import { describe, it, expect, afterEach, vi } from 'vitest'
import { getConfig, validateConfig, debugLog } from '../config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getConfig', () => {
    it('should return defaults when no env vars set', () => {
      delete process.env.DETHERNETY_URL
      delete process.env.DEBUG
      const config = getConfig()
      expect(config.baseUrl).toBe('http://localhost:3003')
      expect(config.debug).toBe(false)
    })

    it('should use DETHERNETY_URL env var', () => {
      process.env.DETHERNETY_URL = 'https://demo.dethernety.io'
      const config = getConfig()
      expect(config.baseUrl).toBe('https://demo.dethernety.io')
    })

    it('should enable debug when DEBUG=true', () => {
      process.env.DEBUG = 'true'
      const config = getConfig()
      expect(config.debug).toBe(true)
    })

    it('should keep debug false for other DEBUG values', () => {
      process.env.DEBUG = '1'
      expect(getConfig().debug).toBe(false)
      process.env.DEBUG = 'yes'
      expect(getConfig().debug).toBe(false)
    })
  })

  describe('validateConfig', () => {
    it('should accept valid config', () => {
      expect(() =>
        validateConfig({ baseUrl: 'http://localhost:3003', debug: false }),
      ).not.toThrow()
    })

    it('should reject empty baseUrl', () => {
      expect(() => validateConfig({ baseUrl: '', debug: false })).toThrow(
        'DETHERNETY_URL is required',
      )
    })

    it('should reject invalid URL format', () => {
      expect(() => validateConfig({ baseUrl: 'not-a-url', debug: false })).toThrow(
        'Invalid DETHERNETY_URL format',
      )
    })
  })

  describe('debugLog', () => {
    it('should log to stderr when debug is enabled', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      debugLog({ baseUrl: 'http://localhost:3003', debug: true }, 'test message')
      expect(spy).toHaveBeenCalledWith('[dethereal] test message')
      spy.mockRestore()
    })

    it('should not log when debug is disabled', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      debugLog({ baseUrl: 'http://localhost:3003', debug: false }, 'test message')
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
