/**
 * The OpenCode smoke's readers of OpenCode's own output, on text shaped like what it prints: they
 * decide pass or fail, so they are checked without an OpenCode binary.
 */

import { describe, it, expect } from 'vitest'
// @ts-expect-error -- a plain ES module script, without type declarations
import { lastMatch, leaksRealHome, mcpConnected, parseJsonOutput, stripAnsi, versionMatches, wildcard } from '../../scripts/smoke-opencode.mjs'

type Rule = { permission: string; action: string; pattern: string }

describe('smoke-opencode: OpenCode wildcards', () => {
  it('matches `*` and `?` across slashes, anchored and case-sensitive', () => {
    expect(wildcard('deploy/orders/.env', '*.env')).toBe(true)
    expect(wildcard('a/b', 'a?b')).toBe(true)
    expect(wildcard('x.env.bak', '*.env')).toBe(false)
    expect(wildcard('OPENCODE.JSON', 'opencode.json*')).toBe(false)
    expect(wildcard('dethereal_model_state_waive', 'dethereal_*')).toBe(true)
    expect(wildcard('a.b', 'a.b')).toBe(true)
    expect(wildcard('axb', 'a.b')).toBe(false)
  })

  it('reads backslashes as slashes, and lets a trailing " *" match nothing after it', () => {
    expect(wildcard('src\\app.ts', 'src/*')).toBe(true)
    expect(wildcard('git status', 'git status *')).toBe(true)
    expect(wildcard('git status --short', 'git status *')).toBe(true)
    expect(wildcard('git statusx', 'git status *')).toBe(false)
  })
})

describe('smoke-opencode: the last matching rule', () => {
  const rules: Rule[] = [
    { permission: '*', action: 'allow', pattern: '*' },
    { permission: '*', action: 'deny', pattern: '*' },
    { permission: 'read', action: 'allow', pattern: '*' },
    { permission: 'read', action: 'deny', pattern: '*.env' },
    { permission: 'read', action: 'allow', pattern: '*.env.example' },
    { permission: 'dethereal_*', action: 'allow', pattern: '*' },
    { permission: 'dethereal_model_state_waive', action: 'deny', pattern: '*' },
  ]

  it('takes the last rule matching both the permission and the pattern', () => {
    expect(lastMatch(rules, 'read', 'src/app.ts')).toBe('allow')
    expect(lastMatch(rules, 'read', 'deploy/.env')).toBe('deny')
    expect(lastMatch(rules, 'read', 'deploy/.env.example')).toBe('allow')
    expect(lastMatch(rules, 'dethereal_list_models', '*')).toBe('allow')
    expect(lastMatch(rules, 'dethereal_model_state_waive', '*')).toBe('deny')
    expect(lastMatch(rules, 'task', '*')).toBe('deny')
  })

  it('asks when no rule matches', () => {
    expect(lastMatch([], 'read', 'x')).toBe('ask')
  })
})

describe('smoke-opencode: command output', () => {
  it('finds the server connected in the coloured list, and not when it failed', () => {
    const ok = '\x1b[0m\n┌  MCP Servers\n│\n●  ✓ dethereal \x1b[90mconnected\n│      \x1b[90m/usr/bin/node /x/dist/index.js\n│\n└  1 server(s)\n'
    expect(mcpConnected(ok, 'dethereal')).toBe(true)
    expect(mcpConnected(ok.replace('✓ dethereal \x1b[90mconnected', '✗ dethereal \x1b[90mfailed'), 'dethereal')).toBe(false)
    expect(mcpConnected(ok.replace('dethereal', 'dethereal-other'), 'dethereal')).toBe(false)
    expect(stripAnsi('\x1b[90mconnected\x1b[0m')).toBe('connected')
  })

  it('refuses JSON that was cut short', () => {
    const full = JSON.stringify([{ name: 'dethereal-status', location: '/p/.opencode/skills/dethereal-status/SKILL.md' }])
    expect(parseJsonOutput(full, 'debug skill')).toHaveLength(1)
    expect(() => parseJsonOutput(full.slice(0, 20), 'debug skill')).toThrow(/debug skill: the output is not complete JSON/)
  })

  it('accepts only the pinned version', () => {
    expect(versionMatches('1.18.34\n', '1.18.34')).toBe(true)
    expect(versionMatches('opencode 1.18.34', '1.18.34')).toBe(true)
    expect(versionMatches('1.18.35\n', '1.18.34')).toBe(false)
    expect(versionMatches('', '1.18.34')).toBe(false)
  })
})

describe('smoke-opencode: the real home in OpenCode\'s output', () => {
  it('finds the real home, but not the sandbox folders inside it', () => {
    const real = '/fake-home/me'
    const sandbox = '/fake-home/me/scratch/cp4/run/home'
    expect(leaksRealHome(`{"location":"${sandbox}/.config/opencode/skills/x/SKILL.md"}`, real, [sandbox])).toBe(false)
    expect(leaksRealHome(`{"location":"/fake-home/me/.claude/skills/x/SKILL.md"}`, real, [sandbox])).toBe(true)
    expect(leaksRealHome(`{"location":"${sandbox}/x","other":"/fake-home/me/.config/opencode/skills"}`, real, [sandbox])).toBe(true)
    expect(leaksRealHome('anything', '/', [])).toBe(false)
  })
})

