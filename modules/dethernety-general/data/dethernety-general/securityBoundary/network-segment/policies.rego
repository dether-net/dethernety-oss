package _dt_built_in.exposures.network_segment



_drawn_not_enforced_def := {
    "name": "Drawn-but-not-enforced segmentation",
    "description": "Diagrams show separate zones; routing/ACLs default-allow inter-segment.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

drawn_not_enforced[_drawn_not_enforced_def] if {
    not input.segment_boundary_enforced
}

exposures contains _drawn_not_enforced_def if {
    count(drawn_not_enforced) > 0
}

_vlan_hopping_def := {
    "name": "VLAN hopping / L2 trust bypass",
    "description": "DTP/double-tagging on native VLAN injects frames into peer VLANs.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

vlan_hopping[_vlan_hopping_def] if {
    not input.vlan_hopping_prevention
}

exposures contains _vlan_hopping_def if {
    count(vlan_hopping) > 0
}

_flat_tier_lateral_def := {
    "name": "Lateral movement on a flat tier",
    "description": "Intra-segment east-west unconstrained.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

flat_tier_lateral[_flat_tier_lateral_def] if {
    not input.east_west_within_segment_restricted
}

exposures contains _flat_tier_lateral_def if {
    count(flat_tier_lateral) > 0
}

_cidr_only_trust_def := {
    "name": "Trusted-relationship abuse via CIDR-only allow rules",
    "description": "Inter-segment allow rules trust source CIDRs without identity re-auth.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cidr_only_trust[_cidr_only_trust_def] if {
    not input.inter_segment_traffic_filtered_by_identity
}

exposures contains _cidr_only_trust_def if {
    count(cidr_only_trust) > 0
}

_east_west_log_gap_def := {
    "name": "Unmonitored east-west and flow-log tampering",
    "description": "VPC/flow logs disabled, under-retained, or tampered.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

east_west_log_gap[_east_west_log_gap_def] if {
    not input.inter_segment_crossings_logged
}

exposures contains _east_west_log_gap_def if {
    count(east_west_log_gap) > 0
}

_segmentation_drift_def := {
    "name": "Segmentation drift via out-of-band changes",
    "description": "Console edits accumulate, opening cross-segment paths absent from IaC.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

segmentation_drift[_segmentation_drift_def] if {
    not input.segmentation_drift_detected
}

exposures contains _segmentation_drift_def if {
    count(segmentation_drift) > 0
}

_privatelink_absent_public_egress_def := {
    "name": "Data egress via public endpoint when PrivateLink absent",
    "description": "Managed cloud services via public endpoints broaden egress surface.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

privatelink_absent_public_egress[_privatelink_absent_public_egress_def] if {
    not input.private_link_for_managed_services
}

exposures contains _privatelink_absent_public_egress_def if {
    count(privatelink_absent_public_egress) > 0
}

_internal_proxy_pivot_def := {
    "name": "Internal-proxy pivot through allowed crossing",
    "description": "Legitimate crossing host used as internal proxy.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

internal_proxy_pivot[_internal_proxy_pivot_def] if {
    not input.segment_egress_scoped
}

exposures contains _internal_proxy_pivot_def if {
    count(internal_proxy_pivot) > 0
}
