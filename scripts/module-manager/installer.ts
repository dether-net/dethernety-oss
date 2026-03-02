/**
 * installer.ts — Module installation pipeline.
 *
 * Orchestrates: extract → validate manifest → copy components → ingest data → record state.
 * Mirrors the Installer from the Go management-service, simplified for local use.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, basename, extname } from 'node:path';
import { extractPackage } from './extractor';
import { loadManifest, type Manifest } from './manifest';
import { DatabaseClient } from './database';
import { StateManager } from './state';

export interface InstallerOptions {
  /** Directory where module JS files are placed (e.g. custom_modules/) */
  target?: string;
  /** Directory mounted into Memgraph for LOAD CSV (e.g. data/memgraph_import/) */
  importDir?: string;
  /** Database client for Cypher ingestion */
  db?: DatabaseClient;
  /** Path to installed-modules.json */
  stateFile?: string;
}

export class Installer {
  private readonly target: string;
  private readonly importDir?: string;
  private readonly db?: DatabaseClient;
  private readonly state: StateManager;

  constructor(opts: InstallerOptions) {
    this.target = opts.target || 'custom_modules';
    this.importDir = opts.importDir;
    this.db = opts.db;
    this.state = new StateManager(opts.stateFile);
  }

  async install(archivePath: string): Promise<void> {
    // 1. Extract
    console.log(`Extracting ${basename(archivePath)}…`);
    const extracted = extractPackage(archivePath);

    // 2. Validate manifest
    const manifest = loadManifest(extracted);
    console.log(`Module: ${manifest.name}@${manifest.version}`);

    // 3. Copy dethernety component (JS module files)
    const dethernetyDir = join(extracted, manifest.name);
    if (existsSync(dethernetyDir)) {
      this.copyModuleFiles(dethernetyDir, manifest.name);
    }

    // 4. Copy CSV data to Memgraph import dir
    const dataDir = join(extracted, 'data');
    if (existsSync(dataDir) && this.importDir) {
      this.copyImportData(dataDir, manifest.name);
    }

    // 5. Run Cypher ingestion
    if (existsSync(dataDir) && this.db) {
      await this.ingestData(dataDir);
    }

    // 6. Record in state
    const components: string[] = [];
    if (existsSync(dethernetyDir)) components.push('dethernety');
    if (existsSync(dataDir)) components.push('data');

    this.state.record({
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      components,
    });

    console.log(`Module ${manifest.name}@${manifest.version} installed successfully.`);
  }

  /**
   * Copy module JS files to the target directory.
   *
   * The tarball contains `<module-name>/<sub-module>/Module.js`.
   * The ModuleRegistryService scans `custom_modules/<sub-dir>/` for *Module.js,
   * so we copy the *contents* of the source dir into target/ (not nested by name).
   *
   * Result: target/<sub-module>/Module.js
   */
  private copyModuleFiles(sourceDir: string, _moduleName: string): void {
    mkdirSync(this.target, { recursive: true });

    // Copy each sub-directory (sub-module) into the target
    const entries = readdirSync(sourceDir);
    for (const entry of entries) {
      const src = join(sourceDir, entry);
      const dest = join(this.target, entry);
      console.log(`  Copying module files → ${dest}`);
      cpSync(src, dest, { recursive: true });
    }
  }

  /**
   * Copy CSV files to the Memgraph import directory so LOAD CSV can find them.
   * Structure: importDir/<module-name>/*.csv
   */
  private copyImportData(dataDir: string, moduleName: string): void {
    if (!this.importDir) return;

    const dest = join(this.importDir, moduleName);
    mkdirSync(dest, { recursive: true });

    const csvFiles = readdirSync(dataDir).filter(
      (f) => extname(f) === '.csv',
    );

    for (const file of csvFiles) {
      const src = join(dataDir, file);
      const dst = join(dest, file);
      cpSync(src, dst);
      console.log(`  Copied CSV: ${file} → ${dst}`);
    }
  }

  /**
   * Execute .cypher files from the data directory against the database.
   */
  private async ingestData(dataDir: string): Promise<void> {
    if (!this.db) return;

    const cypherFiles = readdirSync(dataDir)
      .filter((f) => extname(f) === '.cypher')
      .sort();

    if (cypherFiles.length === 0) return;

    console.log(`  Running data ingestion (${cypherFiles.length} Cypher file(s))…`);
    for (const file of cypherFiles) {
      await this.db.executeCypherFile(join(dataDir, file));
    }
  }
}
