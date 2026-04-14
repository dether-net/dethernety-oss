# Pre-computed Class Embeddings

How modules ship embedding vectors alongside class definitions so the
platform does not have to call an external embedding endpoint at
install time.

- [Overview](#overview)
- [Interface](#interface)
- [File Layout](#file-layout)
- [Base-class Default](#base-class-default)
- [Platform Integration](#platform-integration)
- [CLI — `module-manager embed`](#cli--module-manager-embed)
- [Packaging](#packaging)
- [Multi-model Support](#multi-model-support)
- [Failure Semantics](#failure-semantics)
- [Non-goals](#non-goals)

Author workflow: see
[DEVELOPMENT_GUIDE — Pre-computed Embeddings](./DEVELOPMENT_GUIDE.md#pre-computed-embeddings-optional).

---

## Overview

`match_classes` Priority 3 (vector similarity) requires every class node to
carry an `embedding` property. By default the platform embeds every class
at install time via `EmbeddingService.embedBatch()` — an HTTP call to the
configured endpoint (Ollama, OpenAI, or compatible). For large modules
that call dominates install time; for air-gapped deployments it's a hard
blocker.

Pre-computed embeddings move vector generation to build time: the module
author runs `module-manager embed` once, vectors land under each class
directory as JSON files, and the packager includes them in the tarball.
At install the platform reads vectors from disk instead of making HTTP
calls. Mixed modules (some classes embedded, some not) and legacy
modules (no embeddings directory) keep working unchanged.

## Interface

`DTModule` gains one optional method:

```typescript
// packages/dt-module/src/interfaces/module-interface.ts

interface DTModule {
  // …existing methods…

  /**
   * Return a pre-computed embedding vector for a class, or null if the
   * module doesn't have one for this (className, embeddingModel) pair.
   * Synchronous — implementations read from in-memory caches, not the
   * network. `embeddingModel` is the slugified model identifier
   * (slugifyModelName from `@dethernety/dt-module/embedding`).
   */
  getEmbedding?(className: string, embeddingModel: string): number[] | null;
}
```

Contract:
- Returns `null` (not throws) when the class or model is unknown.
- `className` is matched case-sensitively against `getMetadata()` output.
- The vector's length is **not** validated by the method — the platform
  validates against `EMBEDDING_DIMENSIONS` at install time.

File-based base classes implement the method by default (see
[Base-class Default](#base-class-default)). DB-backed base classes
(`DtNeo4jOpaModule`, `DtNeo4jJsonModule`, `DtLgModule`) do not — pre-
computed vectors on DB-backed modules would require a separate ingestion
path and are out of scope for v1.

## File Layout

Vectors live inside each class directory. One file per model:

**V2 / OPA layout (`DtFileOpaModule`):**
```
data/{moduleName}/
└── {classType}/                  # component | dataFlow | securityBoundary | control | data
    └── {classDir}/
        ├── class.json            # existing class definition
        ├── policies.rego         # existing
        └── embeddings/           # this feature
            └── {modelSlug}.json  # JSON array: [0.01, -0.02, …]
```

**JSON layout (`DtFileJsonModule`):**
```
data/{moduleName}/
└── {ClassTypeDir}/               # ComponentClasses | DataFlowClasses | …
    └── {classDir}/
        ├── metadata.json
        └── embeddings/
            └── {modelSlug}.json
```

File contents are a top-level JSON array of floats — no wrapper, no
metadata. The filename carries the model identity (slugified so forward
slashes, backslashes, and whitespace become `-`; e.g.
`sentence-transformers/all-MiniLM-L6-v2` →
`sentence-transformers-all-MiniLM-L6-v2.json`).

**Why per-class, not one big file:** class directories stay self-contained,
diffs are reviewable per class, and authors can regenerate a single
class without touching the others.

## Base-class Default

`DtFileOpaModule` and `DtFileJsonModule` both instantiate an
`EmbeddingFileCache` in their constructor and implement `getEmbedding()`
by delegating to `cache.get(className, modelSlug)`.

### `EmbeddingFileCache`

[`packages/dt-module/src/embedding-file-cache.ts`](../../../packages/dt-module/src/embedding-file-cache.ts)

Behavior:
- Lazy per-model walk: on first lookup for a given model slug, walks the
  class-type directories, reads the class-definition file to get the
  canonical `name`, and loads the matching `embeddings/{slug}.json`.
- Builds an in-memory `Map<className, number[]>` per model; subsequent
  lookups are O(1) with no I/O.
- Returns `null` when the vector file is missing, malformed, oversized
  (> 8192 dims — a sanity bound), or contains non-finite / non-numeric
  entries.

Constructor:
```typescript
new EmbeddingFileCache({
  moduleDataDir: string,         // already includes the {moduleName} segment
  classTypeDirs: string[],       // ['component', …] or ['ComponentClasses', …]
  classDefinitionFile: 'class.json' | 'metadata.json',
  logger?: { warn: (msg: string, meta?: object) => void },
})
```

`DtFileJsonModule` has no NestJS `Logger`; the helper falls back to
`console.warn` when no logger is provided.

### Security invariants

- `className` is only ever used as a `Map` key. It is never joined into
  a filesystem path. Directory names (controlled by the module author
  at pack time) are the only path segments.
- The model name is always slugified via `slugifyModelName` before being
  used as a filename segment, so path-traversal via `EMBEDDING_MODEL`
  env values containing `/` or `\` is not possible.
- Values read from JSON (notably `className`) are passed to the logger
  as structured metadata, never interpolated into format strings — no
  log-forging via newlines or ANSI.

## Platform Integration

Vector resolution runs **before** any write transaction so the embedding
HTTP fallback never holds Bolt locks across the network.

### `ModuleManagementService.resolveVectors()`

```typescript
resolveVectors(
  metadata: DTMetadata,
  moduleInstance?: DTModule,
): Promise<Map<string, number[]> | null>
```

Returns a map keyed by `className`; `null` means "embedding disabled,
write no embedding property." Runs off the write tx — no DB writes.

Algorithm:

1. Snapshot `embeddingService.isEnabled()` into a local. All downstream
   checks within this invocation read the local, so a mid-call flip does
   not affect the current module.
2. If the snapshot is false, return `null`. Pre-computed vectors shipped
   by the module are **ignored** in this mode — the platform isn't
   configured for vector similarity, writing embedding properties would
   be inconsistent.
3. `await matchClassesResolverService.ensureVectorIndexes()`. That
   method creates the vector indexes on first call and projects their
   `dimension` from `CALL vector_search.show_index_info()` for a
   cross-check against `embeddingService.getDimensions()`. On mismatch
   it calls `embeddingService.disableForSession(reason)` — the re-
   snapshotted `isEnabled()` below then returns false. On Memgraph
   versions that don't project `dimension`, a single warn is logged and
   the check is skipped (no fail-open into wrong-dim writes).
4. Re-snapshot `isEnabled()` in case step 3 flipped the flag.
5. Slugify the configured model (`slugifyModelName(getModel())`). If the
   model string is empty, skip the per-class `getEmbedding(className, "")`
   calls and treat every class as missing.
6. For each class, call
   `moduleInstance?.getEmbedding?.(cls.name, modelSlug) ?? null`
   (undefined is coerced to null because optional chaining returns
   undefined). Dimension-check the returned vector; mismatched vectors
   are warned-on and treated as missing.
7. Batch-embed only the missing classes via `embeddingService.embedBatch()`.
   On failure, throw — the caller's per-module try/catch decides whether
   to skip the module.
8. Return the merged map.

### `upsertModule` signature

```typescript
async upsertModule(
  tx: DatabaseTransaction,
  metadata: DTMetadata,
  options: ModuleOperationOptions = {},
  vectors?: Map<string, number[]> | null,
): Promise<UpsertResult>
```

Vectors are pre-resolved by the caller and keyed by class name. When
`vectors` is `null` or `undefined`, the per-class upsert writes no
`embedding` property (equivalent to the pre-feature "embedding disabled"
behavior).

**Why keyed, not array-indexed:** `upsertModule` builds `allClasses` by
flattening the module's class types in a specific order. An index-based
`(number[] | undefined)[]` handoff would force `resolveVectors` to
reproduce that order exactly; any future reordering would silently assign
vectors to the wrong classes. A `Map<className, number[]>` eliminates
that coupling.

### `updateAllModules` — Phase A / Phase B

Bulk install splits into two phases to keep HTTP off the write tx:

```typescript
// Phase A — offline. Per-module try/catch: a failing module is logged
// and skipped; other modules still install. Mirrors the in-tx catch
// semantic the code had before this feature.
const resolved = new Map<string, {metadata, vectors}>();
for (const [name, instance] of modules) {
  try {
    const metadata = await instance.getMetadata();
    const vectors = await this.resolveVectors(metadata, instance);
    resolved.set(name, { metadata, vectors });
  } catch (err) {
    errorCount++;
    logger.error('Failed to resolve vectors', { moduleName: name, error: err.message });
  }
}

// Phase B — single write tx, no HTTP. Per-module try/catch retained
// for symmetry with Phase A.
await session.executeWrite(async (tx) => {
  for (const [name, { metadata, vectors }] of resolved) {
    try {
      await this.upsertModule(tx, metadata, options, vectors);
      this.logEmbeddingStats(name, vectors, metadata);
    } catch (err) { errorCount++; logger.error(…); }
  }
  if (modulesInstalled.length > 0) await this.deleteOldModules(tx, modulesInstalled);
});
```

Per-module isolation is preserved (this is the same semantic as before
the feature): a single broken module does not roll back siblings. A
Phase-A failure for every module leaves Phase B's loop empty and
`deleteOldModules` is **not** called — the same "nothing to promote,
don't clean up" behavior as before.

### `resetSingleModule`

User-triggered resets pre-resolve outside `executeWrite` and **throw on
failure** (no per-module catch). Error semantics differ from bulk on
purpose: a user waiting on a mutation response gets the error; a bulk
startup install continues through skippable failures.

### `upsertClass` — stale vector cleanup

```cypher
MERGE (t:{Label} {id: $nodeProperties.id})
SET t += $nodeProperties
{REMOVE t.embedding, t.embeddingModel if no vector}
RETURN t
```

When `vectors?.get(cls.name)` is absent, the `REMOVE` clause is appended
to the Cypher so the class node's `embedding` / `embeddingModel`
properties are dropped. Without this, `SET t += $nodeProperties` would
leave stale vectors from a previous install — after a model switch,
file deletion, per-class dim mismatch, or mid-lifetime embedding-
disable. `match_classes` would then silently score against the stale
vectors.

### Class-text normalization

`EmbeddingService.composeClassText()` pins the format:

```
"{name}. {description}. Category: {category}. Type: {type}."
```

`DtFileOpaModule.getMetadata()` normalizes `type` before it reaches
`composeClassText` (component types upper-cased, non-component types
overridden via `FORCED_TYPES`). The CLI applies the identical
normalization via `normalizeClassType` so build-time and install-time
text are byte-equal. The shared
[`embedding-text.ts`](../../../packages/dt-module/src/embedding-text.ts)
module owns both helpers; runtime and CLI import from the same file.

### Session-level embedding disable

`EmbeddingService.enabled` is mutable (not `readonly`). The dim-mismatch
path in `ensureVectorIndexes` calls
`embeddingService.disableForSession(reason)`, which flips the flag,
logs once, and causes all subsequent `isEnabled()` reads to return
false. The flag is process-scoped and not flipped back on — a misconfig
requires a restart to recover, which is the intended safety behavior.

## CLI — `module-manager embed`

```bash
./scripts/module-manager.sh embed <module-path> \
  --model <model-name> \
  --url <embedding-endpoint> \
  [--api-key <key>] \
  [--batch-size <n>]
```

Modules ship a `pnpm embed` alias that reads `EMBEDDING_MODEL` and
`EMBEDDING_URL` from the environment; see
[DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md#pre-computed-embeddings-optional).

### Behavior

1. Reads `manifest.json` for the module `name`, then walks
   `<module-path>/data/<name>/` — always the **source tree**, never
   `dist/` or installed `custom_modules/`.
2. Auto-detects layout (OPA `component/class.json` vs JSON
   `ComponentClasses/metadata.json`). Errors out if both are present.
3. For each class, reads `{ name, description, category, type }` from
   the class-definition file.
4. Normalizes `type` via `normalizeClassType` (OPA only — JSON layout
   mirrors `DtFileJsonModule.getMetadata`, which doesn't normalize).
5. Composes embedding text via the shared `composeClassText` — byte-
   equal to what the runtime would produce.
6. Batches the texts at `--batch-size` (default 128) and POSTs to the
   endpoint. Chunking is mandatory, not optional: OpenAI caps around 2048
   inputs, Ollama is RAM-bounded, and the motivating scenario is 1000-
   class modules.
7. Parses the response via the shared `parseEmbeddingResponse` —
   supports OpenAI (`{data: [{embedding}]}`), Ollama `/api/embed`
   (`{embeddings: [...]}`), and Ollama legacy `/api/embeddings`
   (`{embedding: [...]}`) formats.
8. Writes each vector to `{classDir}/embeddings/{modelSlug}.json`,
   creating the `embeddings/` directory if needed.

### What the CLI does NOT do

- No retries on HTTP errors. Build-time tools fail loudly; rerun after
  fixing the endpoint.
- No dimension validation against an expected value. The platform
  validates at install time.
- No stale-file cleanup for removed classes. `rm -rf` the module's
  `embeddings/` directories before regenerating if class names churn.
- Does not instantiate the compiled module. The CLI reads JSON files
  directly — `DtFileOpaModule`/`DtFileJsonModule` constructors need a
  live Bolt driver, and `getMetadata()` triggers a background OPA
  reset. The CLI must run with no services available.

### Shared helpers

[`packages/dt-module/src/embedding-text.ts`](../../../packages/dt-module/src/embedding-text.ts)
exports `composeClassText`, `parseEmbeddingResponse`,
`slugifyModelName`, and `normalizeClassType`. Both `EmbeddingService`
(in dt-ws) and the CLI (in scripts) import from this one file. The
sub-path export `@dethernety/dt-module/embedding` keeps the HTTP
response parser out of the `dt-ui` bundle.

**Layering:** `oss/scripts/` cannot depend on `dt-ws`; it depends on
`@dethernety/dt-module`. The shared-helper extraction is what makes the
CLI feasible without duplicating text composition logic.

## Packaging

`oss/scripts/package-module.js` copies the module's `data/` tree via
`copyDirRecursive`; `embeddings/` subdirectories are picked up
automatically. The packager is unchanged by this feature.

A unit test in
[`apps/dt-ws/src/__tests__/package-module-embeddings.spec.ts`](../../../apps/dt-ws/src/__tests__/package-module-embeddings.spec.ts)
locks in that behavior: it scaffolds a fixture module with a pre-
computed vector, invokes the packager, and asserts `tar -tzf` on the
archive contains the embedding entry.

**Legacy cypher/csv packager branch** (`.cypher` / `.csv` at the top of
`data/`) only copies those files and does not include `embeddings/`.
Modules packaged via that branch cannot ship pre-computed embeddings.
`DtFileJsonModule` modules must be packaged via the recursive-subdir
branch.

## Multi-model Support

A module can ship vectors for multiple models at once:

```
data/{moduleName}/component/postgresql-database/embeddings/
├── nomic-embed-text.json
├── text-embedding-3-small.json
└── bge-large-en.json
```

At install time the platform asks for exactly one model (the one
`EMBEDDING_MODEL` specifies). The cache loads only that model's files;
the others stay on disk, ready if the deployment is reconfigured later.

**Changing `EMBEDDING_MODEL` requires a `dt-ws` restart.** The per-process
cache is keyed by model slug and is not invalidated at runtime.
Reinstalling the module after a restart re-resolves vectors against the
new model — classes without a matching file fall back to on-the-fly,
and `upsertClass`'s REMOVE clause clears stale vectors from the old
model.

## Failure Semantics

| Condition | Behavior |
|-----------|----------|
| All vectors pre-computed, endpoint unreachable | Install succeeds. Zero HTTP calls. |
| Some vectors pre-computed, endpoint unreachable | `resolveVectors` throws on the missing-class batch; per-module catch skips the module. |
| Pre-computed vector wrong dimension | Warn logged; that class embedded on the fly; others unaffected. |
| Model mismatch (module ships for A, platform configured for B) | All classes fall through to on-the-fly. No error. |
| Embedding disabled in platform, module ships vectors | Vectors ignored; no `embedding` property written. |
| Reinstall after `EMBEDDING_MODEL` switch | Classes without a vector for the new model have `embedding` / `embeddingModel` **removed** via the REMOVE clause. No stale data. |
| Malformed `{slug}.json` (non-array, non-finite, oversized) | Cache warns with the vector path as metadata and treats the class as missing. |
| `EMBEDDING_DIMENSIONS` ≠ vector index dimension at bootstrap | `disableForSession` flips the flag; install proceeds with no embedding property written; error logged once. |
| `updateAllModules` — every module's `resolveVectors` throws | All modules skipped; Phase B loop empty; `deleteOldModules` **not** called; `errorCount === modules.size`. |
| `resetSingleModule` — endpoint unreachable | Throws to caller (not swallowed). Distinct from bulk semantic. |
| Memgraph version that doesn't project `dimension` from `show_index_info()` | Single warn logged; cross-check skipped; embedding stays enabled (no fail-open-into-wrong-dim — the check was attempted but not authoritative on this version). |

## Non-goals

- **Replacing the on-the-fly embedding path.** Modules may still ship
  without vectors; legacy modules install unchanged.
- **Automatic regeneration on `pnpm build`.** Would couple the build to
  the network and defeat the whole point. Regeneration is an explicit
  author action (`pnpm embed`).
- **Content-hash sidecar to detect text drift.** Deferred — the shared
  `composeClassText` helper plus the CLI-runtime byte-equality at the
  source close most of the drift risk. Revisit if production evidence
  justifies it. The file format is frozen plain-array JSON for v1.
- **DB-backed modules.** `DtNeo4jOpaModule` / `DtNeo4jJsonModule` /
  `DtLgModule` store classes in the graph; where pre-computed vectors
  would come from is a separate design. v1 is file-based modules only.
- **Cross-module vector sharing.** Each module owns its own vectors.
