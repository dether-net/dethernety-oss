"""
Embedding provider abstraction for the mitre-frameworks build pipeline.

A built-in onnx embedding profile (the exporter's --profile, which defaults to
manifest.json's embeddingProfile) selects OnnxProfileProvider: the platform's own
embedder, so the vectors are the ones dt-ws embeds in process with the same profile.
Without a profile, the provider comes from the EMBEDDING_PROVIDER env var (explicit).
With neither, select_provider() falls back to a legacy default, Ollama + embeddinggemma,
and returns None when that is unreachable. The exporter never reaches that default (it
passes a profile unless EMBEDDING_PROVIDER is set) and treats None as a failure. A profile
never returns None.

dt-ws has no HTTP/Ollama embedder: it embeds with its onnx profile and refuses the legacy
embeddinggemma. Vectors from any provider but a profile are tagged with another model, and
dt-ws reports them as MODEL_MISMATCH instead of searching them.

Provider precedence:
  1. Profile  — OnnxProfileProvider: an onnx profile through the embedder package's
                helper (oss/packages/embedder/bin/embed-documents.mjs). Any failure is
                fatal; EMBEDDING_PROVIDER must be unset.
  2. Override — EMBEDDING_PROVIDER: ollama (HTTP /api/embed; with embeddinggemma, 768-dim,
                the legacy profile's build path), sentence-transformers
                (nomic-ai/nomic-embed-text-v1.5, 768-dim), openai
                (text-embedding-3-small, 1536-dim) or fixture (deterministic,
                hash-derived vectors tagged 'fixture', for CI).
  3. Legacy default — Ollama + embeddinggemma, probed for reachability; None if Ollama
                is unreachable or the model isn't pulled. Unreachable from the exporter.

Task-prefix discipline: a profile's prompts are applied by the embedder that
runs it. Otherwise 'search_document: ' is prepended only in the
sentence-transformers path, which is hard-pinned to the nomic model family
(its training expects this prefix). Other providers (Ollama, OpenAI) embed
raw text, so a consumer of their corpus must embed its queries as raw text with
the same model, at the cost of slightly degraded recall for operators who deploy
nomic via Ollama. Operators who want the nomic prefix discipline should use the
sentence-transformers provider.
"""

from __future__ import annotations
import hashlib
import json
import math
import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import List, Optional, Protocol, Sequence, Tuple


def _l2_normalize(vector: List[float]) -> List[float]:
    """
    L2-normalize a single vector to unit length. Used so all providers emit
    unit-length vectors regardless of model convention, so cosine similarity
    scores are well-defined and bounded in [-1, 1] modulo FP noise (the
    embeddings file check requires unit length).

    nomic-embed-text-v1.5 is documented to produce
    L2-normalized output but `sentence_transformers.encode(normalize_embeddings=False)`
    + Ollama's default `/api/embed` return un-normalized vectors. Normalizing
    consistently across providers aligns the stored corpus with nomic upstream's
    convention.
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
# model). The OllamaProvider and OpenAIProvider embed raw text; a consumer of
# their corpus must embed its queries the same way. (dt-ws embeds with its onnx
# profile, whose prompts the embedder package applies.)
_DOCUMENT_PREFIX = "search_document: "

# Bounded retry with backoff for the HTTP providers (Ollama, OpenAI).
_MAX_RETRIES = 3
_BACKOFF_BASE_S = 1.0
_BACKOFF_FACTOR = 3.0
# Ollama cold-start can take 60-90s on first request while the model is paged
# into memory, so the timeout is generous: the build doesn't fail-fast on the
# first request of a fresh Ollama. OpenAI's API typically responds well under 30s; the
# extra ceiling only hurts in adversarial timeout scenarios (covered by retry).
_HTTP_TIMEOUT_S = 120.0


class EmbeddingProvider(Protocol):
    model_name: str
    dimensions: int

    def embed(self, texts: List[str]) -> List[List[float]]: ...


def embed_documents(provider: EmbeddingProvider, items: Sequence[Tuple[str, str]]) -> List[List[float]]:
    """
    Embed (title, text) documents. A provider with a document prompt that uses the title
    (OnnxProfileProvider) gets both; every other provider embeds the text alone.
    """
    method = getattr(provider, "embed_documents", None)
    if method is not None:
        return method(items)
    return provider.embed([text for _, text in items])


# ---------------------------------------------------------------------------
# Override: sentence-transformers + nomic-embed-text-v1.5
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
        # MITRE node. This provider produces nomic-ai/nomic-embed-text-v1.5
        # vectors, so it tags them 'nomic-embed-text'. dt-ws embeds with its onnx
        # profile and accepts no other EMBEDDING_MODEL, so it reports a corpus from
        # this provider as MODEL_MISMATCH (diagnosable, not silent) and does not
        # search it.
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
# Override: Ollama (HTTP /api/embed), raw text — the legacy profile's build path
# ---------------------------------------------------------------------------


class OllamaProvider:
    """
    HTTP provider talking to Ollama's /api/embed endpoint.

    Generic across Ollama-served embedding models; with embeddinggemma it
    builds the legacy profile's corpus (build-data.sh sets
    EMBEDDING_PROVIDER=ollama for a manifest naming that profile). Raw text is
    sent on every request, so a consumer must embed its queries the same way.
    dt-ws no longer embeds through Ollama and refuses embeddinggemma. Bounded
    retry with backoff.
    """

    def __init__(self):
        # 'requests' is already an indirect transitive dep of ontolocy/neontology.
        import requests  # noqa: F401

        self._url = os.getenv("OLLAMA_URL", "http://localhost:11434/api/embed")
        self.model_name = os.getenv("EMBEDDING_MODEL", "embeddinggemma")
        self.dimensions = int(os.getenv("EMBEDDING_DIMENSIONS", "768"))

    def available(self) -> bool:
        """
        Best-effort reachability + model-presence probe used by the auto-detect
        default path in select_provider(). Returns True only when the Ollama
        server answers and self.model_name is among the pulled models, so that
        default returns None up front instead of failing mid-run. An EXPLICIT
        EMBEDDING_PROVIDER=ollama bypasses this probe and is contractual (embed()
        raises on failure).
        """
        import requests

        # Derive the server root from the (possibly full) embed URL.
        base = self._url.split("/api/")[0] if "/api/" in self._url else self._url.rstrip("/")
        try:
            resp = requests.get(f"{base}/api/tags", timeout=3.0)
            resp.raise_for_status()
            models = resp.json().get("models", [])
        except Exception:  # noqa: BLE001 — any failure means "treat as unavailable"
            return False
        # Ollama reports names like "embeddinggemma:latest"; match the base name.
        wanted = self.model_name.split(":")[0]
        return any(str(m.get("name", "")).split(":")[0] == wanted for m in models)

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

    Different model family from nomic — does NOT take a task-prefix. A consumer
    of this corpus must embed its queries with the same model, also without a
    prefix. dt-ws has no OpenAI embedder: it embeds with its onnx profile.
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
# Profile: a built-in onnx embedding profile, through the platform's own embedder
# ---------------------------------------------------------------------------

# The embedder package's document helper: oss/packages/embedder/bin/embed-documents.mjs.
EMBEDDER_HELPER = Path(__file__).resolve().parents[3] / "packages" / "embedder" / "bin" / "embed-documents.mjs"

# How long close() waits for the helper to release its session and exit.
_HELPER_EXIT_TIMEOUT_S = 60.0
# How long the helper may take to write its ready line: it reads the weights and builds the
# session first. With --download it fetches the weights before that, so it gets longer.
_HELPER_READY_TIMEOUT_S = 600.0
_HELPER_READY_DOWNLOAD_TIMEOUT_S = 3600.0
# How long one request may take, from writing its batch to reading the reply.
_HELPER_REPLY_TIMEOUT_S = 300.0
# The ready line's fields that a generated file's header records, each held to its format: repo and revision to the
# profile's own patterns (dt-module, embedding-profile.ts), dtype to a plain token. Matched with fullmatch and ASCII
# classes: re's $ also accepts a trailing newline, and \w matches any Unicode letter, unlike the JS patterns.
_READY_FIELD_FORMATS = {
    "repo": re.compile(r"[A-Za-z0-9][0-9A-Za-z_.-]*/[0-9A-Za-z_.-]+"),
    "revision": re.compile(r"[0-9a-f]{40}"),
    "dtype": re.compile(r"[a-z0-9]+"),
}


def _pump_lines(stream, lines: "queue.Queue[Optional[str]]") -> None:
    """Forward the helper's stdout lines to lines; None marks the end of its output."""
    try:
        for line in stream:
            lines.put(line)
    except (OSError, ValueError):
        pass
    finally:
        lines.put(None)


class OnnxProfileProvider:
    """
    Embeds documents with a built-in onnx profile (e.g. embeddinggemma-300m-retrieval-v1)
    through the embedder package's helper: one long-lived Node process running the
    platform's own tokenizer, session and document prompt, so the stored vectors are the
    ones dt-ws would embed for the same text. JSON lines over the helper's stdin and
    stdout; its stderr passes through. Needs the package built
    (pnpm --filter @dethernety/embedder... build) and the profile's weights in models_dir.

    model_name is the profile id, which is what every node stores as embeddingModel. Any
    helper failure raises RuntimeError: there is no fallback. close() ends the helper.

    Every wait on the helper has a deadline, so a helper that hangs fails the build instead
    of stalling it: ready_timeout for the ready line (default 600 s, 3600 s with download),
    reply_timeout for each request, from writing it to reading the reply (default 300 s).
    On expiry the helper is killed and RuntimeError is raised.
    """

    def __init__(
        self,
        profile: str,
        models_dir: str,
        threads: Optional[int] = None,
        download: bool = False,
        command: Optional[Sequence[str]] = None,
        ready_timeout: Optional[float] = None,
        reply_timeout: float = _HELPER_REPLY_TIMEOUT_S,
    ):
        if ready_timeout is None:
            ready_timeout = _HELPER_READY_DOWNLOAD_TIMEOUT_S if download else _HELPER_READY_TIMEOUT_S
        self._reply_timeout = reply_timeout
        argv = list(command or ["node", str(EMBEDDER_HELPER)])
        argv += ["--profile", profile, "--models-dir", str(models_dir)]
        if threads is not None:
            argv += ["--threads", str(threads)]
        if download:
            argv.append("--download")
        try:
            self._proc: Optional[subprocess.Popen] = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8"
            )
        except OSError as err:
            raise RuntimeError(f"embedder helper did not start ({argv[0]}): {err}") from err
        # A reader thread owns stdout, so every read can wait with a deadline.
        self._lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._reader = threading.Thread(target=_pump_lines, args=(self._proc.stdout, self._lines), daemon=True)
        self._reader.start()
        try:
            spec = self._read_json("its ready line", time.monotonic() + ready_timeout, ready_timeout)
            if spec.get("profile") != profile:
                raise RuntimeError(f"embedder helper embeds {spec.get('profile')!r}, not {profile!r}")
            dimensions = spec.get("dimensions")
            if not isinstance(dimensions, int) or dimensions <= 0:
                raise RuntimeError(f"embedder helper named no usable dimensions: {dimensions!r}")
            missing = [
                k for k, form in _READY_FIELD_FORMATS.items() if not isinstance(spec.get(k), str) or not form.fullmatch(spec[k])
            ]
            if missing or spec.get("documentTitle") not in ("name", "none"):
                raise RuntimeError(
                    f"embedder helper's ready line lacks {missing or ['documentTitle']}: "
                    "an older build? run: pnpm --filter @dethernety/embedder... build"
                )
            self.model_name: str = profile
            self.dimensions: int = dimensions
            self.repo: str = spec["repo"]
            self.revision: str = spec["revision"]
            self.dtype: str = spec["dtype"]
            self.document_title: str = spec["documentTitle"]
        except Exception:
            self.close()
            raise

    def _expired(self, what: str, limit: float) -> RuntimeError:
        """Kill the helper and say which wait ran out."""
        self.close(kill=True)
        return RuntimeError(f"embedder helper timed out after {limit:g} s waiting for {what}; it was killed")

    def _read_json(self, what: str, deadline: float, limit: float) -> dict:
        """The helper's next line as a JSON object; deadline is a time.monotonic() value,
        limit the timeout it came from (for the message)."""
        assert self._proc is not None
        try:
            line = self._lines.get(timeout=max(0.0, deadline - time.monotonic()))
        except queue.Empty:
            raise self._expired(what, limit) from None
        if line is None:
            try:
                code = self._proc.wait(timeout=_HELPER_EXIT_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                self.close(kill=True)
                raise RuntimeError(f"embedder helper closed its output before {what} but did not exit; it was killed") from None
            raise RuntimeError(f"embedder helper exited (code {code}) before {what}; its message is above")
        try:
            value = json.loads(line)
        except ValueError as err:
            raise RuntimeError(f"embedder helper wrote {what} that is not JSON: {line[:200]!r}") from err
        if not isinstance(value, dict):
            raise RuntimeError(f"embedder helper wrote {what} that is not an object: {line[:200]!r}")
        return value

    def embed_documents(self, items: Sequence[Tuple[str, str]]) -> List[List[float]]:
        if self._proc is None or self._proc.stdin is None:
            raise RuntimeError("embedder helper is closed")
        request = json.dumps({"items": [{"title": title, "text": text} for title, text in items]}, ensure_ascii=False)
        deadline = time.monotonic() + self._reply_timeout
        # The write runs on a thread too: a helper that stops reading its input would block
        # a batch larger than the pipe's buffer.
        stdin = self._proc.stdin
        failed: List[BaseException] = []

        def send() -> None:
            try:
                stdin.write(request + "\n")
                stdin.flush()
            except (OSError, ValueError) as err:
                failed.append(err)

        writer = threading.Thread(target=send, daemon=True)
        writer.start()
        writer.join(max(0.0, deadline - time.monotonic()))
        if writer.is_alive():
            raise self._expired("it to read the request", self._reply_timeout)
        if failed:
            try:
                code = self._proc.wait(timeout=_HELPER_EXIT_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                self.close(kill=True)
                raise RuntimeError("embedder helper stopped reading requests but did not exit; it was killed") from failed[0]
            raise RuntimeError(f"embedder helper exited (code {code}) before a request; its message is above") from failed[0]
        vectors = self._read_json("its reply", deadline, self._reply_timeout).get("vectors")
        if not isinstance(vectors, list) or len(vectors) != len(items):
            got = len(vectors) if isinstance(vectors, list) else repr(vectors)[:80]
            raise RuntimeError(f"embedder helper returned {got} vectors for {len(items)} documents")
        return vectors

    def embed(self, texts: List[str]) -> List[List[float]]:
        # No title: the profile's document prompt then reads "title: none".
        return self.embed_documents([("", text) for text in texts])

    def header_lines(self) -> List[str]:
        """What a generated file records about the vectors: the profile, its pinned weights and prompt."""
        return [
            f"// Profile: {self.model_name}  Weights: {self.repo}@{self.revision}  dtype: {self.dtype}  "
            f"Document prompt: title = {self.document_title}"
        ]

    def close(self, kill: bool = False) -> None:
        """End the helper: close its input and wait for it to exit, killing it if it does
        not within the exit timeout, or at once with kill. A second call does nothing."""
        proc, self._proc = self._proc, None
        if proc is None:
            return
        if kill:
            proc.kill()
        try:
            if proc.stdin is not None:
                proc.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            proc.wait(timeout=_HELPER_EXIT_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        # The reader thread ends at the helper's end of output. Closing stdout under a read
        # in progress would wait on it, so only a finished reader's stream is closed (a
        # grandchild still holding the pipe keeps it open; the thread is a daemon).
        self._reader.join(timeout=5.0)
        if proc.stdout is not None and not self._reader.is_alive():
            proc.stdout.close()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def select_provider(
    profile: Optional[str] = None,
    models_dir: Optional[str] = None,
    threads: Optional[int] = None,
    download: bool = False,
) -> Optional[EmbeddingProvider]:
    """
    A profile id selects OnnxProfileProvider; it needs a models directory and excludes
    EMBEDDING_PROVIDER. Without one, honor EMBEDDING_PROVIDER if set; otherwise fall back
    to the legacy default, Ollama + embeddinggemma, which the exporter never reaches (it
    always passes a profile or sets EMBEDDING_PROVIDER). Returns None when no provider can
    be selected — the exporter treats that as a failure. A profile never returns None: its
    provider starts or raises.
    """
    explicit = os.getenv("EMBEDDING_PROVIDER")
    if profile is not None:
        if explicit:
            raise ValueError(
                f"a profile ({profile!r}) and EMBEDDING_PROVIDER={explicit!r} are exclusive: "
                "a profile embeds through the platform's embedder"
            )
        if not models_dir:
            raise ValueError(
                f"profile {profile!r} needs a models directory (--models-dir or EMBEDDING_MODEL_DIR)"
            )
        return OnnxProfileProvider(profile, models_dir, threads=threads, download=download)

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

    # Legacy default (no profile, no EMBEDDING_PROVIDER): Ollama + embeddinggemma.
    # The exporter never reaches it: it passes the manifest's profile unless
    # EMBEDDING_PROVIDER is set. dt-ws does not embed this way any more (it embeds
    # in process with its onnx profile and refuses embeddinggemma). Probe first; if
    # Ollama is unreachable or the model isn't pulled, return None, which a caller
    # must treat as a failure.
    provider = OllamaProvider()
    if provider.available():
        return provider
    print(
        f"[warn] legacy default embedding provider (Ollama + {provider.model_name}) "
        "unreachable or model not pulled — no provider.",
        file=sys.stderr,
    )
    return None
