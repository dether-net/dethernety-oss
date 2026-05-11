/**
 * Tests for the shared drift-detection helper.
 *
 * The helper is the single source of truth for the "external-edit drift"
 * predicate consumed by `/dethereal:status` (skill prose) and
 * `validate-model.tool.ts`. Tests assert each clause of the predicate so
 * a regression in any consumer's expected behaviour is caught here.
 */

import { describe, it, expect } from 'vitest';
import {
  detectControlDrift,
  detectControlSetDrift,
  isClassDrifted,
} from '../drift-detector.js';
import type { ControlFile } from '../../schemas/control-file.schema.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_CLASS_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function makeFile(overrides: Partial<ControlFile> = {}): ControlFile {
  return {
    id: VALID_UUID,
    name: 'Test Control',
    source: 'declared',
    lifecycle: 'brownfield',
    classes: [
      {
        classId: VALID_CLASS_ID,
        attributes: { foo: 'bar' },
        platformAttributes: { foo: 'bar' },
      },
    ],
    platformState: { lastSyncedAt: '2026-04-18T12:00:00Z', assignedModelIds: [] },
    ...overrides,
  };
}

describe('isClassDrifted — per-class predicate', () => {
  it('false when attributes equal platformAttributes', () => {
    expect(isClassDrifted(makeFile().classes[0])).toBe(false);
  });

  it('true when attributes diverge AND no pendingEdit', () => {
    const entry = makeFile({
      classes: [{ classId: VALID_CLASS_ID, attributes: { foo: 'edited' }, platformAttributes: { foo: 'bar' } }],
    }).classes[0];
    expect(isClassDrifted(entry)).toBe(true);
  });

  it('false when attributes diverge BUT pendingEdit is present', () => {
    const entry = makeFile({
      classes: [
        {
          classId: VALID_CLASS_ID,
          attributes: { foo: 'edited' },
          platformAttributes: { foo: 'bar' },
          localEditedAt: '2026-04-18T11:00:00Z',
          pendingEdit: { editedBy: 'agent', editedAt: '2026-04-18T11:00:00Z', previousAttributes: { foo: 'bar' } },
        },
      ],
    }).classes[0];
    expect(isClassDrifted(entry)).toBe(false);
  });

  it('false when platformAttributes is absent (greenfield-shape entry)', () => {
    const entry = {
      classId: VALID_CLASS_ID,
      attributes: { foo: 'edited' },
    };
    expect(isClassDrifted(entry as never)).toBe(false);
  });
});

describe('detectControlDrift — file-level report', () => {
  it('hasDrift false when lifecycle is greenfield', () => {
    const file = makeFile({
      lifecycle: 'greenfield',
      classes: [{ classId: VALID_CLASS_ID, attributes: { foo: 'edited' }, platformAttributes: { foo: 'bar' } }],
    });
    const report = detectControlDrift(file);
    expect(report.hasDrift).toBe(false);
    expect(report.driftedClasses).toEqual([]);
  });

  it('hasDrift false when lifecycle is tombstoned', () => {
    const file = makeFile({
      lifecycle: 'tombstoned',
      classes: [{ classId: VALID_CLASS_ID, attributes: { foo: 'edited' }, platformAttributes: { foo: 'bar' } }],
    });
    expect(detectControlDrift(file).hasDrift).toBe(false);
  });

  it('reports each drifted class on a brownfield file', () => {
    const file = makeFile({
      classes: [
        { classId: 'class-a', attributes: { foo: 'a-edited' }, platformAttributes: { foo: 'a-bar' } },
        { classId: 'class-b', attributes: { foo: 'unchanged' }, platformAttributes: { foo: 'unchanged' } },
        { classId: 'class-c', attributes: { foo: 'c-edited' }, platformAttributes: { foo: 'c-bar' } },
      ],
    });
    const report = detectControlDrift(file);
    expect(report.hasDrift).toBe(true);
    expect(report.driftedClasses.map(d => d.classId)).toEqual(['class-a', 'class-c']);
    expect(report.driftedClasses[0].reason).toBe('external-edit');
  });
});

describe('detectControlSetDrift — multi-file aggregation', () => {
  it('returns only files with drift', () => {
    const clean = makeFile({ id: 'control-clean', name: 'Clean' });
    const drifty = makeFile({
      id: 'control-drifty',
      name: 'Drifty',
      classes: [{ classId: VALID_CLASS_ID, attributes: { foo: 'edited' }, platformAttributes: { foo: 'bar' } }],
    });
    const reports = detectControlSetDrift([clean, drifty]);
    expect(reports).toHaveLength(1);
    expect(reports[0].controlId).toBe('control-drifty');
  });

  it('returns empty array when no files have drift', () => {
    expect(detectControlSetDrift([makeFile()])).toEqual([]);
  });
});

describe('validator and drift-detector agreement', () => {
  it('drift-detector verdict matches validator external-edit warning', async () => {
    // The validator emits an external-edit warning iff isClassDrifted is true
    // (the validator routes through the same helper). This test asserts the
    // routing — if a future change splits them, this fails.
    const { validateControlFile } = await import('../validator.js');
    const file = makeFile({
      classes: [{ classId: VALID_CLASS_ID, attributes: { foo: 'edited' }, platformAttributes: { foo: 'bar' } }],
    });
    const validatorResult = validateControlFile(file);
    const driftReport = detectControlDrift(file);
    const validatorFlaggedExternalEdit = validatorResult.warnings.some(w =>
      w.includes('attributes differ from platformAttributes'),
    );
    expect(validatorFlaggedExternalEdit).toBe(driftReport.hasDrift);
  });
});
