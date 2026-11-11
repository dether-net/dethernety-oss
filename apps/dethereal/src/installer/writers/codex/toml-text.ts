/**
 * A small TOML writer for the Codex files: flat key/value tables, strings, string arrays,
 * integers, booleans and inline tables of strings. The bundle generator writes the Codex files
 * with it, and the installer's Codex writer fills the config fragment with it, so it ships.
 *
 * Every string is a basic string with every quote, backslash and control character escaped;
 * text with a line break becomes a multi-line basic string. Literal strings are never used, so
 * no content — `'''`, `"""`, a trailing quote — can end a string early.
 */

export type TomlValue = string | number | boolean | readonly string[] | Readonly<Record<string, string>>

const BARE_KEY = /^[A-Za-z0-9_-]+$/

function escape(text: string, multiline: boolean): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n' && multiline) out += '\n'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out
}

export function tomlString(text: string): string {
  // The newline after the opening delimiter is dropped by TOML, so the content round-trips exactly.
  return text.includes('\n') ? `"""\n${escape(text, true)}"""` : `"${escape(text, false)}"`
}

const ESCAPES: Readonly<Record<string, string>> = { '\\\\': '\\', '\\"': '"', '\\n': '\n', '\\t': '\t', '\\r': '\r' }

/** The content of a basic string this writer produced (quotes stripped): the inverse of its escaping. */
export function tomlUnescape(body: string): string {
  return body.replace(/\\(?:u[0-9a-f]{4}|[\\"ntr])/g, (e) => ESCAPES[e] ?? String.fromCodePoint(parseInt(e.slice(2), 16)))
}

export function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : tomlString(key)
}

export function tomlValue(value: TomlValue): string {
  if (typeof value === 'string') return tomlString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`only integers are written: ${value}`)
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map((v) => tomlString(v)).join(', ')}]`
  const entries = Object.entries(value as Record<string, string>)
  return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`).join(', ')} }`
}

/** Key/value lines in the given order; undefined values are left out. */
export function tomlLines(entries: ReadonlyArray<readonly [string, TomlValue | undefined]>): string {
  return entries
    .filter((e): e is readonly [string, TomlValue] => e[1] !== undefined)
    .map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}\n`)
    .join('')
}

/** A table header for a dotted path, each part quoted when it is not a bare key. */
export function tomlTable(path: readonly string[]): string {
  return `[${path.map(tomlKey).join('.')}]\n`
}
