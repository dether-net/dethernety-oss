# Dethereal -- Plugin Architecture for Claude Code, Codex and OpenCode

## What is Dethereal?

Dethereal is a plugin for **guided threat modeling** in Claude Code, Codex and OpenCode: one workflow, rendered into a bundle for each of the three harnesses. It turns unstructured infrastructure knowledge — code, config files, IaC definitions, container specs, API schemas — into structured threat model graphs that the Dethernety platform can analyze.

The plugin's job is **mapping, not analysis**. It helps users discover components, define trust boundaries, map data flows, classify assets, and enrich security attributes. Once the model is structured and published to the platform, the platform's analysis modules take over — running graph algorithms, computing attack paths, evaluating exposures via OPA/Rego policies, and generating findings.

## Architecture Outline

```
  Unstructured Sources                    Structured Output                Platform
  ─────────────────────                   ──────────────────               ────────────────

  Terraform, K8s, Docker,                 manifest.json                   Graph database
  code, API specs, CI/CD,    ──────>      structure.json       ──────>    (Neo4j/Memgraph)
  env files, docs, diagrams               dataflows.json                  Analysis engine
                                           data-items.json                Exposure evaluation
  (read by discovery agent)               attributes/*.json               Attack path analysis
                                                                          Crown jewel scoring
                             AI-guided     (split-file format,
                             structuring    version-controlled,
                                           per-element files)
```

The plugin converts unstructured infrastructure data into a **split-file JSON format** designed for version control. Each model is a directory with separate files for structure (components, boundaries), data flows, data items, and per-element security attributes. This format maps directly to the platform's graph schema — components become nodes, data flows become edges, boundaries define subgraphs.

## Publish and Working Copy

Dethereal uses a **publish/working copy** model, not bidirectional sync:

- **Push = Publish.** Local model files are the working copy. Pushing publishes the current state to the platform for analysis. The platform model is replaced, not merged.
- **Pull = Get a working copy.** Pulling exports a platform model to local files for offline enrichment. The local copy is independent — changes are not tracked or synced until the user explicitly pushes.

This avoids the complexity and false promises of real-time sync. The local files are the source of truth during modeling. The platform is the source of truth for analysis. Publishing is an explicit, intentional action.

### Recommended workflow

```
1. Model locally         Create and enrich the threat model using plugin skills
                         and agents. All data lives in local JSON files under
                         version control.

2. Commit                Git commit the model at natural checkpoints (after
                         discovery, after enrichment). This gives you clean
                         revert points.

3. Publish for analysis  Push to the platform when the model is ready for
                         analysis. The platform computes exposures, runs
                         graph algorithms, and generates findings.

4. Iterate               Pull findings back, refine the model locally,
                         re-publish. Each publish is a new snapshot.
```

## Guided Workflow Summary

The plugin provides an 11-step guided workflow (`/dethereal:threat-model`) that walks users through the full threat modeling process:

| Step | What happens | Output |
|------|-------------|--------|
| 1. Scope Definition | System description, crown jewels, compliance drivers, adversary classes | `scope.json` |
| 2. Discovery | Auto-scan codebase for infrastructure components | Raw inventory |
| 3. Model Review | Confirm/adjust discovered components, deterministic classification | Validated inventory |
| 4. Boundary Refinement | Define trust boundaries + the **trust skeleton** (zone + plane), enforcement status, hierarchy | `structure.json` |
| 5. Data Flow Mapping | Connect components with data flows; ratify risk-bearing crossings as **approved channels (conduits)** | `dataflows.json` + `conduits[]` |
| 6. Classification | Assign component classes from platform module definitions | Class assignments in `structure.json` |
| 7. Data Item Classification | Classify data sensitivity on flows | `data-items.json` |
| 8. Enrichment | Populate security attributes (auth, encryption, logging, credentials) | `attributes/*.json` |
| 9. Validation | Gates 1–3, the quality score (0-100, a label, not a gate) and advisory zoning-coherence findings | Readiness assessment |
| 10. Publish | Push to platform | Platform model + ID mapping |
| 11. Post-publish linking | Link countermeasures to platform-computed exposures | Defense coverage |

Each step is individually invocable (`/dethereal:discover`, `/dethereal:enrich`, etc.) and the workflow is resumable — progress is tracked via a state machine, and all data is persisted to disk. A new model — one this workflow starts, or one made with `/dethereal:create` — is a **quick model** unless that run has `--full`: enrichment covers only the priority set, the control pass is deferred, and Step 9 is a read-only pass without Gate 3 — a quick model is never marked reviewed until a run with `--full` deepens it. A model pulled from the platform is a full model.

## Plugin Components

| Component | Count | Purpose |
|-----------|-------|---------|
| **Skills** | 17 | 14 slash commands for each workflow step + utilities (login, status, help), and 3 companion skills that `enrich` and `sync` hand over to (`enrich-controls`, `sync-controls`, `sync-pull`) |
| **Agents** | 6 | Specialized subagents: infrastructure-scout, infrastructure-scout-scoped (drift re-verification), threat-modeler, security-enricher, model-reviewer, enrichment-applier (applies the operator's reply to the Step 8 enrichment relay) |
| **MCP Tools** | 30 | Local work: validation and quality gates, workspace status, drift detection, workflow state (`model_state`, `model_state_settle`, `model_state_waive`, `model_state_prune`; `model_state_settle` is listed only with the settlement switched on, which is off by default — see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)). Platform communication: model CRUD, class listing and matching, attribute stub generation, MITRE ATT&CK/D3FEND, controls, countermeasures, control gaps, analysis, and the read-only `query_controls`, `query_exposures` and `query_countermeasures` |
| **Hooks** | 5 commands | Session orientation (also re-injecting model state after a compaction), post-write validation hint, config guard against agent writes to harness permission configuration, auto-approval of the Dethereal tools that need no operator approval, secret-file guard against agent reads of secret files. The wiring differs per harness: Claude Code runs all five; Codex runs all but auto-approval and adds an agent-tool hook; OpenCode runs the guards, the post-write hint and the compaction reminder through its plugin — see [PLUGIN_ARCHITECTURE.md §6](PLUGIN_ARCHITECTURE.md#6-hooks) |
| **Installer** | 1 CLI | `dethereal install`, `uninstall`, `doctor` and `gc`: installs Claude Code through `claude plugin`, and Codex and OpenCode against a runtime copy of the package under `~/.dethernety/runtime/` — see [PLUGIN_ARCHITECTURE.md §2](PLUGIN_ARCHITECTURE.md#installer-and-runtime) |

Skills, agents and hooks are generated from a single workflow source into bundles for Claude Code, Codex and OpenCode; all three bundles ship in the package — see [PLUGIN_ARCHITECTURE.md §2](PLUGIN_ARCHITECTURE.md#2-plugin-structure).

## Architecture Documentation

> **Recommended reading order:** [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md) §1 → SKILL.md (`/dethereal:sync`, `/dethereal:enrich`, `/dethereal:status`) → engine source under [`packages/dt-core/src/dt-control-library/`](../../../packages/dt-core/src/dt-control-library/). The hardening rationale (rejected design alternatives + risk-register Plan-B fallbacks) lives at [CONTROL_LIBRARY.md Appendix A.12](CONTROL_LIBRARY.md#a12--hardening-design-choice-rationale).

| Document | Description |
|----------|-------------|
| [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) | Plugin structure, generated bundles, installer, skills, subagents, hooks, settings |
| [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) | MCP server architecture — tool system, auth flow, dt-core integration |
| [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) | End-to-end workflow, discovery, classification, MITRE integration, quality gates |
| [TRUST_ZONING.md](TRUST_ZONING.md) | Trust zones, planes, domains & conduits — data model, `validate_model_json` determination (incl. structural-container abstention), guided-flow ratification, persistence |
| [USER_EXPERIENCE.md](USER_EXPERIENCE.md) | User journey, interaction patterns, file presentation, error handling |
| [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) | Publish/pull architecture, conflict taxonomy, push flow, state bootstrap |
| [OPERATIONAL_REQUIREMENTS.md](OPERATIONAL_REQUIREMENTS.md) | Attack surface accuracy, detection readiness, compliance, trustworthiness |
| [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) | Control **assignment** — categories, workflow placement, reference shape in `structure.json`, two-tier reporting, phasing |
| [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md) | Control **configuration storage** — `controls/` folder layout, lifecycle (greenfield→brownfield), shared-ownership safety, per-instance attribute sync flows |
| [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) | Backend delegation strategy — what to compute server-side vs client-side |
| [DRIFT_DETECTION.md](DRIFT_DETECTION.md) | Drift detection — the model elements behind files changed since the drift baseline, re-verified and routed through the modeling skills |
| [TEMPLATE_STUB_GENERATION.md](TEMPLATE_STUB_GENERATION.md) | `generate_attribute_stubs` — class template attribute stubs for classified elements, and the per-model class cache |
| [CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md) | Backend services architecture — service design, embedding pipeline, integration, quality attributes |
| [CLASS_AND_CONTROL_RESOLVER_SPEC.md](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md) | Backend services specification — GraphQL types, Cypher queries, method signatures, implementation sequence |
| [DECISIONS.md](DECISIONS.md) | All 73 architecture decisions with rationale |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Retired: pointer from the superseded pre-upgrade server snapshot (2.0.0, 12 tools) to MCP_ARCHITECTURE.md, PLUGIN_ARCHITECTURE.md and DECISIONS.md |

## Key Design Principles

1. **Mapping, not analysis.** The plugin structures data. The platform analyzes it. This boundary is maintained across all 30 MCP tools — exposures are read-only in the plugin because they are analysis outputs, not mapping inputs.

2. **Files as source of truth during modeling.** All model data lives in local JSON files under version control. The plugin reads from and writes to disk. No hidden state, no in-memory-only data.

3. **Publish, don't sync.** Push replaces the platform model with the local state. There is no merge, no conflict resolution beyond "yours or theirs." This is honest about what the tool can guarantee.

4. **Resume anywhere.** Every step writes its output to disk. The state machine tracks progress. Users can stop mid-workflow and resume in a new session — the plugin reads current state from files, not conversation history.

5. **Quality over speed.** The quality score (0-100) provides continuous feedback on model completeness. The workflow recommends session breaks at natural checkpoints to keep token costs manageable and output quality high.

## Related Documentation

- [User Guide](../../user/dethereal/README.md) - End-user documentation
- [dt-core](../dt-core/) - Data access layer architecture
- [Backend](../backend/) - GraphQL API architecture
- [Modules](../modules/) - Module system and class definitions
