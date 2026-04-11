package _dt_built_in.exposures.office_environment



_insufficient_egress_filtering_def := {
    "name": "Insufficient Egress Filtering",
    "description": "Outbound traffic from workstation zone lacks application-layer or destination-based filtering, allowing exfiltration over permitted ports (80/443) and beaconing to attacker-controlled infrastructure without detection or blocking.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    not input.egress_application_layer_filtering_enabled
    not input.egress_destination_allowlist_enforced
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    not input.egress_application_layer_filtering_enabled
    input.outbound_traffic_monitoring_coverage == "none"
}

insufficient_egress_filtering[_insufficient_egress_filtering_def] if {
    not input.egress_destination_allowlist_enforced
    input.outbound_traffic_monitoring_coverage == "none"
}

exposures contains _insufficient_egress_filtering_def if {
    count(insufficient_egress_filtering) > 0
}

_flat_workstation_subnet_segmentation_def := {
    "name": "Flat Workstation Subnet Segmentation",
    "description": "All workstations reside in a single broadcast domain or subnet with no micro-segmentation, enabling any compromised workstation to reach all peer workstations directly without crossing an enforced boundary control.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

flat_workstation_subnet_segmentation[_flat_workstation_subnet_segmentation_def] if {
    input.workstation_subnet_count == 1
    not input.inter_workstation_acl_enforced
}

flat_workstation_subnet_segmentation[_flat_workstation_subnet_segmentation_def] if {
    input.workstation_subnet_count == 1
    input.microsegmentation_technology == "none"
}

flat_workstation_subnet_segmentation[_flat_workstation_subnet_segmentation_def] if {
    not input.inter_workstation_acl_enforced
    input.microsegmentation_technology == "none"
}

exposures contains _flat_workstation_subnet_segmentation_def if {
    count(flat_workstation_subnet_segmentation) > 0
}

_implicit_intranet_server_trust_def := {
    "name": "Implicit Intranet Server Trust",
    "description": "Intranet-facing servers accept connections from any workstation subnet IP without explicit zone-level access control lists, granting broad implicit trust to all zone members regardless of role or device health posture.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

implicit_intranet_server_trust[_implicit_intranet_server_trust_def] if {
    not input.intranet_server_acl_enforced
}

implicit_intranet_server_trust[_implicit_intranet_server_trust_def] if {
    input.intranet_zone_segmentation_model == "flat"
    not input.workstation_device_health_checked_at_access
}

exposures contains _implicit_intranet_server_trust_def if {
    count(implicit_intranet_server_trust) > 0
}

_uncontrolled_ingress_from_vpn_or_remote_access_def := {
    "name": "Uncontrolled Ingress From Vpn Or Remote Access",
    "description": "Remote access VPN or split-tunnel endpoints inject traffic directly into the workstation zone without re-inspection at the zone ingress boundary, bypassing perimeter controls and inheriting full intranet trust upon tunnel establishment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

uncontrolled_ingress_from_vpn_or_remote_access[_uncontrolled_ingress_from_vpn_or_remote_access_def] if {
    not input.vpn_traffic_reinspected_at_zone_ingress
    not input.vpn_assigned_address_pool_isolated
}

uncontrolled_ingress_from_vpn_or_remote_access[_uncontrolled_ingress_from_vpn_or_remote_access_def] if {
    input.split_tunnel_policy == "split_tunnel"
    not input.vpn_traffic_reinspected_at_zone_ingress
}

uncontrolled_ingress_from_vpn_or_remote_access[_uncontrolled_ingress_from_vpn_or_remote_access_def] if {
    not input.vpn_assigned_address_pool_isolated
    input.split_tunnel_policy != "none"
    not input.vpn_traffic_reinspected_at_zone_ingress
}

exposures contains _uncontrolled_ingress_from_vpn_or_remote_access_def if {
    count(uncontrolled_ingress_from_vpn_or_remote_access) > 0
}

_inter_vlan_routing_without_stateful_inspection_def := {
    "name": "Inter Vlan Routing Without Stateful Inspection",
    "description": "Layer-3 routing between workstation VLANs and adjacent internal zones (e.g., server VLAN, management VLAN) is performed at the core switch without stateful firewall enforcement, permitting unrestricted lateral traversal across zone boundaries.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

inter_vlan_routing_without_stateful_inspection[_inter_vlan_routing_without_stateful_inspection_def] if {
    input.inter_vlan_routing_device_type in ["layer3_switch", "router_without_stateful_inspection"]
    not input.acl_enforced_between_vlans
}

inter_vlan_routing_without_stateful_inspection[_inter_vlan_routing_without_stateful_inspection_def] if {
    input.inter_vlan_routing_device_type in ["layer3_switch", "router_without_stateful_inspection"]
}

exposures contains _inter_vlan_routing_without_stateful_inspection_def if {
    count(inter_vlan_routing_without_stateful_inspection) > 0
}

_broadcast_domain_trust_propagation_def := {
    "name": "Broadcast Domain Trust Propagation",
    "description": "Shared Layer-2 broadcast domain allows ARP spoofing and mDNS/NetBIOS name poisoning attacks that redirect zone traffic without crossing any enforced boundary, propagating attacker-controlled trust within the zone.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

broadcast_domain_trust_propagation[_broadcast_domain_trust_propagation_def] if {
    not input.dynamic_arp_inspection_enabled
    input.intranet_zone_segmentation_model in ["flat", "vlan_segmented"]
}

broadcast_domain_trust_propagation[_broadcast_domain_trust_propagation_def] if {
    not input.llmnr_nbt_ns_disabled
    input.intranet_zone_segmentation_model in ["flat", "vlan_segmented"]
}

broadcast_domain_trust_propagation[_broadcast_domain_trust_propagation_def] if {
    input.dynamic_arp_inspection_enabled == true
    not input.llmnr_nbt_ns_disabled
    input.intranet_zone_segmentation_model in ["flat", "vlan_segmented"]
}

exposures contains _broadcast_domain_trust_propagation_def if {
    count(broadcast_domain_trust_propagation) > 0
}

_absence_of_east_west_monitoring_coverage_def := {
    "name": "Absence Of East West Monitoring Coverage",
    "description": "Network monitoring sensors (IDS/NDR) are deployed only at the north-south perimeter boundary and not at east-west choke points within the workstation zone, leaving lateral movement between workstations and internal services undetected.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absence_of_east_west_monitoring_coverage[_absence_of_east_west_monitoring_coverage_def] if {
    not input.east_west_ids_ndr_deployed
}

absence_of_east_west_monitoring_coverage[_absence_of_east_west_monitoring_coverage_def] if {
    input.east_west_ids_ndr_deployed == true
    not input.internal_lateral_movement_alert_capability
}

exposures contains _absence_of_east_west_monitoring_coverage_def if {
    count(absence_of_east_west_monitoring_coverage) > 0
}

_shared_credential_path_across_zone_boundary_def := {
    "name": "Shared Credential Path Across Zone Boundary",
    "description": "Domain credentials or service account tokens used within the workstation zone are also valid on servers in adjacent zones, meaning zone boundary controls do not enforce credential isolation and a stolen workstation credential enables cross-zone access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

shared_credential_path_across_zone_boundary[_shared_credential_path_across_zone_boundary_def] if {
    not input.credential_scope_isolation_enforced
    input.shared_accounts_across_zones == true
}

shared_credential_path_across_zone_boundary[_shared_credential_path_across_zone_boundary_def] if {
    input.zone_boundary_auth_controls in ["none", "network_only"]
    input.shared_accounts_across_zones == true
}

exposures contains _shared_credential_path_across_zone_boundary_def if {
    count(shared_credential_path_across_zone_boundary) > 0
}

_permissive_dns_recursion_and_tunneling_path_def := {
    "name": "Permissive Dns Recursion And Tunneling Path",
    "description": "DNS resolvers accessible from the workstation zone permit recursive queries to arbitrary external resolvers and do not inspect or rate-limit query volume, providing a reliable covert channel for DNS tunneling that bypasses egress controls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

permissive_dns_recursion_and_tunneling_path[_permissive_dns_recursion_and_tunneling_path_def] if {
    input.recursive_query_to_external_resolvers_permitted == true
    not input.dns_payload_inspection_enabled
}

permissive_dns_recursion_and_tunneling_path[_permissive_dns_recursion_and_tunneling_path_def] if {
    input.recursive_query_to_external_resolvers_permitted == true
    not input.dns_query_rate_limiting_enabled
}

permissive_dns_recursion_and_tunneling_path[_permissive_dns_recursion_and_tunneling_path_def] if {
    not input.workstation_zone_egress_dns_restricted_to_internal_resolver
    not input.dns_payload_inspection_enabled
}

exposures contains _permissive_dns_recursion_and_tunneling_path_def if {
    count(permissive_dns_recursion_and_tunneling_path) > 0
}

_unmonitored_physical_network_access_points_def := {
    "name": "Unmonitored Physical Network Access Points",
    "description": "Network jacks in office common areas or conference rooms within the zone perimeter lack 802.1X port authentication or MAC-based admission control, allowing an unauthorized device to join the workstation zone by physical network access alone.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

unmonitored_physical_network_access_points[_unmonitored_physical_network_access_points_def] if {
    input.port_authentication_method == "none"
}

unmonitored_physical_network_access_points[_unmonitored_physical_network_access_points_def] if {
    not input.nac_solution_deployed
    input.unauthenticated_ports_count > 0
}

exposures contains _unmonitored_physical_network_access_points_def if {
    count(unmonitored_physical_network_access_points) > 0
}

_management_plane_cohabitation_def := {
    "name": "Management Plane Cohabitation",
    "description": "Out-of-band management traffic for switches and boundary devices traverses the same workstation zone VLAN rather than an isolated management plane, allowing a zone-level compromise to reach network device management interfaces without crossing an additional boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

management_plane_cohabitation[_management_plane_cohabitation_def] if {
    not input.oob_management_vlan_isolated
}

management_plane_cohabitation[_management_plane_cohabitation_def] if {
    input.management_traffic_path == "shared_workstation_vlan"
}

management_plane_cohabitation[_management_plane_cohabitation_def] if {
    not input.oob_management_vlan_isolated
    not input.management_acl_restricts_workstation_subnets
}

exposures contains _management_plane_cohabitation_def if {
    count(management_plane_cohabitation) > 0
}
