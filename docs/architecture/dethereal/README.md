# Dethereal -- Claude Code Plugin Architecture

## What is Dethereal?

Dethereal is a Claude Code plugin for **guided threat modeling**. It turns unstructured infrastructure knowledge — code, config files, IaC definitions, container specs, API schemas — into structured threat model graphs that the Dethernety platform can analyze.

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
| 4. Boundary Refinement | Define trust boundaries, enforcement status, hierarchy | `structure.json` |
| 5. Data Flow Mapping | Connect components with data flows, auth modes, protocols | `dataflows.json` |
| 6. Classification | Assign component classes from platform module definitions | Class assignments in `structure.json` |
| 7. Data Item Classification | Classify data sensitivity on flows | `data-items.json` |
| 8. Enrichment | Populate security attributes (auth, encryption, logging, credentials) | `attributes/*.json` |
| 9. Validation | Quality gate check (score 0-100) | Readiness assessment |
| 10. Publish | Push to platform | Platform model + ID mapping |
| 11. Post-publish linking | Link countermeasures to platform-computed exposures | Defense coverage |

Each step is individually invocable (`/dethereal:discover`, `/dethereal:enrich`, etc.) and the workflow is resumable — progress is tracked via a state machine, and all data is persisted to disk.

## Plugin Components

| Component | Count | Purpose |
|-----------|-------|---------|
| **Skills** | 14 | Slash commands for each workflow step + utilities (login, status, help) |
| **Agents** | 4 | Specialized subagents: infrastructure-scout, threat-modeler, security-enricher, model-reviewer |
| **MCP Tools** | 20 | Platform communication: model CRUD, MITRE ATT&CK/D3FEND, exposures, controls, countermeasures, analysis, attribute stub generation |
| **Hooks** | 3 | Session orientation, post-write validation, pre-compaction context preservation |

## Architecture Documentation

| Document | Description |
|----------|-------------|
| [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) | Plugin structure, skills, subagents, hooks, settings |
| [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) | MCP server architecture — tool system, auth flow, dt-core integration |
| [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) | End-to-end workflow, discovery, classification, MITRE integration, quality gates |
| [USER_EXPERIENCE.md](USER_EXPERIENCE.md) | User journey, interaction patterns, file presentation, error handling |
| [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) | Publish/pull architecture, conflict taxonomy, push flow, state bootstrap |
| [OPERATIONAL_REQUIREMENTS.md](OPERATIONAL_REQUIREMENTS.md) | Attack surface accuracy, detection readiness, compliance, trustworthiness |
| [DECISIONS.md](DECISIONS.md) | All 66 architecture decisions with rationale |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current MCP server implementation (pre-upgrade reference) |

## Key Design Principles

1. **Mapping, not analysis.** The plugin structures data. The platform analyzes it. This boundary is maintained across all 20 MCP tools — exposures are read-only in the plugin because they are analysis outputs, not mapping inputs.

2. **Files as source of truth during modeling.** All model data lives in local JSON files under version control. The plugin reads from and writes to disk. No hidden state, no in-memory-only data.

3. **Publish, don't sync.** Push replaces the platform model with the local state. There is no merge, no conflict resolution beyond "yours or theirs." This is honest about what the tool can guarantee.

4. **Resume anywhere.** Every step writes its output to disk. The state machine tracks progress. Users can stop mid-workflow and resume in a new session — the plugin reads current state from files, not conversation history.

5. **Quality over speed.** The quality score (0-100) provides continuous feedback on model completeness. The workflow recommends session breaks at natural checkpoints to keep token costs manageable and output quality high.

## Related Documentation

- [User Guide](../../user/dethereal/README.md) - End-user documentation
- [dt-core](../dt-core/) - Data access layer architecture
- [Backend](../backend/) - GraphQL API architecture
- [Modules](../modules/) - Module system and class definitions
