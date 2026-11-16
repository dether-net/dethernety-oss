/**
 * The `./condition-groups` and `./remediation-honesty` entries stay pure: each imports nothing outside its
 * own files, so a consumer that bundles one takes no other dependency with it.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const SRC = path.join(__dirname, '..');

/** Every module specifier a source text names: static imports and re-exports, `import()` and `require()`. */
function specifiersOf(text: string): string[] {
  const found: string[] = [];
  for (const re of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]*)['"]/g, /\brequire\s*\(\s*['"]([^'"]*)['"]/g, /\/\/\/\s*<reference\s+(?:path|types)=['"]([^'"]+)['"]/g]) {
    for (const m of text.matchAll(re)) found.push(m[1]);
  }
  // A dynamic import or require of anything but a string literal is an import too.
  if (/\bimport\s*\(\s*[^'"\s)]/.test(text) || /\brequire\s*\(\s*[^'"\s)]/.test(text)) found.push('<computed>');
  return found.sort();
}
const specifiers = (file: string): string[] => specifiersOf(readFileSync(path.join(SRC, file), 'utf8'));

// Each entry's files, and the only specifiers they may name.
const ENTRIES: Record<string, Record<string, string[]>> = {
  './condition-groups': {
    'condition-groups.ts': ['./kg/condition-groups', './kg/condition-operators'],
    'kg/condition-groups.ts': ['./condition-operators'],
    'kg/condition-operators.ts': [],
  },
  './remediation-honesty': {
    'remediation-honesty.ts': [],
  },
};

describe('the pure subpath entries', () => {
  for (const [entry, files] of Object.entries(ENTRIES)) {
    for (const [file, allowed] of Object.entries(files)) {
      it(`${entry}: ${file} imports only ${allowed.length ? allowed.join(', ') : 'nothing'}`, () => {
        expect(specifiers(file)).toEqual([...allowed].sort());
      });
    }
  }

  it('finds every kind of import (the check itself)', () => {
    const sample = "/// <reference types=\"node\" />\nimport { x } from '../schema';\nexport * from'./tight';\nimport'tight-side-effect';\nexport * from './other';\nimport 'side-effect';\nconst y = require('graphql');\nimport('./lazy');\nconst z = require(name);";
    expect(specifiersOf(sample)).toEqual(['../schema', './lazy', './other', './tight', '<computed>', 'graphql', 'node', 'side-effect', 'tight-side-effect'].sort());
  });

  it('declares both entries in the package exports, and nothing else of theirs at the root', () => {
    const pkg = JSON.parse(readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
    expect(pkg.exports['./condition-groups']).toMatchObject({ require: './dist/condition-groups.js', types: './dist/condition-groups.d.ts' });
    expect(pkg.exports['./remediation-honesty']).toMatchObject({ require: './dist/remediation-honesty.js', types: './dist/remediation-honesty.d.ts' });
    const root = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
    expect(root).not.toMatch(/condition-groups|condition-operators|remediation-honesty/);
  });
});
