/**
 * Neo4j 5 refuses an aggregating column that reads a variable its clause does not project as a key
 * (`WITH bs + collect(x) AS els`); Memgraph runs it. The lint checks every Cypher string in the
 * module's sources. The support anchor's comprehension over added aggregates is legal: its only
 * variable outside the aggregates is its own.
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

const MODULE = path.resolve(__dirname, '..');
const files = cypherLintFiles(path.join(MODULE, 'src')).filter((f) => f.endsWith('.ts'));

describe('Cypher aggregation keys — lint over the coverage-tools module', () => {
  it('reads the module source (a lint that reads nothing passes everything)', () => {
    const strings = files.flatMap((f) => cypherStringsInSource(fs.readFileSync(f, 'utf8')));
    expect(strings.length).toBeGreaterThan(3);
  });

  it('finds no aggregating column that reads a variable its clause does not project', () => {
    const found = aggregationKeyViolationsInFiles(files).map((v) => formatAggregationKeyViolation(v, MODULE));
    expect(found).toEqual([]);
  });

  it('reads the support anchor\'s comprehension as one aggregating column beside its keys', () => {
    const source = fs.readFileSync(path.join(MODULE, 'src', 'DethernetyCoverageToolsModule.ts'), 'utf8');
    const anchor = cypherStringsInSource(source).filter((s) => s.text.includes('AS cms'));
    expect(anchor).toHaveLength(1);
    const columns = cypherProjections(anchor[0].text).map((p) => p.columns);
    expect(columns.find((c) => c[c.length - 1].endsWith(' AS cms'))?.slice(0, -1)).toEqual(['exp', 't']);
    expect(aggregationKeyViolations(anchor[0].text)).toEqual([]);
  });
});
