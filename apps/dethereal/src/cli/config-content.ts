/**
 * What an edit to a harness's configuration file changes, for the config guard: the file is read
 * before and after the edit, and only a change that widens what runs without the operator is named.
 * Parsing is minimal and fails closed: a file that cannot be read in full yields no verdict, and
 * the guard then denies. No imports: plain functions over text.
 */

export type ConfigKind = 'claude' | 'codex' | 'opencode'

/** Why an edit is dangerous, or undefined when it is not; `unreadable` when it cannot be judged. */
/** `kind: 'settlement'`: the edit changes the settlement's switch (refused with its own reason). */
export type ConfigVerdict = { readonly ok: true } | { readonly ok: false; readonly rule: string; readonly kind?: 'settlement' }

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const isObject = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A tool name or rule that reaches a Dethereal tool, a whole server, or every tool. */
export function grantsDethereal(entry: string): boolean {
  const e = entry.trim()
  return /dethereal/i.test(e) || e === '*' || /^mcp__[a-z0-9_]*\*/i.test(e)
}

/**
 * A Claude Code allow rule for Bash, of any form: the guard does not read shell commands, and even one exact command
 * (`Bash(npm test)`) runs whatever an unguarded file it reads says, so any such rule would let a later edit past it.
 */
function bashRule(entry: string): boolean {
  return /^bash(\s*$|\s*\()/i.test(entry.trim())
}

/** JSON with comments and trailing commas (JSONC); undefined when it does not parse. */
export function parseJsonc(text: string): Json | undefined {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (j >= text.length) return undefined
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return undefined
      i = end + 2
    } else {
      out += c
      i++
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Json
  } catch {
    return undefined
  }
}

/**
 * A minimal TOML reader: tables, arrays of tables, dotted and quoted keys, strings, numbers,
 * booleans, dates as strings, arrays (over several lines) and inline tables. Anything else, a
 * duplicate key or a malformed line makes it return undefined.
 */
export function parseToml(text: string): Json | undefined {
  const root: Record<string, Json> = {}
  let table: Record<string, Json> = root
  let src = text.replace(/\r\n/g, '\n')
  let pos = 0
  const fail = (): never => {
    throw new Error('toml')
  }
  const ws = () => {
    while (pos < src.length && (src[pos] === ' ' || src[pos] === '\t')) pos++
  }
  const wsNl = () => {
    for (;;) {
      while (pos < src.length && /[ \t\n]/.test(src[pos]!)) pos++
      if (src[pos] === '#') while (pos < src.length && src[pos] !== '\n') pos++
      else return
    }
  }
  const key = (): string => {
    ws()
    const c = src[pos]
    if (c === '"' || c === "'") return stringValue() as string
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(pos))
    if (!m) fail()
    pos += m![0].length
    return m![0]
  }
  const dotted = (): string[] => {
    const parts = [key()]
    for (;;) {
      ws()
      if (src[pos] !== '.') return parts
      pos++
      parts.push(key())
    }
  }
  const stringValue = (): Json => {
    if (src.startsWith('"""', pos) || src.startsWith("'''", pos)) {
      const q = src.slice(pos, pos + 3)
      const end = src.indexOf(q, pos + 3)
      if (end < 0) fail()
      const v = src.slice(pos + 3, end).replace(/^\n/, '')
      pos = end + 3
      return v
    }
    const q = src[pos]!
    let j = pos + 1
    let v = ''
    while (j < src.length && src[j] !== q && src[j] !== '\n') {
      if (q === '"' && src[j] === '\\') {
        const e = src[j + 1]
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' }
        if (e === 'u' || e === 'U') {
          const n = e === 'u' ? 4 : 8
          v += String.fromCodePoint(parseInt(src.slice(j + 2, j + 2 + n), 16))
          j += 2 + n
          continue
        }
        if (!e || !(e in map)) fail()
        v += map[e!]
        j += 2
        continue
      }
      v += src[j]
      j++
    }
    if (src[j] !== q) fail()
    pos = j + 1
    return v
  }
  const value = (): Json => {
    ws()
    const c = src[pos]
    if (c === '"' || c === "'") return stringValue()
    if (c === '[') {
      pos++
      const arr: Json[] = []
      for (;;) {
        wsNl()
        if (src[pos] === ']') {
          pos++
          return arr
        }
        arr.push(value())
        wsNl()
        if (src[pos] === ',') pos++
        else if (src[pos] !== ']') fail()
      }
    }
    if (c === '{') {
      pos++
      const obj: Record<string, Json> = {}
      ws()
      if (src[pos] === '}') {
        pos++
        return obj
      }
      for (;;) {
        const k = dotted()
        ws()
        if (src[pos] !== '=') fail()
        pos++
        assign(obj, k, value())
        ws()
        if (src[pos] === ',') pos++
        else if (src[pos] === '}') {
          pos++
          return obj
        } else fail()
      }
    }
    const m = /^[^\s,\]}#]+/.exec(src.slice(pos))
    if (!m) fail()
    pos += m![0].length
    const t = m![0]
    if (t === 'true') return true
    if (t === 'false') return false
    if (/^[+-]?(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(t)) return Number(t.replace(/_/g, ''))
    if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{2}:\d{2}/.test(t)) return t
    if (/^(0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|[+-]?(inf|nan))$/.test(t)) return t
    return fail()
  }
  const assign = (obj: Record<string, Json>, keys: string[], v: Json) => {
    let o = obj
    for (const k of keys.slice(0, -1)) {
      if (o[k] === undefined) o[k] = {}
      if (!isObject(o[k])) fail()
      o = o[k] as Record<string, Json>
    }
    const last = keys.at(-1)!
    if (last in o) fail()
    o[last] = v
  }
  const tableAt = (keys: string[], array: boolean): Record<string, Json> => {
    let o = root
    keys.forEach((k, i) => {
      const lastKey = i === keys.length - 1
      if (lastKey && array) {
        if (o[k] === undefined) o[k] = []
        if (!Array.isArray(o[k])) fail()
        const t: Record<string, Json> = {}
        ;(o[k] as Json[]).push(t)
        o = t
        return
      }
      if (o[k] === undefined) o[k] = {}
      const next = o[k]
      if (Array.isArray(next)) {
        const t = next.at(-1)
        if (!isObject(t)) fail()
        o = t as Record<string, Json>
      } else if (isObject(next)) o = next
      else fail()
    })
    return o
  }
  try {
    for (;;) {
      wsNl()
      if (pos >= src.length) break
      if (src[pos] === '[') {
        const array = src[pos + 1] === '['
        pos += array ? 2 : 1
        const keys = dotted()
        ws()
        if (!src.startsWith(array ? ']]' : ']', pos)) fail()
        pos += array ? 2 : 1
        table = tableAt(keys, array)
      } else {
        const keys = dotted()
        ws()
        if (src[pos] !== '=') fail()
        pos++
        assign(table, keys, value())
      }
      ws()
      if (src[pos] === '#') while (pos < src.length && src[pos] !== '\n') pos++
      if (pos < src.length && src[pos] !== '\n') fail()
    }
    return root
  } catch {
    return undefined
  } finally {
    src = ''
  }
}

const danger = (rule: string): ConfigVerdict => ({ ok: false, rule })
const OK: ConfigVerdict = { ok: true }

/** Every `(path, value)` whose last key matches `test`, at any depth. */
function findKeys(v: Json | undefined, test: (k: string) => boolean, at: string[] = []): [string, Json][] {
  if (!isObject(v)) return Array.isArray(v) ? v.flatMap((x, i) => findKeys(x, test, [...at, String(i)])) : []
  return Object.entries(v).flatMap(([k, x]) => [...(test(k) ? [[[...at, k].join('.'), x] as [string, Json]] : []), ...findKeys(x, test, [...at, k])])
}

function claudeScopes(doc: Json | undefined): Map<string, Record<string, Json>> {
  const out = new Map<string, Record<string, Json>>()
  if (!isObject(doc)) return out
  out.set('', doc)
  // `.claude.json` keeps per-project settings under `projects`.
  if (isObject(doc.projects)) for (const [p, s] of Object.entries(doc.projects)) if (isObject(s)) out.set(`projects.${p}`, s)
  return out
}

/** The server's settlement switch (utils/settlement-switch.ts; a test holds the two equal). */
export const SETTLEMENT_ENV = 'DETHEREAL_SETTLEMENT'

// Settings that run a command without asking (statusLine, the helpers, fileSuggestion) or decide what runs.
const CLAUDE_EXECUTION_KEYS = ['hooks', 'disableAllHooks', 'mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'enableAllProjectMcpServers', 'allowedMcpServers', 'deniedMcpServers', 'statusLine', 'apiKeyHelper', 'otelHeadersHelper', 'awsAuthRefresh', 'awsCredentialExport', 'fileSuggestion', 'sandbox', 'extraKnownMarketplaces']
const BYPASS_MODES = new Set(['bypassPermissions', 'acceptEdits', 'dontAsk', 'auto'])

function judgeClaude(before: Json | undefined, after: Json | undefined): ConfigVerdict {
  const b = claudeScopes(before)
  const a = claudeScopes(after)
  for (const scope of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(scope) ?? {}
    const y = a.get(scope) ?? {}
    const xp = isObject(x.permissions) ? x.permissions : {}
    const yp = isObject(y.permissions) ? y.permissions : {}
    const allowBefore = new Set([...strings(xp.allow), ...strings(x.allowedTools)])
    for (const e of [...strings(yp.allow), ...strings(y.allowedTools)]) {
      if (grantsDethereal(e) && !allowBefore.has(e)) return danger(`adds an allow rule for a Dethereal tool or a wildcard of tools (${e.slice(0, 80)})`)
      if (bashRule(e) && !allowBefore.has(e)) return danger(`adds an allow rule for Bash (${e.slice(0, 80)})`)
    }
    for (const list of ['deny', 'ask'] as const) {
      const kept = new Set(strings(yp[list]))
      for (const e of strings(xp[list])) if (grantsDethereal(e) && !kept.has(e)) return danger(`removes the ${list} rule ${e.slice(0, 80)}`)
    }
    for (const e of strings(x.disallowedTools)) if (grantsDethereal(e) && !strings(y.disallowedTools).includes(e)) return danger(`removes the disallowed tool ${e.slice(0, 80)}`)
    const mode = yp.defaultMode
    if (typeof mode === 'string' && BYPASS_MODES.has(mode) && mode !== xp.defaultMode) return danger(`sets the permission mode ${mode}`)
    if (y.skipDangerousModePermissionPrompt === true && x.skipDangerousModePermissionPrompt !== true) return danger('skips the bypass-mode confirmation')
    for (const k of CLAUDE_EXECUTION_KEYS) if (!same(x[k], y[k])) return danger(`changes ${k}`)
    // The settings' environment reaches every process Claude Code starts, the plugin's server and hooks among them
    // (NODE_OPTIONS, PATH, the platform URL, a proxy): any change to it is the operator's. A change to the settlement's
    // switch, in any spelling (as on Windows, where the environment ignores case), is named as such.
    const keyed = (v: Json | undefined) => (isObject(v) ? Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : v)
    if (!same(keyed(x.env), keyed(y.env))) {
      const settlementEnv = (s: Record<string, Json>) =>
        (isObject(s.env) ? Object.entries(s.env).filter(([k]) => k.toUpperCase() === SETTLEMENT_ENV).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [])
      if (!same(settlementEnv(x), settlementEnv(y))) return { ok: false, rule: `changes ${SETTLEMENT_ENV}`, kind: 'settlement' }
      return danger('changes env')
    }
    const plugins = (s: Record<string, Json>) => (isObject(s.enabledPlugins) ? Object.fromEntries(Object.entries(s.enabledPlugins).filter(([k]) => /dethereal/i.test(k))) : {})
    if (!same(plugins(x), plugins(y))) return danger('changes whether the Dethereal plugin is enabled')
    // Another plugin enabled starts its hooks and servers without asking.
    const enabled = (s: Record<string, Json>) => new Set(isObject(s.enabledPlugins) ? Object.entries(s.enabledPlugins).filter(([, v]) => v === true).map(([k]) => k) : [])
    const wasEnabled = enabled(x)
    for (const k of enabled(y)) if (!wasEnabled.has(k)) return danger('enables a plugin')
    // The plugin's own options (its platform URL among them) reach its server.
    const options = (s: Record<string, Json>) => (isObject(s.pluginConfigs) ? Object.entries(s.pluginConfigs).filter(([k]) => /dethereal/i.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [])
    if (!same(options(x), options(y))) return danger("changes the Dethereal plugin's options")
  }
  return OK
}

function judgeCodex(before: Json | undefined, after: Json | undefined): ConfigVerdict {
  const policies = (d: Json | undefined) => new Map(findKeys(d, (k) => k === 'approval_policy'))
  const pb = policies(before)
  for (const [at, v] of policies(after)) if (v === 'never' && pb.get(at) !== 'never') return danger(`sets ${at} to never`)
  const bx = isObject(before) ? before : {}
  const ax = isObject(after) ? after : {}
  if (!same(bx.mcp_servers, ax.mcp_servers)) return danger('changes mcp_servers')
  const hooks = (d: Json | undefined) => Object.fromEntries(findKeys(d, (k) => /hook/i.test(k)))
  if (!same(hooks(before), hooks(after))) return danger('changes hooks')
  const trust = (d: Json | undefined) => Object.fromEntries(findKeys(d, (k) => k === 'trust_level'))
  if (!same(trust(before), trust(after))) return danger('changes a project trust level')
  return OK
}

const RANK: Record<string, number> = { deny: 0, ask: 1, allow: 2 }

function judgeOpencode(before: Json | undefined, after: Json | undefined): ConfigVerdict {
  const permissions = (d: Json | undefined) => {
    const out = new Map<string, Json>()
    const add = (scope: string, p: Json | undefined) => {
      if (typeof p === 'string') out.set(`${scope}*`, p)
      else if (isObject(p)) for (const [k, v] of Object.entries(p)) if (grantsDethereal(k)) out.set(`${scope}${k}`, v)
    }
    if (!isObject(d)) return out
    add('', d.permission)
    for (const group of ['agent', 'mode']) {
      if (isObject(d[group])) for (const [name, def] of Object.entries(d[group] as Record<string, Json>)) if (isObject(def)) add(`${group}.${name}:`, def.permission)
    }
    return out
  }
  const pb = permissions(before)
  const pa = permissions(after)
  for (const [k, v] of pa) {
    const was = pb.get(k)
    if (typeof v !== 'string' || typeof was === 'object') {
      if (!same(v, was)) return danger(`changes the permission ${k}`)
      continue
    }
    if ((RANK[v] ?? 2) > (typeof was === 'string' ? (RANK[was] ?? 2) : 1)) return danger(`widens the permission ${k} to ${v}`)
  }
  for (const [k, was] of pb) if (!pa.has(k) && was !== 'allow') return danger(`removes the permission ${k}`)
  const bx = isObject(before) ? before : {}
  const ax = isObject(after) ? after : {}
  for (const k of ['mcp', 'plugin']) if (!same(bx[k], ax[k])) return danger(`changes ${k}`)
  return OK
}

/**
 * The verdict on an edit that turns `before` into `after` (texts; `before` is '' for a new file).
 * Undefined when either text cannot be parsed: the caller denies.
 */
export function judgeConfigEdit(kind: ConfigKind, before: string, after: string): ConfigVerdict | undefined {
  const parse = kind === 'codex' ? parseToml : parseJsonc
  const b = before.trim() === '' ? {} : parse(before)
  const a = after.trim() === '' ? {} : parse(after)
  if (b === undefined || a === undefined) return undefined
  return kind === 'claude' ? judgeClaude(b, a) : kind === 'codex' ? judgeCodex(b, a) : judgeOpencode(b, a)
}
