/**
 * Exact vector search queries: the cosine expression per dialect, the parameters a query gets
 * (integer k, explicit nulls, unscoped module lists), the components scope, and the dialect self-test.
 */

import { describe, expect, it } from 'vitest';

import { buildRankQuery, clampK, cosineExpr, selfTestCypher, selfTestPasses, vectorDefect } from '../vector-search';

const int = (n: number) => ({ bolt: n });
const unit = [0.6, 0.8];

describe('cosineExpr', () => {
  it('uses the cosine function on Memgraph', () => {
    expect(cosineExpr('memgraph', 'n.embedding', '$vector')).toBe('vector_search.cosine_similarity(n.embedding, $vector)');
  });
  it('maps Neo4j back from (1 + cos) / 2 to the cosine', () => {
    expect(cosineExpr('neo4j', 'n.embedding', '$vector')).toBe('(2 * vector.similarity.cosine(n.embedding, $vector) - 1)');
  });
});

describe('buildRankQuery: classes', () => {
  const base = { corpus: 'classes' as const, label: 'ComponentClass' as const, vector: unit, profileId: 'p1', k: 3, threshold: 0.35 };

  it('filters on the profile, the vector length, the type and the module scope', () => {
    const { cypher } = buildRankQuery('memgraph', base, int);
    expect(cypher).toContain('MATCH (m:Module)-[:HAS_CLASS]->(n:ComponentClass)');
    expect(cypher).toContain('n.embeddingModel = $profileId');
    expect(cypher).toContain('size(n.embedding) = $dims');
    expect(cypher).toContain('($componentType IS NULL OR n.type = $componentType)');
    expect(cypher).toContain('($moduleIds IS NULL OR m.id IN $moduleIds)');
    expect(cypher).toContain('vector_search.cosine_similarity(n.embedding, $vector) AS score');
    expect(cypher).toContain('ORDER BY score DESC, id ASC');
    expect(cypher).toContain('LIMIT $k');
  });

  it('sends k and dims as integers and every optional parameter as an explicit null', () => {
    const { params } = buildRankQuery('neo4j', base, int);
    expect(params).toEqual({
      vector: unit,
      profileId: 'p1',
      dims: { bolt: 2 },
      threshold: 0.35,
      componentType: null,
      moduleIds: null,
      k: { bolt: 3 },
    });
  });

  it('treats an empty module list as unscoped and a null threshold as no floor', () => {
    const { params } = buildRankQuery('memgraph', { ...base, moduleIds: [], threshold: null }, int);
    expect(params.moduleIds).toBeNull();
    expect(params.threshold).toBeNull();
  });

  it('clamps k to 1..50', () => {
    expect(buildRankQuery('memgraph', { ...base, k: 500 }, int).params.k).toEqual({ bolt: 50 });
    expect(buildRankQuery('memgraph', { ...base, k: 0 }, int).params.k).toEqual({ bolt: 1 });
  });

  it('refuses a label outside the class labels', () => {
    expect(() => buildRankQuery('memgraph', { ...base, label: 'Model) DETACH DELETE (x' as any }, int)).toThrow(/not a class label/);
  });

  it('refuses a query vector that is not finite or has a zero norm', () => {
    expect(() => buildRankQuery('memgraph', { ...base, vector: [0, 0] }, int)).toThrow(/zero norm/);
    expect(() => buildRankQuery('memgraph', { ...base, vector: [1, Number.NaN] }, int)).toThrow(/non-finite/);
  });
});

describe('buildRankQuery: components', () => {
  it('requires the component scope and has no escape from it', () => {
    expect(() =>
      buildRankQuery('memgraph', { corpus: 'components', vector: unit, profileId: 'p1', k: 10, threshold: null, componentIds: null as any }, int),
    ).toThrow(/needs componentIds/);
    const { cypher, params } = buildRankQuery(
      'neo4j',
      { corpus: 'components', vector: unit, profileId: 'p1', k: 500, threshold: null, componentIds: ['c1'] },
      int,
    );
    expect(cypher).toContain('WHERE n.id IN $componentIds');
    expect(cypher).not.toContain('$componentIds IS NULL');
    expect(cypher).toContain('score IS NOT NULL');
    expect(params.k).toEqual({ bolt: 100 });
  });
});

describe('clampK', () => {
  it('clamps per corpus and survives garbage', () => {
    expect(clampK('components', 101)).toBe(100);
    expect(clampK('classes', Number.NaN)).toBe(1);
    expect(clampK('classes', 3.9)).toBe(3);
  });
});

describe('vectorDefect', () => {
  it('names the defect, or null for a good vector', () => {
    expect(vectorDefect(unit, 2)).toBeNull();
    expect(vectorDefect([1, 0, 0], 2)).toMatch(/length 3, expected 2/);
    expect(vectorDefect([1, Infinity], 2)).toMatch(/non-finite/);
    expect(vectorDefect([0, 0], 2)).toMatch(/zero norm/);
    expect(vectorDefect('x', 2)).toMatch(/not a list/);
  });
});

describe('dialect self-test', () => {
  it('scores orthogonal and opposite vectors with the dialect expression', () => {
    expect(selfTestCypher('neo4j')).toBe(
      'RETURN (2 * vector.similarity.cosine([1.0, 0.0], [0.0, 1.0]) - 1) AS orthogonal, (2 * vector.similarity.cosine([1.0, 0.0], [-1.0, 0.0]) - 1) AS opposite',
    );
  });
  it('passes on 0 and -1 only', () => {
    expect(selfTestPasses(0, -1)).toBe(true);
    expect(selfTestPasses(1e-9, -0.9999999)).toBe(true);
    expect(selfTestPasses(0.5, 0)).toBe(false); // the unmapped Neo4j scale
    expect(selfTestPasses(null, -1)).toBe(false);
  });
});
