package _dt_built_in.exposures.media_files

_undefined_sensitivity_classification_def := {
    "name": "Undefined Sensitivity Classification",
    "description": "The data lacks a confirmed sensitivity classification. Without a formal classification label, handling controls such as encryption, access restrictions, and retention rules cannot be consistently enforced. Data processors may apply no-classification defaults, treating personal data as non-sensitive.",
    "type": "insecure_default",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "Without sensitivity classification, automated collection of data cannot distinguish between sensitive and non-sensitive data, increasing exposure risk."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Unclassified data in cloud storage is more vulnerable to unauthorized access as protective controls cannot be applied appropriately."
        }
    ]
}

undefined_sensitivity_classification[_undefined_sensitivity_classification_def] if {
    input.personal_data_indicator == true
    input.sensitivity_classification_label in ["unclassified", "pending_review"]
}

undefined_sensitivity_classification[_undefined_sensitivity_classification_def] if {
    input.personal_data_indicator == true
    not input.sensitivity_classification_label
}

exposures contains _undefined_sensitivity_classification_def if {
    count(undefined_sensitivity_classification) > 0
}

_absent_or_undefined_retention_schedule_def := {
    "name": "Absent Or Undefined Retention Schedule",
    "description": "No documented retention period is enforced for this data. Personally identifiable information retained beyond its lawful purpose violates regulations such as GDPR Article 5(1)(e) and CCPA. Data may accumulate indefinitely, increasing exposure window and regulatory liability.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Absent retention schedules directly relate to lifecycle-triggered deletion failures, where data is not properly purged at end-of-life."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Data retained indefinitely without schedules remains accessible in repositories, increasing the attack surface for data collection."
        }
    ]
}

absent_or_undefined_retention_schedule[_absent_or_undefined_retention_schedule_def] if {
    not input.retention_schedule_defined
    input.sensitivity_classification_label in ["confirmed_pii", "possibly_pii", "unclassified"]
}

absent_or_undefined_retention_schedule[_absent_or_undefined_retention_schedule_def] if {
    input.retention_schedule_defined == true
    input.retention_enforcement_mechanism == "none"
    input.sensitivity_classification_label in ["confirmed_pii", "possibly_pii", "unclassified"]
}

exposures contains _absent_or_undefined_retention_schedule_def if {
    count(absent_or_undefined_retention_schedule) > 0
}

_inadequate_access_control_granularity_def := {
    "name": "Inadequate Access Control Granularity",
    "description": "Without confirmed sensitivity classification, role-based or attribute-based access controls may not have been scoped to restrict personal data access to authorized personnel only. Over-permissioned roles or shared credentials may expose personal data to unauthorized readers.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Coarse-grained access controls allow valid accounts to access resources beyond their required scope, enabling lateral movement and data access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Inadequate granularity in access controls may allow attackers to exploit temporary elevated cloud access mechanisms."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.009",
            "name": "Conditional Access Policies",
            "relevance": "Insufficient granularity in conditional access policies is a direct manifestation of inadequate access control granularity."
        }
    ]
}

inadequate_access_control_granularity[_inadequate_access_control_granularity_def] if {
    not input.sensitivity_classification_label
    not input.authorized_roles_defined
}

inadequate_access_control_granularity[_inadequate_access_control_granularity_def] if {
    not input.sensitivity_classification_label
    input.access_control_model in ["shared_credentials", "overpermissioned_role", "none"]
}

inadequate_access_control_granularity[_inadequate_access_control_granularity_def] if {
    input.sensitivity_classification_label == true
    not input.authorized_roles_defined
    input.access_control_model in ["shared_credentials", "overpermissioned_role", "none"]
}

exposures contains _inadequate_access_control_granularity_def if {
    count(inadequate_access_control_granularity) > 0
}

_missing_data_at_rest_encryption_def := {
    "name": "Missing Data At Rest Encryption",
    "description": "Persistent storage of potentially personal information without encryption at rest exposes the data to direct physical or logical access. If encryption has not been mandated due to unresolved classification, plaintext personal data may reside on storage media.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Missing encryption at rest exposes private keys and credentials stored on disk to direct access by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Without encryption at rest, stored data can be directly manipulated or read by unauthorized parties."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052",
            "name": "Exfiltration Over Physical Medium",
            "relevance": "Unencrypted data at rest is especially vulnerable to physical medium exfiltration if storage devices are physically accessed."
        }
    ]
}

missing_data_at_rest_encryption[_missing_data_at_rest_encryption_def] if {
    input.sensitivity_classification_label == "classified_personal"
    not input.encryption_at_rest_enabled
}

missing_data_at_rest_encryption[_missing_data_at_rest_encryption_def] if {
    input.sensitivity_classification_label in ["unclassified", "pending_review"]
    not input.encryption_at_rest_enabled
}

missing_data_at_rest_encryption[_missing_data_at_rest_encryption_def] if {
    input.encryption_policy_mandated == true
    not input.encryption_at_rest_enabled
}

exposures contains _missing_data_at_rest_encryption_def if {
    count(missing_data_at_rest_encryption) > 0
}

_absent_anonymization_or_pseudonymization_controls_def := {
    "name": "Absent Anonymization Or Pseudonymization Controls",
    "description": "Data that possibly contains personal information may not have undergone anonymization or pseudonymization, meaning individuals remain identifiable in stored records. This fails privacy-by-design principles and regulatory requirements under GDPR Recital 26 and similar frameworks.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589",
            "name": "Gather Victim Identity Information",
            "relevance": "Without anonymization or pseudonymization, personal identity information is directly exposed and can be gathered by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1597.002",
            "name": "Purchase Technical Data",
            "relevance": "Non-anonymized personal data can be purchased or obtained by adversaries from breached or leaked datasets."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Absent anonymization controls mean that data repositories contain identifiable personal data accessible to adversaries."
        }
    ]
}

absent_anonymization_or_pseudonymization_controls[_absent_anonymization_or_pseudonymization_controls_def] if {
    input.sensitivity_classification_label in ["confirmed_pii", "possible_pii", "unclassified"]
    not input.anonymization_pseudonymization_applied
}

absent_anonymization_or_pseudonymization_controls[_absent_anonymization_or_pseudonymization_controls_def] if {
    not input.privacy_by_design_assessment_completed
    not input.anonymization_pseudonymization_applied
}

exposures contains _absent_anonymization_or_pseudonymization_controls_def if {
    count(absent_anonymization_or_pseudonymization_controls) > 0
}

_non_compliant_cross_border_transfer_def := {
    "name": "Non Compliant Cross Border Transfer",
    "description": "Persistent storage of personal information may span jurisdictions without adequate transfer mechanisms (e.g., Standard Contractual Clauses, adequacy decisions). If the data's sensitivity is unconfirmed, cross-border transfer assessments and data residency controls may never have been triggered or validated.",
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
            "relevance": "Non-compliant cross-border transfers mirror the technique of transferring data to cloud accounts in unauthorized jurisdictions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Cross-border data transfers often involve cloud storage access from regions that may not comply with data residency requirements."
        }
    ]
}

non_compliant_cross_border_transfer[_non_compliant_cross_border_transfer_def] if {
    input.cross_border_transfer_mechanism == "none"
    not input.data_residency_controls_enforced
}

non_compliant_cross_border_transfer[_non_compliant_cross_border_transfer_def] if {
    input.cross_border_transfer_mechanism == "none"
    not input.sensitivity_classification_label
}

exposures contains _non_compliant_cross_border_transfer_def if {
    count(non_compliant_cross_border_transfer) > 0
}

_insecure_or_incomplete_data_disposal_def := {
    "name": "Insecure Or Incomplete Data Disposal",
    "description": "Without a defined classification and retention schedule, end-of-life disposal procedures for this data may not exist or may be applied inconsistently. Personal data may persist on decommissioned media, in backups, or in archives beyond its authorized lifecycle, creating residual exposure.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Insecure disposal relates directly to improper or incomplete data destruction processes that leave residual data recoverable."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Incomplete data disposal often involves inadequate file deletion methods that do not securely remove data from storage media."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052",
            "name": "Exfiltration Over Physical Medium",
            "relevance": "Insecurely disposed physical media can be recovered and exfiltrated by adversaries who gain access to discarded storage devices."
        }
    ]
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    input.sensitivity_classification_label in ["unclassified", "pending"]
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    input.sensitivity_classification_label == "classified"
    not input.retention_schedule_defined
}

insecure_or_incomplete_data_disposal[_insecure_or_incomplete_data_disposal_def] if {
    input.sensitivity_classification_label == "classified"
    input.retention_schedule_defined == true
    not input.disposal_procedure_defined
}

exposures contains _insecure_or_incomplete_data_disposal_def if {
    count(insecure_or_incomplete_data_disposal) > 0
}
