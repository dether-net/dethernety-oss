package _dt_built_in.exposures.customer_personal_data



_unencrypted_pii_at_rest_def := {
    "name": "Unencrypted PII at rest",
    "description": "Customer records \u2014 including backups, snapshots, and exports \u2014 are stored without storage- or volume-level encryption, letting anyone who reaches the underlying disk, snapshot, or backup artefact read PII directly. Bypasses the data plane entirely.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213"
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    not input.encrypted_at_rest
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    input.at_rest_encryption_strength in ["none", "weak"]
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    not input.backups_encrypted
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    input.relies_on_disk_encryption_only == true
}

exposures contains _unencrypted_pii_at_rest_def if {
    count(unencrypted_pii_at_rest) > 0
}

_cleartext_or_downgraded_transport_of_pii_def := {
    "name": "Cleartext or downgraded transport of PII",
    "description": "PII traverses the network without TLS, or with a downgradeable/legacy TLS version or weak cipher suite, allowing an on-path adversary to sniff or AiTM customer records as they move between services or to clients.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557"
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_or_downgraded_transport_of_pii[_cleartext_or_downgraded_transport_of_pii_def] if {
    not input.tls_only_transport
}

cleartext_or_downgraded_transport_of_pii[_cleartext_or_downgraded_transport_of_pii_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_or_downgraded_transport_of_pii[_cleartext_or_downgraded_transport_of_pii_def] if {
    not input.hsts_enforced
}

exposures contains _cleartext_or_downgraded_transport_of_pii_def if {
    count(cleartext_or_downgraded_transport_of_pii) > 0
}

_unprotected_sensitive_fields_no_masking_tokenization_def := {
    "name": "Unprotected sensitive fields (no masking/tokenization)",
    "description": "High-sensitivity fields (PAN, SSN, government IDs) are persisted in clear within otherwise encrypted stores, so a single SQL-injection, read-only DB credential leak, or analytics export discloses regulated data verbatim. Field-level controls (tokenisation, FPE, deterministic hashing) absent.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unprotected_sensitive_fields_no_masking_tokenization[_unprotected_sensitive_fields_no_masking_tokenization_def] if {
    not input.sensitive_fields_field_level_protected
}

unprotected_sensitive_fields_no_masking_tokenization[_unprotected_sensitive_fields_no_masking_tokenization_def] if {
    not input.pan_rendered_unreadable
}

unprotected_sensitive_fields_no_masking_tokenization[_unprotected_sensitive_fields_no_masking_tokenization_def] if {
    input.field_level_protection_method == "none"
}

exposures contains _unprotected_sensitive_fields_no_masking_tokenization_def if {
    count(unprotected_sensitive_fields_no_masking_tokenization) > 0
}

_weak_key_management_keys_co_located_unrotated_no_hsm_kms_def := {
    "name": "Weak key management (keys co-located, unrotated, no HSM/KMS)",
    "description": "Data-encryption keys live next to the ciphertext (same host/volume/config file), are never rotated, and are not backed by an HSM or managed KMS \u2014 so compromising the data tier yields the keys, collapsing at-rest encryption to obfuscation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.4,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

weak_key_management_keys_co_located_unrotated_no_hsm_kms[_weak_key_management_keys_co_located_unrotated_no_hsm_kms_def] if {
    not input.keys_managed_in_hsm_or_kms
}

weak_key_management_keys_co_located_unrotated_no_hsm_kms[_weak_key_management_keys_co_located_unrotated_no_hsm_kms_def] if {
    input.keys_stored_with_data == true
}

weak_key_management_keys_co_located_unrotated_no_hsm_kms[_weak_key_management_keys_co_located_unrotated_no_hsm_kms_def] if {
    not input.key_rotation_enabled
}

weak_key_management_keys_co_located_unrotated_no_hsm_kms[_weak_key_management_keys_co_located_unrotated_no_hsm_kms_def] if {
    input.keys_derived_from_passphrase == true
}

exposures contains _weak_key_management_keys_co_located_unrotated_no_hsm_kms_def if {
    count(weak_key_management_keys_co_located_unrotated_no_hsm_kms) > 0
}

_over_broad_access_to_pii_stores_def := {
    "name": "Over-broad access to PII stores",
    "description": "No least-privilege on the PII data store: shared admin accounts, blanket SELECT grants, no row-level / column-level controls, no break-glass discipline. One compromised analyst or service account reads every customer record.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

over_broad_access_to_pii_stores[_over_broad_access_to_pii_stores_def] if {
    not input.least_privilege_access_enforced
}

over_broad_access_to_pii_stores[_over_broad_access_to_pii_stores_def] if {
    input.shared_admin_accounts == true
}

over_broad_access_to_pii_stores[_over_broad_access_to_pii_stores_def] if {
    not input.row_or_column_level_restriction
}

exposures contains _over_broad_access_to_pii_stores_def if {
    count(over_broad_access_to_pii_stores) > 0
}

_pii_leakage_into_logs_and_telemetry_def := {
    "name": "PII leakage into logs and telemetry",
    "description": "Application logs, error traces, request dumps, and APM telemetry capture raw PII (emails, payment fields, identifiers) with no redaction or scrubbing \u2014 turning observability sinks (often retained longer and more broadly accessible than the primary store) into a secondary breach surface.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

pii_leakage_into_logs_and_telemetry[_pii_leakage_into_logs_and_telemetry_def] if {
    not input.pii_excluded_from_logs
}

pii_leakage_into_logs_and_telemetry[_pii_leakage_into_logs_and_telemetry_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _pii_leakage_into_logs_and_telemetry_def if {
    count(pii_leakage_into_logs_and_telemetry) > 0
}

_bulk_exfiltration_without_dlp_or_egress_monitoring_def := {
    "name": "Bulk exfiltration without DLP or egress monitoring",
    "description": "No egress controls, no anomalous-query detection, no DLP on outbound flows \u2014 an attacker (or insider) drains the customer table to an external endpoint (S3, paste site, web service) at full speed without tripping an alert. Maps to T1567 Exfiltration Over Web Service.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1030"
        }
    ],
    "attack_vector": "NETWORK"
}

bulk_exfiltration_without_dlp_or_egress_monitoring[_bulk_exfiltration_without_dlp_or_egress_monitoring_def] if {
    not input.dlp_egress_controls_enabled
}

bulk_exfiltration_without_dlp_or_egress_monitoring[_bulk_exfiltration_without_dlp_or_egress_monitoring_def] if {
    not input.bulk_export_monitored_and_alerted
}

exposures contains _bulk_exfiltration_without_dlp_or_egress_monitoring_def if {
    count(bulk_exfiltration_without_dlp_or_egress_monitoring) > 0
}

_indefinite_retention_and_unsafe_deletion_def := {
    "name": "Indefinite retention and unsafe deletion",
    "description": "Soft-delete only \u2014 records marked inactive remain in the store, in backups, and in replicas indefinitely. No retention schedule, no cryptographic erasure, no purge of derived caches \u2014 expanding the breach blast-radius to every customer who ever existed.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.2,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

indefinite_retention_and_unsafe_deletion[_indefinite_retention_and_unsafe_deletion_def] if {
    not input.retention_schedule_enforced
}

indefinite_retention_and_unsafe_deletion[_indefinite_retention_and_unsafe_deletion_def] if {
    not input.secure_deletion_or_crypto_shred
}

indefinite_retention_and_unsafe_deletion[_indefinite_retention_and_unsafe_deletion_def] if {
    input.soft_delete_leaves_recoverable_pii == true
}

exposures contains _indefinite_retention_and_unsafe_deletion_def if {
    count(indefinite_retention_and_unsafe_deletion) > 0
}

_data_residency_sovereignty_violation_def := {
    "name": "Data residency / sovereignty violation",
    "description": "PII is replicated, backed up, or processed in regions outside the approved jurisdiction (e.g. EU data landing in US-region S3, cross-border analytics warehouse), breaching GDPR Chapter V / Schrems II and surfacing immediate regulatory exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537"
        }
    ],
    "attack_vector": "NETWORK"
}

data_residency_sovereignty_violation[_data_residency_sovereignty_violation_def] if {
    not input.residency_confined_to_approved_regions
}

data_residency_sovereignty_violation[_data_residency_sovereignty_violation_def] if {
    not input.governed_transfer_safeguards
}

data_residency_sovereignty_violation[_data_residency_sovereignty_violation_def] if {
    not input.storage_destinations_documented
}

exposures contains _data_residency_sovereignty_violation_def if {
    count(data_residency_sovereignty_violation) > 0
}

_audit_log_tampering_def := {
    "name": "Audit-log tampering",
    "description": "Audit logs recording access to PII are mutable \u2014 held on the same host as the application, writable by the same service identity, with no append-only/WORM sink, no off-host shipping, and no integrity proof \u2014 letting an attacker who reaches the data tier also erase the trail of their reads.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

audit_log_tampering[_audit_log_tampering_def] if {
    not input.audit_log_tamper_evident
}

audit_log_tampering[_audit_log_tampering_def] if {
    not input.access_audit_trail_enabled
}

audit_log_tampering[_audit_log_tampering_def] if {
    not input.audit_management_restricted_to_privileged_subset
}

exposures contains _audit_log_tampering_def if {
    count(audit_log_tampering) > 0
}
