import { EngineInfo } from '../../database/database.service';
import {
  buildConstraintDdl,
  UNIQUE_CONSTRAINT_COVERED_PAIRS,
} from '../ensure-constraints.service';
import { buildIndexDdl, isConstraintCovered } from '../ensure-indexes.service';

/**
 * Pins for the engine-branched DDL builders. The two dialects share NO
 * syntax (verified against live Memgraph 3.8.1 — it parses none of the
 * Neo4j-5 forms), so the exact statement strings are load-bearing: a wrong
 * form fail-opens silently and the deployment runs without its constraint
 * safety net / indexes.
 */

const memgraph: EngineInfo = { engine: 'memgraph', edition: 'community', version: '5.9.0' };
const neo4jEnterprise: EngineInfo = { engine: 'neo4j', edition: 'enterprise', version: '5.26.0' };
const neo4jCommunity: EngineInfo = { engine: 'neo4j', edition: 'community', version: '5.26.0' };
const neo4jUnknownEdition: EngineInfo = { engine: 'neo4j', edition: null, version: null };

describe('buildConstraintDdl', () => {
  it('Memgraph: exact legacy ASSERT forms (the shipped statements)', () => {
    expect(buildConstraintDdl(memgraph, 'ControlClass', 'id', 'unique')).toBe(
      'CREATE CONSTRAINT ON (n:ControlClass) ASSERT n.id IS UNIQUE',
    );
    expect(buildConstraintDdl(memgraph, 'ControlClass', 'id', 'exists')).toBe(
      'CREATE CONSTRAINT ON (n:ControlClass) ASSERT EXISTS (n.id)',
    );
    expect(buildConstraintDdl(memgraph, 'Module', 'name', 'unique')).toBe(
      'CREATE CONSTRAINT ON (n:Module) ASSERT n.name IS UNIQUE',
    );
  });

  it('Neo4j: REQUIRE forms with IF NOT EXISTS', () => {
    expect(buildConstraintDdl(neo4jEnterprise, 'ControlClass', 'id', 'unique')).toBe(
      'CREATE CONSTRAINT IF NOT EXISTS FOR (n:ControlClass) REQUIRE n.id IS UNIQUE',
    );
    expect(buildConstraintDdl(neo4jEnterprise, 'ControlClass', 'id', 'exists')).toBe(
      'CREATE CONSTRAINT IF NOT EXISTS FOR (n:ControlClass) REQUIRE n.id IS NOT NULL',
    );
  });

  it('Neo4j non-enterprise: existence constraints are structurally unavailable (null)', () => {
    // Enterprise-only feature — community AND unknown editions must skip
    // (attempting on community errors; unknown must fail safe).
    expect(buildConstraintDdl(neo4jCommunity, 'ControlClass', 'id', 'exists')).toBeNull();
    expect(buildConstraintDdl(neo4jUnknownEdition, 'ControlClass', 'id', 'exists')).toBeNull();
    // Unique constraints are available on every edition.
    expect(buildConstraintDdl(neo4jCommunity, 'ControlClass', 'id', 'unique')).toContain(
      'REQUIRE n.id IS UNIQUE',
    );
  });
});

describe('buildIndexDdl', () => {
  it('Memgraph keeps the legacy form; Neo4j gets IF NOT EXISTS FOR', () => {
    expect(buildIndexDdl(memgraph, 'Control', 'id')).toBe('CREATE INDEX ON :Control(id)');
    expect(buildIndexDdl(neo4jCommunity, 'Control', 'id')).toBe(
      'CREATE INDEX IF NOT EXISTS FOR (n:Control) ON (n.id)',
    );
  });
});

describe('UNIQUE_CONSTRAINT_COVERED_PAIRS / isConstraintCovered', () => {
  // Membership pins (not a count): on Neo4j a plain index on a covered pair
  // BLOCKS the uniqueness-constraint creation, so the covered set must track
  // the constraint list exactly.
  it('covers every unique-constraint pair', () => {
    for (const label of [
      'AnalysisClass',
      'ComponentClass',
      'ControlClass',
      'DataFlowClass',
      'DataClass',
      'SecurityBoundaryClass',
      'IssueClass',
      'Analysis',
    ]) {
      expect(isConstraintCovered(label, 'id')).toBe(true);
    }
    expect(isConstraintCovered('Module', 'name')).toBe(true);
  });

  it('does not cover index-only pairs', () => {
    expect(isConstraintCovered('Control', 'id')).toBe(false);
    expect(isConstraintCovered('Model', 'id')).toBe(false);
    expect(isConstraintCovered('ControlClass', 'name')).toBe(false);
    expect(isConstraintCovered('Module', 'id')).toBe(false);
    expect(isConstraintCovered('Exposure', 'name')).toBe(false);
  });

  it('the exported list and the predicate agree', () => {
    for (const { label, property } of UNIQUE_CONSTRAINT_COVERED_PAIRS) {
      expect(isConstraintCovered(label, property)).toBe(true);
    }
  });
});
