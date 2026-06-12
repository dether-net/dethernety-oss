import { describe, it, expect } from 'vitest'
import http from 'http'
import { startCallbackServer } from '../oauth-server.js'

const TEST_PORT = 38917

function hitCallback(port: number, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/callback?${query}`, res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode || 0))
      })
      .on('error', reject)
  })
}

describe('oauth callback server', () => {
  it('delivers a callback that arrives BEFORE waitForCallback is invoked', async () => {
    const server = await startCallbackServer({ port: TEST_PORT, timeout: 5000 })
    try {
      // Simulate the cached-IdP-session race: the redirect lands while the
      // flow is still between openBrowser() and waitForCallback().
      const status = await hitCallback(TEST_PORT, 'code=abc123&state=xyz')
      expect(status).toBe(200)

      const result = await server.waitForCallback()
      expect(result.code).toBe('abc123')
      expect(result.state).toBe('xyz')
    } finally {
      server.close()
    }
  })

  it('delivers a callback that arrives while waiting (normal path)', async () => {
    const server = await startCallbackServer({ port: TEST_PORT + 1, timeout: 5000 })
    try {
      const wait = server.waitForCallback()
      const status = await hitCallback(TEST_PORT + 1, 'code=def456&state=st2')
      expect(status).toBe(200)

      const result = await wait
      expect(result.code).toBe('def456')
      expect(result.state).toBe('st2')
    } finally {
      server.close()
    }
  })

  it('rejects with the provider error even when it arrives before the wait', async () => {
    const server = await startCallbackServer({ port: TEST_PORT + 2, timeout: 5000 })
    try {
      const status = await hitCallback(TEST_PORT + 2, 'error=access_denied&error_description=nope')
      expect(status).toBe(400)

      await expect(server.waitForCallback()).rejects.toThrow(/access_denied/)
    } finally {
      server.close()
    }
  })
})
