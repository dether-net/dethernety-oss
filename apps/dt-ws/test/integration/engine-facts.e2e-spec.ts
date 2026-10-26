/**
 * The engine facts the platform's code relies on, asserted against the engine this run uses (DT_TEST_ENGINE). Each
 * test states one assumption; a failure names the assumption that is wrong, with the engine's own answer. Where the
 * code handles two answers (an error or a no-op), the test accepts exactly those two and prints which one came, with
 * the engine's notifications.
 *
 * Every test uses labels of its own (Fact*), so the tests do not depend on each other. Facts that only an external
 * test database can show (its server name, the reset over every kind) run only in an external run.
 */
import neo4j, { Driver, Session } from 'neo4j-driver';
import { ensureSchema, probeEngine, type EngineInfo } from '@dethernety/dt-module';
import { isExternalTestRun, openExternalTestDatabase } from '@dethernety/dt-module/test-database';

import { startMemgraph, MemgraphHandle } from './memgraph-container';
import { describeMemgraphOnly, describeNeo4jOnly, serverFailureLogging, TEST_ENGINE } from './test-engine';

jest.setTimeout(240_000);

const DATABASE = 'memgraph';
const itExternal = isExternalTestRun() ? it : it.skip;

let handle: MemgraphHandle;
let driver: Driver;

beforeAll(async () => {
  handle = await startMemgraph();
  driver = handle.driver;
});

afterAll(async () => {
  await handle?.stop();
});

async function withSession<T>(fn: (session: Session) => Promise<T>, database = DATABASE, read = false): Promise<T> {
  const session = driver.session({ database, ...(read ? { defaultAccessMode: neo4j.session.READ } : {}) });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

async function run(cypher: string, params: Record<string, unknown> = {}, database = DATABASE) {
  return withSession((session) => session.run(cypher, params), database);
}

async function rows(cypher: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  return (await run(cypher, params)).records.map((record) => record.toObject());
}

interface Outcome {
  at: 'ok' | 'RUN' | 'PULL';
  code?: string;
  gqlStatus?: string;
  message?: string;
  notifications?: string[];
}

/** Where a statement fails: at RUN (its keys never arrive), at PULL (the summary fails), or not at all. */
async function outcome(cypher: string, params: Record<string, unknown> = {}): Promise<Outcome> {
  return withSession(async (session) => {
    const result = session.run(cypher, params);
    const failed = (at: 'RUN' | 'PULL', error: unknown): Outcome => {
      const e = error as { code?: string; gqlStatus?: string; message?: string };
      return { at, code: e.code, gqlStatus: e.gqlStatus, message: e.message };
    };
    try {
      await result.keys();
    } catch (error) {
      return failed('RUN', error);
    }
    try {
      const summary = await result.summary();
      return { at: 'ok', notifications: summary.notifications.map((n) => `${n.code}: ${n.title}`) };
    } catch (error) {
      return failed('PULL', error);
    }
  });
}

/** The statement was a no-op, or failed with the one error the code treats as "already there" / "not there". */
function expectNoOpOr(result: Outcome, allowed: RegExp): void {
  if (result.at !== 'ok') expect(`${result.code ?? ''} ${result.message ?? ''}`).toMatch(allowed);
}

function report(fact: string, value: unknown): void {
  console.log(`[engine-fact ${TEST_ENGINE}] ${fact}: ${JSON.stringify(value)}`);
}

const count = (value: unknown): number => (neo4j.isInt(value) ? (value as { toNumber(): number }).toNumber() : Number(value));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe(`engine facts on ${TEST_ENGINE}`, () => {
  it('the engine probe answers this engine, in a write and in a read session', async () => {
    const info = await probeEngine(driver, DATABASE);
    report('probeEngine', info);
    expect(info.engine).toBe(TEST_ENGINE);
    // The console probes in a read session, naming the database.
    const components = await withSession(
      (session) => session.run('CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition'),
      DATABASE,
      true,
    );
    const names = components.records.map((r) => String(r.get('name')));
    report('dbms.components (read)', components.records.map((r) => r.toObject()));
    expect(names.join(' ')).toMatch(TEST_ENGINE === 'memgraph' ? /Memgraph/i : /Neo4j/i);
  });

  it('the batched delete the test-database reset runs is accepted and answers its count', async () => {
    await run('UNWIND range(1, 3) AS i CREATE (:FactDelete {i: i})');
    const [row] = await rows('MATCH (n:FactDelete) WITH n LIMIT 10000 DETACH DELETE n RETURN count(*) AS deleted');
    expect(count(row.deleted)).toBe(3);
    const [again] = await rows('MATCH (n:FactDelete) WITH n LIMIT 10000 DETACH DELETE n RETURN count(*) AS deleted');
    expect(count(again.deleted)).toBe(0);
  });

  it('the uniqueness pre-check runs: a duplicated key keeps the constraint out, and it is reported', async () => {
    await run('CREATE (:FactPre {a: 1, b: 1}), (:FactPre {a: 1, b: 1}), (:FactPre {a: 2})');
    const engineInfo: EngineInfo = await probeEngine(driver, DATABASE);
    const result = await ensureSchema((cypher: string) => run(cypher), engineInfo, {
      constraints: [{ label: 'FactPre', properties: ['a', 'b'], kind: 'unique' }],
    });
    report('ensureSchema on a duplicated key', result);
    expect(JSON.stringify(result.failed)).toMatch(/not run: 1 key value\(s\) are on more than one node/);
    expect(JSON.stringify(result.failed)).toMatch(/1 node\(s\) lack a key property/);
  });

  itExternal('the reset of the external test database clears every kind the platform creates', async () => {
    if (TEST_ENGINE === 'memgraph') {
      for (const statement of [
        'CREATE INDEX ON :FactKind',
        'CREATE INDEX ON :FactKind(id)',
        'CREATE INDEX ON :FactKind(m, r)',
        'CREATE EDGE INDEX ON :FACT_KIND',
        'CREATE EDGE INDEX ON :FACT_KIND(k)',
        'CREATE CONSTRAINT ON (n:FactKind) ASSERT n.a, n.b IS UNIQUE',
        'CREATE CONSTRAINT ON (n:FactKind) ASSERT EXISTS (n.id)',
        'CREATE VECTOR INDEX fact_kind_vec ON :FactKindVec(embedding) WITH CONFIG {"dimension": 2, "capacity": 10, "metric": "cos"}',
      ]) {
        await run(statement);
      }
    } else {
      await run('CREATE INDEX fact_kind_id IF NOT EXISTS FOR (n:FactKind) ON (n.id)');
      await run('CREATE INDEX fact_kind_rel IF NOT EXISTS FOR ()-[r:FACT_KIND]-() ON (r.k)');
      await run('CREATE CONSTRAINT fact_kind_ab IF NOT EXISTS FOR (n:FactKind) REQUIRE (n.a, n.b) IS UNIQUE');
    }
    await run("CREATE (:FactKind {id: 1, a: 1, b: 2})-[:FACT_KIND {k: 'x'}]->(:FactKind {id: 2, a: 2, b: 2})");
    const uri = TEST_ENGINE === 'memgraph' ? process.env.MEMGRAPH_TEST_URI : process.env.NEO4J_TEST_URI;
    // The reset throws if anything it does not know, or anything it should have dropped, is left.
    const reopened = await openExternalTestDatabase(TEST_ENGINE, uri!, (target) =>
      neo4j.driver(target, neo4j.auth.basic('', ''), { logging: serverFailureLogging() }),
    );
    await reopened.close();
    const [left] = await rows('MATCH (n) RETURN count(n) AS c');
    expect(count(left.c)).toBe(0);
  });

  // Neo4j 5 refuses an aggregating column that reads a variable its clause does not project as a key ("implicit
  // grouping expressions"); Memgraph runs it. The platform's statements collect in one WITH and add the lists in the
  // next, which both engines accept, and so is a comprehension whose only variable outside the aggregates is its own.
  describe('a variable beside an aggregate', () => {
    const PREFIX = `MATCH (m:FactAggModel {id: $id})
      OPTIONAL MATCH (m)-[:FACT_AGG]->(a:FactAggA)
      WITH m, collect(DISTINCT a.k) AS aks
      OPTIONAL MATCH (m)-[:FACT_AGG]->(b:FactAggB)`;
    const ks = (found: Record<string, unknown>[]) =>
      found.map((r) => (r.ks as unknown[]).map(count).sort((x, y) => x - y));

    beforeAll(async () => {
      await run(`CREATE (m:FactAggModel {id: 'full'}), (:FactAggModel {id: 'empty'}),
        (m)-[:FACT_AGG]->(:FactAggA {k: 1}), (m)-[:FACT_AGG]->(:FactAggB {k: 2}), (m)-[:FACT_AGG]->(:FactAggB {k: 3})`);
    });

    it('in one column with an aggregate, and not a key of its own: refused on Neo4j, run on Memgraph', async () => {
      const implicit = await outcome(`${PREFIX} WITH aks + collect(DISTINCT b.k) AS ks RETURN ks`, { id: 'full' });
      report('variable + collect(...) in one column', implicit);
      if (TEST_ENGINE === 'neo4j') {
        expect(implicit.at).not.toBe('ok');
        expect(implicit.code).toBe('Neo.ClientError.Statement.SyntaxError');
        expect(implicit.message).toMatch(/implicit grouping expressions/);
      } else {
        expect(implicit.at).toBe('ok');
      }
    });

    it('collected first and added in the next WITH: accepted, one row per model, empty lists for an empty one', async () => {
      const twoStep = `${PREFIX} WITH m, aks, collect(DISTINCT b.k) AS bks WITH aks + bks AS ks RETURN ks`;
      expect(ks(await rows(twoStep, { id: 'full' }))).toEqual([[1, 2, 3]]);
      expect(ks(await rows(twoStep, { id: 'empty' }))).toEqual([[]]);
      expect(await rows(twoStep, { id: 'absent' })).toEqual([]);
    });

    it('in one column with the variable also projected as a key: accepted', async () => {
      const keyed = `${PREFIX} WITH aks, aks + collect(DISTINCT b.k) AS ks RETURN ks`;
      expect(ks(await rows(keyed, { id: 'full' }))).toEqual([[1, 2, 3]]);
    });

    it('a comprehension over added aggregates, its variable its own: accepted', async () => {
      const comprehension = `MATCH (m:FactAggModel {id: $id})
        OPTIONAL MATCH (m)-[:FACT_AGG]->(a:FactAggA)
        OPTIONAL MATCH (m)-[:FACT_AGG]->(b:FactAggB)
        WITH m, [x IN collect(DISTINCT a.k) + collect(DISTINCT b.k) WHERE x IS NOT NULL] AS ks
        RETURN ks`;
      expect(ks(await rows(comprehension, { id: 'full' }))).toEqual([[1, 2, 3]]);
      expect(ks(await rows(comprehension, { id: 'empty' }))).toEqual([[]]);
    });
  });
});

describeMemgraphOnly('Memgraph facts', () => {
  itExternal('the test Memgraph reports the server name it was started with, and still probes as Memgraph', async () => {
    const info = await driver.getServerInfo();
    report('server agent', info.agent);
    expect(info.agent).toBe('dt-test-memgraph');
    expect((await probeEngine(driver, DATABASE)).engine).toBe('memgraph');
  });

  it('SHOW INDEX INFO and SHOW CONSTRAINT INFO name their columns and kinds as the test-database reset reads them', async () => {
    for (const statement of [
      'CREATE INDEX ON :FactShow',
      'CREATE INDEX ON :FactShow(id)',
      'CREATE INDEX ON :FactShow(m, r)',
      'CREATE EDGE INDEX ON :FACT_SHOW',
      'CREATE EDGE INDEX ON :FACT_SHOW(k)',
      'CREATE CONSTRAINT ON (n:FactShow) ASSERT n.a, n.b IS UNIQUE',
      'CREATE CONSTRAINT ON (n:FactShow) ASSERT EXISTS (n.id)',
      'CREATE VECTOR INDEX fact_show_vec ON :FactShowVec(embedding) WITH CONFIG {"dimension": 2, "capacity": 10, "metric": "cos"}',
    ]) {
      await run(statement);
    }
    const all = await rows('SHOW INDEX INFO');
    const indexes = all.filter((r) => r.label === 'FactShow' || r.label === 'FACT_SHOW');
    const vector = all.filter((r) => r.label === 'FactShowVec');
    const constraints = (await rows('SHOW CONSTRAINT INFO')).filter((r) => r.label === 'FactShow');
    report('SHOW INDEX INFO', [...indexes, ...vector]);
    report('vector index rows in SHOW INDEX INFO', vector.length);
    report('SHOW CONSTRAINT INFO', constraints);
    for (const row of indexes) expect(Object.keys(row)).toEqual(expect.arrayContaining(['index type', 'label', 'property']));
    expect(new Set(indexes.map((r) => r['index type']))).toEqual(
      new Set(['label', 'label+property', 'edge-type', 'edge-type+property']),
    );
    // A label+property row carries its properties as a list; the reset accepts a list or a single name.
    expect(indexes.filter((r) => r['index type'] === 'label+property').map((r) => r.property)).toContainEqual(['m', 'r']);
    // A vector index is told apart by its kind, which the reset leaves to DROP VECTOR INDEX.
    for (const row of vector) expect(String(row['index type'])).toMatch(/vector/);
    for (const row of constraints) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining(['constraint type', 'label', 'properties']));
    }
    expect(new Set(constraints.map((r) => r['constraint type']))).toEqual(new Set(['unique', 'exists']));
    // A unique constraint lists its properties as a list, in an order of the engine's own.
    expect([...((constraints.find((r) => r['constraint type'] === 'unique')?.properties as string[]) ?? [])].sort()).toEqual(['a', 'b']);
    const exists = constraints.find((r) => r['constraint type'] === 'exists')?.properties;
    // An exists constraint carries one property, as a name or a one-element list.
    expect(Array.isArray(exists) ? exists : [exists]).toEqual(['id']);
  });

  it('re-creating an existing index or edge index is a no-op or "already exists"; a constraint is a no-op', async () => {
    await run('CREATE INDEX ON :FactAgain(id)');
    await run('CREATE EDGE INDEX ON :FACT_AGAIN(k)');
    await run('CREATE CONSTRAINT ON (n:FactAgain) ASSERT n.id IS UNIQUE');
    for (const statement of ['CREATE INDEX ON :FactAgain(id)', 'CREATE EDGE INDEX ON :FACT_AGAIN(k)']) {
      const second = await outcome(statement);
      report(`again: ${statement}`, second);
      expectNoOpOr(second, /already\s+exists/i);
    }
    // The constraint bootstrap counts any error as a failure, so this one must not raise.
    const constraint = await outcome('CREATE CONSTRAINT ON (n:FactAgain) ASSERT n.id IS UNIQUE');
    report('again: the unique constraint', constraint);
    expect(constraint.at).toBe('ok');
    const indexes = (await rows('SHOW INDEX INFO')).filter((r) => r.label === 'FactAgain' || r.label === 'FACT_AGAIN');
    expect(indexes.filter((r) => r['index type'] === 'label+property')).toHaveLength(1);
    expect(indexes.filter((r) => r['index type'] === 'edge-type+property')).toHaveLength(1);
    expect((await rows('SHOW CONSTRAINT INFO')).filter((r) => r.label === 'FactAgain')).toHaveLength(1);
  });

  it('dropping an absent index or constraint is a no-op or "does not exist"', async () => {
    for (const statement of [
      'DROP INDEX ON :FactAbsent(id)',
      'DROP EDGE INDEX ON :FACT_ABSENT(k)',
      'DROP CONSTRAINT ON (n:FactAbsent) ASSERT n.id IS UNIQUE',
    ]) {
      const result = await outcome(statement);
      report(`absent: ${statement}`, result);
      expectNoOpOr(result, /doesn'?t exist|does not exist/i);
    }
  });

  it('a composite unique constraint holds, and drops', async () => {
    await run('CREATE CONSTRAINT ON (n:FactComposite) ASSERT n.m, n.r IS UNIQUE');
    await run('CREATE (:FactComposite {m: 1, r: 1}), (:FactComposite {m: 1, r: 2})');
    const duplicate = await outcome('CREATE (:FactComposite {m: 1, r: 1})');
    report('composite duplicate', duplicate);
    expect(duplicate.at).not.toBe('ok');
    await run('DROP CONSTRAINT ON (n:FactComposite) ASSERT n.m, n.r IS UNIQUE');
    expect((await rows('SHOW CONSTRAINT INFO')).filter((r) => r.label === 'FactComposite')).toHaveLength(0);
  });

  it('a composite unique constraint over nodes that lack a key property is created (missing values are exempt)', async () => {
    await run('CREATE (:FactMissing {m: 1}), (:FactMissing {m: 1}), (:FactMissing {r: 2})');
    const created = await outcome('CREATE CONSTRAINT ON (n:FactMissing) ASSERT n.m, n.r IS UNIQUE');
    report('composite unique over missing keys', created);
    const listed = (await rows('SHOW CONSTRAINT INFO')).filter((r) => r.label === 'FactMissing');
    if (created.at === 'ok') {
      expect(listed).toHaveLength(1);
    } else {
      // The refusal ensureSchema reports with the missing count.
      expect(created.message).toMatch(/Unable to create unique constraint/i);
      expect(listed).toHaveLength(0);
    }
  });

  it('vector_search.show_index_info() runs inside a read transaction and yields what dt-ws reads', async () => {
    await run('CREATE VECTOR INDEX fact_read_vec ON :FactReadVec(embedding) WITH CONFIG {"dimension": 2, "capacity": 10, "metric": "cos"}');
    const session = driver.session({ database: DATABASE });
    try {
      const listed = await session.executeRead((tx) =>
        tx.run('CALL vector_search.show_index_info() YIELD index_name, label, property, dimension, size RETURN index_name, dimension'),
      );
      report('show_index_info in executeRead', listed.records.map((r) => r.toObject()));
      expect(listed.records.map((r) => r.get('index_name'))).toContain('fact_read_vec');
    } finally {
      await session.close();
    }
  });
});

describeNeo4jOnly('Neo4j facts', () => {
  const INDEXES = 'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, owningConstraint';

  async function indexesOn(label: string): Promise<Record<string, unknown>[]> {
    return (await rows(INDEXES)).filter((r) => Array.isArray(r.labelsOrTypes) && (r.labelsOrTypes as string[]).includes(label));
  }

  it('the test Neo4j names memgraph as its default database, and has the two token lookup indexes', async () => {
    const result = await run('SHOW DEFAULT DATABASE YIELD name', {}, 'system');
    const names = result.records.map((r) => r.get('name'));
    report('SHOW DEFAULT DATABASE', names);
    expect(names).toEqual(['memgraph']);
    const lookups = (await rows(INDEXES)).filter((r) => r.type === 'LOOKUP');
    expect(lookups).toHaveLength(2);
  });

  it('a named CREATE INDEX IF NOT EXISTS is a no-op against an equivalent unnamed index', async () => {
    await run('CREATE INDEX FOR (n:FactNamed) ON (n.k)');
    const named = await outcome('CREATE INDEX fact_named_k IF NOT EXISTS FOR (n:FactNamed) ON (n.k)');
    report('named IF NOT EXISTS index', named);
    expect(named.at).toBe('ok');
    const indexes = await indexesOn('FactNamed');
    expect(indexes).toHaveLength(1);
    expect(indexes[0].name).not.toBe('fact_named_k');
  });

  it('a named CREATE CONSTRAINT IF NOT EXISTS is a no-op against an equivalent unnamed constraint', async () => {
    await run('CREATE CONSTRAINT FOR (n:FactNamedC) REQUIRE n.k IS UNIQUE');
    const named = await outcome('CREATE CONSTRAINT fact_named_c IF NOT EXISTS FOR (n:FactNamedC) REQUIRE n.k IS UNIQUE');
    report('named IF NOT EXISTS constraint', named);
    expect(named.at).toBe('ok');
    const constraints = (await rows('SHOW CONSTRAINTS YIELD name, labelsOrTypes')).filter((r) =>
      (r.labelsOrTypes as string[]).includes('FactNamedC'),
    );
    expect(constraints).toHaveLength(1);
  });

  it('a composite uniqueness constraint works on this edition, keeps its property order, and exempts missing values', async () => {
    await run('CREATE CONSTRAINT fact_comp IF NOT EXISTS FOR (n:FactComp) REQUIRE (n.a, n.b) IS UNIQUE');
    const [constraint] = (await rows('SHOW CONSTRAINTS YIELD name, properties')).filter((r) => r.name === 'fact_comp');
    expect(constraint.properties).toEqual(['a', 'b']);
    await run('CREATE (:FactComp {a: 1, b: 1}), (:FactComp {a: 1, b: 2}), (:FactComp {a: 1}), (:FactComp {a: 1})');
    const duplicate = await outcome('CREATE (:FactComp {a: 1, b: 1})');
    report('composite duplicate', duplicate);
    expect(duplicate.at).not.toBe('ok');
    expect(duplicate.code).toMatch(/ConstraintValidationFailed/);
  });

  it('SHOW INDEXES and SHOW CONSTRAINTS give the columns and values the schema code reads', async () => {
    await run('CREATE CONSTRAINT fact_show_c IF NOT EXISTS FOR (n:FactShowN) REQUIRE n.k IS UNIQUE');
    await run('CREATE INDEX fact_show_rel IF NOT EXISTS FOR ()-[r:FACT_SHOW_N]-() ON (r.k)');
    await run('CREATE INDEX fact_show_plain IF NOT EXISTS FOR (n:FactShowP) ON (n.k)');
    const owned = (await indexesOn('FactShowN'))[0];
    const relationship = (await indexesOn('FACT_SHOW_N'))[0];
    const plain = (await indexesOn('FactShowP'))[0];
    const [constraint] = (await rows('SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties')).filter(
      (r) => r.name === 'fact_show_c',
    );
    report('owned / relationship / plain index', [owned, relationship, plain]);
    report('constraint', constraint);
    expect(owned).toMatchObject({ type: 'RANGE', owningConstraint: 'fact_show_c' });
    expect(relationship).toMatchObject({ type: 'RANGE', entityType: 'RELATIONSHIP', owningConstraint: null });
    expect(plain).toMatchObject({ type: 'RANGE', entityType: 'NODE', owningConstraint: null });
    expect(['UNIQUENESS', 'NODE_PROPERTY_UNIQUENESS']).toContain(constraint.type);
    expect(constraint).toMatchObject({ entityType: 'NODE', labelsOrTypes: ['FactShowN'], properties: ['k'] });
  });

  it('a plain index blocks a constraint on its key, and dropping it first lets the constraint in', async () => {
    await run('CREATE INDEX fact_block_k IF NOT EXISTS FOR (n:FactBlock) ON (n.k)');
    const blocked = await outcome('CREATE CONSTRAINT fact_block_c IF NOT EXISTS FOR (n:FactBlock) REQUIRE n.k IS UNIQUE');
    report('constraint over a plain index', blocked);
    expect(blocked.at).not.toBe('ok');
    expect(blocked.code).toMatch(/^Neo\.ClientError\.Schema\./);
    expect((await rows('SHOW CONSTRAINTS YIELD name')).filter((r) => r.name === 'fact_block_c')).toHaveLength(0);
    await run('DROP INDEX fact_block_k IF EXISTS');
    await run('CREATE CONSTRAINT fact_block_c IF NOT EXISTS FOR (n:FactBlock) REQUIRE n.k IS UNIQUE');
    expect((await rows('SHOW CONSTRAINTS YIELD name')).filter((r) => r.name === 'fact_block_c')).toHaveLength(1);
  });

  it('an index on the first key property does not block a composite constraint', async () => {
    await run('CREATE INDEX fact_part_m IF NOT EXISTS FOR (n:FactPart) ON (n.m)');
    const composite = await outcome('CREATE CONSTRAINT fact_part_c IF NOT EXISTS FOR (n:FactPart) REQUIRE (n.m, n.r) IS UNIQUE');
    report('composite constraint beside a first-property index', composite);
    expect(composite.at).toBe('ok');
    expect((await indexesOn('FactPart')).map((r) => r.name).sort()).toEqual(['fact_part_c', 'fact_part_m']);
  });

  it('CREATE INDEX IF NOT EXISTS on a constraint-covered key: a no-op or a schema error, and no second index', async () => {
    await run('CREATE CONSTRAINT fact_cover_c IF NOT EXISTS FOR (n:FactCover) REQUIRE n.k IS UNIQUE');
    const covered = await outcome('CREATE INDEX fact_cover_k IF NOT EXISTS FOR (n:FactCover) ON (n.k)');
    report('index over a constraint-covered key', covered);
    expectNoOpOr(covered, /Neo\.ClientError\.Schema\./);
    expect((await indexesOn('FactCover')).map((r) => r.name)).toEqual(['fact_cover_c']);
  });

  it('a MERGE on the full constrained key is a locking unique seek, even beside an index on its first property', async () => {
    await run('CREATE CONSTRAINT fact_merge_c IF NOT EXISTS FOR (n:FactMerge) REQUIRE (n.m, n.r) IS UNIQUE');
    await run('CREATE INDEX fact_merge_m IF NOT EXISTS FOR (n:FactMerge) ON (n.m)');
    // A populating index is ignored by the planner, so wait for it.
    await run('CALL db.awaitIndexes(60)');
    const result = await run(
      'EXPLAIN MATCH (a:FactMergeAnchor {id: $a}) MERGE (n:FactMerge {m: $m, r: $r}) SET n.x = 1 MERGE (a)-[:FACT_MERGE]->(n)',
      { a: 'x', m: 'model', r: 'req' },
    );
    const operators: string[] = [];
    const walk = (plan: { operatorType: string; children?: unknown[] } | false | undefined): void => {
      if (!plan) return;
      operators.push(plan.operatorType.replace(/@.*$/, ''));
      for (const child of plan.children ?? []) walk(child as { operatorType: string; children?: unknown[] });
    };
    walk(result.summary.plan as never);
    report('MERGE plan', operators);
    expect(operators).toContain('NodeUniqueIndexSeek(Locking)');
    expect(operators).not.toContain('NodeIndexSeek');
  });

  it('a second MERGE on the same full key waits for the first, then matches its node with no error', async () => {
    await run('CREATE CONSTRAINT fact_race_c IF NOT EXISTS FOR (n:FactRace) REQUIRE (n.m, n.r) IS UNIQUE');
    const first = driver.session({ database: DATABASE });
    const second = driver.session({ database: DATABASE });
    const tx1 = first.beginTransaction();
    const tx2 = second.beginTransaction();
    try {
      await tx1.run('MERGE (n:FactRace {m: 1, r: 1}) SET n.by = 1');
      const late = tx2.run('MERGE (n:FactRace {m: 1, r: 1}) SET n.seen = true RETURN n.by AS by');
      // Wait until the second is blocked on the first; the pattern does not match this query itself.
      let blocked = false;
      for (let i = 0; i < 50 && !blocked; i++) {
        const tx = await rows('SHOW TRANSACTIONS YIELD currentQuery, status');
        blocked = tx.some((t) => String(t.currentQuery).startsWith('MERGE (n:FactRace') && String(t.status).startsWith('Blocked'));
        if (!blocked) await sleep(100);
      }
      report('second MERGE blocked on the first', blocked);
      expect(blocked).toBe(true);
      await tx1.commit();
      const result = await late;
      await tx2.commit();
      expect(result.records.map((r) => count(r.get('by')))).toEqual([1]);
    } finally {
      await first.close();
      await second.close();
    }
    expect(await rows('MATCH (n:FactRace) RETURN n')).toHaveLength(1);
  });
});
