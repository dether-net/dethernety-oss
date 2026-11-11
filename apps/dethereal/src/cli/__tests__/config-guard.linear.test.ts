/**
 * The config guard reads model input of up to 32 MB, with no deadline: every path through it must be linear. Each step
 * is checked against a reference kept here (the plain reading it stands for), on many seeded random inputs, and timed
 * on an input that makes the plain reading quadratic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { classify, decideConfigWrite, patchOperations, rawEventFrom, readGuardEvent, realish, type PathClass, type Roots } from '../config-guard.js'
import { grantsDethereal, judgeConfigEdit } from '../config-content.js'
import { seeded, timed } from '../../test-setup/crafted-input.js'

/** Under 250 ms once warmed up: the plain readings take seconds on the same inputs. */
function fast(label: string, f: () => unknown): void {
  expect([label, timed(f) < 250]).toEqual([label, true])
}

// ── the patch reader's whitespace trim ─────────────────────────────────────────────────────────

const REF_PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to):(.*)$/
const REF_PATCH_SPACE_EDGES = /^[\s\u0085]+|[\s\u0085]+$/g

function referencePatchOperations(text: string) {
  const ops: { kind: 'add' | 'update' | 'delete' | 'move'; path: string; lines?: string[]; bad?: boolean }[] = []
  let adding: { lines?: string[]; bad?: boolean } | undefined
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const trimmed = line.replace(REF_PATCH_SPACE_EDGES, '')
    if (/^\*\*\* Environment ID:/.test(trimmed)) return null
    const header = REF_PATCH_HEADER.exec(trimmed)
    if (header) {
      const kind = header[1] === 'Add File' ? 'add' : header[1] === 'Update File' ? 'update' : header[1] === 'Delete File' ? 'delete' : 'move'
      const op = { kind, path: header[2]!.replace(/^ /, ''), ...(kind === 'add' ? { lines: [] as string[] } : {}) } as const
      ops.push(op)
      adding = kind === 'add' ? op : undefined
      continue
    }
    if (!adding) continue
    if (/^\*\*\* End (Patch|of File)\b/.test(trimmed) || /^\*\*\* Begin Patch\b/.test(trimmed)) {
      adding = undefined
      continue
    }
    if (line.startsWith('+')) adding.lines!.push(line.slice(1))
    else if (line !== '' || adding.lines!.length > 0) adding.bad = true
  }
  if (ops.length === 0) return null
  return ops.map((o) => ({ kind: o.kind, path: o.path, ...(o.kind === 'add' && !o.bad ? { content: o.lines!.map((l) => `${l}\n`).join('') } : {}) }))
}

describe('config guard, linear: the patch reader trims a line from both ends', () => {
  const SPACES = [' ', '\t', '\r', '\v', '\f', '\u0085', ' ', ' ', '　', '﻿', '​']
  const HEADS = ['*** Add File:', '*** Update File:', '*** Delete File:', '*** Move to:', '*** End Patch', '*** Begin Patch', '*** Environment ID:', '+', '']
  const BODY = ['a', 'b', '.', '/', ' ', '\u0085', '\t', '+', '*', 'x y']

  it('reads every random patch as the regex did', () => {
    const r = seeded(1)
    const spaces = (n: number) => Array.from({ length: r.int(n) }, () => r.pick(SPACES)).join('')
    let withOps = 0
    let edgeHeaders = 0
    for (let c = 0; c < 20_000; c++) {
      const lines = Array.from({ length: 1 + r.int(6) }, () => spaces(4) + r.pick(HEADS) + Array.from({ length: r.int(5) }, () => r.pick(BODY)).join('') + spaces(4))
      const text = lines.join(r.next() < 0.2 ? '\r\n' : '\n')
      const want = referencePatchOperations(text)
      expect([text, patchOperations(text)]).toEqual([text, want])
      if (want) withOps++
      // A header found only once whitespace is trimmed from an end, or whose path the trim shortened.
      if (want && lines.some((l) => /^[\s\u0085]+\*\*\* |\*\*\* (Add File|Update File|Delete File|Move to):.*[\s\u0085]$/.test(l))) edgeHeaders++
    }
    expect(withOps).toBeGreaterThan(5000)
    expect(edgeHeaders).toBeGreaterThan(3000)
  })

  it('reads a long run of whitespace in time', () => {
    const n = 100_000
    fast('inner spaces', () => patchOperations(`*** Begin Patch\nx${' '.repeat(n)}x\n*** End Patch\n`))
    fast('inner U+0085', () => patchOperations(`*** Add File: a${'\u0085'.repeat(n)}b\n+x\n`))
    fast('spaces at both ends', () => patchOperations(`${' \t'.repeat(n / 4)}*** Delete File: a${' \t'.repeat(n / 4)}\n`))
    expect(patchOperations(`  *** Add File: a${'\u0085 '.repeat(n / 2)}\n+x`)).toEqual([{ kind: 'add', path: 'a', content: 'x\n' }])
  })
})

// ── the real path through the nearest existing ancestor ─────────────────────────────────────────

let linksFollowed = 0
let depthLimitHit = 0

function referenceRealish(p: string, depth = 0): string {
  let existing = p
  while (!existsSync(existing)) {
    if (depth < 8) {
      let link: string | undefined
      try {
        link = lstatSync(existing).isSymbolicLink() ? readlinkSync(existing) : undefined
      } catch {
        link = undefined
      }
      if (link !== undefined) {
        linksFollowed++
        return referenceRealish(path.join(path.resolve(path.dirname(existing), link), path.relative(existing, p)), depth + 1)
      }
    } else depthLimitHit++
    const parent = path.dirname(existing)
    if (parent === existing) return p
    existing = parent
  }
  try {
    return path.join(realpathSync(existing), path.relative(existing, p))
  } catch {
    return p
  }
}

describe('config guard, linear: the real path of a path that may not exist yet', () => {
  let tmp: string
  let noperm: string

  beforeAll(() => {
    // Not resolved itself: on macOS the temporary folder sits behind a link, which the real path resolves.
    tmp = mkdtempSync(path.join(os.tmpdir(), 'config-guard-linear-'))
    const at = (rel: string) => path.join(tmp, rel)
    mkdirSync(at('d/e'), { recursive: true })
    writeFileSync(at('d/f'), '')
    symlinkSync(at('d'), at('linkdir'))
    symlinkSync('d', at('rellinkdir'))
    symlinkSync(at('missing/target'), at('dangling'))
    symlinkSync('nope/x', at('danglingRel'))
    symlinkSync('dangling', at('danglingToLink'))
    symlinkSync('loop2', at('loop1'))
    symlinkSync('loop1', at('loop2'))
    symlinkSync('self', at('self'))
    symlinkSync('d/f', at('fileLink'))
    symlinkSync('d/f/sub', at('throughFile'))
    symlinkSync('linkdir/e/new', at('viaLink'))
    symlinkSync('/', at('toRoot'))
    symlinkSync('../linkdir', at('d/inner'))
    symlinkSync('e/newdir', at('d/danglingDir'))
    symlinkSync('../../config-guard-linear-outside', at('d/up'))
    for (let i = 0; i < 10; i++) symlinkSync(i === 9 ? 'missing9' : `l${i + 1}`, at(`l${i}`))
    noperm = at('d/noperm')
    mkdirSync(path.join(noperm, 'inner'), { recursive: true })
    chmodSync(noperm, 0o000)
  })

  afterAll(() => {
    chmodSync(noperm, 0o755)
    rmSync(tmp, { recursive: true, force: true })
  })

  const SEGMENTS = [
    'd', 'e', 'f', 'linkdir', 'rellinkdir', 'dangling', 'danglingRel', 'danglingToLink', 'loop1', 'self', 'fileLink', 'throughFile', 'viaLink',
    'toRoot', 'inner', 'danglingDir', 'up', 'l0', 'l3', 'noperm', 'missing', 'x', 'new', '..',
  ]

  it('resolves every random path as the walk up from the path did, links and missing folders included', () => {
    const r = seeded(2)
    let resolvedLink = 0
    let limited = 0
    for (let c = 0; c < 6000; c++) {
      const segs = Array.from({ length: 1 + r.int(6) }, () => r.pick(SEGMENTS))
      const p = r.next() < 0.05 ? path.join('/', ...segs) : path.join(tmp, ...segs)
      const [followed, hit] = [linksFollowed, depthLimitHit]
      const want = referenceRealish(p)
      expect([p, realish(p)]).toEqual([p, want])
      if (linksFollowed > followed) resolvedLink++
      if (depthLimitHit > hit) limited++
    }
    expect(resolvedLink).toBeGreaterThan(1500)
    expect(limited).toBeGreaterThan(20)
  })

  it('resolves a path of many thousand missing folders in time', () => {
    // 100 KB; a chain of links is followed eight times over, each a linear pass, so it is timed at 50 KB.
    for (const [start, segments] of [['x', 50_000], ['linkdir', 50_000], ['dangling', 50_000], ['d/noperm/inner', 50_000], ['l0', 25_000]] as const) {
      fast(start, () => realish(path.join(tmp, start) + '/a'.repeat(segments)))
      const short = path.join(tmp, start) + '/a'.repeat(500)
      expect(realish(short)).toBe(referenceRealish(short))
    }
  })
})

// ── the class of a path ─────────────────────────────────────────────────────────────────────────

function referenceUnder(p: string, dir: string | undefined): string[] | undefined {
  if (!dir) return undefined
  const rel = path.relative(dir, p)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep) : undefined
}

function referenceGitInternal(segments: readonly string[]): boolean {
  return segments.some((s, i) => {
    if (s !== '.git') return false
    const rest = segments.slice(i + 1)
    if (rest.length === 0) return true
    const last = rest.at(-1)!
    const nested = rest[0] === 'modules' || rest[0] === 'worktrees'
    if (rest[0] === 'hooks' || (nested && rest.includes('hooks'))) return true
    if (rest.length >= 2 && rest.at(-2) === 'info' && last === 'attributes') return true
    return ['config', 'config.worktree', 'commondir', 'gitdir'].includes(last) && (rest.length === 1 || nested)
  })
}

function referenceClassify(p: string, r: Roots): PathClass {
  const segments = p.split(path.sep)
  const base = segments.at(-1) ?? ''
  const parent = segments.at(-2) ?? ''
  const dirs = segments.slice(0, -1)
  const kindUnder = (rootDirs: readonly string[], kinds: readonly string[], viaPlugins: boolean) =>
    kinds.includes(rootDirs[0] ?? '') || (viaPlugins && rootDirs[0] === 'plugins' && rootDirs.slice(1).some((d) => kinds.includes(d)))
  const below = (name: string) => dirs.flatMap((d, i) => (d === name ? [dirs.slice(i + 1)] : []))
  const rel = (dir: string | undefined) => {
    const parts = referenceUnder(p, dir)
    return parts ? [parts.slice(0, -1)] : []
  }
  if (r.gitUser.includes(p) || referenceGitInternal(segments)) return 'git-config'
  if ([...below('.claude'), ...rel(r.claudeConfig)].some((d) => d[0] === 'plugins')) return 'plugin-cache'
  if (base === '.claude.json') return 'config:claude'
  if ((base === 'settings.json' || base === 'settings.local.json') && (parent === '.claude' || (r.claudeConfig && path.dirname(p) === r.claudeConfig))) return 'config:claude'
  if (base === 'config.toml' && (parent === '.codex' || (r.codexHome && path.dirname(p) === r.codexHome))) return 'config:codex'
  if (base === 'opencode.json' || base === 'opencode.jsonc' || p === r.opencodeConfig) return 'config:opencode'
  const opencode = [...below('.opencode'), ...rel(r.opencodeDir)]
  if (opencode.some((d) => kindUnder(d, ['plugin', 'plugins'], false))) return 'plugin'
  if ([...below('.codex'), ...rel(r.codexHome)].some((d) => d[0] === 'plugins')) return 'plugin'
  const claudeKinds = ['skills', 'commands', 'agents']
  if ([...below('.claude'), ...rel(r.claudeConfig)].some((d) => kindUnder(d, claudeKinds, true))) return 'definition'
  if (opencode.some((d) => kindUnder(d, ['agent', 'agents', 'command', 'commands', 'skill', 'skills', 'mode', 'modes'], false))) return 'definition'
  if (below('.codex').length > 0 || referenceUnder(p, r.codexHome)) return 'definition'
  return undefined
}

describe('config guard, linear: the class of a path', () => {
  const ROOTS: Roots[] = [
    { gitUser: ['/h/.gitconfig', '/h/.config/git/config'], opencodeDir: '/h/.config/opencode' },
    { gitUser: [], claudeConfig: '/c', codexHome: '/x/codex', opencodeDir: '/h/.config/opencode', opencodeConfig: '/h/oc.json' },
    { gitUser: [], claudeConfig: '/h/.claude', codexHome: '/h/.codex', opencodeDir: '/o' },
  ]
  const PREFIXES = ['', '', '', '/c', '/x/codex', '/h/.config/opencode', '/h', '/o', '/h/.claude']
  const SEGMENTS = [
    '.git', '.git', '.git', 'modules', 'worktrees', 'hooks', 'info', 'attributes', 'config', 'config.worktree', 'commondir', 'gitdir',
    '.claude', '.claude', 'plugins', 'skills', 'commands', 'agents', 'settings.json', 'settings.local.json', '.claude.json',
    '.codex', 'config.toml', '.opencode', 'plugin', 'agent', 'command', 'skill', 'mode', 'modes', 'opencode.json', 'opencode.jsonc',
    '.gitconfig', 'oc.json', 'c', 'x', 'codex', 'h', '.config', 'opencode', 'git', 'a', '',
    // Pairs, so that the rarer classes come up often too.
    '.claude/plugins', '.claude/skills', '.git/modules', '.git/info', '.opencode/plugin', '.codex/plugins', '.codex/config.toml', '.claude/settings.json', 'info/attributes',
  ]

  it('classifies every random path as the sliced reading did', () => {
    const r = seeded(3)
    const tally = new Map<PathClass, number>()
    let severalGit = 0
    let nestedHooks = 0
    let infoAttributes = 0
    for (let c = 0; c < 60_000; c++) {
      const roots = r.pick(ROOTS)
      const segs = Array.from({ length: r.int(9) }, () => r.pick(SEGMENTS))
      const p = r.next() < 0.03 ? r.pick([...roots.gitUser, roots.opencodeConfig ?? '/']) : `${r.pick(PREFIXES)}/${segs.join('/')}`
      const want = referenceClassify(p, roots)
      expect([p, classify(p, roots)]).toEqual([p, want])
      tally.set(want, (tally.get(want) ?? 0) + 1)
      if (want === 'git-config' && p.split('/').filter((s) => s === '.git').length > 1) severalGit++
      if (want === 'git-config' && /\/\.git\/(modules|worktrees)\/(.*\/)?hooks(\/|$)/.test(p)) nestedHooks++
      if (want === 'git-config' && /\/\.git\/(.*\/)?info\/attributes$/.test(p)) infoAttributes++
    }
    for (const c of ['git-config', 'plugin-cache', 'config:claude', 'config:codex', 'config:opencode', 'plugin', 'definition', undefined] as const) {
      expect([c, (tally.get(c) ?? 0) > 300]).toEqual([c, true])
    }
    expect([severalGit, nestedHooks, infoAttributes].map((n) => n > 100)).toEqual([true, true, true])
  })

  it('classifies a path of many thousand guarded folders in time', () => {
    const roots = ROOTS[1]!
    // Each 100 KB: a folder repeated, then a tail.
    const cases: [string, string, string][] = [
      ['/.git', '/x', ''],
      ['/.git/modules', '/x', ''],
      ['/.git/modules', '/hooks/x', ''],
      ['/.claude', '/x', ''],
      ['/.claude/x', '/x', ''],
      ['/.opencode', '/x', ''],
      ['/.codex', '/x', ''],
      ['/a', '/x', '/c'],
    ]
    for (const [unit, tail, head] of cases) {
      const label = `${head}${unit}…${tail}`
      fast(label, () => classify(head + unit.repeat(100_000 / unit.length) + tail, roots))
      const short = head + unit.repeat(100) + tail
      expect([label, classify(short, roots)]).toEqual([label, referenceClassify(short, roots)])
    }
  })

  it('decides a write to such a path in time', () => {
    const g = { env: {}, home: '/nonexistent-home', platform: 'linux' as const, cwd: '/', readFile: () => null }
    for (const dir of ['/.git', '/.claude', '/.opencode', '/a']) {
      const text = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `/nonexistent-config-guard-linear${dir.repeat(100_000 / dir.length)}/x`, content: '' } })
      fast(dir, () => decideConfigWrite(rawEventFrom(text), g))
    }
  })
})

// ── the fields recovered from a raw event ───────────────────────────────────────────────────────

const REF_FIELD = /"(file_path|notebook_path|cwd|tool_name|command|path|glob|output_mode|tool|filePath|include|workdir|directory)"\s*:\s*"((?:[^"\\]|\\.){0,4096})"/g

class OldFieldScanner {
  private tail = ''
  readonly fields = new Map<string, string[]>()

  push(chunk: string): void {
    const window = this.tail + chunk
    for (const m of window.matchAll(REF_FIELD)) {
      let value: string | undefined
      try {
        value = JSON.parse(`"${m[2]!}"`) as string
      } catch {
        value = undefined
      }
      if (value === undefined) continue
      const list = this.fields.get(m[1]!) ?? []
      if (!list.includes(value)) list.push(value)
      this.fields.set(m[1]!, list)
    }
    this.tail = window.slice(-8192)
  }
}

describe('config guard, linear: the fields of a raw event', () => {
  const NAMES = ['file_path', 'path', 'cwd', 'tool_name', 'command', 'filePath', 'other']
  const VALUES = ['a', 'b', '/x/y', 'A', '\\u0041', '\\"q\\"', '\\x', 'a\\\\b', '']
  const event = (r: ReturnType<typeof seeded>) =>
    `{${Array.from({ length: 1 + r.int(12) }, () => `"${r.pick(NAMES)}"${r.pick(['', ' '])}:${r.pick(['', ' '])}"${r.pick(VALUES)}"`).join(',')}}`

  it('recovers every random event as the list search did, each value once, in order', () => {
    const r = seeded(4)
    let deduplicated = 0
    for (let c = 0; c < 10_000; c++) {
      const text = event(r)
      const old = new OldFieldScanner()
      old.push(text)
      const want = [...old.fields]
      expect([text, [...rawEventFrom(text).fields]]).toEqual([text, want])
      const matches = [...text.matchAll(REF_FIELD)].length
      if (want.reduce((n, [, values]) => n + values.length, 0) < matches) deduplicated++
    }
    expect(deduplicated).toBeGreaterThan(3000)
  })

  it('recovers a streamed event, split anywhere, as the list search did', async () => {
    const r = seeded(5)
    for (let c = 0; c < 200; c++) {
      const text = Array.from({ length: 1 + r.int(4) }, () => event(r)).join(' '.repeat(r.int(9000)))
      const cuts = Array.from({ length: r.int(4) }, () => r.int(text.length)).sort((a, b) => a - b)
      const chunks = [0, ...cuts].map((from, i) => text.slice(from, [...cuts, text.length][i]))
      const old = new OldFieldScanner()
      for (const chunk of chunks) old.push(chunk)
      const raw = await readGuardEvent(Readable.from(chunks.map((s) => Buffer.from(s))) as unknown as NodeJS.ReadStream)
      expect([text, [...raw.fields]]).toEqual([text, [...old.fields]])
    }
  })

  it('recovers many thousand distinct values in time', () => {
    const text = JSON.stringify({ a: Array.from({ length: 25_000 }, (_, i) => ({ path: String(i) })) })
    expect(text.length).toBeGreaterThan(300_000)
    fast('distinct paths', () => rawEventFrom(text))
    expect(rawEventFrom(text).fields.get('path')).toHaveLength(25_000)
  })
})

// ── a removed disallowed tool ───────────────────────────────────────────────────────────────────

describe('config guard, linear: a Dethereal tool taken out of disallowedTools', () => {
  const TOOLS = ['mcp__dethereal__x', 'dethereal_y', ' dethereal_y ', '*', 'mcp__*', 'mcp__plugin_dethereal_dethereal__a', 'Read', 'Bash', 1, null, 'mcp__other']

  /** The verdict of the old list search, on settings that differ in nothing else. */
  function referenceVerdict(before: unknown[], after: unknown[]) {
    const strings = (v: unknown[]) => v.filter((x): x is string => typeof x === 'string')
    for (const e of strings(before)) if (grantsDethereal(e) && !strings(after).includes(e)) return { ok: false, rule: `removes the disallowed tool ${e.slice(0, 80)}` }
    return { ok: true }
  }

  it('judges every random pair of lists as the list search did', () => {
    const r = seeded(6)
    let removed = 0
    for (let c = 0; c < 10_000; c++) {
      const list = () => Array.from({ length: r.int(6) }, () => r.pick(TOOLS))
      const [before, after] = [list(), list()]
      const want = referenceVerdict(before, after)
      const got = judgeConfigEdit('claude', JSON.stringify({ disallowedTools: before }), JSON.stringify({ disallowedTools: after }))
      expect([before, after, got]).toEqual([before, after, want])
      if (!want.ok) removed++
    }
    expect(removed).toBeGreaterThan(3000)
  })

  it('judges a list of many thousand tools in time', () => {
    const doc = JSON.stringify({ disallowedTools: Array.from({ length: 30_000 }, (_, i) => `dethereal_${i}`) })
    expect(doc.length).toBeGreaterThan(400_000)
    fast('same list', () => judgeConfigEdit('claude', doc, doc))
    expect(judgeConfigEdit('claude', doc, doc)).toEqual({ ok: true })
  })
})
