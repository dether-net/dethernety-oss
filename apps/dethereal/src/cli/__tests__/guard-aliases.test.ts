/**
 * A path that reaches a file by another name than its text — macOS's volume-by-id forms and its data volume, a process's
 * descriptors and folders — is refused by every guard, on every way in: a guard cannot follow it to the file it names
 * as the command reaches it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { aliasedPath as configAliasedPath, decideConfigWrite, rawEventFrom, type GuardEnv } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'
import { aliasedPath, commandNamesGuarded, patchTouchesGuarded } from '../../utils/secret-fallback.mjs'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'guard-aliases-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, '.env'), 'x')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const secretEnv = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: process.platform, now: Date.now })
const configEnv = (): GuardEnv => ({ env: {}, home, platform: process.platform, cwd: project, readFile: () => '{}' })
const event = (tool: string, input: Record<string, unknown>) => rawEventFrom(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: project }))
const read = (file: string) => decideSecretAccess(event('Read', { file_path: file }), secretEnv())
const bash = (command: string) => decideSecretAccess(event('Bash', { command }), secretEnv())
const write = (file: string) => decideConfigWrite(event('Write', { file_path: file, content: '{"permissions":{"defaultMode":"bypassPermissions"}}' }), configEnv())
const ALIASED = /another name/

describe('the alias forms', () => {
  it.each([
    ['/.vol/16777229/1234/settings.json', true], ['/.resolve/0/x', true], ['/.nofollow/x', true], ['/.VOL/1/2', true], ['/dev/fd/3', true],
    ['/dev/fd', true], ['/proc/self/root/x', true], ['/proc/thread-self/cwd', true], ['/proc/123/root/x', true], ['/proc/123/task/4/cwd', true],
    ['/proc/123/fd/3', true], ['/proc/123/status', false], ['/proc/cpuinfo', false], ['/System/Volumes/Data/opt/x', true], ['/system/volumes/data/x', true],
    ['/System/Volumes/Preboot', false], ['/dev/null', false],
    ['/dev/stdin', false], ['/vol/x', false], ['/x/.vol/y', false], ['.vol/x', false], ['/procx/self', false], ['/dev/fd/2', false], ['/dev/fd/0', false],
    ['/dev/fd/12', true], ['/dev/fd/2/x', true],
  ] as const)('%s is an alias: %s (both guards\' copies)', (p, alias) => {
    expect(aliasedPath(p)).toBe(alias)
    expect(configAliasedPath(p)).toBe(alias)
  })
})

describe('every guard refuses a path through an alias, before it resolves anything', () => {
  for (const p of ['/.resolve/0/x/.env', '/dev/fd/5', '/proc/self/root/etc/x', '/proc/thread-self/cwd/.env']) {
    it(`refuses ${p} to a read, a search, a shell command, a write, a patch and the by-name fallback`, () => {
      expect(read(p)).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
      expect(decideSecretAccess(event('Grep', { pattern: 'x', path: p }), secretEnv())).toMatchObject({ deny: true })
      expect(bash(`cat ${p}`)).toMatchObject({ deny: true })
      expect(decideCodexAccess(event('Bash', { command: `cat ${p}` }), secretEnv())).toMatchObject({ deny: true })
      expect(decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'read', args: { filePath: p }, directory: project })), secretEnv())).toMatchObject({ deny: true })
      expect(write(p)).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
      expect(decideConfigWrite(event('apply_patch', { command: `*** Begin Patch\n*** Add File: ${p}\n+x\n*** End Patch` }), configEnv())).toMatchObject({ deny: true })
      expect(commandNamesGuarded(`cat ${p}`)).toBe(true)
      expect(patchTouchesGuarded(`*** Begin Patch\n*** Add File: ${p}\n+x\n*** End Patch`)).toBe(true)
    })
  }

  it('refuses a relative path read after a change of folder into an alias', () => {
    expect(bash('cd /proc/self/cwd && cat .env')).toMatchObject({ deny: true })
    expect(bash('cd /dev/fd/5; cat x')).toMatchObject({ deny: true })
  })

  it('still reads and writes ordinary paths', () => {
    expect(read(path.join(project, 'src', 'a.ts')).deny).toBe(false)
    expect(bash('cat src/a.ts > /dev/null 2>/dev/stderr').deny).toBe(false)
    expect(bash('echo x > /dev/stdout; cat /dev/stdin < src/a.ts').deny).toBe(false)
    expect(write('/dev/stderr').deny).toBe(false)
    expect(write(path.join(project, 'src', 'a.ts')).deny).toBe(false)
  })
})

describe.runIf(process.platform === 'darwin')('macOS volume-by-id paths', () => {
  const vol = (dir: string) => `/.vol/${statSync(dir).dev}/${statSync(dir).ino}`

  it('refuses a read, a shell command and a write that name a file by its folder\'s volume and inode', () => {
    expect(read(`${vol(project)}/.env`)).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
    expect(bash(`cat ${vol(project)}/.env`)).toMatchObject({ deny: true })
    expect(write(`${vol(path.join(home, '.claude'))}/settings.json`)).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
    expect(write(`${vol(path.join(home, '.claude'))}/skills/x/SKILL.md`)).toMatchObject({ deny: true })
  })

  it('refuses the data volume\'s spelling of a path, which reaches the same file', () => {
    const data = (p: string) => `/System/Volumes/Data${p}`
    expect(read(data(`${project}/.env`))).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
    expect(bash(`cat ${data(`${project}/.env`)}`)).toMatchObject({ deny: true })
    expect(decideCodexAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat .env', workdir: data(project) }, cwd: project })), secretEnv())).toMatchObject({ deny: true })
    expect(write(data(`${home}/.gitconfig`))).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
  })

  it('reads a configuration path in either Unicode normal form as the same', () => {
    const nfc = path.join(tmp, 'h\u00e9')
    mkdirSync(nfc)
    const env: GuardEnv = { env: { CLAUDE_CONFIG_DIR: nfc }, home: nfc, platform: 'darwin', cwd: project, readFile: () => '{}' }
    const nfd = nfc.normalize('NFD')
    for (const target of [`${nfd}/.gitconfig`, `${nfd}/settings.json`]) {
      expect([target, decideConfigWrite(event('Write', { file_path: target, content: '{"permissions":{"defaultMode":"bypassPermissions"}}' }), env)])
        .toEqual([target, expect.objectContaining({ deny: true })])
    }
  })

  it('refuses a dangling link reached through one, which the write would follow', () => {
    symlinkSync(path.join(home, '.claude', 'settings.local.json'), path.join(project, 'dl'))
    expect(write(path.join(project, 'dl'))).toMatchObject({ deny: true })
    expect(write(`${vol(project)}/dl`)).toMatchObject({ deny: true, reason: expect.stringMatching(ALIASED) })
  })
})

describe.runIf(process.platform === 'linux')('another process\'s folder on Linux', () => {
  it('refuses /proc/<pid>/root, cwd and fd: the guard would see them as its own process does', () => {
    for (const p of [`/proc/${process.pid}/root${project}/src/a.ts`, `/proc/${process.pid}/cwd/src/a.ts`, `/proc/${process.pid}/fd/0`]) {
      expect([p, read(p)]).toEqual([p, expect.objectContaining({ deny: true, reason: expect.stringMatching(ALIASED) })])
    }
    expect(write(`/proc/${process.pid}/root${home}/.claude/settings.json`)).toMatchObject({ deny: true })
    expect(read('/proc/cpuinfo').deny).toBe(false)
  })
})
