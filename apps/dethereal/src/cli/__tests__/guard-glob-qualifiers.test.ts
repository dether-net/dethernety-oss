/**
 * zsh reads a trailing glob qualifier `(…)` — `.env(N)`, `*(D)`, `*(.)` — as the glob before it with a qualifier, so
 * `cat .env(N)` reads `.env`. The secret guard read the whole operand as a literal path (no file is named that), and
 * allowed it. It now also judges the operand with the qualifier removed, on every harness.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'guard-qualifiers-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(path.join(project, '.aws'), { recursive: true })
  mkdirSync(path.join(project, 'sub'), { recursive: true })
  writeFileSync(path.join(project, '.env'), 'x')
  writeFileSync(path.join(project, 'server.pem'), 'x')
  writeFileSync(path.join(project, '.aws', 'credentials'), 'x')
  writeFileSync(path.join(project, 'sub', '.env'), 'x')
  writeFileSync(path.join(project, 'a.ts'), 'export {}\n')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const env = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: process.platform, now: Date.now })
const ev = (command: string) => rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project }))
const claude = (command: string) => decideSecretAccess(ev(command), env())
const codex = (command: string) => decideCodexAccess(ev(command), env())
const opencode = (command: string) => decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', args: { command }, directory: project })), env())

describe('a secret read through a zsh glob qualifier', () => {
  const hidden = [
    'cat .env(N)',
    'cat .env(.)',
    'cat .env(om[1])',
    'cat *(D)',
    'cat *(.)',
    'cat .*(.)',
    'cat server.pem(N)',
    'cat .aws/credentials(N)',
    'cat .en[v](N)',
    'cat .env*(om[1])',
    'grep -r x sub(N)',
    'cat .env(',
  ]
  it.each(hidden)('is refused on Claude for %j', (command) => {
    expect(claude(command)).toMatchObject({ deny: true })
  })
  it.each(hidden)('is refused on Codex and OpenCode for %j', (command) => {
    expect(codex(command)).toMatchObject({ deny: true })
    expect(opencode(command)).toMatchObject({ deny: true })
  })
})

describe('ordinary operands still read', () => {
  it.each([
    'cat a.ts',
    'cat *.ts',
    'echo hi',
    'cat src/a.ts',
    'grep -n x a.ts',
  ])('lets %j read', (command) => {
    expect(claude(command).deny).toBe(false)
  })
})
