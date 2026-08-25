import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Drift guard: a script that ships must not read a file that doesn't.
 *
 * `scripts/` is in package.json's `files`; `src/` is not. `scripts/detect-drift.js`
 * reads `src/utils/source-globs.v1.json` at runtime, so the published package
 * carried the reader without the file and every installed user got an uncaught
 * ENOENT — not even the `{message, hint}` JSON the threat-model skill parses on a
 * non-zero exit, just a Node stack trace. Nothing in the repo could see it: the
 * file is right there in a dev checkout, so tests, lint and a local run all pass.
 *
 * The only place the absence is visible is the packed file list, which is what
 * this test reads.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'))
const files: string[] = pkg.files ?? []

/** Does `files` publish this package-relative path? */
function isPublished(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join('/')
  return files.some((entry) => {
    const e = entry.replace(/^\.\//, '').replace(/\/$/, '')
    return normalized === e || normalized.startsWith(`${e}/`)
  })
}

/**
 * Package-relative paths a script resolves at runtime, from
 * `join(__dirname, '..', 'a', 'b')` chains. Only string literals — a computed
 * segment is not something a static check can follow, and pretending otherwise
 * would make this test lie about its own coverage.
 */
function packageRelativeReads(source: string): string[] {
  const out: string[] = []
  const call = /join\(\s*__dirname\s*,\s*'\.\.'\s*((?:,\s*'[^']+'\s*)+)\)/g
  for (const m of source.matchAll(call)) {
    const segments = [...m[1]!.matchAll(/'([^']+)'/g)].map((s) => s[1]!)
    if (segments.length > 0) out.push(segments.join('/'))
  }
  return out
}

describe('published scripts only read published files', () => {
  const scriptsDir = path.join(pkgRoot, 'scripts')
  const scripts = readdirSync(scriptsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))

  it('ships every runtime file a shipped script resolves against the package root', () => {
    const unpublished: string[] = []
    for (const script of scripts) {
      const source = readFileSync(path.join(scriptsDir, script), 'utf-8')
      for (const relPath of packageRelativeReads(source)) {
        if (!isPublished(relPath)) unpublished.push(`${script} reads ${relPath}`)
      }
    }
    expect(unpublished).toEqual([])
  })

  it('actually finds the reads it is meant to guard', () => {
    // A regex that silently matches nothing would make the test above pass by
    // doing nothing at all — the failure mode this whole guard exists to catch.
    const detectDrift = readFileSync(path.join(scriptsDir, 'detect-drift.js'), 'utf-8')
    expect(packageRelativeReads(detectDrift)).toContain('src/utils/source-globs.v1.json')
  })
})
