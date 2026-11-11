/**
 * Follow a run's writes to model files in order, and attribute every changed
 * value to the event that set it.
 *
 * Each model file is known (its text), unknown (something changed it that the
 * transcript does not show: a server-side write, a shell command) or absent. A
 * read of the whole file, or a file tool's own record of the file before it
 * changed it, makes an unknown file known again; what changed meanwhile is an
 * opaque change, attributed to the server write or command after which the
 * file became unknown. A read that differs from a known file is an unexplained
 * change: something wrote it that the replay did not see.
 */
import path from 'node:path'
import type { Attribution, Checkpoint, FileState, OpaqueChange, TranscriptEvent } from './types.js'
import { diffTexts } from './json-diff.js'
import { applyUnifiedDiff, PatchMismatch, sameIgnoringIndent } from './unified-diff.js'
import { sha256Hex } from '../../utils/hash.js'

/** A model directory's own files, and the project's model registry. */
export function isModelFile(rel: string): boolean {
  return (
    /(^|\/)(manifest|structure|dataflows|data-items)\.json$/.test(rel) ||
    /(^|\/)attributes\/(components|dataFlows|dataItems|boundaries)\/[^/]+\.json$/.test(rel) ||
    /(^|\/)\.dethereal\/[^/]+$/.test(rel) ||
    /(^|\/)\.dethernety\/models\.json$/.test(rel)
  )
}

/** The model directory a model file belongs to ('' for the project registry). */
export function modelDirOf(rel: string): string {
  const m = /^(.*?)\/?(?:attributes\/[^/]+\/[^/]+|\.dethereal\/[^/]+|(?:manifest|structure|dataflows|data-items)\.json)$/.exec(rel)
  return m ? m[1]! : path.posix.dirname(rel)
}

/**
 * Server tools that write files: inside the model directory they are given (`''` = all of it), the
 * project's model registry, and sibling backup directories (`<dir>.backup-<time>/`).
 */
const SERVER_WRITERS: Record<string, { inDir: string[]; registry?: boolean; backups?: boolean }> = {
  'dethereal.import_model': { inDir: [''], registry: true, backups: true },
  'dethereal.update_model': { inDir: [''], backups: true },
  'dethereal.export_model': { inDir: [''], registry: true, backups: true },
  'dethereal.create_threat_model': { inDir: [''], registry: true },
  'dethereal.generate_attribute_stubs': { inDir: ['attributes/', '.dethereal/'] },
  'dethereal.model_state': { inDir: ['.dethereal/'] },
  'dethereal.model_state_waive': { inDir: ['.dethereal/'] },
  // Settling writes attribute files (reject, modify, set) and the structure and data-items files (a record value set).
  'dethereal.model_state_settle': { inDir: [''] },
  'dethereal.manage_controls': { inDir: [''] },
  'dethereal.update_attributes': { inDir: ['.dethereal/'] },
}
/** Server tools that read a model directory and write nothing into it. */
const SERVER_READERS = new Set([
  'dethereal.validate_model_json', 'dethereal.detect_drift', 'dethereal.workspace_status', 'dethereal.get_model_schema', 'dethereal.get_example_models',
  'dethereal.list_models', 'dethereal.get_classes', 'dethereal.match_classes', 'dethereal.search_mitre_attack', 'dethereal.get_mitre_defend',
  'dethereal.auth_status', 'dethereal.login', 'dethereal.logout', 'dethereal.get_control_gaps', 'dethereal.query_controls', 'dethereal.query_exposures',
  'dethereal.query_countermeasures', 'dethereal.manage_exposures', 'dethereal.manage_countermeasures', 'dethereal.manage_analyses',
])

/**
 * The project paths a server tool call may have written, or null when it writes none. A path ending in
 * '/' covers a directory, one ending in '*' every path it prefixes, and '*' alone everything.
 */
export function serverWriteScope(tool: string, input: unknown, rel: (p: string) => string): string[] | null {
  if (!tool.startsWith('dethereal.') || SERVER_READERS.has(tool)) return null
  // Reading the workflow state writes nothing.
  if (tool === 'dethereal.model_state' && (input as { action?: unknown } | null)?.action === 'get') return null
  const spec = SERVER_WRITERS[tool]
  const dirArg = (input as { directory_path?: unknown } | null)?.directory_path
  // A writer, or a tool not known to be a reader, without a directory could have written anything.
  if (typeof dirArg !== 'string' || !dirArg) return ['*']
  const dir = rel(dirArg).replace(/\/$/, '')
  const { inDir, registry, backups } = spec ?? { inDir: [''], registry: true, backups: true }
  return [
    ...inDir.map((s) => (s === '' ? `${dir}/` : `${dir}/${s}`)),
    ...(registry ? ['.dethernety/'] : []),
    ...(backups ? [`${dir}.backup-*`] : []),
  ]
}

/** Does `target` (a path, a directory ending in '/', a prefix ending in '*', or '*') cover project path `p`? */
export function covers(target: string, p: string): boolean {
  if (target === '*') return true
  if (target.endsWith('/')) return p.startsWith(target)
  if (target.endsWith('*')) return p.startsWith(target.slice(0, -1))
  return p === target
}

const WRITE_OPERATOR = /(^|[^0-9&<>])>>?(?!&)|\btee\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\b(cp|mv|rm|rmdir|touch|install|truncate|ln|unlink|dd)\b|<<|\b(python3?|node|ruby|perl|jq|awk|deno|bun)\b[^|;&]*\s-[ce]\b|\bgit\s+(checkout|restore|reset|stash|apply|am|mv|rm|clean)\b|\bapply_patch\b/

/**
 * The working directory the rest of a command runs in, after the `cd`s it begins with
 * (`cd P && …`, `cd P; …`, or `cd P` on its own line). A `cd` whose target cannot be read here
 * (`~`, a variable) ends the reading.
 */
export function afterLeadingCd(command: string, cwdRel: string, relPath: (p: string) => string): string {
  let cwd = cwdRel
  let rest = command
  for (;;) {
    const m = /^\s*cd\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))[ \t]*(?:&&|;|\n)/.exec(rest)
    if (!m) return cwd
    const target = m[1] ?? m[2] ?? m[3]!
    if (target.startsWith('/')) cwd = relPath(target)
    else if (/^[~$]/.test(target) || target.includes('$')) return cwd
    else cwd = path.posix.normalize(path.posix.join(cwd || '.', target)).replace(/^\.$/, '')
    rest = rest.slice(m[0].length)
  }
}

/** Does a shell command write, move or delete model files, and which ones (prefixes end in '/'; '*' = any)? */
export function shellModelWrites(command: string, cwdRel: string, knownModelDirs: string[], projectRoot: string | null = null): string[] {
  // Output thrown away (`> /dev/null`) or sent to another descriptor (`2>&1`) writes no file.
  command = command.replace(/\d*>>?\s*\/dev\/null\b|\d*>&\d+/g, ' ')
  if (!WRITE_OPERATOR.test(command)) return []
  const tokens = command.split(/[\s'"`;|&()<>=]+/).filter(Boolean)
  const named = new Set<string>()
  const root = projectRoot ? projectRoot.replace(/\/$/, '') : null
  for (const t of tokens) {
    let p: string
    if (t.startsWith('/')) {
      // An absolute path counts only inside the project, as its project path.
      if (!root || !(t === root || t.startsWith(`${root}/`))) continue
      p = path.posix.relative(root, path.posix.normalize(t))
    } else p = path.posix.normalize(path.posix.join(cwdRel || '.', t)).replace(/^\.\//, '')
    const q = p.replace(/\/$/, '')
    // A working directory outside the project puts a relative path outside it too.
    if (q.startsWith('/')) continue
    const holdsModelFiles = (d: string) =>
      q === d || q === `${d}/.dethereal` || q === `${d}/attributes` || (q.startsWith(`${d}/attributes/`) && !q.slice(d.length + '/attributes/'.length).includes('/'))
    if (isModelFile(q)) named.add(q)
    // A model directory, the parts of one that hold model files, or a directory above one.
    else if (knownModelDirs.some((d) => d && holdsModelFiles(d))) named.add(`${q}/`)
    else if (q && q !== '.' && knownModelDirs.some((d) => d && d.startsWith(`${q}/`))) named.add(`${q}/`)
  }
  // A command that writes and names a model path touches it; one that writes through an interpreter or
  // redirection without naming one is still counted when it mentions any model file name.
  if (named.size) return [...named]
  if (/(manifest|structure|dataflows|data-items|models)\.json|\/attributes\/|\.dethereal/.test(command)) return ['*']
  return []
}

const sha256 = sha256Hex

export interface ReplayResult {
  attributions: Attribution[]
  opaque: OpaqueChange[]
  checkpoints: Checkpoint[]
  notes: Array<{ event: number; path: string; note: string }>
  /** Per event seq: files it made unknown (server writes, shells), for reconciliation */
  touched: Map<number, string[]>
}

export interface ReplayOptions {
  /** Model files present at the start, by project path */
  start?: Map<string, string>
  /** The project root, to read absolute paths in shell commands */
  projectRoot?: string | null
  /** Diagnostics: called before each write to a model file, with the file's replayed state */
  observe?: (event: TranscriptEvent, state: FileState) => void
  /** Called with the whole texts behind every attribution and opaque change, for readers that key values by element */
  onChange?: (change: TextChange) => void
  /**
   * Model files present when the run ended, by project path. Each file is then
   * known once more after the last event: what changed since the replay last
   * knew it is an opaque change seen at `events.length`.
   */
  end?: Map<string, string>
}

/**
 * One change to a model file, as whole texts (undefined = absent or unknown).
 * `event` is the write; an opaque change carries `opaque` instead, as its
 * `OpaqueChange` records it.
 */
export interface TextChange {
  path: string
  before: string | undefined
  after: string | undefined
  event?: number
  actor?: string
  tool?: string
  beforeUnknown?: boolean
  opaque?: Pick<OpaqueChange, 'since' | 'resyncedAt' | 'alsoWritten' | 'alsoCovered'>
}

export function replay(events: TranscriptEvent[], options: ReplayOptions = {}): ReplayResult {
  const files = new Map<string, FileState>()
  const lastWrite = new Map<string, number>()
  /** A file's last known text before it became unknown, to diff against when it is known again */
  const beforeOpaque = new Map<string, string | undefined>()
  /** Writes to a file while its content was unknown */
  const writesWhileUnknown = new Map<string, number[]>()
  const opaquePrefixes: Array<{ prefix: string; since: number }> = []
  /** Server writes and commands that covered a file after it became unknown */
  const coveredWhileUnknown = new Map<string, number[]>()
  const out: ReplayResult = { attributions: [], opaque: [], checkpoints: [], notes: [], touched: new Map() }
  for (const [p, text] of options.start ?? []) files.set(p, { state: 'known', text })

  const modelDirs = () => [...new Set([...files.keys()].map(modelDirOf).filter(Boolean))]
  const stateOf = (p: string): FileState => {
    const s = files.get(p)
    if (s) return s
    // A file first seen under a prefix a server write or command covered: its content was not observed
    // since the earliest of them; the later ones covered it too.
    const hits = opaquePrefixes.filter((o) => covers(o.prefix, p))
    if (!hits.length) return { state: 'absent' }
    return { state: 'unknown', since: hits[0]!.since }
  }
  /** Every event after `since` that covered the file while it was unknown. */
  const laterCovers = (p: string, since: number): number[] | undefined => {
    const fromPrefixes = files.has(p) ? [] : opaquePrefixes.filter((o) => covers(o.prefix, p) && o.since !== since).map((o) => o.since)
    const all = [...new Set([...fromPrefixes, ...(coveredWhileUnknown.get(p) ?? [])])].filter((x) => x > since).sort((a, b) => a - b)
    return all.length ? all : undefined
  }
  /** The file is no longer in an unknown episode: drop what that episode collected. */
  const forgetUnknown = (p: string) => {
    beforeOpaque.delete(p)
    writesWhileUnknown.delete(p)
    coveredWhileUnknown.delete(p)
  }
  const makeUnknown = (p: string, since: number) => {
    const s = stateOf(p)
    if (s.state === 'unknown') {
      if (since !== s.since && !(coveredWhileUnknown.get(p) ?? []).includes(since)) coveredWhileUnknown.set(p, [...(coveredWhileUnknown.get(p) ?? []), since])
      return
    }
    beforeOpaque.set(p, s.state === 'known' ? s.text : undefined)
    files.set(p, { state: 'unknown', since })
  }
  const touch = (targets: string[], seq: number) => {
    out.touched.set(seq, targets)
    for (const t of targets) {
      if (t === '*' || t.endsWith('/') || t.endsWith('*')) {
        opaquePrefixes.push({ prefix: t, since: seq })
        for (const p of files.keys()) if (covers(t, p)) makeUnknown(p, seq)
      } else makeUnknown(t, seq)
    }
  }
  const attribute = (e: TranscriptEvent, p: string, before: string | undefined, after: string | undefined, beforeUnknown: boolean) => {
    options.onChange?.({ path: p, before: beforeUnknown ? undefined : before, after, event: e.seq, actor: e.actor, ...(e.tool ? { tool: e.tool } : {}), ...(beforeUnknown ? { beforeUnknown: true } : {}) })
    for (const c of diffTexts(before, after)) {
      out.attributions.push({
        path: p, pointer: c.pointer, before: beforeUnknown ? undefined : c.before, after: c.after, event: e.seq, actor: e.actor,
        ...(e.tool ? { tool: e.tool } : {}), ...(beforeUnknown ? { beforeUnknown: true } : {}),
      })
    }
  }
  /** The file is known to be `text` at event `seq`: settle any opaque or unexplained change first. */
  const resync = (p: string, text: string, seq: number, lossyEnd: boolean) => {
    const s = stateOf(p)
    const same = (a: string, b: string) => a === b || (lossyEnd && a.replace(/\n$/, '') === b.replace(/\n$/, ''))
    if (s.state === 'unknown') {
      const prior = beforeOpaque.get(p)
      const also = writesWhileUnknown.get(p)
      const covered = laterCovers(p, s.since)
      options.onChange?.({ path: p, before: prior, after: text, opaque: { since: s.since, resyncedAt: seq, ...(also ? { alsoWritten: also } : {}), ...(covered ? { alsoCovered: covered } : {}) } })
      for (const c of diffTexts(prior, text)) {
        out.opaque.push({ path: p, since: s.since, resyncedAt: seq, pointer: c.pointer, before: c.before, after: c.after, ...(also ? { alsoWritten: also } : {}), ...(covered ? { alsoCovered: covered } : {}) })
      }
      forgetUnknown(p)
    } else if (s.state === 'known' && !same(s.text, text)) {
      out.notes.push({ event: seq, path: p, note: 'the file differs from the replay: an unobserved change' })
      options.onChange?.({ path: p, before: s.text, after: text, opaque: { since: -1, resyncedAt: seq } })
      for (const c of diffTexts(s.text, text)) out.opaque.push({ path: p, since: -1, resyncedAt: seq, pointer: c.pointer, before: c.before, after: c.after })
    } else if (s.state === 'absent') {
      out.notes.push({ event: seq, path: p, note: 'a file the replay had not seen exists' })
      options.onChange?.({ path: p, before: undefined, after: text, opaque: { since: -1, resyncedAt: seq } })
      for (const c of diffTexts(undefined, text)) out.opaque.push({ path: p, since: -1, resyncedAt: seq, pointer: c.pointer, before: c.before, after: c.after })
    }
    // A numbered read cannot show a final newline: keep the known text's, never invent one.
    const keep = s.state === 'known' && lossyEnd && same(s.text, text) ? s.text : text
    files.set(p, { state: 'known', text: keep })
  }

  /** The harness says the file did not exist at event `seq`. */
  const settleAbsent = (p: string, seq: number) => {
    const s = stateOf(p)
    if (s.state === 'unknown') {
      const covered = laterCovers(p, s.since)
      options.onChange?.({ path: p, before: beforeOpaque.get(p), after: undefined, opaque: { since: s.since, resyncedAt: seq, ...(covered ? { alsoCovered: covered } : {}) } })
      for (const c of diffTexts(beforeOpaque.get(p), undefined)) out.opaque.push({ path: p, since: s.since, resyncedAt: seq, pointer: c.pointer, before: c.before, after: c.after, ...(covered ? { alsoCovered: covered } : {}) })
      forgetUnknown(p)
    } else if (s.state === 'known') {
      out.notes.push({ event: seq, path: p, note: 'the file differs from the replay: an unobserved change' })
      options.onChange?.({ path: p, before: s.text, after: undefined, opaque: { since: -1, resyncedAt: seq } })
      for (const c of diffTexts(s.text, undefined)) out.opaque.push({ path: p, since: -1, resyncedAt: seq, pointer: c.pointer, before: c.before, after: c.after })
    }
    files.set(p, { state: 'absent' })
  }

  const summary = (): Checkpoint['files'] => {
    const f: Checkpoint['files'] = {}
    for (const [p, s] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      f[p] = s.state === 'known' ? { state: 'known', lastWrite: lastWrite.get(p) ?? -1, sha256: sha256(s.text) } : s.state === 'unknown' ? { state: 'unknown', since: s.since } : { state: 'absent' }
    }
    return f
  }
  /** Per actor, its last message before the next reply: a turn end, once the reply comes */
  const pendingTurnEnd = new Map<string, { after: number; files: Checkpoint['files'] }>()
  const checkpoint = (after: number, reason: Checkpoint['reason'], actor: string, f = summary()) =>
    out.checkpoints.push({ seq: out.checkpoints.length, after, reason, actor, files: f })

  for (const e of events) {
    if (e.kind === 'file_write' && e.path && e.modelFile && !e.isError && e.fileOp) {
      const p = e.path
      const op = e.fileOp
      options.observe?.(e, stateOf(p))
      if (e.before !== undefined) resync(p, e.before, e.seq, false)
      else if (e.beforeAbsent) settleAbsent(p, e.seq)
      const s = stateOf(p)
      const beforeText = s.state === 'known' ? s.text : undefined
      let after: string | undefined
      let unknownAfter = false
      try {
        if (op.op === 'write') after = op.content
        else if (op.op === 'delete') after = undefined
        else if (op.op === 'move') {
          const to = op.to
          if (s.state === 'known') {
            attribute(e, p, s.text, undefined, false)
            files.set(p, { state: 'absent' })
            attribute(e, to, undefined, s.text, false)
            files.set(to, { state: 'known', text: s.text })
            lastWrite.set(to, e.seq)
          } else {
            files.set(p, { state: 'absent' })
            forgetUnknown(p)
            makeUnknown(to, e.seq)
          }
          lastWrite.set(p, e.seq)
          continue
        } else if (s.state !== 'known') {
          unknownAfter = true
          if (s.state === 'absent' && op.op === 'replace' && op.oldString === '') after = op.newString
        } else if (op.op === 'replace') {
          if (op.oldString === '') after = s.text === '' ? op.newString : undefined
          else {
            const n = s.text.split(op.oldString).length - 1
            if (n === 0 || (n > 1 && !op.replaceAll)) throw new PatchMismatch(n === 0 ? 'old text not found' : 'old text not unique')
            after = op.replaceAll ? s.text.split(op.oldString).join(op.newString) : s.text.replace(op.oldString, () => op.newString)
          }
          if (after === undefined) throw new PatchMismatch('an empty old text on a non-empty file')
        } else after = applyUnifiedDiff(s.text, op.hunks)
      } catch (err) {
        e.replayMismatch = err instanceof Error ? err.message : String(err)
        out.notes.push({ event: e.seq, path: p, note: `the change does not apply to the replayed file: ${e.replayMismatch}` })
        unknownAfter = true
        after = undefined
      }
      if (e.expectedPatch && beforeText !== undefined && !unknownAfter && after !== undefined) {
        // OpenCode's diff is made for display, with its indentation reduced: compare without indentation.
        const loose = e.harness === 'opencode'
        try {
          const expected = applyUnifiedDiff(beforeText, e.expectedPatch, { ignoreIndent: loose })
          if (loose ? !sameIgnoringIndent(expected, after) : expected !== after) {
            e.expectedMismatch = true
            out.notes.push({ event: e.seq, path: p, note: loose ? "the replayed result differs from the harness's own record of the change" : "the replayed result differs from the harness's own record of the change; the record is used" })
            if (!loose) after = expected
          }
        } catch {
          e.expectedMismatch = true
          out.notes.push({ event: e.seq, path: p, note: "the harness's own record of the change does not apply to the replayed file" })
        }
      }
      if (unknownAfter && after === undefined) {
        // A write to a file already unknown is listed with it; one that fails on a known file makes it unknown.
        if (stateOf(p).state === 'unknown') writesWhileUnknown.set(p, [...(writesWhileUnknown.get(p) ?? []), e.seq])
        else makeUnknown(p, e.seq)
        if (op.op === 'replace' && op.newString) out.notes.push({ event: e.seq, path: p, note: 'an edit to a file whose content is unknown' })
      } else {
        if (s.state === 'unknown') out.notes.push({ event: e.seq, path: p, note: 'a whole-file write replaced a file whose content was unknown: what changed before it is not known' })
        attribute(e, p, beforeText, after, s.state === 'unknown')
        if (after === undefined) files.set(p, { state: 'absent' })
        else files.set(p, { state: 'known', text: after })
        if (s.state === 'unknown') forgetUnknown(p)
      }
      lastWrite.set(p, e.seq)
    } else if (e.kind === 'file_read' && e.path && e.modelFile && e.content !== undefined && !e.isError) {
      resync(e.path, e.content, e.seq, e.source === 'numbered')
    } else if (e.kind === 'server_write' && e.touches) {
      touch(e.touches, e.seq)
    } else if (e.kind === 'shell' && typeof e.text === 'string') {
      const targets = shellModelWrites(e.text, e.cwdRel ?? '', modelDirs(), options.projectRoot ?? null)
      if (targets.length) {
        e.writesModel = true
        e.touches = targets
        // A refused call never ran: it is an attempt on record, and changes no file.
        if (!e.denied) touch(targets, e.seq)
      }
    }

    if (e.kind === 'assistant') pendingTurnEnd.set(e.actor, { after: e.seq, files: summary() })
    if (e.kind === 'user' || e.kind === 'answer') {
      const pending = pendingTurnEnd.get(e.actor)
      if (e.kind === 'user' && pending) checkpoint(pending.after, 'turn_end', e.actor, pending.files)
      pendingTurnEnd.delete(e.actor)
      checkpoint(e.seq, e.kind, e.actor)
    } else if (e.kind === 'ask' || e.kind === 'compaction') checkpoint(e.seq, e.kind, e.actor)
  }
  // The main session's last turn ends with the transcript.
  const last = pendingTurnEnd.get('main')
  if (last) checkpoint(last.after, 'turn_end', 'main', last.files)
  if (options.end) {
    const endSeq = events.length
    for (const p of [...new Set([...files.keys(), ...options.end.keys()])].sort()) {
      const text = options.end.get(p)
      if (text !== undefined) resync(p, text, endSeq, false)
      else if (stateOf(p).state !== 'absent') settleAbsent(p, endSeq)
    }
  }
  // In the order of the events they follow (a turn end is only known once the reply comes).
  out.checkpoints.sort((a, b) => a.after - b.after || a.seq - b.seq)
  out.checkpoints.forEach((c, i) => (c.seq = i))
  return out
}
