/**
 * Contract-1 time and heap on a model near the call's pair budget, run only when asked (`HE_PERF=1`):
 *
 *   HE_PERF=1 pnpm exec vitest run __tests__/perf.test.ts
 *
 * `HE_SRC` names another copy of `src/` to measure (an earlier version, for a comparison); it defaults to this one.
 * It appends one JSON line to `HE_PERF_OUT` (a file outside the repository). Heap figures need `--expose-gc`
 * (`NODE_OPTIONS=--expose-gc`); without it they are null.
 */
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { model } from './model-builder';

const SRC = process.env.HE_SRC ? path.resolve(process.env.HE_SRC) : path.resolve(__dirname, '..', 'src');
const load = (rel: string): Promise<any> => import(path.join(SRC, rel));
const FLAT = 'Lateral movement on a flat tier';

/** A flat segment of 1,100 processes with 180 flat-tier findings: 180 anchors, each cut at its pair budget. */
export function largeModel() {
  const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
  for (let i = 0; i < 1_100; i++) b.component(`c${String(i).padStart(4, '0')}`, 'Application Service', 'PROCESS', 'SEG', {}, i % 97 === 0);
  for (let i = 0; i < 180; i++) b.exposure(`x${String(i).padStart(3, '0')}`, 'SEG', FLAT, ['T1021'], i % 3 === 0 ? 'pending' : 'confirmed');
  return b;
}

const gc = (globalThis as { gc?: () => void }).gc;

/** Measures the longest the event loop waits for a turn, from now until the returned function is called. */
function blockProbe(): () => number {
  let last = performance.now();
  let longest = 0;
  let on = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (on) setImmediate(tick);
  };
  setImmediate(tick);
  return () => {
    on = false;
    return Math.max(longest, performance.now() - last);
  };
}
const heap = () => {
  gc?.();
  return process.memoryUsage().heapUsed;
};

describe.skipIf(!process.env.HE_PERF)('contract-1 cost on a large model', () => {
  it('measures', async () => {
    const { foldModel } = await load('fold.ts');
    const { validateTable } = await load('table.ts');
    const { boundCandidates, matchCandidates, orderCandidates } = await load('generate.ts');
    const { absentFacts, applyKg } = await load('kg.ts');
    const tableJson = process.env.HE_SRC ? (await import(path.join(SRC, 'edge-kinds.json'))).default : shipped;
    const table = validateTable(tableJson);
    const rows = (largeModel() as any).rows;
    const runs: number[] = [];
    let heapDelta: number | null = null;
    let answer = '';
    let counts: Record<string, number> = {};
    // the last call's results, held so the heap after collection is what the call keeps alive
    let held: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      held = [];
      const before = gc ? heap() : 0;
      const started = performance.now();
      const m = foldModel(rows);
      const matched = await matchCandidates(m, table, { include_pending: true });
      const chosen = boundCandidates(matched.candidates, m, matched.counts);
      const candidates = orderCandidates(applyKg(m, table, chosen, matched.anchors, absentFacts('unavailable')), m);
      answer = JSON.stringify({ candidates, counts: matched.counts });
      runs.push(performance.now() - started);
      held = [m, matched, chosen, candidates];
      if (gc && i === 2) heapDelta = heap() - before;
      counts = matched.counts;
    }
    const warm = runs.slice(1);
    appendFileSync(
      process.env.HE_PERF_OUT ?? '/dev/stderr',
      `${JSON.stringify({
        src: SRC,
        ms_warm: Math.round(Math.min(...warm)),
        ms_runs: runs.map(Math.round),
        heap_kb: heapDelta === null ? null : Math.round(heapDelta / 1024),
        chars: answer.length,
        anchors_cut: counts.pairs_over_anchor_budget,
        peers_capped: counts.peers_capped,
        held: held.length,
        contract2: await contractTwo(),
        recheck200: await recheckTwoHundred(),
      })}\n`,
    );

    /** A recheck of 200 edges on the same model, where the measured copy has it. */
    async function recheckTwoHundred() {
      const { recheckWalk } = await load('generate.ts');
      if (!recheckWalk) return null;
      const entries = Array.from({ length: 200 }, (_, i) => ({ kind: 'remote-service', source: `c${String(i).padStart(4, '0')}`, target: `c${String(i + 600).padStart(4, '0')}`, exposure_ids: ['x000'] }));
      const started = performance.now();
      const { parts } = await recheckWalk(foldModel(rows), table, entries);
      return { ms: Math.round(performance.now() - started), edges_found: parts.size };
    }

    /** Contract 2 on the same model, where the measured copy has it: the walk, then the explanation and the answer. */
    async function contractTwo() {
      let answerOf: any;
      let readKindClasses: any;
      try {
        ({ answerOf } = await load('answer.ts'));
        ({ readKindClasses } = await load('classes.ts'));
      } catch {
        return null;
      }
      const classes = readKindClasses(path.resolve(__dirname, '..', 'data'));
      const times: number[] = [];
      let text = '';
      let trimmed = 0;
      let skipped = 0;
      let remedies = 0;
      let heldKb: number | null = null;
      let answerMs = 0;
      let answerBlockMs = 0;
      for (let i = 0; i < 2; i++) {
        const before = gc ? heap() : 0;
        const started = performance.now();
        const m = foldModel(rows);
        const matched = await matchCandidates(m, table, { include_pending: true, explain: true });
        const chosen = orderCandidates(boundCandidates(matched.candidates, m, matched.counts), m);
        const answerStarted = performance.now();
        const stop = blockProbe();
        const a = await answerOf({ contract: 2, model: m, table, tableHash: 'h', classes, matched, candidates: chosen, regime: { kg: 'kg_absent', reason: 'unavailable' }, classesCapped: 0 });
        answerBlockMs = stop();
        answerMs = performance.now() - answerStarted;
        text = JSON.stringify(a);
        trimmed = a.limits.explain_trimmed;
        skipped = a.limits.remedies_skipped ?? 0;
        remedies = a.candidates.reduce((n: number, c: any) => n + (c.explain.remedies?.length ?? 0), 0);
        times.push(performance.now() - started);
        // what the call keeps alive while the answer is built: the walk's parts, those past the cap and the topology
        if (gc && i === 1) heldKb = Math.round((heap() - before) / 1024);
        held = [m, matched, a];
      }
      // the explanation and the answer alone, and the longest the event loop waited for a turn while they were built
      return { ms_warm: Math.round(times[1]), answer_ms: Math.round(answerMs), answer_block_ms: Math.round(answerBlockMs), heap_kb: heldKb, chars: text.length, explain_trimmed: trimmed, remedies_skipped: skipped, remedies: remedies };
    }
  }, 600_000);
});
