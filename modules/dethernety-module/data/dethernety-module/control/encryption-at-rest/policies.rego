package _dt_built_in.countermeasures.encryption_at_rest

_cipher_algorithm_strength_def := {
    "name": "Cipher Algorithm Strength",
    "description": "Provides cryptographic strength guarantees through the selection and enforcement of approved encryption algorithms (e.g., AES-256), determining the mathematical resistance of encrypted data to brute-force and cryptanalytic attacks.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

cipher_algorithm_strength[_cipher_algorithm_strength_def] if {
    input.encryption_algorithm in ["AES-256", "ChaCha20-256"]
    input.key_length_bits >= 256
    input.encryption_algorithm in ["XTS", "GCM", "CBC", "CTR"]
}

cipher_algorithm_strength[_cipher_algorithm_strength_def] if {
    input.encryption_algorithm == "AES-128"
    input.key_length_bits >= 128
    input.encryption_algorithm in ["XTS", "GCM", "CBC", "CTR"]
}

countermeasures contains _cipher_algorithm_strength_def if {
    count(cipher_algorithm_strength) > 0
}

_full_volume_coverage_def := {
    "name": "Full Volume Coverage",
    "description": "Provides assurance that all data on a storage volume is encrypted, including temporary files, swap space, and hibernation files, eliminating unencrypted data remnants that could be extracted from partial-coverage configurations.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

full_volume_coverage[_full_volume_coverage_def] if {
    input.encryption_coverage_scope == "partial"
}

full_volume_coverage[_full_volume_coverage_def] if {
    input.encryption_coverage_scope == "none"
}

full_volume_coverage[_full_volume_coverage_def] if {
    input.encryption_coverage_scope == "full"
    input.swap_space_encrypted == false
}

full_volume_coverage[_full_volume_coverage_def] if {
    input.encryption_coverage_scope == "full"
    input.hibernation_file_encrypted == false
}

full_volume_coverage[_full_volume_coverage_def] if {
    count(input.unencrypted_remnant_partitions) > 0
}

countermeasures contains _full_volume_coverage_def if {
    count(full_volume_coverage) > 0
}

_key_management_integrity_def := {
    "name": "Key Management Integrity",
    "description": "Provides secure generation, storage, rotation, and revocation of encryption keys through dedicated key management systems or hardware security modules, ensuring that key material is not co-located with encrypted data.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

key_management_integrity[_key_management_integrity_def] if {
    input.key_management_system_type in ["none", "manual"]
}

key_management_integrity[_key_management_integrity_def] if {
    input.key_management_system_type == "software_only"
    input.keys_colocated_with_data == true
}

key_management_integrity[_key_management_integrity_def] if {
    input.keys_colocated_with_data == true
    not input.key_management_system_type in ["hsm", "cloud_kms", "dedicated_kms"]
}

key_management_integrity[_key_management_integrity_def] if {
    input.key_management_system_type in ["hsm", "cloud_kms", "dedicated_kms"]
    input.key_rotation_enabled == false
}

key_management_integrity[_key_management_integrity_def] if {
    input.key_management_system_type in ["hsm", "cloud_kms", "dedicated_kms"]
    input.key_revocation_capability == false
}

countermeasures contains _key_management_integrity_def if {
    count(key_management_integrity) > 0
}

_data_at_rest_access_prevention_def := {
    "name": "Data At Rest Access Prevention",
    "description": "Provides prevention of raw data readability when storage media is accessed outside the authorized operating environment, such as during physical theft, media removal, or unauthorized disk mounting.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

data_at_rest_access_prevention[_data_at_rest_access_prevention_def] if {
    input.encryption_at_rest_enabled == true
    input.encryption_algorithm in ["AES-256", "AES-128"]
    input.key_management_system_type in ["CUSTOMER_MANAGED_KMS", "PROVIDER_MANAGED"]
    input.encryption_coverage_scope == true
}

countermeasures contains _data_at_rest_access_prevention_def if {
    count(data_at_rest_access_prevention) > 0
}

_decommissioning_data_sanitization_def := {
    "name": "Decommissioning Data Sanitization",
    "description": "Provides cryptographic erasure capability allowing secure decommissioning of storage media by destroying encryption keys, rendering previously encrypted data unrecoverable without requiring physical destruction of media.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

decommissioning_data_sanitization[_decommissioning_data_sanitization_def] if {
    input.encryption_at_rest_enabled == true
    input.cryptographic_erasure_supported == true
    input.key_management_policy == "centralized_kms"
}

countermeasures contains _decommissioning_data_sanitization_def if {
    count(decommissioning_data_sanitization) > 0
}

_encryption_status_auditability_def := {
    "name": "Encryption Status Auditability",
    "description": "Provides operational visibility into which volumes, disks, or file systems are encrypted versus unencrypted, enabling compliance verification and detection of coverage gaps through monitoring and audit tooling.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

encryption_status_auditability[_encryption_status_auditability_def] if {
    input.encryption_audit_tooling_enabled == true
    input.encryption_coverage_visibility_scope == "full"
    input.unencrypted_volumes_detected == false
}

countermeasures contains _encryption_status_auditability_def if {
    count(encryption_status_auditability) > 0
}

_transparent_application_integration_def := {
    "name": "Transparent Application Integration",
    "description": "Provides seamless encryption and decryption operations below the application layer, ensuring that authorized applications and processes experience no functional disruption while unauthorized raw access yields ciphertext.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

transparent_application_integration[_transparent_application_integration_def] if {
    input.encryption_at_rest_enabled == true
    input.encryption_algorithm in ["AES-256-XTS", "AES-256-CBC", "AES-128-XTS", "AES-128-CBC"]
    input.key_management_system_type in ["dedicated_kms", "hsm"]
}

countermeasures contains _transparent_application_integration_def if {
    count(transparent_application_integration) > 0
}

_hardware_security_module_binding_def := {
    "name": "Hardware Security Module Binding",
    "description": "Provides hardware-rooted key protection by binding encryption keys to trusted platform modules (TPM) or HSMs, ensuring keys cannot be extracted from the host system even by privileged software actors.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

hardware_security_module_binding[_hardware_security_module_binding_def] if {
    input.hsm_tpm_binding_enabled == true
    input.hardware_binding_type in ["tpm", "dedicated_hsm", "cloud_hsm", "managed_kms_hsm"]
    input.key_extraction_protection_verified == true
}

countermeasures contains _hardware_security_module_binding_def if {
    count(hardware_security_module_binding) > 0
}

_encryption_policy_enforcement_def := {
    "name": "Encryption Policy Enforcement",
    "description": "Provides centralized enforcement of encryption configuration standards across managed endpoints or storage systems, preventing deployment of unencrypted storage through policy controls and automated compliance checks.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

encryption_policy_enforcement[_encryption_policy_enforcement_def] if {
    input.encryption_policy_enabled == true
    input.policy_compliance_status == "compliant"
    input.enforcement_scope == "all_volumes"
}

encryption_policy_enforcement[_encryption_policy_enforcement_def] if {
    input.encryption_policy_enabled == true
    input.policy_compliance_status == "compliant"
    input.enforcement_scope == "system_volume_only"
}

countermeasures contains _encryption_policy_enforcement_def if {
    count(encryption_policy_enforcement) > 0
}

_key_rotation_lifecycle_management_def := {
    "name": "Key Rotation Lifecycle Management",
    "description": "Provides periodic re-encryption or key rotation capability to limit the exposure window of any compromised key material, supporting cryptographic hygiene over the long-term data storage lifecycle.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

key_rotation_lifecycle_management[_key_rotation_lifecycle_management_def] if {
    input.key_rotation_enabled == true
    input.rotation_period_days > 0
    input.rotation_period_days <= 365
}

countermeasures contains _key_rotation_lifecycle_management_def if {
    count(key_rotation_lifecycle_management) > 0
}
