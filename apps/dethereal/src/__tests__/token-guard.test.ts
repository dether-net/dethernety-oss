/**
 * Static guard: nothing the model reads may lead it to session credentials.
 *
 * Three ways a token has reached a model before, each pinned here:
 * - prose telling it to read the token store (skills, agents, docs that ship);
 * - a tool description naming where tokens live;
 * - a tool that takes a token as input, so the model has to hold one to call it.
 *
 * Every scan also asserts it looked at something, since a glob or schema walk
 * that silently matches nothing would pass this whole file.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { allTools } from '../tools/index.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')) as { files?: string[] }

/** Where the token store lives, in any spelling a prompt could use. */
const TOKEN_STORE = /tokens\.json|\.dethernety[\\/]tokens/i

/** Input property names that would make the model hold a credential. */
const CREDENTIAL_INPUT = /token|bearer|jwt|refresh|authorization|password|secret|cookie|api_?key/i

/** `tool.property` names that match CREDENTIAL_INPUT for a reason reviewed here. Keep empty unless justified. */
const ALLOWED_INPUTS: string[] = []

function walk(p: string): string[] {
  if (!existsSync(p)) return []
  if (statSync(p).isFile()) return [p]
  return readdirSync(p).flatMap((entry) => walk(path.join(p, entry)))
}

/** Every file the package publishes except the server build, which holds the store's own file name. */
function shippedPromptFiles(): string[] {
  return (pkg.files ?? [])
    .map((entry) => entry.replace(/^\.\//, '').replace(/\/$/, ''))
    .filter((entry) => entry !== 'dist')
    .flatMap((entry) => walk(path.join(pkgRoot, entry)))
}

function toolSchema(tool: (typeof allTools)[number]): Record<string, unknown> {
  return z.toJSONSchema(tool.inputSchema, { target: 'draft-07' }) as Record<string, unknown>
}

/** Every property name in a JSON schema, including nested and combinator branches. */
function propertyNames(schema: unknown, out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object') return out
  const node = schema as Record<string, unknown>
  if (node.properties && typeof node.properties === 'object') {
    for (const [name, child] of Object.entries(node.properties as Record<string, unknown>)) {
      out.push(name)
      propertyNames(child, out)
    }
  }
  for (const key of ['items', 'additionalProperties', 'not']) propertyNames(node[key], out)
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    if (Array.isArray(node[key])) for (const branch of node[key] as unknown[]) propertyNames(branch, out)
  }
  for (const key of ['$defs', 'definitions']) {
    if (node[key] && typeof node[key] === 'object') {
      for (const child of Object.values(node[key] as Record<string, unknown>)) propertyNames(child, out)
    }
  }
  return out
}

describe('token guard', () => {
  it('no shipped prompt, doc or script names the token store', () => {
    const files = shippedPromptFiles()
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith(path.join('skills', 'status', 'SKILL.md')))).toBe(true)

    const offenders = files.filter((f) => TOKEN_STORE.test(readFileSync(f, 'utf-8'))).map((f) => path.relative(pkgRoot, f))
    expect(offenders).toEqual([])
  })

  it('no tool description or input description names the token store', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(20)
    const offenders = allTools
      .filter((tool) => TOKEN_STORE.test(tool.description) || TOKEN_STORE.test(JSON.stringify(toolSchema(tool))))
      .map((tool) => tool.name)
    expect(offenders).toEqual([])
  })

  it('no tool takes a credential as input', () => {
    const names = allTools.flatMap((tool) => propertyNames(toolSchema(tool)).map((p) => `${tool.name}.${p}`))
    // The walk must reach nested properties, or a credential inside an object would pass.
    expect(names.length).toBeGreaterThan(50)
    expect(names.some((n) => n.split('.').length === 2 && n.startsWith('manage_controls.'))).toBe(true)

    const offenders = names.filter((n) => CREDENTIAL_INPUT.test(n.split('.').slice(1).join('.')) && !ALLOWED_INPUTS.includes(n))
    expect(offenders).toEqual([])
  })

  it('the refresh_token tool is gone and auth_status is registered', () => {
    const names = allTools.map((t) => t.name)
    expect(names).not.toContain('refresh_token')
    expect(names).toContain('auth_status')
    expect(new Set(names).size).toBe(names.length)
  })

  it('no test can open the real OAuth callback port', () => {
    const self = fileURLToPath(import.meta.url)
    const tests = walk(path.join(pkgRoot, 'src')).filter((f) => f.endsWith('.test.ts') && f !== self)
    expect(tests.length).toBeGreaterThan(20)

    const offenders = tests
      .filter((f) => {
        const source = readFileSync(f, 'utf-8')
        // A test that drives the login flow in-process must replace the callback server.
        const drivesLogin = /import\s*\{[^}]*\b(performLogin|loginTool|LoginTool)\b[^}]*\}|from\s*['"][^'"]*login\.tool/.test(source)
        const mocksServer = /vi\.mock\(\s*['"][^'"]*oauth-server/.test(source)
        // A test that starts a callback server itself must not use the real port.
        const bindsRealPort = /startCallbackServer\(\s*\{[^}]*\b(9876|DEFAULT_CALLBACK_PORT)\b/.test(source)
        return (drivesLogin && !mocksServer) || bindsRealPort
      })
      .map((f) => path.relative(pkgRoot, f))
    expect(offenders).toEqual([])
  })
})
