/**
 * Detect Drift Tool
 *
 * Which source files changed since a model's baseline commit: the committed
 * changes since the baseline, plus the staged, unstaged and untracked ones,
 * limited to the files discovery reads (package manifests, IaC, container and
 * Kubernetes files).
 *
 * The repository is untrusted. The model directory must pass confinement, the
 * baseline must be a full object name, git runs only through the hardened runner
 * (which neutralises repository-configured programs), and the file names that come
 * back are filtered and capped before they reach the model. `git status` is never
 * run: it refreshes the index. Without that refresh, a file whose timestamps
 * changed but whose content did not is still listed; drift over-reports, never
 * misses.
 */

import fs from 'node:fs/promises'
import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from './base-tool.js'
import { validatePathConfinement } from '../utils/directory-utils.js'
import { readRepoJson } from '../utils/state-store.js'
import { getProjectRoot, resolveProjectRoot } from '../utils/project-root.js'
import { DISCOVERY_GLOBS } from '../utils/source-globs.js'
import { GitRefusal, openRepository, type GitRepository } from '../utils/git.js'

export type DriftRefusalCode =
  | 'outside-root'
  | 'not-found'
  | 'git-unavailable'
  | 'not-a-git-repo'
  | 'unsupported-repository'
  | 'missing-baseline'
  | 'invalid-baseline'
  | 'ancestry-broken'
  | 'git-failure'

const HINTS: Record<DriftRefusalCode, string> = {
  'outside-root': 'Use a model directory inside the project.',
  'not-found': 'Check the model directory path.',
  'git-unavailable': 'Install a current git, then retry.',
  'not-a-git-repo': 'Drift detection needs a git repository: git init && git add . && git commit -m "initial".',
  'unsupported-repository': 'Drift cannot be read safely in this repository; rescan the sources instead.',
  'missing-baseline': 'Set a drift baseline with the model state tool (set_baseline) after the next discovery.',
  'invalid-baseline': 'Re-baseline: the stored baseline is not a full commit id.',
  'ancestry-broken': 'Re-baseline: the baseline is not in this branch (history rewrite or branch switch).',
  'git-failure': 'Retry; if it persists, rescan the sources instead.'
}

class DriftRefusal extends Error {
  constructor(readonly code: DriftRefusalCode, message: string) {
    super(message)
  }
}

/** Most paths reported; beyond this the result says it is truncated. */
export const MAX_SCOPED = 2000
const MAX_PATH_LENGTH = 1024
const LISTING = { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 }
const UNSAFE_PATH = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}�]|[\uD800-\uDFFF]/u

export interface DriftResult {
  /** The baseline commit the changes are measured from */
  baseline: string
  /** Changed files, relative to the repository root, sorted; a renamed or copied file under both of its paths */
  scoped: string[]
  /** Files git saw renamed since the baseline (committed or staged), both paths in `scoped` */
  renamed: DriftPair[]
  /** Files git saw copied since the baseline (committed), both paths in `scoped` */
  copied: DriftPair[]
  /** Changed files left out because their names hold control or invisible characters, or are too long */
  omitted?: number
  /** More changed files than listed */
  truncated?: boolean
  /** Present when the list is incomplete */
  note?: string
}

export interface DriftPair {
  from: string
  to: string
}

const InputSchema = z.object({
  directory_path: z.string().min(1).describe('Model directory (the one holding manifest.json and .dethereal/)')
})

type DetectDriftInput = z.infer<typeof InputSchema>

/** A refusal's data: the code, and what to do about it. */
export interface DriftRefusalData {
  error: DriftRefusalCode
  hint: string
}

async function listing(repo: GitRepository, args: string[]): Promise<string[]> {
  const pathspecs = DISCOVERY_GLOBS.map((g) => `:(top,glob)${g}`)
  const result = await repo.run([...args, '--', ...pathspecs], LISTING)
  if (result.code !== 0) throw new DriftRefusal('git-failure', 'git could not list changed files')
  return result.stdout.split('\0').filter(Boolean)
}

/** One `--name-status -z` record: a status letter (with a score for R and C), then one path, or two for R and C. */
const STATUS = /^([ACDMTUXB]|[RC]\d{0,3})$/

/** A `--name-status -z` listing: every path it names, and its renames and copies. */
async function statusListing(repo: GitRepository, args: string[]): Promise<{ paths: string[]; renamed: DriftPair[]; copied: DriftPair[] }> {
  const tokens = await listing(repo, args)
  const out = { paths: [] as string[], renamed: [] as DriftPair[], copied: [] as DriftPair[] }
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++]!
    if (!STATUS.test(status)) throw new DriftRefusal('git-failure', 'git listed changed files in an unexpected form')
    if (status[0] === 'R' || status[0] === 'C') {
      const from = tokens[i++]
      const to = tokens[i++]
      if (from === undefined || to === undefined) throw new DriftRefusal('git-failure', 'git listed changed files in an unexpected form')
      out.paths.push(from, to)
      ;(status[0] === 'R' ? out.renamed : out.copied).push({ from, to })
    } else {
      const p = tokens[i++]
      if (p === undefined) throw new DriftRefusal('git-failure', 'git listed changed files in an unexpected form')
      out.paths.push(p)
    }
  }
  return out
}

async function detect(input: DetectDriftInput): Promise<DriftResult> {
  let dir: string
  try {
    dir = await validatePathConfinement(input.directory_path)
  } catch {
    throw new DriftRefusal('outside-root', 'the model directory is outside the project')
  }
  const isDirectory = await fs.stat(dir).then((s) => s.isDirectory(), () => false)
  if (!isDirectory) throw new DriftRefusal('not-found', 'the model directory does not exist')

  let state: Record<string, unknown> | null
  try {
    state = await readRepoJson(dir, '.dethereal/state.json', { baseDir: dir })
  } catch {
    throw new DriftRefusal('missing-baseline', 'the model state could not be read')
  }
  const baseline = state?.lastReconcileCommit
  if (baseline === undefined || baseline === null || baseline === '') {
    throw new DriftRefusal('missing-baseline', 'no drift baseline is recorded for this model')
  }
  // Only a full object name: a short one can be shadowed by a tag or branch of the same name.
  if (typeof baseline !== 'string' || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(baseline)) {
    throw new DriftRefusal('invalid-baseline', 'the recorded baseline is not a full commit id')
  }

  const root = getProjectRoot() ?? resolveProjectRoot()
  let repo: GitRepository
  try {
    repo = await openRepository(dir, { projectRoot: root.root ?? undefined })
  } catch (error) {
    if (error instanceof GitRefusal) throw new DriftRefusal(error.code, error.message)
    throw new DriftRefusal('git-failure', 'git could not be run')
  }

  const sha = await repo.resolveCommit(baseline)
  if (!sha || !(await repo.isAncestor(sha))) {
    throw new DriftRefusal('ancestry-broken', 'the baseline is not in the current branch history')
  }

  // Commits and the index are listed with their status, so a rename or copy names both paths.
  const committed = await statusListing(repo, ['diff-tree', '-r', '--name-status', '-z', '-M', '-C', sha, 'HEAD'])
  const staged = await statusListing(repo, ['diff-index', '--cached', '--name-status', '-z', '-M', '--ignore-submodules=all', 'HEAD'])
  const changed = new Set<string>([
    ...committed.paths,
    ...staged.paths,
    ...(await listing(repo, ['diff-files', '--name-only', '-z', '--ignore-submodules=all'])),
    ...(await listing(repo, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z']))
  ])

  let omitted = 0
  const safe: string[] = []
  for (const p of changed) {
    if (UNSAFE_PATH.test(p) || p.length > MAX_PATH_LENGTH) omitted += 1
    else safe.push(p)
  }
  safe.sort()
  const truncated = safe.length > MAX_SCOPED
  const scoped = safe.slice(0, MAX_SCOPED)
  // A pair is reported only when both of its paths are listed.
  const listed = new Set(scoped)
  const pairs = (all: DriftPair[]): DriftPair[] => {
    const seen = new Map<string, DriftPair>()
    for (const p of all) if (listed.has(p.from) && listed.has(p.to)) seen.set(`${p.from}\0${p.to}`, p)
    return [...seen.values()].sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  }
  const result: DriftResult = {
    baseline,
    scoped,
    renamed: pairs([...committed.renamed, ...staged.renamed]),
    copied: pairs([...committed.copied, ...staged.copied]),
  }
  if (omitted > 0) result.omitted = omitted
  if (truncated) result.truncated = true
  if (omitted > 0 || truncated) {
    result.note = 'Not every changed file is listed; do not report "no drift". Rescan the sources instead.'
  }
  return result
}

export class DetectDriftTool extends ClientFreeTool<DetectDriftInput, DriftResult | DriftRefusalData> {
  readonly name = 'detect_drift'

  readonly description = `List the source files that changed since a threat model's drift baseline: commits since the baseline plus staged, unstaged and untracked changes, limited to the files discovery reads (package manifests, IaC, container and Kubernetes files).

Returns { baseline, scoped, renamed, copied }: scoped is the changed paths, relative to the repository root; a file git saw renamed or copied (committed, or staged for a rename) is listed under both of its paths, and renamed and copied pair them as { from, to }. A file whose timestamps changed without a content change may be listed too. When some paths could not be listed, the result carries "omitted" or "truncated" and a note: then never report "no drift".

Refusals carry a code: not-a-git-repo, missing-baseline, invalid-baseline, ancestry-broken (re-baseline), outside-root, not-found, git-unavailable, unsupported-repository, git-failure. Reads the repository only; never contacts the platform.`

  readonly inputSchema = InputSchema

  async execute(input: DetectDriftInput, _context: ToolContext): Promise<ToolResult<DriftResult | DriftRefusalData>> {
    try {
      return { success: true, data: await detect(input) }
    } catch (error) {
      const code: DriftRefusalCode = error instanceof DriftRefusal ? error.code : 'git-failure'
      const message = error instanceof DriftRefusal ? error.message : 'drift detection failed'
      return {
        success: false,
        error: `${code}: ${message}`,
        data: { error: code, hint: HINTS[code] }
      }
    }
  }
}

export const detectDriftTool = new DetectDriftTool()
