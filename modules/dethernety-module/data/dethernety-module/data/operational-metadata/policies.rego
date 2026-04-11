package _dt_built_in.exposures.operational_metadata



_misclassification_of_performance_data_as_non_sensitive_def := {
    "name": "Misclassification Of Performance Data As Non Sensitive",
    "description": "Performance and characteristics data is routinely tagged as internal or public rather than operationally sensitive, bypassing downstream handling controls such as encryption-at-rest requirements, access restrictions, and audit logging. Without enforced classification labels, the data is treated as low-value and exposed to broader audiences than warranted.",
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
            "relevance": "Misclassifying performance data as non-sensitive exposes information repositories to unauthorized access and collection by threat actors."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Incorrectly labeled sensitive performance data in storage is at risk of manipulation if not properly protected through classification controls."
        }
    ]
}

misclassification_of_performance_data_as_non_sensitive[_misclassification_of_performance_data_as_non_sensitive_def] if {
    input.performance_data_classification_label in ["public", "internal"]
}

misclassification_of_performance_data_as_non_sensitive[_misclassification_of_performance_data_as_non_sensitive_def] if {
    not input.performance_data_classification_label in ["confidential", "restricted", "operationally_sensitive"]
    not input.encryption_at_rest_enforced
}

misclassification_of_performance_data_as_non_sensitive[_misclassification_of_performance_data_as_non_sensitive_def] if {
    not input.performance_data_classification_label in ["confidential", "restricted", "operationally_sensitive"]
    not input.access_scope_restricted
}

misclassification_of_performance_data_as_non_sensitive[_misclassification_of_performance_data_as_non_sensitive_def] if {
    not input.performance_data_classification_label in ["confidential", "restricted", "operationally_sensitive"]
    not input.audit_logging_enabled_for_performance_data
}

exposures contains _misclassification_of_performance_data_as_non_sensitive_def if {
    count(misclassification_of_performance_data_as_non_sensitive) > 0
}

_excessive_retention_beyond_operational_need_def := {
    "name": "Excessive Retention Beyond Operational Need",
    "description": "Performance data is retained indefinitely or well beyond defined retention windows because no automated expiry or lifecycle policy is enforced on this data class. Accumulation over time increases the historical depth available to an adversary, enabling long-range behavioral profiling and capacity planning intelligence.",
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
            "relevance": "Absence of lifecycle-triggered deletion policies directly enables excessive retention of performance data beyond operational need."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1074",
            "name": "Data Staged",
            "relevance": "Excessively retained data accumulates in staged storage locations, increasing the attack surface for unauthorized data collection."
        }
    ]
}

excessive_retention_beyond_operational_need[_excessive_retention_beyond_operational_need_def] if {
    not input.retention_policy_enforced
}

excessive_retention_beyond_operational_need[_excessive_retention_beyond_operational_need_def] if {
    input.defined_retention_window_days == 0
}

excessive_retention_beyond_operational_need[_excessive_retention_beyond_operational_need_def] if {
    input.defined_retention_window_days > 0
    input.oldest_record_age_days > 0
    input.oldest_record_age_days
}

exposures contains _excessive_retention_beyond_operational_need_def if {
    count(excessive_retention_beyond_operational_need) > 0
}

_absence_of_encryption_at_rest_for_stored_metrics_def := {
    "name": "Absence Of Encryption At Rest For Stored Metrics",
    "description": "Stored performance datasets and characteristic snapshots lack encryption-at-rest controls because the data was not classified at a tier that mandates encryption. Plaintext storage means any party with storage-layer access \u2014 including backup operators, storage admins, or compromised credentials \u2014 can read operational profiles without further exploitation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Unencrypted stored metrics are vulnerable to direct manipulation by attackers who gain storage access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Without encryption at rest, metrics stored in cloud storage can be accessed and exfiltrated by adversaries exploiting misconfigured permissions."
        }
    ]
}

absence_of_encryption_at_rest_for_stored_metrics[_absence_of_encryption_at_rest_for_stored_metrics_def] if {
    not input.encryption_at_rest_enforced
}

absence_of_encryption_at_rest_for_stored_metrics[_absence_of_encryption_at_rest_for_stored_metrics_def] if {
    input.performance_data_classification_label in ["public", "internal_low"]
    not input.encryption_at_rest_enforced
}

absence_of_encryption_at_rest_for_stored_metrics[_absence_of_encryption_at_rest_for_stored_metrics_def] if {
    input.encryption_policy_exemption_granted == true
    not input.encryption_at_rest_enforced
}

exposures contains _absence_of_encryption_at_rest_for_stored_metrics_def if {
    count(absence_of_encryption_at_rest_for_stored_metrics) > 0
}

_overly_broad_read_access_to_raw_performance_records_def := {
    "name": "Overly Broad Read Access To Raw Performance Records",
    "description": "Access control policies grant read permissions on raw, unaggregated performance data to roles that require only summary reports. Raw records contain granular timing, throughput, and anomaly data that exceed the least-privilege principle. Excessive access increases the blast radius of any compromised credential or malicious insider.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222.001",
            "name": "Windows File and Directory Permissions Modification",
            "relevance": "Overly broad read permissions on performance records reflect improper access control settings that attackers can exploit or that expose data to unauthorized users."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1069",
            "name": "Permission Groups Discovery",
            "relevance": "Adversaries can discover overly permissive groups with read access to raw performance records to identify targets for data collection."
        }
    ]
}

overly_broad_read_access_to_raw_performance_records[_overly_broad_read_access_to_raw_performance_records_def] if {
    not input.raw_access_scoped_to_authorized_roles_only
}

overly_broad_read_access_to_raw_performance_records[_overly_broad_read_access_to_raw_performance_records_def] if {
    input.raw_performance_data_reader_roles
    input.roles_requiring_only_summary_access
    count(input.raw_performance_data_reader_roles) > 0
    count(input.roles_requiring_only_summary_access) > 0
    not input.raw_access_scoped_to_authorized_roles_only
}

exposures contains _overly_broad_read_access_to_raw_performance_records_def if {
    count(overly_broad_read_access_to_raw_performance_records) > 0
}

_no_anonymization_or_aggregation_before_cross_team_sharing_def := {
    "name": "No Anonymization Or Aggregation Before Cross Team Sharing",
    "description": "Performance and characteristics data is shared across organizational units or with third-party vendors in raw form without anonymization, aggregation, or masking of system-identifying attributes. Recipients gain full operational fingerprints beyond what their function requires, expanding the exposure surface.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589",
            "name": "Gather Victim Identity Information",
            "relevance": "Sharing unanonymized performance data across teams exposes identifiable information that adversaries or insiders can harvest for reconnaissance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1591.002",
            "name": "Business Relationships",
            "relevance": "Cross-team sharing without anonymization can inadvertently reveal organizational relationships and sensitive operational details to unintended parties."
        }
    ]
}

no_anonymization_or_aggregation_before_cross_team_sharing[_no_anonymization_or_aggregation_before_cross_team_sharing_def] if {
    input.cross_team_sharing_enabled == true
    not input.anonymization_applied
    input.data_granularity_level == "raw"
}

exposures contains _no_anonymization_or_aggregation_before_cross_team_sharing_def if {
    count(no_anonymization_or_aggregation_before_cross_team_sharing) > 0
}

_non_compliant_cross_border_transfer_of_operationally_sensitive_metrics_def := {
    "name": "Non Compliant Cross Border Transfer Of Operationally Sensitive Metrics",
    "description": "System performance data transferred to offshore analytics platforms or cloud regions is not screened against cross-border data transfer obligations. Operational characteristics data may be subject to export control or sector-specific data residency rules; unreviewed transfers create regulatory and intelligence-exposure risk.",
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
            "relevance": "Non-compliant cross-border transfers of sensitive metrics mirror the technique of transferring data to external cloud accounts outside authorized boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1029",
            "name": "Scheduled Transfer",
            "relevance": "Scheduled automated transfers of operationally sensitive metrics across borders without compliance checks align with this exfiltration scheduling technique."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unauthorized cross-border data transfers may use alternative protocols to bypass data loss prevention and compliance controls."
        }
    ]
}

non_compliant_cross_border_transfer_of_operationally_sensitive_metrics[_non_compliant_cross_border_transfer_of_operationally_sensitive_metrics_def] if {
    input.destination_region_type == "offshore_foreign"
    not input.cross_border_transfer_screening_enabled
}

non_compliant_cross_border_transfer_of_operationally_sensitive_metrics[_non_compliant_cross_border_transfer_of_operationally_sensitive_metrics_def] if {
    input.destination_region_type == "unknown"
    not input.cross_border_transfer_screening_enabled
}

non_compliant_cross_border_transfer_of_operationally_sensitive_metrics[_non_compliant_cross_border_transfer_of_operationally_sensitive_metrics_def] if {
    count(input.applicable_transfer_obligations) > 0
    not input.cross_border_transfer_screening_enabled
}

exposures contains _non_compliant_cross_border_transfer_of_operationally_sensitive_metrics_def if {
    count(non_compliant_cross_border_transfer_of_operationally_sensitive_metrics) > 0
}

_inadequate_disposal_procedures_for_decommissioned_performance_datasets_def := {
    "name": "Inadequate Disposal Procedures For Decommissioned Performance Datasets",
    "description": "When performance data reaches end-of-retention or systems are decommissioned, disposal procedures do not include verified deletion or cryptographic erasure of operational metrics. Residual data on backup media, archived storage, or exported snapshots remains readable, enabling post-decommission reconnaissance.",
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
            "relevance": "Inadequate disposal procedures fail to ensure proper destruction of decommissioned datasets, leaving sensitive performance data recoverable."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Proper secure file deletion procedures are critical during decommissioning; absence of these controls leaves residual data exposed."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Implementing lifecycle-triggered deletion is a direct countermeasure to inadequate disposal of decommissioned performance datasets."
        }
    ]
}

inadequate_disposal_procedures_for_decommissioned_performance_datasets[_inadequate_disposal_procedures_for_decommissioned_performance_datasets_def] if {
    not input.verified_deletion_enforced
}

inadequate_disposal_procedures_for_decommissioned_performance_datasets[_inadequate_disposal_procedures_for_decommissioned_performance_datasets_def] if {
    input.disposal_procedure_status in ["not_initiated", "completed_unverified"]
}

inadequate_disposal_procedures_for_decommissioned_performance_datasets[_inadequate_disposal_procedures_for_decommissioned_performance_datasets_def] if {
    input.disposal_procedure_status == "in_progress"
    count(input.residual_data_storage_types) > 0
}

exposures contains _inadequate_disposal_procedures_for_decommissioned_performance_datasets_def if {
    count(inadequate_disposal_procedures_for_decommissioned_performance_datasets) > 0
}
