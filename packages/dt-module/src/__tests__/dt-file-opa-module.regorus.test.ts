/**
 * DtFileOpaModule — the in-process evaluation path, which is the only path.
 *
 * Strategy: build a real module tree on disk (no `fs` mock) so the directory walk,
 * `validateModulePath`, and the on-disk key derivation are all exercised for real. Only
 * `dbOps` is stubbed, because it is the one seam that needs a database.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DtFileOpaModule } from '../dt-file-opa-module';
import { RegoEngine, RegoEvalError, RegoPolicyError } from '../rego-engine';

const MODULE_NAME = 'test-module';

// ---------------------------------------------------------------------------
// Rego fixtures — the `contains … if` idiom the real corpus uses.
// ---------------------------------------------------------------------------

const EXPOSURE_DEF = {
  name: 'Publicly reachable',
  description: 'Bound to a public interface.',
  type: 'misconfiguration',
  category: 'network',
  criticality: 'high',
  score: 8.6,
  attack_vector: 'NETWORK',
  exploited_by: [
    {
      label: 'MitreAttackTechnique',
      property: 'attack_id',
      value: 'T1190',
      attributes: { justification: 'public-facing application' },
    },
  ],
};

const EXPOSURE_REGO = `package t.expo

_def := ${JSON.stringify(EXPOSURE_DEF, null, 2)}

exposures contains _def if {
    input.public == true
}
`;

const COUNTERMEASURE_DEF = {
  name: 'Enforce MFA',
  description: 'Multi-factor authentication is required.',
  type: 'CONTROL',
  category: 'identity',
  score: 1,
  responds_with: [
    { label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1032', attributes: { justification: 'identity' } },
  ],
  mitigates: [
    { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078', attributes: { justification: 'stops stolen passwords' } },
  ],
  detects: [
    { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1110', attributes: { justification: 'detects brute force' } },
  ],
  // Snake-case verbs that must land on their camelCase interface fields.
  protects_against: [
    { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1190', attributes: { justification: 'hardens' } },
  ],
  responds_to: [
    { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1486', attributes: { justification: 'responds' } },
  ],
  // Not a member of the closed verb set — the mapper must never project it.
  degrades: [
    { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T9999', attributes: { justification: 'should be dropped' } },
  ],
};

/** Emits an attack_vector outside the CVSS enum — the mapper must default it, loudly. */
const INVALID_AV_REGO = `package t.badav

exposures contains {"name": "Odd", "type": "misconfiguration", "attack_vector": "CARRIER_PIGEON"} if {
    input.public == true
}
`;

const COUNTERMEASURE_REGO = `package t.ctrl

_def := ${JSON.stringify(COUNTERMEASURE_DEF, null, 2)}

countermeasures contains _def if {
    input.mfa_enabled == true
}
`;

/** `count()` over a boolean is a type error: Regorus halts the rule, and that must surface. */
const WRONG_TYPE_REGO = `package t.badtype

exposures contains {"name": "E", "type": "misconfiguration"} if {
    count(input.allowlist) > 0
}
`;

const NO_PACKAGE_REGO = `exposures contains {"name": "E"} if {
    input.public == true
}
`;

// ---------------------------------------------------------------------------
// A real module tree on disk
// ---------------------------------------------------------------------------

interface ClassSpec {
  classType: string;
  slug: string;
  type: string;
  rego?: string;
}

let root: string;

function writeClass(dataDir: string, spec: ClassSpec): string {
  const classDir = path.join(dataDir, MODULE_NAME, spec.classType, spec.slug);
  fs.mkdirSync(classDir, { recursive: true });
  fs.writeFileSync(
    path.join(classDir, 'class.json'),
    JSON.stringify({ name: spec.slug, type: spec.type, category: 'c', description: 'd' }),
  );
  if (spec.rego !== undefined) fs.writeFileSync(path.join(classDir, 'policies.rego'), spec.rego);
  return path.relative(dataDir, classDir);
}

/** A fresh module data dir. Returns the dir plus each class's `path` attribute. */
function makeModule(specs: ClassSpec[]): { dataDir: string; paths: Record<string, string> } {
  const dataDir = fs.mkdtempSync(path.join(root, 'mod-'));
  fs.mkdirSync(path.join(dataDir, MODULE_NAME), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, MODULE_NAME, 'module.json'),
    JSON.stringify({ name: MODULE_NAME, description: 'd', version: '1.0.0' }),
  );
  const paths: Record<string, string> = {};
  for (const spec of specs) paths[spec.slug] = writeClass(dataDir, spec);
  return { dataDir, paths };
}

const COMPONENT: ClassSpec = { classType: 'component', slug: 'web', type: 'PROCESS', rego: EXPOSURE_REGO };
const CONTROL: ClassSpec = { classType: 'control', slug: 'mfa', type: 'CONTROL', rego: COUNTERMEASURE_REGO };
const ISSUE: ClassSpec = { classType: 'issue', slug: 'sqli', type: 'vulnerability', rego: EXPOSURE_REGO };

const stubLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() };

/** Construct against a real on-disk tree; `dbOps` is the only stubbed seam. */
function buildModule(dataDir: string, dbOps: { classPath: string; attributes: unknown }): DtFileOpaModule {
  const mod = new DtFileOpaModule(dataDir, MODULE_NAME, {} as any, stubLogger as any);
  (mod as any).dbOps = {
    getAttribute: vi.fn().mockResolvedValue(dbOps.classPath),
    getInstantiationAttributes: vi.fn().mockResolvedValue(dbOps.attributes),
  };
  return mod;
}

const engineOf = (mod: DtFileOpaModule): RegoEngine => (mod as any).regoEngine;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-regorus-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  stubLogger.log.mockClear();
  stubLogger.warn.mockClear();
  stubLogger.error.mockClear();
});

// ---------------------------------------------------------------------------

describe('getMetadata — registration', () => {
  it('registers one engine per non-issue class and none for issue classes', async () => {
    const { dataDir, paths } = makeModule([COMPONENT, CONTROL, ISSUE]);
    const mod = buildModule(dataDir, { classPath: '', attributes: {} });

    const metadata = await mod.getMetadata();

    // The stray policies.rego under the issue class is never registered.
    expect(engineOf(mod).size).toBe(2);
    expect(metadata.issueClasses).toHaveLength(1);
    expect(metadata.componentClasses).toHaveLength(1);
    expect(metadata.controlClasses).toHaveLength(1);

    // Issue classes surface as-authored: the free-form type is passed through verbatim
    // (never uppercased or forced), and path points at the on-disk class folder.
    const [issue] = metadata.issueClasses as any[];
    expect(issue.name).toBe('sqli');
    expect(issue.type).toBe('vulnerability');
    expect(issue.path).toBe(paths.sqli);
    mod.dispose();
  });

  it('surfaces module.json contentHash onto metadata, and leaves it undefined when absent', async () => {
    const { dataDir } = makeModule([COMPONENT]);
    expect((await buildModule(dataDir, { classPath: '', attributes: {} }).getMetadata()).contentHash).toBeUndefined();

    // contentHash is dt-ws's ingest skip gate — it must ride through verbatim.
    fs.writeFileSync(
      path.join(dataDir, MODULE_NAME, 'module.json'),
      JSON.stringify({ name: MODULE_NAME, description: 'd', version: '1.0.0', contentHash: 'sha256:abc123' }),
    );
    expect((await buildModule(dataDir, { classPath: '', attributes: {} }).getMetadata()).contentHash).toBe('sha256:abc123');
  });

  it('is idempotent — re-running registers the same set without growing it', async () => {
    const { dataDir } = makeModule([COMPONENT, CONTROL]);
    const mod = buildModule(dataDir, { classPath: '', attributes: {} });

    await mod.getMetadata();
    await mod.getMetadata();
    await mod.getMetadata();

    expect(engineOf(mod).size).toBe(2);
    mod.dispose();
  });

  it('prunes the engine of a class that has been removed from disk', async () => {
    const { dataDir, paths } = makeModule([COMPONENT, CONTROL]);
    const mod = buildModule(dataDir, { classPath: paths.mfa, attributes: { mfa_enabled: true } });

    await mod.getMetadata();
    expect(engineOf(mod).size).toBe(2);
    expect(await mod.getCountermeasures('inst', 'class')).toHaveLength(1);

    fs.rmSync(path.join(dataDir, MODULE_NAME, 'control', 'mfa'), { recursive: true });
    await mod.getMetadata();

    expect(engineOf(mod).size).toBe(1);
    // Its policy is gone from disk, so the class short-circuits before evaluation.
    expect(await mod.getCountermeasures('inst', 'class')).toEqual([]);
    mod.dispose();
  });
});

describe('getMetadata — a policy that cannot be registered', () => {
  it('logs at error, keeps the module loadable, and fails only that class', async () => {
    const { dataDir, paths } = makeModule([
      COMPONENT,
      { classType: 'component', slug: 'broken', type: 'PROCESS', rego: NO_PACKAGE_REGO },
    ]);
    const mod = buildModule(dataDir, { classPath: paths.broken, attributes: { public: true } });

    const metadata = await mod.getMetadata();

    // The module still loads: 2 classes in metadata, 1 usable engine.
    expect(metadata.componentClasses).toHaveLength(2);
    expect(engineOf(mod).size).toBe(1);
    expect(stubLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to register'),
      expect.objectContaining({ failures: 1, classes: [paths.broken] }),
    );

    // And the broken class throws rather than reporting "no exposures". The lazy retry
    // re-reads the same unparseable source, so the error names the actual defect.
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(RegoPolicyError);
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(/declares no package/);
    mod.dispose();
  });

  it('frees a stale engine rather than answering from the previous source', async () => {
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: { public: true } });

    await mod.getMetadata();
    expect(await mod.getExposures('inst', 'class')).toHaveLength(1);

    // The class's policy is replaced by one that cannot register.
    fs.writeFileSync(path.join(dataDir, MODULE_NAME, 'component', 'web', 'policies.rego'), NO_PACKAGE_REGO);
    await mod.getMetadata();

    // The engine holding the old, parseable source is gone: a class whose current policy is
    // broken must fail, never keep answering from the source it used to have.
    expect(engineOf(mod).size).toBe(0);
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(/declares no package/);
    mod.dispose();
  });
});

describe('getExposures / getCountermeasures — in-process evaluation', () => {
  it('projects exposures with the exploited_by refs intact', async () => {
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: { public: true } });
    await mod.getMetadata();

    const [exp] = await mod.getExposures('inst', 'class');

    expect(exp.name).toBe('Publicly reachable');
    expect(exp.attackVector).toBe('NETWORK');
    expect(exp.score).toBe(8.6);
    expect(exp.exploitedBy).toEqual(EXPOSURE_DEF.exploited_by);
    expect((exp.exploitedBy as any)[0].attributes.justification).toBe('public-facing application');
    mod.dispose();
  });

  it('projects each known countermeasure verb, snake→camel, and drops unknown ones', async () => {
    const { dataDir, paths } = makeModule([CONTROL]);
    const mod = buildModule(dataDir, { classPath: paths.mfa, attributes: { mfa_enabled: true } });
    await mod.getMetadata();

    const [cm] = await mod.getCountermeasures('inst', 'class');

    expect(cm.respondsWith).toEqual(COUNTERMEASURE_DEF.responds_with);
    expect(cm.mitigates).toEqual(COUNTERMEASURE_DEF.mitigates);
    expect(cm.detects).toEqual(COUNTERMEASURE_DEF.detects);
    // The snake_case policy keys land on their camelCase interface fields.
    expect(cm.protectsAgainst).toEqual(COUNTERMEASURE_DEF.protects_against);
    expect(cm.respondsTo).toEqual(COUNTERMEASURE_DEF.responds_to);
    expect(cm.mitigates![0].attributes!.justification).toBe('stops stolen passwords');
    // Verbs the policy did not emit stay absent; an unknown verb key is never projected.
    expect(cm.isolates).toBeUndefined();
    expect(cm.restores).toBeUndefined();
    expect('degrades' in (cm as any)).toBe(false);
    mod.dispose();
  });

  it('defaults an attack_vector outside the CVSS enum to UNSPECIFIED, with a warning', async () => {
    const { dataDir, paths } = makeModule([
      { classType: 'component', slug: 'odd', type: 'PROCESS', rego: INVALID_AV_REGO },
    ]);
    const mod = buildModule(dataDir, { classPath: paths.odd, attributes: { public: true } });
    await mod.getMetadata();

    const [exp] = await mod.getExposures('inst', 'class');

    expect(exp.attackVector).toBe('UNSPECIFIED');
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid attackVector'),
      expect.objectContaining({ rawValue: 'CARRIER_PIGEON' }),
    );
    mod.dispose();
  });

  it('returns [] when the policy does not define the requested rule', async () => {
    // A control policy asked for exposures. dt-ws dispatches by element type so this is
    // unreachable in production, but [] is the honest answer to "no such rule".
    const { dataDir, paths } = makeModule([CONTROL]);
    const mod = buildModule(dataDir, { classPath: paths.mfa, attributes: { mfa_enabled: true } });
    await mod.getMetadata();

    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    mod.dispose();
  });

  it('resolves a class path with redundant separators', async () => {
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, {
      classPath: `${paths.web.replace(path.sep, `${path.sep}${path.sep}`)}${path.sep}`,
      attributes: { public: true },
    });
    await mod.getMetadata();

    expect(await mod.getExposures('inst', 'class')).toHaveLength(1);
    mod.dispose();
  });
});

describe('fail-loud contract survives the wiring', () => {
  it('throws when a rule halts on a type error, never returning []', async () => {
    // Regorus halts the whole set rule; mapping that to [] would silently zero the
    // element's exposures. `allowlist: false` is the wrong-typed argument.
    const { dataDir, paths } = makeModule([
      { classType: 'component', slug: 'bad', type: 'PROCESS', rego: WRONG_TYPE_REGO },
    ]);
    const mod = buildModule(dataDir, { classPath: paths.bad, attributes: { allowlist: false } });
    await mod.getMetadata();

    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(RegoEvalError);
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(/evaluation failed/);
    // Halts are counted — the post-migration heartbeat's leading regression indicator.
    expect((mod as any).stats.halts).toBe(2);
    expect((mod as any).stats.evaluations).toBe(0);

    // A missing key is undefined on both engines — only the wrong *type* diverges.
    (mod as any).dbOps.getInstantiationAttributes.mockResolvedValue({});
    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    mod.dispose();
  });

  it('throws for a missing element (null attributes) — never fabricates a clean result', async () => {
    // getInstantiationAttributes returns null only when the element node does not exist.
    // Reporting that as "no findings" would be a silent false-negative; the same
    // not-evaluated condition throws in DtRemoteModule, and the two must agree.
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: null });
    await mod.getMetadata();

    await expect(mod.getExposures('ghost', 'class')).rejects.toThrow(/not found for evaluation/);

    // An element that exists but has no instantiation attributes arrives as {} and
    // evaluates normally (no findings because no rule matches empty input).
    (mod as any).dbOps.getInstantiationAttributes.mockResolvedValue({});
    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    mod.dispose();
  });

  it('leaves the module usable after a throwing evaluation', async () => {
    const { dataDir, paths } = makeModule([
      { classType: 'component', slug: 'bad', type: 'PROCESS', rego: WRONG_TYPE_REGO },
    ]);
    const mod = buildModule(dataDir, { classPath: paths.bad, attributes: { allowlist: false } });
    await mod.getMetadata();

    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(RegoEvalError);

    // The throw must not poison the engine: a well-typed input still evaluates.
    (mod as any).dbOps.getInstantiationAttributes.mockResolvedValue({ allowlist: ['a'] });
    expect(await mod.getExposures('inst', 'class')).toHaveLength(1);
    mod.dispose();
  });

  it('registers on first use when getMetadata never ran, and says so', async () => {
    // `evalQuery` on an unregistered package yields undefined — a silent "no findings". A
    // caller that constructs a module and evaluates immediately (an in-repo e2e does exactly
    // this) must still get correct findings, and the lifecycle slip must be visible.
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: { public: true } });

    expect(engineOf(mod).size).toBe(0);
    expect(await mod.getExposures('inst', 'class')).toHaveLength(1);
    expect(engineOf(mod).size).toBe(1);
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not registered at load'),
      expect.objectContaining({ class: paths.web }),
    );
    mod.dispose();
  });

  it('never lets a lazy registration paper over an unusable policy', async () => {
    // The self-heal must not become a fail-open: an unparseable source throws here too.
    const { dataDir, paths } = makeModule([
      { classType: 'component', slug: 'iso', type: 'PROCESS', rego: `package t.iso\n\nexposures contains {"name":"E"} if {\n    data.other.helper == true\n}\n` },
    ]);
    const mod = buildModule(dataDir, { classPath: paths.iso, attributes: {} });

    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(RegoPolicyError);
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(/foreign package/);
    mod.dispose();
  });

});

describe('skip paths', () => {
  it('warns and returns [] when policies.rego is absent', async () => {
    const { dataDir, paths } = makeModule([{ classType: 'component', slug: 'bare', type: 'PROCESS' }]);
    const mod = buildModule(dataDir, { classPath: paths.bare, attributes: { public: true } });
    await mod.getMetadata();

    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    expect(stubLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Policies file not found'));
    mod.dispose();
  });

  it('returns [] for an empty policies.rego', async () => {
    const { dataDir, paths } = makeModule([{ classType: 'component', slug: 'empty', type: 'PROCESS', rego: '' }]);
    const mod = buildModule(dataDir, { classPath: paths.empty, attributes: { public: true } });
    await mod.getMetadata();

    expect(engineOf(mod).size).toBe(0);
    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    mod.dispose();
  });

  it('returns [] when the element has no instantiation attributes', async () => {
    // "No instantiation attributes" is `{}` (the Cypher COALESCE map for an existing
    // element with no IS_INSTANCE_OF edge) — `null` means the element node itself is
    // missing, which throws (see the missing-element test).
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: {} });
    await mod.getMetadata();

    expect(await mod.getExposures('inst', 'class')).toEqual([]);
    expect(await mod.getCountermeasures('inst', 'class')).toEqual([]);
    mod.dispose();
  });
});

describe('dispose', () => {
  it('reports that the engine is gone rather than reading freed memory', async () => {
    const { dataDir, paths } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: paths.web, attributes: { public: true } });
    await mod.getMetadata();
    expect(await mod.getExposures('inst', 'class')).toHaveLength(1);

    mod.dispose();

    // Not "null pointer passed to rust" — a typed error the platform can surface. Disposal
    // also clears the registry, so the lazy path is entered and refuses on the same grounds.
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(/disposed/);
    await expect(mod.getExposures('inst', 'class')).rejects.toThrow(RegoPolicyError);
  });

  it('is idempotent', async () => {
    const { dataDir } = makeModule([COMPONENT]);
    const mod = buildModule(dataDir, { classPath: '', attributes: {} });
    await mod.getMetadata();

    mod.dispose();
    expect(() => mod.dispose()).not.toThrow();
  });

});

describe('RegoPolicyError surfaces the reason a policy was rejected', () => {
  it('names the isolation violation', async () => {
    const rego = `package t.iso\n\nexposures contains {"name": "E"} if {\n    data.other.helper == true\n}\n`;
    const { dataDir } = makeModule([{ classType: 'component', slug: 'iso', type: 'PROCESS', rego }]);
    const mod = buildModule(dataDir, { classPath: '', attributes: {} });

    await mod.getMetadata();

    expect(engineOf(mod).size).toBe(0);
    expect(stubLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to register'),
      expect.objectContaining({ errors: [expect.stringContaining('foreign package')] }),
    );
    // The guard exists because a foreign `data.` reference evaluates to undefined, not an
    // error — an isolated engine would silently drop the clause.
    expect(new RegoPolicyError('x', 'k')).toBeInstanceOf(Error);
    mod.dispose();
  });
});
