/**
 * The module frontend manifest: `frontend/frontend-manifest.json`, checked in beside a module's
 * `frontend/bundle.js`. The host loads a module frontend only through its manifest: it names the
 * component keys the bundle registers, so the host can load the bundle when one of its keys is
 * first needed, and the host dependency versions the bundle works with.
 *
 * The JSON schema (`@dethernety/dt-module/frontend-manifest.schema.json`) is the format's reference.
 * `validateFrontendManifest` enforces the same rules without a schema validator, plus one the
 * schema cannot express: `hostApi.min <= hostApi.max`.
 *
 * No dependencies, so a module's frontend tests can import it without the rest of the package.
 */
import schema from './frontend-manifest.schema.json';

export const FRONTEND_MANIFEST_FILE = 'frontend-manifest.json';
export const FRONTEND_MANIFEST_VERSION = 1;

export interface HostApiRange {
  readonly min: number;
  readonly max: number;
}

export interface FrontendManifest {
  readonly manifestVersion: typeof FRONTEND_MANIFEST_VERSION;
  /** The component keys `install()` registers, exactly. */
  readonly components: readonly string[];
  /** The host dependency versions the bundle works with, inclusive. */
  readonly hostApi: HostApiRange;
}

export class FrontendManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid ${FRONTEND_MANIFEST_FILE}: ${problems.join('; ')}`);
    this.name = 'FrontendManifestError';
  }
}

/** The fields the validator checks. A test holds the schema's property lists to these. */
export const FRONTEND_MANIFEST_FIELDS = ['$schema', 'manifestVersion', 'components', 'hostApi'] as const;
export const HOST_API_FIELDS = ['min', 'max'] as const;

const KEY_PATTERN = new RegExp(schema.properties.components.items.pattern);
const MAX_COMPONENTS = schema.properties.components.maxItems;
const MAX_HOST_API = schema.properties.hostApi.properties.max.maximum;
const MAX_PROBLEMS = 20;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isHostApiVersion = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_HOST_API;

// JSON.stringify leaves these unescaped; some log viewers render them as line breaks or reorder text.
const UNSAFE_IN_LOGS = /[\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
const escapeForLogs = (s: string) =>
  JSON.stringify(s).replace(UNSAFE_IN_LOGS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** A short, single-line rendering of an untrusted value for an error message. */
function show(v: unknown): string {
  if (typeof v === 'string') return escapeForLogs(v.length > 64 ? `${v.slice(0, 64)}…` : v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return `a value of type ${Array.isArray(v) ? 'array' : typeof v}`;
}

/**
 * Validates a parsed manifest and returns a fresh, frozen copy holding only its declared fields.
 * Throws a `FrontendManifestError` naming the problems (the first 20).
 */
export function validateFrontendManifest(value: unknown): FrontendManifest {
  if (!isObject(value)) throw new FrontendManifestError(['not a JSON object']);
  const problems: string[] = [];

  for (const key of Object.keys(value)) {
    if (!(FRONTEND_MANIFEST_FIELDS as readonly string[]).includes(key)) problems.push(`unknown field ${show(key)}`);
  }
  if ('$schema' in value && typeof value.$schema !== 'string') problems.push('$schema must be a string');
  if (value.manifestVersion !== FRONTEND_MANIFEST_VERSION) {
    problems.push(`manifestVersion must be ${FRONTEND_MANIFEST_VERSION}`);
  }

  const { components } = value;
  if (!Array.isArray(components) || components.length === 0) {
    problems.push('components must be a non-empty array');
  } else if (components.length > MAX_COMPONENTS) {
    problems.push(`components must not list more than ${MAX_COMPONENTS} keys`);
  } else {
    const seen = new Set<string>();
    for (const key of components) {
      if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
        problems.push(`component key ${show(key)} must match ${KEY_PATTERN.source}`);
      } else if (seen.has(key)) {
        problems.push(`component key ${show(key)} is listed twice`);
      } else {
        seen.add(key);
      }
    }
  }

  const { hostApi } = value;
  if (!isObject(hostApi)) {
    problems.push('hostApi must be an object { min, max }');
  } else {
    for (const key of Object.keys(hostApi)) {
      if (!(HOST_API_FIELDS as readonly string[]).includes(key)) problems.push(`unknown field hostApi.${show(key)}`);
    }
    for (const field of HOST_API_FIELDS) {
      if (!isHostApiVersion(hostApi[field])) problems.push(`hostApi.${field} must be an integer from 1 to ${MAX_HOST_API}`);
    }
    if (isHostApiVersion(hostApi.min) && isHostApiVersion(hostApi.max) && hostApi.min > hostApi.max) {
      problems.push('hostApi.min must not exceed hostApi.max');
    }
  }

  if (problems.length > MAX_PROBLEMS) {
    const more = problems.length - MAX_PROBLEMS;
    problems.splice(MAX_PROBLEMS, problems.length, `and ${more} more`);
  }
  if (problems.length > 0) throw new FrontendManifestError(problems);

  const range = hostApi as unknown as HostApiRange;
  return Object.freeze({
    manifestVersion: FRONTEND_MANIFEST_VERSION,
    components: Object.freeze([...(components as string[])]),
    hostApi: Object.freeze({ min: range.min, max: range.max }),
  });
}

/**
 * Parses and validates a manifest file's text: a UTF-8 BOM is ignored, and a JSON syntax error
 * is a `FrontendManifestError` like any other problem.
 */
export function parseFrontendManifest(text: string): FrontendManifest {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new FrontendManifestError([`not valid JSON: ${escapeForLogs((error as Error).message)}`]);
  }
  return validateFrontendManifest(value);
}

/** A module frontend's default export, as the host calls it. */
export interface ModuleFrontend {
  install(hostDependencies: unknown): unknown;
}

/**
 * The contract test for a module frontend: runs `install()` against a recording component
 * registry and checks that it registers exactly the manifest's keys, each once. Returns the
 * validated manifest. Throws on any mismatch, so it works under any test runner.
 *
 * The stub registry refuses what the host's registry would: a non-string key or a missing
 * component. An `install()` that catches the refusal leaves the key unregistered, so the
 * mismatch is reported.
 */
export async function assertFrontendManifest(frontend: ModuleFrontend, manifest: unknown): Promise<FrontendManifest> {
  const validated = validateFrontendManifest(manifest);
  if (!frontend || typeof frontend.install !== 'function') {
    throw new Error('the module frontend has no install() function');
  }

  const registered: string[] = [];
  const componentRegistry = {
    register: (key: unknown, component: unknown) => {
      if (typeof key !== 'string') throw new TypeError(`register(): key ${show(key)} is not a string`);
      if (component == null) throw new TypeError(`register(): no component for key ${show(key)}`);
      registered.push(key);
    },
  };
  await frontend.install({ services: { componentRegistry } });

  const declared = new Set(validated.components);
  const problems: string[] = [];
  const twice = registered.filter((key, i) => registered.indexOf(key) !== i);
  if (twice.length > 0) problems.push(`registered more than once: ${[...new Set(twice)].join(', ')}`);
  const missing = validated.components.filter((key) => !registered.includes(key));
  if (missing.length > 0) problems.push(`declared but not registered: ${missing.join(', ')}`);
  const extra = [...new Set(registered)].filter((key) => !declared.has(key));
  if (extra.length > 0) problems.push(`registered but not declared: ${extra.join(', ')}`);
  if (problems.length > 0) {
    throw new Error(`install() does not match ${FRONTEND_MANIFEST_FILE}: ${problems.join('; ')}`);
  }
  return validated;
}
