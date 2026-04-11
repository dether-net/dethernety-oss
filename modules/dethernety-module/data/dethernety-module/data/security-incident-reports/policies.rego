package _dt_built_in.exposures.security_incident_reports



_incident_data_misclassification_def := {
    "name": "Incident Data Misclassification",
    "description": "SIEM incident records lack enforced sensitivity labels, causing them to be treated as general operational data rather than confidential security intelligence. Analysts may store, share, or forward incident reports without appropriate handling controls, exposing active investigation details.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Misclassified incident data stored in cloud repositories can be accessed or exposed due to improper data classification controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Misclassification of incident data can lead to blocking or ignoring critical security indicators, undermining detection efforts."
        }
    ]
}

incident_data_misclassification[_incident_data_misclassification_def] if {
    input.sensitivity_label_enforcement == "none"
}

incident_data_misclassification[_incident_data_misclassification_def] if {
    input.sensitivity_label_enforcement == "optional"
    not input.incident_export_controls_enabled
}

incident_data_misclassification[_incident_data_misclassification_def] if {
    input.incident_access_role_restriction in ["broad_operational", "unrestricted"]
    input.sensitivity_label_enforcement != "enforced"
}

exposures contains _incident_data_misclassification_def if {
    count(incident_data_misclassification) > 0
}

_excessive_access_to_raw_incident_data_def := {
    "name": "Excessive Access To Raw Incident Data",
    "description": "Incident data is accessible to roles beyond the security team (e.g., IT operations, helpdesk, management) without need-to-know justification. Broad access increases the risk of inadvertent disclosure of victim identities, attacker TTPs, and unpatched vulnerability details referenced in incidents.",
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
            "relevance": "Excessive access to raw incident data repositories directly mirrors adversarial techniques of extracting sensitive data from information stores."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1212",
            "name": "Exploitation for Credential Access",
            "relevance": "Overly permissive access to raw incident data increases risk of credential and sensitive information exposure through exploitation."
        }
    ]
}

excessive_access_to_raw_incident_data[_excessive_access_to_raw_incident_data_def] if {
    count(input.incident_data_roles_with_access) > 0
    input.incident_data_access_scope == "full_raw"
    not input.need_to_know_justification_enforced
}

excessive_access_to_raw_incident_data[_excessive_access_to_raw_incident_data_def] if {
    count(input.incident_data_roles_with_access) > 0
    input.incident_data_access_scope == "full_raw"
    not input.need_to_know_justification_enforced
}

exposures contains _excessive_access_to_raw_incident_data_def if {
    count(excessive_access_to_raw_incident_data) > 0
}

_pii_not_masked_in_incident_records_def := {
    "name": "Pii Not Masked In Incident Records",
    "description": "User identities, IP addresses, email addresses, and device identifiers embedded in SIEM incident data are retained in plaintext without masking or pseudonymization. This creates regulatory exposure under privacy frameworks and exposes victim identity to any party with read access to incident tickets or logs.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.003",
            "name": "Employee Names",
            "relevance": "Unmasked PII such as employee names in incident records can be harvested by adversaries for identity-related attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.002",
            "name": "Email Addresses",
            "relevance": "Exposed email addresses in unmasked incident records provide adversaries with actionable identity information for targeting."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Adversaries enumerating logs containing unmasked PII can harvest sensitive personal information from incident records."
        }
    ]
}

pii_not_masked_in_incident_records[_pii_not_masked_in_incident_records_def] if {
    not input.pii_masking_enforced
    count(input.pii_field_types_stored_plaintext) > 0
}

pii_not_masked_in_incident_records[_pii_not_masked_in_incident_records_def] if {
    not input.pii_masking_enforced
    input.incident_access_role_restriction in ["all_authenticated_users", "unrestricted"]
}

exposures contains _pii_not_masked_in_incident_records_def if {
    count(pii_not_masked_in_incident_records) > 0
}

_undefined_retention_policy_for_incident_records_def := {
    "name": "Undefined Retention Policy For Incident Records",
    "description": "No formal retention schedule exists for SIEM-derived incident data, resulting in indefinite storage of sensitive investigation records. Both over-retention (unnecessary exposure window) and under-retention (destruction before legal hold or forensic need is satisfied) represent compliance and evidentiary risks.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Without defined retention policies, lifecycle-triggered deletion controls are absent, leaving incident records vulnerable to improper retention or deletion."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Undefined retention policies leave stored incident data susceptible to unauthorized manipulation over extended periods."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Without clear retention policies, adversaries or insiders may improperly delete incident records, hindering forensic investigations."
        }
    ]
}

undefined_retention_policy_for_incident_records[_undefined_retention_policy_for_incident_records_def] if {
    not input.retention_policy_defined
}

undefined_retention_policy_for_incident_records[_undefined_retention_policy_for_incident_records_def] if {
    input.retention_policy_defined == true
    input.retention_period_days == 0
}

undefined_retention_policy_for_incident_records[_undefined_retention_policy_for_incident_records_def] if {
    input.retention_policy_defined == true
    input.retention_period_days > 0
    not input.legal_hold_integration_configured
}

exposures contains _undefined_retention_policy_for_incident_records_def if {
    count(undefined_retention_policy_for_incident_records) > 0
}

_unencrypted_incident_data_at_rest_in_shared_repositories_def := {
    "name": "Unencrypted Incident Data At Rest In Shared Repositories",
    "description": "Incident summaries, analyst notes, and exported SIEM reports are stored in shared drives or ticketing systems without encryption at rest. If storage access controls fail or the repository is compromised, full incident contents including attacker methodologies and affected assets are exposed in plaintext.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Unencrypted incident data in shared repositories is directly at risk of adversarial collection from information stores."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Unencrypted data at rest in shared cloud repositories can be directly accessed and exfiltrated by adversaries."
        }
    ]
}

unencrypted_incident_data_at_rest_in_shared_repositories[_unencrypted_incident_data_at_rest_in_shared_repositories_def] if {
    not input.encryption_at_rest_enabled
    not input.incident_data_storage_location_type in ["dedicated_secure_repository"]
}

unencrypted_incident_data_at_rest_in_shared_repositories[_unencrypted_incident_data_at_rest_in_shared_repositories_def] if {
    not input.encryption_at_rest_enabled
    not input.access_control_enforced
}

exposures contains _unencrypted_incident_data_at_rest_in_shared_repositories_def if {
    count(unencrypted_incident_data_at_rest_in_shared_repositories) > 0
}

_cross_border_transfer_of_incident_data_without_compliance_review_def := {
    "name": "Cross Border Transfer Of Incident Data Without Compliance Review",
    "description": "Incident data containing PII of data subjects from regulated jurisdictions (e.g., EU residents under GDPR) is transferred to security teams or MSSP analysts in other countries without legal basis documentation, data transfer agreements, or anonymization. This creates regulatory violation risk independent of the security investigation.",
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
            "relevance": "Transferring incident data across borders to cloud accounts without compliance review mirrors adversarial data exfiltration to external cloud storage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Cross-border transfers of incident data from repositories without review expose sensitive information to unauthorized foreign access."
        }
    ]
}

cross_border_transfer_of_incident_data_without_compliance_review[_cross_border_transfer_of_incident_data_without_compliance_review_def] if {
    input.incident_data_contains_pii_from_regulated_jurisdiction == true
    count(input.cross_border_transfer_destinations) > 0
    not input.data_transfer_legal_basis_documented
    not input.pii_anonymization_applied_before_transfer
}

cross_border_transfer_of_incident_data_without_compliance_review[_cross_border_transfer_of_incident_data_without_compliance_review_def] if {
    input.incident_data_contains_pii_from_regulated_jurisdiction == true
    count(input.cross_border_transfer_destinations) > 0
    not input.data_transfer_legal_basis_documented
    input.pii_anonymization_applied_before_transfer == true
}

exposures contains _cross_border_transfer_of_incident_data_without_compliance_review_def if {
    count(cross_border_transfer_of_incident_data_without_compliance_review) > 0
}

_insecure_disposal_of_closed_incident_records_def := {
    "name": "Insecure Disposal Of Closed Incident Records",
    "description": "Closed or resolved incident records are deleted from ticketing systems or shared drives without certified destruction procedures. Residual data may persist in backup snapshots, recycle bins, or unmanaged exports, allowing recovery of historical incident details including previously exploited vulnerabilities and compromised credential information.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Insecure disposal of incident records without proper destruction methods leaves sensitive data recoverable by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Improper file deletion during disposal of incident records can leave recoverable remnants of sensitive security data."
        }
    ]
}

insecure_disposal_of_closed_incident_records[_insecure_disposal_of_closed_incident_records_def] if {
    not input.certified_destruction_procedure_enforced
}

insecure_disposal_of_closed_incident_records[_insecure_disposal_of_closed_incident_records_def] if {
    input.certified_destruction_procedure_enforced == true
    not input.residual_data_locations_addressed
}

insecure_disposal_of_closed_incident_records[_insecure_disposal_of_closed_incident_records_def] if {
    input.incident_record_retention_policy_status in ["absent", "documented_not_enforced"]
}

exposures contains _insecure_disposal_of_closed_incident_records_def if {
    count(insecure_disposal_of_closed_incident_records) > 0
}
