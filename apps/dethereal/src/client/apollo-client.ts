/**
 * Apollo Client Factory
 *
 * Creates Apollo Client instances with JWT Bearer authentication for
 * communicating with the Dethernety GraphQL API.
 * Uses idToken from Cognito as the Bearer token.
 */

import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'
import type { ApolloClient as ApolloClientTypeImport } from '@apollo/client'

// Apollo 4 requires application-wide default options to be DECLARED before they
// can be set, so call sites downstream are typed against the same default.
// Without this block, `errorPolicy: 'none'` below is a type error whose message
// is the instruction to add it.
//
// This became visible only when the client stopped being loaded through
// `createRequire`, which returned `any` and type-checked nothing: the
// `errorPolicy: 'none'` intent was asserted at runtime and unverified at
// compile time. Keep the declaration and the explicit setting in step.
declare module '@apollo/client' {
  namespace ApolloClient {
    namespace DeclareDefaultOptions {
      interface Query {
        errorPolicy: 'none'
      }
      interface Mutate {
        errorPolicy: 'none'
      }
    }
  }
}

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
        // 'none' makes GraphQL errors reject with an ApolloError carrying
        // graphQLErrors[].message. With 'all', calls resolve as
        // { data: null, errors } and dt-core's null-data check collapses
        // every backend failure (expired token, authz denial, validation)
        // into an opaque "No data returned for <action>".
        errorPolicy: 'none'
      },
      mutate: {
        fetchPolicy: 'no-cache',
        errorPolicy: 'none'
      }
    }
  })

  // Cache the client. A long-lived MCP process refreshes tokens many times —
  // each refresh mints a new key, and stale clients would pin their old
  // bearer token in closure forever. Keep exactly one client: reaching this
  // point means the key was a miss, so evict whatever came before.
  clientCache.clear()
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
