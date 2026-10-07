#!/usr/bin/env python3
"""
Check that every MITRE reference a module's policies declare resolves against the
pinned MITRE data of this pack.

A class's exposures (`exploited_by`) and countermeasures (`responds_with` and the
eight verb fields) reference MITRE nodes. When the platform instantiates a class it
links only the references it can resolve and records the rest on the finding as
unlinked, so a reference to an id this pack does not carry is a content defect that
reaches users. This check finds them before release. It applies the platform's
rules:

- `exploited_by` and the verbs may target an ATT&CK or ATLAS technique;
  `responds_with` an ATT&CK or ATLAS mitigation, a D3FEND technique or a
  regulatory requirement. Any other label/key pair is an error.
- A bare id dispatches by shape: T… (ATT&CK technique), AML.T… (ATLAS technique),
  M… (ATT&CK mitigation), AML.M… (ATLAS mitigation), D3-… (D3FEND technique).
- Regulatory requirement references are not checked: their nodes belong to the
  pack that declares them.

A known failure (a defect whose fix is under way) can be listed in a JSON file of
`{"file": <path>, "reference": <reference>, "reason": <text>}` entries, with paths
as this script prints them. A listed failure does not fail the check; a listed
entry that no longer fails does, so the fix has to remove its entry.

`--min-references N` makes the run fail when it checked fewer than N references, so
a module tree that failed to check out cannot pass as "0 failures".

Usage: check_module_refs.py [--data DIR] [--known-failures FILE] [--exclude DIR]...
                            [--min-references N] MODULE_DIR...
Exits 1 on any failure, stale known-failure entry or a count below the floor.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Set, Tuple

Pair = Tuple[str, str]

ATTACK_TECHNIQUE: Pair = ("MitreAttackTechnique", "attack_id")
ATLAS_TECHNIQUE: Pair = ("MitreAtlasTechnique", "atlas_id")
ATTACK_MITIGATION: Pair = ("MitreAttackMitigation", "attack_id")
ATLAS_MITIGATION: Pair = ("MitreAtlasMitigation", "atlas_id")
DEFEND_TECHNIQUE: Pair = ("MitreDefendTechnique", "d3fendId")
REGULATORY_REQUIREMENT: Pair = ("RegulatoryRequirement", "id")

# The platform's closed set of targets per field kind, and its bare-id dispatch.
PAIRS = {
    "technique": [ATTACK_TECHNIQUE, ATLAS_TECHNIQUE],
    "response": [ATTACK_MITIGATION, ATLAS_MITIGATION, DEFEND_TECHNIQUE, REGULATORY_REQUIREMENT],
}
BARE_DISPATCH = {
    "technique": [
        (re.compile(r"T\d{4}(\.\d{3})?"), ATTACK_TECHNIQUE),
        (re.compile(r"AML\.T\d{4}(\.\d{3})?"), ATLAS_TECHNIQUE),
    ],
    "response": [
        (re.compile(r"M\d{4}"), ATTACK_MITIGATION),
        (re.compile(r"AML\.M\d{4}"), ATLAS_MITIGATION),
        (re.compile(r"D3-[A-Za-z0-9]+"), DEFEND_TECHNIQUE),
    ],
}
UNCHECKED_PAIRS = {REGULATORY_REQUIREMENT}

VERBS = ["mitigates", "protects_against", "detects", "isolates", "deceives", "evicts", "restores", "responds_to"]
FIELD_KINDS: Dict[str, str] = {"exploited_by": "technique", "responds_with": "response"}
FIELD_KINDS.update({verb: "technique" for verb in VERBS})


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


# Modules may spell a field in snake or camel case; the platform reads both.
FIELD_KINDS.update({_camel(name): kind for name, kind in list(FIELD_KINDS.items())})
FIELD_RE = re.compile(r'"(' + "|".join(re.escape(f) for f in FIELD_KINDS) + r')"\s*:\s*\[')

NODE_RE = re.compile(r'^MERGE \(n:(\w+) \{(\w+): "((?:[^"\\]|\\.)*)"\}\)', re.M)
SKIPPED_DIRS = {"node_modules", "dist", ".turbo", ".venv", "__pycache__"}


class CheckError(Exception):
    pass


@dataclass(frozen=True)
class Failure:
    file: str
    field: str
    reference: str
    reason: str


def load_pinned_ids(data_dir: Path) -> Dict[Pair, Set[str]]:
    """Every node key in the pack's data files, by (label, key)."""
    ids: Dict[Pair, Set[str]] = {}
    files = sorted(data_dir.glob("*.cypher"))
    if not files:
        raise CheckError(f"no *.cypher data files in {data_dir}")
    for path in files:
        for label, key, value in NODE_RE.findall(path.read_text(encoding="utf-8")):
            ids.setdefault((label, key), set()).add(json.loads(f'"{value}"'))
    return ids


def array_extent(src: str, start: int) -> int:
    """Index just past the array literal whose `[` is at `start`; string-aware."""
    depth = 0
    i = start
    while i < len(src):
        ch = src[i]
        if ch == '"':
            i += 1
            while i < len(src) and src[i] != '"':
                i += 2 if src[i] == "\\" else 1
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise CheckError("unterminated array literal")


def references_in(src: str) -> Iterator[Tuple[str, object]]:
    """(field, reference) for every reference in the policy's literal reference arrays."""
    for match in FIELD_RE.finditer(src):
        field = match.group(1)
        start = match.end() - 1
        literal = src[start:array_extent(src, start)]
        try:
            refs = json.loads(literal)
        except json.JSONDecodeError as err:
            raise CheckError(f"`{field}` is not a literal array ({err.msg})") from err
        for ref in refs:
            yield field, ref


def classify(kind: str, ref: object) -> Tuple[Optional[Pair], str]:
    """The allowed pair for a reference (None when outside the set) and its display form."""
    if isinstance(ref, str):
        for pattern, pair in BARE_DISPATCH[kind]:
            if pattern.fullmatch(ref):
                return pair, ref
        return None, ref
    if isinstance(ref, dict):
        label, key, value = ref.get("label"), ref.get("property"), ref.get("value")
        pair = (label, key)
        if pair in PAIRS[kind] and isinstance(value, str) and value:
            return pair, value  # type: ignore[return-value]
        return None, f"{label}.{key}={value}"
    return None, json.dumps(ref)


def policy_files(module_dir: Path, excluded: List[Path]) -> Iterator[Path]:
    for root, dirs, files in os.walk(module_dir):
        root_path = Path(root)
        dirs[:] = sorted(
            d for d in dirs if d not in SKIPPED_DIRS and not any((root_path / d).resolve() == e for e in excluded)
        )
        for name in sorted(files):
            if name == "policies.rego":
                yield root_path / name


def check_modules(
    module_dirs: Iterable[Path], pinned: Dict[Pair, Set[str]], excluded: Iterable[Path] = ()
) -> Tuple[List[Failure], int, int]:
    """(failures, policy files read, references checked)."""
    excluded_resolved = [Path(e).resolve() for e in excluded]
    failures: List[Failure] = []
    files_read = 0
    checked = 0
    for module_dir in module_dirs:
        if Path(module_dir).resolve() in excluded_resolved:
            continue
        for path in policy_files(Path(module_dir), excluded_resolved):
            files_read += 1
            shown = path.as_posix()
            try:
                refs = list(references_in(path.read_text(encoding="utf-8")))
            except CheckError as err:
                failures.append(Failure(shown, "-", "-", f"cannot read the references: {err}"))
                continue
            for field, ref in refs:
                pair, display = classify(FIELD_KINDS[field], ref)
                if pair is None:
                    failures.append(Failure(shown, field, display, f"not an allowed target for `{field}`"))
                    continue
                if pair in UNCHECKED_PAIRS:
                    continue
                checked += 1
                if display not in pinned.get(pair, set()):
                    failures.append(Failure(shown, field, display, f"no {pair[0]} with {pair[1]} {display} in the MITRE data"))
    return failures, files_read, checked


def load_known_failures(path: Path) -> Set[Tuple[str, str]]:
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise CheckError(f"{path}: expected a JSON list")
    known = set()
    for entry in entries:
        if not (isinstance(entry, dict) and entry.get("file") and entry.get("reference") and entry.get("reason")):
            raise CheckError(f"{path}: every entry needs file, reference and reason: {entry!r}")
        known.add((entry["file"], entry["reference"]))
    return known


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("modules", nargs="+", type=Path, help="module directories to check")
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parent.parent / "data")
    parser.add_argument("--known-failures", type=Path)
    parser.add_argument("--exclude", type=Path, action="append", default=[], help="directory to skip")
    parser.add_argument("--min-references", type=int, default=0, help="fail below this many checked references")
    args = parser.parse_args(argv)

    try:
        pinned = load_pinned_ids(args.data)
        known = load_known_failures(args.known_failures) if args.known_failures else set()
        for module in args.modules:
            if not module.is_dir():
                raise CheckError(f"not a directory: {module}")
        failures, files_read, checked = check_modules(args.modules, pinned, args.exclude)
    except CheckError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1

    seen = {(f.file, f.reference) for f in failures}
    unexpected = [f for f in failures if (f.file, f.reference) not in known]
    expected = [f for f in failures if (f.file, f.reference) in known]
    stale = sorted(known - seen)

    for f in unexpected:
        print(f"{f.file}: {f.field}: {f.reference}: {f.reason}")
    for f in expected:
        print(f"known: {f.file}: {f.field}: {f.reference}: {f.reason}")
    for file, reference in stale:
        print(f"{file}: {reference}: listed as a known failure but resolves now; remove the entry")
    print(
        f"{checked} MITRE reference(s) in {files_read} policy file(s): "
        f"{len(unexpected)} failure(s), {len(expected)} known, {len(stale)} stale known-failure entr(y/ies)"
    )
    below_floor = checked < args.min_references
    if below_floor:
        print(f"only {checked} MITRE reference(s) checked, below the floor of {args.min_references}")
    return 1 if unexpected or stale or below_floor else 0


if __name__ == "__main__":
    sys.exit(main())
