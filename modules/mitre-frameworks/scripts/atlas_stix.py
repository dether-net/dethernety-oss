"""
MITRE ATLAS STIX loader: parse the pinned `stix-atlas.json` bundle into nodes and edges,
and resolve the ATLAS -> ATT&CK technique crosswalk against the pinned ATT&CK bundle.

Pure functions over bytes and dicts (standard library only), so the loader and the
crosswalk are testable without a database or network; ingest.py writes the result.

A dedicated loader rather than the ATT&CK parser: 62 ATLAS objects carry a `mitre-attack`
external id, and an ATT&CK parser keys on exactly that, so it would merge them onto the
ATT&CK nodes. Here an object's identity comes only from its `mitre-atlas` reference.

Everything that does not match the expected shape fails loudly: a new object type, an
unknown relationship, a dangling reference, a tactic the matrix does not place. A silent
skip would ship a partial framework that looks complete.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

ATLAS_SOURCE = "mitre-atlas"
ATTACK_SOURCE = "mitre-attack"

TECHNIQUE_LABEL = "MitreAtlasTechnique"
TACTIC_LABEL = "MitreAtlasTactic"
MITIGATION_LABEL = "MitreAtlasMitigation"
CASE_STUDY_LABEL = "MitreAtlasCaseStudy"

# STIX object type -> (node label, id pattern). Case studies are STIX campaigns.
NODE_TYPES = {
    "attack-pattern": (TECHNIQUE_LABEL, re.compile(r"^AML\.T\d{4}(\.\d{3})?$")),
    "x-mitre-tactic": (TACTIC_LABEL, re.compile(r"^AML\.TA\d{4}$")),
    "course-of-action": (MITIGATION_LABEL, re.compile(r"^AML\.M\d{4}$")),
    "campaign": (CASE_STUDY_LABEL, re.compile(r"^AML\.CS\d{4}$")),
}

# Read for structure, not loaded as nodes.
STRUCTURAL_TYPES = {"relationship", "x-mitre-matrix", "x-mitre-collection", "identity", "marking-definition"}

# STIX relationship type -> (graph type, source label, target label). The graph types are
# ATT&CK's own, so a consumer that names both labels reads both frameworks with one pattern.
RELATIONSHIP_TYPES = {
    "subtechnique-of": ("SUBTECHNIQUE_OF", TECHNIQUE_LABEL, TECHNIQUE_LABEL),
    "mitigates": ("MITIGATION_DEFENDS_AGAINST_TECHNIQUE", MITIGATION_LABEL, TECHNIQUE_LABEL),
    "uses": ("CAMPAIGN_USES_TECHNIQUE", CASE_STUDY_LABEL, TECHNIQUE_LABEL),
}
TACTIC_EDGE_TYPE = "TACTIC_INCLUDES_TECHNIQUE"
CROSSWALK_EDGE_TYPE = "ATLAS_TECHNIQUE_REFERENCES"

ATTACK_TECHNIQUE_ID = re.compile(r"^T\d{4}(\.\d{3})?$")

# ATT&CK ids an ATLAS technique cites that ATT&CK has since revoked, with the successor
# the revoked-by walk must reach. Every revoked citation must be listed here, so a new
# revocation stops the build until someone has looked at it rather than silently
# re-pointing a technique link. AML.T0073 (Impersonation) cites T1656, revoked in ATT&CK v19.
REVOCATION_EXPECTATIONS = {"T1656": "T1684.001"}


class AtlasDataError(Exception):
    """The bundle does not have the shape this loader was written for."""


def verify_sha256(data: bytes, expected: str, what: str) -> None:
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise AtlasDataError(f"{what}: SHA-256 {actual} does not match the pinned {expected}")


def _external_id(obj: Dict[str, Any], source: str) -> List[Dict[str, Any]]:
    return [
        ref
        for ref in obj.get("external_references", [])
        if ref.get("source_name") == source and "external_id" in ref
    ]


def _atlas_ref(obj: Dict[str, Any]) -> Dict[str, Any]:
    refs = _external_id(obj, ATLAS_SOURCE)
    if len(refs) != 1:
        raise AtlasDataError(
            f"{obj.get('id')}: expected exactly one {ATLAS_SOURCE} external id, found {len(refs)}"
        )
    return refs[0]


def _base_props(obj: Dict[str, Any], ref: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "atlas_id": ref["external_id"],
        "name": obj["name"],
        "description": obj.get("description"),
        "ref_url": ref.get("url"),
        "stix_id": obj["id"],
        "stix_created": obj.get("created"),
        "stix_modified": obj.get("modified"),
        "stix_revoked": bool(obj.get("revoked", False)),
        "atlas_deprecated": bool(obj.get("x_mitre_deprecated", False)),
    }


def parse_atlas_bundle(data: bytes) -> Dict[str, Any]:
    """
    Parse an ATLAS STIX bundle.

    Returns {"nodes": {label: [props, ...]}, "edges": [(type, src_label, src_id,
    tgt_label, tgt_id), ...], "attack_refs": [(atlas_technique_id, cited_attack_id), ...]}.
    Nodes are sorted by atlas_id and edges are distinct and sorted, so two parses of the
    same bundle produce the same output.
    """
    objects = json.loads(data)["objects"]

    nodes: Dict[str, List[Dict[str, Any]]] = {label: [] for label, _ in NODE_TYPES.values()}
    by_stix_id: Dict[str, Tuple[str, str]] = {}  # stix id -> (label, atlas_id)
    seen_ids: Dict[str, str] = {}
    technique_objects: List[Dict[str, Any]] = []
    tactic_by_shortname: Dict[str, str] = {}
    tactic_by_stix_id: Dict[str, Dict[str, Any]] = {}
    relationships: List[Dict[str, Any]] = []
    matrices: List[Dict[str, Any]] = []

    for obj in objects:
        stix_type = obj.get("type")
        if stix_type in STRUCTURAL_TYPES:
            if stix_type == "relationship":
                relationships.append(obj)
            elif stix_type == "x-mitre-matrix":
                matrices.append(obj)
            continue
        if stix_type not in NODE_TYPES:
            raise AtlasDataError(f"{obj.get('id')}: unexpected STIX object type {stix_type!r}")

        label, pattern = NODE_TYPES[stix_type]
        ref = _atlas_ref(obj)
        atlas_id = ref["external_id"]
        if not pattern.match(atlas_id):
            raise AtlasDataError(f"{obj['id']}: id {atlas_id!r} does not fit a {stix_type}")
        if atlas_id in seen_ids:
            raise AtlasDataError(f"duplicate ATLAS id {atlas_id} ({seen_ids[atlas_id]}, {obj['id']})")
        seen_ids[atlas_id] = obj["id"]
        by_stix_id[obj["id"]] = (label, atlas_id)

        props = _base_props(obj, ref)
        if label == TECHNIQUE_LABEL:
            is_sub = bool(obj.get("x_mitre_is_subtechnique", False))
            if is_sub != ("." in atlas_id[len("AML.T"):]):
                raise AtlasDataError(f"{atlas_id}: sub-technique flag disagrees with its id")
            props["atlas_subtechnique"] = is_sub
            props["atlas_platforms"] = list(obj.get("x_mitre_platforms", []))
            technique_objects.append(obj)
        elif label == TACTIC_LABEL:
            shortname = obj.get("x_mitre_shortname")
            if not shortname or shortname in tactic_by_shortname:
                raise AtlasDataError(f"{atlas_id}: missing or duplicate tactic shortname {shortname!r}")
            props["atlas_shortname"] = shortname
            tactic_by_shortname[shortname] = atlas_id
            tactic_by_stix_id[obj["id"]] = props
        nodes[label].append(props)

    # Matrix order: the matrix's tactic_refs is an ordered list. Stamped on the tactic so
    # consumers ORDER BY it, as ATT&CK tactics carry their own matrix_order.
    if len(matrices) != 1:
        raise AtlasDataError(f"expected exactly one x-mitre-matrix, found {len(matrices)}")
    refs = matrices[0].get("tactic_refs", [])
    if sorted(refs) != sorted(tactic_by_stix_id) or len(set(refs)) != len(refs):
        raise AtlasDataError("the matrix does not place every tactic exactly once")
    for position, stix_id in enumerate(refs):
        tactic_by_stix_id[stix_id]["matrix_order"] = position

    edges = set()
    for obj in technique_objects:
        _, technique_id = by_stix_id[obj["id"]]
        for phase in obj.get("kill_chain_phases", []):
            if phase.get("kill_chain_name") != ATLAS_SOURCE:
                raise AtlasDataError(f"{technique_id}: unexpected kill chain {phase.get('kill_chain_name')!r}")
            tactic_id = tactic_by_shortname.get(phase.get("phase_name"))
            if tactic_id is None:
                raise AtlasDataError(f"{technique_id}: phase {phase.get('phase_name')!r} names no tactic")
            edges.add((TACTIC_EDGE_TYPE, TACTIC_LABEL, tactic_id, TECHNIQUE_LABEL, technique_id))

    for rel in relationships:
        rel_type = rel.get("relationship_type")
        if rel_type not in RELATIONSHIP_TYPES:
            raise AtlasDataError(f"{rel.get('id')}: unexpected relationship type {rel_type!r}")
        graph_type, want_src, want_tgt = RELATIONSHIP_TYPES[rel_type]
        src = by_stix_id.get(rel.get("source_ref"))
        tgt = by_stix_id.get(rel.get("target_ref"))
        if src is None or tgt is None:
            raise AtlasDataError(f"{rel.get('id')}: {rel_type} references an object outside the bundle")
        if src[0] != want_src or tgt[0] != want_tgt:
            raise AtlasDataError(f"{rel['id']}: {rel_type} from {src[0]} to {tgt[0]}")
        # One edge per pair: a case study that uses a technique in several procedure steps
        # still uses it once, which is ATT&CK's campaign shape.
        edges.add((graph_type, src[0], src[1], tgt[0], tgt[1]))

    attack_refs = []
    for obj in technique_objects:
        _, technique_id = by_stix_id[obj["id"]]
        for ref in _external_id(obj, ATTACK_SOURCE):
            cited = ref["external_id"]
            if not ATTACK_TECHNIQUE_ID.match(cited):
                raise AtlasDataError(f"{technique_id}: cites {cited!r}, not an ATT&CK technique id")
            attack_refs.append((technique_id, cited))

    for rows in nodes.values():
        rows.sort(key=lambda p: p["atlas_id"])
    return {
        "nodes": nodes,
        "edges": sorted(edges),
        "attack_refs": sorted(attack_refs),
    }


def resolve_attack_refs(
    attack_refs: List[Tuple[str, str]],
    attack_bundle: Dict[str, Any],
    expectations: Optional[Dict[str, str]] = None,
) -> List[Tuple[str, str, str]]:
    """
    Resolve each cited ATT&CK id to the live technique the crosswalk edge should target.

    A revoked target is followed through the ATT&CK bundle's revoked-by relationships, never
    by name. Returns [(atlas_technique_id, cited_attack_id, resolved_attack_id), ...].
    Raises on a target the bundle lacks, a revoked target with no successor, a deprecated
    final target, and a revocation that `expectations` does not list or lists differently.
    """
    if expectations is None:
        expectations = REVOCATION_EXPECTATIONS
    objects = attack_bundle["objects"]
    by_stix_id = {o["id"]: o for o in objects if o.get("type") == "attack-pattern"}
    by_attack_id: Dict[str, List[Dict[str, Any]]] = {}
    for obj in by_stix_id.values():
        for ref in _external_id(obj, ATTACK_SOURCE):
            by_attack_id.setdefault(ref["external_id"], []).append(obj)
    revoked_by = {
        o["source_ref"]: o["target_ref"]
        for o in objects
        if o.get("type") == "relationship" and o.get("relationship_type") == "revoked-by"
    }

    def attack_id_of(obj: Dict[str, Any]) -> str:
        return _external_id(obj, ATTACK_SOURCE)[0]["external_id"]

    resolved = []
    used_expectations = set()
    for technique_id, cited in attack_refs:
        candidates = by_attack_id.get(cited, [])
        if len(candidates) != 1:
            raise AtlasDataError(
                f"{technique_id} cites {cited}: {len(candidates)} ATT&CK techniques carry that id"
            )
        current = candidates[0]
        visited = {current["id"]}
        while current.get("revoked"):
            successor = by_stix_id.get(revoked_by.get(current["id"], ""))
            if successor is None or successor["id"] in visited:
                raise AtlasDataError(f"{technique_id} cites {cited}: revoked with no live successor")
            visited.add(successor["id"])
            current = successor
        if current.get("x_mitre_deprecated"):
            raise AtlasDataError(f"{technique_id} cites {cited}: resolves to deprecated {attack_id_of(current)}")
        final = attack_id_of(current)

        if final != cited or cited in expectations:
            expected = expectations.get(cited)
            if expected != final:
                raise AtlasDataError(
                    f"{technique_id} cites {cited}: the revoked-by walk reaches {final}, "
                    f"the expectation table says {expected}"
                )
            used_expectations.add(cited)
        resolved.append((technique_id, cited, final))

    stale = sorted(set(expectations) - used_expectations)
    if stale:
        raise AtlasDataError(f"revocation expectations no ATLAS technique cites any more: {stale}")
    return resolved
