/**
 * The extensions code a masked error keeps.
 *
 * In production both transports replace an error's message with "Internal
 * server error" and keep ONLY `extensions.code` — so the code is the entire
 * message a client gets. @neo4j/graphql's own refusals carry no code, so
 * Apollo labels them INTERNAL_SERVER_ERROR and, masked, the answer for "this
 * deployment does not admit your account" was byte-identical to a crash. The
 * SPA could only tell the refused person to try again.
 *
 * The library refuses in two places, and they look different on the wire:
 *
 *   - the schema-level `@authentication` check, which every gated type runs
 *     before any Cypher, throws a bare `Neo4jGraphQLError("Unauthenticated")`.
 *     Its `name` is the plain GraphQLError's, so the message — the library's
 *     exported constant AUTHORIZATION_UNAUTHENTICATED — is its only handle;
 *   - the Cypher-level path (apoc.util.validate inside a query) is re-thrown
 *     as `Neo4jGraphQLAuthenticationError` / `Neo4jGraphQLForbiddenError`,
 *     classes the library does not export, recognisable by name.
 *
 * Both are named here with the codes the platform's own resolvers already
 * use (schema.service.ts throws UNAUTHENTICATED for a module resolver called
 * without a verified identity). No oracle is opened: a missing, invalid,
 * expired and unlisted credential all reach the same refusal and get the
 * same code, exactly as the guard's 401 already treats them on REST.
 *
 * graphql-js wraps a thrown error in a located GraphQLError and keeps the
 * thrown one as `originalError`; Apollo may hand formatError either. The
 * chain is walked so the classification does not depend on which. The
 * integration suite pins both shapes against the installed library.
 */
export function maskedErrorCode(error: unknown, fallback = 'INTERNAL_ERROR'): string {
  const explicit = (error as any)?.extensions?.code;
  if (typeof explicit === 'string' && explicit !== 'INTERNAL_SERVER_ERROR') return explicit;

  for (let e: any = error, depth = 0; e && depth < 5; e = e.originalError, depth++) {
    if (e.name === 'Neo4jGraphQLAuthenticationError' || e.message === 'Unauthenticated') return 'UNAUTHENTICATED';
    if (e.name === 'Neo4jGraphQLForbiddenError' || e.message === 'Forbidden') return 'FORBIDDEN';
  }

  return typeof explicit === 'string' ? explicit : fallback;
}
