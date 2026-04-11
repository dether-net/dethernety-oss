package _dt_built_in.exposures.authentication_tokens



_misclassification_as_non_sensitive_def := {
    "name": "Misclassification As Non Sensitive",
    "description": "Session tokens classified below their actual sensitivity level (e.g., as 'internal' rather than 'confidential' or 'restricted'), causing downstream handling controls \u2014 encryption, access logging, retention limits \u2014 to be applied at an inadequate tier. Token stores, backups, and log sinks inherit the wrong control set.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

misclassification_as_non_sensitive[_misclassification_as_non_sensitive_def] if {
    input.token_store_classification_label in ["public", "internal"]
}

misclassification_as_non_sensitive[_misclassification_as_non_sensitive_def] if {
    input.token_store_classification_label in ["public", "internal"]
    not input.encryption_at_rest_enabled
}

misclassification_as_non_sensitive[_misclassification_as_non_sensitive_def] if {
    input.token_store_classification_label in ["public", "internal"]
    not input.access_logging_enabled_on_token_store
}

misclassification_as_non_sensitive[_misclassification_as_non_sensitive_def] if {
    input.token_store_classification_label in ["public", "internal"]
    input.token_retention_policy_days == -1
}

exposures contains _misclassification_as_non_sensitive_def if {
    count(misclassification_as_non_sensitive) > 0
}

_token_persistence_beyond_session_lifetime_def := {
    "name": "Token Persistence Beyond Session Lifetime",
    "description": "Tokens retained in storage (databases, caches, log files, audit trails) beyond their intended validity window. Expired or revoked tokens that remain in persistent stores become dormant credentials that can be replayed if the signing secret or validation logic changes, or if revocation checks are bypassed.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

token_persistence_beyond_session_lifetime[_token_persistence_beyond_session_lifetime_def] if {
    not input.token_retention_policy_enforced
}

token_persistence_beyond_session_lifetime[_token_persistence_beyond_session_lifetime_def] if {
    not input.revoked_token_store_cleanup_enabled
}

token_persistence_beyond_session_lifetime[_token_persistence_beyond_session_lifetime_def] if {
    input.max_token_retention_days > 0
}

token_persistence_beyond_session_lifetime[_token_persistence_beyond_session_lifetime_def] if {
    input.tokens_logged_in_plaintext == true
}

exposures contains _token_persistence_beyond_session_lifetime_def if {
    count(token_persistence_beyond_session_lifetime) > 0
}

_unencrypted_token_at_rest_def := {
    "name": "Unencrypted Token At Rest",
    "description": "Tokens stored in plaintext within databases, session stores, backup archives, or exported datasets. Absence of field-level or volume encryption means any actor who gains read access to the storage medium obtains directly usable credentials without further cryptographic attack.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_token_at_rest[_unencrypted_token_at_rest_def] if {
    input.token_storage_encryption == "none"
}

unencrypted_token_at_rest[_unencrypted_token_at_rest_def] if {
    input.token_storage_encryption == "hashed"
}

unencrypted_token_at_rest[_unencrypted_token_at_rest_def] if {
    input.token_storage_encryption in ["field_encrypted", "volume_encrypted", "field_and_volume_encrypted"]
    not input.encryption_at_rest_enabled
}

exposures contains _unencrypted_token_at_rest_def if {
    count(unencrypted_token_at_rest) > 0
}

_token_exposure_in_log_and_audit_data_def := {
    "name": "Token Exposure In Log And Audit Data",
    "description": "Full or partial token values written into application logs, audit records, error reports, or analytics pipelines, which are subject to looser access controls and longer retention than the session store itself. Log consumers, log aggregation services, and backup operators gain unintended access to live credentials.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

token_exposure_in_log_and_audit_data[_token_exposure_in_log_and_audit_data_def] if {
    input.tokens_logged_in_plaintext == true
    not input.log_token_masking_enabled
}

token_exposure_in_log_and_audit_data[_token_exposure_in_log_and_audit_data_def] if {
    input.tokens_logged_in_plaintext == true
    input.log_access_control_scope in ["broader_than_session_store", "unrestricted"]
}

exposures contains _token_exposure_in_log_and_audit_data_def if {
    count(token_exposure_in_log_and_audit_data) > 0
}

_insufficient_access_control_on_token_stores_def := {
    "name": "Insufficient Access Control On Token Stores",
    "description": "Token repositories (session tables, Redis caches, JWT blacklists) accessible to roles or service accounts that do not require direct token data for their function. Overly broad read permissions allow enumeration or bulk extraction of live tokens without triggering targeted alerts.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insufficient_access_control_on_token_stores[_insufficient_access_control_on_token_stores_def] if {
    count(input.token_store_roles_with_read_access) > 0
    not input.non_auth_roles_require_token_access
    not input.token_store_bulk_read_alerting_enabled
}

insufficient_access_control_on_token_stores[_insufficient_access_control_on_token_stores_def] if {
    count(input.token_store_roles_with_read_access) > 0
    not input.non_auth_roles_require_token_access
}

exposures contains _insufficient_access_control_on_token_stores_def if {
    count(insufficient_access_control_on_token_stores) > 0
}

_absent_or_non_compliant_disposal_procedure_def := {
    "name": "Absent Or Non Compliant Disposal Procedure",
    "description": "No defined or enforced procedure for cryptographic erasure or secure deletion of token data from decommissioned storage volumes, exported backups, or archival datasets. Tokens in improperly disposed media or snapshots remain recoverable and may still be valid if revocation state is not preserved separately.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absent_or_non_compliant_disposal_procedure[_absent_or_non_compliant_disposal_procedure_def] if {
    not input.secure_deletion_procedure_defined
}

absent_or_non_compliant_disposal_procedure[_absent_or_non_compliant_disposal_procedure_def] if {
    not input.secure_deletion_procedure_defined
    not input.token_revocation_state_persisted_separately
}

exposures contains _absent_or_non_compliant_disposal_procedure_def if {
    count(absent_or_non_compliant_disposal_procedure) > 0
}
