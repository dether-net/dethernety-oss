/**
 * Contract 1, pinned: the answers on fixed models (written in `__snapshots__/contract1/`) and the keys a released
 * client reads. A released Dethereal refuses an answer with any other envelope key, drops a candidate with any other
 * key (`kg` alone is optional), and keeps only the first 64 count entries; these literals are its lists.
 */
import { describe, expect, it } from 'vitest';
import { contractOneAnswer, SNAPSHOT_MODELS } from './contract1-models';

const RELEASED_ANSWER_KEYS = ['contract', 'module', 'version', 'table_hash', 'regime', 'candidates', 'counts'];
const RELEASED_CANDIDATE_KEYS = ['id', 'kind', 'class', 'source', 'target', 'technique_ids', 'cited_techniques', 'exposure_ids', 'rows', 'tier', 'defaults', 'fields', 'facts', 'totals'];
const RELEASED_COUNTS_READ = 64;
/** The counts the module sent when 0.7.0 shipped (camelCase and boolean ones among them, which it never kept). */
const RELEASED_COUNT_KEYS = [
  'elementsWithoutClass', 'elementsWithSeveralClasses', 'boundariesWithSeveralParents', 'boundaryDepthCut', 'flowsWithSeveralEnds', 'exposuresOnSeveralElements', 'danglingReferences', 'attributeKeysDropped',
  'exposures_read', 'exposures_feeding', 'exposures_without_row', 'hidden_edge_anchors_skipped', 'anchors_without_segment', 'anchors_without_host', 'containers_without_host', 'landings_without_segment',
  'flows_not_credential_bearing', 'items_not_credential', 'pairs_over_anchor_budget', 'excluded_external_pair', 'excluded_declared_flow', 'excluded_reached_type', 'excluded_by_breaker', 'excluded_by_decision',
  'peers_capped', 'kind_budget_dropped', 'kg_classes_capped', 'boundaries', 'components', 'flows', 'dataItems', 'exposures', 'controls',
];

describe('the contract-1 answer on fixed models', () => {
  for (const entry of SNAPSHOT_MODELS) {
    it(`${entry.name}: unchanged`, async () => {
      const { answer } = await contractOneAnswer(entry);
      await expect(`${JSON.stringify(answer, null, 1)}\n`).toMatchFileSnapshot(`__snapshots__/contract1/${entry.name}.json`);
    });
  }

  it('carries exactly the keys a released client reads, and counts it keeps', async () => {
    for (const entry of SNAPSHOT_MODELS) {
      const { answer } = await contractOneAnswer(entry);
      expect(Object.keys(answer)).toEqual(RELEASED_ANSWER_KEYS);
      for (const c of answer.candidates) {
        const extra = Object.keys(c).filter((k) => !RELEASED_CANDIDATE_KEYS.includes(k));
        expect(extra.every((k) => k === 'kg'), `${entry.name} ${c.id}: ${extra.join(',')}`).toBe(true);
        expect(RELEASED_CANDIDATE_KEYS.every((k) => k in c)).toBe(true);
      }
      expect(Object.keys(answer.counts).length).toBeLessThanOrEqual(RELEASED_COUNTS_READ);
      // a released client keeps a count only under this name pattern, with an integer value: a new count must match it
      for (const [k, v] of Object.entries(answer.counts)) {
        if (RELEASED_COUNT_KEYS.includes(k)) continue;
        expect(k, `${entry.name}: count ${k}`).toMatch(/^[a-z_]{1,64}$/);
        expect(Number.isInteger(v), `${entry.name}: count ${k}`).toBe(true);
      }
    }
  });

  it('reaches what the fixtures are for: a key of more than three parts, one past fifty findings, a lowered one', async () => {
    const all = await Promise.all(SNAPSHOT_MODELS.map(contractOneAnswer));
    const candidates = all.flatMap((a) => a.answer.candidates);
    expect(candidates.some((c) => c.totals.exposure_ids > 50)).toBe(true);
    expect(candidates.some((c) => c.kg === 'lowered')).toBe(true);
    expect(candidates.some((c) => c.tier === 'low')).toBe(true);
    expect(new Set(candidates.map((c) => c.kind)).size).toBe(4);
  });
});
