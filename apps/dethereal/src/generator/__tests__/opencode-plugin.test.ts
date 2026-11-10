/**
 * The OpenCode plugin, run as OpenCode runs it (its one export, called with the plugin context)
 * against a stand-in CLI that records what it was given and answers as told.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FALLBACK_IMPORT, inlineFallback, pluginSource } from '../targets/opencode/index.js'
import * as fallback from '../../utils/secret-fallback.mjs'
import { fillPlugin } from '../../installer/writers/opencode/index.js'
import { expandHome, lastMatch, type Rule } from '../../installer/writers/opencode/rules.js'

type Hooks = Record<string, (input: unknown, output: Record<string, unknown>) => Promise<void>>
type Plugin = (ctx: { directory: string; worktree?: string }) => Promise<Hooks>

const STUB = `
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
const here = path.dirname(new URL(import.meta.url).pathname)
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const stdin = Buffer.concat(chunks).toString('utf8')
const url = { DETHERNETY_URL: process.env.DETHERNETY_URL ?? null, DETHERNETY_PLATFORM_URL: process.env.DETHERNETY_PLATFORM_URL ?? null }
appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin, url }) + '\\n')
const mode = readFileSync(path.join(here, 'mode'), 'utf8').trim()
if (mode === 'allow') process.stdout.write('{"deny":false}\\n')
else if (mode === 'deny') process.stdout.write(JSON.stringify({ deny: true, reason: 'dethereal-secret-guard: secrets.yaml is a secret file.' }))
else if (mode === 'garbage') process.stdout.write('{"deny":maybe}')
else if (mode === 'empty') process.stdout.write('')
else if (mode === 'exit1') process.exit(1)
else if (mode === 'signal') process.kill(process.pid, 'SIGKILL')
else if (mode === 'flood') process.stdout.write('x'.repeat(2 * 1024 * 1024))
else if (mode === 'hang') setTimeout(() => undefined, 60_000)
else process.stdout.write(mode)
`

let tmp: string
let project: string
let plugin: Plugin
let missing: Plugin

const setMode = (mode: string) => writeFileSync(path.join(tmp, 'mode'), mode)
type Call = { argv: string[]; cwd: string; stdin: string; url: Record<string, string | null> }
const calls = (): Call[] => {
  const f = path.join(tmp, 'calls.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Call) : []
}

async function load(name: string, node: string, entry: string, source = pluginSource({ node, entry })): Promise<Plugin> {
  const file = path.join(tmp, `${name}.ts`)
  writeFileSync(file, source)
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
  // OpenCode calls every export as a plugin: there is exactly one.
  expect(Object.keys(mod)).toEqual(['DetherealPlugin'])
  return mod.DetherealPlugin as Plugin
}

beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'opencode-plugin-')))
  // The plugin refuses any argument holding the server folder's name: a temp folder named so would refuse every case.
  if (/dethernety/i.test(tmp)) throw new Error(`The temp folder ${tmp} holds "dethernety"; set TMPDIR to a folder without it.`)
  project = path.join(tmp, 'project')
  writeFileSync(path.join(tmp, 'stub.mjs'), STUB)
  mkdirSync(project)
  plugin = await load('dethereal', process.execPath, path.join(tmp, 'stub.mjs'))
  missing = await load('missing', path.join(tmp, 'no-such-node'), path.join(tmp, 'stub.mjs'))
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(path.join(tmp, 'calls.jsonl'), { force: true })
})

const before = async (p: Plugin, tool: string, args: Record<string, unknown>) =>
  (await p({ directory: project }))['tool.execute.before']!({ tool, sessionID: 's', callID: 'c' }, { args })

describe('the OpenCode plugin: the secret guard before read, grep and bash', () => {
  it('has one export and no template placeholders left once filled', () => {
    const source = pluginSource({ node: '/n', entry: '/e' })
    expect(source.match(/^export /gm)).toHaveLength(1)
    expect(source).not.toMatch(/<node-abs>|<runtime>/)
    expect(pluginSource()).toContain('"<node-abs>"')
  })

  it('lets a call the guard allows run, sending it the fields it needs and the directory as cwd', async () => {
    setMode('allow')
    await expect(before(plugin, 'read', { filePath: 'src/app.ts', offset: 3 })).resolves.toBeUndefined()
    await expect(before(plugin, 'grep', { pattern: 'x', path: 'deploy', include: '*.yaml' })).resolves.toBeUndefined()
    await expect(before(plugin, 'bash', { command: 'ls', workdir: 'deploy', description: 'list' })).resolves.toBeUndefined()
    const seen = calls()
    expect(seen.map((c) => c.argv)).toEqual(Array(3).fill(['hook', 'secret-guard', '--harness', 'opencode']))
    expect(seen.map((c) => c.cwd)).toEqual([project, project, project])
    expect(seen.map((c) => JSON.parse(c.stdin))).toEqual([
      { tool: 'read', directory: project, args: { filePath: 'src/app.ts' } },
      { tool: 'grep', directory: project, args: { pattern: 'x', path: 'deploy', include: '*.yaml' } },
      { tool: 'bash', directory: project, args: { command: 'ls', workdir: 'deploy' } },
    ])
  })

  it('throws the guard\'s reason when it denies', async () => {
    setMode('deny')
    await expect(before(plugin, 'read', { filePath: 'deploy/secrets.yaml' })).rejects.toThrow('dethereal-secret-guard: secrets.yaml is a secret file.')
    await expect(before(plugin, 'bash', { command: 'cat deploy/secrets.yaml' })).rejects.toThrow('dethereal-secret-guard: secrets.yaml is a secret file.')
  })

  it('never starts a guard for list, glob or a tool it does not know', async () => {
    setMode('deny')
    for (const tool of ['list', 'glob', 'webfetch', 'todowrite']) await expect(before(plugin, tool, { path: 'deploy' })).resolves.toBeUndefined()
    expect(calls()).toEqual([])
  })

  it('refuses a tool it does not know when its arguments reach for the server folder from outside the project', async () => {
    setMode('allow')
    await expect(before(plugin, 'webfetch', { url: 'file:///home/u/.dethernety/tokens.json' })).rejects.toThrow(/^dethereal-secret-guard: /)
    await expect(before(plugin, 'some_new_tool', { target: '~/.dethernety/tokens.json' })).rejects.toThrow(/does not know/)
    await expect(before(plugin, 'some_new_tool', { nested: { p: '../../.dethernety/x' } })).rejects.toThrow(/does not know/)
    await expect(before(plugin, 'some_new_tool', { p: '.dethernety/models.json' })).resolves.toBeUndefined()
    expect(calls()).toEqual([])
  })

  it('refuses the server folder however a tool that runs, reads or fetches spells it, quoted, built or encoded, nested too', async () => {
    setMode('allow')
    const spellings = [
      '~/.dethernety/tokens.json', '${HOME}/.dethernety', '../.dethernety', '/home/u/.dethernety/x', '~/.${x}dethernety/tokens.json',
      '~/.$(echo dethernety)/tokens.json', '~/.`echo dethernety`/tokens.json', "~/$'\\x2e'dethernety/tokens.json", '~/[!a]dethernety',
      'file:///home/u/%2Edethernety/tokens.json', '{"path":"~/\\u002edethernety"}',
    ]
    for (const tool of ['skill', 'webfetch', 'some_new_tool']) {
      for (const s of spellings) {
        await expect(before(plugin, tool, { arg: s }), `${tool} ${s}`).rejects.toThrow(/does not know/)
        await expect(before(plugin, tool, { a: { b: [s] } }), `${tool} nested ${s}`).rejects.toThrow(/does not know/)
      }
    }
    expect(calls()).toEqual([])
  })

  it('judges no prose of a delegation: a prompt may name a module or the product beside a path', async () => {
    setMode('deny')
    const prompt = 'Model directory: /home/u/proj/threat-models/orderdesk. Classify the components; active modules: dethernety-general.'
    await expect(before(plugin, 'task', { description: 'classify', prompt, subagent_type: 'general' })).resolves.toBeUndefined()
    const prose = 'Review the Dethernety threat model at /home/u/proj/threat-models/orderdesk; the server keeps ~/.dethernety to itself.'
    await expect(before(plugin, 'task', { description: 'review', prompt: prose, subagent_type: 'general', task_id: 't', background: false })).resolves.toBeUndefined()
    // a prompt with no mention starts no guard
    expect(calls()).toEqual([])
  })

  it('judges each file a delegation mentions as a read of that path, since OpenCode reads it itself', async () => {
    const task = (prompt: string) => ({ description: 'd', prompt, subagent_type: 'general' })
    setMode('allow')
    for (const m of ['@~/.dethernety/tokens.json', '@/home/u/.dethernety', '@../.dethernety', '@~/.codex/auth.json', '@~/.local/share/opencode/auth.json', '@~/.claude/settings.json']) {
      await expect(before(plugin, 'task', task(`Classify the model; context: ${m} please`)), m).rejects.toThrow(/lies in a harness's home, OpenCode's data folder or the server's folder/)
    }
    // a guarded folder is refused before any guard starts
    expect(calls()).toEqual([])
    await expect(before(plugin, 'task', task('Read @src/app.ts and @deploy/values.yaml, then classify.'))).resolves.toBeUndefined()
    // the guards run side by side, in any order
    expect(calls().map((c) => JSON.parse(c.stdin) as unknown)).toEqual(expect.arrayContaining([
      { tool: 'read', directory: project, args: { filePath: path.join(project, 'src/app.ts') } },
      { tool: 'read', directory: project, args: { filePath: path.join(project, 'deploy/values.yaml') } },
    ]))
    expect(calls()).toHaveLength(2)
    setMode('deny')
    await expect(before(plugin, 'task', task('Use @.env for the settings'))).rejects.toThrow('dethereal-secret-guard: secrets.yaml is a secret file.')
    // the guard cannot be started: the mention is not read
    await expect(before(missing, 'task', task('Read @src/app.ts'))).rejects.toThrow(/could not be checked/)
    // past the bound, refused unjudged; at it, each distinct name judged once
    rmSync(path.join(tmp, 'calls.jsonl'), { force: true })
    await expect(before(plugin, 'task', task(Array.from({ length: 33 }, (_, i) => `@f${i}.ts`).join(' ')))).rejects.toThrow(/more files than can be checked/)
    expect(calls()).toEqual([])
    setMode('allow')
    await expect(before(plugin, 'task', task(Array.from({ length: 32 }, (_, i) => `@f${i}.ts @f${i}.ts`).join(' ')))).resolves.toBeUndefined()
    expect(calls()).toHaveLength(32)
    // outside the project OpenCode would ask before a read, and nobody can be asked: refused before any guard; a bare @ names nothing
    rmSync(path.join(tmp, 'calls.jsonl'), { force: true })
    for (const m of ['@~/notes/plain.txt', '@../outside.txt', '@/etc/hosts']) {
      await expect(before(plugin, 'task', task(`Read ${m}, then reply @ me`)), m).rejects.toThrow(/lies outside the project/)
    }
    // a spelling OpenCode's reading may decode is refused unjudged
    for (const m of ['@%2e%2e/x.txt', '@src/%61pp.ts', '@..\\x.txt', '@.env#x', '@src/app.ts?x']) {
      await expect(before(plugin, 'task', task(`Read ${m}`)), m).rejects.toThrow(/is spelled with %/)
    }
    // the project's own guarded folders too
    await expect(before(plugin, 'task', task('Read @.claude/settings.json'))).rejects.toThrow(/or in such a folder within the project/)
    expect(calls()).toEqual([])
    // another shape (an extra key) never switches the mentions off
    rmSync(path.join(tmp, 'calls.jsonl'), { force: true })
    await expect(before(plugin, 'task', { ...task('context: @~/.codex/auth.json'), extra: 1 })).rejects.toThrow(/lies in a harness's home/)
    setMode('deny')
    await expect(before(plugin, 'task', { ...task('Use @.env'), extra: 1 })).rejects.toThrow('dethereal-secret-guard: secrets.yaml is a secret file.')
  })

  it('judges where a mention lands: a link out of the project is refused', async () => {
    setMode('allow')
    const outside = path.join(tmp, 'outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(outside, 'notes.txt'), 'x')
    symlinkSync(outside, path.join(project, 'linked'))
    try {
      await expect(before(plugin, 'task', { description: 'd', prompt: 'Read @linked/notes.txt', subagent_type: 'general' })).rejects.toThrow(/lies outside the project/)
      expect(calls()).toEqual([])
    } finally {
      rmSync(path.join(project, 'linked'), { force: true })
    }
  })

  it('reads a subtask with no command as the built-in shape, but not one missing a required field; a bare @ names nothing', async () => {
    setMode('deny')
    const prose = 'The Dethernety model at /home/u/proj; the server keeps ~/.dethernety; reply @ me'
    await expect(before(plugin, 'task', { description: 'd', prompt: prose, subagent_type: 'general', command: undefined })).resolves.toBeUndefined()
    expect(calls()).toEqual([])
    await expect(before(plugin, 'task', { description: 'd', prompt: prose, subagent_type: undefined })).rejects.toThrow(/does not know/)
  })

  it('resolves a mention from the root in a project that is no git checkout, as OpenCode does', async () => {
    setMode('allow')
    const hooks = await plugin({ directory: project, worktree: '/' })
    const task = (prompt: string) => hooks['tool.execute.before']!({ tool: 'task', sessionID: 's', callID: 'c' }, { args: { description: 'd', prompt, subagent_type: 'general' } })
    // OpenCode reads /src/app.ts there: outside the project
    await expect(task('Read @src/app.ts')).rejects.toThrow(/lies outside the project/)
    await expect(task(`Read @${path.join(project, 'src/app.ts')}`)).resolves.toBeUndefined()
    expect(calls().map((c) => (JSON.parse(c.stdin) as { args: unknown }).args)).toEqual([{ filePath: path.join(project, 'src/app.ts') }])
  })

  it('counts a guarded name in the project\'s own path for nothing', async () => {
    setMode('allow')
    const root = path.join(tmp, 'wt', '.claude', 'proj')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    const hooks = await plugin({ directory: path.join(root, 'sub'), worktree: root })
    await expect(hooks['tool.execute.before']!({ tool: 'task', sessionID: 's', callID: 'c' }, { args: { description: 'd', prompt: 'Read @src/app.ts', subagent_type: 'general' } })).resolves.toBeUndefined()
    expect(calls()).toHaveLength(1)
    // nor in its real path, when the project is opened through a link
    mkdirSync(path.join(root, 'src'), { recursive: true })
    writeFileSync(path.join(root, 'src', 'app.ts'), 'x')
    const link = path.join(tmp, 'wtlink')
    symlinkSync(root, link)
    try {
      const linked = await plugin({ directory: link, worktree: link })
      await expect(linked['tool.execute.before']!({ tool: 'task', sessionID: 's', callID: 'c' }, { args: { description: 'd', prompt: 'Read @src/app.ts', subagent_type: 'general' } })).resolves.toBeUndefined()
      expect(calls()).toHaveLength(2)
    } finally {
      rmSync(link, { force: true })
    }
  })

  it('resolves a mention from the project root, as OpenCode does, whatever the session folder', async () => {
    setMode('allow')
    const sub = path.join(project, 'sub')
    mkdirSync(sub, { recursive: true })
    const hooks = await plugin({ directory: sub, worktree: project })
    await expect(hooks['tool.execute.before']!({ tool: 'task', sessionID: 's', callID: 'c' }, { args: { description: 'd', prompt: 'Read @.env', subagent_type: 'general' } })).resolves.toBeUndefined()
    expect(calls().map((c) => (JSON.parse(c.stdin) as { args: unknown }).args)).toEqual([{ filePath: path.join(project, '.env') }])
  })

  it('skips the text-only built-ins only in their own shape; a tool of that name in another shape is judged whole', async () => {
    setMode('deny')
    const shaped: Array<[string, Record<string, unknown>]> = [
      ['todowrite', { todos: [{ content: '~/.dethernety/tokens.json beside /home/u/proj', status: 'pending' }] }],
      ['question', { questions: [{ question: 'Use ~/.dethernety/tokens.json beside /home/u/proj?' }] }],
      ['invalid', { tool: 'read', error: '~/.dethernety/tokens.json beside /home/u/proj' }],
      ['plan_exit', {}],
    ]
    for (const [tool, args] of shaped) await expect(before(plugin, tool, args), tool).resolves.toBeUndefined()
    expect(calls()).toEqual([])
    const other: Array<[string, Record<string, unknown>]> = [
      ['task', { prompt: 'x', target: '~/.dethernety/tokens.json' }],
      // a required key missing, or one key of the wrong kind, is another shape too
      ['task', { description: 'd', prompt: '~/.dethernety/tokens.json beside /home/u/proj' }],
      ['invalid', { tool: '~/.dethernety/tokens.json', error: 1 }],
      ['task', { description: 'd', prompt: 'x', subagent_type: 'general', path: '~/.dethernety/tokens.json' }],
      ['todowrite', { todos: '~/.dethernety/tokens.json' }],
      ['question', { questions: [], file: '~/.dethernety/tokens.json' }],
      ['invalid', { tool: 'read', error: 1, p: '~/.dethernety/tokens.json' }],
      ['plan_exit', { path: '~/.dethernety/tokens.json' }],
    ]
    for (const [tool, args] of other) await expect(before(plugin, tool, args), tool).rejects.toThrow(/does not know/)
    expect(calls()).toEqual([])
  })

  it('sends every file write to the config guard, with the fields it needs, and refuses what it denies', async () => {
    setMode('deny')
    await expect(before(plugin, 'write', { filePath: 'opencode.json', content: '{}' })).rejects.toThrow('dethereal-secret-guard: secrets.yaml is a secret file.')
    setMode('allow')
    await expect(before(plugin, 'edit', { filePath: 'a.ts', oldString: 'a', newString: 'b', replaceAll: false })).resolves.toBeUndefined()
    await expect(before(plugin, 'multiedit', { filePath: 'a.ts', edits: [{ oldString: 'a', newString: 'b' }] })).resolves.toBeUndefined()
    await expect(before(plugin, 'apply_patch', { patchText: '*** Begin Patch\n*** End Patch' })).resolves.toBeUndefined()
    const seen = calls()
    expect(seen.map((c) => c.argv)).toEqual(Array(4).fill(['hook', 'config-guard', '--harness', 'opencode']))
    expect(JSON.parse(seen[0]!.stdin)).toEqual({ tool: 'write', directory: project, args: { filePath: 'opencode.json', content: '{}' } })
    expect(JSON.parse(seen[1]!.stdin).args).toEqual({ filePath: 'a.ts', oldString: 'a', newString: 'b', replaceAll: false })
  })

  it.each([['garbage'], ['empty'], ['exit1'], ['signal'], ['flood']])('refuses read, grep and bash when the guard answers %s', async (mode) => {
    setMode(mode)
    for (const tool of ['read', 'grep', 'bash']) {
      await expect(before(plugin, tool, { filePath: 'a', command: 'ls' }), `${mode} ${tool}`).rejects.toThrow(/^dethereal-secret-guard: this call is not run: it could not be checked/)
    }
  })

  it('refuses read, grep and bash when the guard takes too long', async () => {
    setMode('hang')
    const started = Date.now()
    await Promise.all(['read', 'grep', 'bash'].map((tool) => expect(before(plugin, tool, { filePath: 'a', command: 'ls' })).rejects.toThrow(/took too long/)))
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 30_000)

  it('refuses read, grep and writes when there is no node to start the guard with', async () => {
    setMode('deny')
    await expect(before(missing, 'read', { filePath: 'a' })).rejects.toThrow(/could not be started/)
    await expect(before(missing, 'grep', { pattern: 'a' })).rejects.toThrow(/could not be started/)
    await expect(before(missing, 'write', { filePath: 'a.ts', content: 'x' })).rejects.toThrow(/could not be started/)
  })
})

describe('the OpenCode plugin: a shell command judged by name when the guard cannot be started', () => {
  const VARS = ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_DATA_HOME'] as const
  let saved: Record<string, string | undefined>
  let home: string

  beforeEach(() => {
    saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]))
    // A fake home: nothing in it is read, the names are only compared.
    home = path.join(tmp, 'home')
    process.env.HOME = home
    for (const v of VARS.slice(1)) delete process.env[v]
  })
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
  })

  const runs = (args: Record<string, unknown>) => expect(before(missing, 'bash', args)).resolves.toBeUndefined()
  const refused = (args: Record<string, unknown>) => expect(before(missing, 'bash', args)).rejects.toThrow(/could not be started/)

  it('refuses the harnesses\' sign-ins, secret files, guarded configuration and the server folder', async () => {
    await refused({ command: 'cat ~/.claude/.credentials.json' })
    await refused({ command: 'cat ~/.codex/auth.json' })
    await refused({ command: 'cat deploy/secrets.yaml' })
    await refused({ command: 'cat .env' })
    await refused({ command: 'cat ~/.config/opencode/opencode.json' })
    await refused({ command: 'cp x ~/.claude/settings.json' })
    await refused({ command: 'ls ~/.claude/plugins/cache' })
    await refused({ command: 'cat ~/.dethernety/tokens.json' })
    await refused({ command: "cat ~/'.dether'nety/x" })
  })

  it('reads the homes the environment names, as Codex\'s fallback does', async () => {
    process.env.CODEX_HOME = path.join(tmp, 'codex-home')
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config')
    await refused({ command: 'cat "$CODEX_HOME/auth.json"' })
    await refused({ command: 'cat ${CODEX_HOME}/config.toml' })
    await refused({ command: 'ls $CLAUDE_CONFIG_DIR/plugins' })
    await refused({ command: `cat ${path.join(tmp, 'claude-config', 'settings.json')}` })
  })

  it('refuses a working folder in a harness\'s home or the server folder, however it is spelled', async () => {
    await refused({ command: 'cat auth.json', workdir: '~/.codex' })
    await refused({ command: 'cat auth.json', workdir: '$HOME/.codex' })
    await refused({ command: 'cat .credentials.json', workdir: path.join(home, '.Claude') })
    await refused({ command: 'ls', workdir: path.join(home, '.local', 'share', 'opencode') })
    await refused({ command: 'ls', workdir: '~/.dethernety' })
    await refused({ command: 'ls', workdir: path.join(project, '..', 'home', '.codex', 'sessions') })
    process.env.CODEX_HOME = path.join(tmp, 'codex-home')
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config')
    process.env.XDG_DATA_HOME = path.join(tmp, 'data')
    await refused({ command: 'ls', workdir: path.join(tmp, 'codex-home') })
    await refused({ command: 'ls', workdir: path.join(tmp, 'claude-config', 'x') })
    await refused({ command: 'ls', workdir: path.join(tmp, 'data', 'opencode') })
  })

  it('judges the session folder when the command names no working folder', async () => {
    const inHome = path.join(home, '.codex')
    await expect((await missing({ directory: inHome }))['tool.execute.before']!({ tool: 'bash' }, { args: { command: 'cat auth.json' } })).rejects.toThrow(/could not be started/)
    await runs({ command: 'cat auth.json' })
  })

  it('lets every other command run, in the project or elsewhere', async () => {
    await runs({ command: 'ls' })
    await runs({ command: 'git status' })
    await runs({ command: 'cat .env.example' })
    await runs({ command: 'cat README.md', workdir: project })
    await runs({ command: 'ls', workdir: path.join(home, '.codexes') })
    await runs({ command: 'ls', workdir: path.join(home, 'src') })
    // A relative CLAUDE_CONFIG_DIR is not a home the fallback reads.
    process.env.CLAUDE_CONFIG_DIR = 'claude-config'
    await runs({ command: 'ls', workdir: path.join(project, 'claude-config') })
  })

  it('refuses at least what Codex\'s fallback refuses by name, and lets plain commands run', async () => {
    process.env.CODEX_HOME = path.join(tmp, 'codex-home')
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config')
    process.env.XDG_DATA_HOME = path.join(tmp, 'xdg-data')
    // OpenCode's own sign-ins: in its default data folder and the one XDG_DATA_HOME names, which the plugin's own checks
    // also refuse, and in folders only the names written into it reach (a relative one, another data folder).
    const signIns = [
      'cat ~/.local/share/opencode/auth.json', 'cat ~/.local/share/opencode/mcp-auth.json',
      'cat $XDG_DATA_HOME/opencode/auth.json', 'cat "$XDG_DATA_HOME"/opencode/mcp-auth.json',
      `cat ${path.join(tmp, 'xdg-data', 'opencode', 'auth.json')}`, `cat ${path.join(tmp, 'xdg-data', 'opencode', 'mcp-auth.json')}`,
      'cat opencode/auth.json', `cat ${path.join(tmp, 'mnt', 'opencode', 'mcp-auth.json')}`,
    ]
    const commands = [
      ...signIns, 'ls', 'git log -3', 'cat a.txt', 'cat id_rsa', 'cat ~/.aws/credentials', 'cat x.tfvars', 'cat x.env.sample',
      'cat ~/.codex/config.toml', 'ls .codex/plugins', 'cat opencode.jsonc', 'cat ~/.claude.json',
      'echo $CODEX_HOME/auth.json', 'echo ${UNSET:-.claude/settings.local.json}', 'cat ~/.dethernety/x',
      'cat "$HOME"/.codex/auth.json', 'cat ${CODEX_HOME:-x}/auth.json', 'ls $CLAUDE_CONFIG_DIR/skills',
      `cat ${path.join(tmp, 'claude-config', 'settings.local.json')}`,
    ]
    const { codexHome, claudeConfig, vars } = fallback.guardedHomes(process.env, home)
    const refusedNow = async (command: string) => before(missing, 'bash', { command }).then(() => false, (e: Error) => {
      if (!/could not be started/.test(e.message)) throw e
      return true
    })
    const codexRefuses = commands.filter((command) => fallback.commandNamesGuarded(command, codexHome, claudeConfig, vars))
    // The comparison means something only while Codex's check refuses most of them.
    expect(codexRefuses.length).toBeGreaterThanOrEqual(22)
    expect(codexRefuses).toEqual(expect.arrayContaining(signIns))
    for (const command of codexRefuses) expect({ command, refused: await refusedNow(command) }).toEqual({ command, refused: true })
    for (const command of ['ls', 'git log -3', 'cat a.txt', 'cat x.env.sample', 'npm test', 'cat src/claude.ts']) {
      expect({ command, refused: await refusedNow(command) }).toEqual({ command, refused: false })
    }
  })

  it('refuses a path named inside a guarded folder, however the command reaches it', async () => {
    process.env.CODEX_HOME = path.join(tmp, 'codex-home')
    await refused({ command: 'cd ~/.codex && cat auth.json' })
    await refused({ command: 'cat ~/.claude/.cred*' })
    await refused({ command: 'cat ~/.local/share/opencode/auth.json' })
    await refused({ command: 'ln -s ~/.codex /tmp/c; cat /tmp/c/auth.json' })
    await refused({ command: 'D=~/.codex; cat $D/auth.json' })
    await refused({ command: `cat ${path.join(tmp, 'codex-home', 'sessions', 'x.jsonl')}` })
    await refused({ command: 'cat sessions/x.jsonl', workdir: path.join(tmp, 'codex-home') })
    await refused({ command: 'cat ../.codex/auth.json', workdir: path.join(home, 'src') })
    await refused({ command: 'cd .codex; cat auth.json', workdir: home })
  })

  it('refuses a guarded folder\'s name as a path segment anywhere, the project included', async () => {
    await refused({ command: 'cat /elsewhere/.codex/x' })
    await refused({ command: 'ls', workdir: '/elsewhere/.codex' })
    await refused({ command: 'cat .claude/CLAUDE.md' })
    await refused({ command: 'ls /mnt/u/.local/share/opencode' })
    await runs({ command: 'cat docs/claude.md' })
  })

  it('writes $HOME out before reading the words, and reads them normalised', async () => {
    await refused({ command: 'cat $HOME/.local//share/opencode/auth.json' })
    await refused({ command: 'cat "$HOME"/.local/./share/opencode/auth.json' })
    await refused({ command: 'cat ${HOME}/.local/x/../share/opencode/auth.json' })
    await runs({ command: 'echo $HOME' })
  })

  it('refuses a folder that holds a guarded one, below the home', async () => {
    process.env.CODEX_HOME = path.join(tmp, 'srv', 'codex')
    process.env.XDG_DATA_HOME = path.join(tmp, 'xdg')
    await refused({ command: 'cd ~/.local/share && cat opencode/auth.json' })
    await refused({ command: 'cd ~/.local; cat share/opencode/auth.json' })
    await refused({ command: 'cd $HOME/.local/share && cat opencode/auth.json' })
    await refused({ command: 'cd "${HOME}/.local" && cat share/opencode/auth.json' })
    await refused({ command: 'ln -s ~/.local/share /tmp/s; cat /tmp/s/opencode/auth.json' })
    await refused({ command: `cd ${path.join(tmp, 'srv')} && cat codex/auth.json` })
    await refused({ command: `cd ${path.join(tmp, 'xdg')}; cat opencode/auth.json` })
    await runs({ command: 'ls ~/.local/bin' })
    await runs({ command: 'cd ~ && ls src' })
  })

  it('reads $HOME as the home even when the home\'s own path holds a blank', async () => {
    process.env.HOME = path.join(tmp, 'john doe')
    await refused({ command: 'cd "$HOME/.local/share" && cat opencode/auth.json' })
    await refused({ command: 'cd $HOME/.local/share && cat opencode/auth.json' })
    process.env.CODEX_HOME = path.join(tmp, 'john doe', 'work', 'codex')
    await refused({ command: 'cd "$HOME/work" && cat codex/auth.json' })
  })

  it('reads a word that ends where $HOME begins as it is written too', async () => {
    await refused({ command: `cd ~ && cat .codex$HOME/${'../'.repeat(8)}auth.json` })
    await refused({ command: `cd ~ && cd .local$HOME/${'../'.repeat(8)}share && cat opencode/auth.json` })
  })

  it('refuses the parts of OpenCode\'s data folder that reach it in steps', async () => {
    await refused({ command: 'cd ~ && cd .local/share && cat opencode/auth.json' })
    await refused({ command: 'cd && cd .local && cat share/opencode/auth.json' })
    await refused({ command: 'cat opencode/auth.json', workdir: '.local/share' })
    await runs({ command: 'ls local/share' })
  })

  it('refuses a run of slashes unjudged, which the name check is slow on', async () => {
    await refused({ command: `ls ${'/'.repeat(64)}x` })
    await refused({ command: 'ls', workdir: `${'\\'.repeat(64)}x` })
    await refused({ command: `ls ${'/'.repeat(40)}""${'/'.repeat(40)}x` })
    await runs({ command: 'ls ///x' })
  })

  it('refuses a glob or a brace beside a home spelling', async () => {
    for (const command of ['cat ~/.{codex,x}/auth.json', 'cat ~/.dether{nety,x}/tokens.json', 'cat ~/.cod?x/auth.json', 'cat ~/.cl*/.cred*',
      'cat ~/.[c]odex/auth.json', 'cat $HOME/.cod*/auth.json', `cat ${home}/.cod*/auth.json`]) await refused({ command })
    await runs({ command: 'ls src/*.ts' })
    await runs({ command: 'cat a{1,2}.txt' })
  })

  it('refuses a glob or a brace from the home or a folder above it, however it was reached', async () => {
    await refused({ command: 'cat .cod?x/auth.json', workdir: home })
    await refused({ command: 'cd && cat .cod[e]x/auth.json' })
    await refused({ command: 'cd - ; cat .cl*/.cred*' })
    await refused({ command: 'cd .. && cat .cod?x/auth.json', workdir: path.join(home, 'proj') })
    await refused({ command: `ls ${path.dirname(home)}/*/.codex` })
    // Any change of folder, however spelled, with a glob: the folder it lands in is not known by name.
    for (const command of ['cd\ncat .cod?x/auth.json', 'cd -- && cat .cod?x/auth.json', 'cd -P && cat .cod?x/auth.json', '\\cd && cat .cod?x/auth.json',
      '"cd" && cat .cod?x/auth.json', 'cd >/dev/null && cat .cod?x/auth.json', 'cd src && ls *.ts', 'popd; cat .cl*/x']) await refused({ command })
    // A glob's fixed part above the home, or a climb to it.
    await refused({ command: `cat ${path.dirname(home)}/h*e/.cod?x/auth.json` })
    await refused({ command: `cat /${path.dirname(home).split('/')[1]!.slice(0, 1)}*/.cod?x/auth.json` })
    await refused({ command: 'cat ../.cod?x/auth.json', workdir: path.join(home, 'proj') })
    // A climb after a glob, or a glob an older shell matches to `..`.
    for (const command of ['cat */../../.cod?x/config.toml', 'cat s[r]c/../../.cl?ude/settings.json', 'cat src/*/../../../.cod?x/config.toml',
      "cat ''*/../../.cod?x/f", 'cat */.\\./../.cod?x/f', 'ls .?/.cod?x', 'ls .[.]/.cod?x', 'ls .*/.*/.cod?x']) {
      await refused({ command, workdir: path.join(home, 'proj') })
    }
    await runs({ command: 'cat src/*/../lib/*.ts', workdir: path.join(home, 'proj') })
    await runs({ command: 'ls src/*.ts', workdir: path.join(home, 'proj') })
    await runs({ command: 'cat ../lib/*.ts', workdir: path.join(home, 'proj', 'app') })
    await runs({ command: 'cdx *.ts' })
  })

  it('reads a path in the session folder by its place there, whatever the folder\'s own path holds', async () => {
    const dir = path.join(tmp, 'repo', '.claude', 'worktrees', 'x')
    const inWorktree = (args: Record<string, unknown>) => missing({ directory: dir }).then((h) => h['tool.execute.before']!({ tool: 'bash' }, { args }))
    await expect(inWorktree({ command: 'git status', workdir: dir })).resolves.toBeUndefined()
    await expect(inWorktree({ command: `cat ${path.join(dir, 'src', 'a.ts')}` })).resolves.toBeUndefined()
    await expect(inWorktree({ command: `cat ${path.join(dir, '.claude', 'settings.json')}` })).rejects.toThrow(/could not be started/)
    await expect(inWorktree({ command: 'cat .codex/x' })).rejects.toThrow(/could not be started/)
    // A climb out of the session folder lands in the project's own `.claude`, though it names no segment.
    await expect(inWorktree({ command: 'cat ../../settings.json' })).rejects.toThrow(/could not be started/)
    await expect(inWorktree({ command: 'cat settings.json', workdir: '../..' })).rejects.toThrow(/could not be started/)
    // The session folder as OpenCode may spell it, with a trailing separator.
    const h = await missing({ directory: `${dir}/` })
    await expect(h['tool.execute.before']!({ tool: 'bash' }, { args: { command: 'ls src' } })).resolves.toBeUndefined()
  })

  it('compares the session folder\'s path in lower case throughout, whatever its letters', async () => {
    // U+0130 lower-cases to two code units; the session folder spells it decomposed.
    const dir = path.join(tmp, 'u', 'ri\u0307po')
    const h = await missing({ directory: dir })
    await expect(h['tool.execute.before']!({ tool: 'bash' }, { args: { command: `cat ${path.join(tmp, 'u', 'r\u0130po', '.codex', 'x')}` } })).rejects.toThrow(/could not be started/)
  })

  it('refuses any command when the session folder lies in a guarded folder', async () => {
    const inHome = await missing({ directory: path.join(home, '.claude', 'x') })
    await expect(inHome['tool.execute.before']!({ tool: 'bash' }, { args: { command: '/bin/ls' } })).rejects.toThrow(/could not be started/)
  })

  it('refuses a variable naming a guarded folder, set or not', async () => {
    await refused({ command: 'cd $CODEX_HOME && cat auth.json' })
    await refused({ command: 'ls ${CLAUDE_CONFIG_DIR}' })
    await refused({ command: 'ls $XDG_DATA_HOME/opencode' })
    await refused({ command: 'cat auth.json', workdir: '$CODEX_HOME' })
    await runs({ command: 'echo $CODEX_HOMES' })
  })

  it('refuses a call it cannot judge: no command text, a working folder that is not text, or a very long command', async () => {
    await refused({})
    await refused({ command: ['cat', '~/.codex/auth.json'] })
    await refused({ command: 'cat auth.json', workdir: 5 })
    await refused({ command: `echo ${'a'.repeat(8 * 1024)}` })
    await refused({ command: 'ls', workdir: 'a'.repeat(8 * 1024) })
    await runs({ command: `echo ${'a'.repeat(1024)}` })
    await runs({ command: 'ls', workdir: null })
  })

  it('takes no folder that reads as the root, or a relative home, as guarded', async () => {
    process.env.CODEX_HOME = '/'
    process.env.CLAUDE_CONFIG_DIR = '/'
    await runs({ command: 'ls' })
    await runs({ command: 'git status', workdir: project })
    process.env.CODEX_HOME = '.'
    await runs({ command: 'ls' })
  })
})

describe('the OpenCode plugin: the by-name judgement written into it', () => {
  const MODULE = readFileSync(new URL('../../utils/secret-fallback.mjs', import.meta.url), 'utf8')
  const TEMPLATE = readFileSync(new URL('../targets/opencode/plugin.ts', import.meta.url), 'utf8')

  it('carries secret-fallback.mjs verbatim, its exports dropped, and imports nothing but node builtins', () => {
    expect(TEMPLATE.split(FALLBACK_IMPORT)).toHaveLength(2)
    const source = pluginSource()
    expect(source).not.toContain(FALLBACK_IMPORT)
    const body = MODULE.split('\n').filter((l) => !/^import /.test(l)).map((l) => l.replace(/^export /, '')).join('\n')
    expect(source).toContain(body)
    expect(source.split('\n').filter((l) => /^import /.test(l)).every((l) => / from 'node:[a-z_/]+'$/.test(l))).toBe(true)
    expect(source.split('\n').filter((l) => /^export /.test(l))).toHaveLength(1)
  })

  it('refuses a module it cannot carry', () => {
    const ok = "import path from 'node:path'\nexport function guardedHomes() {}\nexport function commandNamesGuarded() {}\nexport const commandWords = () => []\n"
    expect(() => inlineFallback(TEMPLATE, ok)).not.toThrow()
    expect(() => inlineFallback(TEMPLATE, `import x from './x.mjs'\n${ok}`)).toThrow(/may import only node:path/)
    expect(() => inlineFallback(TEMPLATE, `import {\n  a,\n} from 'node:fs'\n${ok}`)).toThrow(/may import only node:path/)
    for (const load of ["await import('node:fs')", "import/**/('x')", 'import.meta.url', "require ('fs')", "createRequire(x)", "process.getBuiltinModule('node:fs')",
      "eval ('1')", "new Function('x')", "process.binding('fs')", 'Bun.file(x)', '// see import(x)']) {
      expect(() => inlineFallback(TEMPLATE, `${ok}const m = ${load}\n`), load).toThrow(/at run time/)
    }
    // Words, not calls: a comment may say what a function requires or which function it calls.
    expect(() => inlineFallback(TEMPLATE, `${ok}const m = import // a comment\n('node:fs')\n`)).toThrow(/at run time/)
    expect(() => inlineFallback(TEMPLATE, `${ok}// it requires a path; the import function reads it; a function (x) of Bundle\n`)).not.toThrow()
    expect(() => inlineFallback(TEMPLATE, `${ok}const s = '"<node-abs>"'\n`)).toThrow(/placeholder/)
    expect(() => inlineFallback(TEMPLATE, ok.replace(/\n/g, '\r\n'))).not.toThrow()
    expect(inlineFallback(TEMPLATE, ok.replace(/\n/g, '\r\n'))).not.toContain('\r')
    expect(() => inlineFallback(TEMPLATE, `${ok}export default 1\n`)).toThrow(/cannot carry/)
    expect(() => inlineFallback(TEMPLATE, `${ok}export { guardedHomes as g }\n`)).toThrow(/cannot carry/)
    expect(() => inlineFallback(TEMPLATE, ok.replace('commandNamesGuarded', 'other'))).toThrow(/does not export commandNamesGuarded/)
    // Every name the plugin calls on `fallback` counts, read from the plugin itself.
    expect(() => inlineFallback(TEMPLATE, ok.replace('commandWords', 'words'))).toThrow(/does not export commandWords/)
    // An import the plugin makes, line for line, is not repeated; any other builtin than four is refused.
    expect(inlineFallback(TEMPLATE, `import { homedir } from 'node:os'\n${ok}`).split("import { homedir } from 'node:os'")).toHaveLength(2)
    expect(() => inlineFallback(TEMPLATE, `import { inspect } from 'node:util'\nimport { fileURLToPath } from 'node:url'\n${ok}`)).not.toThrow()
    for (const mod of ['node:child_process', 'node:vm', 'node:worker_threads', 'node:module', 'node:fs', 'node:net']) {
      expect(() => inlineFallback(TEMPLATE, `import x from '${mod}'\n${ok}`), mod).toThrow(/may import only node:path/)
    }
    expect(() => inlineFallback(TEMPLATE, `import { tmpdir as spawn } from 'node:os'\n${ok}`)).toThrow(/already binds/)
    expect(() => inlineFallback(TEMPLATE, `import * as fallback from 'node:util'\n${ok}`)).toThrow(/already binds/)
    expect(() => inlineFallback(TEMPLATE, `import { tmpdir as run } from 'node:os'\n${ok}`)).toThrow(/imports run, which/)
    expect(() => inlineFallback(TEMPLATE, `import { constants as ALLOW } from 'node:os'\n${ok}`)).toThrow(/imports ALLOW, which/)
    expect(() => inlineFallback(TEMPLATE.replace(FALLBACK_IMPORT, ''), ok)).toThrow(/exactly once/)
  })
})

describe('the OpenCode plugin: after a write, and before a compaction', () => {
  const after = async (tool: string, args: Record<string, unknown>, metadata: unknown = {}) => {
    const output: Record<string, unknown> = { title: 't', output: 'Wrote file successfully.', metadata }
    await (await plugin({ directory: project }))['tool.execute.after']!({ tool, sessionID: 's', callID: 'c', args }, output)
    return output
  }

  it('appends the hint to the output, sending the paths and never the content', async () => {
    setMode('Validate threat model "orders" with dethereal_validate_model_json.')
    const out = await after('write', { filePath: path.join(project, 'm/manifest.json'), content: 'SECRET-CONTENT' })
    expect(out.output).toBe('Wrote file successfully.\n\nValidate threat model "orders" with dethereal_validate_model_json.')
    const [call] = calls()
    expect(call!.argv).toEqual(['hook', 'post-write', '--harness', 'opencode'])
    expect(call!.stdin).not.toContain('SECRET-CONTENT')
    expect(JSON.parse(call!.stdin)).toEqual({ tool: 'write', directory: project, args: { filePath: path.join(project, 'm/manifest.json') } })
  })

  it('sends the files of a patch without their diffs, and covers multiedit', async () => {
    setMode('')
    await after('apply_patch', { patchText: '*** Begin Patch\n*** Add File: a.json\n' }, { files: [{ filePath: '/p/a.json', movePath: '/p/b.json', patch: 'DIFF' }] })
    await after('multiedit', { filePath: '/p/c.json', edits: [] })
    const [patch, multi] = calls().map((c) => JSON.parse(c.stdin) as Record<string, unknown>)
    expect(patch).toEqual({ tool: 'apply_patch', directory: project, args: { patchText: '*** Begin Patch\n*** Add File: a.json\n' }, metadata: { files: [{ filePath: '/p/a.json', movePath: '/p/b.json' }] } })
    expect(multi).toEqual({ tool: 'multiedit', directory: project, args: { filePath: '/p/c.json' } })
  })

  it('leaves the output alone when there is no hint, the hook fails, or the tool writes nothing', async () => {
    setMode('')
    expect((await after('edit', { filePath: '/p/x' })).output).toBe('Wrote file successfully.')
    setMode('exit1')
    expect((await after('edit', { filePath: '/p/x' })).output).toBe('Wrote file successfully.')
    setMode('hint')
    expect((await after('read', { filePath: '/p/x' })).output).toBe('Wrote file successfully.')
    expect(calls()).toHaveLength(2)
  })

  it('adds the workspace state to the compaction summary\'s context', async () => {
    setMode('Threat model "orders": 3 files changed since the last validation.')
    const output = { context: ['earlier'] as string[] }
    await (await plugin({ directory: project }))['experimental.session.compacting']!({ sessionID: 's' }, output)
    expect(output.context).toHaveLength(2)
    expect(output.context[0]).toBe('earlier')
    expect(output.context[1]).toMatch(/^Copy the block below verbatim at the end of the summary[^\n]*\n\nThreat model "orders": 3 files changed since the last validation\.$/)
    expect(calls()[0]!.argv).toEqual(['hook', 'session-start', '--source', 'compact', '--harness', 'opencode'])
    setMode('exit1')
    await (await plugin({ directory: project }))['experimental.session.compacting']!({ sessionID: 's' }, output)
    expect(output.context).toHaveLength(2)
  })

  it('starts its hooks with the install URL as a default, which a DETHERNETY_URL in the environment overrides', async () => {
    const installed = await load('installed', process.execPath, path.join(tmp, 'stub.mjs'), fillPlugin(pluginSource(), process.execPath, path.join(tmp, 'stub.mjs'), 'https://install.example.test'))
    const saved = { url: process.env.DETHERNETY_URL, platform: process.env.DETHERNETY_PLATFORM_URL }
    try {
      setMode('state')
      delete process.env.DETHERNETY_URL
      process.env.DETHERNETY_PLATFORM_URL = 'https://elsewhere.example.test'
      await (await installed({ directory: project }))['experimental.session.compacting']!({ sessionID: 's' }, { context: [] })
      process.env.DETHERNETY_URL = 'https://shell.example.test'
      await (await installed({ directory: project }))['experimental.session.compacting']!({ sessionID: 's' }, { context: [] })
      expect(calls().map((c) => c.url)).toEqual([
        { DETHERNETY_URL: null, DETHERNETY_PLATFORM_URL: 'https://install.example.test' },
        { DETHERNETY_URL: 'https://shell.example.test', DETHERNETY_PLATFORM_URL: 'https://install.example.test' },
      ])
    } finally {
      for (const [k, v] of [['DETHERNETY_URL', saved.url], ['DETHERNETY_PLATFORM_URL', saved.platform]] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

describe('the OpenCode plugin: the configuration OpenCode builds', () => {
  it('sets the asking tools and the server-folder denies last, over any later layer', async () => {
    const hooks = await plugin({ directory: project })
    const config: Record<string, unknown> = {
      permission: { dethereal_model_state_waive: 'allow', external_directory: { '~/.dethernety/*': 'allow', '/tmp/*': 'allow' }, edit: 'ask' },
      agent: { explore: { permission: { 'dethereal_*': 'allow', read: 'allow' } }, build: { model: 'x' } },
    }
    await hooks.config!(config as never, {} as never)
    const permission = config.permission as Record<string, unknown>
    expect(permission.dethereal_model_state_waive).toBe('ask')
    expect(Object.keys(permission).indexOf('dethereal_model_state_waive')).toBeGreaterThan(Object.keys(permission).indexOf('edit'))
    expect(permission.edit).toBe('ask')
    const external = permission.external_directory as Record<string, string>
    expect(Object.entries(external).slice(-2)).toEqual([['~/.dethernety', 'deny'], ['~/.dethernety/*', 'deny']])
    expect(external['/tmp/*']).toBe('allow')
    const agents = config.agent as Record<string, { permission?: Record<string, string>; model?: string }>
    expect(agents.explore!.permission).toEqual({ read: 'allow', 'dethereal_*': 'deny' })
    expect(agents.build!.model).toBe('x')
  })

  // OpenCode's rule list from a permission block, in key order: a word is one rule for every pattern.
  const rulesOf = (permission: Record<string, unknown>): Rule[] =>
    Object.entries(permission).flatMap(([key, value]) =>
      typeof value === 'string' ? [{ permission: key, pattern: '*', action: value }] : Object.entries(value as Record<string, string>).map(([pattern, action]) => ({ permission: key, pattern: expandHome(pattern, '/home/u'), action })),
    )

  it.each(['allow', 'ask'])('keeps the server-folder denies after a later layer\'s "*": "%s"', async (action) => {
    const hooks = await plugin({ directory: project })
    // The installer's file names external_directory first; a later layer adds "*" after it.
    const config: Record<string, unknown> = { permission: { external_directory: { '/tmp/*': 'allow' }, edit: 'ask', '*': action } }
    await hooks.config!(config as never, {} as never)
    const permission = config.permission as Record<string, unknown>
    const keys = Object.keys(permission)
    expect(keys.at(-1)).toBe('external_directory')
    expect(keys.indexOf('external_directory')).toBeGreaterThan(keys.indexOf('*'))
    const rules = rulesOf(permission)
    expect(lastMatch(rules, 'external_directory', '/home/u/.dethernety/tokens.json')).toBe('deny')
    expect(lastMatch(rules, 'external_directory', '/home/u/.dethernety')).toBe('deny')
    // The block moves as a whole: its own folder rules now come after "*" too; other tools keep "*".
    expect(lastMatch(rules, 'external_directory', '/tmp/x')).toBe('allow')
    expect(lastMatch(rules, 'external_directory', '/elsewhere/x')).toBe(action)
    expect(lastMatch(rules, 'edit', 'x')).toBe(action)
  })

  it('turns a permission given as one word into rules with ours after it', async () => {
    const hooks = await plugin({ directory: project })
    const config: Record<string, unknown> = { permission: 'allow' }
    await hooks.config!(config as never, {} as never)
    const permission = config.permission as Record<string, unknown>
    expect(Object.keys(permission)[0]).toBe('*')
    expect(permission['*']).toBe('allow')
    expect(permission.dethereal_model_state_waive).toBe('ask')
  })
})

