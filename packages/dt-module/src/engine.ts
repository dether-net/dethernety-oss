/**
 * Graph-engine detection shared by the platform and by modules.
 *
 * Both supported engines answer `CALL dbms.components()`: Neo4j with
 * `name: "Neo4j Kernel"` and its real edition, Memgraph with `name: "Memgraph"`
 * (and a Neo4j-compatible version string). Consumers branch Cypher dialects on
 * `engine`; `edition` gates Neo4j-Enterprise-only features.
 */

import type { ModuleResolverContext } from './interfaces/module-resolver-interface';

export type Dialect = 'memgraph' | 'neo4j';

export interface EngineInfo {
  readonly engine: Dialect;
  readonly edition: string | null;
  readonly version: string | null;
}

export const ENGINE_PROBE_CYPHER =
  'CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition';

/** Thrown when the engine cannot be determined; callers decide what a missing answer means. */
export class EngineProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineProbeError';
  }
}

/**
 * Read an engine from one `dbms.components()` row. A component name that names
 * neither engine is an error, never a guess. The answer is frozen, because one
 * answer is shared by every caller of a memoized probe.
 */
export function engineFromComponents(name: unknown, versions: unknown, edition: unknown): EngineInfo {
  const componentName = String(name ?? '');
  let engine: Dialect;
  if (/memgraph/i.test(componentName)) engine = 'memgraph';
  else if (/neo4j/i.test(componentName)) engine = 'neo4j';
  else throw new EngineProbeError(`unrecognised graph engine component "${componentName}"`);
  return Object.freeze({
    engine,
    edition: edition != null ? String(edition) : null,
    version: Array.isArray(versions) && versions.length > 0 ? String(versions[0]) : null,
  });
}

/** Run the probe once on `driver`, in a session of its own. Rejects on any failure. */
export async function probeEngine(driver: any, databaseName?: string): Promise<EngineInfo> {
  const session = driver.session(databaseName ? { database: databaseName } : {});
  try {
    const result = await session.run(ENGINE_PROBE_CYPHER);
    const record = result.records[0];
    if (!record) throw new EngineProbeError('dbms.components() returned no rows');
    return engineFromComponents(record.get('name'), record.get('versions'), record.get('edition'));
  } finally {
    try {
      await session.close();
    } catch {
      // A failure to close must not replace the probe's own outcome.
    }
  }
}

/**
 * A memoized probe. A successful answer is kept for the resolver's lifetime;
 * a failure is not kept, so the next call probes again, and every caller of the
 * failed attempt sees the rejection.
 */
export function createEngineResolver(driver: any, databaseName?: string): () => Promise<EngineInfo> {
  let pending: Promise<EngineInfo> | undefined;
  return () => {
    if (!pending) {
      pending = probeEngine(driver, databaseName).catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

const fallbackResolvers = new WeakMap<object, () => Promise<EngineInfo>>();

/**
 * The engine behind a module's resolver context. A platform that predates
 * `getEngine` gets a probe on the context's driver instead, memoized per driver.
 */
export async function resolveEngine(
  context: Pick<ModuleResolverContext, 'driver' | 'databaseName' | 'getEngine'>,
): Promise<EngineInfo> {
  if (context.getEngine) return context.getEngine();
  let resolver = fallbackResolvers.get(context.driver);
  if (!resolver) {
    resolver = createEngineResolver(context.driver, context.databaseName);
    fallbackResolvers.set(context.driver, resolver);
  }
  return resolver();
}
