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
    'help':        { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage:
  module-manager install <archive.tar.gz> [options]
  module-manager ingest  <cypher-file-or-dir> [options]
  module-manager list    [options]

Options:
  --target <path>        Module installation directory
  --import-dir <path>    Memgraph CSV import directory
  --db-uri <uri>         Bolt URI (default: bolt://localhost:7687)
  --db-user <user>       DB user  (default: neo4j)
  --db-pass <pass>       DB password (or set NEO4J_PASSWORD)
  --state-file <path>    installed-modules.json path
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

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
