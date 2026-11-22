#!/usr/bin/env node
// Writes src/edge-kinds.table.ts from src/edge-kinds.json, so the table is compiled into the module's build
// (the module packager ships compiled code, not data files). A test keeps the two equal.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(path.join(root, 'src', 'edge-kinds.json'), 'utf8'));
const body = [
  '// Generated from edge-kinds.json by scripts/generate-table.mjs. Do not edit; edit the JSON and regenerate.',
  '/* eslint-disable */',
  `export const EDGE_KIND_TABLE: unknown = ${JSON.stringify(table, null, 2)};`,
  '',
].join('\n');
writeFileSync(path.join(root, 'src', 'edge-kinds.table.ts'), body);
