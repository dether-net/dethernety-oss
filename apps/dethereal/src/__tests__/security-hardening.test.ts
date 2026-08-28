import { describe, it, expect } from 'vitest'
import { validateConfig } from '../config.js'

describe('Security Hardening', () => {
  describe('_token removal', () => {
    it('should not reference _token in auth error message', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const indexPath = path.join(import.meta.dirname, '..', 'index.ts')
      const content = await fs.readFile(indexPath, 'utf-8')

      // The auth error message should not mention _token
      const errorMessageMatch = content.match(/error:\s*'Authentication required'[\s\S]*?},/g)
      expect(errorMessageMatch).not.toBeNull()
      for (const match of errorMessageMatch!) {
        expect(match).not.toContain('_token')
      }
    })

    it('should not extract _token from args in buildToolContext', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const indexPath = path.join(import.meta.dirname, '..', 'index.ts')
      const content = await fs.readFile(indexPath, 'utf-8')

      expect(content).not.toContain('args._token')
    })

    it('should not accept a caller-supplied token parameter in the token accessor', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const indexPath = path.join(import.meta.dirname, '..', 'index.ts')
      const content = await fs.readFile(indexPath, 'utf-8')

      // Parameterless by design: the accessor resolves the credential from the
      // stored session alone, so no tool argument can inject a bearer.
      expect(content).toMatch(/async function getSessionTokens\(\)/)
    })

    it('sends the access token as the bearer, never the identity token', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const indexPath = path.join(import.meta.dirname, '..', 'index.ts')
      const content = await fs.readFile(indexPath, 'utf-8')

      // The identity token is a valid JWT that the platform's own guard accepts, so
      // sending it fails only once a request leaves the platform — as an opaque server
      // error, with nothing local to see. A source assertion is the available pin here:
      // index.ts is a bin entry with top-level side effects, so the accessor cannot be
      // invoked in-process without extracting it.
      //
      // BOTH return sites, because the refresh arm is the one a future edit misses and
      // its failure appears an hour after login rather than immediately.
      expect(content).toMatch(/bearer: storedTokens\.accessToken/)
      expect(content).toMatch(/bearer: newTokens\.accessToken/)
      expect(content).not.toMatch(/bearer: storedTokens\.idToken/)
      expect(content).not.toMatch(/bearer: newTokens\.idToken/)
    })
  })

  describe('HTTPS enforcement', () => {
    it('should reject http:// for non-localhost URLs', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://example.com', debug: false })
      ).toThrow('HTTPS')
    })

    it('should accept http://localhost', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://localhost:3003', debug: false })
      ).not.toThrow()
    })

    it('should accept http://127.0.0.1', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://127.0.0.1:3003', debug: false })
      ).not.toThrow()
    })

    it('should accept https:// for any host', () => {
      expect(() =>
        validateConfig({ baseUrl: 'https://demo.dethernety.io', debug: false })
      ).not.toThrow()
    })

    it('should reject http:// with non-localhost IP', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://192.168.1.1:3003', debug: false })
      ).toThrow('HTTPS')
    })

    it('should accept http://[::1] (IPv6 localhost)', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://[::1]:3003', debug: false })
      ).not.toThrow()
    })
  })

  describe('manage_controls lock + WAL pre-dispatch', () => {
    it('manage-controls.tool.ts wires acquireLock + applyPendingRewrites for directory-touching actions', async () => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const toolPath = path.join(import.meta.dirname, '..', 'tools', 'manage-controls.tool.ts')
      const content = await fs.readFile(toolPath, 'utf-8')

      // Lock primitive imported and acquired before dispatch.
      expect(content).toContain('acquireLock')
      expect(content).toContain('releaseLock')
      expect(content).toContain('LockBusyError')
      expect(content).toContain('DIRECTORY_TOUCHING_ACTIONS')

      // WAL replay invoked once per MCP entry.
      expect(content).toContain('applyPendingRewrites')

      // Lock release must live in a finally — otherwise a thrown action
      // leaves the lockfile, blocking subsequent invocations until the
      // operator manually unlinks. Cheap structural assertion.
      expect(content).toMatch(/finally\s*\{[\s\S]*releaseLock/)

      // Lock-busy must surface a typed error envelope so the skill can
      // render a useful message rather than a generic exception.
      expect(content).toContain("error: 'LOCK_BUSY'")

      // WAL replay failures must release the lock and surface the
      // diagnostic; otherwise an ambiguous-state journal silently locks
      // out future invocations.
      expect(content).toContain("error: 'WAL_REPLAY_FAILED'")
    })

    it('set-local-edited Zod enum drops "external"', async () => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const toolPath = path.join(import.meta.dirname, '..', 'tools', 'manage-controls.tool.ts')
      const content = await fs.readFile(toolPath, 'utf-8')

      // Defence at the boundary: enum must NOT include 'external'.
      // Match the edited_by field declaration specifically.
      const enumMatch = content.match(/edited_by:\s*z\.enum\(\[([^\]]+)\]\)/)
      expect(enumMatch).not.toBeNull()
      expect(enumMatch![1]).toContain("'agent'")
      expect(enumMatch![1]).toContain("'operator'")
      expect(enumMatch![1]).not.toContain("'external'")

      // Engine guard imported and surfaced as ILLEGAL_EDITED_BY envelope.
      expect(content).toContain('IllegalEditedByError')
      expect(content).toContain("error: 'ILLEGAL_EDITED_BY'")
    })
  })
})
