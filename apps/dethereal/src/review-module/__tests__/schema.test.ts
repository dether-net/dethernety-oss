/**
 * The proposal fields a review carries for the review workspace: citations as locators only, a person's decision
 * where the analyst was unsure or the cross-examiner objected, and the text one group may hold.
 */
import { describe, it, expect } from 'vitest'
import { checkGroups, GROUP_TEXT_MAX, ReviewRefusal, type ReviewGroup } from '../../triage/review.js'
import { citationProblem, citedPath, discoveredSources } from '../citations.js'

const refusal = (groups: ReviewGroup[]) => {
  try {
    checkGroups('review', groups)
    return null
  } catch (err) {
    if (err instanceof ReviewRefusal) return { code: err.code, message: err.message }
    throw err
  }
}
const dispose = (over: Record<string, unknown> = {}, group: Partial<ReviewGroup> = {}): ReviewGroup => ({ group: 1, exposure_ids: ['e1'], proposal: { op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'internal only', ...over }, ...group })
const supersede = (over: Record<string, unknown> = {}, group: Partial<ReviewGroup> = {}): ReviewGroup => ({ group: 1, exposure_ids: ['e1'], proposal: { op: 'supersede', modifications: { score: 3 }, ...over }, ...group })

describe('citations', () => {
  it("take the review workspace's grammar, as the analysts write them", () => {
    for (const ok of ['platform:score', 'kg:kgrule:abc123:cleartext_transport_tls_strip', 'attributes:api.json', 'source:mesh/peer-auth.yaml:8', 'source:src/app.ts:12-20']) expect(citationProblem(ok), ok).toBeNull()
    for (const bad of ['platform:secret', 'the config says x', 'source:app.ts', 'source:a b.ts:1', 'kg:' + 'x'.repeat(201), 'x'.repeat(301)]) expect(citationProblem(bad), bad).not.toBeNull()
  })

  it('refuse a secret file, an absolute path and one that climbs out', () => {
    for (const bad of ['source:.env:3', 'source:deploy/queue/secrets.yaml:1', 'attributes:/etc/passwd', 'source:../other/app.ts:1']) expect(citationProblem(bad), bad).toMatch(/secret file or outside the project|not a locator/)
    expect(citedPath('source:src/app.ts:12-20')).toBe('src/app.ts')
    expect(citedPath('kg:x')).toBeNull()
  })

  it("discovery's sources, from its elements", () => {
    expect([...discoveredSources({ elements: [{ sources: [{ type: 'file', file: './src/app.ts' }, { type: 'manual' }] }, { sources: [{ file: 'mesh/peer-auth.yaml' }] }] })]).toEqual(['src/app.ts', 'mesh/peer-auth.yaml'])
    expect(discoveredSources(null).size).toBe(0)
  })
})

describe("a person's decision", () => {
  it('a dispose with a low confidence or an objection is marked needs_human', () => {
    expect(refusal([dispose({ confidence: 'low' })])).toMatchObject({ code: 'argument_invalid' })
    expect(refusal([dispose({ objection: 'the rule has a second trigger' })])).toMatchObject({ code: 'argument_invalid' })
    expect(refusal([dispose({ confidence: 'low', objection: 'x' }, { needs_human: true })])).toBeNull()
    expect(refusal([dispose({ confidence: 'high', citations: ['platform:score'] })])).toBeNull()
  })

  it('a supersede: a low confidence is no proposal; an objection keeps it, one group at a time', () => {
    expect(refusal([supersede({ confidence: 'low' })])?.message).toMatch(/low confidence is not proposed/)
    expect(refusal([supersede({ objection: 'lowering it hides a path' })])?.message).toMatch(/per_row_only/)
    expect(refusal([supersede({ objection: 'lowering it hides a path' }, { per_row_only: true })])).toBeNull()
  })

  it("the texts are one line each, and one group's text stays under what the workspace holds", () => {
    expect(refusal([dispose({ objection: 'two\nlines' }, { needs_human: true })])).toMatchObject({ code: 'text_invalid' })
    expect(refusal([dispose({}, { ambiguity: 'x'.repeat(1801) })])).toMatchObject({ code: 'text_invalid' })
    const citations = Array.from({ length: 50 }, (_, i) => `source:${'d'.repeat(270)}/f${i}.ts:1`)
    expect(refusal([dispose({ reason: 'r'.repeat(1800), citations, objection: 'o'.repeat(1800) }, { needs_human: true, ambiguity: 'a'.repeat(1800) })])?.message).toMatch(new RegExp(`at most ${GROUP_TEXT_MAX}`))
    expect(refusal([dispose({ citations: ['source:.env:1'] })])).toMatchObject({ code: 'citation_invalid' })
  })
})
