// @vitest-environment happy-dom
/**
 * useHostContext — the finding-action services exposed to module bundles (e.g. the
 * threat-report residual-risk views). Each is a thin wrapper over the SAME canonical
 * flowStore→dt-core mutation the dt-ui exposures tab calls, so behaviour can't drift.
 * These specs pin the arg mapping + return passthrough; they intentionally mock the
 * stores (the mutations themselves are tested in the store/dt-core suites).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { affirmReasonFor } from '../useFindingDisposition'

const disposeExposure = vi.fn()
const clearDisposition = vi.fn()
const supersedeExposure = vi.fn()
const deleteExposure = vi.fn()
const getExposure = vi.fn()
const setIssueDataClipboard = vi.fn()
const fetchIssueClasses = vi.fn()
const issueOpen = vi.fn()
const routerPush = vi.fn()
const currentRoute = { value: { path: '/analysisresults', query: { id: 'm1' } } }

vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute, push: routerPush }),
  useRoute: () => currentRoute.value,
}))
vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({ disposeExposure, clearDisposition, supersedeExposure, deleteExposure, getExposure }),
}))
vi.mock('@/stores/issueStore', () => ({
  useIssueStore: () => ({ setIssueDataClipboard, fetchIssueClasses, issueClasses: [{ id: 'c1', name: 'Bug' }] }),
}))
vi.mock('@/stores/analysisStore', () => ({ useAnalysisStore: () => ({}) }))
vi.mock('@/stores/dispositionDialogStore', () => ({ useDispositionDialogStore: () => ({ open: vi.fn() }) }))
vi.mock('@/stores/issueDialogStore', () => ({ useIssueDialogStore: () => ({ open: issueOpen }) }))
vi.mock('@/services/ComponentRegistry', () => ({ componentRegistry: {} }))
vi.mock('@/utils/dataFlowUtils', () => ({ getPageDisplayName: () => 'Analysis Results' }))
vi.mock('@/plugins/apolloClient', () => ({ default: {} }))
vi.mock('@dethernety/dt-core', () => ({ DtUtils: class {}, DtModel: class {}, DtClass: class {}, DtMitreAttack: class {} }))

import { useHostContext } from '../useHostContext'

const FINDING = { id: 'exp-1', name: 'SQLi', description: 'inj', exploitedBy: [{ id: 't1' }] }

describe('useHostContext finding-action services', () => {
  beforeEach(() => vi.clearAllMocks())

  it('affirmFinding → disposeExposure({kind:AFFIRMED, branched reason}) and returns its result', async () => {
    disposeExposure.mockResolvedValue({ success: true })
    const { services } = useHostContext()
    const r = await services.affirmFinding({ finding: FINDING })
    expect(disposeExposure).toHaveBeenCalledWith({
      exposureId: 'exp-1',
      kind: 'AFFIRMED',
      reason: affirmReasonFor('EXPOSURE'),
    })
    expect(r).toEqual({ success: true })
  })

  it('clearFindingDisposition → clearDisposition({exposureId})', async () => {
    clearDisposition.mockResolvedValue({ success: true })
    const { services } = useHostContext()
    await services.clearFindingDisposition({ finding: FINDING })
    expect(clearDisposition).toHaveBeenCalledWith({ exposureId: 'exp-1' })
  })

  it('supersedeFinding → hydrates the full Exposure, then supersedeExposure({…, exposure})', async () => {
    // The report finding is thin; the service must fetch the real Exposure (with a
    // valid `type`) before cloning — passing the thin row would break createExposure.
    const fullExposure = { id: 'exp-1', name: 'SQLi', type: 'EXPOSURE', description: 'full', exploitedBy: [{ id: 't1' }] }
    getExposure.mockResolvedValue(fullExposure)
    supersedeExposure.mockResolvedValue({ userCopy: {}, systemDispositionResult: { success: true } })
    const { services } = useHostContext()
    await services.supersedeFinding({ finding: FINDING, elementId: 'el-9' })
    expect(getExposure).toHaveBeenCalledWith({ exposureId: 'exp-1' })
    expect(supersedeExposure).toHaveBeenCalledWith({
      exposureId: 'exp-1',
      elementId: 'el-9',
      exposure: fullExposure,
    })
  })

  it('deleteFinding → deleteExposure({exposureId, exposureName}) (name threads the companion flip)', async () => {
    deleteExposure.mockResolvedValue(true)
    const { services } = useHostContext()
    const ok = await services.deleteFinding({ finding: FINDING })
    expect(deleteExposure).toHaveBeenCalledWith({ exposureId: 'exp-1', exposureName: 'SQLi' })
    expect(ok).toBe(true)
  })

  it('openFindingIssueSelector → opens the host issue picker with the mapped finding context', async () => {
    issueOpen.mockResolvedValue({ created: true })
    const { services } = useHostContext()
    const r = await services.openFindingIssueSelector({
      finding: FINDING,
      elementId: 'el-9',
      modelId: 'm1',
      elementLabel: 'Payments API',
    })
    expect(issueOpen).toHaveBeenCalledWith({
      finding: FINDING,
      elementId: 'el-9',
      modelId: 'm1',
      elementLabel: 'Payments API',
    })
    expect(r).toEqual({ created: true })
  })
})
