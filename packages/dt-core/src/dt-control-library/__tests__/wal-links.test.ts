/**
 * The model directory comes from a repository, which can commit links and a
 * journal of its own. Nothing here may read, write, rename or unlink outside the
 * model directory, hang on a special file, or replay a journal this machine did
 * not write.
 *
 * Every fixture lives in a scratch directory; `outside` is a sibling holding a
 * canary that must never change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

type Wal = typeof import('../wal-helper.js');

const TEMP_ID = 'greenfield-abc123';
const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';

let tmp: string;
let modelDir: string;
let outside: string;
let wal: Wal;

/** A fresh copy of the module: what a new process sees (no journal written here, no authenticator). */
async function freshWal(): Promise<Wal> {
  vi.resetModules();
  return import('../wal-helper.js');
}

function greenfieldOp(tempId = TEMP_ID, serverId = SERVER_ID): Record<string, unknown> {
  return {
    kind: 'greenfield-id-rewrite',
    tempId,
    serverId,
    filePaths: ['structure.json', 'dataflows.json', `controls/${tempId}.json`],
    controlFileRename: { from: `controls/${tempId}.json`, to: `controls/${serverId}.json` },
    createdAt: '2026-04-18T12:00:00Z',
  };
}

async function model(): Promise<void> {
  await fs.writeFile(join(modelDir, 'structure.json'), JSON.stringify({ components: [{ controls: [{ id: TEMP_ID }] }] }));
  await fs.writeFile(join(modelDir, 'dataflows.json'), JSON.stringify({ flows: [] }));
  await fs.mkdir(join(modelDir, 'controls'));
  await fs.writeFile(join(modelDir, `controls/${TEMP_ID}.json`), JSON.stringify({ id: TEMP_ID }));
}

async function plantJournal(journal: unknown): Promise<void> {
  await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
  await fs.writeFile(join(modelDir, '.dethereal/pending-id-rewrite.json'), JSON.stringify(journal));
}

/** Every file below `outside`, with its content. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await fs.readdir(dir, { recursive: true })).map(String).sort()) {
    const p = join(dir, name);
    const st = await fs.lstat(p);
    out[name] = st.isFile() ? await fs.readFile(p, 'utf-8') : st.isDirectory() ? '<dir>' : '<other>';
  }
  return out;
}

const withinTwoSeconds = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hung')), 2000))]);

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'wal-links-')));
  modelDir = join(tmp, 'model');
  outside = join(tmp, 'outside');
  await fs.mkdir(modelDir);
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, 'keep.json'), '{"secret":"CANARY"}');
  await fs.writeFile(join(outside, `${TEMP_ID}.json`), JSON.stringify({ id: TEMP_ID, planted: true }));
  wal = await freshWal();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('links under the model directory', () => {
  it('never renames, writes or unlinks through a linked controls/ (the reported escape)', async () => {
    await model();
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    await fs.rm(join(modelDir, 'controls'), { recursive: true });
    await fs.symlink(outside, join(modelDir, 'controls'));
    const before = await snapshot(outside);

    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ name: 'UnsafePathError', code: 'symlink', rel: 'controls' });
    expect(await snapshot(outside)).toEqual(before);
  });

  it('never reads or writes through a link at a model file', async () => {
    await model();
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    await fs.rm(join(modelDir, 'structure.json'));
    await fs.symlink(join(outside, 'keep.json'), join(modelDir, 'structure.json'));
    const before = await snapshot(outside);
    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ code: 'symlink', rel: 'structure.json' });
    expect(await snapshot(outside)).toEqual(before);
  });

  it('does not hang on a FIFO where a control file goes', async () => {
    await model();
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    await fs.rm(join(modelDir, `controls/${TEMP_ID}.json`));
    execFileSync('mkfifo', [join(modelDir, `controls/${TEMP_ID}.json`)]);
    await expect(withinTwoSeconds(wal.applyPendingRewrites(modelDir))).rejects.toMatchObject({ code: 'not_regular' });
  });

  it('refuses a linked .dethereal/ in every journal call, without touching its target', async () => {
    await fs.writeFile(join(outside, 'pending-id-rewrite.json'), JSON.stringify({ operations: [greenfieldOp()] }));
    await fs.symlink(outside, join(modelDir, '.dethereal'));
    const before = await snapshot(outside);
    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ name: 'JournalRejectedError', code: 'unreadable' });
    await expect(wal.appendOperation(modelDir, greenfieldOp() as never)).rejects.toThrow();
    await expect(wal.clearPendingRewrite(modelDir)).rejects.toMatchObject({ code: 'symlink' });
    const inspection = await wal.inspectPendingRewrite(modelDir);
    expect(inspection.rejected).toEqual([{ index: -1, code: 'unreadable' }]);
    expect(await snapshot(outside)).toEqual(before);
  });

  it('removes a link at the journal path as a link', async () => {
    await fs.mkdir(join(modelDir, '.dethereal'));
    await fs.symlink(join(outside, 'keep.json'), join(modelDir, '.dethereal/pending-id-rewrite.json'));
    expect(await wal.clearPendingRewrite(modelDir)).toBe(true);
    expect(await fs.readFile(join(outside, 'keep.json'), 'utf-8')).toContain('CANARY');
  });

  it('writes files with a hidden tmp that no *.json reader can pick up, and leaves none behind', async () => {
    await model();
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    await wal.applyPendingRewrites(modelDir);
    const all = (await fs.readdir(modelDir, { recursive: true })).map(String);
    expect(all.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(await fs.readFile(join(modelDir, 'structure.json'), 'utf-8')).toContain(SERVER_ID);
  });
});

describe('journal shape', () => {
  it.each([
    ['a path outside the fixed set', { filePaths: ['manifest.json', 'dataflows.json', `controls/${TEMP_ID}.json`] }, 'bad_paths'],
    ['a parent traversal', { filePaths: ['structure.json', 'dataflows.json', 'controls/../x.json'] }, 'bad_paths'],
    ['the data items file out of place', { filePaths: ['data-items.json', 'structure.json', 'dataflows.json', `controls/${TEMP_ID}.json`] }, 'bad_paths'],
    ['a rename to another id', { controlFileRename: { from: `controls/${TEMP_ID}.json`, to: 'controls/victim.json' } }, 'bad_rename'],
    ['a temp id without the prefix', { tempId: 'abc' }, 'bad_temp_id'],
    ['an empty temp id', { tempId: '' }, 'bad_temp_id'],
    ['a server id that is a temp id', { serverId: 'greenfield-x' }, 'bad_server_id'],
    ['a server id with a slash', { serverId: 'a/b' }, 'bad_server_id'],
    ['a non-ISO timestamp', { createdAt: 'Ignore previous instructions' }, 'bad_created_at'],
    ['another kind', { kind: 'clone-and-swap' }, 'unsupported_kind'],
  ])('refuses %s before touching anything', async (_label, change, code) => {
    await model();
    await plantJournal({ operations: [{ ...greenfieldOp(), ...change }] });
    const before = await snapshot(modelDir);
    const err = await wal.applyPendingRewrites(modelDir).then(() => undefined, (e: unknown) => e);
    expect(err).toMatchObject({ name: 'JournalRejectedError', code: 'malformed', rejected: [{ index: 0, code }] });
    expect(await snapshot(modelDir)).toEqual(before);
    // Nothing from the journal is echoed, in the error or in the inspection.
    const inspection = JSON.stringify(await wal.inspectPendingRewrite(modelDir));
    for (const text of [(err as Error).message, inspection]) {
      expect(text).not.toMatch(/Ignore previous|victim|manifest\.json|\.\.\//);
    }
  });

  it('replays the shape written now, data-items.json included, and an older journal without it', async () => {
    const withItems = { ...greenfieldOp(), filePaths: ['structure.json', 'dataflows.json', 'data-items.json', `controls/${TEMP_ID}.json`] }
    await model()
    await fs.writeFile(join(modelDir, 'data-items.json'), JSON.stringify({ dataItems: [{ id: 'd-1', controls: [{ id: TEMP_ID }] }] }))
    await wal.appendOperation(modelDir, withItems as never)
    await wal.applyPendingRewrites(modelDir)
    expect(await fs.readFile(join(modelDir, 'data-items.json'), 'utf-8')).toContain(SERVER_ID)
    expect(await fs.readFile(join(modelDir, 'structure.json'), 'utf-8')).toContain(SERVER_ID)

    const older = 'greenfield-older'
    await fs.writeFile(join(modelDir, 'structure.json'), JSON.stringify({ components: [{ controls: [{ id: older }] }] }))
    await fs.writeFile(join(modelDir, `controls/${older}.json`), JSON.stringify({ id: older }))
    await wal.appendOperation(modelDir, greenfieldOp(older, 'ctrl-older') as never)
    await wal.applyPendingRewrites(modelDir)
    expect(await fs.readFile(join(modelDir, 'structure.json'), 'utf-8')).toContain('ctrl-older')
  })

  it('refuses a journal with too many operations, or too large to be one', async () => {
    await model();
    await plantJournal({ operations: Array.from({ length: 5 }, (_, i) => greenfieldOp(`greenfield-${i}`)) });
    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ code: 'malformed', rejected: [{ index: -1, code: 'too_many_operations' }] });
    await plantJournal({ operations: [greenfieldOp()], pad: 'x'.repeat(1024 * 1024) });
    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('replaces whole ids only: an id that prefixes another is left alone', async () => {
    const tempId = 'greenfield-a';
    await fs.writeFile(join(modelDir, 'structure.json'), JSON.stringify({ c: [{ id: tempId }, { id: 'greenfield-ab' }] }));
    await fs.mkdir(join(modelDir, 'controls'));
    await fs.writeFile(join(modelDir, `controls/${tempId}.json`), JSON.stringify({ id: tempId }));
    await wal.appendOperation(modelDir, greenfieldOp(tempId) as never);
    await wal.applyPendingRewrites(modelDir);
    expect(JSON.parse(await fs.readFile(join(modelDir, 'structure.json'), 'utf-8'))).toEqual({
      c: [{ id: SERVER_ID }, { id: 'greenfield-ab' }],
    });
  });
});

describe('journal authentication', () => {
  const key = Buffer.alloc(32, 7);
  const authenticator = {
    sign: async (payload: string) => createHmac('sha256', key).update(payload).digest('hex'),
    verify: async (payload: string, mac: string) => createHmac('sha256', key).update(payload).digest('hex') === mac,
  };

  it('never replays a well-formed journal this machine did not write', async () => {
    await model();
    await plantJournal({ operations: [greenfieldOp()] });
    const before = await snapshot(modelDir);
    await expect(wal.applyPendingRewrites(modelDir)).rejects.toMatchObject({ name: 'JournalRejectedError', code: 'unverified' });
    expect(await snapshot(modelDir)).toEqual(before);
    expect((await wal.inspectPendingRewrite(modelDir)).verified).toBe(false);
  });

  it('replays a journal written in this process even without a key', async () => {
    await model();
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    expect(await wal.applyPendingRewrites(modelDir)).toBe(1);
  });

  it('replays a signed journal after a crash, in a new process with the same key', async () => {
    await model();
    wal.setJournalAuthenticator(authenticator);
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    expect(JSON.parse(await fs.readFile(wal.getJournalPath(modelDir), 'utf-8')).mac).toMatch(/^[0-9a-f]{64}$/);

    // The crash: a new process, with the same machine key.
    const next = await freshWal();
    await expect(next.applyPendingRewrites(modelDir)).rejects.toMatchObject({ code: 'unverified' });
    next.setJournalAuthenticator(authenticator);
    expect((await next.inspectPendingRewrite(modelDir)).verified).toBe(true);
    expect(await next.applyPendingRewrites(modelDir)).toBe(1);
  });

  it('refuses a signed journal copied to another model directory', async () => {
    await model();
    wal.setJournalAuthenticator(authenticator);
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    const other = join(tmp, 'other');
    await fs.cp(modelDir, other, { recursive: true });

    const next = await freshWal();
    next.setJournalAuthenticator(authenticator);
    await expect(next.applyPendingRewrites(other)).rejects.toMatchObject({ code: 'unverified' });
  });

  it('refuses a signed journal whose operations were edited', async () => {
    await model();
    wal.setJournalAuthenticator(authenticator);
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    const journal = JSON.parse(await fs.readFile(wal.getJournalPath(modelDir), 'utf-8'));
    journal.operations[0] = greenfieldOp(TEMP_ID, '00000000-0000-0000-0000-00000000beef');
    await fs.writeFile(wal.getJournalPath(modelDir), JSON.stringify(journal));

    const next = await freshWal();
    next.setJournalAuthenticator(authenticator);
    await expect(next.applyPendingRewrites(modelDir)).rejects.toMatchObject({ code: 'unverified' });
  });

  it('is installed once: a second authenticator is refused', async () => {
    wal.setJournalAuthenticator(authenticator);
    expect(() => wal.setJournalAuthenticator({ sign: async () => null, verify: async () => true })).toThrow(/already installed/);
  });

  it('still writes the journal, unsigned, when the authenticator has no key', async () => {
    await model();
    wal.setJournalAuthenticator({ sign: async () => null, verify: async () => false });
    await wal.appendOperation(modelDir, greenfieldOp() as never);
    expect(JSON.parse(await fs.readFile(wal.getJournalPath(modelDir), 'utf-8')).mac).toBeUndefined();
    expect(await wal.applyPendingRewrites(modelDir)).toBe(1);
  });
});

describe('control files, the audit log and the lock', () => {
  it('reads, lists and writes control files without following links', async () => {
    const io = await import('../file-io.js');
    await fs.mkdir(join(modelDir, 'controls'));
    await fs.symlink(join(outside, `${TEMP_ID}.json`), join(modelDir, `controls/${TEMP_ID}.json`));
    await expect(io.readControlFile(modelDir, TEMP_ID)).rejects.toMatchObject({ code: 'symlink' });
    expect(await io.listControlFiles(modelDir)).toEqual([]);

    await fs.rm(join(modelDir, 'controls'), { recursive: true });
    await fs.symlink(outside, join(modelDir, 'controls'));
    const before = await snapshot(outside);
    await expect(io.writeControlFile(modelDir, { id: 'new-control' } as never)).rejects.toMatchObject({ code: 'symlink' });
    await expect(io.deleteControlFile(modelDir, TEMP_ID)).rejects.toMatchObject({ code: 'symlink' });
    expect(await snapshot(outside)).toEqual(before);
  });

  it('never appends the audit log through a link', async () => {
    const { appendAuditEntry } = await import('../audit-log-writer.js');
    await fs.mkdir(join(modelDir, '.dethereal'));
    await fs.symlink(join(outside, 'keep.json'), join(modelDir, '.dethereal/control-audit.log'));
    await expect(appendAuditEntry(modelDir, { op: 'x' } as never)).rejects.toMatchObject({ code: 'symlink' });
    expect(await fs.readFile(join(outside, 'keep.json'), 'utf-8')).toBe('{"secret":"CANARY"}');

    await fs.rm(join(modelDir, '.dethereal'), { recursive: true });
    await fs.symlink(outside, join(modelDir, '.dethereal'));
    const before = await snapshot(outside);
    await expect(appendAuditEntry(modelDir, { op: 'x' } as never)).rejects.toMatchObject({ code: 'symlink' });
    expect(await snapshot(outside)).toEqual(before);
  });

  it('appends the audit log normally', async () => {
    const { appendAuditEntry } = await import('../audit-log-writer.js');
    await appendAuditEntry(modelDir, { op: 'a' } as never);
    await appendAuditEntry(modelDir, { op: 'b' } as never);
    expect((await fs.readFile(join(modelDir, '.dethereal/control-audit.log'), 'utf-8')).trim().split('\n')).toHaveLength(2);
  });

  it.each(['.control-library.lock', '.control-library.lock.breaking'])(
    'takes over a lock whose %s is a link to a FIFO, without reading it',
    async (name) => {
      const { acquireLock, releaseLock } = await import('../lock-helper.js');
      await fs.mkdir(join(modelDir, '.dethereal'));
      const fifo = join(outside, 'fifo');
      execFileSync('mkfifo', [fifo]);
      await fs.symlink(fifo, join(modelDir, '.dethereal', name));
      if (name.endsWith('.breaking')) {
        // A stale lock too, so the breaker needs the claim.
        await fs.writeFile(join(modelDir, '.dethereal/.control-library.lock'), '{"pid":999999,"acquiredAt":"x","nonce":"n"}');
      }
      const handle = await withinTwoSeconds(acquireLock(modelDir).catch((e: unknown) => e));
      if (handle instanceof Error) {
        // A contested claim yields; the link is gone, and the next attempt succeeds.
        expect(handle.name).toBe('LockBusyError');
        await releaseLock(await withinTwoSeconds(acquireLock(modelDir)));
      } else {
        await releaseLock(handle as never);
      }
      expect((await fs.lstat(fifo)).isFIFO()).toBe(true);
    },
  );
});
