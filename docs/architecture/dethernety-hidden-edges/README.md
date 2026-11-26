# Dethernety Hidden Edges

Dethernety Hidden Edges is a backend [`DTModule`](../modules/DT_MODULE_INTERFACE.md) that answers one question about a threat model: **which attack paths does the model not show, that its own exposures make plausible?** It reads the model's exposures, their MITRE ATT&CK techniques and the model's structure, and proposes **hidden edges**: inferred paths from one component to another, each with a kind, a tier and the facts behind it. It proposes; it never writes the model. A reviewing client shows the candidates to an operator, and records an accepted one as an ordinary data flow of a hidden-edge class.

**What this document covers:** what the module is and is not, the one field it adds and its two answer contracts, the four kinds and their classes, who consumes what, how to build and test it, and a map to the rest of this documentation set.

---

## Module at a glance

| | |
|---|---|
| **Kind** | A file-policy module (`DtFileOpaModule`): four data flow classes and one read-only query |
| **Surface** | One GraphQL query field: `hiddenEdgeCandidates(modelId: ID!, options: String): String` |
| **Output** | A JSON-encoded answer: candidates, counts, the table hash and the knowledge-graph regime, or an in-band refusal. Contract 2 (from 0.2.0, asked for in `options`) adds each candidate's explanation and remedies, the rules' rationale and the limits, or rechecks edges already decided |
| **Data access** | Read-only Cypher in one read transaction; the module runs no other query |
| **Authorization** | None of its own: the platform's authentication and per-session database scoping own access |
| **Knowledge graph** | Optional: when the deployment's knowledge-graph client answers, it can lower a candidate's tier, never raise it |
| **Database** | Bolt/Cypher, portable across Neo4j and Memgraph |
| **Class ids** | Only in the module's class files, `data/dethernety-hidden-edges/dataFlow/<kind>/class.json`, read once at load; each candidate names its class |

### What it is

- **A fact-based proposer.** Every candidate rests on an exposure that is not disposed (a risk-accepted or compensated one still counts), the ATT&CK technique it cites, a row of the module's **edge-kind table** and the model's structure linking the two ends. Nothing is guessed: an attribute the model does not state lowers a tier rather than raising it.
- **A class module.** It ships the four **hidden-edge classes**, one per kind, each a data flow class in the category `Hidden Edge`, each carrying the same generic policy, which turns the flow's path techniques into exposures in the category `Inferred Path`.
- **Deterministic and bounded.** The same model, table, options and knowledge-graph regime give the same answer; every read has a cap, and the module keeps its own deadline.
- **Explained, on request.** In contract 2 each candidate says which ways in give it its tier, which facts were weighed and what holds it below high, why its rule exists, and what single statement in the model would remove or lower it. A recheck says whether an edge a person already decided still holds, and if not, why.

### What it is not

- **Not a writer.** It reads in read sessions only, and its runner refuses any Cypher but its declared reads. Recording an accepted edge is the reviewing client's job.
- **Not an AI analysis.** It runs no model and no chat; the matching is a pure function over the folded model and the table.
- **Not a chainer.** It proposes single edges. A hidden edge's own `Inferred Path` exposures never anchor a new candidate; analyses that follow paths chain through the flows themselves.
- **Not a cache.** Every call reads the model again: a knowledge-graph-lowered tier depends on the caller's entitlement.

---

## The single GraphQL field

```graphql
extend type Query {
  """Hidden-edge candidates for a model, as a JSON-encoded string. Read-only. See dethernety-hidden-edges."""
  hiddenEdgeCandidates(modelId: ID!, options: String): String
}
```

The answer is JSON in a `String`, as the other backend-only modules answer, so the schema layer never treats it as a graph node. Refusals (`model_not_found`, `model_too_large`, `options_invalid`, `busy`, `deadline`) are answered in the same string, because the platform replaces a thrown module error with one generic code in production. The answer is documented field by field in [query-contract.md](./query-contract.md).

### Two contracts

| Contract | Asked with | Answers |
|---|---|---|
| **1** | No `contract` in `options` (the default) | The candidates, counts, table hash and regime: the shape the module has answered in since 0.1.2, unchanged |
| **2** | `"contract": 2` (module 0.2.0 or later) | `mode: "candidates"`: the same candidates, each with `explain` (its parts, facts, basis and remedies), and the envelope's `rationale` and `limits`. With `recheck`: `mode: "recheck"`, one verdict per edge asked about |

A module before 0.2.0 refuses `contract` as an unknown option (`options_invalid`), so a client asks for contract 2 first and falls back to contract 1. See [query-contract.md → `contract`](./query-contract.md#contract).

---

## The four kinds

| Kind | Class (id in `dataFlow/<kind>/class.json`) | The path | Kind-specific fields |
|---|---|---|---|
| `remote-service` | Hidden Edge: Remote Service | A foothold reaches a service through a remote-service or exploitation technique | none |
| `credential-reuse` | Hidden Edge: Credential Reuse | A credential held at one component is used where it is accepted | `credential_basis` |
| `credential-capture` | Hidden Edge: Credential Capture | A credential crossing a flow is captured beside it and used at its receiver | `transport_state`, `capture_side` |
| `host-escape` | Hidden Edge: Host Escape | A container breaks out to its host and reaches what runs there | `escape_vector` |

Which techniques and element kinds select each kind is the business of the [edge-kind table](./architecture.md#4-the-edge-kind-table).

The class ids live only in the class files. The module reads the four files once when it loads; a missing or malformed file, one outside the `Hidden Edge` category, or a repeated id fails the load. Each candidate in the answer then names the class an accepted edge of its kind is written with (`class: { id, name }`, see [query-contract.md](./query-contract.md#candidate)).

---

## Who consumes it

Two different things are consumed, by different parties:

| What | Consumer | Contract |
|---|---|---|
| The **candidates** from `hiddenEdgeCandidates` | A reviewing client, such as [Dethereal](../dethereal/README.md), or any API client | [query-contract.md](./query-contract.md) |
| An **accepted hidden edge** in the model: a flow of a `Hidden Edge` class and its `Inferred Path` exposures | Every analysis that reads flows or exposures: the [Threat Report](../dethernety-threat-report/README.md), [Coverage Tools](../dethernety-coverage-tools/README.md), [Dethereal](../dethereal/README.md) | [analysis-contract.md](./analysis-contract.md) |

---

## Build and test

```bash
cd modules/dethernety-hidden-edges

pnpm build            # tsc compile + package into dist/{name}-{version}.tar.gz (with data/)
pnpm test             # hash:check (the class files against module.json), then vitest
pnpm generate:table   # regenerate the compiled table from src/edge-kinds.json
```

The suite needs no database: the matching, the fold, the options and the knowledge-graph step are pure functions tested against fixtures of read rows, and the table is linted against the repository (every technique in the pinned MITRE pack, every class and attribute it names in the open-source catalogue). The module's reads against a real database run in dt-ws's integration suite.

---

## Documentation map

| Document | What it covers |
|----------|----------------|
| **README.md** (this file) | Orientation, the field, the kinds, consumers, build and test |
| [architecture.md](./architecture.md) | How candidates are generated: the reads and the fold, the edge-kind table and its footholds, anchoring and relations, exclusions, breakers, tiers, the merge, the budgets, the knowledge-graph regime, the bounds; and contract 2's explanations, remedies and recheck |
| [query-contract.md](./query-contract.md) | The query, its options, both contracts' answers field by field, the counts, refusals, the recheck, and the validation a client must apply |
| [analysis-contract.md](./analysis-contract.md) | What analyses see of an accepted hidden edge: the flow and its fields, its `Inferred Path` findings, the set-apart rule, and how each consumer includes, labels or excludes it |

---

## Source

The module source lives at [`modules/dethernety-hidden-edges/`](../../../modules/dethernety-hidden-edges/):

| File | Role |
|------|------|
| `src/DethernetyHiddenEdgesModule.ts` | The module shell: the schema extension, the resolver, the in-flight limit, the read session, the answer |
| `src/classes.ts` | The `Hidden Edge` category and the read of the four class files at load |
| `src/reads.ts` | The declared reads and their caps |
| `src/fold.ts` | The fold of read rows into the in-memory model, and the exposure lifecycle rule (`lifecycleOf`) |
| `src/topology.ts` | The per-call index: segments, hosts, flows, credential items |
| `src/table.ts`, `src/edge-kinds.json` | The edge-kind table's validator and the table itself |
| `src/generate.ts` | The matching: pairs, footholds, exclusions, breakers, tiers, merge, budgets, order; a part's explanation (`explainPart`); the recheck walk (`recheckWalk`) |
| `src/kg.ts` | The knowledge-graph reads and the one-step lowering |
| `src/answer.ts` | The answer in the contract asked: contract 2's explanations, rationale, limits and size trim |
| `src/remedies.ts` | Contract 2's remedies and their budget |
| `src/recheck.ts` | The recheck's verdicts |
| `src/options.ts`, `src/bounds.ts`, `src/contract.ts` | The options parser (`contract`, `recheck` included), the caps and deadline, the contract versions and refusals |
| `data/dethernety-hidden-edges/` | The four classes |
| `manifest.json` / `package.json` | Module manifest and package definition |

The module shares no constants through `@dethernety/dt-module`. Its clients and the analyses tell a hidden-edge flow from the model's data: the analyses by its class category, `Hidden Edge`, and [Dethereal](../dethereal/README.md) by its class's module (see [analysis-contract.md](./analysis-contract.md)).
