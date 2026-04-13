package _dt_built_in.exposures.application_layer



_insufficient_ingress_filtering_from_dmz_def := {
    "name": "Insufficient Ingress Filtering From Dmz",
    "description": "Absence of strict allowlist-based ingress controls on traffic entering the application tier from the DMZ or presentation layer, permitting non-application protocols or unexpected source IPs to reach internal app servers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Directly relates to bypassing or insufficiently enforcing network boundary controls between the DMZ and internal zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Insufficient ingress filtering can allow adversaries to use alternative protocols to move data or commands across the DMZ boundary."
        }
    ],
    "attack_vector": "NETWORK"
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    not input.ingress_allowlist_enforced
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    input.default_ingress_policy in ["allow_all", "not_configured"]
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    input.ingress_allowlist_enforced == true
    "SSH" in input.permitted_protocols
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    input.ingress_allowlist_enforced == true
    "RDP" in input.permitted_protocols
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    input.ingress_allowlist_enforced == true
    "TELNET" in input.permitted_protocols
}

insufficient_ingress_filtering_from_dmz[_insufficient_ingress_filtering_from_dmz_def] if {
    input.ingress_allowlist_enforced == true
    not input.source_ip_restriction_applied
}

exposures contains _insufficient_ingress_filtering_from_dmz_def if {
    count(insufficient_ingress_filtering_from_dmz) > 0
}

_unrestricted_egress_to_backend_tiers_def := {
    "name": "Unrestricted Egress To Backend Tiers",
    "description": "Application tier components permitted to initiate connections to backend databases or internal services without port-level or protocol-level egress filtering, enabling exploitation of a compromised app server to pivot directly to data stores.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unrestricted egress allows attackers to reach and exploit remote services on backend tiers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unrestricted outbound traffic to backend tiers enables data exfiltration through various protocols without detection."
        }
    ],
    "attack_vector": "LOCAL"
}

unrestricted_egress_to_backend_tiers[_unrestricted_egress_to_backend_tiers_def] if {
    not input.egress_acl_enforced
}

unrestricted_egress_to_backend_tiers[_unrestricted_egress_to_backend_tiers_def] if {
    input.egress_acl_enforced == true
    input.permitted_egress_scope == "unrestricted"
}

unrestricted_egress_to_backend_tiers[_unrestricted_egress_to_backend_tiers_def] if {
    input.permitted_egress_scope == "port_only"
    not input.east_west_inspection_enabled
}

exposures contains _unrestricted_egress_to_backend_tiers_def if {
    count(unrestricted_egress_to_backend_tiers) > 0
}

_east_west_lateral_movement_within_boundary_def := {
    "name": "East West Lateral Movement Within Boundary",
    "description": "Lack of microsegmentation or intra-zone access controls between web servers and application servers within the same boundary, allowing a compromised component to move laterally to peer systems without crossing a monitored boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Lateral movement within a network boundary commonly involves exploiting remote services on adjacent systems."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Attackers abuse software deployment tools to propagate laterally across systems within the same boundary zone."
        }
    ],
    "attack_vector": "LOCAL"
}

east_west_lateral_movement_within_boundary[_east_west_lateral_movement_within_boundary_def] if {
    input.microsegmentation_technology == "none"
}

east_west_lateral_movement_within_boundary[_east_west_lateral_movement_within_boundary_def] if {
    input.microsegmentation_technology != "none"
    not input.intra_zone_acl_enforced
}

east_west_lateral_movement_within_boundary[_east_west_lateral_movement_within_boundary_def] if {
    not input.intra_zone_acl_enforced
    not input.east_west_traffic_monitored
}

exposures contains _east_west_lateral_movement_within_boundary_def if {
    count(east_west_lateral_movement_within_boundary) > 0
}

_trust_propagation_via_shared_service_accounts_def := {
    "name": "Trust Propagation Via Shared Service Accounts",
    "description": "Web and application servers sharing service account credentials or API keys, so that trust obtained on one component implicitly grants access to others within the boundary without re-authentication at internal interfaces.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "name": "Trusted Relationship",
            "relevance": "Shared service accounts propagate implicit trust relationships that adversaries can exploit to move between systems."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Shared service account tokens can be stolen and reused to impersonate trusted identities across boundaries."
        }
    ],
    "attack_vector": "LOCAL"
}

trust_propagation_via_shared_service_accounts[_trust_propagation_via_shared_service_accounts_def] if {
    input.service_account_scope == "shared_across_components"
}

trust_propagation_via_shared_service_accounts[_trust_propagation_via_shared_service_accounts_def] if {
    input.service_account_scope == "unique_per_component"
    not input.internal_interface_reauth_enforced
}

trust_propagation_via_shared_service_accounts[_trust_propagation_via_shared_service_accounts_def] if {
    input.service_account_scope == "shared_across_components"
    input.credential_rotation_days > 90
}

exposures contains _trust_propagation_via_shared_service_accounts_def if {
    count(trust_propagation_via_shared_service_accounts) > 0
}

_boundary_monitoring_coverage_gap_def := {
    "name": "Boundary Monitoring Coverage Gap",
    "description": "Insufficient network traffic inspection or logging at the application tier boundary ingress and egress points, creating blind spots where anomalous cross-zone traffic goes undetected.",
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
            "relevance": "Gaps in boundary monitoring allow network bridging activity to go undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1205",
            "name": "Traffic Signaling",
            "relevance": "Monitoring gaps enable covert traffic signaling techniques to operate undetected at the boundary."
        }
    ],
    "attack_vector": "NETWORK"
}

boundary_monitoring_coverage_gap[_boundary_monitoring_coverage_gap_def] if {
    not input.boundary_traffic_inspection_enabled
}

boundary_monitoring_coverage_gap[_boundary_monitoring_coverage_gap_def] if {
    not input.boundary_traffic_logging_scope in ["both"]
}

boundary_monitoring_coverage_gap[_boundary_monitoring_coverage_gap_def] if {
    input.boundary_traffic_inspection_enabled == true
    not input.log_forwarding_to_siem_configured
}

boundary_monitoring_coverage_gap[_boundary_monitoring_coverage_gap_def] if {
    input.log_forwarding_to_siem_configured == true
    input.cross_zone_alert_rules_count == 0
}

exposures contains _boundary_monitoring_coverage_gap_def if {
    count(boundary_monitoring_coverage_gap) > 0
}

_management_plane_ingress_not_isolated_def := {
    "name": "Management Plane Ingress Not Isolated",
    "description": "Administrative and management traffic (SSH, RDP, management APIs) entering the application tier through the same network path as application traffic, rather than via a dedicated out-of-band management zone, widening the ingress attack surface.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Non-isolated management plane ingress exposes remote service interfaces to unauthorized access from untrusted networks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Management interfaces exposed without isolation can be directly exploited by external adversaries."
        }
    ],
    "attack_vector": "NETWORK"
}

management_plane_ingress_not_isolated[_management_plane_ingress_not_isolated_def] if {
    not input.dedicated_oob_management_network_configured
    count(input.management_protocols_allowed_on_app_ingress) > 0
}

management_plane_ingress_not_isolated[_management_plane_ingress_not_isolated_def] if {
    not input.dedicated_oob_management_network_configured
    not input.management_access_source_restricted_to_mgmt_zone
}

exposures contains _management_plane_ingress_not_isolated_def if {
    count(management_plane_ingress_not_isolated) > 0
}

_inter_zone_certificate_trust_misconfiguration_def := {
    "name": "Inter Zone Certificate Trust Misconfiguration",
    "description": "Internal TLS between components at the application boundary using overly broad certificate trust stores or self-signed certificates without pinning, enabling a boundary-adjacent attacker to perform man-in-the-middle interception of inter-zone traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Certificate trust misconfigurations between zones enable adversaries to intercept and manipulate inter-zone traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Misconfigured certificate trust allows attackers to forge or misuse digital certificates to impersonate trusted zone endpoints."
        }
    ],
    "attack_vector": "ADJACENT"
}

inter_zone_certificate_trust_misconfiguration[_inter_zone_certificate_trust_misconfiguration_def] if {
    input.certificate_trust_store_scope == "system_wide_public_ca"
    not input.certificate_pinning_enforced
}

inter_zone_certificate_trust_misconfiguration[_inter_zone_certificate_trust_misconfiguration_def] if {
    input.certificate_trust_store_scope == "no_validation"
}

inter_zone_certificate_trust_misconfiguration[_inter_zone_certificate_trust_misconfiguration_def] if {
    input.self_signed_certificates_in_use == true
    not input.certificate_pinning_enforced
}

exposures contains _inter_zone_certificate_trust_misconfiguration_def if {
    count(inter_zone_certificate_trust_misconfiguration) > 0
}

_outbound_dns_and_http_egress_for_exfiltration_def := {
    "name": "Outbound Dns And Http Egress For Exfiltration",
    "description": "Application tier boundary permitting unrestricted outbound DNS or HTTP/S to arbitrary external destinations, which can be exploited for data exfiltration or command-and-control channel establishment without triggering ingress-focused controls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "DNS is a commonly abused outbound protocol for covert data exfiltration when egress filtering is insufficient."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "name": "Exfiltration Over Web Service",
            "relevance": "Permitted HTTP egress channels are leveraged to exfiltrate data via web services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Allowed DNS and HTTP egress paths are used as alternative protocols to exfiltrate data outside the boundary."
        }
    ],
    "attack_vector": "LOCAL"
}

outbound_dns_and_http_egress_for_exfiltration[_outbound_dns_and_http_egress_for_exfiltration_def] if {
    input.outbound_destination_restriction == "none"
    count(input.egress_protocols_unrestricted) > 0
}

outbound_dns_and_http_egress_for_exfiltration[_outbound_dns_and_http_egress_for_exfiltration_def] if {
    input.outbound_destination_restriction == "partial_restriction"
    not input.egress_traffic_inspection_enabled
    count(input.egress_protocols_unrestricted) > 0
}

exposures contains _outbound_dns_and_http_egress_for_exfiltration_def if {
    count(outbound_dns_and_http_egress_for_exfiltration) > 0
}

_zone_boundary_bypass_via_allowed_middleware_protocols_def := {
    "name": "Zone Boundary Bypass Via Allowed Middleware Protocols",
    "description": "Message queue or middleware protocols (AMQP, JMS) traversing the application tier boundary without content-level inspection or sender authentication, allowing boundary bypass by injecting malicious payloads through trusted protocol channels.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.005",
            "name": "Publish/Subscribe Protocols",
            "relevance": "Adversaries abuse allowed publish/subscribe middleware protocols to bypass zone boundary controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "name": "Application Layer Protocol",
            "relevance": "Permitted middleware application layer protocols are exploited to traverse zone boundaries covertly."
        }
    ],
    "attack_vector": "NETWORK"
}

zone_boundary_bypass_via_allowed_middleware_protocols[_zone_boundary_bypass_via_allowed_middleware_protocols_def] if {
    not input.middleware_content_inspection_enabled
    not input.middleware_sender_authentication_enforced
}

zone_boundary_bypass_via_allowed_middleware_protocols[_zone_boundary_bypass_via_allowed_middleware_protocols_def] if {
    input.middleware_protocol_exposure_zone in ["external", "dmz"]
    not input.middleware_sender_authentication_enforced
}

zone_boundary_bypass_via_allowed_middleware_protocols[_zone_boundary_bypass_via_allowed_middleware_protocols_def] if {
    input.middleware_protocol_exposure_zone in ["external", "dmz"]
    not input.middleware_content_inspection_enabled
}

exposures contains _zone_boundary_bypass_via_allowed_middleware_protocols_def if {
    count(zone_boundary_bypass_via_allowed_middleware_protocols) > 0
}

_inconsistent_boundary_enforcement_across_redundant_paths_def := {
    "name": "Inconsistent Boundary Enforcement Across Redundant Paths",
    "description": "Load balancer failover paths, secondary NICs, or backup connectivity routes that bypass primary boundary enforcement controls, creating asymmetric policy application and exploitable gaps during failover events.",
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
            "relevance": "Inconsistent enforcement on redundant paths allows adversaries to bridge network boundaries through less-controlled routes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1008",
            "name": "Fallback Channels",
            "relevance": "Redundant paths with weaker enforcement can serve as fallback channels for adversarial communication."
        }
    ],
    "attack_vector": "NETWORK"
}

inconsistent_boundary_enforcement_across_redundant_paths[_inconsistent_boundary_enforcement_across_redundant_paths_def] if {
    not input.failover_paths_policy_parity
}

inconsistent_boundary_enforcement_across_redundant_paths[_inconsistent_boundary_enforcement_across_redundant_paths_def] if {
    not input.redundant_path_inspection_enabled
}

inconsistent_boundary_enforcement_across_redundant_paths[_inconsistent_boundary_enforcement_across_redundant_paths_def] if {
    not input.failover_boundary_crossing_logged
}

exposures contains _inconsistent_boundary_enforcement_across_redundant_paths_def if {
    count(inconsistent_boundary_enforcement_across_redundant_paths) > 0
}
