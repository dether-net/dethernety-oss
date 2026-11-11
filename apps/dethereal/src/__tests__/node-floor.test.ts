/**
 * The entry point's Node floor: on an old Node every command stops, and a guard hook stops so that
 * Claude Code blocks the tool call (exit 2) instead of running it unchecked (exit 1).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { floorStop, olderThan } from '../node-floor.js'

const FLOOR = [20, 11, 1]
const OLD = '20.11.0'
const NEEDS = 'Dethereal needs Node.js 20.11.1 or newer (running 20.11.0)'

describe('the Node floor of the entry point', () => {
  it('reads versions against the floor, an unreadable one as older', () => {
    expect(olderThan('20.11.0', FLOOR)).toBe(true)
    expect(olderThan('18.20.4', FLOOR)).toBe(true)
    expect(olderThan('20.11.1', FLOOR)).toBe(false)
    expect(olderThan('20.12.0', FLOOR)).toBe(false)
    expect(olderThan('22.14.0', FLOOR)).toBe(false)
    expect(olderThan('garbage', FLOOR)).toBe(true)
  })

  it('blocks the call from a guard hook on an old Node (exit 2)', () => {
    for (const guard of ['secret-guard', 'config-guard']) {
      expect(floorStop(OLD, FLOOR, ['hook', guard, '--harness', 'claude'])).toEqual({
        code: 2,
        message: `Dethereal needs Node.js 20.11.1 or newer (found 20.11.0), so its ${guard} can't check this call and blocks it. Update Node, or turn the Dethereal plugin off with /plugin.`,
      })
    }
  })

  it('stops every other command on an old Node with exit 1, the approve hook included', () => {
    for (const args of [['hook', 'approve', '--harness', 'claude'], ['hook', 'session-start', '--source', 'startup'], ['install'], [], ['secret-guard']]) {
      expect(floorStop(OLD, FLOOR, args), args.join(' ')).toEqual({ code: 1, message: `${NEEDS}.` })
    }
  })

  it('is what the entry point stops with, before anything else loads', () => {
    const entry = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts'), 'utf8')
    const check = entry.indexOf('const stop = floorStop(process.versions.node, NODE_FLOOR, args)')
    expect(check).toBeGreaterThan(-1)
    expect(entry).toContain('process.exitCode = stop.code')
    expect(entry).toContain('process.stderr.write(`${stop.message}\\n`)')
    // the only import before the check is the floor module itself, and every dynamic import comes after it
    expect([...entry.matchAll(/^import\s.*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])).toEqual(['./node-floor.js'])
    expect(entry.indexOf('await import(')).toBeGreaterThan(check)
  })

  it('runs every command on a current Node', () => {
    for (const version of ['20.11.1', '22.14.0']) {
      for (const args of [['hook', 'secret-guard'], ['hook', 'config-guard'], ['hook', 'approve'], ['install'], []]) {
        expect(floorStop(version, FLOOR, args), `${version} ${args.join(' ')}`).toBeNull()
      }
    }
  })
})
