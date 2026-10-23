// @vitest-environment happy-dom
/**
 * The analysis results page with lazily loaded module views: it prefetches the analysis class's
 * module, renders the module component only once it is registered, shows a loading state, then an
 * error with Retry on failure, and keeps the mounted view when an unrelated component registers.
 * The loader is mocked; the component registry is the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'

const loader = vi.hoisted(() => {
  class ModuleFrontendError extends Error {
    constructor(readonly kind: string, message = kind) {
      super(message)
    }
  }
  return { ensure: vi.fn(), prefetch: vi.fn(), ModuleFrontendError }
})
vi.mock('@/services/ModuleLoader', () => ({
  moduleLoader: { ensure: loader.ensure, prefetch: loader.prefetch },
  ModuleFrontendError: loader.ModuleFrontendError,
}))

const route = reactive({ path: '/analysisresults', query: { id: 'a1' } as Record<string, string> })
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

const documents: Record<string, object> = {
  a1: { report_view: { summary: 1 } },
  a2: { report_view: { summary: 2 } },
  a3: { 'metadata.only': true },
}
const analysisStore = reactive({
  currentAnalysis: null as any,
  error: '',
  fetchAnalyses: vi.fn(async ({ analysisId }: { analysisId: string }) => [
    { id: analysisId, name: analysisId, analysisClass: { id: 'c', module: { id: 'm', name: 'report-module' } } },
  ]),
  setCurrentAnalysis: vi.fn((a: any) => { analysisStore.currentAnalysis = a }),
  getDocument: vi.fn(async ({ analysisId }: { analysisId: string }) => documents[analysisId]),
  resetStore: vi.fn(),
})
vi.mock('@/stores/analysisStore', () => ({ useAnalysisStore: () => analysisStore }))
vi.mock('@/components/Dialogs/Analysis/ModelAnalysisDialog.vue', () => ({ default: { render: () => null } }))

import { componentRegistry } from '@/services/ComponentRegistry'
import AnalysisResults from '../analysisresults.vue'

let mounts = 0
const ReportView = defineComponent({
  props: { content: Object },
  setup(props) {
    mounts++
    return () => h('div', { class: 'report-view' }, JSON.stringify(props.content))
  },
})

const pending = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const stubs = {
  'v-card': { template: '<div><slot /></div>' },
  'v-toolbar': { template: '<div><slot /></div>' },
  'v-spacer': true,
  'v-btn': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  'v-snackbar': true,
  'v-progress-circular': { template: '<div class="spinner" />' },
  'v-alert': { props: ['text'], template: '<div class="alert">{{ text }}<slot name="append" /></div>' },
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.clearAllMocks()
  loader.ensure.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const key of componentRegistry.getAvailableComponents()) componentRegistry.unregister(key)
  route.query = { id: 'a1' }
  mounts = 0
})

describe('analysis results page — a lazily loaded view', () => {
  it("prefetches the analysis class's module, then shows a loading state until the component registers", async () => {
    const load = pending()
    loader.ensure.mockReturnValue(load.promise)
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()

    expect(loader.prefetch).toHaveBeenCalledWith('report-module')
    expect(loader.ensure).toHaveBeenCalledWith('report_view')
    expect(wrapper.find('.spinner').exists()).toBe(true)
    expect(wrapper.find('.report-view').exists()).toBe(false)

    componentRegistry.register('report_view', ReportView)
    load.resolve()
    await flushPromises()
    expect(wrapper.find('.report-view').text()).toContain('"summary":1')
    expect(wrapper.find('.spinner').exists()).toBe(false)
  })

  it('does not ask the loader when the component is already registered', async () => {
    componentRegistry.register('report_view', ReportView)
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()
    expect(loader.ensure).not.toHaveBeenCalled()
    expect(wrapper.find('.report-view').exists()).toBe(true)
  })

  it('shows the failure in words for its kind, and Retry loads again', async () => {
    loader.ensure.mockRejectedValueOnce(new loader.ModuleFrontendError('unavailable'))
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('.alert').text()).toContain('This analysis view is unavailable right now.')

    loader.ensure.mockImplementationOnce(async () => { componentRegistry.register('report_view', ReportView) })
    await wrapper.find('.alert button').trigger('click')
    await flushPromises()
    expect(loader.ensure).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.alert').exists()).toBe(false)
    expect(wrapper.find('.report-view').exists()).toBe(true)
  })

  it('keeps the mounted view when an unrelated component registers', async () => {
    componentRegistry.register('report_view', ReportView)
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()
    expect(mounts).toBe(1)
    componentRegistry.register('other_view', defineComponent({ render: () => null }))
    await flushPromises()
    expect(mounts).toBe(1)
    expect(wrapper.find('.report-view').exists()).toBe(true)
  })

  it("clears the previous analysis's error when another analysis opens", async () => {
    loader.ensure.mockRejectedValueOnce(new loader.ModuleFrontendError('unloadable'))
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('.alert').exists()).toBe(true)

    route.query = { id: 'a3' }
    await flushPromises()
    expect(wrapper.find('.alert').exists()).toBe(false)
  })

  it("ignores a late failure of the previous analysis's load", async () => {
    const first = pending()
    loader.ensure.mockReturnValueOnce(first.promise)
    const wrapper = mount(AnalysisResults, { global: { stubs } })
    await flushPromises()

    const second = pending()
    loader.ensure.mockReturnValueOnce(second.promise)
    route.query = { id: 'a2' }
    await flushPromises()
    expect(loader.ensure).toHaveBeenCalledTimes(2)

    first.reject(new loader.ModuleFrontendError('unloadable'))
    await flushPromises()
    expect(wrapper.find('.alert').exists()).toBe(false)
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })
})
