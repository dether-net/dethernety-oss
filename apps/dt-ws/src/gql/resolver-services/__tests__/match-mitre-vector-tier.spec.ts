import { cosineExpr } from '@dethernety/dt-module/embedding';
import {
  decideKindPrecheck,
  MatchMitreTechniquesResolverService,
} from '../match-mitre-techniques-resolver.service';
import { EmbeddingService } from '../../services/embedding.service';

/**
 * The service's own embedEach, run on a fake embedding service: the fake's embedBatch (and embedOnce, when it has
 * one) answer, and the query timeout and the overload note are the service's, with its defaults.
 */
function embedEachOn(fake: any, texts: string[], kind: 'query', logger: { warn: (...args: unknown[]) => void } = { warn: () => undefined }) {
  const proto = EmbeddingService.prototype as any;
  const service = Object.assign(Object.create(fake), {
    queryTimeout: { baseMs: 10_000, perItemMs: 250 },
    overloads: { timeout: 0, busy: 0 },
    logger,
    queryEmbedOptions: proto.queryEmbedOptions,
    noteOverload: proto.noteOverload,
  });
  return proto.embedEach.call(service, texts, kind);
}

/**
 * The MITRE vector tier: availability is strict on the active embedding profile, and the exact
 * query ranks before it hops to tactics, so the tactic hop never changes which k techniques return.
 */

describe('decideKindPrecheck', () => {
  it.each([
    ['no addressable nodes', 0, 0, 0, 'EMPTY'],
    ['every node carries an active-profile vector', 697, 697, 0, null],
    ['none does, another model does', 697, 0, 697, 'MODEL_MISMATCH'],
    ['none does, nothing is embedded', 697, 0, 0, 'NO_VECTORS'],
    ['only some do (incomplete)', 697, 650, 0, 'NO_VECTORS'],
    ['some do, the rest are another model', 697, 650, 47, 'NO_VECTORS'],
  ])('%s', (_name, total, active, others, expected) => {
    expect(decideKindPrecheck(total, active, others)).toBe(expected);
  });
});

describe('renderVectorCypher', () => {
  const svc = new MatchMitreTechniquesResolverService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  it.each(['memgraph', 'neo4j'] as const)('%s: scores, filters, ranks, then hops', (dialect) => {
    const score = cosineExpr(dialect, 'node.embedding', '$query_vector');
    const cypher = svc.renderVectorCypher('ATTACK_TECHNIQUE', score);
    const at = (needle: string) => {
      const i = cypher.indexOf(needle);
      expect(i).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(at('MATCH (node:MitreAttackTechnique)')).toBeLessThan(at('node.embeddingModel = $profileId'));
    expect(at('size(node.embedding) = $dims')).toBeLessThan(at(`${score} AS similarity`));
    expect(at(`${score} AS similarity`)).toBeLessThan(at('similarity >= $threshold'));
    expect(at('similarity >= $threshold')).toBeLessThan(at('ORDER BY similarity DESC, node.attack_id ASC'));
    expect(at('ORDER BY similarity DESC, node.attack_id ASC')).toBeLessThan(at('LIMIT $k'));
    expect(at('LIMIT $k')).toBeLessThan(at('OPTIONAL MATCH (node)<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAttackTactic)'));
    expect(at('collect(DISTINCT tac) AS tacs')).toBeLessThan(at('ORDER BY similarity DESC, mitreId ASC'));
    expect(cypher).not.toContain('vector_search.search');
  });

  it('a mitigation has no tactic hop', () => {
    const cypher = svc.renderVectorCypher('ATTACK_MITIGATION', cosineExpr('memgraph', 'node.embedding', '$query_vector'));
    expect(cypher).toContain('MATCH (node:MitreAttackMitigation)');
    expect(cypher).not.toContain('OPTIONAL MATCH');
    expect(cypher).toContain('null AS tactic');
  });
});

describe('the vector tier embeds a request in one call', () => {
  /** An embedder whose vector for a text is fixed by the text, so batched and one-at-a-time give the same vectors. */
  function setup(failOn?: string, failWith: (message: string) => Error = (message) => new Error(message)) {
    const embedCalls: string[][] = [];
    const vectorOf = (t: string) => [t.length / 100, 1 - t.length / 100];
    const embedding = {
      getModel: () => 'embeddinggemma',
      getThreshold: () => 0.3,
      embedBatch: async (texts: string[]) => {
        embedCalls.push(texts);
        if (failOn && texts.some((t) => t.includes(failOn))) throw failWith('cannot embed');
        return texts.map(vectorOf);
      },
      /** The service's per-text fallback: one text, through the same recorded call. */
      async embedOnce(text: string) {
        return (await this.embedBatch([text]))[0];
      },
      embedEach(texts: string[], kind: 'query') {
        return embedEachOn(this, texts, kind);
      },
    };
    const searched: number[][] = [];
    const vectorSearch = {
      cosine: async () => 'score',
      read: async (_cypher: string, params: { query_vector: number[] }) => {
        searched.push(params.query_vector);
        return [{ get: (k: string) => ({ mitreId: 'T9999', name: 'Hit', description: null, tactic: null, tacticOrder: null, similarity: 0.5 } as any)[k] }];
      },
    };
    const svc = new MatchMitreTechniquesResolverService({} as any, {} as any, {} as any, {} as any, embedding as any, vectorSearch as any) as any;
    svc.computeVectorAvailability = async () => ({ vectorAvailable: true, vectorDisabledReason: null });
    svc.fetchMitreRecords = async () => [{ mitreId: 'T1003', name: 'OS Credential Dumping', description: 'dump credentials', tactic: null, tacticOrder: null }];
    const warn = jest.fn();
    svc.logger.warn = warn;
    const match = (queries: string[]) => svc.executeMatchMitreTechniques({ queries: queries.map((query) => ({ query })), kind: 'ATTACK_TECHNIQUE' });
    return { embedCalls, vectorOf, searched, warn, match };
  }

  it('embeds only the queries the id, name and description tiers left, in one call, in order', async () => {
    const s = setup();
    const { result } = await s.match(['T1003', 'steal cached passwords', 'move to another host']);
    expect(s.embedCalls).toEqual([['steal cached passwords', 'move to another host']]);
    expect(s.searched).toEqual([s.vectorOf('steal cached passwords'), s.vectorOf('move to another host')]);
    expect(result.matches.map((m: any) => [m.query, m.candidates[0].matchType])).toEqual([
      ['T1003', 'EXACT_ID'],
      ['steal cached passwords', 'VECTOR_SIMILARITY'],
      ['move to another host', 'VECTOR_SIMILARITY'],
    ]);
  });

  it('costs a query that cannot be embedded only its own vector tier, and logs its shape, not its text', async () => {
    const s = setup('secret');
    const { result } = await s.match(['steal cached passwords', 'paste my secret token']);
    expect(s.embedCalls).toEqual([['steal cached passwords', 'paste my secret token'], ['steal cached passwords'], ['paste my secret token']]);
    expect(s.searched).toEqual([s.vectorOf('steal cached passwords')]);
    expect(result.unmatched).toEqual(['paste my secret token']);
    expect(s.warn.mock.calls).toEqual([['Embedding failed for vector tier, skipping', { kind: 'ATTACK_TECHNIQUE', queryLength: 21, error: 'cannot embed' }]]);
    expect(JSON.stringify(s.warn.mock.calls)).not.toContain('secret');
  });

  it.each(['EmbedderBusyError', 'EmbedTimeoutError'])(
    'on a %s the deterministic tiers answer, and the envelope says EMBEDDER_BUSY',
    async (name) => {
      const s = setup(' ', (message) => Object.assign(new Error(message), { name }));
      const { result } = await s.match(['T1003', 'steal cached passwords', 'move to another host']);
      // One embed call, not retried query by query, and no vector search.
      expect(s.embedCalls).toEqual([['steal cached passwords', 'move to another host']]);
      expect(s.searched).toEqual([]);
      expect(result.matches.map((m: any) => [m.query, m.candidates[0].matchType])).toEqual([['T1003', 'EXACT_ID']]);
      expect(result.unmatched).toEqual(['steal cached passwords', 'move to another host']);
      expect([result.vectorAvailable, result.vectorDisabledReason]).toEqual([false, 'EMBEDDER_BUSY']);
      // The embedding service logs it once; the resolver adds no line per query.
      expect(s.warn).not.toHaveBeenCalled();
    },
  );

  it('keeps the envelope as the precheck left it after a plain embed failure', async () => {
    const s = setup('secret');
    const { result } = await s.match(['paste my secret token']);
    expect([result.vectorAvailable, result.vectorDisabledReason]).toEqual([true, null]);
  });

  it('embeds nothing when the deterministic tiers answer every query', async () => {
    const s = setup();
    await s.match(['T1003', 'credential dumping']);
    expect(s.embedCalls).toEqual([]);
  });
});
