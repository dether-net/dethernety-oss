/**
 * The triage record: replies kept verbatim, the ring of reviews (the active one never dropped), the record kept
 * out of git, and a record that cannot be read refusing the reply rather than starting over.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { LOG_FILE, LOG_LIMITS, recordedText, recordReview, RecordError, refuseWhenFull, trimLog, VERBATIM_MAX, type LoggedReview } from '../log.js'

const base = process.cwd()
let root: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(base, '.test-triage-log-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function modelDir(): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  await fs.mkdir(path.join(dir, '.dethereal'), { recursive: true })
  await fs.writeFile(path.join(dir, 'manifest.json'), '{}')
  return dir
}

const entry = (id: string, replies = 0): LoggedReview => ({
  review_id: id,
  mode: 'review',
  opened_at: '2026-11-11T00:00:00.000Z',
  groups: 1,
  replies: Array.from({ length: replies }, () => ({ at: 'T', reply: 'r'.repeat(1000), outcome: { verb: 'accept' } })),
  applies: [],
})

const read = async (dir: string) => JSON.parse(await fs.readFile(path.join(dir, '.dethereal', LOG_FILE), 'utf8')) as { reviews: LoggedReview[] }

describe('recordReview', () => {
  it('keeps a reply byte for byte, and appends later ones to the same review', async () => {
    const dir = await modelDir()
    const reply = '  Accept 1, 2 — "as shown"  '
    await recordReview(dir, 'rev1', () => entry('rev1'), (e) => e.replies.push({ at: 'first', reply, outcome: { verb: 'accept' } }))
    await recordReview(dir, 'rev1', () => entry('rev1'), (e) => e.replies.push({ at: 'second', reply: 'nonsense', outcome: { refused: 'reply_unparsed' } }))
    const log = await read(dir)
    expect(log.reviews).toHaveLength(1)
    expect(log.reviews[0]!.replies).toEqual([
      { at: 'first', reply, outcome: { verb: 'accept' } },
      { at: 'second', reply: 'nonsense', outcome: { refused: 'reply_unparsed' } },
    ])
  })

  it('keeps the record out of git', async () => {
    const dir = await modelDir()
    await recordReview(dir, 'rev1', () => entry('rev1'), () => {})
    expect(await fs.readFile(path.join(dir, '.dethereal', '.gitignore'), 'utf8')).toContain(LOG_FILE)
  })

  it(`holds the latest ${LOG_LIMITS.reviews} reviews`, async () => {
    const dir = await modelDir()
    for (let i = 0; i < LOG_LIMITS.reviews + 3; i++) await recordReview(dir, `rev${i}`, () => entry(`rev${i}`), () => {})
    const ids = (await read(dir)).reviews.map((r) => r.review_id)
    expect(ids).toHaveLength(LOG_LIMITS.reviews)
    expect(ids[0]).toBe('rev3')
    expect(ids.at(-1)).toBe(`rev${LOG_LIMITS.reviews + 2}`)
  })

  it('refuses, and leaves the file alone, when the record cannot be read', async () => {
    for (const content of ['{not json', '[1, 2]']) {
      const dir = await modelDir()
      const file = path.join(dir, '.dethereal', LOG_FILE)
      await fs.writeFile(file, content)
      const err = await recordReview(dir, 'rev1', () => entry('rev1'), () => {}).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RecordError)
      expect((err as Error).message).toMatch(/move it aside/)
      expect(await fs.readFile(file, 'utf8')).toBe(content)
    }
  })

  it('names a directory that is not a model directory', async () => {
    const dir = path.join(root, `plain${seq++}`)
    await fs.mkdir(dir)
    await expect(recordReview(dir, 'rev1', () => entry('rev1'), () => {})).rejects.toThrow(/not a model directory/)
  })

  it('drops entries that are not reviews, and gives an entry without applies its list', async () => {
    const dir = await modelDir()
    await fs.writeFile(path.join(dir, '.dethereal', LOG_FILE), JSON.stringify({ reviews: [{ junk: true }, { review_id: 'rev1', replies: [] }] }))
    await recordReview(dir, 'rev1', () => entry('rev1'), (e) => e.applies.push({ at: 'T', plan_id: 'p', reply: 'yes', outcome: { written: 1, failed: 0 } }))
    expect((await read(dir)).reviews).toEqual([{ review_id: 'rev1', replies: [], applies: [{ at: 'T', plan_id: 'p', reply: 'yes', outcome: { written: 1, failed: 0 } }] }])
  })
})

describe('recordedText', () => {
  it('keeps a text that could be a command or an answer verbatim', () => {
    expect(recordedText('  Accept 1, 2  ')).toEqual({ reply: '  Accept 1, 2  ' })
    expect(recordedText('r'.repeat(VERBATIM_MAX))).toEqual({ reply: 'r'.repeat(VERBATIM_MAX) })
  })

  it('keeps a longer one, or one with a control character, by its start, length and sha256', () => {
    const long = 'x'.repeat(VERBATIM_MAX + 1)
    expect(recordedText(long)).toEqual({ reply_start: 'x'.repeat(200), reply_length: VERBATIM_MAX + 1, reply_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(recordedText('yes\x00')).toMatchObject({ reply_start: 'yes\x00', reply_length: 4 })
  })
})

describe('refuseWhenFull', () => {
  it('refuses as record_full when the entry is full, saying what to do', () => {
    expect(() => refuseWhenFull([1, 2], 3, 'replies', 'close it')).not.toThrow()
    expect(() => refuseWhenFull([1, 2, 3], 3, 'replies', 'close it')).toThrow(expect.objectContaining({ code: 'record_full', message: "this review's record is full (3 replies): close it" }))
  })

  it('writes only the reviews, dropping anything else the file held', async () => {
    const dir = await modelDir()
    await fs.writeFile(path.join(dir, '.dethereal', LOG_FILE), JSON.stringify({ reviews: [], padding: 'p'.repeat(1000) }))
    await recordReview(dir, 'rev1', () => entry('rev1'), () => {})
    expect(Object.keys(JSON.parse(await fs.readFile(path.join(dir, '.dethereal', LOG_FILE), 'utf8')))).toEqual(['reviews'])
  })

  it('refuses a write the active review alone would take over the size limit', async () => {
    const dir = await modelDir()
    // Under the store's read cap as written here, compact; over the record's limit as the store writes it.
    const huge = { ...entry('rev1'), replies: Array.from({ length: 900 }, () => ({ at: 'T', reply: 'r'.repeat(1000), outcome: { verb: 'accept' } })) }
    await fs.writeFile(path.join(dir, '.dethereal', LOG_FILE), JSON.stringify({ reviews: [huge] }))
    await expect(recordReview(dir, 'rev1', () => entry('rev1'), () => {})).rejects.toMatchObject({ code: 'record_too_large' })
  })

  it('passes a refusal from the change through, writing nothing', async () => {
    const dir = await modelDir()
    await recordReview(dir, 'rev1', () => entry('rev1'), () => {})
    const before = await read(dir)
    await expect(recordReview(dir, 'rev1', () => entry('rev1'), (e) => refuseWhenFull(e.replies, 0, 'replies', 'close it'))).rejects.toMatchObject({ code: 'record_full' })
    expect(await read(dir)).toEqual(before)
  })
})

describe('trimLog', () => {
  it('never drops the active review, even when it is the oldest', () => {
    const reviews = Array.from({ length: LOG_LIMITS.reviews + 2 }, (_, i) => entry(`rev${i}`))
    const kept = trimLog(reviews, 'rev0').map((r) => r.review_id)
    expect(kept).toHaveLength(LOG_LIMITS.reviews)
    expect(kept[0]).toBe('rev0')
    expect(kept).not.toContain('rev1')
  })

  it('drops the oldest others to stay under the size limit, measured as the file is written', () => {
    const big = Array.from({ length: 5 }, (_, i) => entry(`rev${i}`, 200))
    const kept = trimLog(big, 'rev4')
    expect(Buffer.byteLength(JSON.stringify({ reviews: kept }, null, 2))).toBeLessThanOrEqual(LOG_LIMITS.bytes)
    expect(kept.at(-1)!.review_id).toBe('rev4')
    expect(kept.length).toBeLessThan(5)
  })

  it('counts bytes, not characters', () => {
    const wide = (id: string): LoggedReview => ({ ...entry(id), replies: Array.from({ length: 50 }, () => ({ at: 'T', reply: '漢'.repeat(1000), outcome: { verb: 'accept' } })) })
    const reviews = Array.from({ length: 8 }, (_, i) => wide(`rev${i}`))
    expect(JSON.stringify({ reviews }).length).toBeLessThan(LOG_LIMITS.bytes)
    expect(trimLog(reviews, 'rev7').length).toBeLessThan(8)
  })

  it('keeps the active review when it alone is over the size limit', () => {
    const kept = trimLog([entry('rev0', 10), entry('rev1', 900)], 'rev1')
    expect(kept.map((r) => r.review_id)).toEqual(['rev1'])
  })
})

describe('the trim keeps what left this machine', () => {
  const entry = (id: string, published = false) => ({ review_id: id, mode: 'review', opened_at: 't', groups: 1, replies: [], applies: [], ...(published ? { published: [{ at: 't', plan_id: 'p', analysis_id: 'a', exposure_ids: ['e'], not_stored: [], results: {}, fingerprints: 'open' as const }] } : {}) })

  it('drops a review never published, never one that was', () => {
    const reviews = [entry('old-published', true), ...Array.from({ length: LOG_LIMITS.reviews }, (_, i) => entry(`r${i}`))]
    const kept = trimLog(reviews, 'r0')
    expect(kept.map((r) => r.review_id)).toContain('old-published')
    expect(kept).toHaveLength(LOG_LIMITS.reviews)
  })

  it('a record of published reviews only, past its limit, refuses rather than lose one', () => {
    const reviews = [...Array.from({ length: LOG_LIMITS.reviews }, (_, i) => entry(`p${i}`, true)), entry('active')]
    expect(() => trimLog(reviews, 'active')).toThrow(/holds only published reviews/)
  })
})
