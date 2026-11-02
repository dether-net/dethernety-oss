/**
 * Platform capabilities this plugin's GraphQL documents depend on.
 *
 * The documents the plugin sends select a data item's controls (`Data.controls`, `Control.supportedData`). A platform
 * older than that field refuses every one of those documents at validation, so on such a platform every model export,
 * import, push and control assignment fails with an error that does not say why. The probe asks for the field and turns
 * that into one message that does.
 *
 * Introspection is off on production platforms, so the probe is an ordinary query: it selects the field on a filter
 * that matches no node. A platform that has the field answers with an empty list; one that lacks it refuses the query
 * before it runs. A production platform masks every error message, so the refusal is recognised by its code as well
 * as by its wording: the probe is one fixed document, valid wherever the field exists, so a validation failure of it
 * means the field is missing.
 */

import { gql } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'

export const DATA_CONTROLS_PROBE = gql`
  query DetherealDataControlsProbe {
    data(where: { id: { eq: "" } }) {
      id
      controls {
        id
      }
    }
  }
`

/** What a platform without the field answers, in GraphQL's own validation wording, when messages are not masked. */
const MISSING_FIELD = /Cannot query field "controls" on type "Data"/

/** The code a GraphQL server gives a document that fails validation; it survives a production platform's masking. */
const VALIDATION_FAILED = 'GRAPHQL_VALIDATION_FAILED'

/** Platforms that answered the probe with the field present. A missing field is not remembered: it is re-asked. */
const supported = new Set<string>()

type GraphQLErrorLike = { message?: unknown; extensions?: { code?: unknown } }

/**
 * The GraphQL errors a failed query carries: on the error itself (a GraphQL error response), or in the body of a
 * non-2xx response the client did not parse as GraphQL (a server error).
 */
const graphQLErrorsOf = (error: unknown): GraphQLErrorLike[] => {
  const e = error as { message?: unknown; errors?: unknown; bodyText?: unknown }
  const errors: GraphQLErrorLike[] = Array.isArray(e?.errors) ? [...e.errors] : []
  if (typeof e?.bodyText === 'string') {
    try {
      const body = JSON.parse(e.bodyText) as { errors?: unknown }
      if (Array.isArray(body?.errors)) errors.push(...body.errors)
    } catch {
      // Not a GraphQL body: nothing to read.
    }
  }
  return [{ message: e?.message }, ...errors]
}

const isRefusal = (error: unknown): boolean =>
  graphQLErrorsOf(error).some(
    (x) => (typeof x?.message === 'string' && MISSING_FIELD.test(x.message)) || x?.extensions?.code === VALIDATION_FAILED,
  )

/** The platform's origin, which is how a message names it: a URL can carry a login, which a message must not. */
const originOf = (platformUrl: string): string => {
  try {
    return new URL(platformUrl).origin
  } catch {
    return 'the configured platform'
  }
}

/**
 * Why this plugin cannot work with the platform at `platformUrl`, or undefined when it can, or when the probe could not
 * tell (the request failed for another reason, which the tool's own request will then report).
 */
export async function missingPlatformCapability(client: ApolloClient, platformUrl: string): Promise<string | undefined> {
  if (supported.has(platformUrl)) return undefined
  try {
    await client.query({ query: DATA_CONTROLS_PROBE, fetchPolicy: 'no-cache' })
    supported.add(platformUrl)
    return undefined
  } catch (error) {
    if (!isRefusal(error)) return undefined
    return (
      `The platform at ${originOf(platformUrl)} is older than this version of Dethereal: it refused a query for ` +
      `controls on data elements (Data.controls), which this version's model export, import, push and control ` +
      `assignment read. Update the platform, or use a Dethereal version released before controls on data elements.`
    )
  }
}

/** Forget the platforms the probe has accepted. For tests. */
export function clearPlatformCapabilityCache(): void {
  supported.clear()
}
