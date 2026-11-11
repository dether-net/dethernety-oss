---
title: 'Threat Model Concepts'
description: 'Components, boundaries, data flows, classes, attributes, and quality scoring'
category: 'documentation'
position: 5
navigation: true
tags: ['dethereal', 'concepts', 'components', 'boundaries', 'data-flows', 'quality']
---

# Threat Model Concepts

A threat model is a structured representation of your system that captures what components exist, how they communicate, what data they handle, and what security controls protect them. This page explains the building blocks.

---

## Methodology

Dethereal builds a **data flow diagram (DFD)** model of your system — components, trust boundaries, data flows and the data they carry — and describes how each element is secured. It does not judge threats itself. Threats come from the platform's analysis: after you push the model and run an analysis, the policies of the installed modules raise **exposures** against your elements and attach MITRE ATT&CK techniques to them (see [Review and Analysis](REVIEW_AND_ANALYSIS.md#understanding-platform-analysis)).

The underlying data model is methodology-agnostic: which threats are found depends on the analysis modules installed on the platform.

---

## Model Scope

Before modeling the system you declare **scope** — the framing that tells analysis what this model is for and what to hold constant. Scope is set at scope-definition time (e.g. via `/dethereal:create`), stored on the model itself, and round-trips through `.dethereal/scope.json` on sync:

| Field | Meaning |
|-------|---------|
| **Depth** | How deep the model reasons: `architecture`, `design`, or `implementation`. |
| **Modeling intent** | Why the model exists: `initial`, `security_review`, `compliance`, or `incident_response`. |
| **Compliance drivers** | Regulatory/standards obligations in scope (e.g. PCI-DSS, HIPAA) — these drive which compliance prompts appear during enrichment. |
| **Exclusions** | What you deliberately put out of scope, so analysis doesn't fault their absence. |
| **Trust assumptions** | What the model treats as trusted (e.g. "cloud control plane is trusted"). |

Scope is **seed context for analysis**, not a score — it shapes which findings matter rather than computing risk directly. Crown jewels are also declared at scope-definition time (see [Crown Jewels](#crown-jewels)).

---

## Components

Components are the things in your system. Every component has a **type** that determines its behavior in security analysis:

| Type | What It Represents | Examples |
|------|-------------------|---------|
| **PROCESS** | Running software that processes data | API servers, web applications, workers, microservices |
| **STORE** | Anything that persists data | Databases, caches, file storage, message queues |
| **EXTERNAL_ENTITY** | People or systems outside your control | End users, third-party APIs, OAuth providers, a cloud provider's managed services your system consumes (key management, a secret manager) |

**Why types matter:** The analysis engine treats each type differently. A STORE holding credentials has different threat implications than a PROCESS routing traffic. Components must be classified for this analysis to work — this is why Gate 3's criterion C1 requires every non-external component to be classified.

---

## Trust Boundaries

Trust boundaries define security zones in your architecture. They represent where the rules change — different network segments, different authentication requirements, different access controls.

### Why Hierarchy Matters

A **flat** model loses security context:

```
defaultBoundary/
├── User (EXTERNAL_ENTITY)
├── Web Server (PROCESS)
├── API Server (PROCESS)
└── Database (STORE)
```

A **hierarchical** model captures trust transitions:

```
defaultBoundary/
├── Internet Zone/
│   └── User (EXTERNAL_ENTITY)
├── DMZ/
│   └── Web Server (PROCESS)
└── Internal Network/
    ├── Application Tier/
    │   └── API Server (PROCESS)
    └── Data Tier/
        └── Database (STORE)
```

The analysis engine identifies threats at **boundary crossings** — data flows that move between trust zones. A flat model has no boundary crossings, so the analysis has nothing to work with.

### Boundary Enforcement Attributes

Each boundary can have enforcement attributes that describe how it controls traffic:

| Attribute | Values | What It Means |
|-----------|--------|---------------|
| `implicit_deny_enabled` | true / false | Boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Boundary allows unrestricted inbound |
| `egress_filtering` | deny_all / allow_list / allow_all | Outbound traffic policy |

These attributes feed into the attack surface analysis — a boundary with `implicit_deny_enabled: true` and `egress_filtering: deny_all` provides stronger isolation than one with `allow_any_inbound: true`.

### Trust Zones, Planes, Domains, and Conduits

Beyond enforcement posture, each boundary can carry **zoning** — your declared segmentation intent. Zoning is stored on the boundary in `structure.json` and round-trips to the platform:

| Field | What It Captures |
|-------|-----------------|
| `zone` | The **trust zone** — the exposure tier the boundary sits on: *who can reach it*. One of `UNTRUSTED`, `PUBLIC`, `EXPOSED`, `INTERNAL`, `RESTRICTED`, or `VENDOR`. |
| `planes` | The boundary's operational **role**: `WORKLOAD`, `MANAGEMENT`, or both. |
| `domains` | Free-text business-function **tags** (e.g. `payments`, `identity`). |
| `conduits` | **Approved channels** — directional peer boundaries this one is *meant* to talk to, each with an optional justification. |

**A trust zone inherits down.** A boundary with no zone of its own takes the zone of its nearest declaring ancestor; if nothing up the chain declares one, it falls back to the default `INTERNAL` (and is flagged). Set a zone explicitly wherever the trust level genuinely changes — especially when a child is *stricter* than its parent (a `RESTRICTED` store inside an `INTERNAL` tier), since inheritance would otherwise understate it.

**Structural containers abstain — zone the leaves, not the wrapper.** A boundary that mainly *nests* other boundaries (a VPC, a Kubernetes cluster, a cloud account) usually spans several tiers at once, so no single zone is correct for it. Leave it unset and zone the leaf boundaries inside; the review shows the container's span as a display roll-up rather than forcing one zone onto the whole subtree.

**Domains and planes are tags, not structure.** Use them to describe *what* a boundary is for and *how* it operates, separate from *who can reach it*. Model identity, compute-node, location, and business grouping as `domains`/`planes` tags rather than as zone-bearing boundaries.

**Conduits are approved crossings.** A conduit records that a boundary is *supposed* to communicate with a peer, in a chosen direction, with a reason. It is declared design intent — the platform records it but does **not** verify or enforce it. Whether the real flows match your declared conduits is the job of security analysis, which reads your zoning as its baseline.

Zoning is authored two ways that write the same fields: the guided workflow ratifies it step by step (see [Guided Workflow](GUIDED_WORKFLOW.md)), and the platform GUI edits it directly. For the complete how-to — inheritance rules, the Zoning overview, worked examples — see the platform guide [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md).

---

## Data Flows

Data flows are directed connections between components. They represent who talks to whom, using what protocol.

```
API Server → PostgreSQL: SQL queries (TLS 1.3)
End Users → Web Server: HTTPS requests
```

### Cross-Boundary Flows

When a data flow crosses a trust boundary (source and target are in different boundaries), it becomes high-priority for security analysis. Cross-boundary flows are where authentication, encryption, and access controls are most critical.

### Flow Attributes

Data flows can carry security attributes:

| Attribute | Purpose |
|-----------|---------|
| `required_credentials` | Which credentials are needed for this flow (drives lateral movement analysis) |
| `auth_failure_mode` | What happens when authentication fails: `deny`, `fallback`, `fail_open`; left empty when nobody knows |
| `encryption_in_transit` | TLS version, mTLS, none |

The `auth_failure_mode` is particularly important — a flow that appears authenticated but fails open under error conditions provides no security guarantee.

---

## Data Items

Data items classify the data your system handles. A data item is a type of data, modelled once and linked through `dataItemIds` to every element that handles it — components, data flows and boundaries — and it describes the sensitivity of the information.

### Sensitivity Levels

| Level | Examples |
|-------|---------|
| **Restricted** | Cardholder data, health records, credentials, session tokens, API keys, special-category personal data |
| **Confidential** | Personal data (PII), customer records, financial records |
| **Internal** | Internal operational data, metrics |
| **Public** | Public content, documentation |

A data item's data class sets a floor as well as its regulatory flags: a class named for credentials, tokens, secrets, passwords, private, signing, encryption or API keys, sessions, payments, cards or health data floors it at Restricted, and one named for personal, customer or PII data at Confidential (see [Data Item Classification](DISCOVERY_AND_ENRICHMENT.md#data-item-classification)).

### Regulatory Labels

Data items can carry **regulatory flags** — free-text compliance labels, kept separate from the sensitivity level. The recommended canonical set (matched **exactly and case-sensitively** by the platform's compliance queries, so spelling and case matter):

| Label | Framework | Sensitivity floor |
|-------|-----------|-------------------|
| `PCI cardholder` | PCI-DSS | Restricted |
| `PHI` | HIPAA | Restricted |
| `GDPR personal` | GDPR | Confidential (special-category data is Restricted) |
| `PII` | General | Confidential |
| `SOX financial` | SOX | Confidential |
| `CCPA personal` | CCPA | Confidential |

A data item may carry several flags; its sensitivity is the highest applicable floor. This set is the [single source of truth in the architecture docs](../../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) — it's extensible, but emit the canonical casing so scope queries match. Your compliance drivers (set during scope definition) determine which regulatory prompts appear during enrichment.

### Origin

**Origin** records who can write a data item's content (`origin` in `data-items.json`). From most to least trusted:

| Origin | Meaning | Untrusted |
|--------|---------|-----------|
| `authenticated_first_party` | Written only by the operator's own authenticated users or systems | |
| `curated_internal` | Internal content that passed a review or curation step | |
| `agent_relayed` | Produced or forwarded by another agent; at most this trusted | |
| `model_generated` | Written by a model and later read as input; at most this trusted | |
| `third_party` | Written by a known external party under an agreement | yes |
| `arbitrary_public` | Anyone can write it | yes |
| `not_assessed` | Answered as not established; treated as untrusted | yes |

Use the least-trusted source of what the item holds — one public source makes it `arbitrary_public`. Leave it absent when you don't know; absent is not the same as `not_assessed`. How the plugin asks for it is in [Origin and credential flag](DISCOVERY_AND_ENRICHMENT.md#origin-and-credential-flag).

### Credential Flag

**`is_credential`** records whether the data item is a credential — a password, token, key, secret, or certificate. It is `true`, `false`, or absent (unknown). When an item is bound to a credential-like data class and the flag is unanswered, enrichment proposes `true` for you to confirm; it never sets the flag on its own, and an answered `false` is kept. See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md#origin-and-credential-flag).

---

## Classes and Modules

### What Classes Are

Classes are predefined types from the platform's module system. When you classify a component as "Database" or "Web Application," you're assigning it a class that comes with:

- An attribute schema (which security properties are relevant)
- Schema default values, which describe the class rather than your system — the attribute stubs start every field empty, and enrichment may propose a default but writes one only if you accept it (see [Class Templates Drive the Questions](DISCOVERY_AND_ENRICHMENT.md#class-templates-drive-the-questions))
- Guidance for enrichment

### How Classification Works

Classification happens in two passes:

1. **Deterministic (Pass 1):** The plugin queries the platform for available classes and matches components by name and type. "PostgreSQL" matches "Database" with high confidence — no AI needed.

2. **LLM-assisted (Pass 2):** For ambiguous components, the AI proposes classes based on boundary context and peer components.

You always confirm classifications before they're written. The plugin never auto-classifies without showing you what it's doing.

For more on the classification process, see the [classify command](COMMAND_REFERENCE.md#detherealclassify) or the platform's [Component Configuration Guide](../COMPONENT_CONFIGURATION_GUIDE.md).

---

## Security Attributes

### The 6 Key Component Attributes

A floor of six security properties that enrichment captures on every in-scope component, whatever its class template happens to cover. Four have a component attribute key, logging has no scored key, and encryption in transit is recorded on both the data flow and the component. The **attribute key** column is what you must write — the scorer reads these literal names:

| # | Concept | Attribute key | Written on | Value the scorer accepts |
|---|---------|---------------|------------|--------------------------|
| 1 | Authentication | `authentication_type` | component | String — e.g. `oauth2`, `mtls`, `sso`. `none` does not count. `basic`/`digest` count only when `encryption_in_transit` is a non-deprecated string |
| 2 | Encryption in transit | `encryption_in_transit` | **data flow** (and component where meaningful) | String — e.g. `TLS 1.3`. Rejected: `none`, `sslv3`, `ssl v3`, `tls 1.0`, `tls1.0` |
| 3 | Encryption at rest | `encryption_at_rest` | component | String — e.g. `AES-256`. Rejected: `none`, `des`, `3des`, `triple-des`, `rc4` |
| 4 | Logging | *(no scored key)* | — | Captured by the class template; nothing reads a floor-level key for this one |
| 5 | Access control | `implicit_deny_enabled` | component (boundaries too, but only the component value is scored) | Boolean `true` |
| 6 | Log telemetry | `monitoring_tools` | component | Non-empty `string[]` after discarding `none`/`n/a`. Use `[]`, never `["None"]`. Components with no monitoring tools are detection blind spots |

**Write these key names literally.** `control_coverage_rate` (10 points of the quality score) and the attack-surface report's encryption and authentication coverage read these exact keys and no others — a semantically equivalent name that a class template happens to use (`transit_encryption_enforced`, `tls_enabled`, …) does not satisfy the floor. Types are strict too: a boolean `true` for `encryption_at_rest` scores as absent, because that key wants the concrete algorithm string.

Note that `encryption_in_transit` is written in two places. On each **data flow** (the flow's attribute file under `attributes/dataFlows/`), Gate 3's criterion C8 requires it on every flow with a Tier 1–2 end, and the attack-surface report reads it for each cross-boundary flow. On the **component** itself, from the TLS settings of its own listener, C8 requires it on every Tier 1–2 component, and the quality score reads it there. The other four keys (`authentication_type`, `encryption_at_rest`, `implicit_deny_enabled`, `monitoring_tools`) are component attributes, stored in individual files under `attributes/components/`.

These attributes are a floor, not the whole enrichment job: the primary pass resolves every field declared by each element's assigned class template. See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md).

### Additional Attributes

- **`asset_criticality`** — high/medium/low, the business impact of compromise
- **`stores_credentials`** — true for STORE components that hold credential material
- **`credential_scope`** — which credential identifiers are stored (drives lateral movement analysis)

---

## Crown Jewels

Crown jewels are your most valuable assets — the data or capabilities an attacker would target. You name them during scope definition:

```
Crown jewels: ["Cardholder data", "User PII", "API authentication keys"]
```

During classification, these free-text names are fuzzy-matched to actual components and tagged with `crownJewel: true` on the component in `structure.json` (the first-class `Component.crownJewel` field, synced to the platform). Crown-jewel marks are tracked **per component**; marking a data item, boundary, or flow stays local. Besides this AI classify path, crown jewels can also be toggled per component **directly in the GUI** (component settings → General tab → crown button) — both write the same `Component.crownJewel` field. Crown jewels receive priority treatment:

- **Component tiers** — a component holding a crown jewel is in Tier 2 (Tier 1 if it is internet-facing), so Gate 3 holds it to its attribute floors; see [Component Tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers)
- **Enrichment order** — crown jewels and their mapped elements head the enrichment worklist and are always in the priority set
- **Control coverage** — the attack surface analysis gives crown jewels a row of their own in its formal control coverage, beside the tiers

---

## Quality Scoring

The quality score (0-100) measures how completely your model captures the system. It is **not** a security rating — a model with 95/100 quality could describe a system with critical vulnerabilities. The score reflects modeling completeness, not security posture.

The score is computed from 7 weighted factors: component classification (25), attribute completion (20), boundary hierarchy (15), data flow coverage (15), data classification (10), control coverage (10), and credential coverage (5).

Score labels: **Starting** (0-39), **In Progress** (40-69), **Good** (70-89), **Comprehensive** (90-100). The score is a label: it gates nothing, and analysis readiness comes from the gates below.

### The 3 Quality Gates

Three progressive gates enforce increasing strictness:

- **Gate 1 (Creation, advisory)** — flags structural issues without blocking: missing classifications, unnamed flows, single-child boundaries, components in no declared or inherited zone
- **Gate 2 (Sync, blocking)** — must pass before `/dethereal:sync push`: manifest completeness (including module references the server can derive; see [Gate 2 Pre-Flight](SYNC_AND_VERSION_CONTROL.md#gate-2-pre-flight)), structure validity, reference integrity
- **Gate 3 (Analysis, blocking)** — must pass for meaningful analysis. Its nine criteria:
  - **C1** — every non-external component is classified
  - **C2** — ≥ 80% of template fields answered on Tier 1–2
  - **C3** — every cross-boundary flow is reviewed
  - **C4** — sensitive flows carry a classified data item with a sensitivity
  - **C5** — at least one cross-boundary flow
  - **C6** — crown jewels resolve through the persisted map
  - **C7** — sensitivity at or above its floor
  - **C8** — the literal six-attribute floor on Tier 1–2
  - **C9** — no dangling `credential_scope` id

For the full factor breakdown, what each criterion checks (and what Tier 1–2 means), and example output, see [Review and Analysis](REVIEW_AND_ANALYSIS.md#quality-review-detherealreview).

---

## The Split-File Directory Format

Threat models are stored as a directory of JSON files:

```
threat-models/my-system/
├── manifest.json          # Model metadata
├── structure.json         # Boundary and component hierarchy
├── dataflows.json         # Data flow connections
├── data-items.json        # Data classifications
├── README.md              # Auto-generated summary
├── .dethereal/            # Workflow metadata
│   ├── state.json         # Current workflow state (commit)
│   ├── scope.json         # Scope definition
│   ├── quality.json       # Quality score cache
│   ├── discovery.json     # Discovery provenance (commit)
│   ├── sync.json          # Sync metadata (this machine only; the server keeps it out of git)
│   ├── relay/             # Enrichment relay files, one per enrichment run (this machine only; the server keeps them out of git)
│   ├── settlement-baseline.json  # Settlement on only: your registered values (this machine only; kept out of git)
│   ├── settlements.json   # Settlement on only: log of your registrations (this machine only; kept out of git)
│   ├── control-audit.log  # Append-only control-decision ledger (this machine only; gitignore)
│   ├── class-cache/       # Cached class templates and guides
│   │   └── {class-id}.json
│   └── template-fields/   # Per-element template field manifests
│       └── {element-id}.json
├── attributes/            # Per-element security attributes
│   ├── boundaries/
│   │   └── {id}.json
│   ├── components/
│   │   └── {id}.json
│   ├── dataFlows/
│   │   └── {id}.json
│   └── dataItems/
│       └── {id}.json
└── controls/              # Per-Control library files (one per referenced Control)
    └── {id}.json
```

### manifest.json

Model metadata: name, description, and which platform modules it uses.

You never fill in `modules` yourself, and neither does the workflow. A new model starts with `modules: []`. The MCP server derives the list from the entries already there, the modules you selected for the model (`activeModules` in `.dethereal/scope.json`), and the modules of the classes the model uses. It derives the list in memory when it checks the quality gates, and a push writes it to the file. If Gate 2 reports a module gap, apply the remedy it shows. Editing `modules` by hand doesn't fix it.

### structure.json

The hierarchy of trust boundaries and components, with visual coordinates for diagram rendering. This is where the boundary tree lives.

### dataflows.json

An array of directed connections between components. Each flow has a source, target, protocol, and description.

### data-items.json

An array of data classification items. Captures what sensitive data the system handles; components, data flows and boundaries link to the items through `dataItemIds`.

### attributes/

Per-element attribute files containing security properties. Each element type has its own subdirectory. Attribute files are created during classification (as stubs) and populated during enrichment.

### controls/

Per-Control files for the control library. Each Control referenced by the model (via `controls[]` on a component, boundary, flow, or data item in `structure.json` / `dataflows.json` / `data-items.json`) gets a file here. See [Controls and the Control Library](#controls-and-the-control-library) below.

### ID Handling

When you create a model locally, elements get **temporary reference IDs**: descriptive ids with a prefix (`b-`, `c-`, `f-`, `di-`) when a model is first built, or a UUID when you add an element with `/dethereal:add`. These link elements together (e.g., a data flow's source/target IDs reference components in structure.json).

After pushing to the platform, the server assigns **permanent IDs** that are written back to your local files. The original temporary IDs become obsolete.

---

## Metadata Directories

Two metadata directories track plugin state:

### `.dethernety/` (Project Root)

Plugin-level metadata shared across models:

- **`models.json`** — registry of all local models with names, paths, and timestamps
- **`discovery-cache.json`** — cached discovery results for multi-model projects (gitignore)
- **`decomposition-plan.json`** — multi-model decomposition plan (when modeling complex systems)

### `.dethereal/` (Per Model)

Per-model workflow metadata inside each model directory:

- **`state.json`** — current workflow state and completed states (commit — a Gate 3 waiver it records counts only on the machine that granted it)
- **`scope.json`** — scope definition (crown jewels, compliance drivers, etc.)
- **`quality.json`** — cached quality score (deleted on backward transitions)
- **`discovery.json`** — discovery provenance (commit — drift detection reads it)
- **`sync.json`** — sync metadata (this machine's own; the server keeps it out of git — see [What to Commit](SYNC_AND_VERSION_CONTROL.md#what-to-commit))
- **`relay/`** — the enrichment relay files, one per enrichment run: Step 8 of the guided workflow, or an enrichment the threat-modeler agent hands to the security-enricher (this machine's own; the server keeps them out of git). Nothing reads them once that enrichment is over; you may delete the folder by hand when no enrichment is running — see [One relay turn](GUIDED_WORKFLOW.md#one-relay-turn)
- **`settlement-baseline.json`**, **`settlements.json`** — written only with the server's [settlement](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch) switched on, which is off by default: the values you registered on this machine, and the log of those registrations (this machine's own; the server keeps them out of git)
- **`control-audit.log`** — append-only ledger of shared-ownership control decisions (gitignore — it stays on your machine). Records no attribute values, only tags that mean something on this machine; see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#what-to-commit) for an older log that may hold values
- **`class-cache/`** — class templates and configuration guides cached at classification time. This is what makes enrichment work offline, and it is the basis the attribute-completion factor is measured against. Delete it and the quality score silently falls back to counting attribute *files* instead of resolved *fields*; `generate_attribute_stubs` rebuilds it.
- **`template-fields/`** — one manifest per element, recording which fields its current class declared. When an element is reclassified, this is what lets the plugin drop the old class's unanswered fields while preserving values you already enriched.

---

## Controls and the Control Library

Controls are reusable security controls (e.g., "Database Encryption Package", "SOC Monitoring") that one or more model elements reference. They live in the platform's library and are mirrored locally as `controls/<id>.json` — one file per Control referenced by your model. References from elements live in `controls[]` arrays on components, boundaries, flows, and data items (`data-items.json`).

### Why Controls are separate from attributes

The 6 key security attributes (authentication, encryption in transit, etc.) describe each element's *intrinsic* posture. Controls describe *how* that posture is achieved — and the same Control can apply to many elements across many Models. Editing the control's configuration in one Model affects every other Model that uses it, which is why Controls have their own file per Control and a safety check on push (see [shared-ownership prompts](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts)).

### ControlClass and per-instance attributes

A Control is an instance of one or more **ControlClasses** (e.g., "Encryption at Rest", "Access Control"). Each `(Control, ControlClass)` pair has its own attribute payload describing how that instance is configured (algorithm, key rotation, audit retention, etc.).

```json
{
  "id": "ctrl-encryption-package",
  "name": "Database Encryption Package",
  "lifecycle": "brownfield",
  "classes": [
    {
      "classId": "class-encryption-at-rest",
      "attributes":         { "algorithm": "AES-256", "keyRotationDays": 30 },
      "platformAttributes": { "algorithm": "AES-128", "keyRotationDays": 90 }
    }
  ]
}
```

The `attributes` block is what the operator edits. The `platformAttributes` block is the raw server-side payload as of the last pull. The pair is how the plugin detects local edits and shared-ownership conflicts.

### Lifecycle states

| State | Meaning |
|-------|---------|
| `greenfield` | Created locally with a temporary `greenfield-…` id; no platform counterpart yet. The push creates the Control and rewrites the id in the file name and every reference. |
| `brownfield` | Pulled from the platform. Edits queue as `pendingEdit` blocks for the next push. |
| `partially-pushed` | A greenfield push created the Control on the platform, but a later step (such as setting its attributes) failed. The file already carries the platform id; the next push resumes it. |
| `tombstoned` | Left out of pushes: retired locally with `/dethereal:sync tombstone`, or found deleted on the platform. A locally tombstoned Control comes back with a later pull while the model still references it — remove the reference to retire it for good. |

### The Two-Write Rule

Every edit to `attributes` must (a) bump `localEditedAt` and (b) populate `pendingEdit`. The plugin enforces this via the `set-local-edited` MCP action — **never edit `controls/<id>.json` by hand.** A direct edit leaves no `pendingEdit`, so it trips the external-edit guard: the control-library push stops until you recover with `/dethereal:sync promote-external-edit <controlId> <classId>`, which records the local values as your edit.

For the full control workflow, see [Discovery and Enrichment Part 4](DISCOVERY_AND_ENRICHMENT.md#part-4-control-enrichment). For the push-time safety mechanics, see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

---

**Next:** [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md) — infrastructure scanning, security attributes, MITRE integration
