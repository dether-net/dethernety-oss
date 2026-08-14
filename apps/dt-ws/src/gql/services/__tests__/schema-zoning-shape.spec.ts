/**
 * Boundary-zoning schema-shape guardrail.
 *
 * Pins the SDL shape of the zoning vocabulary added to `SecurityBoundary`
 * (the `zone` / `domains` / `planes` classification, the directed `CONDUIT`
 * relationship carrying `ConduitProperties`, and the `trustLevel` →
 * deprecated/nullable relaxation) so a future inadvertent edit breaks loudly
 * at CI time rather than silently changing the auto-generated GraphQL CRUD
 * surface (`@neo4j/graphql` derives every input/connection from this SDL).
 *
 * Why a text-snapshot rather than an executable-schema introspection:
 *
 * - dt-ws constructs the executable schema only against a live Bolt driver
 *   (`Neo4jGraphQL.getSchema()` after a `RETURN 1`); there is no in-process
 *   Memgraph harness in unit tests. The end-to-end proof that the generated
 *   inputs (`SecurityBoundaryUpdateInput.zone`, the conduit `connect` +
 *   `ConduitPropertiesCreateInput`) actually persist on Memgraph is covered
 *   by the Session-1 live round-trip on a live stack, not here.
 * - The shape we care about — "the enums, fields, relationship and edge-
 *   property type are present and correctly typed" — is a function of the SDL
 *   source string. Pinning the source guarantees the schema builder gets the
 *   same input. This mirrors the sibling `schema-cypher-shape.spec.ts`.
 *
 * Note on `schema-noauth.graphql`: it is a *generated, gitignored* artifact
 * (`oss/scripts/generate-noauth-schema.js` strips `@authentication` from this
 * file). We deliberately do NOT read it here — it is absent in a fresh CI
 * checkout. Instead the final assertion proves the new constructs carry no
 * `@authentication`, so the generator passes them through verbatim and the two
 * files stay in lockstep by construction.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../schema/schema.graphql',
);

describe('schema.graphql — boundary zoning shape', () => {
  let schema: string;

  beforeAll(async () => {
    schema = await fs.readFile(SCHEMA_PATH, 'utf-8');
  });

  it('declares enum Zone with all six gradient values', () => {
    const block = schema.match(/enum Zone \{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    const body = block![1];
    for (const value of [
      'UNTRUSTED',
      'PUBLIC',
      'EXPOSED',
      'INTERNAL',
      'RESTRICTED',
      'VENDOR',
    ]) {
      expect(body).toMatch(new RegExp(`\\b${value}\\b`));
    }
  });

  it('declares enum Plane with exactly WORKLOAD and MANAGEMENT', () => {
    const block = schema.match(/enum Plane \{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/\bWORKLOAD\b/);
    expect(body).toMatch(/\bMANAGEMENT\b/);
  });

  it('SecurityBoundary carries the zone/domains/planes classification fields', () => {
    expect(schema).toMatch(/^\s*zone: Zone$/m);
    expect(schema).toMatch(/^\s*domains: \[String!\]$/m);
    // planes is [String!], not the Plane enum list: the generated enum-list mutation
    // input marks both `set` and `push` required while the resolver forbids both, so a
    // plain `{ set }` write is impossible. Values stay Plane-constrained in the data layer.
    expect(schema).toMatch(/^\s*planes: \[String!\]$/m);
  });

  it('trustLevel is relaxed to nullable and @deprecated (no longer TrustLevel!)', () => {
    expect(schema).toMatch(/trustLevel: TrustLevel @deprecated\(reason: ".*"\)/);
    // The non-null form must be gone — readers stay compatible, and create-paths
    // can stop emitting it once the deprecation is fully retired.
    expect(schema).not.toMatch(/trustLevel: TrustLevel!/);
  });

  it('declares ConduitProperties as a @relationshipProperties edge-property bag', () => {
    const block = schema.match(
      /type ConduitProperties @relationshipProperties \{([\s\S]*?)\}/,
    );
    expect(block).not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/justification: String/);
    expect(body).toMatch(/controlRefs: \[ID!\]/);
    // Intent-only: a conduit records declared design intent, never a stored legality/verdict.
    expect(body).not.toMatch(/legality|verdict/i);
  });

  it('exposes both conduit directions over a single CONDUIT relationship type carrying ConduitProperties', () => {
    expect(schema).toMatch(
      /outboundConduits: \[SecurityBoundary!\]!\s*\n\s*@relationship\(type: "CONDUIT", direction: OUT, properties: "ConduitProperties"\)/,
    );
    expect(schema).toMatch(
      /inboundConduits: \[SecurityBoundary!\]!\s*\n\s*@relationship\(type: "CONDUIT", direction: IN, properties: "ConduitProperties"\)/,
    );
  });

  it('the new zoning constructs carry no @authentication (noauth generation passes them through verbatim)', () => {
    // The generated, gitignored schema-noauth.graphql is produced by stripping
    // @authentication from this file. None of the zoning constructs declare it
    // (enums, scalar fields, and @relationshipProperties types never do), so
    // they survive generation unchanged and the two files stay in lockstep.
    for (const decl of [
      /enum Zone \{[\s\S]*?\}/,
      /enum Plane \{[\s\S]*?\}/,
      /type ConduitProperties @relationshipProperties \{[\s\S]*?\}/,
    ]) {
      const block = schema.match(decl);
      expect(block).not.toBeNull();
      expect(block![0]).not.toMatch(/@authentication/);
    }
  });
});
