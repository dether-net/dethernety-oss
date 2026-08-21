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

  it('gates an unsubscribed package: Not subscribed, disabled Mount, Subscribe link', async () => {
    packages.mockResolvedValue({ packages: [{ ...catalog[0], entitled: false }] })
    modules.mockResolvedValue({ modules: [] as MountedModule[] })
    const w = mount(ContentModules, { props: { reloadToken: 0 } })
    await flushPromises()

    // The Not-subscribed chip and Subscribe link sit on the always-visible header.
    expect(w.text()).toContain('Not subscribed')
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

    expect(w.text()).not.toContain('Not subscribed')
    await expand(w)
    const mounts = w.findAll('button').filter((b) => b.text() === 'Mount')
    expect(mounts.length).toBeGreaterThan(0)
    expect(mounts.every((b) => b.attributes('disabled') === undefined)).toBe(true)
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
