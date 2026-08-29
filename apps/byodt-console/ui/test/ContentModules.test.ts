import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContentModules from '@/components/ContentModules.vue'
import { clearCloudTokens, setCloudTokens, type CatalogPackage, type MountedModule } from '@/api'

const packages = vi.fn()
const modules = vi.fn()
const mountModule = vi.fn()
const unmountModule = vi.fn()
const installArtifact = vi.fn()

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    api: {
      packages: () => packages(),
      modules: () => modules(),
      mountModule: (req: unknown) => mountModule(req),
      unmountModule: (key: string) => unmountModule(key),
      installArtifact: (req: unknown) => installArtifact(req),
    },
  }
})

afterEach(() => {
  packages.mockReset()
  modules.mockReset()
  mountModule.mockReset()
  unmountModule.mockReset()
  installArtifact.mockReset()
  // The tokens are module-level state in the real api module, which the mock spreads through — so a test
  // that sets them would otherwise leak them into every test that runs after it.
  clearCloudTokens()
})

const catalog: CatalogPackage[] = [
  {
    key: 'acme-cloud',
    name: 'Acme Cloud',
    version: '1.4.0',
    artifacts: [],
    modules: [
      { key: 'acme-compute', name: 'Acme Compute', version: '1.4.0', contentHash: 'sha256:aaa' },
      { key: 'acme-net', name: 'Acme Net', version: '1.4.0', contentHash: 'sha256:ccc' },
    ],
  },
]

// `[data-not-subscribed]` is the PACKAGE chip. The artifact panel renders inside this component and has a
// chip of its own, namespaced `data-artifact-not-subscribed` for that reason — a shared hook would make
// every assertion here match whichever rendered first, and silently, since these fixtures carry no
// artifacts today and would start carrying one the moment a case needed it.
const btn = (w: ReturnType<typeof mount>, text: string) => w.findAll('button').find((b) => b.text() === text)

// Bands are collapsed by default; expand one to reveal its module rows.
const expand = async (w: ReturnType<typeof mount>, key = 'acme-cloud') => {
  await w.get(`[data-expand="${key}"]`).trigger('click')
  await flushPromises()
}

describe('ContentModules', () => {
  it('collapses bands by default and reveals a package module on expand, then mounts it', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    mountModule.mockResolvedValue({ status: 'mounted', message: 'module mounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // The band header shows; the module list stays hidden until expanded.
    expect(w.text()).toContain('Acme Cloud')
    expect(w.text()).toContain('0/2 mounted')
    expect(w.text()).not.toContain('Acme Compute')
    expect(btn(w, 'Mount')).toBeUndefined()

    await expand(w)
    expect(w.text()).toContain('Acme Compute')

    await btn(w, 'Mount')!.trigger('click')
    await flushPromises()
    expect(mountModule).toHaveBeenCalledWith({ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:aaa' })
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  it('shows the restart-required notice naming byodt restart platform after a mount', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    mountModule.mockResolvedValue({ status: 'mounted', message: 'module mounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // No restart notice until an action needs one.
    expect(w.find('[data-restart-required]').exists()).toBe(false)

    await expand(w)
    await btn(w, 'Mount')!.trigger('click')
    await flushPromises()

    const notice = w.find('[data-restart-required]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('byodt restart platform')
    w.unmount()
  })

  it('shows a mounted module inline with Unmount and no Mount', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [{ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:aaa', currency: 'current' }],
    })
    unmountModule.mockResolvedValue({ status: 'unmounted', message: 'module unmounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // The collapsed header already summarises how many are mounted.
    expect(w.text()).toContain('1/2 mounted')
    await expand(w)

    expect(w.text()).toContain('up to date')
    // acme-compute is mounted (Unmount), acme-net is not (Mount) — so exactly one per-module Mount.
    expect(w.findAll('button').filter((b) => b.text() === 'Mount')).toHaveLength(1)

    await btn(w, 'Unmount')!.trigger('click')
    await flushPromises()
    expect(unmountModule).toHaveBeenCalledWith('acme-compute')
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  it('shows an outdated mount and updates it to the latest pin', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [
        {
          packageKey: 'acme-cloud',
          moduleKey: 'acme-compute',
          name: 'Acme Compute',
          pin: 'sha256:aaa',
          currency: 'outdated',
          latestPin: 'sha256:bbb',
          latestVersion: '2.0.0',
        },
      ],
    })
    mountModule.mockResolvedValue({ status: 'mounted', message: 'module mounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    await expand(w)
    expect(w.text()).toContain('newer available')
    await btn(w, 'Update')!.trigger('click')
    await flushPromises()
    expect(mountModule).toHaveBeenCalledWith({ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:bbb' })
    w.unmount()
  })

  it('Mount all mounts every unmounted module in the package', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    mountModule.mockResolvedValue({ status: 'mounted', message: 'module mounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // Mount all lives on the header, so it works without expanding the band.
    await btn(w, 'Mount all')!.trigger('click')
    await flushPromises()
    expect(mountModule).toHaveBeenCalledTimes(2)
    expect(mountModule).toHaveBeenCalledWith({ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:aaa' })
    expect(mountModule).toHaveBeenCalledWith({ packageKey: 'acme-cloud', moduleKey: 'acme-net', pin: 'sha256:ccc' })
    // One reload trigger for the whole batch, not one per module.
    expect(w.emitted('changed')).toHaveLength(1)
    expect(w.text()).toContain('Mounted 2 modules')
    w.unmount()
  })

  it('Unmount all unmounts every mounted module in the package', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [
        { packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:aaa', currency: 'current' },
        { packageKey: 'acme-cloud', moduleKey: 'acme-net', pin: 'sha256:ccc', currency: 'current' },
      ],
    })
    unmountModule.mockResolvedValue({ status: 'unmounted', message: 'module unmounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    await expand(w)
    // Everything mounted → no per-module Mount, and a package Unmount all.
    expect(w.findAll('button').some((b) => b.text() === 'Mount')).toBe(false)
    await btn(w, 'Unmount all')!.trigger('click')
    await flushPromises()
    expect(unmountModule).toHaveBeenCalledTimes(2)
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  it('keeps a mounted module that the catalog no longer lists, still unmountable', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [{ packageKey: 'old-pkg', moduleKey: 'ghost', name: 'Ghost', pin: 'sha256:zzz', currency: 'unknown' }],
    })
    unmountModule.mockResolvedValue({ status: 'unmounted', message: 'module unmounted' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // Orphans are not part of a collapsible band — they stay visible so they remain unmountable.
    expect(w.text()).toContain('Mounted — not in catalog')
    expect(w.text()).toContain('Ghost')
    await btn(w, 'Unmount')!.trigger('click')
    await flushPromises()
    expect(unmountModule).toHaveBeenCalledWith('ghost')
    w.unmount()
  })

  it('still shows the mounted inventory when the catalog is unreachable', async () => {
    packages.mockRejectedValue(new Error('could not load the catalog'))
    modules.mockResolvedValue({
      modules: [{ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:aaa', currency: 'unknown' }],
    })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    expect(w.text()).toContain('could not load the catalog')
    // The mounted module is still listed (as not-in-catalog) so it can be unmounted.
    expect(w.findAll('button').some((b) => b.text() === 'Unmount')).toBe(true)
    w.unmount()
  })

  it('shows a module description inline and links to the portal catalog', async () => {
    packages.mockResolvedValue({
      packages: [
        {
          key: 'acme-cloud',
          name: 'Acme Cloud',
          version: '1.4.0',
          modules: [
            {
              key: 'acme-compute',
              name: 'Acme Compute',
              version: '1.4.0',
              contentHash: 'sha256:aaa',
              description: 'Compute primitives for Acme.',
            },
          ],
        },
      ],
    })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    await expand(w)
    expect(w.text()).toContain('Compute primitives for Acme.')
    const link = w.findAll('a').find((a) => a.text().includes('Subscribe to more packages'))!
    expect(link.attributes('href')).toBe('https://byodt.dethernety.io/catalog')
    expect(link.attributes('target')).toBe('_blank')
    w.unmount()
  })

  it('renders a stub-less mount as incomplete, never as up to date, and keeps its Unmount', async () => {
    // The operator-facing half of the daemon's 'incomplete' currency. Without the chip arm it falls through
    // to "update unknown", which is a differently misleading thing to say beside an Unmount button about a
    // module that will not be there at the next restart.
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [
        {
          packageKey: 'acme-cloud',
          moduleKey: 'acme-compute',
          name: 'Acme Compute',
          pin: 'sha256:aaa',
          currency: 'incomplete',
        },
      ] as MountedModule[],
      note: 'acme-compute is recorded as mounted but its module file is not loadable — unmounting it is what clears this',
    })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    await expand(w)

    expect(w.text()).toContain('module file missing')
    expect(w.text()).not.toContain('up to date')
    expect(w.text()).not.toContain('update unknown')
    // The row keeps the only control that clears the state, and offers no update for a mount that is
    // not there.
    const unmount = w.findAll('button').filter((b) => b.text() === 'Unmount')
    expect(unmount.length).toBe(1)
    expect(unmount[0].attributes('disabled')).toBeUndefined()
    expect(w.findAll('button').filter((b) => b.text() === 'Update')).toHaveLength(0)
    // And the daemon's note carries the remedy.
    expect(w.text()).toContain('unmounting it is what clears this')
    w.unmount()
  })

  it('renders a diverged mount as mismatched, and its Repair posts the RECORDED pin', async () => {
    // The operator-facing half of the daemon's 'diverged' currency: the module file on disk names a
    // different pin than the marker, so the platform is serving content this mount does not record.
    // chipClass and chipLabel both end in unguarded defaults, so a missing arm compiles clean and falls
    // through to the grey "update unknown" chip — the negative assertions below are the only thing that
    // catches that, since tsc flags nothing.
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [
        {
          packageKey: 'acme-cloud',
          moduleKey: 'acme-compute',
          name: 'Acme Compute',
          pin: 'sha256:aaa',
          currency: 'diverged',
          // The daemon offers the RECORDED pin, not the catalog's newest: repairing must not quietly
          // substitute a different version.
          latestPin: 'sha256:aaa',
        },
      ] as MountedModule[],
      note: 'acme-compute is recorded at a pin its module file does not carry, so the platform is serving different content than this mount records',
    })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    await expand(w)

    expect(w.text()).toContain('module file mismatched')
    expect(w.text()).not.toContain('up to date')
    expect(w.text()).not.toContain('update unknown')
    expect(w.text()).not.toContain('module file missing')
    expect(w.text()).not.toContain('newer available')
    // The row is actionable, and the control says what it does — this is not an update.
    expect(w.findAll('button').filter((b) => b.text() === 'Update')).toHaveLength(0)
    const repair = w.findAll('button').filter((b) => b.text() === 'Repair')
    expect(repair.length).toBe(1)
    expect(repair[0].attributes('disabled')).toBeUndefined()
    expect(w.findAll('button').filter((b) => b.text() === 'Unmount')).toHaveLength(1)

    await repair[0].trigger('click')
    await flushPromises()
    // The repair is a re-POST at the pin the marker already records.
    expect(mountModule).toHaveBeenCalledWith({
      packageKey: 'acme-cloud',
      moduleKey: 'acme-compute',
      pin: 'sha256:aaa',
    })
    expect(w.text()).toContain('does not carry')
    w.unmount()
  })

  it('gates an unsubscribed package: Not subscribed, disabled Mount, Subscribe link', async () => {
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: false }] })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // The Not-subscribed chip and Subscribe link sit on the always-visible header.
    expect(w.find('[data-not-subscribed]').exists()).toBe(true)
    expect(btn(w, 'Mount all')).toBeUndefined()
    const sub = w.findAll('a').find((a) => a.text().trim() === 'Subscribe ↗')!
    expect(sub.attributes('href')).toBe('https://byodt.dethernety.io/catalog')

    // Expanded, every per-module Mount is disabled.
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    w.unmount()
  })

  it('does not gate when entitlement is undetermined (entitled undefined)', async () => {
    packages.mockResolvedValue({ packages: catalog }) // no entitled field
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    expect(w.find('[data-not-subscribed]').exists()).toBe(false)
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    w.unmount()
  })

  // THE capability this whole route exists for. Buying a package used to require regenerating the recipe
  // and reconnecting, and a disconnect removes every cloud-provided module — so the cheapest way to see a
  // new package cost the classes of every module already mounted, and every analysis link into them.
  it('makes a newly subscribed package mountable on Refresh, with no reconnect', async () => {
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: false }] })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-not-subscribed]').exists()).toBe(true)
    expect(btn(w, 'Mount all')).toBeUndefined()

    // Bought in the portal, in another tab. Nothing about this deployment's configuration changed.
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: true }] })
    await w.get('[data-content-refresh]').trigger('click')
    await flushPromises()

    expect(w.find('[data-not-subscribed]').exists()).toBe(false)
    expect(btn(w, 'Mount all')).toBeDefined()
    expect(btn(w, 'Mount all')!.attributes('disabled')).toBeUndefined()
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    w.unmount()
  })

  it('refreshes on demand, and refuses while an action holds the tab', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(packages).toHaveBeenCalledTimes(1)

    await w.get('[data-content-refresh]').trigger('click')
    await flushPromises()
    expect(packages).toHaveBeenCalledTimes(2)
    expect(modules).toHaveBeenCalledTimes(2)

    // While a mount is in flight the refresh is unavailable: load() replaces both collections wholesale,
    // and doing that mid-action would render a view of neither state.
    //
    // Asserted on the attribute and NOT by clicking it: vue-test-utils' trigger() is itself guarded by
    // `!this.isDisabled()`, so a click on a disabled button is never dispatched and a follow-up call-count
    // assertion would hold no matter what the component did. The attribute is the whole contract here.
    await expand(w)
    let release: (v: { message: string }) => void = () => {}
    mountModule.mockReturnValue(new Promise((r) => (release = r)))
    await w.findAll('button').find((b) => b.text() === 'Mount')!.trigger('click')
    await flushPromises()
    expect(w.get('[data-content-refresh]').attributes('disabled')).toBeDefined()

    // …and available again once the action settles.
    release({ message: 'mounted' })
    await flushPromises()
    expect(w.get('[data-content-refresh]').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  // Could-not-ask gates NOTHING, and says why. Three arms, because api.ts enumerates three credential
  // states and records that a component with fewer arms than there are states is how one of them became a
  // sign-in loop. The signed-out arm is the ordinary case, not an edge one: the tokens are memory-only, so
  // every page reload starts here.
  it.each([
    ['signed out — a reloaded tab', undefined, 'Signing in again gives this tab', true],
    ['signed in without the content scope', { idToken: 'id', accessToken: '' }, 'Regenerating the deployment recipe', false],
    ['signed in, and the service did not answer', { idToken: 'id', accessToken: 'acc' }, 'could not be checked just now', false],
  ])('explains an unknown subscription (%s) and gates nothing', async (_name, tokens, expected, signInExpected) => {
    if (tokens) setCloudTokens(tokens)
    else clearCloudTokens()
    packages.mockResolvedValue({ packages: catalog }) // no entitled field: the daemon could not ask
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    expect(w.get('[data-subscription-unknown]').text()).toContain(expected)
    // Every arm says so, including the one that prescribes a reconnect. That arm names the destructive
    // path, and an operator reading it must not be left to infer that something is being withheld until
    // they take it.
    expect(w.get('[data-subscription-unknown]').text()).toMatch(/[Nn]othing is restricted/)
    // The sign-in is a CONTROL and only in the signed-out arm. Asserted on every arm rather than only the
    // one that has it, because the failure that matters is the offer appearing where it is a loop: signing
    // in with no content scope returns the same empty token forever, and where the check merely failed the
    // credential is fine and another sign-in changes nothing.
    expect(w.find('[data-subscription-sign-in]').exists()).toBe(signInExpected)

    expect(w.find('[data-not-subscribed]').exists()).toBe(false)
    expect(btn(w, 'Mount all')).toBeDefined()
    expect(btn(w, 'Mount all')!.attributes('disabled')).toBeUndefined()
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    // every() is true of an empty array, so without this the assertion below holds whatever the component
    // renders — including rendering no Mount buttons at all. Its two sibling gate tests already guard it.
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    w.unmount()
  })

  it('asks for a sign-in through the shell, rather than naming a control the console does not have', async () => {
    // A reloaded tab is signed IN — the session is in sessionStorage and the tokens are not — so the
    // sign-in card is not rendered and there is nowhere to send the operator. This emit is the way back,
    // and it is the same one the artifact panel already uses for the identical credential state.
    clearCloudTokens()
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    await w.get('[data-subscription-sign-in]').trigger('click')
    expect(w.emitted('sign-in-required')).toHaveLength(1)
    w.unmount()
  })

  it('re-reads the credential on every load, rather than freezing the first answer', async () => {
    // Both the sentence and the control read cloudCredential(), which is a plain function over module
    // state and not a ref — so each has to hang off something reactive or it caches its first answer for
    // the life of the component, and the pair can end up disagreeing: the button gone, the sentence still
    // telling the operator to press it.
    clearCloudTokens()
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.get('[data-subscription-unknown]').text()).toContain('Signing in again gives this tab')
    expect(w.find('[data-subscription-sign-in]').exists()).toBe(true)

    setCloudTokens({ idToken: 'id', accessToken: '' })
    await w.get('[data-content-refresh]').trigger('click')
    await flushPromises()

    expect(w.get('[data-subscription-unknown]').text()).toContain('Regenerating the deployment recipe')
    expect(w.find('[data-subscription-sign-in]').exists()).toBe(false)
    w.unmount()
  })

  // A slow read must not land on top of a fast one issued after it. Three callers start load() — the
  // mount, the reloadToken watch, and Refresh — and the failure this guards is the one this whole route
  // exists to remove: a package the operator has just bought going back to "Not subscribed" on its own.
  it('drops a superseded load rather than letting it overwrite a newer one', async () => {
    let releaseFirst: (v: { packages: CatalogPackage[] }) => void = () => {}
    packages.mockReturnValueOnce(new Promise((r) => (releaseFirst = r)))
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // A second load starts and finishes first, reporting the package as bought.
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: true }] })
    await w.setProps({ reloadToken: 1 })
    await flushPromises()
    expect(w.find('[data-not-subscribed]').exists()).toBe(false)

    // The first, older read now lands — issued before the purchase, so it says the opposite.
    releaseFirst({ packages: [{ ...catalog[0], entitled: false }] })
    await flushPromises()
    expect(w.find('[data-not-subscribed]').exists()).toBe(false)
    expect(btn(w, 'Mount all')).toBeDefined()
    w.unmount()
  })

  // THE case the old three-arm split could not reach. A deployment whose configuration lacks the required
  // permission gets a perfectly good token for the scopes it DID request, so the browser sees a normal
  // credential and every retry looks transient. Only the daemon can tell, and it does so from the
  // deployment's own configuration.
  it('names a deployment that can never ask, and offers no sign-in for it', async () => {
    // 'ready' — a real token in hand. The old check keyed on an empty one and so never fired here.
    setCloudTokens({ idToken: 'id', accessToken: 'acc' })
    packages.mockResolvedValue({ packages: catalog, subscriptionUnavailable: true })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    const note = w.get('[data-subscription-unknown]')
    expect(note.text()).toContain('cannot be checked on this deployment')
    expect(note.text()).toContain('Regenerating the deployment recipe')
    expect(w.find('[data-subscription-sign-in]').exists()).toBe(false)
    w.unmount()
  })

  // The case above sets a full token pair, so the sign-in would be withheld anyway on the credential term
  // alone — it cannot see whether `subscriptionUnavailable` is doing anything. This one puts the component
  // in the ONE state where the two terms disagree: signed out, which normally offers a sign-in, on a
  // deployment that can never ask, where signing in is the loop.
  it('withholds the sign-in even when signed out, if the deployment can never ask', async () => {
    clearCloudTokens()
    packages.mockResolvedValue({ packages: catalog, subscriptionUnavailable: true })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    const note = w.get('[data-subscription-unknown]')
    expect(note.text()).toContain('cannot be checked on this deployment')
    expect(w.find('[data-subscription-sign-in]').exists()).toBe(false)
    // And it explains rather than gates.
    expect(note.text()).toMatch(/[Nn]othing is restricted/)
    expect(w.find('[data-not-subscribed]').exists()).toBe(false)
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    w.unmount()
  })

  it('says nothing about the subscription once it is known', async () => {
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: true }] })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-subscription-unknown]').exists()).toBe(false)
    w.unmount()
  })

  it('renders the empty state and reloads when the token changes', async () => {
    packages.mockResolvedValue({ packages: [] })
    modules.mockResolvedValue({ modules: [] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-empty]').exists()).toBe(true)

    expect(modules).toHaveBeenCalledTimes(1)
    await w.setProps({ reloadToken: 1 })
    await flushPromises()
    expect(modules).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('shows the knowledge-graph connection apart from the content modules, with no controls', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({
      modules: [] as MountedModule[],
      knowledgeGraph: { version: 'sha256:abc', mountedAt: '2026-08-16T10:00:00Z' },
    })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    const band = w.find('[data-kg-connection]')
    expect(band.exists()).toBe(true)
    expect(band.text()).toContain('sha256:abc')
    // The sentence that keeps the entry from reading as "the knowledge graph was installed here",
    // which is the whole reason it is not a row among the content modules.
    expect(band.text()).toContain('no graph data was installed')
    // It is mounted and removed with the cloud connection, so there is nothing to act on.
    expect(band.findAll('button')).toHaveLength(0)
    // And it is not one of the module rows.
    expect(w.findAll('[data-module-row]')).toHaveLength(0)
    w.unmount()
  })

  it('shows nothing about a knowledge graph when there is no connection', async () => {
    packages.mockResolvedValue({ packages: catalog })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-kg-connection]').exists()).toBe(false)
    expect(w.text()).not.toContain('Knowledge graph')
    w.unmount()
  })
})

describe('ContentModules and the artifact panel', () => {
  it('raises the mount path\'s own restart banner for an artifact install, not a second one', async () => {
    // The whole reason the artifact panel is a child rather than a sibling: an install and a mount are two
    // writes into one directory that apply at one restart, so they share one reminder.
    setCloudTokens({ idToken: 'id', accessToken: 'acc' })
    packages.mockResolvedValue({
      packages: [
        {
          key: 'acme-cloud',
          name: 'Acme Cloud',
          version: '1.0.0',
          modules: [],
          artifacts: [{ key: 'acme-risk', name: 'Acme Risk', kind: 'code-module', latest: '1.3.0' }],
        },
      ],
    })
    modules.mockResolvedValue({
      modules: [],
      artifacts: [{ artifactKey: 'acme-risk', version: '1.2.0', kind: 'code-module', currency: 'outdated', latestVersion: '1.3.0' }],
      artifactRemovalNotice: 'Removing this deletes the classes this module provides.',
    })
    installArtifact.mockResolvedValue({ status: 'installed', artifactKey: 'acme-risk', version: '1.3.0', message: 'artifact installed' })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    expect(w.find('[data-restart-required]').exists()).toBe(false)
    expect(w.find('[data-artifacts]').exists()).toBe(true)

    await w.get('[data-artifact-install]').trigger('click')
    await flushPromises()

    expect(installArtifact).toHaveBeenCalledWith({ artifactKey: 'acme-risk', version: '1.3.0' })
    expect(w.findAll('[data-restart-required]')).toHaveLength(1)
    expect(w.find('[data-restart-required]').text()).toContain('byodt restart platform')
  })
})

describe('ContentModules empty state with an artifact', () => {
  it('does not call the tab empty when an artifact is installed', async () => {
    // A deployment with an installed artifact and no catalog packages has content, not none — and the
    // empty line would render directly above the panel that proves it.
    packages.mockResolvedValue({ packages: [] })
    modules.mockResolvedValue({
      modules: [],
      artifacts: [{ artifactKey: 'acme-risk', version: '1.2.0', kind: 'code-module', currency: 'unknown' }],
    })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-empty]').exists()).toBe(false)
    expect(w.find('[data-artifact-row]').exists()).toBe(true)
  })

  it('still calls the tab empty when there is genuinely nothing', async () => {
    packages.mockResolvedValue({ packages: [] })
    modules.mockResolvedValue({ modules: [], artifacts: [] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()
    expect(w.find('[data-empty]').exists()).toBe(true)
  })
})
