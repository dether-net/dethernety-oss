/**
 * The module's Cypher is read-only and portable: no write clause or procedure call (Memgraph does not enforce
 * a read session's access mode, so this is the module's own guarantee), no aggregating column that reads a
 * variable its clause does not project (Neo4j refuses it; Memgraph runs it), and every LIMIT an integer literal.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { aggregationKeyViolations, cypherLintFiles, cypherStringsInSource } from '@dethernety/dt-module/cypher-lint';
import { READS } from '../src/reads';

const SRC = path.resolve(__dirname, '..', 'src');
const strings = cypherLintFiles(SRC)
  .filter((f) => f.endsWith('.ts'))
  .flatMap((f) => cypherStringsInSource(fs.readFileSync(f, 'utf8')).map((s) => s.text));

const WRITE = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DETACH|FOREACH|LOAD|CALL|DROP|ALTER|GRANT|REVOKE|DENY|USE|TERMINATE|FREE|RECOVER|ANALYZE|STORAGE)\b/i;

/** The only keywords the module's reads may use; anything else, including any write or admin clause, fails. */
const ALLOWED_KEYWORDS = new Set([
  'MATCH', 'OPTIONAL', 'UNWIND', 'WHERE', 'WITH', 'RETURN', 'DISTINCT', 'ORDER', 'BY', 'SKIP', 'LIMIT', 'UNION', 'ALL', 'AS',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
]);

/** The upper-case words of a statement, outside strings and backticks, and not a label or relationship type. */
function keywordsOf(cypher: string): string[] {
  const bare = cypher.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ').replace(/:\s*[A-Za-z_][A-Za-z0-9_]*/g, ' ');
  return [...bare.matchAll(/\b[A-Z][A-Z_]+\b/g)].map((m) => m[0]);
}

describe("the module's Cypher", () => {
  it('reads the module source (a lint that reads nothing passes everything)', () => {
    // One source template per fact type; the per-kind templates each give four reads, checked as READS below.
    expect(strings.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(READS).length).toBe(21);
  });

  it('holds no write clause and no procedure call', () => {
    expect(strings.filter((s) => WRITE.test(s))).toEqual([]);
    expect(Object.values(READS).filter((s) => WRITE.test(s))).toEqual([]);
  });

  it('uses only the allowed keywords', () => {
    for (const [name, text] of Object.entries(READS)) {
      expect(keywordsOf(text).filter((k) => !ALLOWED_KEYWORDS.has(k)), name).toEqual([]);
    }
  });

  it('the keyword check itself refuses write and admin clauses', () => {
    for (const s of ['MATCH (n) DETACH DELETE n', 'DROP INDEX ON :X(id)', 'MATCH (n) SET n.x = 1', 'LOAD PARQUET FROM "x" AS r', 'CALL db.labels()', 'STORAGE MODE IN_MEMORY_ANALYTICAL']) {
      expect(keywordsOf(s).some((k) => !ALLOWED_KEYWORDS.has(k)), s).toBe(true);
    }
    expect(keywordsOf("MATCH (a:Component {id: 'X'})-[:IS_INSTANCE_OF]->(c) RETURN c")).toEqual(['MATCH', 'RETURN']);
  });

  it('the write check itself finds each write form', () => {
    for (const s of ['CREATE (n)', 'MATCH (n) SET n.x = 1', 'MERGE (n)', 'MATCH (n) DETACH DELETE n', 'LOAD CSV FROM "x" AS r', 'CALL db.labels()', 'MATCH (n) REMOVE n.x']) {
      expect(WRITE.test(s), s).toBe(true);
    }
  });

  it('projects every aggregate key', () => {
    expect(Object.values(READS).flatMap((s) => aggregationKeyViolations(s))).toEqual([]);
  });

  it('limits every RETURN with an integer literal, never a parameter', () => {
    for (const [name, text] of Object.entries(READS)) {
      const limits = [...text.matchAll(/\bLIMIT\s+(\S+)/g)].map((m) => m[1]);
      expect(limits.length, name).toBe([...text.matchAll(/\bRETURN\b/g)].length);
      for (const l of limits) expect(l, name).toMatch(/^\d+$/);
    }
  });

  it('never collects a map and never builds a map literal in a list comprehension', () => {
    for (const text of Object.values(READS)) {
      expect(text).not.toMatch(/collect\s*\(\s*DISTINCT\s*\{/i);
      expect(text).not.toMatch(/\[[^\]]*\|\s*\{/);
    }
  });
});
