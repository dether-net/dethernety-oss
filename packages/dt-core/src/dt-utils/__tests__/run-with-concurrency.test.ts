import { describe, it, expect } from 'vitest';
import { DtUtils } from '../dt-utils.js';

describe('DtUtils.runWithConcurrency', () => {
  const task = (log: string[], name: string, ms: number) => async () => {
    log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`end ${name}`);
  };

  it('does nothing for no tasks', async () => {
    await expect(DtUtils.runWithConcurrency([], 4)).resolves.toBeUndefined();
  });

  it('runs every task when the limit exceeds the task count', async () => {
    const log: string[] = [];
    await DtUtils.runWithConcurrency([task(log, 'a', 1), task(log, 'b', 1)], 4);
    expect(log.filter((l) => l.startsWith('end')).sort()).toEqual(['end a', 'end b']);
  });

  it('starts tasks in order and starts the next only when a lane frees up', async () => {
    const log: string[] = [];
    await DtUtils.runWithConcurrency([task(log, 'a', 20), task(log, 'b', 5), task(log, 'c', 5)], 2);
    expect(log.filter((l) => l.startsWith('start'))).toEqual(['start a', 'start b', 'start c']);
    expect(log.indexOf('start c')).toBeGreaterThan(log.indexOf('end b'));
  });

  it('treats a limit below one as one', async () => {
    const log: string[] = [];
    await DtUtils.runWithConcurrency([task(log, 'a', 2), task(log, 'b', 2)], 0);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
