/**
 * Neo4j 5 refuses an aggregating column that reads a variable its clause does not project as a key
 * (`WITH bs + collect(x) AS els`: "Aggregation column contains implicit grouping expressions");
 * Memgraph runs it, so a Memgraph-only run never shows it. The lint checks every Cypher string in
 * dt-ws's sources and every @cypher statement in schema.graphql. The per-site tests pin the
 * rewritten clauses of the statements that had the shape: the lists are collected in one WITH and
 * added in the next.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  aggregationKeyViolations,
  aggregationKeyViolationsInFiles,
  cypherLintFiles,
  cypherProjections,
  cypherStatementsInSchema,
  cypherStringsInSource,
  formatAggregationKeyViolation,
} from '@dethernety/dt-module/cypher-lint';

const DT_WS = path.resolve(__dirname, '../../../..');
const SCHEMA = path.join(DT_WS, 'schema', 'schema.graphql');

const isTest = (file: string) => /\.(spec|test)\.ts$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);

/** The one Cypher string in `file` that contains every marker. */
function statementIn(file: string, ...markers: string[]): string {
  const text = fs.readFileSync(file, 'utf8');
  const strings = file.endsWith('.graphql') ? cypherStatementsInSchema(text) : cypherStringsInSource(text);
  const found = strings.filter((s) => markers.every((m) => s.text.includes(m)));
  if (found.length !== 1) throw new Error(`expected one statement in ${file} with ${markers.join(', ')}, found ${found.length}`);
  return found[0].text;
}

const columnsOf = (cypher: string) => cypherProjections(cypher).map((p) => p.columns);

/** The key columns of the clause whose last column is aliased `alias`. */
const keysBeside = (cypher: string, alias: string) =>
  columnsOf(cypher).find((columns) => columns[columns.length - 1].endsWith(` AS ${alias}`))?.slice(0, -1);

describe('Cypher aggregation keys — lint over dt-ws', () => {
  const sources = cypherLintFiles(path.join(DT_WS, 'src')).filter((f) => f.endsWith('.ts') && !isTest(f));

  it('reads dt-ws sources and the schema statements (a lint that reads nothing passes everything)', () => {
    const strings = sources.flatMap((f) => cypherStringsInSource(fs.readFileSync(f, 'utf8')));
    expect(strings.length).toBeGreaterThan(50);
    expect(cypherStatementsInSchema(fs.readFileSync(SCHEMA, 'utf8')).length).toBeGreaterThan(20);
  });

  it('finds no aggregating column that reads a variable its clause does not project', () => {
    const found = aggregationKeyViolationsInFiles([...sources, SCHEMA]).map((v) => formatAggregationKeyViolation(v, DT_WS));
    expect(found).toEqual([]);
  });
});

describe('Cypher aggregation keys — the rewritten statements', () => {
  it('the model delete enumeration collects with m as its key, then adds [m]', () => {
    const cypher = statementIn(
      path.join(DT_WS, 'src/gql/resolver-services/model-resolver.service.ts'),
      'ANALYZED_BY]->(a:Analysis)',
      'AS analysisIds',
    );
    expect(keysBeside(cypher, 'elems')).toEqual(['m']);
    expect(columnsOf(cypher)).toContainEqual(['[m] + elems AS owned']);
    expect(aggregationKeyViolations(cypher)).toEqual([]);
  });

  it('control gaps collects the model Data beside the structural list, then adds them', () => {
    const cypher = statementIn(
      path.join(DT_WS, 'src/gql/resolver-services/control-gaps-resolver.service.ts'),
      'UNWIND allElements AS element',
    );
    expect(keysBeside(cypher, 'modelData')).toEqual(['model', 'structural']);
    expect(columnsOf(cypher)).toContainEqual(['structural + modelData AS allElements']);
    expect(aggregationKeyViolations(cypher)).toEqual([]);
  });

  it('getControlsAssignedModels collects the data-flow branch beside ids1, then adds them', () => {
    const cypher = statementIn(SCHEMA, 'AS combined');
    expect(keysBeside(cypher, 'ids2')).toEqual(['cid', 'ids1']);
    expect(columnsOf(cypher)).toContainEqual(['cid', 'ids1 + ids2 AS combined']);
    expect(aggregationKeyViolations(cypher)).toEqual([]);
  });
});
