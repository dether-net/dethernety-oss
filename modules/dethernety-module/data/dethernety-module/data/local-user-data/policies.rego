package _dt_built_in.exposures.local_user_data



_unclassified_sensitive_local_data_def := {
    "name": "Unclassified Sensitive Local Data",
    "description": "Users create and store files containing sensitive information (PII, financial, health, or confidential business data) without applying required classification labels. Absence of classification prevents downstream handling controls such as DLP, encryption enforcement, or retention policies from triggering correctly.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

unclassified_sensitive_local_data[_unclassified_sensitive_local_data_def] if {
    not input.classification_tool_enforced
    input.sensitive_content_detected_without_label == true
}

unclassified_sensitive_local_data[_unclassified_sensitive_local_data_def] if {
    input.dlp_policy_scope in ["none", "partial"]
    input.sensitive_content_detected_without_label == true
}

exposures contains _unclassified_sensitive_local_data_def if {
    count(unclassified_sensitive_local_data) > 0
}

_unencrypted_sensitive_files_at_rest_def := {
    "name": "Unencrypted Sensitive Files At Rest",
    "description": "Sensitive data files stored locally on workstations are not encrypted at the file or folder level. Even where full-disk encryption exists, files may be accessible in cleartext to any authenticated local session or via OS-level access after decryption, and are exposed when files are copied or exfiltrated.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

unencrypted_sensitive_files_at_rest[_unencrypted_sensitive_files_at_rest_def] if {
    input.sensitive_data_present_on_workstation == true
    not input.file_level_encryption_enforced
}

unencrypted_sensitive_files_at_rest[_unencrypted_sensitive_files_at_rest_def] if {
    input.sensitive_data_present_on_workstation == true
    not input.removable_media_encryption_enforced
}

exposures contains _unencrypted_sensitive_files_at_rest_def if {
    count(unencrypted_sensitive_files_at_rest) > 0
}

_retention_policy_non_compliance_local_storage_def := {
    "name": "Retention Policy Non Compliance Local Storage",
    "description": "Data retained locally on workstations exceeds defined retention periods or is retained without any scheduled review or deletion. Regulatory frameworks (GDPR, HIPAA, PCI-DSS) impose maximum retention limits; locally stored data is frequently excluded from centralized retention enforcement, creating compliance violations.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

retention_policy_non_compliance_local_storage[_retention_policy_non_compliance_local_storage_def] if {
    not input.centralized_retention_enforcement_enabled
    not input.local_retention_period_days
}

retention_policy_non_compliance_local_storage[_retention_policy_non_compliance_local_storage_def] if {
    not input.centralized_retention_enforcement_enabled
    not input.scheduled_local_data_review_exists
}

retention_policy_non_compliance_local_storage[_retention_policy_non_compliance_local_storage_def] if {
    input.local_retention_period_days
    not input.centralized_retention_enforcement_enabled
    not input.scheduled_local_data_review_exists
}

exposures contains _retention_policy_non_compliance_local_storage_def if {
    count(retention_policy_non_compliance_local_storage) > 0
}

_inadequate_data_disposal_on_device_reuse_def := {
    "name": "Inadequate Data Disposal On Device Reuse",
    "description": "When workstations are repurposed, reassigned, or decommissioned, locally stored sensitive data is not securely wiped using data-sanitization standards (e.g., NIST 800-88). Standard OS deletion or reformatting leaves data recoverable, enabling data remnant exposure to subsequent users or external parties who acquire the device.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

inadequate_data_disposal_on_device_reuse[_inadequate_data_disposal_on_device_reuse_def] if {
    input.workstation_lifecycle_event in ["repurposed", "reassigned", "decommissioned"]
    input.sensitive_data_present_on_workstation == true
    input.data_sanitization_standard_applied in ["os_delete_or_format", "none"]
}

inadequate_data_disposal_on_device_reuse[_inadequate_data_disposal_on_device_reuse_def] if {
    input.workstation_lifecycle_event in ["repurposed", "reassigned", "decommissioned"]
    input.sensitive_data_present_on_workstation == true
    not input.data_sanitization_standard_applied
}

exposures contains _inadequate_data_disposal_on_device_reuse_def if {
    count(inadequate_data_disposal_on_device_reuse) > 0
}

_sensitive_data_in_temporary_and_cache_files_def := {
    "name": "Sensitive Data In Temporary And Cache Files",
    "description": "Applications generate temporary files, browser caches, print spools, clipboard history, and crash dumps that may contain sensitive data. These artifacts are rarely covered by classification or retention policies applied to primary documents, creating uncontrolled secondary data stores with indefinite retention.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

sensitive_data_in_temporary_and_cache_files[_sensitive_data_in_temporary_and_cache_files_def] if {
    not input.temp_cache_cleanup_policy_enforced
    not input.file_level_encryption_enforced
}

sensitive_data_in_temporary_and_cache_files[_sensitive_data_in_temporary_and_cache_files_def] if {
    not input.crash_dump_sensitive_data_scrubbing_enabled
    not input.file_level_encryption_enforced
}

sensitive_data_in_temporary_and_cache_files[_sensitive_data_in_temporary_and_cache_files_def] if {
    not input.temp_cache_cleanup_policy_enforced
    not input.crash_dump_sensitive_data_scrubbing_enabled
}

exposures contains _sensitive_data_in_temporary_and_cache_files_def if {
    count(sensitive_data_in_temporary_and_cache_files) > 0
}

_cross_border_transfer_via_local_sync_tools_def := {
    "name": "Cross Border Transfer Via Local Sync Tools",
    "description": "Data stored locally may be automatically synchronized to personal or commercial cloud storage, personal devices, or external drives, triggering cross-border data transfer obligations without legal basis assessment, data transfer agreements, or user awareness. This circumvents organizational transfer controls applied at the network boundary.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

cross_border_transfer_via_local_sync_tools[_cross_border_transfer_via_local_sync_tools_def] if {
    input.sync_tool_installation_status == "installed_unmanaged"
    input.sync_scope_includes_sensitive_paths == true
    not input.data_transfer_agreement_in_place
}

cross_border_transfer_via_local_sync_tools[_cross_border_transfer_via_local_sync_tools_def] if {
    input.sync_tool_installation_status == "installed_managed"
    input.sync_scope_includes_sensitive_paths == true
    not input.data_transfer_agreement_in_place
    not input.dlp_policy_scope
}

cross_border_transfer_via_local_sync_tools[_cross_border_transfer_via_local_sync_tools_def] if {
    input.sync_tool_installation_status == "installed_unmanaged"
    input.sync_scope_includes_sensitive_paths == true
    not input.dlp_policy_scope
}

exposures contains _cross_border_transfer_via_local_sync_tools_def if {
    count(cross_border_transfer_via_local_sync_tools) > 0
}

_absence_of_masking_for_locally_copied_production_data_def := {
    "name": "Absence Of Masking For Locally Copied Production Data",
    "description": "Users copy subsets of production data (customer records, transaction logs, test datasets) to local workstations for analysis or troubleshooting without applying anonymization or masking. This creates unmasked sensitive data outside controlled production environments, violating data minimization principles and expanding the exposure surface.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

absence_of_masking_for_locally_copied_production_data[_absence_of_masking_for_locally_copied_production_data_def] if {
    input.production_data_copied_to_local_workstation == true
    not input.data_masking_applied_before_local_copy
    count(input.sensitive_data_classifications_present) > 0
}

exposures contains _absence_of_masking_for_locally_copied_production_data_def if {
    count(absence_of_masking_for_locally_copied_production_data) > 0
}
