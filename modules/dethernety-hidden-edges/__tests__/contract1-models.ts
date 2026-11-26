/**
 * Fixed models whose contract-1 answers are pinned: together they reach every branch of the judging (an
 * `any_false` group, `true_enables`, a gating breaker stated true, a non-gating lowers, a control, a zone's own
 * finding, each low-tier site), a key of more than three parts, a key resting on more than fifty findings, a
 * candidate the knowledge graph lowered, and the options a released client sends. The answer is built as the
 * resolver builds it. Dethereal's tests run the same answers through its released validator.
 */
import path from 'node:path';
import { KG_KEY_SEPARATOR, type KgClient, type KgRule, type KgThreat } from '@dethernety/dt-module';
import shipped from '../src/edge-kinds.json';
import { answerOf } from '../src/answer';
import { readKindClasses } from '../src/classes';
import { type Contract, tableHash } from '../src/contract';
import { boundCandidates, candidateId, matchCandidates, orderCandidates } from '../src/generate';
import { absentFacts, applyKg, classInventory, DEFAULT_KG_CLASS_MODULES, readKg } from '../src/kg';
import { validateTable } from '../src/table';
import type { FoldedModel } from '../src/fold';
import type { GenerateOptions } from '../src/generate';
import { model, ModelBuilder } from './model-builder';

const table = validateTable(shipped);
const FLAT = 'Lateral movement on a flat tier';

/** A segment, an application layer in it, a VPN admitting into the perimeter, and a Kerberos realm. */
function segment(): ModelBuilder {
  return model()
    .boundary('P', 'Network Perimeter')
    .boundary('SEG', 'Network Segment', 'P', { east_west_within_segment_restricted: false })
    .boundary('AL', 'Application Layer', 'SEG', { east_west_microsegmentation_enforced: false, east_west_within_segment_restricted: false })
    .component('A', 'Application Service', 'PROCESS', 'AL')
    .component('B', 'Web Server', 'PROCESS', 'AL', {}, true)
    .component('D', 'Relational Database', 'STORE', 'SEG')
    .component('U', 'End User', 'EXTERNAL_ENTITY', 'SEG')
    .boundary('VP', 'Network Perimeter')
    .component('V', 'VPN Gateway', 'PROCESS', 'VP', { permit_any_from_vpn_pool: true })
    .component('E', 'Application Service', 'PROCESS', 'VP')
    .component('E2', 'Application Service', 'PROCESS', 'VP')
    .component('K', 'Identity Provider', 'PROCESS', 'SEG')
    .flow('q', 'Database Query', 'A', 'D')
    .flow('vpn', 'Secure Remote Access', 'V', 'E')
    .flow('k1', 'Kerberos Authentication', 'A', 'K')
    .flow('k2', 'Kerberos Authentication', 'B', 'K')
    .exposure('x', 'SEG', FLAT, ['T1021'])
    .exposure('z', 'AL', 'Exploitable internal service', ['T1210'], 'pending')
    .exposure('y', 'B', 'Remote administration exposed', ['T1021.004'])
    .exposure('v', 'V', 'Flat internal access after admission', ['T1021'])
    .exposure('r', 'k1', 'Missing pre-authentication (AS-REP roasting)', ['T1558.004']);
}

/** Shared credentials: an enabling shared-service flow, a dumped logon on a workstation, MFA, and a generic item. */
function credential(): ModelBuilder {
  const b = model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .boundary('AL', 'Application Layer', 'SEG', { shared_service_credentials_used: true })
    .boundary('H', 'Operating System / Host', 'SEG')
    .component('A', 'Application Service', 'PROCESS', 'AL')
    .component('B', 'Application Service', 'PROCESS', 'AL')
    .component('D1', 'Relational Database', 'STORE', 'SEG')
    .component('D2', 'Relational Database', 'STORE', 'SEG')
    .component('W', 'User Workstation / Endpoint', 'PROCESS', 'H')
    .component('J', 'Application Service', 'PROCESS', 'SEG')
    .component('X', 'Application Service', 'PROCESS', 'SEG')
    .component('S', 'Object Storage', 'STORE', 'SEG')
    .component('Z', 'Application Service', 'PROCESS', 'AL')
    .component('Y', 'Application Service', 'PROCESS', 'SEG')
    .data('K', 'User Credentials', true)
    .data('T', 'Authentication Tokens', true)
    .data('G', 'Authentication Tokens', true)
    .flow('f1', 'Database Query', 'A', 'D1', {}, ['K'])
    .flow('f2', 'Database Query', 'B', 'D2', { per_workload_db_identity_used: true }, ['K'])
    .flow('isc', 'Internal Service Communication', 'A', 'B', { shared_service_credentials_used: true }, ['T'])
    .flow('w1', 'Secure Remote Access', 'W', 'J', {}, ['K'])
    .flow('w2', 'Secure Remote Access', 'W', 'X', {}, ['K'])
    .flow('st', 'API Call', 'S', 'Z', {}, ['T'])
    .control('mfa', 'Multi-Factor Authentication', ['D2'], {})
    .exposure('x', 'A', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1078', 'T1552', 'T1552.001'])
    .exposure('y', 'D2', 'Exposed / static database credentials', ['T1552'])
    .exposure('w', 'J', 'Credential dumping from memory', ['T1003.001'])
    .exposure('g', 'G', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1552'], 'pending');
  // a token carried by six flows is generic: its pairs are capped at low
  for (let i = 0; i < 6; i++) b.component(`g${i}`, 'Application Service', 'PROCESS', 'SEG').flow(`gf${i}`, 'API Call', `g${i}`, i % 2 ? 'X' : 'Y', {}, ['G']);
  return b;
}

/** A cleartext bind and a protected one, with a store, an outside device and a managed workload among the peers. */
function capture(): ModelBuilder {
  return model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .boundary('MR', 'Managed Runtime', 'SEG')
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('I', 'Identity Provider', 'PROCESS', 'SEG')
    .component('W', 'Web Server', 'PROCESS', 'SEG')
    .component('O', 'Object Storage', 'STORE', 'SEG')
    .component('U', 'End User', 'EXTERNAL_ENTITY', 'SEG')
    .component('F', 'Application Service', 'PROCESS', 'MR')
    .component('Q', 'Application Service', 'PROCESS', 'SEG')
    .component('R', 'Relational Database', 'STORE', 'SEG')
    .data('K', 'User Credentials', true)
    .flow('f', 'LDAP / Directory Access', 'A', 'I', { encryption_in_transit_enabled: false })
    .flow('g', 'Database Query', 'Q', 'R', { flow_tls_encrypted: true, server_certificate_validated: false }, ['K'])
    .control('k', 'Encryption in Transit', ['g'], { tls_only_transport: true })
    .exposure('x', 'f', 'Cleartext LDAP bind credential exposure / StartTLS downgrade', ['T1040', 'T1557'])
    .exposure('t', 'g', 'TLS without server certificate validation (AiTM)', ['T1557']);
}

/** A privileged container and a hardened one on a host, a store inside the first, and a container on a managed runtime. */
function escape(): ModelBuilder {
  return model()
    .boundary('H', 'Operating System / Host', null, { host_os_family: 'linux' })
    .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false, container_capabilities_dropped_to_minimal: true })
    .boundary('C2', 'Container', 'H', {
      container_privileged_mode_disabled: true,
      container_capabilities_dropped_to_minimal: true,
      container_host_namespaces_not_shared: true,
      container_no_sensitive_host_mounts: true,
    })
    .component('A', 'Application Service', 'PROCESS', 'C1')
    .component('L', 'Object Storage', 'STORE', 'C1')
    .component('B', 'Application Service', 'PROCESS', 'C2')
    .component('D', 'Relational Database', 'STORE', 'H')
    .boundary('M', 'Managed Runtime')
    .boundary('C3', 'Container', 'M', {})
    .component('E', 'Application Service', 'PROCESS', 'C3')
    .component('N', 'Application Service', 'PROCESS', 'M')
    .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611'])
    .exposure('m', 'C3', 'Privileged mode / excessive capabilities', ['T1611'], 'pending');
}

/** One pair resting on fifty-five findings, through two rows each. */
function fanout(): ModelBuilder {
  const b = model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .boundary('AL', 'Application Layer', 'SEG', { east_west_microsegmentation_enforced: false, east_west_within_segment_restricted: false })
    .component('A', 'Application Service', 'PROCESS', 'AL')
    .component('B', 'Web Server', 'PROCESS', 'AL');
  for (let i = 0; i < 55; i++) {
    const id = `x${String(i).padStart(2, '0')}`;
    if (i % 2 === 0) b.exposure(id, 'SEG', FLAT, ['T1021']);
    else b.exposure(id, 'AL', 'Exploitable internal service', ['T1210']);
  }
  return b;
}

/** A flat-tier finding on a segment whose east-west restriction is stated true: the breaker gates, it cannot remove. */
function stated(): ModelBuilder {
  return model()
    .boundary('P', 'Network Perimeter')
    .boundary('SEG', 'Network Segment', 'P', { east_west_within_segment_restricted: true })
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Web Server', 'PROCESS', 'SEG')
    .exposure('x', 'SEG', FLAT, ['T1021']);
}

/** Services drawn straight in a perimeter, with no segment: their same-segment pairs are perimeter-only, so low. */
function perimeter(): ModelBuilder {
  return model()
    .boundary('P', 'Network Perimeter')
    .component('A', 'Application Service', 'PROCESS', 'P')
    .component('U', 'End User', 'EXTERNAL_ENTITY', 'P')
    .component('K', 'Cache / In-Memory Store', 'STORE', 'P')
    .component('S', 'Object Storage', 'STORE', 'P')
    .exposure('y', 'K', 'Exploitable cache service', ['T1210']);
}

/** Workloads reading an instance-role credential: on a managed runtime the reach is low; a store on a host is no reader. */
function managedRole(): ModelBuilder {
  return model()
    .boundary('SEG', 'Network Segment')
    .boundary('H', 'Managed Runtime', 'SEG')
    .boundary('OS', 'Operating System / Host', 'SEG')
    .component('A', 'Application Service', 'PROCESS', 'H')
    .component('B', 'Application Service', 'PROCESS', 'H')
    .component('L', 'Relational Database', 'STORE', 'H')
    .component('C', 'Application Service', 'PROCESS', 'OS')
    .component('E', 'Application Service', 'PROCESS', 'OS')
    .component('M', 'Relational Database', 'STORE', 'OS')
    .component('O', 'Object Storage', 'STORE', 'SEG')
    .flow('f', 'API Call', 'B', 'O')
    .flow('g', 'API Call', 'E', 'O')
    .exposure('x', 'A', 'Cloud instance-credential theft via IMDS', ['T1552.005', 'T1552'])
    .exposure('h', 'OS', 'Cloud instance-credential theft via IMDS', ['T1552.005', 'T1552']);
}

/** A holder sending one credential on a hundred flows, and one more acceptor of it: one pair drawn a hundred times. */
function manyFlows(): ModelBuilder {
  const b = model().boundary('SEG', 'Network Segment').component('H', 'Application Service', 'PROCESS', 'SEG').component('X', 'Application Service', 'PROCESS', 'SEG').component('Y', 'Application Service', 'PROCESS', 'SEG').data('K', 'User Credentials', true);
  for (let i = 0; i < 100; i++) b.component(`T${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG').flow(`f${i}`, 'API Call', 'H', `T${String(i).padStart(2, '0')}`, {}, ['K']);
  return b.flow('xy', 'API Call', 'X', 'Y', {}, ['K']).exposure('x', 'H', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1078', 'T1552', 'T1552.001']);
}

/** The segment fixture the knowledge graph lowers: its rule for the flat tier cites none of the row's techniques. */
function lowered(): ModelBuilder {
  return model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Web Server', 'PROCESS', 'SEG')
    .exposure('x', 'SEG', FLAT, ['T1021'])
    .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);
}

/** A knowledge graph whose rule for the network segment's flat-tier finding cites only an unrelated technique. */
function lowersFlat(): KgClient {
  const rule = (classId: string): KgRule =>
    ({ id: 'rule:flat', ruleId: 'flat', classId, name: FLAT, kind: 'exposure', description: null, criticality: null, score: null, attackVector: null, conditionGroups: null, mitreRefs: null, policyHash: null, reads: [] }) as KgRule;
  const threat: KgThreat = { id: 'th', slug: 'th', name: null, description: null, attackSurface: null, techniqueIds: ['T1190'], techniqueProvenance: null, derivedFrom: [] } as KgThreat;
  return {
    version: null,
    capability: async () => ({ available: true, entitled: true, sliceCount: 1 }),
    rulesByClassId: async (ids: string[]) => new Map(ids.map((id) => [id, id === 'c:Network_Segment' ? [rule(id)] : []])),
    threatsByRuleId: async (refs: Array<{ classId: string; ruleId: string }>) =>
      new Map(refs.map((r) => [`${r.classId}${KG_KEY_SEPARATOR}${r.ruleId}`, r.ruleId === 'flat' ? [threat] : []])),
    threatsByTechniqueId: async () => new Map(),
  } as unknown as KgClient;
}

export interface SnapshotModel {
  name: string;
  build: () => ModelBuilder;
  options: GenerateOptions;
  kg?: () => KgClient;
}

export const SNAPSHOT_MODELS: SnapshotModel[] = [
  // the options a released client sends: pending findings included and its standing decisions excluded
  { name: 'segment', build: segment, options: { include_pending: true, excluded: [candidateId('remote-service', 'K', 'A')] } },
  { name: 'credential', build: credential, options: { include_pending: true } },
  { name: 'capture', build: capture, options: {} },
  { name: 'escape', build: escape, options: { include_pending: true } },
  { name: 'stated', build: stated, options: {} },
  { name: 'fanout', build: fanout, options: { include_pending: true } },
  { name: 'lowered', build: lowered, options: {}, kg: lowersFlat },
  { name: 'perimeter', build: perimeter, options: { include_pending: true } },
  { name: 'managed-role', build: managedRole, options: { include_pending: true } },
  { name: 'many-flows', build: manyFlows, options: { include_pending: true } },
];

const MODULE_DIR = path.resolve(__dirname, '..');

/** The answer for one fixed model, as the resolver builds it (contract 1 unless asked); with the folded model it came from. */
export async function answerFor(entry: SnapshotModel, contract: Contract = 1, sizeLimit?: number): Promise<{ answer: Record<string, any>; model: FoldedModel }> {
  const m = entry.build().fold();
  const matched = await matchCandidates(m, table, { ...entry.options, explain: contract === 2 });
  const chosen = boundCandidates(matched.candidates, m, matched.counts);
  const facts = entry.kg ? await readKg(entry.kg(), 'tok', classInventory(m, new Set(DEFAULT_KG_CLASS_MODULES))) : absentFacts('unavailable');
  const classes = readKindClasses(path.join(MODULE_DIR, 'data'));
  const kgEvidence = new Map<string, string[]>();
  const candidates = orderCandidates(applyKg(m, table, chosen, matched.anchors, facts, kgEvidence), m);
  const answer = await answerOf(
    { contract, model: m, table, tableHash: tableHash(shipped), classes, matched, candidates, kgEvidence, regime: facts.regime, classesCapped: facts.classesCapped },
    sizeLimit === undefined ? {} : { sizeLimit },
  );
  return { answer, model: m };
}

/** The contract-1 answer for one fixed model. */
export const contractOneAnswer = (entry: SnapshotModel) => answerFor(entry, 1);
