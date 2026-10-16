#!/usr/bin/env python3
"""
Tests for the onnx profile provider and the exporter's profile path, without Node, a
model or a database.

A fake helper (a Python script run through sys.executable) speaks the embedder helper's
protocol: a ready line, then one reply per request line. Its vectors are derived from each
document's title and text, and it records every request, so the cases can check what was
sent. The cases pin the provider (ready line, titles, order, every failure a RuntimeError,
the helper ended on close and on a failed start, a hung helper killed at its deadline, a
ready-line field out of its format refused) and the exporter with it (the Profile header
line, every SET naming the profile, the cache, all-or-nothing on failure, and a header line
that could end its comment refused before anything is written).
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import embedding_provider  # noqa: E402
import export_embeddings_to_cypher as exporter  # noqa: E402
from embedding_provider import OnnxProfileProvider, embed_documents, select_provider  # noqa: E402

PROFILE = "embeddinggemma-300m-retrieval-v1"
DIMS = 4

# The fake helper. argv: <mode> <requests log> --profile <id> --models-dir <dir> [...]
# A mode "ready=<json>" serves as "ok" with those fields replaced in its ready line.
FAKE_HELPER = r'''
import hashlib, json, sys, time
mode, log = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
profile = args[args.index("--profile") + 1]
# The hang modes stop answering; they end on their own well after any test's deadline.
if mode == "hang-before-ready":
    time.sleep(60)
    sys.exit(0)
if mode == "fail-start":
    sys.stderr.write("config.json: missing or does not match the profile\n")
    sys.exit(1)
if mode == "bad-ready":
    print("not json", flush=True)
elif mode == "old-ready":
    print(json.dumps({"profile": profile, "dimensions": %(dims)d}), flush=True)
else:
    named = "someone-else" if mode == "other-profile" else profile
    spec = {"profile": named, "dimensions": %(dims)d, "repo": "org/model-ONNX",
            "revision": "a" * 40, "dtype": "fp32", "documentTitle": "name"}
    if mode.startswith("ready="):
        spec.update(json.loads(mode[len("ready="):]))
    print(json.dumps(spec), flush=True)
if mode == "no-read":
    time.sleep(60)
    sys.exit(0)
served = 0
for line in sys.stdin:
    if mode == "hang":
        time.sleep(60)
        sys.exit(0)
    if mode == "die-after-one" and served == 1:
        sys.exit(1)
    items = json.loads(line)["items"]
    with open(log, "a") as f:
        f.write(json.dumps(items) + "\n")
    def vec(it):
        h = hashlib.sha256((it["title"] + "|" + it["text"]).encode()).digest()
        return [b / 255.0 for b in h[:%(dims)d]]
    vectors = [vec(it) for it in items]
    if mode == "short":
        vectors = vectors[:-1]
    if mode == "wrong-dims":
        vectors = [v + [0.0] for v in vectors]
    print(json.dumps({"vectors": vectors}), flush=True)
    served += 1
''' % {"dims": DIMS}


class Env:
    def __init__(self, root: Path):
        self.root = root
        self.helper = root / "fake_helper.py"
        self.helper.write_text(FAKE_HELPER, encoding="utf-8")
        self.log = root / "requests.jsonl"
        self.out = root / "data"
        self.out.mkdir()

    def provider(self, mode: str = "ok", **timeouts: float) -> OnnxProfileProvider:
        return OnnxProfileProvider(
            PROFILE, str(self.root / "models"), command=[sys.executable, str(self.helper), mode, str(self.log)], **timeouts
        )

    def requests(self) -> List[List[Dict[str, str]]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]


def raises(fn: Callable[[], Any], exc: type, contains: str) -> None:
    try:
        fn()
    except exc as err:
        assert contains in str(err), f"{contains!r} not in {err!r}"
        return
    raise AssertionError(f"expected {exc.__name__} containing {contains!r}")


def nodes(row: Tuple) -> List[Dict[str, Any]]:
    """Two small nodes per corpus row, keyed like the real ones."""
    label = row[2]
    return [
        {"mitre_id": f"{label}-1", "name": f"{label} One", "description": "Does one thing", "tactic": "Execution"},
        {"mitre_id": f"{label}-2", "name": f"{label} Two", "description": "Does “two”", "tactic": None},
    ]


def fake_fetch(selected: List[Tuple]) -> List[List[Dict[str, Any]]]:
    return [nodes(row) for row in selected]


def quiet(fn: Callable[[], Any]) -> Any:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn()


# --- the provider -----------------------------------------------------------------------


def reads_the_ready_line_and_sends_titles_in_order(env: Env) -> None:
    p = env.provider()
    try:
        assert (p.model_name, p.dimensions) == (PROFILE, DIMS)
        assert p.header_lines() == [
            f"// Profile: {PROFILE}  Weights: org/model-ONNX@{'a' * 40}  dtype: fp32  Document prompt: title = name"
        ]
        first = p.embed_documents([("Phishing", "Phishing. Sends mail."), ("Audit", "Audit.")])
        second = p.embed_documents([("Audit", "Audit.")])
        assert len(first) == 2 and all(len(v) == DIMS for v in first)
        assert second[0] == first[1]
        assert env.requests() == [
            [{"title": "Phishing", "text": "Phishing. Sends mail."}, {"title": "Audit", "text": "Audit."}],
            [{"title": "Audit", "text": "Audit."}],
        ]
        assert p.embed(["x"]) and env.requests()[-1] == [{"title": "", "text": "x"}]
    finally:
        p.close()


def ends_the_helper_on_close(env: Env) -> None:
    p = env.provider()
    proc = p._proc
    p.close()
    assert proc is not None and proc.returncode is not None
    p.close()  # a second close is a no-op
    raises(lambda: p.embed_documents([("a", "b")]), RuntimeError, "closed")


def fails_a_start_the_helper_refuses(env: Env) -> None:
    raises(lambda: quiet(lambda: env.provider("fail-start")), RuntimeError, "exited (code 1) before its ready line")


def fails_and_ends_the_helper_on_a_bad_ready_line(env: Env) -> None:
    for mode, message in (
        ("bad-ready", "not JSON"),
        ("other-profile", "embeds 'someone-else'"),
        ("old-ready", "lacks ['repo', 'revision', 'dtype']: an older build?"),
    ):
        started: List[Any] = []
        real = embedding_provider.subprocess.Popen

        def spy(*a: Any, **k: Any) -> Any:
            started.append(real(*a, **k))
            return started[-1]

        embedding_provider.subprocess.Popen = spy  # type: ignore[assignment]
        try:
            raises(lambda: env.provider(mode), RuntimeError, message)
        finally:
            embedding_provider.subprocess.Popen = real  # type: ignore[assignment]
        assert started[0].returncode is not None, f"{mode}: the helper still runs"


def refuses_a_ready_line_field_out_of_its_format(env: Env) -> None:
    # Every one of these would reach a generated file's header comment.
    cases = [
        ("revision", "a" * 40 + "\n"),  # what re.match with $ would accept
        ("revision", "a" * 40 + "\r"),
        ("revision", "a" * 39 + "\u2028"),
        ("revision", "A" * 40),
        ("revision", "a" * 41),
        ("repo", "org/model\nMATCH (n) DETACH DELETE n"),
        ("repo", "org/model\n"),
        ("repo", "org/model\r"),
        ("repo", "org/model\u2028x"),
        ("repo", "org/mödel"),  # \w would take it
        ("repo", "org model/x"),
        ("repo", "orgmodel"),
        ("dtype", "fp32\n"),
        ("dtype", "fp32\r"),
        ("dtype", "fp\u202832"),
        ("dtype", "fp 32"),
        ("dtype", "FP32"),
    ]
    for field, value in cases:
        started, restore = started_helpers()
        try:
            raises(lambda: env.provider("ready=" + json.dumps({field: value})), RuntimeError, f"ready line lacks ['{field}']")
        finally:
            restore()
        assert started[0].returncode is not None, f"{field}={value!r}: the helper still runs"


def accepts_the_ready_line_fields_the_profiles_use(env: Env) -> None:
    fields = {"repo": "onnx-community/embeddinggemma-300m-ONNX", "revision": "0123456789abcdef" * 2 + "01234567", "dtype": "q8"}
    p = env.provider("ready=" + json.dumps(fields))
    try:
        assert (p.repo, p.revision, p.dtype) == (fields["repo"], fields["revision"], "q8")
    finally:
        p.close()


def fails_when_the_helper_dies_mid_run(env: Env) -> None:
    p = env.provider("die-after-one")
    try:
        p.embed_documents([("a", "a")])
        raises(lambda: p.embed_documents([("b", "b")]), RuntimeError, "exited (code 1)")
    finally:
        p.close()


def fails_on_a_short_reply(env: Env) -> None:
    p = env.provider("short")
    try:
        raises(lambda: p.embed_documents([("a", "a"), ("b", "b")]), RuntimeError, "returned 1 vectors for 2 documents")
    finally:
        p.close()


def started_helpers() -> Tuple[List[Any], Callable[[], None]]:
    """Record every helper Popen starts; the second value restores Popen."""
    started: List[Any] = []
    real = embedding_provider.subprocess.Popen

    def spy(*a: Any, **k: Any) -> Any:
        started.append(real(*a, **k))
        return started[-1]

    embedding_provider.subprocess.Popen = spy  # type: ignore[assignment]

    def restore() -> None:
        embedding_provider.subprocess.Popen = real  # type: ignore[assignment]

    return started, restore


def kills_a_helper_that_hangs_before_its_ready_line(env: Env) -> None:
    started, restore = started_helpers()
    try:
        t0 = time.monotonic()
        raises(lambda: env.provider("hang-before-ready", ready_timeout=0.5), RuntimeError,
               "timed out after 0.5 s waiting for its ready line; it was killed")
        assert time.monotonic() - t0 < 10, "the ready deadline did not bound the wait"
    finally:
        restore()
    assert started[0].returncode is not None, "the hung helper still runs"


def kills_a_helper_that_never_replies(env: Env) -> None:
    p = env.provider("hang", reply_timeout=0.5)
    proc = p._proc
    try:
        t0 = time.monotonic()
        raises(lambda: p.embed_documents([("a", "a")]), RuntimeError, "timed out after 0.5 s waiting for its reply; it was killed")
        assert time.monotonic() - t0 < 10, "the reply deadline did not bound the wait"
        assert proc is not None and proc.returncode is not None, "the hung helper still runs"
        raises(lambda: p.embed_documents([("a", "a")]), RuntimeError, "closed")
    finally:
        p.close()
        p.close()  # still a no-op after the kill


def kills_a_helper_that_stops_reading_requests(env: Env) -> None:
    # A batch well over a pipe's buffer: the write itself blocks until the deadline.
    p = env.provider("no-read", reply_timeout=0.5)
    proc = p._proc
    try:
        t0 = time.monotonic()
        raises(lambda: p.embed_documents([("a", "x" * 4_000_000)]), RuntimeError,
               "timed out after 0.5 s waiting for it to read the request; it was killed")
        assert time.monotonic() - t0 < 10, "the reply deadline did not bound the write"
        assert proc is not None and proc.returncode is not None, "the hung helper still runs"
    finally:
        p.close()


def the_ready_deadline_defaults_longer_with_a_download(env: Env) -> None:
    waits: List[Optional[float]] = []
    real = embedding_provider.queue.Queue.get

    def get(q: Any, block: bool = True, timeout: Optional[float] = None) -> Any:
        waits.append(timeout)
        return real(q, block, timeout)

    embedding_provider.queue.Queue.get = get  # type: ignore[assignment]
    try:
        for download, ceiling in ((False, embedding_provider._HELPER_READY_TIMEOUT_S),
                                  (True, embedding_provider._HELPER_READY_DOWNLOAD_TIMEOUT_S)):
            waits.clear()
            p = OnnxProfileProvider(PROFILE, str(env.root / "models"), download=download,
                                    command=[sys.executable, str(env.helper), "ok", str(env.log)])
            p.close()
            assert waits and ceiling - 5 < waits[0] <= ceiling, (download, waits)
        assert embedding_provider._HELPER_READY_TIMEOUT_S == 600 and embedding_provider._HELPER_REPLY_TIMEOUT_S == 300
    finally:
        embedding_provider.queue.Queue.get = real  # type: ignore[assignment]


def fails_to_start_without_the_command(env: Env) -> None:
    raises(
        lambda: OnnxProfileProvider(PROFILE, "/m", command=[str(env.root / "no-such-node")]),
        RuntimeError,
        "embedder helper did not start",
    )


def other_providers_embed_the_text_alone() -> None:
    class TextOnly:
        model_name, dimensions = "x", 1

        def __init__(self) -> None:
            self.seen: List[List[str]] = []

        def embed(self, texts: List[str]) -> List[List[float]]:
            self.seen.append(texts)
            return [[1.0] for _ in texts]

    p = TextOnly()
    assert embed_documents(p, [("T", "t1"), ("U", "t2")]) == [[1.0], [1.0]]
    assert p.seen == [["t1", "t2"]]


def selection_needs_a_models_dir_and_excludes_embedding_provider() -> None:
    old = os.environ.pop("EMBEDDING_PROVIDER", None)
    try:
        raises(lambda: select_provider(profile=PROFILE), ValueError, "needs a models directory")
        os.environ["EMBEDDING_PROVIDER"] = "fixture"
        raises(lambda: select_provider(profile=PROFILE, models_dir="/m"), ValueError, "are exclusive")
    finally:
        os.environ.pop("EMBEDDING_PROVIDER", None)
        if old is not None:
            os.environ["EMBEDDING_PROVIDER"] = old


def main_refuses_a_profile_with_embedding_provider(env: Env) -> None:
    old_argv, old = sys.argv, os.environ.get("EMBEDDING_PROVIDER")
    sys.argv = ["export_embeddings_to_cypher.py", "--output-dir", str(env.out), "--profile", PROFILE, "--models-dir", "/m"]
    os.environ["EMBEDDING_PROVIDER"] = "fixture"
    try:
        assert quiet(exporter.main) == 1
    finally:
        sys.argv = old_argv
        os.environ.pop("EMBEDDING_PROVIDER", None)
        if old is not None:
            os.environ["EMBEDDING_PROVIDER"] = old
    assert list(env.out.iterdir()) == []


# --- the exporter with the profile provider -----------------------------------------------


def main_exports_with_the_profile_and_ends_the_helper(env: Env) -> None:
    started: List[OnnxProfileProvider] = []

    def select(**kwargs: Any) -> OnnxProfileProvider:
        assert kwargs == {"profile": PROFILE, "models_dir": "/models", "threads": 2, "download": True}, kwargs
        started.append(env.provider())
        return started[-1]

    saved = (sys.argv, exporter.select_provider, exporter.fetch_from_memgraph, os.environ.pop("EMBEDDING_PROVIDER", None))
    sys.argv = ["export_embeddings_to_cypher.py", "--output-dir", str(env.out), "--profile", PROFILE,
                "--models-dir", "/models", "--embed-threads", "2", "--download-weights"]
    exporter.select_provider = select  # type: ignore[assignment]
    exporter.fetch_from_memgraph = fake_fetch  # type: ignore[assignment]
    try:
        assert quiet(exporter.main) == 0
    finally:
        sys.argv, exporter.select_provider, exporter.fetch_from_memgraph = saved[:3]  # type: ignore[assignment]
        if saved[3] is not None:
            os.environ["EMBEDDING_PROVIDER"] = saved[3]
    assert (env.out / "05-mitre-embeddings.cypher").exists() and (env.out / "09-atlas-embeddings.cypher").exists()
    assert started[0]._proc is None, "the helper was not closed"


def run_main(env: Env, argv: List[str], provider_env: Optional[str], manifest: Optional[str], select: Callable[..., Any]) -> int:
    """exporter.main with argv, EMBEDDING_PROVIDER, a manifest (its JSON text, or the real one) and a stub select."""
    saved = (sys.argv, exporter.select_provider, exporter.fetch_from_memgraph, exporter.MANIFEST,
             os.environ.pop("EMBEDDING_PROVIDER", None))
    sys.argv = ["export_embeddings_to_cypher.py", "--output-dir", str(env.out), *argv]
    exporter.select_provider = select  # type: ignore[assignment]
    exporter.fetch_from_memgraph = fake_fetch  # type: ignore[assignment]
    if manifest is not None:
        exporter.MANIFEST = env.root / "manifest.json"
        exporter.MANIFEST.write_text(manifest, encoding="utf-8")
    if provider_env is not None:
        os.environ["EMBEDDING_PROVIDER"] = provider_env
    try:
        return quiet(exporter.main)
    finally:
        sys.argv, exporter.select_provider, exporter.fetch_from_memgraph, exporter.MANIFEST = saved[:4]  # type: ignore[assignment]
        os.environ.pop("EMBEDDING_PROVIDER", None)
        if saved[4] is not None:
            os.environ["EMBEDDING_PROVIDER"] = saved[4]


def main_defaults_to_the_manifest_profile(env: Env) -> None:
    seen: List[Dict[str, Any]] = []

    def select(**kwargs: Any) -> OnnxProfileProvider:
        seen.append(kwargs)
        return env.provider()

    assert run_main(env, ["--models-dir", "/models"], None, json.dumps({"embeddingProfile": PROFILE}), select) == 0
    assert [k["profile"] for k in seen] == [PROFILE], seen
    # The committed manifest names the platform's default profile.
    assert exporter.manifest_profile() == PROFILE


def main_refuses_a_legacy_manifest_without_a_provider(env: Env) -> None:
    def select(**kwargs: Any) -> None:
        raise AssertionError(f"select_provider was called: {kwargs}")

    assert run_main(env, [], None, json.dumps({"embeddingProfile": "embeddinggemma"}), select) == 1
    assert run_main(env, [], None, json.dumps({"name": "mitre-frameworks"}), select) == 1
    assert list(env.out.iterdir()) == []


def main_leaves_an_explicit_provider_alone(env: Env) -> None:
    seen: List[Dict[str, Any]] = []

    def select(**kwargs: Any) -> OnnxProfileProvider:
        seen.append(kwargs)
        return env.provider()

    assert run_main(env, [], "fixture", json.dumps({"embeddingProfile": PROFILE}), select) == 0
    assert [k["profile"] for k in seen] == [None], seen


def main_fails_when_no_provider_starts(env: Env) -> None:
    assert run_main(env, [], "ollama", None, lambda **kwargs: None) == 1
    assert list(env.out.iterdir()) == []


def export_with(env: Env, mode: str = "ok") -> int:
    p = env.provider(mode)
    try:
        return quiet(lambda: exporter.export(p, list(exporter.CORPUS), env.out, fetch=fake_fetch))
    finally:
        p.close()


def writes_the_profile_into_every_file(env: Env) -> None:
    assert export_with(env) == 0
    for name in ("05-mitre-embeddings.cypher", "09-atlas-embeddings.cypher"):
        text = (env.out / name).read_text(encoding="utf-8")
        header = text.split("\n")[:4]
        assert header[1] == f"// Model: {PROFILE}  Dimensions: {DIMS}", header
        assert header[2].startswith(f"// Profile: {PROFILE}  Weights: org/model-ONNX@"), header
        sets = [line for line in text.split("\n") if "embeddingModel" in line]
        assert sets and all(line.strip() == f'n.embeddingModel = "{PROFILE}";' for line in sets), sets
    # Every document went out once, titled with its normalised name.
    sent = [item for request in env.requests() for item in request]
    assert len(sent) == 2 * len(exporter.CORPUS)
    assert {"title": "MitreAttackTechnique One", "text": "MitreAttackTechnique One. Does one thing. Tactic: Execution."} in sent
    assert any(item["title"] == "MitreAtlasMitigation Two" and '"two"' in item["text"] for item in sent)
    assert (env.out / ".embedding-cache" / f"{PROFILE}.json").exists()
    # A second run embeds nothing: every document is in the profile's cache.
    before = len(env.requests())
    assert export_with(env) == 0
    assert len(env.requests()) == before


class HeaderProvider:
    """A provider whose model name and header lines a case sets; write_cypher_file reads nothing else."""

    def __init__(self, model_name: str = PROFILE, lines: Tuple[str, ...] = ()) -> None:
        self.model_name, self.dimensions = model_name, DIMS
        self._lines = list(lines)

    def header_lines(self) -> List[str]:
        return self._lines


def refuses_a_header_line_that_could_end_its_comment(env: Env) -> None:
    good = f"// Profile: {PROFILE}  Weights: org/m@{'a' * 40}  dtype: fp32  Document prompt: title = name"
    providers = [HeaderProvider(lines=(good, bad)) for bad in (
        "// Profile: x\nMATCH (n) DETACH DELETE n",
        "// Profile: x\rMATCH (n) DETACH DELETE n",
        "// Profile: x\u2028MATCH (n) DETACH DELETE n",
        "// Profile: x\u2029y",
        "// Profile: x\x00y",
        "// Profile: x\ty",
    )] + [HeaderProvider(model_name=name, lines=(good,)) for name in (
        f"{PROFILE}\nMATCH (n) DETACH DELETE n",
        f"{PROFILE}\u2028x",
    )]
    out = env.out / "05-mitre-embeddings.cypher"
    sections = [("MitreAttackTechnique", "attack_id", [{"mitre_id": "T1"}], [[1.0, 0.0, 0.0, 0.0]])]
    real_open = Path.open
    for provider in providers:
        opened: List[Path] = []

        def spy(self: Path, *a: Any, **k: Any) -> Any:
            opened.append(self)
            return real_open(self, *a, **k)

        Path.open = spy  # type: ignore[assignment]
        try:
            raises(lambda: exporter.write_cypher_file(out, provider, sections), ValueError, "not printable")  # type: ignore[arg-type]
        finally:
            Path.open = real_open  # type: ignore[assignment]
        # Refused before the temp file was opened: neither it nor the file exists.
        assert opened == [], f"{provider.model_name!r} {provider._lines!r}: opened {opened}"
        assert list(env.out.iterdir()) == [], list(env.out.iterdir())
    # The same provider with printable lines writes its header as it is.
    tmp = exporter.write_cypher_file(out, HeaderProvider(lines=(good,)), sections)  # type: ignore[arg-type]
    try:
        assert tmp.read_text(encoding="utf-8").split("\n")[1:4] == [f"// Model: {PROFILE}  Dimensions: {DIMS}", good, "// Source: mitre-frameworks build"]
    finally:
        tmp.unlink()


def writes_nothing_when_the_helper_fails(env: Env) -> None:
    for mode in ("die-after-one", "wrong-dims", "short"):
        assert export_with(env, mode) == 1, mode
        assert sorted(p.name for p in env.out.iterdir()) == [], f"{mode}: {list(env.out.iterdir())}"


def hashes_the_document_texts_whatever_their_order() -> None:
    a = {"mitre_id": "T1", "name": "One", "embedding_text": "One. x."}
    b = {"mitre_id": "T2", "name": "Two", "embedding_text": "Two. y."}
    assert exporter.document_texts_sha256([a, b]) == exporter.document_texts_sha256([b, a])
    assert exporter.document_texts_sha256([a, b]) != exporter.document_texts_sha256([a, dict(b, name="Too")])


def main_tests() -> int:
    plain: List[Callable[[], None]] = [
        other_providers_embed_the_text_alone,
        selection_needs_a_models_dir_and_excludes_embedding_provider,
        hashes_the_document_texts_whatever_their_order,
    ]
    with_env: List[Callable[[Env], None]] = [
        reads_the_ready_line_and_sends_titles_in_order,
        ends_the_helper_on_close,
        fails_a_start_the_helper_refuses,
        fails_and_ends_the_helper_on_a_bad_ready_line,
        refuses_a_ready_line_field_out_of_its_format,
        accepts_the_ready_line_fields_the_profiles_use,
        fails_when_the_helper_dies_mid_run,
        fails_on_a_short_reply,
        kills_a_helper_that_hangs_before_its_ready_line,
        kills_a_helper_that_never_replies,
        kills_a_helper_that_stops_reading_requests,
        the_ready_deadline_defaults_longer_with_a_download,
        fails_to_start_without_the_command,
        main_refuses_a_profile_with_embedding_provider,
        main_exports_with_the_profile_and_ends_the_helper,
        main_defaults_to_the_manifest_profile,
        main_refuses_a_legacy_manifest_without_a_provider,
        main_leaves_an_explicit_provider_alone,
        main_fails_when_no_provider_starts,
        writes_the_profile_into_every_file,
        writes_nothing_when_the_helper_fails,
        refuses_a_header_line_that_could_end_its_comment,
    ]
    failures = 0
    cases: List[Tuple[str, Callable[[], None]]] = [(f.__name__, f) for f in plain]
    for f in with_env:
        def run(f: Callable[[Env], None] = f) -> None:
            with tempfile.TemporaryDirectory() as tmp:
                f(Env(Path(tmp)))
        cases.append((f.__name__, run))
    for name, case in cases:
        try:
            case()
            print(f"ok   {name}")
        except Exception as err:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {type(err).__name__}: {err}")
    print(f"{len(cases) - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main_tests())
