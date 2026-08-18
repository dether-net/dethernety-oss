/**
 * The knowledge-graph contract suite — the executable form of the protocol's kg surface.
 *
 * Parameterized by a transport rather than by a client, and permanently so: what it asserts is the
 * surface's own shape — which routes need a credential, which statuses the outcomes carry, and that
 * no answer omits a requested key. Those are properties of the service, provable without any client
 * existing, and a client is the wrong instrument for them because a conforming client can hide a
 * non-conforming service behind a retry or a fallback.
 *
 * Client behaviour is asserted next door, by `kg-client.contract.ts` run against each
 * implementation — see the note at the foot of this file for which obligations moved there and why.
 *
 * **Three of the protocol's conformance obligations are deliberately not here**, because this
 * suite cannot own them: the request-counter accounting is service-side, the package-to-slice
 * index behaviour belongs to the publisher, and the end-to-end consumer query belongs to the
 * consumer. They are asserted where they live, and this note exists so that reading a green run
 * here is not mistaken for whole-contract coverage.
 *
 * **Nor is anything below the interface.** Mode selection and the local implementation are not
 * protocol properties and have no transport to be parameterized by; they are asserted in the
 * package's own `kg-factory` and `kg-local` suites.
 */
import { describe, it, expect } from 'vitest';
import type { MockContentServer } from '../mock-content-server';
import {
  KG_VERSION,
  KG_CLASS_ID,
  KG_OTHER_CLASS_ID,
  KG_COLLIDING_RULE_ID,
  KG_UNMATCHED_CLASS_ID,
  ENTITLED_TOKEN,
  UNENTITLED_TOKEN,
  EXPIRED_TOKEN,
  kgRegistry,
  kgRefKey,
} from '../fixtures';

export interface KgContractHarness {
  /** The transport under test — the mock's `fetch`, or a real service's later. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The mock backing it, for driving scenarios and asserting what was sent. */
  mock: MockContentServer;
}

const BASE = 'https://mock.local';

function auth(token?: string): RequestInit {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
}

/** POST a named query with the given parameter object. */
function queryInit(token: string | undefined, parameters: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ requestId: 'fixture-request-id', parameters }),
  };
}

/** Every value nested anywhere in a response body — for the no-embeddings sweep. */
function* walk(value: unknown): Generator<unknown> {
  yield value;
  if (Array.isArray(value)) {
    for (const v of value) yield* walk(v);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) yield* walk(v);
  }
}

/**
 * Register the knowledge-graph contract suite. Call from a `*.test.ts` supplying the harness with
 * per-test isolation (a mock reset).
 */
export function runKgContractSuite(harness: KgContractHarness): void {
  const get = (path: string, token?: string) => harness.fetch(`${BASE}${path}`, auth(token));

  describe('knowledge-graph wire-protocol contract', () => {
    describe('the public routes need no credential', () => {
      // This is the erratum made executable. The registry, the version list and the slice list are
      // interface definitions, not data: they are readable with no token, and a client MUST NOT
      // send one, because those responses are shared-cacheable and a bearer on them ends up in
      // third-party logs having bought nothing.
      it.each([
        ['/v1/kg/queries'],
        ['/v1/kg/versions'],
        [`/v1/kg/versions/${KG_VERSION}`],
      ])('%s answers 200 with no Authorization header', async (path) => {
        const res = await get(path);
        expect(res.status).toBe(200);
        const sent = harness.mock.requests.filter((r) => r.path === path);
        expect(sent).toHaveLength(1);
        expect(sent[0].token).toBeUndefined();
      });

      it('the registry publishes a privacy statement per query, none carrying free text', async () => {
        const body = (await (await get('/v1/kg/queries')).json()) as typeof kgRegistry;
        expect(body.queries.length).toBeGreaterThan(0);
        for (const q of body.queries) {
          expect(q.privacy.sends).toBeTruthy();
          // The flag exists so the property is checkable per query rather than asserted globally.
          // In this protocol version every query is keyed by content-vocabulary identifiers, so
          // every one of them is false; a future query that is not would have to say so here.
          expect(q.privacy.freeText).toBe(false);
        }
      });

      it('an unknown version is 404, not an empty slice list', async () => {
        expect((await get('/v1/kg/versions/sha256:deadbeef')).status).toBe(404);
      });

      it('every published version id is a content digest', async () => {
        // A client validates this before it will address a version, so a listing carrying anything
        // else makes that version unreachable rather than merely unusual.
        const body = (await (await get('/v1/kg/versions')).json()) as {
          latest: string;
          versions: Array<{ id: string }>;
        };
        const digest = /^sha256:[0-9a-f]{64}$/;
        expect(body.latest).toMatch(digest);
        for (const v of body.versions) expect(v.id).toMatch(digest);
      });
    });

    describe('the entitled routes distinguish their denials', () => {
      // Each of these means something different to a consumer, so each has to be separable. The
      // failure this prevents is a caller rendering "no findings" when the real answer was
      // "your subscription does not cover this".
      it('no bearer is 401 — an authentication failure, never a denial', async () => {
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`);
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('invalid_token');
      });

      it('an expired bearer is 401 token_expired', async () => {
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`, EXPIRED_TOKEN);
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('token_expired');
      });

      it('a valid but unentitled bearer is ANSWERED, not refused', async () => {
        // The one route on this surface where a 403 would be wrong, and this suite asserted one for
        // three slices. `capability` exists so a consumer can ask "may I?" WITHOUT issuing an
        // unfiltered query; refusing it forces exactly the probe it was added to prevent, and
        // collapses "there is no graph here" into "you may not read it" — the two outcomes the whole
        // contract is built to keep apart.
        //
        // The service always answered 200 here. The mock and this assertion did not, and nothing
        // caught it because the suite runs against the mock: two executable forms of one protocol,
        // agreeing with each other and disagreeing with production.
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`, UNENTITLED_TOKEN);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.available).toBe(true);
        expect(body.entitled).toBe(false);
        expect(body.entitledSliceCount).toBe(0);
      });

      it('an entitled bearer gets a capability answer, not an enumeration', async () => {
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`, ENTITLED_TOKEN);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.available).toBe(true);
        expect(body.entitled).toBe(true);
        // The wire name, asserted because the client's own field is called something else: local
        // mode has no entitled slices to count. Two names either side of one mapping is fine; two
        // names and no assertion is how the mock and the service quietly stop agreeing.
        expect(body.entitledSliceCount).toBeTypeOf('number');
        expect(body.sliceCount).toBeUndefined();
      });

      it('a recalled version answers 410 even to an unentitled caller', async () => {
        // Recall precedes entitlement. A withdrawn version is withdrawn for everyone, and
        // subscription state must not mask it — a caller owed "this version is known-bad" must
        // never be told "you may not ask" instead, because the two demand different responses.
        harness.mock.recallKgVersion(KG_VERSION);
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`, UNENTITLED_TOKEN);
        expect(res.status).toBe(410);
        expect((await res.json()).code).toBe('version_recalled');
      });

      it('recalling a content pin does not recall the knowledge-graph version', async () => {
        harness.mock.recall(KG_VERSION);
        const res = await get(`/v1/kg/versions/${KG_VERSION}/capability`, ENTITLED_TOKEN);
        expect(res.status).toBe(200);
      });
    });

    describe('every query is keyed', () => {
      const q = (name: string, params: unknown, token: string | undefined = ENTITLED_TOKEN) =>
        harness.fetch(`${BASE}/v1/kg/versions/${KG_VERSION}/query/${name}`, queryInit(token, params));

      it('an unknown query name is 404', async () => {
        expect((await q('everything', { classIds: [KG_CLASS_ID] })).status).toBe(404);
      });

      it.each([
        ['an absent key set', {}],
        ['an empty key set', { classIds: [] }],
        ['a missing parameters object', undefined],
      ])('%s is rejected with 400', async (_label, params) => {
        // There is no query, and no parameter combination, that returns everything. This is the
        // property that makes the surface bounded rather than a graph dump behind a login.
        const res = await q('rulesByClassId', params);
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('payload_invalid');
      });

      it('a malformed body is 400, not a 500', async () => {
        const res = await harness.fetch(`${BASE}/v1/kg/versions/${KG_VERSION}/query/rulesByClassId`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ENTITLED_TOKEN}` },
          body: '{ not json',
        });
        expect(res.status).toBe(400);
      });

      it('results are grouped by input key, and every requested key is present', async () => {
        // A key that matched nothing comes back with an empty array rather than being dropped.
        // Omitting it would make "no matches" and "not asked" indistinguishable at the call site,
        // which is the whole reason the envelope is keyed.
        const res = await q('rulesByClassId', { classIds: [KG_CLASS_ID, KG_UNMATCHED_CLASS_ID] });
        const body = await res.json();
        expect(body.results.map((r: { key: string }) => r.key)).toEqual([KG_CLASS_ID, KG_UNMATCHED_CLASS_ID]);
        expect(body.results[0].matches.length).toBeGreaterThan(0);
        expect(body.results[1].matches).toEqual([]);
        expect(body.truncated).toBe(false);
      });

      it('rules keyed by class carry the class they hang off', async () => {
        const body = await (await q('rulesByClassId', { classIds: [KG_CLASS_ID] })).json();
        expect(body.results[0].matches[0].classId).toBe(KG_CLASS_ID);
      });

      it('a rule id shared by two classes resolves to two distinct answers', async () => {
        // Rule ids are unique only within a class. A flat key would merge these two, and the
        // caller would attribute one class's threats to the other — silently.
        const keys = [
          kgRefKey(KG_CLASS_ID, KG_COLLIDING_RULE_ID),
          kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID),
        ];
        const body = await (await q('threatsByRuleId', { ruleRefs: keys })).json();
        expect(body.results).toHaveLength(2);
        expect(body.results[0].matches[0].id).not.toBe(body.results[1].matches[0].id);
      });

      it('no response on any route carries an embedding', async () => {
        // A structural check, not a policy one: there are no vectors in the fixtures to serve,
        // so this asserts what exists rather than what the mock chooses to withhold.
        const bodies = await Promise.all([
          (await get('/v1/kg/queries')).json(),
          (await get('/v1/kg/versions')).json(),
          (await get(`/v1/kg/versions/${KG_VERSION}`)).json(),
          (await get(`/v1/kg/versions/${KG_VERSION}/capability`, ENTITLED_TOKEN)).json(),
          (await q('rulesByClassId', { classIds: [KG_CLASS_ID] })).json(),
          (await q('threatsByTechniqueId', { techniqueIds: ['T1040'] })).json(),
        ]);
        for (const body of bodies) {
          for (const node of walk(body)) {
            if (Array.isArray(node) && node.length > 0 && node.every((n) => typeof n === 'number')) {
              throw new Error(`a numeric array reached a caller: ${JSON.stringify(node).slice(0, 80)}`);
            }
          }
          expect(JSON.stringify(body)).not.toMatch(/"(embedding|vector)"\s*:/);
        }
      });
    });

    describe('the service declares what it serves', () => {
      it('/meta lists the knowledge-graph surface', async () => {
        const body = await (await get('/meta')).json();
        expect(body.surfaces).toContain('kg');
      });

      it('a service without the surface omits it rather than failing', async () => {
        // A client must treat an absent surface as unavailable rather than probing for it, and
        // must not report an omitted optional surface as an outage.
        harness.mock.setSurfaces(['catalog', 'content', 'eval']);
        const body = await (await get('/meta')).json();
        expect(body.surfaces).not.toContain('kg');
      });
    });

    // --- Client behaviour lives elsewhere ------------------------------------------------
    // The five obligations that used to stand here as todos are now asserted, and none of them
    // could stay: each is a property of a *client*, and this suite is handed a transport.
    //
    //   the full declared field set, in both modes ....... the client suite, run against each
    //   the same query answering identically in both ..... likewise — that is what it is for
    //   a bearer-less call surfacing the locked outcome .. the remote client's own suite
    //   a wide key set chunked invisibly ................. likewise
    //   a warm cache never crossing callers .............. likewise
    //
    // Kept as a signpost rather than deleted, because "the contract suite is green" is a claim
    // someone will make from this file alone.
  });
}
