#!/usr/bin/env node
// The document embedder as a command (src/embed-documents.ts), over the built package: JSON lines on stdin and stdout.
// Build the package first: pnpm --filter @dethernety/embedder... build

import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);

let helper;
try {
  helper = require('../dist/embed-documents.js');
} catch (error) {
  // Only the package's own build missing: the first line names the module that could not be found, while a dependency
  // missing inside the build names itself there (its require stack, on later lines, also names this file).
  if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).split('\n')[0].includes('embed-documents.js')) {
    process.stderr.write('embed-documents: the embedder package is not built; run: pnpm --filter @dethernety/embedder... build\n');
    process.exit(1);
  }
  throw error;
}

// The line iterator is created before the model loads: readline drops the lines (and the end of input) it emits before
// anything iterates, and a build sends its first request without waiting for the ready line.
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const code = await helper.runEmbedDocuments(process.argv.slice(2), {
  lines: { [Symbol.asyncIterator]: () => lines },
  out: (line) => process.stdout.write(`${line}\n`),
  err: (message) => process.stderr.write(`embed-documents: ${message}\n`),
});
// Exit once stdout has drained: the last reply must reach the reader, and nothing may keep the process up after it.
process.stdout.write('', () => process.exit(code));
