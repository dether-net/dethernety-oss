/**
 * A directory swapped for a link while a write is in progress: the write checks
 * the directories again right before its rename, so it aborts instead of
 * renaming into the link's target.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

const swap = vi.hoisted(() => ({ run: null as null | (() => void) }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // After the tmp file is created, run the swap once (as another process would).
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[1] === 'wx' && swap.run) {
        const run = swap.run;
        swap.run = null;
        run();
      }
      return handle;
    },
  };
});

import { atomicWriteWithFsync } from '../wal-helper.js';

let tmp: string;

beforeEach(() => {
  tmp = nodeFs.realpathSync(nodeFs.mkdtempSync(join(os.tmpdir(), 'wal-swap-')));
  nodeFs.mkdirSync(join(tmp, 'model', 'controls'), { recursive: true });
  nodeFs.mkdirSync(join(tmp, 'outside'));
});

afterEach(() => {
  swap.run = null;
  nodeFs.rmSync(tmp, { recursive: true, force: true });
});

describe('directory swapped during a write', () => {
  it('aborts before the rename when controls/ became a link', async () => {
    const model = join(tmp, 'model');
    swap.run = () => {
      nodeFs.renameSync(join(model, 'controls'), join(tmp, 'moved-away'));
      nodeFs.symlinkSync(join(tmp, 'outside'), join(model, 'controls'));
    };
    await expect(atomicWriteWithFsync(join(model, 'controls', 'x.json'), '{"x":1}', model)).rejects.toMatchObject({
      name: 'UnsafePathError',
    });
    expect(nodeFs.readdirSync(join(tmp, 'outside'))).toEqual([]);
  });

  it('writes normally when nothing moves', async () => {
    const model = join(tmp, 'model');
    await atomicWriteWithFsync(join(model, 'controls', 'x.json'), '{"x":1}', model);
    expect(nodeFs.readFileSync(join(model, 'controls', 'x.json'), 'utf-8')).toBe('{"x":1}');
    expect(nodeFs.readdirSync(join(model, 'controls'))).toEqual(['x.json']);
  });
});
