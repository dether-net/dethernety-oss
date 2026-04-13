package _dt_built_in.exposures.cloud_storage

_unencrypted_data_at_rest_def := {
    "name": "Unencrypted Data At Rest",
    "description": "Storage volumes or object buckets configured without encryption at rest, exposing raw data to anyone with physical or hypervisor-level access to the underlying media.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.encryption_at_rest_enabled
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    input.encryption_at_rest_enabled == true
    input.encryption_key_type == "none"
}

exposures contains _unencrypted_data_at_rest_def if {
    count(unencrypted_data_at_rest) > 0
}

_weak_or_absent_encryption_in_transit_def := {
    "name": "Weak Or Absent Encryption In Transit",
    "description": "Data transferred to or from the off-site storage host over unencrypted channels or using deprecated TLS versions (e.g., TLS 1.0/1.1), enabling interception and man-in-the-middle attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

weak_or_absent_encryption_in_transit[_weak_or_absent_encryption_in_transit_def] if {
    not input.tls_enabled
}

weak_or_absent_encryption_in_transit[_weak_or_absent_encryption_in_transit_def] if {
    input.tls_enabled == true
    input.minimum_tls_version in ["none", "ssl3", "tls1.0", "tls1.1"]
}

weak_or_absent_encryption_in_transit[_weak_or_absent_encryption_in_transit_def] if {
    input.tls_enabled == true
    not input.certificate_validation_enforced
}

exposures contains _weak_or_absent_encryption_in_transit_def if {
    count(weak_or_absent_encryption_in_transit) > 0
}

_customer_managed_key_mismanagement_def := {
    "name": "Customer Managed Key Mismanagement",
    "description": "Encryption keys stored on the same host as encrypted data, or using provider-managed keys without customer control, undermining encryption guarantees if the storage provider is compromised.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

customer_managed_key_mismanagement[_customer_managed_key_mismanagement_def] if {
    input.key_management_type == "provider_managed"
}

customer_managed_key_mismanagement[_customer_managed_key_mismanagement_def] if {
    input.key_management_type == "co_located_same_host"
}

customer_managed_key_mismanagement[_customer_managed_key_mismanagement_def] if {
    input.key_management_type == "customer_managed_external"
    not input.customer_key_rotation_enabled
}

exposures contains _customer_managed_key_mismanagement_def if {
    count(customer_managed_key_mismanagement) > 0
}

_overly_permissive_access_control_policies_def := {
    "name": "Overly Permissive Access Control Policies",
    "description": "Storage access policies (IAM roles, bucket ACLs, share permissions) granting broader read/write access than required, violating least privilege and increasing blast radius of credential compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

overly_permissive_access_control_policies[_overly_permissive_access_control_policies_def] if {
    input.principal_scope in ["all_authenticated_users", "public_unauthenticated"]
}

overly_permissive_access_control_policies[_overly_permissive_access_control_policies_def] if {
    input.write_permission_granted_to_non_owners == true
}

overly_permissive_access_control_policies[_overly_permissive_access_control_policies_def] if {
    input.wildcard_resource_scope == true
}

exposures contains _overly_permissive_access_control_policies_def if {
    count(overly_permissive_access_control_policies) > 0
}

_publicly_exposed_storage_endpoints_def := {
    "name": "Publicly Exposed Storage Endpoints",
    "description": "Storage buckets, shares, or endpoints configured with public read or write access, allowing unauthenticated access to stored data from the internet.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

publicly_exposed_storage_endpoints[_publicly_exposed_storage_endpoints_def] if {
    input.public_access_level in ["public_read", "public_read_write"]
}

publicly_exposed_storage_endpoints[_publicly_exposed_storage_endpoints_def] if {
    input.public_access_level in ["public_write", "public_read_write"]
}

publicly_exposed_storage_endpoints[_publicly_exposed_storage_endpoints_def] if {
    not input.block_public_access_enabled
    not input.authentication_required
}

exposures contains _publicly_exposed_storage_endpoints_def if {
    count(publicly_exposed_storage_endpoints) > 0
}

_weak_authentication_for_storage_access_def := {
    "name": "Weak Authentication For Storage Access",
    "description": "Storage host or management interface accessible via static long-lived credentials, shared accounts, or without multi-factor authentication enforcement, enabling credential-based unauthorized access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

weak_authentication_for_storage_access[_weak_authentication_for_storage_access_def] if {
    not input.mfa_enforced
}

weak_authentication_for_storage_access[_weak_authentication_for_storage_access_def] if {
    input.credential_type == "static_long_lived_key"
}

weak_authentication_for_storage_access[_weak_authentication_for_storage_access_def] if {
    input.shared_accounts_present == true
}

weak_authentication_for_storage_access[_weak_authentication_for_storage_access_def] if {
    input.credential_type == "shared_account_password"
}

exposures contains _weak_authentication_for_storage_access_def if {
    count(weak_authentication_for_storage_access) > 0
}

_hardcoded_or_plaintext_credentials_in_configuration_def := {
    "name": "Hardcoded Or Plaintext Credentials In Configuration",
    "description": "Access keys, service account passwords, or storage connection strings stored in plaintext configuration files on hosts or in environment variables without secrets management controls.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

hardcoded_or_plaintext_credentials_in_configuration[_hardcoded_or_plaintext_credentials_in_configuration_def] if {
    input.plaintext_credentials_detected == true
    not input.secrets_management_in_use
}

exposures contains _hardcoded_or_plaintext_credentials_in_configuration_def if {
    count(hardcoded_or_plaintext_credentials_in_configuration) > 0
}

_absent_or_insufficient_access_logging_def := {
    "name": "Absent Or Insufficient Access Logging",
    "description": "Storage access logs (read, write, delete, permission changes) not enabled or not forwarded to a centralized log system, preventing detection of unauthorized access or data exfiltration.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absent_or_insufficient_access_logging[_absent_or_insufficient_access_logging_def] if {
    not input.access_logging_enabled
}

absent_or_insufficient_access_logging[_absent_or_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    input.log_forwarding_destination == ""
}

absent_or_insufficient_access_logging[_absent_or_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    input.log_forwarding_destination != ""
    not "delete" in input.logged_event_types
}

absent_or_insufficient_access_logging[_absent_or_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    input.log_forwarding_destination != ""
    not "read" in input.logged_event_types
}

exposures contains _absent_or_insufficient_access_logging_def if {
    count(absent_or_insufficient_access_logging) > 0
}

_unpatched_storage_host_operating_system_or_firmware_def := {
    "name": "Unpatched Storage Host Operating System Or Firmware",
    "description": "The underlying OS or firmware of the storage host running with known unpatched vulnerabilities, enabling local privilege escalation or remote exploitation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unpatched_storage_host_operating_system_or_firmware[_unpatched_storage_host_operating_system_or_firmware_def] if {
    input.patch_compliance_status == "non_compliant"
}

unpatched_storage_host_operating_system_or_firmware[_unpatched_storage_host_operating_system_or_firmware_def] if {
    count(input.critical_cve_identifiers) > 0
}

unpatched_storage_host_operating_system_or_firmware[_unpatched_storage_host_operating_system_or_firmware_def] if {
    input.days_since_last_patch_applied > 90
}

exposures contains _unpatched_storage_host_operating_system_or_firmware_def if {
    count(unpatched_storage_host_operating_system_or_firmware) > 0
}

_missing_data_replication_and_backup_integrity_controls_def := {
    "name": "Missing Data Replication And Backup Integrity Controls",
    "description": "Off-site storage lacking verified encrypted backups or cross-region replication, and without backup integrity validation, resulting in data loss risk and inability to recover from ransomware or accidental deletion.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

missing_data_replication_and_backup_integrity_controls[_missing_data_replication_and_backup_integrity_controls_def] if {
    not input.encrypted_backups_enabled
}

missing_data_replication_and_backup_integrity_controls[_missing_data_replication_and_backup_integrity_controls_def] if {
    not input.cross_region_replication_enabled
}

missing_data_replication_and_backup_integrity_controls[_missing_data_replication_and_backup_integrity_controls_def] if {
    not input.backup_integrity_validation_enabled
}

exposures contains _missing_data_replication_and_backup_integrity_controls_def if {
    count(missing_data_replication_and_backup_integrity_controls) > 0
}

_unrestricted_management_interface_network_exposure_def := {
    "name": "Unrestricted Management Interface Network Exposure",
    "description": "Storage management consoles or administrative APIs accessible from broad network ranges rather than restricted to management VPNs or private network segments, expanding the attack surface for credential attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unrestricted_management_interface_network_exposure[_unrestricted_management_interface_network_exposure_def] if {
    input.management_interface_network_scope == "public_internet"
}

unrestricted_management_interface_network_exposure[_unrestricted_management_interface_network_exposure_def] if {
    input.management_interface_network_scope == "broad_internal"
    not input.management_vpn_or_bastion_required
}

unrestricted_management_interface_network_exposure[_unrestricted_management_interface_network_exposure_def] if {
    input.allowed_management_cidr_count > 5
    not input.management_vpn_or_bastion_required
}

exposures contains _unrestricted_management_interface_network_exposure_def if {
    count(unrestricted_management_interface_network_exposure) > 0
}

_insufficient_privilege_separation_for_storage_roles_def := {
    "name": "Insufficient Privilege Separation For Storage Roles",
    "description": "Storage administrative roles not separated from data access roles, allowing data access accounts to modify permissions, delete objects, or disable logging without additional authorization controls.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

insufficient_privilege_separation_for_storage_roles[_insufficient_privilege_separation_for_storage_roles_def] if {
    not input.admin_and_data_roles_separated
}

insufficient_privilege_separation_for_storage_roles[_insufficient_privilege_separation_for_storage_roles_def] if {
    input.data_access_account_can_modify_permissions == true
}

insufficient_privilege_separation_for_storage_roles[_insufficient_privilege_separation_for_storage_roles_def] if {
    input.data_access_account_can_disable_logging == true
    not input.privileged_action_requires_additional_authz
}

exposures contains _insufficient_privilege_separation_for_storage_roles_def if {
    count(insufficient_privilege_separation_for_storage_roles) > 0
}

_missing_object_versioning_and_delete_protection_def := {
    "name": "Missing Object Versioning And Delete Protection",
    "description": "Storage configured without object versioning or delete protection (e.g., S3 Object Lock), enabling irreversible data destruction through accidental or malicious deletion.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

missing_object_versioning_and_delete_protection[_missing_object_versioning_and_delete_protection_def] if {
    not input.object_versioning_enabled
    not input.object_lock_enabled
}

missing_object_versioning_and_delete_protection[_missing_object_versioning_and_delete_protection_def] if {
    input.object_versioning_enabled == true
    not input.object_lock_enabled
    not input.mfa_delete_enabled
}

exposures contains _missing_object_versioning_and_delete_protection_def if {
    count(missing_object_versioning_and_delete_protection) > 0
}

_cross_tenant_isolation_misconfiguration_def := {
    "name": "Cross Tenant Isolation Misconfiguration",
    "description": "In shared or cloud-hosted storage environments, misconfigured tenant isolation controls allowing one tenant's processes or accounts to access another tenant's storage namespace.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

cross_tenant_isolation_misconfiguration[_cross_tenant_isolation_misconfiguration_def] if {
    not input.namespace_isolation_enforced
}

cross_tenant_isolation_misconfiguration[_cross_tenant_isolation_misconfiguration_def] if {
    input.shared_credential_scope in ["global"]
}

cross_tenant_isolation_misconfiguration[_cross_tenant_isolation_misconfiguration_def] if {
    input.cross_tenant_policy_violations_detected == true
}

cross_tenant_isolation_misconfiguration[_cross_tenant_isolation_misconfiguration_def] if {
    input.shared_credential_scope == "per_service"
    not input.namespace_isolation_enforced
}

exposures contains _cross_tenant_isolation_misconfiguration_def if {
    count(cross_tenant_isolation_misconfiguration) > 0
}

_missing_data_classification_and_retention_policy_enforcement_def := {
    "name": "Missing Data Classification And Retention Policy Enforcement",
    "description": "Storage host lacking enforced retention or lifecycle policies, resulting in sensitive data retained beyond its required period and increasing exposure surface over time.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

missing_data_classification_and_retention_policy_enforcement[_missing_data_classification_and_retention_policy_enforcement_def] if {
    not input.retention_policy_configured
}

missing_data_classification_and_retention_policy_enforcement[_missing_data_classification_and_retention_policy_enforcement_def] if {
    input.retention_policy_configured == true
    not input.data_classification_labels_applied
    input.oldest_unreviewed_data_age_days > 90
}

missing_data_classification_and_retention_policy_enforcement[_missing_data_classification_and_retention_policy_enforcement_def] if {
    not input.data_classification_labels_applied
    input.oldest_unreviewed_data_age_days > 365
}

exposures contains _missing_data_classification_and_retention_policy_enforcement_def if {
    count(missing_data_classification_and_retention_policy_enforcement) > 0
}

_absence_of_integrity_verification_for_stored_objects_def := {
    "name": "Absence Of Integrity Verification For Stored Objects",
    "description": "No checksums, hash validation, or content integrity controls configured on stored objects, preventing detection of silent data corruption or unauthorized content modification.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

absence_of_integrity_verification_for_stored_objects[_absence_of_integrity_verification_for_stored_objects_def] if {
    not input.object_checksum_validation_enabled
    not input.object_versioning_enabled
}

absence_of_integrity_verification_for_stored_objects[_absence_of_integrity_verification_for_stored_objects_def] if {
    input.integrity_monitoring_policy == "none"
    not input.object_checksum_validation_enabled
}

exposures contains _absence_of_integrity_verification_for_stored_objects_def if {
    count(absence_of_integrity_verification_for_stored_objects) > 0
}
