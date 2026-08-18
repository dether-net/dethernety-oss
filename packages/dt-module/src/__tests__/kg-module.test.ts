/**
 * The remote knowledge-graph module's GraphQL surface, executed rather than introspected.
 *
 * The fragment is built into a schema, the module's own resolvers are attached to it, and real
 * documents are run against the in-process service. That catches everything introspection would —
 * a missing field, a wrong nullability — and also the things it would not: that the resolvers fill
 * what they declare, that the bearer travels, and that one question about a class stays one
 * question rather than becoming one per rule.
 *
 * The document exercised here selects **every** declared field, which is broader than the one a
 * consumer sends today. That is deliberate: the consumer's document lives in another repository,
 * and a test written against a copy of it would only ever prove that the copy still matches.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSchema, graphql, GraphQLObjectType, GraphQLSchema } from 'graphql';
import { Logger } from '@nestjs/common';
import { DtRemoteKnowledgeGraphModule } from '../kg/remote-kg-module';
import { KG_CAPABILITY_SDL, KG_REMOTE_SDL } from '../kg/schema';
import { ResolverMap } from '../interfaces/module-resolver-interface';
import { MockContentServer } from '../testing/mock-content-server';
import {
  ENTITLED_TOKEN,
  KG_CLASS_ID,
  KG_COLLIDING_RULE_ID,
  KG_OTHER_CLASS_ID,
  KG_VERSION,
  UNENTITLED_TOKEN,
} from '../testing/fixtures';

const mock = new MockContentServer();
const BASE_URL = 'https://mock.local';

/**
 * A schema from the module's fragment.
 *
 * The fragment extends `Query` rather than defining it, and a document cannot extend a type it
 * does not contain, so a placeholder is prepended. That is a property of building a fragment in
 * isolation — the platform assembles it onto a real `Query`.
 */
function schemaFrom(sdl: string): GraphQLSchema {
  return buildSchema(`type Query { _placeholder: Boolean }\n${sdl}`);
}

/** Attach a resolver map to a built schema — what a schema-stitching library would do for us, in
 * the eight lines that avoid taking a dependency on one. */
function attach(schema: GraphQLSchema, resolvers: ResolverMap): GraphQLSchema {
  for (const [typeName, fields] of Object.entries(resolvers)) {
    const type = schema.getType(typeName) as GraphQLObjectType | undefined;
    if (!type) throw new Error(`the resolver map names a type the schema does not declare: ${typeName}`);
    const declared = type.getFields();
    for (const [fieldName, fn] of Object.entries(fields)) {
      if (!declared[fieldName]) {
        throw new Error(`the resolver map names a field the schema does not declare: ${typeName}.${fieldName}`);
      }
      declared[fieldName].resolve = fn as never;
    }
  }
  return schema;
}

/** The module, wired to the mock, with its resolvers attached to its own schema. */
function moduleSchema() {
  const mod = new DtRemoteKnowledgeGraphModule({}, new Logger('test'));
  const resolvers = mod.getResolvers({
    driver: {},
    logger: new Logger('test'),
  } as never);
  return attach(schemaFrom(mod.getSchemaExtension()), resolvers);
}

/** Run a document as a caller holding `token`. */
async function run(source: string, token?: string, variableValues?: Record<string, unknown>) {
  return graphql({ schema: moduleSchema(), source, contextValue: { token }, variableValues });
}

/** Every field the surface declares, selected at once. */
const EVERYTHING = `
  query All($classId: String!) {
    kgCapability { available entitled sliceCount }
    matchKgStandards(query: "tls")
    matchKgThreats(query: "tls")
    kgRules(where: { classId: { eq: $classId } }) {
      id ruleId classId kind name description criticality score attackVector
      conditionGroups mitreRefs
      reads { name title description category }
      addresses {
        id slug name description attackSurface techniqueIds techniqueProvenance
        derivedFrom { id kind title canonicalUrl synthesis accessed resolved }
      }
    }
  }
`;

beforeEach(() => {
  mock.reset();
  vi.stubEnv('MODULE_KG_BASE_URL', BASE_URL);
  vi.stubEnv('MODULE_KG_VERSION', KG_VERSION);
  // The factory builds the client and the client builds its own transport, so the one seam a test
  // needs is the global `fetch` — stubbed rather than assigned, so nothing leaks past this file.
  vi.stubGlobal('fetch', mock.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the declared surface answers', () => {
  it('resolves every field it declares, end to end', async () => {
    const res = await run(EVERYTHING, ENTITLED_TOKEN, { classId: KG_CLASS_ID });
    expect(res.errors).toBeUndefined();

    const data = res.data as any;
    expect(data.kgCapability).toEqual({ available: true, entitled: true, sliceCount: 2 });
    // A JSON-encoded string, not a list — the local stubs' own return type, so a consumer cannot
    // tell the modes apart by a type error on a field that answers nothing either way.
    expect(data.matchKgStandards).toBe('[]');
    expect(data.matchKgThreats).toBe('[]');

    const [rule] = data.kgRules;
    expect(rule.classId).toBe(KG_CLASS_ID);
    expect(rule.ruleId).toBe(KG_COLLIDING_RULE_ID);
    expect(rule.score).toEqual(expect.any(Number));
    expect(rule.reads[0].name).toEqual(expect.any(String));
    expect(rule.addresses[0].slug).toEqual(expect.any(String));
    expect(rule.addresses[0].derivedFrom[0].synthesis).toEqual(expect.any(String));
  });

  it('answers a class with no rules with an empty list, not an error', async () => {
    const res = await run(EVERYTHING, ENTITLED_TOKEN, { classId: 'acme-compute.nothing-here' });
    expect(res.errors).toBeUndefined();
    expect((res.data as any).kgRules).toEqual([]);
  });
});

describe('threats are fetched once, not once per rule', () => {
  it('costs two calls for a rule set of any size', async () => {
    // A field resolver on `addresses` would fire per rule and turn one question about a class into
    // one request per rule it has — the round-trip-per-key degradation the batch surface exists to
    // prevent, and a multiplier on every per-request bound the service applies.
    const res = await run(EVERYTHING, ENTITLED_TOKEN, { classId: KG_CLASS_ID });
    expect(res.errors).toBeUndefined();
    const queries = mock.requests.filter((r) => r.method === 'POST');
    expect(queries).toHaveLength(2);
    expect(queries.map((r) => r.path.split('/query/')[1])).toEqual(['rulesByClassId', 'threatsByRuleId']);
  });

  it('reads the threat map by the composite key, not by the rule id alone', async () => {
    // The map the client returns is keyed by class *and* rule, because rule ids are unique only
    // within a class. Indexing it by the bare rule id finds nothing and yields an empty threat
    // list — a rule that addresses nothing, which is a plausible-looking answer and therefore the
    // dangerous kind of wrong. The fixture's two classes share one rule id so the key matters.
    const res = await run(EVERYTHING, ENTITLED_TOKEN, { classId: KG_OTHER_CLASS_ID });
    expect(res.errors).toBeUndefined();
    const [rule] = (res.data as any).kgRules;
    expect(rule.ruleId).toBe(KG_COLLIDING_RULE_ID);
    expect(rule.addresses.map((t: { slug: string }) => t.slug)).toEqual(['downgrade']);
  });
});

describe('the filter subset is exactly what is declared', () => {
  it.each([
    ['a limit', `{ kgRules(limit: 1) { id } }`],
    ['a substring match', `{ kgRules(where: { classId: { contains: "acme" } }) { id } }`],
    ['an undeclared field', `{ kgRules(where: { classId: { eq: "x" } }) { irVersion } }`],
    ['an undeclared root field', `{ kgThreats { id } }`],
  ])('fails validation on %s', async (_label, source) => {
    // The loud failure, chosen over the quiet one. A consumer reaching outside the subset is told
    // immediately and by name; a declared field with nothing behind it would return a null that
    // reads as real absence.
    const res = await run(source, ENTITLED_TOKEN);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(res.data).toBeFalsy();
  });

  it('refuses a filter naming no class, without asking the service', async () => {
    const res = await run(`{ kgRules(where: { ruleId: { eq: "x" } }) { id } }`, ENTITLED_TOKEN);
    expect(res.errors?.[0].message).toMatch(/classId/);
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('narrows by ruleId when one is given', async () => {
    const source = `query { kgRules(where: { classId: { eq: "${KG_CLASS_ID}", }, ruleId: { eq: "no-such-rule" } }) { id } }`;
    const res = await run(source, ENTITLED_TOKEN);
    expect(res.errors).toBeUndefined();
    expect((res.data as any).kgRules).toEqual([]);
  });
});

describe('the caller travels with the call', () => {
  it('forwards the bearer to the service', async () => {
    await run(EVERYTHING, ENTITLED_TOKEN, { classId: KG_CLASS_ID });
    const entitled = mock.requests.filter((r) => r.method === 'POST' || r.path.endsWith('/capability'));
    expect(entitled.length).toBeGreaterThan(0);
    expect(entitled.every((r) => r.token === ENTITLED_TOKEN)).toBe(true);
  });

  it('surfaces a refusal as an error, never as an empty rule list', async () => {
    // The distinction the whole surface exists to keep: "you may not ask" and "nothing matched"
    // must not arrive looking the same.
    const res = await run(EVERYTHING, UNENTITLED_TOKEN, { classId: KG_CLASS_ID });
    expect(res.errors?.length).toBeGreaterThan(0);
    expect((res.data as any)?.kgRules).toBeFalsy();
  });

  it('surfaces a missing session as an error, and asks nothing', async () => {
    const res = await run(`{ kgRules(where: { classId: { eq: "${KG_CLASS_ID}" } }) { id } }`);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('the capability fragment is shared, so it must stand alone', () => {
  it('parses by itself and declares what both modules need', () => {
    // Two repositories now depend on this constant agreeing with itself. Cheap to check, and the
    // failure it prevents is a consumer's availability question validating in one mode only.
    const schema = schemaFrom(KG_CAPABILITY_SDL);
    const capability = schema.getType('KgCapability') as GraphQLObjectType;
    expect(Object.keys(capability.getFields()).sort()).toEqual(['available', 'entitled', 'sliceCount']);
    const query = schema.getType('Query') as GraphQLObjectType;
    expect(String(query.getFields().kgCapability.type)).toBe('KgCapability!');
  });

  it('is contained in the remote fragment verbatim', () => {
    expect(KG_REMOTE_SDL).toContain(KG_CAPABILITY_SDL);
  });
});
