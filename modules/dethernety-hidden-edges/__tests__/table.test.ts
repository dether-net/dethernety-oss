import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { derivedTierCap, EDGE_KINDS, rowFor, selectRows, tableTechniques, TableError, validateTable } from '../src/table';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rowById = (id: string) => clone(shipped.rows.find((r) => r.id === id)) as any;
const baseRow = () => rowById('remote-service/rs-1');
const tableWith = (rows: unknown[], extra: Record<string, unknown> = {}) => ({ version: 2, status: 'draft', kinds: clone(shipped.kinds), rows, ...extra });
const refuses = (raw: unknown, message: RegExp) => expect(() => validateTable(raw)).toThrow(message);
const breaker = (over: Record<string, unknown> = {}) => ({
  attributes: ['x'], read_from: 'reached_end', classes: [], polarity: 'true_breaks', strength: 'lowers', high_when: 'all_false', own_condition: [], techniques: [], ...over,
});

describe('the shipped table', () => {
  it('validates, settled, with every row naming its emitters', () => {
    const t = validateTable(shipped);
    expect(t.status).toBe('settled');
    expect(t.rows.every((r) => r.emitters.length > 0)).toBe(true);
  });

  it('covers the four edge kinds, each with its kind-specific fields and its class', () => {
    const t = validateTable(shipped);
    expect(readdirSync(path.resolve(__dirname, '..', 'data', 'dethernety-hidden-edges', 'dataFlow')).sort()).toEqual([...EDGE_KINDS].sort());
    expect([...new Set(t.rows.map((r) => r.edge_kind))].sort()).toEqual([...EDGE_KINDS].sort());
    expect(t.kinds.find((k) => k.kind === 'host-escape')?.fields.map((f) => f.name)).toEqual(['escape_vector']);
  });
});

describe('validateTable refuses', () => {
  it('an unknown key, on the table, a row, an anchor and a breaker', () => {
    refuses({ ...tableWith([baseRow()]), extra: 1 }, /unknown key "extra"/);
    refuses(tableWith([{ ...baseRow(), note: 'x' }]), /unknown key "note"/);
    refuses(tableWith([{ ...baseRow(), anchors: [{ kind: 'component', classes: [], side: 'x' }] }]), /unknown key "side"/);
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [{ ...breaker(), weight: 1 }] }]), /unknown key "weight"/);
  });

  it('a missing key, and an inherited key counted as present', () => {
    const r = baseRow();
    delete r.tier_cap;
    refuses(tableWith([r]), /lacks "tier_cap"/);
    const inherited = Object.assign(Object.create({ tier_cap: 'low' }), baseRow());
    delete inherited.tier_cap;
    refuses(tableWith([inherited]), /lacks "tier_cap"/);
  });

  it('a value outside its enum', () => {
    refuses(tableWith([{ ...baseRow(), exposed_role: 'peer' }]), /exposed_role must be one of/);
    refuses(tableWith([{ ...baseRow(), peer_relation: 'anywhere' }]), /peer_relation must be one of/);
    refuses(tableWith([{ ...baseRow(), defaults: { ...baseRow().defaults, granted_privilege: 'root' } }]), /granted_privilege/);
  });

  it('a technique that is not an ATT&CK id', () => {
    refuses(tableWith([{ ...baseRow(), techniques: ['T1021', 'lateral'] }]), /invalid entry/);
    refuses(tableWith([{ ...baseRow(), path: { default: 'T10211', from_cited: [], by_item_class: [] } }]), /path.default/);
  });

  it('one technique on one element kind and class in two rows', () => {
    const b = { ...baseRow(), id: 'remote-service/other' };
    refuses(tableWith([baseRow(), b]), /T1021 on securityBoundary Network Segment is in two rows/);
  });

  it('allows one technique in several rows when their anchors differ', () => {
    const b = { ...baseRow(), id: 'remote-service/other', anchors: [{ kind: 'securityBoundary', classes: ['Container'] }] };
    expect(() => validateTable(tableWith([baseRow(), b]))).not.toThrow();
  });

  it('a repeated row id, and a row id not of the form kind/slug', () => {
    const b = { ...baseRow(), anchors: [{ kind: 'component', classes: [] }] };
    refuses(tableWith([baseRow(), b]), /row id .* is repeated/);
    refuses(tableWith([{ ...baseRow(), id: 'host-escape/rs-1' }]), /must start with its edge_kind/);
    refuses(tableWith([{ ...baseRow(), id: 'remote-service/..' }]), /id is invalid/);
  });

  it('an invalid entry, quoting at most 80 characters of it', () => {
    let message = '';
    try {
      validateTable(tableWith([{ ...baseRow(), techniques: ['x'.repeat(5000)] }]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/invalid entry "x{80}"$/);
    refuses(tableWith([{ ...baseRow(), techniques: [10n as unknown as string] }]), /invalid entry bigint/);
  });

  it('a provenance over its cap', () => {
    refuses(tableWith([{ ...baseRow(), provenance: 'x'.repeat(501) }]), /provenance/);
  });

  it('a breaker with a technique the row does not list', () => {
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [breaker({ techniques: ['T1611'] })] }]), /names T1611, which the row does not list/);
    refuses(tableWith([{ ...baseRow(), control_breakers: [{ control_classes: ['Firewall Policy'], attributes_true: [], credential_item_classes: [], supports: 'reached_end', strength: 'lowers', techniques: ['T1611'] }] }]), /names T1611/);
  });

  it('a true_enables breaker with a strength, or gating high; a true_breaks one without a strength', () => {
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [breaker({ polarity: 'true_enables', high_when: 'ignored' })] }]), /has no strength/);
    const enables = breaker({ polarity: 'true_enables', high_when: 'all_false' });
    delete (enables as any).strength;
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [enables] }]), /never gates high/);
    const noStrength = breaker();
    delete (noStrength as any).strength;
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [noStrength] }]), /strength must be one of/);
  });

  it('an ancestor read without the boundary classes it looks for', () => {
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [breaker({ read_from: 'reached_ancestor' })] }]), /names the boundary classes it looks for/);
  });

  it('a flow anchor without its end on a target row, and with one on a capture row', () => {
    refuses(tableWith([{ ...baseRow(), anchors: [{ kind: 'dataFlow', classes: [] }] }]), /flow_end must be one of/);
    const capture = rowById('credential-capture/cc-1');
    refuses(tableWith([{ ...capture, anchors: [{ kind: 'dataFlow', classes: [], flow_end: 'initiator' }] }]), /flow_end is only for/);
  });

  it('credential_flows on a non-credential row, and none on a credential row', () => {
    refuses(tableWith([{ ...baseRow(), credential_flows: 'both' }]), /only for credential rows/);
    const cred = rowById('credential-reuse/cr-1');
    delete cred.credential_flows;
    refuses(tableWith([cred]), /credential_flows must be one of/);
  });

  it('a tier cap above what the breakers support', () => {
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [], control_breakers: [], tier_cap: 'medium' }]), /above what its breakers support \(low\)/);
  });

  it('reached_types missing on a target or source row, or present on a credential or capture row', () => {
    refuses(tableWith([{ ...baseRow(), reached_types: [] }]), /names its reached_types/);
    refuses(tableWith([{ ...rowById('credential-capture/cc-1'), reached_types: ['PROCESS'] }]), /only for target and source rows/);
  });

  it('a settled row without emitters, and a malformed emitter locator', () => {
    refuses(tableWith([{ ...baseRow(), emitters: [] }], { status: 'settled' }), /names its emitters/);
    refuses(tableWith([{ ...baseRow(), emitters: ['../x/policies.rego'] }]), /invalid entry/);
  });

  it('kinds that do not list every edge kind once, and a malformed field', () => {
    refuses(tableWith([baseRow()], { kinds: clone(shipped.kinds).slice(1) }), /every edge kind once/);
    refuses(tableWith([baseRow()], { kinds: [...clone(shipped.kinds), ...clone(shipped.kinds)] }), /every edge kind once/);
    const kinds = clone(shipped.kinds);
    kinds[1].fields[0].values = ['only'];
    refuses(tableWith([baseRow()], { kinds }), /must hold 2 to 8 entries/);
  });

  it('an unknown version or status, or no rows', () => {
    refuses(tableWith([baseRow()], { version: 1 }), /version must be 2/);
    refuses(tableWith([baseRow()], { status: 'final' }), /status must be one of/);
    refuses(tableWith([]), /rows must hold/);
  });

  it('a relation the role cannot use, and a credential item read on a remote-service row', () => {
    refuses(tableWith([{ ...baseRow(), peer_relation: 'landing-segment' }]), /a target row cannot use landing-segment/);
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [breaker({ read_from: 'credential_item' })] }]), /only credential and capture rows read a credential item/);
  });

  it('an any_false group of one attribute', () => {
    refuses(tableWith([{ ...baseRow(), attribute_breakers: [breaker({ high_when: 'any_false' })] }]), /any_false is for a group/);
  });

  it('a provenance with characters outside printable ASCII', () => {
    refuses(tableWith([{ ...baseRow(), provenance: 'line one\nline two' }]), /printable ASCII/);
    refuses(tableWith([{ ...baseRow(), provenance: 'right-to-left \u202e mark' }]), /printable ASCII/);
  });

  it('a path family outside the row, and a malformed path by item class', () => {
    refuses(tableWith([{ ...baseRow(), path: { default: 'T1021', from_cited: ['T1550'], by_item_class: [] } }]), /outside the row's technique families/);
    refuses(tableWith([{ ...baseRow(), path: { default: 'T1021', from_cited: [], by_item_class: [{ item_class: 'Authentication Tokens', technique: 'tok' }] } }]), /not an ATT&CK id/);
  });

  it('an emitter locator outside the open-source catalogue', () => {
    refuses(tableWith([{ ...baseRow(), emitters: ['other-module/component/x/policies.rego'] }]), /invalid entry/);
  });

  it('the same anchor twice in one row, with its own message', () => {
    refuses(tableWith([{ ...baseRow(), anchors: [...baseRow().anchors, ...baseRow().anchors] }]), /remote-service\/rs-1 names T1021 on securityBoundary Network Segment twice/);
  });

  it('returns a frozen table that shares no array with its input', () => {
    const raw = clone(shipped);
    const t = validateTable(raw);
    expect(Object.isFrozen(t.rows[0].techniques)).toBe(true);
    (raw.rows[0].techniques as string[]).push('T1059');
    expect(t.rows[0].techniques).not.toContain('T1059');
  });

  it('throws TableError, never a plain error', () => {
    expect(() => validateTable(null)).toThrow(TableError);
  });
});

describe('the tier cap a row supports', () => {
  const ctl = { control_classes: ['c'], attributes_true: [], credential_item_classes: [], supports: 'reached_end' as const, strength: 'lowers' as const, techniques: [] as string[] };
  const row = (attribute_breakers: any[], control_breakers: any[] = []) => ({ attribute_breakers, control_breakers, techniques: ['T1021'] });

  it('is high with a breaker that gates high, medium with any other breaker, low with none or only enabling ones', () => {
    const gating = breaker({ strength: 'removes' }) as any;
    const lowering = breaker({ high_when: 'ignored' }) as any;
    const enables = { ...breaker({ polarity: 'true_enables', high_when: 'ignored' }) } as any;
    delete enables.strength;
    expect(derivedTierCap(row([gating]))).toBe('high');
    expect(derivedTierCap(row([lowering]))).toBe('medium');
    expect(derivedTierCap(row([], [ctl]))).toBe('medium');
    expect(derivedTierCap(row([enables]))).toBe('low');
    expect(derivedTierCap(row([]))).toBe('low');
  });

  it('is worked out per technique, a filter naming the parent covering its sub-techniques', () => {
    const only = breaker({ strength: 'removes', techniques: ['T1550'] }) as any;
    const r = { attribute_breakers: [only], control_breakers: [], techniques: ['T1550', 'T1078'] };
    expect(derivedTierCap(r, 'T1550.001')).toBe('high');
    expect(derivedTierCap(r, 'T1078')).toBe('low');
    expect(derivedTierCap(r)).toBe('high');
  });

  it('refuses a row cap no technique of the row can reach', () => {
    const cred = rowById('credential-reuse/cr-1');
    cred.attribute_breakers = cred.attribute_breakers.filter((b: any) => b.high_when === 'ignored');
    refuses(tableWith([cred]), /above what its breakers support \(medium\)/);
  });

  it('refuses a lowering control breaker listed before a removing one for the same classes', () => {
    const r = rowById('credential-capture/cc-1');
    r.control_breakers = [...r.control_breakers].reverse();
    refuses(tableWith([r]), /a removing breaker comes before a lowering one/);
  });
});

describe('rowFor', () => {
  const t = validateTable(shipped);

  it('picks the row by technique, element kind and class', () => {
    expect(rowFor(t, 'T1021', 'securityBoundary', 'Network Segment')?.id).toBe('remote-service/rs-1');
    expect(rowFor(t, 'T1021', 'component', 'VPN Gateway')?.id).toBe('remote-service/rs-4v');
    expect(rowFor(t, 'T1021', 'component', 'Administrator')?.id).toBe('remote-service/rs-4a');
    expect(rowFor(t, 'T1021', 'securityBoundary', 'Endpoint / Office Environment')?.id).toBe('remote-service/rs-5');
    expect(rowFor(t, 'T1021.004', 'securityBoundary', 'Operating System / Host')?.id).toBe('remote-service/rs-2');
  });

  it('prefers a row naming the class over one for any class of the kind', () => {
    expect(rowFor(t, 'T1078.001', 'dataFlow', 'SNMP Monitoring')?.id).toBe('credential-reuse/cr-2f');
    expect(rowFor(t, 'T1078.001', 'dataFlow', 'Database Query')?.id).toBe('credential-reuse/cr-1f');
    expect(rowFor(t, 'T1550.003', 'dataFlow', 'Kerberos Authentication')?.id).toBe('credential-reuse/cr-4b');
    expect(rowFor(t, 'T1550.003', 'dataFlow', 'API Call')?.id).toBe('credential-reuse/cr-1f');
  });

  it("falls back to the parent's row for a sub-technique no row lists for the element", () => {
    expect(rowFor(t, 'T1552.007', 'component', 'Application Service')?.id).toBe('credential-reuse/cr-1');
    expect(rowFor(t, 'T1021.007', 'securityBoundary', 'Network Segment')?.id).toBe('remote-service/rs-1');
  });

  it('answers undefined where no row anchors', () => {
    expect(rowFor(t, 'T1021', 'securityBoundary', 'Application Layer')).toBeUndefined();
    expect(rowFor(t, 'T1210', 'dataFlow', 'Message Publish/Consume')).toBeUndefined();
    expect(rowFor(t, 'T1059', 'component', 'Web Server')).toBeUndefined();
    expect(rowFor(t, 'T1611', 'securityBoundary', null)).toBeUndefined();
  });

  it('gives the anchor that matched, with its flow end, and the techniques that chose the row', () => {
    const [sel] = selectRows(t, ['T1558.001'], 'dataFlow', 'Kerberos Authentication');
    expect(sel.row.id).toBe('credential-reuse/cr-4c');
    expect(sel.anchor.flow_end).toBe('responder');
    expect(selectRows(t, ['T1550.002'], 'component', 'Application Service')[0].matched).toEqual(['T1550.002']);
  });

  it('lets a bare parent cited beside its own sub-technique select nothing of its own', () => {
    expect(selectRows(t, ['T1552', 'T1552.005'], 'securityBoundary', 'Operating System / Host').map((x) => x.row.id)).toEqual(['credential-reuse/cr-3']);
    expect(selectRows(t, ['T1078', 'T1078.001'], 'component', 'Relational Database').map((x) => x.row.id)).toEqual(['credential-reuse/cr-2']);
    // a parent whose sub-technique selects nothing still selects its own row
    expect(selectRows(t, ['T1078', 'T1078.003'], 'component', 'Relational Database').map((x) => x.row.id)).toEqual(['credential-reuse/cr-1']);
    // two techniques choosing one row are reported together, in order
    expect(selectRows(t, ['T1552.001', 'T1078'], 'component', 'Application Service')).toMatchObject([{ row: { id: 'credential-reuse/cr-1' }, matched: ['T1078', 'T1552.001'] }]);
  });
});

describe('tableTechniques', () => {
  it('is sorted, unique and depends only on the table', () => {
    const t = validateTable(shipped);
    const a = tableTechniques(t);
    expect(a).toEqual([...new Set(a)].sort());
    expect(a).toEqual(expect.arrayContaining(['T1611', 'T1558', 'T1078']));
    expect(tableTechniques(validateTable(clone(shipped)))).toEqual(a);
  });
});
