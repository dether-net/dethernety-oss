/**
 * The hidden-edge records of a model directory:
 *
 * - `.dethereal/hidden-edges-decisions.json` (committed with the model): the operator's accepted and rejected
 *   candidates. An accepted entry is signed with this machine's key; it counts only where that key verifies it, so
 *   a teammate's entry or a hand edit counts as absent until re-accepted here. A rejected entry is unsigned: it
 *   only keeps a candidate out of this machine's reviews, and every run counts what it excludes. The file is
 *   untrusted input: schema-checked and size-capped.
 * - `.dethereal/hidden-edges-log.json` (this machine's): each review's replies and apply answers, as triage's
 *   record keeps them.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { canonicalJson } from '../utils/canonical-json.js'
import { MAC_TAGS, macHex, subkey, verifyMacHex, waiverKeyState, type WaiverKeyCode } from '../utils/gates.js'
import { modelHashOf } from '../utils/settlement.js'
import { HIDDEN_EDGE_TARGET, readRepoJson, StateFileError, updateDetherealJson, withSettlementLock } from '../utils/state-store.js'
import { ATTACK_ID, CANDIDATE_ID, KINDS, PLATFORM_ID, candidateId } from './contract.js'

export const DECISIONS_FILE = 'hidden-edges-decisions.json'
export const LOG_FILE = 'hidden-edges-log.json'

/** At most this many decisions are kept, and the file stays under the store's read cap. */
export const DECISION_LIMITS = { decisions: 1500, bytes: 960 * 1024, exposures: 50, techniques: 10 } as const

/** The purpose an accepted decision is signed for, through its own subkey of this machine's key (read at use: gates imports this module). */
const decisionKey = (key: Buffer) => subkey(key, MAC_TAGS.hiddenEdgeDecision)

// =============================================================================
// The key
// =============================================================================

export interface Signer {
  key: Buffer
  modelHash: string
}

/** This machine's key for the model, with the model's hash; or why there is none. */
export async function signerFor(dir: string, create: boolean): Promise<Signer | { code: WaiverKeyCode }> {
  const state = await waiverKeyState(create, dir)
  if (!state.key) return { code: state.code }
  return { key: state.key, modelHash: modelHashOf(state.key, await fs.realpath(dir)) }
}

export const isSigner = (s: Signer | { code: WaiverKeyCode }): s is Signer => 'key' in s

// =============================================================================
// Decisions
// =============================================================================

export type Verb = 'accepted' | 'rejected'

export interface Decision {
  id: string
  kind: string
  source: string
  target: string
  verb: Verb
  /** The flow an accept wrote (a local id until the push re-keys it); null for a reject */
  flow_id: string | null
  /** The path techniques written to the flow */
  technique_ids: string[]
  /** The exposures the candidate cited */
  exposure_ids: string[]
  at: string
  /** An accepted entry's MAC; null for a reject */
  mac: string | null
}

/** A decision as read, with whether this machine's key verifies it (a reject never needs to). */
export interface ReadDecision extends Decision {
  verified: boolean
}

export type DecisionsRead = { status: 'ok'; decisions: ReadDecision[]; invalid: number } | { status: 'unreadable'; code: string }

/** The part of an accepted decision its MAC covers: all of it, its time too, so an older accept cannot come back as new. */
function decisionPayload(modelHash: string, d: Omit<Decision, 'mac'>): string {
  return `${modelHash}\u0000${canonicalJson({
    v: 1, id: d.id, kind: d.kind, source: d.source, target: d.target, verb: d.verb, flow_id: d.flow_id, at: d.at,
    technique_ids: [...d.technique_ids].sort(), exposure_ids: [...d.exposure_ids].sort(),
  })}`
}

/** An accepted decision, signed; a rejected one as it is. */
export function signDecision(signer: Signer, d: Omit<Decision, 'mac'>): Decision {
  return { ...d, mac: d.verb === 'accepted' ? macHex(decisionKey(signer.key), decisionPayload(signer.modelHash, d)) : null }
}

export function verifyDecision(signer: Signer | null, d: Decision): boolean {
  return d.verb === 'accepted' && !!signer && verifyMacHex(decisionKey(signer.key), decisionPayload(signer.modelHash, d), d.mac)
}

const DECISION_KEYS = new Set(['id', 'kind', 'source', 'target', 'verb', 'flow_id', 'technique_ids', 'exposure_ids', 'at', 'mac'])
const idList = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && PLATFORM_ID.test(x))

/** A well-formed decision, or null: exact keys, every value in its shape, and its id its kind's and ends'. */
export function decisionOf(raw: unknown): Decision | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length !== DECISION_KEYS.size || !keys.every((k) => DECISION_KEYS.has(k))) return null
  if (typeof o.id !== 'string' || !CANDIDATE_ID.test(o.id) || typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null
  if (typeof o.source !== 'string' || !PLATFORM_ID.test(o.source) || typeof o.target !== 'string' || !PLATFORM_ID.test(o.target) || o.source === o.target) return null
  if (candidateId(o.kind, o.source, o.target) !== o.id) return null
  if (o.verb === 'accepted' ? !(typeof o.flow_id === 'string' && PLATFORM_ID.test(o.flow_id) && typeof o.mac === 'string' && o.mac.length <= 64) : !(o.verb === 'rejected' && o.flow_id === null && o.mac === null)) return null
  if (!Array.isArray(o.technique_ids) || o.technique_ids.length > DECISION_LIMITS.techniques || !o.technique_ids.every((t) => typeof t === 'string' && ATTACK_ID.test(t))) return null
  if (!idList(o.exposure_ids, DECISION_LIMITS.exposures) || typeof o.at !== 'string' || o.at.length > 40) return null
  return {
    id: o.id, kind: o.kind, source: o.source, target: o.target, verb: o.verb as Verb, flow_id: o.flow_id as string | null,
    technique_ids: [...(o.technique_ids as string[])], exposure_ids: [...(o.exposure_ids as string[])], at: o.at, mac: o.mac as string | null,
  }
}

/** Read the decisions file: the well-formed entries with whether each verifies here, and how many were not well-formed. */
export async function readDecisions(dir: string, signer: Signer | null): Promise<DecisionsRead> {
  let raw: Record<string, unknown> | null
  try {
    raw = await readRepoJson(dir, `.dethereal/${DECISIONS_FILE}`)
  } catch (err) {
    return { status: 'unreadable', code: err instanceof StateFileError ? err.code : 'io' }
  }
  if (!raw) return { status: 'ok', decisions: [], invalid: 0 }
  const list = Array.isArray(raw.decisions) ? raw.decisions : null
  if (raw.version !== 1 || !list) return { status: 'unreadable', code: 'invalid_shape' }
  const decisions: ReadDecision[] = []
  let invalid = Math.max(0, list.length - DECISION_LIMITS.decisions)
  for (const entry of list.slice(0, DECISION_LIMITS.decisions)) {
    const d = decisionOf(entry)
    if (!d) invalid++
    else decisions.push({ ...d, verified: verifyDecision(signer, d) })
  }
  return { status: 'ok', decisions, invalid }
}

/**
 * The decision that stands for each candidate id: the latest, by its time, of the verified accepts and the
 * rejects (the later in the file on a tie). An unverified accept never stands. A reject's time is not signed: a
 * hand edit can only take an edge back, which makes its flow count as an ordinary one again.
 */
export function standing(decisions: ReadDecision[]): Map<string, ReadDecision> {
  const out = new Map<string, ReadDecision>()
  for (const d of decisions) {
    if (d.verb !== 'rejected' && !d.verified) continue
    const prev = out.get(d.id)
    if (!prev || d.at >= prev.at) out.set(d.id, d)
  }
  return out
}

/** The decisions file's hash: of its bytes, or empty when absent. */
export async function decisionsHash(dir: string): Promise<string> {
  try {
    return createHash('sha256').update(await fs.readFile(path.join(dir, '.dethereal', DECISIONS_FILE))).digest('hex')
  } catch {
    return ''
  }
}

/**
 * Replace the decisions file under the state lock, only while its bytes still hash to `expected` (the empty string:
 * absent). `change` gets the raw entries (malformed ones are kept as they are) and returns the next ones.
 */
export async function replaceDecisions(dir: string, expected: string, change: (entries: unknown[]) => unknown[]): Promise<void> {
  const rel = `.dethereal/${DECISIONS_FILE}`
  await withSettlementLock(dir, async (io) => {
    const bytes = await io.read(rel)
    if ((bytes ? createHash('sha256').update(bytes).digest('hex') : '') !== expected) throw new StateFileError('changed', rel)
    const doc = bytes ? (JSON.parse(bytes.toString('utf8')) as { version?: unknown; decisions?: unknown }) : { version: 1, decisions: [] }
    if (doc.version !== 1 || !Array.isArray(doc.decisions)) throw new StateFileError('invalid_json', rel)
    const next = change([...doc.decisions])
    const content = JSON.stringify({ version: 1, decisions: next }, null, 2)
    if (next.length > DECISION_LIMITS.decisions || Buffer.byteLength(content, 'utf8') > DECISION_LIMITS.bytes) throw new StateFileError('too_large', rel)
    await io.replace(rel, content, bytes)
  }, { targets: HIDDEN_EDGE_TARGET })
}

/**
 * Re-key the decisions after a push gave local flows their platform ids. Only an accepted entry this machine's key
 * verifies under its old ids is re-signed; any other entry is left as it is (it did not count, and still does
 * not). Returns warnings; best effort, as the other sidecars' re-keying is.
 */
export async function remapDecisions(dir: string, idMapping: Map<string, string>): Promise<string[]> {
  const signer = await signerFor(dir, false)
  const key = isSigner(signer) ? signer : null
  const warnings: string[] = []
  let unsigned = 0
  try {
    await updateDetherealJson(dir, DECISIONS_FILE, (doc) => {
      if (doc.version !== 1 || !Array.isArray(doc.decisions)) return doc
      const next = (doc.decisions as unknown[]).map((raw) => {
        const d = decisionOf(raw)
        const flow = d?.flow_id ? idMapping.get(d.flow_id) : undefined
        // A push maps every flow it kept to itself: only a new id re-keys.
        if (!d || !flow || flow === d.flow_id) return raw
        if (!key || !verifyDecision(key, d)) {
          unsigned++
          return raw
        }
        const { mac: _mac, ...rest } = d
        return signDecision(key, { ...rest, flow_id: flow })
      })
      return { ...doc, decisions: next }
    })
  } catch (err) {
    warnings.push(`hidden-edge decisions were not re-keyed (${err instanceof StateFileError ? err.code : 'error'}): their flows count as ordinary until re-accepted with /dethereal:hidden-edges`)
  }
  if (unsigned) warnings.push(`${unsigned} hidden-edge decision(s) do not verify on this machine and were not re-keyed: their flows count as ordinary until re-accepted`)
  return warnings
}
