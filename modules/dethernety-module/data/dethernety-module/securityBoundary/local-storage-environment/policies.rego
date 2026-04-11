package _dt_built_in.exposures.local_storage_environment

_ingress_filter_bypass_via_trusted_channel_def := {
    "name": "Ingress Filter Bypass Via Trusted Channel",
    "description": "Ingress filtering rules are applied inconsistently on channels designated as 'trusted' (e.g., management interfaces, backup agents), allowing external data to enter the local storage zone without inspection, bypassing boundary enforcement entirely.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

ingress_filter_bypass_via_trusted_channel[_ingress_filter_bypass_via_trusted_channel_def] if {
    not input.trusted_channel_ingress_filtering_enabled
    count(input.trusted_channel_types_defined) > 0
}

ingress_filter_bypass_via_trusted_channel[_ingress_filter_bypass_via_trusted_channel_def] if {
    input.trusted_channel_bypass_scope == "all"
}

ingress_filter_bypass_via_trusted_channel[_ingress_filter_bypass_via_trusted_channel_def] if {
    input.trusted_channel_bypass_scope == "partial"
}

ingress_filter_bypass_via_trusted_channel[_ingress_filter_bypass_via_trusted_channel_def] if {
    not input.trusted_channel_ingress_filtering_enabled
    count(input.trusted_channel_types_defined) > 0
}

exposures contains _ingress_filter_bypass_via_trusted_channel_def if {
    count(ingress_filter_bypass_via_trusted_channel) > 0
}

_egress_path_enumeration_through_unmonitored_port_def := {
    "name": "Egress Path Enumeration Through Unmonitored Port",
    "description": "Egress filtering gaps on secondary or legacy communication paths allow data to leave the local storage zone without triggering alerts or enforced controls, exposing sensitive zone contents to exfiltration.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

egress_path_enumeration_through_unmonitored_port[_egress_path_enumeration_through_unmonitored_port_def] if {
    input.unmonitored_egress_ports_present == true
    input.egress_filter_enforcement_mode in ["monitor_only", "none"]
}

egress_path_enumeration_through_unmonitored_port[_egress_path_enumeration_through_unmonitored_port_def] if {
    count(input.legacy_ports_in_use) > 0
    input.egress_filter_enforcement_mode == "none"
}

egress_path_enumeration_through_unmonitored_port[_egress_path_enumeration_through_unmonitored_port_def] if {
    count(input.legacy_ports_in_use) > 0
    input.unmonitored_egress_ports_present == true
}

exposures contains _egress_path_enumeration_through_unmonitored_port_def if {
    count(egress_path_enumeration_through_unmonitored_port) > 0
}

_subzone_segmentation_absence_def := {
    "name": "Subzone Segmentation Absence",
    "description": "Within the local storage zone, no internal segmentation exists between subzones of differing sensitivity (e.g., temporary staging versus long-term sensitive storage), allowing any process with boundary access to traverse all internal subzones freely.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

subzone_segmentation_absence[_subzone_segmentation_absence_def] if {
    not input.internal_subzone_acl_enforced
}

subzone_segmentation_absence[_subzone_segmentation_absence_def] if {
    input.subzone_isolation_mechanism == "none"
}

subzone_segmentation_absence[_subzone_segmentation_absence_def] if {
    input.subzone_isolation_mechanism == "logical"
    not input.cross_subzone_traversal_logged
}

exposures contains _subzone_segmentation_absence_def if {
    count(subzone_segmentation_absence) > 0
}

_trust_propagation_via_inherited_session_context_def := {
    "name": "Trust Propagation Via Inherited Session Context",
    "description": "Processes that cross the zone boundary carry session tokens or trust attributes from the external zone into the local storage zone, effectively elevating the trust level of external-origin activity without re-evaluation at the boundary.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

trust_propagation_via_inherited_session_context[_trust_propagation_via_inherited_session_context_def] if {
    not input.session_token_revalidation_at_boundary
    input.cross_zone_trust_inheritance_allowed == true
}

trust_propagation_via_inherited_session_context[_trust_propagation_via_inherited_session_context_def] if {
    not input.session_token_revalidation_at_boundary
    input.boundary_ingress_monitoring_coverage == "none"
}

trust_propagation_via_inherited_session_context[_trust_propagation_via_inherited_session_context_def] if {
    input.cross_zone_trust_inheritance_allowed == true
    input.boundary_ingress_monitoring_coverage in ["none", "partial"]
}

exposures contains _trust_propagation_via_inherited_session_context_def if {
    count(trust_propagation_via_inherited_session_context) > 0
}

_credential_exposure_at_boundary_transition_def := {
    "name": "Credential Exposure At Boundary Transition",
    "description": "Credentials used to authenticate across zone boundaries are not isolated per-zone; a credential valid in the external zone also authenticates within the local storage zone, eliminating the trust boundary's enforcement value.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

credential_exposure_at_boundary_transition[_credential_exposure_at_boundary_transition_def] if {
    not input.credential_scope_isolation_enforced
}

credential_exposure_at_boundary_transition[_credential_exposure_at_boundary_transition_def] if {
    input.shared_credential_store_across_zones == true
    input.zone_boundary_credential_reuse_detected == true
}

exposures contains _credential_exposure_at_boundary_transition_def if {
    count(credential_exposure_at_boundary_transition) > 0
}

_boundary_monitoring_blind_spot_at_protocol_layer_transition_def := {
    "name": "Boundary Monitoring Blind Spot At Protocol Layer Transition",
    "description": "Monitoring coverage does not extend to protocol-layer transitions (e.g., where network-layer traffic is translated to file-system or inter-process communication), creating a detection gap at the actual zone crossing point.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

boundary_monitoring_blind_spot_at_protocol_layer_transition[_boundary_monitoring_blind_spot_at_protocol_layer_transition_def] if {
    not input.protocol_translation_points_monitored
}

boundary_monitoring_blind_spot_at_protocol_layer_transition[_boundary_monitoring_blind_spot_at_protocol_layer_transition_def] if {
    input.zone_crossing_alert_coverage == "none"
}

boundary_monitoring_blind_spot_at_protocol_layer_transition[_boundary_monitoring_blind_spot_at_protocol_layer_transition_def] if {
    input.zone_crossing_alert_coverage == "partial"
    not input.protocol_translation_points_monitored
}

exposures contains _boundary_monitoring_blind_spot_at_protocol_layer_transition_def if {
    count(boundary_monitoring_blind_spot_at_protocol_layer_transition) > 0
}

_lateral_movement_via_shared_boundary_interface_def := {
    "name": "Lateral Movement Via Shared Boundary Interface",
    "description": "A shared interface or API exposed at the boundary is accessible by multiple external entities without per-entity segmentation, allowing a compromised external entity to use the shared pathway to reach other internal zones or storage segments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

lateral_movement_via_shared_boundary_interface[_lateral_movement_via_shared_boundary_interface_def] if {
    not input.shared_api_per_entity_segmentation
    input.internal_zone_reachable_from_shared_interface == true
}

lateral_movement_via_shared_boundary_interface[_lateral_movement_via_shared_boundary_interface_def] if {
    input.boundary_interface_access_control_model in ["none", "shared_credential"]
    input.internal_zone_reachable_from_shared_interface == true
}

exposures contains _lateral_movement_via_shared_boundary_interface_def if {
    count(lateral_movement_via_shared_boundary_interface) > 0
}

_insufficient_egress_rate_limiting_enabling_staged_exfiltration_def := {
    "name": "Insufficient Egress Rate Limiting Enabling Staged Exfiltration",
    "description": "No rate limiting or volume thresholds are enforced on egress at the storage zone boundary, enabling an attacker to slowly exfiltrate data at levels that avoid anomaly detection triggers while remaining within normal operational patterns.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insufficient_egress_rate_limiting_enabling_staged_exfiltration[_insufficient_egress_rate_limiting_enabling_staged_exfiltration_def] if {
    not input.egress_rate_limiting_enabled
    not input.egress_volume_threshold_configured
}

insufficient_egress_rate_limiting_enabling_staged_exfiltration[_insufficient_egress_rate_limiting_enabling_staged_exfiltration_def] if {
    not input.egress_rate_limiting_enabled
    not input.egress_anomaly_detection_enabled
}

insufficient_egress_rate_limiting_enabling_staged_exfiltration[_insufficient_egress_rate_limiting_enabling_staged_exfiltration_def] if {
    not input.egress_volume_threshold_configured
    not input.egress_anomaly_detection_enabled
}

exposures contains _insufficient_egress_rate_limiting_enabling_staged_exfiltration_def if {
    count(insufficient_egress_rate_limiting_enabling_staged_exfiltration) > 0
}

_zone_boundary_definition_drift_def := {
    "name": "Zone Boundary Definition Drift",
    "description": "The logical boundary of the local storage zone is not statically defined or regularly audited; gradual expansion of what is considered 'inside' the zone (e.g., new mounts or attached paths) introduces uncontrolled ingress/egress points that lack the original boundary controls.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

zone_boundary_definition_drift[_zone_boundary_definition_drift_def] if {
    not input.storage_boundary_audit_enabled
    input.unapproved_mount_count > 0
}

zone_boundary_definition_drift[_zone_boundary_definition_drift_def] if {
    input.unapproved_mount_count > 0
    not input.boundary_controls_applied_to_new_mounts
}

zone_boundary_definition_drift[_zone_boundary_definition_drift_def] if {
    not input.storage_boundary_audit_enabled
    not input.boundary_controls_applied_to_new_mounts
}

exposures contains _zone_boundary_definition_drift_def if {
    count(zone_boundary_definition_drift) > 0
}

_boundary_control_bypass_via_physical_interface_def := {
    "name": "Boundary Control Bypass Via Physical Interface",
    "description": "Physical access interfaces (e.g., direct-attached storage ports, removable media interfaces) bypass the logical ingress/egress enforcement layer entirely, providing a path into the local storage zone that circumvents network-enforced boundary controls.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

boundary_control_bypass_via_physical_interface[_boundary_control_bypass_via_physical_interface_def] if {
    not input.physical_port_access_controls_enabled
}

boundary_control_bypass_via_physical_interface[_boundary_control_bypass_via_physical_interface_def] if {
    input.removable_media_mount_policy == "allow_all"
}

boundary_control_bypass_via_physical_interface[_boundary_control_bypass_via_physical_interface_def] if {
    input.removable_media_mount_policy == "require_authorization"
    not input.physical_interface_activity_logged
}

exposures contains _boundary_control_bypass_via_physical_interface_def if {
    count(boundary_control_bypass_via_physical_interface) > 0
}
