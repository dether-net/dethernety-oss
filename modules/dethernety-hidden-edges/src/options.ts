/**
 * The `options` argument of `hiddenEdgeCandidates`: JSON, exact keys, every list capped, the size cap first. A key
 * this contract does not read refuses the call, so a newer client's option is never dropped silently. A refusal
 * names the offending key, never its value.
 *
 * `excluded` is the caller's own decisions: it shapes only the caller's read-only answer.
 */
import { OPTIONS_MAX_BYTES } from './bounds';
import { GenerateOptions } from './generate';

export const MAX_EXCLUDED = 2_000;
const CANDIDATE_ID = /^he:[0-9a-f]{16}$/;

export type OptionsResult = { ok: true; options: GenerateOptions } | { ok: false; code: 'options_invalid'; detail?: string };

const fail = (detail: string): OptionsResult => ({ ok: false, code: 'options_invalid', detail });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Parse `options` (absent or null: the defaults). */
export function parseOptions(raw: unknown): OptionsResult {
  if (raw === undefined || raw === null) return { ok: true, options: {} };
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > OPTIONS_MAX_BYTES) return fail('options');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('options');
  }
  if (!isObject(parsed)) return fail('options');
  for (const k of Object.keys(parsed)) if (k !== 'excluded' && k !== 'include_pending') return fail('options has an unknown key');
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
  return { ok: true, options: out };
}
