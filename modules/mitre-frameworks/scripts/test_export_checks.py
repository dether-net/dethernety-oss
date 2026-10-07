#!/usr/bin/env python3
"""
Exporter identity and routing checks, without a database.

The exporter writes a MERGE keyed on each node's one mapped label and key, and files each
relationship under its framework. These cases pin the inputs it must refuse instead of
guessing: no mapped label or two, a missing key, an ATLAS edge to another framework other
than the crosswalk, and a cross-framework edge of a structural type. The routing of every
legal shape is pinned too, so ATT&CK and D3FEND edges keep landing in 03.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from export_to_cypher import (  # noqa: E402
    ExportError,
    is_excluded,
    node_identity,
    route_relationship,
)

ATLAS_T = node_identity(["MitreAtlasTechnique"], {"atlas_id": "AML.T0073"})
ATLAS_SUB = node_identity(["MitreAtlasTechnique"], {"atlas_id": "AML.T0016.001"})
ATLAS_TACTIC = node_identity(["MitreAtlasTactic"], {"atlas_id": "AML.TA0007"})
ATLAS_MITIGATION = node_identity(["MitreAtlasMitigation"], {"atlas_id": "AML.M0001"})
ATTACK_T = node_identity(["MitreAttackTechnique"], {"attack_id": "T1684.001"})
ATTACK_TACTIC = node_identity(["MitreAttackTactic"], {"attack_id": "TA0005"})
ATTACK_MITIGATION = node_identity(["MitreAttackMitigation"], {"attack_id": "M1017"})
DEFEND_ENTITY = node_identity(["MitreDefendFileEntity"], {"uri": "http://d3fend.mitre.org/ontologies/d3fend.owl#File"})


def assert_true(value: bool) -> None:
    assert value


def raises(action: Callable[[], Any], fragment: str) -> None:
    try:
        action()
    except ExportError as err:
        assert fragment in str(err), f"wrong error: {err}"
        return
    raise AssertionError(f"expected an ExportError containing {fragment!r}")


def test_identity() -> None:
    assert ATLAS_T == ("MitreAtlasTechnique", "atlas_id", "AML.T0073")
    assert ATTACK_T == ("MitreAttackTechnique", "attack_id", "T1684.001")
    # The declared D3FEND second key.
    assert node_identity(["MitreDefendTechnique"], {"uri": "u", "name": "x"}) == (
        "MitreDefendTechnique", "uri", "u")
    assert node_identity(["MitreDefendTechnique"], {"d3fendId": "D3-X", "uri": "u"}) == (
        "MitreDefendTechnique", "d3fendId", "D3-X")
    # Unmapped extra labels are ignored; only mapped ones count.
    assert node_identity(["MitreAtlasTechnique", "Other"], {"atlas_id": "AML.T0001"})[0] == "MitreAtlasTechnique"


def test_routing() -> None:
    cases: List[Tuple[str, Any, Any, str]] = [
        ("SUBTECHNIQUE_OF", ATLAS_SUB, ATLAS_T, "atlas"),
        ("TACTIC_INCLUDES_TECHNIQUE", ATLAS_TACTIC, ATLAS_T, "atlas"),
        ("MITIGATION_DEFENDS_AGAINST_TECHNIQUE", ATLAS_MITIGATION, ATLAS_T, "atlas"),
        ("ATLAS_TECHNIQUE_REFERENCES", ATLAS_T, ATTACK_T, "crosswalk"),
        ("TACTIC_INCLUDES_TECHNIQUE", ATTACK_TACTIC, ATTACK_T, "attack-defend"),
        ("MITIGATION_DEFENDS_AGAINST_TECHNIQUE", ATTACK_MITIGATION, ATTACK_T, "attack-defend"),
        ("ACCESSES", ATTACK_T, DEFEND_ENTITY, "attack-defend"),
    ]
    for rel_type, source, target, bucket in cases:
        got = route_relationship(rel_type, source, target)
        assert got == bucket, f"{rel_type} {source[0]}->{target[0]}: {got} (expected {bucket})"


CASES: List[Tuple[str, Callable[[], None]]] = [
    ("identity", test_identity),
    ("routing", test_routing),
    ("skips the ATT&CK matrix by name, nothing else",
     lambda: (assert_true(is_excluded(["MitreAttackMatrix"], ["MitreAttackTactic"])),
              assert_true(not is_excluded(["MitreAttackTactic"], ["MitreAttackTechnique"])))),
    ("rejects a node without a mapped label",
     lambda: raises(lambda: node_identity(["MitreSomethingNew"], {"name": "x"}), "0 mapped MITRE labels")),
    ("rejects a node with two mapped labels",
     lambda: raises(lambda: node_identity(["MitreAtlasTechnique", "MitreAttackTechnique"],
                                          {"atlas_id": "AML.T0001", "attack_id": "T1001"}),
                    "2 mapped MITRE labels")),
    ("rejects an ATT&CK node without attack_id (no name fallback)",
     lambda: raises(lambda: node_identity(["MitreAttackTechnique"], {"name": "x"}), "has no attack_id")),
    ("rejects an ATLAS node without atlas_id (no attack_id default)",
     lambda: raises(lambda: node_identity(["MitreAtlasTechnique"], {"attack_id": "T1001"}), "has no atlas_id")),
    ("rejects a D3FEND node without either key",
     lambda: raises(lambda: node_identity(["MitreDefendTechnique"], {"name": "x"}), "has no uri")),
    ("rejects an ATLAS edge to ATT&CK other than the crosswalk",
     lambda: raises(lambda: route_relationship("EXPLOITED_BY", ATLAS_T, ATTACK_T), "only through")),
    ("rejects a cross-framework sub-technique edge",
     lambda: raises(lambda: route_relationship("SUBTECHNIQUE_OF", ATLAS_SUB, ATTACK_T), "only through")),
    ("rejects a cross-framework tactic edge",
     lambda: raises(lambda: route_relationship("TACTIC_INCLUDES_TECHNIQUE", ATTACK_TACTIC, ATLAS_T),
                    "only through")),
    ("rejects a structural edge between ATT&CK and D3FEND",
     lambda: raises(lambda: route_relationship("SUBTECHNIQUE_OF", ATTACK_T, DEFEND_ENTITY),
                    "cross-framework SUBTECHNIQUE_OF")),
    ("rejects a reversed crosswalk",
     lambda: raises(lambda: route_relationship("ATLAS_TECHNIQUE_REFERENCES", ATTACK_T, ATLAS_T),
                    "ATLAS technique to an ATT&CK technique only")),
    ("rejects a crosswalk from an ATLAS mitigation",
     lambda: raises(lambda: route_relationship("ATLAS_TECHNIQUE_REFERENCES", ATLAS_MITIGATION, ATTACK_T),
                    "ATLAS technique to an ATT&CK technique only")),
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
        print(f"{failed} of {len(CASES)} exporter check test(s) failed")
        return 1
    print(f"all exporter check tests passed ({len(CASES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
