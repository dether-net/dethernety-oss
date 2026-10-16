# mitre-frameworks: MITRE Framework Data Ingestion Tool

This Python-based tool ingests data from the MITRE ATT&CK, MITRE ATLAS and MITRE D3FEND frameworks into the graph database (Neo4j or Memgraph) used by the Dethernety threat modeling framework, and exports it as the Cypher data pack the platform installs. It ensures that the threat and defense techniques of each pinned framework release are available for security analysis.

ATLAS is loaded as a third framework, with its own labels and key, next to ATT&CK and D3FEND. The design is recorded in [ADR-012: MITRE ATLAS as a third framework](../../docs/architecture/decisions/012-mitre-atlas-third-framework.md). The GraphQL API exposes ATLAS as read-only types with typed links from exposures and countermeasures, and the `matchMitreTechniques` query and the technique-picker components support the ATLAS kinds; no dialog offers them in the picker yet, and dt-ui shows ATLAS links read-only.

## Features

- **MITRE ATT&CK Ingestion**: Imports techniques, tactics, and mitigations from the ATT&CK framework
- **MITRE ATLAS Ingestion**: Imports AI-system techniques, tactics, mitigations, and case studies from the ATLAS framework
- **MITRE D3FEND Ingestion**: Imports defensive techniques from the D3FEND framework
- **Relationship Mapping**: Creates relationships between attack patterns and defenses, and a crosswalk from ATLAS techniques to the ATT&CK techniques they cite
- **Pinned Sources**: Each framework is pinned to one release; the ATT&CK and ATLAS bundles are verified against a committed SHA-256 before parsing
- **Database Integration**: Directly populates a Neo4j or Memgraph graph database

## Supported MITRE Data

The tool ingests the following MITRE data. The pinned releases are recorded in `manifest.json` under `corpusVersions`.

| Framework | Pinned release |
|---|---|
| MITRE ATT&CK (Enterprise) | v19.2 |
| MITRE ATLAS | v2026.09 |
| MITRE D3FEND | 1.6.0 |

### MITRE ATT&CK
- Tactics (categories of adversary objectives)
- Techniques (specific adversary behaviors)
- Sub-techniques (more specific behaviors under techniques)
- Mitigations (countermeasures for techniques)

### MITRE ATLAS

ATLAS covers attacks on AI-enabled systems. Its ids carry an `AML.` prefix, so an id's framework is decidable from its prefix.

| Object | Id pattern | v2026.09 count |
|---|---|---|
| Techniques and sub-techniques | `AML.T0000`, `AML.T0000.000` | 208 (120 + 88) |
| Tactics | `AML.TA0000` | 16 |
| Mitigations | `AML.M0000` | 40 |
| Case studies (documented incidents) | `AML.CS0000` | 73 |

- **Tactics with matrix order.** Each ATLAS tactic carries `matrix_order`, its position in the ATLAS matrix's ordered tactic list, as ATT&CK tactics do. ATLAS is its own matrix: group and order its tactics by their full `AML.TA…` id and `matrix_order`, never by name or the numeric part alone. Thirteen tactic names are shared with ATT&CK, and the numbers overlap (`AML.TA0007` Defense Evasion is not `TA0007` Discovery).
- **Crosswalk to ATT&CK.** 44 ATLAS techniques cite an ATT&CK technique. Each citation becomes an `ATLAS_TECHNIQUE_REFERENCES` edge from the ATLAS technique to the ATT&CK technique. The edge is resolved at build time against the pinned ATT&CK bundle: a cited technique that ATT&CK has revoked is followed through ATT&CK's revoked-by relationships to its live successor, and the edge records the id the ATLAS object cites in `cited_attack_id`. In v2026.09 one citation is revoked: `AML.T0073` (Impersonation) cites `T1656`, so its edge targets `T1684.001` with `cited_attack_id: "T1656"`. A revoked citation with no expected successor, or one the walk cannot resolve, stops the build. Tactic and mitigation references to ATT&CK are not linked.

The ATLAS source is the `stix-atlas.json` asset of the pinned `mitre-atlas/atlas-data` release. The loader (`scripts/atlas_stix.py`) keys every object on its `mitre-atlas` reference only, so an ATLAS object that also carries an ATT&CK id never merges onto an ATT&CK node. It fails on anything it was not written for: an unknown object or relationship type, a dangling reference, or a tactic the matrix does not place.

### MITRE D3FEND
- Defensive techniques
- Defensive tactics
- Relationships to ATT&CK techniques

## Data files

The pack is the set of committed files under `data/`. Every install path replays `data/*.cypher` in **file-name order**, so a file can only reference nodes created by a file that sorts before it.

| File | Holds |
|---|---|
| `01-attack-nodes.cypher` | ATT&CK nodes, `MERGE`d on `attack_id` |
| `02-defend-nodes.cypher` | D3FEND nodes, `MERGE`d on `d3fendId` (or `uri`) |
| `03-relationships.cypher` | ATT&CK and D3FEND relationships, including the edges between the two |
| `04-mitre-vectors.sql` | Optional pgvector embeddings for ATT&CK and D3FEND; not committed and not a Cypher file (see [below](#mitre-memgraph-embeddings)) |
| `05-mitre-embeddings.cypher` | Embeddings for ATT&CK techniques and mitigations and D3FEND techniques |
| `06-atlas-nodes.cypher` | ATLAS techniques, tactics, mitigations and case studies, `MERGE`d on `atlas_id` |
| `07-atlas-relationships.cypher` | Relationships between ATLAS nodes |
| `08-atlas-crosswalk.cypher` | `ATLAS_TECHNIQUE_REFERENCES` edges from ATLAS techniques to ATT&CK techniques |
| `09-atlas-embeddings.cypher` | Embeddings for ATLAS techniques and mitigations |

**Why ATLAS sorts after ATT&CK and D3FEND.** ATLAS ships in its own files numbered 06–09 for two reasons:

- **Load order.** The ATLAS nodes (06) load before the ATLAS relationships, crosswalk edges and embeddings (07–09) that reference them, and the crosswalk (08) loads after the ATT&CK nodes (01) it targets.
- **Unchanged ATT&CK and D3FEND files.** Adding ATLAS did not rewrite 01–03 or 05; they stay byte-for-byte as they were.

The exporter (`scripts/export_to_cypher.py`) fails instead of guessing. It raises on:

- a node with no mapped MITRE label, or more than one, or without its key
- an edge between ATLAS and another framework other than the crosswalk
- a cross-framework `SUBTECHNIQUE_OF`, `TACTIC_INCLUDES_TECHNIQUE`, `MITIGATION_DEFENDS_AGAINST_TECHNIQUE` or `CAMPAIGN_USES_TECHNIQUE` edge

The ATT&CK matrix node that the ATT&CK ingest creates is excluded from the export by name, with its edges; the matrix order it holds is already stored on each tactic as `matrix_order`. Relationships are exported in a deterministic order.

The committed `03-relationships.cypher` predates this exporter behaviour. It still carries 15 `MITRE_MATRIX_INCLUDES_TACTIC` statements that match a `MitreAttackMatrix` node; `01-attack-nodes.cypher` creates no such node, so they match nothing on load. The next full `pnpm build:data` rewrites 03 in the deterministic order and without them, so expect a large reordering diff in that file.

## Usage

```bash
# Set up Python virtual environment
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Clean existing MITRE data (ATT&CK, ATLAS and D3FEND) from the database
pnpm m-cleanup

# Ingest MITRE data into database
pnpm m-ingest

# Test parsing functionality
pnpm parsetest
```

`pnpm m-cleanup` is for development databases only: it runs `DETACH DELETE` over the MITRE labels, which on a live database would also delete every platform edge that points at them.

`pnpm m-ingest` fetches the pinned bundles and loads ATT&CK, then ATLAS (its crosswalk targets ATT&CK nodes), then D3FEND.

## Rebuilding the data

The default `pnpm build` (and the deployment bundle) only **packages** the committed `data/` files, `manifest.json` and `NOTICE` into `dist/mitre-frameworks-<version>.tar.gz`. It refuses to package when any of 01–03 or 06–08 or the `NOTICE` is missing, or when 05 or 09 is missing or does not match the manifest's embedding profile (see [Embeddings file check](#embeddings-file-check)).

`pnpm build:data` regenerates the data. It starts a temporary Memgraph container, runs the full ingest, exports the Cypher files and embeddings, and then packages the result. It needs Docker, network access to the MITRE sources, and what the manifest's embedding profile needs (see [Embedding profile](#embedding-profile)). Settings that would write other vectors than the profile's are refused before the container starts.

| Command | Regenerates | Use it when |
|---|---|---|
| `pnpm build:data` | All files: 01–03, 05–09, and `04-mitre-vectors.sql` if `OPENAI_API_KEY` is set | The ATT&CK or D3FEND release or the shared export code changes |
| `FRAMEWORKS=atlas pnpm build:data` | Only the ATLAS files, 06–09 | The ATLAS release or the ATLAS loader changes, and the ATT&CK and D3FEND files must stay untouched |
| `EMBEDDINGS_ONLY=1 pnpm build:data` | Only the embeddings, 05 and 09 | The embedding profile or the embedded text changes, and every other file must stay untouched |

With `FRAMEWORKS=atlas` the ingest still loads every framework, because the ATLAS crosswalk links to ATT&CK nodes; only the export is limited, and the pgvector SQL export is skipped. Both export scripts take the same choice directly as `--frameworks all|atlas`.

With `EMBEDDINGS_ONLY=1` nothing is ingested from MITRE: `scripts/load_committed_data.py` loads the committed node and relationship files (01, 02, 06, 03 and 07) into the temporary database, and the build embeds those nodes. The vectors therefore describe the node text that ships, and no other file changes.

### Bumping the ATLAS release

The ATLAS release is pinned in `ingest.py` by tag (`ATLAS_VERSION`) and SHA-256 (`ATLAS_STIX_BUNDLE_SHA256`). A new release also changes:

- `corpusVersions.atlas` and the module `version` in `manifest.json` (an upgrade to the same module version does not take new data)
- the ATLAS version in `NOTICE` and on the `Versions:` line of the MITRE data entry in [`deploy/compose/NOTICE`](../../deploy/compose/NOTICE)
- the ATLAS row of this README's pinned-release table, and the `v2026.09 count` column header and counts of the ATLAS object table
- the pinned ATLAS counts in `scripts/check_loaded_corpus.py`, and the pinned ATLAS embedding rows in `scripts/check_embeddings_files.py`
- `REVOCATION_EXPECTATIONS` in `scripts/atlas_stix.py`, if an ATLAS technique newly cites a revoked ATT&CK technique

Then run `FRAMEWORKS=atlas pnpm build:data` and the tests below.

## Tests

| Command | Checks | Needs |
|---|---|---|
| `pnpm test:atlas-loader` | The ATLAS loader and crosswalk on a trimmed copy of the public ATLAS and ATT&CK bundles (`scripts/fixtures/`), including every fail-loud path and the revoked `T1656` citation | Python only |
| `pnpm test:export-checks` | The exporter's node identity and relationship routing: the inputs it must refuse, and the file each legal edge lands in | The module virtual environment |
| `pnpm test:pack-idempotency` | No relationship `MERGE` in 03, 07 or 08 carries properties in its pattern, which would create a parallel edge on every re-load | Python only |
| `pnpm test:memgraph` | Loads every `data/*.cypher` file into an ephemeral Memgraph and checks node, edge and embedding counts pinned to the shipped releases; then loads everything a second time and checks the same counts, which proves the pack is idempotent | Docker; the committed 05 and 09 |
| `pnpm test:composer-byte-equality` | The text the build composes for each embedding matches the platform's runtime composer byte for byte | The module virtual environment |
| `pnpm test:module-refs` | The module reference check below, on synthetic policies and data | Python only |
| `pnpm test:embedding-profile` | The onnx profile provider and the exporter's profile path, with a fake embedder helper: the ready line, titles, order, every failure fatal, the helper ended, the `// Profile:` header, all-or-nothing writes | Python only |
| `pnpm test:embeddings-files` | The embeddings file check on generated files and on the committed 05 and 09, and the check's and the loader's statement splits | Python only |

### Module reference check

`scripts/check_module_refs.py` checks that every MITRE reference in a module's policies exists in this pack's pinned data. When the platform instantiates a class, it links only the references it can resolve and marks the rest on the finding as unlinked. A reference to an id that this pack does not carry is therefore a content defect that reaches users, and this check catches it before release.

It reads every `policies.rego` under the given module directories and checks the literal `exploited_by`, `responds_with` and verb arrays (snake or camel case) against the node keys in `data/*.cypher`. It applies the platform's rules:

- **Allowed targets per field.** `exploited_by` and the verbs may target an ATT&CK or ATLAS technique. `responds_with` may target an ATT&CK or ATLAS mitigation, a D3FEND technique or a regulatory requirement. Any other label/key pair is a failure.
- **Bare ids dispatch by shape.** `T…` is an ATT&CK technique, `AML.T…` an ATLAS technique, `M…` an ATT&CK mitigation, `AML.M…` an ATLAS mitigation and `D3-…` a D3FEND technique.
- **Requirements are not checked.** Regulatory requirement references belong to the pack that declares them.

```bash
python3 scripts/check_module_refs.py [--data DIR] [--known-failures FILE] [--exclude DIR]... \
    [--min-references N] MODULE_DIR...
pnpm check:module-refs   # this module's default run, over ../dethernety-general
```

| Option | Effect |
|---|---|
| `--data DIR` | The data directory to check against. Defaults to this module's `data/`. |
| `--known-failures FILE` | A JSON list of `{"file", "reference", "reason"}` entries for defects whose fix is under way. A listed failure does not fail the run. A listed entry that no longer fails does, so the fix must remove its entry. |
| `--exclude DIR` | Skips a directory. Repeatable. |
| `--min-references N` | Fails the run when fewer than `N` references were checked, so a module tree that failed to check out cannot pass as "0 failures". |

The command exits 1 on a failure, a stale known-failure entry or a count below the floor. CI runs the check's tests, then the check over every module under `modules/` with a floor of 1000 references.

## MITRE Memgraph embeddings

The module ships precomputed vectors in `05-mitre-embeddings.cypher` and `09-atlas-embeddings.cypher`. `05` powers the `matchMitreTechniques`
GraphQL query's vector-similarity tier. `09` holds ATLAS embeddings with the same profile and text format; `matchMitreTechniques` searches it for the ATLAS kinds through the `mitre_atlas_technique_embeddings` and `mitre_atlas_mitigation_embeddings` indexes. Both are **separate** from
`04-mitre-vectors.sql` (pgvector path, OpenAI `text-embedding-3-small` 1536-dim,
consumed by the LangChain RAG / analysis subsystem):

| Artifact | Covers | Model | Dimensions | Consumer | Committed |
|---|---|---|---|---|---|
| `data/04-mitre-vectors.sql` | ATT&CK, D3FEND | OpenAI `text-embedding-3-small` | 1536 | pgvector | No — rebuilt on demand with `OPENAI_API_KEY` |
| `data/05-mitre-embeddings.cypher` | ATT&CK techniques and mitigations, D3FEND techniques | The manifest's `embeddingProfile` (today `embeddinggemma-300m-retrieval-v1`) | 768 | Memgraph HNSW — `matchMitreTechniques` picker | **Yes** — required for packaging |
| `data/09-atlas-embeddings.cypher` | ATLAS techniques and mitigations | The manifest's `embeddingProfile` (today `embeddinggemma-300m-retrieval-v1`) | 768 | Memgraph HNSW — `matchMitreTechniques` picker (ATLAS kinds) | **Yes** — required for packaging |

ATLAS tactics and case studies are not embedded, as ATT&CK tactics and campaigns are not.

All coexist; none replaces another. The graph export (`01/02/03`, `06/07/08`) and the
`05` and `09` embeddings are committed so a fresh checkout needn't regenerate the corpus
(see [Rebuilding the data](#rebuilding-the-data)). At run time, the picker uses a kind's
vectors only when all of its nodes carry vectors of the platform's active embedding
profile; otherwise the vector tier is off for that kind and the id, name and description
tiers still answer.

### Embedding profile

`manifest.json`'s `embeddingProfile` names the profile the committed `05` and `09` were
embedded with, and every embedded node records it as `embeddingModel`. Today it is
`embeddinggemma-300m-retrieval-v1`, the platform's built-in onnx profile. `pnpm build:data`
always embeds with the manifest's profile: to change profile, change the manifest first,
then rebuild the embeddings.

| Profile | Embeds through | Needs | On failure |
|---|---|---|---|
| `embeddinggemma` (legacy) | Ollama `/api/embed` at `OLLAMA_URL` | Ollama running with `embeddinggemma` pulled. `EMBEDDING_PROVIDER` unset or `ollama`; `EMBEDDING_MODEL` unset or `embeddinggemma` | Any failure fails the build, an unreachable Ollama included |
| Any other id: a built-in onnx embedding profile | The platform's embedder package (`packages/embedder`, through its `bin/embed-documents.mjs` helper) | `EMBEDDING_MODEL_DIR` (the profile's weights directory), Node, and the package built (`pnpm --filter @dethernety/embedder... build`). `EMBEDDING_PROVIDER` unset | Any failure fails the build |

Other values of `EMBEDDING_PROVIDER` or `EMBEDDING_MODEL` are refused before the build
starts. An onnx profile runs the same embedder, document prompt and weights as the
platform, so build-time and run-time vectors match.

**Running the exporter by hand.** `pnpm m-embed-cypher` runs
`scripts/export_embeddings_to_cypher.py` against the database at `NEO4J_URI`. For an onnx
profile pass `--profile <id>`, with `--models-dir <dir>` (default `EMBEDDING_MODEL_DIR`),
`--embed-threads <n>` (onnxruntime threads) and `--download-weights` (download the
profile's missing weights into the models directory first). Without `--profile` it embeds
with the manifest's `embeddingProfile`, so it needs `--models-dir` or `EMBEDDING_MODEL_DIR`;
a manifest naming the legacy profile is refused unless `EMBEDDING_PROVIDER=ollama` is set.
`EMBEDDING_PROVIDER` replaces the manifest's profile with a provider: `ollama`, or one of
`sentence-transformers` (`nomic-ai/nomic-embed-text-v1.5`), `openai`
(`text-embedding-3-small`, 1536-dim) and `fixture` (deterministic hash-derived test
vectors, tagged `fixture`). These last three are for ad-hoc runs only: `pnpm build:data`
refuses them with the committed manifest, and their files would fail the
[embeddings file check](#embeddings-file-check). The exporter never skips: when no
provider starts, or anything fails, it exits non-zero and writes nothing.

### Generated file header

Each generated file records what embedded it:

```
// Model: <id>  Dimensions: 768
// Profile: <id>  Weights: <repo>@<revision>  dtype: <dtype>  Document prompt: title = <name|none>
```

Only onnx profiles write the `// Profile:` line; legacy files carry the `// Model:` line alone.

### Embeddings file check

`scripts/check_embeddings_files.py` checks `05` and `09` against the manifest's
`embeddingProfile`. `pnpm build` runs it before packaging; `pnpm check:embeddings-files`
runs it alone. It applies the same rules as the platform's CI check on the files the
console embeds, and splits statements the same way. A file fails when:

- it is missing
- its first `// Model:` header does not name the profile with 768 dimensions
- it does not carry exactly one `// Profile:` line naming the profile (none for the legacy profile)
- it does not split into statements (it ends inside a string or a block comment)
- a statement is not one `UNWIND` batch of at least one row for one label that sets
  `embeddingModel` exactly once, so an appended statement of any other kind fails
- any batch sets `embeddingModel` to anything but the profile
- a label's row count differs from the count pinned to the shipped releases
- a vector is not 768 finite numbers of unit length

So a file from another model, a half regeneration, a truncated file or one with a statement
added is never packaged.

### Task-prefix discipline

The build side and the runtime side must embed the same text the same way. An onnx
profile's prompts are applied by the embedder package, which the build and the platform
share. The legacy profile sends **raw text** to Ollama (build via `OllamaProvider`). The
platform no longer queries such a corpus: `dt-ws` embeds queries in process with its onnx
profile, refuses `embeddinggemma`, and reports nodes tagged with another model as
`MODEL_MISMATCH` instead of searching them. A legacy corpus serves only a consumer that
embeds its queries as raw text through Ollama. The `search_document: ` / `search_query: `
prefix discipline applies only to the ad-hoc `sentence-transformers` provider (the
`nomic-ai/nomic-embed-text-v1.5` family), whose training expects it; that prefix is
encoded inside `SentenceTransformersProvider` so it cannot be accidentally skipped.

### `corpusVersions`

`manifest.json` carries a `corpusVersions: { attack, atlas, d3fend }` block. Operator-
visible metadata only; the runtime doesn't consume these fields today. Reserved
for future corpus-drift surfacing.

## Configuration

Configuration is managed through environment variables (typically set in a `.env` file at the project root):

- `NEO4J_URI`: URI for the Neo4j or Memgraph database
- `NEO4J_USERNAME`: Username for database authentication
- `NEO4J_PASSWORD`: Password for database authentication
- `FRAMEWORKS`: `all` (default) or `atlas`. Used by `scripts/build-data.sh` to choose which files to regenerate (see [Rebuilding the data](#rebuilding-the-data)).
- `EMBEDDINGS_ONLY`: unset or `1`. With `1`, `scripts/build-data.sh` regenerates only `05` and `09` from the committed node files (see [Rebuilding the data](#rebuilding-the-data)).
- `EMBEDDING_MODEL_DIR`: The weights directory of an onnx embedding profile. Required by `pnpm build:data` when the manifest names one; the exporter's default `--models-dir`.
- `EMBEDDING_PROVIDER`: The exporter's provider when it runs without `--profile`: `ollama`, `sentence-transformers`, `openai` or `fixture`. Unset, the exporter embeds with the manifest's `embeddingProfile`; an unreachable provider fails the export. `pnpm build:data` accepts only unset or `ollama` with the legacy profile, and only unset with an onnx profile (see [Embedding profile](#embedding-profile)).
- `EMBEDDING_MODEL`: Model identifier an ad-hoc provider uses and writes into `embeddingModel`. Defaults are per-provider: `embeddinggemma` (Ollama), `nomic-embed-text` (sentence-transformers), or `text-embedding-3-small` (OpenAI). `pnpm build:data` accepts only unset or `embeddinggemma` with the legacy profile.
- `EMBEDDING_DIMENSIONS`: Override the expected dimension of the Ollama, OpenAI and fixture providers. Default 768 (1536 for OpenAI); the embeddings file check accepts only 768.
- `OLLAMA_URL`: Override the Ollama endpoint (default `http://localhost:11434/api/embed`).

The framework releases are not configurable: they are pinned in `ingest.py` (see [Supported MITRE Data](#supported-mitre-data)).

## Data Model

The tool creates the following graph node types:

- `MitreAttackTactic`: Represents ATT&CK tactics
- `MitreAttackTechnique`: Represents ATT&CK techniques and sub-techniques
- `MitreAttackMitigation`: Represents ATT&CK mitigations
- `MitreAtlasTactic`: Represents ATLAS tactics
- `MitreAtlasTechnique`: Represents ATLAS techniques and sub-techniques
- `MitreAtlasMitigation`: Represents ATLAS mitigations
- `MitreAtlasCaseStudy`: Represents ATLAS case studies
- `MitreDefendTactic`: Represents D3FEND tactics
- `MitreDefendTechnique`: Represents D3FEND techniques

ATT&CK nodes are keyed by `attack_id`, ATLAS nodes by `atlas_id`. Every node carries exactly one framework's label: an ATLAS node never carries an ATT&CK label or `attack_id`.

And the following relationships:

- `TACTIC_INCLUDES_TECHNIQUE`: Links tactics to techniques
- `SUBTECHNIQUE_OF`: Links sub-techniques to parent techniques
- `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`: Links mitigations to techniques
- `CAMPAIGN_USES_TECHNIQUE`: Links ATT&CK campaigns, and ATLAS case studies, to the techniques they use
- `ATLAS_TECHNIQUE_REFERENCES`: Links an ATLAS technique to the ATT&CK technique it cites, with the cited id in `cited_attack_id`
- `ENABLES`: Links D3FEND techniques to tactics
- `SUB_TECHNIQUE_OF`: Links D3FEND sub-techniques to parent techniques

ATLAS reuses ATT&CK's relationship types for its own structure, with ATLAS labels on both endpoints. A query that names the ATT&CK labels therefore stays ATT&CK-only; a query that needs both frameworks names both labels.

## Integration with Dethernety

The ingested MITRE data is used by the Dethernety framework to:

1. Map detected exposures to relevant ATT&CK techniques
2. Recommend appropriate defenses based on D3FEND techniques
3. Provide a comprehensive view of threats and mitigations
4. Support AI-powered security analysis

The GraphQL API exposes ATLAS as read-only types with typed links from exposures and countermeasures, and the `matchMitreTechniques` query and the technique-picker components support the ATLAS kinds; no dialog offers them in the picker yet, and dt-ui shows ATLAS links read-only.

## Licensing

The data under `data/` is MITRE's, not Dethernety's. Each framework stays under its own terms: ATT&CK under MITRE's ATT&CK license, ATLAS under the Apache License 2.0, and D3FEND under the MIT License. [`NOTICE`](NOTICE) reproduces each in full and lists which data files come from which framework.

The terms require the notice in every copy of the data, so it travels with it:

- `pnpm build` refuses to package without `NOTICE` and includes it in the tarball.
- The operator console embeds it beside the data, and its image ships it at `/licenses/mitre-frameworks/NOTICE`.

## Development

To extend the ingestion tool:

1. Modify the ingestion logic in `ingest.py` (ATLAS parsing and the crosswalk live in `scripts/atlas_stix.py`)
2. Update the exporters in `scripts/export_to_cypher.py` and `scripts/export_embeddings_to_cypher.py`
3. Add tests for new functionality (see [Tests](#tests))
4. Ensure compatibility with both Neo4j and Memgraph
