/**
 * Populates the `authoredBy` field on Exposure / Countermeasure nodes at
 * CREATE time with the authenticated user identifier (JWT `sub` claim)
 * from the GraphQL context.
 *
 * Wired via the `@populatedBy(callback: "populateAuthoredByOnCreate",
 * operations: [CREATE])` directive in schema.graphql. The directive only
 * fires on the auto-generated `createExposures` / `createCountermeasures`
 * mutations; SYSTEM-instantiated findings (created via Cypher MERGE in
 * `SetInstantiationAttributesService` and `ElementBindingService`) bypass
 * this callback and carry resolver-side
 * provenance stamping instead.
 *
 * Context shape (per `gql.module.ts` context factory): `{ token, jwt,
 * user, driver, sessionConfig, cypherQueryOptions }`. `user` is a
 * top-level property holding the decoded JWT claims (so `user.sub` is
 * the subject identifier per RFC 7519). There is NO `context.req`
 * nesting in the production server — the prior version of this callback
 * read `context.req.user.id` which silently returned null for every
 * authenticated request.
 *
 * @neo4j/graphql v7.x callback signature is positional `(parent, args,
 * context, info)`. (The destructured `({ context }) => ...` shape was the
 * v3 form; v7 dropped it.)
 *
 * Returns `null` when the context carries no authenticated user — the
 * directive allows null and leaves the field unset, which the cleanup
 * paths treat as "could not attribute, no enforcement implication."
 */
export const populateAuthoredByOnCreate = (
  _parent: unknown,
  _args: unknown,
  context: any,
): string | null => {
  return context?.user?.sub ?? null;
};

/**
 * Populates `createdBy = 'USER'` on auto-generated create mutations.
 *
 * Why a callback instead of `@default(value: USER)`: in @neo4j/graphql
 * v7.2.0, combining `@default` with `@settable(onCreate: false)` results
 * in the default not firing — the field gets persisted as null. The
 * library treats settable:false-on-create as "field is not set at all on
 * create", which suppresses the @default fallback. Verified by the
 * integration tests in provenance.e2e-spec.ts.
 *
 * Replacing @default with @populatedBy gives a callback the resolver
 * runs unconditionally on CREATE, regardless of @settable behavior, so
 * the field reliably lands on the node. The callback returns the literal
 * 'USER' (matching the AuthorshipKind enum's string serialisation).
 *
 * The corresponding SYSTEM write path (Cypher-direct in
 * SetInstantiationAttributesService) sets createdBy = 'SYSTEM' inline
 * and bypasses the auto-generated mutation, so this callback never sees
 * SYSTEM writes.
 */
export const stampCreatedByUserOnCreate = (
  _parent: unknown,
  _args: unknown,
  _context: any,
): string => {
  return 'USER';
};
