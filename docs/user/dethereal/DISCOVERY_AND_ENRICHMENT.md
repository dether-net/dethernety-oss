---
title: 'Discovery and Enrichment'
description: 'Infrastructure scanning, security attributes, MITRE ATT&CK, credentials, and compliance'
category: 'documentation'
position: 7
navigation: true
tags: ['dethereal', 'discovery', 'enrichment', 'mitre', 'credentials', 'compliance']
---

# Discovery and Enrichment

Discovery finds what's in your system. Enrichment describes how it's secured. Together, they transform a structural sketch into an analysis-ready threat model.

---

## Part 1: Infrastructure Discovery

Discovery scans your codebase to identify components, trust boundaries, and data flows. It runs during Step 2 of the [guided workflow](GUIDED_WORKFLOW.md) or standalone via `/dethereal:discover`.

### What Discovery Finds

The **infrastructure-scout** agent scans 11 source categories:

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
| 10 | Architecture diagrams | Supporting evidence | Screenshots and images — always low confidence; you confirm them explicitly |
| 11 | Documentation | Supporting evidence | README, ADRs, architecture docs |

Before presenting results, the plugin shows a **sources-checked summary** so you can see what was scanned and what was skipped:

```
Sources checked: Code (5), IaC/Terraform (12), Containers (3), K8s (—), API defs (1), Network (—), CI/CD (2), DB schemas (—), Env files (1), Diagrams (—), Docs (2)
```

A `(—)` means the source was checked but no matching files were found.

### The Confidence Model

Each discovered element gets a confidence score across two dimensions:

**Existence confidence** — how certain we are the component exists:
- **High** — explicit declaration (e.g., a Terraform resource, a Kubernetes Service, an OpenAPI endpoint)
- **Medium** — strong inference (e.g., a Docker image, an import statement, an environment variable holding a service URL)
- **Low** — weak inference (e.g., a string literal, a comment, a configuration reference)

**Classification confidence** — how certain the class assignment is:
- **High** — unambiguous mapping (e.g., `aws_rds_instance` is a Database)
- **Medium** — probable mapping (e.g., Dockerfile with `FROM postgres:15`)
- **Low** — ambiguous (e.g., generic service name)

### Pre-Classification From IaC

When the scout finds Infrastructure-as-Code, it pre-classifies components using a mapping table. For example:

| IaC Resource | Component Type | Suggested Class |
|-------------|---------------|----------------|
| `aws_rds_instance`, `aws_dynamodb_table` | STORE | Database, Key-Value Store |
| `aws_lb`, `aws_cloudfront_distribution` | PROCESS | Load Balancer, CDN |
| `aws_api_gateway_rest_api` | PROCESS | API Gateway |
| `aws_s3_bucket` | STORE | Object Storage |
| `aws_lambda_function` | PROCESS | Function |
| `aws_kms_key`, `aws_secretsmanager_secret`, `aws_cloudwatch_log_group`, `aws_acm_certificate` | EXTERNAL_ENTITY | External Cloud Service |
| Kubernetes `Deployment` / `StatefulSet` | PROCESS / STORE | Based on the container image |
| Kubernetes `Ingress` | PROCESS + boundary crossing | API Gateway / Load Balancer |

A cloud provider's managed service your system consumes as a dependency — key management, a secret manager, managed log groups, a managed certificate service — is an external entity, not an internal store: it gets the baseline module's **External Cloud Service** class when no class in your selected modules fits it as an internal component. A store your system runs itself, such as Secrets inside your own cluster or a self-hosted vault, stays internal.

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
| 5 | CloudWatch | EXTERNAL_ENTITY | External Cloud Service | low | ? |

I found 5 components, 4 boundaries, and 6 data flows. Review the table above:
- Are any components missing? (shared infrastructure, third-party services, admin tools)
- Should any be removed? (false positives, out-of-scope)
- Are the suggested types and classes correct?

Respond with changes or "looks good" to confirm.
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

### Component Tiers

Tiers rank your components for enrichment depth, Gate 3 coverage, and review. **The server computes them** from your model and reports their sizes with every Gate 3 result; you never assign a tier. External entities are never tiered. Every other component gets the **first** tier it qualifies for:

| Tier | A component is in this tier when |
|------|----------------------------------|
| **Tier 1** — internet-facing | It is an endpoint of a cross-boundary flow, **and** either its zone is PUBLIC or EXPOSED, or it has a flow with an external entity that is not in a VENDOR zone |
| **Tier 2** — crown-jewel-bearing or restricted | It is a crown jewel (`crownJewel: true` in `structure.json`), its zone is RESTRICTED, it holds a mapped crown-jewel data item, or it sits inside a mapped crown-jewel boundary, at any depth |
| **Tier 3** — everything else | Every other component, unzoned ones included |

- A component's **zone** is the declared or inherited zone of the boundary it sits in. A zone the plugin only proposed does not count until you declare it. A component with no zone is **unzoned**, and Gate 1 warns about it. It is in Tier 3 unless Tier 1 or Tier 2 applies — a cross-boundary flow with an external entity outside a VENDOR zone still makes it Tier 1, and a crown jewel still makes it Tier 2.
- A **cross-boundary flow** has its two endpoints in different boundaries, or exactly one endpoint that is an external entity.
- An external entity is in a VENDOR zone only when its boundary's declared or inherited zone is VENDOR; anywhere else it counts as untrusted. That is why declaring every boundary INTERNAL does not empty Tier 1.
- **Mapped crown jewels** are the elements you confirmed for each crown jewel in your scope during classification.

Gate 3 holds **Tier 1–2** to its attribute floors (criteria C2 and C8; see [Quality Gate Evaluation](REVIEW_AND_ANALYSIS.md#quality-gate-evaluation)). Older guides numbered internet-facing components Tier 3 and crown jewels Tier 1; read an old tier by what it meant, never by its number.

### Enrichment Order and the Priority Set

At the start of a run, the plugin takes a **snapshot** from Gate 3. This snapshot is the **priority set**:

- every crown jewel component, and every element mapped to a crown jewel in your scope;
- the Tier 1–2 components, and the flows with a Tier 1–2 end, that Gate 3 lists as still missing values (criteria C2 and C8);
- the cross-boundary pivots: components outside Tier 1 at one end of a boundary-crossing flow.

The snapshot holds for the whole run: an element that starts passing during the run stays on it. While a Gate 3 loop back is open, Gate 3 is not computed, and the snapshot is the loop back's elements that are still untouched.

The worklist then runs in this order:

1. Stale elements (added or changed since the last enrichment)
2. Crown jewels and their mapped elements
3. The rest of the priority set
4. The cross-boundary flows Gate 3 lists as failing (criterion C3)
5. Every other in-scope element

A data item joins the batch of the first element that handles it. The scope argument of `/dethereal:enrich` decides how far down the list a run goes: `priority` (alias `tier1`) enriches the priority set only, and `all` (the default) the whole worklist, priority set first. See the [Command Reference](COMMAND_REFERENCE.md) for the other scope arguments.

### Class Templates Drive the Questions

Enrichment is not a fixed questionnaire. The questions come from each element's **class template**, so they differ per element: a Database is asked about `ssl_enabled`, `password_encryption`, and `log_connections`; a Load Balancer is asked about something else entirely.

This works because classification leaves a checklist behind. When you classify, the plugin writes a stub attribute file for each classified component and data item containing every field its class template defines, seeded to `null` — schema defaults are deliberately *not* filled in, because a default describes the class, not your system. Those null fields are the checklist, and enrichment resolves every one of them.

For each element in scope, the enricher:

1. Reads the stub to see which fields are still `null`
2. Reads the class configuration guide, cached at `.dethereal/class-cache/<class-id>.json`, for where each value can be found
3. Searches your code, IaC, and config files on the deployed path for concrete evidence. The guide names one place to look, but the same setting stated anywhere on the deployed path — a Terraform parameter or parameter group, a Helm value, a container argument, a driver option — is the same evidence. Each setting in a file it reads is matched to the empty field it settles, and a count or list field is answered from what the element's own configuration states
4. Asks you only about what it could not find, grouped per component to keep round-trips down

Budget for every template field on every in-scope element — not for a fixed six.

**What counts as evidence.** A value is filled in only from effective code or configuration on the deployed path, cited by file and line, or from your answer. Every value it fills in carries its basis:

- **Cited** — `[cited] <path:line>`: the file states the value.
- **Derived** — `[derived: <setting> → <behaviour>] <path:line>`: the file states a setting, the files name the software that reads it, and that software's own reference documentation says what the setting does. `PasswordAuthentication no` in an sshd configuration settles whether password logins are accepted; `require_secure_transport=ON` settles whether plaintext connections are. The value keeps the precision the setting carries — a detail the setting does not name, such as an algorithm or a version above a floor, stays open. A file that states a whole specification (every enabled plugin, a full container spec) also settles what it leaves out, through the platform's documented default.
- **Proposed, never written** — a value that rests on a setting no file states (the default a setting takes because a file leaves it out), or on whether a component no file names enforces a setting. It is listed as a proposed default and written only if you accept it.

What a setting means comes from the reading software's own reference, never from a document in your repository. READMEs, runbooks, comments, `*.example` files and test fixtures are claims: a value only they state is written only after you confirm that the document describes the deployed system.

A value is written only when its source covers the **whole** field as the class guide defines it. A source that covers only part of it turns the field into a question that shows the covered part and quotes the guide's words for the rest. A part the guide's definition does not include — another field's property, a path the guide does not name — never holds a field back.

> **Classify first.** Template-driven enrichment needs those stubs on disk. An element with no class assigned is skipped and reported in the summary (`N elements skipped — unclassified`); only the six-attribute floor below is applied to it. The same applies if the platform is unreachable and the class cache is cold.

In `/dethereal:enrich`, proposals arrive one batch at a time, in worklist order. (In Step 8 of the guided workflow, the enrichment agent writes the cited and derived values itself, and you review them, with its questions, in [one relay turn](GUIDED_WORKFLOW.md#one-relay-turn).) A batch holds the elements whose questions fit one table (at most 15 questions). For each batch you first answer the open questions, then confirm the proposed values: one line per element, each value with its row number and its basis (`[cited]`, `[default]`, `[answer]`), the `path:line` behind `details`, in pages of at most 50 rows:

```
| Element | Values |
|---------|--------|
| payment-db (Database) | 1 ssl_enabled = true [cited] · 2 password_encryption = scram-sha-256 [cited] · 3 log_connections = true [cited] |

Which of these values do you accept, reject or change? Give row numbers — "accept all" covers this page.
```

An accepted default is written and counts in the type-default share; a row you reject or leave out is not written.

Each batch is written to disk before the next one begins, so an interrupted run keeps the batches it finished. If you decline a field (you leave it empty when asked), it stays empty (`null`), and you can give its value at any time. If a Gate 3 floor needs that field, the plugin says so and points you to the [waiver questions](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap) at Step 9 of the guided workflow. A stand-in such as a template's `unknown`, `TBD`, or `n/a` is not an answer: Gate 3 lists it as a placeholder, and a placeholder failure can never be waived.

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

The credential step runs in six parts:

**1. Flow-anchored capture.** The **Credentials** table has a row for every cross-boundary flow, every flow recorded as a privilege transition, and every flow that carries a credential data item:

```
| F# | flow                    | credential             | also reaches        | on failure |
|----|-------------------------|------------------------|---------------------|------------|
| F1 | API Server → PostgreSQL | db-admin-account (src) | Worker → PostgreSQL | deny       |
| F2 | Client → API Gateway    | api-gateway-key        | —                   | not sure   |
```

Rows are pre-filled from your code or configuration and from the shared credentials you named during discovery; a cell pre-filled from your code or configuration is marked `(src)`, with its source behind `details F#`. **on failure** is deny, fallback, fail_open, or not sure. Flows with nothing known fold into one line that keeps their ids and names. Come prepared to answer *per flow* rather than with a flat list — the "also reaches" column is what makes shared credentials visible. Say "none" only for a flow that is unauthenticated. The same question sweeps for anything no flow surfaced: service accounts, API keys, certificates, shared secrets, break-glass accounts, CI deploy keys.

**2. Credential ids from cited names.** A credential's id comes from the secret or variable **name** the source cites — the Kubernetes Secret name, `DATABASE_URL` — never from its value, and stays the same on every flow and store that names it. A workload identity, a cloud IAM role, or a client certificate is a credential too: its id comes from the service account, role, or certificate name, and a flow it authenticates is not unauthenticated.

**3. Mapping to flows.** The **Credential mapping** table pivots the answers by credential — `| S# | credential | type | flows | stores that yield it | shared |` — and says which flows take the credential id as their label. Once you confirm it, the plugin writes `required_credentials` on flow attribute files — this is the key the analysis engine reads when deciding whether an attacker can traverse a flow. A flow's credentials include any it carries on to a later hop: a bearer token a gateway passes to the service that checks it belongs on the gateway's flow too.

**4. Store scope.** For the stores in the mapping's **stores that yield it** column (a secrets vault, a config store, a database with credential tables or one whose migrations create login roles), the plugin sets `stores_credentials: true` and `credential_scope` — the credential ids an attacker acquires by compromising the store. Every id matches a `required_credentials` value on a flow, which is how the engine links a store compromise to flow traversal.

**5. Kubernetes Secret mounts.** If discovery scanned Kubernetes sources, the plugin flags Secrets mounted in several workloads, for example "Secret 'db-credentials' is mounted in 3 workloads: api-server, worker, migration-job."

**6. Secrets committed with the code.** When discovery found a Secret manifest that git tracks (it is reported by name and never opened) and a workload references one of its secret names, that workload's credential sits in a file git tracks. Citing the reference and the discovery record, the plugin proposes, where the element's class template has the field, `secrets_hardcoded_in_config_or_iac: true` on the consuming components and `db_credentials_not_in_code_or_repo: false` on the database whose credential it is. Confirm them knowing what the scan cannot see: a SOPS-encrypted file, Helm-templated data, or placeholder or empty data. Where the database's credentials come from in production (`db_credentials_in_secret_manager`) is always a question, never a proposed value.

**When you are asked.** In `/dethereal:enrich`, the credentials come **after the data items**, so that a flow carrying a credential item already has its row: the Credentials table with its own question, then the Credential mapping with its own, then [Boundary Enforcement](#boundary-enforcement). In Step 8 of the guided workflow, the Credentials and Credential mapping tables, Boundary enforcement, and the open fields come together in [one relay turn](GUIDED_WORKFLOW.md#one-relay-turn), answered by one question; the mapping is asked again only when your answers change a credential.

### Data Item Classification

For cross-boundary flows carrying sensitive data, the plugin proposes data items with sensitivity and regulatory labels. It classifies each proposed item and runs the lifecycle checks before showing anything, then asks you to confirm everything in **one table** — sensitivity, regulatory flags, every handling element by role, origin, data class, and credential flag — with one question. The table and the sensitivity floors are described in [Step 7 of the guided workflow](GUIDED_WORKFLOW.md#step-7-data-item-classification); `/dethereal:enrich` uses the same table. Regulatory flags use the [canonical vocabulary](../../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) — emit the exact casing, since the platform matches them case-sensitively:

| Sensitivity | Regulatory Labels | Examples |
|------------|------------------|---------|
| Restricted | `PHI`, `PCI cardholder` | Health records, credit card numbers |
| Confidential | `GDPR personal`, `PII`, `SOX financial`, `CCPA personal` | Email addresses, customer profiles, financial records |
| Internal | — | Metrics, operational logs |
| Public | — | Documentation, public APIs |

The item's data class sets a floor too, from whole words in the class name. Credentials, tokens, secrets, passwords, private keys, signing keys, encryption keys, API keys, sessions, cookies, JWTs, payments, cards, cardholders, health, medical or PHI floor the item at Restricted — so session tokens and API keys are Restricted. Personal, customer or PII floor it at Confidential. The proposed sensitivity is never below the higher of the two floors.

#### Origin and credential flag

Two more answers sit beside sensitivity on each data item. Both start unanswered, and the plugin never fills either in on its own — it asks or proposes, and you confirm.

**Origin** records who can write the item's content — and so whether an element that reads it is reading trusted input:

| Origin | Meaning | Untrusted |
|--------|---------|-----------|
| Authenticated first party | Written only by the operator's own authenticated users or systems | |
| Curated internal | Internal content that passed a review or curation step | |
| Agent relayed | Produced or forwarded by another agent; at most this trusted | |
| Model generated | Written by a model and later read as input; at most this trusted | |
| Third party | Written by a known external party under an agreement | yes |
| Arbitrary public | Anyone can write it | yes |
| Not assessed | Answered as not established; treated as untrusted | yes |

Typical Arbitrary public content: web pages, inbound email, public issues, public forms.

Pick the **least-trusted** source of what the item holds: if any part of it comes from a public form, the item is Arbitrary public. The plugin asks for the origin in an **Origin** column of the data-item confirm table; the column is blank when the source of the content is unknown, and the item then stays unanswered, which is different from Not assessed. The tokens written to `data-items.json` for each origin are listed in [Threat Model Concepts](MODEL_CONCEPTS.md#origin).

**Credential** records whether the item is a credential — a password, token, key, secret, or certificate. It is yes, no, or unknown. When a data item is classified with a credential-like data class (for example *User Credentials* or *Authentication Tokens*, or any class whose name contains one of the words credential, token, secret, password, passphrase, private key, API key, certificate or kubeconfig, singular or plural) and you have not answered yet, the plugin proposes **yes** in a credential column — first in the data-item confirm table, then, for items still unanswered, in the enricher's batch confirmation table:

```
| # | Data item          | Class                 | Proposed credential |
|---|--------------------|-----------------------|---------------------|
| 1 | Session token      | Authentication Tokens | yes                 |
| 2 | Login password     | User Credentials      | yes                 |
```

Accept, change, or skip each row. If you answer **no**, the plugin keeps your answer and stops proposing. These proposals do not change the quality score; `/dethereal:review` lists any still-unanswered items, and data items without an origin that flow to external parties or to model- or agent-driven components, as informational findings.

You can set or change both fields later in the platform: open the data item and use the **Origin** and **Credential** selects on its **General** tab. Untrusted origins carry an **untrusted** chip in the list.

### Boundary Enforcement

For each trust boundary, the enricher captures enforcement posture:

| Attribute | Options | Security Impact |
|-----------|---------|----------------|
| `implicit_deny_enabled` | true / false | Whether the boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Whether unrestricted inbound is allowed |
| `egress_filtering` | deny_all / allow_list / allow_all | Outbound traffic policy |

A field you are not sure about stays empty (`null`); none of these fields takes `unknown`.

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

If nobody knows, answer "not sure": the field stays empty (`null`), never `unknown`.

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

## Part 3: MITRE Framework Integration

ATT&CK technique coverage is **derived on the platform**, not annotated locally. Enrichment does not write technique IDs onto your attribute files — its job is to produce component attributes good enough for the platform's analysis policies to fire. Those policies attach techniques to the exposures they raise, and `/dethereal:surface` reports coverage from there. Do not expect to find a `mitre_attack_techniques` field after enrichment; there isn't one, and its absence is not a failed run.

### Verified Technique Lookup

You can still look techniques up interactively — to understand an exposure the platform surfaced, for example. When the plugin does, it **never generates technique IDs from memory**:

1. **Search** — it queries the platform's MITRE database using semantic descriptions (e.g., "SQL injection against database"), not remembered IDs
2. **Look up** — each candidate id is looked up on the platform; an id the platform does not know comes back as not found and is not used

All references come from the platform's graph database via the `search_mitre_attack` tool.

### D3FEND Countermeasures

For each mapped ATT&CK technique, the plugin can look up D3FEND defensive techniques — countermeasures that address the identified threats. This helps you understand what controls exist for each technique. D3FEND IDs use the format `D3-` followed by 2 or more uppercase letters (e.g., `D3-SPP`, `D3-IOPR`, `D3-HBPI`).

### Coverage Assessment

The attack surface analysis (`/dethereal:surface`) shows which of the 15 Enterprise ATT&CK tactics are covered by the techniques the platform's analysis attached to your exposures:

```
MITRE ATT&CK Coverage (platform-derived)
  Techniques mapped: 12
  Tactics covered (5/15): Initial Access, Credential Access, Lateral Movement,
    Collection, Exfiltration
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Stealth, Defense Impairment, Discovery, Command and Control,
    Impact
```

Gaps in tactic coverage highlight areas where your model may be missing relevant threats. Re-running `/dethereal:enrich` will **not** move these numbers — they come from platform analysis, not from anything enrichment writes. To change coverage: push the model with `/dethereal:sync push`, run an analysis, then re-run `/dethereal:surface`.

Until that has happened, the section reports what to do instead of a count — on a model never pushed, "Push with /dethereal:sync push, then run an analysis, for tactic coverage."; on a pushed model with no exposures yet, "No exposures yet — run an analysis on the platform (create, run, then read its results), or install a module whose policies cover these components."


> **Note:** Not all 15 tactics are expected to be relevant to every model. Tactics like Reconnaissance and Resource Development describe attacker preparation activities typically outside the scope of component-level threat modeling. Focus on gaps in tactics directly relevant to your system's architecture (e.g., Initial Access, Lateral Movement, Credential Access for internet-facing applications).

---

## Part 4: Control Enrichment

```
> /dethereal:enrich --focus controls
```

The control pass is a **separate enrichment invocation**: it starts the security-enricher agent in runs of its own, which do not share the turns of the attribute enrichment. The agent's turn limit is 40 turns on Claude Code and 40 steps on OpenCode; the plugin sets none on Codex. When its turns run short, the agent returns after a complete boundary, and the pass starts it again for the boundaries left. Run it after the regular enrichment pass (or whenever your control library changes). It manages the link between elements and the platform's reusable security controls.

### Greenfield vs Brownfield

Two paths exist depending on whether the Control already exists on the platform:

| Path | When | What happens |
|------|------|--------------|
| **Greenfield** | You want a new Control that doesn't exist yet | Plugin picks a temporary id of the form `greenfield-<short-uuid>` and writes `controls/<that id>.json` — the file name always equals the id — with `lifecycle: "greenfield"` and one `classes[]` entry per ControlClass it binds, then adds a reference with that id to your element. The next push creates the Control on the platform and rewrites the id in the file name and in every reference, protected by a recovery journal. |
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

The `attributes` block is what you edit. The `platformAttributes` block is the raw server-side payload as of the last pull. Drift between them (`attributes !== platformAttributes` with no `pendingEdit`) means the local file was changed outside the plugin — edited by hand or written by another tool; `/dethereal:status` flags it.

### The Two-Write Rule

Every edit to `attributes` must (a) bump `localEditedAt` and (b) populate `pendingEdit`. The plugin enforces this via the `set-local-edited` MCP action — **never edit `controls/<id>.json` by hand.** A direct edit leaves no `pendingEdit`, so it trips the external-edit guard: the control-library push stops before pushing any Control until you recover with `/dethereal:sync promote-external-edit <controlId> <classId>`, which records the local values as your edit. A hand edit can also corrupt the record of the values before your edit, which the push uses to detect conflicts.

### Push-Time Safety

Pushing edits to a Control assigned to multiple Models pauses on the **shared-ownership prompt**. For a single shared Control it asks `(cancel / push-anyway)`; otherwise a review screen takes `cancel`, `push-anyway`, or `push-unverified` per Control. If you do **not** want to change a shared Control, `cancel` it, then create a separate Control with `/dethereal:enrich --focus controls` — not `push-anyway`, which overwrites the shared Control on every model referencing it. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

### Status Visibility

`/dethereal:status` surfaces:

- The count of pending shared-edit prompts (Controls with un-pushed `pendingEdit` blocks).
- Drift hints (`attributes !== platformAttributes` without a pendingEdit) and the `promote-external-edit` recovery verb to apply.

This keeps a queued review from being forgotten — for example, when you switch branches and come back to the model days later.

---

## Enrichment Output Example

After enrichment, a component attribute file (`attributes/components/{id}.json`) looks like this — here, a PostgreSQL store classified with a database class:

```json
{
  "elementId": "c-db",
  "elementType": "component",
  "elementName": "PostgreSQL",
  "classData": { "id": "<class-uuid>", "name": "PostgreSQL Database" },
  "attributes": {
    "ssl_enabled": true,
    "ssl_version": "TLSv1.3",
    "password_encryption": "scram-sha-256",
    "log_connections": true,
    "row_level_security_policies": null,
    "authentication_type": "mtls",
    "encryption_in_transit": "TLS 1.3",
    "encryption_at_rest": "AES-256",
    "implicit_deny_enabled": true,
    "monitoring_tools": ["SIEM", "CloudWatch"],
    "asset_criticality": "high",
    "stores_credentials": true,
    "credential_scope": ["db-admin-account"]
  },
  "modifiedAt": "2026-03-27T14:30:00Z"
}
```

The element's identity and class sit at the top; every value sits under `attributes`, in three groups:

- **Class-template fields** — `ssl_enabled`, `ssl_version`, `password_encryption`, `log_connections`, `row_level_security_policies`. These come from the class template and differ for every class. `row_level_security_policies` is still `null`: a template field nobody has answered yet.
- **Six-attribute floor keys** — `authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled`, `monitoring_tools`. Spelled exactly as above, on every component, regardless of class.
- **Plugin-enrichment fields** — `asset_criticality`, `stores_credentials`, `credential_scope`.

Flow-level keys such as `auth_failure_mode` and `required_credentials` live in the flow's own file under `attributes/dataFlows/`, not on a component.

Crown-jewel status is not in this file: it is the first-class `crownJewel` field on the component in `structure.json`, which is what the component tiers and the enrichment worklist read.

If you edit these files by hand, read → merge → write. Overwriting drops the groups you weren't thinking about.

MITRE ATT&CK tactic coverage is not stored on the attribute file. After you push the model and run an analysis, the platform emits `Exposure` nodes with `EXPLOITED_BY` edges to MITRE techniques — `/dethereal:surface` aggregates those techniques and reports tactic coverage (see [MITRE ATT&CK Coverage](REVIEW_AND_ANALYSIS.md#5-mitre-attck-coverage)).

---

**Next:** [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) — push/pull, conflict handling, git integration
