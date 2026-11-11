/**
 * Refresh and revocation in the built server, against an identity provider that
 * echoes every submitted token back in its errors (fixtures/echo-fetch.ts, which
 * replaces `cross-fetch` in this build only). Every channel the model or a log can
 * see — the tool list, results and stderr with DEBUG on — is scanned for the
 * session's tokens and the store's location.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { shippedBuild } from '../../packaging/shipped-build.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..', '..', '..')
const PLATFORM = 'http://127.0.0.1:43223'

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const REFRESH = 'refresh-needle-7c1f0e9a4b2d4c3e8f6a'
const ACCESS = `${enc({ alg: 'none' })}.${enc({ scope: 'openid profile email' })}.access-needle-5a8b2c`
const ID = `${enc({ alg: 'none' })}.${enc({ email: 'echo@example.test' })}.id-needle-9d3e1f`
const NEEDLES = [REFRESH, ACCESS, ID, 'refresh-needle', 'access-needle', 'id-needle']

describe('logout and refresh against an echoing identity provider (built server)', () => {
  let outDir: string
  let root: string
  let home: string
  let fakeNet: string
  let client: Client
  let stderr = ''

  beforeAll(async () => {
    const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
    await mkdir(cacheDir, { recursive: true })
    outDir = await mkdtemp(path.join(cacheDir, 'dethereal-echo-'))
    await build({
      config: false,
      entry: { index: path.join(pkgRoot, 'src', 'index.ts') },
      ...shippedBuild,
      outDir,
      clean: false,
      silent: true,
      esbuildOptions(options, context) {
        shippedBuild.esbuildOptions!(options, context)
        options.alias = { ...options.alias, 'cross-fetch': path.join(pkgRoot, 'src', 'auth', '__tests__', 'fixtures', 'echo-fetch.ts') }
      },
    })
    const entry = path.join(outDir, 'index.js')
    expect(existsSync(entry)).toBe(true)

    root = await realpath(await mkdtemp(path.join(tmpdir(), 'dethereal-echo-')))
    home = path.join(root, 'home')
    fakeNet = path.join(root, 'net')
    await mkdir(path.join(home, '.dethernety'), { recursive: true, mode: 0o700 })
    await mkdir(fakeNet, { recursive: true })
    await mkdir(path.join(root, 'project', '.git'), { recursive: true })
    await writeFile(
      path.join(home, '.dethernety', 'tokens.json'),
      JSON.stringify({
        version: 1,
        tokens: {
          [PLATFORM]: {
            accessToken: ACCESS,
            idToken: ID,
            refreshToken: REFRESH,
            expiresAt: Date.now() - 60_000,
            baseUrl: PLATFORM,
            storedAt: Date.now(),
            grantedScope: 'openid profile email',
          },
        },
      }),
      { mode: 0o600 }
    )

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: path.join(root, 'project'),
      env: { HOME: home, PATH: process.env.PATH ?? '', DEBUG: 'true', DETHERNETY_URL: PLATFORM, DETHEREAL_FAKE_NET: fakeNet },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    client = new Client({ name: 'echo-test', version: '0.0.0' })
    await client.connect(transport)
  }, 90_000)

  afterAll(async () => {
    await client?.close()
    await rm(outDir, { recursive: true, force: true })
    if (root) await rm(root, { recursive: true, force: true })
  })

  const text = (r: unknown) => ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? '').join('\n')

  it('reports the refused refresh and the refused revocation by status and code, and leaks nothing', async () => {
    const listed = JSON.stringify(await client.listTools())

    const status = text(await client.callTool({ name: 'auth_status', arguments: { verify: true } }))
    expect(JSON.parse(status)).toMatchObject({
      authenticated: false,
      detail: 'refresh failed: Token refresh failed: HTTP 400 (invalid_request)',
    })

    const logout = text(await client.callTool({ name: 'logout', arguments: { clear_all: true } }))
    expect(JSON.parse(logout).revocation).toEqual([{ platform: PLATFORM, result: 'failed', reason: 'HTTP 400 (invalid_request)' }])

    // Positive control: the provider really was sent, and echoed, the refresh token.
    const bodies = await readFile(path.join(fakeNet, 'bodies.log'), 'utf8')
    expect(bodies).toMatch(new RegExp(`/oauth2/token .*${REFRESH}`))
    expect(bodies).toMatch(new RegExp(`/oauth2/revoke .*${REFRESH}`))
    expect(bodies).toMatch(/client_id=client-echo/)

    for (const [channel, content] of [['tools/list', listed], ['auth_status', status], ['logout', logout], ['stderr', stderr]] as const) {
      for (const needle of NEEDLES) expect(content, `${channel} carries ${needle}`).not.toContain(needle)
      expect(content, `${channel} names the store`).not.toContain('tokens.json')
      expect(content, `${channel} names the home directory`).not.toContain(home)
      expect(content, `${channel} echoes the form`).not.toContain('you sent')
    }
    // DEBUG really was on: the scan covered debug output.
    expect(stderr).toMatch(/Revocation at /)
  }, 60_000)
})
