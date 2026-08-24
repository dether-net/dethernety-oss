import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloudPanel from '@/components/CloudPanel.vue'
import type { ModeView } from '@/api'

const cloudApply = vi.fn()
const cloudDisable = vi.fn()

// Replace the api object while keeping the real SessionExpired the component catches on.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    api: {
      cloudApply: (recipe: string, redirect: string) => cloudApply(recipe, redirect),
      cloudDisable: () => cloudDisable(),
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
const callbacksValue = (w: W) => (w.find('[data-testid="callbacks"]').element as HTMLTextAreaElement).value

const preCloud: ModeView = { phase: 'pre-cloud', authDisabled: true, cloudFileWritten: false, restartPending: false }
const cloudWritten: ModeView = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
// The disconnect restart window: pure-OSS file written, platform still running cloud.
const disconnectPending: ModeView = { phase: 'authenticated', authDisabled: false, cloudFileWritten: false, restartPending: true }

afterEach(() => {
  cloudApply.mockReset()
  cloudDisable.mockReset()
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
