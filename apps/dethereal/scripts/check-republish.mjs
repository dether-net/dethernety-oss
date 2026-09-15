#!/usr/bin/env node
/**
 * Republish guard: if what this package *ships to a consumer* moved, its version has to move too.
 *
 * This package is published to npm, and a published package's dependencies are resolved by whoever
 * installs it — from the ranges the published tarball declares, not from any lockfile in this
 * repository. So a dependency sweep that bumps a range here and does not bump the version produces
 * a repository that is fixed and a registry that is not: the work is done and reaches nobody.
 *
 * That is not hypothetical. Three sweeps moved `@apollo/client` and `@modelcontextprotocol/sdk`
 * forward without a version bump, and the published copy sat several ranges behind the source with
 * nothing reporting a problem — CI was green, the lockfile was correct, and every install still got
 * the old resolution.
 *
 * DEVDEPENDENCIES ARE DELIBERATELY EXCLUDED — WITH ONE EXCEPTION. npm does not install a
 * dependency's devDependencies, so moving one changes nothing for a consumer and a guard that fired
 * on it would cry wolf on every routine sweep — which is how a guard ends up disabled. Only what an
 * installer actually resolves counts: dependencies, peerDependencies, optionalDependencies.
 *
 * The exception is a devDependency that tsup BUNDLES (`noExternal` in tsup.config.ts). That one
 * reaches the consumer as code, not as a range: it is compiled into dist/index.js, and whoever runs
 * the published package runs whatever version of it was in the tree at build time. A change to its
 * source is a change to the published artifact, and the version has to move for exactly the reason
 * above — otherwise the fix exists here and ships nowhere. This guard was blind to that until a
 * platform-wide change to the bundled data layer passed it with "no consumer-facing dependency
 * changed", which was true of the declarations and false of the artifact.
 *
 *   node scripts/check-republish.mjs <base-ref>
 *
 * Compares the package manifest — and the source of every bundled workspace package — at <base-ref>
 * against the working tree. Exits non-zero with an explanation when a republish is owed.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONSUMER_FACING = ['dependencies', 'peerDependencies', 'optionalDependencies']

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim()
const manifestPath = path.relative(repoRoot, path.join(pkgRoot, 'package.json'))

const baseRef = process.argv[2]
if (!baseRef) {
  console.error('usage: check-republish.mjs <base-ref>')
  process.exit(2)
}

/** The manifest as of <base-ref>, or null when it did not exist there. */
function manifestAt(ref) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${manifestPath}`], { encoding: 'utf-8' }))
  } catch {
    return null
  }
}

/**
 * The workspace packages tsup compiles INTO this package, read from tsup.config.ts rather than
 * declared twice — the build config is the one place that decides what is bundled, and a list kept
 * here would drift from it silently.
 */
function bundledWorkspacePackages() {
  let text
  try {
    text = readFileSync(path.join(pkgRoot, 'tsup.config.ts'), 'utf-8')
  } catch {
    return []
  }
  const block = text.match(/noExternal\s*:\s*\[([^\]]*)\]/)
  if (!block) return []
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((n) => n.startsWith('@dethernety/'))
}

/**
 * Source files of a bundled package that changed between <base-ref> and the working tree.
 * Tests and prose do not enter the bundle, so they are not a reason to republish.
 */
function bundledSourceChanges(ref, pkgName) {
  const srcDir = path.join(pkgRoot, '..', '..', 'packages', pkgName.replace('@dethernety/', ''), 'src')
  const rel = path.relative(repoRoot, srcDir)
  let out
  try {
    out = execFileSync('git', ['diff', '--name-only', ref, '--', rel], { cwd: repoRoot, encoding: 'utf-8' })
  } catch {
    return []
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !/(^|\/)__tests__\//.test(p))
    .filter((p) => !/\.test\.[cm]?[jt]sx?$/.test(p))
    .filter((p) => !/\.md$/.test(p))
}

const before = manifestAt(baseRef)
const after = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'))

// A package that did not exist at the base ref is being added, not republished.
if (!before) {
  console.log(`check-republish: ${manifestPath} is new at this ref — nothing to compare.`)
  process.exit(0)
}

const moved = []
for (const field of CONSUMER_FACING) {
  const a = before[field] ?? {}
  const b = after[field] ?? {}
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[name] !== b[name]) moved.push(`${field}.${name}: ${a[name] ?? '(absent)'} → ${b[name] ?? '(removed)'}`)
  }
}

const bundled = []
for (const pkgName of bundledWorkspacePackages()) {
  for (const file of bundledSourceChanges(baseRef, pkgName)) bundled.push(`${pkgName}: ${file}`)
}

if (moved.length === 0 && bundled.length === 0) {
  console.log('check-republish: no consumer-facing dependency changed, and no bundled source moved.')
  process.exit(0)
}

if (before.version !== after.version) {
  console.log(
    `check-republish: ${moved.length} dependency change(s) and ${bundled.length} bundled source file(s) ` +
      `moved, and the version moved ${before.version} → ${after.version}. A republish will carry them.`,
  )
  process.exit(0)
}

const lines = ['', `${after.name}'s published artifact would change, but its version is unchanged at ${after.version}.`, '']

if (moved.length > 0) {
  lines.push(
    'Consumer-facing dependency ranges moved:',
    '',
    ...moved.map((m) => `  ${m}`),
    '',
    'Whoever installs this package resolves from the ranges the published copy declares — not from',
    "this repository's lockfile — so leaving the version alone ships these moves nowhere.",
    '',
  )
}

if (bundled.length > 0) {
  lines.push(
    'Source of a package tsup BUNDLES into dist/index.js moved:',
    '',
    ...bundled.map((b) => `  ${b}`),
    '',
    'A devDependency is normally invisible to a consumer, because npm never installs it. A bundled',
    'one is the opposite: its code is compiled into the artifact, so whoever runs the published',
    'package runs whatever version of it was in the tree at build time. Changing it changes what',
    'ships — and until the version moves, what ships is the OLD code under the same number.',
    '',
  )
}

lines.push(
  'Bump the version, and remember it is declared in three files that must agree:',
  '',
  '  package.json                 what npm publishes',
  '  .claude-plugin/plugin.json   what the plugin reports',
  '  .mcp.json                    what npx actually fetches, so what a user ends up running',
  '',
  'src/__tests__/mcp-config.test.ts checks that those three agree once you have bumped them.',
  '',
)

console.error(lines.join('\n'))
process.exit(1)
