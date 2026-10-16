# ADR-013: In-process embedding replaces the Ollama embedding server

**Status:** Accepted
**Date:** 2026-10-15

**Related:** [ADR-008: Embedding-based MITRE technique matching](008-embedding-technique-matching.md), [ADR-004: Executable module system](004-executable-module-system.md)

## Context

The platform embeds text for two vector tiers: class matching (`matchClasses`) and MITRE technique matching (`matchMitreTechniques`, [ADR-008](008-embedding-technique-matching.md)). Until this release it did so by POSTing text to an HTTP embedding endpoint. The self-hosted deployment bundle ran that endpoint as its own service: an Ollama container serving `embeddinggemma`.

That arrangement had four costs:

- **Query and document were embedded the same way.** The HTTP path sent bare text, with no prompt, for both sides. EmbeddingGemma is trained to compare a query embedded under a query prompt with documents embedded under a document prompt (with a title); embedding both sides as bare text gives that asymmetry up.
- **The vectors were not pinned.** The endpoint decided which weights served a model name, so the vectors the build shipped for the MITRE corpus and the vectors the platform made at run time could come from different weights without anything noticing.
- **Operational cost.** A second container to pin, mirror and license; its health check doubled as the first-run model pull; the platform's start waited on it.
- **Memory.** About 0.8 GiB resident in that container, on a host that also runs the graph database and the platform.

The embedding-profile work had already added an in-process ONNX runtime alongside the HTTP one, so the question was which of the two to keep.

## Decision

### One runtime: an embedding profile, in process

The platform embeds in process, and only that way. `EMBEDDING_MODEL` names an **embedding profile** (`packages/dt-module/src/embedding-profiles/*.json`), which pins everything that shapes a stored vector:

| Part | What it fixes |
|---|---|
| Weights | Hugging Face repository, a full commit revision, and every file's size and sha256 |
| Runtime | ONNX, dtype, output, pooling, normalisation, dimensions |
| Prompts | The query prompt, the document prompt, and the document title rule |
| Thresholds | A calibrated cosine floor per corpus (classes, MITRE, components) |

This release offers one profile, `embeddinggemma-300m-retrieval-v1`, the default when `EMBEDDING_MODEL` is unset. The profile id is what every vector's node stores as `embeddingModel`.

The `@dethernety/embedder` package runs the profile with onnxruntime on a **worker thread**: the tokenizer, the session load and every inference stay off the event loop that serves requests. The load is bounded at 120 s, and a worker that fails after it was ready turns the embedder `failed` until the next start; it never takes the process down. onnxruntime's telemetry is switched off (`ORT_DISABLE_TELEMETRY=1`) before the runtime loads.

The weights are acquired at start into `EMBEDDING_MODEL_DIR`: each file downloaded to a temporary name, checked for size and sha256, and only then renamed into place; a per-file lock lets replicas share the directory; a failed acquisition is retried after 10 s, 30 s, 2 min, 10 min and 30 min; a shutdown aborts a download in flight. Until the model is ready, both vector tiers are off and matching answers by id and name.

### The HTTP runtime is removed

There is no HTTP embedder and no embedding endpoint setting. `EMBEDDING_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS` and `EMBEDDING_SIMILARITY_THRESHOLD` are ignored with a logged warning, so a stale value never stops a start. The per-corpus floors (`EMBEDDING_THRESHOLD_*`) remain.

### Refusal, not a rewrite of the operator's configuration

A setting the release cannot honour stops the start with a message that says what to change. Nothing rewrites the operator's `.env`:

- **The platform** refuses, with embedding on, the legacy `embeddinggemma` id, a built-in profile this release does not offer (`embeddinggemma-2-text-retrieval-v1`: its MITRE vectors are not published), and any unknown id. The check runs in the environment validation, before the database or the modules start; the embedding service applies the same rule (`config/embedding-profile-selection.ts`).
- **The bundle's control script** refuses `EMBEDDING_MODEL=embeddinggemma` in `.env` before it pulls or starts anything, and removes the old `ollama` container by its compose labels. The old data directory is reported, never removed.
- **The one-shot `console-init`** refuses a platform model other than the one the bundled MITRE vectors were embedded with, before it ingests them.

### MITRE vectors are built with the profile

The MITRE corpus ships precomputed vectors (`05-mitre-embeddings.cypher`, `09-atlas-embeddings.cypher`). They are regenerated with the profile, through the same embedder the platform runs: the embedder package's `bin/embed-documents.mjs` helper (JSON lines in, document vectors out) serves the `mitre-frameworks` exporter, so build-time and run-time vectors share tokenizer, session, prompt and weights. The module manifest's `embeddingProfile` names the profile the files were made with, and four checks hold it:

| Check | When | Fails on |
|---|---|---|
| Embeddings file check | Packaging and CI | A file whose header, batches, row counts or vectors do not match the manifest's profile |
| Console build test | Build | A manifest profile that is not the platform's default |
| `console-init` | Every deployment start | A platform model other than the manifest's profile |
| MITRE resolver precheck | Run time | No vector of the active profile in a kind: the vector tier reports `MODEL_MISMATCH` and the deterministic tiers answer |

### Class vectors are embedded at install

Classes are embedded when their module installs, each as a document under the profile's document prompt with its class name as the title. A module's shipped vector is used only when it is filed under the active profile's slug, has the profile's dimensions and can be stored (finite values, a non-zero norm). The install's skip gate records the embedder (profile and dimensions) on each Module node and reinstalls a module whose record differs, or whose searchable classes lack vectors the active embedder made, even under a record that matches. Modules installed before the embedder is ready keep their stored vectors and are installed again when it becomes ready (the catch-up).

## Consequences

**Positive:**
- **One container fewer.** The bundle runs five services; nothing serves embeddings over the network, and the platform's start no longer waits on an embedding server.
- **Queries and documents are embedded as the model was trained**, under their own prompts.
- **Reproducible vectors.** The profile pins the weights to the byte, and the MITRE build embeds through the platform's own embedder, so shipped and run-time vectors come from the same model.
- **Embedding text stays in the process.** Element names and descriptions, and picker queries, never leave the platform container. The only embedding egress is the weight download.

**Negative:**
- **A heavy first start.** The platform downloads about 1.26 GB from the Hugging Face Hub and its CDN, then embeds every class once, at about 0.2 s per class on 4 vCPU: seconds for the bundled modules, about 4 minutes with cloud content packages (about 1,200 classes). Until then matching answers by name. Operators can download ahead (`byodt models pull`) or copy the files in for an offline host.
- **Memory moves into the platform.** The platform container needs about 0.8–0.9 GiB more; the embedding server's ~0.8 GiB is gone.
- **A breaking `.env` change.** An upgraded `.env` that still names `embeddinggemma` is refused until the line is removed. There is no hosted-API option any more.
- **One profile.** `embeddinggemma-2-text-retrieval-v1` is not offered until its MITRE vectors are published.
- **Other consumers of the MITRE vectors must embed with the same profile.** A component that searches the corpus with queries from another model gets meaningless scores.
- **Weights under their own licence.** The default profile's weights are under the Gemma Terms of Use. They are not in any image or in the bundle: the operator's platform downloads them, and logs the licence before it does.

## Rejected options

| Option | Why rejected |
|---|---|
| Keep the Ollama server | Keeps every cost in the context: a second container and its memory, unpinned weights behind a model name, and bare-text embedding unless the client re-implemented each profile's prompts against a server it does not control |
| Ship class vectors per profile with each module | Every module would carry one vector file per class per profile, regenerated on every text or profile change, and its authors would need the profile's runtime. Embedding at install costs a few minutes once per deployment and keeps vectors in step with the installed text |

## References

- [ADR-008: Embedding-based MITRE technique matching](008-embedding-technique-matching.md) — the vector tier this runtime serves
- [Class and control resolver architecture → Embedding service architecture](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#embedding-service-architecture) — the service, its states and the install path
- [Pre-computed class embeddings](../modules/PRE_COMPUTED_EMBEDDINGS_SPEC.md) — when a module's shipped vectors are used
- [BYODt deployment architecture → The embedder](../byodt/ARCHITECTURE.md#the-embedder) — the bundle without an embedding server
- [BYODt security model → The embedding model](../byodt/SECURITY_MODEL.md#the-embedding-model) — weight integrity and egress
- [mitre-frameworks README → Embedding profile](../../../modules/mitre-frameworks/README.md#embedding-profile) — how the MITRE vectors are built
- [Configuration Guide](../../CONFIGURATION_GUIDE.md) — the embedding settings
