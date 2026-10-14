// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * The finding→issue picker a module opens through the host. Two things it must get right for any caller:
 * - "Add to Issue board" carries only the ids it was given. A finding raised on the model alone has no element, and an
 *   empty id in the clipboard made the later link call fail, so nothing was linked to the issue.
 * - A caller's own description is the issue's description as it is. Only a finding with no description of its own (an
 *   exposure, passed by name) is described as "Exposure: <name>", as before.
 */

const mocks = vi.hoisted(() => ({
  dialog: null as any,
  issue: null as any,
  router: { currentRoute: { value: { path: '/models', query: { id: 'm1' } } }, push: vi.fn() },
}))

vi.mock('@/stores/issueDialogStore', () => ({ useIssueDialogStore: () => mocks.dialog }))
vi.mock('@/stores/issueStore', () => ({ useIssueStore: () => mocks.issue }))
vi.mock('vue-router', () => ({ useRouter: () => mocks.router }))
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [], ControlWrapper: {}, useVuetifyControl: () => ({}) }))

import FindingIssueDialog from '../FindingIssueDialog.vue'

const open = (args: Record<string, unknown>) => {
  mocks.dialog = reactive({ show: true, finding: null, elementId: undefined, modelId: 'm1', elementLabel: undefined, close: vi.fn(), ...args })
  return mount(FindingIssueDialog, { shallow: true, global: { stubs: { teleport: true } } })
}

beforeEach(() => {
  mocks.issue = reactive({ issueClasses: [], setIssueDataClipboard: vi.fn() })
  mocks.router.push.mockClear()
})

describe('Add to Issue board', () => {
  it('carries only the ids it was given, so a finding on the model alone has no empty id', async () => {
    const w = open({ finding: { id: 'f-1', name: 'Unapproved destructive action', description: 'Threat Patterns finding: …' }, elementId: undefined })
    await (w.vm as any).onAddToBoard()
    const clip = mocks.issue.setIssueDataClipboard.mock.calls[0][0]
    expect(clip.elementIds).toEqual(['f-1', 'm1'])
  })

  it('keeps every id when the finding sits on an element, and sets the caller description apart from the title', async () => {
    const w = open({ finding: { id: 'ex-1', name: 'weak_tls', description: 'Own text' }, elementId: 'c-1', elementLabel: 'Gateway' })
    await (w.vm as any).onAddToBoard()
    const clip = mocks.issue.setIssueDataClipboard.mock.calls[0][0]
    expect(clip.elementIds).toEqual(['ex-1', 'c-1', 'm1'])
    expect(clip.description).toBe('Weak tls Issue on Gateway: Own text')
  })
})

describe('the issue description', () => {
  it("is the caller's own description as it is", () => {
    const w = open({ finding: { id: 'f-1', name: 'Unapproved destructive action', description: 'Threat Patterns finding: Unapproved destructive action at Main agent.' } })
    expect((w.vm as any).issueDescription).toBe('Threat Patterns finding: Unapproved destructive action at Main agent.')
  })

  it('is "Exposure: <name>" for a finding passed by name only, as before', () => {
    const w = open({ finding: { id: 'ex-1', name: 'weak_tls' }, elementId: 'c-1' })
    expect((w.vm as any).issueDescription).toBe('Exposure: weak_tls')
    expect((w.vm as any).issueName).toBe('Weak tls Issue')
    expect((w.vm as any).elementIds).toEqual(['c-1', 'm1', 'ex-1'])
  })
})
