import { ApolloClient, HttpLink, InMemoryCache, split, from, ApolloLink, Observable } from '@apollo/client/core'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { getMainDefinition } from '@apollo/client/utilities'
import { createClient as createSseClient } from 'graphql-sse'
import { createClient as createWsClient } from 'graphql-ws'
import { print } from 'graphql'
import { useAuthStore } from '@/stores/authStore'
import { getConfig } from '@/config/environment'

// Initialize Apollo client with runtime configuration
let apolloClient: ApolloClient<any> | null = null;

// Create Apollo client with runtime configuration
async function createApolloClient() {
  const config = await getConfig();
  const useWebSocket = config.subscriptionTransport === 'ws';

  if (import.meta.env.DEV) {
    console.log(`[ApolloClient] Subscription transport: ${useWebSocket ? 'WebSocket' : 'SSE'}`);
  }

  // Resolve subscription URL based on transport mode
  const resolveSseUrl = () => {
    const baseUrl = config.graphqlUrl || '/graphql';
    return `${baseUrl}/stream`;
  };

  const resolveWsUrl = () => {
    if (config.graphqlWsUrl) return config.graphqlWsUrl;
    // Auto-detect WebSocket URL from current page
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return `${protocol}//${host}/graphql`;
    }
    return 'ws://localhost:3003/graphql';
  };

  // HTTP link for queries and mutations
  const httpLink = new HttpLink({
    uri: config.graphqlUrl,
  })

  const authLink = setContext(async (_, { headers }) => {
    const authStore = useAuthStore()

    // When auth is disabled (demo / dev mode) skip token handling entirely
    if (authStore.authDisabled) {
      return { headers }
    }

    // Ensure token is still valid before making request
    await authStore.ensureValidToken()

    const token = authStore.token

    return {
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }
    }
  })

  // Error link to handle authentication errors
  const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
    if (graphQLErrors && import.meta.env.DEV) {
      graphQLErrors.forEach(({ message, locations, path }) => {
        console.error(`GraphQL error: Message: ${message}, Location: ${locations}, Path: ${path}`)
      })
    }

    if (networkError) {
      if (import.meta.env.DEV) {
        console.error(`[ApolloClient] Network error: ${networkError}`)
      }

      // Handle 401/403 errors - token might be invalid
      if ('statusCode' in networkError && (networkError.statusCode === 401 || networkError.statusCode === 403)) {
        const authStore = useAuthStore()
        if (import.meta.env.DEV) {
          console.warn('[ApolloClient] GraphQL request unauthorized, clearing session')
        }
        authStore.clearState()
        window.location.href = `${import.meta.env.BASE_URL}login`
      }
    }
  })

  // Create subscription link based on transport mode
  let subscriptionLink: ApolloLink;

  if (useWebSocket) {
    // WebSocket transport (for on-prem deployments)
    const wsUrl = resolveWsUrl();
    if (import.meta.env.DEV) {
      console.log(`[ApolloClient] WebSocket URL: ${wsUrl}`);
    }

    const wsClient = createWsClient({
      url: wsUrl,
      connectionParams: () => {
        const authStore = useAuthStore()
        const token = authStore.token
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
      on: {
        error: async (error: unknown) => {
          if (import.meta.env.DEV) {
            console.error('[ApolloClient] WebSocket error:', error)
          }
          if (error instanceof Error && (error.message?.includes('Unauthorized') || error.message?.includes('401'))) {
            const authStore = useAuthStore()
            try {
              await authStore.ensureValidToken()
            } catch {
              authStore.clearState()
              window.location.href = `${import.meta.env.BASE_URL}login`
            }
          }
        }
      }
    })
    // Type cast needed due to graphql-ws version mismatch between @apollo/client and our dependency
    const wsLink = new GraphQLWsLink(wsClient as any)
    subscriptionLink = wsLink
  } else {
    // SSE transport (default, for CloudFront/CDN deployments)
    const sseUrl = resolveSseUrl();
    if (import.meta.env.DEV) {
      console.log(`[ApolloClient] SSE URL: ${sseUrl}`);
    }

    const sseClient = createSseClient({
      url: sseUrl,
      headers: (): Record<string, string> => {
        const authStore = useAuthStore()
        const token = authStore.token
        if (token) {
          return { Authorization: `Bearer ${token}` }
        }
        return {}
      },
      retryAttempts: 10,
      retry: async (retries) => {
        // Refresh token before reconnecting (headers function will pick up new token)
        const authStore = useAuthStore()
        try {
          await authStore.ensureValidToken()
        } catch {
          // Token refresh failed — stop retrying by throwing
          throw new Error('Token refresh failed, stopping SSE retry')
        }
        // Exponential backoff: 1s, 2s, 4s, ... capped at 30s
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(1000 * 2 ** retries, 30000))
        )
      },
    })

    const sseLink = new ApolloLink((operation) => {
      return new Observable((observer) => {
        const unsubscribe = sseClient.subscribe(
          { ...operation, query: print(operation.query) },
          {
            next: (data: unknown) => observer.next(data as any),
            error: async (err: unknown) => {
              if (import.meta.env.DEV) {
                console.error('[ApolloClient] SSE error:', err)
              }
              if (err instanceof Error && (err.message?.includes('Unauthorized') || err.message?.includes('401'))) {
                const authStore = useAuthStore()
                try {
                  await authStore.ensureValidToken()
                } catch {
                  authStore.clearState()
                  window.location.href = `${import.meta.env.BASE_URL}login`
                  return
                }
              }
              observer.error(err)
            },
            complete: () => observer.complete(),
          }
        )
        return () => unsubscribe()
      })
    })
    subscriptionLink = sseLink
  }

  // Using split, direct subscription operations to the subscriptionLink and others to the httpLink
  const splitLink = split(
    ({ query }) => {
      const definition = getMainDefinition(query)
      return (
        definition.kind === 'OperationDefinition' &&
        definition.operation === 'subscription'
      )
    },
    subscriptionLink,
    from([errorLink, authLink, httpLink]) // HTTP with auth and error handling
  )

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            folders: {
              merge (existing, incoming) {
                return incoming
              },
            },
            analyses: {
              merge (existing, incoming) {
                return incoming
              },
            },
          },
        },
        Folder: {
          fields: {
            childrenFolders: {
              merge (existing, incoming) {
                return incoming
              },
            },
            models: {
              merge (existing, incoming) {
                return incoming
              },
            },
            controls: {
              merge (existing, incoming) {
                return incoming
              },
            },
            parentFolder: {
              merge (existing, incoming) {
                return incoming
              },
            },
          },
        },
        Issue: {
          fields: {
            elements: {
              merge (existing, incoming) {
                // Always replace the entire array to avoid cache merge conflicts
                return incoming
              },
            },
            elementsWithExtendedInfo: {
              merge (existing, incoming) {
                // Always replace the entire array to avoid cache merge conflicts
                return incoming
              },
            },
          },
        },
      },
    }),
  })
}

// Get or create Apollo client
export async function getApolloClient() {
  if (!apolloClient) {
    apolloClient = await createApolloClient();
  }
  return apolloClient;
}

// Proxy object that lazily initializes the client
const apolloClientProxy = new Proxy({} as ApolloClient<any>, {
  get(target, prop) {
    if (!apolloClient) {
      throw new Error('Apollo client not initialized yet. Call initializeApolloClient() in your app startup.');
    }
    return (apolloClient as any)[prop];
  }
});

// Initialize function to be called during app startup
export async function initializeApolloClient(): Promise<ApolloClient<any>> {
  if (!apolloClient) {
    apolloClient = await createApolloClient();
  }
  return apolloClient;
}

// Default export - proxy that provides synchronous access after initialization
export default apolloClientProxy;
