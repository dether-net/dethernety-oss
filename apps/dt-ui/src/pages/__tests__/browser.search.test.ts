// @vitest-environment happy-dom
/**
 * The Browser page's side of the search and the header's trail:
 * - a model picked in the search opens in the editor, after the Browser's URL and the remembered folder move to the
 *   model's folder, without fetching that folder on the way out; if the editor navigation is refused or throws, the
 *   page shows the folder and goes on loading folders;
 * - a control picked opens its dialog in place;
 * - "show in folder" goes to the folder and marks the item's tile for a moment;
 * - a deep trail shows Home, an ellipsis with the folders in between, and the last two.
 * The search component itself is stubbed (tested in components/Browser/__tests__/BrowserSearch.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import type { BrowserSearchResult } from '@/utils/browserSearch'

const route = reactive({ path: '/browser', query: {} as Record<string, string> })
const router = {
  push: vi.fn(async (to: { path: string, query: Record<string, string> }) => {
    route.path = to.path
    route.query = to.query
    return undefined as unknown
  }),
  replace: vi.fn(async (to: { path: string, query: Record<string, string> }) => {
    route.path = to.path
    route.query = to.query
  }),
}
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => router,
  onBeforeRouteLeave: vi.fn(),
}))
vi.mock('vuetify', () => ({ useDisplay: () => ({ width: ref(1440) }) }))

const folder = (id: string, name: string, parent?: string) => ({ id, name, parentFolder: parent ? { id: parent } : undefined })
const folderStore = reactive({
  folders: [] as ReturnType<typeof folder>[],
  selectedFolder: undefined as ReturnType<typeof folder> | undefined,
  isLoading: false,
  fetchFolders: vi.fn(async () => {}),
  fetchContentIndex: vi.fn(),
})
const modelsStore = reactive({
  models: [] as { id: string, name: string }[],
  isLoading: false,
  fetchModelsError: '',
  fetchModels: vi.fn(),
  fetchModules: vi.fn(),
  resetStore: vi.fn(),
})
const controlsStore = reactive({
  controls: [] as { id: string, name: string }[],
  isLoading: false,
  errors: {} as Record<string, string>,
  fetchControls: vi.fn(),
  fetchMitreAttackMitigations: vi.fn(),
  fetchMitreDefendTactics: vi.fn(),
})
vi.mock('@/stores/folderStore', () => ({ useFolderStore: () => folderStore }))
vi.mock('@/stores/modelsStore', () => ({ useModelsStore: () => modelsStore }))
vi.mock('@/stores/controlsStore', () => ({ useControlsStore: () => controlsStore }))
vi.mock('@/components/Browser/BrowserSearch.vue', () => ({
  default: defineComponent({
    name: 'BrowserSearch',
    props: { compact: Boolean },
    emits: ['open', 'show'],
    setup: () => () => h('div', { class: 'browser-search-stub' }),
  }),
}))

import Browser from '../browser.vue'

enableAutoUnmount(afterEach)

const mountPage = async () => {
  const w = shallowMount(Browser, {
    global: {
      renderStubDefaultSlot: true,
      directives: { tooltip: {} },
      stubs: { BrowserSearch: false, ControlDialog: { props: ['id', 'show'], template: '<div class="control-dialog" :data-id="id" />' } },
    },
  })
  await flushPromises()
  return w
}
type Wrapper = Awaited<ReturnType<typeof mountPage>>

const pick = async (w: Wrapper, event: 'open' | 'show', result: BrowserSearchResult) => {
  w.findComponent({ name: 'BrowserSearch' }).vm.$emit(event, result)
  await flushPromises()
}
const model = (id: string, folderId?: string): BrowserSearchResult => ({ id, kind: 'model', name: id, folderId, path: [] })

beforeEach(() => {
  vi.clearAllMocks()
  route.path = '/browser'
  route.query = { dir: 'root' }
  folderStore.folders = [folder('pay', 'Payments'), folder('pci', 'PCI scope', 'pay')]
  folderStore.selectedFolder = undefined
  modelsStore.models = []
  controlsStore.controls = []
})

describe('Browser: opening from the search', () => {
  it('moves the URL and the remembered folder to the model\'s folder, then opens the editor, fetching nothing on the way', async () => {
    const w = await mountPage()
    const fetches = modelsStore.fetchModels.mock.calls.length
    await pick(w, 'open', model('m1', 'pci'))

    expect(router.replace).toHaveBeenCalledWith({ path: '/browser', query: { dir: 'pci' } })
    expect(router.push).toHaveBeenLastCalledWith({ path: '/dataflow', query: { id: 'm1' } })
    expect(router.replace.mock.invocationCallOrder[0]).toBeLessThan(router.push.mock.invocationCallOrder.at(-1)!)
    expect(folderStore.selectedFolder?.id).toBe('pci')
    expect(modelsStore.fetchModels.mock.calls.length).toBe(fetches)
  })

  it('opens a model at the root without moving the URL when the Browser already shows Home', async () => {
    const w = await mountPage()
    await pick(w, 'open', model('m2'))
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenLastCalledWith({ path: '/dataflow', query: { id: 'm2' } })
    expect(folderStore.selectedFolder).toBeUndefined()
  })

  it('shows the model\'s folder when the editor navigation is refused', async () => {
    const w = await mountPage()
    router.push.mockImplementationOnce(async () => ({ type: 4 }))
    await pick(w, 'open', model('m1', 'pci'))
    expect(modelsStore.fetchModels).toHaveBeenLastCalledWith({ folderId: 'pci' })
  })

  it('shows the model\'s folder when the editor navigation throws, and goes on loading folders after it', async () => {
    const w = await mountPage()
    router.push.mockImplementationOnce(async () => { throw new Error('Failed to fetch dynamically imported module') })
    await pick(w, 'open', model('m1', 'pci'))
    expect(modelsStore.fetchModels).toHaveBeenLastCalledWith({ folderId: 'pci' })

    route.query = { dir: 'pay' }
    await flushPromises()
    expect(modelsStore.fetchModels).toHaveBeenLastCalledWith({ folderId: 'pay' })
  })

  it('opens a control in its dialog, where the Browser is', async () => {
    const w = await mountPage()
    await pick(w, 'open', { id: 'c1', kind: 'control', name: 'WAF', folderId: 'pci', path: [] })
    expect(router.push).not.toHaveBeenCalled()
    expect(w.find('.control-dialog').attributes('data-id')).toBe('c1')
  })
})

describe('Browser: show in folder', () => {
  it('goes to the folder and marks the item\'s tile for a moment', async () => {
    vi.useFakeTimers()
    try {
      const w = await mountPage()
      modelsStore.models = [{ id: 'm1', name: 'Shop' }]
      await pick(w, 'show', model('m1', 'pci'))
      expect(router.push).toHaveBeenCalledWith({ path: '/browser', query: { dir: 'pci' } })
      await flushPromises()
      const tile = () => w.find('[data-browser-item="m1"]')
      expect(tile().classes()).toContain('tile-found')
      vi.advanceTimersByTime(2600)
      await flushPromises()
      expect(tile().classes()).not.toContain('tile-found')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays put when the item is in the folder on show', async () => {
    route.query = { dir: 'pci' }
    const w = await mountPage()
    await pick(w, 'show', model('m1', 'pci'))
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('Browser: the header trail', () => {
  it('shows Home, an ellipsis with the folders in between, and the last two of a deep path', async () => {
    folderStore.folders = [
      folder('a', 'Alpha'), folder('b', 'Bravo', 'a'), folder('c', 'Charlie', 'b'), folder('d', 'Delta', 'c'),
    ]
    route.query = { dir: 'd' }
    const w = await mountPage()
    const crumbs = w.findAll('.browser-crumb').map(c => c.text())
    expect(crumbs).toEqual(['🏠 Home', 'Charlie', 'Delta'])
    // The menu's activator (the ellipsis button) is a named slot, which the test does not render.
    expect(w.findAll('.browser-trail v-menu')).toHaveLength(1)
    expect(w.findAll('.browser-trail v-list-item').map(i => i.attributes('title'))).toEqual(['Alpha', 'Bravo'])
  })

  it('shows a short path in full', async () => {
    route.query = { dir: 'pci' }
    const w = await mountPage()
    expect(w.findAll('.browser-crumb').map(c => c.text())).toEqual(['🏠 Home', 'Payments', 'PCI scope'])
    expect(w.findAll('.browser-trail v-menu')).toHaveLength(0)
  })
})
