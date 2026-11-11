/**
 * Token Store
 *
 * Persists OAuth sessions in ~/.dethernety/tokens.json, one entry per platform.
 *
 * Several processes share the store: one server per harness session (Codex starts
 * one per agent), plus the CLI. Every change is a read-modify-write under one
 * cross-process lock, and the change itself is a synchronous function of the file:
 * no network call can run while the lock is held. Work that needs the network
 * (refresh, sign-in, revocation) happens outside the lock, and its result is
 * committed afterwards only if the store still says what the work started from:
 *
 * - a refresh commits only while the entry still carries the refresh token it used
 *   (compare-and-swap), so a logout that ran meanwhile stays a logout;
 * - a browser sign-in commits only while the store's logout epoch is the one it
 *   read when the sign-in began, so a logout in any session cancels it.
 *
 * Reads take no lock: every write is a whole-file rename.
 */

import { readFile, mkdir, unlink, rename, chmod, lstat, open, readdir } from 'fs/promises'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { debug } from '../config.js'
import { registerSecret } from './redact.js'
import { withFileLock } from '../utils/file-lock.js'

/** Directory for storing Dethernety config and tokens */
const CONFIG_DIR = join(homedir(), '.dethernety')

/** Token storage file path */
const TOKENS_FILE = join(CONFIG_DIR, 'tokens.json')

/** The lock serialising every change to the token file. */
const LOCK_FILE = join(CONFIG_DIR, 'tokens.lock')

/** How long a commit (sign-in, refresh) waits for another process's change. */
export const TOKEN_LOCK_WAIT_MS = 3_000

/** How long a logout waits: it must clear the session, so it waits longer. */
export const LOGOUT_LOCK_WAIT_MS = 5_000

/** A change holds the lock for milliseconds; a holder this old is wedged (e.g. a suspended process). */
const TOKEN_LOCK_MAX_HOLD_MS = 30_000

/** Leftover tmp files: this version's unique names and the fixed name older versions used. */
const ORPHAN_TMP = /^tokens\.json\.(?:\d+\.[0-9a-f]{16}\.)?tmp$/

/**
 * Stored token data
 */
export interface StoredTokens {
  /** OAuth access token — the bearer sent to the platform and to any resource server behind it */
  accessToken: string
  /** OIDC identity token — carries the profile claims; not used as a bearer */
  idToken: string
  /**
   * The scope actually granted for this session, as the provider reports it.
   *
   * Absent on records written before this field existed. Readers must fall back
   * to the access token's own `scope` claim rather than treating the absence as
   * a mismatch — see `grantedScopeOf` in ./scope.ts.
   */
  grantedScope?: string
  /** OAuth refresh token for obtaining new access tokens */
  refreshToken: string
  /** Unix timestamp when the access token expires */
  expiresAt: number
  /** Base URL of the platform these tokens are for */
  baseUrl: string
  /** Timestamp when tokens were stored (reset on every save) */
  storedAt: number
  /**
   * The identity provider that issued the session, recorded at save. Logout
   * revokes the refresh token only there. Absent on records from older versions.
   */
  oidcDomain?: string
  /** The client the session was issued to, recorded with `oidcDomain`. */
  oidcClientId?: string
  /**
   * The provider rejected this refresh token. The entry is kept (only logout
   * removes entries) but is never refreshed again; a new sign-in replaces it.
   */
  refreshRejected?: boolean
  /** Written by older versions; ignored. */
  issuedAt?: number
}

/**
 * Token file structure (supports multiple platforms). Unknown top-level keys are
 * kept on every write.
 */
interface TokenFile {
  version: number
  tokens: Record<string, unknown>
  /** Rewritten by every logout; a sign-in saves only if it is unchanged since the sign-in began. */
  logoutEpoch?: string
  [key: string]: unknown
}

/** A session removed by a logout, reduced to what revocation needs. */
export interface RemovedSession {
  /** The key the entry was stored under. */
  storeKey: string
  baseUrl?: string
  refreshToken?: string
  oidcDomain?: string
  oidcClientId?: string
}

/** Outcome of a refresh commit. */
export type RefreshCommit =
  /** The entry carried the refresh token the refresh used; the new tokens are stored. */
  | { kind: 'saved' }
  /** The entry is gone: a logout ran. Nothing is stored. */
  | { kind: 'gone' }
  /** The entry now holds another session (another process refreshed, or a new sign-in). */
  | { kind: 'replaced'; current: StoredTokens | null }
  /** The store could not be parsed; nothing is stored. */
  | { kind: 'unknown' }

/** Outcome of a sign-in commit. */
export type SessionCommit =
  | { kind: 'saved'; displaced?: RemovedSession }
  /** A logout ran since the sign-in began. */
  | { kind: 'superseded' }
  /** The sign-in was cancelled while waiting to save. */
  | { kind: 'cancelled' }

/**
 * A filesystem error reduced to its code. The message of a Node fs error carries
 * the absolute path of the file involved, and these errors reach the model
 * through `login` and `logout`.
 */
function fsErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown error'
}

/** An error whose message is fixed text, safe for model-visible output. */
class StoreError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'StoreError'
  }
}

/**
 * Is this record usable as a session? A hand-edited or half-written store can hold
 * anything, and a non-numeric `expiresAt` would otherwise read as "not expired".
 */
function isWellFormed(tokens: unknown): tokens is StoredTokens {
  const t = tokens as Partial<StoredTokens> | null
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.accessToken === 'string' &&
    typeof t.idToken === 'string' &&
    typeof t.refreshToken === 'string' &&
    typeof t.baseUrl === 'string' &&
    typeof t.expiresAt === 'number' &&
    !Number.isNaN(new Date(t.expiresAt).getTime()) &&
    (t.grantedScope === undefined || typeof t.grantedScope === 'string') &&
    (t.oidcDomain === undefined || typeof t.oidcDomain === 'string') &&
    (t.oidcClientId === undefined || typeof t.oidcClientId === 'string') &&
    (t.refreshRejected === undefined || typeof t.refreshRejected === 'boolean')
  )
}

/**
 * Generate a key for storing tokens by platform URL
 * Normalizes the URL to handle trailing slashes, etc.
 */
export function getTokenKey(baseUrl: string): string {
  const url = new URL(baseUrl)
  return `${url.protocol}//${url.host}`
}

function emptyFile(): TokenFile {
  return { version: 1, tokens: {} }
}

function newEpoch(): string {
  return randomBytes(8).toString('hex')
}

type FileRead = { state: 'ok'; file: TokenFile } | { state: 'unparsable' }

/**
 * Read the token file. Absent → empty. Unparsable → reported as such. Any other
 * read error throws with its code only: reading it as empty would let the next
 * write drop every other platform's session.
 */
async function readTokenFile(): Promise<FileRead> {
  let content: string
  try {
    content = await readFile(TOKENS_FILE, 'utf-8')
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') return { state: 'ok', file: emptyFile() }
    throw new StoreError(fsErrorCode(error))
  }
  try {
    const parsed = JSON.parse(content) as Partial<TokenFile> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'unparsable' }
    if (typeof parsed.tokens !== 'object' || parsed.tokens === null || Array.isArray(parsed.tokens)) {
      return { state: 'unparsable' }
    }
    return { state: 'ok', file: parsed as TokenFile }
  } catch {
    return { state: 'unparsable' }
  }
}

/**
 * The store directory must be a real directory owned by this user; it is
 * (re)tightened to 0700 before every change. Checked before the lock, whose files
 * live in it.
 */
async function prepareConfigDir(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new StoreError(fsErrorCode(error))
  }
  let stat
  try {
    stat = await lstat(CONFIG_DIR)
  } catch (error) {
    throw new StoreError(fsErrorCode(error))
  }
  if (!stat.isDirectory()) throw new StoreError('session store directory is not a directory')
  const uid = process.getuid?.()
  if (uid !== undefined && stat.uid !== uid) throw new StoreError('session store directory is owned by another user')
  if ((stat.mode & 0o777) !== 0o700) await chmod(CONFIG_DIR, 0o700)
}

/** Remove tmp files left by a crashed writer. Every writer holds the lock, so none is in flight. */
async function sweepOrphans(): Promise<void> {
  let names: string[]
  try {
    names = await readdir(CONFIG_DIR)
  } catch {
    return
  }
  for (const name of names) {
    if (!ORPHAN_TMP.test(name)) continue
    const file = join(CONFIG_DIR, name)
    try {
      // Unlinking a link removes the link, never its target.
      const stat = await lstat(file)
      if (stat.isFile() || stat.isSymbolicLink()) await unlink(file)
    } catch {
      // Gone already, or not ours to remove.
    }
  }
}

/**
 * Write the token file: a unique tmp created exclusively with 0600, flushed, then
 * renamed over the store — but only while the lock is still ours.
 */
async function writeTokenFile(tokenFile: TokenFile, assertHeld: () => Promise<void>): Promise<void> {
  const tmpFile = `${TOKENS_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  let created = false
  try {
    const handle = await open(tmpFile, 'wx', 0o600)
    created = true
    try {
      await handle.writeFile(JSON.stringify(tokenFile, null, 2))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await assertHeld()
    await rename(tmpFile, TOKENS_FILE)
    created = false
  } finally {
    if (created) await unlink(tmpFile).catch(() => undefined)
  }
}

/**
 * Change the store under the lock. `change` is synchronous on purpose: nothing
 * slow, and above all no network call, can happen while the lock is held. It
 * returns its result and whether the file must be written.
 */
async function updateTokenFile<T>(
  change: (file: TokenFile, read: FileRead['state']) => { result: T; write: boolean },
  waitMs: number
): Promise<T> {
  await prepareConfigDir()
  return withFileLock(
    LOCK_FILE,
    async (handle) => {
      await sweepOrphans()
      const read = await readTokenFile()
      const file = read.state === 'ok' ? read.file : emptyFile()
      const { result, write } = change(file, read.state)
      if (write) await writeTokenFile(file, () => handle.assertHeld())
      return result
    },
    { waitMs, maxHoldMs: TOKEN_LOCK_MAX_HOLD_MS, label: 'tokens.lock' }
  )
}

/** Why a store operation failed, as a code or fixed text (never a path). */
function failure(error: unknown): string {
  if (error instanceof StoreError) return error.code
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'busy') return 'the session store is busy'
  if (code === 'lost') return 'the session store lock was taken over'
  return fsErrorCode(error)
}

function asRemoved(storeKey: string, entry: unknown): RemovedSession {
  const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  registerSecret(e.accessToken, e.idToken, e.refreshToken)
  return {
    storeKey,
    baseUrl: str(e.baseUrl),
    refreshToken: str(e.refreshToken),
    oidcDomain: str(e.oidcDomain),
    oidcClientId: str(e.oidcClientId)
  }
}

function withoutLegacy(tokens: StoredTokens): StoredTokens {
  const { issuedAt: _issuedAt, refreshRejected: _rejected, ...rest } = tokens
  return { ...rest, storedAt: Date.now() }
}

/**
 * Load stored tokens for a specific platform
 *
 * @param baseUrl - Platform base URL
 * @returns Stored tokens or null if not found/expired
 */
export async function loadStoredTokens(baseUrl: string): Promise<StoredTokens | null> {
  try {
    const read = await readTokenFile()
    if (read.state !== 'ok') {
      debug('Ignoring an unreadable session store')
      return null
    }
    const key = getTokenKey(baseUrl)
    const tokens = read.file.tokens[key]

    if (!tokens) {
      debug(`No stored tokens found for ${key}`)
      return null
    }

    if (!isWellFormed(tokens)) {
      debug(`Ignoring malformed stored session for ${key}`)
      return null
    }
    registerSecret(tokens.accessToken, tokens.idToken, tokens.refreshToken)

    // Check if tokens match the requested baseUrl
    if (getTokenKey(tokens.baseUrl) !== key) {
      debug(`Token baseUrl mismatch`)
      return null
    }

    debug(`Loaded stored tokens for ${key}`)
    return tokens
  } catch (error) {
    debug(`Error loading tokens: ${failure(error)}`)
    return null
  }
}

/**
 * Save tokens for a platform unconditionally.
 *
 * @param tokens - Tokens to save
 */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  // Registered before anything can fail, so no later error or log line can carry them.
  registerSecret(tokens.accessToken, tokens.idToken, tokens.refreshToken)
  try {
    const key = getTokenKey(tokens.baseUrl)
    await updateTokenFile((file) => {
      file.tokens[key] = withoutLegacy(tokens)
      return { result: undefined, write: true }
    }, TOKEN_LOCK_WAIT_MS)
    debug(`Saved tokens for ${key}`)
  } catch (error) {
    debug(`Error saving tokens: ${failure(error)}`)
    throw new Error(`Failed to save tokens: ${failure(error)}`, { cause: error })
  }
}

/** The store's current logout epoch, or undefined when it has none (no lock taken). */
export async function readLogoutEpoch(): Promise<string | undefined> {
  const read = await readTokenFile().catch(() => ({ state: 'unparsable' }) as const)
  if (read.state !== 'ok') return undefined
  return typeof read.file.logoutEpoch === 'string' ? read.file.logoutEpoch : undefined
}

/**
 * The logout epoch a sign-in starts from. A store without one gets one now, so
 * that a later logout — including an older version deleting the file — always
 * reads as a change.
 */
export async function beginSignInEpoch(): Promise<string> {
  const current = await readLogoutEpoch()
  if (current) return current
  try {
    return await updateTokenFile((file) => {
      if (typeof file.logoutEpoch === 'string') return { result: file.logoutEpoch, write: false }
      file.logoutEpoch = newEpoch()
      return { result: file.logoutEpoch, write: true }
    }, TOKEN_LOCK_WAIT_MS)
  } catch (error) {
    throw new Error(`Failed to prepare the session store: ${failure(error)}`, { cause: error })
  }
}

/**
 * Commit a browser sign-in. It is stored only if no logout ran since the sign-in
 * began (`expectEpoch`) and it was not cancelled meanwhile (`signal`). A different
 * session it replaces is returned so that it can be revoked.
 */
export async function saveSignIn(
  tokens: StoredTokens,
  options: { expectEpoch: string; signal?: AbortSignal }
): Promise<SessionCommit> {
  registerSecret(tokens.accessToken, tokens.idToken, tokens.refreshToken)
  try {
    const key = getTokenKey(tokens.baseUrl)
    return await updateTokenFile<SessionCommit>((file) => {
      if (options.signal?.aborted) return { result: { kind: 'cancelled' }, write: false }
      if (file.logoutEpoch !== options.expectEpoch) return { result: { kind: 'superseded' }, write: false }
      const previous = file.tokens[key]
      const displaced =
        previous && (previous as { refreshToken?: unknown }).refreshToken !== tokens.refreshToken
          ? asRemoved(key, previous)
          : undefined
      file.tokens[key] = withoutLegacy(tokens)
      return { result: { kind: 'saved', ...(displaced?.refreshToken ? { displaced } : {}) }, write: true }
    }, TOKEN_LOCK_WAIT_MS)
  } catch (error) {
    debug(`Error saving tokens: ${failure(error)}`)
    throw new Error(`Failed to save tokens: ${failure(error)}`, { cause: error })
  }
}

/**
 * Commit a refresh: store `tokens` only while the platform's entry still carries
 * `baseRefreshToken`, the refresh token the refresh was made with.
 */
export async function commitRefresh(baseRefreshToken: string, tokens: StoredTokens): Promise<RefreshCommit> {
  registerSecret(tokens.accessToken, tokens.idToken, tokens.refreshToken)
  try {
    const key = getTokenKey(tokens.baseUrl)
    return await updateTokenFile<RefreshCommit>((file, read) => {
      if (read === 'unparsable') return { result: { kind: 'unknown' }, write: false }
      const current = file.tokens[key]
      if (!current) return { result: { kind: 'gone' }, write: false }
      if (!isWellFormed(current) || current.refreshToken !== baseRefreshToken) {
        return { result: { kind: 'replaced', current: isWellFormed(current) ? current : null }, write: false }
      }
      file.tokens[key] = withoutLegacy(tokens)
      return { result: { kind: 'saved' }, write: true }
    }, TOKEN_LOCK_WAIT_MS)
  } catch (error) {
    debug(`Error saving refreshed tokens: ${failure(error)}`)
    throw new Error(`Failed to save tokens: ${failure(error)}`, { cause: error })
  }
}

/**
 * Record that the provider rejected `rejectedRefreshToken`, if the entry still
 * carries it. The entry is kept: only a logout removes entries, so a commit that
 * finds its entry gone can trust that a logout ran.
 */
export async function markRefreshRejected(baseUrl: string, rejectedRefreshToken: string): Promise<void> {
  try {
    const key = getTokenKey(baseUrl)
    await updateTokenFile((file) => {
      const current = file.tokens[key]
      if (!isWellFormed(current) || current.refreshToken !== rejectedRefreshToken) return { result: undefined, write: false }
      file.tokens[key] = { ...current, refreshRejected: true }
      return { result: undefined, write: true }
    }, TOKEN_LOCK_WAIT_MS)
  } catch (error) {
    debug(`Could not record the rejected session: ${failure(error)}`)
  }
}

/**
 * Remove sessions and start a new logout epoch, which stops any sign-in pending
 * in another session from saving. The file is kept (without sessions) so the epoch
 * survives. Returns the removed sessions for revocation.
 */
async function removeSessions(select: (key: string) => boolean, what: string): Promise<RemovedSession[]> {
  try {
    const removed = await updateTokenFile((file) => {
      const out: RemovedSession[] = []
      for (const key of Object.keys(file.tokens)) {
        if (!select(key)) continue
        out.push(asRemoved(key, file.tokens[key]))
        delete file.tokens[key]
      }
      file.logoutEpoch = newEpoch()
      return { result: out, write: true }
    }, LOGOUT_LOCK_WAIT_MS)
    debug(`Cleared ${what}`)
    return removed
  } catch (error) {
    debug(`Error clearing tokens: ${failure(error)}`)
    throw new Error(`Failed to clear tokens: ${failure(error)}`, { cause: error })
  }
}

/**
 * Clear tokens for a platform
 *
 * @param baseUrl - Platform base URL
 * @returns The removed session, if there was one
 */
export async function clearTokens(baseUrl: string): Promise<RemovedSession[]> {
  const key = getTokenKey(baseUrl)
  return removeSessions((k) => k === key, `tokens for ${key}`)
}

/**
 * Clear all cached tokens for every platform (logout clear_all)
 */
export async function clearAllTokens(): Promise<RemovedSession[]> {
  return removeSessions(() => true, 'all tokens')
}

/**
 * Check if stored tokens are expired
 *
 * @param tokens - Stored tokens to check
 * @param bufferMs - Buffer time in ms before actual expiry (default 60 seconds)
 * @returns true if tokens are expired or will expire within buffer
 */
export function isTokenExpired(tokens: Pick<StoredTokens, 'expiresAt'>, bufferMs: number = 60000): boolean {
  const now = Date.now()
  const expiresAt = tokens.expiresAt

  return now >= expiresAt - bufferMs
}

/**
 * Can this session be refreshed? Only the provider knows whether a refresh token
 * is still valid, so any session with one is tried — unless the provider already
 * rejected it.
 */
export function canRefresh(tokens: StoredTokens): boolean {
  return tokens.refreshToken.length > 0 && tokens.refreshRejected !== true
}

/**
 * Get the token storage file path. For tests and local tooling only — never put
 * it in a tool result or description.
 */
export function getTokenStoragePath(): string {
  return TOKENS_FILE
}
