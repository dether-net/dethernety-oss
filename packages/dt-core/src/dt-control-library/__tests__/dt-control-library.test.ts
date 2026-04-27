/**
 * Unit tests for DtControlLibrary's pure-state methods.
 *
 * The four primary methods (`pullControls`, `pushGreenfieldControl`,
 * `pushBrownfieldControl`, `markTombstoned`) are exercised end-to-end via
 * the live demo1 smoke test (manual REPL — see plan file). This file
 * covers the pure helpers + state-machine pieces that don't need a live
 * Apollo client:
 *
 * - `setLocalEdited` two-write semantic (CL §4)
 * - `markTombstoned` lifecycle flip + pendingEdit preservation
 * - Brownfield Step 0 short-circuit (no platform call when nothing to push)
 * - Brownfield Step A external-edit guard
 * - Brownfield revert detection (Step C reverted audit entry)
 *
 * The platform-touching steps (Step F mutation, Step E ownership check)
 * use a mock ApolloClient stub that records calls; we exercise the
 * state-machine plumbing without needing a real GraphQL endpoint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DtControlLibrary,
  ExternalEditDetectedError,
  IllegalEditedByError,
  type BrownfieldDecision,
} from '../dt-control-library.js';
import { writeControlFile, readControlFile } from '../file-io.js';
import { getAuditLogPath } from '../audit-log-writer.js';
import type { ControlFile } from '../../schemas/control-file.schema.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_CLASS_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

let modelDir: string;
let lib: DtControlLibrary;

beforeEach(async () => {
  modelDir = await fs.mkdtemp(join(os.tmpdir(), 'dtcl-test-'));
  // Apollo client is unused for these tests; the methods we invoke don't
  // call DtControl. Cast through unknown to satisfy the constructor.
  lib = new DtControlLibrary({} as unknown as ConstructorParameters<typeof DtControlLibrary>[0]);
  // Sprint 4 Tier-2: pushBrownfieldControl Step B inline re-fetch (F-09)
  // calls getControlInstantiationAttributes via the Apollo-bound dtControl.
  // The narrowed catch only swallows network-class transient errors — the
  // test environment's TypeError ("apolloClient?.query is not a function")
  // would now bubble. Stub the spy so each test's freshPlatformAttrs map
  // remains the de-facto Step B input. Tests that need to observe the
  // inline-fetch behaviour explicitly override this with their own spy.
  vi.spyOn(
    (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } }).dtControl,
    'getControlInstantiationAttributes',
  ).mockResolvedValue([]);
});

afterEach(async () => {
  await fs.rm(modelDir, { recursive: true, force: true });
});

function brownfieldFile(overrides: Partial<ControlFile> = {}): ControlFile {
  return {
    id: VALID_UUID,
    name: 'Test Control',
    source: 'declared',
    lifecycle: 'brownfield',
    classes: [
      {
        classId: VALID_CLASS_ID,
        attributes: { foo: 'bar', baz: 1 },
        platformAttributes: { foo: 'bar', baz: 1 },
      },
    ],
    platformState: {
      lastSyncedAt: '2026-04-18T12:00:00Z',
      assignedModelIds: ['model-this'],
    },
    ...overrides,
  };
}

describe('setLocalEdited — two-write semantic (CL §4)', () => {
  it('first edit captures pre-edit value into previousAttributes', async () => {
    const file = brownfieldFile();
    const result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'new-value' },
      editedBy: 'agent',
    });
    const entry = result.classes[0];
    expect(entry.attributes.foo).toBe('new-value');
    expect(entry.attributes.baz).toBe(1); // unchanged keys preserved
    expect(entry.pendingEdit?.previousAttributes).toEqual({ foo: 'bar' });
    expect(entry.pendingEdit?.editedBy).toBe('agent');
    expect(entry.localEditedAt).toBeTruthy();
  });

  it('second edit to SAME key does NOT overwrite the original previousAttributes', async () => {
    const file = brownfieldFile();
    let result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'second-value' },
      editedBy: 'agent',
    });
    // Re-read from disk to mimic Sprint-3 sequential skill calls.
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread).toBeTruthy();
    result = await lib.setLocalEdited({
      modelDir,
      file: reread!,
      classIdx: 0,
      newAttributes: { foo: 'third-value' },
      editedBy: 'operator',
    });
    const entry = result.classes[0];
    expect(entry.attributes.foo).toBe('third-value');
    // Critical: previousAttributes still holds the FIRST pre-edit value 'bar'
    expect(entry.pendingEdit?.previousAttributes).toEqual({ foo: 'bar' });
  });

  it('second edit to a NEW key adds to previousAttributes', async () => {
    const file = brownfieldFile();
    await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'edit-1' },
      editedBy: 'agent',
    });
    const reread = await readControlFile(modelDir, VALID_UUID);
    const result = await lib.setLocalEdited({
      modelDir,
      file: reread!,
      classIdx: 0,
      newAttributes: { baz: 99 },
      editedBy: 'agent',
    });
    expect(result.classes[0].pendingEdit?.previousAttributes).toEqual({
      foo: 'bar',
      baz: 1,
    });
  });

  it('no-op when newAttributes match current attributes', async () => {
    const file = brownfieldFile();
    const result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'bar' }, // already equal
      editedBy: 'agent',
    });
    expect(result.classes[0].pendingEdit).toBeUndefined();
    // File should not have been written.
    expect(await readControlFile(modelDir, VALID_UUID)).toBeNull();
  });

  it('throws on classIdx out of range', async () => {
    const file = brownfieldFile();
    await expect(
      lib.setLocalEdited({
        modelDir,
        file,
        classIdx: 5,
        newAttributes: { foo: 'x' },
        editedBy: 'agent',
      }),
    ).rejects.toThrow(/out of range/);
  });

  it('Sprint 4 F-01 — rejects editedBy "external" (reserved for promote-external-edit)', async () => {
    // The 'external' discriminator is reserved for the promote-external-edit
    // recovery verb's MCP action. Letting any caller pass it via
    // set-local-edited would defeat the audit-log discriminator that
    // distinguishes a genuine reconciliation from a deliberate operator
    // overwrite. Engine-side guard is defence-in-depth — Zod also drops
    // 'external' from the MCP boundary's enum.
    const file = brownfieldFile();
    await expect(
      lib.setLocalEdited({
        modelDir,
        file,
        classIdx: 0,
        newAttributes: { foo: 'attempt-spoof' },
        // 'external' is in the PendingEditAuthor union (it's the legitimate
        // promoteExternalEdit author tag), so this typechecks. The engine's
        // runtime guard at setLocalEdited's entry point is what rejects it.
        editedBy: 'external',
      }),
    ).rejects.toBeInstanceOf(IllegalEditedByError);
    // File must NOT have been written (refused before persistence).
    expect(await readControlFile(modelDir, VALID_UUID)).toBeNull();
  });
});

describe('setLocalEdited — Sprint 7 first-write semantic', () => {
  // Bug-fix scenario: fresh Control just created on the platform with no
  // IS_INSTANCE_OF edge attributes. The local file was materialised via
  // pull-controls with `attributes: {}` and `platformAttributes: {}`. The
  // first set-local-edited call must record every key as first-write rather
  // than serialising `undefined` into previousAttributes (where JSON drops it).
  it('records first-write keys when entry.attributes had no prior value for them', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: {},
          platformAttributes: {},
        },
      ],
    });
    const result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { tls_version: 'TLS_1_2', weak_ciphers: false },
      editedBy: 'agent',
    });
    const entry = result.classes[0];
    expect(entry.attributes).toEqual({ tls_version: 'TLS_1_2', weak_ciphers: false });
    expect(entry.pendingEdit?.previousAttributes).toEqual({});
    expect(entry.pendingEdit?.firstWriteKeys?.sort()).toEqual(['tls_version', 'weak_ciphers'].sort());
    expect(entry.localEditedAt).toBeDefined();

    // Round-trip through disk to confirm firstWriteKeys survives JSON serialisation.
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.classes[0].pendingEdit?.firstWriteKeys?.sort()).toEqual(
      ['tls_version', 'weak_ciphers'].sort(),
    );
  });

  it('mixes first-write and prior-value keys correctly when entry.attributes has partial coverage', async () => {
    // Operator pulled a Control where the platform had set `foo` but not
    // `bar`. The next set-local-edited touches both: foo gets recorded as
    // a normal previousAttributes entry, bar as a first-write key.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'old-foo' },
          platformAttributes: { foo: 'old-foo' },
        },
      ],
    });
    const result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'new-foo', bar: 42 },
      editedBy: 'agent',
    });
    const entry = result.classes[0];
    expect(entry.attributes).toEqual({ foo: 'new-foo', bar: 42 });
    expect(entry.pendingEdit?.previousAttributes).toEqual({ foo: 'old-foo' });
    expect(entry.pendingEdit?.firstWriteKeys).toEqual(['bar']);
  });

  it('preserves first-write status across subsequent edits (two-write rule)', async () => {
    // First edit: bar is first-write (no prior value). Second edit changes
    // bar's value again — the engine must NOT promote bar to previousAttributes
    // (which would lose the first-write status and re-trigger the absent-and-
    // unknown blocked-key path on push).
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: {},
          platformAttributes: {},
        },
      ],
    });
    const after1st = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { bar: 1 },
      editedBy: 'agent',
    });
    expect(after1st.classes[0].pendingEdit?.firstWriteKeys).toEqual(['bar']);

    const after2nd = await lib.setLocalEdited({
      modelDir,
      file: after1st,
      classIdx: 0,
      newAttributes: { bar: 2 },
      editedBy: 'agent',
    });
    expect(after2nd.classes[0].attributes).toEqual({ bar: 2 });
    expect(after2nd.classes[0].pendingEdit?.previousAttributes).toEqual({});
    expect(after2nd.classes[0].pendingEdit?.firstWriteKeys).toEqual(['bar']);
  });

  it('omits firstWriteKeys field when no keys are first-write (back-compat shape)', async () => {
    // Pre-Sprint-7 file shape: pendingEdit has only previousAttributes, no
    // firstWriteKeys field on disk. Engine writes the field only when the
    // set is non-empty.
    const file = brownfieldFile();
    const result = await lib.setLocalEdited({
      modelDir,
      file,
      classIdx: 0,
      newAttributes: { foo: 'updated' },
      editedBy: 'agent',
    });
    expect(result.classes[0].pendingEdit?.previousAttributes).toEqual({ foo: 'bar' });
    expect(result.classes[0].pendingEdit?.firstWriteKeys).toBeUndefined();

    // Confirm on-disk shape too.
    const raw = await fs.readFile(
      join(modelDir, 'controls', `${VALID_UUID}.json`),
      'utf-8',
    );
    expect(raw).not.toContain('firstWriteKeys');
  });
});

describe('promoteExternalEdit — Sprint 3 recovery verb', () => {
  it('synthesises pendingEdit.previousAttributes from platformAttributes for diverging keys only', async () => {
    // Operator hand-edited the file: attributes diverge on key foo, platformAttributes is
    // the last-pulled value. Step A guard would fire on next push — promote unblocks it.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited-locally', baz: 1 },
          platformAttributes: { foo: 'on-platform', baz: 1 },
        },
      ],
    });
    const result = await lib.promoteExternalEdit({ modelDir, file, classIdx: 0 });
    const entry = result.classes[0];
    expect(entry.pendingEdit).toBeDefined();
    expect(entry.pendingEdit?.editedBy).toBe('external');
    // Only `foo` diverges, so previousAttributes contains ONLY foo —
    // not a full snapshot of platformAttributes (would push every key on next push).
    expect(entry.pendingEdit?.previousAttributes).toEqual({ foo: 'on-platform' });
    expect(entry.localEditedAt).toBeTruthy();
    // attributes is unchanged — operator's local edit is preserved.
    expect(entry.attributes).toEqual({ foo: 'edited-locally', baz: 1 });
  });

  it('persists via atomic write and survives re-read', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited-locally' },
          platformAttributes: { foo: 'on-platform' },
        },
      ],
    });
    await lib.promoteExternalEdit({ modelDir, file, classIdx: 0 });
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.classes[0].pendingEdit?.editedBy).toBe('external');
    expect(reread?.classes[0].pendingEdit?.previousAttributes).toEqual({ foo: 'on-platform' });
  });

  it('throws when there is no divergence (Step A guard would not have fired)', async () => {
    const file = brownfieldFile(); // attributes === platformAttributes
    await expect(
      lib.promoteExternalEdit({ modelDir, file, classIdx: 0 }),
    ).rejects.toThrow(/no divergence/);
  });

  it('throws on out-of-range classIdx', async () => {
    const file = brownfieldFile();
    await expect(
      lib.promoteExternalEdit({ modelDir, file, classIdx: 5 }),
    ).rejects.toThrow(/out of range/);
  });

  it('after promote, the next pushBrownfieldControl Step A guard does NOT fire', async () => {
    // Full integration of the recovery flow with the engine's Step A.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'i-want-this', baz: 1 },
          platformAttributes: { foo: 'on-platform', baz: 1 },
        },
      ],
    });
    // Pre-promote: Step A would throw.
    const preDecision: BrownfieldDecision = { sharedOwnership: 'cancel' };
    await expect(
      lib.pushBrownfieldControl({
        modelDir,
        file,
        decision: preDecision,
        freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'on-platform', baz: 1 }]]),
        liveAssignedModelIds: ['model-this'],
        thisModelId: 'model-this',
      }),
    ).rejects.toThrow(ExternalEditDetectedError);

    // Promote.
    const promoted = await lib.promoteExternalEdit({ modelDir, file, classIdx: 0 });

    // Post-promote: Step A passes, Step E hits cancel — mutated:false, but no throw.
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file: promoted,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'on-platform', baz: 1 }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(false);
    expect(result.file.classes[0].pendingEdit).toBeDefined(); // cancel does not clear
  });
});

describe('markTombstoned', () => {
  it('flips lifecycle to tombstoned, preserves pendingEdit', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    const result = await lib.markTombstoned({ modelDir, file });
    expect(result.lifecycle).toBe('tombstoned');
    expect(result.classes[0].pendingEdit).toBeDefined();
    expect(result.classes[0].pendingEdit?.previousAttributes).toEqual({ foo: 'bar' });
  });

  it('persists the file via atomic write', async () => {
    const file = brownfieldFile();
    await lib.markTombstoned({ modelDir, file });
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.lifecycle).toBe('tombstoned');
  });
});

describe('pushBrownfieldControl — Step 0 short-circuit', () => {
  it('returns mutated:false when no pendingEdit and no divergence', async () => {
    const file = brownfieldFile();
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar', baz: 1 }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(false);
    expect(result.auditEntries).toEqual([]);
  });
});

describe('pushBrownfieldControl — Step A external-edit guard', () => {
  it('throws ExternalEditDetectedError when attributes != platformAttributes WITHOUT pendingEdit', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited-externally' },
          platformAttributes: { foo: 'bar' },
        },
      ],
    });
    await expect(
      lib.pushBrownfieldControl({
        modelDir,
        file,
        decision: { sharedOwnership: 'cancel' },
        freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
        liveAssignedModelIds: ['model-this'],
        thisModelId: 'model-this',
      }),
    ).rejects.toThrow(ExternalEditDetectedError);
  });

  it('does NOT throw when divergence is recorded in pendingEdit', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    // Mock setInstantiationAttributes via the dtControl property.
    const setSpy = vi
      .spyOn((lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl, 'setInstantiationAttributes')
      .mockResolvedValue(true);
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(true);
    expect(setSpy).toHaveBeenCalledWith({
      controlId: VALID_UUID,
      classId: VALID_CLASS_ID,
      attributes: { foo: 'edited' }, // partial-payload — only the changed key
    });
  });
});

describe('pushBrownfieldControl — Step C revert detection', () => {
  it('writes reverted audit entry when operator rolled all values back', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'bar' }, // back to original
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' }, // pre-edit value matches current
          },
        },
      ],
    });
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(false);
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].kind).toBe('reverted');
    expect(result.auditEntries[0].attributesPushed).toEqual({});
    expect(result.auditEntries[0].effective).toBeNull();
    // pendingEdit cleared on disk
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.classes[0].pendingEdit).toBeUndefined();
    // Sprint 5 F-19: localEditedAt is cleared alongside pendingEdit so
    // /dethereal:status doesn't render a phantom "recently edited locally".
    expect(reread?.classes[0].localEditedAt).toBeUndefined();
    // Audit log file written
    const auditRaw = await fs.readFile(getAuditLogPath(modelDir), 'utf-8');
    expect(auditRaw).toContain('"kind":"reverted"');
  });
});

describe('pushBrownfieldControl — Step E shared-ownership', () => {
  it('cancel on shared returns mutated:false', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(false);
  });

  it('push-anyway on shared writes force-shared audit entry', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(true);
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].kind).toBe('force-shared');
    expect(result.auditEntries[0].liveAssignedModelIds).toEqual(['model-this', 'model-other']);
    // Sprint 4 F-04 — engine-level: when the caller (not the MCP entry)
    // does not supply authnOperator, the field stays undefined for
    // back-compat with Sprint-3 entries. The 'unauthenticated' sentinel
    // is set at the MCP entry layer (manage-controls.tool.ts), not here.
    expect(result.auditEntries[0].authnOperator).toBeUndefined();
  });

  it('push-unverified writes force-unverified entry with null liveAssignedModelIds', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const decision: BrownfieldDecision = {
      sharedOwnership: 'push-unverified',
      queryFailureReason: 'bolt timeout',
      queryAttempts: 3,
    };
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision,
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.auditEntries[0].kind).toBe('force-unverified');
    expect(result.auditEntries[0].liveAssignedModelIds).toBeNull();
    expect(result.auditEntries[0].queryFailureReason).toBe('bolt timeout');
    expect(result.auditEntries[0].queryAttempts).toBe(3);
  });
});

describe('pullControls — Sprint 7 firstWriteKeys preservation', () => {
  it('preserves pendingEdit.firstWriteKeys when platform state matches existing platformAttributes', async () => {
    // Pre-condition: local file has pendingEdit with firstWriteKeys.
    // Mock the three Apollo calls so platform state matches what's already on
    // disk → no drift → pullControls preserves the existing pendingEdit
    // (including firstWriteKeys) wholesale per CL Appendix A.5.
    const initial: ControlFile = {
      id: VALID_UUID,
      name: 'Test Control',
      source: 'declared',
      lifecycle: 'brownfield',
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { staged_value: 'X' },
          platformAttributes: {},
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: {},
            firstWriteKeys: ['staged_value'],
          },
        },
      ],
      platformState: {
        lastSyncedAt: '2026-04-27T10:00:00Z',
        assignedModelIds: ['model-this'],
      },
    };
    await writeControlFile(modelDir, initial);

    const dtControl = (lib as unknown as {
      dtControl: Record<string, (...args: any[]) => any>;
    }).dtControl;
    vi.spyOn(dtControl, 'getControlsByIds').mockResolvedValue([
      {
        id: VALID_UUID,
        name: 'Test Control',
        controlClasses: [{ id: VALID_CLASS_ID, name: 'Test Class' }],
      },
    ]);
    vi.spyOn(dtControl, 'getControlInstantiationAttributes').mockResolvedValue([
      { controlId: VALID_UUID, classId: VALID_CLASS_ID, attributes: {} },
    ]);
    vi.spyOn(dtControl, 'getControlsAssignedModels').mockResolvedValue(
      new Map([[VALID_UUID, ['model-this']]]),
    );

    await lib.pullControls({ modelDir, controlIds: [VALID_UUID] });

    // Re-read and assert pendingEdit.firstWriteKeys survived.
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.classes[0].pendingEdit?.firstWriteKeys).toEqual(['staged_value']);
    expect(reread?.classes[0].pendingEdit?.previousAttributes).toEqual({});
    expect(reread?.classes[0].attributes).toEqual({ staged_value: 'X' });
    expect(reread?.classes[0].platformAttributes).toEqual({});
    expect(reread?.classes[0].localEditedAt).toBe('2026-04-27T11:00:00Z');
  });
});

describe('pushBrownfieldControl — Sprint 7 first-write path', () => {
  // Bug-fix scenario: 22 fresh Controls created on the platform with empty
  // platformAttributes, set-local-edited populates `attributes` from observed
  // evidence. Previously, push-brownfield short-circuited at Step C (changedKeys
  // = Object.keys(previousAttributes) = []) and returned mutated:false.
  // After the Sprint 7 fix, first-write keys flow through Step C → Step F
  // and the platform mutation lands.

  it('pure first-write (alone Control) pushes all keys and writes a first-write audit entry', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { tls_version: 'TLS_1_2', weak_ciphers: false, key_length: 2048 },
          platformAttributes: {},
          localEditedAt: '2026-04-27T06:46:01Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T06:46:01Z',
            previousAttributes: {},
            firstWriteKeys: ['tls_version', 'weak_ciphers', 'key_length'],
          },
        },
      ],
    });
    const setSpy = vi
      .spyOn(
        (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
        'setInstantiationAttributes',
      )
      .mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, {}]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });

    expect(result.mutated).toBe(true);
    // All three first-write keys reach the platform mutation.
    expect(setSpy).toHaveBeenCalledWith({
      controlId: VALID_UUID,
      classId: VALID_CLASS_ID,
      attributes: { tls_version: 'TLS_1_2', weak_ciphers: false, key_length: 2048 },
    });
    // Audit entry: kind=first-write, previousAttributes empty, firstWriteKeys populated,
    // intendedKeys = full union, effective = 'novel'.
    expect(result.auditEntries).toHaveLength(1);
    const ae = result.auditEntries[0];
    expect(ae.kind).toBe('first-write');
    expect(ae.previousAttributes).toEqual({});
    expect(ae.firstWriteKeys?.sort()).toEqual(['key_length', 'tls_version', 'weak_ciphers']);
    expect(ae.intendedKeys.sort()).toEqual(['key_length', 'tls_version', 'weak_ciphers']);
    expect(ae.attributesPushed).toEqual({
      tls_version: 'TLS_1_2',
      weak_ciphers: false,
      key_length: 2048,
    });
    expect(ae.effective).toBe('novel');

    // Local file: pendingEdit cleared, platformAttributes populated.
    const reread = await readControlFile(modelDir, VALID_UUID);
    expect(reread?.classes[0].pendingEdit).toBeUndefined();
    expect(reread?.classes[0].platformAttributes).toEqual({
      tls_version: 'TLS_1_2',
      weak_ciphers: false,
      key_length: 2048,
    });
  });

  it('mixed first-write + brownfield-update (alone Control) pushes both, audit kind = first-write', async () => {
    // foo had a prior value (recorded in previousAttributes); bar is new.
    // Both end up in the outbound payload; audit kind defaults to first-write
    // because there's at least one first-write key in the push.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'updated', bar: 42 },
          platformAttributes: { foo: 'old' },
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: { foo: 'old' },
            firstWriteKeys: ['bar'],
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'old' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });

    expect(result.mutated).toBe(true);
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].kind).toBe('first-write');
    expect(result.auditEntries[0].firstWriteKeys).toEqual(['bar']);
    expect(result.auditEntries[0].previousAttributes).toEqual({ foo: 'old' });
    expect(result.auditEntries[0].attributesPushed).toEqual({ foo: 'updated', bar: 42 });
  });

  it('first-write on shared Control: force-shared kind wins, firstWriteKeys still recorded', async () => {
    // Sprint 7 §2 design decision: shared-ownership force is the higher-stakes
    // governance signal, so it takes precedence in the audit `kind`. The
    // first-write information is still captured as a sibling field.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { policy_id: 'p-1', enabled: true },
          platformAttributes: {},
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: {},
            firstWriteKeys: ['policy_id', 'enabled'],
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, {}]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });

    expect(result.mutated).toBe(true);
    expect(result.auditEntries).toHaveLength(1);
    const ae = result.auditEntries[0];
    expect(ae.kind).toBe('force-shared');
    expect(ae.liveAssignedModelIds).toEqual(['model-this', 'model-other']);
    expect(ae.firstWriteKeys?.sort()).toEqual(['enabled', 'policy_id']);
  });

  it('Step A external-edit guard still fires when pendingEdit is absent (first-write fix does not weaken Step A)', async () => {
    // Defensive: the schema-drift / hand-edit detection at Step A must remain
    // intact. Local attributes diverge from platformAttributes with no
    // pendingEdit recording the change → ExternalEditDetectedError.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'rogue' },
          platformAttributes: { foo: 'bar' },
          // pendingEdit deliberately absent
        },
      ],
    });
    await expect(
      lib.pushBrownfieldControl({
        modelDir,
        file,
        decision: { sharedOwnership: 'push-anyway' },
        freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
        liveAssignedModelIds: ['model-this'],
        thisModelId: 'model-this',
      }),
    ).rejects.toBeInstanceOf(ExternalEditDetectedError);
  });

  it('absent-and-unknown schema drift guard still fires for keys NOT in firstWriteKeys', async () => {
    // Defence-in-depth: if previousAttributes records a real prior value for
    // key `ghost` but the platform now has no record of it (schema drift),
    // the existing block-list path must still fire — first-write fix must not
    // accidentally relax this guard for non-first-write keys.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { ghost: 'new-ghost' },
          platformAttributes: {}, // ghost absent on platform
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: { ghost: 'old-ghost' }, // prior value recorded
            // No firstWriteKeys — `ghost` was a real prior value, not a first-write.
          },
        },
      ],
    });
    await expect(
      lib.pushBrownfieldControl({
        modelDir,
        file,
        decision: { sharedOwnership: 'push-anyway' },
        freshPlatformAttrs: new Map([[VALID_CLASS_ID, {}]]),
        liveAssignedModelIds: ['model-this'],
        thisModelId: 'model-this',
      }),
    ).rejects.toThrow(/absent-and-unknown/);
  });

  it('back-compat: pre-Sprint-7 file with no firstWriteKeys field pushes normally', async () => {
    // Pre-Sprint-7 files have only previousAttributes on pendingEdit.
    // The engine must read `firstWriteKeys ?? []` and behave identically
    // to the legacy path.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
            // firstWriteKeys deliberately absent — legacy file shape
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    // Alone Control with no first-write keys → no audit entry (existing behaviour).
    expect(result.mutated).toBe(true);
    expect(result.auditEntries).toHaveLength(0);
  });

  it('multi-class Control: only the class with first-write keys gets an audit entry (alone)', async () => {
    // Class A is pure first-write; Class B is a normal brownfield update.
    // Alone Control, no shared-ownership force. Expected outcome:
    //   - Both classes hit setInstantiationAttributes (mutated:true)
    //   - Class A produces a kind='first-write' audit entry
    //   - Class B produces NO audit entry (alone + no first-write keys =
    //     audit-silent — existing Sprint 6 behaviour preserved per-class)
    const CLASS_A = '11111111-1111-1111-1111-111111111111';
    const CLASS_B = '22222222-2222-2222-2222-222222222222';
    const file = brownfieldFile({
      classes: [
        {
          classId: CLASS_A,
          attributes: { fwk1: 'A1', fwk2: 'A2' },
          platformAttributes: {},
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: {},
            firstWriteKeys: ['fwk1', 'fwk2'],
          },
        },
        {
          classId: CLASS_B,
          attributes: { existing: 'updated' },
          platformAttributes: { existing: 'old' },
          localEditedAt: '2026-04-27T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-27T11:00:00Z',
            previousAttributes: { existing: 'old' },
          },
        },
      ],
    });
    const setSpy = vi
      .spyOn(
        (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
        'setInstantiationAttributes',
      )
      .mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([
        [CLASS_A, {}],
        [CLASS_B, { existing: 'old' }],
      ]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });

    expect(result.mutated).toBe(true);
    expect(setSpy).toHaveBeenCalledTimes(2);
    // Exactly one audit entry — Class A (first-write).
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].kind).toBe('first-write');
    expect(result.auditEntries[0].classId).toBe(CLASS_A);
    expect(result.auditEntries[0].firstWriteKeys?.sort()).toEqual(['fwk1', 'fwk2']);
  });
});

describe('pushBrownfieldControl — partial-payload (DEC-CL-11)', () => {
  it('sends ONLY changed keys to setInstantiationAttributes', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited', baz: 1, qux: 'untouched' },
          platformAttributes: { foo: 'bar', baz: 1, qux: 'untouched' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' }, // only 'foo' was intentionally changed
          },
        },
      ],
    });
    const setSpy = vi
      .spyOn(
        (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
        'setInstantiationAttributes',
      )
      .mockResolvedValue(true);

    await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([
        [VALID_CLASS_ID, { foo: 'bar', baz: 1, qux: 'untouched' }],
      ]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(setSpy).toHaveBeenCalledWith({
      controlId: VALID_UUID,
      classId: VALID_CLASS_ID,
      attributes: { foo: 'edited' }, // baz and qux are NOT included
    });
  });
});

describe('pushBrownfieldControl — Step D conflict resolution', () => {
  it('cancels entire control row when a conflict has no per-key decision', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'mine' },
          platformAttributes: { foo: 'theirs' }, // server changed since our snapshot
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'original' }, // was 'original', server now 'theirs', we want 'mine'
          },
        },
      ],
    });
    const setSpy = vi
      .spyOn(
        (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
        'setInstantiationAttributes',
      )
      .mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' }, // no perKey provided
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'theirs' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('keep ours pushes our value with conflictResolutions recorded', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'mine' },
          platformAttributes: { foo: 'theirs' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'original' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: {
        sharedOwnership: 'push-anyway',
        perKey: { '0.foo': { chosen: 'keep' } },
      },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'theirs' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(true);
    expect(result.auditEntries[0].conflictResolutions).toEqual([
      { key: 'foo', ours: 'mine', theirs: 'theirs', chosen: 'ours' },
    ]);
  });

  it('accept-theirs drops the key from outbound and updates pendingEdit baseline', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'mine', baz: 99 },
          platformAttributes: { foo: 'theirs', baz: 1 },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'original', baz: 1 },
          },
        },
      ],
    });
    const setSpy = vi
      .spyOn(
        (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
        'setInstantiationAttributes',
      )
      .mockResolvedValue(true);

    await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: {
        sharedOwnership: 'cancel',
        perKey: { '0.foo': { chosen: 'accept-theirs' } },
      },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'theirs', baz: 1 }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    // foo was accept-theirs (dropped); baz is non-conflicting → still pushed.
    // Wait: baz pre-edit was 1, attribute is 99, server is 1 → no conflict
    // (server matches our snapshot), so baz IS pushed.
    expect(setSpy).toHaveBeenCalledWith({
      controlId: VALID_UUID,
      classId: VALID_CLASS_ID,
      attributes: { baz: 99 },
    });
  });
});

describe('pushGreenfieldControl — guard', () => {
  it('throws when called on a brownfield file', async () => {
    const file = brownfieldFile();
    await expect(
      lib.pushGreenfieldControl({
        modelDir,
        file,
        supportingElementIds: [],
        folderId: undefined,
        liveAssignedModelIds: [],
      }),
    ).rejects.toThrow(/lifecycle/);
  });
});

describe('Sprint 4 Tier-2 — F-01 hand-edit coercion at audit-write site', () => {
  it("coerces editedBy='external' → 'operator' when previousAttributes doesn't match platformAttributes (hand-edit spoof defeated)", async () => {
    // Threat model: a malicious operator hand-edits controls/<id>.json to
    // set editedBy='external' with attacker-chosen previousAttributes,
    // hoping the audit log will tag the push as a Step A recovery rather
    // than a deliberate operator overwrite. Engine coercion catches this:
    // previousAttributes that doesn't match platformAttributes is the
    // signature of a hand-edit, NOT of promoteExternalEdit (which mirrors
    // platform). The audit entry gets the honest 'operator' tag.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'attacker-edit' },
          platformAttributes: { foo: 'real-server-value' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            // Spoofed: hand-editor set 'external' but previousAttributes
            // is attacker-chosen (does NOT mirror platformAttributes).
            editedBy: 'external',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'attacker-fake-baseline' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } })
        .dtControl,
      'getControlInstantiationAttributes',
    ).mockResolvedValue([{ controlId: VALID_UUID, classId: VALID_CLASS_ID, attributes: { foo: 'real-server-value' } }]);
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: {
        sharedOwnership: 'push-anyway',
        // Conflict resolution: previousAttributes (attacker-fake-baseline)
        // != platformAttributes (real-server-value), so foo is a conflict
        // key. Operator chooses keep so the push fires and we get an audit
        // entry to inspect.
        perKey: { '0.foo': { chosen: 'keep' } },
      },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'real-server-value' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    expect(result.auditEntries[0].kind).toBe('force-shared');
    // Coerced — auditor sees the honest 'operator' attribution.
    expect(result.auditEntries[0].editedBy).toBe('operator');
  });

  it("preserves editedBy='external' when previousAttributes matches platformAttributes (legitimate promote-external-edit)", async () => {
    // promoteExternalEdit synthesises previousAttributes from platformAttributes
    // verbatim. This shape is the signature the engine uses to distinguish a
    // legitimate recovery from a hand-edit spoof.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'operator-correction' },
          platformAttributes: { foo: 'platform-state' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'external',
            editedAt: '2026-04-18T11:00:00Z',
            // Mirrors platformAttributes — promoteExternalEdit signature.
            previousAttributes: { foo: 'platform-state' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } })
        .dtControl,
      'getControlInstantiationAttributes',
    ).mockResolvedValue([{ controlId: VALID_UUID, classId: VALID_CLASS_ID, attributes: { foo: 'platform-state' } }]);
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'platform-state' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
    });
    // Legitimate — discriminator preserved.
    expect(result.auditEntries[0].editedBy).toBe('external');
  });
});

describe('Sprint 4 Tier-2 — promoteExternalEdit precondition guards', () => {
  it('refuses when the class already has a pendingEdit', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'platform-state' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'old-baseline' },
          },
        },
      ],
    });
    await expect(
      lib.promoteExternalEdit({ modelDir, file, classIdx: 0 }),
    ).rejects.toThrow(/already has a pendingEdit/);
  });
});

describe('Sprint 4 F-09 — TOCTOU per-control fresh-fetch in Step B', () => {
  it('inline re-fetch overrides caller-supplied freshPlatformAttrs (closes review-window TOCTOU)', async () => {
    // Scenario: at P7.2 the skill batched-fetched freshPlatformAttrs (foo: 'old-server').
    // During operator review, operator B mutates the platform (foo: 'new-server').
    // Without the F-09 fix, our snapshot still shows 'old-server' — Step D
    // sees no conflict, force-shared writes happily, B's edit lost.
    // With F-09 the engine's inline re-fetch reads 'new-server' and Step D
    // surfaces a conflict so the operator can decide.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'old-server' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'old-server' },
          },
        },
      ],
    });
    // Spy returns the LIVE state (operator B's mutation) — different from
    // what the caller passes in freshPlatformAttrs.
    const reFetchSpy = vi.spyOn(
      (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } })
        .dtControl,
      'getControlInstantiationAttributes',
    ).mockResolvedValue([{ controlId: VALID_UUID, classId: VALID_CLASS_ID, attributes: { foo: 'new-server' } }]);
    const setAttrsSpy = vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      // Caller's stale snapshot says 'old-server' — engine must ignore this.
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'old-server' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });

    // Critical proof: the inline re-fetch was invoked exactly once with
    // the touched control's id. Pre-Sprint-4 code would not have called
    // it at all (only the caller's stale map drove Step B).
    expect(reFetchSpy).toHaveBeenCalledTimes(1);
    expect(reFetchSpy).toHaveBeenCalledWith({ controlIds: [VALID_UUID] });

    // Conflict surfaces: previousAttributes ('old-server') !=
    // re-fetched platform ('new-server'). Without an explicit perKey
    // decision the conflicting key is dropped from outboundPayload, so
    // setInstantiationAttributes is never called for foo. This is the
    // intended TOCTOU safety: the engine refuses to silently overwrite
    // operator B's mutation.
    expect(setAttrsSpy).not.toHaveBeenCalled();
  });

  it('falls back to caller-supplied freshPlatformAttrs on TRANSIENT inline re-fetch failure (Bolt ServiceUnavailable)', async () => {
    // Cypher-expert + process-architect Tier-2: the catch must distinguish
    // network-transient errors (degrade safely with stale snapshot +
    // usedStaleSnapshot flag) from non-transient errors (auth, schema,
    // transaction conflict — must bubble).
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } })
        .dtControl,
      'getControlInstantiationAttributes',
    ).mockRejectedValue(new Error('Bolt ServiceUnavailable: connection refused'));
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
    });
    expect(result.mutated).toBe(true);
    // Process-architect T2-1: the result must surface the staleness so
    // the skill can render a one-line caveat.
    expect(result.usedStaleSnapshot).toBe(true);
  });

  it('BUBBLES non-transient inline re-fetch errors (auth / schema / conflict)', async () => {
    // A TransactionConflictError or auth failure is the EXACT signal F-09
    // was added to detect — silently swallowing it would re-introduce the
    // TOCTOU window. Engine must propagate so the operator sees the cause.
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { getControlInstantiationAttributes: (...args: any[]) => any } })
        .dtControl,
      'getControlInstantiationAttributes',
    ).mockRejectedValue(new Error('Authentication required: token expired'));

    await expect(
      lib.pushBrownfieldControl({
        modelDir,
        file,
        decision: { sharedOwnership: 'push-anyway' },
        freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
        liveAssignedModelIds: ['model-this'],
        thisModelId: 'model-this',
      }),
    ).rejects.toThrow(/Authentication required/);
  });
});

describe('Sprint 4 F-04 — authnOperator propagation to audit log', () => {
  it('threads authnOperator into the force-shared audit entry when supplied', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    vi.spyOn(
      (lib as unknown as { dtControl: { setInstantiationAttributes: (...args: any[]) => any } }).dtControl,
      'setInstantiationAttributes',
    ).mockResolvedValue(true);

    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'push-anyway' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this', 'model-other'],
      thisModelId: 'model-this',
      authnOperator: 'sso.user@corp.example.com',
    });
    expect(result.auditEntries[0].authnOperator).toBe('sso.user@corp.example.com');
    // The local `operator` field stays separate — falls back to
    // getOperatorEmail() when not supplied. The two-field design lets an
    // auditor cross-check spoofable local identity against JWT-anchored truth.
    expect(typeof result.auditEntries[0].operator).toBe('string');
  });

  it('propagates authnOperator to the reverted audit entry too', async () => {
    const file = brownfieldFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'bar' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: {
            editedBy: 'agent',
            editedAt: '2026-04-18T11:00:00Z',
            previousAttributes: { foo: 'bar' },
          },
        },
      ],
    });
    const result = await lib.pushBrownfieldControl({
      modelDir,
      file,
      decision: { sharedOwnership: 'cancel' },
      freshPlatformAttrs: new Map([[VALID_CLASS_ID, { foo: 'bar' }]]),
      liveAssignedModelIds: ['model-this'],
      thisModelId: 'model-this',
      authnOperator: 'sso.user@corp.example.com',
    });
    expect(result.auditEntries[0].kind).toBe('reverted');
    expect(result.auditEntries[0].authnOperator).toBe('sso.user@corp.example.com');
  });
});
