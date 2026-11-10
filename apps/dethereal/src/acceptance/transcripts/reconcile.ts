/**
 * The cross-check: a harness's own record of changed files against the writes
 * the replay followed. A tracked change to a model file with no write, server
 * write or writing command in its window is an unobserved write. A followed
 * write the harness did not track is reported, never failed: harness tracking
 * may lag or skip. Where a harness keeps no such record the cross-check is
 * unavailable, which is never the same as passing.
 */
import { covers } from './replay.js'
import type { CrossCheck, Harness, Reconciliation, TranscriptEvent } from './types.js'

const COVERAGE: Record<Harness, { crossCheck: CrossCheck; note: string }> = {
  claude: {
    crossCheck: 'partial',
    note: 'file history covers a file from the first time a file tool touches it; later changes to it, by any means, show at the next user message',
  },
  codex: { crossCheck: 'unavailable', note: 'the file-change items are the replay itself; there is no independent record of the worktree' },
  opencode: { crossCheck: 'available', note: "each step's patch lists every file the step changed, by any means" },
}

const coveredBy = (targets: string[] | undefined, p: string) => !!targets && targets.some((t) => covers(t, p))

/** The first seq whose time is at or after `ts` (the window start). */
function seqAtOrAfter(events: TranscriptEvent[], ts: string): number {
  const i = events.findIndex((e) => e.ts >= ts)
  return i < 0 ? events.length : events[i]!.seq
}

export function reconcile(harness: Harness, events: TranscriptEvent[]): Reconciliation {
  const tracked = events.filter((e) => e.kind === 'harness_change' && e.modelFile && e.path)
  const base = COVERAGE[harness]
  if (base.crossCheck === 'unavailable' || tracked.length === 0) {
    return {
      crossCheck: 'unavailable',
      note: base.crossCheck === 'unavailable' ? base.note : 'the transcript holds no change records',
      unobserved: [],
      untracked: [],
    }
  }
  const unobserved: Reconciliation['unobserved'] = []
  const windows: Array<{ path: string; from: number; to: number }> = []
  for (const h of tracked) {
    const fromTs = (h.source ?? '').replace(/^[a-z-]+:/, '') || h.ts
    const from = seqAtOrAfter(events, fromTs)
    const to = h.seq
    windows.push({ path: h.path!, from, to })
    const inWindow = events.filter((e) => e.seq >= from && e.seq <= to)
    const written = inWindow.some(
      (e) =>
        (e.kind === 'file_write' && !e.isError && (e.path === h.path || (e.fileOp?.op === 'move' && e.fileOp.to === h.path))) ||
        ((e.kind === 'server_write' || (e.kind === 'shell' && e.writesModel && !e.denied)) && coveredBy(e.touches, h.path!)),
    )
    if (written) continue
    const name = h.path!.split('/').pop()!
    const shellInWindow = inWindow.some((e) => e.kind === 'shell' && !e.denied && (e.writesModel || (typeof e.text === 'string' && e.text.includes(name))))
    unobserved.push({ path: h.path!, harnessEvent: h.seq, window: [from, to], shellInWindow })
  }
  const untracked: Reconciliation['untracked'] = []
  for (const e of events) {
    if (e.kind !== 'file_write' || !e.modelFile || e.isError || !e.path) continue
    const target = e.fileOp?.op === 'move' ? e.fileOp.to : e.path
    if (!windows.some((w) => (w.path === e.path || w.path === target) && e.seq >= w.from && e.seq <= w.to)) untracked.push({ path: target, event: e.seq })
  }
  return { crossCheck: base.crossCheck, note: base.note, unobserved, untracked }
}
