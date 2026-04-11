package _dt_built_in.countermeasures.network_access_control

_segment_boundary_enforcement_def := {
    "name": "Segment Boundary Enforcement",
    "description": "Provides precise prevention coverage at network segment boundaries, ensuring only explicitly authorized traffic flows between zones are permitted, with all other inter-segment traffic blocked by default.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NI",
            "name": "Network Isolation",
            "relevance": "Directly enforces segment boundaries by isolating network segments to prevent unauthorized cross-segment communication."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps and enforces traffic policies at segment boundaries to ensure only authorized flows are permitted."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "Core mitigation for enforcing segment boundaries by dividing the network into isolated zones."
        }
    ]
}

segment_boundary_enforcement[_segment_boundary_enforcement_def] if {
    input.default_inter_segment_policy == "deny"
    input.explicit_allowlist_rules_configured == true
    input.boundary_enforcement_scope == "full"
}

countermeasures contains _segment_boundary_enforcement_def if {
    count(segment_boundary_enforcement) > 0
}

_lateral_movement_containment_def := {
    "name": "Lateral Movement Containment",
    "description": "Delivers containment capability by limiting the reachability of any single compromised host to only its authorized segment destinations, reducing blast radius through policy-enforced communication boundaries.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NI",
            "name": "Network Isolation",
            "relevance": "Isolates network segments to prevent adversaries from moving laterally between them."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-BDI",
            "name": "Broadcast Domain Isolation",
            "relevance": "Isolates broadcast domains to limit lateral movement opportunities within the same network layer."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "Directly mitigates lateral movement by segmenting the network so compromise of one segment does not cascade."
        }
    ]
}

lateral_movement_containment[_lateral_movement_containment_def] if {
    input.segmentation_policy_enforced == true
    input.default_deny_posture == "deny_all"
}

lateral_movement_containment[_lateral_movement_containment_def] if {
    input.segmentation_policy_enforced == true
    input.default_deny_posture == "deny_all"
    count(input.authorized_segment_destinations) >= 1
}

countermeasures contains _lateral_movement_containment_def if {
    count(lateral_movement_containment) > 0
}

_cross_segment_traffic_logging_def := {
    "name": "Cross Segment Traffic Logging",
    "description": "Provides logging completeness for all inter-segment access attempts, capturing source, destination, port, protocol, and policy decision (allow/deny) to support forensic reconstruction and audit trails.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Analyzes network traffic crossing segment boundaries to detect anomalies and log cross-segment flows."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Logs and analyzes connection attempts between segments to identify unauthorized cross-segment access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Ensures comprehensive auditing of cross-segment traffic for compliance and forensic purposes."
        }
    ]
}

cross_segment_traffic_logging[_cross_segment_traffic_logging_def] if {
    input.inter_segment_logging_enabled == true
    input.log_coverage_scope == "all_traffic"
    "source_ip" in input.logged_fields
    "destination_ip" in input.logged_fields
    "port" in input.logged_fields
    "protocol" in input.logged_fields
    "policy_decision" in input.logged_fields
    input.log_forwarding_destination
}

countermeasures contains _cross_segment_traffic_logging_def if {
    count(cross_segment_traffic_logging) > 0
}

_unauthorized_access_attempt_detection_def := {
    "name": "Unauthorized Access Attempt Detection",
    "description": "Delivers detection accuracy by generating alerts on denied inter-segment connection attempts, enabling identification of policy violations and anomalous lateral communication patterns in near real-time.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Directly detects unauthorized access attempts by analyzing anomalous or failed connection attempts."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Detects unauthorized administrative access attempts by monitoring abnormal administrative network activity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1031",
            "name": "Network Intrusion Prevention",
            "relevance": "Prevents and detects unauthorized access attempts through active network intrusion prevention mechanisms."
        }
    ]
}

unauthorized_access_attempt_detection[_unauthorized_access_attempt_detection_def] if {
    input.denied_traffic_logging_enabled == true
    input.alert_generation_on_deny_configured == true
    input.log_forwarding_destination in ["siem", "log_aggregator"]
}

countermeasures contains _unauthorized_access_attempt_detection_def if {
    count(unauthorized_access_attempt_detection) > 0
}

_policy_consistency_enforcement_def := {
    "name": "Policy Consistency Enforcement",
    "description": "Provides uniform application of access rules across all enforced segment boundaries, eliminating inconsistencies that could arise from per-device configuration drift through centralized policy management.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APA",
            "name": "Access Policy Administration",
            "relevance": "Administers and enforces consistent access policies across the environment."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps network traffic policies to ensure consistent enforcement across all segments and devices."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Enforces consistent traffic filtering policies to ensure uniform security posture across the network."
        }
    ]
}

policy_consistency_enforcement[_policy_consistency_enforcement_def] if {
    input.centralized_policy_management_enabled == true
    input.policy_sync_status == "synced"
    input.policy_drift_detected == false
}

countermeasures contains _policy_consistency_enforcement_def if {
    count(policy_consistency_enforcement) > 0
}

_least_privilege_access_coverage_def := {
    "name": "Least Privilege Access Coverage",
    "description": "Delivers prevention coverage by enforcing minimum necessary communication rights between segments, ensuring services and hosts only receive access to the segments required for their defined function.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AMED",
            "name": "Access Mediation",
            "relevance": "Mediates access requests to enforce least privilege principles across all resources."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NAM",
            "name": "Network Access Mediation",
            "relevance": "Controls network access at a granular level to enforce least privilege for network resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Directly limits network resource access to implement least privilege access coverage."
        }
    ]
}

least_privilege_access_coverage[_least_privilege_access_coverage_def] if {
    input.segment_access_policy_enforced == true
    input.default_deny_between_segments == true
    input.policy_scope in ["all", "critical_only"]
}

least_privilege_access_coverage[_least_privilege_access_coverage_def] if {
    input.segment_access_policy_enforced == true
    input.default_deny_between_segments == true
    input.policy_scope == "partial"
}

countermeasures contains _least_privilege_access_coverage_def if {
    count(least_privilege_access_coverage) > 0
}

_policy_audit_and_review_maintainability_def := {
    "name": "Policy Audit And Review Maintainability",
    "description": "Provides operational maintainability through structured policy rule sets that can be periodically reviewed, versioned, and validated against a defined access matrix, supporting compliance reporting and rule hygiene.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ORA",
            "name": "Operational Risk Assessment",
            "relevance": "Supports policy audit and review by continuously assessing operational risks and policy gaps."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly enables policy audit and review to maintain accurate and up-to-date security policies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Regular review of privileged accounts is a key component of policy audit and maintainability."
        }
    ]
}

policy_audit_and_review_maintainability[_policy_audit_and_review_maintainability_def] if {
    input.policy_ruleset_versioned == true
    input.policy_review_cycle_days <= 90
    input.access_matrix_validation_status == "validated"
    input.compliance_report_generated == true
}

policy_audit_and_review_maintainability[_policy_audit_and_review_maintainability_def] if {
    input.policy_ruleset_versioned == true
    input.policy_review_cycle_days <= 180
    input.access_matrix_validation_status == "validated"
    input.compliance_report_generated == true
}

countermeasures contains _policy_audit_and_review_maintainability_def if {
    count(policy_audit_and_review_maintainability) > 0
}

_siem_integration_depth_def := {
    "name": "Siem Integration Depth",
    "description": "Delivers integration depth by feeding structured inter-segment access events into SIEM or log aggregation platforms, enabling correlation with endpoint, identity, and application telemetry for holistic threat detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTSA",
            "name": "Network Traffic Signature Analysis",
            "relevance": "Feeds signature-based network traffic analysis data into SIEM for correlation and alerting."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PA",
            "name": "Process Analysis",
            "relevance": "Provides process-level telemetry to SIEM for deep integration and threat detection."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Sends authentication event thresholds and alerts to SIEM for integrated security monitoring."
        }
    ]
}

siem_integration_depth[_siem_integration_depth_def] if {
    input.siem_forwarding_enabled == true
    "deny" in input.log_event_types_forwarded
    input.telemetry_correlation_configured == true
}

siem_integration_depth[_siem_integration_depth_def] if {
    input.siem_forwarding_enabled == true
    "policy_violation" in input.log_event_types_forwarded
    input.telemetry_correlation_configured == true
}

countermeasures contains _siem_integration_depth_def if {
    count(siem_integration_depth) > 0
}

_dynamic_policy_response_automation_def := {
    "name": "Dynamic Policy Response Automation",
    "description": "Provides response automation capability by enabling policy enforcement systems to programmatically update segment access rules in response to detected threats or orchestration triggers, reducing dwell time of policy violations.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APA",
            "name": "Access Policy Administration",
            "relevance": "Enables automated dynamic updates to access policies in response to detected threats."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Triggers automated policy responses when authorization event thresholds are exceeded."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AMED",
            "name": "Access Mediation",
            "relevance": "Dynamically mediates access decisions in real-time as part of automated policy response workflows."
        }
    ]
}

dynamic_policy_response_automation[_dynamic_policy_response_automation_def] if {
    input.automated_policy_update_enabled == true
    not input.orchestration_trigger_source in ["none"]
    input.policy_propagation_latency_seconds <= 300
}

dynamic_policy_response_automation[_dynamic_policy_response_automation_def] if {
    input.automated_policy_update_enabled == true
    not input.orchestration_trigger_source in ["none"]
    not input.policy_propagation_latency_seconds
}

countermeasures contains _dynamic_policy_response_automation_def if {
    count(dynamic_policy_response_automation) > 0
}
