package _dt_built_in.exposures.employee_work_files



_missing_or_inconsistent_classification_labels_def := {
    "name": "Missing Or Inconsistent Classification Labels",
    "description": "Documents lack mandatory sensitivity labels or carry incorrect classifications, preventing downstream controls (access restrictions, encryption, retention rules) from being applied correctly. Employees may not label documents at creation time, or use informal ad-hoc labels that automated tools cannot enforce.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_or_inconsistent_classification_labels[_missing_or_inconsistent_classification_labels_def] if {
    input.classification_label_enforcement in ["none", "optional"]
}

missing_or_inconsistent_classification_labels[_missing_or_inconsistent_classification_labels_def] if {
    input.documents_with_missing_labels_percent > 10
}

missing_or_inconsistent_classification_labels[_missing_or_inconsistent_classification_labels_def] if {
    input.informal_labels_detected == true
}

exposures contains _missing_or_inconsistent_classification_labels_def if {
    count(missing_or_inconsistent_classification_labels) > 0
}

_overly_broad_access_controls_on_confidential_documents_def := {
    "name": "Overly Broad Access Controls On Confidential Documents",
    "description": "Confidential documents are accessible to employees beyond those with a legitimate need-to-know, due to group or role permissions that are not scoped to document sensitivity. This inflates the blast radius of any account compromise or insider threat event.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

overly_broad_access_controls_on_confidential_documents[_overly_broad_access_controls_on_confidential_documents_def] if {
    input.document_sensitivity_label in ["confidential", "restricted"]
    input.access_scope in ["department_or_role", "org_wide"]
}

overly_broad_access_controls_on_confidential_documents[_overly_broad_access_controls_on_confidential_documents_def] if {
    input.document_sensitivity_label in ["confidential", "restricted"]
    not input.need_to_know_enforced
}

overly_broad_access_controls_on_confidential_documents[_overly_broad_access_controls_on_confidential_documents_def] if {
    input.document_sensitivity_label in ["confidential", "restricted"]
    input.external_sharing_enabled == true
}

exposures contains _overly_broad_access_controls_on_confidential_documents_def if {
    count(overly_broad_access_controls_on_confidential_documents) > 0
}

_encryption_not_enforced_at_rest_for_confidential_documents_def := {
    "name": "Encryption Not Enforced At Rest For Confidential Documents",
    "description": "Confidential documents are stored without encryption or with encryption that is not tied to classification level, meaning physical or logical access to storage yields plaintext data. No document-level or rights-management encryption is applied to enforce protection independent of storage controls.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

encryption_not_enforced_at_rest_for_confidential_documents[_encryption_not_enforced_at_rest_for_confidential_documents_def] if {
    not input.document_level_encryption_enforced
}

encryption_not_enforced_at_rest_for_confidential_documents[_encryption_not_enforced_at_rest_for_confidential_documents_def] if {
    not input.storage_encryption_tied_to_classification
}

encryption_not_enforced_at_rest_for_confidential_documents[_encryption_not_enforced_at_rest_for_confidential_documents_def] if {
    input.plaintext_confidential_documents_detected == true
}

exposures contains _encryption_not_enforced_at_rest_for_confidential_documents_def if {
    count(encryption_not_enforced_at_rest_for_confidential_documents) > 0
}

_retention_schedule_non_compliance_def := {
    "name": "Retention Schedule Non Compliance",
    "description": "Confidential documents are retained beyond their defined retention period or deleted before mandatory minimum retention windows expire. Absence of automated retention enforcement means documents accumulate indefinitely or are disposed of without audit trail, creating regulatory and legal exposure.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

retention_schedule_non_compliance[_retention_schedule_non_compliance_def] if {
    not input.retention_policy_assigned
}

retention_schedule_non_compliance[_retention_schedule_non_compliance_def] if {
    input.retention_policy_assigned == true
    not input.automated_retention_enforcement_enabled
}

retention_schedule_non_compliance[_retention_schedule_non_compliance_def] if {
    input.retention_policy_assigned == true
    input.automated_retention_enforcement_enabled == true
    not input.disposal_audit_trail_available
}

retention_schedule_non_compliance[_retention_schedule_non_compliance_def] if {
    input.retention_policy_assigned == true
    input.automated_retention_enforcement_enabled == true
    input.last_retention_audit_days_ago > 365
}

exposures contains _retention_schedule_non_compliance_def if {
    count(retention_schedule_non_compliance) > 0
}

_inadequate_disposal_and_sanitization_procedures_def := {
    "name": "Inadequate Disposal And Sanitization Procedures",
    "description": "Confidential documents are not disposed of in accordance with sensitivity class requirements. Soft-deletion without secure overwrite, retention in archive or backup after logical deletion, or improper physical destruction of printed copies leaves recoverable confidential content outside active lifecycle controls.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

inadequate_disposal_and_sanitization_procedures[_inadequate_disposal_and_sanitization_procedures_def] if {
    input.deletion_method in ["soft_delete", "logical_delete", "no_defined_process"]
}

inadequate_disposal_and_sanitization_procedures[_inadequate_disposal_and_sanitization_procedures_def] if {
    input.retained_in_backup_after_deletion == true
}

inadequate_disposal_and_sanitization_procedures[_inadequate_disposal_and_sanitization_procedures_def] if {
    not input.physical_destruction_verified
}

exposures contains _inadequate_disposal_and_sanitization_procedures_def if {
    count(inadequate_disposal_and_sanitization_procedures) > 0
}

_unauthorized_cross_border_transfer_of_confidential_documents_def := {
    "name": "Unauthorized Cross Border Transfer Of Confidential Documents",
    "description": "Confidential documents containing personal data, trade secrets, or regulated information are transferred to recipients or storage in jurisdictions without equivalent data protection adequacy, violating GDPR, data localization laws, or contractual obligations. No technical or procedural controls validate destination jurisdiction before transfer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unauthorized_cross_border_transfer_of_confidential_documents[_unauthorized_cross_border_transfer_of_confidential_documents_def] if {
    input.document_contains_regulated_data == true
    not input.destination_jurisdiction_validated
}

unauthorized_cross_border_transfer_of_confidential_documents[_unauthorized_cross_border_transfer_of_confidential_documents_def] if {
    input.document_contains_regulated_data == true
    input.transfer_destination_adequacy_status in ["inadequate", "unknown"]
}

exposures contains _unauthorized_cross_border_transfer_of_confidential_documents_def if {
    count(unauthorized_cross_border_transfer_of_confidential_documents) > 0
}

_absence_of_anonymization_or_masking_in_shared_document_copies_def := {
    "name": "Absence Of Anonymization Or Masking In Shared Document Copies",
    "description": "When confidential documents containing personal or sensitive data are shared for lower-trust purposes (review, collaboration, external sharing), no masking or redaction controls are applied. Full-fidelity confidential copies are shared where redacted or anonymized versions would suffice, expanding unnecessary exposure.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

absence_of_anonymization_or_masking_in_shared_document_copies[_absence_of_anonymization_or_masking_in_shared_document_copies_def] if {
    input.document_contains_regulated_data == true
    input.sharing_trust_level == "external"
    not input.masking_controls_enforced
}

absence_of_anonymization_or_masking_in_shared_document_copies[_absence_of_anonymization_or_masking_in_shared_document_copies_def] if {
    input.document_contains_regulated_data == true
    input.sharing_trust_level == "internal_low_trust"
    not input.masking_controls_enforced
}

exposures contains _absence_of_anonymization_or_masking_in_shared_document_copies_def if {
    count(absence_of_anonymization_or_masking_in_shared_document_copies) > 0
}
