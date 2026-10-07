// ATLAS smoke fixture — seeded graph.
//
// One model whose findings carry MITRE ATLAS links next to ATT&CK ones. ATLAS links
// reuse the ATT&CK edge types (EXPLOITED_BY, RESPONDS_WITH, COUNTERMEASURE_*), so a
// reader that does not check the target's label would read an ATLAS node as an
// ATT&CK one. Engines that do not use ATLAS must skip it: no exception, no ATLAS
// id read as a technique, tactic, column or credit.
//
// Run every engine twice: on this graph, and after removing every MitreAtlas* node
// (MATCH (n) WHERE any(l IN labels(n) WHERE l STARTS WITH 'MitreAtlas') DETACH DELETE n).
// The outputs may differ only where the ATLAS-only exposure is concerned (it has a
// technique link in the first run and none in the second, and an engine that skips
// ATLAS reads both the same way). The mixed exposure must come out identical.
//
// Contents:
//   - c-api (crown jewel, entry) and c-db in one boundary, joined by a data flow;
//   - exp-atlas-only: EXPLOITED_BY an ATLAS technique only;
//   - exp-mixed: EXPLOITED_BY an ATT&CK technique and an ATLAS technique;
//   - ctl-guard supports c-api with
//       cm-atlas  (RESPONDS_WITH an ATLAS mitigation; MITIGATES, DETECTS and ISOLATES
//                  the ATLAS technique), and
//       cm-attack (RESPONDS_WITH an ATT&CK mitigation that defends the ATT&CK technique);
//   - the ATLAS technique's tactic (with matrix_order) and a crosswalk edge to the
//     ATT&CK technique.
// Ids, names and the crosswalk are synthetic: T9xxx / M9xxx / AML.T9xxx / AML.M9xxx
// are not real ATT&CK or ATLAS ids. Statements are `;`-separated; loaders strip
// comment lines.

// ── Model skeleton ──────────────────────────────────────────────────────────
CREATE (m:Model {id: 'model-atlas-smoke', name: 'ATLAS Smoke Fixture'});

MATCH (m:Model {id: 'model-atlas-smoke'})
CREATE (m)-[:CONTAINS]->(:SecurityBoundary {id: 'b-app', name: 'Application Zone'});

MATCH (b:SecurityBoundary {id: 'b-app'})
CREATE (:Component {id: 'c-api', name: 'Model Serving API', crownJewel: true, entryPoint: true})-[:BELONGS_TO]->(b);

MATCH (b:SecurityBoundary {id: 'b-app'})
CREATE (:Component {id: 'c-db', name: 'Feature Store'})-[:BELONGS_TO]->(b);

MATCH (a:Component {id: 'c-api'}), (d:Component {id: 'c-db'})
CREATE (a)-[:FLOWS]->(:DataFlow {id: 'f-api-db', name: 'API to Feature Store'})-[:FLOWS]->(d);

// ── MITRE ATT&CK (synthetic ids) ────────────────────────────────────────────
CREATE (:MitreAttackTactic {id: 'tac-ia', attack_id: 'TA0001', name: 'Initial Access', matrix_order: 2});
CREATE (:MitreAttackTechnique {id: 'tech-t9101', attack_id: 'T9101', name: 'Exploit Serving Endpoint', description: 'Adversaries may exploit an exposed serving endpoint.'});
MATCH (tac:MitreAttackTactic {id: 'tac-ia'}), (t:MitreAttackTechnique {attack_id: 'T9101'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
CREATE (:MitreAttackMitigation {id: 'mit-m9101', attack_id: 'M9101', name: 'Endpoint Hardening'});
MATCH (mit:MitreAttackMitigation {attack_id: 'M9101'}), (t:MitreAttackTechnique {attack_id: 'T9101'})
CREATE (mit)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(t);

// ── MITRE ATLAS (synthetic ids) ─────────────────────────────────────────────
CREATE (:MitreAtlasTactic {id: 'atac-ex', atlas_id: 'AML.TA9001', name: 'AI Model Access', matrix_order: 4});
CREATE (:MitreAtlasTechnique {id: 'atlas-t9101', atlas_id: 'AML.T9101', name: 'Prompt Injection', description: 'Adversaries may craft inputs that override a model instructions.'});
MATCH (tac:MitreAtlasTactic {id: 'atac-ex'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(t);
CREATE (:MitreAtlasMitigation {id: 'atlas-m9101', atlas_id: 'AML.M9101', name: 'Input Filtering'});
MATCH (mit:MitreAtlasMitigation {atlas_id: 'AML.M9101'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (mit)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(t);
MATCH (a:MitreAtlasTechnique {atlas_id: 'AML.T9101'}), (t:MitreAttackTechnique {attack_id: 'T9101'})
CREATE (a)-[:ATLAS_TECHNIQUE_REFERENCES {cited_attack_id: 'T9101'}]->(t);

// ── Exposures on c-api ──────────────────────────────────────────────────────
MATCH (c:Component {id: 'c-api'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-atlas-only', name: 'Prompt Injection Surface', score: 8, attackVector: 'NETWORK', createdBy: 'SYSTEM'});
MATCH (e:Exposure {id: 'exp-atlas-only'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (e)-[:EXPLOITED_BY {justification: 'model input reaches the instructions'}]->(t);

MATCH (c:Component {id: 'c-api'})
CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'exp-mixed', name: 'Exposed Inference Endpoint', score: 7, attackVector: 'NETWORK', createdBy: 'SYSTEM'});
MATCH (e:Exposure {id: 'exp-mixed'}), (t:MitreAttackTechnique {attack_id: 'T9101'})
CREATE (e)-[:EXPLOITED_BY]->(t);
MATCH (e:Exposure {id: 'exp-mixed'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (e)-[:EXPLOITED_BY]->(t);

// ── Control and countermeasures ─────────────────────────────────────────────
CREATE (:Control {id: 'ctl-guard', name: 'Inference Guard'});
MATCH (ctrl:Control {id: 'ctl-guard'}), (c:Component {id: 'c-api'})
CREATE (ctrl)-[:SUPPORTS]->(c);

MATCH (ctrl:Control {id: 'ctl-guard'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-atlas', name: 'Prompt Filtering', score: 6, createdBy: 'SYSTEM'});
MATCH (cm:Countermeasure {id: 'cm-atlas'}), (mit:MitreAtlasMitigation {atlas_id: 'AML.M9101'})
CREATE (cm)-[:RESPONDS_WITH]->(mit);
MATCH (cm:Countermeasure {id: 'cm-atlas'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (cm)-[:COUNTERMEASURE_MITIGATES]->(t);
MATCH (cm:Countermeasure {id: 'cm-atlas'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (cm)-[:COUNTERMEASURE_DETECTS]->(t);
MATCH (cm:Countermeasure {id: 'cm-atlas'}), (t:MitreAtlasTechnique {atlas_id: 'AML.T9101'})
CREATE (cm)-[:COUNTERMEASURE_ISOLATES]->(t);

MATCH (ctrl:Control {id: 'ctl-guard'})
CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'cm-attack', name: 'Endpoint Hardening Policy', score: 6, createdBy: 'SYSTEM'});
MATCH (cm:Countermeasure {id: 'cm-attack'}), (mit:MitreAttackMitigation {attack_id: 'M9101'})
CREATE (cm)-[:RESPONDS_WITH]->(mit)
