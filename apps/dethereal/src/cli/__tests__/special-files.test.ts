/**
 * The guards against a FIFO, a socket or a directory where they read a project file. A plain open of
 * a FIFO blocks in the kernel, where no deadline and no test timeout can reach it, so every decision
 * here runs in a child process with a time limit: a guard that blocks fails the test instead of
 * hanging the run. Everything is made inside a temporary project.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx')
/** Each decision must come back well inside the guard's own 6 s deadline. */
const PROMPT_MS = 2000

type Verdict = { deny: boolean; reason?: string; ms: number }
type Case = { name: string; harness: 'claude' | 'opencode' | 'codex' | 'config'; tool: string; input: Record<string, unknown> }

/** Runs each case's decision in one child process and returns the verdicts by name. */
function decideAll(cases: readonly Case[], project: string, home: string): Record<string, Verdict> {
  const script = path.join(path.dirname(project), 'decide.mts')
  writeFileSync(script, `
import { decideConfigWrite, processGuardEnv, rawEventFrom } from ${JSON.stringify(pathToFileURL(path.join(PKG, 'src/cli/config-guard.ts')).href)}
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess } from ${JSON.stringify(pathToFileURL(path.join(PKG, 'src/cli/secret-guard.ts')).href)}
const [project, home, casesJson] = process.argv.slice(2)
const g = { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: process.platform, now: Date.now }
const out = {}
for (const c of JSON.parse(casesJson)) {
  const claude = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: c.tool, tool_input: c.input, cwd: project })
  const t0 = Date.now()
  const d =
    c.harness === 'claude' ? decideSecretAccess(rawEventFrom(claude), g)
    : c.harness === 'opencode' ? decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: c.tool, directory: project, args: c.input })), g)
    : c.harness === 'codex' ? decideCodexAccess(rawEventFrom(JSON.stringify({ session_id: 's', turn_id: 't', cwd: project, hook_event_name: 'PreToolUse', model: 'm', permission_mode: 'default', tool_name: c.tool, tool_input: c.input, tool_use_id: 'u' })), g)
    : decideConfigWrite(rawEventFrom(claude), { ...processGuardEnv(), home, cwd: project })
  out[c.name] = { deny: d.deny, reason: d.deny ? d.reason : undefined, ms: Date.now() - t0 }
}
process.stdout.write(JSON.stringify(out))
`)
  const r = spawnSync(TSX, [script, project, home, JSON.stringify(cases)], { cwd: PKG, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL' })
  expect(r.error, 'the guard did not answer within 20 s').toBeUndefined()
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as Record<string, Verdict>
}

/** Every harness's shell call and file read for the same command and file. */
const everywhere = (name: string, command: string, file?: string): Case[] => [
  { name: `${name}/claude-bash`, harness: 'claude', tool: 'Bash', input: { command } },
  { name: `${name}/opencode-bash`, harness: 'opencode', tool: 'bash', input: { command } },
  { name: `${name}/codex-bash`, harness: 'codex', tool: 'Bash', input: { command } },
  ...(file
    ? [
        { name: `${name}/claude-read`, harness: 'claude', tool: 'Read', input: { file_path: file } } as Case,
        { name: `${name}/opencode-read`, harness: 'opencode', tool: 'read', input: { filePath: file } } as Case,
      ]
    : []),
]

let tmp: string
let project: string
let home: string
let socket: net.Server | null = null

function file(rel: string, content: string): string {
  const f = path.join(project, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, content)
  return f
}

function fifo(rel: string): string {
  const f = path.join(project, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  const r = spawnSync('mkfifo', [f])
  expect(r.status, 'mkfifo').toBe(0)
  return f
}

beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dg-special-')))
  project = path.join(tmp, 'p')
  home = path.join(tmp, 'h')
  mkdirSync(home, { recursive: true })
  mkdirSync(path.join(project, '.git'), { recursive: true })
  // A secret source a kustomization names, and the FIFO operand of the repro.
  file('k8s/kustomization.yaml', 'secretGenerator:\n- name: db\n  files:\n  - db-password.txt\n')
  file('k8s/db-password.txt', 'hunter2\n')
  fifo('trap.json')
  // A FIFO where a kustomization would name the sources of the files below it.
  fifo('svc/kustomization.yaml')
  file('svc/app.txt', 'plain\n')
  mkdirSync(path.join(project, 'folder.yaml'))
  file('plain.json', '{"a":1}\n')
  // A socket with a content extension (the temporary path stays short enough for one).
  socket = await new Promise<net.Server | null>((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(null))
    s.listen(path.join(project, 's.json'), () => resolve(s))
  })
})

afterAll(async () => {
  if (socket) await new Promise<void>((resolve) => socket!.close(() => resolve()))
  rmSync(tmp, { recursive: true, force: true })
})

describe('the guards never block on a FIFO, a socket or a device', () => {
  it('denies, promptly, a call that names a FIFO with a content extension, on every harness', () => {
    const trap = path.join(project, 'trap.json')
    const cases = [
      // The reported bypass: the FIFO operand first, then the secret source.
      ...everywhere('repro', 'test -e trap.json; cat k8s/db-password.txt'),
      ...everywhere('fifo', 'cat trap.json', trap),
    ]
    const v = decideAll(cases, project, home)
    for (const c of cases) {
      expect(v[c.name], c.name).toMatchObject({ deny: true })
      expect(v[c.name]!.ms, c.name).toBeLessThan(PROMPT_MS)
    }
    expect(v['fifo/claude-read']!.reason).toMatch(/cannot be checked|not a regular file|cannot/i)
  })

  it('denies, promptly, a file below a kustomization that is a FIFO, which may name it as a secret source', () => {
    const cases = everywhere('kustomization', 'cat svc/app.txt', path.join(project, 'svc/app.txt'))
    const v = decideAll(cases, project, home)
    for (const c of cases) {
      expect(v[c.name], c.name).toMatchObject({ deny: true })
      expect(v[c.name]!.ms, c.name).toBeLessThan(PROMPT_MS)
    }
  })

  it('denies, promptly, a socket with a content extension', () => {
    expect(socket, 'a socket could not be made in the temporary project').not.toBeNull()
    const cases = everywhere('socket', 'cat s.json', path.join(project, 's.json'))
    const v = decideAll(cases, project, home)
    for (const c of cases) {
      expect(v[c.name], c.name).toMatchObject({ deny: true })
      expect(v[c.name]!.ms, c.name).toBeLessThan(PROMPT_MS)
    }
  })

  it('still answers, and still denies a secret, when the model registry is a FIFO', () => {
    fifo('.dethernety/models.json')
    try {
      const cases = [...everywhere('registry-secret', 'cat k8s/db-password.txt'), ...everywhere('registry-plain', 'cat plain.json', path.join(project, 'plain.json'))]
      const v = decideAll(cases, project, home)
      for (const c of cases) {
        expect(v[c.name], c.name).toMatchObject({ deny: c.name.startsWith('registry-secret') })
        expect(v[c.name]!.ms, c.name).toBeLessThan(PROMPT_MS)
      }
    } finally {
      rmSync(path.join(project, '.dethernety'), { recursive: true, force: true })
    }
  })

  it('lets a directory with a content extension through, as before', () => {
    const cases = everywhere('directory', 'ls folder.yaml')
    const v = decideAll(cases, project, home)
    for (const c of cases) expect(v[c.name], c.name).toMatchObject({ deny: false })
  })

  it('denies, promptly, a write to a guarded configuration file that is a FIFO', () => {
    const settings = fifo('.claude/settings.local.json')
    try {
      const v = decideAll([{ name: 'config', harness: 'config', tool: 'Write', input: { file_path: settings, content: '{}' } }], project, home)
      expect(v.config).toMatchObject({ deny: true })
      expect(v.config!.ms).toBeLessThan(PROMPT_MS)
    } finally {
      rmSync(path.join(project, '.claude'), { recursive: true, force: true })
    }
  })
})
