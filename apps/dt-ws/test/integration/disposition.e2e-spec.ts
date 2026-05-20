// Integration coverage for DispositionResolverService.disposeExposure /
// clearDisposition.
//
// Strategy: instantiate the resolver service directly against a real Memgraph
// testcontainer with stub Config/Auth/Monitoring services. Mirrors the pattern
// in element-binding.e2e-spec.ts (direct service call; no Apollo boot).
//
// Coverage:
//   - dispose with each of the 5 DispositionKind values
//   - re-affirm (same kind + reason) clears dispositionStale, restamps dispositionedAt
//   - re-dispose with different kind updates all fields
//   - clear from each dispositioned state nulls all five fields
//   - clear on already-cleared exposure is successful no-op
//   - dispose / clear on missing exposure → EXPOSURE_NOT_FOUND envelope
//   - reason empty / whitespace-only / >2000 chars → VALIDATION_ERROR
//   - missing actor (context.user.sub absent) → VALIDATION_ERROR
//   - D4 guard regression: module-supplied disposition fields stripped by
//     EXPOSURE_ATTR_KEYS allowlist; existing disposition unchanged after
//     a sanitiseExposureAttrs() round-trip.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { DispositionResolverService } from '../../src/gql/resolver-services/disposition-resolver.service';
import {
  EXPOSURE_ATTR_KEYS,
  COUNTERMEASURE_ATTR_KEYS,
  sanitiseExposureAttrs,
  sanitiseCountermeasureAttrs,
} from '../../src/gql/resolver-services/shared/finding-attrs';

jest.setTimeout(120_000);

const TEST_USER_SUB = 'auth0|test-user-1';

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
  } as unknown as ConfigService;
}
function makeStubAuthService(): any {
  return {
    extractAuthContext: (ctx: any) => ({ user: ctx?.user, token: ctx?.token }),
    checkAuthorization: async () => ({ allowed: true }),
  };
}
function makeStubMonitoringService(): any {
  return { recordOperation: () => {} };
}

function makeAuthCtx(sub: string | null = TEST_USER_SUB): any {
  return sub === null ? {} : { user: { sub } };
}

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function seedExposure(
  driver: any,
  id: string,
  attrs: Record<string, any> = {},
): Promise<void> {
  await runWrite(
    driver,
    `CREATE (e:Exposure { id: $id, name: $name })
     SET e += $attrs`,
    { id, name: attrs.name ?? `Exposure ${id}`, attrs },
  );
}

async function readExposure(driver: any, id: string): Promise<any> {
  const session = driver.session();
  try {
    const r = await session.run(`MATCH (e:Exposure {id: $id}) RETURN e`, { id });
    if (r.records.length === 0) return null;
    return r.records[0].get('e').properties;
  } finally {
    await session.close();
  }
}

async function seedCountermeasure(
  driver: any,
  id: string,
  attrs: Record<string, any> = {},
): Promise<void> {
  await runWrite(
    driver,
    `CREATE (cm:Countermeasure { id: $id, name: $name })
     SET cm += $attrs`,
    { id, name: attrs.name ?? `Countermeasure ${id}`, attrs },
  );
}

async function readCountermeasure(driver: any, id: string): Promise<any> {
  const session = driver.session();
  try {
    const r = await session.run(`MATCH (cm:Countermeasure {id: $id}) RETURN cm`, { id });
    if (r.records.length === 0) return null;
    return r.records[0].get('cm').properties;
  } finally {
    await session.close();
  }
}

describe('DispositionResolverService — disposition mutations (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: DispositionResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new DispositionResolverService(
      mg.driver,
      makeStubConfigService(),
      makeStubAuthService(),
      makeStubMonitoringService(),
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  describe('disposeExposure — happy paths', () => {
    it.each([
      'NOT_APPLICABLE',
      'FALSE_POSITIVE',
      'COMPENSATING_CONTROL',
      'RISK_ACCEPTED',
      'SUPERSEDED',
    ] as const)('disposes with kind=%s — all 5 fields stamped, stale=false', async (kind) => {
      await seedExposure(mg.driver, 'e-1');
      const before = Date.now();
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind, reason: `Test reason for ${kind}` },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.exposureId).toBe('e-1');
      expect(result.dispositionKind).toBe(kind);
      expect(result.dispositionReason).toBe(`Test reason for ${kind}`);
      expect(result.dispositionedBy).toBe(TEST_USER_SUB);
      expect(result.dispositionStale).toBe(false);
      expect(typeof result.dispositionedAt).toBe('string');
      const stamped = Date.parse(String(result.dispositionedAt));
      expect(stamped).toBeGreaterThanOrEqual(before - 1000);

      // Verify graph state matches result envelope.
      const stored = await readExposure(mg.driver, 'e-1');
      expect(stored.dispositionKind).toBe(kind);
      expect(stored.dispositionReason).toBe(`Test reason for ${kind}`);
      expect(stored.dispositionedBy).toBe(TEST_USER_SUB);
      expect(stored.dispositionStale).toBe(false);
    });

    it('re-affirms (same kind + reason): clears stale, restamps dispositionedAt', async () => {
      await seedExposure(mg.driver, 'e-1', {
        dispositionKind: 'NOT_APPLICABLE',
        dispositionReason: 'Initial reason',
        dispositionedBy: 'auth0|prior-user',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: true,
      });
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: 'Initial reason' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.dispositionStale).toBe(false);
      // Restamp: actor + dispositionedAt updated to current user/time.
      expect(result.dispositionedBy).toBe(TEST_USER_SUB);
      const ts = Date.parse(String(result.dispositionedAt));
      expect(ts).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
    });

    it('re-disposes with a different kind: kind + reason + dispositionedAt updated', async () => {
      await seedExposure(mg.driver, 'e-1', {
        dispositionKind: 'NOT_APPLICABLE',
        dispositionReason: 'Initial',
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: false,
      });
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'RISK_ACCEPTED', reason: 'Updated reason' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.dispositionKind).toBe('RISK_ACCEPTED');
      expect(result.dispositionReason).toBe('Updated reason');
      expect(result.dispositionStale).toBe(false);
    });

    it('trims whitespace from reason before persisting', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: '   trimmed reason   ' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.dispositionReason).toBe('trimmed reason');
    });
  });

  describe('clearDisposition — happy paths', () => {
    it.each([
      'NOT_APPLICABLE',
      'FALSE_POSITIVE',
      'COMPENSATING_CONTROL',
      'RISK_ACCEPTED',
      'SUPERSEDED',
    ] as const)('clears from kind=%s — all 5 fields null', async (kind) => {
      await seedExposure(mg.driver, 'e-1', {
        dispositionKind: kind,
        dispositionReason: 'Pre-existing reason',
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: kind === 'FALSE_POSITIVE',
      });
      const result = await svc.clearDisposition({ exposureId: 'e-1' }, makeAuthCtx());
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.dispositionKind).toBeNull();
      expect(result.dispositionReason).toBeNull();
      expect(result.dispositionedBy).toBeNull();
      expect(result.dispositionedAt).toBeNull();
      expect(result.dispositionStale).toBeNull();

      const stored = await readExposure(mg.driver, 'e-1');
      expect(stored.dispositionKind ?? null).toBeNull();
      expect(stored.dispositionReason ?? null).toBeNull();
      expect(stored.dispositionedBy ?? null).toBeNull();
      expect(stored.dispositionedAt ?? null).toBeNull();
      expect(stored.dispositionStale ?? null).toBeNull();
    });

    it('clear on already-cleared exposure is a successful no-op', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.clearDisposition({ exposureId: 'e-1' }, makeAuthCtx());
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
    });
  });

  describe('not-found paths', () => {
    it('disposeExposure on missing id → EXPOSURE_NOT_FOUND envelope', async () => {
      const result = await svc.disposeExposure(
        { exposureId: 'no-such-id', kind: 'NOT_APPLICABLE', reason: 'any' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXPOSURE_NOT_FOUND');
      expect(result.errorMessage).toBeTruthy();
      expect(result.dispositionKind).toBeNull();
    });

    it('clearDisposition on missing id → EXPOSURE_NOT_FOUND envelope', async () => {
      const result = await svc.clearDisposition({ exposureId: 'no-such-id' }, makeAuthCtx());
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXPOSURE_NOT_FOUND');
    });
  });

  describe('validation', () => {
    it('rejects empty reason with VALIDATION_ERROR and no graph write', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: '' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      const stored = await readExposure(mg.driver, 'e-1');
      expect(stored.dispositionKind ?? null).toBeNull();
    });

    it('rejects whitespace-only reason with VALIDATION_ERROR', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: '     ' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rejects reason exceeding 2000 chars with VALIDATION_ERROR', async () => {
      await seedExposure(mg.driver, 'e-1');
      const longReason = 'a'.repeat(2001);
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: longReason },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });

    it('accepts reason exactly 2000 chars', async () => {
      await seedExposure(mg.driver, 'e-1');
      const reason = 'a'.repeat(2000);
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.dispositionReason).toBe(reason);
    });

    it('rejects dispose when actor (context.user.sub) absent → VALIDATION_ERROR', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'NOT_APPLICABLE', reason: 'any' },
        makeAuthCtx(null),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rejects clear when actor absent → VALIDATION_ERROR', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.clearDisposition({ exposureId: 'e-1' }, makeAuthCtx(null));
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('D4 guard — EXPOSURE_ATTR_KEYS strips disposition fields', () => {
    // SetInstantiationAttributesService.upsertExposuresInTx sanitises
    // module-supplied attrs via sanitiseExposureAttrs, which is the
    // actual D4 guard. This test verifies the allowlist excludes all five
    // disposition fields — if a module returns them, they're silently dropped.
    it('all 5 disposition field names are absent from EXPOSURE_ATTR_KEYS', () => {
      const disposition = [
        'dispositionKind',
        'dispositionReason',
        'dispositionedBy',
        'dispositionedAt',
        'dispositionStale',
      ];
      for (const k of disposition) {
        expect(EXPOSURE_ATTR_KEYS).not.toContain(k);
      }
    });

    it('sanitiseExposureAttrs() round-trip drops disposition fields a module might return', () => {
      const moduleSupplied: any = {
        name: 'Test',
        description: 'desc',
        // Module attempts to inject disposition state — not allowed:
        dispositionKind: 'FALSE_POSITIVE',
        dispositionReason: 'attempted injection',
        dispositionedBy: 'auth0|module',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: true,
      };
      const sanitised = sanitiseExposureAttrs(moduleSupplied);
      expect(sanitised).toEqual({ name: 'Test', description: 'desc' });
      expect(sanitised).not.toHaveProperty('dispositionKind');
      expect(sanitised).not.toHaveProperty('dispositionReason');
      expect(sanitised).not.toHaveProperty('dispositionedBy');
      expect(sanitised).not.toHaveProperty('dispositionedAt');
      expect(sanitised).not.toHaveProperty('dispositionStale');
    });
  });

  // ===========================================================================
  // Countermeasure parity.
  // Same shared _applyDisposition / _clearDisposition path, label='Countermeasure',
  // the COUNTERMEASURE_PICKABLE set ({NOT_APPLICABLE, FALSE_POSITIVE, WAIVED,
  // SUPERSEDED}). exposureId in the result envelope carries the countermeasure id.
  // ===========================================================================
  describe('disposeCountermeasure — happy paths', () => {
    it.each([
      'NOT_APPLICABLE',
      'FALSE_POSITIVE',
      'WAIVED',
      'SUPERSEDED',
    ] as const)('disposes with kind=%s — all 5 fields stamped, stale=false', async (kind) => {
      await seedCountermeasure(mg.driver, 'cm-1');
      const result = await svc.disposeCountermeasure(
        { countermeasureId: 'cm-1', kind, reason: `CM reason for ${kind}` },
        makeAuthCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.exposureId).toBe('cm-1');
      expect(result.dispositionKind).toBe(kind);
      expect(result.dispositionReason).toBe(`CM reason for ${kind}`);
      expect(result.dispositionedBy).toBe(TEST_USER_SUB);
      expect(result.dispositionStale).toBe(false);
      expect(typeof result.dispositionedAt).toBe('string');

      const stored = await readCountermeasure(mg.driver, 'cm-1');
      expect(stored.dispositionKind).toBe(kind);
      expect(stored.dispositionedBy).toBe(TEST_USER_SUB);
      expect(stored.dispositionStale).toBe(false);
    });
  });

  describe('clearCountermeasureDisposition — happy paths', () => {
    it('clears all five fields and is a successful no-op on already-cleared', async () => {
      await seedCountermeasure(mg.driver, 'cm-1', {
        dispositionKind: 'WAIVED',
        dispositionReason: 'Pre-existing',
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: true,
      });
      const result = await svc.clearCountermeasureDisposition({ countermeasureId: 'cm-1' }, makeAuthCtx());
      expect(result.success).toBe(true);
      expect(result.dispositionKind).toBeNull();
      expect(result.dispositionStale).toBeNull();
      const stored = await readCountermeasure(mg.driver, 'cm-1');
      expect(stored.dispositionKind ?? null).toBeNull();
      expect(stored.dispositionStale ?? null).toBeNull();

      // Idempotent second clear.
      const again = await svc.clearCountermeasureDisposition({ countermeasureId: 'cm-1' }, makeAuthCtx());
      expect(again.success).toBe(true);
    });
  });

  describe('per-finding kind validation (server mirrors the UI filter)', () => {
    it.each(['COMPENSATING_CONTROL', 'RISK_ACCEPTED'] as const)(
      'disposeCountermeasure rejects exposure-only kind=%s with VALIDATION_ERROR (no write)',
      async (kind) => {
        await seedCountermeasure(mg.driver, 'cm-1');
        const result = await svc.disposeCountermeasure(
          { countermeasureId: 'cm-1', kind: kind as any, reason: 'any' },
          makeAuthCtx(),
        );
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('VALIDATION_ERROR');
        const stored = await readCountermeasure(mg.driver, 'cm-1');
        expect(stored.dispositionKind ?? null).toBeNull();
      },
    );

    it('disposeExposure rejects countermeasure-only kind=WAIVED with VALIDATION_ERROR (no write)', async () => {
      await seedExposure(mg.driver, 'e-1');
      const result = await svc.disposeExposure(
        { exposureId: 'e-1', kind: 'WAIVED' as any, reason: 'any' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      const stored = await readExposure(mg.driver, 'e-1');
      expect(stored.dispositionKind ?? null).toBeNull();
    });

    it('disposeCountermeasure on missing id → not-found envelope', async () => {
      const result = await svc.disposeCountermeasure(
        { countermeasureId: 'no-such-cm', kind: 'WAIVED', reason: 'any' },
        makeAuthCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EXPOSURE_NOT_FOUND');
    });

    it('rejects disposeCountermeasure with empty reason / absent actor', async () => {
      await seedCountermeasure(mg.driver, 'cm-1');
      const emptyReason = await svc.disposeCountermeasure(
        { countermeasureId: 'cm-1', kind: 'WAIVED', reason: '   ' },
        makeAuthCtx(),
      );
      expect(emptyReason.errorCode).toBe('VALIDATION_ERROR');
      const noActor = await svc.disposeCountermeasure(
        { countermeasureId: 'cm-1', kind: 'WAIVED', reason: 'real' },
        makeAuthCtx(null),
      );
      expect(noActor.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('D4 guard — COUNTERMEASURE_ATTR_KEYS strips disposition fields', () => {
    it('all 5 disposition field names are absent from COUNTERMEASURE_ATTR_KEYS', () => {
      for (const k of [
        'dispositionKind',
        'dispositionReason',
        'dispositionedBy',
        'dispositionedAt',
        'dispositionStale',
      ]) {
        expect(COUNTERMEASURE_ATTR_KEYS).not.toContain(k);
      }
    });

    it('sanitiseCountermeasureAttrs() drops disposition fields a module might return', () => {
      const moduleSupplied: any = {
        name: 'Test',
        description: 'desc',
        dispositionKind: 'WAIVED',
        dispositionReason: 'attempted injection',
        dispositionedBy: 'auth0|module',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: true,
      };
      const sanitised = sanitiseCountermeasureAttrs(moduleSupplied);
      expect(sanitised).not.toHaveProperty('dispositionKind');
      expect(sanitised).not.toHaveProperty('dispositionReason');
      expect(sanitised).not.toHaveProperty('dispositionedBy');
      expect(sanitised).not.toHaveProperty('dispositionedAt');
      expect(sanitised).not.toHaveProperty('dispositionStale');
    });
  });
});
