package _dt_built_in.exposures.security_services_layer



_bidirectional_log_ingestion_path_exploitation_def := {
    "name": "Bidirectional Log Ingestion Path Exploitation",
    "description": "Log collection channels that flow from production zones into the security layer create an implicit ingress path. If ingress filtering does not enforce unidirectional flow (e.g., via log forwarder proxies or data diodes), an adversary controlling a log source can send crafted payloads inward to reach SIEM components.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Attackers exploiting a bidirectional log ingestion path could block or manipulate indicators to suppress detection during ingestion."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "A bidirectional log ingestion path can be abused to enumerate log contents, exposing sensitive information or enabling further attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1104",
            "name": "Multi-Stage Channels",
            "relevance": "A bidirectional ingestion path could serve as a covert multi-stage communication channel between attacker-controlled systems."
        }
    ]
}

bidirectional_log_ingestion_path_exploitation[_bidirectional_log_ingestion_path_exploitation_def] if {
    input.log_ingestion_flow_enforcement in ["none", "firewall_acl_only"]
    input.siem_ingestion_endpoint_directly_reachable == true
}

bidirectional_log_ingestion_path_exploitation[_bidirectional_log_ingestion_path_exploitation_def] if {
    not input.log_payload_validation_enforced
    input.siem_ingestion_endpoint_directly_reachable == true
}

bidirectional_log_ingestion_path_exploitation[_bidirectional_log_ingestion_path_exploitation_def] if {
    not input.log_source_authentication_required
    input.log_ingestion_flow_enforcement in ["none", "firewall_acl_only"]
}

exposures contains _bidirectional_log_ingestion_path_exploitation_def if {
    count(bidirectional_log_ingestion_path_exploitation) > 0
}

_management_plane_shared_credential_trust_def := {
    "name": "Management Plane Shared Credential Trust",
    "description": "Service accounts or API keys used by the security layer to pull data from or push actions to adjacent zones may be shared or insufficiently scoped. If credential isolation at zone boundaries is absent, a compromised credential grants lateral access beyond the security layer into managed environments.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "name": "Cloud Accounts",
            "relevance": "Shared credentials in the management plane are a prime target for abuse of cloud account access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.001",
            "name": "Additional Cloud Credentials",
            "relevance": "Shared credential trust in the management plane can be exploited to add or modify cloud credentials for persistent access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.006",
            "name": "Cloud Secrets Management Stores",
            "relevance": "Shared management plane credentials may grant access to cloud secrets stores, enabling credential harvesting across the environment."
        }
    ]
}

management_plane_shared_credential_trust[_management_plane_shared_credential_trust_def] if {
    input.credentials_shared_across_zones == true
}

management_plane_shared_credential_trust[_management_plane_shared_credential_trust_def] if {
    input.credential_scope_enforcement in ["broadly_scoped", "shared_across_zones"]
}

management_plane_shared_credential_trust[_management_plane_shared_credential_trust_def] if {
    not input.zone_boundary_egress_credential_controls
    input.credential_rotation_period_days > 90
}

exposures contains _management_plane_shared_credential_trust_def if {
    count(management_plane_shared_credential_trust) > 0
}

_overly_permissive_egress_from_security_zone_def := {
    "name": "Overly Permissive Egress From Security Zone",
    "description": "The security layer often requires egress to pull threat intelligence feeds, update signatures, or reach cloud SIEM endpoints. If egress filtering is not locked to specific destinations and ports, compromised tooling within the zone can initiate outbound C2 or exfiltrate aggregated log data.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Overly permissive egress rules allow attackers to exfiltrate data using alternative protocols that bypass intended controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "name": "Exfiltration Over Web Service",
            "relevance": "Permissive egress from a security zone enables exfiltration of data to external web services without restriction."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1105",
            "name": "Ingress Tool Transfer",
            "relevance": "Overly permissive egress also allows attackers to transfer tools and payloads into the environment from external sources."
        }
    ]
}

overly_permissive_egress_from_security_zone[_overly_permissive_egress_from_security_zone_def] if {
    not input.egress_destination_allowlist_configured
}

overly_permissive_egress_from_security_zone[_overly_permissive_egress_from_security_zone_def] if {
    input.egress_destination_allowlist_configured == true
    not input.egress_port_restriction_enforced
}

overly_permissive_egress_from_security_zone[_overly_permissive_egress_from_security_zone_def] if {
    input.egress_destination_allowlist_configured == true
    input.egress_port_restriction_enforced == true
    not input.egress_tls_inspection_enabled
}

exposures contains _overly_permissive_egress_from_security_zone_def if {
    count(overly_permissive_egress_from_security_zone) > 0
}

_trust_propagation_via_siem_action_channels_def := {
    "name": "Trust Propagation Via Siem Action Channels",
    "description": "Automated response actions (e.g., firewall rule pushes, account disables) executed by the SIEM cross zone boundaries using elevated trust. If these action channels lack per-zone authorization scoping, a forged or replayed alert can trigger privileged operations in zones the security layer should not autonomously control.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1546",
            "name": "Event Triggered Execution",
            "relevance": "SIEM action channels can be abused to trigger malicious execution by injecting crafted events that invoke automated responses."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "SIEM action channels with broad trust can be leveraged similarly to deployment tools to propagate malicious actions across systems."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "name": "Account Manipulation",
            "relevance": "Trust propagation through SIEM channels could be exploited to manipulate accounts or escalate privileges across integrated systems."
        }
    ]
}

trust_propagation_via_siem_action_channels[_trust_propagation_via_siem_action_channels_def] if {
    not input.action_channel_zone_authorization_scoped
}

trust_propagation_via_siem_action_channels[_trust_propagation_via_siem_action_channels_def] if {
    not input.alert_action_integrity_verification
}

trust_propagation_via_siem_action_channels[_trust_propagation_via_siem_action_channels_def] if {
    input.action_credential_isolation_model in ["shared", "unmanaged"]
}

exposures contains _trust_propagation_via_siem_action_channels_def if {
    count(trust_propagation_via_siem_action_channels) > 0
}

_insufficient_micro_segmentation_within_security_layer_def := {
    "name": "Insufficient Micro Segmentation Within Security Layer",
    "description": "Internal to the security boundary layer, SIEM collectors, correlation engines, case management, and dashboards may reside on flat network segments. Absence of internal segmentation allows lateral movement between these sub-components if one is compromised, ultimately reaching the most privileged management interfaces.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Insufficient micro-segmentation allows attackers to bridge network boundaries and move laterally within the security layer."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Without proper micro-segmentation, attackers can exploit remote services to move laterally between components in the security layer."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Lack of micro-segmentation enables network sniffing across security layer traffic, exposing sensitive communications."
        }
    ]
}

insufficient_micro_segmentation_within_security_layer[_insufficient_micro_segmentation_within_security_layer_def] if {
    not input.internal_vlan_segmentation_enforced
}

insufficient_micro_segmentation_within_security_layer[_insufficient_micro_segmentation_within_security_layer_def] if {
    input.inter_component_acl_policy == "none"
}

insufficient_micro_segmentation_within_security_layer[_insufficient_micro_segmentation_within_security_layer_def] if {
    input.inter_component_acl_policy == "partial"
    not input.management_interface_isolated
}

exposures contains _insufficient_micro_segmentation_within_security_layer_def if {
    count(insufficient_micro_segmentation_within_security_layer) > 0
}

_monitoring_blind_spot_on_security_layer_own_traffic_def := {
    "name": "Monitoring Blind Spot On Security Layer Own Traffic",
    "description": "The security layer's own ingress and egress traffic is often excluded from the SIEM it hosts to avoid recursive logging or noise. This creates a coverage gap where boundary violations targeting the security zone itself go undetected, defeating the zone's monitoring purpose.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "A monitoring blind spot on the security layer's own traffic allows attackers to block indicators without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Attackers can exploit the blind spot to enumerate logs from the security layer without their activity being recorded."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Unmonitored security layer traffic can be sniffed by an attacker with access to that network segment without detection."
        }
    ]
}

monitoring_blind_spot_on_security_layer_own_traffic[_monitoring_blind_spot_on_security_layer_own_traffic_def] if {
    input.security_zone_traffic_excluded_from_siem == true
    not input.boundary_ingress_egress_alerts_configured
}

exposures contains _monitoring_blind_spot_on_security_layer_own_traffic_def if {
    count(monitoring_blind_spot_on_security_layer_own_traffic) > 0
}

_api_gateway_boundary_bypass_for_siem_integration_def := {
    "name": "Api Gateway Boundary Bypass For Siem Integration",
    "description": "Third-party integrations with ticketing, SOAR, or threat intel platforms often connect via API without traversing the primary zone gateway. If these API endpoints are not subject to the same ingress filtering and zone enforcement as other entry points, they represent an uncontrolled boundary crossing vector.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Bypassing the API gateway boundary directly relates to bridging network boundaries to reach the SIEM integration layer."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Bypassing the API gateway often involves abuse of application access tokens to authenticate directly to SIEM APIs."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1671",
            "name": "Cloud Application Integration",
            "relevance": "Exploiting SIEM integration through API gateway bypass aligns with abusing cloud application integration points."
        }
    ]
}

api_gateway_boundary_bypass_for_siem_integration[_api_gateway_boundary_bypass_for_siem_integration_def] if {
    input.api_endpoints_bypass_zone_gateway == true
}

api_gateway_boundary_bypass_for_siem_integration[_api_gateway_boundary_bypass_for_siem_integration_def] if {
    not input.api_endpoints_bypass_zone_gateway
    not input.integration_api_ingress_filtering_enforced
}

api_gateway_boundary_bypass_for_siem_integration[_api_gateway_boundary_bypass_for_siem_integration_def] if {
    not input.integration_api_ingress_filtering_enforced
    not input.integration_credential_isolation_enforced
}

exposures contains _api_gateway_boundary_bypass_for_siem_integration_def if {
    count(api_gateway_boundary_bypass_for_siem_integration) > 0
}

_zone_boundary_misconfiguration_during_deployment_updates_def := {
    "name": "Zone Boundary Misconfiguration During Deployment Updates",
    "description": "Security tooling requires frequent updates and reconfigurations. During deployment windows, firewall rules or segmentation policies are sometimes temporarily relaxed or misconfigured. If change management does not enforce boundary rule validation pre- and post-deployment, transient exposure windows persist.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Deployment updates that misconfigure zone boundaries may inadvertently disable or alter cloud firewall rules protecting zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.004",
            "name": "Disable or Modify System Firewall",
            "relevance": "Misconfiguration during deployment updates can result in system firewall rules being modified or disabled, exposing zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Deployment tools are the mechanism through which zone boundary misconfigurations are introduced during update cycles."
        }
    ]
}

zone_boundary_misconfiguration_during_deployment_updates[_zone_boundary_misconfiguration_during_deployment_updates_def] if {
    input.transient_permissive_rules_detected == true
}

zone_boundary_misconfiguration_during_deployment_updates[_zone_boundary_misconfiguration_during_deployment_updates_def] if {
    not input.boundary_rule_validation_enforced
    input.deployment_window_recency_hours <= 72
    input.post_deployment_boundary_audit_status in ["not_performed", "failed"]
}

exposures contains _zone_boundary_misconfiguration_during_deployment_updates_def if {
    count(zone_boundary_misconfiguration_during_deployment_updates) > 0
}

_out_of_band_management_network_boundary_gap_def := {
    "name": "Out Of Band Management Network Boundary Gap",
    "description": "Dedicated out-of-band management networks used to access security appliances may not be subject to the same ingress/egress controls as the primary security zone boundary. If OOB network segmentation is enforced independently and inconsistently, it becomes an alternative lateral movement path into the security layer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "An out-of-band management network boundary gap directly enables bridging between management and production network boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.008",
            "name": "Network Devices",
            "relevance": "Out-of-band management gaps often involve compromise of network devices that provide access to the management plane."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "A gap in out-of-band management network boundaries can allow an attacker to sniff sensitive management traffic."
        }
    ]
}

out_of_band_management_network_boundary_gap[_out_of_band_management_network_boundary_gap_def] if {
    not input.oob_network_ingress_egress_filtering_enforced
}

out_of_band_management_network_boundary_gap[_out_of_band_management_network_boundary_gap_def] if {
    input.oob_network_segmentation_consistency in ["inconsistent", "absent"]
}

out_of_band_management_network_boundary_gap[_out_of_band_management_network_boundary_gap_def] if {
    input.oob_lateral_movement_paths_identified == true
}

exposures contains _out_of_band_management_network_boundary_gap_def if {
    count(out_of_band_management_network_boundary_gap) > 0
}
