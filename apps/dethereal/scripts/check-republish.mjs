#!/usr/bin/env node
/**
 * Republish guard: if what this package *ships to a consumer* moved, its version has to go up.
 *
 * This package is published to npm, and what a consumer runs is the published tarball: the bundle
 * in dist/, the plugin root (.claude-plugin/, bundles/claude/) and the files listed beside them.
 * A change that reaches any of those without a version bump produces a repository that is fixed
 * and a registry that is not: the work is done and reaches nobody.
 *
 * That is not hypothetical. Three dependency sweeps moved `@apollo/client` and
 * `@modelcontextprotocol/sdk` forward without a version bump, and the published copy sat several
 * releases behind the source with nothing reporting a problem.
 *
 * EVERYTHING IS BUNDLED. The shipped build compiles every package it imports into dist/ (the
 * package has no runtime dependencies; a plugin install gets no node_modules). So a dependency
 * reaches the consumer as code, at whatever version the lockfile resolved at build time, whether it
 * is declared as a dependency or a devDependency. What counts is therefore:
 *
 *   - the resolved version of every package the build bundles (BUNDLED_PACKAGES, read from the
 *     lockfile at both refs; a range edit that resolves to the same version changes nothing);
 *   - the source of this package that reaches the bundle (src/, without tests, prose, fixture
 *     sources and the development code the build refuses to bundle);
 *   - the source of every workspace package it bundles (reached through a `link:` in the lockfile);
 *   - every file the tarball ships as committed (the `files` entries other than dist/);
 *   - the ranges a consumer would resolve (dependencies, peerDependencies, optionalDependencies).
 *
 * BUNDLED_PACKAGES is a list rather than a walk of the whole dependency tree, because the tree holds
 * far more than the bundle (a workspace package's UI dependencies, a test runner's helpers), and a
 * guard that fires on those cries wolf on every routine sweep, which is how a guard ends up
 * disabled. The shipped-build test keeps the list equal to the bundle's own inventory, so the list
 * cannot drift from what ships.
 *
 *   node scripts/check-republish.mjs <base-ref>
 *   node scripts/check-republish.mjs --describe     (the lists above, as JSON, for the tests)
 *
 * Compares <base-ref> against the working tree. Exits non-zero with an explanation when a republish
 * is owed, and also when the version went down.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const CONSUMER_FACING = ['dependencies', 'peerDependencies', 'optionalDependencies']

/** Every third-party package the shipped build compiles into dist/; equal to the build's inventory. */
const BUNDLED_PACKAGES = [
  '@apollo/client', '@modelcontextprotocol/sdk', '@wry/caches', '@wry/context', '@wry/equality', '@wry/trie',
  'ajv', 'ajv-formats', 'fast-deep-equal', 'fast-uri', 'graphql', 'graphql-tag', 'js-yaml', 'json-schema-traverse',
  'jsonc-parser', 'optimism', 'rxjs', 'smol-toml', 'tslib', 'zod', 'zod-to-json-schema',
]

/** Tools that run at build or test time only; their dependency trees are not walked. */
const BUILD_ONLY = new Set(['tsup', 'tsx', 'typescript', 'vitest', 'yaml'])

/** This package's development code, which the build refuses to bundle; equal to the build's own list. */
const DEV_ONLY_SOURCES = ['src/acceptance/', 'src/generator/']

/** Test-only source that nothing shipped imports. */
const TEST_ONLY_SOURCES = ['src/test-setup/']

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot, encoding: 'utf-8' }).trim()
const rel = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/')

const baseRef = process.argv[2]
const describe = baseRef === '--describe'
if (!baseRef) {
  console.error('usage: check-republish.mjs <base-ref> | --describe')
  process.exit(2)
}

/** A file as of <ref>, or null when it did not exist there. */
function fileAt(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** Files under `paths` that differ between <ref> and the working tree. */
function changedFiles(ref, paths) {
  if (paths.length === 0) return []
  const out = execFileSync('git', ['diff', '--name-only', ref, '--', ...paths], { cwd: repoRoot, encoding: 'utf-8' })
  return out.split('\n').filter(Boolean)
}

/** Source that does not enter a bundle: tests, prose, fixture sources. */
const notShippedSource = (p) =>
  /(^|\/)__tests__\//.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p) || /\.md$/.test(p) || /(^|\/)fixtures\/(.*\/)?source\//.test(p)

/** The lockfile that resolves this package: the nearest pnpm-lock.yaml at or above it. */
function findLockfile() {
  for (let dir = pkgRoot; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return dir
    if (dir === repoRoot || dir === path.dirname(dir)) return null
  }
}

const stripPeers = (version) => String(version).replace(/\(.*$/, '')

/**
 * The resolved versions of the bundled packages, and the bundled workspace packages, as one
 * lockfile resolves them: walk from this package's importer (skipping build-only tools), through
 * `link:` workspace packages' runtime dependencies, and through every resolved package's own
 * dependencies.
 */
function resolveBundle(lockText, lockDir) {
  const lock = parse(lockText) ?? {}
  const importers = lock.importers ?? {}
  const snapshots = lock.snapshots ?? {}
  const versions = new Set()
  const workspaces = new Set()
  const seen = new Set()
  const visit = (name, version) => {
    const key = `${name}@${version}`
    if (seen.has(key)) return
    seen.add(key)
    if (BUNDLED_PACKAGES.includes(name)) versions.add(`${name}@${stripPeers(version)}`)
    const snap = snapshots[key] ?? {}
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dep, v] of Object.entries(snap[field] ?? {})) visit(dep, v)
    }
  }
  const visitImporter = (importerDir, fields) => {
    const importer = importers[importerDir] ?? {}
    for (const field of fields) {
      for (const [name, entry] of Object.entries(importer[field] ?? {})) {
        if (BUILD_ONLY.has(name) || name.startsWith('@types/')) continue
        const version = String(entry?.version ?? '')
        if (version.startsWith('link:')) {
          const target = path.posix.normalize(path.posix.join(importerDir, version.slice('link:'.length)))
          if (workspaces.has(target)) continue
          workspaces.add(target)
          visitImporter(target, ['dependencies'])
        } else {
          visit(name, version)
        }
      }
    }
  }
  const self = path.relative(lockDir, pkgRoot).split(path.sep).join('/')
  visitImporter(self, ['dependencies', 'devDependencies', 'optionalDependencies'])
  return { versions, workspaces: [...workspaces].map((w) => path.join(lockDir, w)) }
}

/** -1, 0 or 1; null when either is not a plain semver version. */
function compareVersions(a, b) {
  const re = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
  const ma = re.exec(String(a))
  const mb = re.exec(String(b))
  if (!ma || !mb) return null
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d) return Math.sign(d)
  }
  if (ma[4] === mb[4]) return 0
  if (ma[4] === undefined) return 1
  if (mb[4] === undefined) return -1
  const pa = ma[4].split('.')
  const pb = mb[4].split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = /^\d+$/.test(pa[i])
    const nb = /^\d+$/.test(pb[i])
    if (na && nb && Number(pa[i]) !== Number(pb[i])) return Math.sign(Number(pa[i]) - Number(pb[i]))
    if (na !== nb) return na ? -1 : 1
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

const lockDir = findLockfile()
if (!lockDir) {
  console.error(`check-republish: no pnpm-lock.yaml at or above ${rel(pkgRoot)}; cannot tell what the bundle resolves.`)
  process.exit(2)
}
const bundleAfter = resolveBundle(readFileSync(path.join(lockDir, 'pnpm-lock.yaml'), 'utf-8'), lockDir)

if (describe) {
  console.log(JSON.stringify({
    bundledPackages: BUNDLED_PACKAGES,
    devOnlySources: DEV_ONLY_SOURCES,
    resolved: [...bundleAfter.versions].sort(),
    workspaces: bundleAfter.workspaces.map(rel).sort(),
  }))
  process.exit(0)
}

// A base the clone does not hold (a push after a force-push, a typo) is an error, never "nothing moved".
try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
} catch {
  console.error(`check-republish: ${baseRef} is not a commit in this clone; cannot compare against it.`)
  process.exit(2)
}

const manifestPath = rel(path.join(pkgRoot, 'package.json'))
const beforeText = fileAt(baseRef, manifestPath)

// A package that did not exist at the base ref is being added, not republished.
if (beforeText === null) {
  console.log(`check-republish: ${manifestPath} is new at this ref, nothing to compare.`)
  process.exit(0)
}
const before = JSON.parse(beforeText)
const after = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'))

const lockPath = rel(path.join(lockDir, 'pnpm-lock.yaml'))
const lockBefore = fileAt(baseRef, lockPath)
if (lockBefore === null) {
  console.error(`check-republish: ${lockPath} does not exist at ${baseRef}; cannot tell what the bundle resolved there.`)
  process.exit(2)
}
const bundleBefore = resolveBundle(lockBefore, lockDir)

const ranges = []
for (const field of CONSUMER_FACING) {
  const a = before[field] ?? {}
  const b = after[field] ?? {}
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[name] !== b[name]) ranges.push(`${field}.${name}: ${a[name] ?? '(absent)'} → ${b[name] ?? '(removed)'}`)
  }
}

/**
 * The manifest as it ships, without what does not reach a consumer: the version (compared on its
 * own), devDependencies (what is bundled is compared by resolved version above), the ranges (listed
 * above) and the scripts that run only in this repository. Install-time scripts do run for a
 * consumer, so they stay.
 */
function shippedManifest(m) {
  const { version: _v, devDependencies: _d, scripts, ...rest } = m
  for (const field of CONSUMER_FACING) delete rest[field]
  const install = Object.entries(scripts ?? {}).filter(([k]) => /^(pre|post)?install$/.test(k))
  if (install.length) rest.scripts = Object.fromEntries(install)
  return rest
}
const manifestBefore = shippedManifest(before)
const manifestAfter = shippedManifest(after)
const manifestFields = [...new Set([...Object.keys(manifestBefore), ...Object.keys(manifestAfter)])]
  .filter((k) => JSON.stringify(manifestBefore[k]) !== JSON.stringify(manifestAfter[k]))
  .sort()
  .map((k) => `package.json ${k}`)

const resolved = [
  ...[...bundleBefore.versions].filter((v) => !bundleAfter.versions.has(v)).map((v) => `- ${v}`),
  ...[...bundleAfter.versions].filter((v) => !bundleBefore.versions.has(v)).map((v) => `+ ${v}`),
].sort((x, y) => x.slice(2).localeCompare(y.slice(2)))

const excluded = [...DEV_ONLY_SOURCES, ...TEST_ONLY_SOURCES].map((p) => `${rel(path.join(pkgRoot, p))}/`)
const ownSource = [
  ...changedFiles(baseRef, [rel(path.join(pkgRoot, 'src'))]).filter((p) => !notShippedSource(p) && !excluded.some((x) => p.startsWith(x))),
  ...changedFiles(baseRef, [rel(path.join(pkgRoot, 'tsup.config.ts'))]),
]

const committed = [...new Set([...(before.files ?? []), ...(after.files ?? [])])].filter((f) => f !== 'dist' && !f.startsWith('dist/'))
const shippedFiles = changedFiles(baseRef, committed.map((f) => rel(path.join(pkgRoot, f))))

const workspaceSource = []
for (const dir of new Set([...bundleBefore.workspaces, ...bundleAfter.workspaces])) {
  for (const p of changedFiles(baseRef, [rel(path.join(dir, 'src'))])) if (!notShippedSource(p)) workspaceSource.push(p)
}

const total = manifestFields.length + ranges.length + resolved.length + ownSource.length + shippedFiles.length + workspaceSource.length
const order = compareVersions(after.version, before.version)

if (order !== null && order < 0) {
  console.error(`\ncheck-republish: the version went down, ${before.version} → ${after.version}. npm refuses a version it has already published; a release only moves forward.\n`)
  process.exit(1)
}

if (total === 0) {
  console.log('check-republish: nothing the published package carries moved.')
  process.exit(0)
}

if (order !== null && order > 0) {
  console.log(`check-republish: ${total} shipped change(s), and the version went up ${before.version} → ${after.version}. A republish will carry them.`)
  process.exit(0)
}

const lines = ['']
if (order === null && before.version !== after.version) {
  lines.push(`${after.name}'s version moved ${before.version} → ${after.version}, but one of them is not a plain x.y.z[-pre] version, so it cannot be told to have gone up.`, '')
} else {
  lines.push(`${after.name}'s published package would change, but its version is unchanged at ${after.version}.`, '')
}
const section = (title, items, why) => {
  if (items.length === 0) return
  lines.push(title, '', ...items.map((i) => `  ${i}`), '')
  if (why.length) lines.push(...why, '')
}
section('The shipped manifest changed:', manifestFields, [])
section('Consumer-facing dependency ranges moved:', ranges, [
  'Whoever installs this package resolves these from the ranges the published copy declares.',
])
section('A bundled package resolves to a different version:', resolved, [
  'The build compiles these into dist/, at the version the lockfile resolves; the published copy',
  'carries the old one until the version goes up.',
])
section("This package's shipped source moved:", ownSource, [])
section('A file the package ships as committed moved:', shippedFiles, [])
section('Source of a workspace package compiled into dist/ moved:', workspaceSource, [])
lines.push(
  'Raise the version in package.json, then regenerate the plugin root, which carries the same version:',
  '',
  '  pnpm --filter @dether.net/dethereal exec tsx src/generator/cli.ts --package-root',
  '',
  'src/generator/__tests__/package-root.test.ts checks that the committed plugin root matches.',
  '',
)
console.error(lines.join('\n'))
process.exit(1)
