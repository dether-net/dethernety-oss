#!/usr/bin/env python3
"""
Check the committed MITRE embeddings files against the manifest's embedding profile.

For data/05-mitre-embeddings.cypher and data/09-atlas-embeddings.cypher: the file exists;
its first `// Model:` header names manifest.json's `embeddingProfile`, with 768 dimensions;
one `// Profile:` header names it too (the line the embedder's profile path writes; the
legacy Ollama profile has none); the file splits into statements; every statement is one
UNWIND batch of at least one row for one label that sets `embeddingModel` exactly once, to
that profile, and starts with its UNWIND; each label has its pinned row count; and every
vector has 768 finite numbers and unit length. A file from another model, a half
regeneration, a truncated file, an appended statement of any other kind or a clause placed
before a batch's UNWIND fails.

The rules are the Go check's (oss/pkg/cypher/embeddings_files_test.go,
embeddingsFileProblems), which runs in CI on the files the console embeds; this port keeps
its regular expressions and its statement splitter (oss/pkg/cypher/parse.go,
ParseStatements), so the two accept the same files.

The row counts are pinned to the releases this module ships, as check_loaded_corpus.py
pins the node counts: a release bump changes them on purpose.

Usage: check_embeddings_files.py [<module dir>]
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Dict, List

DIMENSIONS = 768
# The legacy profile is Ollama's embeddinggemma: its files carry no // Profile: line.
LEGACY_PROFILE = "embeddinggemma"
EXPECTED_ROWS: Dict[str, Dict[str, int]] = {
    "05-mitre-embeddings.cypher": {"MitreAttackTechnique": 697, "MitreDefendTechnique": 271, "MitreAttackMitigation": 44},
    "09-atlas-embeddings.cypher": {"MitreAtlasTechnique": 208, "MitreAtlasMitigation": 40},
}

# The Go check's expressions, with Go's character classes spelled out: Go's \s is
# [\t\n\f\r ], its \S the complement, its \w and \d ASCII only.
_S = r"[\t\n\f\r ]"
_NS = r"[^\t\n\f\r ]"
_W = r"[0-9A-Za-z_]"
MODEL_HEADER = re.compile(rf"^// Model: ({_NS}+)  Dimensions: ([0-9]+)$", re.M)
PROFILE_HEADER = re.compile(rf"^// Profile: ({_NS}+)  ", re.M)
EMBEDDING_ROW = re.compile(rf'^{_S}*\{{ {_W}+: "[^"]+", embedding: \[([^\]]*)\] \}},?$', re.M)
# The whole statement, exactly as the exporter writes it: the others search inside a statement,
# so a clause before the UNWIND, or between its rows and the MATCH, would pass them.
STATEMENT_SHAPE = re.compile(
    r"UNWIND \[\n"
    # No backslash in a row's id: one before the closing quote would escape it and run the string on.
    rf'(?:  \{{ {_W}+: "[^"\\\n]*", embedding: \[[^\]\n]*\] \}},?\n)+'
    r"\] AS row\n"
    rf"MATCH \(n:{_W}+ \{{{_W}+: row\.{_W}+\}}\)\n"
    r"SET n\.embedding = row\.embedding,\n"
    r'    n\.embeddingModel = "[^"\n]*"'
)
MATCH_LABEL = re.compile(rf"^MATCH \(n:({_W}+) \{{", re.M)
SET_MODEL = re.compile(rf'^{_S}*n\.embeddingModel = "([^"]*)"$', re.M)


def parse_statements(content: str) -> List[str]:
    """Split content as the Go splitter does (oss/pkg/cypher/parse.go, ParseStatements).

    Semicolons end statements except inside string literals and comments; comments are
    dropped (a line comment keeps its newline); a backslash carries the next character
    through, inside a string or not; blank statements are omitted. Raises ValueError when
    the input ends inside a string literal or a block comment, as Go returns an error.
    load_committed_data.parse_cypher_statements is not reused: it neither fails on a
    truncated file nor carries a backslash outside a string.
    """
    statements: List[str] = []
    current: List[str] = []
    in_string = in_line = in_block = False
    quote = ""
    i, n = 0, len(content)

    def flush() -> None:
        stmt = "".join(current).strip()
        if stmt:
            statements.append(stmt)
        current.clear()

    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if not in_string and not in_line and not in_block and ch == "/" and nxt == "*":
            in_block = True
            i += 2
            continue
        if in_block and ch == "*" and nxt == "/":
            in_block = False
            i += 2
            continue
        if in_block:
            i += 1
            continue
        if not in_string and not in_line and ch == "/" and nxt == "/":
            in_line = True
            i += 2
            continue
        if in_line and ch == "\n":
            in_line = False
            current.append("\n")
            i += 1
            continue
        if in_line:
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            current.append(content[i : i + 2])
            i += 2
            continue
        if not in_string and ch in ("'", '"'):
            in_string, quote = True, ch
        elif in_string and ch == quote:
            in_string = False
        elif not in_string and ch == ";":
            flush()
            i += 1
            continue
        current.append(ch)
        i += 1
    if in_string:
        raise ValueError("unterminated string literal")
    if in_block:
        raise ValueError("unterminated block comment")
    flush()
    return statements


def vector_problem(numbers: str) -> str:
    """What is wrong with one vector literal's numbers, or "" when it has DIMENSIONS finite
    numbers of unit length."""
    parts = numbers.split(",")
    if len(parts) != DIMENSIONS:
        return f"a vector without {DIMENSIONS} finite numbers ({len(parts)} numbers)"
    total = 0.0
    for part in parts:
        try:
            x = float(part.strip())
        except ValueError:
            x = math.nan
        if not math.isfinite(x):
            return f"a vector without {DIMENSIONS} finite numbers (not finite: {part.strip()})"
        total += x * x
    if abs(math.sqrt(total) - 1.0) > 1e-3:
        return f"a vector that is not unit length (norm {math.sqrt(total):.4f})"
    return ""


def file_problems(name: str, content: str, profile: str, expected: Dict[str, int]) -> List[str]:
    """Every way content disagrees with profile and the pinned rows; empty when it passes."""
    problems: List[str] = []
    header = MODEL_HEADER.search(content)
    model_header = (header.group(1), int(header.group(2))) if header else None
    if model_header != (profile, DIMENSIONS):
        problems.append(f"{name}: the Model header is {model_header}, expected ({profile!r}, {DIMENSIONS})")
    profile_lines = PROFILE_HEADER.findall(content)
    for named in profile_lines:
        if named != profile:
            problems.append(f"{name}: the Profile header names {named!r}, not {profile!r}")
    want_profile_lines = 0 if profile == LEGACY_PROFILE else 1
    if len(profile_lines) != want_profile_lines:
        problems.append(f"{name}: {len(profile_lines)} Profile header lines, expected {want_profile_lines}")

    try:
        statements = parse_statements(content)
    except ValueError as err:
        return problems + [f"{name}: the file does not parse: {err}"]
    rows: Dict[str, int] = {}
    for i, stmt in enumerate(statements):
        label = MATCH_LABEL.search(stmt)
        models = SET_MODEL.findall(stmt)
        vectors = EMBEDDING_ROW.findall(stmt)
        if not STATEMENT_SHAPE.fullmatch(stmt) or label is None or len(models) != 1 or not vectors:
            problems.append(
                f"{name}: statement {i} is not one UNWIND batch for one label that sets embeddingModel: {stmt[:120]!r}"
            )
            continue
        if models[0] != profile:
            problems.append(f"{name}: statement {i} sets embeddingModel {models[0]!r}, expected {profile!r}")
        rows[label.group(1)] = rows.get(label.group(1), 0) + len(vectors)
        for r, numbers in enumerate(vectors):
            msg = vector_problem(numbers)
            if msg:
                problems.append(f"{name}: statement {i}, row {r}: {msg}")
                break
    if rows != expected:
        problems.append(f"{name}: rows per label are {rows}, expected {expected}")
    return problems


def check_file(path: Path, profile: str, expected: Dict[str, int]) -> List[str]:
    """The problems with one file; empty when it passes."""
    if not path.is_file():
        return [f"{path.name}: missing"]
    return file_problems(path.name, path.read_text(encoding="utf-8"), profile, expected)


def check_module(module_dir: Path) -> List[str]:
    manifest = json.loads((module_dir / "manifest.json").read_text(encoding="utf-8"))
    profile = manifest.get("embeddingProfile")
    if not isinstance(profile, str) or not profile:
        return ["manifest.json: no embeddingProfile"]
    problems: List[str] = []
    for name, expected in EXPECTED_ROWS.items():
        problems += check_file(module_dir / "data" / name, profile, expected)
    return problems


def main() -> int:
    if len(sys.argv) > 2:
        print(__doc__)
        return 2
    module_dir = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).resolve().parent.parent
    problems = check_module(module_dir)
    for problem in problems:
        print(f"[error] {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"[info] the embeddings files match the manifest's profile: {', '.join(EXPECTED_ROWS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
