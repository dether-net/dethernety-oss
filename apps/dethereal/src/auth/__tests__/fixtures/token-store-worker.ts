/**
 * A separate process using the token store, for the cross-process tests. Built
 * with `cross-fetch` replaced by ./scripted-fetch.ts; run with HOME set to the
 * test's sandbox and DETHERNETY_URL set to the platform under test.
 *
 *   save <count> <prefix>   store <count> sessions for distinct platforms → {saved, busy, errors}
 *   seed-expired <refresh>  store an expired session for DETHERNETY_URL
 *   refresh                 refresh DETHERNETY_URL's session → refreshed | signed-out | expired | error
 *   logout                  sign out of DETHERNETY_URL and revoke → the revocation results
 *   hold                    hold the store's lock until killed
 *   tmp-then-die            leave a tmp file behind, as a writer killed mid-write would
 *   signin-begin            print the logout epoch a sign-in starts from
 *   signin-commit <epoch>   commit a sign-in begun at <epoch> → saved | superseded | cancelled
 */

import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  saveTokens,
  loadStoredTokens,
  clearTokens,
  beginSignInEpoch,
  saveSignIn,
  type StoredTokens,
} from '../../token-store.js'
import { refreshStoredSession, SignedOutError, SessionExpiredError } from '../../oauth-flow.js'
import { fetchPlatformConfig } from '../../platform-config.js'
import { revokeSessions } from '../../revoke.js'
import { acquireFileLock } from '../../../utils/file-lock.js'

const platform = process.env.DETHERNETY_URL ?? ''

function session(baseUrl: string, refreshToken: string, expiresAt = Date.now() + 3600_000): StoredTokens {
  return {
    accessToken: `access-${refreshToken}`,
    idToken: `id-${refreshToken}`,
    refreshToken,
    expiresAt,
    baseUrl,
    storedAt: Date.now(),
  }
}

async function main(): Promise<string> {
  const [command, a, b] = process.argv.slice(2)
  switch (command) {
    case 'save': {
      // Every save ends as saved or as a coded busy (the lock wait ran out under load); anything else is an error.
      const outcome = { saved: [] as string[], busy: [] as string[], errors: 0 }
      for (let i = 0; i < Number(a); i++) {
        const url = `https://${b}-${i}.example.test`
        try {
          await saveTokens(session(url, `refresh-token-${b}-${i}-0123456789`))
          outcome.saved.push(url)
        } catch (error) {
          if (error instanceof Error && error.message === 'Failed to save tokens: the session store is busy') outcome.busy.push(url)
          else outcome.errors++
        }
      }
      return JSON.stringify(outcome)
    }
    case 'seed-expired':
      await saveTokens(session(platform, a!, Date.now() - 60_000))
      return 'ok'
    case 'refresh': {
      await fetchPlatformConfig()
      const stored = await loadStoredTokens(platform)
      if (!stored) return 'no-session'
      try {
        await refreshStoredSession(stored, platform)
        return 'refreshed'
      } catch (error) {
        if (error instanceof SignedOutError) return 'signed-out'
        if (error instanceof SessionExpiredError) return 'expired'
        return 'error'
      }
    }
    case 'logout':
      return JSON.stringify(await revokeSessions(await clearTokens(platform)))
    case 'hold': {
      await acquireFileLock(path.join(homedir(), '.dethernety', 'tokens.lock'), { maxHoldMs: 30_000 })
      process.stdout.write('held\n')
      await new Promise(() => setInterval(() => undefined, 1000))
      return ''
    }
    case 'tmp-then-die':
      writeFileSync(path.join(homedir(), '.dethernety', `tokens.json.${process.pid}.0123456789abcdef.tmp`), '{"tokens":{}}', { mode: 0o600 })
      process.kill(process.pid, 'SIGKILL')
      return ''
    case 'signin-begin':
      return await beginSignInEpoch()
    case 'signin-commit':
      return (await saveSignIn(session(platform, 'refresh-token-signin-0123456789'), { expectEpoch: a! })).kind
    default:
      return 'unknown command'
  }
}

main().then(
  (out) => process.stdout.write(`${out}\n`),
  (error: unknown) => {
    process.stdout.write(`failed: ${error instanceof Error ? error.message : 'unknown'}\n`)
    process.exitCode = 1
  }
)
