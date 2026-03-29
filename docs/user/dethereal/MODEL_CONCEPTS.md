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

Dethereal's default methodology is **STRIDE-per-element** — the plugin systematically evaluates spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of privilege for each component, boundary crossing, and data flow. This maps directly to the data flow diagram (DFD) modeling approach and integrates with MITRE ATT&CK for concrete technique identification.

The underlying data model is methodology-agnostic. STRIDE is the built-in interpretive overlay; the platform's module system can support additional methodologies (PASTA, attack trees) as analysis modules.

---

## Components

Components are the things in your system. Every component has a **type** that determines its behavior in security analysis:

| Type | What It Represents | Examples |
|------|-------------------|---------|
| **PROCESS** | Running software that processes data | API servers, web applications, workers, microservices |
| **STORE** | Anything that persists data | Databases, caches, file storage, message queues |
| **EXTERNAL_ENTITY** | People or systems outside your control | End users, third-party APIs, OAuth providers |

**Why types matter:** The analysis engine treats each type differently. A STORE holding credentials has different threat implications than a PROCESS routing traffic. STORE components must be classified for data sensitivity analysis to work — this is why the classification quality gate requires 100% STORE classification.

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
| `egress_filtering` | deny_all / allow_list / allow_all / unknown | Outbound traffic policy |

These attributes feed into the attack surface analysis — a boundary with `implicit_deny_enabled: true` and `egress_filtering: deny_all` provides stronger isolation than one with `allow_any_inbound: true`.

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
| `auth_failure_mode` | What happens when authentication fails: `deny`, `fallback`, `fail_open`, `unknown` |
| `encryption_in_transit` | TLS version, mTLS, none |

The `auth_failure_mode` is particularly important — a flow that appears authenticated but fails open under error conditions provides no security guarantee.

---

## Data Items

Data items classify what data flows carry. They're attached to data flows and describe the sensitivity of the information.

### Sensitivity Levels

| Level | Examples |
|-------|---------|
| **Restricted** (Tier 1) | Regulated PII, cardholder data, credentials, health records |
| **Confidential** (Tier 2) | Internal business data, session tokens, API keys |
| **Internal** (Tier 3) | Internal operational data, metrics |
| **Public** (Tier 4) | Public content, documentation |

### Regulatory Labels

Data items can carry regulatory flags that map to compliance frameworks:

| Label | Framework | Sensitivity |
|-------|-----------|------------|
| `PHI` | HIPAA | Restricted |
| `PCI_cardholder` | PCI-DSS | Restricted |
| `GDPR_personal_data` | GDPR | Confidential (minimum — special category data is Restricted) |
| `PII` | General | Confidential |

Your compliance drivers (set during scope definition) determine which regulatory prompts appear during enrichment.

---

## Classes and Modules

### What Classes Are

Classes are predefined types from the platform's module system. When you classify a component as "Database" or "Web Application," you're assigning it a class that comes with:

- An attribute schema (which security properties are relevant)
- Default attribute values
- Guidance for enrichment

### How Classification Works

Classification happens in two passes:

1. **Deterministic (Pass 1):** The plugin queries the platform for available classes and matches components by name and type. "PostgreSQL" matches "Database" with high confidence — no AI needed.

2. **LLM-assisted (Pass 2):** For ambiguous components, the AI proposes classes based on boundary context and peer components.

You always confirm classifications before they're written. The plugin never auto-classifies without showing you what it's doing.

For more on the classification process, see the [classify command](COMMAND_REFERENCE.md#detherealclassify---type-componentsflowsboundariesdata-items) or the platform's [Component Configuration Guide](../COMPONENT_CONFIGURATION_GUIDE.md).

---

## Security Attributes

### The 6 Key Component Attributes

Every component can have these security properties, populated during enrichment:

| # | Attribute | What It Captures | Example Values |
|---|-----------|-----------------|---------------|
| 1 | `authentication` | How the component is protected | OAuth2, JWT, mTLS, API key, none |
| 2 | `encryption_in_transit` | Transport-level encryption | TLS 1.3, TLS 1.2, mTLS, none |
| 3 | `encryption_at_rest` | Storage encryption | AES-256, AES-128, none, unknown |
| 4 | `logging` | Whether audit logging is enabled | enabled, disabled, unknown |
| 5 | `access_control` | Authorization model | RBAC, ABAC, ACL, none |
| 6 | `log_telemetry` | Log destination and queryability | SIEM/queryable, CloudWatch/queryable, local/not-queryable, none |

These attributes are populated during the enrichment step and stored in individual attribute files under `attributes/components/`.

### Additional Attributes

- **`monitoring_tools`** — which monitoring systems observe this component (SIEM, EDR, NDR, APM). Components without monitoring tools are detection blind spots.
- **`crown_jewel`** — true/false, marks the component as a high-value target
- **`asset_criticality`** — high/medium/low, the business impact of compromise
- **`stores_credentials`** — true for STORE components that hold credential material
- **`credential_scope`** — which credential identifiers are stored (drives lateral movement analysis)

---

## Crown Jewels

Crown jewels are your most valuable assets — the data or capabilities an attacker would target. You name them during scope definition:

```
Crown jewels: ["Cardholder data", "User PII", "API authentication keys"]
```

During classification, these free-text names are fuzzy-matched to actual components and tagged with `crown_jewel: true`. Crown jewels receive priority treatment:

- **Enrichment tier 1** — enriched first, with the most thorough prompts
- **Control gap analysis** — crown jewels without controls are flagged as highest-priority gaps
- **Attack surface** — appear in the top tier of the surface analysis

---

## Quality Scoring

The quality score (0-100) measures how completely your model captures the system. It is **not** a security rating — a model with 95/100 quality could describe a system with critical vulnerabilities. The score reflects modeling completeness, not security posture.

The score is computed from 7 weighted factors: component classification (25), attribute completion (20), boundary hierarchy (15), data flow coverage (15), data classification (10), control coverage (10), and credential coverage (5).

Score labels: **Starting** (0-39), **In Progress** (40-69), **Good** (70-89), **Comprehensive** (90-100). Analysis readiness requires 70+.

### The 3 Quality Gates

Three progressive gates enforce increasing strictness:

- **Gate 1 (Creation, advisory)** — flags structural issues without blocking: missing classifications, unnamed flows, single-component boundaries
- **Gate 2 (Sync, blocking)** — must pass before `/dethereal:sync push`: manifest completeness, structure validity, reference integrity
- **Gate 3 (Analysis, blocking)** — must pass for meaningful analysis: 100% classification, >= 80% attribute completion, data items classified for sensitive flows, >= 1 cross-boundary flow

For the full factor breakdown, gate criteria, and example output, see [Review and Analysis](REVIEW_AND_ANALYSIS.md#quality-review-detherealreview).

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
│   ├── state.json         # Current workflow state
│   ├── scope.json         # Scope definition
│   ├── quality.json       # Quality score cache
│   ├── discovery.json     # Discovery provenance (gitignore)
│   └── sync.json          # Sync metadata (gitignore)
└── attributes/            # Per-element security attributes
    ├── boundaries/
    │   └── {id}.json
    ├── components/
    │   └── {id}.json
    ├── dataFlows/
    │   └── {id}.json
    └── dataItems/
        └── {id}.json
```

### manifest.json

Model metadata: name, description, and which platform modules it uses.

### structure.json

The hierarchy of trust boundaries and components, with visual coordinates for diagram rendering. This is where the boundary tree lives.

### dataflows.json

An array of directed connections between components. Each flow has a source, target, protocol, and description.

### data-items.json

An array of data classification items attached to data flows. Captures what sensitive data is flowing through the system.

### attributes/

Per-element attribute files containing security properties. Each element type has its own subdirectory. Attribute files are created during classification (as stubs) and populated during enrichment.

### ID Handling

When you create a model locally, components get **temporary reference IDs** (UUIDs). These link elements together (e.g., a data flow's source/target IDs reference components in structure.json).

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

- **`state.json`** — current workflow state and completed states
- **`scope.json`** — scope definition (crown jewels, compliance drivers, etc.)
- **`quality.json`** — cached quality score (deleted on backward transitions)
- **`discovery.json`** — discovery provenance (gitignore — may contain infrastructure details)
- **`sync.json`** — sync metadata (gitignore — per-user state)

---

**Next:** [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md) — infrastructure scanning, security attributes, MITRE integration
