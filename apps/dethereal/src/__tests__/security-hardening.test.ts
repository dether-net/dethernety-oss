import { describe, it, expect } from 'vitest'
import { validateConfig } from '../config.js'

describe('Security Hardening (D61)', () => {
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

    it('should not accept argsToken parameter in getIdToken', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const indexPath = path.join(import.meta.dirname, '..', 'index.ts')
      const content = await fs.readFile(indexPath, 'utf-8')

      expect(content).toMatch(/async function getIdToken\(\)/)
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
})
