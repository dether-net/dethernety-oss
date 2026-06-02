package _dt_built_in.exposures.management_monitoring_plane



_admin_credential_theft_def := {
    "name": "Admin credential theft and session-token replay",
    "description": "Phishing/infostealer/AiTM replay of admin credential or session token.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

admin_credential_theft[_admin_credential_theft_def] if {
    not input.mfa_enforced_at_boundary_crossing
}

admin_credential_theft[_admin_credential_theft_def] if {
    not input.session_binding_or_short_session_lifetime
}

exposures contains _admin_credential_theft_def if {
    count(admin_credential_theft) > 0
}

_cloud_iam_over_permission_def := {
    "name": "Cloud IAM over-permission abuse",
    "description": "Wildcard actions, over-broad roles, long-lived service-principal keys enable tenant-wide pivot.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cloud_iam_over_permission[_cloud_iam_over_permission_def] if {
    not input.no_standing_admin_privileges_jit_required
}

cloud_iam_over_permission[_cloud_iam_over_permission_def] if {
    not input.least_privilege_access_enforced
}

exposures contains _cloud_iam_over_permission_def if {
    count(cloud_iam_over_permission) > 0
}

_cicd_pipeline_compromise_def := {
    "name": "CI/CD pipeline compromise (trusted-relationship abuse)",
    "description": "Poisoned pipeline / leaked deploy key mints deploy straight into workload plane.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cicd_pipeline_compromise[_cicd_pipeline_compromise_def] if {
    not input.cicd_pipeline_identity_per_environment_no_long_lived_keys
}

cicd_pipeline_compromise[_cicd_pipeline_compromise_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
}

exposures contains _cicd_pipeline_compromise_def if {
    count(cicd_pipeline_compromise) > 0
}

_artifact_supply_chain_def := {
    "name": "Artifact supply-chain compromise",
    "description": "Unsigned/unverified images and packages substitute backdoored binary.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

artifact_supply_chain[_artifact_supply_chain_def] if {
    not input.artifact_supply_chain_signed_provenance_verified
}

exposures contains _artifact_supply_chain_def if {
    count(artifact_supply_chain) > 0
}

_direct_admin_protocol_exposure_def := {
    "name": "Direct admin-protocol exposure",
    "description": "Control-plane admin protocols reachable directly bypassing PAM/bastion.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

direct_admin_protocol_exposure[_direct_admin_protocol_exposure_def] if {
    not input.control_plane_access_mediated_by_pam_with_recording
}

direct_admin_protocol_exposure[_direct_admin_protocol_exposure_def] if {
    not input.control_plane_api_not_publicly_exposed
}

exposures contains _direct_admin_protocol_exposure_def if {
    count(direct_admin_protocol_exposure) > 0
}

_telemetry_tampering_def := {
    "name": "Telemetry tampering and log silencing",
    "description": "Compromised workload or insider disables forwarder, deletes source-side logs, alters audit policy.",
    "type": "EXPOSURE",
    "category": "LOCAL",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

telemetry_tampering[_telemetry_tampering_def] if {
    not input.telemetry_pipeline_isolated_from_workload
}

telemetry_tampering[_telemetry_tampering_def] if {
    not input.audit_log_tamper_evident
}

exposures contains _telemetry_tampering_def if {
    count(telemetry_tampering) > 0
}

_mgmt_plane_bridging_def := {
    "name": "Management-plane network boundary bridging",
    "description": "Misconfigured peering / flat VPN / over-broad SGs / bastion misconfig creates L3 path from less-trusted into mgmt plane.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

mgmt_plane_bridging[_mgmt_plane_bridging_def] if {
    not input.management_plane_isolated_from_data_plane
}

exposures contains _mgmt_plane_bridging_def if {
    count(mgmt_plane_bridging) > 0
}

_admin_endpoint_compromise_def := {
    "name": "Admin endpoint compromise via productivity device",
    "description": "Admin reads email / browses on same device used for control-plane work; endpoint compromise becomes control-plane compromise.",
    "type": "EXPOSURE",
    "category": "LOCAL",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

admin_endpoint_compromise[_admin_endpoint_compromise_def] if {
    not input.paw_required_for_control_plane_access
}

admin_endpoint_compromise[_admin_endpoint_compromise_def] if {
    not input.admin_endpoint_health_attested_at_elevation
}

exposures contains _admin_endpoint_compromise_def if {
    count(admin_endpoint_compromise) > 0
}
