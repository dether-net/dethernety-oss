## Security Constraint

When reading config maps, connection strings, or any configuration:
- **Extract only variable NAMES and endpoint information** (hostnames, ports, protocols); secret files are never opened (see Secret files below)
- **NEVER include secret VALUES** (passwords, API keys, tokens, private keys, certificates) in your output or conversation context
- If you encounter a secret, reference it by variable name only (e.g., "DB_PASSWORD is configured" not the actual value)
- Connection strings: extract host, port, protocol, database name — **never credentials**
- Config maps: list key names only, never display values; Secret manifests are never opened (see Secret files below)

{{include shared/secret-files.md}}

## IaC Component Mappings

Use this table for deterministic pre-classification. When a discovered element matches a source pattern, assign the component type and suggested class directly.

| Source Pattern | Component Type | Dethernety Class |
|---------------|---------------|-----------------|
| `aws_instance`, `aws_ecs_service` | PROCESS | Varies by workload |
| `aws_db_instance`, `aws_dynamodb_table` | STORE | Database, Key-Value Store |
| `aws_lb`, `aws_cloudfront_distribution` | PROCESS | Load Balancer, CDN |
| `aws_vpc`, `aws_subnet` | Boundary | Network Zone |
| `aws_security_group` | Boundary + Control | Network Zone + Firewall |
| `aws_api_gateway_rest_api` | PROCESS | API Gateway |
| `aws_s3_bucket` | STORE | Object Storage |
| `aws_lambda_function` | PROCESS | Function |
| `aws_cognito_user_pool` | EXTERNAL_ENTITY | Identity Provider |
| `aws_kms_key`, `aws_secretsmanager_secret`, `aws_cloudwatch_log_group`, `aws_acm_certificate` | EXTERNAL_ENTITY | External Cloud Service |
| K8s Deployment/StatefulSet | PROCESS/STORE | Based on container image |
| K8s Namespace | Boundary | Namespace |
| K8s NetworkPolicy | Control | Network Policy |
| K8s Ingress | PROCESS + boundary crossing | API Gateway / Load Balancer |

Check that a suggested class exists on the platform before you propose it, with {{tool:get_classes}} listed by module, never one unfiltered page: list the modules once (`view: 'modules'`), then each `class_type` you need once per module — the baseline module and each module whose provider pattern the source shows — with `module_name` and `fields: ['id', 'name']`, for all the elements of that type together. While a page is `truncated`, call again with its `next_offset`; never choose from a page not fetched. A name search asks for `module` in `fields` and weighs every same-name hit. Candidates at the same confidence from different modules — or a provider's class against the class of the engine it runs (a managed database service's class against the database's) — are told apart by how much of the element's attack surface each template covers: the provider's class wins only when its template also covers the engine's concerns (queries, roles, credentials, host access), not only the provider's control plane; otherwise the engine's class. When the template keys cannot be fetched, or do not settle it, propose the engine's class, with the provider's beside it for the operator. A full tie is reported with both candidates: no module is selected yet. On a real tie — candidates from different modules at the same confidence, or a provider's class against its engine's — fetch each tied class's template keys, {{tool:get_classes}} with `class_id`, its `module_name` and `fields: ['id', 'name', 'template_keys']`, one class a call and once per class in a run (a third class only when it is in the tie too), and compare them; never for an `exact_name` pick with no rival, and never in a listing. If no class fits, mark the element unclassified (the class may not be in the installed modules).

## Confidence Model

Each discovered element receives two confidence dimensions:

| Dimension | High | Medium | Low |
|-----------|------|--------|-----|
| **Existence** | Explicit declaration (K8s Service, Terraform resource, OpenAPI endpoint) | Strong inference (Docker image, import statement, env var with service URL) | Weak inference (string literal, comment, config reference) |
| **Classification** | Unambiguous type mapping (`aws_db_instance` → STORE/Database) | Probable type (Docker image name suggests purpose) | Ambiguous (custom module, generic service name) |

**Multi-source deduplication:**
1. Existence confidence = max of all sources
2. Classification confidence = max of all sources
3. Prefer the source with higher classification confidence for type/class assignment
4. Store all sources in provenance for auditability

## Zone & Plane Suggestion

For each **boundary** element, propose a trust `zone` where topology gives strong evidence (its `classificationConfidence` is the confidence of the proposal). The raw enum goes in `suggestedZone`; a report table shows its display name.

- Public IP / `0.0.0.0/0` ingress / internet gateway **on the subnet itself** → `PUBLIC`; reachable only via an upstream load balancer / edge → `EXPOSED`. When the front door is ambiguous, **lean to the more-exposed `PUBLIC`** and say why in the boundary's rationale.
- Subnet with no inbound internet route → `INTERNAL`.
- Third-party SaaS / external entity → `VENDOR` (vetted partner) or `UNTRUSTED` (open / unknown). A cloud provider's boundary of the managed services the system consumes → `VENDOR`, confidence `medium` when a provider block or resource in IaC is the evidence.
- A boundary whose members are **all** external entities (people or outside systems) is a signal even without topology: `UNTRUSTED` — `VENDOR` only for a partner the source names as vetted or a cloud provider's boundary of managed services (above) — with `classificationConfidence: 'low'` when membership is the only evidence (for a boundary, that is also its class's confidence).
- **No signal → propose nothing** (leave the field for Step 4). `plane` is usually code-invisible — propose it only on clear evidence.
- **Never propose `RESTRICTED`** — it depends on the flow graph and asset classification that don't exist at discovery; it is a later Step-7 promotion.

## Pre-Classification Flow

For each discovered component — components only; flows and boundaries are classified at the model review:
1. Check the IaC Component Mappings table above for a deterministic match
2. If matched with high classification confidence, pre-fill the class in the report table
3. Check the class with {{tool:get_classes}} (the component's `class_type`, `fields: ['id', 'name']`), as IaC Component Mappings says
4. Format pre-classified items as: `"Redis Cache (STORE / Key-Value Store)"` in the report table

## Component Type Reference

| Type | Use When | Examples |
|------|----------|---------|
| PROCESS | Active computation, request handling | API servers, web servers, workers, microservices, Lambda functions |
| STORE | Persistent or cached data | Databases, Redis, S3 buckets, file systems, message queues |
| EXTERNAL_ENTITY | Outside the system's control | End users, third-party APIs, SaaS services, partner systems, a cloud provider's managed service consumed as a dependency (key management, a secret manager, managed log groups, a managed certificate service) |

**A cloud provider's managed service** — the provider operates it and the system only calls its API (key management, a secret manager, managed log groups, a managed certificate service) — is an `EXTERNAL_ENTITY` with the baseline module's External Cloud Service class: one element per provider service the system uses, its resources in `sources`, never an internal `STORE` left without a class. The model review swaps it for an active module's class made for that service, with that class's type. It sits in the provider's own external boundary, never inside an internal one. A flow to it runs from the component that calls it (a workload to key management, an application to a secret manager or a log group), and a configuration binding (a certificate on a listener, a key a resource references) is drawn from the consumer too; a flow runs from the service into the system only when the service initiates the call. A store the system deploys and runs itself — Kubernetes Secrets in its own cluster, a vault on its own pods or VMs — stays internal; a provider's key vault is a managed service.

## Discovery Output Schema

Each discovered element follows this structure:

```
{
  suggestedType: 'component' | 'boundary' | 'dataFlow' | 'dataItem' | 'control',
  suggestedName: string,
  suggestedDescription: string,
  suggestedComponentType?: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY',
  suggestedClass?: { id: string, name: string },
  suggestedZone?: 'UNTRUSTED' | 'PUBLIC' | 'EXPOSED' | 'INTERNAL' | 'RESTRICTED' | 'VENDOR',  // boundary elements only
  suggestedPlane?: 'WORKLOAD' | 'MANAGEMENT',  // boundary elements only; omit when there is no signal (usually code-invisible)
  existenceConfidence: 'high' | 'medium' | 'low',
  classificationConfidence: 'high' | 'medium' | 'low',
  sources: [{ type, file, line?, resource? }],
  confirmed: false
}
```

The element's `classificationConfidence` **is** the confidence of its `suggestedZone` — there is no separate zone-confidence field. `suggestedZone`/`suggestedPlane` are proposals only; nothing is committed until the operator confirms (a re-proposed zone never overwrites a previously ratified one). You always return `confirmed: false`: only the operator's answer confirms an element.

**Evidence traceability for data flows:** The `sources` array must be populated with structured evidence for data flows, not just components. When inferring flows from configuration (reverse proxy configs, connection strings, service mesh routes, gRPC imports), set `file` to the specific file where the flow was inferred, and `line` to the line number when identifiable. The `type` should match a discovery source category (e.g., `"network_config"`, `"connection_string"`, `"api_definition"`, `"code"`). Freetext-only evidence fields are insufficient for audit traceability.

**Defense-in-depth:** The `suggestedDescription` field must never contain credential material. Before finalizing your report, scan all description fields for common secret patterns (strings matching `password=`, base64-encoded blocks, JWT-shaped tokens, AWS key patterns like `AKIA`). Strip any matches and replace with `[REDACTED]`. This is a secondary safeguard — the primary constraint is the Security Constraint section above.
