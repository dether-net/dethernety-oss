import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

// Redirect the token store's hardcoded ~/.dethernety into a sandbox dir.
// CONFIG_DIR is computed at module load, so the mock must be in place first.
const { mockHome } = vi.hoisted(() => ({
  mockHome: { dir: `${process.cwd()}/.test-auth-home` },
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

import {
  saveTokens,
  loadStoredTokens,
  clearAllTokens,
  isRefreshTokenValid,
  getTokenStoragePath,
  type StoredTokens,
} from '../token-store.js'

const BASE_URL = 'http://localhost:3003'

function makeTokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: 'access-1',
    idToken: 'id-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3600_000,
    baseUrl: BASE_URL,
    storedAt: 0,
    ...overrides,
  }
}

describe('token-store', () => {
  beforeEach(async () => {
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  it('saves atomically with 0600 mode and no tmp leftover', async () => {
    await saveTokens(makeTokens())

    const tokensFile = getTokenStoragePath()
    const stat = await fs.stat(tokensFile)
    expect(stat.mode & 0o777).toBe(0o600)
    await expect(fs.access(`${tokensFile}.tmp`)).rejects.toThrow()

    const loaded = await loadStoredTokens(BASE_URL)
    expect(loaded?.accessToken).toBe('access-1')
  })

  it('re-tightens permissions on a pre-existing looser token file', async () => {
    const tokensFile = getTokenStoragePath()
    await fs.mkdir(path.dirname(tokensFile), { recursive: true })
    await fs.writeFile(tokensFile, JSON.stringify({ version: 1, tokens: {} }), { mode: 0o644 })

    await saveTokens(makeTokens())

    const stat = await fs.stat(tokensFile)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('preserves issuedAt across saves with the same refresh token, resets on rotation', async () => {
    vi.useFakeTimers()
    const t0 = new Date('2026-06-01T00:00:00Z').getTime()

    vi.setSystemTime(t0)
    await saveTokens(makeTokens())
    let loaded = await loadStoredTokens(BASE_URL)
    expect(loaded?.issuedAt).toBe(t0)
    expect(loaded?.storedAt).toBe(t0)

    // Non-rotating refresh: storedAt advances, issuedAt does not.
    vi.setSystemTime(t0 + 5 * 24 * 60 * 60 * 1000)
    await saveTokens(makeTokens({ accessToken: 'access-2' }))
    loaded = await loadStoredTokens(BASE_URL)
    expect(loaded?.issuedAt).toBe(t0)
    expect(loaded?.storedAt).toBe(t0 + 5 * 24 * 60 * 60 * 1000)

    // Rotated refresh token: issuedAt resets.
    vi.setSystemTime(t0 + 10 * 24 * 60 * 60 * 1000)
    await saveTokens(makeTokens({ refreshToken: 'refresh-2' }))
    loaded = await loadStoredTokens(BASE_URL)
    expect(loaded?.issuedAt).toBe(t0 + 10 * 24 * 60 * 60 * 1000)
  })

  it('isRefreshTokenValid measures from issuance, not the last save', () => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    // Refresh-saved five minutes ago but ISSUED 30 days ago → invalid.
    expect(isRefreshTokenValid(makeTokens({ storedAt: now - 300_000, issuedAt: thirtyDaysAgo }))).toBe(false)

    // Issued recently → valid.
    expect(isRefreshTokenValid(makeTokens({ storedAt: now, issuedAt: now - 24 * 60 * 60 * 1000 }))).toBe(true)

    // Legacy entry without issuedAt falls back to storedAt.
    expect(isRefreshTokenValid(makeTokens({ storedAt: now - 24 * 60 * 60 * 1000 }))).toBe(true)
  })

  it('clearAllTokens removes the token file', async () => {
    await saveTokens(makeTokens())
    await clearAllTokens()
    expect(await loadStoredTokens(BASE_URL)).toBeNull()
  })
})
