/**
 * Crash/recovery correctness at the control-library seams.
 *
 *  - Greenfield: id-as-resume (a crash after createControl + WAL id-rewrite but
 *    before the lifecycle flip must NOT re-create the platform Control).
 *  - Brownfield: idempotent retry (a crash after a class's platform mutation but
 *    before pendingEdit is cleared must NOT flag a phantom conflict).
 *  - Reverted audit is buffered and flushed only on a persisting path (no
 *    duplicate lines across a crash-then-retry).
 *  - pullControls carries over a pendingEdit whose platform binding vanished.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { DtControlLibrary, type BrownfieldDecision } from '../dt-control-library.js';
import { writeControlFile, readControlFile } from '../file-io.js';
import { getAuditLogPath } from '../audit-log-writer.js';
import type { ControlFile } from '../../schemas/control-file.schema.js';

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';
const CLASS_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const CLASS_B = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

let modelDir: string;
let lib: DtControlLibrary;

// Access the Apollo-bound dtControl seam for stubbing.
const dtControl = (l: DtControlLibrary) =>
  (l as unknown as { dtControl: Record<string, (...a: any[]) => any> }).dtControl;

beforeEach(async () => {
  modelDir = await fs.mkdtemp(join(os.tmpdir(), 's9-test-'));
  lib = new DtControlLibrary({} as unknown as ConstructorParameters<typeof DtControlLibrary>[0]);
});

afterEach(async () => {
  await fs.rm(modelDir, { recursive: true, force: true });
});

describe('pushGreenfieldControl — id-as-resume (P1)', () => {
  it('does NOT re-create when a greenfield file already carries a server id (crash-before-flip)', async () => {
    // The resume state: lifecycle still 'greenfield' but id is a server UUID —
    // the create + WAL id-rewrite completed, we crashed before the flip.
    const file: ControlFile = {
      id: SERVER_ID,
      name: 'Resumed Control',
      source: 'declared',
      lifecycle: 'greenfield',
      classes: [
        // Already-pushed class so Step B skips (pushedAt >= localEditedAt).
        { classId: CLASS_A, attributes: { a: 1 }, localEditedAt: '2026-01-01T00:00:00Z', pushedAt: '2026-01-02T00:00:00Z' },
      ],
    };
    const createSpy = vi.fn();
    dtControl(lib).createControl = createSpy;
    dtControl(lib).setInstantiationAttributes = vi.fn().mockResolvedValue({ success: true });

    const result = await lib.pushGreenfieldControl({
      modelDir, file, supportingElementIds: [], folderId: undefined, liveAssignedModelIds: [],
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(result.lifecycle).not.toBe('greenfield'); // flipped forward
  });

  it('DOES create when the id is still a greenfield temp id', async () => {
    const tempId = 'greenfield-abc123';
    // The WAL id-rewrite touches structure.json + dataflows.json + the control
    // file. Seed them so applyPendingRewrites completes.
    await fs.mkdir(join(modelDir, 'controls'), { recursive: true });
    await fs.writeFile(join(modelDir, 'structure.json'), JSON.stringify({ ref: tempId }));
    await fs.writeFile(join(modelDir, 'dataflows.json'), JSON.stringify({ ref: tempId }));
    const file: ControlFile = {
      id: tempId,
      name: 'Fresh Control',
      source: 'declared',
      lifecycle: 'greenfield',
      classes: [{ classId: CLASS_A, attributes: { a: 1 }, localEditedAt: '2026-01-01T00:00:00Z' }],
    };
    const createSpy = vi.fn().mockResolvedValue({ id: SERVER_ID });
    dtControl(lib).createControl = createSpy;
    dtControl(lib).setInstantiationAttributes = vi.fn().mockResolvedValue({ success: true });

    await lib.pushGreenfieldControl({
      modelDir, file, supportingElementIds: [], folderId: undefined, liveAssignedModelIds: [],
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    // The WAL rewrite renamed the control file to the server id.
    expect(await readControlFile(modelDir, SERVER_ID)).toBeTruthy();
  });
});

// --- Brownfield helpers ---------------------------------------------------

const brownfield = (classes: ControlFile['classes']): ControlFile => ({
  id: SERVER_ID,
  name: 'BF Control',
  source: 'declared',
  lifecycle: 'brownfield',
  classes,
  platformState: { lastSyncedAt: '2026-04-18T12:00:00Z', assignedModelIds: ['model-this'] },
});

const decision: BrownfieldDecision = { sharedOwnership: 'push-anyway' };

describe('pushBrownfieldControl — idempotent retry / already-applied (P1)', () => {
  it('does NOT flag a phantom conflict when the server already holds our intended value', async () => {
    // pendingEdit: we intended foo: 'new' (pre-edit 'old'). A prior push landed
    // it; we crashed before clearing pendingEdit. Step B now re-fetches 'new'.
    const file = brownfield([
      {
        classId: CLASS_A,
        attributes: { foo: 'new' },
        platformAttributes: { foo: 'old' },
        localEditedAt: '2026-01-02T00:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { foo: 'old' } },
      },
    ]);
    // Step B inline re-fetch returns the already-pushed value.
    dtControl(lib).getControlInstantiationAttributes = vi
      .fn()
      .mockResolvedValue([{ controlId: SERVER_ID, classId: CLASS_A, attributes: { foo: 'new' } }]);
    const setSpy = vi.fn().mockResolvedValue({ success: true });
    dtControl(lib).setInstantiationAttributes = setSpy;

    const result = await lib.pushBrownfieldControl({
      modelDir, file, decision, freshPlatformAttrs: new Map(), liveAssignedModelIds: ['model-this'], thisModelId: 'model-this',
    });

    expect(setSpy).not.toHaveBeenCalled(); // nothing re-pushed
    expect(result.mutated).toBe(false);
    expect(result.file.classes[0].pendingEdit).toBeUndefined(); // finalized, not wedged
    expect(result.file.classes[0].pushedAt).toBeTruthy();
  });

  it('still flags a genuine conflict (server moved to a third value)', async () => {
    const file = brownfield([
      {
        classId: CLASS_A,
        attributes: { foo: 'mine' },
        platformAttributes: { foo: 'old' },
        localEditedAt: '2026-01-02T00:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { foo: 'old' } },
      },
    ]);
    dtControl(lib).getControlInstantiationAttributes = vi
      .fn()
      .mockResolvedValue([{ controlId: SERVER_ID, classId: CLASS_A, attributes: { foo: 'theirs' } }]);
    const setSpy = vi.fn().mockResolvedValue({ success: true });
    dtControl(lib).setInstantiationAttributes = setSpy;

    const result = await lib.pushBrownfieldControl({
      modelDir, file, decision, freshPlatformAttrs: new Map(), liveAssignedModelIds: ['model-this'], thisModelId: 'model-this',
    });

    // Undecided conflict cancels the row: no push, pendingEdit preserved.
    expect(setSpy).not.toHaveBeenCalled();
    expect(result.mutated).toBe(false);
    expect(result.file.classes[0].pendingEdit).toBeTruthy();
  });
});

describe('pushBrownfieldControl — reverted audit is flushed once, on persist (P2)', () => {
  it('a revert-then-crash writes no audit; the retry writes exactly one reverted entry', async () => {
    // class A reverts (typed back to previous). class B is a real push that
    // fails on the first attempt (crash) and succeeds on retry.
    const makeFile = () =>
      brownfield([
        {
          classId: CLASS_A,
          attributes: { foo: 'orig' },
          platformAttributes: { foo: 'orig' },
          localEditedAt: '2026-01-02T00:00:00Z',
          pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { foo: 'orig' } },
        },
        {
          classId: CLASS_B,
          attributes: { bar: 'new' },
          platformAttributes: { bar: 'old' },
          localEditedAt: '2026-01-02T00:00:00Z',
          pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { bar: 'old' } },
        },
      ]);

    // Step B re-fetch returns the pre-push platform state (bar still 'old').
    dtControl(lib).getControlInstantiationAttributes = vi
      .fn()
      .mockResolvedValue([
        { controlId: SERVER_ID, classId: CLASS_A, attributes: { foo: 'orig' } },
        { controlId: SERVER_ID, classId: CLASS_B, attributes: { bar: 'old' } },
      ]);
    // class B push: fail first (crash), succeed on retry.
    dtControl(lib).setInstantiationAttributes = vi
      .fn()
      .mockResolvedValueOnce({ success: false, errorMessage: 'boom' })
      .mockResolvedValue({ success: true });

    const args = {
      modelDir, decision, freshPlatformAttrs: new Map(), liveAssignedModelIds: ['model-this'], thisModelId: 'model-this',
    };

    // First attempt throws (class B push failed) — nothing persisted, no audit.
    await expect(lib.pushBrownfieldControl({ ...args, file: makeFile() })).rejects.toThrow();
    const auditPath = getAuditLogPath(modelDir);
    const firstLog = await fs.readFile(auditPath, 'utf-8').catch(() => '');
    expect(firstLog).toBe(''); // buffered, never flushed

    // Retry succeeds — persists + flushes.
    const result = await lib.pushBrownfieldControl({ ...args, file: makeFile() });
    expect(result.mutated).toBe(true);

    const log = await fs.readFile(auditPath, 'utf-8');
    const revertedLines = log.split('\n').filter(l => l.includes('"kind":"reverted"'));
    expect(revertedLines).toHaveLength(1); // exactly one, not duplicated
  });

  it('flushes a buffered reverted entry when Step D empties resolvedPlans (persisting path)', async () => {
    // class A reverts (buffers audit + clears its pendingEdit); class B conflicts
    // and the operator accepts-theirs → Step D drops B's only key → resolvedPlans
    // empties → the persist-and-return path must still flush A's reverted audit.
    const file = brownfield([
      {
        classId: CLASS_A,
        attributes: { foo: 'orig' },
        platformAttributes: { foo: 'orig' },
        localEditedAt: '2026-01-02T00:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { foo: 'orig' } },
      },
      {
        classId: CLASS_B,
        attributes: { bar: 'mine' },
        platformAttributes: { bar: 'old' },
        localEditedAt: '2026-01-02T00:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { bar: 'old' } },
      },
    ]);
    // Step B re-fetch: class B's server value moved to a third value → conflict.
    dtControl(lib).getControlInstantiationAttributes = vi
      .fn()
      .mockResolvedValue([
        { controlId: SERVER_ID, classId: CLASS_A, attributes: { foo: 'orig' } },
        { controlId: SERVER_ID, classId: CLASS_B, attributes: { bar: 'theirs' } },
      ]);
    dtControl(lib).setInstantiationAttributes = vi.fn().mockResolvedValue({ success: true });

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway', perKey: { '1.bar': { chosen: 'accept-theirs' } } },
      freshPlatformAttrs: new Map(),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });

    expect(result.mutated).toBe(false); // nothing pushed (B accepted-theirs)
    const log = await fs.readFile(getAuditLogPath(modelDir), 'utf-8');
    expect(log.split('\n').filter(l => l.includes('"kind":"reverted"'))).toHaveLength(1);
  });
});

describe('pullControls — carries over a pendingEdit whose platform binding vanished (P2)', () => {
  it('preserves a local class with an unpushed edit that is no longer on the platform', async () => {
    // Seed a local file: class A is still bound platform-side, class B has a
    // local pendingEdit but its IS_INSTANCE_OF edge was removed platform-side.
    await writeControlFile(modelDir, brownfield([
      { classId: CLASS_A, attributes: { a: 1 }, platformAttributes: { a: 1 } },
      {
        classId: CLASS_B,
        attributes: { b: 'edited' },
        platformAttributes: { b: 'orig' },
        localEditedAt: '2026-01-02T00:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-01-02T00:00:00Z', previousAttributes: { b: 'orig' } },
      },
    ]));

    // Platform now returns the control with ONLY class A (B's edge gone).
    dtControl(lib).getControlsByIds = vi
      .fn()
      .mockResolvedValue([{ id: SERVER_ID, name: 'BF Control', controlClasses: [{ id: CLASS_A, name: 'A' }] }]);
    dtControl(lib).getControlInstantiationAttributes = vi
      .fn()
      .mockResolvedValue([{ controlId: SERVER_ID, classId: CLASS_A, attributes: { a: 1 } }]);
    dtControl(lib).getControlsAssignedModels = vi.fn().mockResolvedValue(new Map([[SERVER_ID, ['model-this']]]));

    const composed = await lib.pullControls({ modelDir, controlIds: [SERVER_ID] });

    const rebuilt = composed[0];
    const carried = rebuilt.classes.find(c => c.classId === CLASS_B);
    expect(carried).toBeTruthy();
    expect(carried!.pendingEdit).toBeTruthy(); // the unpushed edit survived
    expect(carried!.platformAttributes).toBeUndefined(); // drift signal: no live binding
    // class A still present and rebuilt from the platform.
    expect(rebuilt.classes.find(c => c.classId === CLASS_A)).toBeTruthy();
  });
});
