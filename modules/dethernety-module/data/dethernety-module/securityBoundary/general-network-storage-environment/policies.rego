package _dt_built_in.exposures.general_network_storage_environment



_permissive_storage_protocol_ingress_filtering_def := {
    "name": "Permissive Storage Protocol Ingress Filtering",
    "description": "NAS ingress controls fail to restrict storage protocol traffic (SMB, NFS, iSCSI) to authorized source zones only, allowing hosts from untrusted or adjacent zones to initiate storage sessions without zone-level enforcement. Absence of per-protocol ACLs on the zone boundary firewall or VLAN enforcement enables cross-zone storage access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

permissive_storage_protocol_ingress_filtering[_permissive_storage_protocol_ingress_filtering_def] if {
    not input.storage_protocol_zone_acls_configured
    not input.nas_vlan_isolation_enforced
}

permissive_storage_protocol_ingress_filtering[_permissive_storage_protocol_ingress_filtering_def] if {
    not input.storage_protocol_zone_acls_configured
    input.unauthorized_zone_storage_access_observed == true
}

permissive_storage_protocol_ingress_filtering[_permissive_storage_protocol_ingress_filtering_def] if {
    not input.nas_vlan_isolation_enforced
    input.unauthorized_zone_storage_access_observed == true
}

exposures contains _permissive_storage_protocol_ingress_filtering_def if {
    count(permissive_storage_protocol_ingress_filtering) > 0
}

_nfs_trust_propagation_via_uid_gid_mapping_def := {
    "name": "Nfs Trust Propagation Via Uid Gid Mapping",
    "description": "NFS exports rely on client-side UID/GID values without cryptographic validation at the trust zone boundary, allowing a client in a lower-trust zone to present arbitrary UID/GID identities. The boundary does not enforce re-authentication or identity re-mapping when traffic crosses zone demarcations, enabling trust escalation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

nfs_trust_propagation_via_uid_gid_mapping[_nfs_trust_propagation_via_uid_gid_mapping_def] if {
    input.nfs_export_crosses_trust_zone_boundary == true
    input.nfs_auth_mechanism in ["sys", "none"]
    not input.nfs_uid_gid_squashing_enabled
}

nfs_trust_propagation_via_uid_gid_mapping[_nfs_trust_propagation_via_uid_gid_mapping_def] if {
    input.nfs_auth_mechanism in ["sys", "none"]
    not input.nfs_uid_gid_squashing_enabled
    input.nfs_export_crosses_trust_zone_boundary == true
}

exposures contains _nfs_trust_propagation_via_uid_gid_mapping_def if {
    count(nfs_trust_propagation_via_uid_gid_mapping) > 0
}

_management_plane_zone_colocation_def := {
    "name": "Management Plane Zone Colocation",
    "description": "NAS management interfaces (HTTP/S admin consoles, SNMP, SSH) are accessible from the same network zone as data-plane storage clients, collapsing management and data trust zones. The absence of a dedicated out-of-band management zone allows lateral movement from a compromised storage client directly to the management boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

management_plane_zone_colocation[_management_plane_zone_colocation_def] if {
    not input.dedicated_oob_management_network_present
    input.management_interfaces_exposed_on_data_vlan == true
}

management_plane_zone_colocation[_management_plane_zone_colocation_def] if {
    not input.dedicated_oob_management_network_present
    not input.acl_restricts_mgmt_access_to_admin_hosts_only
}

management_plane_zone_colocation[_management_plane_zone_colocation_def] if {
    input.management_interfaces_exposed_on_data_vlan == true
    not input.acl_restricts_mgmt_access_to_admin_hosts_only
}

exposures contains _management_plane_zone_colocation_def if {
    count(management_plane_zone_colocation) > 0
}

_shared_credential_propagation_across_zones_def := {
    "name": "Shared Credential Propagation Across Zones",
    "description": "Service accounts or domain credentials used to authenticate NAS shares are shared across multiple trust zones, such that a credential valid in a lower-trust zone is also honored in higher-trust zones. The zone boundary does not enforce credential scope isolation, enabling stolen credentials to traverse zone demarcations without re-validation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

shared_credential_propagation_across_zones[_shared_credential_propagation_across_zones_def] if {
    not input.credential_scope_isolation_enforced
    count(input.shared_credential_zones) > 1
}

shared_credential_propagation_across_zones[_shared_credential_propagation_across_zones_def] if {
    input.nas_zone_boundary_revalidation == "none"
    count(input.shared_credential_zones) > 1
}

shared_credential_propagation_across_zones[_shared_credential_propagation_across_zones_def] if {
    input.nas_zone_boundary_revalidation == "partial"
    not input.credential_scope_isolation_enforced
    count(input.shared_credential_zones) > 1
}

exposures contains _shared_credential_propagation_across_zones_def if {
    count(shared_credential_propagation_across_zones) > 0
}

_egress_unfiltered_storage_replication_channels_def := {
    "name": "Egress Unfiltered Storage Replication Channels",
    "description": "NAS replication and backup channels (rsync, NDMP, snapshot replication) traverse zone boundaries without egress filtering or destination zone validation, creating covert exfiltration paths. Replication traffic is often excluded from DLP or egress inspection policies due to its high volume and trusted-service classification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

egress_unfiltered_storage_replication_channels[_egress_unfiltered_storage_replication_channels_def] if {
    not input.replication_egress_filtering_enabled
}

egress_unfiltered_storage_replication_channels[_egress_unfiltered_storage_replication_channels_def] if {
    not input.replication_destination_zone_validation
}

egress_unfiltered_storage_replication_channels[_egress_unfiltered_storage_replication_channels_def] if {
    input.replication_traffic_dlp_exempted == true
}

exposures contains _egress_unfiltered_storage_replication_channels_def if {
    count(egress_unfiltered_storage_replication_channels) > 0
}

_smb_relay_path_across_zone_boundary_def := {
    "name": "Smb Relay Path Across Zone Boundary",
    "description": "SMB authentication challenges can be relayed through the NAS system across trust zone boundaries when the boundary does not enforce SMB signing requirements or block NTLM relay-capable traffic at the ingress filter. The NAS acts as an inadvertent relay point bridging zone authentication contexts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

smb_relay_path_across_zone_boundary[_smb_relay_path_across_zone_boundary_def] if {
    not input.smb_signing_enforced
    input.cross_zone_authentication_scope == "multi_zone"
}

smb_relay_path_across_zone_boundary[_smb_relay_path_across_zone_boundary_def] if {
    not input.ntlm_traffic_blocked_at_boundary
    input.cross_zone_authentication_scope == "multi_zone"
}

exposures contains _smb_relay_path_across_zone_boundary_def if {
    count(smb_relay_path_across_zone_boundary) > 0
}

_iscsi_initiator_zone_enforcement_gap_def := {
    "name": "Iscsi Initiator Zone Enforcement Gap",
    "description": "iSCSI target exposure is not restricted to initiator IQNs from authorized zones, and CHAP authentication is either absent or uses weak shared secrets that are not rotated per zone. The storage fabric boundary does not enforce LUN masking aligned to trust zone membership, allowing unauthorized initiators to present valid discovery requests.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

iscsi_initiator_zone_enforcement_gap[_iscsi_initiator_zone_enforcement_gap_def] if {
    input.iscsi_initiator_acl_enforcement == "none"
}

iscsi_initiator_zone_enforcement_gap[_iscsi_initiator_zone_enforcement_gap_def] if {
    input.iscsi_initiator_acl_enforcement == "partial"
    input.chap_authentication_state == "absent"
}

iscsi_initiator_zone_enforcement_gap[_iscsi_initiator_zone_enforcement_gap_def] if {
    input.iscsi_initiator_acl_enforcement == "partial"
    input.chap_authentication_state == "weak_or_static"
}

iscsi_initiator_zone_enforcement_gap[_iscsi_initiator_zone_enforcement_gap_def] if {
    not input.lun_masking_zone_aligned
    input.iscsi_initiator_acl_enforcement != "enforced"
}

exposures contains _iscsi_initiator_zone_enforcement_gap_def if {
    count(iscsi_initiator_zone_enforcement_gap) > 0
}

_insufficient_east_west_monitoring_on_storage_vlan_def := {
    "name": "Insufficient East West Monitoring On Storage Vlan",
    "description": "Traffic between storage clients and NAS systems within the same VLAN or storage zone is not inspected by boundary monitoring controls, creating blind spots for lateral movement. The absence of intra-zone flow logging or anomaly detection means that unauthorized storage access patterns between peers within the zone go undetected at the boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insufficient_east_west_monitoring_on_storage_vlan[_insufficient_east_west_monitoring_on_storage_vlan_def] if {
    not input.intra_zone_flow_logging_enabled
}

insufficient_east_west_monitoring_on_storage_vlan[_insufficient_east_west_monitoring_on_storage_vlan_def] if {
    not input.anomaly_detection_applied_to_storage_zone
}

exposures contains _insufficient_east_west_monitoring_on_storage_vlan_def if {
    count(insufficient_east_west_monitoring_on_storage_vlan) > 0
}

_guest_or_anonymous_share_exposure_at_zone_edge_def := {
    "name": "Guest Or Anonymous Share Exposure At Zone Edge",
    "description": "NAS exports permit guest or anonymous access that is reachable from adjacent or untrusted zones due to missing ingress controls at the zone boundary. Even if host-level share permissions are intended to be restrictive, the zone boundary does not block unauthenticated storage protocol connections from traversing into the storage zone.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

guest_or_anonymous_share_exposure_at_zone_edge[_guest_or_anonymous_share_exposure_at_zone_edge_def] if {
    input.anonymous_or_guest_access_enabled == true
    not input.zone_boundary_ingress_filter_blocks_storage_protocols
    input.reachable_from_untrusted_or_adjacent_zone == true
}

exposures contains _guest_or_anonymous_share_exposure_at_zone_edge_def if {
    count(guest_or_anonymous_share_exposure_at_zone_edge) > 0
}
