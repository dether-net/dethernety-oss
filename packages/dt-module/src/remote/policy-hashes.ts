/**
 * Reading a pin's policy hashes — the `policyHash` of each class, served beside the module document.
 *
 * The platform stamps an evaluation as following its class's stored hash only when the module's
 * answer agrees with it, so a wrong value here marks elements current under a policy they were not
 * evaluated with. Every field is therefore checked against what was asked for, and anything that
 * does not check out is treated as no hashes at all: the classes then report none, which leaves
 * their elements unstamped rather than wrongly stamped.
 */
import { DTMetadata } from '../interfaces/module-metadata-interface';
import { POLICY_HASH_ALGORITHM } from '../policy-hash';
import { SERVED_CLASS_ARRAYS } from './metadata-cache';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The class ids a module document serves. */
export function servedClassIds(module: DTMetadata): Set<string> {
  const ids = new Set<string>();
  for (const key of SERVED_CLASS_ARRAYS) {
    const classes = module[key] as Array<{ id?: unknown }> | undefined;
    if (!Array.isArray(classes)) continue;
    for (const cls of classes) {
      if (typeof cls?.id === 'string') ids.add(cls.id);
    }
  }
  return ids;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The class id → hash map a body carries for `moduleKey` at `pin`, or `null` when the body is not a
 * well-formed set for exactly that module and pin, under the algorithm this package computes.
 *
 * A malformed value, or a `__proto__` key, rejects the whole body: a producer that wrote one is not
 * trusted for the rest. A class id the document does not serve is dropped, and the rest kept — a set
 * may name a class the catalog leaves out of the document. Keys are read as own properties into a
 * `Map`, so no key reaches an object's prototype.
 */
export function parsePolicyHashes(
  body: unknown,
  moduleKey: string,
  pin: string,
  classIds: ReadonlySet<string>,
): Map<string, string> | null {
  if (!isPlainObject(body)) return null;
  if (body.moduleKey !== moduleKey || body.version !== pin || body.algorithm !== POLICY_HASH_ALGORITHM) return null;
  const served = body.policyHashes;
  if (!isPlainObject(served)) return null;
  const hashes = new Map<string, string>();
  for (const classId of Object.keys(served)) {
    if (classId === '__proto__') return null;
    const hash = served[classId];
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) return null;
    if (classIds.has(classId)) hashes.set(classId, hash);
  }
  return hashes;
}

/** The body a parsed set is stored as: the shape it was served in, rebuilt from the checked values. */
export function policyHashesBody(moduleKey: string, pin: string, hashes: ReadonlyMap<string, string>): unknown {
  return { moduleKey, version: pin, algorithm: POLICY_HASH_ALGORITHM, policyHashes: Object.fromEntries(hashes) };
}
