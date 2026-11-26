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
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { updateDetherealJson } from '../utils/state-store.js'
import { keepMachineFilesOut } from '../utils/settlement-writers.js'
import { replyProblem } from '../utils/settlement.js'
import { redactSecrets } from '../auth/redact.js'

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
  outcome: { answer: 'yes' | 'reject' | 'release' } | { cancelled: true } | { written: number; failed: number } | { published: number; not_stored: number } | { write_error: true } | { refused: string }
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

/** A publish of hidden-edge proposals to the review workspace: where it went, which edges, and what it answered. */
export interface LoggedEdgePublish {
  at: string
  plan_id: string
  analysis_id: string
  /** Each edge sent, by its candidate id: its number in the review, its kind and its ends' ids */
  edges: Record<string, { n: number; kind: string; source: string; target: string }>
  /** The edges the workspace did not store, by its answer */
  not_stored: Array<{ candidate_id: string; result: string }>
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
  /** The review's hidden-edge publishes; absent for a review never published */
  published_edges?: LoggedEdgePublish[]
}

/** The text as the record keeps it: one holding this session's credentials only by its hash, its start redacted. */
export function recordedText(text: string): RecordedText {
  const clean = redactSecrets(text) === text
  if (clean && text.length <= VERBATIM_MAX && !replyProblem(text)) return { reply: text }
  return { reply_start: redactSecrets(text).slice(0, START_CHARS), reply_length: text.length, reply_sha256: createHash('sha256').update(text, 'utf8').digest('hex') }
}

/** The record's size as the store writes it. */
const sizeOf = (reviews: LoggedReview[]) => Buffer.byteLength(JSON.stringify({ reviews }, null, 2), 'utf8')

/** The newest published reviews kept whole when the record is over its bytes; older ones are compacted. */
export const PUBLISHED_KEPT_WHOLE = 5

const isPublished = (r: LoggedReview) => !!r.published?.length || !!r.published_edges?.length

/**
 * A published review down to what left this machine: its ids, its stamps, its publishes, and the typed answer
 * behind each publish (the plan's answer entry); its replies and other answers dropped.
 */
function compacted(r: LoggedReview): LoggedReview {
  const plans = new Set([...(r.published ?? []), ...(r.published_edges ?? [])].map((x) => x.plan_id))
  return {
    review_id: r.review_id, mode: r.mode, opened_at: r.opened_at, groups: r.groups, replies: [],
    applies: (r.applies ?? []).filter((a) => plans.has(a.plan_id) && !('refused' in a.outcome) && !('cancelled' in a.outcome)),
    ...(r.published ? { published: r.published } : {}), ...(r.published_edges ? { published_edges: r.published_edges } : {}),
  }
}

/**
 * Keep the latest reviews: at most LOG_LIMITS.reviews unpublished ones, all under LOG_LIMITS.bytes. The active review
 * is never dropped, and a published one never: it is the record of what left this machine, and the count does not
 * apply to it. Over the bytes with only published reviews left to drop, those older than the newest
 * PUBLISHED_KEPT_WHOLE are compacted; only a record still over its bytes refuses (record_full).
 */
export function trimLog(reviews: LoggedReview[], active: string, record: ReviewRecordFile = TRIAGE_RECORD): LoggedReview[] {
  const out = [...reviews]
  const overBytes = () => sizeOf(out) > LOG_LIMITS.bytes
  const drop = () => {
    const i = out.findIndex((r) => r.review_id !== active && !isPublished(r))
    if (i < 0) return false
    out.splice(i, 1)
    return true
  }
  while (out.filter((r) => !isPublished(r)).length > LOG_LIMITS.reviews && drop());
  while (overBytes() && drop());
  if (!overBytes()) return out
  const older = out.flatMap((r, i) => (r.review_id !== active && isPublished(r) ? [i] : [])).slice(0, -PUBLISHED_KEPT_WHOLE)
  for (const i of older) out[i] = compacted(out[i]!)
  if (overBytes() && out.some((r) => r.review_id !== active)) {
    throw new RecordError(
      'record_full',
      `the ${record.name} is at its size limit with its published reviews, the record of what left this machine, already compacted: copy .dethereal/${record.file} elsewhere to keep it, then move it aside and try again`,
      'published reviews',
    )
  }
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
  return recordReviewIn(dir, TRIAGE_RECORD, reviewId, fresh, change)
}

const TRIAGE_RECORD: ReviewRecordFile = { file: LOG_FILE, name: 'triage record' }

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
      const kept = trimLog(reviews, reviewId, record)
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

/** The most a local record or discovery file is read: the record's own bound, rounded up. */
const LOCAL_READ_MAX = 1024 * 1024

/** A local JSON file, or null when it is absent, too large or no JSON. */
export async function readLocalJson(file: string): Promise<unknown> {
  try {
    // a regular file only: never a device, a pipe or a directory
    const s = await stat(file)
    if (!s.isFile() || s.size > LOCAL_READ_MAX) return null
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** The reviews a record of this machine's under `.dethereal/` holds; none when there is no record. */
export async function readLoggedReviewsIn(dir: string, file: string): Promise<LoggedReview[]> {
  const doc = ((await readLocalJson(join(dir, '.dethereal', file))) ?? {}) as { reviews?: unknown }
  return (Array.isArray(doc.reviews) ? doc.reviews : []).filter((r): r is LoggedReview => !!r && typeof r === 'object' && typeof (r as LoggedReview).review_id === 'string')
}

/** Refuse, writing nothing, when the entry already holds `max` items: `then` says what the operator can do. */
export function refuseWhenFull(items: unknown[], max: number, what: string, then: string): void {
  if (items.length >= max) throw new RecordError('record_full', `this review's record is full (${max} ${what}): ${then}`, what)
}
