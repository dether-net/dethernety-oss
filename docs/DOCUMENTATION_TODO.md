# Documentation TODO

Gaps identified by comparing against OSS projects of similar scope (Backstage, Hasura, Strapi, OWASP Threat Dragon).

## High priority

- **Dedicated docs site** -- All mature OSS projects have a searchable, versioned documentation site (Docusaurus, VitePress, or similar). The current markdown-in-repo approach works but doesn't scale for discoverability.
- **Troubleshooting guide** -- Common errors during setup (database connection failures, OIDC misconfiguration, module loading issues) with concrete solutions. This is a frequent friction point for new users.

## Medium priority

- **Production deployment checklist** -- Step-by-step guide beyond the Docker quickstart: TLS configuration, database backups, OIDC provider setup, reverse proxy, monitoring. Operators self-hosting a security tool need this.
- **Testing guide** -- CONTRIBUTING.md references `pnpm test` but there's no guide on test structure, how to write tests for modules, or how to run specific test suites.
- **Database operations guide** -- Backup and restore, migration between Neo4j and Memgraph, index management, scaling considerations.

## Low priority

- **Versioned documentation** -- Not needed until v1.0, but worth planning for. The docs site (if built) should support version pinning.
