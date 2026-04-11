package _dt_built_in.countermeasures.device_encryption

_encryption_algorithm_strength_def := {
    "name": "Encryption Algorithm Strength",
    "description": "Provides cryptographic protection quality determined by the encryption algorithm and key length used (e.g., AES-256). Stronger algorithms ensure that brute-force or cryptanalytic attacks against ciphertext are computationally infeasible, directly determining the durability of data protection.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

encryption_algorithm_strength[_encryption_algorithm_strength_def] if {
    input.encryption_algorithm in ["DES", "3DES", "RC4", "Blowfish", "none"]
}

encryption_algorithm_strength[_encryption_algorithm_strength_def] if {
    input.encryption_algorithm in ["AES", "ChaCha20", "other"]
    input.encryption_key_length_bits < 256
}

encryption_algorithm_strength[_encryption_algorithm_strength_def] if {
    input.encryption_mode_of_operation in ["ECB"]
}

countermeasures contains _encryption_algorithm_strength_def if {
    count(encryption_algorithm_strength) > 0
}

_pre_boot_authentication_enforcement_def := {
    "name": "Pre Boot Authentication Enforcement",
    "description": "Provides a mandatory authentication gate before the operating system loads, ensuring encrypted volumes cannot be accessed without valid credentials (PIN, passphrase, smart card, or TPM-bound key). Prevents bypass of OS-level controls by booting from external media.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

pre_boot_authentication_enforcement[_pre_boot_authentication_enforcement_def] if {
    input.pre_boot_auth_enabled == true
    input.auth_factor_type in ["pin_passphrase", "smart_card", "tpm_and_pin"]
    input.external_boot_prevented == true
}

countermeasures contains _pre_boot_authentication_enforcement_def if {
    count(pre_boot_authentication_enforcement) > 0
}

_tpm_key_binding_and_integrity_verification_def := {
    "name": "Tpm Key Binding And Integrity Verification",
    "description": "Provides hardware-rooted key storage and platform integrity measurement via TPM, binding decryption keys to a verified boot state. Ensures encryption keys are released only when the device boots into an untampered, expected configuration, preventing cold-boot and offline attacks.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

tpm_key_binding_and_integrity_verification[_tpm_key_binding_and_integrity_verification_def] if {
    input.tpm_present_and_enabled == true
    input.disk_encryption_tpm_key_protector_active == true
    input.secure_boot_enabled == true
}

countermeasures contains _tpm_key_binding_and_integrity_verification_def if {
    count(tpm_key_binding_and_integrity_verification) > 0
}

_encryption_coverage_completeness_def := {
    "name": "Encryption Coverage Completeness",
    "description": "Provides uniform protection across all storage surfaces including OS volumes, swap/hibernate files, temporary files, and removable media. Gaps in coverage scope leave residual data exposed even when primary volumes are encrypted.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

encryption_coverage_completeness[_encryption_coverage_completeness_def] if {
    input.primary_volume_encryption_enabled == true
    input.swap_hibernate_encryption_enabled == true
    input.temp_file_location_on_encrypted_volume == true
    input.removable_media_encryption_policy == "enforced"
}

countermeasures contains _encryption_coverage_completeness_def if {
    count(encryption_coverage_completeness) > 0
}

_centralized_key_management_and_escrow_def := {
    "name": "Centralized Key Management And Escrow",
    "description": "Provides organizational control over encryption keys through enterprise key management or escrow services (e.g., Active Directory, MDM-integrated escrow). Enables authorized recovery of encrypted devices without data loss while preventing unauthorized key retrieval.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

centralized_key_management_and_escrow[_centralized_key_management_and_escrow_def] if {
    input.key_escrow_service_configured == true
    input.key_retrieval_requires_authorization == true
    input.devices_with_escrowed_keys_percent >= 90
}

countermeasures contains _centralized_key_management_and_escrow_def if {
    count(centralized_key_management_and_escrow) > 0
}

_encryption_status_monitoring_and_reporting_def := {
    "name": "Encryption Status Monitoring And Reporting",
    "description": "Provides visibility into per-device encryption compliance state through MDM or endpoint management platforms, enabling detection of unencrypted or partially encrypted devices. Supports audit trails showing when encryption was enabled, modified, or disabled.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

encryption_status_monitoring_and_reporting[_encryption_status_monitoring_and_reporting_def] if {
    input.encryption_enforcement_status == "enabled"
    input.mdm_encryption_reporting_active == true
    input.encryption_coverage_scope in ["full_disk", "volume_level"]
}

encryption_status_monitoring_and_reporting[_encryption_status_monitoring_and_reporting_def] if {
    input.encryption_enforcement_status == "enabled"
    input.mdm_encryption_reporting_active == true
    input.encryption_coverage_scope == "full_disk"
}

countermeasures contains _encryption_status_monitoring_and_reporting_def if {
    count(encryption_status_monitoring_and_reporting) > 0
}

_remote_wipe_and_key_revocation_capability_def := {
    "name": "Remote Wipe And Key Revocation Capability",
    "description": "Provides the ability to remotely invalidate encryption keys or wipe device contents, rendering stored data permanently inaccessible when a device is reported lost, stolen, or decommissioned. Integrates with MDM for automated policy enforcement.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

remote_wipe_and_key_revocation_capability[_remote_wipe_and_key_revocation_capability_def] if {
    input.remote_wipe_enabled == true
    input.mdm_enrollment_coverage == "full"
}

remote_wipe_and_key_revocation_capability[_remote_wipe_and_key_revocation_capability_def] if {
    input.encryption_key_revocation_supported == true
    input.mdm_enrollment_coverage == "full"
}

remote_wipe_and_key_revocation_capability[_remote_wipe_and_key_revocation_capability_def] if {
    input.remote_wipe_enabled == true
    input.wipe_policy_trigger_configured == true
    input.mdm_enrollment_coverage == "partial"
}

remote_wipe_and_key_revocation_capability[_remote_wipe_and_key_revocation_capability_def] if {
    input.remote_wipe_enabled == true
    input.encryption_key_revocation_supported == true
    input.wipe_policy_trigger_configured == true
}

countermeasures contains _remote_wipe_and_key_revocation_capability_def if {
    count(remote_wipe_and_key_revocation_capability) > 0
}

_policy_enforcement_and_drift_prevention_def := {
    "name": "Policy Enforcement And Drift Prevention",
    "description": "Provides automated enforcement of encryption policy through MDM or group policy, preventing users from disabling or circumventing encryption controls. Detects and remediates policy drift where devices fall out of compliant encryption state.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

policy_enforcement_and_drift_prevention[_policy_enforcement_and_drift_prevention_def] if {
    input.mdm_encryption_policy_enforced == true
    input.encryption_compliance_state == "compliant"
    input.drift_remediation_enabled == true
}

countermeasures contains _policy_enforcement_and_drift_prevention_def if {
    count(policy_enforcement_and_drift_prevention) > 0
}

_removable_media_encryption_control_def := {
    "name": "Removable Media Encryption Control",
    "description": "Provides encryption requirements for USB drives and external storage devices, preventing unencrypted data exfiltration through removable media. Enforces that data written to removable devices is encrypted and can only be read on authorized systems.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

removable_media_encryption_control[_removable_media_encryption_control_def] if {
    input.removable_media_encryption_enforced == true
    input.removable_media_encryption_scope in ["all_devices"]
    input.unencrypted_write_blocked == true
}

removable_media_encryption_control[_removable_media_encryption_control_def] if {
    input.removable_media_encryption_enforced == true
    input.removable_media_encryption_scope == "approved_devices_only"
    input.unencrypted_write_blocked == true
    input.read_restriction_to_authorized_systems == true
}

countermeasures contains _removable_media_encryption_control_def if {
    count(removable_media_encryption_control) > 0
}
