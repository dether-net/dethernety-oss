/**
 * The triage record of a model directory, `.dethereal/triage-log.json`: every reply a review received, with what
 * it did, and every apply answer. It is this machine's own record (kept out of git, like the settlement log) and
 * holds the latest reviews only.
 *
 * A reply or an answer takes effect only once it is recorded: the tools write the record first, and refuse when
 * it cannot be written. A text that could be a command or an answer is kept verbatim; a longer one, or one that is
 * no clean text, by its start, its length and its sha256.
 */
import { createHash } from 'node:crypto'
import { updateDetherealJson } from '../utils/state-store.js'
import { keepMachineFilesOut } from '../utils/settlement-writers.js'
import { replyProblem } from '../utils/settlement.js'

export const LOG_FILE = 'triage-log.json'
/**
 * The record holds at most `reviews` reviews, and stays under `bytes` as written (below the store's 1 MiB read
 * cap). One review records at most `replies` replies and `refusedAnswers` refused apply answers; a closing reply
 * is recorded past the cap while the review is open, and a yes or cancel up to `answers` in all.
 */
export const LOG_LIMITS = { reviews: 20, bytes: 896 * 1024, replies: 70, refusedAnswers: 20, answers: 40 } as const
/** A text longer than this is no command and no answer: it is recorded by its start, length and hash. */
export const VERBATIM_MAX = 2000
const START_CHARS = 200

/** A reply or answer as recorded: verbatim, or by its start, length and sha256. */
export type RecordedText = { reply: string } | { reply_start: string; reply_length: number; reply_sha256: string }

export type LoggedReply = { at: string; outcome: { verb: string } | { refused: string } } & RecordedText

export type LoggedApply = {
  at: string
  plan_id: string
  outcome: { answer: 'yes' } | { cancelled: true } | { written: number; failed: number } | { published: number; not_stored: number } | { write_error: true } | { refused: string }
} & RecordedText

/** A publish to the review workspace: where it went, which findings, and what the workspace answered. */
export interface LoggedPublish {
  at: string
  plan_id: string
  analysis_id: string
  exposure_ids: string[]
  /** Each finding's group, as the operator saw it numbered */
  group_of?: Record<string, number>
  /** The findings the workspace did not store, by its answer */
  not_stored: Array<{ exposure_id: string; result: string }>
  results: Record<string, number>
  /** When the fingerprints sent were read: at open, at prepare, or at the publish */
  fingerprints: 'open' | 'prepare' | 'publish'
  /** A publish whose answer never came: the workspace may hold it */
  unconfirmed?: true
}

export interface LoggedReview {
  review_id: string
  mode: string
  opened_at: string
  groups: number
  replies: LoggedReply[]
  applies: LoggedApply[]
  /** The review's publishes to the review workspace; absent for a review never published */
  published?: LoggedPublish[]
}

/** The text as the record keeps it. */
export function recordedText(text: string): RecordedText {
  if (text.length <= VERBATIM_MAX && !replyProblem(text)) return { reply: text }
  return { reply_start: text.slice(0, START_CHARS), reply_length: text.length, reply_sha256: createHash('sha256').update(text, 'utf8').digest('hex') }
}

/** The record's size as the store writes it. */
const sizeOf = (reviews: LoggedReview[]) => Buffer.byteLength(JSON.stringify({ reviews }, null, 2), 'utf8')

/**
 * Keep the latest reviews: at most LOG_LIMITS.reviews, under LOG_LIMITS.bytes. The active review is never dropped,
 * and a published one never: it is the record of what left this machine. A record of published reviews only, past
 * its limits, refuses (record_full) rather than lose one.
 */
export function trimLog(reviews: LoggedReview[], active: string): LoggedReview[] {
  const out = [...reviews]
  const drop = () => {
    const i = out.findIndex((r) => r.review_id !== active && !r.published?.length)
    if (i < 0) {
      if (out.some((r) => r.review_id !== active)) throw new RecordError('record_full', 'the triage record holds only published reviews, the record of what left this machine: move .dethereal/triage-log.json aside to keep it, then try again', 'published reviews')
      return false
    }
    out.splice(i, 1)
    return true
  }
  while (out.length > LOG_LIMITS.reviews && drop());
  while (sizeOf(out) > LOG_LIMITS.bytes && drop());
  return out
}

const isReview = (r: unknown): r is LoggedReview =>
  !!r && typeof r === 'object' && typeof (r as LoggedReview).review_id === 'string' && Array.isArray((r as LoggedReview).replies)

/**
 * Why the record could not be written: the reply or answer that needed it was not taken. `record_full` is a count
 * reached (`what` names it), after which some replies are still taken; `record_too_large` is the record's size,
 * after which none is.
 */
export class RecordError extends Error {
  constructor(readonly code: 'record_unwritable' | 'not_model_dir' | 'record_full' | 'record_too_large', message: string, readonly what?: string) {
    super(message)
    this.name = 'RecordError'
  }
}

/** The directories whose .gitignore was checked for the triage files in this process. */
const ignored = new Set<string>()

/**
 * Keep this machine's triage files (the record, the runs' files under `.dethereal/triage-run/`) out of git: once per
 * directory and process, and cheaply when the entries are there. Outside the state lock, which is not reentrant.
 * Returns a warning when `.dethereal/.gitignore` could not be updated.
 */
export async function keepTriageFilesOut(dir: string): Promise<string[]> {
  if (ignored.has(dir)) return []
  if ((await keepMachineFilesOut(dir)) === 'refused') {
    return [".dethereal/.gitignore could not be updated: keep .dethereal/triage-log.json, .dethereal/hidden-edges-log.json and .dethereal/triage-run/ out of git, as they hold the operator's replies and the runs' evidence"]
  }
  ignored.add(dir)
  return []
}

/**
 * Change review `reviewId`'s entry (creating it with `fresh` when absent) and write the record. `change` may throw
 * a RecordError to refuse, writing nothing. The record file is kept out of git before its first write here.
 */
export async function recordReview(dir: string, reviewId: string, fresh: () => LoggedReview, change: (r: LoggedReview) => void): Promise<{ warnings: string[] }> {
  return recordReviewIn(dir, { file: LOG_FILE, name: 'triage record' }, reviewId, fresh, change)
}

/** A review record of this machine's, under `.dethereal/`, and what its refusals call it. */
export interface ReviewRecordFile {
  file: string
  name: string
}

/** {@link recordReview} for any review record of the same shape: triage's, or another review's. */
export async function recordReviewIn(dir: string, record: ReviewRecordFile, reviewId: string, fresh: () => LoggedReview, change: (r: LoggedReview) => void): Promise<{ warnings: string[] }> {
  const warnings = await keepTriageFilesOut(dir)
  try {
    await updateDetherealJson(dir, record.file, (doc) => {
      const reviews = (Array.isArray(doc.reviews) ? doc.reviews : []).filter(isReview) as LoggedReview[]
      let entry = reviews.find((r) => r.review_id === reviewId)
      if (!entry) {
        entry = fresh()
        reviews.push(entry)
      }
      if (!Array.isArray(entry.applies)) entry.applies = []
      change(entry)
      const kept = trimLog(reviews, reviewId)
      // Only the reviews are written: nothing else in the file can grow it past what can be read back.
      if (sizeOf(kept) > LOG_LIMITS.bytes) throw new RecordError('record_too_large', "this review's record is too large to write; nothing was taken: open a new review")
      return { reviews: kept }
    }, { createIfMissing: true })
  } catch (err) {
    if (err instanceof RecordError) throw err
    const code = (err as { code?: string }).code
    if (code === 'not_model_dir') throw new RecordError('not_model_dir', 'the directory is not a model directory (it has no manifest.json): name the model directory')
    throw new RecordError(
      'record_unwritable',
      code === 'invalid_json' || code === 'not_object' || code === 'too_large'
        ? `the ${record.name} (.dethereal/${record.file}) cannot be read: move it aside, then try again; nothing was taken`
        : `the ${record.name} could not be written (${code ?? 'error'}); nothing was taken: try again`,
    )
  }
  return { warnings }
}

/** Refuse, writing nothing, when the entry already holds `max` items: `then` says what the operator can do. */
export function refuseWhenFull(items: unknown[], max: number, what: string, then: string): void {
  if (items.length >= max) throw new RecordError('record_full', `this review's record is full (${max} ${what}): ${then}`, what)
}
