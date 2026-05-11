/**
 * Unit tests for the `DtAnalysis.createAnalysis()` wrapper, which targets
 * the `createAnalysisIdempotent` mutation. The mutation itself is
 * exercised end-to-end against Memgraph in
 * `oss/apps/dt-ws/test/integration/create-analysis-idempotent.e2e-spec.ts`.
 * These tests pin the wrapper-side contract (variable pass-through,
 * dataPath extraction, response shape, dedupe-key stability) without
 * spinning a DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Apollo from '@apollo/client';

import { DtAnalysis } from '../dt-analysis.js';

interface PerformMutationCall {
  mutation: unknown;
  variables: Record<string, unknown>;
  dataPath: string;
  action: string;
  deduplicationKey?: string | false;
}

function buildHarness(mutationResult: unknown) {
  const calls: PerformMutationCall[] = [];
  const apolloClient = {} as Apollo.ApolloClient;
  const dt = new DtAnalysis(apolloClient);
  // Replace the underlying dtUtils.performMutation with a spy that captures
  // call shape and returns the prepared result. Casting to unknown→any is the
  // canonical vitest pattern for stubbing private fields without exposing
  // them in production typings.
  const performMutation = vi.fn(async (input: PerformMutationCall) => {
    calls.push(input);
    return mutationResult;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dt as any).dtUtils.performMutation = performMutation;
  return { dt, calls, performMutation };
}

describe('DtAnalysis.createAnalysis (createAnalysisIdempotent wrapper)', () => {
  const baseInput = {
    id: 'analysis-id-1',
    elementId: 'element-id-1',
    name: 'Risk Analysis',
    description: 'A description',
    type: 'attack-tree',
    category: 'security',
    analysisClassId: 'class-id-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the caller-supplied id through to the mutation variables', async () => {
    const { dt, calls } = buildHarness({
      id: 'analysis-id-1',
      name: 'Risk Analysis',
      analysisClass: [{ id: 'class-id-1', name: 'Risk' }],
    });

    await dt.createAnalysis(baseInput);

    expect(calls).toHaveLength(1);
    expect(calls[0].variables.id).toBe('analysis-id-1');
    expect(calls[0].variables.elementId).toBe('element-id-1');
    expect(calls[0].variables.analysisClassId).toBe('class-id-1');
  });

  it('targets dataPath "createAnalysisIdempotent" (singular, not the legacy "createAnalyses.analyses")', async () => {
    const { dt, calls } = buildHarness({
      id: 'analysis-id-1',
      name: 'Risk Analysis',
      analysisClass: [{ id: 'class-id-1', name: 'Risk' }],
    });

    await dt.createAnalysis(baseInput);

    expect(calls[0].dataPath).toBe('createAnalysisIdempotent');
  });

  it('handles single-object response (the @cypher mutation returns Analysis, not [Analysis])', async () => {
    const { dt } = buildHarness({
      id: 'analysis-id-1',
      name: 'Risk Analysis',
      analysisClass: [{ id: 'class-id-1', name: 'Risk' }],
    });

    const result = await dt.createAnalysis(baseInput);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('analysis-id-1');
    expect(result?.name).toBe('Risk Analysis');
  });

  it('collapses analysisClass list-shape to singleton (schema is [AnalysisClass!]! but each Analysis has exactly one)', async () => {
    const { dt } = buildHarness({
      id: 'analysis-id-1',
      name: 'Risk Analysis',
      analysisClass: [{ id: 'class-id-1', name: 'Risk' }],
    });

    const result = await dt.createAnalysis(baseInput);

    // analysisClass on the returned value is the singleton, not the list.
    expect(result?.analysisClass).toEqual({ id: 'class-id-1', name: 'Risk' });
  });

  it('returns null when the mutation yields no data', async () => {
    const { dt } = buildHarness(null);

    const result = await dt.createAnalysis(baseInput);

    expect(result).toBeNull();
  });

  it('uses a stable dedupe key keyed on id (idempotent retries collapse)', async () => {
    const { dt, calls } = buildHarness({
      id: 'analysis-id-1',
      analysisClass: [{ id: 'class-id-1', name: 'Risk' }],
    });

    await dt.createAnalysis(baseInput);
    await dt.createAnalysis(baseInput);

    expect(calls).toHaveLength(2);
    expect(calls[0].deduplicationKey).toBe('create-analysis-analysis-id-1');
    expect(calls[1].deduplicationKey).toBe('create-analysis-analysis-id-1');
    // Same id → same dedupe key. The actual dedupe-merge behaviour lives in
    // dtUtils.withDeduplication; this asserts the key derivation contract.
  });

  it('coerces optional type/category to empty string (matches the platform mutation contract)', async () => {
    const { dt, calls } = buildHarness({
      id: 'analysis-id-1',
      analysisClass: [],
    });

    await dt.createAnalysis({
      id: 'analysis-id-1',
      elementId: 'element-id-1',
      name: 'Bare Analysis',
      description: '',
      analysisClassId: 'class-id-1',
    });

    expect(calls[0].variables.type).toBe('');
    expect(calls[0].variables.category).toBe('');
  });
});
