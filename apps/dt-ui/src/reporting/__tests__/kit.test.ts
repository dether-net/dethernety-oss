// @vitest-environment happy-dom
/**
 * The report kit as modules reach it: version 1 with every v1 member, on window.__HOST_DEPENDENCIES__.reporting and as
 * the same object from useHostContext(); its reportDetails.get against a stubbed GraphQL client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('@/plugins/apolloClient', () => ({ default: {}, getApolloClient: async () => ({ query }) }))
vi.mock('@/config/environment', () => ({ getConfig: vi.fn(async () => ({ graphqlUrl: '/graphql', branding: null })) }))
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ user: { name: 'Jane Doe' }, authDisabled: true }) }))
vi.mock('@/stores/modulesStore', () => ({ useModulesStore: () => ({}) }))
vi.mock('vue-router', () => ({ useRouter: () => ({}), useRoute: () => ({}) }))
vi.mock('@/stores/analysisStore', () => ({ useAnalysisStore: () => ({}) }))
vi.mock('@/stores/issueStore', () => ({ useIssueStore: () => ({}) }))
vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => ({}) }))
vi.mock('@/stores/dispositionDialogStore', () => ({ useDispositionDialogStore: () => ({}) }))
vi.mock('@/stores/issueDialogStore', () => ({ useIssueDialogStore: () => ({}) }))
vi.mock('@/utils/dataFlowUtils', () => ({ getPageDisplayName: () => '' }))
vi.mock('@dethernety/dt-core', () => ({ DtUtils: class {}, DtModel: class {}, DtClass: class {}, DtMitreAttack: class {} }))
// The page's kit starts reading the brand when it is created; a test build is a development build, which reads /config.
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ branding: null }), { status: 200 })))

import { createReportingKit, getReportingKit } from '..'
import { REPORT_DETAILS } from '../reportDetails'
import { ModuleLoader } from '@/services/ModuleLoader'
import { useHostContext } from '@/composables/useHostContext'

const MEMBERS = ['version', 'escapeHtml', 'currentUser', 'brand', 'reportDetails', 'renderModelDiagram', 'buildReport', 'download']

describe('the report kit', () => {
  beforeEach(() => query.mockReset())

  it('is version 1 with every v1 member, and cannot be changed by a module', () => {
    const kit = createReportingKit({ dev: false, config: async () => ({ graphqlUrl: '/graphql', branding: null }), fetch: vi.fn() })
    expect(kit.version).toBe(1)
    expect(Object.keys(kit).sort()).toEqual([...MEMBERS].sort())
    expect(typeof kit.reportDetails.get).toBe('function')
    expect(Object.isFrozen(kit)).toBe(true)
    expect(kit.currentUser()).toEqual({ displayName: 'Jane Doe' })
  })

  it('reads an analysis\'s report details live, leaving out empty values', async () => {
    query.mockResolvedValue({ data: { reportDetails: { client: 'Example Ltd', updated: '2026-11-20T10:15:00.000Z' } } })
    expect(await getReportingKit().reportDetails.get('an-1')).toEqual({ client: 'Example Ltd', updated: '2026-11-20T10:15:00.000Z' })
    expect(query).toHaveBeenCalledWith({ query: REPORT_DETAILS, variables: { analysisId: 'an-1' }, fetchPolicy: 'network-only' })

    query.mockResolvedValue({ data: { reportDetails: { client: null, updated: null } } })
    expect(await getReportingKit().reportDetails.get('an-1')).toEqual({})
    query.mockResolvedValue({ data: { reportDetails: null } })
    expect(await getReportingKit().reportDetails.get('an-1')).toBeNull()
  })

  it('is on window.__HOST_DEPENDENCIES__ and in useHostContext() as one object', () => {
    ModuleLoader.exposeHostDependencies({}, {})
    const exposed = window.__HOST_DEPENDENCIES__.reporting!
    expect(exposed).toBe(getReportingKit())
    expect(exposed.version).toBe(1)
    expect(useHostContext().reporting).toBe(exposed)
  })
})
