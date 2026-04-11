package _dt_built_in.exposures.user_input



_ambiguous_classification_enforcement_def := {
    "name": "Ambiguous Classification Enforcement",
    "description": "The qualifier 'potentially includes PII' indicates classification has not been definitively determined or enforced. Without a confirmed classification label, mandatory handling controls tied to PII classification \u2014 such as encryption-at-rest requirements, access restrictions, and audit logging \u2014 cannot be consistently applied, leaving the data in a policy gap where protective controls are optional rather than mandatory.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1679",
            "name": "Selective Exclusion",
            "relevance": "Selective exclusion directly relates to ambiguous classification enforcement where certain data or assets may be inconsistently or selectively excluded from security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027",
            "name": "Obfuscated Files or Information",
            "relevance": "Ambiguous classification can allow obfuscation techniques to go undetected when data sensitivity labels are unclear or inconsistently applied."
        }
    ]
}

ambiguous_classification_enforcement[_ambiguous_classification_enforcement_def] if {
    not input.pii_classification_confirmed
    not input.mandatory_controls_enforced
}

ambiguous_classification_enforcement[_ambiguous_classification_enforcement_def] if {
    not input.pii_classification_confirmed
    not input.retention_boundary_defined
}

ambiguous_classification_enforcement[_ambiguous_classification_enforcement_def] if {
    not input.mandatory_controls_enforced
    not input.retention_boundary_defined
}

exposures contains _ambiguous_classification_enforcement_def if {
    count(ambiguous_classification_enforcement) > 0
}

_undefined_temporary_retention_boundary_def := {
    "name": "Undefined Temporary Retention Boundary",
    "description": "Labeling storage as 'temporary' without a defined maximum retention period, automated expiry trigger, or enforced deletion schedule means data may persist indefinitely. Retention compliance requires specific time-bound commitments; vague temporariness fails regulatory obligations (e.g., GDPR storage limitation principle) and expands the exposure window proportionally to the delay in deletion.",
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
            "relevance": "Undefined retention boundaries in cloud storage environments expose data to unauthorized access over extended unmanaged periods."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Without defined retention boundaries, temporarily stored data remains accessible and vulnerable to manipulation by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Lifecycle-triggered deletion is directly relevant as undefined temporary retention boundaries mean deletion policies are not properly configured or enforced."
        }
    ]
}

undefined_temporary_retention_boundary[_undefined_temporary_retention_boundary_def] if {
    not input.maximum_retention_period_defined
    input.automated_expiry_mechanism == "none"
}

undefined_temporary_retention_boundary[_undefined_temporary_retention_boundary_def] if {
    input.pii_classification_confirmed == "unclassified"
    input.automated_expiry_mechanism == "none"
}

undefined_temporary_retention_boundary[_undefined_temporary_retention_boundary_def] if {
    input.pii_classification_confirmed == "confirmed_pii"
    not input.maximum_retention_period_defined
}

exposures contains _undefined_temporary_retention_boundary_def if {
    count(undefined_temporary_retention_boundary) > 0
}

_missing_pii_anonymization_or_masking_def := {
    "name": "Missing Pii Anonymization Or Masking",
    "description": "If the data does contain PII and no anonymization or pseudonymization has been applied prior to or during temporary storage, the raw identifiers remain exposed throughout the retention period. The absence of masking means any unauthorized access event directly yields actionable personal data rather than a non-sensitive surrogate.",
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
            "relevance": "Missing PII anonymization or masking makes it easier for adversaries to gather victim identity information from exposed data stores."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.003",
            "name": "Employee Names",
            "relevance": "Unmasked PII directly enables adversaries to collect employee names and personal identifiers for targeting purposes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Repositories lacking PII anonymization become high-value targets for adversaries seeking to extract personal information."
        }
    ]
}

missing_pii_anonymization_or_masking[_missing_pii_anonymization_or_masking_def] if {
    input.pii_presence_confirmed == "confirmed_present"
    not input.pii_anonymization_applied
}

missing_pii_anonymization_or_masking[_missing_pii_anonymization_or_masking_def] if {
    input.pii_presence_confirmed == "unclassified"
    not input.pii_anonymization_applied
    not input.retention_period_defined
}

exposures contains _missing_pii_anonymization_or_masking_def if {
    count(missing_pii_anonymization_or_masking) > 0
}

_insufficient_access_control_for_unclassified_data_def := {
    "name": "Insufficient Access Control For Unclassified Data",
    "description": "Because classification is uncertain, access control policies that are tied to sensitivity tiers may not have been applied. Data without a confirmed classification may default to broad or open access permissions, allowing users or processes without a legitimate need to read, copy, or export the data during its temporary storage window.",
    "type": "insecure_default",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "name": "File and Directory Permissions Modification",
            "relevance": "Insufficient access controls on unclassified data can be exploited through permission modification techniques to escalate access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Weak access controls on unclassified cloud-stored data allow adversaries to access data from cloud storage without authorization."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.009",
            "name": "Conditional Access Policies",
            "relevance": "Insufficient access controls relate directly to inadequate or missing conditional access policies that fail to restrict unclassified data appropriately."
        }
    ]
}

insufficient_access_control_for_unclassified_data[_insufficient_access_control_for_unclassified_data_def] if {
    input.data_classification_status in ["unknown", "pending", "unclassified"]
    not input.access_control_policy_applied
}

insufficient_access_control_for_unclassified_data[_insufficient_access_control_for_unclassified_data_def] if {
    input.data_classification_status in ["unknown", "pending", "unclassified"]
    not input.access_control_policy_applied
    not input.storage_retention_boundary_defined
}

exposures contains _insufficient_access_control_for_unclassified_data_def if {
    count(insufficient_access_control_for_unclassified_data) > 0
}

_inadequate_disposal_procedure_for_transient_data_def := {
    "name": "Inadequate Disposal Procedure For Transient Data",
    "description": "Temporary data requires a defined, verifiable disposal procedure \u2014 secure deletion or cryptographic erasure \u2014 at the end of its retention period. Without a procedure tied to classification and retention policy, disposal may consist of simple file deletion or cache eviction, leaving data recoverable via forensic means and violating data minimization obligations.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Inadequate disposal procedures fail to ensure secure file deletion, leaving transient data recoverable by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Proper lifecycle-triggered deletion policies are the direct countermeasure to inadequate transient data disposal procedures."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.011",
            "name": "Fileless Storage",
            "relevance": "Fileless storage of transient data may be missed by inadequate disposal procedures that only target traditional file-based artifacts."
        }
    ]
}

inadequate_disposal_procedure_for_transient_data[_inadequate_disposal_procedure_for_transient_data_def] if {
    not input.secure_disposal_procedure_defined
}

inadequate_disposal_procedure_for_transient_data[_inadequate_disposal_procedure_for_transient_data_def] if {
    input.secure_disposal_procedure_defined == true
    not input.retention_period_defined
}

inadequate_disposal_procedure_for_transient_data[_inadequate_disposal_procedure_for_transient_data_def] if {
    input.pii_classification_confirmed == "ambiguous"
    not input.secure_disposal_procedure_defined
}

exposures contains _inadequate_disposal_procedure_for_transient_data_def if {
    count(inadequate_disposal_procedure_for_transient_data) > 0
}

_cross_border_transfer_compliance_gap_def := {
    "name": "Cross Border Transfer Compliance Gap",
    "description": "Temporary PII storage may occur on servers in jurisdictions subject to cross-border data transfer restrictions (e.g., GDPR Chapter V, CCPA). Without a confirmed classification, the legal basis for processing and any required transfer impact assessments or standard contractual clauses may not have been evaluated, exposing the organization to regulatory liability if the data crosses jurisdictional boundaries.",
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
            "relevance": "Transferring data to cloud accounts in different jurisdictions is a direct mechanism through which cross-border transfer compliance gaps are exploited."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Data stored in cloud environments across borders without proper compliance controls can be accessed in violation of data residency regulations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1074",
            "name": "Data Staged",
            "relevance": "Staging data prior to cross-border transfer is a technique that highlights compliance gaps when data is aggregated and moved without proper authorization."
        }
    ]
}

cross_border_transfer_compliance_gap[_cross_border_transfer_compliance_gap_def] if {
    not input.pii_classification_confirmed
    input.server_jurisdiction in ["EU", "UK", "US-California", "other_restricted", "unknown"]
    not input.transfer_impact_assessment_completed
}

cross_border_transfer_compliance_gap[_cross_border_transfer_compliance_gap_def] if {
    input.pii_classification_confirmed == true
    input.server_jurisdiction in ["EU", "UK", "US-California", "other_restricted"]
    not input.transfer_impact_assessment_completed
}

exposures contains _cross_border_transfer_compliance_gap_def if {
    count(cross_border_transfer_compliance_gap) > 0
}
