import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, symlinkSync } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { stringify } from 'yaml'
import { DEV_ONLY_SOURCES } from '../packaging/metafile-checks.js'

/**
 * The republish guard fires on what the published package carries, and on nothing else.
 *
 * The shipped build bundles every package it imports, so a dependency reaches a consumer as code
 * at the version the lockfile resolved, whether it is declared as a dependency or a devDependency.
 * These cases build a throwaway git repository in the same layout (a package, a bundled workspace
 * package, a lockfile) and prove the guard sees every way the artifact can change, and still
 * ignores what does not ship (tests, prose, fixture sources, development code, build tools), so it
 * cannot cry wolf on a routine sweep.
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

const manifest = (version: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: '@dether.net/fixture',
    version,
    files: ['dist', 'bundles/claude'],
    devDependencies: { zod: '4.0.0', '@dethernety/dt-core': 'workspace:*', vitest: '^1.0.0' },
    ...extra,
  }, null, 2)

/** A lockfile resolving the package, a linked workspace package and a build tool, with transitive packages. */
const lockfile = (o: { zod?: string; zodSpec?: string; tslib?: string; vitestTslib?: string; dtCoreRxjs?: string } = {}) => {
  const zod = o.zod ?? '4.0.0'
  const tslib = o.tslib ?? '2.0.0'
  const vitestTslib = o.vitestTslib ?? '1.0.0'
  const rxjs = o.dtCoreRxjs ?? '7.0.0'
  return stringify({
    lockfileVersion: '9.0',
    importers: {
      'apps/dethereal': {
        devDependencies: {
          zod: { specifier: o.zodSpec ?? '4.0.0', version: zod },
          '@dethernety/dt-core': { specifier: 'workspace:*', version: 'link:../../packages/dt-core' },
          vitest: { specifier: '^1.0.0', version: '1.0.0' },
        },
      },
      'packages/dt-core': {
        dependencies: { graphql: { specifier: '^16.0.0', version: '16.0.0' } },
        devDependencies: { rxjs: { specifier: '^7.0.0', version: rxjs } },
      },
    },
    snapshots: {
      [`zod@${zod}`]: {},
      'graphql@16.0.0': { dependencies: { tslib } },
      [`tslib@${tslib}`]: {},
      'vitest@1.0.0': { dependencies: { tslib: vitestTslib } },
      [`tslib@${vitestTslib}`]: {},
      [`rxjs@${rxjs}`]: {},
    },
  })
}

/** Run the guard against a base ref (HEAD by default) and return what CI would see. */
const run = (base = 'HEAD') => {
  try {
    const stdout = execFileSync('node', [script, base], { cwd: pluginDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
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

  write('.gitignore', 'node_modules\n')
  write('pnpm-lock.yaml', lockfile())
  write('apps/dethereal/package.json', manifest('0.4.8'))
  write('apps/dethereal/src/index.ts', 'export const a = 1\n')
  write('apps/dethereal/src/__tests__/helper.ts', 'export const h = 1\n')
  write('apps/dethereal/src/index.test.ts', 'export const t = 1\n')
  write('apps/dethereal/src/NOTES.md', '# notes\n')
  write('apps/dethereal/src/acceptance/fixtures/shop/source/app.ts', 'export const s = 1\n')
  write('apps/dethereal/src/acceptance/score.ts', 'export const s = 1\n')
  write('apps/dethereal/src/generator/cli.ts', 'export const g = 1\n')
  write('apps/dethereal/src/test-setup/home.ts', 'export const h = 1\n')
  write('apps/dethereal/src/tools/fixtures/model/source/main.tf', 'resource "x" "y" {}\n')
  write('apps/dethereal/bundles/claude/skills/discover/SKILL.md', '# discover\n')
  write('apps/dethereal/workflow/harness/codex.yaml', 'harness: codex\n')
  write('apps/dethereal/CLAUDE.md', '# not shipped\n')
  write('apps/dethereal/tsup.config.ts', 'export default { entry: ["src/index.ts"] }\n')
  write('apps/dethereal/src/generator-utils.ts', 'export const u = 1\n')
  write('packages/dt-core/src/index.ts', 'export const a = 1\n')
  write('packages/dt-core/src/__tests__/helper.ts', 'export const h = 1\n')
  write('packages/dt-core/src/index.test.ts', 'export const t = 1\n')
  write('packages/dt-core/src/NOTES.md', '# notes\n')
  mkdirSync(path.dirname(script), { recursive: true })
  copyFileSync(REAL_SCRIPT, script)
  // The script reads the lockfile with this package's own yaml parser.
  symlinkSync(path.join(pkgRoot, 'node_modules'), path.join(pluginDir, 'node_modules'))

  git('init', '-q')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base')
  // A pre-release of the base under a tag, then the base version again on top.
  write('apps/dethereal/package.json', manifest('0.4.8-rc.1'))
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'rc')
  git('tag', 'rc')
  write('apps/dethereal/package.json', manifest('0.4.8'))
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'release')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('the version', () => {
  it('passes when nothing moved', () => {
    reset()
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/nothing the published package carries moved/)
  })

  // A version that changed is not a version that went up: npm refuses one it has already published.
  it('refuses a version that went down, even with nothing else moved', () => {
    reset()
    write('apps/dethereal/package.json', manifest('0.4.7'))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/the version went down, 0\.4\.8 → 0\.4\.7/)
  })

  it('refuses a downgrade that carries a change', () => {
    reset()
    write('apps/dethereal/src/index.ts', 'export const a = 2\n')
    write('apps/dethereal/package.json', manifest('0.4.7'))
    expect(run().status).toBe(1)
  })

  it('orders pre-releases below their release', () => {
    reset()
    write('apps/dethereal/src/index.ts', 'export const a = 2\n')
    write('apps/dethereal/package.json', manifest('0.4.8-rc.1'))
    expect(run().status).toBe(1)
    write('apps/dethereal/package.json', manifest('0.4.9-rc.1'))
    expect(run().status).toBe(0)
  })

  it('counts a release after its own pre-release as going up', () => {
    reset()
    write('apps/dethereal/src/index.ts', 'export const a = 2\n')
    const r = run('rc')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/went up 0\.4\.8-rc\.1 → 0\.4\.8/)
  })

  it('cannot tell an unparseable version went up, and says so', () => {
    reset()
    write('apps/dethereal/src/index.ts', 'export const a = 2\n')
    write('apps/dethereal/package.json', manifest('next'))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/not a plain x\.y\.z/)
  })
})

describe("this package's own shipped inputs", () => {
  it('refuses a source change with an unchanged version, and passes it once the version goes up', () => {
    reset()
    write('apps/dethereal/src/index.ts', 'export const a = 2\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/shipped source moved/)
    expect(r.stderr).toMatch(/apps\/dethereal\/src\/index\.ts/)
    expect(r.stderr).toMatch(/--package-root/)
    write('apps/dethereal/package.json', manifest('0.4.9'))
    const ok = run()
    expect(ok.status).toBe(0)
    expect(ok.stdout).toMatch(/1 shipped change\(s\), and the version went up 0\.4\.8 → 0\.4\.9/)
  })

  it('refuses a change to the build config', () => {
    reset()
    write('apps/dethereal/tsup.config.ts', 'export default { entry: ["src/other.ts"] }\n')
    expect(run().status).toBe(1)
  })

  // The development-code exclusions are directories: a shipped file beside one still counts.
  it('counts a source file whose name starts like an excluded directory', () => {
    reset()
    write('apps/dethereal/src/generator-utils.ts', 'export const u = 2\n')
    expect(run().status).toBe(1)
  })

  it('refuses a change to a file the package ships as committed', () => {
    reset()
    write('apps/dethereal/bundles/claude/skills/discover/SKILL.md', '# changed\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/ships as committed moved/)
  })

  // Each exclusion is pinned by a file only it catches, so deleting one filter fails one case.
  it.each([
    ['a helper under __tests__', 'apps/dethereal/src/__tests__/helper.ts'],
    ['a test beside the source', 'apps/dethereal/src/index.test.ts'],
    ['prose in the source', 'apps/dethereal/src/NOTES.md'],
    ['a fixture source outside the development code', 'apps/dethereal/src/tools/fixtures/model/source/main.tf'],
    ['acceptance tooling', 'apps/dethereal/src/acceptance/score.ts'],
    ['the generator', 'apps/dethereal/src/generator/cli.ts'],
    ['test setup', 'apps/dethereal/src/test-setup/home.ts'],
    ['workflow content the committed bundle does not carry', 'apps/dethereal/workflow/harness/codex.yaml'],
    ['a file the package does not list', 'apps/dethereal/CLAUDE.md'],
  ])('ignores %s', (_label, file) => {
    reset()
    write(file, '// changed\n')
    expect(run().status).toBe(0)
  })
})

describe('what the bundle resolves', () => {
  it('refuses a bundled devDependency that resolves to a new version', () => {
    reset()
    write('pnpm-lock.yaml', lockfile({ zod: '4.0.1', zodSpec: '4.0.1' }))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/- zod@4\.0\.0/)
    expect(r.stderr).toMatch(/\+ zod@4\.0\.1/)
  })

  it('refuses a transitive bundled package that moves under a workspace package', () => {
    reset()
    write('pnpm-lock.yaml', lockfile({ tslib: '2.0.1' }))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/\+ tslib@2\.0\.1/)
  })

  it('ignores a range edit that resolves to the same version', () => {
    reset()
    write('pnpm-lock.yaml', lockfile({ zodSpec: '^4.0.0' }))
    expect(run().status).toBe(0)
  })

  it("ignores a build tool's own tree", () => {
    reset()
    write('pnpm-lock.yaml', lockfile({ vitestTslib: '1.0.1' }))
    expect(run().status).toBe(0)
  })

  it("ignores a workspace package's devDependencies", () => {
    reset()
    write('pnpm-lock.yaml', lockfile({ dtCoreRxjs: '7.0.1' }))
    expect(run().status).toBe(0)
  })
})

describe('bundled workspace packages', () => {
  it('refuses a source change in a linked workspace package', () => {
    reset()
    write('packages/dt-core/src/index.ts', 'export const a = 2\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/workspace package compiled into dist\/ moved/)
    expect(r.stderr).toMatch(/packages\/dt-core\/src\/index\.ts/)
  })

  it.each([
    ['a helper under __tests__', 'packages/dt-core/src/__tests__/helper.ts'],
    ['a test beside the source', 'packages/dt-core/src/index.test.ts'],
    ['prose', 'packages/dt-core/src/NOTES.md'],
  ])('ignores %s', (_label, file) => {
    reset()
    write(file, '// changed\n')
    expect(run().status).toBe(0)
  })
})

describe('the shipped manifest', () => {
  it.each([
    ['an entry point', { bin: { fixture: 'dist/cli.js' } }],
    ['the files it ships', { files: ['dist'] }],
    ['an install-time script', { scripts: { postinstall: 'node x.js' } }],
  ])('refuses a change to %s', (_label, extra) => {
    reset()
    write('apps/dethereal/package.json', manifest('0.4.8', extra))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/shipped manifest changed/)
  })

  it('ignores a script that runs only in this repository', () => {
    reset()
    write('apps/dethereal/package.json', manifest('0.4.8', { scripts: { prepack: 'tsup', test: 'vitest run' } }))
    expect(run().status).toBe(0)
  })
})

describe('the base ref', () => {
  it('refuses a base the clone does not hold, rather than reporting nothing moved', () => {
    reset()
    expect(run('0123456789abcdef0123456789abcdef01234567').status).toBe(2)
  })
})

describe('consumer-facing ranges', () => {
  it('refuses a moved dependency range with an unchanged version', () => {
    reset()
    write('apps/dethereal/package.json', manifest('0.4.8', { dependencies: { zod: '^4.0.0' } }))
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/dependencies\.zod: \(absent\) → \^4\.0\.0/)
  })
})

it("names the build's development code exactly as the build does", () => {
  const described = JSON.parse(execFileSync('node', [REAL_SCRIPT, '--describe'], { cwd: pkgRoot, encoding: 'utf-8' })) as { devOnlySources: string[] }
  expect(described.devOnlySources).toEqual([...DEV_ONLY_SOURCES])
})

// The fixture must actually be exercising the script this repository ships, not a stale copy.
it('runs the script that lives in this package', () => {
  expect(readFileSync(script, 'utf-8')).toBe(readFileSync(REAL_SCRIPT, 'utf-8'))
})
