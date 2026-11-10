/**
 * Stands in for `cross-fetch` in the token-store worker build. It answers from
 * files in `DETHEREAL_FAKE_NET`, records every request there, and holds a token
 * request until the test creates `release` — so a test can run a logout in another
 * process while a refresh is in flight.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.DETHEREAL_FAKE_NET ?? ''

function reply(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  }
}

export default async function fetch(url: string, init: { body?: string } = {}) {
  const u = new URL(url)
  const form = new URLSearchParams(init.body ?? '')
  appendFileSync(
    path.join(dir, 'calls.jsonl'),
    JSON.stringify({ pid: process.pid, host: u.host, path: u.pathname, token: form.get('token') ?? form.get('refresh_token') }) + '\n'
  )
  if (u.pathname === '/config') return reply(200, readFileSync(path.join(dir, 'config.json'), 'utf8'))
  if (u.pathname === '/oauth2/revoke') return reply(200, '')
  if (u.pathname === '/oauth2/token') {
    writeFileSync(path.join(dir, `token-requested-${process.pid}`), '')
    while (!existsSync(path.join(dir, 'release'))) await new Promise((r) => setTimeout(r, 10))
    return reply(200, readFileSync(path.join(dir, 'token.json'), 'utf8'))
  }
  throw new Error('unexpected request')
}
