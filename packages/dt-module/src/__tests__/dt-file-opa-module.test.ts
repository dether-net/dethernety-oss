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

import { describe, it, expect, vi } from 'vitest';

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
