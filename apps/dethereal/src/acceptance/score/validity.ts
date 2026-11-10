/**
 * The checks that make a run INVALID before anything is scored, beyond the
 * run directory's own shape: the run must have followed the protocol, or its
 * score means nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { invocationFor, type AnswerSheet } from '../answer-sheet.js'
import { checkFacts } from './facts.js'
import { treeHash } from '../snapshot.js'
import type { ParsedRun } from '../transcripts/types.js'
import { runGit } from '../../utils/git.js'
import { matchReplies, normaliseOperatorText, operatorInputs } from './replies.js'
import { replyModeOf, type RunDir, type RunDirProblem } from './run-dir.js'

export interface ValidityInput {
  run: RunDir
  /** The whole run */
  parsed: ParsedRun
  /** With a skills tail, the walk: the opening and a full run's forced compaction are the walk's */
  walk?: ParsedRun
  /** The fixture's source/ directory, which start/ must equal */
  fixtureSource: string
  sheet: AnswerSheet
  /** Which fixture secret files git does not track in the project the run worked in (`untrackedSecretFiles`) */
  untracked?: string | null
}

/** Every protocol breach, named; empty when the run may be scored. */
export function protocolProblems({ run, parsed, walk, fixtureSource, sheet, untracked }: ValidityInput): RunDirProblem[] {
  const problems: RunDirProblem[] = []
  if (treeHash(path.join(run.dir, 'start')) !== treeHash(fixtureSource)) problems.push({ code: 'start_not_fixture', detail: 'start/ differs from the fixture source' })
  const root = parsed.projectRoot
  if (!root) problems.push({ code: 'no_project_root', detail: 'the transcript names no project root' })
  else if (path.posix.normalize(root).replace(/\/$/, '') !== path.posix.normalize(run.record.projectPath).replace(/\/$/, '')) {
    problems.push({ code: 'project_root_mismatch', detail: 'the transcript worked in another directory than run.json names' })
  }
  // A quick or baseline run opens on its own mode's invocation.
  const runMode = run.record.run_mode ?? 'full'
  const invocation = invocationFor(sheet, runMode, run.record.harness)
  const first = operatorInputs((walk ?? parsed).events).find((i) => i.kind !== 'compaction')
  if (!invocation) problems.push({ code: 'no_invocation', detail: `the answer sheet has no ${runMode === 'full' ? '' : `${runMode} `}invocation for ${run.record.harness}` })
  else if (!first || first.text !== normaliseOperatorText(invocation)) problems.push({ code: 'invocation_mismatch', detail: 'the transcript does not open on the answer sheet invocation' })
  // Only a full run is compacted on purpose: quick and baseline runs are compared on runs the kit never compacts.
  if (runMode === 'full' && !(walk ?? parsed).events.some((e) => e.kind === 'compaction' && e.actor === 'main')) problems.push({ code: 'no_compaction', detail: 'the main session holds no compaction (the forced compact is missing)' })
  // An item the parser does not know may hold a call the gates would never see: nothing is scored on such a reading.
  if (parsed.unknownTypes) {
    const types = Object.entries(parsed.unknownTypes).map(([t, n]) => `${t} ×${n}`).join(', ')
    problems.push({ code: 'unknown_item_type', detail: `the ${run.record.harness} transcript holds items the parser does not know: ${types}` })
  }
  const replies = matchReplies(parsed.events, run.replies)
  for (const m of replies.mismatches) problems.push({ code: 'reply_mismatch', detail: `${m.line ? `replies.jsonl line ${m.line}` : `transcript event ${m.event}`}: ${m.reason}` })
  // A fact the operator gave unasked, or outside its modes, is one the product was never meant to have. A baseline's
  // facts are matched by hand to another release's tables: a mismatch there is reviewed, not a breach.
  const mode = replyModeOf(run.record)
  if (mode && run.record.run_mode !== 'baseline') problems.push(...checkFacts(sheet, parsed.events, run.replies, replies.pairs, mode).unasked)
  if (!fs.existsSync(path.join(run.dir, 'project', '.git'))) problems.push({ code: 'project_not_git', detail: 'project/ is not a git repository' })
  // A run reports whether git tracks each secret file; the project it worked in must track all of them.
  if (untracked) problems.push({ code: 'secret_file_untracked', detail: untracked })
  for (const [i, r] of run.replies.entries()) {
    if (!r.prompt.startsWith('tail:')) continue
    const command = sheet.tail.find((t) => `tail:${t.id}` === r.prompt)?.commands[run.record.harness]
    if (!command) problems.push({ code: 'tail_command_mismatch', detail: `the answer sheet has no ${run.record.harness} command for ${r.prompt}` })
    else if (!commandPattern(command).test(r.text.trim())) problems.push({ code: 'tail_command_mismatch', detail: `replies.jsonl line ${i + 1}: ${r.prompt} logs another command than the answer sheet's` })
  }
  return problems
}

/**
 * Which secret files git does not track in the project a run worked in (`walk/project` with a skills tail), named;
 * null when it tracks all of them.
 */
export async function untrackedSecretFiles(run: RunDir, files: string[]): Promise<string | null> {
  if (!files.length) return null
  const rel = run.record.tail_start ? 'walk/project' : 'project'
  const r = await runGit(path.join(run.dir, rel), ['ls-files', '-z', '--', ...files])
  if (r.code !== 0) return `git could not list the tracked files of ${rel}/`
  const tracked = new Set(r.stdout.split('\0').filter(Boolean))
  const missing = files.filter((f) => !tracked.has(f))
  return missing.length ? `git does not track ${missing.join(', ')}` : null
}

/** A sheet command as a pattern: its text as written, each `<placeholder>` one word. */
function commandPattern(command: string): RegExp {
  const parts = command.trim().split(/<[^>]+>/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('\\S+')}$`)
}
