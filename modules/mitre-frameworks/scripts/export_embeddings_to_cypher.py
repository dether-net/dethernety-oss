#!/usr/bin/env python3
"""
Export MITRE ATT&CK, D3FEND and ATLAS vector embeddings to Cypher (Memgraph HNSW path).

Generates `data/05-mitre-embeddings.cypher` (ATT&CK techniques and mitigations, D3FEND
techniques) and `data/09-atlas-embeddings.cypher` (ATLAS techniques and mitigations).
Consumed by the mitre-frameworks module install path; each file UNWIND-batches
`embedding` + `embeddingModel` SETs onto the MITRE nodes already created by the node
files that sort before it (01/02 and 06).

The runtime side is `MatchMitreTechniquesResolverService` in dt-ws — it reads
the `embeddingModel` property on each MITRE node to gate the model-coherence precheck and
the `embedding` property as the source vector for HNSW similarity search.

Provider selection lives in embedding_provider.py:
  - default: Ollama + embeddinggemma (768-dim), skipped gracefully when unreachable
  - override (EMBEDDING_PROVIDER): ollama / sentence-transformers / openai / fixture

All-or-nothing failure mode: partial vector coverage is
worse than no coverage (the model-coherence precheck would still see total > 0 but
withModel < total → NO_VECTORS). The script writes to a temp path and renames
atomically only after every batch succeeds. The idempotency cache is updated
only on full success.
"""

from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from neo4j import GraphDatabase  # type: ignore[import-untyped]

# Local-relative imports (script directory is on sys.path).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_text import (  # noqa: E402
    compose_mitigation_text,
    compose_technique_text,
    normalize_for_embedding,
    slugify_model_name,
)
from embedding_provider import EmbeddingProvider, select_provider  # noqa: E402

# Environment variables.
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "password")

# Tuning.
EMBED_BATCH_SIZE = 100         # max texts per embedding call
UNWIND_CHUNK_SIZE = 200        # max rows per emitted UNWIND statement


# ---------------------------------------------------------------------------
# Cypher queries (mirrored from the deterministic-tactic projection)
# ---------------------------------------------------------------------------
# The deterministic-tactic guarantee comes from the ORDER BY inside the inner WITH,
# which fixes the order of names BEFORE collect(DISTINCT). The outer key
# (n.attack_id / n.d3fendId here vs n.id in the runtime resolver) is a partition hint —
# both forms yield the same `tactics[0]` selection because the per-n tactic ordering is
# what drives the pick. The build script uses the user-visible id (attack_id/d3fendId)
# so the queries are more semantically honest standalone; the runtime resolver uses the
# internal n.id because it had no need to be operator-readable.
#
# ATT&CK techniques order by MATRIX POSITION, not by name. A multi-tactic technique's
# embedded `Tactic:` should be the earliest kill-chain stage it belongs to, which is a
# real property of the technique; alphabetical order is an accident of the names. v19
# made the difference impossible to ignore: renaming Defense Evasion to Stealth moved
# 185 of 674 techniques' alphabetical pick, and for 66 of them the new pick is an
# unrelated tactic (Privilege Escalation, Execution, …) chosen by nothing but spelling.
# `matrix_order` is stamped at ingest from the bundle's own ordered `tactic_refs`, so
# this needs no transcribed copy of the sequence and follows MITRE when it changes.
#
# D3FEND keeps name ordering: its tactics carry no matrix_order (D3FEND has its own
# ordering concept, and v19 did not restructure it), so there is nothing better to key on.

ATTACK_TECHNIQUE_QUERY = """
MATCH (n:MitreAttackTechnique)
OPTIONAL MATCH (n)<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAttackTactic)
WITH n, tac ORDER BY n.attack_id ASC, tac.matrix_order ASC, tac.name ASC
WITH n, collect(DISTINCT tac.name) AS tactics
RETURN n.attack_id AS mitre_id, n.name AS name, n.description AS description,
       CASE WHEN size(tactics)=0 THEN null ELSE tactics[0] END AS tactic
ORDER BY n.attack_id ASC
"""

ATTACK_MITIGATION_QUERY = """
MATCH (n:MitreAttackMitigation)
RETURN n.attack_id AS mitre_id, n.name AS name, n.description AS description, null AS tactic
ORDER BY n.attack_id ASC
"""

# ATLAS techniques pick their tactic as ATT&CK's do: the earliest by the matrix position
# stamped at ingest. ATLAS tactics and case studies are not embedded, as ATT&CK tactics
# and campaigns are not.
ATLAS_TECHNIQUE_QUERY = """
MATCH (n:MitreAtlasTechnique)
OPTIONAL MATCH (n)<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAtlasTactic)
WITH n, tac ORDER BY n.atlas_id ASC, tac.matrix_order ASC, tac.name ASC
WITH n, collect(DISTINCT tac.name) AS tactics
RETURN n.atlas_id AS mitre_id, n.name AS name, n.description AS description,
       CASE WHEN size(tactics)=0 THEN null ELSE tactics[0] END AS tactic
ORDER BY n.atlas_id ASC
"""

ATLAS_MITIGATION_QUERY = """
MATCH (n:MitreAtlasMitigation)
RETURN n.atlas_id AS mitre_id, n.name AS name, n.description AS description, null AS tactic
ORDER BY n.atlas_id ASC
"""

DEFEND_TECHNIQUE_QUERY = """
MATCH (n:MitreDefendTechnique)
OPTIONAL MATCH (n)-[:ENABLES]->(tac:MitreDefendTactic)
WITH n, tac ORDER BY n.d3fendId ASC, tac.name ASC
WITH n, collect(DISTINCT tac.name) AS tactics
RETURN n.d3fendId AS mitre_id, n.name AS name, n.description AS description,
       CASE WHEN size(tactics)=0 THEN null ELSE tactics[0] END AS tactic
ORDER BY n.d3fendId ASC
"""


# ---------------------------------------------------------------------------
# Cypher emission helpers
# ---------------------------------------------------------------------------


def cypher_string_literal(value: str) -> str:
    """
    Emit a Cypher double-quoted string literal with the same escape discipline
    used by export_to_cypher.py:escape_cypher_string()'s string branch:
    backslash, double-quote, and CR/LF/TAB collapsed to space.

    Scope: suitable for STIX-sourced identifiers (attack_id/d3fendId,
    MITRE-style ASCII) and operator-controlled model names. Adversarial Unicode
    line separators (U+2028/U+2029) and NUL are NOT specially handled here —
    Memgraph's openCypher implementation tolerates them inside strings today,
    and STIX/OWL sources don't carry them in practice.
    """
    s = str(value)
    # Backslash MUST be replaced first.
    s = s.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    # Defense-in-depth: never let stray newlines/tabs reach the Cypher parser.
    # Mitre IDs and model names don't carry these in practice, but the helper
    # is generic.
    s = s.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    return f'"{s}"'


def format_float(x: float) -> str:
    """
    Render a float as a Cypher numeric literal.

    repr() gives shortest-round-trip rendering: 0.0001 → '0.0001', 1e-05 → '1e-05'.
    Memgraph parses both forms as float literals. nan/inf are not valid floats
    for our embedding payload; raise loudly if encountered.
    """
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError(f"non-finite float in embedding vector: {x!r}")
    return repr(x)


def format_embedding(vector: List[float]) -> str:
    return "[" + ", ".join(format_float(x) for x in vector) + "]"


# ---------------------------------------------------------------------------
# Idempotency cache
# ---------------------------------------------------------------------------


class FingerprintCache:
    """
    Per-model fingerprint → vector cache. Lives at
    data/.embedding-cache/<model-slug>.json. Read on startup, written only on
    successful full export.
    """

    def __init__(self, cache_path: Path):
        self._path = cache_path
        self._data: Dict[str, List[float]] = {}
        if self._path.exists():
            try:
                with self._path.open("r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except Exception as err:  # noqa: BLE001
                # A corrupt cache should not break the build — start fresh.
                print(
                    f"[warn] embedding cache at {self._path} is unreadable, ignoring: {err}",
                    file=sys.stderr,
                )
                self._data = {}

    def get(self, fingerprint: str) -> Optional[List[float]]:
        return self._data.get(fingerprint)

    def put(self, fingerprint: str, vector: List[float]) -> None:
        self._data[fingerprint] = list(vector)

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(self._data, f)
        os.replace(tmp, self._path)

    def size(self) -> int:
        return len(self._data)


def fingerprint_for(mitre_id: str, model_name: str, dimensions: int, text: str) -> str:
    """
    Hash key for the idempotency cache.

    Includes dimensions to invalidate the cache when a Matryoshka model
    (same model_name, different dim) is selected via EMBEDDING_DIMENSIONS.

    NOTE: the task prefix ('search_document: ' for nomic, none for OpenAI) is
    applied INSIDE the provider's .embed() call AFTER fingerprint computation.
    Any change to the prefix invalidates the semantic meaning of cached vectors
    but NOT this fingerprint. Mitigation: changing the prefix must be paired
    with bumping model_name (e.g. 'nomic-embed-text' → 'nomic-embed-text-v2').
    The composer format is already pinned for the same reason.
    """
    payload = f"{mitre_id}|{model_name}|{dimensions}|{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Corpus fetch
# ---------------------------------------------------------------------------


def fetch_corpus(driver, query: str, label: str) -> List[Dict[str, Any]]:
    """Run a corpus query and return a list of record dicts. Skips rows without mitre_id."""
    out: List[Dict[str, Any]] = []
    with driver.session() as session:
        result = session.run(query)
        for record in result:
            mid = record["mitre_id"]
            if mid is None:
                continue
            out.append(
                {
                    "mitre_id": mid,
                    "name": record["name"] or "",
                    "description": record["description"],
                    "tactic": record["tactic"],
                }
            )
    print(f"[info] {label}: {len(out)} nodes fetched")
    return out


# ---------------------------------------------------------------------------
# Embedding (batched + retried)
# ---------------------------------------------------------------------------


def embed_batch_with_provider(
    provider: EmbeddingProvider, texts: List[str]
) -> List[List[float]]:
    """
    Embed a batch and validate dimensions. The provider's own retry/backoff
    runs internally where applicable (HTTP providers); local providers raise
    immediately. The script aborts on RuntimeError per all-or-nothing policy.
    """
    vectors = provider.embed(texts)
    if len(vectors) != len(texts):
        raise RuntimeError(
            f"provider returned {len(vectors)} vectors for {len(texts)} inputs"
        )
    for i, v in enumerate(vectors):
        if len(v) != provider.dimensions:
            raise RuntimeError(
                f"vector {i} has length {len(v)}, expected {provider.dimensions}"
            )
    return vectors


def embed_with_cache(
    provider: EmbeddingProvider,
    items: List[Dict[str, Any]],
    cache: FingerprintCache,
    kind_label: str,
) -> Tuple[List[List[float]], int, int]:
    """
    Compose text per item, look up in cache, embed misses in batches.
    Returns (vectors aligned with items, cache_hits, cache_misses).
    All-or-nothing: any provider failure raises and aborts.
    """
    fingerprints: List[str] = []
    cached: List[Optional[List[float]]] = []
    miss_texts: List[str] = []
    miss_indices: List[int] = []

    for idx, item in enumerate(items):
        text = item["embedding_text"]
        fp = fingerprint_for(
            item["mitre_id"], provider.model_name, provider.dimensions, text
        )
        fingerprints.append(fp)
        hit = cache.get(fp)
        if hit is not None:
            cached.append(hit)
        else:
            cached.append(None)
            miss_texts.append(text)
            miss_indices.append(idx)

    print(
        f"[info] {kind_label}: {len(items)} items "
        f"({len(items) - len(miss_texts)} cache-hit, {len(miss_texts)} embed)"
    )

    # Embed misses in batches; per-batch retry happens inside provider.embed for HTTP providers.
    miss_vectors: List[List[float]] = []
    for batch_start in range(0, len(miss_texts), EMBED_BATCH_SIZE):
        batch = miss_texts[batch_start : batch_start + EMBED_BATCH_SIZE]
        batch_num = batch_start // EMBED_BATCH_SIZE + 1
        total_batches = (len(miss_texts) + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE
        if batch:
            print(
                f"[info] {kind_label}: embedding batch {batch_num}/{total_batches} ({len(batch)} texts)"
            )
            try:
                vectors = embed_batch_with_provider(provider, batch)
            except Exception as err:  # noqa: BLE001
                # All-or-nothing: surface the offending mitre_id and bail.
                first_failing_idx = miss_indices[batch_start]
                first_failing_id = items[first_failing_idx]["mitre_id"]
                raise RuntimeError(
                    f"embedding failed at batch starting with {first_failing_id}: {err}"
                ) from err
            miss_vectors.extend(vectors)

    # Stitch back together.
    final: List[List[float]] = []
    miss_iter = iter(zip(miss_indices, miss_vectors))
    next_miss = next(miss_iter, None)
    for idx in range(len(items)):
        if cached[idx] is not None:
            final.append(cached[idx])  # type: ignore[arg-type]
        else:
            if next_miss is None or next_miss[0] != idx:
                raise RuntimeError(
                    f"internal: miss-vector alignment failure at index {idx}"
                )
            final.append(next_miss[1])
            # Stage cache update; commit only on full success at end of run.
            cache.put(fingerprints[idx], next_miss[1])
            next_miss = next(miss_iter, None)

    return final, len(items) - len(miss_texts), len(miss_texts)


# ---------------------------------------------------------------------------
# Cypher emission (UNWIND-batched, label-aware)
# ---------------------------------------------------------------------------


def write_unwind_chunks(
    f,
    items: List[Dict[str, Any]],
    vectors: List[List[float]],
    label: str,
    id_field: str,
    model_name: str,
) -> int:
    """
    Emit a sequence of UNWIND statements (UNWIND_CHUNK_SIZE rows each) that SET
    embedding + embeddingModel on the matched MITRE nodes.

    Unconditional overwrite is intentional: the model-coherence precheck rejects on
    MODEL_MISMATCH (mixed embeddingModel values across nodes), so a partial
    overwrite from an aborted re-install would silently degrade the runtime
    vector tier. The exporter's all-or-nothing temp+rename + cache-on-success
    semantics ensure no partial overwrite ever reaches the cypher file.
    Returns the number of rows emitted.
    """
    n = len(items)
    written = 0
    for chunk_start in range(0, n, UNWIND_CHUNK_SIZE):
        chunk_items = items[chunk_start : chunk_start + UNWIND_CHUNK_SIZE]
        chunk_vectors = vectors[chunk_start : chunk_start + UNWIND_CHUNK_SIZE]

        f.write("UNWIND [\n")
        for i, (item, vec) in enumerate(zip(chunk_items, chunk_vectors)):
            sep = "," if i < len(chunk_items) - 1 else ""
            mitre_id_lit = cypher_string_literal(item["mitre_id"])
            f.write(
                f"  {{ {id_field}: {mitre_id_lit}, embedding: {format_embedding(vec)} }}{sep}\n"
            )
        f.write("] AS row\n")
        f.write(f"MATCH (n:{label} {{{id_field}: row.{id_field}}})\n")
        f.write("SET n.embedding = row.embedding,\n")
        f.write(f"    n.embeddingModel = {cypher_string_literal(model_name)};\n\n")
        written += len(chunk_items)
    return written


def write_cypher_file(
    out_path: Path,
    provider: EmbeddingProvider,
    sections: List[Tuple[str, str, List[Dict[str, Any]], List[List[float]]]],
) -> Path:
    """
    Serialize one embeddings file to a temp path next to out_path and fsync it.
    `sections` is [(label, id_field, items, vectors), ...]. Returns the temp path; the
    caller renames every file only after all of them are written, so a failure leaves
    no file changed. The temp file is removed on any exception before propagation.
    """
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            f.write(
                f"// Generated by mitre-frameworks export_embeddings_to_cypher.py "
                f"at {dt.datetime.now(dt.timezone.utc).isoformat()}\n"
            )
            f.write(
                f"// Model: {provider.model_name}  Dimensions: {provider.dimensions}\n"
            )
            f.write("// Source: mitre-frameworks build\n\n")

            for label, id_field, items, vectors in sections:
                write_unwind_chunks(
                    f,
                    items,
                    vectors,
                    label=label,
                    id_field=id_field,
                    model_name=provider.model_name,
                )
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        # All-or-nothing: leave NO partial artifact behind.
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        raise
    return tmp_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def prepare_items_with_text(
    items: List[Dict[str, Any]], kind: str
) -> None:
    """
    In place: add normalized name/description/tactic + the composed embedding text.
    """
    for item in items:
        name = normalize_for_embedding(item["name"])
        desc = normalize_for_embedding(item["description"])
        tactic = normalize_for_embedding(item["tactic"]) if item["tactic"] is not None else None
        item["name"] = name
        item["description"] = desc
        item["tactic"] = tactic
        if kind == "mitigation":
            item["embedding_text"] = compose_mitigation_text(name, desc or None)
        else:
            item["embedding_text"] = compose_technique_text(
                name, desc or None, tactic or None
            )


# (output file, selection, label, id field, query, kind, display name). Within a file the
# sections are written in this order.
CORPUS = [
    ("05-mitre-embeddings.cypher", "attack-defend", "MitreAttackTechnique", "attack_id",
     ATTACK_TECHNIQUE_QUERY, "technique", "ATT&CK techniques"),
    ("05-mitre-embeddings.cypher", "attack-defend", "MitreDefendTechnique", "d3fendId",
     DEFEND_TECHNIQUE_QUERY, "technique", "D3FEND techniques"),
    ("05-mitre-embeddings.cypher", "attack-defend", "MitreAttackMitigation", "attack_id",
     ATTACK_MITIGATION_QUERY, "mitigation", "ATT&CK mitigations"),
    ("09-atlas-embeddings.cypher", "atlas", "MitreAtlasTechnique", "atlas_id",
     ATLAS_TECHNIQUE_QUERY, "technique", "ATLAS techniques"),
    ("09-atlas-embeddings.cypher", "atlas", "MitreAtlasMitigation", "atlas_id",
     ATLAS_MITIGATION_QUERY, "mitigation", "ATLAS mitigations"),
]
FRAMEWORK_SELECTIONS = {"all": {"attack-defend", "atlas"}, "atlas": {"atlas"}}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export MITRE ATT&CK, D3FEND and ATLAS embeddings to Cypher (Memgraph HNSW path)."
    )
    parser.add_argument(
        "--output-dir",
        default="./data",
        help="Output directory for the Cypher files (default ./data).",
    )
    parser.add_argument(
        "--frameworks",
        choices=sorted(FRAMEWORK_SELECTIONS),
        default="all",
        help="Files to write: all, or atlas (09 only, leaving 05 untouched).",
    )
    args = parser.parse_args()
    selected = [row for row in CORPUS if row[1] in FRAMEWORK_SELECTIONS[args.frameworks]]

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    # Provider selection. None → graceful skip with warning + zero exit.
    try:
        provider = select_provider()
    except ValueError as err:
        print(f"[error] {err}", file=sys.stderr)
        return 1

    if provider is None:
        print(
            "[warn] MITRE Memgraph embeddings not generated — the committed "
            "05-mitre-embeddings.cypher and 09-atlas-embeddings.cypher (if present) stay "
            "authoritative, else the picker falls back to text matching at runtime. The "
            "default provider is Ollama + embeddinggemma; start Ollama and `ollama pull "
            "embeddinggemma`, or set EMBEDDING_PROVIDER (ollama, sentence-transformers, "
            "openai, fixture).",
            file=sys.stderr,
        )
        return 0

    print(
        f"[info] using provider={type(provider).__name__} "
        f"model_name={provider.model_name!r} dimensions={provider.dimensions}"
    )

    cache_dir = output_dir / ".embedding-cache"
    cache_path = cache_dir / f"{slugify_model_name(provider.model_name)}.json"
    cache = FingerprintCache(cache_path)
    print(f"[info] cache: {cache_path} ({cache.size()} entries on startup)")

    start = time.time()
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    try:
        corpora = [fetch_corpus(driver, row[4], row[6]) for row in selected]
    finally:
        driver.close()

    # A selected kind with no nodes would ship a file that silently covers less than
    # the graph the picker checks it against.
    empty = [row[6] for row, items in zip(selected, corpora) if not items]
    if empty:
        print(
            f"[error] no nodes for {', '.join(empty)} in Memgraph — did you run ingest.py first?",
            file=sys.stderr,
        )
        return 1

    results = []
    try:
        for row, items in zip(selected, corpora):
            prepare_items_with_text(items, kind=row[5])
            vectors, hits, misses = embed_with_cache(provider, items, cache, row[6])
            results.append((row, items, vectors, hits, misses))
    except RuntimeError as err:
        print(f"[error] {err}", file=sys.stderr)
        return 1

    # All-or-nothing across files: every file is written to a temp path first, and only
    # renamed once all of them exist.
    files: Dict[str, List[Tuple[str, str, List[Dict[str, Any]], List[List[float]]]]] = {}
    for row, items, vectors, _, _ in results:
        files.setdefault(row[0], []).append((row[2], row[3], items, vectors))
    written: List[Tuple[Path, Path]] = []
    try:
        for name, sections in files.items():
            out_path = output_dir / name
            print(f"[info] writing {out_path}")
            written.append((write_cypher_file(out_path, provider, sections), out_path))
    except Exception:
        for tmp_path, _ in written:
            tmp_path.unlink(missing_ok=True)
        raise
    for tmp_path, out_path in written:
        os.replace(tmp_path, out_path)

    # Cache write happens last — only on full success.
    cache.save()

    elapsed = time.time() - start
    print("=== Export complete ===")
    for row, items, _, hits, misses in results:
        print(f"  {row[6]}: {len(items)} ({hits} cache-hit, {misses} embedded) -> {row[0]}")
    total = sum(len(items) for _, items, _, _, _ in results)
    print(f"  Total nodes: {total}")
    print(f"  Cache size after run: {cache.size()}")
    print(f"  Elapsed: {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
