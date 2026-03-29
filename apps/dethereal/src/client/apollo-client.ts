/**
 * Apollo Client Factory
 *
 * Creates Apollo Client instances with JWT Bearer authentication for
 * communicating with the Dethernety GraphQL API.
 * Uses idToken from Cognito as the Bearer token.
 */

import { createRequire } from 'module'
import type { ApolloClient as ApolloClientTypeImport } from '@apollo/client'

// Use createRequire for CommonJS module in ESM context
const require = createRequire(import.meta.url)
const { ApolloClient, InMemoryCache, HttpLink } = require('@apollo/client')

type ApolloClientType = ApolloClientTypeImport
import fetch from 'cross-fetch'
import { debug } from '../config.js'
import { getCachedPlatformConfig, getGraphQLEndpoint } from '../auth/platform-config.js'

export type { ApolloClientType }

/**
 * Client cache - stores clients by token to avoid recreating for same session
 */
const clientCache = new Map<string, ApolloClientType>()

/**
 * Create an Apollo Client with optional JWT authentication
 *
 * Uses the idToken from Cognito as the Bearer token.
 * When idToken is omitted (auth-disabled mode), requests are sent without
 * an Authorization header — the backend creates a mock user automatically.
 * The GraphQL endpoint is derived from the platform config.
 *
 * @param idToken - JWT idToken from Cognito authentication (optional in auth-disabled mode)
 * @returns Configured Apollo Client instance
 */
export function createApolloClient(idToken?: string): ApolloClientType {
  // Cache key: use token if available, otherwise a sentinel for unauthenticated client
  const cacheKey = idToken || '__noauth__'

  // Check cache first
  const cached = clientCache.get(cacheKey)
  if (cached) {
    debug('Using cached Apollo Client')
    return cached
  }

  // Get GraphQL endpoint from platform config
  const platformConfig = getCachedPlatformConfig()
  if (!platformConfig) {
    throw new Error('Platform config not loaded. Initialize the server first.')
  }

  const graphqlEndpoint = getGraphQLEndpoint(platformConfig)
  debug(`Creating Apollo Client for endpoint: ${graphqlEndpoint}${idToken ? '' : ' (no auth)'}`)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`
  }

  const httpLink = new HttpLink({
    uri: graphqlEndpoint,
    fetch,
    headers
  })

  const client = new ApolloClient({
    link: httpLink,
    cache: new InMemoryCache(),
    defaultOptions: {
      query: {
        fetchPolicy: 'no-cache',
        errorPolicy: 'all'
      },
      mutate: {
        fetchPolicy: 'no-cache',
        errorPolicy: 'all'
      }
    }
  })

  // Cache the client
  clientCache.set(cacheKey, client)

  return client
}

/**
 * Clear client from cache (useful for token refresh or logout)
 *
 * @param token - Token to clear from cache, or clear all if not provided
 */
export function clearClientCache(token?: string): void {
  if (token) {
    clientCache.delete(token)
  } else {
    clientCache.clear()
  }
}

/**
 * Test connection to GraphQL API
 *
 * @param client - Apollo Client to test
 * @returns true if connection successful
 */
export async function testConnection(client: ApolloClientType): Promise<boolean> {
  try {
    // Simple introspection query to test connection
    const result = await client.query({
      query: {
        kind: 'Document',
        definitions: [
          {
            kind: 'OperationDefinition',
            operation: 'query',
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: '__typename' }
                }
              ]
            }
          }
        ]
      } as any
    })
    return !result.error
  } catch (error) {
    debug(`Connection test failed: ${error}`)
    return false
  }
}
