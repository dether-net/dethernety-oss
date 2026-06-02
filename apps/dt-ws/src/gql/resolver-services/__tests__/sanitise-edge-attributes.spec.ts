/**
 * Edge-property allowlist sanitiser. Standalone unit tests for the helper that
 * decides which ref `attributes` are written onto a MITRE edge — the symmetric
 * counterpart of the node-property allowlist in ./shared/finding-attrs.
 */

import { sanitiseEdgeAttributes, EDGE_ATTR_KEYS } from '../set-instantiation-attributes.service';

const CONTEXT = { originName: 'Some Countermeasure', relationName: 'COUNTERMEASURE_MITIGATES' };

function makeLogger() {
  const calls: { message: string; meta?: unknown }[] = [];
  return {
    warn: (message: string, meta?: unknown) => calls.push({ message, meta }),
    calls,
  };
}

describe('sanitiseEdgeAttributes', () => {
  it('keeps an allowlisted justification string', () => {
    const logger = makeLogger();
    const out = sanitiseEdgeAttributes({ justification: 'M1032 → T1078' }, CONTEXT, logger);
    expect(out).toEqual({ justification: 'M1032 → T1078' });
    expect(logger.calls).toHaveLength(0);
  });

  it('drops keys outside the allowlist', () => {
    const logger = makeLogger();
    const out = sanitiseEdgeAttributes(
      { justification: 'keep me', createdBy: 'USER', priority: 5, internalNotes: 'x' } as any,
      CONTEXT,
      logger,
    );
    expect(out).toEqual({ justification: 'keep me' });
    expect('createdBy' in out).toBe(false);
    expect('priority' in out).toBe(false);
    expect(logger.calls).toHaveLength(0); // non-allowlisted keys are silently excluded, not warned
  });

  it('drops a non-primitive allowlisted value with a warn and does not throw', () => {
    const logger = makeLogger();
    const out = sanitiseEdgeAttributes(
      { justification: { nested: 'object' } } as any,
      CONTEXT,
      logger,
    );
    expect(out).toEqual({});
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].message).toMatch(/Dropping non-primitive/);
    expect(logger.calls[0].meta).toMatchObject({ key: 'justification', relationName: CONTEXT.relationName });
  });

  it('returns an empty object for undefined / empty attributes (SET += {} no-op)', () => {
    const logger = makeLogger();
    expect(sanitiseEdgeAttributes(undefined, CONTEXT, logger)).toEqual({});
    expect(sanitiseEdgeAttributes({}, CONTEXT, logger)).toEqual({});
    expect(logger.calls).toHaveLength(0);
  });

  it('skips null/undefined allowlisted values without warning', () => {
    const logger = makeLogger();
    const out = sanitiseEdgeAttributes({ justification: null } as any, CONTEXT, logger);
    expect(out).toEqual({});
    expect(logger.calls).toHaveLength(0);
  });

  it('allowlist is exactly the documented closed set', () => {
    expect([...EDGE_ATTR_KEYS]).toEqual(['justification']);
  });
});
