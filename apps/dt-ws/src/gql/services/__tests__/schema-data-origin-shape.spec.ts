/**
 * Data origin and credential schema-shape guardrail.
 *
 * Pins the SDL shape of the two author-asserted fields on `Data` — `origin`
 * (the `DataOrigin` enum) and `isCredential` — so an inadvertent edit breaks
 * at CI time rather than silently changing the auto-generated CRUD surface.
 * Text-snapshot rather than introspection for the reason the sibling
 * `schema-zoning-shape.spec.ts` gives: dt-ws builds the executable schema only
 * against a live Bolt driver. The persistence proof is the asset-context e2e.
 *
 * The enum's member order is part of its meaning (most to least trusted), so
 * it is asserted exactly; GraphQL itself attaches no order to enum values.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const SCHEMA_PATH = path.resolve(__dirname, '../../../../schema/schema.graphql');

function block(sdl: string, header: RegExp): string {
  const start = sdl.search(header);
  expect(start).toBeGreaterThanOrEqual(0);
  return sdl.slice(start, sdl.indexOf('\n}', start) + 2);
}

describe('schema.graphql — Data origin and credential shape', () => {
  let sdl: string;

  beforeAll(async () => {
    sdl = await fs.readFile(SCHEMA_PATH, 'utf-8');
  });

  it('declares DataOrigin with its seven members, most to least trusted', () => {
    const members = block(sdl, /^enum DataOrigin \{/m)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+$/.test(line));
    expect(members).toEqual([
      'AUTHENTICATED_FIRST_PARTY',
      'CURATED_INTERNAL',
      'AGENT_RELAYED',
      'MODEL_GENERATED',
      'THIRD_PARTY',
      'ARBITRARY_PUBLIC',
      'NOT_ASSESSED',
    ]);
  });

  it('adds origin and isCredential to Data as nullable fields with descriptions', () => {
    const data = block(sdl, /^type Data implements Element /m);
    expect(data).toMatch(/"[^"]*Null ⇒ unclassified\."\s*\n\s*origin: DataOrigin\n/);
    expect(data).toMatch(/"[^"]*Null ⇒ unknown\."\s*\n\s*isCredential: Boolean\n/);
    expect(data).not.toMatch(/origin: DataOrigin!/);
    expect(data).not.toMatch(/isCredential: Boolean!/);
  });

  it('carries no @authentication on the new constructs, so the no-auth schema generator passes them through', () => {
    expect(block(sdl, /^enum DataOrigin \{/m)).not.toMatch(/@authentication/);
    expect(sdl).not.toMatch(/origin: DataOrigin[^\n]*@authentication/);
    expect(sdl).not.toMatch(/isCredential: Boolean[^\n]*@authentication/);
  });
});
