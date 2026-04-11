package _dt_built_in.exposures.cloud_environment

_insufficient_ingress_allowlist_enforcement_def := {
    "name": "Insufficient Ingress Allowlist Enforcement",
    "description": "Ingress filtering relies on broad CIDR ranges or service tags rather than strict allowlists, allowing unexpected source networks to reach cloud-hosted services without challenge. This expands the attack surface by permitting traffic from untrusted or compromised external networks into the zone boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

insufficient_ingress_allowlist_enforcement[_insufficient_ingress_allowlist_enforcement_def] if {
    input.permits_internet_sourced_traffic == true
}

insufficient_ingress_allowlist_enforcement[_insufficient_ingress_allowlist_enforcement_def] if {
    input.ingress_rule_type in ["broad_cidr", "service_tag", "any"]
}

insufficient_ingress_allowlist_enforcement[_insufficient_ingress_allowlist_enforcement_def] if {
    input.allowlisted_source_count == 0
    input.ingress_rule_type != "strict_allowlist"
}

exposures contains _insufficient_ingress_allowlist_enforcement_def if {
    count(insufficient_ingress_allowlist_enforcement) > 0
}

_missing_egress_traffic_inspection_def := {
    "name": "Missing Egress Traffic Inspection",
    "description": "Egress controls lack deep packet inspection or DNS-layer filtering, permitting compromised workloads within the zone to establish outbound C2 channels or exfiltrate data without triggering boundary-level alerts. The absence of enforceable egress allowlists leaves the outbound trust boundary undefined.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_egress_traffic_inspection[_missing_egress_traffic_inspection_def] if {
    not input.deep_packet_inspection_enabled
    not input.dns_layer_filtering_enabled
    input.egress_allowlist_enforcement in ["none", "partial"]
}

missing_egress_traffic_inspection[_missing_egress_traffic_inspection_def] if {
    not input.dns_layer_filtering_enabled
    input.egress_allowlist_enforcement == "none"
}

missing_egress_traffic_inspection[_missing_egress_traffic_inspection_def] if {
    not input.deep_packet_inspection_enabled
    input.egress_allowlist_enforcement == "none"
}

exposures contains _missing_egress_traffic_inspection_def if {
    count(missing_egress_traffic_inspection) > 0
}

_flat_cloud_network_segmentation_def := {
    "name": "Flat Cloud Network Segmentation",
    "description": "Internal and external user data workloads share the same virtual network segment or VPC without micro-segmentation enforcement, allowing lateral traversal between workloads that should reside in separate trust tiers. Absence of subnet-level security group enforcement collapses the internal zone boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

flat_cloud_network_segmentation[_flat_cloud_network_segmentation_def] if {
    "internal" in input.workload_types_in_shared_segment
    "external" in input.workload_types_in_shared_segment
    not input.subnet_security_group_enforcement
}

flat_cloud_network_segmentation[_flat_cloud_network_segmentation_def] if {
    "internal" in input.workload_types_in_shared_segment
    "external" in input.workload_types_in_shared_segment
    not input.distinct_subnets_per_trust_tier
}

flat_cloud_network_segmentation[_flat_cloud_network_segmentation_def] if {
    "internal" in input.workload_types_in_shared_segment
    "external" in input.workload_types_in_shared_segment
    input.inter_zone_routing_policy in ["none", "permissive"]
}

exposures contains _flat_cloud_network_segmentation_def if {
    count(flat_cloud_network_segmentation) > 0
}

_implicit_trust_propagation_via_service_mesh_def := {
    "name": "Implicit Trust Propagation Via Service Mesh",
    "description": "East-west traffic between cloud microservices or managed services relies on network adjacency rather than explicit mutual authentication, causing trust to propagate transitively across zone boundaries. A compromised peripheral service inherits access to core internal services without re-authentication at each zone hop.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

implicit_trust_propagation_via_service_mesh[_implicit_trust_propagation_via_service_mesh_def] if {
    not input.mutual_tls_enforced
}

implicit_trust_propagation_via_service_mesh[_implicit_trust_propagation_via_service_mesh_def] if {
    not input.per_hop_authorization_policy
    input.service_identity_validation_mode != "cryptographic"
}

exposures contains _implicit_trust_propagation_via_service_mesh_def if {
    count(implicit_trust_propagation_via_service_mesh) > 0
}

_overpermissive_cloud_iam_federation_def := {
    "name": "Overpermissive Cloud Iam Federation",
    "description": "Identity federation between the cloud zone and external identity providers uses broad role mappings or missing audience restrictions, allowing external identities to assume elevated privileges within the internal trust zone. Trust boundary violations occur at the credential layer rather than the network layer.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

overpermissive_cloud_iam_federation[_overpermissive_cloud_iam_federation_def] if {
    input.federation_role_mapping_scope == "wildcard"
    input.assumed_role_privilege_level in ["admin", "elevated"]
}

overpermissive_cloud_iam_federation[_overpermissive_cloud_iam_federation_def] if {
    input.federation_role_mapping_scope == "broad_group"
    not input.audience_restriction_enforced
    input.assumed_role_privilege_level in ["admin", "elevated"]
}

overpermissive_cloud_iam_federation[_overpermissive_cloud_iam_federation_def] if {
    not input.audience_restriction_enforced
    input.assumed_role_privilege_level == "admin"
}

exposures contains _overpermissive_cloud_iam_federation_def if {
    count(overpermissive_cloud_iam_federation) > 0
}

_uncontrolled_cloud_peering_and_private_link_exposure_def := {
    "name": "Uncontrolled Cloud Peering And Private Link Exposure",
    "description": "VPC peering connections, private endpoints, or cloud interconnects are established without enforcing route-level access controls, creating unintended network paths that bypass the defined trust zone boundary. Peered networks may introduce third-party or partner networks as implicit zone members.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

uncontrolled_cloud_peering_and_private_link_exposure[_uncontrolled_cloud_peering_and_private_link_exposure_def] if {
    not input.peering_route_filter_enforced
}

uncontrolled_cloud_peering_and_private_link_exposure[_uncontrolled_cloud_peering_and_private_link_exposure_def] if {
    input.third_party_networks_in_peering == true
    not input.private_endpoint_network_policy_enabled
}

exposures contains _uncontrolled_cloud_peering_and_private_link_exposure_def if {
    count(uncontrolled_cloud_peering_and_private_link_exposure) > 0
}

_management_plane_not_isolated_from_data_plane_def := {
    "name": "Management Plane Not Isolated From Data Plane",
    "description": "Cloud management and administration interfaces (console APIs, control plane endpoints) are reachable from the same network segments as data-plane workloads, removing the boundary separation between operational management and production traffic. A foothold in any zone tier provides access to management functions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

management_plane_not_isolated_from_data_plane[_management_plane_not_isolated_from_data_plane_def] if {
    not input.management_plane_network_isolated
}

management_plane_not_isolated_from_data_plane[_management_plane_not_isolated_from_data_plane_def] if {
    input.management_api_access_control_scope in ["workload_segments_accessible", "unrestricted"]
}

management_plane_not_isolated_from_data_plane[_management_plane_not_isolated_from_data_plane_def] if {
    input.data_plane_to_control_plane_routes_exist == true
    not input.management_access_requires_dedicated_bastion_or_vpn
}

exposures contains _management_plane_not_isolated_from_data_plane_def if {
    count(management_plane_not_isolated_from_data_plane) > 0
}

_lack_of_inter_zone_traffic_logging_and_alerting_def := {
    "name": "Lack Of Inter Zone Traffic Logging And Alerting",
    "description": "Traffic crossing the boundary between internal and external user data segments is not captured in flow logs or subjected to anomaly detection, leaving lateral movement and boundary violations invisible to defenders. Absence of boundary-specific monitoring negates detection and response capabilities at the zone level.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

lack_of_inter_zone_traffic_logging_and_alerting[_lack_of_inter_zone_traffic_logging_and_alerting_def] if {
    not input.inter_zone_flow_logging_enabled
}

lack_of_inter_zone_traffic_logging_and_alerting[_lack_of_inter_zone_traffic_logging_and_alerting_def] if {
    input.inter_zone_flow_logging_enabled == true
    not input.inter_zone_anomaly_detection_enabled
}

exposures contains _lack_of_inter_zone_traffic_logging_and_alerting_def if {
    count(lack_of_inter_zone_traffic_logging_and_alerting) > 0
}

_transitive_storage_bucket_policy_exposure_def := {
    "name": "Transitive Storage Bucket Policy Exposure",
    "description": "Cloud storage services with policies granting access to broad principal sets (e.g., any authenticated cloud user) allow workloads from adjacent or external zones to reach storage resources without traversing a network boundary control, effectively bypassing zone segmentation through the cloud resource policy plane.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

transitive_storage_bucket_policy_exposure[_transitive_storage_bucket_policy_exposure_def] if {
    input.principal_scope in ["any_authenticated_user", "any_user"]
    input.cross_zone_workload_access_permitted == true
    not input.network_boundary_control_enforced
}

exposures contains _transitive_storage_bucket_policy_exposure_def if {
    count(transitive_storage_bucket_policy_exposure) > 0
}

_shared_nat_gateway_collapsing_zone_boundaries_def := {
    "name": "Shared Nat Gateway Collapsing Zone Boundaries",
    "description": "Multiple trust tiers sharing a single NAT gateway or internet egress point removes network-observable separation between external and internal workload traffic, preventing egress-based zone enforcement and making traffic attribution across zone boundaries impossible.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

shared_nat_gateway_collapsing_zone_boundaries[_shared_nat_gateway_collapsing_zone_boundaries_def] if {
    input.distinct_trust_tiers_sharing_nat_gateway == true
    input.egress_traffic_attribution_mechanism == "none"
}

shared_nat_gateway_collapsing_zone_boundaries[_shared_nat_gateway_collapsing_zone_boundaries_def] if {
    input.distinct_trust_tiers_sharing_nat_gateway == true
    input.egress_traffic_attribution_mechanism == "flow_log_tagging_only"
    not input.zone_egress_firewall_policy_enforced
}

exposures contains _shared_nat_gateway_collapsing_zone_boundaries_def if {
    count(shared_nat_gateway_collapsing_zone_boundaries) > 0
}
