/**
 * Index and constraint DDL per engine. The two dialects share no syntax, so the exact statements are
 * pinned: a wrong form fails per statement and leaves the deployment without its index or constraint.
 */

import { describe, expect, it } from 'vitest';

import {
  buildConstraintDdl,
  buildDropConstraintDdl,
  buildDropIndexDdl,
  buildDropRelationshipIndexDdl,
  buildIndexDdl,
  buildRelationshipIndexDdl,
  constraintName,
  indexName,
  relationshipIndexName,
} from '../ddl';
import type { EngineInfo } from '../engine';

const memgraph: EngineInfo = { engine: 'memgraph', edition: 'community', version: '5.9.0' };
const neo4jEnterprise: EngineInfo = { engine: 'neo4j', edition: 'enterprise', version: '5.26.0' };
const neo4jCommunity: EngineInfo = { engine: 'neo4j', edition: 'community', version: '5.26.0' };
const neo4jUnknownEdition: EngineInfo = { engine: 'neo4j', edition: null, version: null };

describe('names', () => {
  it('derive from label, properties and kind', () => {
    expect(indexName('MitreAttackTechnique', 'attack_id')).toBe('dt_idx__MitreAttackTechnique__attack_id');
    expect(constraintName('ControlClass', 'id', 'unique')).toBe('dt_uniq__ControlClass__id');
    expect(constraintName('ControlClass', 'id', 'exists')).toBe('dt_exists__ControlClass__id');
    expect(constraintName('Membership', ['teamId', 'userId'], 'unique')).toBe(
      'dt_uniq__Membership__teamId__userId',
    );
  });

  it('cannot collide across the label/property split', () => {
    expect(indexName('A_b', 'c')).not.toBe(indexName('A', 'b_c'));
    expect(constraintName('A', ['b', 'c'], 'unique')).not.toBe(constraintName('A_b', 'c', 'unique'));
  });
});

describe('buildIndexDdl', () => {
  it('Memgraph keeps the legacy form', () => {
    expect(buildIndexDdl(memgraph, 'Control', 'id')).toBe('CREATE INDEX ON :Control(id)');
  });
  it('Neo4j gets a named index with IF NOT EXISTS', () => {
    expect(buildIndexDdl(neo4jCommunity, 'Control', 'id')).toBe(
      'CREATE INDEX dt_idx__Control__id IF NOT EXISTS FOR (n:Control) ON (n.id)',
    );
  });
});

describe('buildDropIndexDdl', () => {
  it('drops by schema on Memgraph and by name on Neo4j', () => {
    expect(buildDropIndexDdl(memgraph, 'Control', 'id')).toBe('DROP INDEX ON :Control(id)');
    expect(buildDropIndexDdl(neo4jCommunity, 'Control', 'id')).toBe('DROP INDEX dt_idx__Control__id IF EXISTS');
  });
});

describe('relationship indexes', () => {
  it('name and build per engine', () => {
    expect(relationshipIndexName('HIDDEN_EDGE', 'merge_key')).toBe('dt_ridx__HIDDEN_EDGE__merge_key');
    expect(buildRelationshipIndexDdl(memgraph, 'HIDDEN_EDGE', 'merge_key')).toBe('CREATE EDGE INDEX ON :HIDDEN_EDGE(merge_key)');
    expect(buildRelationshipIndexDdl(neo4jCommunity, 'HIDDEN_EDGE', 'merge_key')).toBe(
      'CREATE INDEX dt_ridx__HIDDEN_EDGE__merge_key IF NOT EXISTS FOR ()-[r:HIDDEN_EDGE]-() ON (r.merge_key)',
    );
    expect(buildDropRelationshipIndexDdl(memgraph, 'HIDDEN_EDGE', 'merge_key')).toBe('DROP EDGE INDEX ON :HIDDEN_EDGE(merge_key)');
    expect(buildDropRelationshipIndexDdl(neo4jCommunity, 'HIDDEN_EDGE', 'merge_key')).toBe(
      'DROP INDEX dt_ridx__HIDDEN_EDGE__merge_key IF EXISTS',
    );
  });
  it('refuses a type or property that is not a plain identifier', () => {
    expect(() => buildRelationshipIndexDdl(neo4jCommunity, 'A]-()', 'p')).toThrow(/invalid relationship type/);
    expect(() => buildRelationshipIndexDdl(memgraph, 'A', 'p)')).toThrow(/invalid property/);
    expect(() => buildRelationshipIndexDdl(memgraph, 'A', ['p'] as any)).toThrow(/exactly one property/);
  });
});

describe('buildConstraintDdl', () => {
  it('Memgraph: the legacy ASSERT forms', () => {
    expect(buildConstraintDdl(memgraph, 'ControlClass', 'id', 'unique')).toBe(
      'CREATE CONSTRAINT ON (n:ControlClass) ASSERT n.id IS UNIQUE',
    );
    expect(buildConstraintDdl(memgraph, 'ControlClass', 'id', 'exists')).toBe(
      'CREATE CONSTRAINT ON (n:ControlClass) ASSERT EXISTS (n.id)',
    );
    expect(buildConstraintDdl(memgraph, 'Membership', ['teamId', 'userId'], 'unique')).toBe(
      'CREATE CONSTRAINT ON (n:Membership) ASSERT n.teamId, n.userId IS UNIQUE',
    );
  });

  it('Neo4j: named REQUIRE forms with IF NOT EXISTS', () => {
    expect(buildConstraintDdl(neo4jEnterprise, 'ControlClass', 'id', 'unique')).toBe(
      'CREATE CONSTRAINT dt_uniq__ControlClass__id IF NOT EXISTS FOR (n:ControlClass) REQUIRE n.id IS UNIQUE',
    );
    expect(buildConstraintDdl(neo4jEnterprise, 'ControlClass', 'id', 'exists')).toBe(
      'CREATE CONSTRAINT dt_exists__ControlClass__id IF NOT EXISTS FOR (n:ControlClass) REQUIRE n.id IS NOT NULL',
    );
    expect(buildConstraintDdl(neo4jCommunity, 'Membership', ['teamId', 'userId'], 'unique')).toBe(
      'CREATE CONSTRAINT dt_uniq__Membership__teamId__userId IF NOT EXISTS FOR (n:Membership) ' +
        'REQUIRE (n.teamId, n.userId) IS UNIQUE',
    );
  });

  it('Neo4j other than Enterprise: existence constraints are unavailable (null), uniqueness is not', () => {
    expect(buildConstraintDdl(neo4jCommunity, 'ControlClass', 'id', 'exists')).toBeNull();
    expect(buildConstraintDdl(neo4jUnknownEdition, 'ControlClass', 'id', 'exists')).toBeNull();
    expect(buildConstraintDdl(neo4jCommunity, 'ControlClass', 'id', 'unique')).toContain('REQUIRE n.id IS UNIQUE');
  });

  it('an existence constraint takes exactly one property', () => {
    expect(() => buildConstraintDdl(memgraph, 'A', ['b', 'c'], 'exists')).toThrow(/exactly one property/);
    expect(() => buildConstraintDdl(neo4jEnterprise, 'A', ['b', 'c'], 'exists')).toThrow(/exactly one property/);
  });
});

describe('buildDropConstraintDdl', () => {
  it('Memgraph: the ASSERT forms', () => {
    expect(buildDropConstraintDdl(memgraph, 'ControlClass', 'id', 'unique')).toBe(
      'DROP CONSTRAINT ON (n:ControlClass) ASSERT n.id IS UNIQUE',
    );
    expect(buildDropConstraintDdl(memgraph, 'ControlClass', 'id', 'exists')).toBe(
      'DROP CONSTRAINT ON (n:ControlClass) ASSERT EXISTS (n.id)',
    );
  });

  it('Neo4j: by name, and null exactly where creation is null', () => {
    expect(buildDropConstraintDdl(neo4jCommunity, 'Membership', ['teamId', 'userId'], 'unique')).toBe(
      'DROP CONSTRAINT dt_uniq__Membership__teamId__userId IF EXISTS',
    );
    expect(buildDropConstraintDdl(neo4jEnterprise, 'ControlClass', 'id', 'exists')).toBe(
      'DROP CONSTRAINT dt_exists__ControlClass__id IF EXISTS',
    );
    expect(buildDropConstraintDdl(neo4jCommunity, 'ControlClass', 'id', 'exists')).toBeNull();
  });
});

describe('arguments a caller can get wrong at run time', () => {
  it('refuses an unknown constraint kind instead of treating it as existence', () => {
    for (const kind of ['UNIQUE', 'uniq', 'primary', '']) {
      expect(() => buildConstraintDdl(memgraph, 'A', 'b', kind as any)).toThrow(/unknown constraint kind/);
      expect(() => buildConstraintDdl(neo4jCommunity, 'A', 'b', kind as any)).toThrow(/unknown constraint kind/);
      expect(() => buildDropConstraintDdl(neo4jCommunity, 'A', 'b', kind as any)).toThrow(/unknown constraint kind/);
      expect(() => constraintName('A', 'b', kind as any)).toThrow(/unknown constraint kind/);
    }
  });

  it('refuses several properties for an index instead of indexing the first', () => {
    expect(() => buildIndexDdl(neo4jCommunity, 'A', ['b', 'c'] as any)).toThrow(/exactly one property/);
    expect(() => buildDropIndexDdl(memgraph, 'A', ['b'] as any)).toThrow(/exactly one property/);
    expect(() => indexName('A', ['b'] as any)).toThrow(/exactly one property/);
  });
});

describe('identifiers', () => {
  const builders: Array<[string, (label: string, property: string) => unknown]> = [
    ['buildIndexDdl', (l, p) => buildIndexDdl(neo4jCommunity, l, p)],
    ['buildDropIndexDdl', (l, p) => buildDropIndexDdl(memgraph, l, p)],
    ['buildConstraintDdl', (l, p) => buildConstraintDdl(memgraph, l, p, 'unique')],
    ['buildDropConstraintDdl', (l, p) => buildDropConstraintDdl(neo4jCommunity, l, p, 'unique')],
  ];

  it.each(builders)('%s refuses a label or property that is not a plain identifier', (_name, build) => {
    for (const bad of ['', 'a b', 'A)-[r]-(', 'A`', 'n.id', '_lead', 'trail_', 'a__b', '1abc']) {
      expect(() => build(bad, 'id')).toThrow(/invalid label/);
      expect(() => build('Control', bad)).toThrow(/invalid property/);
    }
  });

  it('refuses no properties and a repeated property', () => {
    expect(() => buildConstraintDdl(memgraph, 'A', [], 'unique')).toThrow(/at least one property/);
    expect(() => buildConstraintDdl(memgraph, 'A', ['b', 'b'], 'unique')).toThrow(/repeated property/);
  });
});
