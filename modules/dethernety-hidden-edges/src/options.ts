/**
 * The `options` argument of `hiddenEdgeCandidates`: JSON, exact keys, every list capped, the size cap first. A key
 * this contract does not read refuses the call, so a newer client's option is never dropped silently. A refusal
 * names the offending key, never its value.
 *
 * `excluded` is the caller's own decisions: it shapes only the caller's read-only answer.
 */
import { OPTIONS_MAX_BYTES } from './bounds';
import { Contract, CONTRACT_VERSION, CONTRACTS } from './contract';
import { GenerateOptions, RecheckEntry } from './generate';
import { EDGE_KINDS } from './table';

/** Edges judged again per recheck call; a client batches past it. */
export const MAX_RECHECK = 200;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export const MAX_EXCLUDED = 2_000;
const CANDIDATE_ID = /^he:[0-9a-f]{16}$/;

export type OptionsResult = { ok: true; options: GenerateOptions; contract: Contract } | { ok: false; code: 'options_invalid'; detail?: string };

const KEYS: readonly string[] = ['excluded', 'include_pending', 'contract', 'recheck'];

/** The recheck entries, exact keys, or null when malformed. */
function recheckOf(v: unknown): RecheckEntry[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_RECHECK) return null;
  const out: RecheckEntry[] = [];
  for (const x of v) {
    if (!isObject(x) || Object.keys(x).sort().join() !== 'exposure_ids,kind,source,target') return null;
    if (!(EDGE_KINDS as readonly unknown[]).includes(x.kind) || typeof x.source !== 'string' || !ID.test(x.source) || typeof x.target !== 'string' || !ID.test(x.target)) return null;
    if (!Array.isArray(x.exposure_ids) || x.exposure_ids.length > 50 || !x.exposure_ids.every((e) => typeof e === 'string' && ID.test(e))) return null;
    out.push({ kind: x.kind as string, source: x.source, target: x.target, exposure_ids: [...new Set(x.exposure_ids as string[])] });
  }
  return out;
}

const fail = (detail: string): OptionsResult => ({ ok: false, code: 'options_invalid', detail });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Parse `options` (absent or null: the defaults). */
export function parseOptions(raw: unknown): OptionsResult {
  if (raw === undefined || raw === null) return { ok: true, options: {}, contract: CONTRACT_VERSION };
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > OPTIONS_MAX_BYTES) return fail('options');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('options');
  }
  if (!isObject(parsed)) return fail('options');
  for (const k of Object.keys(parsed)) if (!KEYS.includes(k)) return fail('options has an unknown key');
  let contract: Contract = CONTRACT_VERSION;
  if (own(parsed, 'contract')) {
    if (!(CONTRACTS as readonly unknown[]).includes(parsed.contract)) return fail('contract');
    contract = parsed.contract as Contract;
  }
  const out: GenerateOptions = {};
  if (own(parsed, 'excluded')) {
    const v = parsed.excluded;
    if (!Array.isArray(v) || v.length > MAX_EXCLUDED || !v.every((x) => typeof x === 'string' && CANDIDATE_ID.test(x))) return fail('excluded');
    out.excluded = [...new Set(v as string[])].sort();
  }
  if (own(parsed, 'include_pending')) {
    if (typeof parsed.include_pending !== 'boolean') return fail('include_pending');
    out.include_pending = parsed.include_pending;
  }
  if (own(parsed, 'recheck')) {
    // a recheck is contract 2's, and judges the edges it names with no exclusions and every finding
    if (contract !== 2 || own(parsed, 'excluded') || own(parsed, 'include_pending')) return fail('recheck');
    const entries = recheckOf(parsed.recheck);
    if (!entries) return fail('recheck');
    out.recheck = entries;
  }
  return { ok: true, options: out, contract };
}
