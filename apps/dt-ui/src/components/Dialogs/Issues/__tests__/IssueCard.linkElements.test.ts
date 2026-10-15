// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * Adding the clipboard's data to an issue links its elements. When that link call failed, the rejection went nowhere:
 * the card said nothing and the elements were silently missing. The card now says so, and an empty id is never sent.
 */

const mocks = vi.hoisted(() => ({ issue: null as any }))

vi.mock('@/stores/issueStore', () => ({ useIssueStore: () => mocks.issue }))
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import IssueCard from '../IssueCard.vue'

const ISSUE = { id: 'i-1', name: 'Issue', description: '', type: '', category: '', attributes: '', elements: [] } as any
const CLIP = { name: 'Finding', description: 'Text', elementIds: ['f-1', '', 'm1'], returnTo: { name: 'Models', path: '/models', query: {} } }

const mountCard = () => mount(IssueCard, { props: { issue: ISSUE, showClose: false }, shallow: true, global: { stubs: { teleport: true } } })

beforeEach(() => {
  mocks.issue = reactive({
    updateIssue: vi.fn().mockResolvedValue(ISSUE),
    addElementsToIssue: vi.fn().mockResolvedValue(2),
    removeElementFromIssue: vi.fn(),
    getIssueDataClipboard: vi.fn(() => CLIP),
    clearIssueDataClipboard: vi.fn(),
  })
})

describe('adding the clipboard to an issue', () => {
  it('links only the ids that are set', async () => {
    const w = mountCard()
    ;(w.vm as any).onAddFromClipboard()
    await flushPromises()
    expect(mocks.issue.addElementsToIssue).toHaveBeenCalledWith({ issueId: 'i-1', elementIds: ['f-1', 'm1'] })
    expect((w.vm as any).linkError).toBe('')
  })

  it('says on the card when the elements could not be linked', async () => {
    mocks.issue.addElementsToIssue.mockRejectedValue(new Error('Variable "$elementIds" got invalid value'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mountCard()
    ;(w.vm as any).onAddFromClipboard()
    await flushPromises()
    expect((w.vm as any).linkError).toContain("Couldn't link the elements to this issue")
    expect(w.html()).toContain("Couldn't link the elements to this issue")
    errors.mockRestore()
  })
})
