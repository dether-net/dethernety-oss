import {
  ALL_REFERENCE_PAIRS,
  REFERENCE_PAIRS,
  RESOLVE_REFERENCES_CYPHER,
  classifyReference,
  isToleratedWhenUnresolved,
  resolveReferencesParams,
} from '../shared/reference-resolution';

/**
 * Unit pins for the instantiation writer's reference table: the closed set of
 * label/key pairs per field kind, bare-string dispatch, and the resolve query
 * built only from the table's literals.
 */
describe('classifyReference', () => {
  it.each([
    ['T1078', 'MitreAttackTechnique', 'attack_id'],
    ['T1562.001', 'MitreAttackTechnique', 'attack_id'],
    ['AML.T0051', 'MitreAtlasTechnique', 'atlas_id'],
    ['AML.T0051.000', 'MitreAtlasTechnique', 'atlas_id'],
  ])('dispatches the bare technique id %s to %s.%s', (ref, label, property) => {
    expect(classifyReference('technique', ref)).toEqual({
      status: 'allowed',
      pair: { label, property },
      target: { label, property, value: ref },
    });
  });

  it.each([
    ['M1037', 'MitreAttackMitigation', 'attack_id'],
    ['AML.M0015', 'MitreAtlasMitigation', 'atlas_id'],
    ['D3-NTA', 'MitreDefendTechnique', 'd3fendId'],
  ])('dispatches the bare response id %s to %s.%s', (ref, label, property) => {
    expect(classifyReference('response', ref)).toMatchObject({
      status: 'allowed',
      target: { label, property, value: ref },
    });
  });

  it.each([
    ['technique', 'M1037'],
    ['technique', 'T12'],
    ['technique', 'AML.M0015'],
    ['response', 'T1078'],
    ['response', 'D3F-UGPH'],
    ['response', ''],
  ] as const)('rejects the bare %s ref %p, keeping it for display', (kind, ref) => {
    expect(classifyReference(kind, ref)).toEqual({ status: 'rejected', display: ref });
  });

  it('accepts every pair in the set for its kind, carrying the attributes', () => {
    for (const kind of ['technique', 'response'] as const) {
      for (const pair of REFERENCE_PAIRS[kind]) {
        const ref = { ...pair, value: 'X1', attributes: { justification: 'why' } };
        expect(classifyReference(kind, ref)).toEqual({
          status: 'allowed',
          pair,
          target: { ...pair, value: 'X1', attributes: { justification: 'why' } },
        });
      }
    }
  });

  it('returns the table literals, not the input strings', () => {
    const c = classifyReference('technique', { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078' });
    expect(c.status).toBe('allowed');
    if (c.status === 'allowed') {
      expect(c.pair).toBe(REFERENCE_PAIRS.technique[0]);
    }
  });

  it.each([
    // a pair valid for the other field kind
    ['technique', { label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1037' }, 'MitreAttackMitigation.attack_id=M1037'],
    ['technique', { label: 'RegulatoryRequirement', property: 'id', value: 'iso:A.8.20' }, 'RegulatoryRequirement.id=iso:A.8.20'],
    ['response', { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078' }, 'MitreAttackTechnique.attack_id=T1078'],
    // a wrong key, an unknown label, an injection attempt in the label
    ['technique', { label: 'MitreAttackTechnique', property: 'attack_iexposured', value: 'T1078' }, 'MitreAttackTechnique.attack_iexposured=T1078'],
    ['response', { label: 'MitreMitigation', property: 'mitigationId', value: 'M1030' }, 'MitreMitigation.mitigationId=M1030'],
    ['technique', { label: 'X) DETACH DELETE (n', property: 'attack_id', value: 'T1' }, 'X) DETACH DELETE (n.attack_id=T1'],
    // a missing or empty value
    ['technique', { label: 'MitreAttackTechnique', property: 'attack_id' }, 'MitreAttackTechnique.attack_id=undefined'],
    ['technique', { label: 'MitreAttackTechnique', property: 'attack_id', value: '' }, 'MitreAttackTechnique.attack_id='],
  ] as const)('rejects the %s object ref %p', (kind, ref, display) => {
    expect(classifyReference(kind, ref)).toEqual({ status: 'rejected', display });
  });

  it('rejects a ref that is neither a string nor an object', () => {
    expect(classifyReference('technique', 42)).toEqual({ status: 'rejected', display: '42' });
    expect(classifyReference('technique', null)).toEqual({ status: 'rejected', display: 'null' });
  });
});

describe('the closed set', () => {
  it('is the five MITRE pairs plus RegulatoryRequirement.id', () => {
    expect(ALL_REFERENCE_PAIRS.map(p => `${p.label}.${p.property}`)).toEqual([
      'MitreAttackTechnique.attack_id',
      'MitreAtlasTechnique.atlas_id',
      'MitreAttackMitigation.attack_id',
      'MitreAtlasMitigation.atlas_id',
      'MitreDefendTechnique.d3fendId',
      'RegulatoryRequirement.id',
    ]);
    const perKind = [...REFERENCE_PAIRS.technique, ...REFERENCE_PAIRS.response];
    expect(new Set(perKind)).toEqual(new Set(ALL_REFERENCE_PAIRS));
  });

  it('tolerates only an unresolved RegulatoryRequirement', () => {
    expect(ALL_REFERENCE_PAIRS.filter(isToleratedWhenUnresolved).map(p => p.label)).toEqual([
      'RegulatoryRequirement',
    ]);
  });
});

describe('the resolve query', () => {
  it('has one indexed branch per pair, built from the table literals', () => {
    const branches = RESOLVE_REFERENCES_CYPHER.split('UNION ALL');
    expect(branches).toHaveLength(ALL_REFERENCE_PAIRS.length);
    ALL_REFERENCE_PAIRS.forEach((pair, i) => {
      expect(branches[i]).toContain(`UNWIND $p${i} AS value`);
      expect(branches[i]).toContain(`OPTIONAL MATCH (t:${pair.label} {${pair.property}: value})`);
      expect(branches[i]).toContain(`RETURN ${i} AS pairIndex, value, count(t) > 0 AS found`);
    });
  });

  it('groups distinct values per pair, with an empty list for unused pairs', () => {
    const refs = ['T1078', 'T1078', 'AML.T0051'].map(r => classifyReference('technique', r));
    const req = classifyReference('response', { label: 'RegulatoryRequirement', property: 'id', value: 'iso:A.5.1' });
    const allowed = [...refs, req].flatMap(c => (c.status === 'allowed' ? [c] : []));
    expect(resolveReferencesParams(allowed)).toEqual({
      p0: ['T1078'],
      p1: ['AML.T0051'],
      p2: [],
      p3: [],
      p4: [],
      p5: ['iso:A.5.1'],
    });
  });
});
