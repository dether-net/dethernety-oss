import { ForbiddenException, Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { Neo4jError } from 'neo4j-driver';
import {
  LOCK_ANALYSIS,
  READ_REPORT_DETAILS,
  READ_SIBLING_REPORT_DETAILS,
  ReportDetailsResolverService,
  WRITE_REPORT_DETAILS,
} from '../report-details-resolver.service';

/**
 * Report details through a fake transaction: the set's order inside one write transaction, the read's choice among
 * bindings, the suggestion's query, and the refusals. The same on a real graph:
 * test/integration/report-details.e2e-spec.ts.
 */

const OLD = '2026-01-01T00:00:00.000Z';
const NEW = '2026-06-01T00:00:00.000Z';

const rows = (values: unknown[]) => ({ records: values.map((value) => ({ get: () => value })) });

function makeService({
  stored = [] as unknown[],
  analysisExists = true,
  failOn,
  gql = {},
}: {
  stored?: unknown[];
  analysisExists?: boolean;
  failOn?: { query: string; error: unknown };
  gql?: Record<string, unknown>;
} = {}) {
  const asked: { query: string; params: Record<string, unknown> }[] = [];
  const tx = {
    run: jest.fn(async (query: string, params: Record<string, unknown>) => {
      asked.push({ query, params });
      if (failOn && query === failOn.query) throw failOn.error;
      if (query === LOCK_ANALYSIS) return analysisExists ? rows(['an-1']) : rows([]);
      if (query === READ_REPORT_DETAILS || query === READ_SIBLING_REPORT_DETAILS) return rows(stored);
      return rows([2]);
    }),
  };
  const session = {
    executeWrite: jest.fn(async (work: (t: unknown) => unknown) => work(tx)),
    executeRead: jest.fn(async (work: (t: unknown) => unknown) => work(tx)),
    close: jest.fn(),
  };
  const neo4jDriver: any = { session: jest.fn(() => session) };
  const configService: any = { get: jest.fn((key: string) => (key === 'gql' ? gql : 'memgraph')) };
  const authorizationService: any = { checkAuthorization: jest.fn().mockResolvedValue({ allowed: true }) };
  const svc = new ReportDetailsResolverService(neo4jDriver, configService, authorizationService);
  return { svc, asked, session, authorizationService, neo4jDriver };
}

const auth = { user: { id: 'u-1' } } as any;

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error instanceof GraphQLError ? error.extensions.code : error;
  }
  return undefined;
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('setReportDetails', () => {
  it('locks the analysis, reads every binding, then writes the merged value to all of them, in one transaction', async () => {
    const { svc, asked, session } = makeService({
      stored: [JSON.stringify({ client: 'Old', project: 'kept', updated: OLD })],
    });

    const result = await svc.setReportDetails('an-1', { client: ' New Ltd ' }, auth);

    expect(asked.map((a) => a.query)).toEqual([LOCK_ANALYSIS, READ_REPORT_DETAILS, WRITE_REPORT_DETAILS]);
    expect(session.executeWrite).toHaveBeenCalledTimes(1);
    const written = JSON.parse(asked[2].params.metadata as string);
    expect(written).toEqual({ client: 'New Ltd', project: 'kept', updated: expect.any(String) });
    expect(written.updated > OLD).toBe(true);
    expect(result).toEqual({ client: 'New Ltd', updated: written.updated });
    expect(session.close).toHaveBeenCalled();
  });

  it('locks with a write on the analysis node, which leaves no property behind', () => {
    expect(LOCK_ANALYSIS).toMatch(/MATCH \(a:Analysis \{id: \$analysisId\}\)\s+SET a\._lock = true REMOVE a\._lock/);
  });

  it('merges onto the newest binding when bindings disagree', async () => {
    const { svc, asked } = makeService({
      stored: [
        JSON.stringify({ client: 'Older', updated: OLD }),
        JSON.stringify({ client: 'Newer', updated: NEW }),
        null,
      ],
    });
    await svc.setReportDetails('an-1', {}, auth);
    expect(JSON.parse(asked[2].params.metadata as string).client).toBe('Newer');
  });

  it('reads a stored value that is not a JSON object as empty, with one log line naming the analysis', async () => {
    const { svc, asked } = makeService({ stored: ['{not json'] });
    await svc.setReportDetails('an-1', { client: 'x' }, auth);
    expect(JSON.parse(asked[2].params.metadata as string)).toEqual({ client: 'x', updated: expect.any(String) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ analysisId: 'an-1' });
  });

  it('refuses a bad client by its code, before opening a transaction', async () => {
    const { svc, session } = makeService();
    const code = await codeOf(svc.setReportDetails('an-1', { client: 'a'.repeat(121) }, auth));
    expect(code).toBe('REPORT_DETAILS_CLIENT_TOO_LONG');
    expect(session.executeWrite).not.toHaveBeenCalled();
  });

  it('refuses an unknown analysis, and one bound to no element, writing nothing', async () => {
    const missing = makeService({ analysisExists: false });
    expect(await codeOf(missing.svc.setReportDetails('an-1', { client: 'x' }, auth))).toBe('ANALYSIS_NOT_FOUND');
    expect(missing.asked.map((a) => a.query)).not.toContain(WRITE_REPORT_DETAILS);
    const unbound = makeService({ stored: [] });
    expect(await codeOf(unbound.svc.setReportDetails('an-1', { client: 'x' }, auth))).toBe('ANALYSIS_NOT_BOUND');
    expect(unbound.asked.map((a) => a.query)).not.toContain(WRITE_REPORT_DETAILS);
  });

  it('rethrows a transient conflict as it is, so the managed transaction retries it', async () => {
    const conflict = new Neo4jError('conflict', 'Neo.TransientError.Transaction.DeadlockDetected', '50N00', 'conflict');
    const { svc } = makeService({ stored: [null], failOn: { query: WRITE_REPORT_DETAILS, error: conflict } });
    await expect(svc.setReportDetails('an-1', { client: 'x' }, auth)).rejects.toBe(conflict);
  });
});

describe('reportDetails', () => {
  it('is null for an analysis bound to no element', async () => {
    const { svc } = makeService({ stored: [] });
    expect(await svc.reportDetails('an-1', auth)).toBeNull();
  });

  it('returns the newest binding\'s known keys', async () => {
    const { svc, session } = makeService({
      stored: [
        JSON.stringify({ client: 'Older', updated: OLD }),
        JSON.stringify({ client: 'Newer', project: 'p', updated: NEW }),
      ],
    });
    expect(await svc.reportDetails('an-1', auth)).toEqual({ client: 'Newer', updated: NEW });
    expect(session.executeRead).toHaveBeenCalledTimes(1);
    expect(session.executeWrite).not.toHaveBeenCalled();
  });
});

describe('suggestReportDetails', () => {
  it('reads the other analyses of the same element(s), and offers the newest client name', async () => {
    const { svc, asked } = makeService({
      stored: [JSON.stringify({ client: 'Older', updated: OLD }), JSON.stringify({ client: 'Newer', updated: NEW })],
    });
    expect(await svc.suggestReportDetails('an-1', auth)).toEqual({ client: 'Newer', updated: NEW });
    expect(asked[0]).toEqual({ query: READ_SIBLING_REPORT_DETAILS, params: { analysisId: 'an-1' } });
  });

  it('reads only the edges\' report details, no property of the bound elements', () => {
    expect(READ_SIBLING_REPORT_DETAILS).toContain('WHERE other.id <> $analysisId');
    expect(READ_SIBLING_REPORT_DETAILS).not.toMatch(/\be\.|properties\(|:Model/);
  });
});

describe('authentication', () => {
  const calls = [
    ['reportDetails', (svc: ReportDetailsResolverService, a: any) => svc.reportDetails('an-1', a)],
    ['suggestReportDetails', (svc: ReportDetailsResolverService, a: any) => svc.suggestReportDetails('an-1', a)],
    [
      'setReportDetails',
      (svc: ReportDetailsResolverService, a: any) => svc.setReportDetails('an-1', { client: 'x' }, a),
    ],
  ] as const;

  it.each(calls)('%s refuses a request without a verified user, before it opens a session', async (_name, call) => {
    const { svc, neo4jDriver, authorizationService } = makeService({
      stored: [null],
      gql: { oidcJwksUri: 'https://idp.example/jwks' },
    });
    expect(await codeOf(call(svc, {}))).toBe('UNAUTHENTICATED');
    expect(neo4jDriver.session).not.toHaveBeenCalled();
    expect(authorizationService.checkAuthorization).not.toHaveBeenCalled();
  });

  it.each(calls)('%s needs no user where authentication is off (no OIDC, ENABLE_NOAUTH)', async (_name, call) => {
    const { svc } = makeService({ stored: [null], gql: { enableNoauth: true } });
    expect(await codeOf(call(svc, {}))).toBeUndefined();
  });
});

describe('authorization', () => {
  it.each([
    ['reportDetails', 'query', (svc: ReportDetailsResolverService) => svc.reportDetails('an-1', auth)],
    ['suggestReportDetails', 'query', (svc: ReportDetailsResolverService) => svc.suggestReportDetails('an-1', auth)],
    ['setReportDetails', 'mutation', (svc: ReportDetailsResolverService) => svc.setReportDetails('an-1', {}, auth)],
  ])('%s asks for authorization first, and stops when refused', async (operationName, operationType, call) => {
    const allowed = makeService({ stored: [null] });
    await call(allowed.svc);
    expect(allowed.authorizationService.checkAuthorization).toHaveBeenCalledWith(auth, {
      operationType,
      operationName,
      resourceType: 'Analysis',
      resourceId: 'an-1',
    });

    const refused = makeService({ stored: [null] });
    refused.authorizationService.checkAuthorization.mockResolvedValue({ allowed: false });
    await expect(call(refused.svc)).rejects.toBeInstanceOf(ForbiddenException);
    expect(refused.asked).toEqual([]);
  });
});
