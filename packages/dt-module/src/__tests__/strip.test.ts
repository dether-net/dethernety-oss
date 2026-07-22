import { describe, it, expect } from 'vitest';
import { stripToSchema } from '../remote/strip';

describe('stripToSchema — the payload-minimization point', () => {
  it('keeps only schema-declared keys and drops everything else', () => {
    const schema = { properties: { a: {}, b: {} } };
    const attributes = { a: 1, b: 2, c: 3, name: 'vm-1', description: 'a machine' };
    expect(stripToSchema(attributes, schema)).toEqual({ a: 1, b: 2 });
  });

  it('drops identity/free-text fields the schema does not declare', () => {
    const schema = { properties: { tls_version: {} } };
    const attributes = { tls_version: '1.2', id: 'x', name: 'y', description: 'z', topology: {} };
    expect(stripToSchema(attributes, schema)).toEqual({ tls_version: '1.2' });
  });

  it('yields an empty object for an empty or absent properties allowlist', () => {
    expect(stripToSchema({ a: 1 }, { properties: {} })).toEqual({});
    expect(stripToSchema({ a: 1 }, {})).toEqual({});
  });

  it('preserves array-valued attributes by reference', () => {
    const ports = [22, 443];
    const out = stripToSchema({ open_ports: ports }, { properties: { open_ports: {} } });
    expect(out).toEqual({ open_ports: [22, 443] });
    expect(out.open_ports).toBe(ports);
  });
});
