/**
 * Unit tests for hash-module.mjs — run with:  node --test oss/scripts/
 *
 * Uses Node's built-in test runner (node:test) + node:assert/strict, with
 * hermetic fixtures created under os.tmpdir() so nothing depends on a real
 * module. oss/scripts/ has no Vitest wiring; this is the self-contained,
 * zero-config choice. The CI-relevant validation is the later `hash:check`,
 * not this dev-time unit test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  resolveDataDir,
  computeContentHash,
  readStoredHash,
  writeStoredHash,
} from './hash-module.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hash-module.mjs');
const MODULE_NAME = 'fixture-mod';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal module tree under a fresh tmpdir and return its paths.
 * Layout: <root>/manifest.json + <root>/data/fixture-mod/{module.json,
 * component/x/{class.json,schema.json,policies.rego,embeddings/m1.json}}.
 */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-module-test-'));
  const dataDir = path.join(root, 'data', MODULE_NAME);
  const classDir = path.join(dataDir, 'component', 'x');
  fs.mkdirSync(path.join(classDir, 'embeddings'), { recursive: true });

  writeJson(path.join(root, 'manifest.json'), { name: MODULE_NAME, version: '1.0.0' });
  writeJson(path.join(dataDir, 'module.json'), {
    formatVersion: 1,
    name: MODULE_NAME,
    version: '1.0.0',
    exportedAt: '2026-06-21T00:00:00.000Z',
    classCount: 1,
  });
  writeJson(path.join(classDir, 'class.json'), {
    id: 'abc',
    name: 'X',
    classType: 'component',
    description: 'a class',
  });
  writeJson(path.join(classDir, 'schema.json'), { type: 'object', properties: {} });
  fs.writeFileSync(path.join(classDir, 'policies.rego'), 'package x\nallow := true\n');
  writeJson(path.join(classDir, 'embeddings', 'm1.json'), [0.1, 0.2, 0.3]);

  return { root, dataDir, classDir };
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function withFixture(fn) {
  const fx = makeFixture();
  try {
    fn(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('resolveDataDir resolves data/<name> via manifest name', () => {
  withFixture(({ root, dataDir }) => {
    assert.equal(resolveDataDir(root), dataDir);
  });
});

test('hash is deterministic across runs', () => {
  withFixture(({ dataDir }) => {
    assert.equal(computeContentHash(dataDir), computeContentHash(dataDir));
  });
});

test('hash has the sha256: prefix and hex digest', () => {
  withFixture(({ dataDir }) => {
    assert.match(computeContentHash(dataDir), /^sha256:[0-9a-f]{64}$/);
  });
});

test('JSON key order does not change the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    // Same values, different key order.
    writeJson(path.join(classDir, 'class.json'), {
      description: 'a class',
      classType: 'component',
      name: 'X',
      id: 'abc',
    });
    assert.equal(computeContentHash(dataDir), before);
  });
});

test('changing a class.json value changes the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    writeJson(path.join(classDir, 'class.json'), {
      id: 'abc',
      name: 'X',
      classType: 'component',
      description: 'a DIFFERENT class',
    });
    assert.notEqual(computeContentHash(dataDir), before);
  });
});

test('changing a policies.rego byte changes the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    fs.writeFileSync(path.join(classDir, 'policies.rego'), 'package x\nallow := false\n');
    assert.notEqual(computeContentHash(dataDir), before);
  });
});

test('rego trailing-whitespace / CRLF normalization does not change the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    // Same content, CRLF line endings and extra trailing whitespace.
    fs.writeFileSync(path.join(classDir, 'policies.rego'), 'package x\r\nallow := true\r\n\n  ');
    assert.equal(computeContentHash(dataDir), before);
  });
});

test('editing embedding float contents (same path) does NOT change the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    writeJson(path.join(classDir, 'embeddings', 'm1.json'), [0.9, 0.8, 0.7, 0.6]);
    assert.equal(computeContentHash(dataDir), before);
  });
});

test('adding an embedding file (new model slug) changes the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    writeJson(path.join(classDir, 'embeddings', 'm2.json'), [0.1, 0.2]);
    assert.notEqual(computeContentHash(dataDir), before);
  });
});

test('removing an embedding file changes the hash', () => {
  withFixture(({ dataDir, classDir }) => {
    const before = computeContentHash(dataDir);
    fs.rmSync(path.join(classDir, 'embeddings', 'm1.json'));
    assert.notEqual(computeContentHash(dataDir), before);
  });
});

test('changing only module.json exportedAt does NOT change the hash', () => {
  withFixture(({ dataDir }) => {
    const before = computeContentHash(dataDir);
    const p = path.join(dataDir, 'module.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.exportedAt = '2099-01-01T00:00:00.000Z';
    writeJson(p, m);
    assert.equal(computeContentHash(dataDir), before);
  });
});

test('an existing contentHash field does NOT affect the computed hash', () => {
  withFixture(({ dataDir }) => {
    const before = computeContentHash(dataDir);
    const p = path.join(dataDir, 'module.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.contentHash = 'sha256:stale';
    writeJson(p, m);
    assert.equal(computeContentHash(dataDir), before);
  });
});

test('changing module.json version DOES change the hash', () => {
  withFixture(({ dataDir }) => {
    const before = computeContentHash(dataDir);
    const p = path.join(dataDir, 'module.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.version = '2.0.0';
    writeJson(p, m);
    assert.notEqual(computeContentHash(dataDir), before);
  });
});

test('writeStoredHash / readStoredHash round-trip', () => {
  withFixture(({ dataDir }) => {
    assert.equal(readStoredHash(dataDir), null);
    const hash = computeContentHash(dataDir);
    writeStoredHash(dataDir, hash);
    assert.equal(readStoredHash(dataDir), hash);
  });
});

test('default mode writes a valid, 2-space, no-trailing-newline module.json with contentHash', () => {
  withFixture(({ root, dataDir }) => {
    const res = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);

    const moduleJsonPath = path.join(dataDir, 'module.json');
    const raw = fs.readFileSync(moduleJsonPath, 'utf8');
    const parsed = JSON.parse(raw);

    assert.match(parsed.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(parsed.contentHash, computeContentHash(dataDir));
    assert.ok(raw.includes('\n  "'), 'expected 2-space indentation');
    assert.ok(!raw.endsWith('\n'), 'expected no trailing newline');
    // stdout prints the hash.
    assert.equal(res.stdout.trim(), parsed.contentHash);
  });
});

test('--check exits 1 when no/stale hash is committed, 0 after stamping', () => {
  withFixture(({ root }) => {
    // No contentHash yet → mismatch → exit 1.
    const miss = spawnSync(process.execPath, [SCRIPT, root, '--check'], { encoding: 'utf8' });
    assert.equal(miss.status, 1);
    assert.match(miss.stderr, /mismatch/i);

    // Stamp it.
    const write = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr);

    // Now --check passes → exit 0.
    const ok = spawnSync(process.execPath, [SCRIPT, root, '--check'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^OK sha256:/);
  });
});

test('resolveDataDir throws a clear error when there is no data/ dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-module-test-'));
  try {
    assert.throws(() => resolveDataDir(root), /No data\/ directory/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
