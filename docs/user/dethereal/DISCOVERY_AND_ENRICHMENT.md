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
| **Tier 1** | Crown jewels (`crownJewel: true` in `structure.json`) | Highest-value targets — enrich first |
| **Tier 2** | Cross-boundary components | Exposed at trust transitions |
| **Tier 3** | Internet-facing components | Directly reachable from outside |
| **Tier 4** | Internal-only components | Lowest exposure |

Each component is assigned to its **highest-priority matching tier only** — a crown jewel that is also cross-boundary appears only in Tier 1.

If stale elements exist (from adding components during enrichment), they're prioritized first regardless of tier.

### Class Templates Drive the Questions

Enrichment is not a fixed questionnaire. The questions come from each element's **class template**, so they differ per element: a Database is asked about `ssl_enabled`, `password_encryption`, and `log_connections`; a Load Balancer is asked about something else entirely.

This works because classification leaves a checklist behind. When you classify, the plugin writes a stub attribute file for each classified component and data item containing every field its class template defines, seeded to `null` — schema defaults are deliberately *not* filled in, because a default describes the class, not your system. Those null fields are the checklist, and enrichment resolves every one of them.

For each element in scope, the enricher:

1. Reads the stub to see which fields are still `null`
2. Reads the class configuration guide, cached at `.dethereal/class-cache/<class-id>.json`, for where each value can be found
3. Searches your code, IaC, and config files for concrete evidence
4. Asks you only about what it could not find, grouped per component to keep round-trips down

Budget for every template field on every in-scope element — not for a fixed six.

> **Classify first.** Template-driven enrichment needs those stubs on disk. An element with no class assigned is skipped and reported in the summary (`N elements skipped — unclassified`); only the six-attribute floor below is applied to it. The same applies if the platform is unreachable and the class cache is cold.

Proposals arrive as a batch confirmation table per tier:

```
## Proposed Enrichment — Tier 1 (Crown Jewels)

| # | Component | Class | Attribute | Current | Proposed | Source |
|---|-----------|-------|-----------|---------|----------|--------|
| 1 | payment-db | Database | ssl_enabled | null | true | postgresql.conf |
| 2 | payment-db | Database | password_encryption | null | scram-sha-256 | pg_hba.conf |
| 3 | payment-db | Database | log_connections | null | true | postgresql.conf |
| ...

Apply these changes? (yes / modify / skip)
```

Each tier is written to disk before the next one begins, so an interrupted run keeps the tiers it finished. If you decline a field, the plugin writes the template's documented unknown value rather than leaving it `null` — a resumed pass reads `null` as "not yet asked" and would ask again.

To see what is left, run a quality check: alongside the score it returns an **attribute residual** — the elements carrying the most unresolved template fields, with the field names, plus the elements it could not measure at all (usually a missing class template). Both lists are capped, so treat them as the top of the queue; the complete checklist is still the null fields in the attribute files.

### The Six-Attribute Floor

After template-driven enrichment, the enricher checks six security concepts on every in-scope component, whether or not its class template covered them. Anything the template missed is prompted for. Surface reports assume these are captured universally, so a template that omits one must not become a silent blind spot.

**Write these exact key names.** The `control_coverage_rate` quality factor (10% of the score) and the `/dethereal:surface` encryption and authentication coverage read these literal keys and no others. A semantically equivalent name that a class template happens to use (`transit_encryption_enforced`, `tls_enabled`, …) does **not** satisfy the floor — and nothing raises an error. The element simply reads as having no positive security attribute.

| # | Concept | Attribute key | Written on | Value that counts |
|---|---------|--------------|------------|-------------------|
| 1 | Authentication | `authentication_type` | component | String — `oauth2`, `mtls`, `sso`. `none` does not count. `basic`/`digest` count only when `encryption_in_transit` is a current protocol |
| 2 | Encryption in transit | `encryption_in_transit` | data flow (and component where meaningful) | String — e.g. `TLS 1.3`. Rejected: `none`, `sslv3`, `tls 1.0` |
| 3 | Encryption at rest | `encryption_at_rest` | component | String — e.g. `AES-256`. Rejected: `none`, `des`, `3des`, `rc4` |
| 4 | Logging | *(no scored key)* | — | Captured by the class template; nothing reads a floor-level key for this one |
| 5 | Access control | `implicit_deny_enabled` | component (and boundary, though only the component value is scored) | Boolean `true` |
| 6 | Log telemetry | `monitoring_tools` | component | Non-empty `string[]` once `none`/`n/a` entries are discarded. Use `[]`, never `["None"]` |

Types are strict as well as names: a boolean `true` for `encryption_at_rest` scores as absent, because that field wants the concrete algorithm string.

### Credential Enrichment

Credential topology is critical for lateral movement analysis — it shows which components share credentials and where credential compromise could spread.

Capture is **anchored to your data flows**, not to a cold inventory. A "list all your credentials" brain-dump reliably misses the shared service accounts that *are* the lateral-movement story, so the plugin asks flow by flow instead.

**Phase 1 — Flow-anchored capture:** The plugin enumerates the cross-boundary flows it computed during tiering and asks about them in one batched table:

```
For each of these cross-boundary flows: what credential authenticates it,
and what ELSE does that credential reach?

| # | Flow | Credential (id or "none"/"unknown") | Also used by |
|---|------|--------------------------------------|--------------|
| 1 | API Server → PostgreSQL | db-admin-account | Worker → PostgreSQL |
| 2 | Client → API Gateway | api-gateway-key | — |
```

Come prepared to answer *per flow* rather than with a flat list — the "also used by" column is what makes shared credentials visible. A free-form sweep follows for anything no flow surfaced: break-glass accounts, CI deploy keys, certificates.

**Phase 2 — Mapping:** The answers are consolidated into a credential → flows mapping and presented for confirmation. The plugin then writes `required_credentials` on flow attribute files — this is the key the analysis engine reads when deciding whether an attacker can traverse a flow.

**Phase 3 — STORE scope:** For components that store credential material (databases with password tables, secret managers), the plugin sets `stores_credentials: true` and `credential_scope` listing which credentials are stored there.

**Phase 4 — Shared credential analysis:** If the same credential appears on multiple flows across different boundaries, the plugin flags the credential blast radius — compromise of that credential exposes all linked components.

### Data Item Classification

For cross-boundary flows carrying sensitive data, the plugin proposes data items with sensitivity and regulatory labels. Regulatory flags use the [canonical vocabulary](../../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) — emit the exact casing, since the platform matches them case-sensitively:

| Sensitivity | Regulatory Labels | Examples |
|------------|------------------|---------|
| Restricted (Tier 1) | `PHI`, `PCI cardholder` | Health records, credit card numbers |
| Confidential (Tier 2) | `GDPR personal`, `PII`, `SOX financial`, `CCPA personal` | Email addresses, session tokens |
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
| **Full integration** | SOC2, ISO 27001 | Framework-specific attribute prompts — SOC2 covers access control, encryption in transit, and monitoring; ISO 27001 covers asset classification, cryptographic controls, and logging |
| **Data-focused** | PCI-DSS, HIPAA, GDPR | Data classification prompts, sensitivity mapping |
| **Declared only** | NIST CSF 2.0, NIS2, DORA | Recorded as drivers, no framework-specific prompts |

---

## Part 3: MITRE ATT&CK and D3FEND Integration

ATT&CK technique coverage is **derived on the platform**, not annotated locally. Enrichment does not write technique IDs onto your attribute files — its job is to produce component attributes good enough for the platform's analysis policies to fire. Those policies attach techniques to the exposures they raise, and `/dethereal:surface` reports coverage from there. Do not expect to find a `mitre_attack_techniques` field after enrichment; there isn't one, and its absence is not a failed run.

### Verified Technique Lookup

You can still look techniques up interactively — to understand an exposure the platform surfaced, for example. When the plugin does, it **never generates technique IDs from memory**:

1. **Search** — it queries the platform's MITRE database using semantic descriptions (e.g., "SQL injection against database"), not remembered IDs
2. **Validate** — each candidate is confirmed against the platform and checked for format (`T####` or `T####.###` for techniques, `TA####` for tactics). Anything that fails validation is dropped

All references come from the platform's graph database via the `search_mitre_attack` tool.

### D3FEND Countermeasures

For each mapped ATT&CK technique, the plugin can look up D3FEND defensive techniques — countermeasures that address the identified threats. This helps you understand what controls exist for each technique. D3FEND IDs use the format `D3-` followed by 2 or more uppercase letters (e.g., `D3-SPP`, `D3-IOPR`, `D3-HBPI`).

### Coverage Assessment

The attack surface analysis (`/dethereal:surface`) shows which of the 14 Enterprise ATT&CK tactics are covered by the techniques the platform's analysis attached to your exposures:

```
MITRE ATT&CK Coverage (platform-derived)
  Techniques mapped: 12
  Tactics covered (5/14): Initial Access, Credential Access, Lateral Movement,
    Collection, Exfiltration
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Defense Evasion, Discovery, Command and Control, Impact
```

Gaps in tactic coverage highlight areas where your model may be missing relevant threats. Re-running `/dethereal:enrich` will **not** move these numbers — they come from platform analysis, not from anything enrichment writes. To change coverage: push the model with `/dethereal:sync push`, run an analysis, then re-run `/dethereal:surface`.

Until that has happened, the section reports the reason instead of a count — either "Model not synced" or "No exposures — analysis has not produced technique mappings yet."


> **Note:** Not all 14 tactics are expected to be relevant to every model. Tactics like Reconnaissance and Resource Development describe attacker preparation activities typically outside the scope of component-level threat modeling. Focus on gaps in tactics directly relevant to your system's architecture (e.g., Initial Access, Lateral Movement, Credential Access for internet-facing applications).

---

## Part 4: Control Enrichment

```
> /dethereal:enrich --focus controls
```

The control pass is a **separate enrichment invocation** with its own 40-turn budget. Run it after the regular enrichment pass (or whenever your control library changes). It manages the link between elements and the platform's reusable security controls.

### Greenfield vs Brownfield

Two paths exist depending on whether the Control already exists on the platform:

| Path | When | What happens |
|------|------|--------------|
| **Greenfield** | You want a new Control that doesn't exist yet | Plugin writes `controls/greenfield-<temp>.json` with `{ id: null, name: ... }` and adds a reference to your element. The next push asks the platform for a UUID and rebinds every reference atomically. |
| **Brownfield** | The Control already exists on the platform | Plugin pulls `controls/<id>.json` and lets you edit per-(Control, ControlClass) attributes. Edits queue as `pendingEdit` blocks for the next push. |

### Per-Control Files

Each Control referenced by your model gets its own file under `controls/`:

```json
{
  "id": "ctrl-encryption-package",
  "name": "Database Encryption Package",
  "lifecycle": "brownfield",
  "classes": [
    {
      "classId": "class-encryption-at-rest",
      "attributes":         { "algorithm": "AES-256", "keyRotationDays": 30 },
      "platformAttributes": { "algorithm": "AES-128", "keyRotationDays": 90 },
      "localEditedAt": "2026-04-19T10:21:00Z",
      "pendingEdit": { "editedBy": "operator", "previousAttributes": {...} }
    }
  ]
}
```

The `attributes` block is what you edit. The `platformAttributes` block is the raw server-side payload as of the last pull. Drift between them (`attributes !== platformAttributes && !pendingEdit`) is a sign that someone edited the Control on the platform behind your back; `/dethereal:status` flags it.

### The Two-Write Rule

Every edit to `attributes` must (a) bump `localEditedAt` and (b) populate `pendingEdit`. The plugin enforces this via the `set-local-edited` MCP action — **never edit `controls/<id>.json` by hand.** Direct edits bypass the safety check and drop your changes silently on the next reconciliation.

### Push-Time Safety

Pushing edits to a Control assigned to multiple Models pauses on the **shared-ownership prompt** — the operator chooses `cancel`, `push-anyway`, or `push-unverified` per Control. `clone-and-swap` is planned for V1.1 and is not yet implemented: choosing it returns `CLONE_AND_SWAP_NOT_IMPLEMENTED` and the Control is left untouched. If you reached for it because you did **not** want to mutate a shared Control, the V1 equivalent is `cancel`, then create a separate Control with `/dethereal:enrich --focus controls` — not `push-anyway`, which overwrites the shared Control on every model referencing it. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

### Status Visibility

`/dethereal:status` surfaces:

- The count of pending shared-edit prompts (Controls with un-pushed `pendingEdit` blocks).
- Drift hints (`attributes !== platformAttributes` without a pendingEdit) and the `promote-external-edit` recovery verb to apply.

This avoids the "branch-switch ambush" case where you forget a queued review screen across days.

---

## Enrichment Output Example

After enrichment, a component attribute file (`attributes/components/{id}.json`) looks like this — here, a PostgreSQL store classified as a Database:

```json
{
  "componentId": "c-db",
  "name": "PostgreSQL",
  "type": "STORE",
  "ssl_enabled": true,
  "ssl_version": "TLSv1.3",
  "password_encryption": "scram-sha-256",
  "log_connections": true,
  "authentication_type": "mtls",
  "encryption_in_transit": "TLS 1.3",
  "encryption_at_rest": "AES-256",
  "implicit_deny_enabled": true,
  "monitoring_tools": ["SIEM", "CloudWatch"],
  "auth_failure_mode": "deny",
  "asset_criticality": "high",
  "stores_credentials": true,
  "credential_scope": ["db-admin-account"]
}
```

Three groups are mixed in one flat file:

- **Class-template fields** — `ssl_enabled`, `ssl_version`, `password_encryption`, `log_connections`. These come from the Database class template and differ for every class.
- **Six-attribute floor keys** — `authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled`, `monitoring_tools`. Spelled exactly as above, on every component, regardless of class.
- **Plugin-enrichment fields** — `auth_failure_mode`, `asset_criticality`, `stores_credentials`, `credential_scope`.

Crown-jewel status is not in this file: it is the first-class `crownJewel` field on the component in `structure.json`, which is what the enrichment tier sweep reads.

If you edit these files by hand, read → merge → write. Overwriting drops the groups you weren't thinking about.

MITRE ATT&CK tactic coverage is not stored on the attribute file. After you push the model and run an analysis, the platform emits `Exposure` nodes with `EXPLOITED_BY` edges to MITRE techniques — `/dethereal:surface` §5 aggregates those techniques and reports tactic coverage (see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md)).

---

**Next:** [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) — push/pull, conflict handling, git integration
