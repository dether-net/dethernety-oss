package _dt_built_in.exposures.network_segment

_implicit_inter_segment_trust_def := {
    "name": "Implicit Inter Segment Trust",
    "description": "Adjacent network segments granted implicit trust due to shared infrastructure or misconfigured boundary policies, allowing traffic to traverse zone boundaries without explicit allow-list enforcement. A boolean such as 'explicit_deny_default' being false indicates this exposure.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.003",
            "name": "Network Trust Dependencies",
            "relevance": "Directly relates to implicit trust relationships between network segments that attackers can exploit to move laterally."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Covers techniques for bridging network boundaries by exploiting implicit trust between segments."
        }
    ],
    "attack_vector": "ADJACENT"
}

implicit_inter_segment_trust[_implicit_inter_segment_trust_def] if {
    not input.explicit_deny_default
}

implicit_inter_segment_trust[_implicit_inter_segment_trust_def] if {
    input.inter_segment_traffic_inspection == "none"
}

implicit_inter_segment_trust[_implicit_inter_segment_trust_def] if {
    input.inter_segment_traffic_inspection == "stateless"
    not input.explicit_deny_default
}

implicit_inter_segment_trust[_implicit_inter_segment_trust_def] if {
    input.shared_credentials_across_segments == true
    not input.explicit_deny_default
}

exposures contains _implicit_inter_segment_trust_def if {
    count(implicit_inter_segment_trust) > 0
}

_insufficient_egress_filtering_def := {
    "name": "Insufficient Egress Filtering",
    "description": "Outbound traffic from a segment is permitted without rule-based filtering, enabling data exfiltration or command-and-control callbacks from a compromised host within the segment. Indicated by 'egress_acl_enforced' being false.",
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
            "relevance": "Insufficient egress filtering enables attackers to exfiltrate data using alternative protocols that bypass controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Lack of egress filtering allows unencrypted exfiltration over non-standard protocols to go undetected."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    not input.egress_acl_enforced
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    input.egress_acl_enforced == true
    input.egress_destination_restriction == "none"
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    input.egress_acl_enforced == true
    input.egress_destination_restriction in ["none", "partial"]
    not input.egress_dns_filtered
}

exposures contains _insufficient_egress_filtering_def if {
    count(insufficient_egress_filtering) > 0
}

_overpermissive_ingress_acl_def := {
    "name": "Overpermissive Ingress Acl",
    "description": "Ingress filter rules are too broad (e.g., permitting entire CIDR blocks or all ports) at a segment boundary, expanding the attack surface beyond what legitimate flows require. Indicated by 'least_privilege_ingress_rule_set' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Overpermissive ingress ACLs represent a misconfiguration of network device firewall rules that attackers can exploit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overly permissive ingress rules effectively allow boundary bridging by not restricting unauthorized traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

overpermissive_ingress_acl[_overpermissive_ingress_acl_def] if {
    not input.least_privilege_ingress_rule_set
}

overpermissive_ingress_acl[_overpermissive_ingress_acl_def] if {
    input.broad_cidr_permit_present == true
}

overpermissive_ingress_acl[_overpermissive_ingress_acl_def] if {
    input.wildcard_port_permit_present == true
}

exposures contains _overpermissive_ingress_acl_def if {
    count(overpermissive_ingress_acl) > 0
}

_boundary_monitoring_blind_spots_def := {
    "name": "Boundary Monitoring Blind Spots",
    "description": "Traffic crossing zone boundaries is not captured by IDS/IPS or flow telemetry, creating detection gaps for reconnaissance and lateral movement between segments. Indicated by 'east_west_traffic_inspection_enabled' being false.",
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
            "relevance": "Attackers exploit monitoring blind spots to block or avoid generating indicators at the network boundary."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Blind spots in boundary monitoring can enable undetected network sniffing at segment boundaries."
        }
    ],
    "attack_vector": "ADJACENT"
}

boundary_monitoring_blind_spots[_boundary_monitoring_blind_spots_def] if {
    not input.inter_segment_traffic_inspection
}

boundary_monitoring_blind_spots[_boundary_monitoring_blind_spots_def] if {
    not input.boundary_monitoring_coverage
}

exposures contains _boundary_monitoring_blind_spots_def if {
    count(boundary_monitoring_blind_spots) > 0
}

_shared_credentials_across_zones_def := {
    "name": "Shared Credentials Across Zones",
    "description": "Administrative or service credentials are reused across multiple network segments, so compromise in a lower-trust zone grants access to higher-trust zones without additional authentication barriers. Indicated by 'credential_isolation_per_zone' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Shared credentials across zones allow attackers to use valid accounts to authenticate and move between segments."
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

shared_credentials_across_zones[_shared_credentials_across_zones_def] if {
    not input.credential_isolation_per_zone
    input.cross_zone_privilege_escalation_path == true
}

shared_credentials_across_zones[_shared_credentials_across_zones_def] if {
    not input.credential_isolation_per_zone
    not input.zone_boundary_mfa_enforced
}

exposures contains _shared_credentials_across_zones_def if {
    count(shared_credentials_across_zones) > 0
}

_trust_propagation_via_management_plane_def := {
    "name": "Trust Propagation Via Management Plane",
    "description": "A shared out-of-band or in-band management network spans multiple trust zones without equivalent boundary controls, allowing an attacker with management plane access to pivot across segment boundaries. Indicated by 'management_plane_zone_isolated' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.003",
            "name": "Network Trust Dependencies",
            "relevance": "Management plane trust propagation exploits network trust dependencies to gain access across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Attackers can intercept management plane communications to propagate trust and manipulate traffic between zones."
        }
    ],
    "attack_vector": "ADJACENT"
}

trust_propagation_via_management_plane[_trust_propagation_via_management_plane_def] if {
    not input.management_plane_zone_isolated
}

trust_propagation_via_management_plane[_trust_propagation_via_management_plane_def] if {
    input.management_network_scope == "multi_zone_uncontrolled"
}

trust_propagation_via_management_plane[_trust_propagation_via_management_plane_def] if {
    input.management_network_scope == "multi_zone_controlled"
    input.credential_isolation_per_zone == true
}

exposures contains _trust_propagation_via_management_plane_def if {
    count(trust_propagation_via_management_plane) > 0
}

_dynamic_routing_protocol_boundary_leakage_def := {
    "name": "Dynamic Routing Protocol Boundary Leakage",
    "description": "Routing protocol adjacencies (e.g., BGP, OSPF) are not restricted at segment boundaries, enabling route injection or routing table pollution that can redirect inter-zone traffic across unintended paths. Indicated by 'routing_protocol_boundary_filtering_enabled' being false.",
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
            "relevance": "Dynamic routing protocol leakage can bridge network boundaries by advertising routes across intended segment separations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Routing protocol leakage can be used to create tunnels that bypass boundary controls between network segments."
        }
    ],
    "attack_vector": "ADJACENT"
}

dynamic_routing_protocol_boundary_leakage[_dynamic_routing_protocol_boundary_leakage_def] if {
    not input.routing_protocol_boundary_filtering_enabled
}

dynamic_routing_protocol_boundary_leakage[_dynamic_routing_protocol_boundary_leakage_def] if {
    input.unauthorized_routing_adjacency_detected == true
}

dynamic_routing_protocol_boundary_leakage[_dynamic_routing_protocol_boundary_leakage_def] if {
    not input.routing_protocol_boundary_filtering_enabled
    not input.routing_protocol_boundary_filtering_enabled
}

exposures contains _dynamic_routing_protocol_boundary_leakage_def if {
    count(dynamic_routing_protocol_boundary_leakage) > 0
}

_vlan_hopping_at_segment_boundary_def := {
    "name": "Vlan Hopping At Segment Boundary",
    "description": "Improper trunk port configuration or double-tagging vulnerabilities at the boundary layer allow an attacker to hop VLANs and bypass segment isolation enforced at Layer 2. Indicated by 'trunk_port_explicit_allow_list_configured' being false.",
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
            "relevance": "VLAN hopping is a direct technique for bridging network segment boundaries by exploiting VLAN misconfiguration."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "name": "Network Address Translation Traversal",
            "relevance": "NAT traversal techniques can complement VLAN hopping to cross segment boundaries undetected."
        }
    ],
    "attack_vector": "ADJACENT"
}

vlan_hopping_at_segment_boundary[_vlan_hopping_at_segment_boundary_def] if {
    not input.trunk_port_vlan_controls
}

vlan_hopping_at_segment_boundary[_vlan_hopping_at_segment_boundary_def] if {
    input.trunk_port_vlan_controls == 1
    not input.trunk_port_vlan_controls
}

vlan_hopping_at_segment_boundary[_vlan_hopping_at_segment_boundary_def] if {
    input.trunk_port_vlan_controls == true
    not input.trunk_port_vlan_controls
}

exposures contains _vlan_hopping_at_segment_boundary_def if {
    count(vlan_hopping_at_segment_boundary) > 0
}

_split_tunnel_vpn_segment_bypass_def := {
    "name": "Split Tunnel Vpn Segment Bypass",
    "description": "Remote access VPN clients using split tunneling can bridge an external network and an internal segment, effectively creating an uncontrolled ingress path that bypasses boundary controls. Indicated by 'split_tunnel_disabled_for_privileged_segments' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Split tunnel VPNs create protocol tunnels that can bypass segment controls by routing traffic outside the secured path."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Split tunnel VPN configurations can bridge network segments by allowing direct internet access alongside VPN traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Split tunnel VPNs are a form of external remote service that can be exploited to bypass segment boundaries."
        }
    ],
    "attack_vector": "NETWORK"
}

split_tunnel_vpn_segment_bypass[_split_tunnel_vpn_segment_bypass_def] if {
    not input.split_tunnel_disabled_for_privileged_segments
    input.privileged_segments_accessible_via_vpn == true
}

split_tunnel_vpn_segment_bypass[_split_tunnel_vpn_segment_bypass_def] if {
    not input.split_tunnel_disabled_for_privileged_segments
    input.privileged_segments_accessible_via_vpn == true
    not input.vpn_client_endpoint_posture_check_enforced
}

exposures contains _split_tunnel_vpn_segment_bypass_def if {
    count(split_tunnel_vpn_segment_bypass) > 0
}

_firewall_rule_shadowing_def := {
    "name": "Firewall Rule Shadowing",
    "description": "Boundary firewall rule sets contain shadowed or redundant rules where a permissive earlier rule masks a more restrictive later rule, resulting in unintended traffic being allowed across zone boundaries. Indicated by 'rule_shadowing_audit_performed' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.004",
            "name": "Disable or Modify System Firewall",
            "relevance": "Firewall rule shadowing involves manipulating firewall rules so that overly permissive rules override restrictive ones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Rule shadowing in cloud environments involves modifying cloud firewall policies to create unintended permissive paths."
        }
    ],
    "attack_vector": "LOCAL"
}

firewall_rule_shadowing[_firewall_rule_shadowing_def] if {
    not input.rule_shadowing_audit_performed
}

firewall_rule_shadowing[_firewall_rule_shadowing_def] if {
    input.rule_shadowing_audit_performed == true
    input.shadowed_rule_count > 0
}

exposures contains _firewall_rule_shadowing_def if {
    count(firewall_rule_shadowing) > 0
}

_uncontrolled_inter_zone_protocol_tunneling_def := {
    "name": "Uncontrolled Inter Zone Protocol Tunneling",
    "description": "Protocols capable of encapsulating other traffic (e.g., GRE, IP-in-IP, DNS tunneling) are permitted at segment boundaries without deep inspection, providing a covert channel that bypasses ACL enforcement. Indicated by 'protocol_tunneling_inspection_enabled' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Uncontrolled inter-zone tunneling directly maps to protocol tunneling used to encapsulate traffic and bypass zone controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1095",
            "name": "Non-Application Layer Protocol",
            "relevance": "Using non-application layer protocols for tunneling between zones can evade application-layer inspection controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Uncontrolled tunneling enables bridging of network zone boundaries, undermining segmentation controls."
        }
    ],
    "attack_vector": "ADJACENT"
}

uncontrolled_inter_zone_protocol_tunneling[_uncontrolled_inter_zone_protocol_tunneling_def] if {
    not input.protocol_tunneling_inspection_enabled
    count(input.permitted_tunneling_protocols) > 0
}

uncontrolled_inter_zone_protocol_tunneling[_uncontrolled_inter_zone_protocol_tunneling_def] if {
    not input.protocol_tunneling_inspection_enabled
    not input.explicit_deny_default
}

exposures contains _uncontrolled_inter_zone_protocol_tunneling_def if {
    count(uncontrolled_inter_zone_protocol_tunneling) > 0
}

_stale_boundary_policy_drift_def := {
    "name": "Stale Boundary Policy Drift",
    "description": "Segment boundary policies are not reviewed or updated as network topology changes, resulting in orphaned allow rules for decommissioned services and undocumented trust relationships. Indicated by 'boundary_policy_review_cadence_defined' being false.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.003",
            "name": "Network Trust Dependencies",
            "relevance": "Policy drift can introduce stale trust dependencies between zones that no longer reflect the intended security posture."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484",
            "name": "Domain or Tenant Policy Modification",
            "relevance": "Stale boundary policies can result from unauthorized or untracked policy modifications that degrade zone separation over time."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "name": "Network Address Translation Traversal",
            "relevance": "Outdated NAT and boundary policies may allow traversal techniques that should have been remediated as the environment evolved."
        }
    ],
    "attack_vector": "LOCAL"
}

stale_boundary_policy_drift[_stale_boundary_policy_drift_def] if {
    not input.boundary_policy_review_cadence_defined
}

stale_boundary_policy_drift[_stale_boundary_policy_drift_def] if {
    input.orphaned_allow_rules_present == true
}

stale_boundary_policy_drift[_stale_boundary_policy_drift_def] if {
    input.undocumented_trust_relationships_present == true
}

exposures contains _stale_boundary_policy_drift_def if {
    count(stale_boundary_policy_drift) > 0
}

_vpn_endpoint_posture_not_enforced_def := {
    "name": "VPN Client Endpoint Posture Check Not Enforced",
    "description": "VPN clients connecting to this network segment are not required to pass an endpoint posture check. This allows potentially compromised, unpatched, or non-compliant devices to establish VPN sessions and access segment resources, increasing the risk of lateral movement and malware ingress.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Attackers abuse VPN access from unmanaged or compromised endpoints when posture checks are absent, gaining persistent access to internal network segments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Without posture enforcement, valid credentials from a non-compliant device are sufficient to access the segment, bypassing device-based access controls."
        }
    ],
    "attack_vector": "NETWORK"
}

vpn_endpoint_posture_not_enforced[_vpn_endpoint_posture_not_enforced_def] if {
    not input.vpn_client_endpoint_posture_check_enforced
}

exposures contains _vpn_endpoint_posture_not_enforced_def if {
    count(vpn_endpoint_posture_not_enforced) > 0
}
