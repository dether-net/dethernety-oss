import { describe, it, expect, vi } from 'vitest';
import { mapExposureFinding, mapCountermeasureFinding } from '../rego-mapping';

describe('mapExposureFinding', () => {
  it('projects a full finding, preserving exploited_by refs and their attributes', () => {
    const onInvalid = vi.fn();
    const raw = {
      name: 'Public ingress',
      description: 'reachable from the internet',
      type: 'network',
      category: 'exposure',
      score: 7,
      attack_vector: 'NETWORK',
      exploited_by: [
        {
          label: 'MitreAttackTechnique',
          property: 'techniqueId',
          value: 'T1190',
          attributes: { justification: 'edge-facing' },
        },
      ],
    };

    const result = mapExposureFinding(raw, onInvalid);

    expect(result).toEqual({
      name: 'Public ingress',
      description: 'reachable from the internet',
      type: 'network',
      category: 'exposure',
      score: 7,
      attackVector: 'NETWORK',
      exploitedBy: [
        {
          label: 'MitreAttackTechnique',
          property: 'techniqueId',
          value: 'T1190',
          attributes: { justification: 'edge-facing' },
        },
      ],
    });
    // the nested attribute survives the projection
    expect((result.exploitedBy as any[])[0].attributes.justification).toBe('edge-facing');
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('defaults an attack vector outside the CVSS enum to UNSPECIFIED and fires the callback once', () => {
    const onInvalid = vi.fn();
    const result = mapExposureFinding(
      { name: 'Weird', attack_vector: 'CARRIER_PIGEON' },
      onInvalid,
    );

    expect(result.attackVector).toBe('UNSPECIFIED');
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid).toHaveBeenCalledWith('CARRIER_PIGEON', 'Weird');
  });

  it('defaults a missing attack vector to UNSPECIFIED without firing the callback', () => {
    const onInvalid = vi.fn();
    const result = mapExposureFinding({ name: 'No AV' }, onInvalid);

    expect(result.attackVector).toBe('UNSPECIFIED');
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('uppercases a valid lower-case vector and resolves camelCase input keys via the fallbacks', () => {
    const onInvalid = vi.fn();
    const result = mapExposureFinding(
      { name: 'Camel', attackVector: 'network', exploitedBy: ['T1190'] },
      onInvalid,
    );

    expect(result.attackVector).toBe('NETWORK');
    expect(result.exploitedBy).toEqual(['T1190']);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('is pure when no callback is supplied (invalid vector still defaults, no throw)', () => {
    expect(mapExposureFinding({ name: 'X', attack_vector: 'BOGUS' }).attackVector).toBe(
      'UNSPECIFIED',
    );
  });
});

describe('mapCountermeasureFinding', () => {
  it('projects every known verb snake→camel and drops unknown verb keys', () => {
    const raw = {
      name: 'Segment the network',
      description: 'restrict lateral movement',
      type: 'control',
      category: 'countermeasure',
      score: 4,
      responds_with: [{ label: 'MitreMitigation', property: 'mitigationId', value: 'M1030' }],
      mitigates: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1021' }],
      protects_against: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1210' }],
      detects: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1046' }],
      isolates: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1570' }],
      deceives: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1036' }],
      evicts: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1078' }],
      restores: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1490' }],
      responds_to: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1567' }],
      // a bogus/future verb — must NOT be projected onto the result
      degrades: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T9999' }],
    };

    const result = mapCountermeasureFinding(raw);

    expect(result).toEqual({
      name: 'Segment the network',
      description: 'restrict lateral movement',
      type: 'control',
      category: 'countermeasure',
      score: 4,
      respondsWith: [{ label: 'MitreMitigation', property: 'mitigationId', value: 'M1030' }],
      mitigates: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1021' }],
      protectsAgainst: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1210' }],
      detects: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1046' }],
      isolates: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1570' }],
      deceives: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1036' }],
      evicts: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1078' }],
      restores: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1490' }],
      respondsTo: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1567' }],
    });
    expect('degrades' in result).toBe(false);
  });

  it('leaves unemitted verbs undefined and resolves the camelCase respondsWith fallback', () => {
    const result = mapCountermeasureFinding({
      name: 'Minimal',
      type: 'control',
      category: 'countermeasure',
      respondsWith: [{ label: 'MitreMitigation', property: 'mitigationId', value: 'M1042' }],
      mitigates: [{ label: 'MitreAttackTechnique', property: 'techniqueId', value: 'T1059' }],
    });

    expect(result.respondsWith).toEqual([
      { label: 'MitreMitigation', property: 'mitigationId', value: 'M1042' },
    ]);
    expect(result.mitigates).toBeDefined();
    expect(result.detects).toBeUndefined();
    expect(result.protectsAgainst).toBeUndefined();
    expect(result.respondsTo).toBeUndefined();
  });
});
