/**
 * Minimal Apollo Client Vue composable utilities.
 *
 * Replaces @vue/apollo-composable which does not yet support Apollo Client 4.
 * Only the two features actually used in this app are implemented:
 *   - DefaultApolloClient  — InjectionKey for provide/inject
 *   - useApolloClient()    — composable to retrieve the injected client
 */

import type { InjectionKey } from 'vue'
import { inject } from 'vue'
import type { ApolloClient } from '@apollo/client/core'

export const DefaultApolloClient: InjectionKey<ApolloClient> = Symbol('DefaultApolloClient')

export function useApolloClient() {
  const client = inject(DefaultApolloClient)
  if (!client) {
    throw new Error(
      'Apollo Client not found. Did you forget to provide DefaultApolloClient?'
    )
  }
  return { client }
}
