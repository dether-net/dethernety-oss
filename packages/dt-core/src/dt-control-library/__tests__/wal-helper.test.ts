/**
 * Crash-injection tests for the WAL helper.
 *
 * Each test simulates a crash at one of the four points described in
 * CONTROL_LIBRARY.md §7 "Crash recovery" by manually injecting partial
 * filesystem state, then asserting that `applyPendingRewrites` converges
 * to the same final state as a non-crashed run.
 *
 * DoD requires all four scenarios pass.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  appendOperation,
  applyPendingRewrites,
  atomicWriteWithFsync,
  getJournalPath,
  readJournal,
  replaceIdInFile,
  inspectPendingRewrite,
  clearPendingRewrite,
  type GreenfieldIdRewriteOp,
  type CloneAndSwapOp,
} from '../wal-helper.js';

const TEMP_ID = 'greenfield-abc123';
const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';

let modelDir: string;

beforeEach(async () => {
  modelDir = await fs.mkdtemp(join(os.tmpdir(), 'wal-test-'));
});

afterEach(async () => {
  await fs.rm(modelDir, { recursive: true, force: true });
});

async function setupGreenfieldFixture(): Promise<{
  op: GreenfieldIdRewriteOp;
  structureContent: string;
  dataflowsContent: string;
  controlFileContent: string;
}> {
  const structureContent = JSON.stringify({
    components: [{ id: 'c1', controls: [{ id: TEMP_ID, name: 'Foo', source: 'declared' }] }],
  });
  const dataflowsContent = JSON.stringify({
    flows: [{ id: 'f1', controls: [{ id: TEMP_ID, name: 'Foo', source: 'declared' }] }],
  });
  const controlFileContent = JSON.stringify({
    id: TEMP_ID,
    name: 'Foo',
    source: 'declared',
    lifecycle: 'greenfield',
    classes: [],
  });
  await fs.writeFile(join(modelDir, 'structure.json'), structureContent);
  await fs.writeFile(join(modelDir, 'dataflows.json'), dataflowsContent);
  await fs.mkdir(join(modelDir, 'controls'), { recursive: true });
  await fs.writeFile(join(modelDir, `controls/${TEMP_ID}.json`), controlFileContent);

  const op: GreenfieldIdRewriteOp = {
    kind: 'greenfield-id-rewrite',
    tempId: TEMP_ID,
    serverId: SERVER_ID,
    filePaths: ['structure.json', 'dataflows.json', `controls/${TEMP_ID}.json`],
    controlFileRename: {
      from: `controls/${TEMP_ID}.json`,
      to: `controls/${SERVER_ID}.json`,
    },
    createdAt: '2026-04-18T12:00:00Z',
  };
  return { op, structureContent, dataflowsContent, controlFileContent };
}

async function assertFinalState(): Promise<void> {
  // After successful replay, all references must use serverId, the control
  // file must be at its server-id name, and the journal must be deleted.
  const struct = await fs.readFile(join(modelDir, 'structure.json'), 'utf-8');
  const flows = await fs.readFile(join(modelDir, 'dataflows.json'), 'utf-8');
  expect(struct).not.toContain(TEMP_ID);
  expect(struct).toContain(SERVER_ID);
  expect(flows).not.toContain(TEMP_ID);
  expect(flows).toContain(SERVER_ID);

  const serverFile = await fs.readFile(
    join(modelDir, `controls/${SERVER_ID}.json`),
    'utf-8',
  );
  expect(serverFile).toContain(SERVER_ID);

  await expect(
    fs.access(join(modelDir, `controls/${TEMP_ID}.json`)),
  ).rejects.toThrow();
  await expect(fs.access(getJournalPath(modelDir))).rejects.toThrow();
}

describe('WAL helper — basic operations', () => {
  it('atomicWriteWithFsync creates a file with exact content', async () => {
    const target = join(modelDir, 'subdir', 'file.txt');
    await atomicWriteWithFsync(target, 'hello world');
    expect(await fs.readFile(target, 'utf-8')).toBe('hello world');
  });

  it('replaceIdInFile is idempotent — already-replaced file is a no-op', async () => {
    const target = join(modelDir, 'a.json');
    await fs.writeFile(target, JSON.stringify({ id: SERVER_ID }));
    await replaceIdInFile(target, TEMP_ID, SERVER_ID);
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe(JSON.stringify({ id: SERVER_ID }));
  });

  it('replaceIdInFile silently ignores missing files', async () => {
    await expect(
      replaceIdInFile(join(modelDir, 'does-not-exist.json'), TEMP_ID, SERVER_ID),
    ).resolves.toBeUndefined();
  });

  it('readJournal returns null when no journal exists', async () => {
    expect(await readJournal(modelDir)).toBeNull();
  });

  it('appendOperation creates a journal and a second call appends to it', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    const op2 = { ...op, tempId: 'greenfield-second', serverId: 'second-uuid' };
    await appendOperation(modelDir, op2);
    const journal = await readJournal(modelDir);
    expect(journal?.operations).toHaveLength(2);
    expect(journal?.operations[1]).toMatchObject({ tempId: 'greenfield-second' });
  });

  it('applyPendingRewrites returns 0 when no journal exists', async () => {
    expect(await applyPendingRewrites(modelDir)).toBe(0);
  });
});

describe('WAL helper — happy-path replay (no crash)', () => {
  it('end-to-end: append, apply, journal cleared', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    const replayed = await applyPendingRewrites(modelDir);
    expect(replayed).toBe(1);
    await assertFinalState();
  });
});

describe('WAL helper — crash-injection scenarios (DoD)', () => {
  it('Scenario 1: crash BEFORE any file rewritten — replay rewrites all', async () => {
    // Setup: write the journal, but no files have been touched yet.
    // This is the state right after appendOperation() returns and before
    // applyPendingRewrites() is invoked.
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);

    // Sanity: structure.json still contains tempId (no rewrite has happened).
    const preStruct = await fs.readFile(join(modelDir, 'structure.json'), 'utf-8');
    expect(preStruct).toContain(TEMP_ID);

    // Replay must drive the system to the final state.
    await applyPendingRewrites(modelDir);
    await assertFinalState();
  });

  it('Scenario 2: crash MID-rewrite — some files rewritten, some not', async () => {
    // Setup: journal present; structure.json already partially rewritten
    // (contains serverId), dataflows.json still has tempId.
    const { op, dataflowsContent } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);

    // Inject partial state: structure.json rewritten by a previous (crashed)
    // attempt; dataflows.json untouched.
    const structAfter = JSON.stringify({
      components: [
        { id: 'c1', controls: [{ id: SERVER_ID, name: 'Foo', source: 'declared' }] },
      ],
    });
    await fs.writeFile(join(modelDir, 'structure.json'), structAfter);
    // dataflows.json left as the fixture wrote it (still has TEMP_ID)
    expect(dataflowsContent).toContain(TEMP_ID);
    // controls/<tempId>.json content already rewritten by the crashed attempt
    const controlContentAfter = JSON.stringify({
      id: SERVER_ID,
      name: 'Foo',
      source: 'declared',
      lifecycle: 'greenfield',
      classes: [],
    });
    await fs.writeFile(join(modelDir, `controls/${TEMP_ID}.json`), controlContentAfter);

    // Replay: must skip already-rewritten files, finish dataflows.json,
    // then perform the rename.
    await applyPendingRewrites(modelDir);
    await assertFinalState();
  });

  it('Scenario 3: crash AFTER rewrite, BEFORE file rename — replay performs rename', async () => {
    // Setup: journal present; all content rewrites complete; control file
    // still at tempId path (rename hasn't happened yet).
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);

    // Apply all content rewrites by hand (simulating successful first 3 steps).
    for (const p of op.filePaths) {
      await replaceIdInFile(join(modelDir, p), op.tempId, op.serverId);
    }
    // Sanity: tempId file present at old name (rename not done).
    await expect(
      fs.access(join(modelDir, `controls/${TEMP_ID}.json`)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(join(modelDir, `controls/${SERVER_ID}.json`)),
    ).rejects.toThrow();

    // Replay: must perform the rename and then delete the journal.
    await applyPendingRewrites(modelDir);
    await assertFinalState();
  });

  it('Scenario 4: crash AFTER rename, BEFORE journal delete — replay is no-op + clears journal', async () => {
    // Setup: journal present; all rewrites done; control file already at
    // serverId path. Only the journal-delete step remains.
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);

    // Apply all rewrites by hand.
    for (const p of op.filePaths) {
      await replaceIdInFile(join(modelDir, p), op.tempId, op.serverId);
    }
    // Perform the rename by hand (file at SERVER_ID name; old name gone).
    await fs.rename(
      join(modelDir, `controls/${TEMP_ID}.json`),
      join(modelDir, `controls/${SERVER_ID}.json`),
    );

    // Sanity: final state already in place except journal.
    await expect(fs.access(getJournalPath(modelDir))).resolves.toBeUndefined();

    // Replay: every per-operation step is a no-op (content checks find
    // no tempId; file rename detects from-absent → skip), then journal unlink.
    await applyPendingRewrites(modelDir);
    await assertFinalState();
  });

  it('Scenario 5 (defensive): ambiguous state (both tempId and serverId files present) → throws', async () => {
    // Setup mirrors the macOS overlay-FS caveat: rename "succeeded" but
    // the source wasn't actually unlinked, leaving both files visible.
    // Replay must refuse rather than guess.
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);

    // Apply content rewrites and CREATE the destination file without
    // removing the source — the ambiguous state.
    for (const p of op.filePaths) {
      await replaceIdInFile(join(modelDir, p), op.tempId, op.serverId);
    }
    await fs.copyFile(
      join(modelDir, `controls/${TEMP_ID}.json`),
      join(modelDir, `controls/${SERVER_ID}.json`),
    );

    await expect(applyPendingRewrites(modelDir)).rejects.toThrow(/ambiguous state/);
  });
});

describe('WAL helper — clone-and-swap operation', () => {
  it('end-to-end: rewrites references, creates new file, deletes old', async () => {
    const oldId = '11111111-1111-1111-1111-111111111111';
    const newId = '22222222-2222-2222-2222-222222222222';
    const oldFileContent = JSON.stringify({ id: oldId, name: 'Original' });
    const newFileContent = JSON.stringify({ id: newId, name: 'Cloned' });

    await fs.writeFile(
      join(modelDir, 'structure.json'),
      JSON.stringify({ components: [{ controls: [{ id: oldId }] }] }),
    );
    await fs.mkdir(join(modelDir, 'controls'), { recursive: true });
    await fs.writeFile(join(modelDir, `controls/${oldId}.json`), oldFileContent);

    const op: CloneAndSwapOp = {
      kind: 'clone-and-swap',
      oldId,
      newId,
      filePaths: ['structure.json'],
      controlFileWrite: `controls/${newId}.json`,
      controlFileContent: newFileContent,
      controlFileDelete: `controls/${oldId}.json`,
      createdAt: '2026-04-18T12:00:00Z',
    };
    await appendOperation(modelDir, op);
    await applyPendingRewrites(modelDir);

    const struct = await fs.readFile(join(modelDir, 'structure.json'), 'utf-8');
    expect(struct).toContain(newId);
    expect(struct).not.toContain(oldId);
    expect(
      await fs.readFile(join(modelDir, `controls/${newId}.json`), 'utf-8'),
    ).toBe(newFileContent);
    await expect(
      fs.access(join(modelDir, `controls/${oldId}.json`)),
    ).rejects.toThrow();
    await expect(fs.access(getJournalPath(modelDir))).rejects.toThrow();
  });

  it('clone-and-swap replay is idempotent if all steps already applied', async () => {
    const oldId = 'aaaaaaaa-1111-1111-1111-111111111111';
    const newId = 'bbbbbbbb-2222-2222-2222-222222222222';
    await fs.writeFile(
      join(modelDir, 'structure.json'),
      JSON.stringify({ controls: [{ id: newId }] }),
    );
    await fs.mkdir(join(modelDir, 'controls'), { recursive: true });
    await fs.writeFile(
      join(modelDir, `controls/${newId}.json`),
      JSON.stringify({ id: newId }),
    );

    const op: CloneAndSwapOp = {
      kind: 'clone-and-swap',
      oldId,
      newId,
      filePaths: ['structure.json'],
      controlFileWrite: `controls/${newId}.json`,
      controlFileContent: JSON.stringify({ id: newId }),
      controlFileDelete: `controls/${oldId}.json`,
      createdAt: '2026-04-18T12:00:00Z',
    };
    await appendOperation(modelDir, op);
    await expect(applyPendingRewrites(modelDir)).resolves.toBe(1);
  });
});

describe('WAL helper — concurrent / repeated replay convergence', () => {
  it('replay → replay produces same final state', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    await applyPendingRewrites(modelDir);
    // Second replay finds no journal — no-op.
    expect(await applyPendingRewrites(modelDir)).toBe(0);
    await assertFinalState();
  });

  it('two operations in one journal: greenfield then clone-and-swap', async () => {
    const { op: gop } = await setupGreenfieldFixture();
    const cloneOldId = SERVER_ID; // The just-rewritten id
    const cloneNewId = '33333333-3333-3333-3333-333333333333';
    await appendOperation(modelDir, gop);
    await appendOperation(modelDir, {
      kind: 'clone-and-swap',
      oldId: cloneOldId,
      newId: cloneNewId,
      filePaths: ['structure.json', 'dataflows.json'],
      controlFileWrite: `controls/${cloneNewId}.json`,
      controlFileContent: JSON.stringify({ id: cloneNewId, name: 'Cloned' }),
      controlFileDelete: `controls/${cloneOldId}.json`,
      createdAt: '2026-04-18T12:00:01Z',
    });

    await applyPendingRewrites(modelDir);

    const struct = await fs.readFile(join(modelDir, 'structure.json'), 'utf-8');
    expect(struct).toContain(cloneNewId);
    expect(struct).not.toContain(cloneOldId);
    expect(struct).not.toContain(TEMP_ID);
    await expect(
      fs.access(join(modelDir, `controls/${cloneNewId}.json`)),
    ).resolves.toBeUndefined();
    await expect(fs.access(getJournalPath(modelDir))).rejects.toThrow();
  });
});

describe('WAL helper — inspect + clear (repair-wal verb)', () => {
  it('inspectPendingRewrite returns present:false when no journal', async () => {
    const inspection = await inspectPendingRewrite(modelDir);
    expect(inspection.present).toBe(false);
    expect(inspection.operations).toEqual([]);
  });

  it('inspectPendingRewrite reports unambiguous greenfield state', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    // From file present, to file absent (rename not yet performed) — clean
    // recovery state.
    const inspection = await inspectPendingRewrite(modelDir);
    expect(inspection.present).toBe(true);
    expect(inspection.operations).toHaveLength(1);
    const greenOp = inspection.operations[0];
    expect(greenOp.kind).toBe('greenfield-id-rewrite');
    if (greenOp.kind !== 'greenfield-id-rewrite') throw new Error('type-narrow');
    expect(greenOp.fromExists).toBe(true);
    expect(greenOp.toExists).toBe(false);
    expect(greenOp.ambiguous).toBe(false);
    expect(greenOp.filePaths.find(f => f.path === 'structure.json')?.containsTempId).toBe(true);
    expect(greenOp.filePaths.find(f => f.path === 'structure.json')?.containsServerId).toBe(false);
  });

  it('inspectPendingRewrite flags ambiguous state when both rename targets exist', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    // Manually create the destination file too to simulate a partial replay
    // (the from-file should have been removed but wasn't — overlay/network FS
    // case described in wal-helper.ts:34-38).
    await fs.mkdir(join(modelDir, 'controls'), { recursive: true });
    await fs.writeFile(
      join(modelDir, op.controlFileRename.to),
      JSON.stringify({ id: SERVER_ID, name: 'Foo' }),
    );
    const inspection = await inspectPendingRewrite(modelDir);
    expect(inspection.operations[0].kind).toBe('greenfield-id-rewrite');
    if (inspection.operations[0].kind !== 'greenfield-id-rewrite') throw new Error();
    expect(inspection.operations[0].ambiguous).toBe(true);
    expect(inspection.operations[0].fromExists).toBe(true);
    expect(inspection.operations[0].toExists).toBe(true);
  });

  it('clearPendingRewrite deletes the journal and returns true', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    const cleared = await clearPendingRewrite(modelDir);
    expect(cleared).toBe(true);
    await expect(fs.access(getJournalPath(modelDir))).rejects.toThrow();
  });

  it('clearPendingRewrite returns false when no journal exists', async () => {
    const cleared = await clearPendingRewrite(modelDir);
    expect(cleared).toBe(false);
  });

  it('clearPendingRewrite leaves local files untouched (operator must reconcile)', async () => {
    const { op } = await setupGreenfieldFixture();
    await appendOperation(modelDir, op);
    await clearPendingRewrite(modelDir);
    // Source files still contain TEMP_ID — operator's call to reconcile.
    const struct = await fs.readFile(join(modelDir, 'structure.json'), 'utf-8');
    expect(struct).toContain(TEMP_ID);
  });
});
