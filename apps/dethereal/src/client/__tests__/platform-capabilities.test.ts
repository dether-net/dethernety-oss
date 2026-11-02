/**
 * The platform probe: one query for the field this version's documents select, asked once per platform while the
 * answer is yes, and turned into one message when the platform refuses it for lacking the field. Any other failure says
 * nothing, so the tool's own request reports it as it would have.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearPlatformCapabilityCache, missingPlatformCapability } from '../platform-capabilities.js'

const clientAnswering = (query: () => Promise<unknown>) => ({ query: vi.fn(query) }) as any

const refusal = Object.assign(new Error('Cannot query field "controls" on type "Data".'), {
  errors: [{ message: 'Cannot query field "controls" on type "Data".' }],
})

beforeEach(() => clearPlatformCapabilityCache())

describe('missingPlatformCapability', () => {
  it('passes a platform that has the field, and does not ask it again', async () => {
    const client = clientAnswering(async () => ({ data: { data: [] } }))

    expect(await missingPlatformCapability(client, 'https://p.example')).toBeUndefined()
    expect(await missingPlatformCapability(client, 'https://p.example')).toBeUndefined()
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(client.query.mock.calls[0][0].fetchPolicy).toBe('no-cache')
  })

  it('names the platform and the missing field when the platform refuses the query for it', async () => {
    const message = await missingPlatformCapability(clientAnswering(async () => { throw refusal }), 'https://old.example')

    expect(message).toContain('https://old.example')
    expect(message).toContain('Data.controls')
  })

  it('recognises the refusal of a production platform, which masks the message and keeps the code', async () => {
    // What a production platform's formatError makes of the validation error, as the client reports it.
    const masked = Object.assign(new Error('Internal server error'), {
      errors: [{ message: 'Internal server error', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }],
    })

    expect(await missingPlatformCapability(clientAnswering(async () => { throw masked }), 'https://old.example')).toBeDefined()
  })

  it('reads the refusal from the body of a response the client did not take as GraphQL', async () => {
    const serverError = Object.assign(new Error('Response not successful: Received status code 400'), {
      statusCode: 400,
      bodyText: JSON.stringify({ errors: [{ message: 'Internal server error', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }),
    })

    expect(await missingPlatformCapability(clientAnswering(async () => { throw serverError }), 'https://old.example')).toBeDefined()
  })

  it('names the platform by its origin, never by a login the URL carries', async () => {
    const message = await missingPlatformCapability(clientAnswering(async () => { throw refusal }), 'https://login:placeholder@old.example/app')

    expect(message).toContain('https://old.example')
    expect(message).not.toContain('placeholder')
    expect(message).not.toContain('login:')
  })

  it('reads the refusal from the error list too, and asks again next time', async () => {
    const listed = Object.assign(new Error('Response not successful'), { errors: refusal.errors })
    const client = clientAnswering(async () => { throw listed })

    expect(await missingPlatformCapability(client, 'https://old.example')).toBeDefined()
    expect(await missingPlatformCapability(client, 'https://old.example')).toBeDefined()
    expect(client.query).toHaveBeenCalledTimes(2)
  })

  it('says nothing for any other failure', async () => {
    const unauthenticated = Object.assign(new Error('Internal server error'), {
      errors: [{ message: 'Internal server error', extensions: { code: 'UNAUTHENTICATED' } }],
    })
    for (const failure of [new Error('fetch failed'), unauthenticated, Object.assign(new Error('Bad gateway'), { bodyText: '<html>' })]) {
      expect(await missingPlatformCapability(clientAnswering(async () => { throw failure }), 'https://p.example')).toBeUndefined()
    }
  })
})
