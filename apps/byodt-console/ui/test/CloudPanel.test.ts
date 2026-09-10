import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloudPanel from '@/components/CloudPanel.vue'
import type { ModeView } from '@/api'

const cloudApply = vi.fn()
const cloudDisable = vi.fn()
const changeAllowlist = vi.fn()

// Replace the api object while keeping the real SessionExpired the component catches on.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    api: {
      cloudApply: (recipe: string, redirect: string) => cloudApply(recipe, redirect),
      cloudDisable: () => cloudDisable(),
      changeAllowlist: (allowlist: string) => changeAllowlist(allowlist),
    },
  }
})

vi.mock('@/auth', () => ({
  consoleRedirectUri: () => 'http://localhost:3000/console/auth/callback',
}))

type W = ReturnType<typeof mount>
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)
// Two textareas exist now (the read-only callbacks in step 1 and the recipe in step 2's form), so
// target each by its aria-label / testid rather than the first match.
const recipeBox = (w: W) => w.find('textarea[aria-label="deployment login recipe"]')
const allowlistBox = (w: W) => w.find('[data-cloud-allowlist-input]')
const callbacksValue = (w: W) => (w.find('[data-testid="callbacks"]').element as HTMLTextAreaElement).value

const preCloud: ModeView = { phase: 'pre-cloud', authDisabled: true, cloudFileWritten: false, restartPending: false }
const cloudWritten: ModeView = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
// The disconnect restart window: pure-OSS file written, platform still running cloud.
const disconnectPending: ModeView = { phase: 'authenticated', authDisabled: false, cloudFileWritten: false, restartPending: true }

afterEach(() => {
  cloudApply.mockReset()
  cloudDisable.mockReset()
  changeAllowlist.mockReset()
  vi.unstubAllGlobals()
})

describe('CloudPanel', () => {
  it('always shows both callbacks to register, one per line, in every connect state', () => {
    for (const mode of [preCloud, cloudWritten, disconnectPending]) {
      const w = mount(CloudPanel, { props: { mode } })
      const lines = callbacksValue(w).split('\n')
      // The platform's front-door callback and the console's own PKCE callback, each on its own line.
      expect(lines).toContain(window.location.origin + '/auth/callback')
      expect(lines).toContain('http://localhost:3000/console/auth/callback')
      w.unmount()
    }
  })

  it('copies both callbacks to the clipboard from step 1', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const w = mount(CloudPanel, { props: { mode: preCloud } })

    await button(w, 'Copy')!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain(window.location.origin + '/auth/callback')
    expect(copied).toContain('http://localhost:3000/console/auth/callback')
    expect(w.text()).toContain('Copied.')
    w.unmount()
  })

  it('applies a pasted recipe with the seeded redirect URI and shows the result', async () => {
    cloudApply.mockResolvedValue({ status: 'applied', message: 'cloud configuration written' })
    const w = mount(CloudPanel, { props: { mode: preCloud } })

    await recipeBox(w).setValue('OIDC_ISSUER=https://issuer')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(cloudApply).toHaveBeenCalledTimes(1)
    const [recipe, redirect] = cloudApply.mock.calls[0]
    expect(recipe).toBe('OIDC_ISSUER=https://issuer')
    expect(redirect).toMatch(/\/auth\/callback$/)
    expect(w.text()).toContain('cloud configuration written')
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  it('offers disconnect (not the paste form) once a cloud file is written', async () => {
    cloudDisable.mockResolvedValue({ status: 'reverted', message: 'reverted to pure-OSS' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })

    expect(recipeBox(w).exists()).toBe(false) // no paste form when connected
    await button(w, 'Disconnect from cloud')!.trigger('click')
    await w.find('[data-cloud-disconnect-accept]').trigger('click')
    await flushPromises()

    expect(cloudDisable).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('reverted to pure-OSS')
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  // The disconnect button opens a confirmation and does nothing else. This is the whole point of the
  // gate: a stack-recreating revert was one click from anywhere in the panel.
  it('asks before disconnecting — the button alone reverts nothing', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })

    await button(w, 'Disconnect from cloud')!.trigger('click')
    await flushPromises()

    expect(w.find('[data-cloud-disconnect-confirm]').exists()).toBe(true)
    expect(cloudDisable).not.toHaveBeenCalled()
    expect(w.emitted('changed')).toBeUndefined()
    w.unmount()
  })

  it('cancelling closes the confirmation and reverts nothing', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })

    await button(w, 'Disconnect from cloud')!.trigger('click')
    await w.find('[data-cloud-disconnect-cancel]').trigger('click')
    await flushPromises()

    expect(w.find('[data-cloud-disconnect-confirm]').exists()).toBe(false)
    expect(cloudDisable).not.toHaveBeenCalled()
    // The button comes back, so a cancel is not a dead end.
    expect(button(w, 'Disconnect from cloud')!.attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  // The confirmation has to carry the CONSEQUENCE, not just the action. A card that said only "the modules
  // are removed" would read as tidying up, when what follows at the next restart is the platform dropping
  // those modules' classes and every link to them — and reconnecting does not bring the links back.
  it('the confirmation names the removal and what it costs at the next restart', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })

    await button(w, 'Disconnect from cloud')!.trigger('click')

    const card = w.find('[data-cloud-disconnect-confirm]')
    expect(card.text()).toContain('Every cloud-provided module is removed')
    const consequence = w.find('[data-cloud-disconnect-graph]').text()
    expect(consequence).toContain('deletes the classes those modules provide')
    expect(consequence).toContain('every link to them')
    // The half that is NOT reversible has to be said, or "reconnect to undo it" is what an operator hears.
    expect(consequence).toContain('brings the classes back but not those links')
    w.unmount()
  })

  it('offers neither paste nor disconnect during the disconnect restart window', () => {
    const w = mount(CloudPanel, { props: { mode: disconnectPending } })
    // No reconnect over a deployment the platform is still running, and nothing to disconnect — but the
    // step-1 callbacks Copy button is still present, so assert on the specific controls, not "no button".
    expect(recipeBox(w).exists()).toBe(false)
    expect(button(w, 'Disconnect from cloud')).toBeUndefined()
    expect(button(w, 'Apply cloud configuration')).toBeUndefined()
    expect(w.text()).toContain('recreate the stack')
    w.unmount()
  })
})

// DISCONNECT IS REFUSED AT THE CLICK, NOT AFTER THE CONFIRMATION.
//
// This panel makes no entitled call of its own, so the answer is handed down: the content panel is mounted
// whenever the deployment is post-cloud, and already holds it. Leaving the control live because this panel
// cannot ask would mean the console's most destructive operation refusing a member only AFTER they had read
// four bullet points about irreversible deletion and accepted them.
describe('CloudPanel — the admin gate', () => {
  it('disables disconnect for a member, and says who can grant the role', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten, admin: false } })
    const b = button(w, 'Disconnect from cloud')!
    expect(b.attributes('disabled')).toBeDefined()
    // Visible and explained, never hidden — and the sentence sits where the confirmation card would open.
    expect(w.find('[data-cloud-disconnect-not-admin]').exists()).toBe(true)
    expect(w.find('[data-cloud-disconnect-not-admin]').text()).toContain('administrator role')
    // And the confirmation must never be reachable: refusing after it is the failure this prevents.
    await b.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-disconnect-confirm]').exists()).toBe(false)
    expect(cloudDisable).not.toHaveBeenCalled()
    w.unmount()
  })

  it('leaves disconnect available to an administrator', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten, admin: true } })
    expect(button(w, 'Disconnect from cloud')!.attributes('disabled')).toBeUndefined()
    expect(w.find('[data-cloud-disconnect-not-admin]').exists()).toBe(false)
    w.unmount()
  })

  // COULD-NOT-ASK MUST NOT DISABLE, and Vue would have made this fail on its own: it applies boolean
  // casting to a prop it infers as Boolean, so an absent `admin` arrives as `false` unless the default is
  // stated explicitly. That collapses the three-valued answer into the one value allowed to gate — and
  // every parent not yet passing it would disable disconnect for everybody.
  it('leaves disconnect available when the answer is unknown, including when the prop is absent', async () => {
    for (const props of [{ mode: cloudWritten, admin: undefined }, { mode: cloudWritten }]) {
      const w = mount(CloudPanel, { props })
      expect(button(w, 'Disconnect from cloud')!.attributes('disabled')).toBeUndefined()
      expect(w.find('[data-cloud-disconnect-not-admin]').exists()).toBe(false)
      w.unmount()
    }
  })
})


// THE ACCESS LIST — changing who may sign in without disconnecting.
//
// The whole point of this control is that the operation it replaces destroys graph data. Every test below
// is therefore about it being reachable, honest about when it applies, and refusing in ways the operator
// can act on.
describe('CloudPanel — the access list', () => {
  const withNotice: ModeView = { ...cloudWritten, allowlistNotice: 'NOTICE-FROM-THE-DAEMON' }

  it('offers it only on a connected deployment', () => {
    for (const mode of [preCloud, disconnectPending]) {
      const w = mount(CloudPanel, { props: { mode } })
      expect(allowlistBox(w).exists()).toBe(false)
      w.unmount()
    }
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    expect(allowlistBox(w).exists()).toBe(true)
    w.unmount()
  })

  // A DISTINCTIVE FIXTURE VALUE, and that is the point of the test rather than an incidental choice: no
  // hardcoded copy of the sentence in this component could satisfy it. It passes only if the panel is
  // rendering what the daemon sent, which is what "one definition, no drift" has to mean here.
  it('states when a change takes effect BEFORE anything is submitted, in the daemon\'s own words', () => {
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    expect(w.find('[data-cloud-allowlist-notice]').text()).toBe('NOTICE-FROM-THE-DAEMON')
    expect(changeAllowlist).not.toHaveBeenCalled()
    w.unmount()
  })

  it('says the current list cannot be shown, so nobody edits from memory', () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    expect(w.text()).toContain('cannot show you the current list')
    // And that it REPLACES rather than adds, which is the other thing a blind box has to say out loud.
    expect(w.text()).toContain('replaces')
    w.unmount()
  })

  it('submits the pasted value and reports the count and the consequence', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 3, message: 'RESTART-SENTENCE' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a,sub-b,sub-c')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a,sub-b,sub-c')
    // The count is the only check the operator has that their paste was read as three people, not one.
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('3 accounts written')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('RESTART-SENTENCE')
    w.unmount()
  })

  // THE LIST IS TYPED WHILE THE ANSWER IS STILL UNKNOWN, AND THEN THE ROLE ARRIVES. That sequence is the
  // test rather than setup, because `disabled` on this button has TWO causes and only one of them is the
  // role.
  //
  // An untouched panel is disabled because the box is empty, so asserting `disabled` there holds whether or
  // not the control gates on the role at all. Filling the box first does not separate them either: the
  // TEXTAREA is disabled for a member too, so the value never lands and the empty-box cause is back.
  //
  // Mounting with the answer undetermined leaves both enabled, so the value goes in; flipping the prop then
  // leaves the role as the only cause left that could explain a disabled button. It is also the real
  // sequence — the catalog read is what learns the role, and it lands after the panel has rendered.
  it('disables it for a member and says who can grant the role', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten, admin: undefined } })
    await allowlistBox(w).setValue('sub-a,sub-b')
    expect(button(w, 'Apply access list')!.attributes('disabled')).toBeUndefined()

    await w.setProps({ admin: false })
    expect(allowlistBox(w).attributes('disabled')).toBeDefined()
    expect(button(w, 'Apply access list')!.attributes('disabled')).toBeDefined()
    expect(w.find('[data-cloud-allowlist-not-admin]').text()).toContain('administrator role')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(changeAllowlist).not.toHaveBeenCalled()
    w.unmount()
  })

  // The same three-valued rule disconnect follows: only an explicit false gates, and Vue's boolean casting
  // would otherwise turn an absent prop into one.
  it('stays available when the answer is unknown, including when the prop is absent', async () => {
    for (const props of [{ mode: cloudWritten, admin: undefined }, { mode: cloudWritten }]) {
      const w = mount(CloudPanel, { props })
      await allowlistBox(w).setValue('sub-a')
      expect(button(w, 'Apply access list')!.attributes('disabled')).toBeUndefined()
      expect(w.find('[data-cloud-allowlist-not-admin]').exists()).toBe(false)
      w.unmount()
    }
  })

  // 412 IS THE ONE REFUSAL ANSWERED BY ACTING. Printing it would strand the operator: the access token is
  // memory-only, so a reloaded tab is signed in, shows their name, and holds nothing to ask with — and the
  // console hides its only sign-in control while signed in.
  it('answers 412 by asking for a sign-in rather than printing one', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    changeAllowlist.mockRejectedValue(new ApiError(412, 'sign in again'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.emitted('sign-in-required')).toBeTruthy()
    expect(w.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    w.unmount()
  })

  // Every other refusal is prose the operator acts on themselves, so it is printed verbatim — which is
  // what lets the daemon add a refusal without a change here.
  it('prints the daemon\'s sentence for every refusal it cannot act on', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    for (const status of [400, 403, 409, 503]) {
      changeAllowlist.mockRejectedValue(new ApiError(status, `REFUSAL-${status}`))
      const w = mount(CloudPanel, { props: { mode: cloudWritten } })
      await allowlistBox(w).setValue('sub-a')
      await button(w, 'Apply access list')!.trigger('click')
      await flushPromises()
      expect(w.find('[data-cloud-allowlist-message]').text()).toContain(`REFUSAL-${status}`)
      expect(w.emitted('sign-in-required')).toBeFalsy()
      w.unmount()
    }
  })

  // Two live controls now share this panel. They had one message ref between them while they could never
  // be on screen together, and sharing it now would wipe whichever spoke first.
  it('keeps its message separate from the disconnect receipt', async () => {
    cloudDisable.mockResolvedValue({ status: 'reverted', message: 'DISCONNECT-RECEIPT' })
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    changeAllowlist.mockRejectedValue(new ApiError(409, 'ALLOWLIST-REFUSAL'))

    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await button(w, 'Disconnect from cloud')!.trigger('click')
    await button(w, 'Disconnect')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('DISCONNECT-RECEIPT')

    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('ALLOWLIST-REFUSAL')
    expect(w.text()).toContain('DISCONNECT-RECEIPT')
    w.unmount()
  })
  // The singular, the reset, and the re-disable — one apply, because they are one interaction. A control
  // whose box still holds the list it just wrote invites a second submit of the same thing, and a blind
  // box makes that hard to notice.
  it('reports one account in the singular, clears the box, and disables itself again', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('1 account written')
    expect(w.find('[data-cloud-allowlist-message]').text()).not.toContain('1 accounts')
    expect((allowlistBox(w).element as HTMLTextAreaElement).value).toBe('')
    // Empty box, so the control is back to refusing an empty submit rather than sending one.
    expect(button(w, 'Apply access list')!.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  // The client sends what was pasted, and NOTHING normalises it here. Every separator rule belongs to the
  // daemon, because the daemon is what has to agree with the platform about what the value means — a
  // client-side tidy-up would be a second opinion on that question, and an invisible one. The fixture is
  // newline-separated because that is what copying from the portal produces.
  it('sends the pasted value verbatim, normalising nothing', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a\nsub-b\n')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a\nsub-b\n')
    w.unmount()
  })

  // The notice sits ABOVE the box, not under the button, because the footnote position is the one a reader
  // skips — and this is the sentence that stops an operator concluding the console failed.
  it('states when a change takes effect above the box, not below the button', () => {
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    const html = w.html()
    expect(html.indexOf('data-cloud-allowlist-notice')).toBeLessThan(html.indexOf('data-cloud-allowlist-input'))
    w.unmount()
  })

  // The receipt repeats the notice verbatim, so showing both stacks two identical grey blocks and buries
  // the count in front of the second one.
  it('hides the standing notice once a receipt has replaced it', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'NOTICE-FROM-THE-DAEMON' })
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(true)
    await allowlistBox(w).setValue('sub-a,sub-b')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('NOTICE-FROM-THE-DAEMON')
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(false)
    w.unmount()
  })

  // The count is the only confirmation this control can give, so it must reach a screen reader too.
  it('announces its answer to a screen reader', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a,sub-b')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').attributes('aria-live')).toBe('polite')
    w.unmount()
  })

  it('shows no notice element at all when the daemon sent none', () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(false)
    w.unmount()
  })

  // The clobber the second message ref exists to prevent, from the OTHER side. The existing test covers
  // disconnect-then-allowlist; this is an access-list receipt on screen when the operator reaches for
  // Disconnect, which is the likelier order — they change the list, then decide to disconnect anyway.
  it('keeps its receipt when the operator opens the disconnect confirmation', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'ALLOWLIST-RECEIPT' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a,sub-b')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('ALLOWLIST-RECEIPT')

    await button(w, 'Disconnect from cloud')!.trigger('click')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('ALLOWLIST-RECEIPT')
    w.unmount()
  })

  // ONE CLICK, ONE WRITE. The box is not cleared until the answer comes back, so a second click while the
  // first is still in flight submits the same list again — two writes to the mode layer for one operator
  // intention. The lock in the daemon makes that safe rather than corrupting, but "safe" is not "intended",
  // and the second write's answer overwrites the first's receipt.
  it('does not submit twice when the button is clicked again mid-flight', async () => {
    let release: (v: unknown) => void = () => {}
    changeAllowlist.mockReturnValue(new Promise((r) => { release = r }))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    // By the data hook, not the label: the label becomes "Applying…" while in flight, which is itself part
    // of what this test is about.
    const applyBtn = () => w.find('[data-cloud-allowlist-apply]')
    await allowlistBox(w).setValue('sub-a')
    await applyBtn().trigger('click')
    expect(applyBtn().attributes('disabled')).toBeDefined()
    expect(applyBtn().text()).toBe('Applying…')
    await applyBtn().trigger('click')
    expect(changeAllowlist).toHaveBeenCalledTimes(1)

    release({ status: 'applied', subjects: 1, message: 'R' })
    await flushPromises()
    // And the control comes back afterwards rather than staying dead.
    await allowlistBox(w).setValue('sub-b')
    expect(applyBtn().attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  // A SESSION EXPIRY IS NOT AN ERROR TO REPORT HERE. The app is already taking the operator to the sign-in
  // card; printing the exception underneath it adds a second explanation for one event, and it is the one
  // the operator can do nothing about.
  it('says nothing when the session expired — the app is already handling it', async () => {
    const { SessionExpired } = await vi.importActual<typeof import('@/api')>('@/api')
    changeAllowlist.mockRejectedValue(new SessionExpired())
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    expect(w.emitted('sign-in-required')).toBeFalsy()
    w.unmount()
  })

  // THE REDIRECT MUST NOT EAT WHAT THE OPERATOR COMPOSED. 412 navigates the whole page to the identity
  // provider, so anything not stashed first is gone — and the operator comes back to an empty box with no
  // sign that their apply did not happen.
  it('keeps the pasted list across the sign-in redirect, and says what did not happen', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    changeAllowlist.mockRejectedValue(new ApiError(412, 'sign in again'))
    const first = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(first).setValue('sub-a,sub-b,sub-c')
    await button(first, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(first.emitted('sign-in-required')).toBeTruthy()
    first.unmount()

    // What the operator gets after the identity provider sends them back: a fresh mount. The restore
    // happens in onMounted, so the DOM needs a tick before the box reflects it.
    const back = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect((allowlistBox(back).element as HTMLTextAreaElement).value).toBe('sub-a,sub-b,sub-c')
    expect(back.find('[data-cloud-allowlist-message]').text()).toContain('nothing was changed')
    back.unmount()

    // And it is consumed, not left to be restored again on some later visit against a moved roster.
    const later = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect((allowlistBox(later).element as HTMLTextAreaElement).value).toBe('')
    expect(later.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    later.unmount()
  })

  // Blocked site data must not take the panel down with it: losing a draft is a papercut, a panel that
  // will not mount is not.
  it('still works when session storage is unavailable', async () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    vi.stubGlobal('sessionStorage', throwing)
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('1 account written')
    w.unmount()
  })

  // THE ORDER IS THE ARGUMENT, so it is asserted rather than left to the comment that makes it. Until this
  // control existed the connected state offered only the destructive one, and an operator looking for
  // "change who has access" found Disconnect.
  it('offers the access list ABOVE the disconnect control', () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    const html = w.html()
    expect(html.indexOf('data-cloud-allowlist-input')).toBeGreaterThan(-1)
    expect(html.indexOf('data-cloud-allowlist-input')).toBeLessThan(html.indexOf('data-cloud-disconnect'))
    w.unmount()
  })
})

// DISCONNECT ANSWERS 412 THE SAME WAY, and did not until now. The gate has been able to answer 412 on
// disconnect since it shipped, and this panel printed it — leaving a reloaded tab told to sign in, in a
// console with no visible way to do it. The content panel has answered it correctly all along.
describe('CloudPanel — disconnect and the missing sign-in', () => {
  it('asks for a sign-in when the gate says this tab holds no credential', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    cloudDisable.mockRejectedValue(new ApiError(412, 'sign in again'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await button(w, 'Disconnect from cloud')!.trigger('click')
    await button(w, 'Disconnect')!.trigger('click')
    await flushPromises()
    expect(w.emitted('sign-in-required')).toBeTruthy()
    // And the in-flight label does not survive the redirect.
    expect(w.text()).not.toContain('Reverting…')
    w.unmount()
  })

  // THE NEGATIVE TWIN, without which the 412 test above passes on a component that redirects for EVERY
  // refusal. The gate defines four distinct refusals precisely so the interface can tell them apart;
  // collapsing them would send an operator who is simply not an administrator through a full-page sign-in
  // that fixes nothing, and would never show them the sentence naming who can grant the role.
  it('prints the other gate refusals instead of redirecting', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/api')>('@/api')
    for (const status of [403, 409, 503]) {
      cloudDisable.mockRejectedValue(new ApiError(status, `DISCONNECT-REFUSAL-${status}`))
      const w = mount(CloudPanel, { props: { mode: cloudWritten } })
      await button(w, 'Disconnect from cloud')!.trigger('click')
      await button(w, 'Disconnect')!.trigger('click')
      await flushPromises()
      expect(w.text()).toContain(`DISCONNECT-REFUSAL-${status}`)
      expect(w.emitted('sign-in-required')).toBeFalsy()
      w.unmount()
    }
  })
})
