/**
 * The wire-protocol contract suite — the executable form of the protocol. It
 * asserts a `DtRemoteModule`'s conforming behavior end-to-end against a mock,
 * with no network and no credentials, so it runs in CI. The same suite is meant
 * to run against the real service later (one suite, two implementations, no
 * drift), which is why it is parameterized by a client factory and shipped from
 * the `./testing` subpath rather than hard-wired to the mock.
 */
import { describe, it, expect } from 'vitest';
import type { DtRemoteModule } from '../../dt-remote-module';
import type { MockContentServer } from '../mock-content-server';
import type { ModuleDocument } from '../../remote/wire-client';
import {
  CloudSessionExpiredError,
  ContentRecalledError,
  EvaluationNotEntitledError,
  RemoteModuleUnavailableError,
} from '../../remote/errors';
import {
  MODULE_KEY,
  CLASS_ID,
  PIN,
  MODEL_SLUG,
  PORTAL_ORIGIN,
  ENTITLED_TOKEN,
  UNENTITLED_TOKEN,
  EXPIRED_TOKEN,
  embeddingsResponse,
  templateResponse,
  guideResponse,
  evalResponse,
  recall,
} from '../fixtures';

export interface ContractHarness {
  /** Build a fresh module bound to the mock, optionally at a different pin and
   * with a fake platform driver (for the local attribute read on the eval path). */
  makeClient: (pin?: string, driver?: unknown) => DtRemoteModule;
  /** The mock backing the client, for driving scenarios and asserting requests. */
  mock: MockContentServer;
}

/** A fake platform driver whose IS_INSTANCE_OF read returns the given attributes. */
export function fakeDriver(attributes: Record<string, unknown>): unknown {
  return {
    session: () => ({
      run: async () => ({ records: [{ get: () => ({ properties: attributes }) }] }),
      close: async () => undefined,
    }),
  };
}

/** Schema-declared attributes for the fixture class (see templateResponse.schema). */
const EVAL_ATTRS = { authentication_enabled: false, tls_version: '1.2', open_ports: [22, 443] };

/** A module document with no classes across any served array — corruption. */
const ZERO_CLASS_DOC: ModuleDocument = {
  protocol: '1',
  module: { name: MODULE_KEY, componentClasses: [] },
  embeddings: { models: [] },
};

/** Count eval POSTs the mock has seen. */
function evalPosts(mock: MockContentServer): number {
  return mock.requests.filter((r) => r.method === 'POST').length;
}

/**
 * Register the contract suite. Call from a `*.test.ts` that supplies the harness
 * with per-test isolation (fresh cache dir + mock reset).
 */
export function runContractSuite(harness: ContractHarness): void {
  describe('module content wire-protocol contract', () => {
    it('online boot registers classes; ids match; embeddings resolve synchronously', async () => {
      const client = harness.makeClient();
      const meta = await client.getMetadata();
      expect(meta.componentClasses?.[0]?.id).toBe(CLASS_ID);
      expect(meta.componentClasses?.[0]?.name).toBe('Virtual Machine');
      // getEmbedding is synchronous and answers from the registration prefetch.
      expect(client.getEmbedding('Virtual Machine', MODEL_SLUG)).toEqual(embeddingsResponse.embeddings[0].vector);
      // A model the module doc does not list, and an unknown class, are null (not errors).
      expect(client.getEmbedding('Virtual Machine', 'unlisted-model')).toBeNull();
      expect(client.getEmbedding('No Such Class', MODEL_SLUG)).toBeNull();
    });

    it('warm-offline boot serves the full cached class set', async () => {
      await harness.makeClient().getMetadata(); // populate the shared cache online
      harness.mock.setFailureMode('network');
      // A fresh client (cold memo) on the same cache dir + pin boots from disk.
      const meta = await harness.makeClient().getMetadata();
      expect(meta.componentClasses?.[0]?.id).toBe(CLASS_ID);
    });

    it('an offline pin-miss serves newest-cached metadata, staying registered', async () => {
      await harness.makeClient().getMetadata(); // cache a good entry at the fixture pin
      harness.mock.setFailureMode('network');
      // Operator bumped the pin during an outage: exact pin uncached, live fails →
      // newestFor keeps the module registered with stable ids, never throwing.
      const bumped = await harness.makeClient('sha256:bumped-during-outage').getMetadata();
      expect(bumped.componentClasses?.[0]?.id).toBe(CLASS_ID);
    });

    it('nothing ever cached + offline throws (safe first boot)', async () => {
      harness.mock.setFailureMode('network');
      await expect(harness.makeClient().getMetadata()).rejects.toBeInstanceOf(Error);
    });

    it('a live zero-class document is never returned reduced (throws when nothing cached)', async () => {
      harness.mock.setModuleDocument(ZERO_CLASS_DOC);
      await expect(harness.makeClient().getMetadata()).rejects.toBeInstanceOf(Error);
    });

    it('a live zero-class document with a warm cache serves the newest good document instead', async () => {
      await harness.makeClient().getMetadata(); // good doc cached at the fixture pin
      harness.mock.setModuleDocument(ZERO_CLASS_DOC);
      const meta = await harness.makeClient('sha256:new-bad-pin').getMetadata();
      expect(meta.componentClasses?.length).toBeGreaterThan(0); // newest good, not the reduced live doc
    });

    it('entitled template/guide are shape-identical to the baseline', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      // Pass-through: the client does not re-normalize an entitled template.
      expect(JSON.parse(await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN))).toEqual(templateResponse.template);
      expect(JSON.parse(await client.getClassGuide(CLASS_ID, ENTITLED_TOKEN))).toEqual(guideResponse.guide);
    });

    it('unentitled → rendering-valid fallback carrying the sanitized server message', async () => {
      const client = harness.makeClient();
      await client.getMetadata(); // pins portalOrigin so a valid action URL is retained
      const fallback = JSON.parse(await client.getClassTemplate(CLASS_ID, UNENTITLED_TOKEN));
      expect(fallback.schema).toBeDefined();
      expect(fallback.uischema.type).toBe('VerticalLayout');
      const text = JSON.stringify(fallback);
      expect(text).toContain('subscription'); // from the fixture denial title
      expect(text).toContain(`${PORTAL_ORIGIN}/subscribe/acme-cloud`); // portalOrigin-valid actionUrl kept
    });

    it('the fallback neutralizes markup and drops a foreign action URL', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      harness.mock.setDenial({
        message: {
          title: 'Locked',
          body: '<img src=x onerror=alert(1)> [click](javascript:alert(1))',
          actionUrl: 'https://evil.com/phish',
          actionLabel: 'Subscribe',
        },
      });
      const text = await client.getClassTemplate(CLASS_ID, UNENTITLED_TOKEN);
      expect(text).not.toContain('<img'); // HTML escaped
      expect(text).not.toContain(']('); // markdown pivot broken
      expect(text).not.toContain('evil.com'); // foreign origin dropped
    });

    it('a portalOrigin-valid action URL cannot smuggle a markdown link pivot', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      harness.mock.setDenial({
        message: {
          title: 'Locked',
          body: 'Subscribe',
          actionUrl: `${PORTAL_ORIGIN}/x/[y](javascript:alert(1))`,
          actionLabel: 'Subscribe',
        },
      });
      const text = await client.getClassTemplate(CLASS_ID, UNENTITLED_TOKEN);
      expect(text).not.toContain(']('); // the URL is sanitized even though its origin matched
    });

    it('caller B never receives caller A cached content; a warm A hit skips the network', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      const before = harness.mock.requests.length;
      const a1 = await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN); // fetch + cache + entitled memo
      const a2 = await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN); // warm memo → no new request
      expect(a2).toBe(a1);
      expect(harness.mock.requests.length).toBe(before + 1);
      expect(JSON.parse(a1)).toEqual(templateResponse.template);
      // B has no entitled memo → forced live re-check → 403 → fallback (not A's content).
      const b = JSON.parse(await client.getClassTemplate(CLASS_ID, UNENTITLED_TOKEN));
      // The fallback has an empty schema; A's real template has populated properties —
      // this distinguishes a genuine fallback from A's content leaking to B.
      expect(Object.keys(b.schema?.properties ?? {})).toHaveLength(0);
      expect(harness.mock.requests.length).toBe(before + 2);
    });

    it('no token arg → fallback, no content request, no crash', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      const before = harness.mock.requests.length;
      const t = JSON.parse(await client.getClassTemplate(CLASS_ID)); // no token
      expect(t.uischema).toBeDefined();
      expect(harness.mock.requests.length).toBe(before); // no network on the no-token path
    });

    it('entitled evaluation returns findings verbatim in one round trip', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      const before = evalPosts(harness.mock);
      expect(await client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN)).toEqual(evalResponse.exposures);
      // The response carried both halves — the second read is an eval-cache hit.
      expect(await client.getCountermeasures('el-1', CLASS_ID, ENTITLED_TOKEN)).toEqual(evalResponse.countermeasures);
      expect(evalPosts(harness.mock) - before).toBe(1);
    });

    it('a missing element (no graph node) throws, never fabricates a clean result from empty input', async () => {
      // Driver whose IS_INSTANCE_OF read finds no node → getInstantiationAttributes returns null.
      const missingDriver = {
        session: () => ({ run: async () => ({ records: [] }), close: async () => undefined }),
      };
      const client = harness.makeClient(undefined, missingDriver);
      await client.getMetadata();
      const before = evalPosts(harness.mock);
      await expect(client.getExposures('ghost', CLASS_ID, ENTITLED_TOKEN)).rejects.toThrow();
      expect(evalPosts(harness.mock) - before).toBe(0); // failed loud before any cloud round trip
    });

    it('the eval payload carries only schema-declared attribute keys', async () => {
      const client = harness.makeClient(
        undefined,
        fakeDriver({ ...EVAL_ATTRS, name: 'vm-1', description: 'topology secret', extra: 'nope' }),
      );
      await client.getMetadata();
      await client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN);
      const post = harness.mock.requests.find((r) => r.method === 'POST');
      const body = JSON.parse(post?.bodyText ?? '{}');
      expect(Object.keys(body.attributes).sort()).toEqual(['authentication_enabled', 'open_ports', 'tls_version']);
    });

    it('identical saves at one pin → one eval call; a different pin re-evaluates', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      await client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN);
      await client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN); // same attrs → cache hit
      expect(evalPosts(harness.mock)).toBe(1);
      const other = harness.makeClient('sha256:other-pin', fakeDriver(EVAL_ATTRS));
      await other.getMetadata();
      await other.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN); // cold caches at a new pin
      expect(evalPosts(harness.mock)).toBe(2);
    });

    it('a denied evaluation throws (sanitized), never [] — findings are preserved', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      harness.mock.setDenial({ message: { title: 'Locked', body: '<b>subscribe now</b>' } });
      await expect(client.getExposures('el-1', CLASS_ID, UNENTITLED_TOKEN)).rejects.toBeInstanceOf(
        EvaluationNotEntitledError,
      );
      const err = await client.getExposures('el-1', CLASS_ID, UNENTITLED_TOKEN).catch((e) => e);
      expect(err.message).not.toContain('<b>'); // eval-error message is sanitized
    });

    it('an expired token throws CloudSessionExpiredError, no retry', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      await expect(client.getExposures('el-1', CLASS_ID, EXPIRED_TOKEN)).rejects.toBeInstanceOf(
        CloudSessionExpiredError,
      );
    });

    it('eval with no obtainable schema throws, never a strip-to-empty evaluation', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      harness.mock.setFailureMode('network'); // schema fetch fails → no allowlist
      const before = evalPosts(harness.mock);
      await expect(client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN)).rejects.toBeInstanceOf(
        RemoteModuleUnavailableError,
      );
      expect(evalPosts(harness.mock)).toBe(before); // never reached the eval POST
    });

    it('class ids are stable across an operator pin upgrade', async () => {
      const metaA = await harness.makeClient(PIN).getMetadata();
      const metaB = await harness.makeClient('sha256:newer-pin').getMetadata();
      expect(metaB.componentClasses?.map((c) => c.id)).toEqual(metaA.componentClasses?.map((c) => c.id));
    });

    it('a 410 on an entitled path throws ContentRecalledError carrying the reason', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      harness.mock.recall(PIN);
      const err = await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(ContentRecalledError);
      expect((err as ContentRecalledError).recall?.reason).toBe(recall.reason);
    });

    it('a recalled version stops serving cached content once the recall is observed', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN); // cache the template + a warm entitled memo
      harness.mock.recall(PIN);
      // The eval path's live schema fetch observes the 410 and evicts the pin's cache.
      await expect(client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN)).rejects.toBeInstanceOf(ContentRecalledError);
      // The template content is now evicted despite the still-warm memo, so the next
      // read goes live and surfaces the recall rather than serving stale content.
      await expect(client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN)).rejects.toBeInstanceOf(ContentRecalledError);
    });

    it('a recall reason with markup is sanitized before it reaches the error banner', async () => {
      const client = harness.makeClient();
      await client.getMetadata();
      harness.mock.setRecall({ moduleKey: MODULE_KEY, version: PIN, reason: '<script>alert(1)</script> withdrawn' });
      harness.mock.recall(PIN);
      const err = await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(ContentRecalledError);
      expect((err as Error).message).not.toContain('<script>'); // content-path error is sanitized too
    });

    it('a redirect on an authenticated call is a hard failure — the bearer never follows it', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      await client.getMetadata();
      harness.mock.setRedirectHardFailure(true);
      await expect(client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN)).rejects.toBeInstanceOf(
        RemoteModuleUnavailableError,
      );
    });

    it('an end-to-end flow runs with no real network and no credentials', async () => {
      const client = harness.makeClient(undefined, fakeDriver(EVAL_ATTRS));
      const meta = await client.getMetadata();
      expect(meta.componentClasses?.[0]?.id).toBe(CLASS_ID);
      expect(client.getEmbedding('Virtual Machine', MODEL_SLUG)).toEqual(embeddingsResponse.embeddings[0].vector);
      expect(JSON.parse(await client.getClassTemplate(CLASS_ID, ENTITLED_TOKEN))).toEqual(templateResponse.template);
      expect(await client.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN)).toEqual(evalResponse.exposures);
    });
  });
}
