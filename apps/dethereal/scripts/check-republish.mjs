#!/usr/bin/env node
/**
 * Republish guard: if this package's *runtime* dependencies moved, its version has to move too.
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
 * DEVDEPENDENCIES ARE DELIBERATELY EXCLUDED. npm does not install a dependency's devDependencies,
 * so moving one changes nothing for a consumer and a guard that fired on it would cry wolf on every
 * routine sweep — which is how a guard ends up disabled. Only what an installer actually resolves
 * counts: dependencies, peerDependencies, optionalDependencies.
 *
 *   node scripts/check-republish.mjs <base-ref>
 *
 * Compares the package manifest at <base-ref> against the working tree. Exits non-zero with an
 * explanation when a republish is owed.
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

if (moved.length === 0) {
  console.log('check-republish: no consumer-facing dependency changed.')
  process.exit(0)
}

if (before.version !== after.version) {
  console.log(
    `check-republish: ${moved.length} dependency change(s), and the version moved ` +
      `${before.version} → ${after.version}. A republish will carry them.`,
  )
  process.exit(0)
}

console.error(
  [
    '',
    `${after.name} declares dependency changes but its version is unchanged at ${after.version}.`,
    '',
    ...moved.map((m) => `  ${m}`),
    '',
    'This package is published to npm. Whoever installs it resolves from the ranges the published',
    'copy declares — not from this repository\'s lockfile — so leaving the version alone ships the',
    'fix nowhere. Bump the version, and remember it is declared in three files that must agree:',
    '',
    '  package.json                 what npm publishes',
    '  .claude-plugin/plugin.json   what the plugin reports',
    '  .mcp.json                    what npx actually fetches, so what a user ends up running',
    '',
    'src/__tests__/mcp-config.test.ts checks that those three agree once you have bumped them.',
    '',
  ].join('\n'),
)
process.exit(1)
