import { describe, expect, it } from 'vitest';
import { MAX_EXCLUDED, parseOptions } from '../src/options';

const ok = (raw: unknown) => {
  const r = parseOptions(raw);
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail}`);
  return r.options;
};
const refused = (raw: unknown) => {
  const r = parseOptions(raw);
  return r.ok ? null : [r.code, r.detail];
};

describe('parseOptions', () => {
  it('gives the defaults for no options', () => {
    for (const raw of [undefined, null, '{}']) expect(ok(raw)).toEqual({});
  });

  it('reads both options it knows', () => {
    expect(ok(JSON.stringify({ excluded: ['he:0123456789abcdef', 'he:0123456789abcdef'], include_pending: false }))).toEqual({ excluded: ['he:0123456789abcdef'], include_pending: false });
  });

  it('refuses what is not JSON, not an object, or too large', () => {
    expect(refused('not json')).toEqual(['options_invalid', 'options']);
    expect(refused('[]')).toEqual(['options_invalid', 'options']);
    expect(refused(7)).toEqual(['options_invalid', 'options']);
    expect(refused(JSON.stringify({ excluded: [], pad: 'x'.repeat(128 * 1024) }))).toEqual(['options_invalid', 'options']);
  });

  it('refuses an unknown key, never echoing it or its value', () => {
    for (const key of ['secret_key', 'caps', 'accepted_flows', 'min_contract']) {
      const r = refused(JSON.stringify({ [key]: 'SECRET-CANARY' }));
      expect(r).toEqual(['options_invalid', 'options has an unknown key']);
      expect(JSON.stringify(r)).not.toContain('SECRET');
    }
  });

  it('reads the contract asked for: 1 by default, 1 or 2 when asked, anything else refused', () => {
    expect(parseOptions(null)).toMatchObject({ ok: true, contract: 1 });
    expect(parseOptions(JSON.stringify({ contract: 1, include_pending: true }))).toMatchObject({ ok: true, contract: 1, options: { include_pending: true } });
    expect(parseOptions(JSON.stringify({ contract: 2 }))).toMatchObject({ ok: true, contract: 2 });
    for (const c of [3, 0, '2', null, 1.5]) expect(refused(JSON.stringify({ contract: c }))).toEqual(['options_invalid', 'contract']);
  });

  it('refuses malformed or oversized exclusions, and a pending flag that is no boolean', () => {
    expect(refused(JSON.stringify({ excluded: ['he:XYZ'] }))).toEqual(['options_invalid', 'excluded']);
    expect(refused(JSON.stringify({ excluded: Array.from({ length: MAX_EXCLUDED + 1 }, (_, i) => `he:${i.toString(16).padStart(16, '0')}`) }))).toEqual(['options_invalid', 'excluded']);
    expect(refused(JSON.stringify({ include_pending: 'no' }))).toEqual(['options_invalid', 'include_pending']);
  });
});
