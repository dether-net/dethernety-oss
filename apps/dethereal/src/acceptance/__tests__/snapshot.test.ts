/**
 * Run checkpoints: a snapshot copies the project only, refuses anything a
 * resumed run must not carry, and a restore is byte-identical, verified, and
 * recorded as resumed (so never a clean end-to-end run).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isCleanRun, restoreSnapshot, SnapshotRefusal, takeSnapshot, treeHash, type SnapshotManifest } from '../snapshot.js'

let tmp: string
let run: string
let store: string
const opts = () => ({ store, runId: 'run-1', bundleHash: 'b'.repeat(64), distHash: 'd'.repeat(64), platformModelId: 'model-1', exportHash: 'e'.repeat(64) })

function put(rel: string, content: string | Buffer, mode = 0o644) {
  const p = path.join(run, 'project', rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, { mode })
}
const refusal = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    if (err instanceof SnapshotRefusal) return err.code
    throw err
  }
  return 'ok'
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-snapshot-')))
  run = path.join(tmp, 'run')
  store = path.join(tmp, 'store')
  put('src/app.py', 'print(1)\n')
  put('bin/tool.sh', '#!/bin/sh\n', 0o755)
  put('tm/x/manifest.json', '{"name":"x"}\n')
  put('tm/x/.dethereal/state.json', '{"currentState":"DISCOVERED"}\n')
  put('.dethernety/models.json', '{"models":[]}\n')
  put('.git/HEAD', 'ref: refs/heads/main\n')
  put('.git/config', '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://example.invalid/repo.git\n')
  put('.git/hooks/pre-commit.sample', '#!/bin/sh\n', 0o755)
  put('.git/hooks/post-checkout', '#!/bin/sh\necho hook\n', 0o755)
  fs.writeFileSync(path.join(run, 'run.json'), '{"runId":"run-1"}\n')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('takeSnapshot', () => {
  it('copies the project only, into a private store, with a manifest', () => {
    const dir = takeSnapshot(run, 'step-6', opts())
    expect(dir).toBe(path.join(store, 'run-1', 'step-6'))
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.join(dir, 'project', 'tm', 'x', 'manifest.json')).mode & 0o777).toBe(0o600)
    expect(fs.existsSync(path.join(dir, 'run.json'))).toBe(false)
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest
    expect(m).toMatchObject({ schemaVersion: 1, label: 'step-6', runId: 'run-1', bundleHash: 'b'.repeat(64), distHash: 'd'.repeat(64), platform: { modelId: 'model-1', exportHash: 'e'.repeat(64) } })
    expect(m.files.map((f) => f.path)).toEqual([
      '.dethernety/models.json', '.git/HEAD', '.git/config', '.git/hooks/pre-commit.sample', 'bin/tool.sh', 'src/app.py', 'tm/x/.dethereal/state.json', 'tm/x/manifest.json',
    ])
    expect(m.files.find((f) => f.path === 'bin/tool.sh')!.mode).toBe(0o755)
    // A hook would run code in the resumed run: it is left out, and the manifest says so.
    expect(m.skipped).toEqual(['.git/hooks/post-checkout'])
  })

  it.each([
    ['tokens.json', 'credential_file'],
    ['tm/x/.dethereal/waiver.key', 'credential_file'],
    ['home/.codex/auth.json', 'credential_file'],
    ['cfg/credentials.json', 'credential_file'],
    ['.netrc', 'credential_file'],
    ['services/api/.env', 'credential_file'],
    ['.git-credentials', 'credential_file'],
    ['deploy/id_ed25519', 'credential_file'],
    ['services/api/.env.local', 'credential_file'],
    ['certs/server.pem', 'credential_file'],
    ['certs/tls.key', 'credential_file'],
    ['.dethernety/tokens.bak', 'registry_content'],
    ['.dethernety/runtime/current.json', 'registry_content'],
  ])('refuses a project holding %s, writing nothing', (rel, code) => {
    put(rel, '{}')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe(code)
    expect(fs.existsSync(path.join(store, 'run-1', 's'))).toBe(false)
  })

  it('keeps environment templates, and refuses submodule URLs with credentials and gpg programs', () => {
    put('.env.example', 'DB_PASSWORD=\n')
    expect(refusal(() => takeSnapshot(run, 'tpl', opts()))).toBe('ok')
    put('.gitmodules', '[submodule "v"]\n\tpath = vendor\n\turl = https://user:pw@example.invalid/v.git\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_credentials')
    fs.rmSync(path.join(run, 'project', '.gitmodules'))
    put('.git/config', '[gpg "ssh"]\n\tdefaultKeyCommand = ./key\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_config_exec')
  })

  it('refuses symlinks anywhere, including inside .git', () => {
    fs.symlinkSync('/etc/hosts', path.join(run, 'project', 'hosts'))
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('symlink')
    fs.rmSync(path.join(run, 'project', 'hosts'))
    fs.symlinkSync('../HEAD', path.join(run, 'project', '.git', 'hooks', 'link.sample'))
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('symlink')
  })

  it('refuses git credentials: a credential section, or a remote URL with userinfo', () => {
    put('.git/config', '[credential]\n\thelper = store\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_credentials')
    put('.git/config', '[remote "origin"]\n\turl = https://user:secret@example.invalid/repo.git\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_credentials')
    put('.git/config', '[remote "origin"]\n\turl = git@example.invalid:repo.git\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('ok')
  })

  it('refuses git configuration that runs a program or reads more configuration, in any repository under .git', () => {
    for (const cfg of ['[core]\n\thooksPath = tools/hooks\n', '[diff]\n\texternal = ./d\n', '[protocol "ext"]\n\tallow = always\n', '[remote "o"]\n\turl = ext::sh -c x\n', '[core]\n\tfsmonitor = ./watch\n', '[core]\n\tsshCommand = ./ssh\n', '[include]\n\tpath = ../extra\n', '[filter "x"]\n\tclean = ./c\n', '[alias]\n\tst = !./x\n', '[diff "x"]\n\ttextconv = ./t\n']) {
      put('.git/config', cfg)
      expect(refusal(() => takeSnapshot(run, 's', opts())), cfg).toBe('git_config_exec')
    }
    put('.git/config', '[core]\n\trepositoryformatversion = 0\n')
    put('.git/config.worktree', '[core]\n\tfsmonitor = ./watch\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_config_exec')
    fs.rmSync(path.join(run, 'project', '.git', 'config.worktree'))
    put('.git/modules/sub/config', '[credential]\n\thelper = store\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('git_credentials')
    put('.git/modules/sub/config', '[core]\n\tbare = false\n')
    put('.git/modules/sub/hooks/pre-push', '#!/bin/sh\n', 0o755)
    const m = JSON.parse(fs.readFileSync(path.join(takeSnapshot(run, 's', opts()), 'manifest.json'), 'utf8')) as SnapshotManifest
    expect(m.skipped).toEqual(['.git/hooks/post-checkout', '.git/modules/sub/hooks/pre-push'])
  })

  it('refuses a gitfile pointing outside the project', () => {
    put('sub/.git', `gitdir: ${path.join(tmp, 'elsewhere', '.git')}\n`)
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('gitfile_outside')
    put('sub/.git', 'gitdir: ../.git/modules/sub\n')
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('ok')
  })

  it('refuses a project that overlaps a sandbox home, a bad label, and an existing label', () => {
    expect(refusal(() => takeSnapshot(run, 's', { ...opts(), homes: [path.join(run, 'project', 'home')] }))).toBe('home_overlap')
    expect(refusal(() => takeSnapshot(run, 's', { ...opts(), homes: [run] }))).toBe('home_overlap')
    expect(refusal(() => takeSnapshot(run, '../x', opts()))).toBe('bad_label')
    expect(refusal(() => takeSnapshot(run, 's', { ...opts(), runId: '..' }))).toBe('bad_run_id')
    takeSnapshot(run, 's', opts())
    expect(refusal(() => takeSnapshot(run, 's', opts()))).toBe('exists')
  })
})

describe('restoreSnapshot', () => {
  it('restores the project byte for byte, and records the run as resumed', () => {
    const snap = takeSnapshot(run, 'step-6', opts())
    const next = path.join(tmp, 'run-2')
    const r = restoreSnapshot(snap, next, { newRunId: 'run-2', liveExportHash: 'e'.repeat(64) })
    expect(r.warnings).toEqual([])
    const before = path.join(tmp, 'expected')
    fs.cpSync(path.join(run, 'project'), before, { recursive: true })
    fs.rmSync(path.join(before, '.git', 'hooks', 'post-checkout'))
    expect(treeHash(path.join(next, 'project'))).toBe(treeHash(before))
    expect(fs.statSync(path.join(next, 'project', 'bin', 'tool.sh')).mode & 0o111).not.toBe(0)
    const record = JSON.parse(fs.readFileSync(path.join(next, 'run.json'), 'utf8'))
    expect(record).toEqual({ runId: 'run-2', resumed_from: { snapshot: 'step-6', label: 'step-6', runId: 'run-1' } })
    expect(isCleanRun(record)).toBe(false)
    expect(isCleanRun({ runId: 'run-1' })).toBe(true)
  })

  it('keeps the run\'s modes in the resumed record, and only those fields', () => {
    const snap = takeSnapshot(run, 'bar-6', { ...opts(), runModes: { sheet_mode: 'bar', extra: 'x' } as never })
    const manifest = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8')) as SnapshotManifest
    expect(manifest.runModes).toEqual({ sheet_mode: 'bar' })
    restoreSnapshot(snap, path.join(tmp, 'bar'), { newRunId: 'bar' })
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'bar', 'run.json'), 'utf8'))).toEqual({ runId: 'bar', sheet_mode: 'bar', resumed_from: { snapshot: 'bar-6', label: 'bar-6', runId: 'run-1' } })
    const quick = takeSnapshot(run, 'quick-6', { ...opts(), runModes: { run_mode: 'quick' } })
    expect(restoreSnapshot(quick, path.join(tmp, 'quick'), { newRunId: 'quick' }).record).toMatchObject({ run_mode: 'quick' })
    // A run with the settlement off is resumed as one.
    const off = takeSnapshot(run, 'off-6', { ...opts(), runModes: { run_mode: 'quick', settlement: 'off' } })
    expect(restoreSnapshot(off, path.join(tmp, 'off'), { newRunId: 'off' }).record).toMatchObject({ run_mode: 'quick', settlement: 'off' })
    expect(refusal(() => takeSnapshot(run, 'bad-settlement', { ...opts(), runModes: { settlement: 'Off' } }))).toBe('bad_modes')    // A mode the run record would refuse is refused here, before anything is copied.
    expect(refusal(() => takeSnapshot(run, 'typo', { ...opts(), runModes: { sheet_mode: 'Bar' } }))).toBe('bad_modes')
    expect(refusal(() => takeSnapshot(run, 'no-version', { ...opts(), runModes: { run_mode: 'baseline' } }))).toBe('bad_modes')
    expect(fs.existsSync(path.join(store, 'run-1', 'typo'))).toBe(false)
  })

  it('warns when the platform export differs, or was not checked; never restores platform state', () => {
    const snap = takeSnapshot(run, 's', opts())
    expect(restoreSnapshot(snap, path.join(tmp, 'a'), { newRunId: 'a', liveExportHash: 'f'.repeat(64) }).warnings).toEqual(["the platform model's export differs from the one the snapshot recorded"])
    expect(restoreSnapshot(snap, path.join(tmp, 'b'), { newRunId: 'b' }).warnings).toEqual(['the platform export was not checked against the snapshot'])
    const bare = takeSnapshot(run, 'no-export', { ...opts(), exportHash: null })
    expect(restoreSnapshot(bare, path.join(tmp, 'c'), { newRunId: 'c', liveExportHash: 'e'.repeat(64) }).warnings).toEqual(['the snapshot recorded no platform export to compare with'])
  })

  it('leaves nothing half-restored when a file changes during the restore', () => {
    const snap = takeSnapshot(run, 's', opts())
    const m = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8')) as SnapshotManifest
    // A manifest listing a file twice makes the second copy fail after the first has landed.
    fs.chmodSync(path.join(snap, 'manifest.json'), 0o600)
    fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify({ ...m, files: [...m.files, m.files[0]] }))
    expect(() => restoreSnapshot(snap, path.join(tmp, 'half'), { newRunId: 'half' })).toThrow()
    expect(fs.existsSync(path.join(tmp, 'half'))).toBe(false)
  })

  it('refuses an existing target, and a snapshot that does not match its manifest', () => {
    const snap = takeSnapshot(run, 's', opts())
    fs.mkdirSync(path.join(tmp, 'taken'))
    expect(refusal(() => restoreSnapshot(snap, path.join(tmp, 'taken'), { newRunId: 'x' }))).toBe('exists')
    fs.chmodSync(path.join(snap, 'project', 'src', 'app.py'), 0o600)
    fs.writeFileSync(path.join(snap, 'project', 'src', 'app.py'), 'tampered\n')
    expect(refusal(() => restoreSnapshot(snap, path.join(tmp, 'c'), { newRunId: 'c' }))).toBe('corrupt')
    expect(fs.existsSync(path.join(tmp, 'c'))).toBe(false)
  })

  it('refuses a file planted in the snapshot that its manifest does not list', () => {
    const snap = takeSnapshot(run, 's', opts())
    fs.writeFileSync(path.join(snap, 'project', 'extra.txt'), 'x')
    expect(refusal(() => restoreSnapshot(snap, path.join(tmp, 'd'), { newRunId: 'd' }))).toBe('corrupt')
  })
})
