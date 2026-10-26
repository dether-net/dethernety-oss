/**
 * Applying and dropping a schema plan per engine: what runs, in which order, what is skipped, and how
 * Neo4j objects are found by schema rather than by an assumed name. The runner is a fake that answers
 * SHOW INDEXES / SHOW CONSTRAINTS from fixed rows and records every other statement.
 */

import { describe, expect, it } from 'vitest';

import type { EngineInfo } from '../engine';
import { dropSchemaObject, ensureSchema, SHOW_CONSTRAINTS_CYPHER, SHOW_INDEXES_CYPHER, uniqueKeyCheckCypher } from '../schema';

const memgraph: EngineInfo = { engine: 'memgraph', edition: 'community', version: '5.9.0' };
const neo4j: EngineInfo = { engine: 'neo4j', edition: 'community', version: '5.26.0' };
const neo4jEnterprise: EngineInfo = { engine: 'neo4j', edition: 'enterprise', version: '5.26.0' };

type Row = Record<string, unknown>;

function indexRow(name: string, label: string, properties: string[], extra: Row = {}): Row {
  return { name, type: 'RANGE', entityType: 'NODE', labelsOrTypes: [label], properties, owningConstraint: null, ...extra };
}

function constraintRow(name: string, label: string, properties: string[], type = 'UNIQUENESS'): Row {
  return { name, type, entityType: 'NODE', labelsOrTypes: [label], properties };
}

/** Key counts per label for the uniqueness pre-check; a label not listed has none. */
type KeyCounts = Record<string, { missing?: unknown; duplicated?: unknown } | 'fail'>;

function fakeRunner(
  opts: { indexes?: Row[]; constraints?: Row[]; keys?: KeyCounts; fail?: (cypher: string) => string | undefined } = {},
) {
  const ran: string[] = [];
  const checked: string[] = [];
  const run = async (cypher: string) => {
    const asRecords = (rows: Row[]) => ({ records: rows.map((row) => ({ get: (k: string) => row[k] })) });
    if (cypher === SHOW_INDEXES_CYPHER) return asRecords(opts.indexes ?? []);
    if (cypher === SHOW_CONSTRAINTS_CYPHER) return asRecords(opts.constraints ?? []);
    const check = /^MATCH \(n:(\w+)\) WITH /.exec(cypher);
    if (check) {
      checked.push(cypher);
      const counts = opts.keys?.[check[1]];
      if (counts === 'fail') throw new Error('check failed');
      return asRecords([{ missing: counts?.missing ?? 0, duplicated: counts?.duplicated ?? 0 }]);
    }
    ran.push(cypher);
    const failure = opts.fail?.(cypher);
    if (failure) throw new Error(failure);
    return { records: [] };
  };
  return { run, ran, checked };
}

const plan = {
  constraints: [{ label: 'Rule', properties: ['id'], kind: 'unique' as const }],
  indexes: [
    { label: 'Rule', property: 'id' },
    { label: 'Note', property: 'modelId' },
  ],
  relationshipIndexes: [{ type: 'LINKS', property: 'key' }],
};

describe('ensureSchema on Memgraph', () => {
  it('creates constraints, then indexes, then relationship indexes, all of them', async () => {
    const { run, ran } = fakeRunner();
    const report = await ensureSchema(run, memgraph, plan);
    expect(ran).toEqual([
      'CREATE CONSTRAINT ON (n:Rule) ASSERT n.id IS UNIQUE',
      'CREATE INDEX ON :Rule(id)',
      'CREATE INDEX ON :Note(modelId)',
      'CREATE EDGE INDEX ON :LINKS(key)',
    ]);
    expect(report.failed).toEqual([]);
  });

  it('counts "already exists" as present and any other error as a failure, and keeps going', async () => {
    const { run, ran } = fakeRunner({
      fail: (c) => (c.includes(':Rule(id)') ? 'Index already exists' : c.includes('EDGE') ? 'boom' : undefined),
    });
    const report = await ensureSchema(run, memgraph, plan);
    expect(ran).toHaveLength(4);
    expect(report.existed).toEqual(['CREATE INDEX ON :Rule(id)']);
    expect(report.failed).toEqual([{ statement: 'CREATE EDGE INDEX ON :LINKS(key)', error: 'boom' }]);
  });

  it('never reads SHOW on Memgraph', async () => {
    const { run } = fakeRunner({ fail: () => undefined });
    const seen: string[] = [];
    await ensureSchema(async (c) => {
      seen.push(c);
      return run(c);
    }, memgraph, plan);
    expect(seen.some((c) => c.startsWith('SHOW'))).toBe(false);
  });
});

describe('ensureSchema on Neo4j', () => {
  it('skips a plain index that a declared uniqueness constraint covers', async () => {
    const { run, ran } = fakeRunner();
    const report = await ensureSchema(run, neo4j, plan);
    expect(ran).toEqual([
      'CREATE CONSTRAINT dt_uniq__Rule__id IF NOT EXISTS FOR (n:Rule) REQUIRE n.id IS UNIQUE',
      'CREATE INDEX dt_idx__Note__modelId IF NOT EXISTS FOR (n:Note) ON (n.modelId)',
      'CREATE INDEX dt_ridx__LINKS__key IF NOT EXISTS FOR ()-[r:LINKS]-() ON (r.key)',
    ]);
    expect(report.skipped).toEqual(['index on :Rule(id): a uniqueness constraint covers it']);
  });

  it.each([['UNIQUENESS'], ['NODE_PROPERTY_UNIQUENESS'], ['NODE_KEY']])(
    'skips a plain index whose key a %s constraint already in the database covers',
    async (type) => {
      const { run, ran } = fakeRunner({ constraints: [constraintRow('constraint_abc', 'Note', ['modelId'], type)] });
      const report = await ensureSchema(run, neo4j, { indexes: [{ label: 'Note', property: 'modelId' }] });
      expect(ran).toEqual([]);
      expect(report.skipped).toEqual(['index on :Note(modelId): a uniqueness constraint covers it']);
    },
  );

  it('drops a plain index in the way of a declared constraint by its actual name, first', async () => {
    const { run, ran } = fakeRunner({ indexes: [indexRow('index_5c1f4f6d', 'Rule', ['id'])] });
    await ensureSchema(run, neo4j, { constraints: plan.constraints });
    expect(ran).toEqual([
      'DROP INDEX index_5c1f4f6d IF EXISTS',
      'CREATE CONSTRAINT dt_uniq__Rule__id IF NOT EXISTS FOR (n:Rule) REQUIRE n.id IS UNIQUE',
    ]);
  });

  it('refuses to drop an index whose name is not a plain word, and reports it', async () => {
    const odd = 'x` IF EXISTS DROP CONSTRAINT dt_uniq__Analysis__id //';
    const { run, ran } = fakeRunner({ indexes: [indexRow(odd, 'Rule', ['id'])] });
    const report = await ensureSchema(run, neo4j, { constraints: plan.constraints });
    expect(ran).toEqual(['CREATE CONSTRAINT dt_uniq__Rule__id IF NOT EXISTS FOR (n:Rule) REQUIRE n.id IS UNIQUE']);
    expect(report.failed).toEqual([{ statement: `DROP INDEX ${JSON.stringify(odd)}`, error: 'refused: not a plain name' }]);
  });

  it('validates every spec before running any statement', async () => {
    const { run, ran } = fakeRunner();
    await expect(
      ensureSchema(run, memgraph, { indexes: [{ label: 'Rule', property: 'id' }, { label: 'Bad label', property: 'id' }] }),
    ).rejects.toThrow(/invalid label/);
    expect(ran).toEqual([]);
  });

  it('leaves the index alone when the constraint is already there, or when the index belongs to a constraint', async () => {
    const owned = fakeRunner({ indexes: [indexRow('constraint_x', 'Rule', ['id'], { owningConstraint: 'constraint_x' })] });
    await ensureSchema(owned.run, neo4j, { constraints: plan.constraints });
    expect(owned.ran.some((c) => c.startsWith('DROP'))).toBe(false);

    const present = fakeRunner({
      indexes: [indexRow('index_old', 'Rule', ['id'])],
      constraints: [constraintRow('constraint_x', 'Rule', ['id'])],
    });
    await ensureSchema(present.run, neo4j, { constraints: plan.constraints });
    expect(present.ran.some((c) => c.startsWith('DROP'))).toBe(false);
  });

  it.each([
    ['listed in the plan', [{ label: 'Rule', property: 'id' }]],
    ['not listed in the plan', []],
  ])('puts the plain index back once when the constraint it made way for fails (index %s)', async (_case, indexes) => {
    const { run, ran } = fakeRunner({
      indexes: [indexRow('index_old', 'Rule', ['id'])],
      fail: (c) => (c.startsWith('CREATE CONSTRAINT') ? 'duplicate values' : undefined),
    });
    const report = await ensureSchema(run, neo4j, { constraints: plan.constraints, indexes });
    expect(ran).toEqual([
      'DROP INDEX index_old IF EXISTS',
      'CREATE CONSTRAINT dt_uniq__Rule__id IF NOT EXISTS FOR (n:Rule) REQUIRE n.id IS UNIQUE',
      'CREATE INDEX dt_idx__Rule__id IF NOT EXISTS FOR (n:Rule) ON (n.id)',
    ]);
    expect(report.failed.map((f) => f.error)).toEqual(['duplicate values']);
    expect(report.skipped).toEqual([]);
  });

  it('does not treat a composite constraint as covering a single-property index', async () => {
    const { run, ran } = fakeRunner();
    await ensureSchema(run, neo4j, {
      constraints: [{ label: 'Note', properties: ['modelId', 'topicId'], kind: 'unique' }],
      indexes: [{ label: 'Note', property: 'modelId' }],
    });
    expect(ran).toEqual([
      'CREATE CONSTRAINT dt_uniq__Note__modelId__topicId IF NOT EXISTS FOR (n:Note) REQUIRE (n.modelId, n.topicId) IS UNIQUE',
      'CREATE INDEX dt_idx__Note__modelId IF NOT EXISTS FOR (n:Note) ON (n.modelId)',
    ]);
  });

  it('skips an existence constraint on Community and reports it', async () => {
    const { run, ran } = fakeRunner();
    const report = await ensureSchema(run, neo4j, { constraints: [{ label: 'Rule', properties: ['id'], kind: 'exists' }] });
    expect(ran).toEqual([]);
    expect(report.skipped).toEqual(['exists constraint on :Rule(id): needs Neo4j Enterprise']);
  });

  it('still creates the plan when SHOW fails, and reports the failed read', async () => {
    const run = async (cypher: string) => {
      if (cypher.startsWith('SHOW')) throw new Error('no permission');
      return { records: [] };
    };
    const report = await ensureSchema(run, neo4j, plan);
    expect(report.failed).toHaveLength(1);
    expect(report.applied).toHaveLength(3);
  });
});

describe('the uniqueness pre-check', () => {
  const composite = { label: 'Note', properties: ['modelId', 'key'], kind: 'unique' as const };

  it('scans the label once, keys aliased by position', () => {
    expect(uniqueKeyCheckCypher('Note', ['modelId', 'key'])).toBe(
      'MATCH (n:Note) WITH n.modelId AS k0, n.key AS k1, count(*) AS c ' +
        'RETURN sum(CASE WHEN k0 IS NULL OR k1 IS NULL THEN c ELSE 0 END) AS missing, ' +
        'sum(CASE WHEN k0 IS NOT NULL AND k1 IS NOT NULL AND c > 1 THEN 1 ELSE 0 END) AS duplicated',
    );
  });

  it.each([
    ['Memgraph', memgraph],
    ['Neo4j', neo4j],
  ])('on %s, checks before each uniqueness constraint and creates it when no key is duplicated', async (_name, engine) => {
    const { run, ran, checked } = fakeRunner();
    const report = await ensureSchema(run, engine, { constraints: [composite] });
    expect(checked).toEqual([uniqueKeyCheckCypher('Note', ['modelId', 'key'])]);
    expect(ran).toHaveLength(1);
    expect(report.failed).toEqual([]);
  });

  it.each([
    ['Memgraph', memgraph],
    ['Neo4j', neo4j],
  ])('on %s, does not run a constraint whose key is duplicated, and reports it with both counts', async (_name, engine) => {
    const { run, ran } = fakeRunner({ keys: { Note: { duplicated: { toNumber: () => 2 }, missing: 3 } } });
    const report = await ensureSchema(run, engine, { constraints: [composite], indexes: [{ label: 'Rule', property: 'id' }] });
    expect(ran.some((c) => c.includes('CONSTRAINT'))).toBe(false);
    expect(ran).toHaveLength(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].statement).toContain('CONSTRAINT');
    expect(report.failed[0].error).toBe('not run: 2 key value(s) are on more than one node; 3 node(s) lack a key property');
  });

  it('on Neo4j, leaves the plain index in the way alone when the key is duplicated, and keeps the planned index', async () => {
    const { run, ran } = fakeRunner({ indexes: [indexRow('index_old', 'Rule', ['id'])], keys: { Rule: { duplicated: 1 } } });
    const report = await ensureSchema(run, neo4j, plan);
    expect(ran.some((c) => c.startsWith('DROP'))).toBe(false);
    expect(ran).toContain('CREATE INDEX dt_idx__Rule__id IF NOT EXISTS FOR (n:Rule) ON (n.id)');
    expect(report.skipped).toEqual([]);
  });

  it.each([
    ['Memgraph', memgraph],
    ['Neo4j', neo4j],
  ])('on %s, appends the count of nodes lacking a key property when the constraint then fails', async (_name, engine) => {
    const { run } = fakeRunner({ keys: { Note: { missing: 4 } }, fail: (c) => (c.includes('CONSTRAINT') ? 'boom' : undefined) });
    const report = await ensureSchema(run, engine, { constraints: [composite] });
    expect(report.failed.map((f) => f.error)).toEqual(['boom; 4 node(s) lack a key property']);
  });

  it('attempts the constraint as before when the check itself fails', async () => {
    const { run, ran } = fakeRunner({ keys: { Note: 'fail' } });
    const report = await ensureSchema(run, neo4j, { constraints: [composite] });
    expect(ran).toEqual([
      'CREATE CONSTRAINT dt_uniq__Note__modelId__key IF NOT EXISTS FOR (n:Note) REQUIRE (n.modelId, n.key) IS UNIQUE',
    ]);
    expect(report.failed).toEqual([]);
  });

  it.each([['UNIQUENESS'], ['NODE_PROPERTY_UNIQUENESS'], ['NODE_KEY']])(
    'does not check a constraint Neo4j already holds as %s',
    async (type) => {
      const held = fakeRunner({
        constraints: [constraintRow('constraint_x', 'Note', ['modelId', 'key'], type)],
        keys: { Note: { duplicated: 1 } },
      });
      const report = await ensureSchema(held.run, neo4j, { constraints: [composite] });
      expect(held.checked).toEqual([]);
      expect(report.failed).toEqual([]);
    },
  );

  it('does not check an existence constraint', async () => {
    const exists = fakeRunner();
    await ensureSchema(exists.run, neo4jEnterprise, { constraints: [{ label: 'Rule', properties: ['id'], kind: 'exists' }] });
    expect(exists.checked).toEqual([]);
  });
});

describe('ensureSchema routes by engine', () => {
  it('one plan gives each engine its own dialect, and only Neo4j reads its schema first', async () => {
    const seen = { memgraph: [] as string[], neo4j: [] as string[] };
    for (const engineInfo of [memgraph, neo4j]) {
      const { run } = fakeRunner();
      await ensureSchema(async (c) => {
        seen[engineInfo.engine].push(c);
        return run(c);
      }, engineInfo, plan);
    }
    const created = (statements: string[]) => statements.filter((c) => c.startsWith('CREATE'));
    // Memgraph: the unnamed legacy forms. Neo4j: named, IF NOT EXISTS, FOR ... REQUIRE/ON.
    expect(created(seen.memgraph).length).toBeGreaterThan(0);
    expect(created(seen.memgraph).every((c) => !c.includes('IF NOT EXISTS') && !c.includes(' FOR '))).toBe(true);
    expect(created(seen.neo4j).length).toBeGreaterThan(0);
    expect(created(seen.neo4j).every((c) => c.includes('IF NOT EXISTS') && c.includes(' FOR '))).toBe(true);
    expect(seen.memgraph.some((c) => c.startsWith('SHOW'))).toBe(false);
    expect(seen.neo4j.slice(0, 2)).toEqual([SHOW_INDEXES_CYPHER, SHOW_CONSTRAINTS_CYPHER]);
  });
});

describe('ensureSchema applied twice', () => {
  it('on Memgraph, the second run finds everything present and fails nothing', async () => {
    const created = new Set<string>();
    const { run } = fakeRunner({
      fail: (c) => (created.has(c) ? 'Index already exists' : (created.add(c), undefined)),
    });
    const first = await ensureSchema(run, memgraph, plan);
    const second = await ensureSchema(run, memgraph, plan);
    expect(first.failed).toEqual([]);
    expect(first.applied).toHaveLength(4);
    expect(second.failed).toEqual([]);
    expect(second.applied).toEqual([]);
    expect(second.existed).toEqual(first.applied);
  });

  it('on Neo4j, the second run reads what the first created, drops nothing and fails nothing', async () => {
    const first = fakeRunner();
    const firstReport = await ensureSchema(first.run, neo4j, plan);
    // What the first run created, as SHOW INDEXES / SHOW CONSTRAINTS would list it.
    const indexes: Row[] = [];
    const constraints: Row[] = [];
    for (const c of first.ran) {
      let m = /^CREATE CONSTRAINT (\w+) IF NOT EXISTS FOR \(n:(\w+)\) REQUIRE n\.(\w+) IS UNIQUE$/.exec(c);
      if (m) {
        constraints.push(constraintRow(m[1], m[2], [m[3]]));
        indexes.push(indexRow(m[1], m[2], [m[3]], { owningConstraint: m[1] }));
        continue;
      }
      m = /^CREATE INDEX (\w+) IF NOT EXISTS FOR \(n:(\w+)\) ON \(n\.(\w+)\)$/.exec(c);
      if (m) {
        indexes.push(indexRow(m[1], m[2], [m[3]]));
        continue;
      }
      m = /^CREATE INDEX (\w+) IF NOT EXISTS FOR \(\)-\[r:(\w+)\]-\(\) ON \(r\.(\w+)\)$/.exec(c);
      if (m) {
        indexes.push(indexRow(m[1], m[2], [m[3]], { entityType: 'RELATIONSHIP' }));
        continue;
      }
      throw new Error(`the first run made a statement this test does not model: ${c}`);
    }
    const second = fakeRunner({ indexes, constraints });
    const secondReport = await ensureSchema(second.run, neo4j, plan);
    expect(firstReport.failed).toEqual([]);
    expect(secondReport.failed).toEqual([]);
    expect(second.ran.some((c) => c.startsWith('DROP'))).toBe(false);
    // It sends the first run's statements again; each is IF NOT EXISTS, so the server leaves the schema as it is.
    expect(second.ran).toEqual(first.ran);
    expect(second.ran.every((c) => c.startsWith('CREATE') && c.includes('IF NOT EXISTS'))).toBe(true);
    // The constraint the first run made is read back: the plain index on its key stays skipped.
    expect(secondReport.skipped).toEqual(firstReport.skipped);
    expect(secondReport.skipped.length).toBeGreaterThan(0);
  });
});

describe('dropSchemaObject', () => {
  it('drops by schema on Memgraph', async () => {
    const { run, ran } = fakeRunner();
    await dropSchemaObject(run, memgraph, { kind: 'index', label: 'Rule', property: 'id' });
    await dropSchemaObject(run, memgraph, { kind: 'relationshipIndex', type: 'LINKS', property: 'key' });
    await dropSchemaObject(run, memgraph, { kind: 'unique', label: 'Rule', properties: ['id'] });
    expect(ran).toEqual([
      'DROP INDEX ON :Rule(id)',
      'DROP EDGE INDEX ON :LINKS(key)',
      'DROP CONSTRAINT ON (n:Rule) ASSERT n.id IS UNIQUE',
    ]);
  });

  it('on Neo4j drops every matching object by its actual name, generated names included', async () => {
    const { run, ran } = fakeRunner({
      indexes: [
        indexRow('index_auto', 'Rule', ['id']),
        indexRow('dt_idx__Rule__id', 'Rule', ['id']),
        indexRow('other', 'Rule', ['name']),
        indexRow('owned', 'Rule', ['id'], { owningConstraint: 'c' }),
        indexRow('rel_auto', 'LINKS', ['key'], { entityType: 'RELATIONSHIP' }),
        indexRow('text', 'Rule', ['id'], { type: 'TEXT' }),
      ],
      constraints: [
        constraintRow('constraint_auto', 'Rule', ['id']),
        constraintRow('key_constraint', 'Rule', ['id'], 'NODE_KEY'),
        constraintRow('exists_auto', 'Rule', ['id'], 'NODE_PROPERTY_EXISTENCE'),
      ],
    });
    await dropSchemaObject(run, neo4j, { kind: 'index', label: 'Rule', property: 'id' });
    await dropSchemaObject(run, neo4j, { kind: 'relationshipIndex', type: 'LINKS', property: 'key' });
    await dropSchemaObject(run, neo4j, { kind: 'unique', label: 'Rule', properties: ['id'] });
    await dropSchemaObject(run, neo4jEnterprise, { kind: 'exists', label: 'Rule', properties: ['id'] });
    expect(ran).toEqual([
      'DROP INDEX index_auto IF EXISTS',
      'DROP INDEX dt_idx__Rule__id IF EXISTS',
      'DROP INDEX rel_auto IF EXISTS',
      'DROP CONSTRAINT constraint_auto IF EXISTS',
      'DROP CONSTRAINT exists_auto IF EXISTS',
    ]);
  });

  it('refuses a name that starts with a digit (it would not parse unquoted)', async () => {
    const { run, ran } = fakeRunner({ indexes: [indexRow('1abc', 'Rule', ['id'])] });
    const report = await dropSchemaObject(run, neo4j, { kind: 'index', label: 'Rule', property: 'id' });
    expect(ran).toEqual([]);
    expect(report.failed.map((f) => f.error)).toEqual(['refused: not a plain name']);
  });

  it('on Neo4j refuses to drop a matching object whose name is not a plain word', async () => {
    const { run, ran } = fakeRunner({ constraints: [constraintRow('c`; x', 'Rule', ['id'])] });
    const report = await dropSchemaObject(run, neo4j, { kind: 'unique', label: 'Rule', properties: ['id'] });
    expect(ran).toEqual([]);
    expect(report.failed).toEqual([{ statement: 'DROP CONSTRAINT "c`; x"', error: 'refused: not a plain name' }]);
  });

  it('reports a target with nothing to drop, and an existence constraint Community cannot hold', async () => {
    const { run, ran } = fakeRunner();
    const none = await dropSchemaObject(run, neo4j, { kind: 'index', label: 'Rule', property: 'id' });
    const exists = await dropSchemaObject(run, neo4j, { kind: 'exists', label: 'Rule', properties: ['id'] });
    expect(ran).toEqual([]);
    expect(none.skipped).toEqual(['no index matches the target']);
    expect(exists.skipped).toEqual(['exists constraint on :Rule(id): needs Neo4j Enterprise']);
  });

  it('refuses a target that is not a plain identifier before any lookup', async () => {
    const { run, ran } = fakeRunner();
    await expect(dropSchemaObject(run, neo4j, { kind: 'index', label: 'Rule) DETACH DELETE (n', property: 'id' })).rejects.toThrow(
      /invalid label/,
    );
    expect(ran).toEqual([]);
  });

  it('reports a failed SHOW instead of throwing', async () => {
    const report = await dropSchemaObject(
      async () => {
        throw new Error('no permission');
      },
      neo4j,
      { kind: 'index', label: 'Rule', property: 'id' },
    );
    expect(report.failed).toHaveLength(1);
  });
});
