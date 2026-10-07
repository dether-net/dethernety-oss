#!/usr/bin/env python3
"""
Assert the node and edge counts of a database loaded from data/*.cypher.

The counts are pinned to the releases this module ships (ATT&CK v19.2, D3FEND 1.6.0,
ATLAS v2026.09). test-memgraph.sh runs this after loading the files once and again
after loading them a second time, so the same pins also prove the pack is idempotent.
A release bump changes these numbers on purpose; anything else that changes them is a
regression in the ingest, the export or the pack.

Usage: check_loaded_corpus.py <bolt_uri>
"""

from __future__ import annotations

import sys

from neo4j import GraphDatabase

NODE_COUNTS = {
    "MitreAttackTactic": 15,
    "MitreAttackTechnique": 697,
    "MitreAttackGroup": 176,
    "MitreAttackSoftware": 825,
    "MitreAttackMitigation": 44,
    "MitreAttackCampaign": 56,
    "MitreAttackDataSource": 0,
    "MitreAttackDataComponent": 106,
    "MitreDefendTactic": 8,
    "MitreDefendTechnique": 273,
    "MitreAtlasTechnique": 208,
    "MitreAtlasTactic": 16,
    "MitreAtlasMitigation": 40,
    "MitreAtlasCaseStudy": 73,
}

# Edges with no ATLAS endpoint: the ATT&CK and D3FEND corpus, unchanged by ATLAS.
NON_ATLAS_EDGES = 24329

ATLAS_EDGES = {
    ("SUBTECHNIQUE_OF", "MitreAtlasTechnique", "MitreAtlasTechnique"): 88,
    ("TACTIC_INCLUDES_TECHNIQUE", "MitreAtlasTactic", "MitreAtlasTechnique"): 225,
    ("MITIGATION_DEFENDS_AGAINST_TECHNIQUE", "MitreAtlasMitigation", "MitreAtlasTechnique"): 361,
    ("CAMPAIGN_USES_TECHNIQUE", "MitreAtlasCaseStudy", "MitreAtlasTechnique"): 628,
    ("ATLAS_TECHNIQUE_REFERENCES", "MitreAtlasTechnique", "MitreAttackTechnique"): 44,
}

# Nodes that carry a precomputed vector, by label, and the model every one must name.
EMBEDDED = {
    "MitreAttackTechnique": 697,
    "MitreDefendTechnique": 271,
    "MitreAttackMitigation": 44,
    "MitreAtlasTechnique": 208,
    "MitreAtlasMitigation": 40,
    "MitreAtlasTactic": 0,
    "MitreAtlasCaseStudy": 0,
}
EMBEDDING_MODEL = "embeddinggemma"

ATLAS_LABELS = ["MitreAtlasTechnique", "MitreAtlasTactic", "MitreAtlasMitigation", "MitreAtlasCaseStudy"]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    failures = []

    def expect(what: str, got, want) -> None:
        status = "ok" if got == want else "FAIL"
        print(f"   {status:4} {what}: {got}" + ("" if got == want else f" (expected {want})"))
        if got != want:
            failures.append(what)

    driver = GraphDatabase.driver(sys.argv[1], auth=None)
    try:
        with driver.session() as session:
            def scalar(query: str, **params):
                return session.run(query, **params).single()[0]

            for label, want in NODE_COUNTS.items():
                expect(label, scalar(f"MATCH (n:{label}) RETURN count(n)"), want)

            atlas_predicate = " OR ".join(f"n:{label}" for label in ATLAS_LABELS)
            expect(
                "edges without an ATLAS endpoint",
                scalar(
                    "MATCH (a)-[r]->(b) "
                    f"WITH a, r, b, [n IN [a, b] WHERE {atlas_predicate}] AS atlas "
                    "WHERE size(atlas) = 0 RETURN count(r)"
                ),
                NON_ATLAS_EDGES,
            )
            for (rel_type, src, tgt), want in ATLAS_EDGES.items():
                expect(
                    f"{src} -{rel_type}-> {tgt}",
                    scalar(f"MATCH (:{src})-[r:{rel_type}]->(:{tgt}) RETURN count(r)"),
                    want,
                )
            expect(
                "ATLAS edges of any other shape",
                scalar(
                    "MATCH (a)-[r]-(b) "
                    f"WITH a, r, b WHERE ({atlas_predicate.replace('n:', 'a:')}) "
                    "RETURN count(DISTINCT r)"
                ) - sum(ATLAS_EDGES.values()),
                0,
            )
            expect(
                "AML.T0073 crosswalk target and cited id",
                [
                    tuple(r)
                    for r in session.run(
                        "MATCH (:MitreAtlasTechnique {atlas_id: 'AML.T0073'})"
                        "-[r:ATLAS_TECHNIQUE_REFERENCES]->(t:MitreAttackTechnique) "
                        "RETURN t.attack_id, r.cited_attack_id"
                    )
                ],
                [("T1684.001", "T1656")],
            )
            expect(
                "ATLAS nodes carrying attack_id or another framework's label",
                scalar(
                    f"MATCH (n) WHERE ({atlas_predicate}) AND (n.attack_id IS NOT NULL OR "
                    "any(l IN labels(n) WHERE l STARTS WITH 'MitreAttack' OR l STARTS WITH 'MitreDefend')) "
                    "RETURN count(n)"
                ),
                0,
            )
            expect(
                "ATLAS tactics without matrix_order",
                scalar("MATCH (t:MitreAtlasTactic) WHERE t.matrix_order IS NULL RETURN count(t)"),
                0,
            )
            for label, want in EMBEDDED.items():
                expect(
                    f"{label} with an embedding",
                    scalar(f"MATCH (n:{label}) WHERE n.embedding IS NOT NULL RETURN count(n)"),
                    want,
                )
            expect(
                "embedded nodes naming another model",
                scalar(
                    "MATCH (n) WHERE n.embedding IS NOT NULL AND n.embeddingModel <> $model RETURN count(n)",
                    model=EMBEDDING_MODEL,
                ),
                0,
            )
    finally:
        driver.close()

    if failures:
        print(f"   {len(failures)} check(s) failed")
        return 1
    print("   all corpus checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
