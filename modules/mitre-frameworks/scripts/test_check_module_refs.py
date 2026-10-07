#!/usr/bin/env python3
"""
Tests for check_module_refs.py, without a database.

Each case builds a small data directory and module tree in a temporary directory: the
pinned ids come from `MERGE (n:<Label> {<key>: "<id>"})` lines, the references from
literal arrays in policies.rego files. The cases pin the platform's rules (allowed
pairs per field, bare-id dispatch, requirement refs left unchecked), the string-aware
array scan, and the known-failure list (a listed failure passes, a stale entry fails).
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path
from typing import Callable, Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_module_refs import (  # noqa: E402
    CheckError,
    check_modules,
    classify,
    load_pinned_ids,
    main,
    references_in,
)

DATA = {
    "01-attack-nodes.cypher": (
        'MERGE (n:MitreAttackTechnique {attack_id: "T1078"})\nON CREATE SET n.id = randomUUID();\n'
        'MERGE (n:MitreAttackTechnique {attack_id: "T1562.001"})\nSET n.name = "x";\n'
        'MERGE (n:MitreAttackMitigation {attack_id: "M1037"})\nSET n.name = "x";\n'
    ),
    "02-defend-nodes.cypher": 'MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTA"})\nSET n.name = "x";\n',
    "06-atlas-nodes.cypher": (
        'MERGE (n:MitreAtlasTechnique {atlas_id: "AML.T0051"})\nSET n.name = "x";\n'
        'MERGE (n:MitreAtlasMitigation {atlas_id: "AML.M0015"})\nSET n.name = "x";\n'
    ),
}


def ref(label: str, key: str, value: str) -> dict:
    return {"label": label, "property": key, "value": value, "attributes": {"justification": "a [bracket] \"quoted\""}}


def policy(**fields: list) -> str:
    body = ",\n".join(f'    "{name}": {json.dumps(refs, indent=8)}' for name, refs in fields.items())
    return f'package x\n\n_def := {{\n    "name": "n",\n{body}\n}}\n'


class Tree:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.data = root / "data"
        self.data.mkdir()
        for name, text in DATA.items():
            (self.data / name).write_text(text)

    def policy(self, rel: str, text: str) -> Path:
        path = self.root / rel / "policies.rego"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def run(self, *args: str) -> Tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = main(["--data", str(self.data), *args])
        return code, out.getvalue()


def with_tree(case: Callable[[Tree], None]) -> Callable[[], None]:
    def run() -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case(Tree(Path(tmp)))
    return run


def failures_of(tree: Tree, *modules: str, exclude: List[str] = ()) -> List[Tuple[str, str, str]]:
    pinned = load_pinned_ids(tree.data)
    failures, _, _ = check_modules([tree.root / m for m in modules], pinned, [tree.root / e for e in exclude])
    return [(f.field, f.reference, f.reason) for f in failures]


def eq(actual, expected) -> None:
    assert actual == expected, f"expected {expected!r}, got {actual!r}"


@with_tree
def resolves_every_allowed_pair(tree: Tree) -> None:
    tree.policy("mod/data/a", policy(
        exploited_by=[ref("MitreAttackTechnique", "attack_id", "T1078"), "T1562.001", "AML.T0051",
                      ref("MitreAtlasTechnique", "atlas_id", "AML.T0051")],
        responds_with=["M1037", "AML.M0015", "D3-NTA", ref("MitreDefendTechnique", "d3fendId", "D3-NTA"),
                       ref("RegulatoryRequirement", "id", "iso:A.9.99")],
        mitigates=["T1078"], protects_against=["AML.T0051"], detects=[], isolates=[], deceives=[],
        evicts=[], restores=[], responds_to=["T1078"],
    ))
    eq(failures_of(tree, "mod"), [])
    code, out = tree.run(str(tree.root / "mod"))
    eq(code, 0)
    assert "11 MITRE reference(s) in 1 policy file(s): 0 failure(s)" in out, out


@with_tree
def reports_ids_missing_from_the_data(tree: Tree) -> None:
    tree.policy("mod/data/a", policy(exploited_by=["T1562.010", ref("MitreAtlasTechnique", "atlas_id", "AML.T0999")],
                                     responds_with=["M9999"], detects=["T1562.010"]))
    eq(failures_of(tree, "mod"), [
        ("exploited_by", "T1562.010", "no MitreAttackTechnique with attack_id T1562.010 in the MITRE data"),
        ("exploited_by", "AML.T0999", "no MitreAtlasTechnique with atlas_id AML.T0999 in the MITRE data"),
        ("responds_with", "M9999", "no MitreAttackMitigation with attack_id M9999 in the MITRE data"),
        ("detects", "T1562.010", "no MitreAttackTechnique with attack_id T1562.010 in the MITRE data"),
    ])


@with_tree
def rejects_pairs_outside_the_set_for_the_field(tree: Tree) -> None:
    tree.policy("mod/data/a", policy(
        exploited_by=[ref("MitreAttackMitigation", "attack_id", "M1037"),
                      ref("MitreAttackTechnique", "attack_iexposured", "T1078"), "M1037", "D3F-UGPH"],
        responds_with=[ref("MitreAttackTechnique", "attack_id", "T1078"), "T1078"],
        mitigates=[ref("RegulatoryRequirement", "id", "iso:A.5.1")],
    ))
    eq([f[:2] for f in failures_of(tree, "mod")], [
        ("exploited_by", "MitreAttackMitigation.attack_id=M1037"),
        ("exploited_by", "MitreAttackTechnique.attack_iexposured=T1078"),
        ("exploited_by", "M1037"),
        ("exploited_by", "D3F-UGPH"),
        ("responds_with", "MitreAttackTechnique.attack_id=T1078"),
        ("responds_with", "T1078"),
        ("mitigates", "RegulatoryRequirement.id=iso:A.5.1"),
    ])
    assert all(f[2].startswith("not an allowed target for") for f in failures_of(tree, "mod"))


def reads_camel_case_fields_and_skips_strings() -> None:
    src = (
        '_def := {"description": "a \\"exploited_by\\": [ in prose",\n'
        '  "exploitedBy": ["T1078", {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1",'
        ' "attributes": {"justification": "] } [ {"}}],\n'
        '  "respondsTo": []}'
    )
    eq(list(references_in(src)), [
        ("exploitedBy", "T1078"),
        ("exploitedBy", {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1",
                         "attributes": {"justification": "] } [ {"}}),
    ])


def refuses_a_non_literal_array() -> None:
    try:
        list(references_in('_def := {"exploited_by": [techniques[_]]}'))
    except CheckError as err:
        assert "not a literal array" in str(err), err
        return
    raise AssertionError("expected CheckError")


def classifies_like_the_platform() -> None:
    eq(classify("technique", "AML.T0051.000"), (("MitreAtlasTechnique", "atlas_id"), "AML.T0051.000"))
    eq(classify("technique", "T1078X"), (None, "T1078X"))
    eq(classify("response", "D3-NTA"), (("MitreDefendTechnique", "d3fendId"), "D3-NTA"))
    eq(classify("response", {"label": "MitreAttackMitigation", "property": "attack_id", "value": ""}),
       (None, "MitreAttackMitigation.attack_id="))
    eq(classify("technique", 7), (None, "7"))


@with_tree
def skips_build_output_and_excluded_directories(tree: Tree) -> None:
    tree.policy("mod/dist/a", policy(exploited_by=["T0000"]))
    tree.policy("mod/node_modules/a", policy(exploited_by=["T0000"]))
    tree.policy("legacy/data/a", policy(exploited_by=["T0000"]))
    tree.policy("mod/data/old", policy(exploited_by=["T0000"]))
    eq(failures_of(tree, "mod", "legacy", exclude=["legacy", "mod/data/old"]), [])
    eq(len(failures_of(tree, "mod", "legacy")), 2)


@with_tree
def known_failures_pass_and_stale_entries_fail(tree: Tree) -> None:
    path = tree.policy("mod/data/a", policy(detects=["T1562.010"]))
    shown = path.as_posix()
    known = tree.root / "known.json"
    known.write_text(json.dumps([{"file": shown, "reference": "T1562.010", "reason": "fix in progress"}]))

    code, out = tree.run(str(tree.root / "mod"))
    eq(code, 1)
    assert f"{shown}: detects: T1562.010: no MitreAttackTechnique" in out, out

    code, out = tree.run("--known-failures", str(known), str(tree.root / "mod"))
    eq(code, 0)
    assert f"known: {shown}: detects: T1562.010" in out, out

    tree.policy("mod/data/a", policy(detects=["T1078"]))
    code, out = tree.run("--known-failures", str(known), str(tree.root / "mod"))
    eq(code, 1)
    assert f"{shown}: T1562.010: listed as a known failure but resolves now; remove the entry" in out, out


@with_tree
def enforces_the_reference_floor(tree: Tree) -> None:
    tree.policy("mod/data/a", policy(detects=["T1078", "T1562.001"]))
    eq(tree.run("--min-references", "2", str(tree.root / "mod"))[0], 0)
    code, out = tree.run("--min-references", "3", str(tree.root / "mod"))
    eq(code, 1)
    assert "only 2 MITRE reference(s) checked, below the floor of 3" in out, out


@with_tree
def known_failure_entries_need_a_reason(tree: Tree) -> None:
    tree.policy("mod/data/a", policy(detects=["T1078"]))
    known = tree.root / "known.json"
    known.write_text(json.dumps([{"file": "x", "reference": "T1"}]))
    code, out = tree.run("--known-failures", str(known), str(tree.root / "mod"))
    eq(code, 1)
    assert "every entry needs file, reference and reason" in out, out


@with_tree
def unreadable_policies_and_missing_data_fail(tree: Tree) -> None:
    tree.policy("mod/data/a", '_def := {"exploited_by": [x]}')
    code, out = tree.run(str(tree.root / "mod"))
    eq(code, 1)
    assert "cannot read the references" in out, out

    code, out = tree.run("--data", str(tree.root / "nowhere"), str(tree.root / "mod"))
    eq(code, 1)
    assert "no *.cypher data files" in out, out

    code, out = tree.run(str(tree.root / "missing"))
    eq(code, 1)
    assert "not a directory" in out, out


def loads_pinned_ids_by_label_and_key() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        ids: Dict = load_pinned_ids(Tree(Path(tmp)).data)
    eq(ids[("MitreAttackTechnique", "attack_id")], {"T1078", "T1562.001"})
    eq(ids[("MitreDefendTechnique", "d3fendId")], {"D3-NTA"})
    eq(ids[("MitreAtlasMitigation", "atlas_id")], {"AML.M0015"})


CASES: List[Tuple[str, Callable[[], None]]] = [
    ("resolves every allowed pair, bare and object", resolves_every_allowed_pair),
    ("reports ids missing from the data", reports_ids_missing_from_the_data),
    ("rejects pairs outside the set for the field", rejects_pairs_outside_the_set_for_the_field),
    ("reads camel-case fields and skips strings", reads_camel_case_fields_and_skips_strings),
    ("refuses a non-literal array", refuses_a_non_literal_array),
    ("classifies like the platform", classifies_like_the_platform),
    ("skips build output and excluded directories", skips_build_output_and_excluded_directories),
    ("known failures pass and stale entries fail", known_failures_pass_and_stale_entries_fail),
    ("enforces the reference floor", enforces_the_reference_floor),
    ("known-failure entries need a reason", known_failure_entries_need_a_reason),
    ("unreadable policies and missing data fail", unreadable_policies_and_missing_data_fail),
    ("loads pinned ids by label and key", loads_pinned_ids_by_label_and_key),
]


def main_tests() -> int:
    failed = 0
    for name, case in CASES:
        try:
            case()
        except AssertionError as err:
            print(f"FAIL {name}: {err}")
            failed += 1
    if failed:
        print(f"{failed} of {len(CASES)} module reference check test(s) failed")
        return 1
    print(f"all module reference check tests passed ({len(CASES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main_tests())
