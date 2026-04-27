/**
 * Tests for the ControlFile validator.
 *
 * One positive + one negative case per §4 invariant. Plus the live-platform
 * validator's classId-resolution check.
 */

import { describe, it, expect } from 'vitest';
import {
  validateControlFile,
  validateControlFileWithPlatform,
} from '../validator.js';
import type { ControlFile } from '../../schemas/control-file.schema.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_CLASS_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function brownfieldFile(overrides: Partial<ControlFile> = {}): ControlFile {
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
    platformState: { lastSyncedAt: '2026-04-18T12:00:00Z' },
    ...overrides,
  };
}

function greenfieldFile(overrides: Partial<ControlFile> = {}): ControlFile {
  return {
    id: 'greenfield-abc',
    name: 'New Control',
    source: 'declared',
    lifecycle: 'greenfield',
    classes: [{ classId: VALID_CLASS_ID, attributes: {} }],
    ...overrides,
  };
}

describe('validateControlFile — id', () => {
  it('accepts a UUID', () => {
    const r = validateControlFile(brownfieldFile());
    expect(r.errors).toEqual([]);
  });

  it('accepts a greenfield temp id', () => {
    const r = validateControlFile(greenfieldFile());
    expect(r.errors).toEqual([]);
  });

  it('rejects an empty id', () => {
    const r = validateControlFile(brownfieldFile({ id: '' }));
    expect(r.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('rejects a junk id', () => {
    const r = validateControlFile(brownfieldFile({ id: 'not-a-uuid' }));
    expect(r.errors.some(e => /id:/.test(e))).toBe(true);
  });
});

describe('validateControlFile — lifecycle ⇄ id consistency', () => {
  it('errors when lifecycle=brownfield but id is greenfield-...', () => {
    const r = validateControlFile(
      brownfieldFile({ id: 'greenfield-abc', platformState: { lastPushedAt: '...' } }),
    );
    expect(
      r.errors.some(e => /requires a UUID/.test(e)),
    ).toBe(true);
  });

  it('warns when lifecycle=greenfield but id is a UUID', () => {
    const r = validateControlFile(
      greenfieldFile({ id: VALID_UUID }),
    );
    expect(r.warnings.some(w => /stale lifecycle/.test(w))).toBe(true);
  });
});

describe('validateControlFile — lifecycle enum', () => {
  it('accepts brownfield', () => {
    expect(validateControlFile(brownfieldFile()).errors).toEqual([]);
  });

  it('rejects an unknown lifecycle', () => {
    const r = validateControlFile(
      brownfieldFile({ lifecycle: 'invalid-state' as 'brownfield' }),
    );
    expect(r.errors.some(e => /lifecycle:/.test(e))).toBe(true);
  });
});

describe('validateControlFile — platformState presence', () => {
  it('errors when brownfield is missing platformState', () => {
    const r = validateControlFile(brownfieldFile({ platformState: undefined }));
    expect(
      r.errors.some(e => /platformState/.test(e)),
    ).toBe(true);
  });

  it('warns when greenfield has platformState', () => {
    const r = validateControlFile(
      greenfieldFile({ platformState: { lastSyncedAt: '...' } }),
    );
    expect(r.warnings.some(w => /platformState is present/.test(w))).toBe(true);
  });
});

describe('validateControlFile — pendingEdit invariants', () => {
  it('accepts pendingEdit with localEditedAt > pushedAt', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'new' },
            platformAttributes: { foo: 'old' },
            pushedAt: '2026-04-18T10:00:00Z',
            localEditedAt: '2026-04-18T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-18T11:00:00Z',
              previousAttributes: { foo: 'old' },
            },
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
  });

  it('errors when pendingEdit but pushedAt >= localEditedAt', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'new' },
            platformAttributes: { foo: 'old' },
            pushedAt: '2026-04-18T12:00:00Z',
            localEditedAt: '2026-04-18T10:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-18T10:00:00Z',
              previousAttributes: { foo: 'old' },
            },
          },
        ],
      }),
    );
    expect(
      r.errors.some(e => /pushedAt.*localEditedAt/.test(e)),
    ).toBe(true);
  });

  it('errors when pendingEdit is populated but localEditedAt absent', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'new' },
            platformAttributes: { foo: 'old' },
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-18T11:00:00Z',
              previousAttributes: { foo: 'old' },
            },
          },
        ],
      }),
    );
    expect(r.errors.some(e => /localEditedAt is absent/.test(e))).toBe(true);
  });

  it('accepts pendingEdit with attributes==platformAttributes (operator rolled back)', () => {
    // §4: this is valid — the next push clears pendingEdit silently.
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'rolledback' },
            platformAttributes: { foo: 'rolledback' },
            pushedAt: '2026-04-18T10:00:00Z',
            localEditedAt: '2026-04-18T11:00:00Z',
            pendingEdit: {
              editedBy: 'operator',
              editedAt: '2026-04-18T11:00:00Z',
              previousAttributes: { foo: 'rolledback' },
            },
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
  });
});

describe('validateControlFile — external-edit warning', () => {
  it('warns when attributes != platformAttributes WITHOUT pendingEdit', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'edited externally' },
            platformAttributes: { foo: 'server-current' },
          },
        ],
      }),
    );
    expect(
      r.warnings.some(w => /promote-external-edit/.test(w)),
    ).toBe(true);
  });

  it('does NOT warn when attributes match platformAttributes', () => {
    const r = validateControlFile(brownfieldFile());
    expect(r.warnings.filter(w => /external/.test(w))).toEqual([]);
  });
});

describe('validateControlFile — Sprint 7 firstWriteKeys', () => {
  it('accepts a valid firstWriteKeys array (no overlap, no platform staleness)', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { fwk1: 'A', fwk2: 'B', fwk3: 'C' },
            platformAttributes: {},
            localEditedAt: '2026-04-27T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-27T11:00:00Z',
              previousAttributes: {},
              firstWriteKeys: ['fwk1', 'fwk2', 'fwk3'],
            },
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter(w => /firstWriteKeys/.test(w))).toEqual([]);
  });

  it('errors when firstWriteKeys contains a non-string element', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { fwk1: 'A' },
            platformAttributes: {},
            localEditedAt: '2026-04-27T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-27T11:00:00Z',
              previousAttributes: {},
              firstWriteKeys: ['valid', 42 as unknown as string],
            },
          },
        ],
      }),
    );
    expect(
      r.errors.some(e => /firstWriteKeys must be an array of strings/.test(e)),
    ).toBe(true);
  });

  it('errors when a key appears in BOTH firstWriteKeys and previousAttributes (mutual exclusivity)', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { conflicting: 'new' },
            platformAttributes: { conflicting: 'old' },
            localEditedAt: '2026-04-27T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-27T11:00:00Z',
              previousAttributes: { conflicting: 'old' },
              firstWriteKeys: ['conflicting'],
            },
          },
        ],
      }),
    );
    expect(r.errors.some(e => /must be disjoint/.test(e))).toBe(true);
  });

  it('warns (not errors) when firstWriteKeys is also present in platformAttributes (stale local file)', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { stale: 'local' },
            platformAttributes: { stale: 'platform-already-has-it' },
            localEditedAt: '2026-04-27T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-27T11:00:00Z',
              previousAttributes: {},
              firstWriteKeys: ['stale'],
            },
          },
        ],
      }),
    );
    expect(r.errors.filter(e => /firstWriteKeys/.test(e))).toEqual([]);
    expect(r.warnings.some(w => /local file may be stale/.test(w))).toBe(true);
  });

  it('errors on hand-edit spoof: editedBy="external" with non-empty firstWriteKeys (Sprint 7 hardening)', () => {
    // This shape cannot be produced by the legitimate promoteExternalEdit
    // recovery verb (which synthesises previousAttributes from
    // platformAttributes for diverging keys and never emits firstWriteKeys).
    // The validator must surface this hand-edit pattern as a hard error so
    // /dethereal:status and validate-model catch it before push.
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { spoofed: 'value' },
            platformAttributes: {},
            localEditedAt: '2026-04-27T11:00:00Z',
            pendingEdit: {
              editedBy: 'external',
              editedAt: '2026-04-27T11:00:00Z',
              previousAttributes: {},
              firstWriteKeys: ['spoofed'],
            },
          },
        ],
      }),
    );
    expect(
      r.errors.some(e =>
        /editedBy='external' must NOT carry firstWriteKeys/.test(e),
      ),
    ).toBe(true);
  });
});

describe('validateControlFile — class entry attributes', () => {
  it('errors when attributes is null', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: null as unknown as Record<string, unknown>,
            platformAttributes: {},
          },
        ],
      }),
    );
    expect(r.errors.some(e => /attributes must be an object/.test(e))).toBe(true);
  });

  it('warns when brownfield entry missing platformAttributes', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [{ classId: VALID_CLASS_ID, attributes: {} }],
      }),
    );
    expect(
      r.warnings.some(w => /platformAttributes is absent/.test(w)),
    ).toBe(true);
  });
});

describe('validateControlFile — source field', () => {
  it('rejects an unknown source', () => {
    const r = validateControlFile(
      brownfieldFile({ source: 'invalid' as 'declared' }),
    );
    expect(r.errors.some(e => /source:/.test(e))).toBe(true);
  });
});

describe('validateControlFileWithPlatform', () => {
  it('errors when classId does not resolve to a platform template', () => {
    const templates = new Map<string, { id: string }>();
    const r = validateControlFileWithPlatform(brownfieldFile(), templates);
    expect(r.errors.some(e => /does not resolve/.test(e))).toBe(true);
  });

  it('passes when every classId resolves', () => {
    const templates = new Map([[VALID_CLASS_ID, { id: VALID_CLASS_ID }]]);
    const r = validateControlFileWithPlatform(brownfieldFile(), templates);
    expect(r.errors.filter(e => /does not resolve/.test(e))).toEqual([]);
  });
});

describe('validateControlFile — Sprint 5 F-17 prototype-pollution keys', () => {
  it('rejects __proto__ at the root of attributes (own property)', () => {
    // Using Object.defineProperty to install __proto__ as an own enumerable
    // property — a literal `{ __proto__: ... }` would set the prototype, not
    // an own key. The realistic vector is a hand-edited JSON file parsed via
    // JSON.parse which DOES install __proto__ as an own key.
    const attrs: Record<string, unknown> = {};
    Object.defineProperty(attrs, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: attrs,
            platformAttributes: {},
          },
        ],
      }),
    );
    expect(r.errors.some(e => /forbidden key.*__proto__/.test(e))).toBe(true);
  });

  it('rejects __proto__ via JSON.parse (the realistic vector)', () => {
    const attrs = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: attrs,
            platformAttributes: {},
          },
        ],
      }),
    );
    expect(r.errors.some(e => /forbidden key.*__proto__/.test(e))).toBe(true);
  });

  it('rejects constructor nested inside platformAttributes', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'bar' },
            platformAttributes: { meta: { constructor: 'evil' } },
          },
        ],
      }),
    );
    expect(r.errors.some(e => /forbidden key.*constructor/.test(e))).toBe(true);
  });

  it('rejects prototype inside pendingEdit.previousAttributes', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'new' },
            platformAttributes: { foo: 'old' },
            pushedAt: '2026-04-18T10:00:00Z',
            localEditedAt: '2026-04-18T11:00:00Z',
            pendingEdit: {
              editedBy: 'agent',
              editedAt: '2026-04-18T11:00:00Z',
              previousAttributes: { foo: 'old', prototype: 'snuck-in' },
            },
          },
        ],
      }),
    );
    expect(r.errors.some(e => /forbidden key.*prototype/.test(e))).toBe(true);
  });
});

describe('validateControlFile — Sprint 5 F-18 unknown lifecycle short-circuit', () => {
  it('emits per-class warning when lifecycle is unknown and skips downstream checks', () => {
    const r = validateControlFile(
      brownfieldFile({
        lifecycle: 'invalid-state' as 'brownfield',
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'edited' },
            platformAttributes: { foo: 'server' },
          },
        ],
      }),
    );
    expect(r.warnings.some(w => /lifecycle.*not in the known enum/.test(w))).toBe(true);
    // The drift warning would normally fire; verify it doesn't (proves we
    // short-circuited).
    expect(r.warnings.some(w => /promote-external-edit/.test(w))).toBe(false);
  });
});

describe('validateControlFile — Sprint 5 F-38 hint includes classId', () => {
  it('includes the classId in the promote-external-edit recovery hint', () => {
    const r = validateControlFile(
      brownfieldFile({
        classes: [
          {
            classId: VALID_CLASS_ID,
            attributes: { foo: 'edited externally' },
            platformAttributes: { foo: 'server-current' },
          },
        ],
      }),
    );
    const hint = r.warnings.find(w => /promote-external-edit/.test(w));
    expect(hint).toBeTruthy();
    expect(hint).toContain(VALID_CLASS_ID);
  });
});
