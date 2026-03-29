---
title: 'Discovery and Enrichment'
description: 'Infrastructure scanning, security attributes, MITRE ATT&CK, credentials, and compliance'
category: 'documentation'
position: 6
navigation: true
tags: ['dethereal', 'discovery', 'enrichment', 'mitre', 'credentials', 'compliance']
---

# Discovery and Enrichment

Discovery finds what's in your system. Enrichment describes how it's secured. Together, they transform a structural sketch into an analysis-ready threat model.

---

## Part 1: Infrastructure Discovery

Discovery scans your codebase to identify components, trust boundaries, and data flows. It runs during Step 2 of the [guided workflow](GUIDED_WORKFLOW.md) or standalone via `/dethereal:discover`.

### What Discovery Finds

The **infrastructure-scout** agent scans 10 source categories:

| # | Source | What It Finds | Examples |
|---|--------|--------------|---------|
| 1 | Code structure | Application components | package.json, go.mod, monorepo configs |
| 2 | Infrastructure-as-Code | Cloud resources, networking | Terraform, CloudFormation, Pulumi, CDK |
| 3 | Container definitions | Containerized services | Dockerfiles, docker-compose.yml |
| 4 | Kubernetes manifests | Orchestrated workloads | Deployments, Services, NetworkPolicies |
| 5 | API definitions | Service interfaces | OpenAPI specs, gRPC .proto, GraphQL schemas |
| 6 | Network configuration | Load balancers, proxies | Nginx, HAProxy, Envoy, service mesh |
| 7 | CI/CD pipelines | Deployment infrastructure | GitHub Actions, GitLab CI, Jenkins |
| 8 | Database schemas | Data stores | SQL migrations, ORM models, Prisma |
| 9 | Environment files | Configuration | .env.example, ConfigMaps (names only, never secret values) |
| 10 | Documentation | Supporting evidence | README, ADRs, architecture diagrams |

Before presenting results, the plugin shows a **sources-checked summary** so you can see what was scanned and what was skipped:

```
Sources checked: IaC/Terraform (12), Containers (3), K8s (—), CI/CD (2), Code (5), API defs (1)
```

A `(—)` means the source was checked but no matching files were found.

### The Confidence Model

Each discovered element gets a confidence score across two dimensions:

**Existence confidence** — how certain we are the component exists:
- **High** — explicit declaration (e.g., Terraform `aws_rds_instance`)
- **Medium** — strong inference (e.g., SQL migration files imply a database)
- **Low** — weak inference (e.g., environment variable `REDIS_URL` implies Redis)

**Classification confidence** — how certain the class assignment is:
- **High** — unambiguous mapping (e.g., `aws_rds_instance` is a Database)
- **Medium** — probable mapping (e.g., Dockerfile with `FROM postgres:15`)
- **Low** — ambiguous (e.g., generic service name)

### Pre-Classification From IaC

When the scout finds Infrastructure-as-Code, it pre-classifies components using a mapping table. For example:

| IaC Resource | Component Type | Suggested Class |
|-------------|---------------|----------------|
| `aws_rds_instance` | STORE | Database |
| `aws_elasticache_cluster` | STORE | Key-Value Store |
| `aws_lambda_function` | PROCESS | Serverless Function |
| `aws_lb` | PROCESS | Load Balancer |
| Kubernetes `Deployment` | PROCESS | (from container image) |
| Kubernetes `Service` | PROCESS | (from selector) |

Pre-classifications are validated against the platform's class library before being presented to you. This deterministic pass runs before any LLM-assisted classification.

### The Batch Confirmation Workflow

Discovery always presents all found elements in a single table for your review — it never auto-imports without confirmation:

```
| # | Name | Type | Class | Confidence | Include? |
|---|------|------|-------|------------|---------|
| 1 | API Gateway | PROCESS | API Gateway | high | Y |
| 2 | PostgreSQL | STORE | Database | high | Y |
| 3 | Redis | STORE | Key-Value Store | high | Y |
| 4 | Auth Service | PROCESS | — | medium | Y |
| 5 | CloudWatch | EXTERNAL_ENTITY | — | low | ? |

Are any components missing? Should any be removed or reclassified?
```

### The Blind-Spots Interview

After you confirm the component list, the plugin runs a consolidated prompt to catch commonly missed elements:

> Discovery found your main components. Common elements NOT found in code:
> 1. Shared infrastructure — IdP, DNS, CA, log aggregator, SIEM, secret manager
> 2. Side-channel data flows — logging pipelines, metrics, DNS resolution, backups
> 3. Deployment pipeline — CI/CD platform, container registries, artifact stores
> 4. Third-party SaaS — OAuth providers, payment processors, CDN, email/SMS
> 5. Human actors with privileged access — system admins, DBAs, on-call engineers
> 6. Shared credentials — service accounts used by multiple components
>
> List anything else I missed, or say "none" to continue.

This is a single question, not a series of individual prompts. Items already discovered are confirmed and not re-asked.

### Discovery Cache

For multi-model projects, the first discovery saves a cache at `.dethernety/discovery-cache.json`. Subsequent models can reuse this cache, filtering out components already assigned to other models. The user can force a re-scan at any time.

---

## Part 2: Security Enrichment

Enrichment populates security attributes on your model's components, data flows, and boundaries. It runs during Step 8 of the [guided workflow](GUIDED_WORKFLOW.md) or standalone via `/dethereal:enrich`.

### Enrichment Tiers

Components are enriched in priority order:

| Tier | Components | Why This Order |
|------|-----------|---------------|
| **Tier 1** | Crown jewels (`crown_jewel: true`) | Highest-value targets — enrich first |
| **Tier 2** | Cross-boundary components | Exposed at trust transitions |
| **Tier 3** | Internet-facing components | Directly reachable from outside |
| **Tier 4** | Internal-only components | Lowest exposure |

Each component is assigned to its **highest-priority matching tier only** — a crown jewel that is also cross-boundary appears only in Tier 1.

If stale elements exist (from adding components during enrichment), they're prioritized first regardless of tier.

### The 6 Key Security Attributes

For each component, the enricher prompts for:

| # | Attribute | Question | Example Values |
|---|-----------|---------|---------------|
| 1 | `authentication` | How is this component protected? | OAuth2, JWT, mTLS, API key, basic, none |
| 2 | `encryption_in_transit` | What transport encryption? | TLS 1.3, TLS 1.2, mTLS, none |
| 3 | `encryption_at_rest` | Is stored data encrypted? | AES-256, AES-128, none, unknown |
| 4 | `logging` | Is audit logging enabled? | enabled, disabled, unknown |
| 5 | `access_control` | What authorization model? | RBAC, ABAC, ACL, none |
| 6 | `log_telemetry` | Where do logs go? Are they queryable? | SIEM/queryable, CloudWatch/queryable, local/not-queryable, none |

Enrichment presents proposals in batch confirmation tables per tier:

```
Proposed Enrichment — Tier 1 (Crown Jewels)

| # | Component | Attribute | Current | Proposed | Rationale |
|---|-----------|-----------|---------|----------|-----------|
| 1 | payment-db | authentication | — | mTLS | Service account with cert |
| 2 | payment-db | encryption_at_rest | — | AES-256 | AWS RDS encryption |
| 3 | payment-db | logging | — | enabled | CloudTrail audit |
| ...

Apply these changes? (yes / modify / skip)
```

### Credential Enrichment

Credential topology is critical for lateral movement analysis — it shows which components share credentials and where credential compromise could spread.

**Phase 1 — Inventory:** The plugin asks you to list all credentials in your system:
> What credentials and service accounts does your system use? List all: service accounts, API keys, database credentials, certificates, shared secrets.

**Phase 2 — Mapping:** Each credential is mapped to the data flows that use it. The plugin writes `required_credentials` on flow attribute files.

**Phase 3 — STORE scope:** For components that store credential material (databases with password tables, secret managers), the plugin sets `stores_credentials: true` and `credential_scope` listing which credentials are stored there.

**Phase 4 — Shared credential analysis:** If the same credential appears on multiple flows across different boundaries, the plugin flags the credential blast radius — compromise of that credential exposes all linked components.

### Data Item Classification

For cross-boundary flows carrying sensitive data, the plugin proposes data items with sensitivity and regulatory labels:

| Sensitivity | Regulatory Labels | Examples |
|------------|------------------|---------|
| Restricted (Tier 1) | PHI, PCI_cardholder | Health records, credit card numbers |
| Confidential (Tier 2) | GDPR_personal_data, PII | Email addresses, session tokens |
| Internal (Tier 3) | — | Metrics, operational logs |
| Public (Tier 4) | — | Documentation, public APIs |

### Boundary Enforcement

For each trust boundary, the enricher captures enforcement posture:

| Attribute | Options | Security Impact |
|-----------|---------|----------------|
| `implicit_deny_enabled` | true / false | Whether the boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Whether unrestricted inbound is allowed |
| `egress_filtering` | deny_all / allow_list / allow_all / unknown | Outbound traffic policy |

### Monitoring Tools

The enricher captures which monitoring systems observe each component:

- **SIEM** — Security Information and Event Management
- **EDR** — Endpoint Detection and Response
- **NDR** — Network Detection and Response
- **APM** — Application Performance Monitoring
- **Cloud-native** — CloudTrail, Azure Monitor, GCP Cloud Audit Logs

Components without any monitoring tools are flagged as SOC blind spots in the [attack surface analysis](REVIEW_AND_ANALYSIS.md).

### Auth Failure Mode

For authenticated cross-boundary flows, the enricher captures what happens when authentication fails:

| Mode | Meaning | Risk |
|------|---------|------|
| `deny` | Connection refused | Safe default |
| `fallback` | Falls back to weaker auth | Potential downgrade attack |
| `fail_open` | Allows unauthenticated access | Critical vulnerability |
| `unknown` | Not documented | Risk unclear |

Flows marked `fail_open` or `fallback` appear authenticated in the model but may provide no security guarantee under failure conditions. The attack surface analysis (`/dethereal:surface`) highlights these.

> **Known limitation:** The platform's analysis engine does not currently incorporate `auth_failure_mode` into risk scoring. A flow with `authType: "OAuth2"` and `auth_failure_mode: "fail_open"` receives full authentication credit in platform analysis. Treat fail-open and fallback flows as high-priority regardless of the engine's computed score. The local attack surface analysis (`/dethereal:surface`) correctly annotates these flows.

### Compliance-Driven Enrichment

Your compliance drivers (from scope definition) determine which framework-specific prompts appear:

| Integration Level | Frameworks | What's Prompted |
|-------------------|-----------|----------------|
| **Full integration** | SOC2, ISO 27001 | Framework-specific attribute prompts for all 6 key attributes |
| **Data-focused** | PCI-DSS, HIPAA, GDPR | Data classification prompts, sensitivity mapping |
| **Declared only** | NIST CSF 2.0, NIS2, DORA | Recorded as drivers, no framework-specific prompts |

---

## Part 3: MITRE ATT&CK and D3FEND Integration

During enrichment, the plugin maps relevant ATT&CK techniques to your components. This is done carefully to avoid hallucinated technique IDs.

### The 3-Step Verification Protocol

1. **Search** — the plugin queries the platform's MITRE database using semantic descriptions (e.g., "SQL injection against database"), not memorized technique IDs
2. **Validate** — returned technique IDs are checked against the expected format (`T####` or `T####.###` for techniques, `TA####` for tactics)
3. **Persist** — only verified IDs are written to attribute files

The plugin **never generates technique IDs from memory**. All references come from the platform's graph database via the `search_mitre_attack` tool.

### D3FEND Countermeasures

For each mapped ATT&CK technique, the plugin can look up D3FEND defensive techniques — countermeasures that address the identified threats. This helps you understand what controls exist for each technique. D3FEND IDs use the format `D3-` followed by 2 or more uppercase letters (e.g., `D3-SPP`, `D3-IOPR`, `D3-HBPI`).

### Coverage Assessment

The attack surface analysis (`/dethereal:surface`) shows which of the 14 Enterprise ATT&CK tactics are covered by your technique mappings:

```
MITRE ATT&CK Coverage
  Techniques mapped: 12
  Tactics covered (5/14): Initial Access, Credential Access, Lateral Movement,
    Collection, Exfiltration
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Defense Evasion, Discovery, Command and Control, Impact
```

Gaps in tactic coverage highlight areas where your model may be missing relevant threats. Running `/dethereal:enrich` adds more technique mappings.

> **Note:** Not all 14 tactics are expected to be relevant to every model. Tactics like Reconnaissance and Resource Development describe attacker preparation activities typically outside the scope of component-level threat modeling. Focus on gaps in tactics directly relevant to your system's architecture (e.g., Initial Access, Lateral Movement, Credential Access for internet-facing applications).

---

## Enrichment Output Example

After enrichment, a component attribute file (`attributes/components/{id}.json`) looks like this:

```json
{
  "authentication": "OAuth2",
  "encryption_in_transit": "TLS 1.3",
  "encryption_at_rest": "AES-256",
  "logging": "enabled",
  "access_control": "RBAC",
  "log_telemetry": "SIEM/queryable",
  "monitoring_tools": ["SIEM", "APM"],
  "auth_failure_mode": "deny",
  "crown_jewel": true,
  "asset_criticality": "high",
  "mitre_attack_techniques": ["T1190", "T1078"]
}
```

---

**Next:** [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) — push/pull, conflict handling, git integration
