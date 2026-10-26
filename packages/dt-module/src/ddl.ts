/**
 * Index and constraint DDL for both supported graph engines.
 *
 * The two dialects share no schema syntax. Memgraph only parses the legacy
 * `CREATE INDEX ON :L(p)` / `CREATE CONSTRAINT ON … ASSERT …` forms, has no
 * schema-object names and no `IF NOT EXISTS` (an existing index is reported as
 * "already exists"; re-creating a constraint is a no-op). Neo4j 5 only parses
 * `CREATE INDEX … FOR … ON …` / `CREATE CONSTRAINT … FOR … REQUIRE …` and drops
 * schema objects by name only, so every Neo4j index and constraint built here
 * carries a deterministic name derived from its label, properties and kind.
 *
 * The drop forms name what these builders create. On Neo4j, an equivalent
 * object created earlier without a name keeps its generated name (a named
 * `IF NOT EXISTS` against it is a no-op), so `schema.ts` drops by looking the
 * name up instead. On Memgraph, dropping an absent object is up to the engine;
 * on Neo4j `IF EXISTS` makes it a no-op.
 *
 * Labels and properties are interpolated into the statement, so each must be a
 * plain identifier: letters and digits, with single underscores between them.
 * That rule also keeps names unambiguous, because the name joins its parts
 * with a double underscore.
 *
 * Two copies of the node-index form and its naming live where this package
 * cannot be imported, and pin the same literals in their tests: the operator
 * console's corpus indexes (`apps/byodt-console/internal/initcmd/corpusindex.go`)
 * and the MITRE embeddings build's loader
 * (`modules/mitre-frameworks/scripts/load_committed_data.py`). A change to the
 * forms or names here changes them too.
 */

import type { EngineInfo } from './engine';

export type ConstraintKind = 'unique' | 'exists';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/;

function identifier(value: unknown, role: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`invalid ${role} for schema DDL: ${JSON.stringify(value)}`);
  }
  return value;
}

function propertyList(property: string | readonly string[]): readonly string[] {
  const properties = typeof property === 'string' ? [property] : property;
  if (!Array.isArray(properties) || properties.length === 0) {
    throw new Error('schema DDL needs at least one property');
  }
  if (new Set(properties).size !== properties.length) {
    throw new Error(`repeated property in schema DDL: ${properties.join(', ')}`);
  }
  return properties.map((p) => identifier(p, 'property'));
}

/** An index covers exactly one property, given as a string. */
function indexProperty(property: string): string {
  if (typeof property !== 'string') throw new Error('an index takes exactly one property');
  return identifier(property, 'property');
}

function constraintTarget(
  label: string,
  property: string | readonly string[],
  kind: ConstraintKind,
): { label: string; properties: readonly string[] } {
  if (kind !== 'unique' && kind !== 'exists') {
    throw new Error(`unknown constraint kind: ${JSON.stringify(kind)}`);
  }
  const properties = propertyList(property);
  if (kind === 'exists' && properties.length !== 1) {
    throw new Error('an existence constraint takes exactly one property');
  }
  return { label: identifier(label, 'label'), properties };
}

function isEnterprise(engineInfo: EngineInfo): boolean {
  return (engineInfo.edition ?? '').toLowerCase() === 'enterprise';
}

function propertyRefs(properties: readonly string[]): string {
  return properties.map((p) => `n.${p}`).join(', ');
}

/** The Neo4j name of the range index on `label(property)`. */
export function indexName(label: string, property: string): string {
  return `dt_idx__${identifier(label, 'label')}__${indexProperty(property)}`;
}

/** The Neo4j name of a constraint on `label` over `property` (one, or several for a composite unique). */
export function constraintName(
  label: string,
  property: string | readonly string[],
  kind: ConstraintKind,
): string {
  const target = constraintTarget(label, property, kind);
  const tag = kind === 'unique' ? 'uniq' : 'exists';
  return `dt_${tag}__${target.label}__${target.properties.join('__')}`;
}

/** Create the range index on `label(property)`. */
export function buildIndexDdl(engineInfo: EngineInfo, label: string, property: string): string {
  const name = indexName(label, property);
  return engineInfo.engine === 'neo4j'
    ? `CREATE INDEX ${name} IF NOT EXISTS FOR (n:${label}) ON (n.${property})`
    : `CREATE INDEX ON :${label}(${property})`;
}

/** Drop the range index on `label(property)`. */
export function buildDropIndexDdl(engineInfo: EngineInfo, label: string, property: string): string {
  const name = indexName(label, property);
  return engineInfo.engine === 'neo4j' ? `DROP INDEX ${name} IF EXISTS` : `DROP INDEX ON :${label}(${property})`;
}

/** The Neo4j name of the range index on relationships of `type` by `property`. */
export function relationshipIndexName(type: string, property: string): string {
  return `dt_ridx__${identifier(type, 'relationship type')}__${indexProperty(property)}`;
}

/** Create the range index on relationships of `type` by `property` (an edge index on Memgraph). */
export function buildRelationshipIndexDdl(engineInfo: EngineInfo, type: string, property: string): string {
  const name = relationshipIndexName(type, property);
  return engineInfo.engine === 'neo4j'
    ? `CREATE INDEX ${name} IF NOT EXISTS FOR ()-[r:${type}]-() ON (r.${property})`
    : `CREATE EDGE INDEX ON :${type}(${property})`;
}

/** Drop the range index on relationships of `type` by `property`. */
export function buildDropRelationshipIndexDdl(engineInfo: EngineInfo, type: string, property: string): string {
  const name = relationshipIndexName(type, property);
  return engineInfo.engine === 'neo4j' ? `DROP INDEX ${name} IF EXISTS` : `DROP EDGE INDEX ON :${type}(${property})`;
}

/**
 * Create a constraint. Several properties make a composite uniqueness
 * constraint; an existence constraint takes exactly one property.
 *
 * Returns `null` when the kind is structurally unavailable on the engine:
 * property-existence constraints need Neo4j Enterprise, so any other Neo4j
 * edition (an unknown one included) yields `null` and the caller skips it.
 */
export function buildConstraintDdl(
  engineInfo: EngineInfo,
  label: string,
  property: string | readonly string[],
  kind: ConstraintKind,
): string | null {
  const { label: l, properties } = constraintTarget(label, property, kind);
  if (engineInfo.engine === 'memgraph') {
    return kind === 'unique'
      ? `CREATE CONSTRAINT ON (n:${l}) ASSERT ${propertyRefs(properties)} IS UNIQUE`
      : `CREATE CONSTRAINT ON (n:${l}) ASSERT EXISTS (n.${properties[0]})`;
  }
  const name = constraintName(l, properties, kind);
  if (kind === 'unique') {
    const target = properties.length === 1 ? `n.${properties[0]}` : `(${propertyRefs(properties)})`;
    return `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${l}) REQUIRE ${target} IS UNIQUE`;
  }
  return isEnterprise(engineInfo)
    ? `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${l}) REQUIRE n.${properties[0]} IS NOT NULL`
    : null;
}

/** Drop a constraint built by {@link buildConstraintDdl}; `null` exactly where that returns `null`. */
export function buildDropConstraintDdl(
  engineInfo: EngineInfo,
  label: string,
  property: string | readonly string[],
  kind: ConstraintKind,
): string | null {
  const { label: l, properties } = constraintTarget(label, property, kind);
  if (engineInfo.engine === 'memgraph') {
    return kind === 'unique'
      ? `DROP CONSTRAINT ON (n:${l}) ASSERT ${propertyRefs(properties)} IS UNIQUE`
      : `DROP CONSTRAINT ON (n:${l}) ASSERT EXISTS (n.${properties[0]})`;
  }
  if (kind === 'exists' && !isEnterprise(engineInfo)) return null;
  return `DROP CONSTRAINT ${constraintName(l, properties, kind)} IF EXISTS`;
}
