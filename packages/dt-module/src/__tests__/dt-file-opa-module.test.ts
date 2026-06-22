/**
 * DtFileOpaModule mapper projection.
 *
 * Strategy: construct the module against fake deps, then override the I/O seams —
 * `dbOps` (class path + instantiation attributes), `opaOps.evaluate` (the OPA result),
 * and `fs` (a tiny real plaintext rego so the private package-name extraction runs) —
 * and assert how `getCountermeasures` / `getExposures` project the OPA `_def` objects
 * into the typed interfaces. Real OPA evaluation + edge writing are exercised by the
 * dt-ws integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { DtFileOpaModule } from '../dt-file-opa-module';

// fs is a read-only ESM namespace under vitest (can't vi.spyOn it), so mock the module.
// A plaintext rego with a package decl: decodeRegoPolicies returns it verbatim and
// extractRegoPackageName parses the package → the mapper reaches the (mocked) opaOps.evaluate.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'package test.pkg\n'),
    readdirSync: vi.fn(() => []),
  };
});

const stubLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() };

function buildModule(evaluateResult: unknown[]) {
  const mod = new DtFileOpaModule('/fake/dir', 'test-module', {} as any, stubLogger as any);
  (mod as any).dbOps = {
    getAttribute: vi.fn().mockResolvedValue('control/x'),
    getInstantiationAttributes: vi.fn().mockResolvedValue({ description: 'x' }),
  };
  (mod as any).opaOps = {
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
  return mod;
}

const techRef = (value: string, justification: string) => ({
  label: 'MitreAttackTechnique',
  property: 'attack_id',
  value,
  attributes: { justification },
});

describe('DtFileOpaModule.getCountermeasures — per-verb projection', () => {
  it('projects each known verb block with its ref attributes intact', async () => {
    const mod = buildModule([
      {
        name: 'CM1',
        description: 'desc',
        type: 'CONTROL',
        category: 'cat',
        score: 1,
        responds_with: [
          { label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1032', attributes: { justification: 'identity' } },
        ],
        mitigates: [techRef('T1078', 'stops stolen passwords')],
        detects: [techRef('T1110', 'detects brute force')],
        // unknown verb key — must NOT be projected (closed set by omission)
        degrades: [techRef('T9999', 'should be dropped')],
      },
    ]);

    const [cm] = await mod.getCountermeasures('inst-1', 'class-1');

    // Identity block widened, attributes preserved.
    expect(cm.respondsWith).toEqual([
      { label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1032', attributes: { justification: 'identity' } },
    ]);
    // Verb blocks projected with justification intact.
    expect(cm.mitigates).toEqual([techRef('T1078', 'stops stolen passwords')]);
    expect(cm.detects).toEqual([techRef('T1110', 'detects brute force')]);
    expect(cm.mitigates![0].attributes!.justification).toBe('stops stolen passwords');

    // Verbs the policy did not emit are absent in value (optional fields).
    expect(cm.protectsAgainst).toBeUndefined();
    expect(cm.isolates).toBeUndefined();
    expect(cm.restores).toBeUndefined();

    // Unknown verb key is never projected onto the object at all.
    expect('degrades' in (cm as any)).toBe(false);
  });

  it('maps snake_case policy keys to camelCase interface fields', async () => {
    const mod = buildModule([
      {
        name: 'CM2',
        type: 'CONTROL',
        category: 'cat',
        protects_against: [techRef('T1190', 'hardens')],
        responds_to: [techRef('T1486', 'responds')],
      },
    ]);

    const [cm] = await mod.getCountermeasures('inst-1', 'class-1');

    expect(cm.protectsAgainst).toEqual([techRef('T1190', 'hardens')]);
    expect(cm.respondsTo).toEqual([techRef('T1486', 'responds')]);
  });
});

describe('DtFileOpaModule.getMetadata — issue classes', () => {
  // Layout simulated on disk:
  //   /fake/dir/test-module/module.json
  //   /fake/dir/test-module/issue/sql-injection/class.json
  //   /fake/dir/test-module/issue/sql-injection/policies.rego  (stray — must be ignored)
  const MODULE_JSON = JSON.stringify({ name: 'test-module', description: 'd', version: '1.0.0' });
  const ISSUE_CLASS_JSON = JSON.stringify({
    name: 'SQL Injection',
    type: 'vulnerability', // free-form; must NOT be uppercased/forced
    category: 'Injection',
    description: 'An injection flaw.',
  });

  const makeDirent = (name: string) => ({ name, isDirectory: () => true } as any);

  // Restore the file-wide defaults the other suites rely on, regardless of test order.
  afterEach(() => {
    vi.mocked(fs.existsSync).mockImplementation(() => true);
    vi.mocked(fs.readFileSync).mockImplementation((() => 'package test.pkg\n') as any);
    vi.mocked(fs.readdirSync).mockImplementation((() => []) as any);
  });

  beforeEach(() => {
    // Drop call history accumulated by earlier suites so per-test call assertions
    // (e.g. "policies.rego was never read") only see this test's I/O.
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('module.json')) return true;
      if (s.endsWith(`issue${path.sep}sql-injection${path.sep}class.json`)) return true;
      if (s.endsWith(`issue${path.sep}sql-injection${path.sep}policies.rego`)) return true;
      if (s.endsWith(`test-module${path.sep}issue`)) return true; // the issue classType dir
      return false; // every other classType dir is absent → skipped
    });
    vi.mocked(fs.readFileSync).mockImplementation(((p: any) => {
      const s = String(p);
      if (s.endsWith('module.json')) return MODULE_JSON;
      if (s.endsWith('class.json')) return ISSUE_CLASS_JSON;
      return ''; // policies.rego must never be read for issue classes
    }) as any);
    vi.mocked(fs.readdirSync).mockImplementation(((p: any) => {
      const s = String(p);
      if (s.endsWith(`test-module${path.sep}issue`)) return [makeDirent('sql-injection')];
      return [];
    }) as any);
  });

  function buildIssueModule() {
    const mod = new DtFileOpaModule('/fake/dir', 'test-module', {} as any, stubLogger as any);
    (mod as any).opaOps = {
      deletePolicyByPrefix: vi.fn().mockResolvedValue(undefined),
      installPolicies: vi.fn().mockResolvedValue(undefined),
    };
    return mod;
  }

  it('loads issue classes from the issue/ folder into metadata.issueClasses', async () => {
    const mod = buildIssueModule();
    const metadata = await mod.getMetadata();

    expect(metadata.issueClasses).toHaveLength(1);
    const [issue] = metadata.issueClasses as any[];
    expect(issue.name).toBe('SQL Injection');
    expect(issue.category).toBe('Injection');
    // path is relative to moduleDataDir and points at the on-disk class folder.
    expect(issue.path).toBe(`test-module${path.sep}issue${path.sep}sql-injection`);
  });

  it('passes the free-form issue type through verbatim (not forced/uppercased)', async () => {
    const mod = buildIssueModule();
    const metadata = await mod.getMetadata();

    const [issue] = metadata.issueClasses as any[];
    expect(issue.type).toBe('vulnerability');
  });

  it('installs no policy for an issue class even when a stray policies.rego exists', async () => {
    const mod = buildIssueModule();
    await mod.getMetadata();

    // resetPolicies runs fire-and-forget; wait for the background install to land.
    await vi.waitFor(() => {
      expect((mod as any).opaOps.installPolicies).toHaveBeenCalledTimes(1);
    });
    expect((mod as any).opaOps.installPolicies).toHaveBeenCalledWith([]);
    // The stray issue policies.rego was never read.
    const readPaths = vi.mocked(fs.readFileSync).mock.calls.map((c) => String(c[0]));
    expect(readPaths.some((p) => p.endsWith('policies.rego'))).toBe(false);
  });
});

describe('DtFileOpaModule.getMetadata — contentHash', () => {
  // Minimal layout: only module.json exists; no class-type dirs (readdir → []).
  const makeModuleJson = (extra: Record<string, unknown>) =>
    JSON.stringify({ name: 'test-module', description: 'd', version: '1.0.0', ...extra });

  // Restore the file-wide defaults the other suites rely on.
  afterEach(() => {
    vi.mocked(fs.existsSync).mockImplementation(() => true);
    vi.mocked(fs.readFileSync).mockImplementation((() => 'package test.pkg\n') as any);
    vi.mocked(fs.readdirSync).mockImplementation((() => []) as any);
  });

  function buildModule(moduleJson: string) {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).endsWith('module.json'));
    vi.mocked(fs.readFileSync).mockImplementation(((p: any) =>
      String(p).endsWith('module.json') ? moduleJson : '') as any);
    vi.mocked(fs.readdirSync).mockImplementation((() => []) as any);
    const mod = new DtFileOpaModule('/fake/dir', 'test-module', {} as any, stubLogger as any);
    (mod as any).opaOps = {
      deletePolicyByPrefix: vi.fn().mockResolvedValue(undefined),
      installPolicies: vi.fn().mockResolvedValue(undefined),
    };
    return mod;
  }

  it('surfaces module.json contentHash onto metadata', async () => {
    const mod = buildModule(makeModuleJson({ contentHash: 'sha256:abc123' }));
    const metadata = await mod.getMetadata();
    expect(metadata.contentHash).toBe('sha256:abc123');
  });

  it('leaves contentHash undefined when module.json has none', async () => {
    const mod = buildModule(makeModuleJson({}));
    const metadata = await mod.getMetadata();
    expect(metadata.contentHash).toBeUndefined();
  });
});

describe('DtFileOpaModule.getExposures — ref passthrough', () => {
  it('passes the exploited_by ref array through verbatim, attributes included', async () => {
    const mod = buildModule([
      {
        name: 'EXP1',
        type: 'EXPOSURE',
        category: 'cat',
        attack_vector: 'NETWORK',
        exploited_by: [techRef('T1078', 'valid accounts abuse')],
      },
    ]);

    const [exp] = await mod.getExposures('inst-1', 'class-1');

    expect(exp.exploitedBy).toEqual([techRef('T1078', 'valid accounts abuse')]);
    expect((exp.exploitedBy as any)[0].attributes.justification).toBe('valid accounts abuse');
  });
});
