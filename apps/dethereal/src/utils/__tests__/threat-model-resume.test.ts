import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execSync, type ExecFileException } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Integration tests for the drift orchestration path of /dethereal:threat-model.
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
//       manual smoke walkthrough's job — but they do prove the prose is still
//       there for the agent to walk.

const PLUGIN_ROOT = join(__dirname, '..', '..', '..')
const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'detect-drift.js')
const SKILL_THREAT_MODEL = join(PLUGIN_ROOT, 'skills', 'threat-model', 'SKILL.md')
const SKILL_DISCOVER = join(PLUGIN_ROOT, 'skills', 'discover', 'SKILL.md')
const SKILL_REMOVE = join(PLUGIN_ROOT, 'skills', 'remove', 'SKILL.md')
const SKILL_ENRICH = join(PLUGIN_ROOT, 'skills', 'enrich', 'SKILL.md')
const AGENT_THREAT_MODELER = join(PLUGIN_ROOT, 'agents', 'threat-modeler.md')
const AGENT_SCOUT_SCOPED = join(PLUGIN_ROOT, 'agents', 'infrastructure-scout-scoped.md')
const AGENT_SCOUT = join(PLUGIN_ROOT, 'agents', 'infrastructure-scout.md')
const AGENT_MODEL_REVIEWER = join(PLUGIN_ROOT, 'agents', 'model-reviewer.md')
const AGENT_SECURITY_ENRICHER = join(PLUGIN_ROOT, 'agents', 'security-enricher.md')
const GUIDELINES_CORE = join(PLUGIN_ROOT, 'docs', 'guidelines-core.md')

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
// contract has been edited away.

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

  it('scoped scout schema carries the S8 zone proposal (kept in sync with the full scout)', () => {
    expect(body).toMatch(/suggestedZone/)
    expect(body).toMatch(/suggestedPlane/)
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

  it('covers the component (structure.json) and non-component (bag) crown-jewel paths', () => {
    // Components: first-class crownJewel in structure.json (matches validate-model.tool.ts)
    expect(body).toMatch(/crownJewel === true/)
    expect(body).toMatch(/structure\.json/)
    // Non-component elements (data flow / data item / boundary): local-only bag mark
    expect(body).toMatch(/crown_jewel === true/)
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

// S8 — zone vocabulary (guidelines-core.md) + scout zone proposals. The frozen enum→display-name
// table is the single rendering source; the scout proposes a zone with its classificationConfidence.
describe('S8 — boundary-zone vocabulary + scout proposals', () => {
  it('guidelines-core.md carries the frozen enum→display-name table (the single rendering source)', () => {
    const body = readFileSync(GUIDELINES_CORE, 'utf8')
    // every zone enum mapped to its frozen display name + the conduit term
    expect(body).toMatch(/`UNTRUSTED`.*Open internet/)
    expect(body).toMatch(/`PUBLIC`.*Internet-facing/)
    expect(body).toMatch(/`EXPOSED`.*DMZ/)
    expect(body).toMatch(/`INTERNAL`.*Internal/)
    expect(body).toMatch(/`RESTRICTED`.*Restricted/)
    expect(body).toMatch(/`VENDOR`.*Trusted external/)
    expect(body).toMatch(/approved channel/)
    // the cascade is a pointer, not inlined (budget discipline)
    expect(body).toMatch(/action:'zoning'/)
  })

  it("guidelines-core.md stays within the always-loaded byte budget (cascade kept out)", () => {
    // Always @-imported into every threat-modeler turn — keep it tight. The zone vocab is a 7-row
    // table + a few notes; the determination cascade lives behind action:'zoning', not inline.
    const bytes = Buffer.byteLength(readFileSync(GUIDELINES_CORE), 'utf8')
    expect(bytes).toBeLessThanOrEqual(9000)
  })

  it('the full scout proposes a zone (raw enum) carrying its classificationConfidence, never RESTRICTED', () => {
    const body = readFileSync(AGENT_SCOUT, 'utf8')
    expect(body).toMatch(/suggestedZone/)
    expect(body).toMatch(/suggestedPlane/)
    expect(body).toMatch(/## Zone & Plane Suggestion/)
    expect(body).toMatch(/Never propose `RESTRICTED`/)
    // classificationConfidence is reused as the zone-proposal confidence (no new field)
    expect(body).toMatch(/classificationConfidence/)
  })
})

// S9 — Step-4 trust-skeleton gate. The threat-model SKILL renders the two stacked tables under one
// accept-all/adjust gate, calling action:'zoning' in skeleton mode (no RESTRICTED), with the inline
// [hi/med/lo] sourced from the scout's classificationConfidence and the Resolved column from the payload.
describe('S9 — Step-4 trust-skeleton gate', () => {
  const body = readFileSync(SKILL_THREAT_MODEL, 'utf8')

  it('Step 4 renders the two stacked tables (trust classification + enforcement posture)', () => {
    expect(body).toMatch(/## Step 4: Boundary Refinement/)
    expect(body).toMatch(/Trust classification/)
    expect(body).toMatch(/Enforcement posture/)
  })

  it("Step 4 computes the skeleton via action:'zoning' with assets:'skeleton', deferring RESTRICTED", () => {
    expect(body).toMatch(/action: 'zoning', assets: 'skeleton'/)
    expect(body).toMatch(/`RESTRICTED` is deferred/)
    expect(body).toMatch(/[Nn]ever propose `RESTRICTED` here/)
  })

  it('the [hi/med/lo] tag is the scout classificationConfidence, NOT the payload confidence', () => {
    expect(body).toMatch(/\[hi\/med\/lo\]/)
    expect(body).toMatch(/scout's `classificationConfidence`/)
    // explicit guard against the stale "render the payload confidence" reading
    expect(body).toMatch(/[Dd]o \*\*not\*\* render the payload's own `confidence`/)
  })

  it('the Resolved column is payload-computed with the inheritance glyphs (never LLM-walked)', () => {
    expect(body).toMatch(/never walk the tree yourself/)
    expect(body).toMatch(/⬆/)             // declared & stricter than parent
    expect(body).toMatch(/· inherited · /) // resolves from a named ancestor
    expect(body).toMatch(/`—` = unclassified/)
  })

  it('Step 4 abstains on structural containers (leaf-only proposal) and carries the S16 tag guidance', () => {
    expect(body).toMatch(/Propose zones for LEAF segments only/)
    expect(body).toMatch(/`structural: true`/)
    expect(body).toMatch(/`— structural`/)
    // structural containers are excluded from the Step 9 unclassified count
    expect(body).toMatch(/excluded from the unclassified count/)
    // S16 guidance: model network containment as boundaries; identity/node/etc. as tags
    expect(body).toMatch(/identity, compute-node, location, and business domain are `domains`\/`planes` tags/)
  })

  it('Step-4 accept is a split write and honours proposed ≠ set', () => {
    expect(body).toMatch(/split write/)
    expect(body).toMatch(/proposed ≠ set/)
    expect(body).toMatch(/`zone` \/ `planes` → `structure\.json`/)
    expect(body).toMatch(/enforcement attributes → `attributes\/boundaries\/<id>\.json`/)
  })

  it('a ratified (declared) row is never re-proposed from the scout', () => {
    expect(body).toMatch(/[Dd]o not re-propose a ratified row/)
    expect(body).toMatch(/resolvedSource: 'declared'/)
  })

  it('the auto-skip predicate is composite (quality 1.0 AND no unratified zone proposals)', () => {
    expect(body).toMatch(/boundary_hierarchy_quality.{0,60}1\.0/s)
    expect(body).toMatch(/no unratified zone proposals/)
  })

  it('threat-modeler step table notes Step 4 emits the trust skeleton', () => {
    const tm = readFileSync(AGENT_THREAT_MODELER, 'utf8')
    expect(tm).toMatch(/Step 4 emits the trust skeleton/)
    expect(tm).toMatch(/assets:'skeleton'/)
  })

  it('discover Step 8 keeps zone/plane proposals in discovery.json (not written to structure.json)', () => {
    const disc = readFileSync(SKILL_DISCOVER, 'utf8')
    expect(disc).toMatch(/proposals.{0,80}stay in `discovery\.json`/s)
    expect(disc).toMatch(/proposed ≠ set/)
  })
})

// S10 — Step-7 RESTRICTED-promotion (completion-framed) + Step-9 zoning coherence findings (closes M-C).
// Promotion is proposed-and-confirmed (never an auto-write) with an explicit eligibility filter; the
// read-only model-reviewer surfaces the 3 conduit-independent findings rolled-up and advisory.
describe('S10 — Step-7 promotion + Step-9 findings', () => {
  const skill = readFileSync(SKILL_THREAT_MODEL, 'utf8')
  const rev = readFileSync(AGENT_MODEL_REVIEWER, 'utf8')

  it('Step 7 carries both mandated completion framings, in display names', () => {
    expect(skill).toMatch(/[Tt]he promotion we deferred at Step 4/)
    expect(skill).toMatch(/safe-direction change \(Internal → Restricted\)/)
    // the mock renders display names, not raw enums
    expect(skill).toMatch(/\| Internal \| Restricted \|/)
  })

  it('Step 7 calls action:zoning in full mode and states the eligibility filter', () => {
    expect(skill).toMatch(/validate_model_json\(action: 'zoning'\)/) // no assets arg = full phase
    expect(skill).toMatch(/proposedTier === 'RESTRICTED'/)
    expect(skill).toMatch(/resolvedZone !== 'RESTRICTED'/)
    expect(skill).toMatch(/declaredZone` is `null` or `INTERNAL`/)
    expect(skill).toMatch(/[Nn]ever touch a row the operator declared/)
  })

  it('Step 7 promotion is proposed-and-confirmed, never an auto-write (S9-guard consistent)', () => {
    expect(skill).toMatch(/[Pp]roposed-and-confirmed, never an auto-write/)
    expect(skill).toMatch(/never silently overwritten/)
  })

  it('Step 9 surfaces zoning coherence findings as advisory, fulfilling the Step-4 unclassified count', () => {
    expect(skill).toMatch(/Zoning coherence findings.{0,140}advisory, never sync-blocking/s)
    expect(skill).toMatch(/unclassified count the Step-4 trust gate forward-references/)
    expect(skill).toMatch(/one mechanism, not two/)
  })

  it('model-reviewer runs action:zoning and adds checkable items 9–14 (all 6 kinds now fire)', () => {
    expect(rev).toMatch(/validate_model_json\(action: 'zoning'\)/)
    expect(rev).toMatch(/9\. Trust zones declared/)
    expect(rev).toMatch(/10\. Assets in adequately-restricted boundaries/)
    expect(rev).toMatch(/11\. Management-plane boundaries not externally reachable/)
    expect(rev).toMatch(/12\. External-tier ingress declared as an approved channel/)
    expect(rev).toMatch(/13\. Modelled risk-bearing crossings reconciled with declared channels/)
    expect(rev).toMatch(/14\. Shared `domains` tags don't couple an exposed segment with a protected one/)
    expect(rev).toMatch(/no `cross-tier-domain`/)
  })

  it('model-reviewer no longer defers the conduit-dependent findings (S13a — engine emits them)', () => {
    expect(rev).not.toMatch(/deferred until conduits ship/)
    expect(rev).toMatch(/no `external-ingress`/)
    expect(rev).toMatch(/no `flow-channel`/)
  })

  it('model-reviewer has a rolled-up ### Zoning Coherence dashboard block with a cap and no [Critical]', () => {
    expect(rev).toMatch(/### Zoning Coherence/)
    expect(rev).toMatch(/\+N more/)
    expect(rev).toMatch(/Roll up by kind/)
    expect(rev).toMatch(/[Oo]rder actionable-first/)
    // engine emits only info|warning — the zoning block must not introduce a [Critical] mapping
    expect(rev).toMatch(/never uses `\[Critical\]`/)
    // the divergent shape from the flat Top Issues list is justified in-copy (F2)
    expect(rev).toMatch(/deliberately shaped unlike the flat, curated top-3/)
  })

  it('model-reviewer excludes structural containers and always prints the zoning scope disclaimer (S15a)', () => {
    expect(rev).toMatch(/Exclude structural containers/)
    expect(rev).toMatch(/`structural: true`/)
    expect(rev).toMatch(/— structural/)
    // the ratifier-facing scope disclaimer must state co-tenancy / shared identity are not evaluated from topology
    expect(rev).toMatch(/node co-tenancy are not evaluated from topology/)
    expect(rev).toMatch(/does not imply cross-tier isolation/)
  })

  it('enricher notes enforcement is the counterpart to the trust zone; threat-modeler notes Step-7 completion', () => {
    const enr = readFileSync(AGENT_SECURITY_ENRICHER, 'utf8')
    expect(enr).toMatch(/enforcement counterpart to a boundary's \*\*trust zone\*\*/)
    const tm = readFileSync(AGENT_THREAT_MODELER, 'utf8')
    expect(tm).toMatch(/Step 7 completes the determination/)
    expect(tm).toMatch(/safe-direction, tighten-only change/)
  })
})

// S13b — Step-5 conduit ratification gate. A batched accept-all/adjust sub-step in Step 5 surfaces the
// risk-bearing crossings (from action:'zoning' skeleton external-ingress findings), proposes directional
// OUTBOUND-only approved channels authored straight from the finding's peerId, and split-writes the
// ratified ones to structure.json; unratified crossings re-surface at Step 9.
describe('S13b — Step-5 conduit ratification gate', () => {
  const body = readFileSync(SKILL_THREAT_MODEL, 'utf8')

  it('Step 5 computes crossings via action:zoning skeleton and auto-skips when there are none', () => {
    expect(body).toMatch(/Ratify risk-bearing crossings as approved channels/)
    expect(body).toMatch(/action: 'zoning', assets: 'skeleton'/)
    expect(body).toMatch(/[Ii]f there are no such findings, skip this sub-step/)
  })

  it('the gate authors the conduit straight from the finding peerId (no flow-graph re-walk)', () => {
    expect(body).toMatch(/`peerId` \(the \*\*target\*\* boundary\)/)
    expect(body).toMatch(/never re-walk the flow graph yourself/)
  })

  it('the gate is a batched accept-all/adjust, in display names', () => {
    expect(body).toMatch(/## Approved channels/)
    expect(body).toMatch(/Ratify all, or adjust specific rows\?/)
    expect(body).toMatch(/Trusted external → Internal/) // display names, not raw enums
  })

  it('ratify is a split write (proposed ≠ set) via Edit to structure.json conduits[], OUTBOUND-only, no controlRefs', () => {
    expect(body).toMatch(/split write — proposed ≠ set/)
    expect(body).toMatch(/`conduits\[\]` in `structure\.json`/)
    expect(body).toMatch(/OUTBOUND end only/)
    expect(body).toMatch(/never an INBOUND mirror/)
    expect(body).toMatch(/[Nn]ever populate `controlRefs`/)
  })

  it('does not re-propose an existing conduit (resume/drift safety) and defers unratified to Step 9', () => {
    expect(body).toMatch(/\*\*Do not re-propose\*\* a crossing whose source boundary already carries a conduit/)
    expect(body).toMatch(/re-surfaces at Step 9 as an `external-ingress` finding/)
  })

  it('Presentation Discipline lists the Step-5 approved-channels gate', () => {
    expect(body).toMatch(/approved-channels ratification gate \(Step 5\)/)
  })
})
