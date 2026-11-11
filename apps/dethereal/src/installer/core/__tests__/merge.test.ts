/**
 * The JSONC and TOML editors: an owned key or table goes in and comes out again
 * byte for byte, nothing else moves, and every existing form of the owned name
 * is a conflict.
 */
import { describe, expect, it } from 'vitest'
import { InstallerError } from '../errors.js'
import { guard, mergeJson, mergeJsonAll, unmergeJson } from '../merge-jsonc.js'
import { parse } from 'smol-toml'
import { deleteTomlTables, mergeToml, TOML_BEGIN, TOML_END, tomlTreeDiff, unmergeToml } from '../merge-toml.js'
import { unmergeRecord } from '../editors.js'
import { sha256 } from '../safe-write.js'

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    if (err instanceof InstallerError) return err.code
    throw err
  }
  return 'ok'
}
const VALUE = { type: 'local', command: ['node', '/r/dist/index.js'], enabled: true }

describe('JSONC editor', () => {
  const cases: Array<[string, string]> = [
    ['multi-line with comments and a trailing comma', '{\n  // user settings\n  "theme": "dark", /* inline */\n  "mcp": {\n    "other": { "x": [1, 2] }, // keep\n  },\n}\n'],
    ['multi-line without a trailing comma', '{\n  "mcp": {\n    "other": {\n      "x": 1\n    }\n  }\n}\n'],
    ['compact', '{"mcp":{"other":{"x":1}}}'],
    ['empty parent object', '{\n  "mcp": {}\n}\n'],
    ['CRLF, tabs and a BOM', '\uFEFF{\r\n\t"mcp": {\r\n\t\t"other": 1\r\n\t}\r\n}\r\n'],
    ['missing parent', '{\n  "theme": "dark"\n}'],
    ['empty root', '{}'],
  ]
  for (const [name, input] of cases) {
    it(`merges and unmerges exactly: ${name}`, () => {
      const r = mergeJson(Buffer.from(input), ['mcp', 'dethereal'], VALUE, 'jsonc', 'opencode.json')
      const out = r.bytes.toString('utf8')
      expect(out.startsWith(input.startsWith('\uFEFF') ? '\uFEFF' : '')).toBe(true)
      expect(unmergeJson(r.bytes, r.owned.path, 'jsonc', 'opencode.json', r.owned.created)!.toString('utf8')).toBe(input)
    })
  }

  it('owns only the key, and removes a parent it created only while that parent holds nothing else', () => {
    const input = '{\n  "theme": "dark"\n}\n'
    const r = mergeJson(Buffer.from(input), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f')
    expect(r.owned).toMatchObject({ path: ['mcp', 'dethereal'], created: 1 })
    // The user adds a server of their own under the parent the install created.
    const edited = r.bytes.toString().replace('"mcp": {', '"mcp": {"mine": {"type": "remote"},')
    const back = unmergeJson(Buffer.from(edited), r.owned.path, 'jsonc', 'f', r.owned.created)!
    expect(JSON.parse(back.toString())).toEqual({ theme: 'dark', mcp: { mine: { type: 'remote' } } })
    expect(unmergeJson(r.bytes, r.owned.path, 'jsonc', 'f', r.owned.created)!.toString()).toBe(input)
  })

  it('keeps every comment when the user added keys around the owned one', () => {
    const r = mergeJson(Buffer.from(cases[0]![1]), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f')
    const out = r.bytes.toString()
    const after = out.replace(/("dethereal": \{[\s\S]*?\n {4}\},?)\n/, '$1\n    // theirs\n    "later": 1, /* note */\n')
    const back = unmergeJson(Buffer.from(after), r.owned.path, 'jsonc', 'f')!.toString()
    for (const c of ['// user settings', '/* inline */', '// keep', '// theirs', '/* note */']) expect(back).toContain(c)
    expect(back).not.toContain('dethereal')
    const inline = unmergeJson(Buffer.from('{"mcp": {"a": 1, /* c */ "dethereal": {"x": 1}, "b": 2}}'), ['mcp', 'dethereal'], 'jsonc', 'f')!.toString()
    expect(inline).toBe('{"mcp": {"a": 1, /* c */ "b": 2}}')
  })

  it('leaves a key it cannot cut out cleanly to the user', () => {
    // A comment sits between the owned key and its comma: no cut keeps it and the syntax.
    expect(unmergeJson(Buffer.from('{"a": 1, "dethereal": 2 /* c */, "b": 3}'), ['dethereal'], 'jsonc', 'f')).toBeNull()
  })

  it('refuses a file that is not UTF-8', () => {
    expect(codeOf(() => mergeJson(Buffer.from([0x7b, 0xff, 0x7d]), ['mcp'], VALUE, 'jsonc', 'f'))).toBe('parse_error')
  })

  it('has a guard that catches an editor changing a neighbour, missing the value, or not reversing', () => {
    const before = Buffer.from('{\n  "a": 1\n}\n')
    const ok = Buffer.from('{\n  "a": 1,\n  "k": 2\n}\n')
    expect(codeOf(() => guard(before, ok, ['k'], 2, 0, 'jsonc', 'f'))).toBe('ok')
    expect(codeOf(() => guard(before, Buffer.from('{\n  "a": 9,\n  "k": 2\n}\n'), ['k'], 2, 0, 'jsonc', 'f'))).toBe('guard_failed')
    expect(codeOf(() => guard(before, Buffer.from('{\n  "a": 1,\n  "k": 3\n}\n'), ['k'], 2, 0, 'jsonc', 'f'))).toBe('guard_failed')
    expect(codeOf(() => guard(before, Buffer.from('{\n  "a": 1,\n  "k": 2,\n}\n'), ['k'], 2, 0, 'jsonc', 'f'))).toBe('guard_failed')
  })

  it('creates a missing file', () => {
    const r = mergeJson(null, ['mcp', 'dethereal'], VALUE, 'json', 'f')
    expect(JSON.parse(r.bytes.toString())).toEqual({ mcp: { dethereal: VALUE } })
  })

  it('refuses a conflict in every form, parse errors, duplicate keys and a non-object root', () => {
    expect(codeOf(() => mergeJson(Buffer.from('{"mcp":{"dethereal":{}}}'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('conflict')
    expect(codeOf(() => mergeJson(Buffer.from('{"mcp":"off"}'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('conflict_scalar_parent')
    expect(codeOf(() => mergeJson(Buffer.from('{"mcp":{'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('parse_error')
    expect(codeOf(() => mergeJson(Buffer.from('{"a":1,"a":2}'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('parse_error')
    expect(codeOf(() => mergeJson(Buffer.from('[1]'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('parse_error')
    expect(codeOf(() => mergeJson(Buffer.from('null'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f'))).toBe('parse_error')
    expect(codeOf(() => mergeJson(Buffer.from('{"a":1,}'), ['mcp', 'dethereal'], VALUE, 'json', 'f'))).toBe('parse_error')
    expect(codeOf(() => mergeJson(Buffer.from('{// c\n"a":1}'), ['mcp', 'dethereal'], VALUE, 'json', 'f'))).toBe('parse_error')
  })

  it('never puts parser text or file content into an error', () => {
    try {
      mergeJson(Buffer.from('{"secret-canary-value": '), ['mcp'], VALUE, 'jsonc', 'opencode.json')
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('secret-canary-value')
    }
  })

  it('removes an owned key the user moved things around, keeping every other key', () => {
    const r = mergeJson(Buffer.from('{\n  "mcp": {\n    "a": 1\n  }\n}\n'), ['mcp', 'dethereal'], VALUE, 'jsonc', 'f')
    const edited = r.bytes.toString().replace('"a": 1,', '"a": 1,\n    "b": 2,')
    const back = unmergeJson(Buffer.from(edited), ['mcp', 'dethereal'], 'jsonc', 'f')!
    expect(JSON.parse(back.toString())).toEqual({ mcp: { a: 1, b: 2 } })
    expect(unmergeJson(Buffer.from('{"mcp":{}}'), ['mcp', 'dethereal'], 'jsonc', 'f')).toBeNull()
  })
})

describe('TOML editor', () => {
  const TABLE = ['mcp_servers', 'dethereal']
  const FRAG = '[mcp_servers.dethereal]\ncommand = "node"\nargs = ["/r/dist/index.js"]\n\n[mcp_servers.dethereal.env]\nX = "1"\n'
  const cases: Array<[string, string]> = [
    ['plain', 'model = "o4"\n\n[profiles.a]\nx = 1\n'],
    ['no final newline', 'model = "o4"'],
    ['ending in a comment', 'model = "o4"\n# the end'],
    ['CRLF', 'model = "o4"\r\n[a]\r\nb = 1\r\n'],
    ['empty', ''],
    ['other servers', '[mcp_servers.other]\ncommand = "x"\n'],
    ['a multi-line string holding the header text', 'note = """\n[mcp_servers.dethereal]\n"""\n'],
  ]
  for (const [name, input] of cases) {
    it(`appends and removes exactly: ${name}`, () => {
      const r = mergeToml(input ? Buffer.from(input) : null, ['mcp_servers', 'dethereal'], FRAG, 'config.toml')
      const out = r.bytes.toString('utf8')
      expect(out.startsWith(input)).toBe(true)
      expect(out).toContain(TOML_BEGIN)
      expect(out.trimEnd().endsWith(TOML_END)).toBe(true)
      expect(unmergeToml(r.bytes, TABLE, 'config.toml')!.toString('utf8')).toBe(input)
    })
  }

  it('refuses the owned table in every form', () => {
    for (const input of [
      '[mcp_servers.dethereal]\ncommand = "x"\n',
      'mcp_servers.dethereal.command = "x"\n',
      'mcp_servers = { dethereal = { command = "x" } }\n',
      '[[mcp_servers.dethereal]]\ncommand = "x"\n',
      '[mcp_servers.dethereal.env]\nX = "1"\n',
      '[ "mcp_servers" . \'dethereal\' ]\ncommand = "x"\n',
      `${TOML_BEGIN}\n${TOML_END}\n`,
    ]) expect(codeOf(() => mergeToml(Buffer.from(input), ['mcp_servers', 'dethereal'], FRAG, 'f')), input).toBe('conflict')
  })

  it('refuses a fragment that could land keys in the user\'s last table, and a broken file', () => {
    expect(codeOf(() => mergeToml(Buffer.from('[a]\n'), ['mcp_servers', 'dethereal'], 'command = "x"\n', 'f'))).toBe('guard_failed')
    expect(codeOf(() => mergeToml(Buffer.from('[a]\n'), ['mcp_servers', 'dethereal'], '[other]\nx = 1\n', 'f'))).toBe('guard_failed')
    expect(codeOf(() => mergeToml(Buffer.from('a = = 1\nsecret = "canary-value"'), ['mcp_servers', 'dethereal'], FRAG, 'f'))).toBe('parse_error')
  })

  it('removes the block after the user edited around it, and reports a missing block', () => {
    const r = mergeToml(Buffer.from('a = 1\n'), ['mcp_servers', 'dethereal'], FRAG, 'f')
    const edited = 'top = 0\n' + r.bytes.toString() + '\n[later]\ny = 2\n'
    const back = unmergeToml(Buffer.from(edited), TABLE, 'f')!.toString()
    expect(back).not.toContain('dethereal')
    expect(back).toContain('[later]')
    expect(unmergeToml(Buffer.from('a = 1\n'), TABLE, 'f')).toBeNull()
    expect(unmergeToml(Buffer.from(`${TOML_BEGIN}\n${TOML_BEGIN}\n${TOML_END}\n`), TABLE, 'f')).toBeNull()
  })

  it('keeps tables a harness inserted inside the block, with the comments above them', () => {
    const r = mergeToml(Buffer.from('model = "o4"\n'), TABLE, FRAG, 'f')
    // An editor that keeps the file's last comment last inserts new tables above it.
    const inserted = '\n# trusted by the user\n[projects."/work/app"]\ntrust_level = "trusted"\n\n[mcp_servers.other]\ncommand = "x"\n'
    const edited = r.bytes.toString().replace(`${TOML_END}\n`, `${inserted.slice(1)}${TOML_END}\n`)
    const back = unmergeToml(Buffer.from(edited), TABLE, 'f')!.toString()
    expect(back).not.toContain('dethereal')
    for (const s of ['# trusted by the user', '[projects."/work/app"]', 'trust_level = "trusted"', '[mcp_servers.other]']) expect(back).toContain(s)
    expect(parse(back)).toEqual({ model: 'o4', projects: { '/work/app': { trust_level: 'trusted' } }, mcp_servers: { other: { command: 'x' } } })
  })

  it('leaves the file to the user when removing the block would take anything but the owned table', () => {
    const r = mergeToml(Buffer.from('model = "o4"\n'), TABLE, FRAG, 'f')
    // Header text inside a multi-line string of the owned table reads as a foreign table line by line.
    const edited = r.bytes.toString().replace('X = "1"\n', 'X = "1"\nnote = """\n[other]\nx = 1\n"""\n')
    expect(unmergeToml(Buffer.from(edited), TABLE, 'f')).toBeNull()
    expect(unmergeToml(Buffer.from('a = = 1\n'), TABLE, 'f')).toBeNull()
  })

  it('refuses a file that is not UTF-8', () => {
    expect(codeOf(() => mergeToml(Buffer.from([0x61, 0x20, 0x3d, 0x20, 0x22, 0xff, 0x22, 0x0a]), TABLE, FRAG, 'f'))).toBe('parse_error')
  })
})

describe('the TOML editor around a parent table the user already has', () => {
  const TABLE = ['mcp_servers', 'dethereal']
  const FRAG = '[mcp_servers.dethereal]\ncommand = "node"\n'
  it('merges into a file holding only an empty [mcp_servers], and gives it back byte for byte', () => {
    const r = mergeToml(Buffer.from('[mcp_servers]\n'), TABLE, FRAG, 'f')
    expect(unmergeToml(r.bytes, TABLE, 'f')!.toString()).toBe('[mcp_servers]\n')
  })
  it('leaves the file to the user when part of the owned table sits outside the block', () => {
    const r = mergeToml(Buffer.from('a = 1\n'), TABLE, FRAG, 'f')
    const edited = r.bytes.toString() + '\n[mcp_servers.dethereal.env]\nX = "1"\n'
    expect(unmergeToml(Buffer.from(edited), TABLE, 'f')).toBeNull()
  })
})

describe('removing the whole owned tree, and what in it changed', () => {
  const TABLE = ['mcp_servers', 'dethereal']
  const FRAG = '[mcp_servers.dethereal]\ncommand = "node"\nstartup_timeout_sec = 30\n'
  const base = '[model]\nname = "x"\n'
  const withTool = () => mergeToml(Buffer.from(base), TABLE, FRAG, 'f').bytes.toString() +
    '\n# the user allowed one tool for good\n[mcp_servers.dethereal.tools.update_model]\napproval = "always"\n\n[profile]\nx = 1\n'

  it('takes the owned sub-tables outside the block too, when asked, and keeps every other table', () => {
    expect(unmergeToml(Buffer.from(withTool()), TABLE, 'f')).toBeNull()
    const out = unmergeToml(Buffer.from(withTool()), TABLE, 'f', { outside: true })!.toString()
    expect(out).not.toMatch(/dethereal/)
    expect(parse(out)).toEqual(parse(base + '\n[profile]\nx = 1\n'))
    expect(out).toMatch(/# the user allowed one tool for good\n\n?\[profile\]|\[profile\]/)
  })

  it('does so through a record whose writer asks for the whole tree', () => {
    const bytes = mergeToml(Buffer.from(base), TABLE, FRAG, 'f')
    const record = { path: '/c', format: 'toml' as const, writer: 'installer' as const, pre: sha256(base), post: sha256(bytes.bytes), backupId: null, state: 'committed' as const, owned: [bytes.owned] }
    expect(unmergeRecord(Buffer.from(withTool()), record, 'f', { format: 'toml', paths: [TABLE] })).toBeNull()
    expect(unmergeRecord(Buffer.from(withTool()), record, 'f', { format: 'toml', paths: [TABLE], wholeTree: true })!.toString()).not.toMatch(/dethereal/)
  })

  it('names every leaf that differs from what was installed', () => {
    const edited = withTool().replace('startup_timeout_sec = 30', 'startup_timeout_sec = 90\nenabled = false')
    expect(tomlTreeDiff(Buffer.from(edited), TABLE, (parse(FRAG) as { mcp_servers: { dethereal: unknown } }).mcp_servers.dethereal).sort()).toEqual([
      ['mcp_servers', 'dethereal', 'enabled'],
      ['mcp_servers', 'dethereal', 'startup_timeout_sec'],
      ['mcp_servers', 'dethereal', 'tools'],
    ].sort())
    expect(tomlTreeDiff(Buffer.from('not = = toml'), TABLE, {})).toEqual([TABLE])
  })
})

describe('deleting named foreign tables', () => {
  const KEY = 'dethereal@dethereal-local:hooks/hooks.json:session_start:0:0'
  const KEY2 = 'dethereal@dethereal-local:hooks/hooks.json:pre_tool_use:0:1'
  const T = (k: string) => ['hooks', 'state', k]

  it('deletes exactly those tables, quoted and full of colons, inside or outside the block, every other byte kept', () => {
    const managed = mergeToml(Buffer.from('[model]\nname = "x"\n'), ['mcp_servers', 'dethereal'], '[mcp_servers.dethereal]\ncommand = "node"\n', 'f').bytes.toString()
    // The harness writes its own tables above the end sentinel, and anywhere else.
    const text = managed.replace(TOML_END, `[hooks.state."${KEY}"]\ntrusted_hash = "abc"\n\n${TOML_END}`) +
      `\n# keep me\n[hooks.state."${KEY2}"]\ntrusted_hash = "def"\n\n# about other\n[hooks.state."other-plugin:x"]\ntrusted_hash = "ghi"\n`
    const out = deleteTomlTables(Buffer.from(text), [T(KEY), T(KEY2)], 'f')!.toString()
    expect(out).not.toContain('dethereal@dethereal-local')
    expect(out).toContain('# about other\n[hooks.state."other-plugin:x"]')
    expect(parse(out)).toEqual({ ...parse(managed), hooks: { state: { 'other-plugin:x': { trusted_hash: 'ghi' } } } })
    // Absent tables: nothing to do, the bytes come back as they were.
    expect(deleteTomlTables(Buffer.from(out), [T(KEY)], 'f')!.toString()).toBe(out)
  })

  it('cannot prove the result, and says so, for an inline or dotted definition, an array of tables, a sub-table left behind or a broken file', () => {
    for (const text of [
      `[hooks.state]\n"${KEY}" = { trusted_hash = "a" }\n`,
      `hooks.state."${KEY}".trusted_hash = "a"\n`,
      `[[hooks.state."${KEY}"]]\ntrusted_hash = "a"\n`,
      `[hooks.state."${KEY}"]\nx = 1\n[hooks.state."${KEY}".sub]\ny = 2\n`,
      `[hooks.state."${KEY}"\n`,
      // A line inside a multi-line string that reads like the header: cutting there would change the string.
      `[hooks.state."${KEY}"]\nx = 1\n[other]\ns = """\n[hooks.state."${KEY}"]\ny\n[z]\n"""\n`,
    ]) expect(deleteTomlTables(Buffer.from(text), [T(KEY)], 'f'), text).toBeNull()
  })
})

describe('several owned keys in one JSONC file', () => {
  const OPENCODE = [
    { path: ['mcp', 'dethereal'], value: { type: 'local', command: ['node', '/r/dist/index.js'] } },
    { path: ['permission', 'read'], value: { '~/.dethernety/**': 'deny' } },
    { path: ['agent', 'explore', 'permission'], value: { edit: 'deny' } },
  ]
  it('merges and unmerges a three-key fragment into an empty, a partial and an edited file', () => {
    for (const input of ['{}', '{\n  "theme": "dark",\n  "agent": {\n    "build": { "model": "x" }\n  }\n}\n', '{\n  // mine\n  "mcp": {\n    "other": { "type": "remote" }\n  }\n}\n']) {
      const r = mergeJsonAll(Buffer.from(input), OPENCODE, 'jsonc', 'opencode.json')
      expect(r.owned.map((o) => o.path)).toEqual(OPENCODE.map((e) => e.path))
      let back: Buffer | null = r.bytes
      for (const o of [...r.owned].reverse()) back = unmergeJson(back!, o.path, 'jsonc', 'f', o.created ?? 0)
      expect(back!.toString()).toBe(input)
    }
  })
  it('keeps the user\'s own permission entries, and refuses a permission set to a plain value', () => {
    const r = mergeJsonAll(Buffer.from('{\n  "permission": {\n    "bash": "ask"\n  }\n}\n'), OPENCODE, 'jsonc', 'f')
    expect(JSON.parse(r.bytes.toString().replace(/\/\/.*$/gm, ''))).toMatchObject({ permission: { bash: 'ask', read: { '~/.dethernety/**': 'deny' } } })
    expect(codeOf(() => mergeJsonAll(Buffer.from('{ "permission": "allow" }'), OPENCODE, 'jsonc', 'f'))).toBe('conflict_scalar_parent')
  })
})
