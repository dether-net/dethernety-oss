package _dt_built_in.exposures.system_configuration_files

_plaintext_secret_storage_def := {
    "name": "Plaintext Secret Storage",
    "description": "Configuration files store credentials, API keys, tokens, or database passwords in plaintext without encryption or secret management integration. Even files classified as internal or confidential may contain embedded secrets that are never encrypted at rest, violating encryption requirements for sensitive data.",
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
            "relevance": "Directly addresses the risk of credentials and secrets stored in plaintext without proper protection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Specifically covers plaintext secrets stored in files, which is the core concern of this vector."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Covers private keys stored insecurely in plaintext, a common form of plaintext secret storage."
        }
    ]
}

plaintext_secret_storage[_plaintext_secret_storage_def] if {
    input.secrets_stored_in_plaintext == true
}

plaintext_secret_storage[_plaintext_secret_storage_def] if {
    not input.secret_manager_integration
    not input.file_encryption_at_rest
}

exposures contains _plaintext_secret_storage_def if {
    count(plaintext_secret_storage) > 0
}

_missing_or_inconsistent_data_classification_def := {
    "name": "Missing Or Inconsistent Data Classification",
    "description": "Configuration files are not assigned a data sensitivity classification (e.g., Public, Internal, Confidential, Restricted), meaning downstream handling controls \u2014 access restrictions, encryption mandates, retention schedules \u2014 cannot be enforced. Files containing secrets may be treated as equivalent to benign configuration, producing gaps in protective controls.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.013",
            "name": "Encrypted/Encoded File",
            "relevance": "Relates to how inconsistent data classification can lead to improper handling of files that should be encrypted or labeled sensitive."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Misclassified data in files can expose credentials, directly relevant to missing data classification controls."
        }
    ]
}

missing_or_inconsistent_data_classification[_missing_or_inconsistent_data_classification_def] if {
    input.contains_sensitive_values == true
    not input.classification_label_assigned
}

missing_or_inconsistent_data_classification[_missing_or_inconsistent_data_classification_def] if {
    input.classification_label_assigned == true
    input.contains_sensitive_values == true
    input.classification_enforcement_mechanism == "none"
}

exposures contains _missing_or_inconsistent_data_classification_def if {
    count(missing_or_inconsistent_data_classification) > 0
}

_excessive_filesystem_permissions_def := {
    "name": "Excessive Filesystem Permissions",
    "description": "Configuration files are readable or writable by users, groups, or processes beyond those with a legitimate operational need. World-readable or group-readable permission settings on files containing sensitive configuration data violate least-privilege access control requirements and enable unauthorized disclosure.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "name": "File and Directory Permissions Modification",
            "relevance": "Directly relates to filesystem permission issues, covering modification and abuse of file/directory permissions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.001",
            "name": "Setuid and Setgid",
            "relevance": "Excessive filesystem permissions via setuid/setgid bits are a classic privilege escalation risk tied to this vector."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222.002",
            "name": "Linux and Mac File and Directory Permissions Modification",
            "relevance": "Specifically addresses Linux/Mac filesystem permission abuse, highly relevant to excessive filesystem permission concerns."
        }
    ]
}

excessive_filesystem_permissions[_excessive_filesystem_permissions_def] if {
    input.world_readable == true
}

excessive_filesystem_permissions[_excessive_filesystem_permissions_def] if {
    input.group_readable_by_non_operational_group == true
}

excessive_filesystem_permissions[_excessive_filesystem_permissions_def] if {
    not input.file_owner_matches_service_account
    not input.file_permission_mode in ["600", "400", "500", "700"]
}

exposures contains _excessive_filesystem_permissions_def if {
    count(excessive_filesystem_permissions) > 0
}

_undefined_retention_and_accumulation_def := {
    "name": "Undefined Retention And Accumulation",
    "description": "Configuration files \u2014 including superseded, deprecated, and backup copies (e.g., config.bak, .env.old) \u2014 accumulate on the filesystem without a defined retention schedule or expiry policy. Outdated files may retain valid or reusable credentials and connection strings, extending the window of exposure beyond the operational need.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Undefined retention policies mean files are not deleted on schedule, and attackers can exploit or manipulate retained files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Accumulated files over time without defined retention may contain credentials that become exposure risks."
        }
    ]
}

undefined_retention_and_accumulation[_undefined_retention_and_accumulation_def] if {
    input.stale_config_files_present == true
    not input.retention_policy_defined
}

undefined_retention_and_accumulation[_undefined_retention_and_accumulation_def] if {
    input.stale_config_files_present == true
    input.stale_config_contains_secrets == true
}

exposures contains _undefined_retention_and_accumulation_def if {
    count(undefined_retention_and_accumulation) > 0
}

_inadequate_disposal_procedures_def := {
    "name": "Inadequate Disposal Procedures",
    "description": "When configuration files are retired, decommissioned, or replaced, secure deletion or cryptographic erasure is not applied. Files may persist in recoverable form on the filesystem, in recycle bins, in snapshot/backup stores, or on decommissioned storage, enabling post-disposal recovery of sensitive configuration data.",
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
            "relevance": "Inadequate disposal procedures can lead to improper data destruction, leaving sensitive data recoverable."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Directly relates to the improper or incomplete deletion of files during disposal procedures."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "name": "Inhibit System Recovery",
            "relevance": "Inadequate disposal may leave recovery paths intact, and this technique covers the manipulation of system recovery mechanisms."
        }
    ]
}

inadequate_disposal_procedures[_inadequate_disposal_procedures_def] if {
    not input.secure_deletion_method_applied
    input.retired_config_files_recoverable == true
}

inadequate_disposal_procedures[_inadequate_disposal_procedures_def] if {
    not input.disposal_procedure_documented
    input.retired_config_files_recoverable == true
}

exposures contains _inadequate_disposal_procedures_def if {
    count(inadequate_disposal_procedures) > 0
}

_cross_environment_data_leakage_via_config_copy_def := {
    "name": "Cross Environment Data Leakage Via Config Copy",
    "description": "Configuration files containing production-environment secrets or sensitive parameters are copied into development, staging, or test environments without sanitization or masking. Classification controls that apply to production data (restricted handling, limited access, encryption mandates) are not enforced in lower environments, exposing production credentials to a broader set of users.",
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
            "relevance": "Config files copied across environments often contain embedded credentials, directly causing cross-environment data leakage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1074.002",
            "name": "Remote Data Staging",
            "relevance": "Copying configuration data across environments mirrors remote data staging behavior used to exfiltrate or leak sensitive data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1480.001",
            "name": "Environmental Keying",
            "relevance": "Directly relevant as attackers or misconfigurations may exploit environment-specific keys when configs are copied between environments."
        }
    ]
}

cross_environment_data_leakage_via_config_copy[_cross_environment_data_leakage_via_config_copy_def] if {
    input.environment_type in ["staging", "development", "test"]
    input.contains_production_secrets == true
    not input.secrets_masked_or_sanitized
}

cross_environment_data_leakage_via_config_copy[_cross_environment_data_leakage_via_config_copy_def] if {
    input.environment_type in ["staging", "development", "test"]
    input.contains_production_secrets == true
    not input.access_control_equivalent_to_production
}

exposures contains _cross_environment_data_leakage_via_config_copy_def if {
    count(cross_environment_data_leakage_via_config_copy) > 0
}
