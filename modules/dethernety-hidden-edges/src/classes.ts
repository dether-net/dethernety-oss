/**
 * The hidden-edge classes, as this module's own class files hold them: one data flow class per edge kind, under
 * `dataFlow/<kind>/class.json`. Their ids live only there; the module reads them once at load and names, on each
 * candidate, the class an accepted edge of its kind is written with.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { MODULE_NAME } from './contract';
import { EDGE_KINDS, EdgeKind } from './table';

/** The class category of a hidden-edge flow, and so of every class below. */
export const HIDDEN_EDGE_CATEGORY = 'Hidden Edge';

export interface KindClass {
  id: string;
  name: string;
}

export class ClassFileError extends Error {}

/** Each kind's class, read from `<dataDir>/<module>/dataFlow/<kind>/class.json`; a missing or malformed file fails the load. */
export function readKindClasses(dataDir: string): Readonly<Record<EdgeKind, KindClass>> {
  const out = {} as Record<EdgeKind, KindClass>;
  const ids = new Set<string>();
  for (const kind of EDGE_KINDS) {
    const file = path.join(dataDir, MODULE_NAME, 'dataFlow', kind, 'class.json');
    let cls: { id?: unknown; name?: unknown; category?: unknown };
    try {
      cls = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new ClassFileError(`the class file of ${kind} cannot be read`);
    }
    if (typeof cls?.id !== 'string' || !cls.id || typeof cls.name !== 'string' || !cls.name || cls.category !== HIDDEN_EDGE_CATEGORY || ids.has(cls.id)) {
      throw new ClassFileError(`the class file of ${kind} is malformed`);
    }
    ids.add(cls.id);
    out[kind] = Object.freeze({ id: cls.id, name: cls.name });
  }
  return Object.freeze(out);
}
