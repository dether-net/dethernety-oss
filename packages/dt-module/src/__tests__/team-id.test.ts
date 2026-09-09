import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WireClient, FetchLike } from '../remote/wire-client';
import { deploymentTeamId, DEPLOYMENT_TEAM_HEADER, TEAM_ID_PATTERN } from '../remote/team-id';
import { createKgClient } from '../kg/factory';
import { MockContentServer } from '../testing/mock-content-server';
import { MODULE_KEY, PIN, CLASS_ID, ENTITLED_TOKEN } from '../testing/fixtures';

const BASE = 'https://svc.local';
/** A team identifier of the shape the issuer mints: an opaque base64url token. */
const TEAM_ID = '9Xk2QpLm4RtZaB7cWvNfEg';

function crafted(body: unknown = {}): { fetchImpl: FetchLike; seen: RequestInit[] } {
  const seen: RequestInit[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    seen.push(init);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  };
  return { fetchImpl, seen };
}

const headerOf = (init: RequestInit) => new Headers(init.headers as Record<string, string>);

describe('deploymentTeamId', () => {
  it('reads a well-formed identifier', () => {
    expect(deploymentTeamId({ DEPLOYMENT_TEAM_ID: TEAM_ID })).toBe(TEAM_ID);
  });

  // Absent, blank and malformed all answer the same way, and none of them throws. A resolver that dies
  // because one environment variable is mistyped is a worse answer than one that degrades — and what
  // degrading costs is a call that names no team, which the content service answers transitionally and
  // will later refuse. So this is a choice about where the failure surfaces, not a way of avoiding one.
  it.each([
    ['absent', {}],
    ['empty', { DEPLOYMENT_TEAM_ID: '' }],
    ['a space', { DEPLOYMENT_TEAM_ID: 'has a space' }],
    ['an at sign', { DEPLOYMENT_TEAM_ID: 'has@at' }],
    ['a header injection', { DEPLOYMENT_TEAM_ID: 'x\r\nX-Injected: yes' }],
    ['over the bound', { DEPLOYMENT_TEAM_ID: 'a'.repeat(65) }],
  ])('answers undefined for %s', (_name, env) => {
    expect(deploymentTeamId(env as NodeJS.ProcessEnv, { warn: () => {} })).toBeUndefined();
  });

  // DEGRADING QUIETLY IS THE HALF THAT WAS WRONG. The console logs when it rejects this same value on
  // read; this side said nothing at all, so the operator who mistyped it had no way to learn that from
  // the deployment doing the calling. The rejected value goes in the metadata, never interpolated into
  // the message.
  it('warns when it rejects a malformed identifier', () => {
    const warned: Array<{ msg: string; meta?: object }> = [];
    const logger = { warn: (msg: string, meta?: object) => warned.push({ msg, meta }) };
    expect(deploymentTeamId({ DEPLOYMENT_TEAM_ID: 'has a space' }, logger)).toBeUndefined();
    expect(warned).toHaveLength(1);
    expect(warned[0].msg).toContain('DEPLOYMENT_TEAM_ID');
    expect(warned[0].meta).toEqual({ value: 'has a space' });
  });

  // AN UNSET VARIABLE IS NOT A MISTAKE and must not be logged as one. A deployment that has never been
  // told its team is the ordinary state of every deployment predating the name; warning on it would put
  // a line in every such log and teach operators to ignore the message that matters.
  it.each([
    ['absent', {}],
    ['empty', { DEPLOYMENT_TEAM_ID: '' }],
  ])('stays silent when the identifier is simply %s', (_name, env) => {
    const warned: string[] = [];
    expect(
      deploymentTeamId(env as NodeJS.ProcessEnv, { warn: (m) => warned.push(m) }),
    ).toBeUndefined();
    expect(warned).toEqual([]);
  });
});

// THE GAP THAT WAS OPEN, asserted from the caller's side rather than the reader's. The pattern was
// exported and applied only when the value came from the environment, so every caller that passed
// `teamId` directly — and all four public option types accept one — put an unchecked value on the wire.
// Nothing exploitable, because undici refuses a CR/LF header, but that is the transport's property and
// not this client's, and the documentation claimed the check.
describe('WireClient — a supplied team identifier is held to the same shape', () => {
  it.each([
    ['a space', 'has a space'],
    ['a header injection', 'x\r\nX-Injected: yes'],
    ['over the bound', 'a'.repeat(65)],
  ])('drops %s rather than sending it', async (_name, teamId) => {
    const { fetchImpl, seen } = crafted({ classId: CLASS_ID, template: {} });
    await new WireClient({ baseUrl: BASE, fetchImpl, teamId }).template(CLASS_ID, PIN, ENTITLED_TOKEN);
    expect(headerOf(seen[0]).get(DEPLOYMENT_TEAM_HEADER)).toBeNull();
  });

  it('still sends a well-formed one', async () => {
    const { fetchImpl, seen } = crafted({ classId: CLASS_ID, template: {} });
    await new WireClient({ baseUrl: BASE, fetchImpl, teamId: TEAM_ID }).template(CLASS_ID, PIN, ENTITLED_TOKEN);
    expect(headerOf(seen[0]).get(DEPLOYMENT_TEAM_HEADER)).toBe(TEAM_ID);
  });
});

describe('WireClient — the team header rides with the credential', () => {
  it('sends it on an entitled call', async () => {
    const { fetchImpl, seen } = crafted({ classId: CLASS_ID, template: {} });
    await new WireClient({ baseUrl: BASE, fetchImpl, teamId: TEAM_ID }).template(CLASS_ID, PIN, ENTITLED_TOKEN);
    expect(headerOf(seen[0]).get(DEPLOYMENT_TEAM_HEADER)).toBe(TEAM_ID);
  });

  it('sends nothing when the deployment has no team', async () => {
    const { fetchImpl, seen } = crafted({ classId: CLASS_ID, template: {} });
    await new WireClient({ baseUrl: BASE, fetchImpl }).template(CLASS_ID, PIN, ENTITLED_TOKEN);
    expect(headerOf(seen[0]).get(DEPLOYMENT_TEAM_HEADER)).toBeNull();
  });

  // THE RULE, asserted as the biconditional it is, over every surface the client can reach rather than a
  // chosen pair. A surface nobody thought to enumerate is exactly what this catches.
  it('sends the team header if and only if it sends a credential, across every surface', async () => {
    const mock = new MockContentServer();
    const client = new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch, teamId: TEAM_ID });

    await client.meta();
    await client.moduleDocument(MODULE_KEY, PIN);
    await client.kgQueries();
    await client.template(CLASS_ID, PIN, ENTITLED_TOKEN);
    await client.guide(CLASS_ID, PIN, ENTITLED_TOKEN);

    expect(mock.requests.length).toBeGreaterThanOrEqual(5);
    for (const req of mock.requests) {
      const sentCredential = req.headers.get('authorization') !== null;
      const sentTeam = req.headers.get(DEPLOYMENT_TEAM_HEADER) !== null;
      expect(sentTeam, `${req.path} sent team=${sentTeam} credential=${sentCredential}`).toBe(sentCredential);
    }
  });
});

describe('the knowledge-graph chain carries it too', () => {
  // One of the three paths the scoping is decided on, so leaving it out would leave a third of the
  // enforcement unable to scope.
  it('threads the team into the cloud client', async () => {
    const { fetchImpl, seen } = crafted({ version: 'sha256:' + 'a'.repeat(64), capability: {} });
    const client = createKgClient(
      { driver: null },
      { baseUrl: BASE, version: 'sha256:' + 'a'.repeat(64), fetchImpl, teamId: TEAM_ID },
    );
    await client.capability(ENTITLED_TOKEN).catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    expect(headerOf(seen[0]).get(DEPLOYMENT_TEAM_HEADER)).toBe(TEAM_ID);
  });
});

// Two senders speak this protocol — this client, and the operator console's Go daemon. Nothing but a
// source scan can hold them to one name and one shape, because there is no build step joining a Go binary
// to a TypeScript package.
//
// THE SCAN LIVES ON THIS SIDE DELIBERATELY. The console's own header_parity_test.go explains the
// asymmetry: it reads the SPA source, which sits inside its Go module, so the Go test cache tracks the
// read and invalidates on it — "That one reaches four levels out of its module, where the cache does not
// follow. Measured, not assumed." This package is exactly that four-levels-out case, so a Go-side test
// would go stale. Vitest re-reads every run.
describe('parity with the console, the other sender', () => {
  const consoleSource = (file: string) =>
    fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'apps', 'byodt-console', 'internal', 'daemoncmd', file),
      'utf8',
    );

  it('agrees on the header name', () => {
    const m = /^const deploymentTeamHeader = "([^"]+)"/m.exec(consoleSource('content.go'));
    expect(m, 'the console no longer declares deploymentTeamHeader in the form this scan reads').not.toBeNull();
    expect(m![1]).toBe(DEPLOYMENT_TEAM_HEADER);
  });

  // The sharper half. A drifted NAME means neither sender is read and the failure is loud; a drifted
  // SHAPE means one sender accepts an identifier the other rejects, so half a deployment's calls are
  // scoped and half are not — and "some content is scoped" is a far harder symptom to read.
  it('agrees on the accepted shape', () => {
    const m = /^var teamIDPattern = regexp\.MustCompile\(`([^`]+)`\)/m.exec(consoleSource('cloud.go'));
    expect(m, 'the console no longer declares teamIDPattern in the form this scan reads').not.toBeNull();
    expect(m![1]).toBe(TEAM_ID_PATTERN.source);
  });
});
