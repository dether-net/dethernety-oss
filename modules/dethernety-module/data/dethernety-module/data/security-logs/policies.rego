package _dt_built_in.exposures.security_logs

_insufficient_sensitivity_classification_def := {
    "name": "Insufficient Sensitivity Classification",
    "description": "Metadata logs are collectively assigned a low or generic classification label that does not reflect their aggregate sensitivity. Individual fields such as IP addresses, user identifiers, or timing data may be treated as non-sensitive, while their combination enables behavioral profiling and re-identification. Absence of a formal aggregate reclassification policy means the dataset operates under weaker controls than warranted.",
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
            "relevance": "Insufficient sensitivity classification enables attackers to access and exfiltrate data from repositories without triggering appropriate access controls or alerts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589",
            "name": "Gather Victim Identity Information",
            "relevance": "Improperly classified sensitive data can expose identity information that adversaries gather for reconnaissance and targeting purposes."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_sensitivity_classification[_insufficient_sensitivity_classification_def] if {
    input.log_classification_label in ["public", "internal"]
    count(input.sensitive_field_types_present) >= 2
}

insufficient_sensitivity_classification[_insufficient_sensitivity_classification_def] if {
    not input.aggregate_reclassification_policy_exists
    count(input.sensitive_field_types_present) >= 2
}

exposures contains _insufficient_sensitivity_classification_def if {
    count(insufficient_sensitivity_classification) > 0
}

_undefined_or_unenforced_retention_schedule_def := {
    "name": "Undefined Or Unenforced Retention Schedule",
    "description": "No formally defined or technically enforced retention schedule governs how long operational metadata is retained. Logs may persist indefinitely beyond their operational or legal necessity, expanding the window of exposure for sensitive behavioral data. Conversely, premature deletion may violate compliance mandates requiring audit trails. Neither extreme satisfies data minimization or evidentiary requirements.",
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
            "relevance": "Undefined retention schedules can be exploited or misconfigured to trigger premature or improper deletion of data through lifecycle policies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Without enforced retention schedules, stored data is vulnerable to manipulation or tampering over extended periods without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Unenforced retention policies leave no guardrails to prevent unauthorized or premature deletion of files that should be preserved."
        }
    ],
    "attack_vector": "LOCAL"
}

undefined_or_unenforced_retention_schedule[_undefined_or_unenforced_retention_schedule_def] if {
    not input.retention_schedule_defined
}

undefined_or_unenforced_retention_schedule[_undefined_or_unenforced_retention_schedule_def] if {
    input.retention_schedule_defined == true
    not input.retention_schedule_enforced
}

undefined_or_unenforced_retention_schedule[_undefined_or_unenforced_retention_schedule_def] if {
    input.retention_schedule_defined == true
    input.retention_schedule_enforced == true
    input.log_maximum_retention_days == 0
}

exposures contains _undefined_or_unenforced_retention_schedule_def if {
    count(undefined_or_unenforced_retention_schedule) > 0
}

_absence_of_pii_and_quasi_identifier_masking_def := {
    "name": "Absence Of Pii And Quasi Identifier Masking",
    "description": "Log records contain unmasked quasi-identifiers such as internal usernames, device identifiers, source IP addresses, or session tokens. No anonymization or pseudonymization policy is applied at ingestion or storage. This enables re-identification of individuals from operational metadata, creating privacy regulation exposure under frameworks such as GDPR or CCPA, and expanding the blast radius of any unauthorized access event.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589",
            "name": "Gather Victim Identity Information",
            "relevance": "Unmasked PII and quasi-identifiers directly enable adversaries to gather and exploit victim identity information for targeting."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.005",
            "name": "IP Addresses",
            "relevance": "Absence of masking for quasi-identifiers such as IP addresses exposes network identity information that adversaries can collect and use."
        }
    ],
    "attack_vector": "LOCAL"
}

absence_of_pii_and_quasi_identifier_masking[_absence_of_pii_and_quasi_identifier_masking_def] if {
    not input.pii_anonymization_policy_applied
    count(input.unmasked_quasi_identifier_fields) > 0
}

absence_of_pii_and_quasi_identifier_masking[_absence_of_pii_and_quasi_identifier_masking_def] if {
    input.pii_anonymization_policy_applied == true
    count(input.unmasked_quasi_identifier_fields) > 0
}

exposures contains _absence_of_pii_and_quasi_identifier_masking_def if {
    count(absence_of_pii_and_quasi_identifier_masking) > 0
}

_overly_broad_read_access_to_metadata_aggregates_def := {
    "name": "Overly Broad Read Access To Metadata Aggregates",
    "description": "Access controls on the metadata collection are role-agnostic or rely on coarse-grained permissions, allowing personnel without operational need to query or export the full dataset. Metadata aggregates reveal access patterns, behavioral baselines, and network activity that should be restricted to specific roles such as security operations or compliance. Lack of field-level or purpose-bound access controls amplifies insider threat risk.",
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
            "relevance": "Overly broad read access allows adversaries to collect and aggregate sensitive metadata from information repositories they should not have access to."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "Excessive read permissions on metadata aggregates facilitate automated bulk collection of sensitive information by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1069.003",
            "name": "Cloud Groups",
            "relevance": "Overly broad access to metadata aggregates often stems from misconfigured cloud group permissions that grant unintended read access."
        }
    ],
    "attack_vector": "LOCAL"
}

overly_broad_read_access_to_metadata_aggregates[_overly_broad_read_access_to_metadata_aggregates_def] if {
    input.metadata_access_control_model == "none"
}

overly_broad_read_access_to_metadata_aggregates[_overly_broad_read_access_to_metadata_aggregates_def] if {
    input.metadata_access_control_model == "coarse"
    not input.field_level_access_control_enabled
    not input.purpose_bound_export_controls_enforced
}

overly_broad_read_access_to_metadata_aggregates[_overly_broad_read_access_to_metadata_aggregates_def] if {
    input.metadata_access_control_model == "fine_grained"
    not input.field_level_access_control_enabled
    not input.purpose_bound_export_controls_enforced
}

exposures contains _overly_broad_read_access_to_metadata_aggregates_def if {
    count(overly_broad_read_access_to_metadata_aggregates) > 0
}

_missing_encryption_at_rest_for_sensitive_log_fields_def := {
    "name": "Missing Encryption At Rest For Sensitive Log Fields",
    "description": "Sensitive metadata fields \u2014 including user identifiers, session tokens, or behavioral indicators \u2014 are stored in plaintext within the log repository. No field-level or column-level encryption is applied to protect high-sensitivity attributes. Any party with read access to the storage layer obtains full plaintext values, bypassing logical access controls and increasing exposure during unauthorized access scenarios.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Unencrypted log fields allow adversaries who enumerate logs to directly read sensitive information without needing to bypass any cryptographic protections."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Sensitive log fields lacking encryption may contain credentials stored in plaintext that adversaries can directly extract."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Missing encryption at rest for cloud-stored log fields exposes sensitive data to adversaries who gain access to cloud storage resources."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_encryption_at_rest_for_sensitive_log_fields[_missing_encryption_at_rest_for_sensitive_log_fields_def] if {
    count(input.sensitive_field_types_present) > 0
    not input.field_level_encryption_enabled
    not input.pii_anonymization_policy_applied
}

exposures contains _missing_encryption_at_rest_for_sensitive_log_fields_def if {
    count(missing_encryption_at_rest_for_sensitive_log_fields) > 0
}

_non_compliant_cross_border_transfer_of_operational_metadata_def := {
    "name": "Non Compliant Cross Border Transfer Of Operational Metadata",
    "description": "Operational metadata containing identifiers tied to individuals or systems in jurisdictions with strict data localization or cross-border transfer requirements is replicated or exported without adequate legal basis, adequacy decisions, or transfer mechanisms. The aggregate nature of the dataset may trigger jurisdictional obligations that are not recognized when the data is classified generically as non-personal operational telemetry.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "name": "Transmitted Data Manipulation",
            "relevance": "Cross-border transfers of operational metadata are at risk of interception and manipulation in transit by adversaries or state actors."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1591.001",
            "name": "Determine Physical Locations",
            "relevance": "Operational metadata transferred across borders can reveal physical location information that adversaries use for reconnaissance."
        }
    ],
    "attack_vector": "NETWORK"
}

non_compliant_cross_border_transfer_of_operational_metadata[_non_compliant_cross_border_transfer_of_operational_metadata_def] if {
    input.cross_border_transfer_enabled == true
    input.metadata_contains_individual_identifiers == true
    input.transfer_legal_basis == "none"
}

exposures contains _non_compliant_cross_border_transfer_of_operational_metadata_def if {
    count(non_compliant_cross_border_transfer_of_operational_metadata) > 0
}

_inadequate_secure_disposal_procedures_def := {
    "name": "Inadequate Secure Disposal Procedures",
    "description": "No formally documented or technically enforced disposal procedure exists for expired or superseded log data. Deletion operations may be logical rather than cryptographic, leaving residual data recoverable from storage media. Absence of disposal attestation records means there is no verifiable evidence of compliant data destruction, creating audit gaps and potential for recovery of sensitive historical metadata.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Inadequate disposal procedures fail to ensure complete and irreversible data destruction, leaving residual data recoverable by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Poor secure disposal processes can result in data being improperly wiped, leaving it subject to manipulation or recovery."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Inadequate disposal procedures may fail to properly configure lifecycle-triggered deletion, resulting in data not being securely removed as intended."
        }
    ],
    "attack_vector": "LOCAL"
}

inadequate_secure_disposal_procedures[_inadequate_secure_disposal_procedures_def] if {
    not input.formal_disposal_procedure_documented
}

inadequate_secure_disposal_procedures[_inadequate_secure_disposal_procedures_def] if {
    input.disposal_method in ["none", "logical_deletion"]
}

inadequate_secure_disposal_procedures[_inadequate_secure_disposal_procedures_def] if {
    not input.disposal_attestation_records_maintained
}

exposures contains _inadequate_secure_disposal_procedures_def if {
    count(inadequate_secure_disposal_procedures) > 0
}
