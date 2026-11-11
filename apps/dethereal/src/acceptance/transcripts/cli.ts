/**
 * Parse one run's transcripts and print the result as JSON.
 *
 *   tsx src/acceptance/transcripts/cli.ts <claude|codex|opencode> <transcripts dir>
 *     [--project-root <dir>] [--start <dir>] [--summary] [--no-bodies]
 *
 * --summary prints counts only; --no-bodies drops texts, tool inputs and file contents.
 */
import { parseRun, type Harness, type ParsedRun } from './index.js'

function summary(run: ParsedRun) {
  const kinds: Record<string, number> = {}
  for (const e of run.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
  return {
    harness: run.harness,
    events: run.events.length,
    kinds,
    attributions: run.attributions.length,
    opaque: run.opaque.length,
    checkpoints: run.checkpoints.length,
    replayNotes: run.replayNotes.length,
    crossCheck: run.reconciliation.crossCheck,
    unobserved: run.reconciliation.unobserved.length,
    untracked: run.reconciliation.untracked.length,
  }
}

function withoutBodies(run: ParsedRun): ParsedRun {
  return {
    ...run,
    events: run.events.map(({ text, input, content, before, fileOp, expectedPatch, ...rest }) => ({
      ...rest,
      ...(fileOp ? { fileOp: fileOp.op === 'move' ? fileOp : ({ op: fileOp.op } as never) } : {}),
    })),
  }
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const [harness, input] = args
if (!harness || !input || !['claude', 'codex', 'opencode'].includes(harness)) {
  console.error('usage: cli.ts <claude|codex|opencode> <transcripts dir> [--project-root <dir>] [--start <dir>] [--summary] [--no-bodies]')
  process.exit(2)
}
const run = parseRun(harness as Harness, input, { projectRoot: flag('--project-root'), start: flag('--start') })
const out = args.includes('--summary') ? summary(run) : args.includes('--no-bodies') ? withoutBodies(run) : run
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
