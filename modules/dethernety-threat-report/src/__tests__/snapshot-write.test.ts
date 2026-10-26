/**
 * The report snapshot write, pinned on its statement through a fake session whose executeWrite
 * retries a transient error (by its code, as the driver does) and commits a transaction's
 * statements only when it succeeds.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Session } from 'neo4j-driver';
import { writeThreatReportSnapshot } from '../snapshot-write';

const transient = Object.assign(new Error('Cannot resolve conflicting transactions'), {
  code: 'Memgraph.TransientError.MemgraphError.MemgraphError',
});

/** The first `conflicts` statements meet a transient error. `committed` holds the statements that
 *  landed, `direct` those run outside a transaction. */
function fakeSession(conflicts = 0, found = true) {
  const committed: string[] = [];
  const direct: string[] = [];
  let left = conflicts;
  let attempts = 0;
  const records = found ? [{ get: () => 'a1' }] : [];
  const session = {
    run: vi.fn(async (q: string) => (direct.push(q), { records })),
    executeWrite: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      for (;;) {
        attempts++;
        const pending: string[] = [];
        const tx = {
          run: async (q: string) => {
            if (left-- > 0) throw transient;
            pending.push(q);
            return { records };
          },
        };
        try {
          const value = await work(tx);
          committed.push(...pending);
          return value;
        } catch (e) {
          if (!String((e as { code?: string }).code).includes('TransientError') || attempts >= 3) throw e;
        }
      }
    }),
  };
  return { session: session as unknown as Session, committed, direct, attempts: () => attempts };
}

const WRITE = { analysisId: 'a1', doc: '{"generated":true}', generatedAt: 'iso', fingerprint: 'sha256:x' };

describe('writeThreatReportSnapshot', () => {
  it('writes the doc in one write transaction, never as an auto-commit', async () => {
    const { session, committed, direct } = fakeSession();
    await expect(writeThreatReportSnapshot(session, WRITE)).resolves.toBe(true);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toContain('SET a.threatReportDoc = $doc');
    expect(direct).toEqual([]);
  });

  // A second run of the same analysis.
  it('a transient conflict is retried by the driver, and the write lands once', async () => {
    const { session, committed, attempts } = fakeSession(2);
    await expect(writeThreatReportSnapshot(session, WRITE)).resolves.toBe(true);
    expect(attempts()).toBe(3);
    expect(committed).toHaveLength(1);
  });

  it('a conflict the driver stops retrying fails the write, and no attempt left a write', async () => {
    const { session, committed } = fakeSession(Infinity);
    await expect(writeThreatReportSnapshot(session, WRITE)).rejects.toThrow(/conflicting transactions/);
    expect(committed).toEqual([]);
  });

  it('answers false when the Analysis node is missing', async () => {
    const { session } = fakeSession(0, false);
    await expect(writeThreatReportSnapshot(session, WRITE)).resolves.toBe(false);
  });
});
