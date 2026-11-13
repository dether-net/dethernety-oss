/**
 * The analysis status a listing reads: always idle, hasDocument from the stored snapshot, and the snapshot's
 * generation time as updatedAt. Pinned through a fake driver whose session answers the one lookup.
 */

import { describe, it, expect, vi } from 'vitest';
import DethernetyThreatReportModule from '../DethernetyThreatReportModule';

const logger = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

function moduleAnswering(row: Record<string, unknown> | null | Error) {
  const close = vi.fn(async () => undefined);
  const run = vi.fn(async () => {
    if (row instanceof Error) throw row;
    return { records: row ? [{ get: (key: string) => row[key] }] : [] };
  });
  const driver = { session: vi.fn(() => ({ run, close })) };
  return { mod: new DethernetyThreatReportModule(driver, logger), run, close };
}

describe('getAnalysisStatus', () => {
  it('reports a stored report: hasDocument, and updatedAt from its generation time', async () => {
    const { mod, run, close } = moduleAnswering({ hasDoc: true, generatedAt: '2026-11-13T09:30:00.000Z' });
    const status = await mod.getAnalysisStatus('a1');
    expect(status).toMatchObject({
      createdAt: '',
      updatedAt: '2026-11-13T09:30:00.000Z',
      status: 'idle',
      hasDocument: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('a.threatReportGeneratedAt AS generatedAt');
    expect(close).toHaveBeenCalled();
  });

  it("reads '' and no document before a report exists", async () => {
    const { mod } = moduleAnswering({ hasDoc: false, generatedAt: null });
    expect(await mod.getAnalysisStatus('a1')).toMatchObject({ updatedAt: '', hasDocument: false, status: 'idle' });
  });

  it("reads '' and no document for an analysis the lookup does not find", async () => {
    const { mod } = moduleAnswering(null);
    expect(await mod.getAnalysisStatus('a1')).toMatchObject({ updatedAt: '', hasDocument: false, status: 'idle' });
  });

  it('stays idle on a failed lookup, never the error fallback', async () => {
    const { mod, close } = moduleAnswering(new Error('connection refused'));
    expect(await mod.getAnalysisStatus('a1')).toMatchObject({ updatedAt: '', hasDocument: false, status: 'idle' });
    expect(close).toHaveBeenCalled();
  });
});
