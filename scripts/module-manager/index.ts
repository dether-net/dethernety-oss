#!/usr/bin/env tsx
/**
 * module-manager CLI — TypeScript core
 *
 * Local module management for Dethernety OSS.
 * A local-use implementation of the same module-management operations the platform performs server-side
 * for use in development and self-hosted deployments.
 *
 * Commands:
 *   install <archive> [options]   Extract, validate, copy, ingest
 *   ingest  <path>    [options]   Execute Cypher files against Memgraph
 *   list               [options]  Show installed modules
 *   embed     <module-path>      Pre-computed class vectors for one module
 *   embed-all <modules-root>...  Pre-computed class vectors for every module under the roots
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Installer } from './installer';
import { DatabaseClient } from './database';
import { StateManager } from './state';
import { runEmbed } from './embed';
import { findClassModules } from '../lib/class-vectors';
import { runExport } from './export';

// ── argument parsing ────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'target':      { type: 'string', default: '' },
    'import-dir':  { type: 'string', default: '' },
    'db-uri':      { type: 'string', default: 'bolt://localhost:7687' },
    'db-user':     { type: 'string', default: 'dethernety' },
    'db-pass':     { type: 'string', default: process.env.NEO4J_PASSWORD || '' },
    'state-file':  { type: 'string', default: '' },
    'profile':     { type: 'string', default: '' },
    'models-dir':  { type: 'string', default: '' },
    'download':    { type: 'boolean', default: false },
    'exclude':     { type: 'string', multiple: true, default: [] },
    'batch-size':  { type: 'string', default: '16' },
    'output':      { type: 'string', default: '' },
    'include-embeddings': { type: 'boolean', default: false },
    'help':        { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage:
  module-manager install <archive.tar.gz> [options]
  module-manager ingest  <cypher-file-or-dir> [options]
  module-manager list    [options]
  module-manager embed     <module-path> [--models-dir <dir>] [options]
  module-manager embed-all <modules-root>... [--exclude <module-path>]... [--models-dir <dir>] [options]
  module-manager export  <module-path> [--output <path>] [--include-embeddings]

Options:
  --target <path>        Module installation directory
  --import-dir <path>    Memgraph CSV import directory
  --db-uri <uri>         Bolt URI (default: bolt://localhost:7687)
  --db-user <user>       DB user  (default: neo4j)
  --db-pass <pass>       DB password (or set NEO4J_PASSWORD)
  --state-file <path>    installed-modules.json path
  --profile <id>         Embedding profile (embed only, default: the platform's default)
  --models-dir <dir>     The profile's weights (embed only; or set EMBEDDING_MODEL_DIR)
  --download             Fetch missing weights at the profile's pinned revision (embed only)
  --exclude <path>       A module to leave out (embed-all only; repeatable)
  --batch-size <n>       Classes per embedder request (embed only, default: 16)
  --output <path>        Output archive path (export only)
  --include-embeddings   Keep embeddings/ subdirs in archive (export only)
`);
  process.exit(0);
}

const [command, ...rest] = positionals;

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  switch (command) {
    case 'install': {
      const archivePath = rest[0];
      if (!archivePath) {
        console.error('Usage: module-manager install <archive.tar.gz>');
        process.exit(1);
      }

      const db = new DatabaseClient(
        values['db-uri']!,
        values['db-user']!,
        values['db-pass']!,
      );

      const stateFile = values['state-file']
        ? resolve(values['state-file'])
        : undefined;

      const installer = new Installer({
        target: values.target ? resolve(values.target) : undefined,
        importDir: values['import-dir'] ? resolve(values['import-dir']) : undefined,
        db,
        stateFile,
      });

      try {
        await installer.install(resolve(archivePath));
      } finally {
        await db.close();
      }
      break;
    }

    case 'ingest': {
      const target = rest[0];
      if (!target) {
        console.error('Usage: module-manager ingest <cypher-file-or-dir>');
        process.exit(1);
      }

      const db = new DatabaseClient(
        values['db-uri']!,
        values['db-user']!,
        values['db-pass']!,
      );

      try {
        await db.ingestPath(resolve(target));
      } finally {
        await db.close();
      }
      break;
    }

    case 'embed':
    case 'embed-all': {
      if (rest.length === 0) {
        console.error(
          command === 'embed'
            ? 'Usage: module-manager embed <module-path> [--models-dir <dir>] [--profile <id>]'
            : 'Usage: module-manager embed-all <modules-root>... [--exclude <module-path>]... [--models-dir <dir>]',
        );
        process.exit(1);
      }
      if (command === 'embed' && rest.length > 1) {
        console.error('embed: one module path; use embed-all for several');
        process.exit(1);
      }
      const batchSize = parseInt(values['batch-size'] || '16', 10);
      if (!Number.isFinite(batchSize) || batchSize <= 0) {
        console.error(`embed: --batch-size must be a positive integer (got "${values['batch-size']}")`);
        process.exit(1);
      }
      const modulePaths =
        command === 'embed' ? [resolve(rest[0])] : findClassModules(rest.map((r) => resolve(r)), values.exclude ?? []);
      await runEmbed({
        modulePaths,
        profileId: values.profile || undefined,
        modelsDir: values['models-dir'] || undefined,
        download: values.download === true,
        batchSize,
      });
      break;
    }

    case 'export': {
      const modulePath = rest[0];
      if (!modulePath) {
        console.error(
          'Usage: module-manager export <module-path> [--output <path>] [--include-embeddings]',
        );
        process.exit(1);
      }
      runExport({
        modulePath: resolve(modulePath),
        output: values.output || undefined,
        includeEmbeddings: values['include-embeddings'] === true,
      });
      break;
    }

    case 'list': {
      const stateFile = values['state-file']
        ? resolve(values['state-file'])
        : undefined;
      const state = new StateManager(stateFile);
      const modules = state.list();

      if (modules.length === 0) {
        console.log('No modules installed.');
      } else {
        console.log('Installed modules:');
        for (const m of modules) {
          console.log(`  ${m.name}@${m.version}  (installed ${m.installedAt})`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command || '(none)'}`);
      console.error('Run with --help for usage.');
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
