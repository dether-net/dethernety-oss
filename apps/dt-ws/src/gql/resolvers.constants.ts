export const RESOLVER_SERVICES = 'RESOLVER_SERVICES';

// The ONE executable GraphQL schema (base + module fragments + platform +
// module resolvers), built once by SchemaModule and shared by every
// transport: Apollo (/graphql), SSE (/graphql/stream), and the health probe.
export const GQL_SCHEMA = 'GQL_SCHEMA';
