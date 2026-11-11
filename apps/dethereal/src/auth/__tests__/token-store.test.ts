import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

// Redirect the token store's hardcoded ~/.dethernety into a sandbox dir.
// CONFIG_DIR is computed at module load, so the mock must be in place first.
const { mockHome } = vi.hoisted(() => ({
  mockHome: { // Unique per run: two runs of one checkout must not share a sandbox.
  dir: `${process.cwd()}/.test-auth-home-${process.pid}-${Math.random().toString(36).slice(2, 10)}` },
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('os')
  return { ...actual, homedir: () => mockHome.dir }
})

import {
  saveTokens,
  loadStoredTokens,
  clearTokens,
  clearAllTokens,
  canRefresh,
  commitRefresh,
  markRefreshRejected,
  saveSignIn,
  beginSignInEpoch,
  readLogoutEpoch,
  getTokenStoragePath,
  TOKEN_LOCK_WAIT_MS,
  type StoredTokens,
} from '../token-store.js'
import { acquireFileLock } from '../../utils/file-lock.js'
import { redactSecrets } from '../redact.js'

const BASE_URL = 'http://localhost:3003'
const OTHER_URL = 'https://other.example.test'

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

const dir = () => path.dirname(getTokenStoragePath())
const readFile = async () => JSON.parse(await fs.readFile(getTokenStoragePath(), 'utf8'))

describe('token-store', () => {
  beforeEach(async () => {
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(mockHome.dir, { recursive: true, force: true })
  })

  describe('writes', () => {
    it('saves atomically with 0600 mode, a 0700 directory, and no tmp or lock leftover', async () => {
      await saveTokens(makeTokens())

      const stat = await fs.stat(getTokenStoragePath())
      expect(stat.mode & 0o777).toBe(0o600)
      expect((await fs.stat(dir())).mode & 0o777).toBe(0o700)
      expect(await fs.readdir(dir())).toEqual(['tokens.json'])

      const loaded = await loadStoredTokens(BASE_URL)
      expect(loaded?.accessToken).toBe('access-1')
    })

    it('re-tightens a looser token file and store directory', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o755 })
      await fs.chmod(dir(), 0o755)
      await fs.writeFile(getTokenStoragePath(), JSON.stringify({ version: 1, tokens: {} }), { mode: 0o644 })

      await saveTokens(makeTokens())

      expect((await fs.stat(getTokenStoragePath())).mode & 0o777).toBe(0o600)
      expect((await fs.stat(dir())).mode & 0o777).toBe(0o700)
    })

    it('refuses a store directory that is a link, without writing through it', async () => {
      const elsewhere = path.join(mockHome.dir, 'elsewhere')
      await fs.mkdir(elsewhere, { recursive: true })
      await fs.symlink(elsewhere, dir())
      await expect(saveTokens(makeTokens())).rejects.toThrow('Failed to save tokens: session store directory is not a directory')
      expect(await fs.readdir(elsewhere)).toEqual([])
    })

    it('never follows a link planted at a tmp name, and sweeps leftover tmp files', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      const victim = path.join(mockHome.dir, 'victim')
      await fs.writeFile(victim, 'untouched')
      // Older versions' fixed tmp name, and a leftover of this version's unique names.
      await fs.symlink(victim, `${getTokenStoragePath()}.tmp`)
      await fs.writeFile(`${getTokenStoragePath()}.123.0123456789abcdef.tmp`, '{"tokens":{"x":"leftover"}}')
      await fs.writeFile(path.join(dir(), 'waiver.key'), 'not ours')

      await saveTokens(makeTokens())

      expect(await fs.readFile(victim, 'utf8')).toBe('untouched')
      expect((await fs.readdir(dir())).sort()).toEqual(['tokens.json', 'waiver.key'])
    })

    it('keeps other platforms and unknown keys on every change', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      await fs.writeFile(
        getTokenStoragePath(),
        JSON.stringify({ version: 1, extra: { keep: true }, tokens: { [OTHER_URL]: makeTokens({ baseUrl: OTHER_URL }) } })
      )
      await saveTokens(makeTokens())
      await clearTokens(BASE_URL)
      const file = await readFile()
      expect(file.extra).toEqual({ keep: true })
      expect(Object.keys(file.tokens)).toEqual([OTHER_URL])
    })

    it('loads and keeps a store written by an older version', async () => {
      // The shape older versions write: no epoch, no issuer, issuedAt on each entry.
      const legacy = {
        version: 1,
        tokens: {
          [BASE_URL]: {
            accessToken: 'access-legacy',
            idToken: 'id-legacy',
            refreshToken: 'refresh-legacy',
            expiresAt: Date.now() + 3600_000,
            baseUrl: BASE_URL,
            storedAt: 1_700_000_000_000,
            issuedAt: 1_700_000_000_000,
          },
          [OTHER_URL]: makeTokens({ baseUrl: OTHER_URL, refreshToken: 'refresh-other' }),
        },
      }
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      await fs.writeFile(getTokenStoragePath(), JSON.stringify(legacy, null, 2), { mode: 0o600 })

      const loaded = await loadStoredTokens(BASE_URL)
      expect(loaded?.accessToken).toBe('access-legacy')
      expect(canRefresh(loaded!)).toBe(true)

      await saveTokens(makeTokens({ baseUrl: OTHER_URL, refreshToken: 'refresh-other-2' }))
      expect((await loadStoredTokens(BASE_URL))?.accessToken).toBe('access-legacy')
      const removed = await clearTokens(BASE_URL)
      expect(removed.map((r) => r.refreshToken)).toEqual(['refresh-legacy'])
    })

    it('drops the old issuance bookkeeping on the next save', async () => {
      await saveTokens(makeTokens({ issuedAt: 5 }))
      expect((await loadStoredTokens(BASE_URL))?.issuedAt).toBeUndefined()
    })

    it('reads an unparsable store as no session, and a change rewrites it', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      await fs.writeFile(getTokenStoragePath(), '{ not json')
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
      await saveTokens(makeTokens())
      expect((await loadStoredTokens(BASE_URL))?.accessToken).toBe('access-1')
    })

    it('reports a read error by code, never as an empty store that would drop other sessions', async () => {
      await saveTokens(makeTokens({ baseUrl: OTHER_URL }))
      await fs.chmod(getTokenStoragePath(), 0o000)
      try {
        const err = await saveTokens(makeTokens()).then(() => undefined, (e: Error) => e)
        expect(err?.message).toBe('Failed to save tokens: EACCES')
        expect(err?.message).not.toContain(mockHome.dir)
      } finally {
        await fs.chmod(getTokenStoragePath(), 0o600)
      }
      expect((await loadStoredTokens(OTHER_URL))?.accessToken).toBe('access-1')
    })

    it('waits for a held lock only as long as its budget, then fails with a code', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      const held = await acquireFileLock(path.join(dir(), 'tokens.lock'))
      try {
        const started = Date.now()
        const err = await saveTokens(makeTokens()).then(() => undefined, (e: Error) => e)
        expect(err?.message).toBe('Failed to save tokens: the session store is busy')
        // It waited out its budget and gave up; the upper bound only says it did not wait on indefinitely.
        const waited = Date.now() - started
        expect(waited).toBeGreaterThanOrEqual(TOKEN_LOCK_WAIT_MS - 100)
        expect(waited).toBeLessThan(TOKEN_LOCK_WAIT_MS + 15_000)
      } finally {
        await held.release()
      }
    }, 30_000)

    it('registers tokens for redaction before anything can fail', async () => {
      await fs.mkdir(mockHome.dir, { recursive: true })
      await fs.writeFile(dir(), 'a file where the directory goes')
      await expect(saveTokens(makeTokens({ accessToken: 'access-token-never-saved-first' }))).rejects.toThrow()
      expect(redactSecrets('access-token-never-saved-first')).toBe('[redacted]')
    })
  })

  describe('logout', () => {
    it('removes only the platform, keeps the file, and starts a new epoch', async () => {
      await saveTokens(makeTokens())
      await saveTokens(makeTokens({ baseUrl: OTHER_URL, refreshToken: 'refresh-other' }))
      const before = await beginSignInEpoch()

      const removed = await clearTokens(BASE_URL)
      expect(removed).toEqual([{ storeKey: BASE_URL, baseUrl: BASE_URL, refreshToken: 'refresh-1', oidcDomain: undefined, oidcClientId: undefined }])
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
      expect(await loadStoredTokens(OTHER_URL)).not.toBeNull()
      expect(await readLogoutEpoch()).not.toBe(before)
    })

    it('clear-all removes every session, reports each, and leaves no session in the file', async () => {
      await saveTokens(makeTokens({ oidcDomain: 'auth.one.test', oidcClientId: 'c1' }))
      await saveTokens(makeTokens({ baseUrl: OTHER_URL, refreshToken: 'refresh-other' }))
      const removed = await clearAllTokens()
      expect(removed.map((r) => r.storeKey).sort()).toEqual([BASE_URL, OTHER_URL].sort())
      expect(removed.find((r) => r.storeKey === BASE_URL)).toMatchObject({ oidcDomain: 'auth.one.test', oidcClientId: 'c1' })
      const file = await readFile()
      expect(file.tokens).toEqual({})
      expect(typeof file.logoutEpoch).toBe('string')
    })

    it('changes the epoch even with nothing to remove', async () => {
      const before = await beginSignInEpoch()
      expect(await clearTokens(BASE_URL)).toEqual([])
      expect(await readLogoutEpoch()).not.toBe(before)
    })
  })

  describe('sign-in commit', () => {
    it('saves when no logout ran since the sign-in began', async () => {
      const epoch = await beginSignInEpoch()
      expect(await saveSignIn(makeTokens(), { expectEpoch: epoch })).toEqual({ kind: 'saved' })
      expect((await loadStoredTokens(BASE_URL))?.accessToken).toBe('access-1')
    })

    it('refuses to save after a logout, in this process or any other', async () => {
      const epoch = await beginSignInEpoch()
      await clearAllTokens()
      expect(await saveSignIn(makeTokens(), { expectEpoch: epoch })).toEqual({ kind: 'superseded' })
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
    })

    it('reads an older version deleting the file as a logout', async () => {
      const epoch = await beginSignInEpoch()
      await fs.unlink(getTokenStoragePath())
      expect(await saveSignIn(makeTokens(), { expectEpoch: epoch })).toEqual({ kind: 'superseded' })
    })

    it('gives a store without an epoch one when a sign-in begins', async () => {
      await saveTokens(makeTokens())
      expect(await readLogoutEpoch()).toBeUndefined()
      const epoch = await beginSignInEpoch()
      expect(await readLogoutEpoch()).toBe(epoch)
      expect(await beginSignInEpoch()).toBe(epoch)
    })

    it('never writes once cancelled, even while waiting for the lock', async () => {
      const epoch = await beginSignInEpoch()
      const held = await acquireFileLock(path.join(dir(), 'tokens.lock'))
      const abort = new AbortController()
      const pending = saveSignIn(makeTokens(), { expectEpoch: epoch, signal: abort.signal })
      await new Promise((r) => setTimeout(r, 50))
      abort.abort()
      await held.release()
      expect(await pending).toEqual({ kind: 'cancelled' })
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
    })

    it('returns the session it replaced, for revocation', async () => {
      await saveTokens(makeTokens({ refreshToken: 'refresh-old', oidcDomain: 'auth.one.test', oidcClientId: 'c1' }))
      const epoch = await beginSignInEpoch()
      const saved = await saveSignIn(makeTokens({ refreshToken: 'refresh-new' }), { expectEpoch: epoch })
      expect(saved).toEqual({
        kind: 'saved',
        displaced: { storeKey: BASE_URL, baseUrl: BASE_URL, refreshToken: 'refresh-old', oidcDomain: 'auth.one.test', oidcClientId: 'c1' },
      })
    })
  })

  describe('refresh commit', () => {
    it('saves while the entry still carries the refresh token the refresh used', async () => {
      await saveTokens(makeTokens())
      expect(await commitRefresh('refresh-1', makeTokens({ accessToken: 'access-2' }))).toEqual({ kind: 'saved' })
      expect((await loadStoredTokens(BASE_URL))?.accessToken).toBe('access-2')
    })

    it('saves nothing after a logout: the session stays cleared', async () => {
      await saveTokens(makeTokens())
      await clearTokens(BASE_URL)
      expect(await commitRefresh('refresh-1', makeTokens({ accessToken: 'access-2' }))).toEqual({ kind: 'gone' })
      expect(await loadStoredTokens(BASE_URL)).toBeNull()
    })

    it('yields to a session another process stored meanwhile', async () => {
      await saveTokens(makeTokens({ refreshToken: 'refresh-theirs', accessToken: 'access-theirs' }))
      const commit = await commitRefresh('refresh-1', makeTokens({ accessToken: 'access-ours', refreshToken: 'refresh-ours' }))
      expect(commit.kind).toBe('replaced')
      expect(commit.kind === 'replaced' && commit.current?.accessToken).toBe('access-theirs')
      expect((await loadStoredTokens(BASE_URL))?.accessToken).toBe('access-theirs')
    })

    it('treats an unparsable store as unknown: nothing saved, nothing inferred', async () => {
      await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
      await fs.writeFile(getTokenStoragePath(), '{ not json')
      expect(await commitRefresh('refresh-1', makeTokens())).toEqual({ kind: 'unknown' })
      expect(await fs.readFile(getTokenStoragePath(), 'utf8')).toBe('{ not json')
    })
  })

  describe('rejected refresh', () => {
    it('marks the entry instead of removing it, and a marked entry is not refreshed', async () => {
      await saveTokens(makeTokens())
      await markRefreshRejected(BASE_URL, 'refresh-1')
      const stored = await loadStoredTokens(BASE_URL)
      expect(stored?.refreshRejected).toBe(true)
      expect(canRefresh(stored!)).toBe(false)
    })

    it('never marks a session that another process already replaced', async () => {
      await saveTokens(makeTokens({ refreshToken: 'refresh-2' }))
      await markRefreshRejected(BASE_URL, 'refresh-1')
      expect((await loadStoredTokens(BASE_URL))?.refreshRejected).toBeUndefined()
    })

    it('lets a concurrent winner commit over the mark: the rejection was only the loser\'s', async () => {
      // Rotation: A and B refresh with refresh-1; A wins, B is rejected, and B's
      // rejection lands before A's commit.
      await saveTokens(makeTokens())
      await markRefreshRejected(BASE_URL, 'refresh-1')
      expect(await commitRefresh('refresh-1', makeTokens({ refreshToken: 'refresh-2', accessToken: 'access-2' }))).toEqual({ kind: 'saved' })
      const stored = await loadStoredTokens(BASE_URL)
      expect(stored?.accessToken).toBe('access-2')
      expect(stored?.refreshRejected).toBeUndefined()
    })

    it('is cleared by a new sign-in', async () => {
      await saveTokens(makeTokens())
      await markRefreshRejected(BASE_URL, 'refresh-1')
      const epoch = await beginSignInEpoch()
      await saveSignIn(makeTokens({ refreshToken: 'refresh-new' }), { expectEpoch: epoch })
      expect((await loadStoredTokens(BASE_URL))?.refreshRejected).toBeUndefined()
    })
  })
})
