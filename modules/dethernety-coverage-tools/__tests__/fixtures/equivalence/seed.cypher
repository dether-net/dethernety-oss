// Cross-implementation equivalence fixture — seeded graph.
//
// One synthetic model exercising every contract dimension of the graded
// coverage primitive (see coverage-facts.md):
//   - all three tiers (DIRECT incl. a detective _DETECTS edge,
//     INDIRECT_MITIGATION, INDIRECT_D3FEND),
//   - a detect-only technique (covered, but never preventively),
//   - a soft exposure (no EXPLOITED_BY technique),
//   - a dispositioned countermeasure (still credited — the facts are
//     disposition-agnostic by contract),
//   - a Data-element exposure,
//   - ATT&CK sub-technique inheritance (coverage from the parent flows
//     down; tactic columns inherited via SUBTECHNIQUE_OF*0..1),
//   - D3FEND tactic inheritance via SUB_TECHNIQUE_OF, a tactic-less
//     artifact bridge (reads as PREVENT), and a defend technique spanning
//     Detect + Harden (yields BOTH functions),
//   - boundary-inherited control support (exactly one BELONGS_TO level),
//   - an element-scoping negative: a countermeasure countering a technique
//     while its control supports a DIFFERENT element must not be credited,
//   - an uncovered technique (mapped but unmet).
//
// All ids are synthetic (T9xxx / M9xxx / D9xxx are not real ATT&CK or
// D3FEND ids). `rows.json` pins what the module's four queries return for
// this graph; `expected.json` pins the aggregated CoverageResult.
// Statements are `;`-separated; comments are stripped by loaders.

// ── Model skeleton ──────────────────────────────────────────────────────────
CREATE (m:Model {id: 'model-eq-fixture', name: 'Coverage Equivalence Fixture'});

MATCH (m:Model {id: 'model-eq-fixture'})
CREATE (m)-[:CONTAINS]->(:SecurityBoundary {id: 'b-edge', name: 'Edge Zone'});

MATCH (outer:SecurityBoundary {id: 'b-edge'})
CREATE (:SecurityBoundary {id: 'b-core', name: 'Core Zone'})-[:BELONGS_TO]->(outer);

MATCH (b:SecurityBoundary {id: 'b-edge'})
CREATE (:Component {id: 'c-web', name: 'Web Frontend'})-[:BELONGS_TO]->(b);

MATCH (b:SecurityBoundary {id: 'b-core'})
CREATE (:Component {id: 'c-db', name: 'Database'})-[:BELONGS_TO]->(b);

MATCH (w:Component {id: 'c-web'}), (d:Component {id: 'c-db'})
CREATE (w)-[:FLOWS]->(f:DataFlow {id: 'f-web-db', name: 'Web to DB'})-[:FLOWS]->(d);

MATCH (m:Model {id: 'model-eq-fixture'})
CREATE (m)-[:CONTAINS]->(:Data {id: 'd-records', name: 'Customer Records'});

// ── MITRE ATT&CK catalogue (synthetic) ──────────────────────────────────────
CREATE (:MitreAttackTactic {id: 'tac-ia', name: 'Initial Access'});
CREATE (:MitreAttackTactic {id: 'tac-pe', name: 'Privilege Escalation'});
CREATE (:MitreAttackTactic {id: 'tac-ex', name: 'Exfiltration'});
CREATE (:MitreAttackTactic {id: 'tac-cr', name: 'Credential Access'});

CREATE (:MitreAttackTechnique {attack_id: 'T9001', name: 'Exploit Edge Service', description: 'Adversaries may exploit an internet-facing edge service.'});
CREATE (:MitreAttackTechnique {attack_id: 'T9002', name: 'Valid Accounts', description: 'Adversaries may abuse valid accounts.'});
CREATE (:MitreAttackTechnique {attack_id: 'T9002.004', name: 'Cloud Accounts', description: 'Adversaries may abuse cloud accounts.'});
CREATE (:MitreAttackTechnique {attack_id: 'T9003', name: 'Stage and Exfiltrate', description: 'Adversaries may stage and exfiltrate collected data.'});
CREATE (:MitreAttackTechnique {attack_id: 'T9004', name: 'Flow Interception', description: 'Adversaries may intercept data in transit.'});
CREATE (:MitreAttackTechnique {attack_id: 'T9005', name: 'Record Harvesting', description: 'Adversaries may harvest stored records.'});

// T9002.004 is a sub-technique of T9002 and carries NO direct tactic edges —
// its tactic columns must arrive via the parent (SUBTECHNIQUE_OF*0..1).
MATCH (s:MitreAttackTechnique {attack_id: 'T9002.004'}), (p:MitreAttackTechnique {attack_id: 'T9002'})
CREATE (s)-[:SUBTECHNIQUE_OF]->(p);

MATCH (tac:MitreAttackTactic {id: 'tac-ia'}), (t:MitreAttackTechnique {attack_id: 'T9001'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
MATCH (tac:MitreAttackTactic {id: 'tac-ia'}), (t:MitreAttackTechnique {attack_id: 'T9002'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
MATCH (tac:MitreAttackTactic {id: 'tac-pe'}), (t:MitreAttackTechnique {attack_id: 'T9002'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
MATCH (tac:MitreAttackTactic {id: 'tac-ex'}), (t:MitreAttackTechnique {attack_id: 'T9003'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
MATCH (tac:MitreAttackTactic {id: 'tac-cr'}), (t:MitreAttackTechnique {attack_id: 'T9004'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
MATCH (tac:MitreAttackTactic {id: 'tac-ex'}), (t:MitreAttackTechnique {attack_id: 'T9005'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);

CREATE (:MitreAttackMitigation {id: 'M9001', name: 'Account Use Policies'});

// ── MITRE D3FEND catalogue (synthetic) ──────────────────────────────────────
CREATE (:MitreDefendTactic {id: 'dtac-detect', name: 'Detect'});
CREATE (:MitreDefendTactic {id: 'dtac-harden', name: 'Harden'});

// D9001: detective, but its tactic arrives via SUB_TECHNIQUE_OF inheritance.
CREATE (:MitreDefendTechnique {id: 'D9001', name: 'Traffic Analysis Variant'});
CREATE (:MitreDefendTechnique {id: 'D9001-parent', name: 'Traffic Analysis'});
MATCH (s:MitreDefendTechnique {id: 'D9001'}), (p:MitreDefendTechnique {id: 'D9001-parent'})
CREATE (s)-[:SUB_TECHNIQUE_OF]->(p);
MATCH (p:MitreDefendTechnique {id: 'D9001-parent'}), (tac:MitreDefendTactic {id: 'dtac-detect'})
CREATE (p)-[:ENABLES]->(tac);

// D9002: tactic-less bridge — must read as PREVENT.
CREATE (:MitreDefendTechnique {id: 'D9002', name: 'Record Hardening'});

// D9003: spans Detect AND Harden — must yield BOTH functions.
CREATE (:MitreDefendTechnique {id: 'D9003', name: 'Edge Inspection'});
MATCH (dt:MitreDefendTechnique {id: 'D9003'}), (tac:MitreDefendTactic {id: 'dtac-detect'})
CREATE (dt)-[:ENABLES]->(tac);
MATCH (dt:MitreDefendTechnique {id: 'D9003'}), (tac:MitreDefendTactic {id: 'dtac-harden'})
CREATE (dt)-[:ENABLES]->(tac);

// Shared defensive artifacts (the OWL-derived bridge is untyped in the
// schema; the matcher is verb-agnostic, so the seed's edge types are
// arbitrary offensive/defensive verbs).
CREATE (:MitreDefendNetworkTrafficEntity {id: 'ent-traffic', name: 'Network Traffic'});
CREATE (:MitreDefendFileEntity {id: 'ent-records', name: 'Stored Records'});
CREATE (:MitreDefendNetworkTrafficEntity {id: 'ent-edge', name: 'Edge Traffic'});

MATCH (dt:MitreDefendTechnique {id: 'D9001'}), (e:MitreDefendNetworkTrafficEntity {id: 'ent-traffic'})
CREATE (dt)-[:ANALYZES]->(e);
MATCH (t:MitreAttackTechnique {attack_id: 'T9003'}), (e:MitreDefendNetworkTrafficEntity {id: 'ent-traffic'})
CREATE (t)-[:PRODUCES]->(e);

MATCH (dt:MitreDefendTechnique {id: 'D9002'}), (e:MitreDefendFileEntity {id: 'ent-records'})
CREATE (dt)-[:HARDENS]->(e);
MATCH (t:MitreAttackTechnique {attack_id: 'T9005'}), (e:MitreDefendFileEntity {id: 'ent-records'})
CREATE (t)-[:ACCESSES]->(e);

MATCH (dt:MitreDefendTechnique {id: 'D9003'}), (e:MitreDefendNetworkTrafficEntity {id: 'ent-edge'})
CREATE (dt)-[:MONITORS]->(e);
MATCH (t:MitreAttackTechnique {attack_id: 'T9001'}), (e:MitreDefendNetworkTrafficEntity {id: 'ent-edge'})
CREATE (t)-[:PRODUCES]->(e);

// ── Exposures ───────────────────────────────────────────────────────────────
// c-web: a multi-tier-covered technique + a soft exposure.
MATCH (c:Component {id: 'c-web'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-web-rce', name: 'Edge RCE'});
MATCH (e:Exposure {id: 'exp-web-rce'}), (t:MitreAttackTechnique {attack_id: 'T9001'})
CREATE (e)-[:EXPLOITED_BY]->(t);

MATCH (c:Component {id: 'c-web'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-web-soft', name: 'Unmapped Weakness'});

// c-web: sub-technique row — covered only via its PARENT's mitigation.
MATCH (c:Component {id: 'c-web'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-web-cloudacct', name: 'Cloud Account Abuse'});
MATCH (e:Exposure {id: 'exp-web-cloudacct'}), (t:MitreAttackTechnique {attack_id: 'T9002.004'})
CREATE (e)-[:EXPLOITED_BY]->(t);

// c-db: detect-only technique (DIRECT _DETECTS + D3FEND Detect; never prevented).
MATCH (c:Component {id: 'c-db'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-db-exfil', name: 'Data Exfiltration'});
MATCH (e:Exposure {id: 'exp-db-exfil'}), (t:MitreAttackTechnique {attack_id: 'T9003'})
CREATE (e)-[:EXPLOITED_BY]->(t);

// f-web-db: mapped but UNCOVERED (flows do not inherit boundary support and
// no control supports the flow directly).
MATCH (f:DataFlow {id: 'f-web-db'})
CREATE (f)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-flow-intercept', name: 'Flow Interception'});
MATCH (e:Exposure {id: 'exp-flow-intercept'}), (t:MitreAttackTechnique {attack_id: 'T9004'})
CREATE (e)-[:EXPLOITED_BY]->(t);

// d-records: Data-element exposure covered by a DISPOSITIONED countermeasure.
MATCH (d:Data {id: 'd-records'})
CREATE (d)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-data-harvest', name: 'Record Harvesting'});
MATCH (e:Exposure {id: 'exp-data-harvest'}), (t:MitreAttackTechnique {attack_id: 'T9005'})
CREATE (e)-[:EXPLOITED_BY]->(t);

// ── Controls & countermeasures ──────────────────────────────────────────────
// ctrl-edge supports c-web DIRECTLY. Its countermeasures:
//   cm-waf      → DIRECT prevent on T9001 (PROTECTS_AGAINST)
//                 + D3FEND both-function bridge to T9001 (via D9003)
//   cm-acctpol  → INDIRECT_MITIGATION on T9002 (parent) — covers T9002.004
CREATE (:Control {id: 'ctrl-edge', name: 'Edge Protection'});
MATCH (ctrl:Control {id: 'ctrl-edge'}), (c:Component {id: 'c-web'})
CREATE (ctrl)-[:SUPPORTS]->(c);
MATCH (ctrl:Control {id: 'ctrl-edge'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-waf', name: 'Web Application Firewall'});
MATCH (ctrl:Control {id: 'ctrl-edge'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-acctpol', name: 'Account Policy Enforcement'});

MATCH (cm:Countermeasure {id: 'cm-waf'}), (t:MitreAttackTechnique {attack_id: 'T9001'})
CREATE (cm)-[:COUNTERMEASURE_PROTECTS_AGAINST]->(t);
MATCH (cm:Countermeasure {id: 'cm-waf'}), (dt:MitreDefendTechnique {id: 'D9003'})
CREATE (cm)-[:RESPONDS_WITH]->(dt);

MATCH (cm:Countermeasure {id: 'cm-acctpol'}), (mit:MitreAttackMitigation {id: 'M9001'})
CREATE (cm)-[:RESPONDS_WITH]->(mit);
MATCH (mit:MitreAttackMitigation {id: 'M9001'}), (t:MitreAttackTechnique {attack_id: 'T9002'})
CREATE (mit)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(t);

// ctrl-core supports b-core (the BOUNDARY) — c-db is credited via exactly
// one boundary-inherited BELONGS_TO level. Its countermeasures:
//   cm-ids   → DIRECT detect on T9003 (COUNTERMEASURE_DETECTS)
//   cm-nta   → INDIRECT_D3FEND Detect on T9003 (via D9001, whose Detect
//              tactic arrives through SUB_TECHNIQUE_OF inheritance)
CREATE (:Control {id: 'ctrl-core', name: 'Core Monitoring'});
MATCH (ctrl:Control {id: 'ctrl-core'}), (b:SecurityBoundary {id: 'b-core'})
CREATE (ctrl)-[:SUPPORTS]->(b);
MATCH (ctrl:Control {id: 'ctrl-core'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-ids', name: 'Intrusion Detection Sensor'});
MATCH (ctrl:Control {id: 'ctrl-core'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-nta', name: 'Network Traffic Analyzer'});

MATCH (cm:Countermeasure {id: 'cm-ids'}), (t:MitreAttackTechnique {attack_id: 'T9003'})
CREATE (cm)-[:COUNTERMEASURE_DETECTS]->(t);
MATCH (cm:Countermeasure {id: 'cm-nta'}), (dt:MitreDefendTechnique {id: 'D9001'})
CREATE (cm)-[:RESPONDS_WITH]->(dt);

// ctrl-data supports d-records directly; cm-vault is DISPOSITIONED
// (risk-accepted) but the raw facts still credit it — disposition filtering
// is a consumer concern by contract.
CREATE (:Control {id: 'ctrl-data', name: 'Data Protection'});
MATCH (ctrl:Control {id: 'ctrl-data'}), (d:Data {id: 'd-records'})
CREATE (ctrl)-[:SUPPORTS]->(d);
MATCH (ctrl:Control {id: 'ctrl-data'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-vault', name: 'Record Vault Hardening', dispositionKind: 'RISK_ACCEPTED'});
MATCH (cm:Countermeasure {id: 'cm-vault'}), (dt:MitreDefendTechnique {id: 'D9002'})
CREATE (cm)-[:RESPONDS_WITH]->(dt);

// ── Element-scoping NEGATIVE ────────────────────────────────────────────────
// ctrl-other supports ONLY c-db; cm-other counters T9001 — which is exposed
// on c-web, not c-db. It must appear in NO tier fact for exp-web-rce.
CREATE (:Control {id: 'ctrl-other', name: 'Unrelated Control'});
MATCH (ctrl:Control {id: 'ctrl-other'}), (c:Component {id: 'c-db'})
CREATE (ctrl)-[:SUPPORTS]->(c);
MATCH (ctrl:Control {id: 'ctrl-other'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-other', name: 'Misplaced Mitigator'});
MATCH (cm:Countermeasure {id: 'cm-other'}), (t:MitreAttackTechnique {attack_id: 'T9001'})
CREATE (cm)-[:COUNTERMEASURE_MITIGATES]->(t);
