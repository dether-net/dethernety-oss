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

| Artifact | Model | Dimensions | Consumer |
|---|---|---|---|
| `data/04-mitre-vectors.sql` | OpenAI `text-embedding-3-small` | 1536 | pgvector |
| `data/05-mitre-embeddings.cypher` | `embeddinggemma` (runtime default) | 768 | Memgraph HNSW — `matchMitreTechniques` picker |

Both coexist; neither replaces the other.

### Embedding provider precedence

`scripts/export_embeddings_to_cypher.py` honours `EMBEDDING_PROVIDER`. Auto-detects
sentence-transformers if installed; otherwise skips gracefully (build still succeeds).

| `EMBEDDING_PROVIDER` | Provider | Notes |
|---|---|---|
| _(unset, default)_ | sentence-transformers + `nomic-ai/nomic-embed-text-v1.5` if installed; else skip | 768-dim, requires `einops` (transitive). Model weights cache ~250 MB on first run. |
| `sentence-transformers` | Same as above, explicitly | Forces the path even if other env vars are set. |
| `ollama` | HTTP `OLLAMA_URL` `/api/embed` (default `http://localhost:11434/api/embed`) | Same model family — `search_document: ` task prefix applied build-side. |
| `openai` | OpenAI client, `EMBEDDING_MODEL=text-embedding-3-small` | 1536-dim. NO task prefix (different model family). |
| `fixture` | Deterministic hash-derived vectors, tagged `embeddingModel: "fixture"` | CI mode. The runtime precheck rejects fixture-tagged vectors against any real model — fail-closed by design. |

### Graceful skip

If no provider is configured (no sentence-transformers installed AND no
`EMBEDDING_PROVIDER` set), the build logs a warning, omits
`05-mitre-embeddings.cypher` from the tarball, and exits zero. The
mitre-frameworks module still installs cleanly — the runtime picker
falls back to deterministic tiers (id / name / description). See
[`scripts/build-data.sh`](scripts/build-data.sh).

### Task-prefix discipline

The runtime side (`dt-ws` `EmbeddingService`) prepends `search_query: ` before
embedding the user's typed query; the build side (`SentenceTransformersProvider`
and `OllamaProvider`) prepends `search_document: ` before `model.encode()`.
Silent prefix mismatch produces ~9% recall degradation invisible to operators —
the prefix is encoded inside each provider so operators cannot accidentally skip
it.

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
- `EMBEDDING_PROVIDER`: One of `sentence-transformers`, `ollama`, `openai`, `fixture`. Used by `export_embeddings_to_cypher.py`. Auto-detects when unset (sentence-transformers if installed, else skip).
- `EMBEDDING_MODEL`: Model identifier written into the `embeddingModel` property on each MITRE node. Defaults are per-provider: `nomic-embed-text` (sentence-transformers), `embeddinggemma` (Ollama — the platform runtime default), or `text-embedding-3-small` (OpenAI).
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