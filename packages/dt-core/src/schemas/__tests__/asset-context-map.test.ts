/**
 * Asset-context transform-boundary unit tests (pure functions).
 * Covers enum case round-trips, empty-scope omission, and the
 * drop-unknown-with-warning contract that protects pushes from hand-edit typos.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  platformEnumToLocal,
  localEnumToPlatform,
  platformScopeToLocal,
  localScopeToPlatform,
  MODELING_DEPTHS,
  MODELING_INTENTS,
  RECOMMENDED_COMPLIANCE_DRIVERS,
} from '../asset-context-map.js';

describe('platformEnumToLocal', () => {
  it('lowercases the platform token', () => {
    expect(platformEnumToLocal('SECURITY_REVIEW')).toBe('security_review');
    expect(platformEnumToLocal('RESTRICTED')).toBe('restricted');
  });
  it('returns undefined for null/undefined', () => {
    expect(platformEnumToLocal(null)).toBeUndefined();
    expect(platformEnumToLocal(undefined)).toBeUndefined();
  });
});

describe('localEnumToPlatform', () => {
  it('uppercases a valid local token', () => {
    expect(localEnumToPlatform('security_review', MODELING_INTENTS)).toBe('SECURITY_REVIEW');
    expect(localEnumToPlatform('design', MODELING_DEPTHS)).toBe('DESIGN');
  });
  it('is lenient about input casing', () => {
    expect(localEnumToPlatform('Architecture', MODELING_DEPTHS)).toBe('ARCHITECTURE');
  });
  it('drops an unknown value with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(localEnumToPlatform('bogus', MODELING_DEPTHS)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('returns undefined for empty input', () => {
    expect(localEnumToPlatform(undefined, MODELING_DEPTHS)).toBeUndefined();
    expect(localEnumToPlatform('', MODELING_DEPTHS)).toBeUndefined();
  });
});

describe('platformScopeToLocal', () => {
  it('returns undefined when nothing is set', () => {
    expect(platformScopeToLocal({})).toBeUndefined();
    expect(platformScopeToLocal({ depth: null, complianceDrivers: [] })).toBeUndefined();
  });
  it('omits empty arrays rather than writing []', () => {
    expect(platformScopeToLocal({ depth: 'DESIGN', complianceDrivers: [] })).toEqual({
      depth: 'design',
    });
  });
  it('maps a full flat scope to grouped snake_case', () => {
    expect(
      platformScopeToLocal({
        depth: 'ARCHITECTURE',
        modelingIntent: 'INITIAL',
        complianceDrivers: ['PCI'],
        exclusions: ['X'],
        trustAssumptions: ['Y'],
      }),
    ).toEqual({
      depth: 'architecture',
      modeling_intent: 'initial',
      compliance_drivers: ['PCI'],
      exclusions: ['X'],
      trust_assumptions: ['Y'],
    });
  });
});

describe('localScopeToPlatform', () => {
  it('returns undefined for null/empty', () => {
    expect(localScopeToPlatform(undefined)).toBeUndefined();
    expect(localScopeToPlatform({})).toBeUndefined();
  });
  it('maps grouped snake_case to flat camelCase platform fields', () => {
    expect(
      localScopeToPlatform({
        depth: 'design',
        modeling_intent: 'compliance',
        compliance_drivers: ['A'],
      }),
    ).toEqual({
      depth: 'DESIGN',
      modelingIntent: 'COMPLIANCE',
      complianceDrivers: ['A'],
    });
  });
  it('drops an unknown enum and yields undefined when nothing else is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(localScopeToPlatform({ depth: 'bogus' })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('round-trips with platformScopeToLocal', () => {
    const platform = {
      depth: 'IMPLEMENTATION',
      modelingIntent: 'INCIDENT_RESPONSE',
      complianceDrivers: ['HIPAA'],
      exclusions: ['legacy'],
      trustAssumptions: ['kms'],
    };
    expect(localScopeToPlatform(platformScopeToLocal(platform))).toEqual(platform);
  });
});

describe('RECOMMENDED_COMPLIANCE_DRIVERS', () => {
  // Guards the doc <-> code mirror: THREAT_MODELING_WORKFLOW.md Phase 1 (D52 tiers) is
  // the SSOT. A drift here means the doc and the GUI's suggestions have forked.
  it('mirrors the documented D52 framework set and tiers', () => {
    expect(RECOMMENDED_COMPLIANCE_DRIVERS).toEqual([
      { driver: 'SOC2', tier: 1 },
      { driver: 'ISO 27001', tier: 1 },
      { driver: 'PCI-DSS', tier: 2 },
      { driver: 'HIPAA', tier: 2 },
      { driver: 'GDPR', tier: 2 },
      { driver: 'NIST CSF', tier: 3 },
      { driver: 'NIS2', tier: 3 },
      { driver: 'DORA', tier: 3 },
    ]);
  });
  it('uses only valid D52 tiers (1, 2, or 3)', () => {
    for (const { tier } of RECOMMENDED_COMPLIANCE_DRIVERS) {
      expect([1, 2, 3]).toContain(tier);
    }
  });
});
