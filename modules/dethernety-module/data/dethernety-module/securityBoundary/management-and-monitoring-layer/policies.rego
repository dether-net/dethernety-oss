package _dt_built_in.exposures.management_and_monitoring_layer



_management_plane_ingress_bypass_def := {
    "name": "Management Plane Ingress Bypass",
    "description": "Absence of strict ingress filtering on management interfaces allows unauthorized sources outside the designated management zone to reach administrative endpoints directly, bypassing intended zone separation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "name": "Network Address Translation Traversal",
            "relevance": "Attackers can traverse NAT boundaries to reach management plane interfaces that should be restricted."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1665",
            "name": "Hide Infrastructure",
            "relevance": "Adversaries may hide infrastructure used to bypass management plane ingress controls."
        }
    ],
    "attack_vector": "NETWORK"
}

management_plane_ingress_bypass[_management_plane_ingress_bypass_def] if {
    not input.management_interface_ingress_filter_enabled
}

management_plane_ingress_bypass[_management_plane_ingress_bypass_def] if {
    input.management_interface_ingress_filter_enabled == true
    "0.0.0.0/0" in input.allowed_management_source_cidrs
}

management_plane_ingress_bypass[_management_plane_ingress_bypass_def] if {
    input.management_interface_ingress_filter_enabled == true
    "::/0" in input.allowed_management_source_cidrs
}

management_plane_ingress_bypass[_management_plane_ingress_bypass_def] if {
    not input.management_zone_network_segment_defined
    not input.management_interface_ingress_filter_enabled
}

exposures contains _management_plane_ingress_bypass_def if {
    count(management_plane_ingress_bypass) > 0
}

_egress_telemetry_exfiltration_path_def := {
    "name": "Egress Telemetry Exfiltration Path",
    "description": "Telemetry and monitoring egress channels lack destination allowlisting, enabling an adversary to redirect outbound monitoring traffic to attacker-controlled infrastructure or tunnel data out of the management zone.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Telemetry egress paths can be abused to tunnel exfiltrated data out of the network disguised as legitimate monitoring traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Blocking telemetry indicators on egress paths prevents detection of exfiltration activity."
        }
    ],
    "attack_vector": "NETWORK"
}

egress_telemetry_exfiltration_path[_egress_telemetry_exfiltration_path_def] if {
    not input.egress_destination_allowlist_enabled
}

egress_telemetry_exfiltration_path[_egress_telemetry_exfiltration_path_def] if {
    input.telemetry_destination_validation_mode == "none"
}

egress_telemetry_exfiltration_path[_egress_telemetry_exfiltration_path_def] if {
    input.telemetry_destination_validation_mode == "denylist"
    not input.telemetry_egress_tls_with_server_auth
}

exposures contains _egress_telemetry_exfiltration_path_def if {
    count(egress_telemetry_exfiltration_path) > 0
}

_shared_credential_across_zones_def := {
    "name": "Shared Credential Across Zones",
    "description": "Management credentials or service account tokens are reused across multiple trust zones, allowing compromise of one zone's management component to grant equivalent access in adjacent zones without re-authentication.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Shared credentials across zones allow adversaries to use the same valid account to move between security boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Shared credentials increase the risk of credential stuffing attacks succeeding across multiple zones."
        }
    ],
    "attack_vector": "LOCAL"
}

shared_credential_across_zones[_shared_credential_across_zones_def] if {
    input.credential_zone_scope == "multi_zone"
}

shared_credential_across_zones[_shared_credential_across_zones_def] if {
    not input.zone_isolation_enforced
    input.distinct_zones_sharing_credential > 1
}

shared_credential_across_zones[_shared_credential_across_zones_def] if {
    input.credential_zone_scope == "unknown"
    input.distinct_zones_sharing_credential > 1
}

exposures contains _shared_credential_across_zones_def if {
    count(shared_credential_across_zones) > 0
}

_monitoring_agent_lateral_movement_vector_def := {
    "name": "Monitoring Agent Lateral Movement Vector",
    "description": "Monitoring agents deployed across zones operate with overly broad network permissions, enabling an attacker who compromises an agent to pivot laterally into production or restricted zones using the agent's existing trust relationships.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Monitoring agents deployed via software deployment tools can be abused as a lateral movement vector across network zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Vulnerabilities in monitoring agent remote services can be exploited to move laterally between zones."
        }
    ],
    "attack_vector": "LOCAL"
}

monitoring_agent_lateral_movement_vector[_monitoring_agent_lateral_movement_vector_def] if {
    not input.agent_network_policy_enforced
    input.agent_zone_access_scope in ["multi_zone", "management_and_monitoring"]
}

monitoring_agent_lateral_movement_vector[_monitoring_agent_lateral_movement_vector_def] if {
    input.agent_credential_scope == "broad"
}

monitoring_agent_lateral_movement_vector[_monitoring_agent_lateral_movement_vector_def] if {
    input.agent_privilege_level in ["root", "elevated"]
    input.agent_zone_access_scope == "multi_zone"
}

exposures contains _monitoring_agent_lateral_movement_vector_def if {
    count(monitoring_agent_lateral_movement_vector) > 0
}

_unsegmented_management_vlan_def := {
    "name": "Unsegmented Management Vlan",
    "description": "The management network is not isolated into a dedicated VLAN or micro-segment, allowing management traffic to traverse alongside production traffic and reducing the effectiveness of zone-based access controls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "An unsegmented management VLAN allows adversaries to sniff sensitive management traffic across the broadcast domain."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Lack of VLAN segmentation enables bridging between management and other network boundaries."
        }
    ],
    "attack_vector": "ADJACENT"
}

unsegmented_management_vlan[_unsegmented_management_vlan_def] if {
    not input.management_vlan_dedicated
    not input.management_traffic_acl_enforced
}

unsegmented_management_vlan[_unsegmented_management_vlan_def] if {
    not input.management_vlan_dedicated
    not input.management_network_micro_segmentation_enabled
}

exposures contains _unsegmented_management_vlan_def if {
    count(unsegmented_management_vlan) > 0
}

_trust_propagation_via_orchestration_controller_def := {
    "name": "Trust Propagation Via Orchestration Controller",
    "description": "Orchestration or configuration management controllers within the management boundary can issue commands to all managed zones without per-zone authorization checks, allowing a single controller compromise to propagate trust transitively across all downstream zones.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "name": "Trust Modification",
            "relevance": "Orchestration controllers can be abused to modify trust relationships and propagate elevated trust across zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Orchestration controllers function as software deployment tools whose compromise enables trust propagation throughout the infrastructure."
        }
    ],
    "attack_vector": "LOCAL"
}

trust_propagation_via_orchestration_controller[_trust_propagation_via_orchestration_controller_def] if {
    not input.per_zone_authorization_enforced
    input.controller_blast_radius_scope == "all_zones"
}

trust_propagation_via_orchestration_controller[_trust_propagation_via_orchestration_controller_def] if {
    not input.per_zone_authorization_enforced
    not input.zone_isolation_policy_defined
}

exposures contains _trust_propagation_via_orchestration_controller_def if {
    count(trust_propagation_via_orchestration_controller) > 0
}

_health_check_endpoint_zone_exposure_def := {
    "name": "Health Check Endpoint Zone Exposure",
    "description": "Health-check and status endpoints exposed to non-management zones lack authentication and return information about internal component states, providing reconnaissance data to an attacker who reaches those endpoints from an adjacent zone.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1595.002",
            "name": "Vulnerability Scanning",
            "relevance": "Exposed health check endpoints can be discovered and scanned by adversaries to identify vulnerabilities across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "Health check endpoints may reveal network configuration and zone topology information to adversaries."
        }
    ],
    "attack_vector": "ADJACENT"
}

health_check_endpoint_zone_exposure[_health_check_endpoint_zone_exposure_def] if {
    not input.endpoint_authentication_required
    not input.exposed_zone in ["management"]
    input.response_includes_internal_state == true
}

health_check_endpoint_zone_exposure[_health_check_endpoint_zone_exposure_def] if {
    not input.endpoint_authentication_required
    input.exposed_zone in ["internet", "dmz"]
}

exposures contains _health_check_endpoint_zone_exposure_def if {
    count(health_check_endpoint_zone_exposure) > 0
}

_monitoring_blind_spot_at_zone_boundary_def := {
    "name": "Monitoring Blind Spot At Zone Boundary",
    "description": "Traffic crossing the boundary between the management zone and adjacent zones is not mirrored or inspected by any monitoring component, creating a detection gap that allows covert command-and-control or data exfiltration to operate undetected.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1665",
            "name": "Hide Infrastructure",
            "relevance": "Adversaries exploit monitoring blind spots at zone boundaries to hide infrastructure and activity from defenders."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020.001",
            "name": "Traffic Duplication",
            "relevance": "Blind spots at zone boundaries may allow traffic duplication and exfiltration without detection."
        }
    ],
    "attack_vector": "ADJACENT"
}

monitoring_blind_spot_at_zone_boundary[_monitoring_blind_spot_at_zone_boundary_def] if {
    not input.zone_boundary_traffic_mirroring_enabled
    not input.inline_inspection_deployed
}

monitoring_blind_spot_at_zone_boundary[_monitoring_blind_spot_at_zone_boundary_def] if {
    not input.zone_boundary_traffic_mirroring_enabled
    not input.boundary_traffic_logged_to_siem
}

monitoring_blind_spot_at_zone_boundary[_monitoring_blind_spot_at_zone_boundary_def] if {
    not input.inline_inspection_deployed
    not input.boundary_traffic_logged_to_siem
}

exposures contains _monitoring_blind_spot_at_zone_boundary_def if {
    count(monitoring_blind_spot_at_zone_boundary) > 0
}

_out_of_band_channel_unmonitored_def := {
    "name": "Out Of Band Channel Unmonitored",
    "description": "Out-of-band management channels (IPMI, iDRAC, serial-over-LAN) connected to the management boundary operate on separate network paths that bypass standard ingress/egress filtering and logging, creating an unmonitored administrative access vector.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1095",
            "name": "Non-Application Layer Protocol",
            "relevance": "Unmonitored out-of-band channels often use non-application layer protocols that bypass standard monitoring controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1205",
            "name": "Traffic Signaling",
            "relevance": "Adversaries may use traffic signaling over out-of-band channels to covertly communicate without triggering monitored paths."
        }
    ],
    "attack_vector": "ADJACENT"
}

out_of_band_channel_unmonitored[_out_of_band_channel_unmonitored_def] if {
    input.oob_channel_enabled == true
    not input.oob_traffic_logging_enabled
}

out_of_band_channel_unmonitored[_out_of_band_channel_unmonitored_def] if {
    input.oob_channel_enabled == true
    not input.oob_network_segment_isolated
}

out_of_band_channel_unmonitored[_out_of_band_channel_unmonitored_def] if {
    input.oob_channel_enabled == true
    input.oob_authentication_method in ["none", "default_credentials"]
}

exposures contains _out_of_band_channel_unmonitored_def if {
    count(out_of_band_channel_unmonitored) > 0
}

_supply_chain_implant_in_monitoring_agent_def := {
    "name": "Supply Chain Implant In Monitoring Agent",
    "description": "Third-party monitoring agents or management software introduced via software supply chain may contain implants that establish covert egress paths from within the trusted management zone, bypassing boundary controls because the agent itself is trusted.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Monitoring agents distributed via software deployment pipelines are a direct vector for supply chain implants."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553",
            "name": "Subvert Trust Controls",
            "relevance": "Supply chain implants in monitoring agents subvert trust controls to appear as legitimate signed software."
        }
    ],
    "attack_vector": "NETWORK"
}

supply_chain_implant_in_monitoring_agent[_supply_chain_implant_in_monitoring_agent_def] if {
    not input.agent_integrity_verification_enabled
    not input.agent_network_policy_enforced
}

supply_chain_implant_in_monitoring_agent[_supply_chain_implant_in_monitoring_agent_def] if {
    not input.agent_integrity_verification_enabled
    not input.agent_runtime_behavior_monitored
}

supply_chain_implant_in_monitoring_agent[_supply_chain_implant_in_monitoring_agent_def] if {
    not input.agent_network_policy_enforced
    not input.agent_runtime_behavior_monitored
}

exposures contains _supply_chain_implant_in_monitoring_agent_def if {
    count(supply_chain_implant_in_monitoring_agent) > 0
}

_overpermissive_service_mesh_sidecar_in_management_zone_def := {
    "name": "Overpermissive Service Mesh Sidecar In Management Zone",
    "description": "Service mesh sidecar proxies deployed in the management zone are configured with permissive mTLS policies that accept connections from any zone, weakening zone boundary enforcement and allowing east-west traffic from untrusted zones to reach management services.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.001",
            "name": "Internal Proxy",
            "relevance": "An overpermissive service mesh sidecar can act as an internal proxy enabling unauthorized traffic routing within the management zone."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overpermissive sidecar proxies in the management zone can bridge network boundaries that should remain isolated."
        }
    ],
    "attack_vector": "ADJACENT"
}

overpermissive_service_mesh_sidecar_in_management_zone[_overpermissive_service_mesh_sidecar_in_management_zone_def] if {
    input.mtls_peer_authentication_mode in ["PERMISSIVE", "DISABLE"]
}

overpermissive_service_mesh_sidecar_in_management_zone[_overpermissive_service_mesh_sidecar_in_management_zone_def] if {
    input.mtls_peer_authentication_mode == "STRICT"
    count(input.authorization_policy_source_namespaces) == 0
    not input.cross_zone_deny_policy_present
}

exposures contains _overpermissive_service_mesh_sidecar_in_management_zone_def if {
    count(overpermissive_service_mesh_sidecar_in_management_zone) > 0
}

_stale_firewall_rule_permitting_legacy_management_access_def := {
    "name": "Stale Firewall Rule Permitting Legacy Management Access",
    "description": "Legacy or stale firewall rules on the management zone boundary permit obsolete management protocols or source ranges that are no longer operationally required, expanding the ingress attack surface without operational justification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.004",
            "name": "Disable or Modify System Firewall",
            "relevance": "Stale firewall rules effectively modify firewall policy to permit legacy access that should be blocked."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Legacy management access permitted by stale rules on network device firewalls exposes management interfaces to unauthorized access."
        }
    ],
    "attack_vector": "NETWORK"
}

stale_firewall_rule_permitting_legacy_management_access[_stale_firewall_rule_permitting_legacy_management_access_def] if {
    count(input.legacy_management_protocols_permitted) > 0
}

stale_firewall_rule_permitting_legacy_management_access[_stale_firewall_rule_permitting_legacy_management_access_def] if {
    input.stale_source_ranges_permitted == true
}

stale_firewall_rule_permitting_legacy_management_access[_stale_firewall_rule_permitting_legacy_management_access_def] if {
    input.last_rule_review_days_ago > 365
}

exposures contains _stale_firewall_rule_permitting_legacy_management_access_def if {
    count(stale_firewall_rule_permitting_legacy_management_access) > 0
}
