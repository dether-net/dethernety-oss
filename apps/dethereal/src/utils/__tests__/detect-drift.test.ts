import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execSync, type ExecFileException } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Resolve script path relative to this test file (src/utils/__tests__ → ../../../scripts).
const SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'detect-drift.js')

// Hermetic git: prevent the operator's user-level config and any inherited
// GIT_* env vars (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG_COUNT,
// GIT_SSH_COMMAND, GIT_HOOKS_PATH, etc.) from leaking into fixtures or vice
// versa. Strip every GIT_* key from process.env, then set the explicit allowlist.
const HERMETIC_ENV = (() => {
  const filtered: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && v !== undefined) filtered[k] = v
  }
  return {
    ...filtered,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
})()

function gitInit(dir: string) {
  execSync('git init -q -b main', { cwd: dir, env: HERMETIC_ENV })
}

function gitCommitAll(dir: string, message: string): string {
  execSync('git add -A', { cwd: dir, env: HERMETIC_ENV })
  execSync(`git commit -q -m "${message}"`, { cwd: dir, env: HERMETIC_ENV })
  return execSync('git rev-parse HEAD', { cwd: dir, env: HERMETIC_ENV }).toString().trim()
}

function writeFile(dir: string, relPath: string, content: string) {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function writeState(dir: string, state: Record<string, unknown>) {
  mkdirSync(join(dir, '.dethereal'), { recursive: true })
  writeFileSync(join(dir, '.dethereal', 'state.json'), JSON.stringify(state, null, 2))
}

type Result = { status: number; stdout: string; stderr: string }

function runScript(dir: string): Result {
  try {
    const stdout = execFileSync('node', [SCRIPT, '--model-dir', dir], {
      env: HERMETIC_ENV,
      encoding: 'utf8',
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as ExecFileException & { stdout?: string; stderr?: string }
    return {
      status: e.status ?? 1,
      stdout: (e.stdout ?? '').toString(),
      stderr: (e.stderr ?? '').toString(),
    }
  }
}

function parseStderrJson(stderr: string): { error: string; message?: string; hint?: string } {
  return JSON.parse(stderr.trim())
}

describe('detect-drift.js', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'detect-drift-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses when not in a git repo (exit 2)', () => {
    writeState(tempDir, { lastReconcileCommit: 'deadbeef' })
    const r = runScript(tempDir)
    expect(r.status).toBe(2)
    expect(parseStderrJson(r.stderr).error).toBe('not-a-git-repo')
  })

  it('refuses when state.json is absent (exit 3)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    gitCommitAll(tempDir, 'init')
    const r = runScript(tempDir)
    expect(r.status).toBe(3)
    expect(parseStderrJson(r.stderr).error).toBe('missing-baseline')
  })

  it('refuses when state.json lacks lastReconcileCommit (exit 3)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    gitCommitAll(tempDir, 'init')
    writeState(tempDir, { currentState: 'DISCOVERED' })
    const r = runScript(tempDir)
    expect(r.status).toBe(3)
    expect(parseStderrJson(r.stderr).error).toBe('missing-baseline')
  })

  it('refuses when baseline is not in branch ancestry (exit 4)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    gitCommitAll(tempDir, 'init')
    writeState(tempDir, { lastReconcileCommit: '0000000000000000000000000000000000000000' })
    const r = runScript(tempDir)
    expect(r.status).toBe(4)
    expect(parseStderrJson(r.stderr).error).toBe('ancestry-broken')
  })

  it('returns empty scoped set on a clean repo at baseline', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    const sha = gitCommitAll(tempDir, 'init')
    writeState(tempDir, { lastReconcileCommit: sha })
    // Untracked state.json is in .dethereal which is not in source-globs;
    // committed README.md isn't in source-globs either; expect empty scoped.
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.baseline).toBe(sha)
    expect(out.scoped).toEqual([])
  })

  it('captures an in-glob committed change since baseline', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    const sha = gitCommitAll(tempDir, 'init')
    writeState(tempDir, { lastReconcileCommit: sha })
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" {}')
    gitCommitAll(tempDir, 'add tf')
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.scoped).toContain('infra/main.tf')
  })

  it('excludes out-of-glob committed changes', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    const sha = gitCommitAll(tempDir, 'init')
    writeState(tempDir, { lastReconcileCommit: sha })
    writeFile(tempDir, 'notes.md', 'some prose')
    gitCommitAll(tempDir, 'add notes')
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).scoped).toEqual([])
  })

  it('treats a `git mv` of an in-glob file as identity-preserving (-M -C)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" {}')
    const sha = gitCommitAll(tempDir, 'init tf')
    writeState(tempDir, { lastReconcileCommit: sha })
    execSync('git mv infra/main.tf infra/network.tf', { cwd: tempDir, env: HERMETIC_ENV })
    gitCommitAll(tempDir, 'rename')
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    const scoped: string[] = JSON.parse(r.stdout).scoped
    // -M -C makes git report the move as a single rename entry; the new path appears
    // in the diff. With pure renames, the old path may also surface — we only assert
    // the new path is present (the orchestrator will treat it as identity-preserved).
    expect(scoped).toContain('infra/network.tf')
  })

  it('captures an in-glob dirty (uncommitted) change', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" {}')
    const sha = gitCommitAll(tempDir, 'init tf')
    writeState(tempDir, { lastReconcileCommit: sha })
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" { acl = "private" }')
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).scoped).toContain('infra/main.tf')
  })

  it('dedupes a file that appears in both diff and dirty tree', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/main.tf', 'v1')
    const sha = gitCommitAll(tempDir, 'init tf')
    writeState(tempDir, { lastReconcileCommit: sha })
    // Commit a change (so it appears in diff baseline..HEAD) and then dirty it again.
    writeFile(tempDir, 'infra/main.tf', 'v2')
    gitCommitAll(tempDir, 'edit tf')
    writeFile(tempDir, 'infra/main.tf', 'v3')
    const r = runScript(tempDir)
    expect(r.status).toBe(0)
    const scoped: string[] = JSON.parse(r.stdout).scoped
    expect(scoped.filter((p) => p === 'infra/main.tf').length).toBe(1)
  })
})
