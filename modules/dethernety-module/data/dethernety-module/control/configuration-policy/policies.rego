package _dt_built_in.countermeasures.configuration_policy

_baseline_configuration_enforcement_def := {
    "name": "Baseline Configuration Enforcement",
    "description": "Provides enforcement of approved configuration baselines across all system instances, ensuring no component deviates from the intended security-hardened state at deployment time.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PH",
            "name": "Platform Hardening",
            "relevance": "Platform hardening directly enforces baseline security configurations across system components."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Software configuration management is the core mitigation for enforcing baseline configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1028",
            "name": "Operating System Configuration",
            "relevance": "OS configuration directly relates to establishing and enforcing baseline system configurations."
        }
    ]
}

baseline_configuration_enforcement[_baseline_configuration_enforcement_def] if {
    input.baseline_enforcement_enabled == true
    input.compliance_scan_status == "compliant"
}

baseline_configuration_enforcement[_baseline_configuration_enforcement_def] if {
    input.baseline_enforcement_enabled == true
    input.drift_detection_enabled == true
    input.compliance_scan_status == "compliant"
}

countermeasures contains _baseline_configuration_enforcement_def if {
    count(baseline_configuration_enforcement) > 0
}

_configuration_drift_detection_def := {
    "name": "Configuration Drift Detection",
    "description": "Provides continuous or periodic detection of deviations from the intended configuration state, generating alerts when runtime configuration diverges from the defined baseline.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OPM",
            "name": "Operational Process Monitoring",
            "relevance": "Monitoring operational processes enables detection of deviations from expected baseline configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing system states and configurations is the primary method for detecting configuration drift."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1028",
            "name": "Operating System Configuration",
            "relevance": "Monitoring OS configuration settings is essential for identifying drift from established baselines."
        }
    ]
}

configuration_drift_detection[_configuration_drift_detection_def] if {
    input.drift_detection_enabled == true
    input.baseline_definition_status == "defined_and_enforced"
    input.alert_on_drift == true
    input.detection_frequency_hours <= 24
}

countermeasures contains _configuration_drift_detection_def if {
    count(configuration_drift_detection) > 0
}

_immutable_infrastructure_provisioning_def := {
    "name": "Immutable Infrastructure Provisioning",
    "description": "Provides deployment of read-only or image-based environment instances that prevent in-place modification, ensuring environments always match the intended build artifact.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-EI",
            "name": "Execution Isolation",
            "relevance": "Execution isolation supports immutable infrastructure by preventing unauthorized modifications to provisioned environments."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PH",
            "name": "Platform Hardening",
            "relevance": "Platform hardening ensures provisioned infrastructure maintains a locked-down, immutable state."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1033",
            "name": "Limit Software Installation",
            "relevance": "Limiting software installation enforces immutability by preventing unauthorized changes to infrastructure components."
        }
    ]
}

immutable_infrastructure_provisioning[_immutable_infrastructure_provisioning_def] if {
    input.immutable_deployment_model == "image_based"
    input.in_place_modification_permitted == false
    input.artifact_integrity_validation_enabled == true
}

countermeasures contains _immutable_infrastructure_provisioning_def if {
    count(immutable_infrastructure_provisioning) > 0
}

_secrets_and_credential_injection_control_def := {
    "name": "Secrets And Credential Injection Control",
    "description": "Provides controlled, auditable injection of secrets and credentials into environments at provisioning time, ensuring sensitive values are never hardcoded and are consistently applied.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CRO",
            "name": "Credential Rotation",
            "relevance": "Credential rotation is a key control for managing the lifecycle of injected secrets and credentials."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CH",
            "name": "Credential Hardening",
            "relevance": "Credential hardening directly addresses securing credentials during injection and storage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1043",
            "name": "Credential Access Protection",
            "relevance": "Protecting credential access is the primary mitigation concern for secrets and credential injection control."
        }
    ]
}

secrets_and_credential_injection_control[_secrets_and_credential_injection_control_def] if {
    input.secrets_manager_integrated == true
    input.hardcoded_secrets_detected == false
    input.secret_injection_method in ["vault_dynamic", "secrets_manager_api", "encrypted_env_injection"]
}

countermeasures contains _secrets_and_credential_injection_control_def if {
    count(secrets_and_credential_injection_control) > 0
}

_automated_remediation_response_def := {
    "name": "Automated Remediation Response",
    "description": "Provides automated re-convergence of misconfigured systems to the intended state upon drift detection, reducing mean time to remediation without manual intervention.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SICA",
            "name": "System Init Config Analysis",
            "relevance": "Analyzing system initialization configurations supports automated detection and remediation of configuration issues."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Automated software updates are a common form of automated remediation response to vulnerabilities."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1016",
            "name": "Vulnerability Scanning",
            "relevance": "Vulnerability scanning feeds automated remediation workflows by identifying issues requiring response."
        }
    ]
}

automated_remediation_response[_automated_remediation_response_def] if {
    input.auto_remediation_enabled == true
    input.remediation_mode == "enforced"
    input.max_remediation_interval_minutes <= 60
}

automated_remediation_response[_automated_remediation_response_def] if {
    input.auto_remediation_enabled == true
    input.remediation_mode == "enforced"
    not input.max_remediation_interval_minutes
}

countermeasures contains _automated_remediation_response_def if {
    count(automated_remediation_response) > 0
}

_environment_parity_assurance_def := {
    "name": "Environment Parity Assurance",
    "description": "Provides verified consistency between development, staging, and production environments, ensuring security controls applied in lower environments are faithfully reproduced in production.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OLV",
            "name": "Operational Logic Validation",
            "relevance": "Validating operational logic ensures consistency and parity across different environments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1039",
            "name": "Environment Variable Permissions",
            "relevance": "Controlling environment variable permissions ensures consistent and secure configuration across environments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing configurations across environments is essential for verifying and maintaining environment parity."
        }
    ]
}

environment_parity_assurance[_environment_parity_assurance_def] if {
    input.environment_config_sync_status == "in_sync"
    input.security_controls_reproduced_in_production == true
}

environment_parity_assurance[_environment_parity_assurance_def] if {
    input.iac_enforcement_mechanism == "automated_iac_with_drift_detection"
    input.security_controls_reproduced_in_production == true
}

countermeasures contains _environment_parity_assurance_def if {
    count(environment_parity_assurance) > 0
}

_configuration_change_audit_logging_def := {
    "name": "Configuration Change Audit Logging",
    "description": "Provides complete, tamper-evident logging of all configuration changes, including who initiated them, when, and what the previous and new states were, supporting forensic investigation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Analyzing administrative network activity captures configuration changes made through administrative interfaces."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-USICA",
            "name": "User Session Init Config Analysis",
            "relevance": "User session initialization config analysis directly supports logging and auditing configuration changes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Audit logging of configuration changes is the core function described by this mitigation technique."
        }
    ]
}

configuration_change_audit_logging[_configuration_change_audit_logging_def] if {
    input.audit_logging_enabled == true
    "initiator" in input.logged_change_fields
    "timestamp" in input.logged_change_fields
    "previous_state" in input.logged_change_fields
    "new_state" in input.logged_change_fields
    input.log_tamper_protection == "immutable_storage"
}

configuration_change_audit_logging[_configuration_change_audit_logging_def] if {
    input.audit_logging_enabled == true
    "initiator" in input.logged_change_fields
    "timestamp" in input.logged_change_fields
    "previous_state" in input.logged_change_fields
    "new_state" in input.logged_change_fields
    input.log_tamper_protection == "cryptographic_signing"
}

configuration_change_audit_logging[_configuration_change_audit_logging_def] if {
    input.audit_logging_enabled == true
    "initiator" in input.logged_change_fields
    "timestamp" in input.logged_change_fields
    "previous_state" in input.logged_change_fields
    "new_state" in input.logged_change_fields
    input.log_tamper_protection == "centralized_siem"
}

countermeasures contains _configuration_change_audit_logging_def if {
    count(configuration_change_audit_logging) > 0
}

_policy_as_code_validation_def := {
    "name": "Policy As Code Validation",
    "description": "Provides pre-deployment validation of configuration definitions against security policy rules encoded as machine-readable checks, preventing non-compliant configurations from being applied.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CV",
            "name": "Content Validation",
            "relevance": "Content validation directly supports policy-as-code by validating that code and configurations meet defined policies."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SFA",
            "name": "System File Analysis",
            "relevance": "System file analysis enables validation that policy-as-code definitions match deployed configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing ensures policy-as-code definitions are consistently validated and enforced."
        }
    ]
}

policy_as_code_validation[_policy_as_code_validation_def] if {
    input.policy_validation_enabled == true
    input.validation_enforcement_mode == "enforced"
    input.policy_rule_count > 0
}

countermeasures contains _policy_as_code_validation_def if {
    count(policy_as_code_validation) > 0
}

_dependency_and_package_version_pinning_def := {
    "name": "Dependency And Package Version Pinning",
    "description": "Provides enforcement of specific, approved versions of software packages and dependencies within environments, preventing unintended or unauthorized component substitution.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SU",
            "name": "Software Update",
            "relevance": "Software update management is directly related to controlling dependency and package versions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SCH",
            "name": "Source Code Hardening",
            "relevance": "Source code hardening includes practices like pinning dependency versions to prevent supply chain risks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Managing software updates is directly tied to controlling and pinning dependency and package versions."
        }
    ]
}

dependency_and_package_version_pinning[_dependency_and_package_version_pinning_def] if {
    input.version_pinning_enforced == true
    input.lockfile_present == true
    input.pinning_scope == "full"
}

dependency_and_package_version_pinning[_dependency_and_package_version_pinning_def] if {
    input.version_pinning_enforced == true
    input.lockfile_present == true
    input.pinning_scope == "direct_only"
}

countermeasures contains _dependency_and_package_version_pinning_def if {
    count(dependency_and_package_version_pinning) > 0
}

_operational_maintainability_of_config_templates_def := {
    "name": "Operational Maintainability Of Config Templates",
    "description": "Provides a structured, version-controlled repository of configuration templates that reduces operational complexity and enables rapid, consistent environment reproduction at scale.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SICA",
            "name": "System Init Config Analysis",
            "relevance": "Analyzing system initialization configurations supports maintaining and validating configuration templates."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-RC",
            "name": "Restore Configuration",
            "relevance": "Configuration restore capabilities are essential for operational maintainability of configuration templates."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CI",
            "name": "Configuration Inventory",
            "relevance": "Maintaining a configuration inventory is fundamental to operationally managing and maintaining config templates."
        }
    ]
}

operational_maintainability_of_config_templates[_operational_maintainability_of_config_templates_def] if {
    input.template_repository_exists == true
    input.version_control_enabled == true
    input.template_coverage_scope == "full"
    input.deployment_pipeline_integrated == true
}

operational_maintainability_of_config_templates[_operational_maintainability_of_config_templates_def] if {
    input.template_repository_exists == true
    input.version_control_enabled == true
    input.template_coverage_scope == "partial"
    input.deployment_pipeline_integrated == true
}

countermeasures contains _operational_maintainability_of_config_templates_def if {
    count(operational_maintainability_of_config_templates) > 0
}
