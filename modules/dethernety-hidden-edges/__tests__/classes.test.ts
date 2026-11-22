/**
 * The hidden-edge classes the module ships: one per kind, its id held only in its class file, the category, the fixed
 * template (the base fields, the fields Dethereal writes, the kind's own fields from the table, and nothing else)
 * and the generic policy and its tests, copied unchanged apart from the package line.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClassFileError, HIDDEN_EDGE_CATEGORY, readKindClasses } from '../src/classes';
import { EDGE_KINDS } from '../src/table';
import table from '../src/edge-kinds.json';
import { createHash } from 'node:crypto';
import DethernetyHiddenEdgesModule from '../src/DethernetyHiddenEdgesModule';
import { MODULE_VERSION } from '../src/contract';
import { classFiles, fakeDriver } from './fixtures';

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'dethernety-hidden-edges');
const read = (rel: string) => readFileSync(path.join(DATA, rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel));
const kinds = [...EDGE_KINDS];

const BASE = {
  required_capability: ['opportunistic', 'targeted', 'advanced'],
  required_privilege: ['none', 'user', 'admin', 'system'],
  granted_privilege: ['none', 'user', 'admin', 'system'],
};
const DETHEREAL = ['hidden_edge_kind', 'technique_ids', 'source_exposure_ids', 'proposed_by', 'tier', 'rationale'];

describe('the hidden-edge classes', () => {
  it('are one data flow class per kind, and nothing else', () => {
    expect(readdirSync(DATA).sort()).toEqual(['dataFlow', 'module.json']);
    expect(readdirSync(path.join(DATA, 'dataFlow')).sort()).toEqual([...kinds].sort());
    expect(json('module.json')).toMatchObject({ name: 'dethernety-hidden-edges', classCount: kinds.length });
  });

  for (const kind of kinds) {
    describe(kind, () => {
      it('has an id and a name, in the hidden-edge category', () => {
        expect(json(`dataFlow/${kind}/class.json`)).toMatchObject({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: expect.stringMatching(/^Hidden Edge: /), classType: 'dataFlow', type: 'dataFlow', category: HIDDEN_EDGE_CATEGORY });
        expect(json(`dataFlow/${kind}/class.json`).description).toMatch(/^An inferred attack path reviewed by the operator, not a declared flow/);
      });

      it('carries the fixed template: the base fields, the fields Dethereal writes, its own fields, in that order', () => {
        const props = json(`dataFlow/${kind}/schema.json`).schema.properties as Record<string, any>;
        const own = (table.kinds.find((k) => k.kind === kind)?.fields ?? []) as Array<{ name: string; values: string[] }>;
        expect(Object.keys(props)).toEqual([...Object.keys(BASE), ...DETHEREAL, ...own.map((f) => f.name)]);
        for (const [k, values] of Object.entries(BASE)) expect(props[k]).toMatchObject({ type: 'string', enum: values });
        expect(props.hidden_edge_kind).toMatchObject({ type: 'string', enum: [kind], readOnly: true });
        expect(props.technique_ids).toMatchObject({ type: 'array', items: { type: 'string' } });
        expect(props.source_exposure_ids).toMatchObject({ type: 'array', items: { type: 'string' } });
        expect(props.proposed_by).toMatchObject({ type: 'string', enum: ['rule', 'operator'] });
        expect(props.tier).toMatchObject({ type: 'string', enum: ['high', 'medium', 'low'] });
        expect(props.rationale).toMatchObject({ type: 'string' });
        for (const f of own) expect(props[f.name]).toMatchObject({ type: 'string', enum: f.values });
        for (const p of Object.values(props)) expect(p.description, kind).toBeTruthy();
      });

      it('carries the generic policy and its tests, unchanged apart from a package line of its own', () => {
        const generic = readFileSync(path.join(ROOT, 'class-template', 'policies.rego'), 'utf8');
        const policy = read(`dataFlow/${kind}/policies.rego`);
        expect(policy.split('\n')[0]).toBe(`package _dt_built_in.exposures.hidden_edge_${kind.replace(/-/g, '_')}`);
        expect(policy.split('\n').slice(1)).toEqual(generic.split('\n').slice(1));
        expect(read(`dataFlow/${kind}/tests.json`)).toBe(readFileSync(path.join(ROOT, 'class-template', 'tests.json'), 'utf8'));
      });
    });
  }

  it('load and evaluate through the module itself: each class registers its policy, and a flow of it gets its exposure', async () => {
    const errors: unknown[] = [];
    const log = { log() {}, warn() {}, debug() {}, verbose() {}, error: (...a: unknown[]) => errors.push(a) } as any;
    const mod = new DethernetyHiddenEdgesModule({}, log);
    const meta = await mod.getMetadata();
    const empty = createHash('sha256').update('').digest('hex');
    for (const cls of meta.dataFlowClasses ?? []) expect(typeof (cls as any).policyHash === 'string' && (cls as any).policyHash !== empty, cls.name).toBe(true);
    expect(errors).toEqual([]);
    for (const kind of kinds) {
      const cls = (meta.dataFlowClasses ?? []).find((c) => c.id === classFiles()[kind].id)! as any;
      (mod as any).dbOps = {
        getAttribute: async () => cls.path,
        getInstantiationAttributes: async () => ({ technique_ids: ['T1021'], tier: 'high', hidden_edge_kind: kind, granted_privilege: 'admin' }),
      };
      const exposures = await mod.getExposures('flow-1', cls.id);
      // the platform keeps the score, which follows what the path grants (admin: 7.5)
      expect(exposures.map((e: any) => [e.name, e.category, e.score])).toEqual([[`Inferred ${kind.replace(/-/g, ' ')} path: T1021`, 'Inferred Path', 7.5]]);
      expect((exposures[0] as any).attackVector).toBe(kind === 'host-escape' ? 'LOCAL' : kind === 'credential-capture' ? 'ADJACENT' : 'NETWORK');
    }
    mod.dispose();
  });

  it('name each candidate’s class as its kind’s class file holds it, ids distinct', async () => {
    const files = classFiles();
    expect(new Set(Object.values(files).map((c) => c.id)).size).toBe(kinds.length);
    const answer: any = await new DethernetyHiddenEdgesModule(fakeDriver().driver, { log() {}, warn() {}, error() {} } as any).candidates({ modelId: 'm' });
    expect(answer.candidates.length).toBeGreaterThan(0);
    for (const c of answer.candidates) expect(c.class, c.kind).toEqual(files[c.kind]);
  });

  it('fail the load when a class file is missing, malformed, out of the category, or repeats an id', () => {
    const at = mkdtempSync(path.join(tmpdir(), 'hidden-edge-classes-'));
    try {
      cpSync(path.join(ROOT, 'data'), at, { recursive: true });
      expect(readKindClasses(at)).toEqual(classFiles());
      const file = (kind: string) => path.join(at, 'dethernety-hidden-edges', 'dataFlow', kind, 'class.json');
      const original = readFileSync(file('host-escape'), 'utf8');
      const broken = [
        '{',
        JSON.stringify({ ...JSON.parse(original), id: '' }),
        JSON.stringify({ ...JSON.parse(original), category: 'Network' }),
        JSON.stringify({ ...JSON.parse(original), id: classFiles()['remote-service'].id }),
      ];
      for (const text of broken) {
        writeFileSync(file('host-escape'), text);
        expect(() => readKindClasses(at), text).toThrow(ClassFileError);
      }
      rmSync(file('host-escape'));
      expect(() => readKindClasses(at)).toThrow(ClassFileError);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  it('carry one version: the module’s, its data’s and its package’s', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect([json('module.json').version, manifest.version, pkg.version]).toEqual([MODULE_VERSION, MODULE_VERSION, MODULE_VERSION]);
  });
});
