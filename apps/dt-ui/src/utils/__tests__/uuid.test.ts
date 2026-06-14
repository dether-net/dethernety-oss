import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateUUID } from '../uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available (secure context)', () => {
    const fixed = '12345678-1234-4234-8234-1234567890ab'
    vi.stubGlobal('crypto', { randomUUID: () => fixed })
    expect(generateUUID()).toBe(fixed)
  })

  it('falls back to getRandomValues when randomUUID is missing (insecure context)', () => {
    // Simulate plain-HTTP: no randomUUID, but getRandomValues is present.
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 0xff
        return arr
      },
    })
    const id = generateUUID()
    expect(id).toMatch(V4)
  })

  it('sets the version (4) and variant (10xx) bits in the fallback', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = 0xff // all bits set
        return arr
      },
    })
    const id = generateUUID()
    // version nibble must be 4, variant nibble must be one of 8/9/a/b
    expect(id[14]).toBe('4')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
    expect(id).toMatch(V4)
  })

  it('produces distinct ids across calls in the fallback path', () => {
    let seed = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (seed++ * 7) & 0xff
        return arr
      },
    })
    expect(generateUUID()).not.toBe(generateUUID())
  })
})
