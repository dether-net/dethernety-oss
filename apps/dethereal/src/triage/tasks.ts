/**
 * The remediation task list: checked for the claims remediation copy may not make, then written once into the run's
 * scratch directory, both in one call, so no unchecked list can stand at its path as if it were the checked one.
 *
 * A line that quotes a class guide's own text whole is the guide's words, not the model's, and is set aside before
 * the check: a guide field this server read itself, for a class of this model, at least QUOTE_MIN characters long,
 * matched as a whole line after both sides are cleaned the same way. Everything else is checked as the model's own.
 *
 * The write never replaces anything and never leaves the run's directory: each directory from the model directory
 * down to the run's is checked one level at a time, a link anywhere refuses, and nothing is created on the way. The
 * file itself is created exclusively and without following a link (on macOS, without following one anywhere in the
 * path), and checked afterwards through its own descriptor: the file at the path must be the one written, in the
 * run directory checked. A file already at the path is read only through a descriptor that follows no link.
 */
import { constants as fsConstants, type BigIntStats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { GuideEntry } from '../tools/get-class-guide.tool.js'

/** The shortest guide field a line may quote to be set aside. */
export const QUOTE_MIN = 24
/** The most characters one task list may hold. */
export const TASKS_TEXT_MAX = 65_536
/** A run's scratch directory name. */
export const RUN_NAME = /^run-(\d{4})(\d{2})(\d{2})-\d{6}$/

/** Control, format, default-ignorable, bidi and line-separator characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu

const LONE_SURROGATE = /\p{Cs}/u

/**
 * The characters no reader sees, other than a line break, and lone surrogates, by line (1-based) and code point: such
 * a character can split a word past the check. At most `max` are named.
 */
export function hiddenCharacters(text: string, max = 5): Array<{ line: number; code: string }> {
  const found: Array<{ line: number; code: string }> = []
  text.split('\n').forEach((l, i) => {
    for (const ch of l) {
      if (found.length >= max) return
      if (INVISIBLE.test(ch) || LONE_SURROGATE.test(ch)) found.push({ line: i + 1, code: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` })
    }
  })
  return found
}

/**
 * Platform text cleaned as the skill cleans it before showing it: NFC, line breaks to spaces, control, invisible
 * and bidirectional characters removed, white space collapsed, trimmed.
 */
export function cleanText(text: string): string {
  return text.normalize('NFC').replace(/\r\n|[\r\n\u2028\u2029]/g, ' ').replace(INVISIBLE_ALL, '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** The guide fields a line may quote: each step's instruction and expected output, and string typical values. */
export function quotableFields(entries: GuideEntry[]): Set<string> {
  const fields = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v !== 'string') return
    const cleaned = cleanText(v)
    if (cleaned.length >= QUOTE_MIN) fields.add(cleaned)
  }
  for (const entry of entries) {
    for (const step of entry.howToObtain) {
      add(step.instruction)
      add(step.expectedOutput)
    }
    if (Array.isArray(entry.typicalValues)) entry.typicalValues.forEach(add)
    else add(entry.typicalValues)
  }
  return fields
}

const QUOTES: Array<[string, string]> = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']]

/**
 * What a cleaned line may quote whole: the line, the line after an optional `- ` or `> ` prefix, and each of those
 * without one pair of surrounding quotes (a field may itself begin with a quote or a prefix).
 */
function quotedBodies(cleaned: string): string[] {
  const bodies = [cleaned]
  if (cleaned.startsWith('- ') || cleaned.startsWith('> ')) bodies.push(cleaned.slice(2))
  for (const body of [...bodies]) {
    for (const [open, close] of QUOTES) {
      if (body.length >= 2 && body.startsWith(open) && body.endsWith(close)) bodies.push(body.slice(1, -1))
    }
  }
  return bodies
}

/**
 * The text the check reads: every line but those that quote a field in `fields` whole, as the runs of lines between
 * the lines set aside, each checked on its own so no two lines are joined across a quote. One pass over the lines; a
 * line is set aside whole or not at all.
 */
export function withoutQuotedLines(text: string, fields: Set<string>): { checked: string[]; exempted: number } {
  const runs: string[][] = [[]]
  let exempted = 0
  for (const line of text.split('\n')) {
    if (fields.size && quotedBodies(cleanText(line)).some((b) => fields.has(b))) {
      exempted++
      runs.push([])
    } else runs[runs.length - 1]!.push(line)
  }
  return { checked: runs.filter((r) => r.length).map((r) => r.join('\n')), exempted }
}

/** The date a run's name carries, `YYYY-MM-DD`: the list, its run directory and its header agree on it. */
export function dateOfRun(run: string): string {
  const m = RUN_NAME.exec(run)
  if (!m) throw new Error(`not a run name: ${run}`)
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Why the list was not written. */
export class TasksError extends Error {
  constructor(readonly code: 'not_model_dir' | 'run_not_found' | 'not_confined' | 'tasks_exist' | 'tasks_unwritable', message: string) {
    super(message)
    this.name = 'TasksError'
  }
}

/** The run directory's path inside the model directory. */
export const runDirOf = (run: string) => path.join('.dethereal', 'triage-run', run)

/**
 * Check the run directory without creating or following anything: the model directory holds `manifest.json`, and
 * each of `.dethereal`, `triage-run` and the run's own directory exists as a directory, not a link.
 */
export async function checkRunDir(dir: string, run: string): Promise<string> {
  const manifest = await fs.lstat(path.join(dir, 'manifest.json')).catch(() => null)
  if (!manifest?.isFile()) throw new TasksError('not_model_dir', 'the directory is not a model directory (it has no manifest.json): name the model directory')
  let at = dir
  for (const part of ['.dethereal', 'triage-run', run]) {
    at = path.join(at, part)
    const stat = await fs.lstat(at).catch(() => null)
    if (!stat) throw new TasksError('run_not_found', `no run directory ${runDirOf(run)}: name the run's scratch directory, which the run created`)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TasksError('not_confined', `${path.relative(dir, at)} is a link or not a directory: the task list is written only into the run's own directory`)
  }
  return at
}

/** Test seams: the step run after the run directory's check, before the file is created; the platform the placement is confirmed for. */
export interface WriteSeams {
  beforeCreate?: (target: string) => Promise<void>
  platform?: NodeJS.Platform
}

/** macOS's O_NOFOLLOW_ANY: no link in any component of the path, the last included; the system refuses it alongside O_NOFOLLOW. */
const O_NOFOLLOW_ANY = 0x20000000
const noLinks = (platform: NodeJS.Platform) => (platform === 'darwin' ? O_NOFOLLOW_ANY : fsConstants.O_NOFOLLOW)

/**
 * Where the open file really is, from its descriptor, never from its path: on macOS the open followed no link
 * anywhere, so the path it was opened at; on Linux the kernel's own name for the descriptor. Elsewhere the place
 * cannot be confirmed, and the caller refuses.
 */
async function placeOf(handle: fs.FileHandle, opened: string, platform: NodeJS.Platform): Promise<string | null> {
  if (platform === 'darwin') return opened
  if (platform === 'linux') return fs.readlink(`/proc/self/fd/${handle.fd}`).catch(() => null)
  return null
}

/**
 * Write `text` as the run's task list, never over anything and only into the run directory checked. A file already
 * at the path holding exactly these bytes, alone (no other link to it), is the list (`existing`); any other refuses
 * with `tasks_exist`, leaving it untouched.
 */
export async function writeTaskList(dir: string, run: string, text: string, seams: WriteSeams = {}): Promise<{ path: string; existing: boolean }> {
  const platform = seams.platform ?? process.platform
  // `dir` is the model directory's real path, and the check found each level below it a directory, not a link: the
  // run directory's path as joined is where the list must be, and it is never resolved again.
  const runDir = await checkRunDir(dir, run)
  const name = `remediation-tasks-${dateOfRun(run)}.md`
  const target = path.join(runDir, name)
  const rel = path.relative(dir, target).split(path.sep).join('/')
  const unwritable = (err: unknown) =>
    new TasksError('tasks_unwritable', `the task list could not be written to ${rel} (${(err as NodeJS.ErrnoException).code ?? 'error'}); nothing is at the path from this call`)
  if (seams.beforeCreate) await seams.beforeCreate(target)
  let handle: fs.FileHandle
  try {
    handle = await fs.open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noLinks(platform), 0o600)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return existingList(target, rel, text, platform)
    if (code === 'ELOOP' || code === 'ENOTDIR') throw new TasksError('not_confined', `${rel} is reached through a link: the task list is written only into the run's own directory`)
    throw unwritable(err)
  }
  let written = false
  let mine: BigIntStats | undefined
  const misplaced = () => new TasksError('not_confined', `${runDirOf(run)} changed while the task list was written: nothing was written at ${rel}`)
  try {
    mine = await handle.stat({ bigint: true })
    // Nothing is written until the descriptor itself shows the file in the run directory checked: a directory swapped
    // for a link after the check leaves at most an empty file where it led, which is removed when it can be.
    const place = await placeOf(handle, target, platform)
    if (place === null) throw new TasksError('tasks_unwritable', `this system cannot confirm where ${rel} was created, so the task list is not written there`)
    if (place !== target) throw misplaced()
    await handle.writeFile(text, 'utf8')
    // Still the one file, alone, at its path.
    const there = await fs.lstat(target, { bigint: true }).catch(() => null)
    const now = await handle.stat({ bigint: true })
    if (!(there !== null && there.isFile() && there.dev === mine.dev && there.ino === mine.ino && now.nlink === 1n)) throw misplaced()
    written = true
    return { path: rel, existing: false }
  } catch (err) {
    if (err instanceof TasksError) throw err
    throw unwritable(err)
  } finally {
    await handle.close()
    // A failed or misplaced write leaves nothing behind: the file is removed only while it is still the one created.
    if (!written && mine) {
      const there = await fs.lstat(target, { bigint: true }).catch(() => null)
      if (there && there.ino === mine.ino && there.dev === mine.dev) await fs.unlink(target).catch(() => {})
    }
  }
}

/** A file already at the task list's path: the list when it holds exactly `text`, alone, as a plain file. */
async function existingList(target: string, rel: string, text: string, platform: NodeJS.Platform): Promise<{ path: string; existing: boolean }> {
  const refuse = () => new TasksError('tasks_exist', `a file is already at ${rel}; this call neither wrote nor checked it, and it is not the task list`)
  let fh: fs.FileHandle
  try {
    fh = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | noLinks(platform))
  } catch {
    throw refuse()
  }
  try {
    const st = await fh.stat()
    const bytes = Buffer.byteLength(text, 'utf8')
    if (!st.isFile() || st.nlink !== 1 || st.size !== bytes) throw refuse()
    const buf = Buffer.alloc(bytes + 1)
    const { bytesRead } = await fh.read(buf, 0, bytes + 1, 0)
    if (bytesRead !== bytes || !buf.subarray(0, bytes).equals(Buffer.from(text, 'utf8'))) throw refuse()
    return { path: rel, existing: true }
  } finally {
    await fh.close()
  }
}
