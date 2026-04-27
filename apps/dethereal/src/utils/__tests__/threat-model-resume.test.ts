import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execSync, type ExecFileException } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Sprint 2 integration tests for the drift orchestration path of /dethereal:threat-model.
//
// The orchestration is prose-driven inside the threat-modeler agent — a unit test
// cannot "run" it the way it can run a TypeScript function. So this file does two
// distinct jobs:
//
//   (a) Git-fixture tests that spawn detect-drift.js in the same shapes a resume
//       run would (lastReconcileCommit set, scoped sources changed, --full-scan
//       considered). These verify the detection layer behaves correctly under the
//       state shapes the orchestrator produces.
//
//   (b) Prose-contract assertions on the skill bodies and agent bodies. These act
//       as regression guards: if a future edit deletes the Drift Orchestration
//       Protocol section, removes the four-mode contract from the scoped scout,
//       or strips the crown-jewel pre-confirm from /dethereal:remove, these tests
//       fail. They don't prove the agent walks the prose correctly — that's the
//       Sprint 3 manual smoke walkthrough's job — but they do prove the prose is
//       still there for the agent to walk.

const PLUGIN_ROOT = join(__dirname, '..', '..', '..')
const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'detect-drift.js')
const SKILL_THREAT_MODEL = join(PLUGIN_ROOT, 'skills', 'threat-model', 'SKILL.md')
const SKILL_DISCOVER = join(PLUGIN_ROOT, 'skills', 'discover', 'SKILL.md')
const SKILL_REMOVE = join(PLUGIN_ROOT, 'skills', 'remove', 'SKILL.md')
const SKILL_ENRICH = join(PLUGIN_ROOT, 'skills', 'enrich', 'SKILL.md')
const AGENT_THREAT_MODELER = join(PLUGIN_ROOT, 'agents', 'threat-modeler.md')
const AGENT_SCOUT_SCOPED = join(PLUGIN_ROOT, 'agents', 'infrastructure-scout-scoped.md')

// Hermetic git env (same posture as detect-drift.test.ts — strip all GIT_*
// inherited from the operator's shell, then set an explicit allowlist).
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
function writeJson(dir: string, relPath: string, obj: unknown) {
  writeFile(dir, relPath, JSON.stringify(obj, null, 2))
}

type Result = { status: number; stdout: string; stderr: string }
function runDetectDrift(dir: string): Result {
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

describe('threat-model resume — drift orchestration (git fixtures)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'threat-model-resume-'))
  })
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it('clean repo at baseline → empty scoped set (drift orchestrator skips delta loop)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" {}')
    const sha = gitCommitAll(tempDir, 'init tf')
    writeJson(tempDir, '.dethereal/state.json', {
      currentState: 'ENRICHING',
      completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'],
      lastModified: '2026-04-25T00:00:00Z',
      staleElements: [],
      lastReconcileCommit: sha,
    })
    const r = runDetectDrift(tempDir)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).scoped).toEqual([])
    // The orchestrator's "no drift" branch fires when scoped is empty.
  })

  it('in-glob change since baseline → scoped includes the changed file (orchestrator enters delta loop)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" {}')
    const sha = gitCommitAll(tempDir, 'init tf')
    writeJson(tempDir, '.dethereal/state.json', { lastReconcileCommit: sha })
    writeFile(tempDir, 'infra/main.tf', 'resource "aws_s3_bucket" "x" { acl = "private" }')
    gitCommitAll(tempDir, 'edit tf')
    const r = runDetectDrift(tempDir)
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.scoped).toContain('infra/main.tf')
    expect(out.baseline).toBe(sha)
  })

  it('in-glob file added → scoped includes new file (orchestrator routes via /dethereal:add)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    const sha = gitCommitAll(tempDir, 'init')
    writeJson(tempDir, '.dethereal/state.json', { lastReconcileCommit: sha })
    writeFile(tempDir, 'infra/lambda.tf', 'resource "aws_lambda_function" "f" {}')
    gitCommitAll(tempDir, 'add lambda')
    const r = runDetectDrift(tempDir)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).scoped).toContain('infra/lambda.tf')
  })

  it('in-glob file deleted → scoped includes deleted path (orchestrator routes via /dethereal:remove)', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/old.tf', 'resource "aws_instance" "o" {}')
    const sha = gitCommitAll(tempDir, 'init')
    writeJson(tempDir, '.dethereal/state.json', { lastReconcileCommit: sha })
    execSync('git rm infra/old.tf', { cwd: tempDir, env: HERMETIC_ENV })
    gitCommitAll(tempDir, 'remove old')
    const r = runDetectDrift(tempDir)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).scoped).toContain('infra/old.tf')
  })

  it('mid-loop kill scenario: lastReconcileCommit unchanged → re-run produces same scoped set', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'infra/a.tf', 'resource "aws_s3_bucket" "a" {}')
    const sha = gitCommitAll(tempDir, 'init')
    writeJson(tempDir, '.dethereal/state.json', { lastReconcileCommit: sha })
    writeFile(tempDir, 'infra/a.tf', 'resource "aws_s3_bucket" "a" { acl = "private" }')
    writeFile(tempDir, 'infra/b.tf', 'resource "aws_s3_bucket" "b" {}')
    gitCommitAll(tempDir, 'two changes')
    const first = JSON.parse(runDetectDrift(tempDir).stdout)
    // Simulate the orchestrator killed mid-loop: state.json baseline is still `sha`,
    // not advanced. A second run from the same baseline must report the same scoped set.
    const second = JSON.parse(runDetectDrift(tempDir).stdout)
    expect(second.scoped).toEqual(first.scoped)
    expect(second.baseline).toBe(sha)
  })

  it('absent lastReconcileCommit → script refuses (exit 3); orchestrator skips drift', () => {
    gitInit(tempDir)
    writeFile(tempDir, 'README.md', 'init')
    gitCommitAll(tempDir, 'init')
    writeJson(tempDir, '.dethereal/state.json', { currentState: 'DISCOVERED' })
    const r = runDetectDrift(tempDir)
    expect(r.status).toBe(3)
    expect(JSON.parse(r.stderr.trim()).error).toBe('missing-baseline')
  })
})

// ─── Prose-contract regression guards ────────────────────────────────────────────
// These don't validate behaviour; they validate that the protocol prose the
// agent walks is still in place. If any of these fail, the orchestration
// contract has been edited away — which is a Sprint 2 regression.

describe('threat-model SKILL.md drift orchestration prose', () => {
  const body = readFileSync(SKILL_THREAT_MODEL, 'utf8')

  it('frontmatter argument-hint includes --full-scan', () => {
    expect(body).toMatch(/argument-hint:.*--full-scan/)
  })

  it('resume body invokes detect-drift.js via the canonical Bash + CLAUDE_PLUGIN_ROOT form', () => {
    // Quoting around ${CLAUDE_PLUGIN_ROOT} is allowed (defends against paths with spaces).
    expect(body).toMatch(/Bash\(node "?\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/detect-drift\.js"?/)
  })

  it('resume body documents a fallback for when CLAUDE_PLUGIN_ROOT is not propagated', () => {
    expect(body).toMatch(/require\.resolve\('@dether\.net\/dethereal\/package\.json'\)/)
  })

  it('resume body documents the four delta dispositions', () => {
    expect(body).toContain('REMOVED')
    expect(body).toContain('ADDED')
    expect(body).toContain('CHANGED-substrate')
    expect(body).toContain('CHANGED-attribute-only')
  })

  it('resume body emits the four routing slash-commands / MCP call', () => {
    expect(body).toMatch(/\/dethereal:remove/)
    expect(body).toMatch(/\/dethereal:add/)
    expect(body).toMatch(/\/dethereal:enrich --pick/)
    expect(body).toMatch(/match_classes/)
  })

  it('resume body advances lastReconcileCommit only after every delta item resolves', () => {
    expect(body).toMatch(/After every delta item resolves/i)
    expect(body).toMatch(/lastReconcileCommit/)
  })

  it('resume body handles the --full-scan bypass', () => {
    expect(body).toMatch(/--full-scan/)
    expect(body).toMatch(/\/dethereal:discover/)
  })

  it('resume body handles missing discovery.json (skip drift)', () => {
    expect(body).toMatch(/discovery\.json/)
    expect(body).toMatch(/No prior discovery provenance/)
  })
})

describe('threat-modeler agent — Drift Orchestration Protocol', () => {
  const body = readFileSync(AGENT_THREAT_MODELER, 'utf8')

  it('tools list grants Agent(infrastructure-scout-scoped)', () => {
    expect(body).toMatch(/Agent\(infrastructure-scout-scoped\)/)
  })

  it('Drift Orchestration Protocol section is present', () => {
    expect(body).toMatch(/## Drift Orchestration Protocol/)
  })

  it('Resume protocol references the drift logic before cursor computation', () => {
    expect(body).toMatch(/[Bb]efore.{0,40}step cursor.{0,200}Drift Orchestration Protocol/s)
  })
})

describe('infrastructure-scout-scoped — four-mode contract', () => {
  const body = readFileSync(AGENT_SCOUT_SCOPED, 'utf8')

  it('invocation enum lists all four modes', () => {
    expect(body).toMatch(/`discover elements`/)
    expect(body).toMatch(/`re-verify element attributes`/)
    expect(body).toMatch(/`propose reclassification`/)
    expect(body).toMatch(/`check element existence`/)
  })

  it('discover-elements output schema matches the full scout (suggestedName + sources)', () => {
    expect(body).toMatch(/### For `discover elements`/)
    expect(body).toMatch(/suggestedName/)
    expect(body).toMatch(/sources/)
    expect(body).toMatch(/existenceConfidence/)
  })

  it('preserves the narrow-tools posture (no Grep/Glob/Bash on the scoped scout)', () => {
    expect(body).not.toMatch(/^\s*-\s*Grep\b/m)
    expect(body).not.toMatch(/^\s*-\s*Glob\b/m)
    expect(body).not.toMatch(/^\s*-\s*Bash\b/m)
  })
})

describe('/dethereal:remove — crown-jewel pre-confirm', () => {
  const body = readFileSync(SKILL_REMOVE, 'utf8')

  it('step 4 has a crown-jewel pre-check before the dependency table', () => {
    expect(body).toMatch(/Crown-jewel pre-check/)
    expect(body).toMatch(/CROWN JEWEL/)
  })

  it('checks both top-level and nested attribute paths (matching validate-model.tool.ts predicate)', () => {
    expect(body).toMatch(/crown_jewel === true/)
    expect(body).toMatch(/attributes\.crown_jewel === true/)
  })

  it('declining the crown-jewel prompt stops without showing dependencies', () => {
    expect(body).toMatch(/declines on the crown-jewel prompt.{0,80}stop/i)
  })

  it('untagged removal falls through to the existing dependency-table flow (no behaviour change)', () => {
    expect(body).toMatch(/element is untagged.{0,80}continue with the dependency table/i)
  })
})

describe('/dethereal:enrich — --pick <id> flag', () => {
  const body = readFileSync(SKILL_ENRICH, 'utf8')

  it('argument-hint advertises --pick <element-id>', () => {
    expect(body).toMatch(/argument-hint:.*--pick <element-id>/)
  })

  it('skill body documents the targeted single-element behaviour', () => {
    expect(body).toMatch(/--pick <element-id>.{0,200}single element/i)
  })
})

// Initial-baseline write: without these guards, lastReconcileCommit is only
// ever written by the resume path's drift-loop completion (which can only fire
// if a baseline already exists). Without an initial-baseline writer, drift
// detection is permanently dormant on a freshly-created model.
describe('initial drift-detection baseline is written at end of discovery', () => {
  it('/dethereal:discover Step 9 writes lastReconcileCommit', () => {
    const body = readFileSync(SKILL_DISCOVER, 'utf8')
    expect(body).toMatch(/### 9\. Update State/)
    expect(body).toMatch(/lastReconcileCommit/)
    expect(body).toMatch(/git rev-parse HEAD/)
  })

  it('/dethereal:discover documents the non-git fallback (omit field, drift skips)', () => {
    const body = readFileSync(SKILL_DISCOVER, 'utf8')
    expect(body).toMatch(/not a git repo.{0,100}omit the field/i)
  })

  it('/dethereal:discover documents the re-baseline semantics (re-running overwrites)', () => {
    const body = readFileSync(SKILL_DISCOVER, 'utf8')
    expect(body).toMatch(/[Rr]e-running.{0,80}overwrites/)
  })

  it('/dethereal:threat-model Step 2 writes lastReconcileCommit alongside the DISCOVERED transition', () => {
    const body = readFileSync(SKILL_THREAT_MODEL, 'utf8')
    expect(body).toMatch(/## Step 2: Discovery/)
    // The Step 2 update-state line names lastReconcileCommit on the same
    // bullet as the DISCOVERED state transition.
    expect(body).toMatch(/DISCOVERED.{0,200}lastReconcileCommit/s)
  })

  it('threat-modeler agent Discovery Orchestration Protocol step 12 writes lastReconcileCommit', () => {
    const body = readFileSync(AGENT_THREAT_MODELER, 'utf8')
    expect(body).toMatch(/## Discovery Orchestration Protocol/)
    expect(body).toMatch(/DISCOVERED.{0,300}lastReconcileCommit/s)
    expect(body).toMatch(/git rev-parse HEAD/)
  })
})
