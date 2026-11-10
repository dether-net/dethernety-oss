import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import {
  getConfig,
  getPlatformUrl,
  validateConfig,
  configProblem,
  envValue,
  originOf,
  debugLog,
  urlPolicyProblem,
  nodeOptionTokens,
  DEFAULT_PLATFORM_URL,
} from '../config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getConfig', () => {
    it('should return defaults when no env vars set', () => {
      delete process.env.DETHERNETY_URL
      delete process.env.DETHERNETY_PLATFORM_URL
      delete process.env.DEBUG
      const config = getConfig()
      expect(config.baseUrl).toBe('http://127.0.0.1:3000')
      expect(config.debug).toBe(false)
    })

    it('defaults to the URL the Claude plugin offers, so the server and the installers never disagree', () => {
      const harness = parse(readFileSync(new URL('../../workflow/harness/claude.yaml', import.meta.url), 'utf8')) as { userConfig: { platform_url: { default: string } } }
      expect(harness.userConfig.platform_url.default).toBe(DEFAULT_PLATFORM_URL)
    })

    it('should use DETHERNETY_URL env var', () => {
      process.env.DETHERNETY_URL = 'https://dethernety.example.com'
      const config = getConfig()
      expect(config.baseUrl).toBe('https://dethernety.example.com')
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

  describe('platform URL precedence', () => {
    const REAL = 'https://env.example.test'
    const USER = 'https://user-config.example.test'
    const unsetLike: [string, string | undefined][] = [
      ['unset', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['a literal placeholder', '${DETHERNETY_URL}'],
    ]

    it.each(unsetLike)('DETHERNETY_URL %s falls back to DETHERNETY_PLATFORM_URL', (_label, value) => {
      const env = { DETHERNETY_PLATFORM_URL: USER, ...(value === undefined ? {} : { DETHERNETY_URL: value }) }
      expect(getPlatformUrl(env)).toEqual({ url: USER, source: 'user_config' })
    })

    it('a plugin hook reads the user config from its plugin option, after the server variables', () => {
      expect(getPlatformUrl({ CLAUDE_PLUGIN_OPTION_PLATFORM_URL: USER })).toEqual({ url: USER, source: 'user_config' })
      expect(getPlatformUrl({ CLAUDE_PLUGIN_OPTION_PLATFORM_URL: USER, DETHERNETY_URL: REAL })).toEqual({ url: REAL, source: 'env' })
      expect(getPlatformUrl({ CLAUDE_PLUGIN_OPTION_PLATFORM_URL: 'https://other.example.test', DETHERNETY_PLATFORM_URL: USER })).toEqual({ url: USER, source: 'user_config' })
      expect(getPlatformUrl({ CLAUDE_PLUGIN_OPTION_PLATFORM_URL: '  ' })).toEqual({ url: DEFAULT_PLATFORM_URL, source: 'default' })
    })

    it.each(unsetLike)('DETHERNETY_URL %s with no user config gives the default', (_label, value) => {
      const env = value === undefined ? {} : { DETHERNETY_URL: value }
      expect(getPlatformUrl(env)).toEqual({ url: DEFAULT_PLATFORM_URL, source: 'default' })
    })

    it.each([
      ['a real user config', USER],
      ['a literal user-config placeholder', '${user_config.platform_url}'],
      ['no user config', undefined],
    ])('a real DETHERNETY_URL wins over %s', (_label, userConfig) => {
      const env = { DETHERNETY_URL: REAL, ...(userConfig === undefined ? {} : { DETHERNETY_PLATFORM_URL: userConfig }) }
      expect(getPlatformUrl(env)).toEqual({ url: REAL, source: 'env' })
    })

    it('a literal user-config placeholder counts as unset', () => {
      expect(getPlatformUrl({ DETHERNETY_PLATFORM_URL: '${user_config.platform_url}' })).toEqual({
        url: DEFAULT_PLATFORM_URL,
        source: 'default',
      })
    })

    it('a real but invalid DETHERNETY_URL still wins, and is reported rather than replaced', () => {
      process.env.DETHERNETY_URL = 'http://platform.example.test'
      process.env.DETHERNETY_PLATFORM_URL = USER
      expect(getConfig()).toMatchObject({ baseUrl: 'http://platform.example.test', urlSource: 'env' })
      expect(configProblem()).toMatch(/DETHERNETY_URL must use HTTPS/)
    })

    it('names the variable that supplied an invalid URL', () => {
      delete process.env.DETHERNETY_URL
      process.env.DETHERNETY_PLATFORM_URL = 'http://platform.example.test'
      expect(configProblem()).toMatch(/^DETHERNETY_PLATFORM_URL must use HTTPS/)
    })

    it('reports no problem for a usable configuration', () => {
      process.env.DETHERNETY_URL = 'http://127.0.0.1:9'
      expect(configProblem()).toBeUndefined()
    })

    it('never quotes the URL in a configuration problem', () => {
      process.env.DETHERNETY_URL = 'http://someone:hunter2@platform.example.test'
      expect(configProblem()).not.toMatch(/hunter2|someone|platform\.example/)
    })

    it('treats a trailing-dot localhost as a remote host', () => {
      process.env.DETHERNETY_URL = 'http://localhost.:3003'
      expect(configProblem()).toMatch(/HTTPS/)
    })
  })

  describe('envValue', () => {
    it('trims and rejects only unset-like values', () => {
      expect(envValue('X', { X: '  /a/b  ' })).toBe('/a/b')
      expect(envValue('X', { X: '${X}' })).toBeUndefined()
      expect(envValue('X', { X: ' ${CLAUDE_PROJECT_DIR} ' })).toBeUndefined()
      expect(envValue('X', { X: '' })).toBeUndefined()
      expect(envValue('X', {})).toBeUndefined()
      // Only a whole-value placeholder is one.
      expect(envValue('X', { X: '/a/${B}' })).toBe('/a/${B}')
    })
  })

  describe('originOf', () => {
    it('drops userinfo, path and query', () => {
      expect(originOf('https://u:p@platform.example.test/app/?x=1')).toBe('https://platform.example.test')
      expect(originOf('not a url')).toBe('invalid URL')
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

    it('names the user-config variable when it supplied the URL', () => {
      expect(() =>
        validateConfig({ baseUrl: 'not-a-url', urlSource: 'user_config' }),
      ).toThrow('Invalid DETHERNETY_PLATFORM_URL format')
    })

    it('should reject invalid URL format', () => {
      expect(() => validateConfig({ baseUrl: 'not-a-url', debug: false })).toThrow(
        'Invalid DETHERNETY_URL format',
      )
    })
 
    it('refuses a user name or password in the URL, without quoting it', () => {
      for (const url of ['https://user@platform.example', 'https://user:pw@platform.example', 'http://:pw@localhost:3000']) {
        const problem = urlPolicyProblem(url, 'DETHERNETY_URL', {})
        expect(problem).toBe('DETHERNETY_URL must not contain a user name or password.')
        expect(problem).not.toContain('pw')
      }
    })

    it('refuses plain HTTP while Node fetch honours proxy variables', () => {
      expect(urlPolicyProblem('http://localhost:3000', 'DETHERNETY_URL', { NODE_USE_ENV_PROXY: '1' })).toMatch(/NODE_USE_ENV_PROXY/)
      expect(urlPolicyProblem('http://localhost:3000', 'DETHERNETY_URL', { NODE_USE_ENV_PROXY: '0' })).toBeUndefined()
      expect(urlPolicyProblem('http://localhost:3000', 'DETHERNETY_URL', {})).toBeUndefined()
      expect(urlPolicyProblem('https://platform.example', 'DETHERNETY_URL', { NODE_USE_ENV_PROXY: '1' })).toBeUndefined()
    })

    it('refuses plain HTTP while the proxy option is on, in any spelling Node accepts, in NODE_OPTIONS or on the command line', () => {
      const http = 'http://localhost:3000'
      for (const options of ['--use-env-proxy', '--use_env_proxy', '--max-old-space-size=100 --use-env-proxy', '"--use-env-proxy"', '--use-env-proxy=1', '--no-warnings "--use_env_proxy"']) {
        expect(urlPolicyProblem(http, 'DETHERNETY_URL', { NODE_OPTIONS: options }, []), options).toMatch(/--use-env-proxy/)
      }
      for (const argv of [['--use-env-proxy'], ['--use_env_proxy=true']]) {
        expect(urlPolicyProblem(http, 'DETHERNETY_URL', {}, argv), argv.join(' ')).toMatch(/--use-env-proxy/)
      }
      // Other options, and HTTPS, are not affected.
      expect(urlPolicyProblem(http, 'DETHERNETY_URL', { NODE_OPTIONS: '--use-env-proxy-not --max-old-space-size=100' }, ['--inspect'])).toBeUndefined()
      expect(urlPolicyProblem('https://platform.example', 'DETHERNETY_URL', { NODE_OPTIONS: '--use-env-proxy' }, ['--use-env-proxy'])).toBeUndefined()
    })

    it('splits NODE_OPTIONS as Node does', () => {
      expect(nodeOptionTokens('  --a  "--b c" --d="e \\" f" ')).toEqual(['--a', '--b c', '--d=e " f'])
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
