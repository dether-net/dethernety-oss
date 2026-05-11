/**
 * Tests for the audit-log writer.
 *
 * Covers: append produces well-formed JSONL; `effective` derivation cases
 * (all-theirs / all-ours / mixed-with-merge); operator-email fallback
 * never throws.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  appendAuditEntry,
  buildAuditEntry,
  computeEffective,
  getAuditLogPath,
  getOperatorEmail,
  type AuditLogEntry,
  type ConflictResolution,
} from '../audit-log-writer.js';

let modelDir: string;

beforeEach(async () => {
  modelDir = await fs.mkdtemp(join(os.tmpdir(), 'audit-test-'));
});

afterEach(async () => {
  await fs.rm(modelDir, { recursive: true, force: true });
});

function baseEntry(overrides: Partial<AuditLogEntry> = {}): Promise<AuditLogEntry> {
  return buildAuditEntry({
    kind: 'force-shared',
    controlId: 'ctrl-1',
    controlName: 'Azure Firewall',
    classId: 'cls-1',
    className: 'Firewall Policy',
    modelId: 'model-this',
    liveAssignedModelIds: ['model-this', 'model-other'],
    intendedKeys: ['default_inbound_policy'],
    attributesPushed: { default_inbound_policy: 'log_only' },
    previousAttributes: { default_inbound_policy: 'deny' },
    timestamp: '2026-04-18T12:00:00Z',
    operator: 'tester@example.com',
    ...overrides,
  });
}

describe('audit-log writer — append', () => {
  it('appends a well-formed JSONL line', async () => {
    await appendAuditEntry(modelDir, await baseEntry());
    const raw = await fs.readFile(getAuditLogPath(modelDir), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.kind).toBe('force-shared');
    expect(parsed.timestamp).toBe('2026-04-18T12:00:00Z');
    expect(parsed.operator).toBe('tester@example.com');
  });

  it('appends multiple entries — one line per call', async () => {
    await appendAuditEntry(modelDir, await baseEntry({ controlId: 'ctrl-A' }));
    await appendAuditEntry(modelDir, await baseEntry({ controlId: 'ctrl-B' }));
    await appendAuditEntry(modelDir, await baseEntry({ controlId: 'ctrl-C' }));
    const raw = await fs.readFile(getAuditLogPath(modelDir), 'utf-8');
    const lines = raw.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    const ids = lines.map(l => JSON.parse(l).controlId);
    expect(ids).toEqual(['ctrl-A', 'ctrl-B', 'ctrl-C']);
  });

  it('creates the .dethereal directory if absent', async () => {
    await appendAuditEntry(modelDir, await baseEntry());
    const stat = await fs.stat(join(modelDir, '.dethereal'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('appends to an existing log without truncating', async () => {
    const logPath = getAuditLogPath(modelDir);
    await fs.mkdir(join(modelDir, '.dethereal'), { recursive: true });
    await fs.writeFile(logPath, '{"pre-existing":"line"}\n');
    await appendAuditEntry(modelDir, await baseEntry());
    const raw = await fs.readFile(logPath, 'utf-8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
    expect(raw).toContain('"pre-existing":"line"');
  });
});

describe('audit-log writer — computeEffective', () => {
  it('returns null for force-unverified', () => {
    expect(computeEffective('force-unverified', [])).toBeNull();
  });

  it('returns null for reverted', () => {
    expect(computeEffective('reverted', undefined)).toBeNull();
  });

  it('returns "ours" for force-shared with no conflicts', () => {
    expect(computeEffective('force-shared', [])).toBe('ours');
    expect(computeEffective('force-shared', undefined)).toBe('ours');
  });

  it('returns "theirs" when every conflict resolved to accept-theirs', () => {
    const resolutions: ConflictResolution[] = [
      { key: 'k1', ours: 'A', theirs: 'B', chosen: 'theirs' },
      { key: 'k2', ours: 1, theirs: 2, chosen: 'theirs' },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('theirs');
  });

  it('returns "ours" when every conflict resolved to keep ours', () => {
    const resolutions: ConflictResolution[] = [
      { key: 'k1', ours: 'A', theirs: 'B', chosen: 'ours' },
      { key: 'k2', ours: 1, theirs: 2, chosen: 'ours' },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('ours');
  });

  it('returns "novel" when any merge produced a value not equal to either side', () => {
    const resolutions: ConflictResolution[] = [
      { key: 'k1', ours: 'A', theirs: 'B', chosen: 'merge', merged: 'C' },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('novel');
  });

  it('mixed: ours + merge-to-theirs counts as not-all-theirs and not-novel → ours', () => {
    const resolutions: ConflictResolution[] = [
      { key: 'k1', ours: 'A', theirs: 'B', chosen: 'ours' },
      { key: 'k2', ours: 'X', theirs: 'Y', chosen: 'merge', merged: 'Y' },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('ours');
  });

  it('all-theirs with one merge that landed on theirs is still "theirs"', () => {
    const resolutions: ConflictResolution[] = [
      { key: 'k1', ours: 'A', theirs: 'B', chosen: 'theirs' },
      { key: 'k2', ours: 'X', theirs: 'Y', chosen: 'merge', merged: 'Y' },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('theirs');
  });

  // shallowEqual must be deterministic across key orders.
  it('treats objects with identical content but different key order as equal', () => {
    const resolutions: ConflictResolution[] = [
      {
        key: 'k1',
        ours: { a: 1, b: 2 },
        theirs: { c: 3 },
        chosen: 'merge',
        merged: { b: 2, a: 1 }, // same content as ours, reversed key order
      },
    ];
    // Pre-fix this would be 'novel' (stringify diverges across key order);
    // post-fix this is 'ours' because canonicalStringify normalises key order.
    expect(computeEffective('force-shared', resolutions)).toBe('ours');
  });

  it('treats merge-result as theirs when canonicalised content matches theirs', () => {
    const resolutions: ConflictResolution[] = [
      {
        key: 'k1',
        ours: { a: 1 },
        theirs: { x: 1, y: 2 },
        chosen: 'merge',
        merged: { y: 2, x: 1 }, // same content as theirs, reversed
      },
    ];
    expect(computeEffective('force-shared', resolutions)).toBe('theirs');
  });

  // First-write entries always derive 'novel' (no prior values exist on
  // either side, so neither 'ours' nor 'theirs' applies).
  it('returns "novel" for first-write regardless of conflictResolutions', () => {
    expect(computeEffective('first-write', undefined)).toBe('novel');
    expect(computeEffective('first-write', [])).toBe('novel');
  });
});

describe('audit-log writer — buildAuditEntry', () => {
  it('auto-derives effective from conflictResolutions', async () => {
    const entry = await buildAuditEntry({
      kind: 'force-shared',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: ['m'],
      intendedKeys: ['k1'],
      attributesPushed: { k1: 'A' },
      previousAttributes: { k1: 'A' },
      conflictResolutions: [
        { key: 'k1', ours: 'A', theirs: 'B', chosen: 'theirs' },
      ],
    });
    expect(entry.effective).toBe('theirs');
  });

  it('defaults timestamp to now and operator to git/user fallback', async () => {
    const before = Date.now();
    const entry = await buildAuditEntry({
      kind: 'reverted',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: null,
      intendedKeys: ['k1'],
      attributesPushed: {},
      previousAttributes: { k1: 'A' },
    });
    const after = Date.now();
    const ts = Date.parse(entry.timestamp);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(entry.operator).toBeTruthy();
  });

  // First-write entry shape: empty previousAttributes,
  // populated firstWriteKeys, effective='novel'.
  it('first-write entry threads firstWriteKeys and derives effective=novel', async () => {
    const entry = await buildAuditEntry({
      kind: 'first-write',
      controlId: 'ctrl-tls',
      controlName: 'TLS 1.2+ in transit',
      classId: 'cls-encryption-in-transit',
      className: 'Encryption in Transit',
      modelId: 'model-this',
      liveAssignedModelIds: ['model-this'],
      intendedKeys: ['tls_version', 'weak_ciphers', 'key_length'],
      attributesPushed: { tls_version: 'TLS_1_2', weak_ciphers: false, key_length: 2048 },
      previousAttributes: {},
      firstWriteKeys: ['tls_version', 'weak_ciphers', 'key_length'],
    });
    expect(entry.kind).toBe('first-write');
    expect(entry.firstWriteKeys?.sort()).toEqual(
      ['key_length', 'tls_version', 'weak_ciphers'].sort(),
    );
    expect(entry.previousAttributes).toEqual({});
    expect(entry.effective).toBe('novel');
  });

  it('force-shared entry can carry firstWriteKeys as a sibling field', async () => {
    // When a push is shared-ownership-forced AND contains first-write keys,
    // the engine sets kind='force-shared' (governance signal wins) but still
    // records firstWriteKeys for the audit reader.
    const entry = await buildAuditEntry({
      kind: 'force-shared',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: ['m', 'other'],
      intendedKeys: ['existing', 'new'],
      attributesPushed: { existing: 'updated', new: 'value' },
      previousAttributes: { existing: 'old' },
      firstWriteKeys: ['new'],
    });
    expect(entry.kind).toBe('force-shared');
    expect(entry.firstWriteKeys).toEqual(['new']);
    expect(entry.previousAttributes).toEqual({ existing: 'old' });
  });

  it('reverted entry has effective=null and empty attributesPushed', async () => {
    const entry = await buildAuditEntry({
      kind: 'reverted',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: null,
      intendedKeys: ['k1'],
      attributesPushed: {},
      previousAttributes: { k1: 'A' },
    });
    expect(entry.effective).toBeNull();
    expect(entry.attributesPushed).toEqual({});
  });
});

describe('audit-log writer — getOperatorEmail', () => {
  it('returns a non-empty string (git email or fallback)', async () => {
    const email = await getOperatorEmail();
    expect(email).toMatch(/.+@.+/);
  });
});

describe('authnOperator field', () => {
  it('buildAuditEntry accepts and persists authnOperator', async () => {
    const entry = await buildAuditEntry({
      kind: 'force-shared',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: ['m'],
      intendedKeys: ['k1'],
      attributesPushed: { k1: 'A' },
      previousAttributes: { k1: 'A' },
      authnOperator: 'sso.user@corp.example.com',
    });
    expect(entry.authnOperator).toBe('sso.user@corp.example.com');
    // Local `operator` field stays separate.
    expect(entry.operator).toBeTruthy();
    expect(entry.operator).not.toBe('sso.user@corp.example.com');
  });

  it('buildAuditEntry leaves authnOperator undefined when not supplied (back-compat)', async () => {
    const entry = await buildAuditEntry({
      kind: 'force-shared',
      controlId: 'c',
      controlName: 'C',
      classId: 'cl',
      className: 'CL',
      modelId: 'm',
      liveAssignedModelIds: ['m'],
      intendedKeys: ['k1'],
      attributesPushed: { k1: 'A' },
      previousAttributes: { k1: 'A' },
    });
    expect(entry.authnOperator).toBeUndefined();
  });

  it('appendAuditEntry round-trips authnOperator through JSONL', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'authn-op-test-'));
    try {
      const entry = await buildAuditEntry({
        kind: 'force-shared',
        controlId: 'c',
        controlName: 'C',
        classId: 'cl',
        className: 'CL',
        modelId: 'm',
        liveAssignedModelIds: ['m'],
        intendedKeys: ['k1'],
        attributesPushed: { k1: 'A' },
        previousAttributes: { k1: 'A' },
        authnOperator: 'sso.user@corp.example.com',
      });
      const { appendAuditEntry, getAuditLogPath } = await import('../audit-log-writer.js');
      await appendAuditEntry(dir, entry);
      const raw = await fs.readFile(getAuditLogPath(dir), 'utf-8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.authnOperator).toBe('sso.user@corp.example.com');
      expect(parsed.operator).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
