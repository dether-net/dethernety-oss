/**
 * Stands in for `cross-fetch` in a built server: a platform whose identity
 * provider refuses every token and revocation request and echoes the submitted
 * form back in its error — the worst a provider can do with a token it is sent.
 * Every request body is appended to `DETHEREAL_FAKE_NET/bodies.log`, so a test can
 * prove the echo really carried the secret.
 */

import { appendFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.DETHEREAL_FAKE_NET ?? ''

function reply(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Echo',
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  }
}

export default async function fetch(url: string, init: { body?: string } = {}) {
  const u = new URL(url)
  const body = init.body ?? ''
  appendFileSync(path.join(dir, 'bodies.log'), `${u.pathname} ${body}\n`)
  if (u.pathname === '/config') {
    return reply(
      200,
      JSON.stringify({ oidcClientId: 'client-echo', oidcDomain: 'auth.echo.test', oidcIssuer: 'https://auth.echo.test', graphqlUrl: '/graphql' })
    )
  }
  if (u.pathname === '/oauth2/token' || u.pathname === '/oauth2/revoke') {
    return reply(400, JSON.stringify({ error: 'invalid_request', error_description: `you sent: ${body}`, echo: body }))
  }
  throw new Error(`no route; you sent: ${body}`)
}
