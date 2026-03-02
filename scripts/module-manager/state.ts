/**
 * state.ts — Track installed modules in installed-modules.json.
 *
 * Mirrors the StateManager from the Go management-service.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface InstalledModule {
  name: string;
  version: string;
  installedAt: string;
  components?: string[];
}

interface StateFile {
  modules: Record<string, InstalledModule>;
}

const DEFAULT_STATE_FILE = 'installed-modules.json';

export class StateManager {
  private readonly path: string;

  constructor(stateFilePath?: string) {
    this.path = stateFilePath || resolve(DEFAULT_STATE_FILE);
  }

  private load(): StateFile {
    if (!existsSync(this.path)) {
      return { modules: {} };
    }
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return { modules: {} };
    }
  }

  private save(state: StateFile): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  record(mod: InstalledModule): void {
    const state = this.load();
    state.modules[mod.name] = mod;
    this.save(state);
  }

  remove(name: string): void {
    const state = this.load();
    delete state.modules[name];
    this.save(state);
  }

  get(name: string): InstalledModule | undefined {
    return this.load().modules[name];
  }

  list(): InstalledModule[] {
    return Object.values(this.load().modules);
  }
}
