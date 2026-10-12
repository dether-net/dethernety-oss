import { cosineExpr } from '@dethernety/dt-module/embedding';
import {
  decideKindPrecheck,
  MatchMitreTechniquesResolverService,
} from '../match-mitre-techniques-resolver.service';

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
