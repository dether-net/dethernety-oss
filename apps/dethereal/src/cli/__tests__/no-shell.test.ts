/**
 * Static checks over the shipped source (tests and fixtures excluded):
 * - no file starts processes unless it is listed here; a listed file starts only
 *   git (a literal 'git' or a resolved-binary variable), never asks for a shell,
 *   and never names one;
 * - the browser launcher starts only the fixed system launchers, never asks for
 *   a shell, and never names one;
 * - the CLI and the local workspace tool never reach the session store or the
 *   platform client, so hooks and scripts cannot touch either.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(import.meta.dirname, '..', '..')

/** Files allowed to import child_process, relative to src/. */
const PROCESS_ALLOWLIST: string[] = [
  // The one git runner.
  'utils/git.ts',
  // Development CLI for goldens and ledgers, outside the bundled entry: `git rev-parse` with fixed arguments.
  'generator/cli.ts',
]

/** The browser launcher, which starts one of the fixed system launchers and nothing else. */
const LAUNCHER = 'auth/browser.ts'

/** The installer's harness CLI runner, which starts only `claude`, `codex` or `opencode`, resolved from safe PATH entries. */
const HARNESS_CLI = 'installer/core/harness-cli.ts'

/** Doctor's server probe, which starts only a checked node, with `--version` or the server's entry file. */
const SERVER_PROBE = 'installer/core/server-probe.ts'

/** Build-time checks that name child_process to police the bundle; they are never bundled and start nothing. */
const BUILD_TIME: string[] = ['packaging/metafile-checks.ts']

/**
 * Codex's hook runner, which starts the installed runtime's CLI with node: its source and the goldens
 * generated from it. Present once the Codex target ships it.
 */
const CODEX_SHIM: string[] = [
  'generator/targets/codex/assets/hook.mjs',
  'generator/goldens/codex/bundles/codex/plugins/dethereal/bin/hook.mjs',
  'generator/package-goldens/codex/bundles/codex/plugins/dethereal/bin/hook.mjs',
]

/** OpenCode's plugin, which starts the Dethereal CLI with node: its template and the goldens generated from it. */
const OPENCODE_PLUGIN: string[] = [
  'generator/targets/opencode/plugin.ts',
  'generator/goldens/opencode/bundles/opencode/plugins/dethereal.ts',
  'generator/package-goldens/opencode/bundles/opencode/plugins/dethereal.ts',
]

function productionFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'fixtures' || entry.name === '__fixtures__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...productionFiles(full))
    else if (/\.(ts|js|mjs|cjs)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = productionFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join('/'),
  source: fs.readFileSync(file, 'utf8'),
}))

const CHILD_PROCESS = /['"`](node:)?child_process['"`]/

describe('shipped source', () => {
  it('is scanned', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.rel === 'index.ts')).toBe(true)
  })

  it('starts processes only from allowlisted files', () => {
    const offenders = files.filter((f) => CHILD_PROCESS.test(f.source) && !PROCESS_ALLOWLIST.includes(f.rel) && f.rel !== LAUNCHER && !BUILD_TIME.includes(f.rel) && !OPENCODE_PLUGIN.includes(f.rel) && !CODEX_SHIM.includes(f.rel) && f.rel !== HARNESS_CLI && f.rel !== SERVER_PROBE)
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it('starts only git, never through a shell, in a file that starts processes', () => {
    const allowed = files.filter((f) => PROCESS_ALLOWLIST.includes(f.rel))
    expect(allowed.length).toBeGreaterThan(0)
    for (const f of allowed) {
      expect(f.source, f.rel).not.toMatch(/\bshell\s*:/)
      expect(f.source, f.rel).not.toMatch(/['"`](\/bin\/)?(sh|bash|zsh|dash|cmd(\.exe)?|powershell(\.exe)?|pwsh)['"`]/)
      for (const call of f.source.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\(\s*([^,)]+)/g)) {
        const target = call[1]!.trim()
        expect(target === "'git'" || /^[A-Za-z_$][\w$]*$/.test(target), `${f.rel} starts ${target}`).toBe(true)
      }
      // child_process exec runs a shell; RegExp's .exec is not it.
      expect(f.source, f.rel).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
    }
  })

  it('starts only a resolved claude, codex or opencode, never through a shell, in the harness CLI runner', () => {
    const f = files.find((x) => x.rel === HARNESS_CLI)!
    expect(f, HARNESS_CLI).toBeDefined()
    expect([...f.source.matchAll(/^import\s[^'"]*['"]([^'"]*child_process)['"]/gm)].map((m) => m[1])).toEqual(['node:child_process'])
    expect(f.source).not.toMatch(/\bshell\s*:/)
    expect(f.source).not.toMatch(/['"`](\/bin\/)?(sh|bash|zsh|dash|cmd(\.exe)?|powershell(\.exe)?|pwsh)['"`]/)
    expect(f.source).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
    expect(f.source).not.toMatch(/\b(?:execFile|execFileSync|spawnSync|fork)\(/)
    // One start, of the binary resolved from the closed set of names.
    expect([...f.source.matchAll(/\bspawn\(\s*([^,)]+)/g)].map((m) => m[1]!.trim())).toEqual(['binary'])
    expect(f.source).toMatch(/^export type HarnessCli = 'claude' \| 'codex' \| 'opencode'$/m)
    expect(f.source).toMatch(/^ {2}const binary = resolveHarnessCli\(name, options\.projectRoot\)$/m)
  })

  it('starts only a checked node with --version or the server entry, never through a shell, in the server probe', () => {
    const f = files.find((x) => x.rel === SERVER_PROBE)!
    expect(f, SERVER_PROBE).toBeDefined()
    expect([...f.source.matchAll(/^import\s[^'"]*['"]([^'"]*child_process)['"]/gm)].map((m) => m[1])).toEqual(['node:child_process'])
    expect(f.source).not.toMatch(/\bshell\s*:/)
    expect(f.source).not.toMatch(/['"`](\/bin\/)?(sh|bash|zsh|dash|cmd(\.exe)?|powershell(\.exe)?|pwsh)['"`]/)
    expect(f.source).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
    expect(f.source).not.toMatch(/\b(?:execFile|execFileSync|spawnSync|fork)\(/)
    // One start: the node it was given, with exactly one of two argument lists, after the binary is checked.
    expect([...f.source.matchAll(/\bspawn\(\s*([^,)]+)/g)].map((m) => m[1]!.trim())).toEqual(['node'])
    expect(f.source).toMatch(/^async function spawnNode\(node: string, argv: readonly \['--version'\] \| readonly \[string\],/m)
    expect(f.source).toMatch(/^ {2}await checkExecPath\(node, installer\)$/m)
  })

  it('keeps the build-time checks free of process starts', () => {
    for (const rel of BUILD_TIME) {
      const f = files.find((x) => x.rel === rel)!
      expect(f.source, rel).not.toMatch(/^import\s[^'"]*['"](node:)?child_process['"]|(?<!['"])\bimport\(\s*['"](node:)?child_process|require\(\s*['"](node:)?child_process/m)
    }
  })

  it('starts only a fixed system launcher, never through a shell, in the browser launcher', () => {
    const f = files.find((x) => x.rel === LAUNCHER)!
    expect(CHILD_PROCESS.test(f.source)).toBe(true)
    // The one shell option is an explicit refusal.
    expect([...f.source.matchAll(/\bshell\s*:\s*(\w+)/g)].map((m) => m[1])).toEqual(['false'])
    expect(f.source).not.toMatch(/['"`](\/bin\/)?(sh|bash|zsh|dash|cmd(\.exe)?|powershell(\.exe)?|pwsh|start)['"`]/)
    expect(f.source).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
    expect(f.source).not.toMatch(/\b(?:execFile|execFileSync|spawnSync|fork)\(/)
    // One start, of the command chosen from the fixed launchers.
    const starts = [...f.source.matchAll(/\bspawn\(\s*([^,)]+)/g)].map((m) => m[1]!.trim())
    expect(starts).toEqual(['command.file'])
    const launchers = [...f.source.matchAll(/return \{ file(?:: ([^\n]+?))?, args:/g)].map((m) => m[1]?.trim() ?? 'file')
    expect(launchers).toEqual(["'/usr/bin/open'", "path.win32.join(root, 'System32', 'rundll32.exe')", 'file'])
    expect(f.source).toMatch(/const XDG_OPEN_FIXED = \['\/usr\/bin\/xdg-open', '\/usr\/local\/bin\/xdg-open'\]/)
    expect(f.source).toMatch(/XDG_OPEN_FIXED\.find\(isExecutable\) \?\? resolve\('xdg-open', projectRoot\)/)
  })

  it('starts only node with the Dethereal CLI, never through a shell, in the OpenCode plugin', () => {
    // The goldens carry secret-fallback.mjs written in by the generator; it is scanned as its own source above, and
    // here checked to be that module, verbatim, holding no way to start a process.
    const fallback = files.find((x) => x.rel === 'utils/secret-fallback.mjs')!.source
    const fallbackBody = fallback.split('\n').filter((l) => !/^import /.test(l)).map((l) => l.replace(/^export /, '')).join('\n')
    for (const rel of OPENCODE_PLUGIN) {
      const f = files.find((x) => x.rel === rel)
      expect(f, rel).toBeDefined()
      const template = rel.startsWith('generator/targets/')
      let source = f!.source
      expect([...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]), rel).toEqual(
        ['node:child_process', 'node:fs', 'node:os', 'node:path', ...(template ? ['../../../utils/secret-fallback.mjs'] : [])],
      )
      if (!template) {
        const blocks = [...source.matchAll(/^const fallback = \(\(\) => \{\n([\s\S]*?)\nreturn \{[^}\n]*\}\n\}\)\(\)$/gm)]
        expect(blocks, rel).toHaveLength(1)
        const block = blocks[0]![1]!
        expect(block, rel).toBe(fallbackBody)
        expect(block, rel).not.toMatch(/\bspawn|child_process|\bshell\s*:|(?<![.\w$])exec(Sync)?\(|\b(?:execFile|execFileSync|spawnSync|fork)\(/)
        source = source.replace(blocks[0]![0], '')
      }
      expect(source, rel).not.toMatch(/\bimport\(|\brequire\(|\bfetch\(|\bBun\.|\$`|\$\(/)
      expect(source, rel).not.toMatch(/\bshell\s*:/)
      expect(source, rel).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
      expect(source, rel).not.toMatch(/\b(?:execFile|execFileSync|spawnSync|fork)\(/)
      expect([...source.matchAll(/\bspawn\(\s*([^,)]+)/g)].map((m) => m[1]!.trim()), rel).toEqual(['NODE'])
      expect(source, rel).toMatch(/^const NODE: string = "<node-abs>"$/m)
      expect(source, rel).toMatch(/^const ENTRY: string = "<runtime>\/dist\/index\.js"$/m)
    }
  })

  it("starts only node with the runtime's CLI, never through a shell, in Codex's hook runner", () => {
    const present = CODEX_SHIM.filter((rel) => files.some((x) => x.rel === rel))
    expect([0, CODEX_SHIM.length]).toContain(present.length)
    for (const rel of present) {
      const source = files.find((x) => x.rel === rel)!.source
      for (const m of source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) expect(m[1], rel).toMatch(/^node:/)
      // Every dynamic import is of a sibling module by a literal relative name (a computed one would not
      // pass the installer's self-contained runtime check), and nothing else.
      const allowed = [...source.matchAll(/\bimport\(\s*'\.\/[\w-]+\.mjs'\s*\)/g)].length
      expect([...source.matchAll(/\bimport\(/g)].length, rel).toBe(allowed)
      expect(source, rel).not.toMatch(/\brequire\(|\bfetch\(|\bshell\s*:/)
      expect(source, rel).not.toMatch(/(?<![.\w$])exec(Sync)?\(/)
      expect(source, rel).not.toMatch(/\b(?:execFile|execFileSync|fork)\(/)
      // One more start, for session start only: Codex's own CLI (`codex mcp list --json`), from a checked
      // PATH entry, in its own process group, killed whole at a time limit.
      const spawns = [...source.matchAll(/\bspawn\(\s*([^,)]+),\s*(\[[^\]]*\])/g)].map((m) => [m[1]!.trim(), m[2]!])
      expect([[], [['cli', "['mcp', 'list', '--json']"]]], rel).toContainEqual(spawns)
      if (spawns.length) {
        expect(source, rel).toMatch(/const cli = codexCli\(/)
        expect(source, rel).toMatch(/detached: true/)
        expect(source, rel).toMatch(/process\.kill\(-child\.pid, 'SIGKILL'\)/)
        expect(source, rel).toMatch(/setTimeout\(\(\) => end\(null\), SERVER_ENV_TIMEOUT_MS\)/)
        expect(source, rel).toMatch(/if \(sub === 'session-start'\) \{\n\s*const urls = await askCodex\(/)
      }
      // The first runner starts nothing; the runner that does starts the checked node, once, with a
      // deadline, an output cap and no inherited NODE_OPTIONS or NODE_PATH.
      const starts = [...source.matchAll(/\bspawnSync\(\s*([^,)]+)/g)].map((m) => m[1]!.trim())
      expect([[], ['check.node']], rel).toContainEqual(starts)
      if (starts.length) {
        expect(source, rel).toMatch(/delete env\.NODE_OPTIONS/)
        expect(source, rel).toMatch(/delete env\.NODE_PATH/)
        expect(source, rel).toMatch(/\btimeout:/)
        expect(source, rel).toMatch(/\bmaxBuffer:/)
      }
    }
  })

  it('keeps the hook entry light: the CLI loads heavy modules only inside the command that needs them', () => {
    const light = ['index.ts', 'node-floor.ts', 'cli/index.ts', 'cli/post-write.ts', 'cli/session-start.ts', 'cli/text.ts', 'cli/config-guard.ts', 'cli/config-content.ts', 'cli/approve.ts']
    for (const rel of light) {
      const f = files.find((x) => x.rel === rel)!
      const staticImports = [...f.source.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
      for (const spec of staticImports) {
        // The tool manifest is plain data (checked below); the approve hook reads its auto set. The Node floor check
        // imports nothing, so the entry's check runs before anything else loads.
        expect(spec.startsWith('node:') || ['./node-floor.js', './session-start.js', './text.js', '../tools/manifest.js', './config-content.js', '../utils/settlement-switch.js'].includes(spec), `${rel} imports ${spec}`).toBe(true)
      }
    }
  })

  it('keeps the tool manifest plain data, so the approve hook stays light', () => {
    const f = files.find((x) => x.rel === 'tools/manifest.ts')!
    expect(f.source).not.toMatch(/^import\s+(?!type\b)/m)
    expect(f.source).not.toMatch(/\bimport\(|\brequire\(/)
    const approve = files.find((x) => x.rel === 'cli/approve.ts')!
    const specs = [...approve.source.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specs).toEqual(['../tools/manifest.js', '../utils/settlement-switch.js'])
  })

  it('keeps the settlement switch as light: it reads only the tool manifest', () => {
    const f = files.find((x) => x.rel === 'utils/settlement-switch.ts')!
    expect([...f.source.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])).toEqual(['../tools/manifest.js'])
    expect(f.source).not.toMatch(/\bimport\(|\brequire\(/)
  })

  it('keeps the config guard on node builtins and its import-free content rules, so nothing else can switch it off', () => {
    const importsOf = (rel: string) => {
      const f = files.find((x) => x.rel === rel)!
      expect(f.source, rel).not.toMatch(/\bimport\(\s*[^'"\s]/)
      return [...f.source.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2] ?? m[3])
    }
    const specs = importsOf('cli/config-guard.ts')
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) expect(spec === './config-content.js' || /^node:/.test(spec!), spec).toBe(true)
    expect(importsOf('cli/config-content.ts')).toEqual([])
  })

  it('keeps the CLI and the workspace tool away from the session store and the platform client', () => {
    const local = files.filter(
      (f) =>
        f.rel.startsWith('cli/') ||
        ['tools/workspace-status.tool.ts', 'tools/detect-drift.tool.ts', 'utils/git.ts'].includes(f.rel)
    )
    expect(local.length).toBeGreaterThan(1)
    for (const f of local) {
      const imports = [...f.source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2])
      for (const spec of imports) {
        expect(spec, `${f.rel} imports ${spec}`).not.toMatch(/(^|\/)(auth|client)(\/|$)/)
      }
    }
  })
})
