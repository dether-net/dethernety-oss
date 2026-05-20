#!/usr/bin/env python3
"""
MITRE composer byte-equality (Python side).

Sentinel: keep fixtures BYTE-EQUAL with
oss/apps/dt-ws/test/integration/mitre-composer-byte-equality.e2e-spec.ts.
If you edit fixtures, edit BOTH files in the same PR — byte-equality
is asserted by parallel tests on a shared fixture set.

This script also tests normalize_for_embedding — Python-only, no TS counterpart.
"""

from __future__ import annotations
import sys
from pathlib import Path

# Make sibling modules importable when invoked directly from any cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from embedding_text import (  # noqa: E402
    compose_mitigation_text,
    compose_technique_text,
    normalize_for_embedding,
)


# ---------------------------------------------------------------------------
# Technique fixtures — MUST match the TS test 1:1.
# ---------------------------------------------------------------------------
TECHNIQUE_FIXTURES = [
    {
        "in": {
            "name": "OS Credential Dumping",
            "description": "Adversaries may attempt to dump credentials...",
            "tactic": "Credential Access",
        },
        "out": "OS Credential Dumping. Adversaries may attempt to dump credentials.... Tactic: Credential Access.",
    },
    {
        "in": {"name": "T1003.001", "description": "LSASS Memory.", "tactic": "Credential Access"},
        "out": "T1003.001. LSASS Memory.. Tactic: Credential Access.",
    },
    {
        "in": {"name": "No description", "tactic": "Initial Access"},
        "out": "No description. . Tactic: Initial Access.",
    },
    {
        "in": {"name": "No tactic", "description": "Some desc."},
        "out": "No tactic. Some desc.. Tactic: Unknown.",
    },
    {
        "in": {"name": "Bare name"},
        "out": "Bare name. . Tactic: Unknown.",
    },
]

# ---------------------------------------------------------------------------
# Mitigation fixtures — MUST match the TS test 1:1.
# ---------------------------------------------------------------------------
MITIGATION_FIXTURES = [
    {
        "in": {"name": "Privileged Account Management", "description": "Manage privileged accounts."},
        "out": "Privileged Account Management. Manage privileged accounts..",
    },
    {
        "in": {"name": "No description"},
        "out": "No description. .",
    },
    {
        "in": {"name": "Empty description", "description": ""},
        "out": "Empty description. .",
    },
]

# ---------------------------------------------------------------------------
# normalize_for_embedding — Python-only.
# ---------------------------------------------------------------------------
NORMALIZE_FIXTURES = [
    ("smart quote ‘x’", "smart quote 'x'"),
    ("em-dash — here", "em-dash -- here"),
    ("en-dash – there", "en-dash - there"),
    ("ellipsis …", "ellipsis ..."),
    ("multi\nline\rtext\there", "multi line text here"),
    (None, ""),
    ("", ""),
]


def main() -> int:
    fail = 0

    for fx in TECHNIQUE_FIXTURES:
        got = compose_technique_text(**fx["in"])
        if got != fx["out"]:
            print(f"FAIL technique: {fx['in']!r} -> {got!r} (expected {fx['out']!r})")
            fail += 1

    for fx in MITIGATION_FIXTURES:
        got = compose_mitigation_text(**fx["in"])
        if got != fx["out"]:
            print(f"FAIL mitigation: {fx['in']!r} -> {got!r} (expected {fx['out']!r})")
            fail += 1

    for raw, expected in NORMALIZE_FIXTURES:
        got = normalize_for_embedding(raw)
        if got != expected:
            print(f"FAIL normalize: {raw!r} -> {got!r} (expected {expected!r})")
            fail += 1

    total = len(TECHNIQUE_FIXTURES) + len(MITIGATION_FIXTURES) + len(NORMALIZE_FIXTURES)
    if fail:
        print(f"{fail} of {total} test(s) failed")
        return 1
    print(
        f"all composer tests passed "
        f"({len(TECHNIQUE_FIXTURES)} technique, {len(MITIGATION_FIXTURES)} mitigation, "
        f"{len(NORMALIZE_FIXTURES)} normalize)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
