#!/usr/bin/env node
/**
 * Build a Claude Code plugin root that runs THIS checkout's workflow and MCP server.
 *
 *   node dev/dev-plugin-root.mjs --out <dir> --sandbox-home <dir> [--url <platform>]
 *   claude --plugin-dir <dir>
 *
 * The root is the generator's Claude bundle for `workflow/` (the same skills, agents and
 * hooks the package ships), with its MCP server and hooks running `node <checkout>/dist/index.js`
 * (run `pnpm build` first). The server's HOME is the sandbox, so its token store and model
 * registry never touch yours; the hooks read only the project directory. Re-run after changing
 * the workflow; `--out` must be outside the repository, and only a directory this command wrote
 * is ever replaced.
 *
 * Developer tooling: not in the package's `files`, never published.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const args = parseArgs(process.argv.slice(2))
if (!args.out || !args['sandbox-home']) {
  fail('usage: node dev/dev-plugin-root.mjs --out <dir> --sandbox-home <dir> [--url <platform>]')
}

const serverEntry = path.join(pkgRoot, 'dist', 'index.js')
if (!existsSync(serverEntry)) fail(`${serverEntry} does not exist — run \`pnpm build\` first`)
const tsx = path.join(pkgRoot, 'node_modules', '.bin', 'tsx')
if (!existsSync(tsx)) fail('tsx is not installed — run `pnpm install` first')

const url = args.url ?? process.env.DETHERNETY_URL
try {
  // The generator refuses an --out or --sandbox-home inside the repository, a sandbox that holds
  // your home directory, overlapping directories, and a non-empty --out it did not write.
  execFileSync(
    tsx,
    [
      path.join(pkgRoot, 'src', 'generator', 'cli.ts'),
      '--harness', 'claude',
      '--workflow', path.join(pkgRoot, 'workflow'),
      '--out', args.out,
      '--mcp-entry', serverEntry,
      '--sandbox-home', args['sandbox-home'],
      ...(url ? ['--url', url] : []),
    ],
    { cwd: pkgRoot, stdio: 'inherit' },
  )
} catch {
  process.exit(1)
}

console.log(`Server:   ${process.execPath} ${serverEntry}`)
console.log(`HOME:     ${path.resolve(args['sandbox-home'])}`)
console.log(`Platform: ${url ?? '(server default)'}`)
