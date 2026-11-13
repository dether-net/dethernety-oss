/**
 * onModelDeleted against a fake transaction: what it asks, and what it reports. test/model-deleted.e2e.spec.ts runs
 * the delete itself against a real graph.
 */

import { describe, it, expect } from 'vitest';
import DethernetyThreatReportModule from '../DethernetyThreatReportModule';
import { MODULE_NAME, Q_DELETE_MODEL_ANALYSES } from '../model-deleted';

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {} } as any;

// A transaction whose one statement answers with the given row; it records what it was asked.
const txWith = (row: Record<string, unknown> | null) => {
  const asked: Array<{ query: string; params: Record<string, unknown> }> = [];
  const tx = {
    run: async (query: string, params: Record<string, unknown>) => {
      asked.push({ query, params });
      return { records: row ? [{ get: (k: string) => row[k] }] : [] };
    },
  };
  return { tx, asked };
};
// A driver Integer, as the database answers a count.
const int = (n: number) => ({ toNumber: () => n });

describe('onModelDeleted', () => {
  it("deletes this module's analyses among the model's, on the platform's transaction, and reports the counts", async () => {
    const m = new DethernetyThreatReportModule(null, quiet);
    const { tx, asked } = txWith({ nodesDeleted: int(2), relationshipsDeleted: int(4) });
    expect(await m.onModelDeleted(tx, 'm1', ['an-1', 'an-2', 'an-other'])).toEqual({ nodesDeleted: 2, relationshipsDeleted: 4 });
    expect(asked).toEqual([
      { query: Q_DELETE_MODEL_ANALYSES, params: { analysisIds: ['an-1', 'an-2', 'an-other'], module: MODULE_NAME } },
    ]);
  });

  it('asks nothing for a model that owned no analysis', async () => {
    const m = new DethernetyThreatReportModule(null, quiet);
    const { tx, asked } = txWith(null);
    expect(await m.onModelDeleted(tx, 'm1', [])).toEqual({ nodesDeleted: 0, relationshipsDeleted: 0 });
    expect(asked).toEqual([]);
  });

  it('reads plain numbers and a missing row as counts', async () => {
    const m = new DethernetyThreatReportModule(null, quiet);
    expect(await m.onModelDeleted(txWith({ nodesDeleted: 1, relationshipsDeleted: 3 }).tx, 'm1', ['an-1'])).toEqual({
      nodesDeleted: 1,
      relationshipsDeleted: 3,
    });
    expect(await m.onModelDeleted(txWith(null).tx, 'm1', ['an-1'])).toEqual({ nodesDeleted: 0, relationshipsDeleted: 0 });
  });

  it("matches only this module's classes, a retired one included", () => {
    expect(Q_DELETE_MODEL_ANALYSES).toContain('<-[:HAS_CLASS|HAS_ORPHANED_CLASS]-(:Module {name: $module})');
    expect(Q_DELETE_MODEL_ANALYSES).toContain('MATCH (a:Analysis {id: id})');
    expect(MODULE_NAME).toBe(new DethernetyThreatReportModule(null, quiet).getMetadata().name);
  });
});
