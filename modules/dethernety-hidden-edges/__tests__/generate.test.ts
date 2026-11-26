/**
 * The matching core on small models: a positive and a negative model per kind (each the smallest model where the
 * edge must be proposed, and one where a breaker or the relation must stop it), then the core's rules one by one.
 */
import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { candidateId, generateCandidates } from '../src/generate';
import { validateTable } from '../src/table';
import { model } from './model-builder';

const table = validateTable(shipped);
const run = (b: ReturnType<typeof model>, options = {}) => generateCandidates(b.fold(), table, options);
const pairs = (r: Awaited<ReturnType<typeof run>>) => r.candidates.map((c) => `${c.source}->${c.target}`).sort();

const FLAT = 'Lateral movement on a flat tier';
const SEGMENT_DRAWN = 'Drawn-but-not-enforced segmentation';

/** Network Perimeter P > Network Segment SEG holding two services and a database, one query flow. */
function remoteServiceModel(segment: Record<string, unknown>) {
  return model()
    .boundary('P', 'Network Perimeter')
    .boundary('SEG', 'Network Segment', 'P', segment)
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Web Server', 'PROCESS', 'SEG')
    .component('D', 'Relational Database', 'STORE', 'SEG')
    .flow('f1', 'Database Query', 'A', 'D');
}

describe('remote-service', () => {
  it('proposes the flat-tier pairs into services, never into the store nor from it', async () => {
    const r = await run(remoteServiceModel({ segment_boundary_enforced: true, east_west_within_segment_restricted: false }).exposure('x', 'SEG', FLAT, ['T1021']));
    // the database cannot run the attacker's code: it is no starting point for a remote-service row, and is counted
    expect(pairs(r)).toEqual(['A->B', 'B->A']);
    expect(r.counts.excluded_foothold_type).toBe(2);
    for (const c of r.candidates) {
      expect(c.kind).toBe('remote-service');
      expect(c.technique_ids).toEqual(['T1021']);
      // a boundary-anchored target row stays at medium unless the reached component has its own exposure of the technique
      expect(c.tier).toBe('medium');
    }
  });

  it('reaches high where the reached component has its own exposure of the technique', async () => {
    const r = await run(
      remoteServiceModel({ east_west_within_segment_restricted: false })
        .exposure('x', 'SEG', FLAT, ['T1021'])
        .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']),
    );
    expect(r.candidates.find((c) => c.target === 'B')?.tier).toBe('high');
  });

  it('keeps only the parts that give a merged candidate its tier: a lower part’s technique never rides on a higher pair', async () => {
    // A→B is found by the flat segment (T1021, high: B has its own T1021 exposure) and by the application layer
    // (T1210, capped at medium); B→A by both at medium.
    const r = await run(
      model()
        .boundary('P', 'Network Perimeter')
        .boundary('SEG', 'Network Segment', 'P', { east_west_within_segment_restricted: false })
        .boundary('AL', 'Application Layer', 'SEG', { east_west_microsegmentation_enforced: false, east_west_within_segment_restricted: false })
        .component('A', 'Application Service', 'PROCESS', 'AL')
        .component('B', 'Web Server', 'PROCESS', 'AL')
        .exposure('x', 'SEG', FLAT, ['T1021'])
        .exposure('z', 'AL', 'Exploitable internal service', ['T1210'])
        .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']),
    );
    const ab = r.candidates.find((c) => c.source === 'A' && c.target === 'B')!;
    expect([ab.tier, ab.technique_ids, ab.exposure_ids.includes('z')]).toEqual(['high', ['T1021'], false]);
    const ba = r.candidates.find((c) => c.source === 'B' && c.target === 'A')!;
    expect([ba.tier, [...ba.technique_ids].sort()]).toEqual(['medium', ['T1021', 'T1210']]);
  });

  it('removes every pair when east-west traffic in the segment is restricted, and counts them', async () => {
    const r = await run(remoteServiceModel({ segment_boundary_enforced: false, east_west_within_segment_restricted: true }).exposure('x', 'SEG', SEGMENT_DRAWN, ['T1021']));
    expect(r.candidates).toEqual([]);
    expect(r.counts.excluded_by_breaker).toBe(2);
  });

  it('cannot remove with the finding’s own condition: the flat-tier finding exists only while the attribute is not true', async () => {
    // the attribute true and the finding still present (a stale finding): it gates, it does not remove
    const r = await run(remoteServiceModel({ east_west_within_segment_restricted: true }).exposure('x', 'SEG', FLAT, ['T1021']));
    expect(pairs(r)).toEqual(['A->B', 'B->A']);
  });
});

/** Segment SEG with two services and two databases; one credential item on two query flows. */
function credentialModel(isCredential: boolean | null, sameItem = true) {
  return model()
    .boundary('SEG', 'Network Segment')
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Application Service', 'PROCESS', 'SEG')
    .component('D1', 'Relational Database', 'STORE', 'SEG')
    .component('D2', 'Relational Database', 'STORE', 'SEG')
    .data('K', 'User Credentials', isCredential)
    .data('K2', 'User Credentials', isCredential)
    .flow('f1', 'Database Query', 'A', 'D1', {}, ['K'])
    .flow('f2', 'Database Query', 'B', 'D2', {}, [sameItem ? 'K' : 'K2'])
    .exposure('x', 'A', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1078', 'T1552', 'T1552.001']);
}

describe('credential-reuse', () => {
  it('pairs the holder with the other acceptor of the same credential', async () => {
    const r = await run(credentialModel(true));
    expect(pairs(r)).toEqual(['A->D2']);
    expect(r.candidates[0]).toMatchObject({ kind: 'credential-reuse', technique_ids: ['T1078'], tier: 'medium', fields: { credential_basis: 'shared_item' } });
  });

  it('finds the pair from the acceptor side too, and merges both findings into one candidate', async () => {
    const r = await run(credentialModel(true).exposure('y', 'D2', 'Exposed / static database credentials', ['T1552']));
    expect(pairs(r)).toEqual(['A->D2']);
    expect(r.candidates[0].exposure_ids).toEqual(['x', 'y']);
  });

  it('never treats an answered "not a credential" as one, whatever its class', async () => {
    expect((await run(credentialModel(false))).candidates).toEqual([]);
  });

  it('pairs nothing when no item is shared', async () => {
    expect((await run(credentialModel(true, false))).candidates).toEqual([]);
  });

  it('proposes a default account to every segment peer, high when stated, unless east-west is restricted', async () => {
    const build = (eastWest: boolean) =>
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: eastWest })
        .component('M', 'Message Queue', 'STORE', 'SEG', { default_accounts_removed_or_changed: false })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('W', 'Web Server', 'PROCESS', 'SEG')
        .flow('f', 'Message Publish/Consume', 'A', 'M')
        .exposure('x', 'M', 'Default / anonymous / weak broker authentication', ['T1078.001']);
    const pos = await run(build(false));
    expect(pairs(pos)).toEqual(['W->M']);
    expect(pos.candidates[0].tier).toBe('high');
    expect(pos.candidates[0].fields).toEqual({ credential_basis: 'default_account' });
    expect((await run(build(true))).candidates).toEqual([]);
  });

  it('reaches the cloud services a co-hosted workload reaches, from the instance-metadata finding', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .boundary('H', 'Operating System / Host', 'SEG')
        .component('A', 'Application Service', 'PROCESS', 'H')
        .component('B', 'Application Service', 'PROCESS', 'H')
        .component('O', 'Object Storage', 'STORE', 'SEG')
        .flow('f', 'API Call', 'B', 'O')
        .exposure('x', 'H', 'Cloud instance-credential theft via IMDS', ['T1552.005', 'T1552']),
    );
    expect(pairs(r)).toEqual(['A->O']);
    expect(r.candidates[0]).toMatchObject({ technique_ids: ['T1078.004'], rows: ['credential-reuse/cr-3'] });
  });

  it('uses the realm for Kerberos roasting: the other principals reach the roastable one', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('K', 'Identity Provider', 'PROCESS', 'SEG')
        .component('U', 'Application Service', 'PROCESS', 'SEG')
        .component('V', 'Application Service', 'PROCESS', 'SEG')
        .flow('k1', 'Kerberos Authentication', 'U', 'K')
        .flow('k2', 'Kerberos Authentication', 'V', 'K')
        .exposure('x', 'k1', 'Missing pre-authentication (AS-REP roasting)', ['T1558.004']),
    );
    expect(pairs(r)).toEqual(['V->U']);
    expect(r.candidates[0]).toMatchObject({ technique_ids: ['T1078.002'], tier: 'low' });
  });
});

/** Segment SEG with a service, an identity provider and a web server; an LDAP bind flow. */
function captureModel(flowAttrs: Record<string, unknown>) {
  return model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('I', 'Identity Provider', 'PROCESS', 'SEG')
    .component('W', 'Web Server', 'PROCESS', 'SEG')
    .flow('f', 'LDAP / Directory Access', 'A', 'I', flowAttrs)
    .exposure('x', 'f', 'Cleartext LDAP bind credential exposure / StartTLS downgrade', ['T1040', 'T1557']);
}

describe('credential-capture', () => {
  it('lets a segment peer capture the bind and use it at the receiver, high when the flow is stated cleartext', async () => {
    const r = await run(captureModel({ encryption_in_transit_enabled: false }));
    expect(pairs(r)).toEqual(['W->I']);
    expect(r.candidates[0]).toMatchObject({ kind: 'credential-capture', technique_ids: ['T1078'], tier: 'high', rows: ['credential-capture/cc-1', 'credential-capture/cc-2'] });
    expect(r.candidates[0].fields).toMatchObject({ transport_state: 'cleartext' });
  });

  it('an encryption-in-transit control removes sniffing and lowers interception', async () => {
    const r = await run(captureModel({ encryption_in_transit_enabled: false }).control('k', 'Encryption in Transit', ['f'], { tls_only_transport: true }));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ rows: ['credential-capture/cc-2'], tier: 'medium' });
  });

  it('skips a flow that carries no credential, and counts it', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('L', 'Monitoring & SIEM Service', 'PROCESS', 'SEG')
        .component('W', 'Web Server', 'PROCESS', 'SEG')
        .flow('f', 'Log & Telemetry Collection', 'A', 'L', { flow_tls_encrypted: false })
        .exposure('x', 'f', 'Cleartext log shipping', ['T1040']),
    );
    expect(r.candidates).toEqual([]);
    expect(r.counts.flows_not_credential_bearing).toBe(1);
  });
});

/** A host with a privileged container holding a service, a hardened container, and a database on the host. */
function escapeModel(withPeers = true) {
  const b = model()
    .boundary('H', 'Operating System / Host', null, { host_os_family: 'linux' })
    .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false })
    .component('A', 'Application Service', 'PROCESS', 'C1');
  if (withPeers) {
    b.boundary('C2', 'Container', 'H', {
      container_privileged_mode_disabled: true,
      container_capabilities_dropped_to_minimal: true,
      container_host_namespaces_not_shared: true,
      container_no_sensitive_host_mounts: true,
    })
      .component('B', 'Application Service', 'PROCESS', 'C2')
      .component('D', 'Relational Database', 'STORE', 'H');
  } else {
    b.component('A2', 'Application Service', 'PROCESS', 'C1');
  }
  return b.exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']);
}

describe('host-escape', () => {
  it('reaches what runs on the host outside the container, high on one stated configuration weakness', async () => {
    const r = await run(escapeModel());
    expect(pairs(r)).toEqual(['A->B', 'A->D']);
    for (const c of r.candidates) expect(c).toMatchObject({ technique_ids: ['T1611'], tier: 'high', defaults: { granted_privilege: 'system' }, fields: { escape_vector: 'configuration' } });
  });

  it('reaches nothing inside the same container', async () => {
    expect((await run(escapeModel(false))).candidates).toEqual([]);
  });

  it('counts a container with no host above it', async () => {
    const r = await run(model().boundary('C1', 'Container').component('A', 'Application Service', 'PROCESS', 'C1').exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']));
    expect(r.counts.containers_without_host).toBe(1);
  });
});

/** A holder sending one credential on a hundred flows, and one more acceptor of it: 10,100 draws of 101 pairs. */
export function manyFlows() {
  const b = model().boundary('SEG', 'Network Segment').component('H', 'Application Service', 'PROCESS', 'SEG').component('X', 'Application Service', 'PROCESS', 'SEG').component('Y', 'Application Service', 'PROCESS', 'SEG').data('K', 'User Credentials', true);
  for (let i = 0; i < 100; i++) b.component(`T${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG').flow(`f${i}`, 'API Call', 'H', `T${String(i).padStart(2, '0')}`, {}, ['K']);
  return b.flow('xy', 'API Call', 'X', 'Y', {}, ['K']).exposure('x', 'H', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1078', 'T1552', 'T1552.001']);
}

describe('starting points', () => {
  /** A segment with a cleartext bind between two processes, and a store, an outside device and a process as peers. */
  const peers = () =>
    model()
      .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
      .component('A', 'Application Service', 'PROCESS', 'SEG')
      .component('I', 'Identity Provider', 'PROCESS', 'SEG')
      .component('W', 'Web Server', 'PROCESS', 'SEG')
      .component('O', 'Object Storage', 'STORE', 'SEG')
      .component('U', 'End User', 'EXTERNAL_ENTITY', 'SEG')
      .flow('f', 'LDAP / Directory Access', 'A', 'I', { encryption_in_transit_enabled: false })
      .exposure('x', 'f', 'Cleartext LDAP bind credential exposure / StartTLS downgrade', ['T1040', 'T1557']);

  it('a capture needs code running at the starting point: a store or an outside device never captures, and is counted', async () => {
    const r = await run(peers());
    expect(pairs(r)).toEqual(['W->I']);
    expect(r.counts.excluded_foothold_type).toBeGreaterThan(0);
  });

  it('a store is no starting point for an escape, an instance-role fetch or a dump', async () => {
    const escape = await run(
      model()
        .boundary('H', 'Operating System / Host')
        .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false })
        .component('A', 'Application Service', 'PROCESS', 'C1')
        .component('L', 'Object Storage', 'STORE', 'C1')
        .component('D', 'Relational Database', 'STORE', 'H')
        .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']),
    );
    expect(pairs(escape)).toEqual(['A->D']);
    const role = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .boundary('H', 'Operating System / Host', 'SEG')
        .component('A', 'Application Service', 'PROCESS', 'H')
        .component('S', 'Relational Database', 'STORE', 'H')
        .component('B', 'Application Service', 'PROCESS', 'H')
        .component('O', 'Object Storage', 'STORE', 'SEG')
        .flow('f', 'API Call', 'B', 'O')
        .exposure('x', 'H', 'Cloud instance-credential theft via IMDS', ['T1552.005', 'T1552']),
    );
    expect(pairs(role)).toEqual(['A->O']);
    const dump = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('W', 'User Workstation / Endpoint', 'PROCESS', 'SEG')
        .component('J', 'Relational Database', 'STORE', 'SEG')
        .component('X', 'Application Service', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('f1', 'Secure Remote Access', 'W', 'J', {}, ['K'])
        .flow('f2', 'Secure Remote Access', 'W', 'X', {}, ['K'])
        .exposure('x', 'J', 'Credential dumping from memory', ['T1003.001']),
    );
    expect(dump.candidates).toEqual([]);
    expect(dump.counts.excluded_foothold_type).toBe(1);
  });

  it('a starting point that is not a component is dropped, not counted as one of the wrong type', async () => {
    // the realm's members are the Kerberos flows' initiators; with V no longer a component, V→U has no starting point
    const m = model()
      .boundary('SEG', 'Network Segment')
      .component('K', 'Identity Provider', 'PROCESS', 'SEG')
      .component('U', 'Application Service', 'PROCESS', 'SEG')
      .component('V', 'Application Service', 'PROCESS', 'SEG')
      .flow('k1', 'Kerberos Authentication', 'U', 'K')
      .flow('k2', 'Kerberos Authentication', 'V', 'K')
      .exposure('x', 'k1', 'Missing pre-authentication (AS-REP roasting)', ['T1558.004'])
      .fold();
    m.components.delete('V');
    const r = await generateCandidates(m, table);
    expect(r.candidates).toEqual([]);
    expect(r.counts.excluded_foothold_type).toBe(0);
  });

  it('an outside device stays a starting point for a target row', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('U', 'End User', 'EXTERNAL_ENTITY', 'SEG')
        .exposure('x', 'SEG', FLAT, ['T1021']),
    );
    expect(pairs(r)).toEqual(['U->A']);
  });

  it('a store that holds a credential stays a starting point for its reuse', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('S', 'Object Storage', 'STORE', 'SEG')
        .component('D', 'Relational Database', 'STORE', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('f1', 'Database Query', 'A', 'D', {}, ['K'])
        .flow('f2', 'API Call', 'S', 'A', {}, ['K'])
        .exposure('x', 'S', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1552']),
    );
    expect(pairs(r)).toContain('S->D');
  });

  it('starting points the row cannot act from never spend the anchor’s budget', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    // a thousand stores sort before the one process that can start the edge
    for (let i = 0; i < 1_000; i++) b.component(`a${String(i).padStart(4, '0')}`, 'Relational Database', 'STORE', 'SEG');
    b.component('B', 'Web Server', 'PROCESS', 'SEG').component('z', 'Application Service', 'PROCESS', 'SEG').exposure('x', 'SEG', FLAT, ['T1021']);
    const r = await run(b);
    expect(pairs(r)).toContain('z->B');
    expect(r.counts.pairs_over_anchor_budget).toBe(0);
  });

  it('a managed starting point caps capture, dumping and escape at low, and leaves other rows alone', async () => {
    const managed = (cls: string) =>
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .boundary('MR', 'Managed Runtime', 'SEG')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('I', 'Identity Provider', 'PROCESS', 'SEG')
        .component('F', cls, 'PROCESS', 'MR')
        .flow('f', 'LDAP / Directory Access', 'A', 'I', { encryption_in_transit_enabled: false })
        .exposure('x', 'f', 'Cleartext LDAP bind credential exposure / StartTLS downgrade', ['T1040', 'T1557'])
        .exposure('y', 'SEG', FLAT, ['T1021']);
    const r = await run(managed('Application Service'));
    const capture = r.candidates.find((c) => c.kind === 'credential-capture' && c.source === 'F')!;
    expect(capture.tier).toBe('low');
    // a compromised function attacking a peer in its segment is a real path: the remote-service row keeps its tier
    const remote = r.candidates.find((c) => c.kind === 'remote-service' && c.source === 'F')!;
    expect(remote.tier).not.toBe('low');
    const dump = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .boundary('MR', 'Managed Runtime', 'SEG')
        .component('W', 'User Workstation / Endpoint', 'PROCESS', 'SEG')
        .component('J', 'Application Service', 'PROCESS', 'MR')
        .component('X', 'Application Service', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('f1', 'Secure Remote Access', 'W', 'J', {}, ['K'])
        .flow('f2', 'Secure Remote Access', 'W', 'X', {}, ['K'])
        .exposure('x', 'J', 'Credential dumping from memory', ['T1003.001']),
    );
    expect(dump.candidates.map((c) => [c.source, c.target, c.tier])).toEqual([['J', 'X', 'low']]);
  });

  it('caps an escape at low when the container’s host sits on a managed runtime', async () => {
    const r = await run(
      model()
        .boundary('M', 'Managed Runtime')
        .boundary('H', 'Operating System / Host', 'M')
        .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false })
        .component('A', 'Application Service', 'PROCESS', 'C1')
        .component('D', 'Relational Database', 'STORE', 'H')
        .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']),
    );
    expect(r.candidates.map((c) => [c.source, c.target, c.tier])).toEqual([['A', 'D', 'low']]);
  });

  it('bounds the walk where a relation offers mostly starting points it skips', async () => {
    const b = model().boundary('H', 'Operating System / Host').boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false });
    for (let i = 0; i < 120; i++) b.component(`s${String(i).padStart(3, '0')}`, 'Object Storage', 'STORE', 'C1');
    for (let i = 0; i < 120; i++) b.component(`d${String(i).padStart(3, '0')}`, 'Relational Database', 'STORE', 'H');
    const r = await run(b.exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']));
    expect(r.candidates).toEqual([]);
    expect([r.counts.excluded_foothold_type, r.counts.pairs_over_anchor_budget]).toEqual([10_000, 1]);
  });

  it('counts distinct pairs toward the walk’s bound: a pair offered once per flow is drawn many times, counted once', async () => {
    const r = await run(manyFlows());
    expect(pairs(r)).toContain('H->Y');
    expect(r.counts.pairs_over_anchor_budget).toBe(0);
  });

  it('keeps the instance-role reach’s own cap on a managed host', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .boundary('H', 'Managed Runtime', 'SEG')
        .component('A', 'Application Service', 'PROCESS', 'H')
        .component('B', 'Application Service', 'PROCESS', 'H')
        .component('O', 'Object Storage', 'STORE', 'SEG')
        .flow('f', 'API Call', 'B', 'O')
        .exposure('x', 'A', 'Cloud instance-credential theft via IMDS', ['T1552.005', 'T1552']),
    );
    expect(r.candidates.map((c) => [c.source, c.target, c.tier])).toEqual([['A', 'O', 'low']]);
  });
});

describe('the core', () => {
  it('builds the id from the kind and the ends, and gives the same answer on the same input', async () => {
    const b = () => remoteServiceModel({ east_west_within_segment_restricted: false }).exposure('x', 'SEG', FLAT, ['T1021']);
    const a1 = await run(b());
    expect(a1.candidates[0].id).toBe(candidateId('remote-service', a1.candidates[0].source, a1.candidates[0].target));
    expect(await run(b())).toEqual(a1);
  });

  it('feeds pending exposures at a lower tier, and none when asked', async () => {
    const b = () => remoteServiceModel({ east_west_within_segment_restricted: false }).exposure('x', 'SEG', FLAT, ['T1021'], 'pending');
    expect((await run(b())).candidates.every((c) => c.tier !== 'high')).toBe(true);
    expect((await run(b(), { include_pending: false })).candidates).toEqual([]);
  });

  it('skips a disposed exposure', async () => {
    const b = remoteServiceModel({});
    (b as any).rows.exposures.push({ elementId: 'SEG', id: 'x', name: FLAT, dispositionKind: 'NOT_APPLICABLE', dispositionedBy: 'someone', createdBy: 'SYSTEM' });
    (b as any).rows.exposureTechniques.push({ exposureId: 'x', techniqueId: 'T1021' });
    expect((await run(b)).candidates).toEqual([]);
  });

  it('feeds a risk-accepted exposure as confirmed and a compensated one as pending', async () => {
    const tiers = async (b: ReturnType<typeof remoteServiceModel>) => (await run(b)).candidates.map((c) => [c.id, c.tier]);
    // B's own confirmed exposure lets the confirmed anchor reach high, so the two lifecycles differ
    const base = () => remoteServiceModel({ east_west_within_segment_restricted: false }).exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);
    const kind = (dispositionKind: string) => {
      const b = base();
      (b as any).rows.exposures.push({ elementId: 'SEG', id: 'x', name: FLAT, dispositionKind, dispositionedBy: 'someone', createdBy: 'SYSTEM' });
      (b as any).rows.exposureTechniques.push({ exposureId: 'x', techniqueId: 'T1021' });
      return b;
    };
    const confirmed = await tiers(base().exposure('x', 'SEG', FLAT, ['T1021']));
    const pending = await tiers(base().exposure('x', 'SEG', FLAT, ['T1021'], 'pending'));
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed).not.toEqual(pending);
    expect(await tiers(kind('RISK_ACCEPTED'))).toEqual(confirmed);
    expect(await tiers(kind('COMPENSATING_CONTROL'))).toEqual(pending);
    expect((await run(kind('COMPENSATING_CONTROL'), { include_pending: false })).candidates).toEqual([]);
  });

  it('excludes a pair with a declared flow in the same direction only', async () => {
    const r = await run(remoteServiceModel({}).flow('f2', 'API Call', 'B', 'A').exposure('x', 'SEG', FLAT, ['T1021']));
    expect(pairs(r)).not.toContain('B->A');
    expect(pairs(r)).toContain('A->B');
    expect(r.counts.excluded_declared_flow).toBe(1);
  });

  it('excludes a decided pair by its directional id', async () => {
    const id = candidateId('remote-service', 'A', 'B');
    const r = await run(remoteServiceModel({}).exposure('x', 'SEG', FLAT, ['T1021']), { excluded: [id] });
    expect(pairs(r)).not.toContain('A->B');
    expect(pairs(r)).toContain('B->A');
  });

  it('never anchors on an exposure of a hidden-edge flow', async () => {
    const r = await run(remoteServiceModel({}).flow('he', 'Hidden Edge Test', 'A', 'B').exposure('x', 'he', 'Inferred path: T1021', ['T1021']));
    expect(r.candidates).toEqual([]);
    expect(r.counts.hidden_edge_anchors_skipped).toBe(1);
  });

  it('does not count a hidden-edge flow as declared', async () => {
    const r = await run(remoteServiceModel({}).flow('he', 'Hidden Edge Test', 'A', 'B').exposure('x', 'SEG', FLAT, ['T1021']));
    expect(pairs(r)).toContain('A->B');
  });

  it('caps the peers of one anchor at twenty', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 30; i++) b.component(`c${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.component('V', 'VPN Gateway', 'PROCESS', 'SEG').flow('f', 'Secure Remote Access', 'V', 'c00').exposure('x', 'V', 'Flat internal access after admission', ['T1021']);
    const r = await run(b);
    expect(r.candidates).toHaveLength(20);
    expect(r.counts.peers_capped).toBe(9);
  });
});

describe('the credential role in both directions', () => {
  it('lets a host that receives a credential use it at its other acceptors (dumped logons)', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('W', 'User Workstation / Endpoint', 'PROCESS', 'SEG')
        .component('J', 'Application Service', 'PROCESS', 'SEG')
        .component('X', 'Application Service', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('f1', 'Secure Remote Access', 'W', 'J', {}, ['K'])
        .flow('f2', 'Secure Remote Access', 'W', 'X', {}, ['K'])
        .exposure('x', 'J', 'Credential dumping from memory', ['T1003.001']),
    );
    expect(pairs(r)).toEqual(['J->X']);
  });

  it('lets the receiver of a leaked secret use it at the other acceptors (secrets in logs)', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('L', 'Monitoring & SIEM Service', 'PROCESS', 'SEG')
        .component('D', 'Relational Database', 'STORE', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('log', 'Log & Telemetry Collection', 'A', 'L', {}, ['K'])
        .flow('q', 'Database Query', 'A', 'D', {}, ['K'])
        .exposure('x', 'log', 'Secrets and PII leakage into log bodies', ['T1552']),
    );
    expect(pairs(r)).toEqual(['L->D']);
  });
});

describe('tier arithmetic', () => {
  it('counts a true gating breaker once: interception over TLS without certificate checks stays medium', async () => {
    const r = await run(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('D', 'Relational Database', 'STORE', 'SEG')
        .component('W', 'Web Server', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('q', 'Database Query', 'A', 'D', { flow_tls_encrypted: true, server_certificate_validated: false }, ['K'])
        .exposure('x', 'q', 'TLS without server certificate validation (AiTM)', ['T1557']),
    );
    expect(r.candidates.find((c) => c.source === 'W' && c.target === 'D')?.tier).toBe('medium');
  });

  it('keeps a perimeter-only relation at low, whatever raises it', async () => {
    const r = await run(
      model()
        .boundary('P', 'Network Perimeter')
        .component('V', 'VPN Gateway', 'PROCESS', 'P', { permit_any_from_vpn_pool: true })
        .component('A', 'Application Service', 'PROCESS', 'P')
        .component('B', 'Application Service', 'PROCESS', 'P')
        .flow('f', 'Secure Remote Access', 'V', 'A')
        .exposure('x', 'V', 'Flat internal access after admission', ['T1021']),
    );
    expect(r.candidates.map((c) => c.tier)).toEqual(['low']);
  });
});

describe('list caps', () => {
  it('keeps at most fifty entries per list of one candidate, with the full counts beside', async () => {
    const { capLists } = await import('../src/generate');
    const c = (await run(remoteServiceModel({}).exposure('x', 'SEG', FLAT, ['T1021']))).candidates[0];
    const big = capLists({ ...c, exposure_ids: Array.from({ length: 120 }, (_, i) => `x${i}`), facts: Array.from({ length: 3 }, (_, i) => `f${i}`) });
    expect(big.exposure_ids).toHaveLength(50);
    expect(big.totals).toMatchObject({ exposure_ids: 120, facts: 3 });
  });
});

describe('determinism and bounds', () => {
  it('gives the same answer whatever order the rows come in', async () => {
    const build = () =>
      remoteServiceModel({ east_west_within_segment_restricted: false })
        .exposure('x', 'SEG', FLAT, ['T1021'])
        .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);
    const a = await run(build());
    const b = build();
    const rows = (b as any).rows;
    for (const k of Object.keys(rows)) if (Array.isArray(rows[k])) rows[k].reverse();
    expect(await run(b)).toEqual(a);
  });

  it('bounds the work on a large flat segment and keeps to the peer cap', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 2000; i++) b.component(`c${String(i).padStart(4, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.exposure('x', 'SEG', FLAT, ['T1021']);
    const started = Date.now();
    const r = await run(b);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.candidates.length).toBeLessThanOrEqual(20);
    expect(r.counts.pairs_over_anchor_budget).toBe(1);
  });
});
