/**
 * readConfig turns the TOML parser's null-prototype tables into ordinary objects, so a
 * structural compare against a plain object (as the doctor does) sees them as equal.
 */
import { describe, expect, it } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { readConfig } from '../config.js'

const SAMPLE = `stamp = 2026-11-11T00:00:00Z

[mcp_servers.dethereal]
command = "/usr/bin/node"
args = ["/runtime/dist/index.js"]

[mcp_servers.dethereal.env]
DETHERNETY_URL = "https://example.com"

[[profiles]]
name = "a"

[[profiles]]
name = "b"
`

const proto = (v: unknown) => Object.getPrototypeOf(v)

describe('readConfig', () => {
  it('returns an empty object when there are no bytes', () => {
    expect(readConfig(null, 'config.toml')).toEqual({})
  })

  it('gives every table the ordinary object prototype, nested and inside arrays', () => {
    const cfg = readConfig(Buffer.from(SAMPLE), 'config.toml')
    const server = (cfg.mcp_servers as Record<string, Record<string, unknown>>).dethereal!
    const profiles = cfg.profiles as Record<string, unknown>[]

    expect(proto(cfg)).toBe(Object.prototype)
    expect(proto(cfg.mcp_servers)).toBe(Object.prototype)
    expect(proto(server)).toBe(Object.prototype)
    expect(proto(server.env)).toBe(Object.prototype)
    expect(Array.isArray(profiles)).toBe(true)
    expect(proto(profiles[0])).toBe(Object.prototype)
    expect(proto(profiles[1])).toBe(Object.prototype)
  })

  it('compares equal to a plain object by structure (the doctor comparison)', () => {
    const cfg = readConfig(Buffer.from(SAMPLE), 'config.toml')
    const server = (cfg.mcp_servers as Record<string, Record<string, unknown>>).dethereal!
    // Without the normalisation the parser's null-prototype table is unequal to this plain object.
    expect(isDeepStrictEqual(server.env, { DETHERNETY_URL: 'https://example.com' })).toBe(true)
    expect(isDeepStrictEqual(server.args, ['/runtime/dist/index.js'])).toBe(true)
  })

  it('keeps a datetime as a Date', () => {
    const cfg = readConfig(Buffer.from(SAMPLE), 'config.toml')
    expect(cfg.stamp).toBeInstanceOf(Date)
    expect((cfg.stamp as Date).toISOString()).toBe('2026-11-11T00:00:00.000Z')
  })
})
