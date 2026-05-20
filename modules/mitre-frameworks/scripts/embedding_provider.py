"""
Embedding provider abstraction for the mitre-frameworks build pipeline.

Selected via the EMBEDDING_PROVIDER env var (explicit), or by auto-detecting
sentence-transformers when not set. Returns None if no provider is configured,
which causes export_embeddings_to_cypher.py to skip with a warning.

Provider precedence:
  1. Default — sentence-transformers with nomic-ai/nomic-embed-text-v1.5 (768-dim)
  2. Override — ollama via HTTP /api/embed
  3. Override — OpenAI text-embedding-3-small (1536-dim)
  4. CI       — fixture (deterministic, hash-derived vectors tagged 'fixture')

Task-prefix discipline: 'search_document: ' is prepended only in the
sentence-transformers path, which is hard-pinned to the nomic model family
(its training expects this prefix). Other providers (Ollama, OpenAI) embed
raw text — keeps the build-side and the query-side byte-aligned regardless
of which model the operator wires up, at the cost of slightly degraded
recall for operators who deploy nomic via Ollama. Operators who want the
nomic prefix discipline should use the sentence-transformers provider.
"""

from __future__ import annotations
import hashlib
import math
import os
import time
from typing import List, Optional, Protocol


def _l2_normalize(vector: List[float]) -> List[float]:
    """
    L2-normalize a single vector to unit length. Used so all providers emit
    unit-length vectors regardless of model convention — runtime side (dt-ws
    embedding.service.ts) also L2-normalizes query vectors, so cosine
    similarity scores are well-defined and bounded in [-1, 1] modulo FP noise.

    nomic-embed-text-v1.5 is documented to produce
    L2-normalized output but `sentence_transformers.encode(normalize_embeddings=False)`
    + Ollama's default `/api/embed` return un-normalized vectors. Normalizing
    consistently across providers aligns the stored corpus with nomic upstream's
    convention and matches the runtime query-side normalization.
    """
    norm = math.sqrt(sum(x * x for x in vector))
    if norm == 0.0:
        return vector
    inv = 1.0 / norm
    return [x * inv for x in vector]


def _l2_normalize_batch(vectors: List[List[float]]) -> List[List[float]]:
    return [_l2_normalize(v) for v in vectors]

# 'search_document: ' is the build-side task prefix for nomic-embed-text-v1.5,
# applied only by SentenceTransformersProvider (which is hard-pinned to that
# model). The OllamaProvider and OpenAIProvider embed raw text — symmetric
# with the dt-ws runtime, which does the same on the query side.
_DOCUMENT_PREFIX = "search_document: "

# Retry / timeout discipline mirrors oss/apps/dt-ws/src/gql/services/embedding.service.ts:embedBatch().
_MAX_RETRIES = 3
_BACKOFF_BASE_S = 1.0
_BACKOFF_FACTOR = 3.0
# Ollama cold-start can take 60-90s on first request while the model is paged
# into memory. The runtime side has its own retry; here we set a generous
# timeout so the build doesn't fail-fast on the first request of a fresh
# operator deployment. OpenAI's API typically responds well under 30s; the
# extra ceiling only hurts in adversarial timeout scenarios (covered by retry).
_HTTP_TIMEOUT_S = 120.0


class EmbeddingProvider(Protocol):
    model_name: str
    dimensions: int

    def embed(self, texts: List[str]) -> List[List[float]]: ...


# ---------------------------------------------------------------------------
# Default: sentence-transformers + nomic-embed-text-v1.5
# ---------------------------------------------------------------------------


class SentenceTransformersProvider:
    """
    Loads nomic-ai/nomic-embed-text-v1.5 via sentence-transformers.

    Loaded with trust_remote_code=True (nomic-bert-2048 is a
    custom HF architecture). einops is a hard transitive dep; sentence-transformers
    does NOT auto-install it — listed explicitly in requirements.txt.

    Model load is one-time: ~20s cold start on first construction. Cache reused
    across all subsequent .embed() calls in this process.
    """

    def __init__(self):
        from sentence_transformers import SentenceTransformer

        # SECURITY: the HF model path is hard-coded ON PURPOSE. Do NOT make this
        # env-driven — trust_remote_code=True executes Python from the named
        # HF Hub repo, so the pinning here is the trust boundary. Operators who
        # want a different model use OllamaProvider / OpenAIProvider, which do
        # not execute remote code.
        self._model = SentenceTransformer(
            "nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True
        )
        # model_name is what we write into the embeddingModel property on each
        # MITRE node. Runtime EMBEDDING_MODEL defaults to 'nomic-embed-text';
        # we keep that string here so the model-coherence precheck matches by default.
        self.model_name = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
        dim = self._model.get_sentence_embedding_dimension()
        if dim is None:
            raise RuntimeError("sentence-transformers model returned no dimension")
        self.dimensions = int(dim)

    def embed(self, texts: List[str]) -> List[List[float]]:
        # SentenceTransformersProvider pins the nomic-ai HF repo, so the
        # prefix always applies here. (Operators wanting a different
        # sentence-transformers model would extend this class explicitly.)
        prefixed = [_DOCUMENT_PREFIX + t for t in texts]
        vectors = self._model.encode(
            prefixed,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return [list(v.tolist()) for v in vectors]


# ---------------------------------------------------------------------------
# Override: Ollama (HTTP /api/embed) — same nomic model family, same prefix
# ---------------------------------------------------------------------------


class OllamaProvider:
    """
    HTTP provider talking to Ollama's /api/embed endpoint.

    Generic across Ollama-served embedding models. Raw text is sent on
    every request — the dt-ws runtime side does the same on the query
    side, so the build-side and query-side stay byte-aligned regardless
    of which model the operator wires up. Bounded retry mirrors
    EmbeddingService.embedBatch() shape.
    """

    def __init__(self):
        # 'requests' is already an indirect transitive dep of ontolocy/neontology.
        import requests  # noqa: F401

        self._url = os.getenv("OLLAMA_URL", "http://localhost:11434/api/embed")
        self.model_name = os.getenv("EMBEDDING_MODEL", "embeddinggemma")
        self.dimensions = int(os.getenv("EMBEDDING_DIMENSIONS", "768"))

    def embed(self, texts: List[str]) -> List[List[float]]:
        import requests

        inputs = list(texts)
        delay = _BACKOFF_BASE_S
        last_err: Optional[Exception] = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                resp = requests.post(
                    self._url,
                    json={"model": self.model_name, "input": inputs},
                    timeout=_HTTP_TIMEOUT_S,
                )
                resp.raise_for_status()
                data = resp.json()
                vectors = data.get("embeddings")
                if vectors is None:
                    # Older Ollama returns a singular 'embedding' for single-input requests.
                    single = data.get("embedding")
                    if single is not None and len(inputs) == 1:
                        return _l2_normalize_batch([list(single)])
                    raise RuntimeError(
                        f"Ollama response missing 'embeddings': keys={list(data.keys())}"
                    )
                # Ollama's /api/embed returns un-normalized vectors by default;
                # apply L2 normalization to match SentenceTransformersProvider's
                # normalize_embeddings=True convention.
                return _l2_normalize_batch([list(v) for v in vectors])
            except Exception as err:  # noqa: BLE001
                last_err = err
                if attempt == _MAX_RETRIES:
                    break
                time.sleep(delay)
                delay *= _BACKOFF_FACTOR
        raise RuntimeError(f"Ollama embed failed after {_MAX_RETRIES} retries: {last_err}")


# ---------------------------------------------------------------------------
# Override: OpenAI text-embedding-3-small — different model family, NO prefix
# ---------------------------------------------------------------------------


class OpenAIProvider:
    """
    OpenAI text-embedding-3-small (1536-dim).

    Different model family from nomic — does NOT take a task-prefix. Operators
    deploying with OpenAI runtime want their pre-computed vectors to match what
    the runtime would produce; the runtime side (EmbeddingService.embedBatch)
    must also skip the prefix in that case (configured at the call-site).
    """

    def __init__(self):
        from openai import OpenAI

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY to be set"
            )
        self._client = OpenAI(api_key=api_key)
        self.model_name = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
        self.dimensions = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))

    def embed(self, texts: List[str]) -> List[List[float]]:
        delay = _BACKOFF_BASE_S
        last_err: Optional[Exception] = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                response = self._client.embeddings.create(
                    model=self.model_name, input=texts
                )
                # OpenAI text-embedding-3-small returns unit-length vectors by
                # default, but normalize defensively to align with the cross-
                # provider unit-vector contract. Idempotent on already-unit
                # vectors.
                return _l2_normalize_batch(
                    [list(item.embedding) for item in response.data]
                )
            except Exception as err:  # noqa: BLE001
                last_err = err
                if attempt == _MAX_RETRIES:
                    break
                time.sleep(delay)
                delay *= _BACKOFF_FACTOR
        raise RuntimeError(f"OpenAI embed failed after {_MAX_RETRIES} retries: {last_err}")


# ---------------------------------------------------------------------------
# CI: fixture — deterministic hash-derived vectors, tagged 'fixture'
# ---------------------------------------------------------------------------


class FixtureProvider:
    """
    Deterministic embedding provider for CI.

    Emits unit-length vectors seeded by sha256(text). The 'fixture' model tag
    is rejected by the model-coherence precheck against any real runtime model
    (fail-closed). Lets CI verify the build pipeline shape without an external
    embedding source.
    """

    def __init__(self):
        self.model_name = "fixture"
        self.dimensions = int(os.getenv("EMBEDDING_DIMENSIONS", "768"))

    def embed(self, texts: List[str]) -> List[List[float]]:
        try:
            import numpy as np  # type: ignore[import-untyped]
        except ImportError:
            np = None  # type: ignore[assignment]

        out: List[List[float]] = []
        for t in texts:
            seed = int.from_bytes(hashlib.sha256(t.encode("utf-8")).digest()[:8], "big")
            if np is not None:
                rng = np.random.default_rng(seed)
                v = rng.standard_normal(self.dimensions).astype("float32")
                norm = float(np.linalg.norm(v))
                if norm > 0:
                    v = v / norm
                out.append([float(x) for x in v.tolist()])
            else:
                # numpy-free fallback for environments without numpy installed.
                import random

                rnd = random.Random(seed)
                vec = [rnd.gauss(0.0, 1.0) for _ in range(self.dimensions)]
                norm = sum(x * x for x in vec) ** 0.5
                if norm > 0:
                    vec = [x / norm for x in vec]
                out.append(vec)
        return out


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def select_provider() -> Optional[EmbeddingProvider]:
    """
    Honor EMBEDDING_PROVIDER if set; otherwise auto-detect sentence-transformers.
    Returns None when no provider can be selected — caller must skip with a warning.
    """
    explicit = os.getenv("EMBEDDING_PROVIDER")
    if explicit:
        explicit_norm = explicit.strip().lower()
        if explicit_norm == "fixture":
            return FixtureProvider()
        if explicit_norm == "ollama":
            return OllamaProvider()
        if explicit_norm == "openai":
            return OpenAIProvider()
        if explicit_norm in ("sentence-transformers", "sentence_transformers"):
            return SentenceTransformersProvider()
        raise ValueError(f"unknown EMBEDDING_PROVIDER: {explicit!r}")

    # Auto-detect: prefer sentence-transformers when importable.
    try:
        import sentence_transformers  # noqa: F401
        return SentenceTransformersProvider()
    except ImportError:
        return None
