# ADR-012: MITRE ATLAS as a third framework

**Status:** Accepted
**Date:** 2026-10-07

**Related:** [ADR-001: Graph-native data model](001-graph-native-data-model.md), [ADR-008: Embedding-based MITRE technique matching](008-embedding-technique-matching.md)

## Context

The platform carries MITRE ATT&CK (pinned at v19.2) and D3FEND. Every technique reference — an exposure's
`EXPLOITED_BY` edge, a countermeasure's verb edges, the technique picker, coverage and threat-report modules,
authoring validators — assumes an ATT&CK node keyed by `attack_id` matching `^T\d{4}(\.\d{3})?$`. ATT&CK has no
technique for prompt injection, AI tool invocation, context poisoning or tool poisoning; MITRE ATLAS does.

| Fact (ATLAS v2026.09, verified 2026-10-07) | Value |
|---|---|
| Source asset | `stix-atlas.json` from the `v2026.09` release of `mitre-atlas/atlas-data` |
| Techniques + sub-techniques / tactics / mitigations / case studies | 208 (120 + 88) / 16 / 40 / 73 (AML.CS0000–AML.CS0072) |
| Objects with an ATT&CK external reference (`source_name: mitre-attack`) | 44 techniques (39 distinct targets), 14 of 16 tactics, 4 of 40 mitigations |
| Core agent techniques with an ATT&CK reference | 0 |
| Revoked or deprecated ATLAS techniques | 0 |
| ATT&CK references whose target ATT&CK v19 revoked | 1: AML.T0073 Impersonation → T1656 (successor T1684.001) |
| Tactic names shared with ATT&CK v19.2 | 13 of 16. ATLAS-only: AI Model Access, AI Attack Adaptation, Defense Evasion (AML.TA0007; ATT&CK renamed TA0005 to Stealth) |
| Licence | Apache-2.0 ("Copyright 2021-2026 MITRE") |

ATLAS ids match `^AML\.T\d{4}(\.\d{3})?$` (techniques), `^AML\.M\d{4}$` (mitigations), `^AML\.TA\d{4}$` (tactics),
`^AML\.CS\d{4}$` (case studies; verified against v2026.09: 73, AML.CS0000–AML.CS0072). The prefixes are disjoint from ATT&CK's, so a bare id's framework is decidable from
its prefix. The numeric parts are **not** disjoint: AML.TA0007 Defense Evasion vs TA0007 Discovery, AML.TA0008
Discovery vs TA0008 Lateral Movement.

## Decision

### ATLAS is a third framework

ATLAS is loaded by the `mitre-frameworks` data module, completely, in its own data file(s), as ATT&CK (with campaigns,
groups and software) and D3FEND are:

- **Own labels:** `MitreAtlasTechnique` (techniques and sub-techniques), `MitreAtlasTactic`, `MitreAtlasMitigation`,
  `MitreAtlasCaseStudy`. An ATLAS node never carries an ATT&CK label, and no label is shared across frameworks.
- **Own key** `atlas_id` (symmetric with `attack_id`). An ATLAS node never carries `attack_id`.
- **Own version:** the manifest's `corpusVersions` gains `atlas`; the module version moves 1.0.0 → 1.1.0, because an
  upgrade to the same version does not take new data.
- **Own ingest and cleanup:** `ingest_atlas`, and a dev-only `cleanup_atlas` that mirrors `cleanup_attack`. No
  install path runs `DETACH DELETE` over MITRE labels: on a live database it would delete every platform edge that
  points at them.
- **ATT&CK and D3FEND data files untouched:** the committed ATT&CK and D3FEND data files stay byte-for-byte
  unchanged in this change. ATLAS files are named so that every ingest path, which replays data files in file-name
  order, loads ATLAS nodes before the ATLAS relationships, crosswalk edges and embeddings that reference them. ATLAS
  data ships in its own files, which sort after the ATT&CK and D3FEND files, so the existing files need no rewrite.
  The shared exporter does change for every framework: it sorts nodes and relationships, fails instead of falling
  back to a `name` key, and excludes the `MitreAttackMatrix` node and its `MITRE_MATRIX_INCLUDES_TACTIC` edges. The
  next full rebuild therefore regenerates the ATT&CK and D3FEND files, with a reordered relationship file that drops
  the 15 matrix statements the committed one still carries (they are inert: no matrix node is loaded).

### Source bundle and loader

- Ingest `stix-atlas.json` attached to the pinned `mitre-atlas/atlas-data` GitHub release, pinned by tag and a
  committed SHA-256 constant verified before parsing; parsed with the standard-library `json` module, no new
  dependency. The ATT&CK bundle (`enterprise-attack-19.2.json`, read today without a checksum) gains the same check.
- **Never** `stix-atlas-attack-enterprise.json`: it embeds its own ATT&CK, which would overwrite the pinned one.
- Not `dist/stix-atlas.json` from `mitre-atlas/atlas-navigator-data`'s default branch: on 2026-10-03 it was stale
  (2026-04-30, 170 techniques, no AML.T0132).
- A **dedicated loader keyed only on `source_name == 'mitre-atlas'`**. Reusing the ATT&CK parser is wrong: the 62
  ATLAS objects with a `mitre-attack` id would merge onto ATT&CK nodes.

### Relationships

- **Intra-ATLAS structure reuses ATT&CK's type names:** `SUBTECHNIQUE_OF`, `TACTIC_INCLUDES_TECHNIQUE`,
  `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`; case study → technique reuses `CAMPAIGN_USES_TECHNIQUE`, the ATT&CK shape
  for a documented incident using a technique. Both endpoints carry ATLAS labels.
- **Platform edges reuse their types:** `EXPLOITED_BY` and the countermeasure verb types may target ATLAS techniques;
  `RESPONDS_WITH` may target ATLAS mitigations. This is required: mitigation-chain consumers credit a control through
  `RESPONDS_WITH → mitigation → technique`.
- **Consumers name their labels.** A label-constrained ATT&CK query stays ATT&CK-only by construction. A consumer
  that needs both frameworks names both labels on the technique; on the mitigation leg it leaves the mitigation node
  unlabelled and lets the reused relationship types constrain it, rather than writing a label disjunction in the
  pattern. Unconstrained patterns (`-[:EXPLOITED_BY]->(t)`) start returning ATLAS nodes and are audited.

### Crosswalk edge layer

- A separate edge layer links an ATLAS technique to the ATT&CK technique its `mitre-attack` reference names
  (`ATLAS_TECHNIQUE_REFERENCES`). Techniques only: tactic and mitigation references are not linked.
- **Resolved at build time** against the pinned ATT&CK bundle: a revoked target is followed through the bundle's
  revoked-by relationships (a revocation map, about ten lines), never by name. A one-entry override table records the
  known case, AML.T0073 → T1656 → T1684.001; the build prints every resolution and fails on a target it cannot
  resolve. The crosswalk edge records the ATT&CK id the ATLAS object cites, which differs from the edge's target only
  where the target was revoked (one case in v2026.09).
- **Semantics.** The crosswalk is an authoring aid: an exposure or countermeasure verb that cites a crosswalked ATLAS
  technique must also cite the ATT&CK target, which the authoring lint checks against this edge. Any engine that
  compares an expected technique set with an observed one and traverses the edge does so on **both sides or
  neither**; a one-sided expansion can report an expectation as met when it is not.

### Tactics and the matrix

- Tactic grouping keys on the **full tactic id** end to end, never on the name alone or a prefix-stripped id. JSON
  contracts that emit tactics emit `{id, name, order}`; the fixture is a tactic name shared by both frameworks (13 are).
- ATLAS is presented as **its own matrix**, ordered by `matrix_order` stored on ATLAS tactics from the ATLAS matrix's
  ordered tactic list, as for ATT&CK. The ATLAS matrix states its denominator rules (many of the 208 techniques
  concern training-time or model-internal attacks).

### Exporter and build checks

- The exporter's explicit label-to-key map gains the ATLAS labels. It raises on a node with zero or more than one
  mapped label, on a cross-framework `SUBTECHNIQUE_OF`, `TACTIC_INCLUDES_TECHNIQUE`,
  `MITIGATION_DEFENDS_AGAINST_TECHNIQUE` or `CAMPAIGN_USES_TECHNIQUE`, on any edge between ATLAS and another
  framework other than the crosswalk, and on an endpoint it cannot identify — instead of defaulting to `attack_id`
  or skipping silently. Relationship export is ordered deterministically.
- The module's Memgraph test script pins the ATLAS node and edge counts of the pinned release.
- No new uniqueness constraint.

### Fail-loud references

An unresolved reference — an id whose prefix names a label under which no node has that id — is an error.

| Prefix | Resolves to |
|---|---|
| `T…` | `MitreAttackTechnique.attack_id` |
| `M…` | `MitreAttackMitigation.attack_id` |
| `AML.T…` | `MitreAtlasTechnique.atlas_id` |
| `AML.M…` | `MitreAtlasMitigation.atlas_id` |
| anything else | error (no default label) |

- **Writer pre-pass:** before writing, the instantiation writer resolves every MITRE reference in one query
  (`UNWIND` + `OPTIONAL MATCH`) and fails with the unresolved ids. An object-form target (`{label, property, value}`)
  is accepted only for the closed set of MITRE label/key pairs (ATT&CK, ATLAS, D3FEND) and fails on anything else.
  Counting unwritten edges is not a substitute: the writer legitimately writes no edge in some cases.
- **Content builds:** any content build consuming MITRE references fails on an unresolved one.
- **No install-time gate.** Module manifests can declare dependencies, but the installers do not enforce version
  constraints. The defence against data-version skew is release order — the platform release that carries ATLAS ships
  before any content that references it — plus the two checks above.
- Technique id lists stored as strings (for example on knowledge-graph threats) stay flat; the framework is read from
  the prefix.

> **Amendment (2026-10-07):** the writer no longer fails the write on an unresolved reference.
>
> - **What the writer does.** The pre-pass still resolves every reference of the save's findings in one statement
>   before any edge is written. The allowed label/key pairs per field are a closed set. `exploitedBy` and the
>   countermeasure verb fields accept ATT&CK or ATLAS techniques. `respondsWith` accepts ATT&CK or ATLAS
>   mitigations, D3FEND techniques (`D3-…` → `MitreDefendTechnique.d3fendId`) or a `RegulatoryRequirement.id`.
>   A resolved reference is linked as before. Two kinds of reference are not written: a MITRE reference that does
>   not resolve, and a reference outside the set. Each is logged at error level, recorded on its finding as
>   `unresolvedReferences` (the id, or `Label.key=value` for a disallowed pair) and returned in
>   `SetInstantiationAttributesResult.unresolvedReferences`. The save goes ahead: the attributes and every other link
>   are written, and a later save in which the references resolve clears the marker.
> - **Requirement references.** An unresolved `RegulatoryRequirement` reference only logs a warning. A compliance
>   pack may load its requirement nodes after the classes that cite them.
> - **Cypher identifiers.** The labels and keys in the writer's Cypher come only from the writer's own table, never
>   from module data.
> - **Why the save does not fail.** A save is two transactions: the attribute write commits before the findings and
>   their links are written. Failing the second would leave the new attributes next to stale findings. It would also
>   reject the user's attribute edit over class content they cannot fix. The real problem was the silent miss, and
>   the marker on the finding now makes it visible.
> - **Content builds.** The content-build guarantee now comes from a CI check. It resolves every MITRE reference in
>   the shipped modules' policies against the pinned data (see the
>   [`mitre-frameworks` README](../../../modules/mitre-frameworks/README.md)).

### GraphQL API, indexes and picker

- MITRE node types are read-only: `@mutation(operations: [])` on every MITRE type removes the top-level mutations,
  and every relationship field that targets a MITRE type (`exploitedBy`, `mitigates`, `defendedTechniques`, the new
  ATLAS fields) gets `nestedOperations: [CONNECT, DISCONNECT]`, because nested create, update and delete would
  otherwise write the shared MITRE nodes. A test asserts that nested create, update and delete are rejected.
- **All eight countermeasure verbs.** The writer creates `COUNTERMEASURE_MITIGATES`, `_PROTECTS_AGAINST`, `_DETECTS`,
  `_ISOLATES`, `_DECEIVES`, `_EVICTS`, `_RESTORES` and `_RESPONDS_TO`, each with a `justification` property; the API
  exposes only the first four (`mitigates`, `protectsAgainst`, `detects`, `isolates`) and no edge property. Clients
  that write through the API need fields with a relationship-properties type for all eight, or a Cypher resolver.
- ATLAS links are exposed as **typed sibling fields** (for example `exploitedByAtlas`, `mitigatesAtlas`,
  `respondsWithAtlas`) for every verb, next to the unchanged ATT&CK fields, as `Countermeasure.mitigations` sits beside
  `Countermeasure.defendedTechniques`. No interface-typed `@relationship` fields: the deployed `@neo4j/graphql` returns
  phantom targets on them.
- ATT&CK and ATLAS technique and mitigation key indexes join the startup index list (`REQUIRED_INDEXES`) on both graph
  engines; the picker's lazy, Memgraph-only index creation is deleted.
- The technique picker gains ATLAS technique and mitigation kinds. It **skips a kind whose total is 0**, with a log
  line; the rest of its vector precheck stays global.
- ATLAS techniques and mitigations get precomputed embeddings with the same model and text format as ATT&CK; tactics
  and case studies are not embedded, as ATT&CK tactics and campaigns are not.

### OWASP in the knowledge graph

An OWASP entry is a `KgCorpusEntry` with `kind: 'owasp'` (the kind is a free string) and an edition-qualified id
(`LLM01:2026`). Standards matching is a stub today; any future standards matcher must filter by kind. A threat links to
it by a **distinct classification edge** (**proposed** `KG_CLASSIFIED_AS`), never `KG_DERIVED_FROM`, which stays the
provenance edge.

### Licence

ATLAS is Apache-2.0, compatible with the AGPL-3.0 platform. `mitre-frameworks` gains a `NOTICE` crediting MITRE ATLAS
(Apache-2.0), MITRE ATT&CK (its licence, which asks every copy to reproduce MITRE's copyright designation and the
licence) and MITRE D3FEND (MIT); every embedded copy of the MITRE data carries it.

## Consequences

- Consumers that need both frameworks name both labels; ATT&CK-intrinsic consumers (the D3FEND-artifact coverage tier,
  heuristics keyed on ATT&CK tactic ids) stay ATT&CK-only, document it and count what they skip.
- ATLAS-mapped exposures are visible to the API and survive writes and supersedes before every engine renders them;
  engines adopt ATLAS views at their own pace.
- Every embedded copy of the MITRE data and of the GraphQL schema is regenerated.

## Rejected options

| Option | Why rejected |
|---|---|
| ATT&CK only, with declared non-mappings | Empty where agent threats matter; invites forced mappings |
| ATLAS nodes under the ATT&CK labels | Corrupts the tactic matrix, coverage totals, the picker, revocation tooling and link builders |
| A shared supertype label on ATT&CK and ATLAS techniques | Touches every ATT&CK node and every label-prefix heuristic, needs ingest-order guarantees, and saves only naming two labels |
| A separate ATLAS data module | Two deployment units for one body of public reference data |
| Crosswalk stored as `attack_id` on the ATLAS node | ATLAS nodes would answer ATT&CK lookups |
| ATLAS-prefixed intra-ATLAS relationship types | More query variants; the exporter already rejects cross-framework edges |
| OWASP as a dedicated taxonomy label | A new label for every KG reader; a corpus kind plus a distinct edge separates classification from provenance |
