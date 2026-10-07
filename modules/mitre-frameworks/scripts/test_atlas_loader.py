#!/usr/bin/env python3
"""
ATLAS loader and crosswalk tests, on a trimmed copy of the pinned bundles.

fixtures/atlas-mini.json holds five ATLAS objects (two tactics, AML.T0016 with its
sub-technique AML.T0016.001, AML.T0073, one mitigation, the case study AML.CS0030,
which uses AML.T0016.001 in two procedure steps) and a matrix trimmed to those
tactics. fixtures/attack-mini.json holds the ATT&CK techniques they cite, including
T1656, which ATT&CK v19 revoked in favour of T1684.001.

Each case mutates a fresh copy of a fixture and asserts the loader accepts or rejects
it, so the fail-loud paths are exercised without a database or network.
"""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atlas_stix import (  # noqa: E402
    AtlasDataError,
    parse_atlas_bundle,
    resolve_attack_refs,
    verify_sha256,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"
ATLAS = json.loads((FIXTURES / "atlas-mini.json").read_text(encoding="utf-8"))
ATTACK = json.loads((FIXTURES / "attack-mini.json").read_text(encoding="utf-8"))


def encode(bundle: Dict[str, Any]) -> bytes:
    return json.dumps(bundle).encode("utf-8")


def find(bundle: Dict[str, Any], external_id: str) -> Dict[str, Any]:
    for obj in bundle["objects"]:
        for ref in obj.get("external_references", []):
            if ref.get("external_id") == external_id:
                return obj
    raise KeyError(external_id)


def mutated(bundle: Dict[str, Any], change: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
    out = copy.deepcopy(bundle)
    change(out)
    return out


def test_parse() -> None:
    corpus = parse_atlas_bundle(encode(ATLAS))
    counts = {label: len(rows) for label, rows in corpus["nodes"].items()}
    assert counts == {
        "MitreAtlasTechnique": 3,
        "MitreAtlasTactic": 2,
        "MitreAtlasMitigation": 1,
        "MitreAtlasCaseStudy": 1,
    }, counts

    techniques = {p["atlas_id"]: p for p in corpus["nodes"]["MitreAtlasTechnique"]}
    assert techniques["AML.T0016.001"]["atlas_subtechnique"] is True
    assert techniques["AML.T0016"]["atlas_subtechnique"] is False
    assert techniques["AML.T0073"]["ref_url"] == "https://atlas.mitre.org/techniques/AML.T0073"
    assert all("attack_id" not in p for rows in corpus["nodes"].values() for p in rows)

    tactics = {p["atlas_id"]: p["matrix_order"] for p in corpus["nodes"]["MitreAtlasTactic"]}
    assert tactics == {"AML.TA0003": 0, "AML.TA0007": 1}, tactics

    edges = corpus["edges"]
    assert len(edges) == len(set(edges))
    uses = [e for e in edges if e[0] == "CAMPAIGN_USES_TECHNIQUE"]
    # Two procedure steps on the same technique are one edge.
    assert ("CAMPAIGN_USES_TECHNIQUE", "MitreAtlasCaseStudy", "AML.CS0030",
            "MitreAtlasTechnique", "AML.T0016.001") in uses
    assert len(uses) == 1, uses
    assert ("SUBTECHNIQUE_OF", "MitreAtlasTechnique", "AML.T0016.001",
            "MitreAtlasTechnique", "AML.T0016") in edges
    assert ("TACTIC_INCLUDES_TECHNIQUE", "MitreAtlasTactic", "AML.TA0007",
            "MitreAtlasTechnique", "AML.T0073") in edges
    assert any(e[0] == "MITIGATION_DEFENDS_AGAINST_TECHNIQUE" for e in edges)

    assert parse_atlas_bundle(encode(ATLAS)) == corpus, "parse is not deterministic"


def test_crosswalk() -> None:
    corpus = parse_atlas_bundle(encode(ATLAS))
    resolved = resolve_attack_refs(corpus["attack_refs"], ATTACK)
    assert ("AML.T0073", "T1656", "T1684.001") in resolved, resolved
    assert ("AML.T0016", "T1588", "T1588") in resolved, resolved
    assert ("AML.T0016.001", "T1588.002", "T1588.002") in resolved, resolved


def test_sha256() -> None:
    data = encode(ATLAS)
    verify_sha256(data, hashlib.sha256(data).hexdigest(), "fixture")
    expect_error(lambda: verify_sha256(data, "0" * 64, "fixture"), "does not match")


def expect_error(action: Callable[[], Any], fragment: str) -> None:
    try:
        action()
    except AtlasDataError as err:
        assert fragment in str(err), f"wrong error: {err}"
        return
    raise AssertionError(f"expected an AtlasDataError containing {fragment!r}")


def parse_rejects(change: Callable[[Dict[str, Any]], None], fragment: str) -> Callable[[], None]:
    return lambda: expect_error(lambda: parse_atlas_bundle(encode(mutated(ATLAS, change))), fragment)


def crosswalk_rejects(
    change: Callable[[Dict[str, Any]], None], fragment: str, expectations: Dict[str, str] = None
) -> Callable[[], None]:
    refs = parse_atlas_bundle(encode(ATLAS))["attack_refs"]
    return lambda: expect_error(
        lambda: resolve_attack_refs(refs, mutated(ATTACK, change), expectations), fragment
    )


def _set_kill_chain(bundle: Dict[str, Any]) -> None:
    find(bundle, "AML.T0073")["kill_chain_phases"][0]["kill_chain_name"] = "mitre-attack"


def _unknown_phase(bundle: Dict[str, Any]) -> None:
    find(bundle, "AML.T0073")["kill_chain_phases"][0]["phase_name"] = "no-such-tactic"


def _unknown_type(bundle: Dict[str, Any]) -> None:
    bundle["objects"].append({"type": "intrusion-set", "id": "intrusion-set--x"})


def _unknown_relationship(bundle: Dict[str, Any]) -> None:
    rel = next(o for o in bundle["objects"] if o["type"] == "relationship")
    rel["relationship_type"] = "related-to"


def _dangling(bundle: Dict[str, Any]) -> None:
    rel = next(o for o in bundle["objects"] if o["type"] == "relationship")
    rel["target_ref"] = "attack-pattern--00000000-0000-0000-0000-000000000000"


def _matrix_drops_tactic(bundle: Dict[str, Any]) -> None:
    matrix = next(o for o in bundle["objects"] if o["type"] == "x-mitre-matrix")
    matrix["tactic_refs"] = matrix["tactic_refs"][:1]


def _duplicate_id(bundle: Dict[str, Any]) -> None:
    clone = copy.deepcopy(find(bundle, "AML.T0073"))
    clone["id"] = "attack-pattern--00000000-0000-0000-0000-000000000001"
    bundle["objects"].append(clone)


def _bad_id(bundle: Dict[str, Any]) -> None:
    for ref in find(bundle, "AML.M0001")["external_references"]:
        if ref["source_name"] == "mitre-atlas":
            ref["external_id"] = "AML.T9999"


def _sub_flag(bundle: Dict[str, Any]) -> None:
    find(bundle, "AML.T0016.001")["x_mitre_is_subtechnique"] = False


def _wrong_endpoints(bundle: Dict[str, Any]) -> None:
    rel = next(o for o in bundle["objects"]
               if o["type"] == "relationship" and o["relationship_type"] == "mitigates")
    rel["source_ref"], rel["target_ref"] = rel["target_ref"], rel["source_ref"]


def _remove_successor(bundle: Dict[str, Any]) -> None:
    bundle["objects"] = [o for o in bundle["objects"] if o.get("relationship_type") != "revoked-by"]


def _remove_target(bundle: Dict[str, Any]) -> None:
    bundle["objects"] = [o for o in bundle["objects"]
                         if not any(r.get("external_id") == "T1588" for r in o.get("external_references", []))]


def _deprecate_successor(bundle: Dict[str, Any]) -> None:
    find(bundle, "T1684.001")["x_mitre_deprecated"] = True


def _revoke_live_target(bundle: Dict[str, Any]) -> None:
    # T1588.002 revoked in favour of T1684.001: a revocation the table does not list.
    find(bundle, "T1588.002")["revoked"] = True
    rel = copy.deepcopy(next(o for o in bundle["objects"] if o.get("relationship_type") == "revoked-by"))
    rel["id"] = "relationship--00000000-0000-0000-0000-000000000002"
    rel["source_ref"] = find(bundle, "T1588.002")["id"]
    bundle["objects"].append(rel)


CASES: List[Tuple[str, Callable[[], None]]] = [
    ("parse", test_parse),
    ("crosswalk", test_crosswalk),
    ("sha256", test_sha256),
    ("rejects a foreign kill chain", parse_rejects(_set_kill_chain, "unexpected kill chain")),
    ("rejects a phase naming no tactic", parse_rejects(_unknown_phase, "names no tactic")),
    ("rejects an unknown object type", parse_rejects(_unknown_type, "unexpected STIX object type")),
    ("rejects an unknown relationship", parse_rejects(_unknown_relationship, "unexpected relationship type")),
    ("rejects a dangling reference", parse_rejects(_dangling, "outside the bundle")),
    ("rejects a matrix that drops a tactic", parse_rejects(_matrix_drops_tactic, "every tactic")),
    ("rejects a duplicate ATLAS id", parse_rejects(_duplicate_id, "duplicate ATLAS id")),
    ("rejects an id of the wrong kind", parse_rejects(_bad_id, "does not fit")),
    ("rejects a wrong sub-technique flag", parse_rejects(_sub_flag, "sub-technique flag")),
    ("rejects a relationship between wrong kinds", parse_rejects(_wrong_endpoints, "mitigates from")),
    ("rejects a revoked target with no successor", crosswalk_rejects(_remove_successor, "no live successor")),
    ("rejects a target ATT&CK lacks", crosswalk_rejects(_remove_target, "0 ATT&CK techniques")),
    ("rejects a deprecated final target", crosswalk_rejects(_deprecate_successor, "deprecated")),
    ("rejects an unlisted revocation", crosswalk_rejects(_revoke_live_target, "expectation table says None")),
    ("rejects a wrong expectation",
     crosswalk_rejects(lambda b: None, "expectation table says T9999", {"T1656": "T9999"})),
    ("rejects a stale expectation",
     crosswalk_rejects(lambda b: None, "no ATLAS technique cites",
                       {"T1656": "T1684.001", "T1000": "T1001"})),
]


def main() -> int:
    failed = 0
    for name, case in CASES:
        try:
            case()
        except AssertionError as err:
            print(f"FAIL {name}: {err}")
            failed += 1
    if failed:
        print(f"{failed} of {len(CASES)} ATLAS loader test(s) failed")
        return 1
    print(f"all ATLAS loader tests passed ({len(CASES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
