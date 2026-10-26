/**
 * The aggregation-key check: Neo4j 5 refuses an aggregating column that reads a variable the clause
 * does not project as a key; Memgraph accepts it. Each refused shape below is one Neo4j rejects, and
 * each accepted shape is one both engines run.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  aggregationKeyViolations,
  aggregationKeyViolationsInFiles,
  cypherLintFiles,
  cypherProjections,
  formatAggregationKeyViolation,
  cypherStatementsInSchema,
  cypherStringsInSource,
} from '../cypher-lint';

const flagged = (cypher: string) => aggregationKeyViolations(cypher).map((v) => v.variable);

describe('aggregationKeyViolations — refused shapes', () => {
  it('flags a list added to an aggregate in one column', () => {
    expect(flagged('MATCH (m) WITH m, collect(a) AS bs WITH bs + collect(DISTINCT c) AS els RETURN els'))
      .toEqual(['bs']);
  });

  it('flags every unprojected variable, once each', () => {
    expect(flagged('WITH bs + cs + bs + collect(df) AS els RETURN els')).toEqual(['bs', 'cs']);
  });

  it('flags a variable inside a list literal', () => {
    expect(flagged('MATCH (m) WITH [m] + collect(DISTINCT sb) AS owned RETURN owned')).toEqual(['m']);
  });

  it('flags the aggregate on the left of the variable too', () => {
    expect(flagged('WITH cid, collect(x) + ids1 AS combined RETURN combined')).toEqual(['ids1']);
  });

  it('flags a property access whose variable is not a key', () => {
    expect(flagged('MATCH (n) RETURN n.name + count(*) AS label')).toEqual(['n.name']);
  });

  it('flags a variable used outside the aggregate in a CASE', () => {
    expect(flagged('WITH CASE WHEN count(x) > 0 THEN y ELSE z END AS v RETURN v')).toEqual(['y', 'z']);
  });

  it('flags a RETURN as well as a WITH, with the line of its keyword', () => {
    const v = aggregationKeyViolations('MATCH (n)\nWITH n, collect(n) AS ns\nRETURN ns + collect(n) AS all');
    expect(v).toEqual([{ keyword: 'RETURN', line: 3, column: 'ns + collect(n) AS all', variable: 'ns' }]);
  });

  it('flags an outer variable a quantifier or reduce reads, beside the one it declares', () => {
    expect(flagged('WITH n, a WITH any(x IN collect(n) WHERE x.a = a) AS k RETURN k')).toEqual(['a']);
    expect(flagged('WITH reduce(acc = 0, v IN collect(a) | acc + v + y) AS t RETURN t')).toEqual(['y']);
  });

  it('flags an outer variable a pattern comprehension reads', () => {
    expect(flagged('MATCH (n) WITH n, 1 AS z WITH size([(n)-->(o) | o.id]) + count(*) AS k RETURN k')).toEqual(['n']);
  });

  it('flags a parenthesised aggregating column', () => {
    expect(flagged('WITH bs, x RETURN (bs + collect(x)) AS y')).toEqual(['bs']);
  });

  it('checks the columns after one that uses STARTS WITH', () => {
    expect(flagged("MATCH (n) RETURN n.id STARTS WITH 'a' AS s, count(*) + y AS c")).toEqual(['y']);
  });

  it('checks the columns after an alias named like a clause word', () => {
    expect(flagged('MATCH (n) WITH n, count(*) AS order, y + count(*) AS c RETURN c')).toEqual(['y']);
  });

  it('flags a deeper property access whose prefix is not a key', () => {
    expect(flagged('MATCH (n) WITH n.a.b + count(*) AS k RETURN k')).toEqual(['n.a.b']);
  });

  it('checks a clause inside a CALL subquery', () => {
    expect(flagged('MATCH (a) CALL { WITH a MATCH (a)-->(b) WITH a, b RETURN b + count(*) AS x } RETURN x'))
      .toEqual(['b']);
  });
});

describe('aggregationKeyViolations — accepted shapes', () => {
  it('accepts the two-step rewrite: collect first, add in the next clause', () => {
    expect(flagged('WITH m, bs, cs, collect(DISTINCT df) AS dfs WITH bs + cs + dfs AS els RETURN els')).toEqual([]);
  });

  it('accepts one clause that projects the variable as a key of its own', () => {
    expect(flagged('WITH bs, bs + collect(DISTINCT df) AS els RETURN els')).toEqual([]);
  });

  it('accepts aggregates added to each other', () => {
    expect(flagged('WITH m, collect(a) + collect(b) AS ab RETURN ab')).toEqual([]);
  });

  it('accepts a property access on a key, and the key expression itself', () => {
    expect(flagged('MATCH (n) WITH n, n.x + count(*) AS c RETURN c')).toEqual([]);
    expect(flagged('MATCH (n) WITH n.x, n.x + count(*) AS c RETURN c')).toEqual([]);
  });

  it('accepts the comprehension shape: its variable is local to it', () => {
    expect(flagged(
      'WITH el, [x IN collect(DISTINCT a) + collect(DISTINCT b) WHERE x IS NOT NULL] AS ids RETURN el, ids',
    )).toEqual([]);
  });

  it('accepts quantifier, reduce and pattern-comprehension variables', () => {
    expect(flagged('WITH any(x IN collect(a) WHERE x > 1) AS anyBig RETURN anyBig')).toEqual([]);
    expect(flagged('WITH reduce(acc = 0, v IN collect(a) | acc + v) AS total RETURN total')).toEqual([]);
    expect(flagged('MATCH (n) WITH n, size([(n)-->(o:X) | o.id]) + count(*) AS k RETURN k')).toEqual([]);
  });

  it('keeps a pattern comprehension\'s own variables local when an earlier map key or comprehension used the name', () => {
    expect(flagged('MATCH (n {o: 1}) WITH n, size([(n)-->(o) | o.id]) + count(*) AS k RETURN k')).toEqual([]);
    expect(flagged('MATCH (n) WITH n, [o IN [1] | o] AS l WITH n, size([(n)-->(o) | o.id]) + count(*) AS k RETURN k'))
      .toEqual([]);
  });

  it('keeps a named path in a pattern comprehension local', () => {
    expect(flagged('MATCH (n) WITH n, size([p = (n)-->(o) | p]) + count(*) AS k RETURN k')).toEqual([]);
  });

  it('does not read labels, relationship types, map keys or function names as variables', () => {
    expect(flagged(
      'MATCH (n) RETURN n, collect({id: n.id, kind: head(labels(n))}) + size([(n)-[:R]->(:L) | 1]) AS rows',
    )).toEqual([]);
  });

  it('reads a map value as a variable', () => {
    expect(flagged('RETURN {total: count(*), first: f} AS summary')).toEqual(['f']);
  });

  it('accepts parameters and literals beside an aggregate', () => {
    expect(flagged("RETURN $base + count(*) + 1 AS n, 'x' + toString(count(*)) AS s")).toEqual([]);
    expect(flagged('RETURN count(*) * 1e3 + 0x1F + 2.5E-1 AS k')).toEqual([]);
  });

  it('accepts a property access whose prefix is a key', () => {
    expect(flagged('MATCH (n) WITH n.a, n.a.b + count(*) AS k RETURN k')).toEqual([]);
  });

  it('skips COUNT {} and EXISTS {} subqueries, which are not aggregates', () => {
    expect(flagged('MATCH (n) RETURN n, COUNT { (n)-->() } AS degree')).toEqual([]);
    expect(flagged('MATCH (n) WITH n, EXISTS { MATCH (n)-->(o) RETURN o } AS linked RETURN n')).toEqual([]);
  });

  it('does not read a subquery\'s own variables as the column\'s', () => {
    expect(flagged('MATCH (n) WITH n, count(*) + COUNT { MATCH (o:Other) RETURN o } AS k RETURN k')).toEqual([]);
  });

  it('accepts a variable beside an aggregate when * projects it', () => {
    expect(flagged('MATCH (n) WITH n, 1 AS y RETURN *, y + count(*) AS c')).toEqual([]);
  });

  it('ends a projection at WHERE, ORDER BY and LIMIT', () => {
    expect(flagged('MATCH (n) WITH n, count(*) AS c WHERE c > x ORDER BY y LIMIT 5 RETURN n')).toEqual([]);
  });

  it('does not take a backtick-quoted name for a keyword', () => {
    expect(cypherProjections('MATCH (`WITH`) RETURN 1 AS x')).toEqual([{ keyword: 'RETURN', line: 1, columns: ['1 AS x'] }]);
  });

  it('does not take STARTS WITH or ENDS WITH for a projection', () => {
    expect(cypherProjections("MATCH (n) WHERE n.id STARTS WITH 'a' AND n.id ENDS WITH 'z' RETURN count(n) AS c"))
      .toEqual([{ keyword: 'RETURN', line: 1, columns: ['count(n) AS c'] }]);
  });

  it('ends a projection at a clause spliced in by an interpolation', () => {
    expect(flagged('MATCH (r) OPTIONAL MATCH (r)-[e]-() WITH r, count(e) AS rels $__interp RETURN count(*) AS n'))
      .toEqual([]);
  });

  it('ignores comments', () => {
    expect(flagged('WITH m, collect(a) AS as1 // bs + collect(b)\nRETURN as1')).toEqual([]);
  });
});

describe('cypherProjections', () => {
  it('splits each clause into its columns, aliases included', () => {
    expect(cypherProjections('MATCH (m)\nWITH DISTINCT m, collect(x) AS xs\nRETURN [m] + xs AS all')).toEqual([
      { keyword: 'WITH', line: 2, columns: ['m', 'collect(x) AS xs'] },
      { keyword: 'RETURN', line: 3, columns: ['[m] + xs AS all'] },
    ]);
  });
});

describe('cypherStringsInSource', () => {
  it('finds template literals and quoted strings that read as Cypher, interpolations replaced', () => {
    const source = [
      'const a = `MATCH (n)',
      '  WITH n, ${extra} RETURN n`;',
      "const b = 'MATCH (n) RETURN count(n) AS c';",
      "const prose = 'Return to the list';",
    ].join('\n');
    expect(cypherStringsInSource(source)).toEqual([
      { text: 'MATCH (n)\n  WITH n, $__interp RETURN n', line: 1 },
      { text: 'MATCH (n) RETURN count(n) AS c', line: 3 },
    ]);
  });

  it('finds a template nested in an interpolation', () => {
    const source = 'const q = `MATCH (n) ${on ? `WITH n, collect(x) AS xs RETURN xs` : ""} RETURN n`;';
    expect(cypherStringsInSource(source).map((s) => s.text)).toEqual([
      'WITH n, collect(x) AS xs RETURN xs',
      'MATCH (n) $__interp RETURN n',
    ]);
  });

  it('is not thrown off by a regex literal holding a quote or a backtick', () => {
    const source = [
      "const re = /`/g, quote = /'/;",
      'const q = `MATCH (n) WITH bs + collect(n) AS els RETURN els`;',
    ].join('\n');
    const found = cypherStringsInSource(source);
    expect(found.map((s) => s.line)).toEqual([2]);
    expect(aggregationKeyViolations(found[0].text).map((v) => v.variable)).toEqual(['bs']);
  });

  it('reads \\n, \\t and \\r escapes in a quoted string as whitespace', () => {
    const found = cypherStringsInSource("const q = 'MATCH (n)\\nWITH bs + collect(n) AS els\\tRETURN els';");
    expect(found).toHaveLength(1);
    expect(aggregationKeyViolations(found[0].text).map((v) => v.variable)).toEqual(['bs']);
  });

  it('skips strings inside comments', () => {
    expect(cypherStringsInSource('// `MATCH (n) WITH n RETURN n`\n/* "MATCH (n) RETURN n AS x" */')).toEqual([]);
  });
});

describe('cypherStatementsInSchema', () => {
  it('finds block and single-line @cypher statements with their lines', () => {
    const sdl = [
      'type Query {',
      '  a: Int @cypher(statement: """',
      '    MATCH (n) RETURN count(n) AS c',
      '  """, columnName: "c")',
      '  b: Int @cypher(statement: "MATCH (n) RETURN count(n) AS c", columnName: "c")',
      '}',
    ].join('\n');
    expect(cypherStatementsInSchema(sdl)).toEqual([
      { text: '\n    MATCH (n) RETURN count(n) AS c\n  ', line: 2 },
      { text: 'MATCH (n) RETURN count(n) AS c', line: 5 },
    ]);
  });
});

describe('cypherLintFiles and aggregationKeyViolationsInFiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cypher-lint-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('src/a.ts', 'const x = 1;\nconst q = `MATCH (n)\n  WITH bs + collect(n) AS els RETURN els`;\n');
  write('schema/schema.graphql', 'type Query {\n  a: [ID] @cypher(statement: """\n    MATCH (c) WITH ids + collect(c.id) AS all RETURN all\n  """)\n}\n');
  write('src/clean.mjs', "export const q = 'MATCH (n) RETURN count(n) AS c';\n");
  write('src/notes.md', '`MATCH (n) WITH bs + collect(n) AS els RETURN els`');
  write('node_modules/dep/index.ts', 'const q = `MATCH (n) WITH bs + collect(n) AS els RETURN els`;');
  write('dist/a.js', 'const q = `MATCH (n) WITH bs + collect(n) AS els RETURN els`;');

  it('lists the source and schema files, skipping node_modules and dist', () => {
    expect(cypherLintFiles(root).map((f) => path.relative(root, f))).toEqual([
      path.join('schema', 'schema.graphql'),
      path.join('src', 'a.ts'),
      path.join('src', 'clean.mjs'),
    ]);
  });

  it('reports each violation with its file and the file\'s line', () => {
    const found = aggregationKeyViolationsInFiles(cypherLintFiles(root));
    expect(found.map((v) => formatAggregationKeyViolation(v, root))).toEqual([
      `${path.join('schema', 'schema.graphql')}:3 WITH reads ids in "ids + collect(c.id) AS all"`,
      `${path.join('src', 'a.ts')}:3 WITH reads bs in "bs + collect(n) AS els"`,
    ]);
  });
});
