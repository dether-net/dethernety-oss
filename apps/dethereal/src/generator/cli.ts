/**
 * Command line for the generator (run with tsx).
 *
 * Scratch root — a plugin root outside the repository, for loading a workflow into a harness:
 *
 *   tsx src/generator/cli.ts --harness claude --workflow <dir> --out <dir>
 *       [--mcp-entry <abs dist/index.js> --sandbox-home <dir> [--url <platform url>]] [--settlement]
 *
 * With --mcp-entry the root runs that server build under this node binary, with HOME set to the
 * sandbox so its session and registry never touch yours. With --settlement the root turns the
 * server's settlement on (the package root never does). Only a directory this command created
 * is ever replaced.
 *
 * Package root — the bundles this package ships, at the package's version: the Claude plugin
 * (`.claude-plugin/plugin.json` and `bundles/claude/`) and the Codex and OpenCode bundles
 * (`bundles/codex/`, `bundles/opencode/`), which the installer copies into its runtime. Stale files
 * under each bundle directory are removed; nothing else is touched, and the root must hold none of
 * the paths Claude Code would load on top of the manifest:
 *
 *   tsx src/generator/cli.ts --package-root
 *
 * Goldens — regenerate the version-normalised goldens of the fixture workflow (`goldens/`) and of
 * the package's own workflow (`package-goldens/`), and the package root with them:
 *
 *   tsx src/generator/cli.ts --update-goldens
 *
 * Rule ledger (see ledger.ts):
 *
 *   tsx src/generator/cli.ts --ledger-baseline          record every source's blob and rule count
 *   tsx src/generator/cli.ts --ledger-init <source>     create or refresh that source's ledger file
 *   tsx src/generator/cli.ts --ledger-show <source>     print the source's rules: id, line, text
 *   tsx src/generator/cli.ts --ledger-place <source> --into <workflow file>
 *                                                       place the rules that survive verbatim there
 *   tsx src/generator/cli.ts --ledger-check             check every ledger; exit 1 on findings
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VERSION_PLACEHOLDER } from './bundle-json.js'
import { generate } from './index.js'
import {
  autoPlace,
  BASELINE_FILE,
  checkLedgers,
  computeBaseline,
  initLedger,
  LEDGER_DIR,
  legacyNames,
  ledgerFileFor,
  listSources,
  ledgerYaml,
  parseLedger,
  readLedgerInput,
} from './ledger.js'
import { readWorkflow } from './source.js'
import { LEGACY_ROOT_PATHS } from './targets/claude/index.js'
import { targetFor } from './targets/index.js'
import { renderText } from './tokens.js'
import { extractRules } from './rules.js'
import { type Harness, HARNESSES, type PackageInfo } from './types.js'

export const MARKER = '.generated-root'
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FIXTURE_WORKFLOW = path.join(PKG_ROOT, 'src', 'generator', 'fixtures', 'workflow', 'source')
export const GOLDENS = path.join(PKG_ROOT, 'src', 'generator', 'goldens')
export const WORKFLOW = path.join(PKG_ROOT, 'workflow')
export const PACKAGE_GOLDENS = path.join(PKG_ROOT, 'src', 'generator', 'package-goldens')
/** Harnesses the goldens cover. */
export const GOLDEN_HARNESSES: readonly Harness[] = ['claude', 'codex', 'opencode']

class UsageError extends Error {}

/** The real path of `p`, resolving symlinks through its nearest existing ancestor. */
function realish(p: string): string {
  const abs = path.resolve(p)
  let existing = abs
  while (!existsSync(existing)) existing = path.dirname(existing)
  return path.join(realpathSync(existing), path.relative(existing, abs))
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function repoRoot(): string {
  try {
    return realish(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: PKG_ROOT, encoding: 'utf8' }).trim())
  } catch {
    return realish(PKG_ROOT)
  }
}

function readPkg(): PackageInfo {
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as PackageInfo
  return { name: pkg.name, version: pkg.version }
}

/** Writes `files` under `dir`; every path must stay inside it. */
export function writeTree(dir: string, files: ReadonlyMap<string, string>): void {
  for (const [rel, content] of files) {
    const abs = path.resolve(dir, rel)
    if (path.isAbsolute(rel) || !isWithin(abs, dir) || abs === dir) throw new Error(`refusing to write outside ${dir}: ${rel}`)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
}

export interface ScratchOptions {
  readonly harness: Harness
  readonly workflow: string
  readonly out: string
  readonly mcpEntry?: string
  readonly sandboxHome?: string
  readonly url?: string
  readonly settlement?: boolean
  /** For tests: the repository boundary and home directory to check against. */
  readonly repo?: string
  readonly home?: string
}

/** Generates a scratch root; returns the number of files written. */
export function writeScratchRoot(options: ScratchOptions): number {
  const out = realish(options.out)
  const repo = options.repo ? realish(options.repo) : repoRoot()
  if (isWithin(out, repo)) throw new UsageError('--out must be outside the repository')
  if ((options.mcpEntry === undefined) !== (options.sandboxHome === undefined)) {
    throw new UsageError('--mcp-entry and --sandbox-home go together')
  }
  if (options.url !== undefined && options.mcpEntry === undefined) throw new UsageError('--url needs --mcp-entry')

  let mcpEntry
  if (options.mcpEntry !== undefined && options.sandboxHome !== undefined) {
    const entry = realish(options.mcpEntry)
    const sandbox = realish(options.sandboxHome)
    if (!existsSync(entry)) throw new UsageError(`${entry} does not exist — build the server first`)
    const home = realish(options.home ?? homedir())
    if (isWithin(home, sandbox)) throw new UsageError('--sandbox-home must not be your home directory or one of its parents')
    if (isWithin(sandbox, repo)) throw new UsageError('--sandbox-home must be outside the repository')
    if (isWithin(out, sandbox) || isWithin(sandbox, out)) throw new UsageError('--out and --sandbox-home must not overlap')
    mkdirSync(sandbox, { recursive: true, mode: 0o700 })
    mcpEntry = { node: process.execPath, entry, home: sandbox, ...(options.url ? { url: options.url } : {}) }
  }

  // The package's own workflow may still name skills and agents that have not moved into it.
  const own = realish(options.workflow) === realish(WORKFLOW)
  const files = generate({
    pkg: readPkg(),
    workflowDir: options.workflow,
    harness: options.harness,
    ...(mcpEntry ? { mcpEntry } : {}),
    ...(own ? { externalNames: legacyNames(PKG_ROOT) } : {}),
    ...(options.settlement ? { settlement: true } : {}),
  })

  if (existsSync(out) && readdirSync(out).length > 0) {
    if (!existsSync(path.join(out, MARKER))) throw new UsageError(`${out} is not empty and was not created by this command`)
    rmSync(out, { recursive: true, force: true })
  }
  mkdirSync(out, { recursive: true })
  writeTree(out, files)
  writeFileSync(path.join(out, MARKER), `${options.harness}\n`)
  return files.size
}

/** The fixture workflow's bundle for `harness`, version-normalised. */
export function goldenFiles(harness: Harness): Map<string, string> {
  return generate({ pkg: { ...readPkg(), version: VERSION_PLACEHOLDER }, workflowDir: FIXTURE_WORKFLOW, harness })
}

/** The package's own workflow bundle for `harness`, version-normalised; skills and agents not yet in it count as known. */
export function packageGoldenFiles(harness: Harness): Map<string, string> {
  return generate({ pkg: { ...readPkg(), version: VERSION_PLACEHOLDER }, workflowDir: WORKFLOW, harness, externalNames: legacyNames(PKG_ROOT) })
}

/** The harnesses whose bundles this package ships at its root. */
export const PACKAGE_ROOT_HARNESSES = ['claude', 'codex', 'opencode'] as const satisfies readonly Harness[]

/** Every bundle file this package ships at its root, at the package's version. */
export function packageRootFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const harness of PACKAGE_ROOT_HARNESSES) {
    for (const [p, content] of generate({ pkg: readPkg(), workflowDir: WORKFLOW, harness })) {
      if (files.has(p)) throw new Error(`two targets emitted ${p}`)
      files.set(p, content)
    }
  }
  return files
}

/** Where the package root's generated files live: the Claude manifest, and one directory per harness bundle. */
export const PACKAGE_ROOT_DIRS = {
  manifest: '.claude-plugin/plugin.json',
  bundles: PACKAGE_ROOT_HARNESSES.map((h) => `bundles/${h}`),
} as const

function listFiles(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  )
}

/** The generated files committed at the package root, by path. */
export function committedPackageRootFiles(pkgRoot = PKG_ROOT): Map<string, string> {
  const paths = [
    ...(existsSync(path.join(pkgRoot, PACKAGE_ROOT_DIRS.manifest)) ? [PACKAGE_ROOT_DIRS.manifest] : []),
    ...PACKAGE_ROOT_DIRS.bundles.flatMap((dir) => listFiles(path.join(pkgRoot, dir), `${dir}/`)),
  ]
  return new Map(paths.map((p) => [p, readFileSync(path.join(pkgRoot, p), 'utf8')] as const))
}

/** Writes every shipped bundle into the package root; returns the number of files written. */
export function writePackageRoot(pkgRoot = PKG_ROOT): number {
  const present = LEGACY_ROOT_PATHS.filter((p) => existsSync(path.join(pkgRoot, p)))
  if (present.length > 0) throw new UsageError(`remove ${present.join(', ')} from the package root first: Claude Code loads them on top of the manifest`)
  const files = packageRootFiles()
  for (const p of files.keys()) {
    if (p !== PACKAGE_ROOT_DIRS.manifest && !PACKAGE_ROOT_DIRS.bundles.some((dir) => p.startsWith(`${dir}/`))) throw new Error(`a target emitted ${p}, outside the package-root paths`)
  }
  for (const dir of PACKAGE_ROOT_DIRS.bundles) rmSync(path.join(pkgRoot, dir), { recursive: true, force: true })
  writeTree(pkgRoot, files)
  return files.size
}

/** Rewrites `goldens/<harness>/` and `package-goldens/<harness>/` for every golden harness; nothing else is touched. */
export function updateGoldens(): number {
  let count = 0
  for (const harness of GOLDEN_HARNESSES) {
    for (const [root, files] of [
      [GOLDENS, goldenFiles(harness)],
      [PACKAGE_GOLDENS, packageGoldenFiles(harness)],
    ] as const) {
      const dir = path.join(root, harness)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      writeTree(dir, files)
      count += files.size
    }
  }
  return count
}

/** Rewrites the baseline from the sources in the tree; returns the rule total. */
export function writeBaseline(pkgRoot = PKG_ROOT): number {
  const sources = new Map(listSources(pkgRoot).map((p) => [p, readFileSync(path.join(pkgRoot, p), 'utf8')] as const))
  const baseline = computeBaseline(sources)
  writeFileSync(path.join(pkgRoot, BASELINE_FILE), `${JSON.stringify(baseline, null, 2)}\n`)
  return baseline.total
}

function ledgerSource(source: string, pkgRoot: string): string {
  if (!listSources(pkgRoot).includes(source)) throw new UsageError(`not a ledger source: ${source} (see the baseline for the list)`)
  return readFileSync(path.join(pkgRoot, source), 'utf8')
}

/** Creates or refreshes the ledger of one source; returns the ids no longer in it. */
export function writeLedgerInit(source: string, pkgRoot = PKG_ROOT): string[] {
  const text = ledgerSource(source, pkgRoot)
  const file = path.join(pkgRoot, LEDGER_DIR, ledgerFileFor(source))
  const existing = existsSync(file) ? parseLedger(ledgerFileFor(source), readFileSync(file, 'utf8')).doc : undefined
  const { yaml, removed } = initLedger(source, text, existing)
  writeFileSync(file, yaml)
  return removed
}

/**
 * Places the pending rules of `source` whose text survives in the workflow file `into`, checked
 * against its rendering for every harness with a target. Returns placed and still-pending counts.
 */
export function writeLedgerPlace(source: string, into: string, pkgRoot = PKG_ROOT): { placed: number; pending: number } {
  const text = ledgerSource(source, pkgRoot)
  const file = path.join(pkgRoot, LEDGER_DIR, ledgerFileFor(source))
  if (!existsSync(file)) throw new UsageError(`no ledger for ${source}; run --ledger-init first`)
  const parsed = parseLedger(ledgerFileFor(source), readFileSync(file, 'utf8'))
  if (!parsed.doc) throw new Error(parsed.findings.map((f) => f.message).join('; '))
  const workflow = readWorkflow(path.join(pkgRoot, 'workflow'))
  const destination = workflow.get(into)
  if (destination === undefined) throw new UsageError(`${into} is not a workflow file`)
  const renderings = HARNESSES.flatMap((h) => {
    const target = targetFor(h)
    return target ? [renderText(destination, { harness: h, renderer: target.renderer, shared: (p) => workflow.get(p), allowAsFile: true }).text] : []
  })
  const { doc, placed } = autoPlace(parsed.doc, text, into, renderings)
  writeFileSync(file, ledgerYaml(doc))
  return { placed, pending: doc.rules.filter((r) => !('anchor' in r) && !('dropped' in r)).length }
}

const FLAGS = ['--update-goldens', '--package-root', '--ledger-baseline', '--ledger-check', '--settlement']

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const valued = ['--harness', '--workflow', '--out', '--mcp-entry', '--sandbox-home', '--url', '--ledger-init', '--ledger-show', '--ledger-place', '--into']
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    if (FLAGS.includes(flag)) {
      out[flag.slice(2)] = true
      continue
    }
    if (!valued.includes(flag)) throw new UsageError(`unknown argument: ${flag}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    out[flag.slice(2)] = value
    i++
  }
  return out
}

export function main(argv: readonly string[]): number {
  try {
    const args = parseArgs(argv)
    if (typeof args['ledger-place'] === 'string') {
      if (typeof args.into !== 'string' || Object.keys(args).length !== 2) throw new UsageError('--ledger-place <source> needs --into <workflow file> and nothing else')
      const { placed, pending } = writeLedgerPlace(args['ledger-place'], args.into)
      console.log(`${ledgerFileFor(args['ledger-place'])}: ${placed} placed in ${args.into}; ${pending} still pending`)
      return 0
    }
    const command = ['update-goldens', 'package-root', 'ledger-baseline', 'ledger-check', 'ledger-init', 'ledger-show'].filter((k) => k in args)
    if (command.length > 0 && Object.keys(args).length > 1) throw new UsageError(`--${command[0]} takes no other arguments`)
    if (args['update-goldens']) {
      console.log(`goldens: ${updateGoldens()} files; package root: ${writePackageRoot()} files`)
      return 0
    }
    if (args['package-root']) {
      console.log(`package root: ${writePackageRoot()} files`)
      return 0
    }
    if (args['ledger-baseline']) {
      console.log(`baseline: ${writeBaseline()} rules`)
      return 0
    }
    if (typeof args['ledger-init'] === 'string') {
      const removed = writeLedgerInit(args['ledger-init'])
      console.log(`${ledgerFileFor(args['ledger-init'])} written${removed.length ? `; no longer in the source: ${removed.join(', ')}` : ''}`)
      return 0
    }
    if (typeof args['ledger-show'] === 'string') {
      for (const rule of extractRules(ledgerSource(args['ledger-show'], PKG_ROOT))) console.log(`${rule.id}\t${rule.line}\t${rule.kind}\t${rule.text.replace(/\n/g, '\\n')}`)
      return 0
    }
    if (args['ledger-check']) {
      const report = checkLedgers(readLedgerInput(PKG_ROOT, readPkg()))
      for (const f of report.findings) console.error(`${f.file}${f.line ? `:${f.line}` : ''} ${f.message}`)
      const c = report.counts
      console.log(
        `ledger: ${c.placed} placed (${c.unconsumed} not yet included by any skill or agent), ${c.dropped} dropped, ${c.pending} pending, ` +
          `${c.unchecked} checks skipped (harness without a target); ${report.findings.length} finding(s)`,
      )
      return report.findings.length ? 1 : 0
    }
    const harness = args.harness
    if (typeof harness !== 'string' || !(HARNESSES as readonly string[]).includes(harness)) {
      throw new UsageError(`--harness must be one of ${HARNESSES.join(', ')}`)
    }
    if (typeof args.workflow !== 'string' || typeof args.out !== 'string') throw new UsageError('--workflow and --out are required')
    const count = writeScratchRoot({
      harness: harness as Harness,
      workflow: args.workflow,
      out: args.out,
      ...(typeof args['mcp-entry'] === 'string' ? { mcpEntry: args['mcp-entry'] } : {}),
      ...(typeof args['sandbox-home'] === 'string' ? { sandboxHome: args['sandbox-home'] } : {}),
      ...(typeof args.url === 'string' ? { url: args.url } : {}),
      ...(args.settlement ? { settlement: true } : {}),
    })
    console.log(`${harness}: ${count} files → ${realish(args.out)}`)
    return 0
  } catch (err) {
    console.error(`generator: ${(err as Error).message}`)
    return err instanceof UsageError ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realish(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
