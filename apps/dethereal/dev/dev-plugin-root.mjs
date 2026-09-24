#!/usr/bin/env node
/**
 * Build a Claude Code plugin root that runs THIS checkout's MCP server.
 *
 *   node dev/dev-plugin-root.mjs --out <dir> --sandbox-home <dir> [--url <platform>]
 *   claude --plugin-dir <dir>
 *
 * The published plugin starts the server with `npx @dether.net/dethereal@<version>`,
 * which runs the registry copy, not your branch. This writes a plugin root with the
 * same skills, agents, hooks and scripts, whose `.mcp.json` runs
 * `node <checkout>/dist/index.js` instead (run `pnpm build` first). The server's
 * HOME is the sandbox, so its token store and model registry never touch yours.
 *
 * Developer tooling: not in the package's `files`, never published.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const MARKER = '.dev-plugin-root'
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`dev-plugin-root: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!['--out', '--sandbox-home', '--url'].includes(flag)) fail(`unknown argument: ${flag}`)
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`)
    out[flag.slice(2)] = value
    i++
  }
  return out
}

/** The real path of `p`, resolving symlinks through its nearest existing ancestor. */
function realish(p) {
  const abs = path.resolve(p)
  let existing = abs
  while (!existsSync(existing)) existing = path.dirname(existing)
  return path.join(realpathSync(existing), path.relative(existing, abs))
}

/** Is `child` equal to or inside `parent`? */
function isWithin(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const args = parseArgs(process.argv.slice(2))
if (!args.out || !args['sandbox-home']) {
  fail('usage: node dev/dev-plugin-root.mjs --out <dir> --sandbox-home <dir> [--url <platform>]')
}

const outDir = realish(args.out)
const sandboxHome = realish(args['sandbox-home'])
const serverEntry = path.join(pkgRoot, 'dist', 'index.js')

if (!existsSync(serverEntry)) fail(`${serverEntry} does not exist — run \`pnpm build\` first`)

// The sandbox exists to keep the developer's real credentials out of reach.
const realHome = realish(homedir())
if (isWithin(realHome, sandboxHome)) fail('--sandbox-home must not be your home directory or one of its parents')

let repoRoot = realish(pkgRoot)
try {
  repoRoot = realish(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
} catch {
  // Not a git checkout: the package root is the boundary.
}
if (isWithin(outDir, repoRoot)) fail('--out must be outside the repository')
// A session signed in to the sandbox must never land in a working tree.
if (isWithin(sandboxHome, repoRoot)) fail('--sandbox-home must be outside the repository')
// Regenerating the root wipes it, which must never take the sandbox session with it.
if (isWithin(outDir, sandboxHome) || isWithin(sandboxHome, outDir)) fail('--out and --sandbox-home must not overlap')

// Only a directory this script wrote is ever wiped.
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  if (!existsSync(path.join(outDir, MARKER))) fail(`${outDir} is not empty and was not created by this script`)
  rmSync(outDir, { recursive: true, force: true })
}
mkdirSync(outDir, { recursive: true })
mkdirSync(sandboxHome, { recursive: true, mode: 0o700 })

// Everything the package publishes, except the server build and the npx launcher.
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
for (const entry of pkg.files ?? []) {
  const rel = entry.replace(/^\.\//, '').replace(/\/$/, '')
  if (rel === 'dist' || rel === '.mcp.json') continue
  const from = path.join(pkgRoot, rel)
  if (!existsSync(from)) continue
  cpSync(from, path.join(outDir, rel), { recursive: true })
}

const url = args.url ?? process.env.DETHERNETY_URL
const mcp = {
  mcpServers: {
    dethereal: {
      type: 'stdio',
      command: process.execPath,
      args: [serverEntry],
      env: { HOME: sandboxHome, ...(url ? { DETHERNETY_URL: url } : {}) }
    }
  }
}
writeFileSync(path.join(outDir, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`)
writeFileSync(path.join(outDir, MARKER), `${pkgRoot}\n`)

console.log(`Plugin root: ${outDir}`)
console.log(`Server:      ${process.execPath} ${serverEntry}`)
console.log(`HOME:        ${sandboxHome}`)
console.log(`Platform:    ${url ?? '(server default)'}`)
