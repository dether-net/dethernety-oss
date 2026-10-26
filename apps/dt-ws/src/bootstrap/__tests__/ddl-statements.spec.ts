import { UNIQUE_CONSTRAINT_COVERED_PAIRS } from '../ensure-constraints.service';
import { isConstraintCovered } from '../ensure-indexes.service';

/**
 * Pins for the pairs the index bootstrap must leave to the uniqueness
 * constraints on Neo4j. The statements themselves are pinned in dt-module
 * (`ddl.test.ts`), where the builders live.
 */

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
