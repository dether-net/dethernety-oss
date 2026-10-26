/**
 * Neo4j 5 refuses an aggregating column that reads a variable its clause does not project as a key
 * (`WITH bs + collect(x) AS els`); Memgraph runs it. The lint checks every Cypher string in the
 * module's sources and in its e2e suites, which copy the module's statements. The per-site test pins
 * the ledger's rewritten clauses: the lists are collected in one WITH and added in the next.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  aggregationKeyViolations,
  aggregationKeyViolationsInFiles,
  cypherLintFiles,
  cypherProjections,
  cypherStringsInSource,
  formatAggregationKeyViolation,
} from '@dethernety/dt-module/cypher-lint';

const MODULE = path.resolve(__dirname, '../..');
const isUnitTest = (file: string) => /\.test\.ts$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);
const files = [
  ...cypherLintFiles(path.join(MODULE, 'src')).filter((f) => f.endsWith('.ts') && !isUnitTest(f)),
  ...cypherLintFiles(path.join(MODULE, 'test')).filter((f) => f.endsWith('.ts')),
];

describe('Cypher aggregation keys — lint over the threat-report module', () => {
  it('reads the module source and its e2e copies (a lint that reads nothing passes everything)', () => {
    const strings = files.flatMap((f) => cypherStringsInSource(fs.readFileSync(f, 'utf8')));
    expect(strings.length).toBeGreaterThan(5);
    expect(files.map((f) => path.relative(MODULE, f))).toContain(path.join('test', 'compute-ledger.e2e.spec.ts'));
  });

  it('finds no aggregating column that reads a variable its clause does not project', () => {
    const found = aggregationKeyViolationsInFiles(files).map((v) => formatAggregationKeyViolation(v, MODULE));
    expect(found).toEqual([]);
  });
});

describe('Cypher aggregation keys — the ledger statement', () => {
  it('collects the data flows beside the other lists, then adds them', () => {
    const source = fs.readFileSync(path.join(MODULE, 'src', 'DethernetyThreatReportModule.ts'), 'utf8');
    const ledger = cypherStringsInSource(source).filter((s) => s.text.includes('AS ledger'));
    expect(ledger).toHaveLength(1);
    const columns = cypherProjections(ledger[0].text).map((p) => p.columns);
    expect(columns.find((c) => c[c.length - 1].endsWith(' AS dfs'))?.slice(0, -1)).toEqual(['m', 'bs', 'cs', 'ds']);
    expect(columns).toContainEqual(['bs + cs + ds + dfs AS els']);
    expect(aggregationKeyViolations(ledger[0].text)).toEqual([]);
  });
});
