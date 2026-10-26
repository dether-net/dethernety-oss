/**
 * Pins the `where` that `DtAnalysis.findAnalyses()` sends. Opening a model calls it with the model's id, and the
 * element filter runs over `Analysis.element`, a relationship to the Element interface: `single` there renders as a
 * XOR across every member type, which Neo4j cannot plan and the platform refuses, so the filter must be `some`. The
 * query itself runs against both engines in `oss/apps/dt-ws/test/integration/model-open-queries.e2e-spec.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import * as Apollo from '@apollo/client';

import { DtAnalysis } from '../dt-analysis.js';

function buildHarness() {
  const dt = new DtAnalysis({} as Apollo.ApolloClient);
  const performQuery = vi.fn(async (_input: { variables: { condition: { AND: Record<string, unknown> } } }) => ({
    analyses: [],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dt as any).dtUtils.performQuery = performQuery;
  return { dt, performQuery };
}

describe('DtAnalysis.findAnalyses — the where it sends', () => {
  it('filters by element with `some`, never `single`', async () => {
    const { dt, performQuery } = buildHarness();
    await dt.findAnalyses({ elementId: 'model-1' });

    const condition = performQuery.mock.calls[0][0].variables.condition;
    expect(condition).toEqual({ AND: { element: { some: { id: { eq: 'model-1' } } } } });
  });

  it('uses `single` only on a relationship to a concrete type (the class)', async () => {
    const { dt, performQuery } = buildHarness();
    await dt.findAnalyses({ elementId: 'model-1', classId: 'class-1', classType: 'model_analysis' });

    const condition = performQuery.mock.calls[0][0].variables.condition;
    expect(condition.AND.element).toEqual({ some: { id: { eq: 'model-1' } } });
    expect(condition.AND.analysisClass).toEqual({ single: { id: { eq: 'class-1' }, type: { eq: 'model_analysis' } } });
  });

  it('filters by module through the class, the only way an analysis belongs to one', async () => {
    const { dt, performQuery } = buildHarness();
    await dt.findAnalyses({ classType: 'model_analysis', moduleId: 'module-1' });

    expect(performQuery.mock.calls[0][0].variables.condition).toEqual({
      AND: { analysisClass: { single: { type: { eq: 'model_analysis' }, module: { single: { id: { eq: 'module-1' } } } } } },
    });
  });

  it('sends no element filter without an element id', async () => {
    const { dt, performQuery } = buildHarness();
    await dt.findAnalyses({ analysisId: 'analysis-1' });

    expect(performQuery.mock.calls[0][0].variables.condition).toEqual({ AND: { id: { eq: 'analysis-1' } } });
  });
});
