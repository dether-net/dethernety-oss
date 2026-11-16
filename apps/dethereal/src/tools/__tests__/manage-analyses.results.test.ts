/**
 * manage_analyses results: an empty document is no result, never a finished analysis's output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const getDocument = vi.hoisted(() => vi.fn())
vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, DtAnalysis: class { constructor(_c: unknown) {} getDocument = getDocument } }
})

const { manageAnalysesTool } = await import('../manage-analyses.tool.js')
const context = { debug: false, apolloClient: {} } as unknown as ToolContext
const results = () => manageAnalysesTool.run({ action: 'results', analysis_id: 'an-1' }, context)

beforeEach(() => getDocument.mockReset())

describe('manage_analyses results', () => {
  it('asks for the main document, as the platform’s results view does', async () => {
    getDocument.mockResolvedValue({ summary: 'done' })
    await results()
    expect(getDocument).toHaveBeenCalledWith({ analysisId: 'an-1', filter: { document: 'index' } })
  })

  it.each([[null], [undefined], [{}], [{ error: 'No filter provided' }], [{ ThreatReport: { generated: false } }]])('answers no_results for %j: a missing, unknown or unread analysis looks like none', async (doc) => {
    getDocument.mockResolvedValue(doc)
    const r = await results()
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ analysis_id: 'an-1', status: 'no_results' })
    expect(r.data).not.toHaveProperty('results')
  })

  it('returns a document that holds something', async () => {
    getDocument.mockResolvedValue({ summary: 'done' })
    expect((await results()).data).toEqual({ analysis_id: 'an-1', results: { summary: 'done' } })
  })
})
