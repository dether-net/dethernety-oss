/**
 * Exact vector search in Cypher, for Memgraph and Neo4j.
 *
 * Every candidate node is scored with the database's own cosine function and the query keeps the
 * top k: no vector index, so filters are ordinary WHERE clauses. The only dialect-specific piece is
 * the score expression. Neo4j's `vector.similarity.cosine` returns (1 + cos) / 2, so it is mapped
 * back to the cosine; a threshold or a score therefore means the same on both engines.
 *
 * Every query also filters on the embedding profile (`embeddingModel`) and the vector length, so a
 * vector made by another model is never compared with the query.
 *
 * This module builds Cypher and parameters only; it never touches a driver. Bolt integers come from
 * the caller's `int` factory, because this package carries no neo4j-driver.
 */

export type Dialect = 'memgraph' | 'neo4j';

/** Cosine of two lists on either engine. */
export function cosineExpr(dialect: Dialect, stored: string, query: string): string {
  return dialect === 'memgraph'
    ? `vector_search.cosine_similarity(${stored}, ${query})`
    : `(2 * vector.similarity.cosine(${stored}, ${query}) - 1)`;
}

/** The class labels the classes corpus may search. Never taken from caller input. */
export const CLASS_LABELS = ['ComponentClass', 'ControlClass', 'DataFlowClass', 'SecurityBoundaryClass', 'DataClass'] as const;
export type ClassLabel = (typeof CLASS_LABELS)[number];

export interface ClassRankRequest {
  corpus: 'classes';
  label: ClassLabel;
  vector: number[];
  profileId: string;
  /** Clamped to 1..50. */
  k: number;
  /** Cosine floor; null for none. */
  threshold: number | null;
  componentType?: string | null;
  /** An empty list means unscoped. */
  moduleIds?: string[] | null;
}

export interface ComponentRankRequest {
  corpus: 'components';
  vector: number[];
  profileId: string;
  /** Clamped to 1..100. */
  k: number;
  threshold: number | null;
  /** Required: the components in scope. */
  componentIds: string[];
}

export type RankRequest = ClassRankRequest | ComponentRankRequest;

const K_MAX = { classes: 50, components: 100 } as const;

export function clampK(corpus: keyof typeof K_MAX, k: number): number {
  const n = Math.floor(Number(k));
  if (!Number.isFinite(n)) return 1;
  return Math.min(K_MAX[corpus], Math.max(1, n));
}

/** Why a vector cannot be stored or searched with: wrong length, a non-finite value or a zero norm. */
export function vectorDefect(vector: unknown, dimensions: number): string | null {
  if (!Array.isArray(vector)) return 'not a list';
  if (vector.length !== dimensions) return `length ${vector.length}, expected ${dimensions}`;
  let sumSq = 0;
  for (const v of vector) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'a non-finite value';
    sumSq += v * v;
  }
  if (sumSq === 0) return 'a zero norm';
  return null;
}

/**
 * The Cypher and parameters for one exact search. `int` turns a JS number into a Bolt integer
 * (neo4j-driver's `neo4j.int`), so `LIMIT $k` gets an integer on both engines.
 */
export function buildRankQuery(
  dialect: Dialect,
  request: RankRequest,
  int: (n: number) => unknown,
): { cypher: string; params: Record<string, unknown> } {
  const defect = vectorDefect(request.vector, request.vector.length);
  if (defect) throw new Error(`query vector has ${defect}`);
  const score = cosineExpr(dialect, 'n.embedding', '$vector');
  const common = {
    vector: request.vector,
    profileId: request.profileId,
    dims: int(request.vector.length),
    threshold: request.threshold ?? null,
  };

  if (request.corpus === 'classes') {
    if (!CLASS_LABELS.includes(request.label)) throw new Error(`not a class label: ${String(request.label)}`);
    const moduleIds = request.moduleIds && request.moduleIds.length > 0 ? request.moduleIds : null;
    return {
      cypher: `MATCH (m:Module)-[:HAS_CLASS]->(n:${request.label})
WHERE n.embedding IS NOT NULL
  AND n.embeddingModel = $profileId
  AND size(n.embedding) = $dims
  AND ($componentType IS NULL OR n.type = $componentType)
  AND ($moduleIds IS NULL OR m.id IN $moduleIds)
WITH n, m, ${score} AS score
WHERE $threshold IS NULL OR score >= $threshold
RETURN n.id AS id, n.name AS name, n.description AS description, n.category AS category, n.type AS type,
       m.id AS moduleId, m.name AS moduleName, score
ORDER BY score DESC, id ASC
LIMIT $k`,
      params: {
        ...common,
        componentType: request.componentType ?? null,
        moduleIds,
        k: int(clampK('classes', request.k)),
      },
    };
  }

  if (!Array.isArray(request.componentIds)) throw new Error('a component search needs componentIds');
  return {
    cypher: `MATCH (n:Component)
WHERE n.id IN $componentIds
  AND n.embedding IS NOT NULL
  AND n.embeddingModel = $profileId
  AND size(n.embedding) = $dims
WITH n, ${score} AS score
WHERE score IS NOT NULL AND ($threshold IS NULL OR score >= $threshold)
RETURN n.id AS id, n.name AS name, score
ORDER BY score DESC, id ASC
LIMIT $k`,
    params: { ...common, componentIds: request.componentIds, k: int(clampK('components', request.k)) },
  };
}

/**
 * A check that the engine has the cosine function and that its scale maps as expected: orthogonal
 * vectors must score 0 and opposite vectors -1. Failing it means the vector tier must stay off.
 */
export function selfTestCypher(dialect: Dialect): string {
  return `RETURN ${cosineExpr(dialect, '[1.0, 0.0]', '[0.0, 1.0]')} AS orthogonal, ${cosineExpr(dialect, '[1.0, 0.0]', '[-1.0, 0.0]')} AS opposite`;
}

export function selfTestPasses(orthogonal: unknown, opposite: unknown): boolean {
  if (orthogonal === null || orthogonal === undefined || opposite === null || opposite === undefined) return false;
  const o = Number(orthogonal);
  const p = Number(opposite);
  return Number.isFinite(o) && Number.isFinite(p) && Math.abs(o) < 1e-6 && Math.abs(p + 1) < 1e-6;
}
