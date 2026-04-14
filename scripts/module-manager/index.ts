#!/usr/bin/env tsx
/**
 * module-manager CLI — TypeScript core
 *
 * Local module management for Dethernety OSS.
 * Replicates core functionality from the Go management-service
 * for use in development, demos, and self-hosted deployments.
 *
 * Commands:
 *   install <archive> [options]   Extract, validate, copy, ingest
 *   ingest  <path>    [options]   Execute Cypher files against Memgraph
 *   list               [options]  Show installed modules
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Installer } from './installer';
import { DatabaseClient } from './database';
import { StateManager } from './state';
import { runEmbed } from './embed';

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
    'model':       { type: 'string', default: '' },
    'url':         { type: 'string', default: '' },
    'api-key':     { type: 'string', default: '' },
    'batch-size':  { type: 'string', default: '128' },
    'help':        { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage:
  module-manager install <archive.tar.gz> [options]
  module-manager ingest  <cypher-file-or-dir> [options]
  module-manager list    [options]
  module-manager embed   <module-path> --model <name> --url <endpoint> [options]

Options:
  --target <path>        Module installation directory
  --import-dir <path>    Memgraph CSV import directory
  --db-uri <uri>         Bolt URI (default: bolt://localhost:7687)
  --db-user <user>       DB user  (default: neo4j)
  --db-pass <pass>       DB password (or set NEO4J_PASSWORD)
  --state-file <path>    installed-modules.json path
  --model <name>         Embedding model (embed only, required)
  --url <endpoint>       Embedding endpoint URL (embed only, required)
  --api-key <key>        Bearer token for the embedding endpoint (embed only)
  --batch-size <n>       Classes per POST (embed only, default: 128)
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

    case 'embed': {
      const modulePath = rest[0];
      if (!modulePath) {
        console.error(
          'Usage: module-manager embed <module-path> --model <name> --url <endpoint> [--api-key <key>] [--batch-size <n>]',
        );
        process.exit(1);
      }
      if (!values.model) {
        console.error('embed: --model is required');
        process.exit(1);
      }
      if (!values.url) {
        console.error('embed: --url is required');
        process.exit(1);
      }
      const batchSize = parseInt(values['batch-size'] || '128', 10);
      if (!Number.isFinite(batchSize) || batchSize <= 0) {
        console.error(`embed: --batch-size must be a positive integer (got "${values['batch-size']}")`);
        process.exit(1);
      }
      await runEmbed({
        modulePath: resolve(modulePath),
        model: values.model!,
        url: values.url!,
        apiKey: values['api-key'] || undefined,
        batchSize,
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
