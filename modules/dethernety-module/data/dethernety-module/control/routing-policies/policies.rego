package _dt_built_in.countermeasures.routing_policies

_packet_filtering_coverage_def := {
    "name": "Packet Filtering Coverage",
    "description": "Provides granular permit/deny enforcement at the packet level based on source/destination IP, protocol, and port, limiting unauthorized traffic flows between network segments.",
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
            "relevance": "Directly addresses packet filtering by controlling which network packets are allowed or denied based on policy."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Core mitigation technique for implementing packet filtering controls across network infrastructure."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Specifically addresses filtering of outbound packets, complementing inbound packet filtering coverage."
        }
    ]
}

packet_filtering_coverage[_packet_filtering_coverage_def] if {
    input.acl_applied_to_interfaces == true
    input.acl_filter_coverage == "full"
    input.default_deny_policy == true
}

packet_filtering_coverage[_packet_filtering_coverage_def] if {
    input.acl_applied_to_interfaces == true
    input.acl_filter_coverage == "partial"
    input.default_deny_policy == true
}

countermeasures contains _packet_filtering_coverage_def if {
    count(packet_filtering_coverage) > 0
}

_network_segmentation_enforcement_def := {
    "name": "Network Segmentation Enforcement",
    "description": "Delivers logical isolation between network zones by restricting inter-segment routing, ensuring that traffic crossing administrative boundaries is explicitly authorized.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-BDI",
            "name": "Broadcast Domain Isolation",
            "relevance": "Directly enforces network segmentation by isolating broadcast domains to prevent lateral movement."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "The primary mitigation technique for enforcing network segmentation to limit adversary lateral movement."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NI",
            "name": "Network Isolation",
            "relevance": "Enforces segmentation by isolating network segments to contain threats and restrict unauthorized access."
        }
    ]
}

network_segmentation_enforcement[_network_segmentation_enforcement_def] if {
    input.acl_inter_segment_rules_configured == true
    input.default_inter_segment_policy == "deny"
    input.acl_applied_to_interfaces == true
}

countermeasures contains _network_segmentation_enforcement_def if {
    count(network_segmentation_enforcement) > 0
}

_route_advertisement_integrity_def := {
    "name": "Route Advertisement Integrity",
    "description": "Provides validation and filtering of routing protocol advertisements using prefix lists and route maps, ensuring only authorized routes are accepted and propagated.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-RAM",
            "name": "Routing Access Mediation",
            "relevance": "Directly controls and mediates routing access to ensure integrity of route advertisements."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Filtering network traffic can prevent malicious route advertisements from propagating through the network."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps network traffic policies to detect deviations in route advertisement that may indicate integrity violations."
        }
    ]
}

route_advertisement_integrity[_route_advertisement_integrity_def] if {
    input.prefix_lists_configured == true
    input.route_maps_applied == true
    input.inbound_filter_direction_coverage == "all_peers"
}

route_advertisement_integrity[_route_advertisement_integrity_def] if {
    input.prefix_lists_configured == true
    input.route_maps_applied == true
    input.default_route_advertisement_control == "explicitly_denied"
    input.inbound_filter_direction_coverage in ["all_peers", "partial"]
}

countermeasures contains _route_advertisement_integrity_def if {
    count(route_advertisement_integrity) > 0
}

_traffic_logging_and_visibility_def := {
    "name": "Traffic Logging And Visibility",
    "description": "Delivers flow-level logging of permitted and denied packets matching ACL entries, providing audit trails and forensic data for security analysis and compliance reporting.",
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
            "relevance": "Directly provides visibility into network traffic by analyzing patterns and behaviors for security monitoring."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing ensures comprehensive logging of network activity to maintain visibility and support forensic analysis."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Provides visibility into administrative network activity, critical for detecting unauthorized or anomalous traffic."
        }
    ]
}

traffic_logging_and_visibility[_traffic_logging_and_visibility_def] if {
    input.acl_logging_enabled == true
    input.log_destination_configured in ["remote_syslog", "siem"]
    input.logged_acl_entry_coverage in ["deny_only", "both"]
}

traffic_logging_and_visibility[_traffic_logging_and_visibility_def] if {
    input.acl_logging_enabled == true
    input.log_destination_configured == "local_only"
    input.logged_acl_entry_coverage in ["deny_only", "both"]
}

countermeasures contains _traffic_logging_and_visibility_def if {
    count(traffic_logging_and_visibility) > 0
}

_ingress_egress_policy_consistency_def := {
    "name": "Ingress Egress Policy Consistency",
    "description": "Provides bidirectional policy enforcement at router interfaces, ensuring both inbound and outbound traffic conform to defined security guidelines and reducing asymmetric routing risks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Enforces consistent ingress policy by filtering inbound traffic according to defined security rules."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Enforces consistent egress policy by filtering outbound traffic to match ingress policy controls."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps and validates that ingress and egress policies are consistently applied across network boundaries."
        }
    ]
}

ingress_egress_policy_consistency[_ingress_egress_policy_consistency_def] if {
    input.acl_direction_coverage == true
    input.acl_direction_coverage == true
    input.default_deny_policy == true
}

ingress_egress_policy_consistency[_ingress_egress_policy_consistency_def] if {
    input.acl_direction_coverage == "both"
    input.default_deny_policy == true
}

countermeasures contains _ingress_egress_policy_consistency_def if {
    count(ingress_egress_policy_consistency) > 0
}

_management_plane_access_restriction_def := {
    "name": "Management Plane Access Restriction",
    "description": "Delivers access controls that limit which source addresses and protocols can reach router management interfaces, reducing the administrative attack surface of the routing device itself.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-LAMED",
            "name": "LAN Access Mediation",
            "relevance": "Mediates LAN-level access to management interfaces, directly restricting unauthorized management plane access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Restricts network-level access to management plane resources, preventing unauthorized remote management."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-RAM",
            "name": "Routing Access Mediation",
            "relevance": "Controls routing-level access to management plane networks, limiting which paths can reach management interfaces."
        }
    ]
}

management_plane_access_restriction[_management_plane_access_restriction_def] if {
    input.mgmt_acl_applied == true
    input.permitted_source_scope in ["specific_subnet", "explicit_hosts"]
    input.default_deny_policy == true
    not "Telnet" in input.allowed_mgmt_protocols
    not "HTTP" in input.allowed_mgmt_protocols
}

countermeasures contains _management_plane_access_restriction_def if {
    count(management_plane_access_restriction) > 0
}

_traffic_prioritization_and_qos_control_def := {
    "name": "Traffic Prioritization And Qos Control",
    "description": "Provides policy-based traffic classification and queuing that ensures critical security and operational traffic receives appropriate bandwidth, preventing resource starvation through traffic manipulation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps network traffic policies that underpin QoS controls and traffic prioritization decisions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Analyzes traffic patterns necessary for informed QoS policy enforcement and prioritization."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Traffic filtering supports QoS by controlling which traffic classes receive priority treatment."
        }
    ]
}

traffic_prioritization_and_qos_control[_traffic_prioritization_and_qos_control_def] if {
    input.qos_policy_configured == true
    input.traffic_classes_defined >= 2
    input.qos_policy_configured == true
}

countermeasures contains _traffic_prioritization_and_qos_control_def if {
    count(traffic_prioritization_and_qos_control) > 0
}

_null_route_and_blackhole_response_def := {
    "name": "Null Route And Blackhole Response",
    "description": "Delivers automated or manual blackhole routing capability to rapidly drop traffic to or from specified prefixes, enabling fast containment response without upstream firewall changes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-RAM",
            "name": "Routing Access Mediation",
            "relevance": "Directly controls routing decisions including implementation of null routes and blackhole routing responses."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FRIDL",
            "name": "Forward Resolution IP Denylisting",
            "relevance": "Denylisting IPs at the DNS/forwarding level complements null route and blackhole techniques for blocking malicious traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Filtering network traffic is the foundational mechanism enabling null route and blackhole traffic responses."
        }
    ]
}

null_route_and_blackhole_response[_null_route_and_blackhole_response_def] if {
    input.blackhole_routing_enabled == true
    input.blackhole_trigger_mechanism in ["rtbh_bgp", "automated_api"]
    input.blackhole_scope in ["internal_edge", "upstream_isp"]
}

null_route_and_blackhole_response[_null_route_and_blackhole_response_def] if {
    input.blackhole_routing_enabled == true
    input.blackhole_trigger_mechanism == "static"
    input.blackhole_scope in ["internal_edge", "upstream_isp"]
}

countermeasures contains _null_route_and_blackhole_response_def if {
    count(null_route_and_blackhole_response) > 0
}

_acl_rule_maintainability_and_audit_def := {
    "name": "Acl Rule Maintainability And Audit",
    "description": "Provides structured rule organization, documentation standards, and change tracking that maintain policy accuracy over time, reducing risk of misconfiguration from rule sprawl or stale entries.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Maps existing ACL rules and network traffic policies to support maintainability and audit of access control lists."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly addresses the need to audit ACL rules to ensure they remain current, accurate, and properly configured."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Hardening configuration processes ensures ACL rules are maintained in a secure and auditable state."
        }
    ]
}

acl_rule_maintainability_and_audit[_acl_rule_maintainability_and_audit_def] if {
    input.acl_rules_have_comments == true
    input.stale_rule_review_age_days <= 180
    input.change_tracking_mechanism in ["version_control", "itsm_integrated"]
}

acl_rule_maintainability_and_audit[_acl_rule_maintainability_and_audit_def] if {
    input.acl_rules_have_comments == true
    input.stale_rule_review_age_days <= 90
    input.change_tracking_mechanism == "manual_log"
}

countermeasures contains _acl_rule_maintainability_and_audit_def if {
    count(acl_rule_maintainability_and_audit) > 0
}
