import { describe, it, expect } from 'vitest';
import schema from '../frontend-manifest.schema.json';
import {
  FRONTEND_MANIFEST_FIELDS,
  FRONTEND_MANIFEST_VERSION,
  FrontendManifestError,
  HOST_API_FIELDS,
  assertFrontendManifest,
  parseFrontendManifest,
  validateFrontendManifest,
} from '../frontend-manifest';

const valid = () => ({
  manifestVersion: 1,
  components: ['report_dashboard', 'report_dialog'],
  hostApi: { min: 1, max: 2 },
});

const problemsOf = (value: unknown): string[] => {
  try {
    validateFrontendManifest(value);
  } catch (e) {
    expect(e).toBeInstanceOf(FrontendManifestError);
    return (e as FrontendManifestError).problems;
  }
  throw new Error('expected the manifest to be refused');
};

describe('validateFrontendManifest', () => {
  it('accepts a valid manifest, with or without a string $schema', () => {
    expect(validateFrontendManifest(valid())).toEqual(valid());
    expect(validateFrontendManifest({ $schema: './x.json', ...valid() })).toEqual(valid());
  });

  it('returns a fresh frozen copy holding only the declared fields', () => {
    const input = { $schema: './x.json', ...valid() };
    const out = validateFrontendManifest(input);
    expect(out).not.toBe(input);
    expect(out.components).not.toBe(input.components);
    expect(out.hostApi).not.toBe(input.hostApi);
    expect(Object.keys(out)).toEqual(['manifestVersion', 'components', 'hostApi']);
    expect(Object.isFrozen(out) && Object.isFrozen(out.components) && Object.isFrozen(out.hostApi)).toBe(true);
    (input.components as string[]).push('later');
    expect(out.components).toEqual(['report_dashboard', 'report_dialog']);
  });

  it('refuses a non-object', () => {
    for (const v of [null, undefined, 'x', 1, []]) expect(problemsOf(v)).toEqual(['not a JSON object']);
  });

  it('refuses a non-string $schema', () => {
    expect(problemsOf({ $schema: 42, ...valid() })).toContain('$schema must be a string');
  });

  it('refuses a missing or wrong manifestVersion', () => {
    const { manifestVersion: _drop, ...rest } = valid();
    expect(problemsOf(rest)).toContain('manifestVersion must be 1');
    expect(problemsOf({ ...valid(), manifestVersion: 2 })).toContain('manifestVersion must be 1');
    expect(problemsOf({ ...valid(), manifestVersion: '1' })).toContain('manifestVersion must be 1');
  });

  it('refuses empty, missing, oversized, malformed and duplicate component lists', () => {
    expect(problemsOf({ ...valid(), components: [] })).toContain('components must be a non-empty array');
    const { components: _drop, ...rest } = valid();
    expect(problemsOf(rest)).toContain('components must be a non-empty array');
    const many = Array.from({ length: 257 }, (_, i) => `k${i}`);
    expect(problemsOf({ ...valid(), components: many })).toEqual(['components must not list more than 256 keys']);
    expect(problemsOf({ ...valid(), components: ['ok', 'has space'] }).join()).toMatch(/"has space" must match/);
    expect(problemsOf({ ...valid(), components: ['1starts_with_digit'] }).join()).toMatch(/must match/);
    expect(problemsOf({ ...valid(), components: ['a'.repeat(129)] }).join()).toMatch(/must match/);
    expect(problemsOf({ ...valid(), components: [42] }).join()).toMatch(/key 42 must match/);
    expect(problemsOf({ ...valid(), components: [{}] }).join()).toMatch(/key a value of type object must match/);
    expect(problemsOf({ ...valid(), components: ['a', 'a'] })).toContain('component key "a" is listed twice');
  });

  it('refuses a missing, malformed, out-of-range or inverted hostApi', () => {
    const { hostApi: _drop, ...rest } = valid();
    expect(problemsOf(rest)).toContain('hostApi must be an object { min, max }');
    const range = 'must be an integer from 1 to 1000';
    expect(problemsOf({ ...valid(), hostApi: { min: 0, max: 1 } })).toContain(`hostApi.min ${range}`);
    expect(problemsOf({ ...valid(), hostApi: { min: 1, max: 1.5 } })).toContain(`hostApi.max ${range}`);
    expect(problemsOf({ ...valid(), hostApi: { min: 1, max: 1001 } })).toContain(`hostApi.max ${range}`);
    expect(problemsOf({ ...valid(), hostApi: { min: 1, max: Infinity } })).toContain(`hostApi.max ${range}`);
    expect(problemsOf({ ...valid(), hostApi: { min: 3, max: 2 } })).toContain('hostApi.min must not exceed hostApi.max');
  });

  it('refuses unknown fields at both levels, prototype keys included, and quotes their names', () => {
    expect(problemsOf({ ...valid(), entry: 'bundle.js' })).toContain('unknown field "entry"');
    expect(problemsOf({ ...valid(), hostApi: { min: 1, max: 1, exact: 1 } })).toContain('unknown field hostApi."exact"');
    expect(problemsOf(JSON.parse('{"__proto__":{},"manifestVersion":1,"components":["a"],"hostApi":{"min":1,"max":1}}')))
      .toContain('unknown field "__proto__"');
    expect(problemsOf({ ...valid(), 'x\n[ERROR] forged': 1 })).toContain('unknown field "x\\n[ERROR] forged"');
    expect(problemsOf({ ...valid(), 'a\u2028b\u202Ec': 1 })).toContain('unknown field "a\\u2028b\\u202ec"');
  });

  it('names every problem at once, up to 20, and shortens long values', () => {
    expect(problemsOf({ manifestVersion: 0, components: [], hostApi: null })).toHaveLength(3);
    const bad = Array.from({ length: 30 }, (_, i) => `bad key ${i}`);
    const problems = problemsOf({ ...valid(), components: bad });
    expect(problems).toHaveLength(21);
    expect(problems[20]).toBe('and 10 more');
    const [long] = problemsOf({ ...valid(), components: [`x y${'z'.repeat(500)}`] });
    expect(long.length).toBeLessThan(150);
  });
});

describe('parseFrontendManifest', () => {
  it('parses file text, ignoring a UTF-8 BOM', () => {
    expect(parseFrontendManifest(`﻿${JSON.stringify(valid())}`)).toEqual(valid());
  });

  it('reports a JSON syntax error as a FrontendManifestError', () => {
    expect(() => parseFrontendManifest('{ not json')).toThrow(FrontendManifestError);
    expect(() => parseFrontendManifest('{ not json')).toThrow(/not valid JSON/);
  });

  it('escapes the input snippet a syntax error quotes', () => {
    try {
      parseFrontendManifest('x\n[ERROR] forged');
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as FrontendManifestError).problems[0]).not.toMatch(/\n/);
    }
  });
});

describe('the JSON schema matches the validator', () => {
  it('declares exactly the fields the validator checks, with the same rules', () => {
    expect(Object.keys(schema.properties)).toEqual([...FRONTEND_MANIFEST_FIELDS]);
    expect(Object.keys(schema.properties.hostApi.properties)).toEqual([...HOST_API_FIELDS]);
    expect(schema.properties.$schema).toEqual({ type: 'string' });
    expect(schema.properties.manifestVersion.const).toBe(FRONTEND_MANIFEST_VERSION);
    expect(schema.required).toEqual(['manifestVersion', 'components', 'hostApi']);
    expect(schema.additionalProperties).toBe(false);
    const { components, hostApi } = schema.properties;
    expect(components).toMatchObject({ type: 'array', minItems: 1, maxItems: 256, uniqueItems: true });
    expect(components.items.type).toBe('string');
    expect(hostApi).toMatchObject({ type: 'object', required: ['min', 'max'], additionalProperties: false });
    expect(hostApi.properties.min).toEqual({ type: 'integer', minimum: 1, maximum: 1000 });
    expect(hostApi.properties.max).toEqual({ type: 'integer', minimum: 1, maximum: 1000 });
  });
});

describe('assertFrontendManifest', () => {
  const component = {};
  const frontendRegistering = (...keys: string[]) => ({
    install(deps: any) {
      for (const key of keys) deps.services.componentRegistry.register(key, component, 'some-module');
    },
  });

  it('passes when install() registers exactly the declared keys, in any order', async () => {
    await expect(
      assertFrontendManifest(frontendRegistering('report_dialog', 'report_dashboard'), valid()),
    ).resolves.toEqual(valid());
  });

  it('awaits an async install()', async () => {
    const frontend = {
      async install(deps: any) {
        await Promise.resolve();
        deps.services.componentRegistry.register('report_dashboard', component);
        deps.services.componentRegistry.register('report_dialog', component);
      },
    };
    await expect(assertFrontendManifest(frontend, valid())).resolves.toEqual(valid());
  });

  it('fails on a declared key that install() does not register', async () => {
    await expect(assertFrontendManifest(frontendRegistering('report_dashboard'), valid())).rejects.toThrow(
      /declared but not registered: report_dialog/,
    );
  });

  it('fails on a registered key the manifest does not declare', async () => {
    await expect(
      assertFrontendManifest(frontendRegistering('report_dashboard', 'report_dialog', 'stray'), valid()),
    ).rejects.toThrow(/registered but not declared: stray/);
  });

  it('fails on a key registered twice', async () => {
    await expect(
      assertFrontendManifest(frontendRegistering('report_dashboard', 'report_dialog', 'report_dialog'), valid()),
    ).rejects.toThrow(/registered more than once: report_dialog/);
  });

  it('refuses a missing component as the host would, so a caught refusal reads as unregistered', async () => {
    const frontend = {
      install(deps: any) {
        deps.services.componentRegistry.register('report_dashboard', component);
        try {
          deps.services.componentRegistry.register('report_dialog', undefined);
        } catch {
          // a module that logs a failed registration and carries on
        }
      },
    };
    await expect(assertFrontendManifest(frontend, valid())).rejects.toThrow(/declared but not registered: report_dialog/);
  });

  it('refuses a non-string key', async () => {
    const frontend = { install: (deps: any) => deps.services.componentRegistry.register(7, component) };
    await expect(assertFrontendManifest(frontend, valid())).rejects.toThrow(/key 7 is not a string/);
  });

  it('fails on an invalid manifest before running install()', async () => {
    let ran = false;
    const frontend = { install: () => { ran = true; } };
    await expect(assertFrontendManifest(frontend, { ...valid(), manifestVersion: 2 })).rejects.toBeInstanceOf(
      FrontendManifestError,
    );
    expect(ran).toBe(false);
  });

  it('fails on a frontend without install()', async () => {
    await expect(assertFrontendManifest({} as any, valid())).rejects.toThrow(/no install\(\) function/);
  });
});
