/**
 * Build-time checks on the shipped bundle, from esbuild's metafile. These are
 * the authoritative self-contained check: the bundle must load with nothing
 * but Node and its own files, so
 * - nothing may stay external except Node built-ins imported as ES modules
 *   (a `require()` left for run time fails in an ES module bundle, built-in or not);
 * - only the git runner, the browser launcher and the installer's harness CLI runner
 *   may import `child_process`, and
 *   nothing may import the other built-ins that start processes or load code
 *   (`cluster`, `worker_threads`, `module`, `vm`, `inspector`, `wasi`); inputs are
 *   named by their exact path in this package, never by a suffix;
 * - the output text holds none of the ways around those imports (process bindings,
 *   `getBuiltinModule`, `dlopen`, `execve`, an `import()` of a computed name), and
 *   `new Function` only as often as the allowlisted code-generating dependency uses it
 *   (a tripwire: the review of the source is the control);
 * - every bundled package must carry a license on the allowlist, and its
 *   notice is written next to the bundle (`THIRD_PARTY_NOTICES`), with an
 *   inventory (`bundle-inputs.json`) for per-release diffs;
 * - no output may contain the build machine's home or working directory;
 * - no development code (acceptance tooling, the generator) may reach the bundle.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinModules } from 'node:module'

export interface Metafile {
  inputs: Record<string, { bytes: number; imports: Array<{ path: string; kind: string; external?: boolean }> }>
  outputs: Record<string, { bytes: number; imports?: Array<{ path: string; kind: string; external?: boolean }> }>
}

/** Licenses compatible with redistribution inside an AGPL-3.0-only package. */
export const LICENSE_ALLOWLIST: ReadonlySet<string> = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0', 'Unlicense',
])
/** The package's development code, which never ships. */
export const DEV_ONLY_SOURCES: readonly string[] = ['src/acceptance/', 'src/generator/']
/** Sources that may start processes, by their path in this package. */
export const CHILD_PROCESS_IMPORTERS: readonly string[] = ['src/utils/git.ts', 'src/auth/browser.ts', 'src/installer/core/harness-cli.ts', 'src/installer/core/server-probe.ts']
/** Built-ins that start processes or load code: `child_process` only from the importers above, the rest never. */
export const LOADER_BUILTINS: readonly string[] = ['child_process', 'cluster', 'worker_threads', 'module', 'vm', 'inspector', 'wasi', 'test', 'sqlite']
/** Ways around those imports, in the output text. */
export const OUTPUT_TEXT_BANS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'a process binding', pattern: /\bprocess\s*(?:\?\.\s*|\.\s*)?(?:\[\s*['"`])?(?:binding|_linkedBinding)\b/ },
  { name: '_linkedBinding', pattern: /\b_linkedBinding\b/ },
  { name: 'eval', pattern: /\beval\b/ },
  { name: 'getBuiltinModule', pattern: /\bgetBuiltinModule\b/ },
  { name: 'dlopen', pattern: /\bdlopen\b/ },
  { name: 'execve', pattern: /\bexecve\b/ },
  { name: 'a bracketed binding', pattern: /\[\s*['"`](?:binding|_linkedBinding|getBuiltinModule|dlopen|execve)['"`]\s*\]/ },
  { name: 'createRequire', pattern: /\bcreateRequire\b/ },
  // Only one whole string literal: `import("node:" + x)` or a template with a substitution is a computed name.
  { name: 'an import() of a computed name', pattern: /\bimport\(\s*(?!(?:"[^"\\\n]*"|'[^'\\\n]*'|`[^`$\\]*`)\s*[,)])/ },
]
/**
 * Code generated at run time, counted: ajv compiles its validators with `new Function` once, and zod finds the
 * global object with `Function.prototype.constructor("return this")` once. Any other use fails the build.
 */
export const CODE_GENERATION_ALLOWED: ReadonlyArray<{ name: string; pattern: RegExp; allowed: number }> = [
  { name: 'Function(', pattern: /\bFunction\s*\(/g, allowed: 1 },
  { name: '.constructor(', pattern: /\.constructor\s*\(/g, allowed: 1 },
]


/**
 * Known process starts outside those files, each matched by its file and by the
 * exact call. Empty: an entry is added only with a reason, and the check fails
 * once an entry matches nothing, so none can outlive its cause. Any other process
 * start in an excepted file still fails.
 */
export interface ChildProcessException {
  file: string
  call: string
  binding: string
  load: string
}
export const CHILD_PROCESS_EXCEPTIONS: readonly ChildProcessException[] = []
const PROCESS_API = /\b(?:execSync|execFileSync|spawnSync|execFile|spawn|exec|fork)\b/g

/** The input's text holds the excepted call once, and no other process start. */
function exceptionHolds(text: string, exception: ChildProcessException): boolean {
  const count = (needle: string) => text.split(needle).length - 1
  if (count(exception.call) !== 1 || count(exception.binding) !== 1 || count(exception.load) !== 1) return false
  const rest = text.replace(exception.call, '').replace(exception.binding, '')
  return (rest.match(PROCESS_API) ?? []).length === 0 && !/(?:from|require\(|import\()\s*['"](?:node:)?child_process['"]/.test(rest.replace(exception.load, ''))
}

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
const bare = (p: string) => (p.startsWith('node:') ? p.slice('node:'.length) : p)

const PACKAGE_NAME = '@dether.net/dethereal'
const packageRoots = new Map<string, string | null>()
/** The directory of this package that holds `dir`, or null (a file of another package, or none). */
function packageRootOf(dir: string): string | null {
  if (packageRoots.has(dir)) return packageRoots.get(dir)!
  const manifest = path.join(dir, 'package.json')
  let found: string | null
  if (fs.existsSync(manifest)) {
    // The nearest package.json decides: this package's, or another package's file.
    try {
      found = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: unknown }).name === PACKAGE_NAME ? dir : null
    } catch {
      found = null
    }
  } else {
    const parent = path.dirname(dir)
    found = parent === dir ? null : packageRootOf(parent)
  }
  packageRoots.set(dir, found)
  return found
}
/** An input's exact path within this package (`src/...`), or null for a dependency's file. */
function packagePath(absFile: string): string | null {
  if (absFile.includes(`${path.sep}node_modules${path.sep}`)) return null
  const root = packageRootOf(path.dirname(absFile))
  return root ? path.relative(root, absFile).split(path.sep).join('/') : null
}
const isBuiltin = (p: string) => BUILTINS.has(p) || BUILTINS.has(p.split('/')[0]!)

export interface BundledPackage {
  name: string
  version: string
  license: string
  bytes: number
  licenseText: string
}

/** The package an input file belongs to, when it comes from `node_modules`. */
function packageOf(absFile: string): { root: string; name: string } | null {
  const i = absFile.lastIndexOf(`${path.sep}node_modules${path.sep}`)
  if (i < 0) return null
  const rest = absFile.slice(i + '/node_modules/'.length).split(path.sep)
  const name = rest[0]!.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]!
  return { root: absFile.slice(0, i + '/node_modules/'.length) + name, name }
}

/** SPDX expressions such as "(MIT OR Apache-2.0)" pass when any alternative is allowed. */
function licenseAllowed(license: string): boolean {
  return license.replace(/[()]/g, '').split(/\s+OR\s+/).some((l) => LICENSE_ALLOWLIST.has(l.trim()))
}

function licenseText(root: string): string {
  const files = fs.readdirSync(root).filter((f) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(f)).sort()
  return files.map((f) => fs.readFileSync(path.join(root, f), 'utf8').trim()).join('\n\n')
}

export interface CheckResult {
  errors: string[]
  packages: BundledPackage[]
}

/** Check a metafile produced from `workingDir`, and the output files' text. */
export function checkMetafile(meta: Metafile, workingDir: string, outputs: ReadonlyArray<{ path: string; text: string }>,
  options: { home?: string; exceptions?: readonly ChildProcessException[] } = {}): CheckResult {
  const exceptions = options.exceptions ?? CHILD_PROCESS_EXCEPTIONS
  const errors: string[] = []
  const packages = new Map<string, BundledPackage>()
  const usedExceptions = new Set<string>()
  // Sources are judged by their path in this package: without its root nothing could be judged.
  if (Object.keys(meta.inputs).length && !packageRootOf(path.resolve(workingDir))) errors.push(`${workingDir}: not inside the package; its sources cannot be checked`)
  for (const [input, info] of Object.entries(meta.inputs)) {
    const own = packagePath(path.resolve(workingDir, input))
    if (own && DEV_ONLY_SOURCES.some((d) => own.startsWith(d))) errors.push(`${input}: development code is in the bundle`)
    for (const imp of info.imports) {
      // A sub-path (`inspector/promises`) is the same module.
      const name = bare(imp.path).split('/')[0]!
      if (!LOADER_BUILTINS.includes(name)) continue
      if (name !== 'child_process') {
        errors.push(`${input}: imports ${name}`)
        continue
      }
      if (own && CHILD_PROCESS_IMPORTERS.includes(own)) continue
      // An exception names a file by its path from the repository: matched at a path-segment boundary, never in a dependency.
      const abs = path.resolve(workingDir, input).split(path.sep).join('/')
      const exception = abs.includes('/node_modules/') ? undefined
        : exceptions.find((e) => (own !== null && e.file === own) || abs.endsWith(`/${e.file}`))
      if (exception && exceptionHolds(fs.readFileSync(path.resolve(workingDir, input), 'utf8'), exception)) {
        usedExceptions.add(exception.file)
        continue
      }
      errors.push(`${input}: imports child_process`)
    }
    const pkg = packageOf(path.resolve(workingDir, input))
    if (!pkg) continue
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg.root, 'package.json'), 'utf8')) as { name?: string; version?: string; license?: unknown }
    const key = `${pkg.name}@${manifest.version}`
    const found = packages.get(key)
    if (found) { found.bytes += info.bytes; continue }
    const license = typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN'
    if (!licenseAllowed(license)) errors.push(`${key}: license ${license} is not on the allowlist`)
    packages.set(key, { name: pkg.name, version: String(manifest.version), license, bytes: info.bytes, licenseText: licenseText(pkg.root) })
  }
  for (const e of exceptions) {
    if (!usedExceptions.has(e.file)) errors.push(`${e.file}: the child_process exception matches nothing; remove it`)
  }
  // What the bundle itself still imports at run time (an input's type-only import never reaches it).
  for (const [output, info] of Object.entries(meta.outputs)) {
    for (const imp of info.imports ?? []) {
      if (imp.path.startsWith('<') || !imp.external) continue
      if (imp.kind === 'require-call') errors.push(`${path.basename(output)}: require("${imp.path}") is left for run time`)
      else if (!isBuiltin(imp.path)) errors.push(`${path.basename(output)}: "${imp.path}" (${imp.kind}) is not bundled`)
    }
  }
  const home = options.home ?? os.homedir()
  const needles = [home, workingDir, '/private/var/', 'C:\\Users\\'].filter((n) => n && n.length > 3)
  const generated = CODE_GENERATION_ALLOWED.map(() => 0)
  for (const { path: file, text } of outputs) {
    if (!/\.(m?js|cjs|d\.ts)$/.test(file)) continue
    const out = path.basename(file)
    for (const n of needles) if (text.includes(n)) errors.push(`${out}: contains a build-machine path`)
    if (text.includes('Dynamic require of "')) errors.push(`${out}: holds a run-time require of a module it cannot serve`)
    for (const ban of OUTPUT_TEXT_BANS) if (ban.pattern.test(text)) errors.push(`${out}: holds ${ban.name}`)
    CODE_GENERATION_ALLOWED.forEach((g, i) => { generated[i]! += (text.match(g.pattern) ?? []).length })
  }
  CODE_GENERATION_ALLOWED.forEach((g, i) => {
    if (generated[i]! > g.allowed) errors.push(`the bundle uses ${g.name} ${generated[i]} times; ${g.allowed} is allowed`)
  })
  return { errors: [...new Set(errors)], packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) }
}

/** The notices file and the inventory, written next to the bundle. */
export function writeNotices(outDir: string, packages: BundledPackage[]): void {
  fs.mkdirSync(outDir, { recursive: true })
  const notices = packages.map((p) => `${p.name}@${p.version} (${p.license})\n\n${p.licenseText || '(no license file in the package)'}`)
  fs.writeFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES'),
    `This bundle includes the following third-party packages.\n\n${notices.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`)
  fs.writeFileSync(path.join(outDir, 'bundle-inputs.json'),
    JSON.stringify(packages.map(({ name, version, license, bytes }) => ({ name, version, license, bytes })), null, 2) + '\n')
}

/** An esbuild plugin that fails the build on any check, and writes the notices. */
export function shippedChecks(): { name: string; setup(build: any): void } {
  return {
    name: 'dethereal-shipped-checks',
    setup(build) {
      build.initialOptions.metafile = true
      build.onEnd((result: { metafile?: Metafile; errors: unknown[]; outputFiles?: Array<{ path: string; text: string }> }) => {
        if (result.errors.length || !result.metafile) return
        const workingDir = build.initialOptions.absWorkingDir ?? process.cwd()
        const outputs = result.outputFiles ?? Object.keys(result.metafile.outputs).map((o) => {
          const file = path.resolve(workingDir, o)
          return { path: file, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' }
        })
        const { errors, packages } = checkMetafile(result.metafile, workingDir, outputs)
        // One message holding every finding: esbuild's thrown error lists only the first five messages.
        if (errors.length) return { errors: [{ text: `${errors.length} shipped-build check(s) failed:\n${errors.join('\n')}` }] }
        writeNotices(path.resolve(workingDir, build.initialOptions.outdir ?? 'dist'), packages)
        return undefined
      })
    },
  }
}
