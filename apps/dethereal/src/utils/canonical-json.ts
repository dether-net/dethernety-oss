/**
 * Canonical JSON: object keys sorted, no whitespace, so equal values print the
 * same text. Two historical forms differ only in how an `undefined` object
 * value is printed, and both are kept byte for byte (hashes computed with them
 * are stored):
 * - `canonicalJson`: an `undefined` value prints `null`;
 * - `canonicalJsonOmit`: an `undefined` object value is left out, as
 *   `JSON.stringify` does (a top-level `undefined` returns `undefined`).
 */
export function canonicalJson(value: unknown): string {
  return canonicalNull(value)
}

/** The omitting form: `JSON.stringify` over the value with its object keys sorted. */
export function canonicalJsonOmit(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function canonicalNull(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalNull).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalNull((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}
