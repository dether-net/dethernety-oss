/**
 * Apply and drop a module's indexes and constraints on either graph engine.
 *
 * A module declares what it needs ({@link SchemaPlan}); {@link ensureSchema}
 * builds it with the per-engine DDL from `ddl.ts`. Three engine differences are
 * handled here rather than by each module:
 *
 * - **Memgraph** keeps indexes and constraints independent, has no
 *   `IF NOT EXISTS`, and reports an existing index as "already exists"; that
 *   answer counts as present, not as a failure.
 * - **Neo4j** backs a uniqueness constraint with its own index, and a plain
 *   index on the same label and property blocks the constraint. So on Neo4j a
 *   plain index is skipped when a uniqueness constraint (or node key) covers its
 *   key, declared in the plan or already in the database, and a plain index
 *   already in the way of a declared constraint is dropped first, and put back
 *   if the constraint then fails.
 * - **Neo4j drops by name only**, and objects created before names were
 *   deterministic carry generated ones. Drops therefore look the name up with
 *   `SHOW INDEXES` / `SHOW CONSTRAINTS` instead of assuming it
 *   ({@link dropSchemaObject}). A name read back that is not a plain word
 *   (a letter or underscore, then letters, digits, underscores — as every name
 *   Neo4j generates) is refused rather than quoted into a DROP.
 *
 * Before a uniqueness constraint is created, one scan of its label counts the
 * key values held by more than one node and the nodes lacking a key property
 * ({@link uniqueKeyCheckCypher}). Duplicates would make the constraint fail on
 * either engine, so it is not run and is reported as failed with the counts; on
 * Neo4j the plain index in its way is then left alone. A constraint Neo4j
 * already holds is not checked.
 *
 * Statements run one at a time through the caller's runner, which must use an
 * auto-commit (implicit) transaction: Memgraph rejects schema changes inside an
 * explicit one.
 */

import {
  buildConstraintDdl,
  buildDropConstraintDdl,
  buildDropIndexDdl,
  buildDropRelationshipIndexDdl,
  buildIndexDdl,
  buildRelationshipIndexDdl,
  ConstraintKind,
} from './ddl';
import type { EngineInfo } from './engine';

export interface IndexSpec {
  label: string;
  property: string;
}

export interface RelationshipIndexSpec {
  type: string;
  property: string;
}

export interface ConstraintSpec {
  label: string;
  properties: readonly string[];
  kind: ConstraintKind;
}

export interface SchemaPlan {
  indexes?: readonly IndexSpec[];
  relationshipIndexes?: readonly RelationshipIndexSpec[];
  constraints?: readonly ConstraintSpec[];
}

export type SchemaTarget =
  | ({ kind: 'index' } & IndexSpec)
  | ({ kind: 'relationshipIndex' } & RelationshipIndexSpec)
  | ConstraintSpec;

/** Runs one statement in an auto-commit transaction and returns its records. */
export type CypherRunner = (cypher: string) => Promise<{ records: ReadonlyArray<{ get(key: string): unknown }> }>;

export interface SchemaReport {
  /** Statements that ran without error. */
  applied: string[];
  /** Statements Memgraph answered with "already exists". */
  existed: string[];
  /** What was not attempted, and why. */
  skipped: string[];
  failed: Array<{ statement: string; error: string }>;
}

export const SHOW_INDEXES_CYPHER =
  'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, owningConstraint';
export const SHOW_CONSTRAINTS_CYPHER = 'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties';

interface Neo4jSchemaRow {
  name: string;
  type: string;
  entityType: string;
  labelsOrTypes: string[];
  properties: string[];
  owningConstraint: string | null;
}

const NODE_UNIQUENESS = new Set(['UNIQUENESS', 'NODE_PROPERTY_UNIQUENESS']);
const NODE_EXISTENCE = new Set(['NODE_PROPERTY_EXISTENCE']);
/** Constraints whose own index serves a plain index's lookups (a node key is unique too). */
const COVERS_INDEX = new Set([...NODE_UNIQUENESS, 'NODE_KEY']);
/** The only names read back from SHOW that are ever put into a DROP. */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function toRow(record: { get(key: string): unknown }, hasOwner: boolean): Neo4jSchemaRow {
  const owner = hasOwner ? record.get('owningConstraint') : null;
  return {
    name: String(record.get('name')),
    type: String(record.get('type') ?? ''),
    entityType: String(record.get('entityType') ?? ''),
    labelsOrTypes: stringList(record.get('labelsOrTypes')),
    properties: stringList(record.get('properties')),
    owningConstraint: owner == null ? null : String(owner),
  };
}

function sameSchema(row: Neo4jSchemaRow, entityType: string, labelOrType: string, properties: readonly string[]): boolean {
  return (
    row.entityType === entityType &&
    row.labelsOrTypes.length === 1 &&
    row.labelsOrTypes[0] === labelOrType &&
    row.properties.length === properties.length &&
    row.properties.every((p, i) => p === properties[i])
  );
}

async function readNeo4jSchema(run: CypherRunner): Promise<{ indexes: Neo4jSchemaRow[]; constraints: Neo4jSchemaRow[] }> {
  const indexes = (await run(SHOW_INDEXES_CYPHER)).records.map((r) => toRow(r, true));
  const constraints = (await run(SHOW_CONSTRAINTS_CYPHER)).records.map((r) => toRow(r, false));
  return { indexes, constraints };
}

/** A DROP of the named object, or `null` for a name that is not a plain word. */
function dropByName(objectKind: 'INDEX' | 'CONSTRAINT', name: string): string | null {
  return PLAIN_NAME.test(name) ? `DROP ${objectKind} ${name} IF EXISTS` : null;
}

function enterpriseSkip(c: { kind: ConstraintKind; label: string; properties: readonly string[] }): string {
  return `${c.kind} constraint on :${c.label}(${c.properties.join(', ')}): needs Neo4j Enterprise`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainIndexOn(row: Neo4jSchemaRow, label: string, property: string): boolean {
  return row.type === 'RANGE' && row.owningConstraint === null && sameSchema(row, 'NODE', label, [property]);
}

/**
 * One scan of `label` for a uniqueness key: `missing` counts the nodes that lack
 * a key property, `duplicated` the key values more than one node holds. The keys
 * are aliased by position, so a property named like a keyword cannot clash.
 * Callers validate the identifiers first (the constraint builder does).
 */
export function uniqueKeyCheckCypher(label: string, properties: readonly string[]): string {
  const keys = properties.map((p, i) => `n.${p} AS k${i}`).join(', ');
  const anyMissing = properties.map((_, i) => `k${i} IS NULL`).join(' OR ');
  const allPresent = properties.map((_, i) => `k${i} IS NOT NULL`).join(' AND ');
  return (
    `MATCH (n:${label}) WITH ${keys}, count(*) AS c ` +
    `RETURN sum(CASE WHEN ${anyMissing} THEN c ELSE 0 END) AS missing, ` +
    `sum(CASE WHEN ${allPresent} AND c > 1 THEN 1 ELSE 0 END) AS duplicated`
  );
}

function asCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: unknown }).toNumber === 'function') return (value as { toNumber(): number }).toNumber();
  return Number(value ?? 0);
}

/** The key counts, or `null` when the check itself fails (the constraint is then attempted as is). */
async function checkUniqueKey(run: CypherRunner, c: ConstraintSpec): Promise<{ missing: number; duplicated: number } | null> {
  try {
    const record = (await run(uniqueKeyCheckCypher(c.label, c.properties))).records[0];
    return record ? { missing: asCount(record.get('missing')), duplicated: asCount(record.get('duplicated')) } : { missing: 0, duplicated: 0 };
  } catch {
    return null;
  }
}

function missingNote(missing: number): string {
  return missing > 0 ? `; ${missing} node(s) lack a key property` : '';
}

/**
 * Create every object in `plan` that the engine can hold. Never throws for a
 * statement: each failure is reported and the rest still run.
 */
export async function ensureSchema(run: CypherRunner, engineInfo: EngineInfo, plan: SchemaPlan): Promise<SchemaReport> {
  const report: SchemaReport = { applied: [], existed: [], skipped: [], failed: [] };
  const constraints = plan.constraints ?? [];
  const indexes = plan.indexes ?? [];
  const relationshipIndexes = plan.relationshipIndexes ?? [];
  // Build every statement once up front, so a bad spec throws before anything has run.
  for (const c of constraints) buildConstraintDdl(engineInfo, c.label, c.properties, c.kind);
  for (const i of indexes) buildIndexDdl(engineInfo, i.label, i.property);
  for (const r of relationshipIndexes) buildRelationshipIndexDdl(engineInfo, r.type, r.property);

  const execute = async (statement: string, failureNote = ''): Promise<void> => {
    try {
      await run(statement);
      report.applied.push(statement);
    } catch (error) {
      const message = errorText(error);
      if (engineInfo.engine === 'memgraph' && /already\s+exists/i.test(message)) report.existed.push(statement);
      else report.failed.push({ statement, error: message + failureNote });
    }
  };
  // The note for a uniqueness constraint's failure, or `null` when duplicate keys rule it out (reported here).
  const precheck = async (c: ConstraintSpec, statement: string): Promise<string | null> => {
    if (c.kind !== 'unique') return '';
    const counts = await checkUniqueKey(run, c);
    if (!counts) return '';
    if (counts.duplicated > 0) {
      report.failed.push({
        statement,
        error: `not run: ${counts.duplicated} key value(s) are on more than one node${missingNote(counts.missing)}`,
      });
      return null;
    }
    return missingNote(counts.missing);
  };

  if (engineInfo.engine === 'memgraph') {
    for (const c of constraints) {
      const statement = buildConstraintDdl(engineInfo, c.label, c.properties, c.kind);
      if (!statement) continue;
      const note = await precheck(c, statement);
      if (note !== null) await execute(statement, note);
    }
    for (const i of indexes) await execute(buildIndexDdl(engineInfo, i.label, i.property));
    for (const r of relationshipIndexes) await execute(buildRelationshipIndexDdl(engineInfo, r.type, r.property));
    return report;
  }

  let existing: { indexes: Neo4jSchemaRow[]; constraints: Neo4jSchemaRow[] } | null = null;
  try {
    existing = await readNeo4jSchema(run);
  } catch (error) {
    report.failed.push({ statement: `${SHOW_INDEXES_CYPHER}; ${SHOW_CONSTRAINTS_CYPHER}`, error: errorText(error) });
  }

  // Single-property keys a uniqueness constraint backs with its own index.
  const uniqueKeys = new Set<string>();
  const key = (label: string, property: string) => `${label}\u0000${property}`;
  for (const row of existing?.constraints ?? []) {
    if (COVERS_INDEX.has(row.type) && row.entityType === 'NODE' && row.labelsOrTypes.length === 1 && row.properties.length === 1) {
      uniqueKeys.add(key(row.labelsOrTypes[0], row.properties[0]));
    }
  }

  for (const c of constraints) {
    const statement = buildConstraintDdl(engineInfo, c.label, c.properties, c.kind);
    if (!statement) {
      report.skipped.push(enterpriseSkip(c));
      continue;
    }
    const held =
      c.kind === 'unique' &&
      (existing?.constraints ?? []).some((row) => COVERS_INDEX.has(row.type) && sameSchema(row, 'NODE', c.label, c.properties));
    const note = held ? '' : await precheck(c, statement);
    if (note === null) continue;
    const singleUnique = c.kind === 'unique' && c.properties.length === 1;
    let droppedIndex = false;
    if (singleUnique && existing && !uniqueKeys.has(key(c.label, c.properties[0]))) {
      // A plain index on the key blocks the constraint; the constraint brings its own.
      for (const row of existing.indexes.filter((r) => isPlainIndexOn(r, c.label, c.properties[0]))) {
        const drop = dropByName('INDEX', row.name);
        if (!drop) {
          report.failed.push({ statement: `DROP INDEX ${JSON.stringify(row.name)}`, error: 'refused: not a plain name' });
          continue;
        }
        await execute(drop);
        droppedIndex = true;
      }
    }
    const failuresBefore = report.failed.length;
    await execute(statement, note);
    if (!singleUnique) continue;
    if (report.failed.length === failuresBefore) uniqueKeys.add(key(c.label, c.properties[0]));
    else if (droppedIndex && !indexes.some((i) => i.label === c.label && i.property === c.properties[0])) {
      // Restore the index this made way for; one the plan lists comes back below.
      await execute(buildIndexDdl(engineInfo, c.label, c.properties[0]));
    }
  }

  // A key whose constraint failed keeps (or gets back) its plain index here.
  for (const i of indexes) {
    if (uniqueKeys.has(key(i.label, i.property))) {
      report.skipped.push(`index on :${i.label}(${i.property}): a uniqueness constraint covers it`);
      continue;
    }
    await execute(buildIndexDdl(engineInfo, i.label, i.property));
  }
  for (const r of relationshipIndexes) await execute(buildRelationshipIndexDdl(engineInfo, r.type, r.property));
  return report;
}

/**
 * Drop one schema object. On Memgraph the statement names the schema; on Neo4j
 * every object matching the target is found with `SHOW` and dropped by its
 * actual name, so an object created without a deterministic name goes too.
 * An existence constraint on Neo4j other than Enterprise cannot exist and is
 * reported as skipped.
 */
export async function dropSchemaObject(run: CypherRunner, engineInfo: EngineInfo, target: SchemaTarget): Promise<SchemaReport> {
  const report: SchemaReport = { applied: [], existed: [], skipped: [], failed: [] };
  const execute = async (statement: string): Promise<void> => {
    try {
      await run(statement);
      report.applied.push(statement);
    } catch (error) {
      report.failed.push({ statement, error: errorText(error) });
    }
  };

  if (engineInfo.engine === 'memgraph') {
    if (target.kind === 'index') await execute(buildDropIndexDdl(engineInfo, target.label, target.property));
    else if (target.kind === 'relationshipIndex') {
      await execute(buildDropRelationshipIndexDdl(engineInfo, target.type, target.property));
    } else {
      const statement = buildDropConstraintDdl(engineInfo, target.label, target.properties, target.kind);
      if (statement) await execute(statement);
    }
    return report;
  }

  // Validates the target's identifiers before any lookup runs.
  if (target.kind === 'index') buildDropIndexDdl(engineInfo, target.label, target.property);
  else if (target.kind === 'relationshipIndex') buildDropRelationshipIndexDdl(engineInfo, target.type, target.property);
  else if (buildDropConstraintDdl(engineInfo, target.label, target.properties, target.kind) === null) {
    report.skipped.push(enterpriseSkip(target));
    return report;
  }

  let existing: { indexes: Neo4jSchemaRow[]; constraints: Neo4jSchemaRow[] };
  try {
    existing = await readNeo4jSchema(run);
  } catch (error) {
    report.failed.push({ statement: `${SHOW_INDEXES_CYPHER}; ${SHOW_CONSTRAINTS_CYPHER}`, error: errorText(error) });
    return report;
  }

  let names: string[];
  let objectKind: 'INDEX' | 'CONSTRAINT';
  if (target.kind === 'index') {
    objectKind = 'INDEX';
    names = existing.indexes.filter((r) => isPlainIndexOn(r, target.label, target.property)).map((r) => r.name);
  } else if (target.kind === 'relationshipIndex') {
    objectKind = 'INDEX';
    names = existing.indexes
      .filter((r) => r.type === 'RANGE' && r.owningConstraint === null && sameSchema(r, 'RELATIONSHIP', target.type, [target.property]))
      .map((r) => r.name);
  } else {
    objectKind = 'CONSTRAINT';
    const types = target.kind === 'unique' ? NODE_UNIQUENESS : NODE_EXISTENCE;
    names = existing.constraints
      .filter((r) => types.has(r.type) && sameSchema(r, 'NODE', target.label, target.properties))
      .map((r) => r.name);
  }
  if (names.length === 0) report.skipped.push(`no ${objectKind.toLowerCase()} matches the target`);
  for (const name of names) {
    const drop = dropByName(objectKind, name);
    if (drop) await execute(drop);
    else report.failed.push({ statement: `DROP ${objectKind} ${JSON.stringify(name)}`, error: 'refused: not a plain name' });
  }
  return report;
}
