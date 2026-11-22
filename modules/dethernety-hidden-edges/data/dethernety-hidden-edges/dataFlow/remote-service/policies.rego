package _dt_built_in.exposures.hidden_edge_remote_service

# The one policy every hidden-edge class carries; each class copy differs only in the
# package line. A hidden-edge flow marks an inferred attack path, and its `technique_ids`
# hold the technique an attacker uses at the reached end of the path.
# This policy turns each of them into one exposure in category "Inferred Path", so a
# consumer can tell these findings from declared ones and keep them out of its totals.
# The policy cannot know who set the values, so the finding states only what the flow's
# class says: that the flow is marked as an inferred path.
#
# Inputs are read through guards: a wrong-typed value yields no exposure instead of an
# engine error. Only the first ten entries are read, and of those only well-formed ATT&CK
# technique ids count.

_attack_id := `^T[0-9]{4}(\.[0-9]{3})?$`

_ids := array.slice(ids, 0, 10) if {
    ids := object.get(input, "technique_ids", [])
    is_array(ids)
} else := []

_tier := t if {
    t := object.get(input, "tier", "")
    t in {"high", "medium", "low"}
} else := "low"

# The kind, from the class's fixed values only: no free text of the flow is copied into a finding.
_kind := replace(k, "-", " ") if {
    k := object.get(input, "hidden_edge_kind", "")
    k in {"remote-service", "credential-reuse", "credential-capture", "host-escape"}
} else := "hidden edge"

_granted := g if {
    g := object.get(input, "granted_privilege", "")
    g in {"none", "user", "admin", "system"}
} else := "unstated"

# The impact is what the path grants at its target; how firmly the model supports it (the tier) is stated in the
# description, not counted twice.
_criticality := {"none": "low", "user": "medium", "admin": "high", "system": "critical", "unstated": "medium"}

_score := {"low": 3.0, "medium": 5.0, "high": 7.5, "critical": 9.0}

_attack_vector := "LOCAL" if {
    object.get(input, "hidden_edge_kind", "") == "host-escape"
} else := "ADJACENT" if {
    object.get(input, "hidden_edge_kind", "") == "credential-capture"
} else := "NETWORK"

exposures contains finding if {
    some technique in _ids
    is_string(technique)
    regex.match(_attack_id, technique)
    finding := {
        "name": sprintf("Inferred %s path: %s", [_kind, technique]),
        "description": sprintf("This flow is marked as an inferred attack path, not a declared flow. An attacker may move along it with %s. Confidence: %s; grants %s at the target.", [technique, _tier, _granted]),
        "type": "EXPOSURE",
        "category": "Inferred Path",
        "criticality": _criticality[_granted],
        "score": _score[_criticality[_granted]],
        "exploited_by": [
            {
                "label": "MitreAttackTechnique",
                "property": "attack_id",
                "value": technique,
                "attributes": {}
            }
        ],
        "attack_vector": _attack_vector
    }
}
