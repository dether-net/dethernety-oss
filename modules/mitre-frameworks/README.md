# mitre-frameworks: MITRE Framework Data Ingestion Tool

This Python-based tool ingests data from the MITRE ATT&CK and MITRE D3FEND frameworks into the Neo4j database used by the Dethernety threat modeling framework. It ensures that the latest threat and defense techniques are available for security analysis.

## Features

- **MITRE ATT&CK Ingestion**: Imports techniques, tactics, and mitigations from the ATT&CK framework
- **MITRE D3FEND Ingestion**: Imports defensive techniques from the D3FEND framework
- **Relationship Mapping**: Creates relationships between attack patterns and defenses
- **Versioning Support**: Handles multiple versions of the MITRE frameworks
- **Database Integration**: Directly populates the Neo4j graph database

## Supported MITRE Data

The tool ingests the following MITRE data:

### MITRE ATT&CK
- Tactics (categories of adversary objectives)
- Techniques (specific adversary behaviors)
- Sub-techniques (more specific behaviors under techniques)
- Mitigations (countermeasures for techniques)

### MITRE D3FEND
- Defensive techniques
- Defensive tactics
- Relationships to ATT&CK techniques

## Usage

```bash
# Set up Python virtual environment
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Clean existing MITRE data from database
pnpm m-cleanup

# Ingest MITRE data into database
pnpm m-ingest

# Run tests
pnpm test

# Test parsing functionality
pnpm parsetest
```

## MITRE Memgraph embeddings (`05-mitre-embeddings.cypher`)

The module ships an optional sidecar artifact that powers the `matchMitreTechniques`
GraphQL query's vector-similarity tier. It is **separate** from the existing
`04-mitre-vectors.sql` (pgvector path, OpenAI `text-embedding-3-small` 1536-dim,
consumed by the LangChain RAG / analysis subsystem):

| Artifact | Model | Dimensions | Consumer | Committed |
|---|---|---|---|---|
| `data/04-mitre-vectors.sql` | OpenAI `text-embedding-3-small` | 1536 | pgvector | No — rebuilt on demand with `OPENAI_API_KEY` |
| `data/05-mitre-embeddings.cypher` | `embeddinggemma` (build + runtime default) | 768 | Memgraph HNSW — `matchMitreTechniques` picker | **Yes** — checked into the repo |

Both coexist; neither replaces the other. The graph export (`01/02/03`) and the
embeddinggemma `05` embeddings are committed so a fresh checkout needn't
regenerate the corpus — see [`.gitignore`](.gitignore). The default `pnpm build`
(and the deployment bundle) only **package** the committed exports; run `pnpm build:data`
to regenerate them when the MITRE source or the embedding model changes.

### Embedding provider precedence

`scripts/export_embeddings_to_cypher.py` honours `EMBEDDING_PROVIDER`. When unset
it **defaults to Ollama + `embeddinggemma`** (matching the `dt-ws` runtime
default), probing the endpoint first and skipping gracefully if it's unreachable.

| `EMBEDDING_PROVIDER` | Provider | Notes |
|---|---|---|
| _(unset, default)_ | Ollama + `embeddinggemma` via `OLLAMA_URL` `/api/embed` | 768-dim. Reachability-probed (`/api/tags`); if Ollama is down or the model isn't pulled, skips gracefully (committed `05` stays authoritative). Matches the platform runtime, so the stored corpus is byte-aligned with query vectors. |
| `ollama` | Same as default, explicitly | Contractual — bypasses the probe; `embed()` fails the build if the endpoint is unreachable. `EMBEDDING_MODEL` overrides the model (default `embeddinggemma`). |
| `sentence-transformers` | `nomic-ai/nomic-embed-text-v1.5` (self-contained) | 768-dim, requires `einops` (transitive). Model weights cache ~250 MB on first run. Applies the `search_document: ` task prefix; tag with `EMBEDDING_MODEL=nomic-embed-text` at query time to match. |
| `openai` | OpenAI client, `EMBEDDING_MODEL=text-embedding-3-small` | 1536-dim. NO task prefix (different model family). |
| `fixture` | Deterministic hash-derived vectors, tagged `embeddingModel: "fixture"` | CI mode. The runtime precheck rejects fixture-tagged vectors against any real model — fail-closed by design. |

### Graceful skip

When the default provider is unreachable (Ollama down or `embeddinggemma` not
pulled) and no `EMBEDDING_PROVIDER` is set, the data build (`pnpm build:data`)
logs a warning, leaves the committed `05-mitre-embeddings.cypher` in place, and
exits zero. The
mitre-frameworks module still installs cleanly — and if no `05` artifact is
present at all, the runtime picker falls back to deterministic tiers (id / name /
description). See [`scripts/build-data.sh`](scripts/build-data.sh).

### Task-prefix discipline

The build side and the runtime side must embed the same text the same way.
`embeddinggemma` over Ollama (the default on both sides — build via `OllamaProvider`,
query via `dt-ws` `EmbeddingService`) sends **raw text** on both sides, so the
corpus and queries stay byte-aligned. The `search_document: ` / `search_query: `
prefix discipline applies only to the `nomic-ai/nomic-embed-text-v1.5` family
(the `sentence-transformers` override), whose training expects it; that prefix is
encoded inside `SentenceTransformersProvider` so it cannot be accidentally skipped.

### `corpusVersions`

`manifest.json` carries a `corpusVersions: { attack, d3fend }` block. Operator-
visible metadata only; the runtime doesn't consume these fields today. Reserved
for future corpus-drift surfacing.

## Configuration

Configuration is managed through environment variables (typically set in a `.env` file at the project root):

- `NEO4J_URI`: URI for the Neo4j database
- `NEO4J_USERNAME`: Username for Neo4j authentication
- `NEO4J_PASSWORD`: Password for Neo4j authentication
- `MITRE_ATTACK_VERSION`: Version of MITRE ATT&CK to ingest (default: latest)
- `MITRE_DEFEND_VERSION`: Version of MITRE D3FEND to ingest (default: latest)
- `EMBEDDING_PROVIDER`: One of `sentence-transformers`, `ollama`, `openai`, `fixture`. Used by `export_embeddings_to_cypher.py`. Defaults to `ollama` + `embeddinggemma` when unset (matching the platform runtime); skips gracefully if Ollama is unreachable.
- `EMBEDDING_MODEL`: Model identifier written into the `embeddingModel` property on each MITRE node. Defaults are per-provider: `embeddinggemma` (Ollama — the default and platform runtime default), `nomic-embed-text` (sentence-transformers), or `text-embedding-3-small` (OpenAI).
- `EMBEDDING_DIMENSIONS`: Override the expected dimension. Default 768 (Ollama / sentence-transformers) / 1536 (OpenAI).
- `OLLAMA_URL`: Override the Ollama endpoint (default `http://localhost:11434/api/embed`).

## Data Model

The tool creates the following Neo4j node types:

- `MitreAttackTactic`: Represents ATT&CK tactics
- `MitreAttackTechnique`: Represents ATT&CK techniques and sub-techniques
- `MitreAttackMitigation`: Represents ATT&CK mitigations
- `MitreDefendTactic`: Represents D3FEND tactics
- `MitreDefendTechnique`: Represents D3FEND techniques

And the following relationships:

- `TACTIC_INCLUDES_TECHNIQUE`: Links tactics to techniques
- `SUBTECHNIQUE_OF`: Links sub-techniques to parent techniques
- `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`: Links mitigations to techniques
- `ENABLES`: Links D3FEND techniques to tactics
- `SUB_TECHNIQUE_OF`: Links D3FEND sub-techniques to parent techniques

## Integration with Dethernety

The ingested MITRE data is used by the Dethernety framework to:

1. Map detected exposures to relevant ATT&CK techniques
2. Recommend appropriate defenses based on D3FEND techniques
3. Provide a comprehensive view of threats and mitigations
4. Support AI-powered security analysis

## Development

To extend the ingestion tool:

1. Update the data models in `models.py`
2. Modify the ingestion logic in `ingest.py`
3. Add tests for new functionality
4. Ensure compatibility with the Neo4j schema 