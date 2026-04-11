package _dt_built_in.exposures.application_state_data



_missing_sensitivity_classification_for_session_tokens_def := {
    "name": "Missing Sensitivity Classification For Session Tokens",
    "description": "Session tokens are not formally classified as confidential or secret-equivalent data, causing them to be handled under generic or lower-tier data policies. This means protections such as field-level encryption, strict access logging, and masking requirements are never triggered.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.001",
            "name": "Web Cookies",
            "relevance": "Session tokens in web cookies lack sensitivity classification, enabling attackers to forge or steal them without proper data handling controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "name": "Web Session Cookie",
            "relevance": "Unclassified session tokens in cookies can be exploited for unauthorized access, as their sensitivity level is not enforced."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Application access tokens without sensitivity classification are at higher risk of misuse or improper handling across systems."
        }
    ]
}

missing_sensitivity_classification_for_session_tokens[_missing_sensitivity_classification_for_session_tokens_def] if {
    input.session_token_data_classification in ["internal", "public", "unclassified"]
    not input.field_level_encryption_enforced_for_tokens
}

missing_sensitivity_classification_for_session_tokens[_missing_sensitivity_classification_for_session_tokens_def] if {
    input.session_token_data_classification in ["internal", "public", "unclassified"]
    not input.token_masking_in_logs_enabled
}

missing_sensitivity_classification_for_session_tokens[_missing_sensitivity_classification_for_session_tokens_def] if {
    input.session_token_data_classification in ["internal", "public", "unclassified"]
    not input.token_access_audit_logging_enabled
}

missing_sensitivity_classification_for_session_tokens[_missing_sensitivity_classification_for_session_tokens_def] if {
    not input.session_token_data_classification
    not input.field_level_encryption_enforced_for_tokens
}

missing_sensitivity_classification_for_session_tokens[_missing_sensitivity_classification_for_session_tokens_def] if {
    not input.session_token_data_classification
    not input.token_masking_in_logs_enabled
}

exposures contains _missing_sensitivity_classification_for_session_tokens_def if {
    count(missing_sensitivity_classification_for_session_tokens) > 0
}

_session_token_retained_beyond_expiry_in_logs_def := {
    "name": "Session Token Retained Beyond Expiry In Logs",
    "description": "Tokens are captured in application or audit logs without masking and retained past their functional lifetime, violating the principle that credential data should not persist beyond session end. Log retention policies designed for operational data are applied to tokens, creating long-lived exposure windows.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Expired session tokens retained in logs can be stolen by adversaries and replayed to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.001",
            "name": "Token Impersonation/Theft",
            "relevance": "Tokens persisted in logs beyond expiry provide opportunities for theft and impersonation of legitimate user sessions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Application access tokens retained in logs after expiry can be used by attackers to bypass authentication mechanisms."
        }
    ]
}

session_token_retained_beyond_expiry_in_logs[_session_token_retained_beyond_expiry_in_logs_def] if {
    not input.token_masking_in_logs_enabled
    input.log_scope_includes_session_tokens == true
    input.log_retention_days > 0
    input.max_session_token_lifetime_days
    input.log_retention_days > 0
}

session_token_retained_beyond_expiry_in_logs[_session_token_retained_beyond_expiry_in_logs_def] if {
    not input.token_masking_in_logs_enabled
    input.log_scope_includes_session_tokens == true
    input.log_retention_days > 0
    not input.max_session_token_lifetime_days
}

exposures contains _session_token_retained_beyond_expiry_in_logs_def if {
    count(session_token_retained_beyond_expiry_in_logs) > 0
}

_plaintext_token_persistence_in_memory_snapshots_def := {
    "name": "Plaintext Token Persistence In Memory Snapshots",
    "description": "Tokens held in application memory are exposed when memory is serialized \u2014 via heap dumps, core dumps, or crash reports \u2014 without scrubbing. No data-at-rest encryption or masking requirement applies to these artifacts because the token is classified as transient.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Plaintext tokens stored in memory snapshots represent unsecured credentials directly accessible to adversaries performing memory analysis."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003",
            "name": "OS Credential Dumping",
            "relevance": "Memory snapshots containing plaintext tokens are a prime target for credential dumping techniques to extract authentication material."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.001",
            "name": "Token Impersonation/Theft",
            "relevance": "Plaintext tokens found in memory snapshots can be directly stolen and used for token impersonation attacks."
        }
    ]
}

plaintext_token_persistence_in_memory_snapshots[_plaintext_token_persistence_in_memory_snapshots_def] if {
    not input.memory_snapshot_scrubbing_enabled
    input.session_token_data_classification == "transient"
}

plaintext_token_persistence_in_memory_snapshots[_plaintext_token_persistence_in_memory_snapshots_def] if {
    not input.memory_snapshot_scrubbing_enabled
    input.crash_report_destination == "external_service"
}

exposures contains _plaintext_token_persistence_in_memory_snapshots_def if {
    count(plaintext_token_persistence_in_memory_snapshots) > 0
}

_inadequate_access_control_to_token_stores_def := {
    "name": "Inadequate Access Control To Token Stores",
    "description": "In-memory caches or temporary stores holding active tokens lack role-based access restrictions at the data level. Any process or user with read access to the store can enumerate all active session tokens, enabling session hijacking without network interception.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Poorly controlled token stores allow adversaries to directly steal application access tokens without significant effort."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.005",
            "name": "Ccache Files",
            "relevance": "Inadequate access controls on token stores, including credential cache files, enable unauthorized retrieval of authentication tokens."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134",
            "name": "Access Token Manipulation",
            "relevance": "Weak access controls on token stores enable adversaries to manipulate or abuse access tokens for privilege escalation."
        }
    ]
}

inadequate_access_control_to_token_stores[_inadequate_access_control_to_token_stores_def] if {
    not input.token_store_rbac_enabled
}

inadequate_access_control_to_token_stores[_inadequate_access_control_to_token_stores_def] if {
    input.token_store_access_scope == "host_wide"
}

inadequate_access_control_to_token_stores[_inadequate_access_control_to_token_stores_def] if {
    input.token_store_access_scope == "multi_service"
    not input.token_enumeration_commands_restricted
}

exposures contains _inadequate_access_control_to_token_stores_def if {
    count(inadequate_access_control_to_token_stores) > 0
}

_absence_of_token_disposal_procedure_on_session_end_def := {
    "name": "Absence Of Token Disposal Procedure On Session End",
    "description": "No formal disposal procedure mandates explicit invalidation and overwriting of token values on logout, timeout, or revocation. Tokens persist in their storage medium \u2014 cache, cookie store, or memory \u2014 remaining usable by an attacker who acquires the value after session termination.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "name": "Web Session Cookie",
            "relevance": "Failure to dispose of session cookies on logout leaves valid tokens that can be reused for unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Without proper token disposal procedures, application tokens remain valid after session end and can be hijacked."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.001",
            "name": "Token Impersonation/Theft",
            "relevance": "Tokens not invalidated at session termination can be stolen and used for impersonation of the original authenticated user."
        }
    ]
}

absence_of_token_disposal_procedure_on_session_end[_absence_of_token_disposal_procedure_on_session_end_def] if {
    not input.server_side_token_invalidation_on_logout
}

absence_of_token_disposal_procedure_on_session_end[_absence_of_token_disposal_procedure_on_session_end_def] if {
    not input.token_overwrite_on_disposal
}

absence_of_token_disposal_procedure_on_session_end[_absence_of_token_disposal_procedure_on_session_end_def] if {
    input.token_logged_in_plaintext == true
}

exposures contains _absence_of_token_disposal_procedure_on_session_end_def if {
    count(absence_of_token_disposal_procedure_on_session_end) > 0
}

_cross_border_transfer_of_session_tokens_without_residency_controls_def := {
    "name": "Cross Border Transfer Of Session Tokens Without Residency Controls",
    "description": "Session tokens are replicated across geographically distributed cache nodes or analytics pipelines without evaluating whether the token value constitutes personal data or an authentication credential under jurisdictional law. Transfer occurs without applicable data transfer agreements or residency enforcement.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "name": "Forge Web Credentials",
            "relevance": "Session tokens transferred across borders without residency controls may be intercepted and used to forge web credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "name": "SAML Tokens",
            "relevance": "Cross-border transfer of SAML tokens without residency controls exposes them to interception and forgery by foreign adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "name": "Web Session Cookie",
            "relevance": "Web session cookies transmitted across jurisdictions without controls are at risk of being hijacked for unauthorized session use."
        }
    ]
}

cross_border_transfer_of_session_tokens_without_residency_controls[_cross_border_transfer_of_session_tokens_without_residency_controls_def] if {
    input.token_classified_as_personal_data == true
    input.cross_region_replication_enabled == true
    not input.data_transfer_agreement_status in ["valid"]
}

cross_border_transfer_of_session_tokens_without_residency_controls[_cross_border_transfer_of_session_tokens_without_residency_controls_def] if {
    input.cross_region_replication_enabled == true
    input.data_transfer_agreement_status == "none"
}

exposures contains _cross_border_transfer_of_session_tokens_without_residency_controls_def if {
    count(cross_border_transfer_of_session_tokens_without_residency_controls) > 0
}
