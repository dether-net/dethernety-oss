import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CloudPanel from '@/components/CloudPanel.vue'
import { ApiError, SessionExpired, type ModeView, type RosterMember } from '@/api'

const cloudApply = vi.fn()
const cloudDisable = vi.fn()
const changeAllowlist = vi.fn()
const roster = vi.fn()
const allowlistRead = vi.fn()

// Replace the api object while keeping the real SessionExpired and ApiError the component catches on.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    api: {
      cloudApply: (recipe: string, redirect: string) => cloudApply(recipe, redirect),
      cloudDisable: () => cloudDisable(),
      changeAllowlist: (allowlist: string) => changeAllowlist(allowlist),
      roster: () => roster(),
      allowlist: () => allowlistRead(),
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
const tick = (w: W, sub: string) => w.find(`[data-cloud-roster-member="${sub}"] input[type="checkbox"]`)
const ticked = (w: W, sub: string) => (tick(w, sub).element as HTMLInputElement).checked
const departedMembers = (w: W) =>
  w.findAll('[data-cloud-departed-member]').map((el) => el.attributes('data-cloud-departed-member'))

const preCloud: ModeView = { phase: 'pre-cloud', authDisabled: true, cloudFileWritten: false, restartPending: false }
const cloudWritten: ModeView = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
// The disconnect restart window: pure-OSS file written, platform still running cloud.
const disconnectPending: ModeView = { phase: 'authenticated', authDisabled: false, cloudFileWritten: false, restartPending: true }

// A team of three, one of them without an address — the content service can list an account that carries
// none, and the card has to show the identifier rather than a blank row.
const sampleMembers: RosterMember[] = [
  { sub: 'sub-a', email: 'anna@example.test' },
  { sub: 'sub-b', email: 'ben@example.test' },
  { sub: 'sub-c', email: '' },
]

// The two reads the card makes: the roster, and the identifiers the deployment admits today.
function team(subjects: string[], members: RosterMember[] = sampleMembers) {
  roster.mockResolvedValue({ members })
  allowlistRead.mockResolvedValue({ subjects })
}

// A deployment whose recipe names no team: both reads refuse with the daemon's sentence at 409, and the
// card falls back to the paste box beneath it.
function noTeam() {
  roster.mockRejectedValue(new ApiError(409, 'NO-TEAM-SENTENCE'))
  allowlistRead.mockRejectedValue(new ApiError(409, 'NO-TEAM-SENTENCE'))
}

function refuseReads(status: number, detail: string) {
  roster.mockRejectedValue(new ApiError(status, detail))
  allowlistRead.mockRejectedValue(new ApiError(status, detail))
}

// A connected deployment with a team is the default: two members admitted, one not, nobody departed.
beforeEach(() => {
  team(['sub-a', 'sub-c'])
})

afterEach(() => {
  cloudApply.mockReset()
  cloudDisable.mockReset()
  changeAllowlist.mockReset()
  roster.mockReset()
  allowlistRead.mockReset()
  try {
    sessionStorage.clear()
  } catch {
    // stubbed away by a test
  }
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


// THE CARD — choosing who may sign in from the team's members, and seeing who has left.
//
// The card fetches two lists and never stores either. Every test below is about what it derives from
// them, what it submits, and what it refuses to hold: the ticks are the admitted list laid over the
// roster, the departed are the admitted list less the roster, the removal submits their intersection,
// and the one thing that crosses the sign-in redirect is a list of identifiers.
describe('CloudPanel — the card', () => {
  const withNotice: ModeView = { ...cloudWritten, allowlistNotice: 'NOTICE-FROM-THE-DAEMON' }

  it('fetches the roster and the admitted list once, on a connected deployment only', async () => {
    for (const mode of [preCloud, disconnectPending]) {
      const w = mount(CloudPanel, { props: { mode } })
      await flushPromises()
      expect(roster).not.toHaveBeenCalled()
      expect(allowlistRead).not.toHaveBeenCalled()
      expect(w.find('[data-cloud-roster]').exists()).toBe(false)
      w.unmount()
    }
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(roster).toHaveBeenCalledTimes(1)
    expect(allowlistRead).toHaveBeenCalledTimes(1)
    expect(w.find('[data-cloud-roster]').exists()).toBe(true)
    w.unmount()
  })

  // THE TICKS ARE DERIVED ON THE PAGE, from two lists the daemon serves separately: it never says who is
  // ticked, because it holds no such thing. An address-less member is a row too, by identifier.
  it('lists every member by address and ticks those the deployment admits today', async () => {
    team(['sub-a', 'sub-c'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.text()).toContain('anna@example.test')
    expect(w.text()).toContain('ben@example.test')
    expect(ticked(w, 'sub-a')).toBe(true)
    expect(ticked(w, 'sub-b')).toBe(false)
    expect(ticked(w, 'sub-c')).toBe(true)
    // The address-less member is shown by identifier, and the absence is said rather than left blank.
    const c = w.find('[data-cloud-roster-member="sub-c"]')
    expect(c.text()).toContain('sub-c')
    expect(c.text()).toContain('no address on file')
    // Nobody has left, so nothing is red and the parent is told zero.
    expect(w.find('[data-cloud-departed]').exists()).toBe(false)
    expect(w.emitted('departed')).toEqual([[0]])
    w.unmount()
  })

  // DEPARTED, BY IDENTIFIER, INDIVIDUALLY. Each admitted identifier that belongs to nobody on the team is
  // its own row — a person who can still read this client's models — and the address is not shown because
  // it is kept nowhere. They are not rendered as unticked members either: an unticked row reads as "not
  // chosen", and these are "no longer choosable".
  it('lists each departed identifier in red, labelled, and counts them for the parent', async () => {
    team(['sub-a', 'sub-gone-1', 'sub-gone-2'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(departedMembers(w)).toEqual(['sub-gone-1', 'sub-gone-2'])
    for (const el of w.findAll('[data-cloud-departed-member]')) {
      expect(el.text()).toContain('no longer on the team')
      expect(el.classes()).toContain('text-dt-quinary')
    }
    expect(w.find('[data-cloud-departed-summary]').text()).toBe('2 people who have left the team can still sign in.')
    expect(w.emitted('departed')).toEqual([[2]])
    expect(tick(w, 'sub-gone-1').exists()).toBe(false)
    // And the card says what that implies: a departed identifier has no tick box, so ANY apply drops it,
    // not only the button. A user document said so before the card did; now both do.
    expect(w.find('[data-cloud-departed]').text()).toContain('Applying any selection removes them too')
    w.unmount()
  })

  it('counts one departed person in the singular', async () => {
    team(['sub-a', 'sub-gone'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-departed-summary]').text()).toBe('1 person who has left the team can still sign in.')
    expect(w.emitted('departed')).toEqual([[1]])
    w.unmount()
  })

  // THE REMOVAL SUBMITS local list ∩ roster AND NOTHING ELSE — not the ticks. An operator who has changed
  // ticks without applying them keeps that draft exactly as it is; the removal keeps everyone still on the
  // team exactly as they were. And it goes through the same write as everything else, so the daemon's
  // guards run on it.
  it('removes people who have left by submitting the intersection, leaving unapplied ticks alone', async () => {
    team(['sub-a', 'sub-c', 'sub-gone'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    // A draft the operator has not applied: untick a, tick b.
    await tick(w, 'sub-a').setValue(false)
    await tick(w, 'sub-b').setValue(true)
    // The list is refreshed after the write; make the second fetch reflect it.
    team(['sub-a', 'sub-c'])
    await w.find('[data-cloud-remove-departed]').trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledTimes(1)
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a\nsub-c')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('2 accounts written')
    // Both lists were fetched again, so the departed row is gone and the ticks show the list as written —
    // which is what the operator was told, not what their unapplied draft said.
    expect(roster).toHaveBeenCalledTimes(2)
    expect(allowlistRead).toHaveBeenCalledTimes(2)
    expect(w.find('[data-cloud-departed]').exists()).toBe(false)
    expect(w.emitted('departed')).toEqual([[1], [0]])
    w.unmount()
  })

  it('applies exactly the ticks, and reports the count and the consequence', async () => {
    team(['sub-a', 'sub-c'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'RESTART-SENTENCE' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await tick(w, 'sub-a').setValue(false)
    await tick(w, 'sub-b').setValue(true)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledTimes(1)
    const sent = (changeAllowlist.mock.calls[0][0] as string).split('\n').sort()
    expect(sent).toEqual(['sub-b', 'sub-c'])
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('2 accounts written')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('RESTART-SENTENCE')
    w.unmount()
  })

  // NOBODY TICKED IS SUBMITTED, NOT SILENTLY DISABLED. The daemon refuses an empty list with a sentence
  // about what an empty list would mean, and that sentence is what the operator should read — not a greyed
  // button with no explanation.
  it('submits an empty selection so the daemon\'s own refusal is what the operator reads', async () => {
    team(['sub-a'])
    changeAllowlist.mockRejectedValue(new ApiError(400, 'EMPTY-LIST-SENTENCE'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await tick(w, 'sub-a').setValue(false)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('EMPTY-LIST-SENTENCE')
    w.unmount()
  })

  // THE NO-TEAM STATE IS A REASON, NOT AN EMPTY LIST. The daemon's sentence is printed, no member list is
  // rendered, and the paste box is offered beneath it as the fallback — not instead of it.
  it('shows the daemon\'s reason and the paste fallback when the deployment names no team', async () => {
    noTeam()
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-roster-no-team]').text()).toContain('NO-TEAM-SENTENCE')
    expect(w.find('[data-cloud-roster]').exists()).toBe(false)
    expect(w.find('[data-cloud-roster-empty]').exists()).toBe(false)
    expect(allowlistBox(w).exists()).toBe(true)
    // And the reason comes first.
    const html = w.html()
    expect(html.indexOf('data-cloud-roster-no-team')).toBeLessThan(html.indexOf('data-cloud-allowlist-input'))
    expect(w.emitted('departed')).toEqual([[undefined]])
    w.unmount()
  })

  // The paste box exists in exactly one arm. Everywhere else the write would be refused for the same
  // reason the read was, so a box there would be an invitation to a refusal.
  it('offers the paste box in no other state', async () => {
    for (const [status, detail] of [[403, 'not admin'], [412, 'sign in'], [503, 'down'], [502, 'refused']] as const) {
      refuseReads(status, detail)
      const w = mount(CloudPanel, { props: { mode: cloudWritten } })
      await flushPromises()
      expect(allowlistBox(w).exists()).toBe(false)
      w.unmount()
    }
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(allowlistBox(w).exists()).toBe(false)
    w.unmount()
  })

  // A MEMBER SEES NOTHING OF THE TEAM. The gate's 403 lands on the fetch, and the card shows the sentence
  // naming who can grant the role — and no list, no ticks, no departed, no box.
  it('shows a member the admin-only sentence and nothing of the team', async () => {
    refuseReads(403, 'You are not an administrator')
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-not-admin]').text()).toContain('administrator role')
    expect(w.find('[data-cloud-roster]').exists()).toBe(false)
    expect(w.find('[data-cloud-departed]').exists()).toBe(false)
    expect(w.find('[data-cloud-allowlist-apply]').exists()).toBe(false)
    // And no retry: a browser run found "Try again" rendered under the sentence, because the template's
    // catch-all arm caught this outcome too. Retrying a 403 fails the same way; the sentence is the answer.
    expect(w.find('[data-cloud-roster-unavailable]').exists()).toBe(false)
    expect(w.find('[data-cloud-roster-refresh]').exists()).toBe(false)
    expect(w.emitted('departed')).toEqual([[undefined]])
    w.unmount()
  })

  // THE PROP GATES THE CONTROLS, AND ONLY AN EXPLICIT FALSE DOES. The content panel's answer can arrive
  // after the roster has, and when it says false the controls disable and say why. Undefined — could not
  // ask — disables nothing, including when the prop is absent altogether.
  it('disables the controls when the parent says the operator is not an administrator', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten, admin: undefined } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-apply]').attributes('disabled')).toBeUndefined()
    await w.setProps({ admin: false })
    expect(w.find('[data-cloud-allowlist-apply]').attributes('disabled')).toBeDefined()
    expect(tick(w, 'sub-a').attributes('disabled')).toBeDefined()
    expect(w.find('[data-cloud-allowlist-not-admin]').text()).toContain('administrator role')
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(changeAllowlist).not.toHaveBeenCalled()
    w.unmount()
  })

  it('leaves the controls available when the answer is unknown, including when the prop is absent', async () => {
    team(['sub-a'])
    for (const props of [{ mode: cloudWritten, admin: undefined }, { mode: cloudWritten }]) {
      const w = mount(CloudPanel, { props })
      await flushPromises()
      expect(w.find('[data-cloud-allowlist-apply]').attributes('disabled')).toBeUndefined()
      expect(w.find('[data-cloud-allowlist-not-admin]').exists()).toBe(false)
      w.unmount()
    }
  })

  // A RELOADED TAB IS OFFERED A SIGN-IN, NEVER SENT TO ONE. The read's 412 is the ordinary state of a
  // reloaded tab; a card that redirected on mount would bounce every reloaded console to the identity
  // provider unasked. The button performs the same redirect the write's 412 does.
  it('offers a sign-in when this tab holds no cloud credential, and redirects only when asked', async () => {
    refuseReads(412, 'sign in again')
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.emitted('sign-in-required')).toBeFalsy()
    expect(w.find('[data-cloud-roster-signed-out]').exists()).toBe(true)
    expect(w.find('[data-cloud-roster]').exists()).toBe(false)
    await w.find('[data-cloud-roster-sign-in]').trigger('click')
    expect(w.emitted('sign-in-required')).toHaveLength(1)
    w.unmount()
  })

  // Every other refusal is the daemon's sentence and a retry — and the retry fetches again.
  it('prints the daemon\'s sentence for an unavailable roster and fetches again on request', async () => {
    for (const status of [502, 503, 500]) {
      refuseReads(status, `ROSTER-REFUSAL-${status}`)
      const w = mount(CloudPanel, { props: { mode: cloudWritten } })
      await flushPromises()
      expect(w.find('[data-cloud-roster-unavailable]').text()).toContain(`ROSTER-REFUSAL-${status}`)
      expect(w.find('[data-cloud-roster]').exists()).toBe(false)
      expect(w.emitted('sign-in-required')).toBeFalsy()
      team(['sub-a'])
      await w.find('[data-cloud-roster-refresh]').trigger('click')
      await flushPromises()
      expect(w.find('[data-cloud-roster]').exists()).toBe(true)
      expect(w.find('[data-cloud-roster-unavailable]').exists()).toBe(false)
      w.unmount()
      roster.mockReset()
      allowlistRead.mockReset()
    }
  })

  // A session expiry is the app's to handle, and the card says nothing — it must not print a refusal
  // under a sign-in card the app is already showing.
  it('says nothing when the session expired on the fetch', async () => {
    roster.mockRejectedValue(new SessionExpired())
    allowlistRead.mockRejectedValue(new SessionExpired())
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-roster-unavailable]').exists()).toBe(false)
    expect(w.find('[data-cloud-roster-signed-out]').exists()).toBe(false)
    expect(w.emitted('sign-in-required')).toBeFalsy()
    w.unmount()
  })

  // THE STASH HOLDS IDENTIFIERS, NEVER THE ROSTER. This is criterion 8's browser half: after the card has
  // been exercised through a 412 redirect, nothing in session storage carries an address. The test reads
  // the stored value back and looks — it does not reason about the code that wrote it.
  it('carries the ticks across the sign-in redirect as identifiers, with no address in storage', async () => {
    team(['sub-a', 'sub-c'])
    changeAllowlist.mockRejectedValue(new ApiError(412, 'sign in again'))
    const first = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await tick(first, 'sub-a').setValue(false)
    await tick(first, 'sub-b').setValue(true)
    await first.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(first.emitted('sign-in-required')).toBeTruthy()
    first.unmount()

    // What the browser now holds, by looking: every key, every value.
    const stored: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) stored.push(sessionStorage.getItem(sessionStorage.key(i)!) ?? '')
    expect(stored.length).toBeGreaterThan(0)
    for (const v of stored) expect(v).not.toContain('@')
    for (const v of stored) expect(v).not.toContain('example.test')
    const draft = JSON.parse(sessionStorage.getItem('byodt.console.allowlist.draft')!)
    expect(draft).toEqual({ ticks: ['sub-c', 'sub-b'] })

    // On return: the roster is fetched again, the ticks are laid over it, and what did not happen is said.
    const back = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(roster).toHaveBeenCalledTimes(2)
    expect(ticked(back, 'sub-a')).toBe(false)
    expect(ticked(back, 'sub-b')).toBe(true)
    expect(ticked(back, 'sub-c')).toBe(true)
    expect(back.find('[data-cloud-allowlist-message]').text()).toContain('nothing was changed')
    back.unmount()

    // And it is consumed, not restored again on a later visit against a moved roster.
    const later = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(ticked(later, 'sub-a')).toBe(true)
    expect(ticked(later, 'sub-b')).toBe(false)
    expect(later.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    later.unmount()
  })

  // A restored tick for someone no longer on the team is dropped: the draft is laid over the roster just
  // fetched, never the other way round.
  it('drops a restored tick for an identifier that has left the team', async () => {
    sessionStorage.setItem('byodt.console.allowlist.draft', JSON.stringify({ ticks: ['sub-a', 'sub-gone'] }))
    team(['sub-a', 'sub-gone'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(ticked(w, 'sub-a')).toBe(true)
    expect(tick(w, 'sub-gone').exists()).toBe(false)
    expect(departedMembers(w)).toEqual(['sub-gone'])
    w.unmount()
  })

  it('discards a draft it did not write', async () => {
    sessionStorage.setItem('byodt.console.allowlist.draft', 'sub-a,sub-b')
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(ticked(w, 'sub-a')).toBe(true)
    expect(w.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    w.unmount()
  })

  // The daemon names the submitter by identifier, which is the one thing an operator does not know about
  // themselves. The mode read carries that identifier, and the row it names is labelled.
  it('labels the signed-in operator\'s own row, by identifier', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: { ...cloudWritten, user: { sub: 'sub-c' } } } })
    await flushPromises()
    expect(w.find('[data-cloud-roster-member="sub-c"]').text()).toContain('(you)')
    expect(w.find('[data-cloud-roster-member="sub-a"]').text()).not.toContain('(you)')
    w.unmount()
  })

  // A daemon that does not yet say the identifier: the address is the fallback, and it is matched without
  // regard to case.
  it('falls back to the address when the mode read carries no identifier', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: { ...cloudWritten, user: { email: 'Anna@Example.test' } } } })
    await flushPromises()
    expect(w.find('[data-cloud-roster-member="sub-a"]').text()).toContain('(you)')
    expect(w.find('[data-cloud-roster-member="sub-b"]').text()).not.toContain('(you)')
    w.unmount()
  })

  // THE OPERATOR CANNOT UNTICK THEMSELVES. The daemon refuses a list that leaves the submitter out, and
  // read on the card its refusal was a puzzle — it told the operator to re-paste a list they never pasted.
  // So the choice is not offered: the row is ticked, its box is disabled, the box says why, and the list
  // the card submits always names them.
  it('keeps the operator\'s own row ticked and disabled, and says why on the box', async () => {
    team(['sub-a', 'sub-c'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'RESTART-SENTENCE' })
    const w = mount(CloudPanel, { props: { mode: { ...cloudWritten, user: { sub: 'sub-a' } } } })
    await flushPromises()
    const you = tick(w, 'sub-a')
    expect((you.element as HTMLInputElement).checked).toBe(true)
    expect((you.element as HTMLInputElement).disabled).toBe(true)
    expect(w.find('[data-cloud-roster-member="sub-a"] label').attributes('title')).toMatch(/lock you out/)
    // A colleague's box is not disabled by the same rule.
    expect((tick(w, 'sub-c').element as HTMLInputElement).disabled).toBe(false)
    // The intro says so, so the disabled box is not a surprise.
    expect(w.text()).toContain('Your own row stays ticked')
    // Belt and braces: a change event on the disabled box is not a choice the card offers.
    await you.setValue(false)
    await tick(w, 'sub-c').setValue(false)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a')
    w.unmount()
  })

  // The seed is the admitted list, and a draft restored across the redirect overrides it — neither may
  // bring back a selection that leaves the operator out. Applied where the ticks are set from outside the
  // operator's hand, so a draft written before this rule existed cannot lock them out either.
  it('ticks the operator\'s own row even when the admitted list or a restored draft omits it', async () => {
    team(['sub-c'])
    const w = mount(CloudPanel, { props: { mode: { ...cloudWritten, user: { sub: 'sub-a' } } } })
    await flushPromises()
    expect([ticked(w, 'sub-a'), ticked(w, 'sub-b'), ticked(w, 'sub-c')]).toEqual([true, false, true])
    w.unmount()

    sessionStorage.setItem('byodt.console.allowlist.draft', JSON.stringify({ ticks: ['sub-b'] }))
    const w2 = mount(CloudPanel, { props: { mode: { ...cloudWritten, user: { sub: 'sub-a' } } } })
    await flushPromises()
    expect([ticked(w2, 'sub-a'), ticked(w2, 'sub-b'), ticked(w2, 'sub-c')]).toEqual([true, true, false])
    w2.unmount()
  })

  // A CHANGE OWES A RESTART, AND THE RECEIPT SAYING SO SCROLLS AWAY. The platform reads the list once,
  // when it starts, and whoever was just removed can sign in until it is recreated. This is the modules
  // tab's sticky reminder in the same shape: raised by a successful write, kept for the session, and
  // naming the command.
  it('raises a sticky restart reminder once a change is written, naming the command', async () => {
    team(['sub-a', 'sub-c'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'RESTART-SENTENCE' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-restart-required]').exists()).toBe(false)
    await tick(w, 'sub-c').setValue(false)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    const banner = w.find('[data-cloud-restart-required]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('byodt restart platform')
    expect(banner.text()).toContain('can still sign in')
    // It outlives the receipt: a later fetch replaces the message, not the reminder.
    await w.find('[data-cloud-roster-refresh]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-restart-required]').exists()).toBe(true)
    w.unmount()
  })

  it('raises no restart reminder for a refused write', async () => {
    team(['sub-a', 'sub-c'])
    changeAllowlist.mockRejectedValue(new ApiError(400, 'EMPTY-LIST-SENTENCE'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await tick(w, 'sub-a').setValue(false)
    await tick(w, 'sub-c').setValue(false)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-restart-required]').exists()).toBe(false)
    w.unmount()
  })

  // The daemon never answers an unrecognised document as an empty team, so this cannot happen — and if it
  // did, an empty list would read as "everyone has left". It is said instead.
  it('never renders an empty team as an empty list', async () => {
    team(['sub-a'], [])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-roster]').exists()).toBe(false)
    expect(w.find('[data-cloud-roster-empty]').text()).toContain('cannot be right')
    w.unmount()
  })

  // A disconnect forgets the lists: they were fetched for a connected deployment and belong to nothing
  // once it is not one.
  it('forgets both lists and tells the parent when the deployment is disconnected', async () => {
    team(['sub-a', 'sub-gone'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.emitted('departed')).toEqual([[1]])
    await w.setProps({ mode: disconnectPending })
    await flushPromises()
    expect(w.find('[data-cloud-roster]').exists()).toBe(false)
    expect(w.emitted('departed')).toEqual([[1], [undefined]])
    w.unmount()
  })

  it('states when a change takes effect BEFORE anything is submitted, in the daemon\'s own words', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-notice]').text()).toBe('NOTICE-FROM-THE-DAEMON')
    const html = w.html()
    expect(html.indexOf('data-cloud-allowlist-notice')).toBeLessThan(html.indexOf('data-cloud-roster'))
    expect(changeAllowlist).not.toHaveBeenCalled()
    w.unmount()
  })

  // A sentence about when a change takes effect, above a card that cannot make one, reads as a promise.
  it('shows the notice only where there is a control to apply', async () => {
    refuseReads(403, 'not admin')
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(false)
    w.unmount()
  })

  it('hides the standing notice once a receipt has replaced it', async () => {
    team(['sub-a'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'NOTICE-FROM-THE-DAEMON' })
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(true)
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('NOTICE-FROM-THE-DAEMON')
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(false)
    w.unmount()
  })

  // Every refusal the operator acts on themselves is printed verbatim — what lets the daemon add one
  // without a change here — and 412 is the one answered by acting.
  it('prints the daemon\'s sentence for every write refusal it cannot act on', async () => {
    team(['sub-a'])
    for (const status of [400, 403, 409, 503]) {
      changeAllowlist.mockRejectedValue(new ApiError(status, `REFUSAL-${status}`))
      const w = mount(CloudPanel, { props: { mode: cloudWritten } })
      await flushPromises()
      await w.find('[data-cloud-allowlist-apply]').trigger('click')
      await flushPromises()
      expect(w.find('[data-cloud-allowlist-message]').text()).toContain(`REFUSAL-${status}`)
      expect(w.emitted('sign-in-required')).toBeFalsy()
      w.unmount()
    }
  })

  it('reports one account in the singular', async () => {
    team(['sub-a'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('1 account written')
    expect(w.find('[data-cloud-allowlist-message]').text()).not.toContain('1 accounts')
    w.unmount()
  })

  it('announces its answer to a screen reader', async () => {
    team(['sub-a'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').attributes('aria-live')).toBe('polite')
    w.unmount()
  })

  // ONE CLICK, ONE WRITE — the button is disabled while the first is in flight.
  it('does not submit twice when the button is clicked again mid-flight', async () => {
    team(['sub-a'])
    let release: (v: unknown) => void = () => {}
    changeAllowlist.mockReturnValue(new Promise((r) => { release = r }))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    const applyBtn = () => w.find('[data-cloud-allowlist-apply]')
    await applyBtn().trigger('click')
    expect(applyBtn().attributes('disabled')).toBeDefined()
    expect(applyBtn().text()).toBe('Applying…')
    await applyBtn().trigger('click')
    expect(changeAllowlist).toHaveBeenCalledTimes(1)
    release({ status: 'applied', subjects: 1, message: 'R' })
    await flushPromises()
    expect(applyBtn().attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  // Two live controls share this panel, and the disconnect receipt must not wipe the card's message or
  // the other way round.
  it('keeps its message separate from the disconnect receipt', async () => {
    team(['sub-a'])
    cloudDisable.mockResolvedValue({ status: 'reverted', message: 'DISCONNECT-RECEIPT' })
    changeAllowlist.mockRejectedValue(new ApiError(409, 'ALLOWLIST-REFUSAL'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await button(w, 'Disconnect from cloud')!.trigger('click')
    await button(w, 'Disconnect')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('DISCONNECT-RECEIPT')
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('ALLOWLIST-REFUSAL')
    expect(w.text()).toContain('DISCONNECT-RECEIPT')
    w.unmount()
  })

  it('says nothing when the session expired on the write — the app is already handling it', async () => {
    team(['sub-a'])
    changeAllowlist.mockRejectedValue(new SessionExpired())
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    expect(w.emitted('sign-in-required')).toBeFalsy()
    w.unmount()
  })

  // Blocked site data must not take the panel down with it: losing a draft is a papercut, a panel that
  // will not mount is not.
  it('still works when session storage is unavailable', async () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
      clear: () => { throw new Error('blocked') },
    }
    vi.stubGlobal('sessionStorage', throwing)
    team(['sub-a'])
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await w.find('[data-cloud-allowlist-apply]').trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('1 account written')
    w.unmount()
  })

  // THE ORDER IS THE ARGUMENT, so it is asserted rather than left to the comment that makes it. Until this
  // control existed the connected state offered only the destructive one, and an operator looking for
  // "change who has access" found Disconnect.
  it('offers the card ABOVE the disconnect control', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    const html = w.html()
    expect(html.indexOf('data-cloud-roster')).toBeGreaterThan(-1)
    expect(html.indexOf('data-cloud-roster')).toBeLessThan(html.indexOf('data-cloud-disconnect'))
    w.unmount()
  })

  // THE STEPS ARE A SEQUENCE, AND THE CARD IS ITS THIRD. Steps 1 and 2 pair with twins on the account
  // portal's deployment page by numeral; so does this one now — the portal's third step assembles the team,
  // this one chooses which of them the deployment admits — and it cannot come earlier, because the roster
  // is fetched for a connected deployment. Disconnect is unnumbered and last: it undoes step 2 rather than
  // being a step, and a destructive control belongs after everything the operator might have come for.
  it('numbers who-may-sign-in as step 3, after configuration and before an unnumbered disconnect', async () => {
    team(['sub-a'])
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    const steps = w.findAll('[data-step]').map((el) => [el.attributes('data-step'), el.element.parentElement?.textContent?.trim()])
    expect(steps).toEqual([
      ['1', '1 Access and callbacks'],
      ['2', '2 Configuration'],
      ['3', '3 Who may sign in'],
    ])
    const html = w.html()
    const order = ['data-section="configuration"', 'data-section="allowlist"', 'data-section="disconnect"'].map((m) => html.indexOf(m))
    expect(order[0]).toBeGreaterThan(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // Step 2, once done, points at step 3 and at the foot of the page rather than holding either.
    expect(w.find('[data-cloud-configured]').text()).toContain('step 3')
    expect(w.find('[data-section="disconnect"] [data-step]').exists()).toBe(false)
    expect(w.find('[data-section="disconnect"] [data-cloud-disconnect]').exists()).toBe(true)
    w.unmount()
  })

  it('shows neither step 3 nor disconnect before the deployment is connected', () => {
    const w = mount(CloudPanel, { props: { mode: preCloud } })
    expect(w.findAll('[data-step]').map((el) => el.attributes('data-step'))).toEqual(['1', '2'])
    expect(w.find('[data-section="allowlist"]').exists()).toBe(false)
    expect(w.find('[data-section="disconnect"]').exists()).toBe(false)
    w.unmount()
  })

  // Said before the recipe is applied, because the recipe lists the whole team and an operator who learns
  // that after loading a client's data has already let the whole team at it.
  it('says on the connect form that every member will be able to sign in', () => {
    const w = mount(CloudPanel, { props: { mode: preCloud } })
    const p = w.find('[data-cloud-connect-everyone]')
    expect(p.text()).toContain('Every member of your team will be able to sign in')
    expect(p.text()).toContain('narrow who can sign in before you load it')
    const html = w.html()
    expect(html.indexOf('data-cloud-connect-everyone')).toBeLessThan(html.indexOf('<form'))
    w.unmount()
  })
})

// THE PASTE FALLBACK — the box that was the whole control, now offered only on a deployment whose recipe
// names no team. Everything it did it still does, beneath the daemon's reason.
describe('CloudPanel — the paste fallback', () => {
  const withNotice: ModeView = { ...cloudWritten, allowlistNotice: 'NOTICE-FROM-THE-DAEMON' }

  beforeEach(() => {
    noTeam()
  })

  it('says the current list cannot be shown on this deployment, so nobody edits from memory', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.text()).toContain('cannot show you the current list')
    // And that it REPLACES rather than adds, which is the other thing a blind box has to say out loud.
    expect(w.text()).toContain('replaces')
    w.unmount()
  })

  // WHERE THE VALUE COMES FROM, pinned because it moved once: the box used to name a copyable card on the
  // portal that no longer exists. The recipe's own line is the source, and nothing else on the portal is.
  it('names the recipe\'s DEPLOYMENT_ALLOWLIST line as the value to paste, and no portal card', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    const source = w.find('[data-cloud-paste-source]').text()
    expect(source).toContain('DEPLOYMENT_ALLOWLIST')
    expect(source).toContain('deployment recipe')
    expect(source).not.toContain('card')
    w.unmount()
  })

  it('submits the pasted value and reports the count and the consequence', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 3, message: 'RESTART-SENTENCE' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await allowlistBox(w).setValue('sub-a,sub-b,sub-c')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a,sub-b,sub-c')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('3 accounts written')
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('RESTART-SENTENCE')
    w.unmount()
  })

  // The list is typed while the answer is unknown, then the role arrives — the only sequence that leaves
  // the role as the sole cause of a disabled button, since the box is disabled for a member too.
  it('disables it for a member and says who can grant the role', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten, admin: undefined } })
    await flushPromises()
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

  it('answers 412 by asking for a sign-in rather than printing one', async () => {
    changeAllowlist.mockRejectedValue(new ApiError(412, 'sign in again'))
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.emitted('sign-in-required')).toBeTruthy()
    expect(w.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    w.unmount()
  })

  it('reports one account in the singular, clears the box, and disables itself again', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 1, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await allowlistBox(w).setValue('sub-a')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-message]').text()).toContain('1 account written')
    expect((allowlistBox(w).element as HTMLTextAreaElement).value).toBe('')
    expect(button(w, 'Apply access list')!.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  // The client sends what was pasted, and NOTHING normalises it here: every separator rule belongs to the
  // daemon, which is what has to agree with the platform about what the value means.
  it('sends the pasted value verbatim, normalising nothing', async () => {
    changeAllowlist.mockResolvedValue({ status: 'applied', subjects: 2, message: 'R' })
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await allowlistBox(w).setValue('sub-a\nsub-b\n')
    await button(w, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(changeAllowlist).toHaveBeenCalledWith('sub-a\nsub-b\n')
    w.unmount()
  })

  it('states when a change takes effect above the box, not below the button', async () => {
    const w = mount(CloudPanel, { props: { mode: withNotice } })
    await flushPromises()
    const html = w.html()
    expect(html.indexOf('data-cloud-allowlist-notice')).toBeGreaterThan(-1)
    expect(html.indexOf('data-cloud-allowlist-notice')).toBeLessThan(html.indexOf('data-cloud-allowlist-input'))
    w.unmount()
  })

  it('shows no notice element at all when the daemon sent none', async () => {
    const w = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect(w.find('[data-cloud-allowlist-notice]').exists()).toBe(false)
    w.unmount()
  })

  // THE REDIRECT MUST NOT EAT WHAT THE OPERATOR COMPOSED — and what it keeps is the paste, which is
  // identifiers the operator typed, under the same key the card's ticks use.
  it('keeps the pasted list across the sign-in redirect, and says what did not happen', async () => {
    changeAllowlist.mockRejectedValue(new ApiError(412, 'sign in again'))
    const first = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    await allowlistBox(first).setValue('sub-a,sub-b,sub-c')
    await button(first, 'Apply access list')!.trigger('click')
    await flushPromises()
    expect(first.emitted('sign-in-required')).toBeTruthy()
    first.unmount()

    expect(JSON.parse(sessionStorage.getItem('byodt.console.allowlist.draft')!)).toEqual({ paste: 'sub-a,sub-b,sub-c' })

    const back = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect((allowlistBox(back).element as HTMLTextAreaElement).value).toBe('sub-a,sub-b,sub-c')
    expect(back.find('[data-cloud-allowlist-message]').text()).toContain('nothing was changed')
    back.unmount()

    const later = mount(CloudPanel, { props: { mode: cloudWritten } })
    await flushPromises()
    expect((allowlistBox(later).element as HTMLTextAreaElement).value).toBe('')
    expect(later.find('[data-cloud-allowlist-message]').exists()).toBe(false)
    later.unmount()
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
