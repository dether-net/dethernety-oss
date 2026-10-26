// A rule's reads leave normalisation ordered by name, and a threat's sources by id, whatever order the engine or the
// wire handed them over in.
import { describe, it, expect } from 'vitest';
import { fromObject, toRule, toThreat } from '../kg/normalize';

const read = (name: string) => ({ name, title: `${name} title`, description: null, category: null });
const rule = (reads: unknown[]) =>
  toRule(fromObject({ id: 'kr1', ruleId: 'r1', classId: 'c1', kind: 'exposure', reads }));

/** Every ordering of `items`. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe("toRule — the order of a rule's reads", () => {
  it('is code-unit order by name (upper case first), whatever order the reads arrive in', () => {
    const names = ['flow_tls_encrypted', 'access_token_ttl_minutes', 'Mfa_required', 'mfa_required'];
    for (const order of permutations(names)) {
      expect(rule(order.map(read)).reads.map((r) => r.name)).toEqual(['Mfa_required', 'access_token_ttl_minutes', 'flow_tls_encrypted', 'mfa_required']);
    }
  });

  it('keeps every field of each read', () => {
    expect(rule([read('b'), read('a')]).reads).toEqual([read('a'), read('b')]);
  });
});

const source = (id: string) => ({ id, kind: 'cwe', title: `${id} title`, canonicalUrl: null, synthesis: null, accessed: null, resolved: true });
const threat = (derivedFrom: unknown[]) => toThreat(fromObject({ id: 't1', slug: 's1', derivedFrom }));

describe("toThreat — the order of a threat's sources", () => {
  it('is code-unit order by id (upper case first), whatever order the sources arrive in', () => {
    const ids = ['cwe:89', 'CWE:79', 'capec:66', 'attack:T1190'];
    for (const order of permutations(ids)) {
      expect(threat(order.map(source)).derivedFrom.map((d) => d.id)).toEqual(['CWE:79', 'attack:T1190', 'capec:66', 'cwe:89']);
    }
  });

  it('keeps every field of each source', () => {
    expect(threat([source('b'), source('a')]).derivedFrom).toEqual([source('a'), source('b')]);
  });
});
