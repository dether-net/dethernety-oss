package _dt_built_in.exposures.customer_data



_unclassified_or_misclassified_pii_fields_def := {
    "name": "Unclassified Or Misclassified Pii Fields",
    "description": "PII and financial fields lack formal sensitivity classification labels or are assigned incorrect classification tiers, causing downstream handling controls (encryption, access, retention) to be applied inconsistently or not at all.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "Unclassified or misclassified PII fields can be automatically harvested by adversaries who exploit the lack of data classification controls to collect sensitive information at scale."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Misclassified PII fields stored in cloud environments are at risk of unauthorized access and exfiltration from cloud storage due to inadequate classification and protection."
        }
    ]
}

unclassified_or_misclassified_pii_fields[_unclassified_or_misclassified_pii_fields_def] if {
    not input.pii_field_classification_policy_enforced
}

unclassified_or_misclassified_pii_fields[_unclassified_or_misclassified_pii_fields_def] if {
    input.unclassified_pii_field_count > 0
}

unclassified_or_misclassified_pii_fields[_unclassified_or_misclassified_pii_fields_def] if {
    input.misclassified_pii_field_count > 0
}

exposures contains _unclassified_or_misclassified_pii_fields_def if {
    count(unclassified_or_misclassified_pii_fields) > 0
}

_excessive_retention_beyond_policy_def := {
    "name": "Excessive Retention Beyond Policy",
    "description": "PII and financial records are retained past legally mandated or policy-defined retention periods, increasing regulatory exposure and the blast radius of any data breach. No automated purge or archival enforcement exists.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Data retained beyond policy remains in repositories longer than necessary, increasing the window of opportunity for adversaries to access and exfiltrate it."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Excessive retention beyond policy relates directly to failures in data lifecycle management, where required deletion or destruction of data is not performed."
        }
    ]
}

excessive_retention_beyond_policy[_excessive_retention_beyond_policy_def] if {
    not input.automated_purge_enforcement_enabled
}

excessive_retention_beyond_policy[_excessive_retention_beyond_policy_def] if {
    not input.retention_policy_defined
}

excessive_retention_beyond_policy[_excessive_retention_beyond_policy_def] if {
    input.oldest_unreviewed_record_age_days
    input.max_policy_retention_days
    input.oldest_unreviewed_record_age_days
}

exposures contains _excessive_retention_beyond_policy_def if {
    count(excessive_retention_beyond_policy) > 0
}

_unmasked_pii_in_non_production_environments_def := {
    "name": "Unmasked Pii In Non Production Environments",
    "description": "Production PII and financial data is copied to development, test, or analytics environments without anonymization or masking applied, exposing sensitive records to a broader, less-controlled audience.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Non-production environments containing unmasked PII represent accessible repositories where sensitive data can be collected by adversaries with lower security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1074",
            "name": "Data Staged",
            "relevance": "Unmasked PII copied into non-production environments effectively stages real sensitive data in less-protected locations, mimicking adversarial data staging behavior."
        }
    ]
}

unmasked_pii_in_non_production_environments[_unmasked_pii_in_non_production_environments_def] if {
    input.environment_type in ["development", "test", "staging", "analytics"]
    input.pii_data_present == true
    not input.masking_or_anonymization_applied
}

unmasked_pii_in_non_production_environments[_unmasked_pii_in_non_production_environments_def] if {
    input.environment_type == "unknown"
    input.pii_data_present == true
    not input.masking_or_anonymization_applied
}

exposures contains _unmasked_pii_in_non_production_environments_def if {
    count(unmasked_pii_in_non_production_environments) > 0
}

_insufficient_field_level_encryption_for_sensitive_attributes_def := {
    "name": "Insufficient Field Level Encryption For Sensitive Attributes",
    "description": "High-sensitivity fields such as SSNs, payment card numbers, and account credentials are stored without field-level or column-level encryption, meaning any unauthorized read of the table exposes plaintext sensitive values.",
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
            "relevance": "Insufficient field-level encryption leaves sensitive attributes exposed in a manner analogous to unsecured credentials, making them accessible to adversaries without decryption effort."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Lack of field-level encryption for sensitive attributes may expose cryptographic keys or sensitive data that adversaries can leverage directly without needing to crack encryption."
        }
    ]
}

insufficient_field_level_encryption_for_sensitive_attributes[_insufficient_field_level_encryption_for_sensitive_attributes_def] if {
    input.sensitive_fields_with_encryption == "none"
}

insufficient_field_level_encryption_for_sensitive_attributes[_insufficient_field_level_encryption_for_sensitive_attributes_def] if {
    input.sensitive_fields_with_encryption == "partial"
    count(input.unencrypted_sensitive_field_types) > 0
}

insufficient_field_level_encryption_for_sensitive_attributes[_insufficient_field_level_encryption_for_sensitive_attributes_def] if {
    "ssn" in input.unencrypted_sensitive_field_types
}

insufficient_field_level_encryption_for_sensitive_attributes[_insufficient_field_level_encryption_for_sensitive_attributes_def] if {
    "payment_card" in input.unencrypted_sensitive_field_types
}

insufficient_field_level_encryption_for_sensitive_attributes[_insufficient_field_level_encryption_for_sensitive_attributes_def] if {
    "account_credential" in input.unencrypted_sensitive_field_types
}

exposures contains _insufficient_field_level_encryption_for_sensitive_attributes_def if {
    count(insufficient_field_level_encryption_for_sensitive_attributes) > 0
}

_overly_broad_data_access_without_need_to_know_def := {
    "name": "Overly Broad Data Access Without Need To Know",
    "description": "Database roles and application service accounts have read access to PII and financial columns that exceed operational necessity, violating least-privilege principles and expanding the exposure surface for both insider misuse and credential compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Overly broad data access means valid account holders can access far more data than their role requires, enabling insider threats or compromised accounts to exfiltrate sensitive information."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Excessive access permissions without need-to-know controls mirror the risk of temporary elevated cloud access, where accounts gain more privilege than necessary."
        }
    ]
}

overly_broad_data_access_without_need_to_know[_overly_broad_data_access_without_need_to_know_def] if {
    count(input.pii_financial_columns_with_broad_read_access) > 0
    not input.column_level_access_control_enforced
}

overly_broad_data_access_without_need_to_know[_overly_broad_data_access_without_need_to_know_def] if {
    count(input.pii_financial_columns_with_broad_read_access) > 0
    not input.data_masking_applied_to_sensitive_columns
}

overly_broad_data_access_without_need_to_know[_overly_broad_data_access_without_need_to_know_def] if {
    input.overprivileged_role_count > 0
    not input.column_level_access_control_enforced
}

overly_broad_data_access_without_need_to_know[_overly_broad_data_access_without_need_to_know_def] if {
    input.overprivileged_role_count > 0
    not input.data_masking_applied_to_sensitive_columns
}

exposures contains _overly_broad_data_access_without_need_to_know_def if {
    count(overly_broad_data_access_without_need_to_know) > 0
}

_cross_border_transfer_without_adequacy_controls_def := {
    "name": "Cross Border Transfer Without Adequacy Controls",
    "description": "PII and financial data is replicated, backed up, or transferred to database instances in jurisdictions without verified adequacy decisions or standard contractual clauses, violating GDPR and equivalent regulations.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "name": "Transfer Data to Cloud Account",
            "relevance": "Cross-border data transfers without adequacy controls directly relate to unauthorized or uncontrolled transfer of data to cloud accounts in foreign jurisdictions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Data moved across borders without controls is often staged or accessed via cloud storage, making this technique highly relevant to the exposure risk."
        }
    ]
}

cross_border_transfer_without_adequacy_controls[_cross_border_transfer_without_adequacy_controls_def] if {
    not input.adequacy_decision_verified
}

cross_border_transfer_without_adequacy_controls[_cross_border_transfer_without_adequacy_controls_def] if {
    input.transfer_mechanism_type == "none"
}

cross_border_transfer_without_adequacy_controls[_cross_border_transfer_without_adequacy_controls_def] if {
    "CN" in input.replication_target_jurisdictions
    not input.transfer_mechanism_type in ["adequacy_decision", "standard_contractual_clauses", "binding_corporate_rules"]
}

cross_border_transfer_without_adequacy_controls[_cross_border_transfer_without_adequacy_controls_def] if {
    "IN" in input.replication_target_jurisdictions
    not input.transfer_mechanism_type in ["adequacy_decision", "standard_contractual_clauses", "binding_corporate_rules"]
}

exposures contains _cross_border_transfer_without_adequacy_controls_def if {
    count(cross_border_transfer_without_adequacy_controls) > 0
}

_insecure_or_incomplete_data_disposal_def := {
    "name": "Insecure Or Incomplete Data Disposal",
    "description": "When records are deleted or databases are decommissioned, disposal procedures do not guarantee cryptographic erasure or verified overwrite of PII and financial data, leaving recoverable residual data in storage media or backup sets.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Insecure or incomplete data disposal directly relates to failures in lifecycle-triggered deletion processes that should ensure data is properly removed."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1561.001",
            "name": "Disk Content Wipe",
            "relevance": "Incomplete data disposal may leave residual data on storage media that should have been wiped, making disk content wipe techniques relevant to assessing disposal gaps."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Insecure disposal that relies on simple file deletion without secure erasure leaves data recoverable, directly tied to the risks of incomplete file deletion practices."
        }
    ]
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    not input.cryptographic_erasure_enforced
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    not input.backup_purge_verified
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    input.disposal_verification_method == "none"
}

exposures contains _insecure_or_incomplete_data_disposal_def if {
    count(insecure_or_incomplete_data_disposal) > 0
}

_absence_of_data_lineage_and_classification_audit_trail_def := {
    "name": "Absence Of Data Lineage And Classification Audit Trail",
    "description": "No authoritative record tracks where PII and financial data originates, how it has been transformed, who has accessed it, and what classifications were applied at each stage, preventing effective compliance demonstration and breach scope determination.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Without data lineage and classification audit trails, adversaries can access information repositories without detection, as there is no baseline to identify anomalous access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1591.002",
            "name": "Business Relationships",
            "relevance": "Absence of audit trails for data lineage obscures how data flows across business relationships and third parties, enabling undetected data misuse or exfiltration."
        }
    ]
}

absence_of_data_lineage_and_classification_audit_trail[_absence_of_data_lineage_and_classification_audit_trail_def] if {
    not input.data_lineage_tracking_enabled
}

absence_of_data_lineage_and_classification_audit_trail[_absence_of_data_lineage_and_classification_audit_trail_def] if {
    not input.classification_audit_trail_present
}

absence_of_data_lineage_and_classification_audit_trail[_absence_of_data_lineage_and_classification_audit_trail_def] if {
    not input.access_history_logged_for_sensitive_data
}

exposures contains _absence_of_data_lineage_and_classification_audit_trail_def if {
    count(absence_of_data_lineage_and_classification_audit_trail) > 0
}
