# Pre-computed Class Embeddings

How modules ship embedding vectors alongside class definitions so the
platform does not have to embed their classes at install time.

- [Overview](#overview)
- [Interface](#interface)
- [File Layout](#file-layout)
- [Base-class Default](#base-class-default)
- [Platform Integration](#platform-integration)
- [Producer — `module-manager embed`](#producer--module-manager-embed)
- [Packaging](#packaging)
- [Multi-model Support](#multi-model-support)
- [Failure Semantics](#failure-semantics)
- [Non-goals](#non-goals)

Author workflow: see
[DEVELOPMENT_GUIDE — Pre-computed Embeddings](./DEVELOPMENT_GUIDE.md#pre-computed-embeddings-optional).

---

## Overview

The `match_classes` vector tier (vector similarity) requires every class node to
carry an `embedding` property. By default the platform embeds every class
at install time via `EmbeddingService.embedBatch()`, with its in-process
embedder: the active embedding profile, each class embedded as a document
titled with its class name. For large modules that embedding dominates
install time — on a first start, every class of every module is embedded
once.

Pre-computed embeddings move vector generation to build time: the module
author ships vectors made with the platform's active embedding profile as
JSON files under each class directory, and the packager includes them in the
tarball. The `module-manager embed` producer makes them with the platform's
own embedder, and a CI check keeps them current (see
[Producer](#producer--module-manager-embed)).
At install the platform reads vectors from disk instead of embedding.
Mixed modules (some classes embedded, some not) and legacy
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
  validates it against the active profile's dimensions at install time.
- The platform asks only for the **active profile's** slug, so a vector is
  used only when it was filed under that profile's id. It must also have been
  made the way the profile embeds a class document (its document prompt,
  with the class name as the title); the platform cannot tell a vector made
  any other way, and would score it against query vectors it does not
  match.

The file-based base class implements the method by default (see
[Base-class Default](#base-class-default)). `DtLgModule` does not — its
analysis classes are derived from the LangGraph server rather than from
on-disk class definitions, so pre-computed vectors would require a
separate ingestion path and are out of scope for v1.

## File Layout

Vectors live inside each class directory. One file per model:

**V2 / OPA layout (`DtFileOpaModule`):**
```
data/{moduleName}/
└── {classType}/                  # component | dataFlow | securityBoundary | control | data | issue
    └── {classDir}/
        ├── class.json            # existing class definition
        ├── policies.rego         # existing
        └── embeddings/           # this feature
            └── {modelSlug}.json  # e.g. embeddinggemma-300m-retrieval-v1.json
```

**JSON layout:**
```
data/{moduleName}/
└── {ClassTypeDir}/               # ComponentClasses | DataFlowClasses | …
    └── {classDir}/
        ├── metadata.json
        └── embeddings/
            └── {modelSlug}.json
```

File contents are a `{ vector, contentHash }` object: `vector` is the array
of floats, `contentHash` is the SHA-256 of the class's composed embedding
text, stamped so the runtime cache can detect a vector left stale by an
un-regenerated text edit (see [Content-hash binding](#content-hash-binding)).
The producer also writes `profile` and `revision` (the profile's weights
revision) for the CI check; the platform reads only `vector` and
`contentHash`.
The reader also accepts a **legacy bare-array** file (a top-level JSON array,
the pre-hash format) and serves it unverified — so old caches keep working
with no mass recompute. The filename carries the model identity (slugified so
forward slashes, backslashes, and whitespace become `-`; e.g.
`sentence-transformers/all-MiniLM-L6-v2` →
`sentence-transformers-all-MiniLM-L6-v2.json`).

**Why per-class, not one big file:** class directories stay self-contained,
diffs are reviewable per class, and authors can regenerate a single
class without touching the others.

### Content-hash binding

Each `{ vector, contentHash }` file carries the SHA-256 of the class's composed
embedding text, so a vector left stale by an un-regenerated text edit (edit a
class `description` without re-running the CLI) is **detected** instead of
silently serving the old-text vector into similarity search.

The mechanism rests on one invariant: the writer's stamped hash and the cache's
recomputed hash must be **byte-identical**. Both sides route through the single
shared composer `classEmbeddingText(def, classTypeDir)`
(`composeClassText` + `normalizeClassType`) and hash it with `hashEmbeddingText`
— the writer over the raw `class.json` fields it read, the cache over the same
raw fields it reads at load time — so there is no second composition to drift
against. On a mismatch the cache treats the vector as a **miss** and the runtime
recomputes it on the fly.

The format is **additive and backward-compatible**: a legacy bare-array file
(the pre-hash format) has no hash and is served unverified, so existing caches
keep working and there is no mass recompute when this ships. Newly generated
files gain the hash and full staleness protection. (This supersedes the earlier
"deferred — frozen plain-array JSON for v1" position.)

## Base-class Default

`DtFileOpaModule` instantiates an `EmbeddingFileCache` in its
constructor and implements `getEmbedding()` by delegating to
`cache.get(className, modelSlug)`.

### `EmbeddingFileCache`

[`packages/dt-module/src/embedding-file-cache.ts`](../../../packages/dt-module/src/embedding-file-cache.ts)

Behavior:
- Lazy per-model walk: on first lookup for a given model slug, walks the
  class-type directories, reads the class-definition file (`name`,
  `description`, `category`, `type`), and loads the matching
  `embeddings/{slug}.json`.
- For a `{ vector, contentHash }` file, recomputes the class-text hash
  (`hashEmbeddingText(classEmbeddingText(def, classTypeDir))` — the same
  composer the writer used) and treats a mismatch as a **cache miss** so the
  vector is recomputed on the fly. A legacy bare-array file has no hash and is
  served as-is. A wrapper whose `contentHash` is missing or not a 64-char hex
  digest is rejected as corrupt (miss).
- Builds an in-memory `Map<className, number[]>` per model; subsequent
  lookups are O(1) with no I/O. `get()` returns a **copy** so a consumer that
  normalizes the vector in place cannot corrupt the shared cache.
- Returns `null` (a cache miss) when the vector file is missing, malformed,
  oversized (> 8192 dims — a sanity bound), zero-magnitude, or contains
  non-finite / non-numeric entries. `readVector` never throws — every failure
  degrades to a recompute.

Constructor:
```typescript
new EmbeddingFileCache({
  moduleDataDir: string,         // already includes the {moduleName} segment
  classTypeDirs: string[],       // ['component', …] or ['ComponentClasses', …]
  classDefinitionFile: 'class.json' | 'metadata.json',
  logger?: { warn: (msg: string, meta?: object) => void },
})
```

When no `Logger` is provided, the helper falls back to `console.warn`.

### Security invariants

- `className` is only ever used as a `Map` key. It is never joined into
  a filesystem path. Directory names (controlled by the module author
  at pack time) are the only path segments.
- The model name (the active profile id) is always slugified via
  `slugifyModelName` before being used as a filename segment, so
  path-traversal via a value containing `/` or `\` is not possible.
- Values read from JSON (notably `className`) are passed to the logger
  as structured metadata, never interpolated into format strings — no
  log-forging via newlines or ANSI.

## Platform Integration

Vector resolution runs **before** any write transaction so on-the-fly
embedding never holds Bolt locks while the embedder works.

### `ModuleManagementService.resolveVectors()`

```typescript
resolveVectors(
  metadata: DTMetadata,
  moduleInstance?: DTModule,
): Promise<Map<string, number[]> | null | 'pending'>
```

Returns a map keyed by `className`; `null` means "embedding disabled,
write no embedding property"; `'pending'` means "embedding enabled but the
embedder not ready yet (downloading, loading or failed): keep the stored
vectors and mark the install partial." Runs off the write tx — no DB writes.

Algorithm:

1. Snapshot `embeddingService.isEnabled()` into a local. All downstream
   checks within this invocation read the local, so a mid-call flip does
   not affect the current module.
2. If the snapshot is false, return `'pending'` when the embedder is
   enabled but not ready (`isPending()`), else `null`. Pre-computed vectors
   shipped by the module are **ignored** in both cases — with embedding off
   the platform isn't configured for vector similarity, and while the
   embedder is not ready the install keeps what the nodes hold and the
   catch-up reinstalls the module once it is ready.
3. Slugify the active profile id (`slugifyModelName(getModel())`).
4. For each class, call
   `moduleInstance?.getEmbedding?.(cls.name, modelSlug) ?? null`
   (undefined is coerced to null because optional chaining returns
   undefined). Dimension-check the returned vector, then check that it
   can be stored (`vectorDefect`: finite values, a non-zero norm). Both
   a vector of the wrong length and one of the right length that cannot
   be stored are warned-on and treated as missing; the latter is logged
   as `Pre-computed embedding cannot be stored; falling through to
   on-the-fly`, with the defect.
5. Batch-embed only the missing classes via
   `embeddingService.embedBatch(texts, 'document', classNames)`.
   On failure, throw — the caller's per-module try/catch decides whether
   to skip the module. The batch must return one storable vector per
   missing class: another number of vectors, or a vector that cannot be
   stored, throws too, so an install writes every class it declares a
   vector or fails.
6. Return the merged map.

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
behavior). When it is `'pending'`, the classes keep the vectors they have
and the module is recorded as installed partial; the Module node's
`embeddingProfile` (the embedder its vectors were made with) is left as it
was.

**Why keyed, not array-indexed:** `upsertModule` builds `allClasses` by
flattening the module's class types in a specific order. An index-based
`(number[] | undefined)[]` handoff would force `resolveVectors` to
reproduce that order exactly; any future reordering would silently assign
vectors to the wrong classes. A `Map<className, number[]>` eliminates
that coupling.

### `updateAllModules` — Phase A / Phase B

Bulk install splits into two phases to keep embedding off the write tx.
Phase A first applies the **skip gate**: an unchanged module (same content
hash, last install authoritative) whose Module node records the active
embedder (`embeddingProfile`: `<profile id>/<dimensions>`, or `off`) is
skipped; one recorded with another embedder is reinstalled, so its classes
are embedded with the active profile. With embedding on, the gate also
reads the classes' stored vectors: a module whose declared searchable
classes hold a vector of another profile, of another length, or none, is
reinstalled even under a matching record (see
[ModuleManagementService → The class vector check](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md#the-class-vector-check)).

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

// Phase B — one write tx per module, no embedding inside. A module whose
// write fails rolls back only its own tx.
for (const [name, { metadata, vectors }] of resolved) {
  try {
    await session.executeWrite((tx) => this.upsertModule(tx, metadata, options, vectors));
  } catch (err) { errorCount++; logger.error(…); }
}
// The obsolescence sweep runs in its own final tx (not in a catch-up).
```

Per-module isolation is preserved (this is the same semantic as before
the feature): a single broken module does not roll back siblings. A
Phase-A failure for every module leaves Phase B's loop empty. The sweep
still runs, but it protects every module present on disk this round, not
only those that installed, so a module that failed to resolve is never
treated as obsolete.

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

When `vectors?.get(cls.name)` is absent (and `vectors` is not
`'pending'`), the `REMOVE` clause is appended
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

### No vector index check at install

Embedding is on or off by configuration (`EMBEDDING_ENABLED`); nothing
switches it off for the rest of a process. Install does not check a
vector index dimension: class vectors are searched without a vector
index, so there is no index to create, check or repair before writing
them.

## Producer — `module-manager embed`

```bash
./scripts/module-manager.sh embed <module-path> [--models-dir <dir>] [--profile <id>] [--download] [--batch-size <n>]
./scripts/module-manager.sh embed-all <modules-root>... [--exclude <module-path>]... [options]
```

Modules ship a `pnpm embed` alias for the first form; see
[DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md#pre-computed-embeddings-optional)
for the flags and the author workflow. The embedder package must be built
first (`pnpm --filter @dethernety/embedder... build`).

**The producer embeds with the platform's profile.** It runs the platform's
own in-process embedder through `packages/embedder/bin/embed-documents.mjs`:
the profile (default: the platform's default,
`embeddinggemma-300m-retrieval-v1`), its document prompt with the class name
as the title, truncation and normalisation. It has no HTTP endpoint option:
an endpoint cannot reproduce the profile's prompt or model, so its vectors
would rank wrongly against the platform's query vectors.

### Behavior

1. Reads `manifest.json` for the module `name`, then walks the
   **source tree** `<module-path>/data/<name>/` (never `dist/` or installed
   `custom_modules/`): `component/`, `dataFlow/`, `securityBoundary/`,
   `control/`, `data/` and `issue/`, each class with a `class.json`.
2. Composes each class's text with the shared `classEmbeddingText`
   (`composeClassText` + `normalizeClassType`) and hashes it with
   `hashEmbeddingText`, byte-equal to what the runtime cache recomputes.
3. Skips a class whose file already holds the profile, its weights revision
   and the current hash. When none is left, the embedder is not started.
4. Embeds the rest in batches (`--batch-size`, default 16), after checking
   that the embedder runs the profile's id, weights revision, dimensions and
   title rule.
5. Writes `{ profile, revision, contentHash, vector }` to
   `{classDir}/embeddings/{profile id}.json`, creating `embeddings/` if
   needed. The platform reads `vector` and `contentHash`.

It does not instantiate the compiled module (the `DtFileOpaModule`
constructor needs a live Bolt driver, and `getMetadata()` registers every
policy in the Rego engine), and does not delete files for removed classes.

### CI check

`scripts/check-module-embeddings.mjs <modules-root>... [--exclude <path>]...`
applies the same rules as step 3, from the same source
(`scripts/lib/class-vectors.ts`). It fails when a class lacks its file, the
file is for another profile or weights revision, the vector is not the
profile's length of finite unit-norm values, the `contentHash` no longer
matches the class text, or any other embeddings file exists. A change to the
composer, the profile or the default profile id therefore fails the check
until the vectors are made again.

### Shared helpers

[`packages/dt-module/src/embedding-text.ts`](../../../packages/dt-module/src/embedding-text.ts)
exports `composeClassText`, `classEmbeddingText`, `hashEmbeddingText`,
`slugifyModelName`, and `normalizeClassType`. `EmbeddingService` (in dt-ws),
the producer and the CI check all use this one file, so the stamped and
recomputed hashes are byte-identical.

**Layering:** `oss/scripts/` cannot depend on `dt-ws`; it depends on
`@dethernety/dt-module` and `@dethernety/embedder`. The producer and the CI
check read the default profile id from its one definition in dt-ws's source.

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
File-based modules must be packaged via the recursive-subdir branch.

## Multi-model Support

The reader accepts vectors for several profiles at once, one file each:

```
data/{moduleName}/component/postgresql-database/embeddings/
├── embeddinggemma-300m-retrieval-v1.json
└── {other-profile-id}.json
```

The modules in this repository ship only the default profile's file; the CI
check rejects any other until a second profile ships vectors.

At install time the platform asks for exactly one model: the active
embedding profile, by the slug of its id. The cache loads only that model's files;
the others stay on disk, ready if the deployment is reconfigured later.

**Changing `EMBEDDING_MODEL` requires a `dt-ws` restart.** The per-process
cache is keyed by model slug and is not invalidated at runtime. At the
restart the skip gate sees a different embedder recorded on the Module node
(or, under a matching record, class vectors of another profile)
and reinstalls the module, which re-resolves vectors against the new
profile — classes without a matching file fall back to on-the-fly, and
`upsertClass`'s REMOVE clause clears stale vectors from the old model.

## Failure Semantics

| Condition | Behavior |
|-----------|----------|
| All vectors pre-computed for the active profile, embedder ready | Install succeeds. The embedder is not called. |
| Embedder not ready (downloading, loading, failed), with or without pre-computed vectors | `'pending'`: stored vectors kept, module installed partial; the catch-up reinstalls it when the embedder becomes ready. |
| Some vectors pre-computed, the missing-class batch throws | `resolveVectors` throws; per-module catch skips the module. |
| Pre-computed vector wrong dimension | Warn logged; that class embedded on the fly; others unaffected. |
| Pre-computed vector of the right dimension that cannot be stored (non-finite value, zero norm) | Warn logged with the defect; that class embedded on the fly; others unaffected. |
| The on-the-fly batch returns another number of vectors than classes, or a vector that cannot be stored | `resolveVectors` throws; per-module catch skips the module, which is left as it was. |
| Model mismatch (module ships for A, platform runs profile B) | All classes fall through to on-the-fly. No error. |
| Embedding disabled in platform, module ships vectors | Vectors ignored; no `embedding` property written. |
| Reinstall after `EMBEDDING_MODEL` switch (the skip gate forces it at the next start) | Classes without a vector for the new model have `embedding` / `embeddingModel` **removed** via the REMOVE clause. No stale data. |
| Malformed `{slug}.json` (non-array, non-finite, oversized) | Cache warns with the vector path as metadata and treats the class as missing. |
| `updateAllModules` — every module's `resolveVectors` throws | All modules skipped; Phase B loop empty; the sweep removes only modules no longer on disk; `errorCount === modules.size`. |
| `resetSingleModule` — the embedding batch throws | Throws to caller (not swallowed). Distinct from bulk semantic. |

## Non-goals

- **Replacing the on-the-fly embedding path.** Modules may still ship
  without vectors; legacy modules install unchanged.
- **Automatic regeneration on `pnpm build`.** Would couple the build to
  an embedder and defeat the whole point. Regeneration is an explicit
  author action (`pnpm embed`).
- **`DtLgModule`.** Its analysis classes are derived from the LangGraph
  server rather than from on-disk class definitions; where pre-computed
  vectors would come from is a separate design. v1 is file-based modules
  only.
- **Cross-module vector sharing.** Each module owns its own vectors.
