import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * The republish guard fires on what the published artifact carries — not only on what the manifest
 * declares.
 *
 * `@dethernety/dt-core` is a devDependency that tsup bundles into dist/index.js. A guard that reads
 * dependency ranges alone reports "nothing changed" when that package's source moves, and a consumer
 * keeps running the old data layer under the same version number. That is what happened: a
 * platform-wide change to the write path passed the guard with a clean report. These cases build a
 * throwaway git repository in the same layout and prove the guard now sees it — and still ignores
 * the things that do not ship (tests, prose) so it cannot cry wolf on a routine sweep.
 *
 * The script is exercised as a process, the way CI runs it, because its file location is how it
 * finds the package and its cwd is how it finds the repository.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REAL_SCRIPT = path.join(pkgRoot, 'scripts', 'check-republish.mjs')

let repo: string
let pluginDir: string
let script: string

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })

const write = (rel: string, content: string) => {
  const full = path.join(repo, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

const manifest = (version: string, deps: Record<string, string> = { zod: '^3.0.0' }) =>
  JSON.stringify({ name: '@dether.net/fixture', version, dependencies: deps, devDependencies: { '@dethernety/dt-core': 'workspace:*' } }, null, 2)

/** Run the guard against HEAD and return what CI would see. */
const run = () => {
  try {
    const stdout = execFileSync('node', [script, 'HEAD'], { cwd: pluginDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (e: any) {
    return { status: e.status as number, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

/** Reset the working tree to the committed base between cases. */
const reset = () => git('checkout', '--', '.')

beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'check-republish-'))
  pluginDir = path.join(repo, 'apps', 'dethereal')
  script = path.join(pluginDir, 'scripts', 'check-republish.mjs')

  write('apps/dethereal/package.json', manifest('1.0.0'))
  write('apps/dethereal/tsup.config.ts', `export default { noExternal: ['@dethernety/dt-core'] }\n`)
  write('packages/dt-core/src/index.ts', 'export const a = 1\n')
  write('packages/dt-core/src/__tests__/helper.ts', 'export const h = 1\n') // under __tests__, no .test suffix
  write('packages/dt-core/src/index.test.ts', 'export const t = 1\n')       // .test suffix, beside the source
  write('packages/dt-core/src/NOTES.md', '# notes\n')
  mkdirSync(path.dirname(script), { recursive: true })
  copyFileSync(REAL_SCRIPT, script)

  git('init', '-q')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('the guard reads the bundle list from the build config', () => {
  it('passes when nothing moved', () => {
    reset()
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/no bundled source moved/)
  })

  // THE CASE THAT WAS MISSED. The manifest is untouched, so the old guard reported a clean pass —
  // while the code compiled into the artifact had changed underneath it.
  it('refuses when a bundled package\'s source moves and the version does not', () => {
    reset()
    write('packages/dt-core/src/index.ts', 'export const a = 2\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/BUNDLES/)
    expect(r.stderr).toMatch(/@dethernety\/dt-core: packages\/dt-core\/src\/index\.ts/)
  })

  it('passes the same change once the version moves', () => {
    reset()
    write('packages/dt-core/src/index.ts', 'export const a = 2\n')
    write('apps/dethereal/package.json', manifest('1.0.1'))
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/1 bundled source file\(s\) moved, and the version moved 1\.0\.0 → 1\.0\.1/)
  })
})

// Without these, the case above is satisfied by a guard that fires on ANY change under the package —
// which would demand a republish for a test edit and be switched off within a week.
describe('what does not ship does not count', () => {
  // Two exclusions, each pinned by a file that ONLY it catches. A single fixture matching both
  // would let either filter be deleted without a test noticing — measured, not supposed.
  it('ignores a helper under __tests__ even when it is not itself a test file', () => {
    reset()
    write('packages/dt-core/src/__tests__/helper.ts', 'export const h = 2\n')
    expect(run().status).toBe(0)
  })

  it('ignores a test file that lives beside the source', () => {
    reset()
    write('packages/dt-core/src/index.test.ts', 'export const t = 2\n')
    expect(run().status).toBe(0)
  })

  it('ignores a change confined to prose', () => {
    reset()
    write('packages/dt-core/src/NOTES.md', '# changed\n')
    expect(run().status).toBe(0)
  })
})

describe('the range check it always had is still there', () => {
  it('refuses a moved dependency range with an unchanged version', () => {
    reset()
    write('apps/dethereal/package.json', manifest('1.0.0', { zod: '^4.0.0' }))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/dependencies\.zod: \^3\.0\.0 → \^4\.0\.0/)
  })

  it('reports both causes together when both apply', () => {
    reset()
    write('packages/dt-core/src/index.ts', 'export const a = 3\n')
    write('apps/dethereal/package.json', manifest('1.0.0', { zod: '^4.0.0' }))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/dependency ranges moved/)
    expect(r.stderr).toMatch(/BUNDLES/)
  })
})

describe('a package with nothing bundled behaves as before', () => {
  it('reads an empty bundle list from a config with no noExternal', () => {
    reset()
    write('apps/dethereal/tsup.config.ts', `export default { entry: ['src/index.ts'] }\n`)
    write('packages/dt-core/src/index.ts', 'export const a = 9\n')
    // dt-core moved, but the build config says it is not bundled — so it is not a reason to republish.
    expect(run().status).toBe(0)
  })
})

// The fixture must actually be exercising the script this repository ships, not a stale copy.
it('runs the script that lives in this package', () => {
  expect(readFileSync(script, 'utf-8')).toBe(readFileSync(REAL_SCRIPT, 'utf-8'))
})
