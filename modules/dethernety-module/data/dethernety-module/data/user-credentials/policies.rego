package _dt_built_in.exposures.user_credentials



_unclassified_or_misclassified_credential_data_def := {
    "name": "Unclassified Or Misclassified Credential Data",
    "description": "Authentication data transmitted during VPN setup lacks a formal sensitivity classification label (e.g., Confidential or Restricted), causing downstream handling policies \u2014 encryption requirements, retention limits, access controls \u2014 to default to less protective tiers. Without explicit classification, storage systems and log aggregators may treat credential data equivalently to low-sensitivity operational data.",
    "type": "insecure_default",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_iexposured",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Unclassified or misclassified credential data directly results in unsecured credentials that can be discovered and exploited by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555",
            "name": "Credentials from Password Stores",
            "relevance": "Misclassified credential data may be stored in accessible locations similar to password stores, enabling credential theft."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.001",
            "name": "Credentials",
            "relevance": "Improperly classified credential data can be gathered by adversaries as part of reconnaissance to obtain valid credentials."
        }
    ]
}

unclassified_or_misclassified_credential_data[_unclassified_or_misclassified_credential_data_def] if {
    input.credential_data_classification_label in ["unclassified", "not_assigned"]
}

unclassified_or_misclassified_credential_data[_unclassified_or_misclassified_credential_data_def] if {
    input.credential_data_classification_label in ["public", "internal"]
}

unclassified_or_misclassified_credential_data[_unclassified_or_misclassified_credential_data_def] if {
    input.credential_data_classification_label in ["restricted", "confidential"]
    not input.classification_enforced_in_handling_policies
}

unclassified_or_misclassified_credential_data[_unclassified_or_misclassified_credential_data_def] if {
    input.log_aggregator_sensitivity_tier in ["low_sensitivity", "unclassified", "not_configured"]
}

exposures contains _unclassified_or_misclassified_credential_data_def if {
    count(unclassified_or_misclassified_credential_data) > 0
}

_plaintext_credential_logging_def := {
    "name": "Plaintext Credential Logging",
    "description": "VPN authentication data, including usernames and potentially passwords or token values, is written in plaintext to system logs, SIEM feeds, or diagnostic traces. Log classification policies may not flag these records as sensitive, allowing them to persist in poorly controlled log storage tiers, violating both encryption-at-rest requirements and minimum necessary access principles.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Plaintext credentials written to log files represent credentials stored in files that adversaries can directly read and exploit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Adversaries can enumerate logs to discover plaintext credentials that were inadvertently recorded during authentication events."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1056.001",
            "name": "Keylogging",
            "relevance": "Plaintext credential logging is conceptually similar to keylogging in that sensitive authentication input is captured and stored in an unprotected form."
        }
    ]
}

plaintext_credential_logging[_plaintext_credential_logging_def] if {
    input.credential_fields_in_logs == true
    not input.log_credential_masking_enabled
}

plaintext_credential_logging[_plaintext_credential_logging_def] if {
    input.credential_fields_in_logs == true
    not input.log_storage_encryption_at_rest
}

exposures contains _plaintext_credential_logging_def if {
    count(plaintext_credential_logging) > 0
}

_excessive_retention_of_authentication_artifacts_def := {
    "name": "Excessive Retention Of Authentication Artifacts",
    "description": "Session tokens, negotiated keys, or hashed credential material generated during VPN connection setup are retained beyond the defined retention window (or indefinitely when no policy exists). Persisted authentication artifacts remain exploitable long after the legitimate session ends, expanding the window for replay attacks or offline cracking.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550",
            "name": "Use Alternate Authentication Material",
            "relevance": "Excessive retention of authentication artifacts such as tokens and session cookies allows adversaries to reuse them as alternate authentication material."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "name": "Web Session Cookie",
            "relevance": "Retained web session cookies are a primary authentication artifact that attackers can steal and reuse to hijack sessions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Long-retained authentication certificates increase the window of opportunity for adversaries to steal or forge them for unauthorized access."
        }
    ]
}

excessive_retention_of_authentication_artifacts[_excessive_retention_of_authentication_artifacts_def] if {
    not input.artifact_retention_policy_defined
}

excessive_retention_of_authentication_artifacts[_excessive_retention_of_authentication_artifacts_def] if {
    input.artifact_retention_policy_defined == true
    input.artifact_max_retention_hours > 24
}

excessive_retention_of_authentication_artifacts[_excessive_retention_of_authentication_artifacts_def] if {
    input.credential_artifacts_persist_to_disk == true
}

exposures contains _excessive_retention_of_authentication_artifacts_def if {
    count(excessive_retention_of_authentication_artifacts) > 0
}

_missing_masking_of_credential_fields_in_audit_records_def := {
    "name": "Missing Masking Of Credential Fields In Audit Records",
    "description": "Audit and accounting records generated for VPN authentication events capture full credential fields (e.g., username, OTP value, certificate serial) without masking or tokenization. These records are often shared across teams for compliance review, transmitted to external SIEM vendors, or archived without the same access controls applied to production credential stores.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Unmasked credential fields in audit records effectively store credentials in files, enabling direct credential harvesting by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003",
            "name": "OS Credential Dumping",
            "relevance": "Audit records containing unmasked credentials can be accessed and dumped similarly to OS credential dumping techniques."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.001",
            "name": "Credentials",
            "relevance": "Exposed credential fields in audit records provide adversaries with harvested credentials during reconnaissance activities."
        }
    ]
}

missing_masking_of_credential_fields_in_audit_records[_missing_masking_of_credential_fields_in_audit_records_def] if {
    not input.log_credential_masking_enabled
    count(input.unmasked_credential_fields_present) > 0
}

missing_masking_of_credential_fields_in_audit_records[_missing_masking_of_credential_fields_in_audit_records_def] if {
    not input.log_credential_masking_enabled
    input.audit_log_sharing_scope in ["external_vendor", "unrestricted"]
}

exposures contains _missing_masking_of_credential_fields_in_audit_records_def if {
    count(missing_masking_of_credential_fields_in_audit_records) > 0
}

_cross_border_transfer_of_authentication_data_without_adequacy_controls_def := {
    "name": "Cross Border Transfer Of Authentication Data Without Adequacy Controls",
    "description": "Authentication data collected at VPN endpoints is replicated to log aggregation, identity analytics, or SIEM platforms hosted in jurisdictions with different data-protection requirements. No data-transfer agreements, adequacy decisions, or binding corporate rules govern the export of credential-linked records, creating regulatory exposure under GDPR, PDPA, or equivalent frameworks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "name": "Transfer Data to Cloud Account",
            "relevance": "Authentication data transferred across borders without controls mirrors the risk of unauthorized data exfiltration to external cloud accounts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.001",
            "name": "Credentials",
            "relevance": "Cross-border transfer of authentication data exposes credentials to jurisdictions without adequate protection, enabling adversarial collection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "Bulk automated collection of authentication data for cross-border transfer increases the risk of large-scale credential exposure."
        }
    ]
}

cross_border_transfer_of_authentication_data_without_adequacy_controls[_cross_border_transfer_of_authentication_data_without_adequacy_controls_def] if {
    input.vpn_auth_data_logged_to_external_siem == true
    input.data_transfer_legal_mechanism == "none"
    not input.auth_data_anonymization_before_export
}

cross_border_transfer_of_authentication_data_without_adequacy_controls[_cross_border_transfer_of_authentication_data_without_adequacy_controls_def] if {
    input.vpn_auth_data_logged_to_external_siem == true
    input.data_transfer_legal_mechanism == "derogation"
    not input.auth_data_anonymization_before_export
}

exposures contains _cross_border_transfer_of_authentication_data_without_adequacy_controls_def if {
    count(cross_border_transfer_of_authentication_data_without_adequacy_controls) > 0
}

_inadequate_disposal_of_cached_authentication_material_def := {
    "name": "Inadequate Disposal Of Cached Authentication Material",
    "description": "Temporary credential caches, session key material, and pre-shared key copies written to disk or memory during VPN handshake are not securely overwritten upon session termination or system shutdown. Standard deletion leaves recoverable artifacts, and no formal disposal procedure exists to cryptographically erase or verify removal of classified credential data.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Inadequately disposed cached authentication material remains as unsecured credentials accessible to adversaries on the system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.004",
            "name": "Windows Credential Manager",
            "relevance": "Cached authentication material retained in credential managers like Windows Credential Manager can be extracted by adversaries due to improper disposal."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Cached credentials not properly disposed of may persist in files on disk where they can be discovered and harvested."
        }
    ]
}

inadequate_disposal_of_cached_authentication_material[_inadequate_disposal_of_cached_authentication_material_def] if {
    not input.secure_credential_disposal_enforced
    input.credential_cache_persistence_scope in ["disk_transient", "disk_persistent"]
}

inadequate_disposal_of_cached_authentication_material[_inadequate_disposal_of_cached_authentication_material_def] if {
    input.credential_cache_persistence_scope == "disk_persistent"
    not input.session_termination_wipe_verified
}

inadequate_disposal_of_cached_authentication_material[_inadequate_disposal_of_cached_authentication_material_def] if {
    not input.secure_credential_disposal_enforced
    not input.secure_credential_disposal_enforced
}

exposures contains _inadequate_disposal_of_cached_authentication_material_def if {
    count(inadequate_disposal_of_cached_authentication_material) > 0
}
