/**
 * The DTModule content-method contract: the optional trailing `token?: string`
 * and the `isContentCallerVariant?()` predicate are additive and source-compatible.
 *
 * Two things are asserted here, and they are proven by two different mechanisms:
 *   1. TYPE assignability — a module written WITHOUT the token param and one written
 *      WITH it BOTH satisfy `DTModule`. This is asserted by typing each fixture
 *      `: DTModule`; it is only actually checked when the package is typechecked
 *      (`tsc --noEmit -p tsconfig.json`), NOT by this vitest run (vitest transpiles
 *      via esbuild and strips types).
 *   2. RUNTIME arity/absence behavior — a token-ignoring implementation still works
 *      when called with an extra argument, and a token-aware one reads it. That is
 *      what the `it()` blocks below exercise.
 */

import { describe, it, expect } from 'vitest';
import { DTModule } from '../interfaces/module-interface';

/** Old shape: no `token` parameter, no `isContentCallerVariant`. Must still satisfy DTModule. */
const noTokenModule: DTModule = {
  getMetadata: () => ({ name: 'no-token-fixture' }),
  getClassTemplate: async (_id: string) => 'template',
  getClassGuide: async (_id: string) => 'guide',
  getExposures: async (_id: string, _classId: string) => [],
  getCountermeasures: async (_id: string, _classId: string) => [],
};

/** New shape: token-aware content methods + caller-variance declared. Must satisfy DTModule. */
const tokenAwareModule: DTModule = {
  getMetadata: () => ({ name: 'token-aware-fixture' }),
  getClassTemplate: async (_id: string, token?: string) => token ?? 'anon',
  getClassGuide: async (_id: string, token?: string) => token ?? 'anon',
  getExposures: async (_id: string, _classId: string, _token?: string) => [],
  getCountermeasures: async (_id: string, _classId: string, _token?: string) => [],
  isContentCallerVariant: () => true,
};

describe('DTModule content-method contract', () => {
  it('a token-ignoring module tolerates an extra positional argument', async () => {
    // The platform will call every module with the token; a module that never declared
    // it must ignore the extra arg and behave identically.
    await expect(noTokenModule.getClassTemplate!('id', 'ignored-token')).resolves.toBe('template');
    await expect(noTokenModule.getClassGuide!('id', 'ignored-token')).resolves.toBe('guide');
    await expect(noTokenModule.getExposures!('id', 'classId', 'ignored-token')).resolves.toEqual([]);
    await expect(noTokenModule.getCountermeasures!('id', 'classId', 'ignored-token')).resolves.toEqual([]);
  });

  it('a token-aware module receives the token, and tolerates its absence', async () => {
    await expect(tokenAwareModule.getClassTemplate!('id', 'the-bearer')).resolves.toBe('the-bearer');
    await expect(tokenAwareModule.getClassGuide!('id', 'the-bearer')).resolves.toBe('the-bearer');
    // Absence (dev/NOAUTH or no bearer) → the module's own absence policy, no crash.
    await expect(tokenAwareModule.getClassTemplate!('id')).resolves.toBe('anon');
    await expect(tokenAwareModule.getClassGuide!('id')).resolves.toBe('anon');
  });

  it('caller-variance is opt-in: true when declared', () => {
    expect(tokenAwareModule.isContentCallerVariant!()).toBe(true);
  });

  it('caller-variance defaults to absent (== false == cacheable) when not declared', () => {
    expect(noTokenModule.isContentCallerVariant).toBeUndefined();
  });
});
