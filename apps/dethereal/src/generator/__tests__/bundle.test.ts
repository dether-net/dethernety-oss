import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { bundleJson, type BundleJson, VERSION_PLACEHOLDER } from '../bundle-json.js'
import { FIXTURE_WORKFLOW, GOLDEN_HARNESSES, GOLDENS, goldenFiles } from '../cli.js'
import { generate, generateFromSource } from '../index.js'
import { TOKEN_STORE } from '../lint.js'
import { readWorkflow, sha256, treeHash } from '../source.js'

// These tests generate or walk the whole package workflow; under a full parallel run that can take
// longer than the default per-test timeout.
vi.setConfig({ testTimeout: 60_000 })

const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }
const fixture = readWorkflow(FIXTURE_WORKFLOW)
const gen = (source: ReadonlyMap<string, string> = fixture, version = pkg.version) =>
  generateFromSource({ pkg: { ...pkg, version }, source, harness: 'claude' })
const bundleOf = (files: ReadonlyMap<string, string>) => JSON.parse(files.get('bundles/claude/bundle.json')!) as BundleJson

describe('bundle.json', () => {
  const files = gen()
  const bundle = bundleOf(files)

  it('describes the bundle', () => {
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.harness).toBe('claude')
    expect(bundle.version).toBe('1.2.3')
    expect(bundle.generatedFrom).toBe(treeHash(fixture))
    expect(bundle.placeholders).toEqual([])
    expect(bundle.runtimePathContract).toBe('~/.dethernety/runtime/current.json')
    expect(Object.keys(bundle)).toEqual([
      'schemaVersion', 'harness', 'version', 'generatedFrom', 'contentHash', 'files', 'placeholders', 'runtimePathContract',
    ])
  })

  it('lists every other generated file, sorted, with the hash of its bytes', () => {
    const others = [...files.keys()].filter((p) => p !== 'bundles/claude/bundle.json')
    expect(bundle.files.map((f) => f.path)).toEqual(others)
    expect(others).toContain('.claude-plugin/plugin.json')
    for (const f of bundle.files) expect(f.sha256).toBe(sha256(files.get(f.path)!))
  })

  it('moves generatedFrom with any workflow byte, and only then', () => {
    const edited = new Map(fixture)
    edited.set('shared/steps.md', `${fixture.get('shared/steps.md')} `)
    expect(bundleOf(gen(edited)).generatedFrom).not.toBe(bundle.generatedFrom)
    const reordered = new Map([...fixture].reverse())
    expect(bundleOf(gen(reordered)).generatedFrom).toBe(bundle.generatedFrom)
  })

  it('keeps contentHash across versions while the manifest hash moves', () => {
    const other = bundleOf(gen(fixture, '7.8.9'))
    expect(other.contentHash).toBe(bundle.contentHash)
    const manifest = (b: BundleJson) => b.files.find((f) => f.path === '.claude-plugin/plugin.json')!.sha256
    expect(manifest(other)).not.toBe(manifest(bundle))
  })

  it('reports the installer placeholders a bundle contains', () => {
    const b = bundleJson('codex', '1.0.0', 'x', new Map([['a.toml', 'command = "<node-abs>"\nargs = ["<runtime>/dist/index.js"]\n']]))
    expect(b.placeholders).toEqual(['<node-abs>', '<runtime>'])
  })
})

describe('determinism', () => {
  it('gives the same output for the same workflow, whatever order it is read in', () => {
    const a = gen()
    const shuffled = new Map([...fixture].sort(() => 0.5 - Math.random()))
    expect([...gen(shuffled)]).toEqual([...a])
    expect([...gen()]).toEqual([...a])
  })

  it('writes LF only and ends every file with a newline', () => {
    for (const [p, content] of gen()) {
      expect(content.includes('\r'), p).toBe(false)
      expect(content.endsWith('\n'), p).toBe(true)
    }
  })

  const tmp = mkdtempSync(path.join(tmpdir(), 'generator-crlf-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('reads a CRLF checkout as the same workflow', () => {
    const copy = (from: string, to: string) => {
      for (const entry of readdirSync(from)) {
        const src = path.join(from, entry)
        const dst = path.join(to, entry)
        if (statSync(src).isDirectory()) {
          mkdirSync(dst)
          copy(src, dst)
        } else writeFileSync(dst, readFileSync(src, 'utf8').replace(/\n/g, '\r\n'))
      }
    }
    copy(FIXTURE_WORKFLOW, tmp)
    expect([...generate({ pkg, workflowDir: tmp, harness: 'claude' })]).toEqual([...gen()])
  })
})

/** Every file under `dir`, by POSIX path relative to it. */
function tree(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs)) {
      const childAbs = path.join(abs, entry)
      const childRel = rel ? `${rel}/${entry}` : entry
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel)
      else files.set(childRel, readFileSync(childAbs, 'utf8'))
    }
  }
  walk(dir, '')
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)))
}

describe.each(GOLDEN_HARNESSES)('%s golden', (harness) => {
  const golden = tree(path.join(GOLDENS, harness))

  it('equals the generated fixture bundle file for file (run `pnpm golden:update` after reviewing the diff)', () => {
    const generated = goldenFiles(harness)
    expect([...golden.keys()]).toEqual([...generated.keys()])
    for (const [p, content] of generated) expect(golden.get(p), p).toBe(content)
  })

  it('differs from a real-version build only by the version', () => {
    const real = generateFromSource({ pkg: { ...pkg, version: '4.5.6' }, source: fixture, harness })
    expect([...real.keys()]).toEqual([...golden.keys()])
    for (const [p, content] of real) {
      if (p.endsWith('bundle.json')) continue
      expect(content.split('4.5.6').join(VERSION_PLACEHOLDER), p).toBe(golden.get(p))
    }
  })

  it('names no token store anywhere (token guard over the generated surface)', () => {
    expect(golden.size).toBeGreaterThan(5)
    expect([...golden].filter(([, content]) => TOKEN_STORE.test(content)).map(([p]) => p)).toEqual([])
  })
})
