package _dt_built_in.countermeasures.firewall_policy



_inbound_traffic_prevention_coverage_def := {
    "name": "Inbound Traffic Prevention Coverage",
    "description": "Provides explicit blocking of unauthorized inbound connection attempts based on source IP, destination port, and protocol rules, reducing the accessible attack surface exposed to external networks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Directly addresses prevention of unwanted inbound traffic by filtering at network boundaries."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Provides broad coverage for filtering network traffic to prevent unauthorized inbound connections."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Core mitigation technique for controlling and blocking inbound network traffic."
        }
    ]
}

inbound_traffic_prevention_coverage[_inbound_traffic_prevention_coverage_def] if {
    input.inbound_firewall_enabled == false
}

inbound_traffic_prevention_coverage[_inbound_traffic_prevention_coverage_def] if {
    input.inbound_firewall_enabled == true
    input.default_inbound_policy in ["allow", "unset"]
}

inbound_traffic_prevention_coverage[_inbound_traffic_prevention_coverage_def] if {
    input.inbound_firewall_enabled == true
    input.default_inbound_policy == "deny"
    count(input.unrestricted_inbound_ports) > 0
}

countermeasures contains _inbound_traffic_prevention_coverage_def if {
    count(inbound_traffic_prevention_coverage) > 0
}

_outbound_traffic_filtering_control_def := {
    "name": "Outbound Traffic Filtering Control",
    "description": "Provides enforcement of egress policies that restrict unauthorized outbound connections, limiting data exfiltration paths and preventing lateral command-and-control communications from establishing.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Directly controls and filters outbound network traffic to prevent data exfiltration and unauthorized communications."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Provides comprehensive filtering of network traffic including outbound flows."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1057",
            "name": "Data Loss Prevention",
            "relevance": "Prevents unauthorized outbound data transmission by monitoring and controlling egress traffic."
        }
    ]
}

outbound_traffic_filtering_control[_outbound_traffic_filtering_control_def] if {
    input.egress_filtering_enabled == false
}

outbound_traffic_filtering_control[_outbound_traffic_filtering_control_def] if {
    input.egress_filtering_enabled == true
    input.default_egress_policy == "allow"
}

outbound_traffic_filtering_control[_outbound_traffic_filtering_control_def] if {
    input.egress_filtering_enabled == true
    input.default_egress_policy == "deny"
    "0.0.0.0/0" in input.permitted_egress_destinations
}

countermeasures contains _outbound_traffic_filtering_control_def if {
    count(outbound_traffic_filtering_control) > 0
}

_stateful_connection_inspection_def := {
    "name": "Stateful Connection Inspection",
    "description": "Provides session-aware packet evaluation that validates connection state consistency, ensuring only established and related traffic flows are permitted rather than accepting stateless packet forgeries.",
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
            "relevance": "Analyzes connection attempts to detect anomalies, directly supporting stateful inspection of network connections."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Examines network traffic patterns and connection states to identify suspicious stateful behaviors."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "Enables deep stateful inspection of encrypted connections to detect malicious traffic within established sessions."
        }
    ]
}

stateful_connection_inspection[_stateful_connection_inspection_def] if {
    input.stateful_inspection_enabled == false
}

stateful_connection_inspection[_stateful_connection_inspection_def] if {
    input.stateful_inspection_enabled == true
    not "ESTABLISHED" in input.permitted_connection_states
}

stateful_connection_inspection[_stateful_connection_inspection_def] if {
    input.stateful_inspection_enabled == true
    input.stateless_packet_acceptance_enabled == true
}

countermeasures contains _stateful_connection_inspection_def if {
    count(stateful_connection_inspection) > 0
}

_rule_logging_completeness_def := {
    "name": "Rule Logging Completeness",
    "description": "Provides structured logging of allow and deny decisions per rule match, enabling retrospective analysis, forensic investigation, and compliance audit trails for all evaluated traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Monitors and logs administrative network activities to ensure completeness of rule-based logging."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly supports logging completeness by ensuring firewall rules and network events are audited and recorded."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Provides comprehensive traffic logging to validate rule logging completeness across network flows."
        }
    ]
}

rule_logging_completeness[_rule_logging_completeness_def] if {
    input.logging_enabled == true
    input.log_both_allow_and_deny == true
    input.log_destination in ["siem", "syslog_server", "cloud_native_log_store"]
}

countermeasures contains _rule_logging_completeness_def if {
    count(rule_logging_completeness) > 0
}

_default_deny_policy_enforcement_def := {
    "name": "Default Deny Policy Enforcement",
    "description": "Provides a baseline deny-all posture for unmatched traffic, ensuring that only explicitly permitted traffic flows are allowed and no implicit permit rules create unintended access paths.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Implements default-deny by filtering all network traffic that does not match explicit allow rules."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps network traffic against defined policies to enforce default-deny posture."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "Supports default-deny enforcement by segmenting networks so only explicitly permitted traffic traverses boundaries."
        }
    ]
}

default_deny_policy_enforcement[_default_deny_policy_enforcement_def] if {
    input.default_deny_rule_present == false
}

default_deny_policy_enforcement[_default_deny_policy_enforcement_def] if {
    input.default_deny_rule_present == true
    input.default_rule_action in ["allow", "accept"]
}

default_deny_policy_enforcement[_default_deny_policy_enforcement_def] if {
    input.implicit_permit_rules_present == true
}

countermeasures contains _default_deny_policy_enforcement_def if {
    count(default_deny_policy_enforcement) > 0
}

_rule_specificity_and_least_privilege_alignment_def := {
    "name": "Rule Specificity And Least Privilege Alignment",
    "description": "Provides granular access control by scoping permit rules to precise source-destination pairs, ports, and protocols, minimizing overly permissive rules that broaden the permitted traffic envelope.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps specific traffic policies to enforce least-privilege access rules at the network level."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Directly enforces least-privilege by restricting network access to only what is specifically required."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-LAMED",
            "name": "LAN Access Mediation",
            "relevance": "Mediates LAN access to ensure rules are specific and aligned with least-privilege principles."
        }
    ]
}

rule_specificity_and_least_privilege_alignment[_rule_specificity_and_least_privilege_alignment_def] if {
    input.wildcard_source_rules_present == false
    input.wildcard_destination_port_rules_present == false
    input.protocol_any_permit_rules_present == false
    input.overly_broad_permit_rule_count == 0
}

countermeasures contains _rule_specificity_and_least_privilege_alignment_def if {
    count(rule_specificity_and_least_privilege_alignment) > 0
}

_network_segment_isolation_enforcement_def := {
    "name": "Network Segment Isolation Enforcement",
    "description": "Provides logical separation between network zones by enforcing inter-segment traffic policies, preventing unrestricted lateral movement between trusted and untrusted network segments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NI",
            "name": "Network Isolation",
            "relevance": "Directly enforces isolation of network segments to prevent lateral movement between zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "Core technique for enforcing network segment isolation to contain threats and limit access."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps traffic policies across network segments to validate and enforce isolation boundaries."
        }
    ]
}

network_segment_isolation_enforcement[_network_segment_isolation_enforcement_def] if {
    input.segment_isolation_rules_configured == true
    input.default_inter_segment_policy == "deny"
    input.stateful_inspection_enabled == true
}

network_segment_isolation_enforcement[_network_segment_isolation_enforcement_def] if {
    input.segment_isolation_rules_configured == true
    input.default_inter_segment_policy == "deny"
    count(input.unrestricted_segment_pairs) == 0
}

countermeasures contains _network_segment_isolation_enforcement_def if {
    count(network_segment_isolation_enforcement) > 0
}

_rule_change_management_and_version_control_def := {
    "name": "Rule Change Management And Version Control",
    "description": "Provides operational maintainability through documented, auditable rule modification processes, enabling rollback capability and ensuring configuration drift is detected and controlled.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Ensures firewall rule changes are audited and tracked to support version control and change management."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Manages software and firewall configurations to ensure rule changes are controlled and versioned."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OLV",
            "name": "Operational Logic Validation",
            "relevance": "Validates operational logic of rule changes to ensure correctness and integrity in version control."
        }
    ]
}

rule_change_management_and_version_control[_rule_change_management_and_version_control_def] if {
    input.rule_versioning_enabled == true
    input.change_approval_process == "formal_approval_required"
    input.rollback_capability == true
    input.configuration_drift_detection == "automated_alerting"
}

rule_change_management_and_version_control[_rule_change_management_and_version_control_def] if {
    input.rule_versioning_enabled == true
    input.change_approval_process == "formal_approval_required"
    input.rollback_capability == true
    input.configuration_drift_detection == "periodic_manual_review"
}

countermeasures contains _rule_change_management_and_version_control_def if {
    count(rule_change_management_and_version_control) > 0
}

_icmp_and_protocol_abuse_prevention_def := {
    "name": "Icmp And Protocol Abuse Prevention",
    "description": "Provides filtering of non-essential protocol types and malformed packet constructs, blocking covert channel techniques that exploit permitted protocol fields for unauthorized communication.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Detects anomalies in protocol metadata including ICMP misuse and non-standard protocol behavior."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APCA",
            "name": "Application Protocol Command Analysis",
            "relevance": "Analyzes protocol commands to identify abuse of ICMP and other protocols for covert communication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Filters ICMP and abused protocol traffic at the network level to prevent protocol-based attacks."
        }
    ]
}

icmp_and_protocol_abuse_prevention[_icmp_and_protocol_abuse_prevention_def] if {
    input.icmp_filtering_enabled == true
    input.protocol_anomaly_filtering_enabled == true
}

icmp_and_protocol_abuse_prevention[_icmp_and_protocol_abuse_prevention_def] if {
    input.icmp_filtering_enabled == true
    input.non_essential_protocols_blocked == true
}

countermeasures contains _icmp_and_protocol_abuse_prevention_def if {
    count(icmp_and_protocol_abuse_prevention) > 0
}

_alert_integration_with_siem_def := {
    "name": "Alert Integration With Siem",
    "description": "Provides real-time forwarding of firewall deny events and anomaly detections to centralized monitoring platforms, enabling correlation across security data sources and accelerating incident response.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Provides network activity data that can be integrated into SIEM for centralized alert correlation."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Generates network traffic alerts and events suitable for ingestion and correlation within a SIEM platform."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Produces connection-level alerts that feed into SIEM for threat detection and incident response."
        }
    ]
}

alert_integration_with_siem[_alert_integration_with_siem_def] if {
    input.siem_forwarding_enabled == true
    input.siem_destination_configured == true
    "deny" in input.forwarded_event_types
}

alert_integration_with_siem[_alert_integration_with_siem_def] if {
    input.siem_forwarding_enabled == true
    input.siem_destination_configured == true
    "anomaly" in input.forwarded_event_types
}

countermeasures contains _alert_integration_with_siem_def if {
    count(alert_integration_with_siem) > 0
}
