/**
 * database.ts — Cypher file execution against Memgraph / Neo4j.
 *
 * Handles multi-statement parsing, comment stripping, and LOAD CSV.
 * Mirrors the DatabaseClient from the Go management-service.
 */

import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

let neo4j: typeof import('neo4j-driver');

async function loadDriver() {
  if (!neo4j) {
    neo4j = await import('neo4j-driver');
  }
  return neo4j;
}

export class DatabaseClient {
  private driver: any;
  private driverPromise: Promise<any>;

  constructor(
    private readonly uri: string,
    private readonly user: string,
    private readonly password: string,
  ) {
    this.driverPromise = this.connect();
  }

  private async connect() {
    const neo4j = await loadDriver();
    this.driver = neo4j.default.driver(
      this.uri,
      this.user ? neo4j.default.auth.basic(this.user, this.password) : undefined,
    );
    // Verify connectivity
    await this.driver.verifyConnectivity();
    return this.driver;
  }

  async close() {
    if (this.driver) {
      await this.driver.close();
    }
  }

  /**
   * Execute all .cypher files in a directory or a single .cypher file.
   * Files are processed in alphabetical order.
   */
  async ingestPath(target: string): Promise<void> {
    const stat = statSync(target);

    if (stat.isDirectory()) {
      const files = readdirSync(target)
        .filter((f) => extname(f) === '.cypher')
        .sort();

      if (files.length === 0) {
        console.log(`No .cypher files found in ${target}`);
        return;
      }

      for (const file of files) {
        await this.executeCypherFile(join(target, file));
      }
    } else {
      await this.executeCypherFile(target);
    }
  }

  /**
   * Execute a single .cypher file (may contain multiple statements
   * separated by semicolons).
   */
  async executeCypherFile(filePath: string): Promise<void> {
    const content = readFileSync(filePath, 'utf8');
    const statements = this.parseStatements(content);

    if (statements.length === 0) {
      console.log(`  Skipping empty file: ${filePath}`);
      return;
    }

    console.log(`  Executing ${filePath} (${statements.length} statement(s))…`);

    await this.driverPromise;
    const session = this.driver.session();

    try {
      for (const stmt of statements) {
        await session.run(stmt);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Parse a Cypher file into individual statements.
   * Handles:
   *   - Line comments (//)
   *   - Block comments (/* ... *\/)
   *   - String literals (preserves semicolons inside strings)
   *   - Semicolon-delimited statements
   */
  private parseStatements(content: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let i = 0;

    while (i < content.length) {
      const ch = content[i];
      const next = content[i + 1];

      // Block comment start
      if (!inString && !inLineComment && !inBlockComment && ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      // Block comment end
      if (inBlockComment && ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }

      if (inBlockComment) {
        i++;
        continue;
      }

      // Line comment
      if (!inString && !inLineComment && ch === '/' && next === '/') {
        inLineComment = true;
        i += 2;
        continue;
      }

      // Line comment end
      if (inLineComment && ch === '\n') {
        inLineComment = false;
        current += '\n';
        i++;
        continue;
      }

      if (inLineComment) {
        i++;
        continue;
      }

      // Escape sequences (e.g. \", \', \\) — skip the next character
      // Must be checked BEFORE quote toggling (matches Go management-service)
      if (ch === '\\' && i + 1 < content.length) {
        current += ch;
        current += content[i + 1];
        i += 2;
        continue;
      }

      // String literal start
      if (!inString && (ch === "'" || ch === '"')) {
        inString = true;
        stringChar = ch;
        current += ch;
        i++;
        continue;
      }

      // String literal end
      if (inString && ch === stringChar) {
        inString = false;
        current += ch;
        i++;
        continue;
      }

      // Statement delimiter
      if (!inString && ch === ';') {
        const trimmed = current.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        current = '';
        i++;
        continue;
      }

      current += ch;
      i++;
    }

    // Last statement (may not end with ;)
    const trimmed = current.trim();
    if (trimmed) {
      statements.push(trimmed);
    }

    return statements;
  }
}
