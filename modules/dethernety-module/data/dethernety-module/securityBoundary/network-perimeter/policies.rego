package _dt_built_in.exposures.network_perimeter

_ingress_acl_misconfiguration_def := {
    "name": "Ingress Acl Misconfiguration",
    "description": "Overly permissive inbound ACL rules on the firewall allow unauthorized traffic from untrusted zones into the DMZ or internal segments, bypassing intended trust zone boundaries. This includes implicit allows, legacy rules, or unreviewed rule accumulation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.004",
            "name": "Disable or Modify System Firewall",
            "relevance": "Misconfigured ingress ACLs directly relate to firewall rule manipulation that allows unauthorized traffic through boundary controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Cloud-based ingress ACL misconfigurations map directly to cloud firewall modification techniques that expose resources to unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Network device firewall modifications represent the network-layer equivalent of ingress ACL misconfigurations at boundary devices."
        }
    ],
    "attack_vector": "NETWORK"
}

ingress_acl_misconfiguration[_ingress_acl_misconfiguration_def] if {
    input.default_inbound_policy in ["allow_all", "undefined"]
}

ingress_acl_misconfiguration[_ingress_acl_misconfiguration_def] if {
    input.any_source_rules_count > 0
}

ingress_acl_misconfiguration[_ingress_acl_misconfiguration_def] if {
    input.stale_rules_present == true
}

ingress_acl_misconfiguration[_ingress_acl_misconfiguration_def] if {
    input.internal_segments_directly_reachable == true
}

exposures contains _ingress_acl_misconfiguration_def if {
    count(ingress_acl_misconfiguration) > 0
}

_egress_filtering_absence_def := {
    "name": "Egress Filtering Absence",
    "description": "Lack of enforced outbound traffic restrictions allows compromised internal hosts to exfiltrate data or establish command-and-control channels through the perimeter without detection. No egress ACL or domain-based filtering is applied at the boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Absence of egress filtering enables attackers to exfiltrate data over unencrypted protocols without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Missing egress controls allow data exfiltration over alternative protocols that bypass security monitoring."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "name": "Exfiltration Over Web Service",
            "relevance": "Without egress filtering, attackers can freely exfiltrate data to external web services without interception."
        }
    ],
    "attack_vector": "NETWORK"
}

egress_filtering_absence[_egress_filtering_absence_def] if {
    not input.egress_acl_enforced
    not input.domain_based_egress_filtering_enabled
}

egress_filtering_absence[_egress_filtering_absence_def] if {
    not input.egress_acl_enforced
    input.egress_traffic_inspection_mode == "none"
}

egress_filtering_absence[_egress_filtering_absence_def] if {
    not input.domain_based_egress_filtering_enabled
    input.egress_traffic_inspection_mode in ["none", "stateless"]
}

exposures contains _egress_filtering_absence_def if {
    count(egress_filtering_absence) > 0
}

_vpn_gateway_over_trust_propagation_def := {
    "name": "Vpn Gateway Over Trust Propagation",
    "description": "VPN-authenticated sessions are granted broad internal network access without post-authentication segmentation enforcement. Successful VPN authentication implicitly propagates trust across multiple internal zones, enabling lateral movement from any compromised VPN endpoint.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "VPN gateways are external remote services whose excessive trust propagation can allow attackers to pivot into internal networks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Over-trusted VPN gateways bridge network security boundaries, enabling lateral movement across zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "VPN trust propagation can be exploited through protocol tunneling to route malicious traffic through trusted VPN connections."
        }
    ],
    "attack_vector": "NETWORK"
}

vpn_gateway_over_trust_propagation[_vpn_gateway_over_trust_propagation_def] if {
    not input.vpn_post_auth_segmentation_enforced
}

vpn_gateway_over_trust_propagation[_vpn_gateway_over_trust_propagation_def] if {
    input.vpn_accessible_internal_zone_count > 1
    not input.vpn_post_auth_segmentation_enforced
}

vpn_gateway_over_trust_propagation[_vpn_gateway_over_trust_propagation_def] if {
    input.vpn_micro_segmentation_policy == "none"
}

exposures contains _vpn_gateway_over_trust_propagation_def if {
    count(vpn_gateway_over_trust_propagation) > 0
}

_load_balancer_zone_bypass_def := {
    "name": "Load Balancer Zone Bypass",
    "description": "The load balancer accepts and forwards traffic to backend tiers without enforcing zone-level ACLs or validating that traffic conforms to expected protocol and source constraints. Direct backend access from the load balancer may bypass firewall policy, collapsing DMZ segmentation.",
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
            "relevance": "Load balancer misconfigurations that allow zone bypass directly enable bridging of network security boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.004",
            "name": "Domain Fronting",
            "relevance": "Domain fronting techniques can exploit load balancer configurations to route traffic to unintended backend zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Cloud load balancer zone bypass often involves modification or circumvention of associated cloud firewall rules."
        }
    ],
    "attack_vector": "NETWORK"
}

load_balancer_zone_bypass[_load_balancer_zone_bypass_def] if {
    not input.backend_zone_acl_enforced
    input.firewall_policy_bypass_possible == true
}

load_balancer_zone_bypass[_load_balancer_zone_bypass_def] if {
    input.protocol_validation_mode in ["none", "partial"]
    not input.backend_zone_acl_enforced
}

load_balancer_zone_bypass[_load_balancer_zone_bypass_def] if {
    not input.backend_zone_acl_enforced
    not input.backend_zone_acl_enforced
}

exposures contains _load_balancer_zone_bypass_def if {
    count(load_balancer_zone_bypass) > 0
}

_inter_boundary_device_shared_management_plane_def := {
    "name": "Inter Boundary Device Shared Management Plane",
    "description": "Firewall, VPN gateway, and load balancer share a common out-of-band management network or management VLAN without adequate inter-device access controls. Compromise of one boundary device's management interface enables lateral pivot to adjacent boundary components.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.008",
            "name": "Network Devices",
            "relevance": "Shared management planes across boundary devices represent a compromise path where one device's access grants control over others."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "A shared management plane allows an attacker to modify firewall configurations across multiple boundary devices simultaneously."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Shared management planes between boundary devices create pathways to bridge otherwise separated network zones."
        }
    ],
    "attack_vector": "ADJACENT"
}

inter_boundary_device_shared_management_plane[_inter_boundary_device_shared_management_plane_def] if {
    input.shared_management_network == true
    not input.inter_device_management_acl_enforced
}

inter_boundary_device_shared_management_plane[_inter_boundary_device_shared_management_plane_def] if {
    input.shared_management_network == true
    input.management_plane_auth_method in ["shared_password", "per_device_local"]
}

exposures contains _inter_boundary_device_shared_management_plane_def if {
    count(inter_boundary_device_shared_management_plane) > 0
}

_vpn_split_tunneling_enforcement_gap_def := {
    "name": "Vpn Split Tunneling Enforcement Gap",
    "description": "VPN gateway policy permits split tunneling, allowing remote endpoints to simultaneously route traffic through the VPN and directly to the internet without boundary inspection. This creates an unmonitored ingress path into the internal zone via the VPN client.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "name": "Network Address Translation Traversal",
            "relevance": "Split tunneling gaps allow traffic to bypass NAT and VPN enforcement, directly enabling network boundary traversal."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Split tunneling enforcement gaps enable bridging between protected corporate networks and untrusted external networks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Attackers can exploit split tunneling gaps by tunneling malicious traffic through allowed VPN channels."
        }
    ],
    "attack_vector": "NETWORK"
}

vpn_split_tunneling_enforcement_gap[_vpn_split_tunneling_enforcement_gap_def] if {
    input.split_tunneling_enabled == true
    not input.vpn_client_traffic_inspection_enforced
}

vpn_split_tunneling_enforcement_gap[_vpn_split_tunneling_enforcement_gap_def] if {
    input.split_tunneling_enabled == true
    input.vpn_client_subnet_segmentation in ["none", "partial"]
}

exposures contains _vpn_split_tunneling_enforcement_gap_def if {
    count(vpn_split_tunneling_enforcement_gap) > 0
}

_insufficient_east_west_segmentation_at_ingress_def := {
    "name": "Insufficient East West Segmentation At Ingress",
    "description": "Traffic entering through the perimeter is distributed by the load balancer across multiple backend tiers without enforcement of inter-tier segmentation rules. Compromise of one backend tier allows unrestricted east-west movement to other tiers within the same ingress zone.",
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
            "relevance": "Insufficient east-west segmentation allows attackers to bridge internal network segments after gaining initial access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Lack of east-west segmentation allows protocol tunneling techniques to move laterally across internal zones unchallenged."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "Without east-west controls, attackers can chain internal hosts as multi-hop proxies to reach deeper network segments."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_east_west_segmentation_at_ingress[_insufficient_east_west_segmentation_at_ingress_def] if {
    not input.inter_tier_segmentation_enforced
}

insufficient_east_west_segmentation_at_ingress[_insufficient_east_west_segmentation_at_ingress_def] if {
    input.inter_tier_segmentation_enforced == true
    not input.east_west_traffic_inspection_enabled
}

exposures contains _insufficient_east_west_segmentation_at_ingress_def if {
    count(insufficient_east_west_segmentation_at_ingress) > 0
}

_monitoring_blind_spot_at_vpn_termination_def := {
    "name": "Monitoring Blind Spot At Vpn Termination",
    "description": "Encrypted VPN traffic is decrypted at the VPN gateway but not inspected by the firewall or IDS/IPS before entering the internal zone. Post-decryption traffic flows are invisible to boundary monitoring controls, allowing malicious payloads to traverse the perimeter unchecked.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "name": "Encrypted Channel",
            "relevance": "VPN termination blind spots prevent detection of encrypted channels used for command-and-control or data exfiltration."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Monitoring gaps at VPN termination points allow protocol tunneling to go undetected as traffic enters the internal network."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Blind spots at VPN termination create opportunities where network sniffing or traffic interception goes unmonitored."
        }
    ],
    "attack_vector": "ADJACENT"
}

monitoring_blind_spot_at_vpn_termination[_monitoring_blind_spot_at_vpn_termination_def] if {
    not input.post_decryption_traffic_inspection_enabled
}

monitoring_blind_spot_at_vpn_termination[_monitoring_blind_spot_at_vpn_termination_def] if {
    input.vpn_termination_zone_placement in ["direct_internal", "bypasses_inspection"]
}

monitoring_blind_spot_at_vpn_termination[_monitoring_blind_spot_at_vpn_termination_def] if {
    not input.post_decryption_traffic_inspection_enabled
    not input.ids_ips_sensor_coverage_on_vpn_segment
}

exposures contains _monitoring_blind_spot_at_vpn_termination_def if {
    count(monitoring_blind_spot_at_vpn_termination) > 0
}

_protocol_tunneling_through_allowed_ports_def := {
    "name": "Protocol Tunneling Through Allowed Ports",
    "description": "Ingress firewall rules permit specific ports such as 443 or 53 without deep packet inspection, enabling attackers to tunnel non-HTTP or non-DNS protocols through the boundary. This allows firewall rule bypass while appearing compliant with allowed service definitions.",
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
            "relevance": "This technique directly describes encapsulating malicious protocols within allowed port traffic to bypass firewall restrictions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.004",
            "name": "Disable or Modify System Firewall",
            "relevance": "Protocol tunneling through allowed ports exploits gaps in firewall rules that are equivalent to effective firewall policy weakening."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Tunneling through allowed ports enables boundary bridging by carrying unauthorized traffic inside permitted protocol wrappers."
        }
    ],
    "attack_vector": "NETWORK"
}

protocol_tunneling_through_allowed_ports[_protocol_tunneling_through_allowed_ports_def] if {
    not input.dpi_enabled_on_allowed_ports
    count(input.allowed_ports_without_protocol_enforcement) > 0
}

protocol_tunneling_through_allowed_ports[_protocol_tunneling_through_allowed_ports_def] if {
    not input.dpi_enabled_on_allowed_ports
    not input.egress_traffic_inspection_mode
    count(input.allowed_ports_without_protocol_enforcement) > 0
}

exposures contains _protocol_tunneling_through_allowed_ports_def if {
    count(protocol_tunneling_through_allowed_ports) > 0
}

_asymmetric_routing_breaking_stateful_inspection_def := {
    "name": "Asymmetric Routing Breaking Stateful Inspection",
    "description": "Load balancer or multi-homed firewall configurations introduce asymmetric return paths where response traffic does not traverse the same stateful firewall instance as the request. This breaks connection tracking and allows partially inspected or uninspected flows to cross zone boundaries.",
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
            "relevance": "Asymmetric routing that breaks stateful inspection effectively bridges network boundaries by bypassing return-path security checks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020.001",
            "name": "Traffic Duplication",
            "relevance": "Asymmetric routing can involve traffic duplication or mirroring that causes packets to traverse inspection points inconsistently."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "Multi-hop proxy chains can deliberately induce asymmetric routing to evade stateful firewall inspection of bidirectional flows."
        }
    ],
    "attack_vector": "NETWORK"
}

asymmetric_routing_breaking_stateful_inspection[_asymmetric_routing_breaking_stateful_inspection_def] if {
    input.asymmetric_routing_paths_present == true
    not input.stateful_inspection_symmetry_enforced
    not input.firewall_state_synchronization_enabled
}

asymmetric_routing_breaking_stateful_inspection[_asymmetric_routing_breaking_stateful_inspection_def] if {
    input.asymmetric_routing_paths_present == true
    not input.stateful_inspection_symmetry_enforced
    not input.firewall_state_synchronization_enabled
}

exposures contains _asymmetric_routing_breaking_stateful_inspection_def if {
    count(asymmetric_routing_breaking_stateful_inspection) > 0
}

_boundary_credential_reuse_across_zones_def := {
    "name": "Boundary Credential Reuse Across Zones",
    "description": "Administrative or service credentials used to manage boundary devices are shared with or derivable from credentials used within internal zones. Credential compromise at the perimeter layer provides a direct path to internal zone management without re-authentication.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Credential reuse across zones exploits valid accounts to authenticate to multiple boundary systems with the same stolen credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Credential stuffing directly describes the reuse of credentials across multiple boundary systems and security zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.001",
            "name": "Credentials",
            "relevance": "Gathering boundary credentials enables their reuse across multiple zones as part of reconnaissance and lateral movement planning."
        }
    ],
    "attack_vector": "LOCAL"
}

boundary_credential_reuse_across_zones[_boundary_credential_reuse_across_zones_def] if {
    not input.credential_scope_separation_enforced
}

boundary_credential_reuse_across_zones[_boundary_credential_reuse_across_zones_def] if {
    input.shared_credential_identities_detected == true
}

boundary_credential_reuse_across_zones[_boundary_credential_reuse_across_zones_def] if {
    not input.credential_scope_separation_enforced
    not input.boundary_to_internal_mfa_required
}

exposures contains _boundary_credential_reuse_across_zones_def if {
    count(boundary_credential_reuse_across_zones) > 0
}

_firewall_rule_shadowing_and_stale_policy_def := {
    "name": "Firewall Rule Shadowing And Stale Policy",
    "description": "Accumulated firewall rules contain shadowed or redundant entries that mask effective policy behavior. Stale rules for decommissioned services remain active, unknowingly permitting traffic to defunct or repurposed IP ranges that may now belong to different trust zones.",
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
            "relevance": "Stale and shadowed firewall rules represent an effective modification of firewall policy that allows unintended traffic through."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Shadowed or stale cloud firewall rules create exploitable gaps equivalent to intentional cloud firewall modification."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.007",
            "name": "Clear Network Connection History and Configurations",
            "relevance": "Stale firewall policies may result from cleared or untracked configuration changes that obscure the true security posture."
        }
    ],
    "attack_vector": "NETWORK"
}

firewall_rule_shadowing_and_stale_policy[_firewall_rule_shadowing_and_stale_policy_def] if {
    input.shadowed_rule_count > 0
}

firewall_rule_shadowing_and_stale_policy[_firewall_rule_shadowing_and_stale_policy_def] if {
    input.stale_rule_count > 0
}

firewall_rule_shadowing_and_stale_policy[_firewall_rule_shadowing_and_stale_policy_def] if {
    input.rule_review_age_days > 180
    not input.automated_shadow_detection_enabled
}

exposures contains _firewall_rule_shadowing_and_stale_policy_def if {
    count(firewall_rule_shadowing_and_stale_policy) > 0
}
