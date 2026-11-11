/**
 * The build-time checks on the shipped bundle, over hand-made metafiles and a
 * scratch package tree: what stays external, which files may start processes,
 * the known exception and its expiry, licenses, notices, and build-machine paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'tsup'
import { checkMetafile, CHILD_PROCESS_EXCEPTIONS, type ChildProcessException, type Metafile, shippedChecks, writeNotices } from '../metafile-checks.js'

let tmp: string
let workingDir: string

const EXCEPTION: ChildProcessException = {
  file: 'packages/lib/dist/writer.js',
  call: "execSync('git config user.email'",
  binding: '{ execSync }',
  load: "import('node:child_process')",
}
/** The shape the known exception covers: a lazy load, one destructured binding, one call. */
const WRITER = `/**
 * Resolves the operator.
 */
let _cp;
async function load() {
    if (!_cp)
        _cp = await import('node:child_process');
    return _cp;
}
export async function operator() {
    const { execSync } = await load();
    return execSync('git config user.email', { encoding: 'utf-8' }).trim();
}
`

function writeFile(rel: string, text: string): void {
  const p = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}

function pkg(name: string, license: unknown, version = '1.0.0'): string {
  const root = `node_modules/.pnpm/${name.replace('/', '+')}@${version}/node_modules/${name}`
  writeFile(`${root}/package.json`, JSON.stringify({ name, version, ...(license === undefined ? {} : { license }) }))
  writeFile(`${root}/LICENSE`, `${name} license text`)
  writeFile(`${root}/index.js`, 'export default 1')
  return path.relative(workingDir, path.join(tmp, root, 'index.js'))
}

type Import = { path: string; kind: string; external?: boolean }
function meta(inputs: Record<string, Import[]>, outputImports: Import[] = []): Metafile {
  return {
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, imports]) => [k, { bytes: 10, imports }])),
    outputs: { 'dist/index.js': { bytes: 100, imports: outputImports } },
  }
}

const check = (m: Metafile, outputs: Array<{ path: string; text: string }> = [], exceptions: readonly ChildProcessException[] = []) =>
  checkMetafile(m, workingDir, outputs, { home: '/home/builder', exceptions })

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-metafile-')))
  workingDir = path.join(tmp, 'apps', 'app')
  fs.mkdirSync(workingDir, { recursive: true })
  // The package the inputs belong to: sources are named by their path in it.
  fs.writeFileSync(path.join(workingDir, 'package.json'), JSON.stringify({ name: '@dether.net/dethereal' }))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('what stays external', () => {
  it('allows only Node built-ins imported as ES modules', () => {
    expect(check(meta({ 'src/a.ts': [] }, [{ path: 'node:fs', kind: 'import-statement', external: true }, { path: 'path', kind: 'import-statement', external: true }])).errors).toEqual([])
    expect(check(meta({}, [{ path: 'zod', kind: 'import-statement', external: true }])).errors).toEqual(['index.js: "zod" (import-statement) is not bundled'])
    expect(check(meta({}, [{ path: 'zod', kind: 'dynamic-import', external: true }])).errors).toEqual(['index.js: "zod" (dynamic-import) is not bundled'])
    // A require() left for run time fails in an ES module bundle, built-in or not.
    expect(check(meta({}, [{ path: 'punycode', kind: 'require-call', external: true }])).errors).toEqual(['index.js: require("punycode") is left for run time'])
  })

  it('judges what the bundle imports, not an input import the bundler dropped', () => {
    // A type-only import is marked external on its input and never reaches the output.
    expect(check(meta({ 'src/base.ts': [{ path: 'zod', kind: 'import-statement', external: true }] })).errors).toEqual([])
    expect(check(meta({}, [{ path: '<runtime>', kind: 'import-statement', external: true }])).errors).toEqual([])
  })
})

describe('process starts', () => {
  it('allows child_process only in the git runner and the browser launcher', () => {
    const cp: Import[] = [{ path: 'node:child_process', kind: 'import-statement', external: true }]
    expect(check(meta({ 'src/utils/git.ts': cp, 'src/auth/browser.ts': cp })).errors).toEqual([])
    expect(check(meta({ 'src/tools/x.ts': cp })).errors).toEqual(['src/tools/x.ts: imports child_process'])
    const dep = pkg('o', 'MIT')
    expect(check(meta({ [dep]: [{ path: 'child_process', kind: 'require-call', external: true }] })).errors).toEqual([`${dep}: imports child_process`])
  })

  describe('the known exception', () => {
    const input = '../../packages/lib/dist/writer.js'
    const cp: Import[] = [{ path: 'node:child_process', kind: 'dynamic-import', external: true }]

    it('passes the one excepted call', () => {
      writeFile('packages/lib/dist/writer.js', WRITER)
      expect(check(meta({ [input]: cp }), [], [EXCEPTION]).errors).toEqual([])
    })

    it.each([
      ['a second call of the same function', WRITER.replace("return execSync(", "execSync('id'); return execSync(")],
      ['another process function', WRITER + "export const s = () => _cp.spawn('sh')\n"],
      ['a second binding', WRITER + "export async function b() { const { execSync } = await load(); return 1 }\n"],
      ['a static import', "import { spawn } from 'node:child_process'\n" + WRITER],
      ['a second load', WRITER + "export const l = () => import('node:child_process')\n"],
      ['a changed call', WRITER.replace("'git config user.email'", "'git config user.name'")],
    ])('fails on %s', (_name, text) => {
      writeFile('packages/lib/dist/writer.js', text)
      expect(check(meta({ [input]: cp }), [], [EXCEPTION]).errors).toContain(`${input}: imports child_process`)
    })

    it('does not cover the same code in another file', () => {
      writeFile('packages/lib/dist/other.js', WRITER)
      const errors = check(meta({ '../../packages/lib/dist/other.js': cp }), [], [EXCEPTION]).errors
      expect(errors).toContain('../../packages/lib/dist/other.js: imports child_process')
    })

    it('fails once it matches nothing, so it is removed with the fix', () => {
      expect(check(meta({ 'src/a.ts': [] }), [], [EXCEPTION]).errors).toEqual([
        'packages/lib/dist/writer.js: the child_process exception matches nothing; remove it',
      ])
    })

    it('ships no exception: the control library no longer starts a process', () => {
      expect(CHILD_PROCESS_EXCEPTIONS).toEqual([])
    })
  })
})

describe('loaders and process starts: exact paths, other built-ins, and the output text', () => {
  const cp: Import[] = [{ path: 'node:child_process', kind: 'import-statement', external: true }]

  it('names a source by its exact path in the package: a dependency\'s file of the same name is not the git runner', () => {
    const dep = pkg('x', 'MIT').replace(/index\.js$/, 'src/utils/git.ts')
    writeFile(path.relative(tmp, path.resolve(workingDir, dep)), 'export {}')
    expect(check(meta({ [dep]: cp })).errors).toEqual([`${dep}: imports child_process`])
    expect(check(meta({ 'lib/src/utils/git.ts': cp })).errors).toEqual(['lib/src/utils/git.ts: imports child_process'])
  })

  it('refuses the other built-ins that start processes or load code, from any source', () => {
    for (const name of ['cluster', 'node:worker_threads', 'module', 'node:vm', 'inspector', 'node:wasi']) {
      expect(check(meta({ 'src/utils/git.ts': [{ path: name, kind: 'import-statement', external: true }] })).errors, name)
        .toEqual([`src/utils/git.ts: imports ${name.replace('node:', '')}`])
    }
  })

  it('fails on the ways around those imports in the output text, and on a second new Function', () => {
    const out = (text: string) => check(meta({}), [{ path: '/o/dist/b.js', text }]).errors
    expect(out('const a = import("./chunk.js"); const f = new Function("x", "return x")')).toEqual([])
    for (const [text, what] of <Array<[string, string]>>[
      ['process.binding("spawn_sync")', 'a process binding'],
      ['process["_linkedBinding"]("x")', 'a process binding'],
      ['globalThis.process.getBuiltinModule("child_process")', 'getBuiltinModule'],
      ['process.dlopen(m, p)', 'dlopen'],
      ['process.execve("/bin/sh")', 'execve'],
      ['const k = "bind" + "ing"; x[`binding`]', 'a bracketed binding'],
      ['const r = createRequire(import.meta.url)', 'createRequire'],
      ['const m = await import(name)', 'an import() of a computed name'],
    ]) expect(out(text), text).toContain(`b.js: holds ${what}`)
    expect(out('new Function("a"); new Function("b")')).toEqual(['the bundle uses Function( 2 times; 1 is allowed'])
    expect(out('new Function("a"); Function("b")')).toEqual(['the bundle uses Function( 2 times; 1 is allowed'])
    expect(out('f.constructor("return this")(); (async()=>{}).constructor(s)')).toEqual(['the bundle uses .constructor( 2 times; 1 is allowed'])
    for (const [text, what] of <Array<[string, string]>>[
      ['process?.binding("x")', 'a process binding'],
      ['const { _linkedBinding: b } = process', '_linkedBinding'],
      ['(0, eval)(s)', 'eval'],
      ['import("node:" + x)', 'an import() of a computed name'],
      ['import(`node:${x}`)', 'an import() of a computed name'],
    ]) expect(out(text), text).toContain(`b.js: holds ${what}`)
    // Ordinary words and whole literals pass.
    expect(out('const binding = 1; const doc = "a binding"; import("./a.js"); import(`./b.js`, { with: {} })')).toEqual([])
  })

  it('treats a sub-path of a banned built-in as that built-in, and the test runner and sqlite as loaders', () => {
    for (const name of ['node:inspector/promises', 'inspector/promises', 'node:test', 'node:sqlite']) {
      expect(check(meta({ 'src/tools/x.ts': [{ path: name, kind: 'import-statement', external: true }] })).errors, name)
        .toEqual([`src/tools/x.ts: imports ${name.replace('node:', '').split('/')[0]}`])
    }
  })

  it('fails when the sources cannot be named in the package, rather than skip the checks', () => {
    fs.rmSync(path.join(workingDir, 'package.json'))
    expect(check(meta({ 'src/acceptance/snapshot.ts': [] })).errors).toContain(`${workingDir}: not inside the package; its sources cannot be checked`)
  })
})

describe('development code', () => {
  it('fails the build when acceptance tooling or the generator reaches the bundle', () => {
    expect(check(meta({ 'src/acceptance/snapshot.ts': [], 'src/generator/cli.ts': [], 'src/tools/x.ts': [] })).errors).toEqual([
      'src/acceptance/snapshot.ts: development code is in the bundle',
      'src/generator/cli.ts: development code is in the bundle',
    ])
    // A library's own directory of that name is not the package's development code.
    const libGenerator = pkg('lib', 'MIT').replace(/index\.js$/, 'src/generator/a.js')
    expect(check(meta({ [libGenerator]: [] })).errors).toEqual([])
  })
})

describe('licenses and notices', () => {
  it('accepts allowlisted licenses and SPDX alternatives, and refuses others', () => {
    const inputs = {
      [pkg('a', 'MIT')]: [],
      [pkg('@s/b', 'Apache-2.0')]: [],
      [pkg('c', '(MIT OR GPL-3.0-only)')]: [],
      [pkg('d', 'GPL-3.0-only')]: [],
      [pkg('e', undefined)]: [],
      [pkg('f', { type: 'MIT' })]: [],
    }
    const { errors, packages } = check(meta(inputs))
    expect(errors.sort()).toEqual([
      'd@1.0.0: license GPL-3.0-only is not on the allowlist',
      'e@1.0.0: license UNKNOWN is not on the allowlist',
      'f@1.0.0: license UNKNOWN is not on the allowlist',
    ])
    expect(packages.map((p) => `${p.name}@${p.version} ${p.license}`)).toEqual([
      '@s/b@1.0.0 Apache-2.0', 'a@1.0.0 MIT', 'c@1.0.0 (MIT OR GPL-3.0-only)', 'd@1.0.0 GPL-3.0-only', 'e@1.0.0 UNKNOWN', 'f@1.0.0 UNKNOWN',
    ])
  })

  it('writes the notices with each license text, and the inventory', () => {
    const { packages } = check(meta({ [pkg('a', 'MIT')]: [], [pkg('b', 'ISC', '2.0.0')]: [] }))
    const out = path.join(tmp, 'dist')
    writeNotices(out, packages)
    const notices = fs.readFileSync(path.join(out, 'THIRD_PARTY_NOTICES'), 'utf8')
    expect(notices).toContain('a@1.0.0 (MIT)\n\na license text')
    expect(notices).toContain('b@2.0.0 (ISC)\n\nb license text')
    expect(JSON.parse(fs.readFileSync(path.join(out, 'bundle-inputs.json'), 'utf8'))).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT', bytes: 10 },
      { name: 'b', version: '2.0.0', license: 'ISC', bytes: 10 },
    ])
  })
})

describe('the output text', () => {
  it('holds no build-machine path and no run-time require of a missing module', () => {
    const outputs = [
      { path: '/o/dist/a.js', text: 'const p = "/home/builder/src/x.ts"' },
      { path: '/o/dist/b.js', text: `const p = ${JSON.stringify(workingDir)}` },
      { path: '/o/dist/c.js', text: 'const p = "/private/var/folders/x"' },
      { path: '/o/dist/d.js', text: 'const p = "C:\\Users\\x"' },
      { path: '/o/dist/e.js', text: 'throw Error(\'Dynamic require of "\' + x + \'" is not supported\')' },
      { path: '/o/dist/ok.js', text: 'export const ok = 1' },
      { path: '/o/dist/notes.txt', text: '/home/builder' },
    ]
    expect(check(meta({}), outputs).errors).toEqual([
      'a.js: contains a build-machine path',
      'b.js: contains a build-machine path',
      'c.js: contains a build-machine path',
      'd.js: contains a build-machine path',
      'e.js: holds a run-time require of a module it cannot serve',
    ])
  })
})

describe('a failed build', () => {
  it('reports every finding, not only the first five', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-failing-'))
    try {
      const banned = ['eval', 'getBuiltinModule', 'dlopen', 'execve', 'createRequire', '_linkedBinding', 'Dynamic require of "']
      fs.writeFileSync(path.join(dir, 'entry.ts'), `export const words = ${JSON.stringify(banned)}\n`)
      const failed = await build({
        config: false, entry: { index: path.join(dir, 'entry.ts') }, outDir: path.join(dir, 'out'), format: ['esm'],
        esbuildPlugins: [shippedChecks()], silent: true,
      }).then(() => null, (e: Error) => e)
      expect(failed).toBeInstanceOf(Error)
      for (const finding of ['eval', 'getBuiltinModule', 'dlopen', 'execve', 'createRequire', '_linkedBinding', 'a run-time require']) {
        expect(failed!.message, finding).toContain(`index.js: hold${finding === 'a run-time require' ? 's a run-time require' : `s ${finding}`}`)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
