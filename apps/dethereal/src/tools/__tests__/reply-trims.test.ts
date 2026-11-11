/**
 * Replies that no longer repeat themselves: validate lists an identical warning once with its count and drops the
 * list of files it read; match_classes gives a class's description once per reply and no GraphQL __typename.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { collapseWarnings, validateModelTool } from '../validate-model.tool.js'
import { DESCRIPTION_MAX, firstSentence, oncePerClass, trimMatches } from '../match-classes.tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'

let root: string
beforeAll(async () => { root = await fs.mkdtemp(path.join(process.cwd(), '.test-reply-trims-')) })
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('validate', () => {
  it('lists an identical warning once, with how many it stands for, and keeps different ones apart', () => {
    const w = { file: 'model', message: 'gate3_in_progress: C3' }
    expect(collapseWarnings([w, { ...w }, { ...w, path: 'x' }, { file: 'model', message: 'info: other' }])).toEqual([
      { ...w, count: 2 }, { ...w, path: 'x' }, { file: 'model', message: 'info: other' },
    ])
    expect(collapseWarnings([w])).toEqual([w])
  })

  it('no longer lists the files it read', async () => {
    const dir = path.join(root, 'm')
    await writeGateModel(dir, gateModel())
    const r = await validateModelTool.run({ action: 'validate', directory_path: dir } as never, { debug: false })
    expect(r.success, r.error).toBe(true)
    expect(r.data).not.toHaveProperty('files_validated')
    expect(r.data).toHaveProperty('warnings')
  })
})

describe('match_classes', () => {
  it("gives a class's description the first time the class appears, and drops __typename; module fields stay", () => {
    const cand = (id: string, extra: Record<string, unknown> = {}) => ({ __typename: 'ClassMatch', classId: id, className: id, classDescription: `about ${id}`, moduleId: 'm-1', moduleName: 'general', matchType: 'name', confidence: 'high', ...extra })
    const out = oncePerClass([
      { __typename: 'ElementMatch', elementName: 'Gateway', candidates: [cand('c-a'), cand('c-b')] },
      { __typename: 'ElementMatch', elementName: 'API', candidates: [cand('c-a'), cand('c-c', { classDescription: undefined })] },
    ] as never) as any[]
    expect(out[0]).not.toHaveProperty('__typename')
    expect(out[0].candidates[0]).toMatchObject({ classId: 'c-a', classDescription: 'about c-a', moduleId: 'm-1', moduleName: 'general' })
    expect(out[0].candidates[0]).not.toHaveProperty('__typename')
    expect(out[0].candidates[1].classDescription).toBe('about c-b')
    expect(out[1].candidates[0]).not.toHaveProperty('classDescription')
    expect(out[1].candidates[0]).toMatchObject({ classId: 'c-a', moduleId: 'm-1' })
  })

  it('cuts a description to its first sentence, drops null fields, rounds the score and says one module once', () => {
    const long = 'An HTTP/S request, also called web traffic, crossing the perimeter. The place to look for web requests.'
    const cand = (id: string, extra: Record<string, unknown> = {}) => ({ classId: id, className: id, classDescription: long, classType: null, moduleId: 'm-1', moduleName: 'general', matchType: 'vector_similarity', confidence: 'medium', similarityScore: 0.5487688, ...extra })
    const r = trimMatches([{ elementName: 'Gateway', candidates: [cand('c-a'), cand('c-b', { similarityScore: undefined })] }])
    expect(r.module).toEqual({ id: 'm-1', name: 'general' })
    expect(r.matches[0]!.candidates[0]).toEqual({ classId: 'c-a', className: 'c-a', classDescription: 'An HTTP/S request, also called web traffic, crossing the perimeter.', matchType: 'vector_similarity', confidence: 'medium', similarityScore: 0.55 })
    expect(r.matches[0]!.candidates[1]).not.toHaveProperty('similarityScore')
  })

  it('keeps the module on each candidate when the candidates come from more than one', () => {
    const r = trimMatches([{ elementName: 'Gateway', candidates: [{ classId: 'a', moduleId: 'm-1', moduleName: 'one' }, { classId: 'b', moduleId: 'm-2', moduleName: 'two' }] }])
    expect(r).not.toHaveProperty('module')
    expect(r.matches[0]!.candidates[1]).toMatchObject({ moduleId: 'm-2', moduleName: 'two' })
  })

  it('reads past an abbreviation and a short opening, and never splits a character', () => {
    expect(firstSentence('An object store (e.g. Amazon S3) holding uploaded files for the application. It is the place to look.'))
      .toBe('An object store (e.g. Amazon S3) holding uploaded files for the application.')
    expect(firstSentence('A queue vs. Kafka topics, i.e. Simple messaging between the services. More text.'))
      .toBe('A queue vs. Kafka topics, i.e. Simple messaging between the services.')
    expect(firstSentence('Mr. X. A long description that follows the short opening words here. Next.'))
      .toBe('Mr. X. A long description that follows the short opening words here.')
    const astral = firstSentence(`${'\u{1F512}'.repeat(300)}`)
    expect(Array.from(astral)).toHaveLength(240)
    expect(astral.endsWith('…')).toBe(true)
  })

  it('cuts a first sentence longer than the cap, and keeps a description that is one sentence', () => {
    expect(firstSentence('One short sentence without a later capital.')).toBe('One short sentence without a later capital.')
    const cut = firstSentence(`${'word '.repeat(80)}end. Next`)
    expect(cut.length).toBe(DESCRIPTION_MAX)
    expect(cut.endsWith('…')).toBe(true)
  })
})
