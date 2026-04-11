package _dt_built_in.countermeasures.data_recovery_procedures



_backup_integrity_validation_def := {
    "name": "Backup Integrity Validation",
    "description": "Provides systematic verification that backup copies are complete, uncorrupted, and restorable before a recovery event occurs, ensuring backup reliability through scheduled integrity checks and checksum validation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

backup_integrity_validation[_backup_integrity_validation_def] if {
    input.integrity_checks_enabled == true
    input.checksum_validation_enabled == true
    input.integrity_check_frequency_days >= 1
    input.integrity_check_frequency_days <= 30
}

backup_integrity_validation[_backup_integrity_validation_def] if {
    input.integrity_checks_enabled == true
    input.checksum_validation_enabled == true
    input.restore_test_performed == "regularly"
}

countermeasures contains _backup_integrity_validation_def if {
    count(backup_integrity_validation) > 0
}

_recovery_time_objective_enforcement_def := {
    "name": "Recovery Time Objective Enforcement",
    "description": "Delivers measurable assurance that data restoration operations meet defined RTO and RPO thresholds, enabling predictable recovery windows and limiting data loss exposure through documented and tested time-bound procedures.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

recovery_time_objective_enforcement[_recovery_time_objective_enforcement_def] if {
    input.rto_rpo_objectives_documented == true
    input.recovery_procedures_tested_within_months <= 12
    input.last_test_met_rto_rpo == true
}

countermeasures contains _recovery_time_objective_enforcement_def if {
    count(recovery_time_objective_enforcement) > 0
}

_recovery_procedure_documentation_completeness_def := {
    "name": "Recovery Procedure Documentation Completeness",
    "description": "Provides operational clarity through step-by-step recovery runbooks that reduce human error during high-stress restoration events, ensuring consistent execution regardless of which personnel perform the recovery.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

recovery_procedure_documentation_completeness[_recovery_procedure_documentation_completeness_def] if {
    input.recovery_runbook_exists == true
    input.runbook_completeness_level in ["substantial", "complete"]
    input.runbook_last_reviewed_days_ago <= 365
    input.runbook_tested_in_drill == true
}

recovery_procedure_documentation_completeness[_recovery_procedure_documentation_completeness_def] if {
    input.recovery_runbook_exists == true
    input.runbook_completeness_level == "complete"
    input.runbook_last_reviewed_days_ago <= 180
}

countermeasures contains _recovery_procedure_documentation_completeness_def if {
    count(recovery_procedure_documentation_completeness) > 0
}

_recovery_testing_and_drill_coverage_def := {
    "name": "Recovery Testing And Drill Coverage",
    "description": "Delivers validated confidence in recovery capability through periodic recovery drills and tabletop exercises, confirming that procedures work as expected and identifying gaps before an actual failure occurs.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

recovery_testing_and_drill_coverage[_recovery_testing_and_drill_coverage_def] if {
    input.recovery_drill_conducted == true
    input.months_since_last_drill <= 12
    input.drill_outcome_documented == true
}

countermeasures contains _recovery_testing_and_drill_coverage_def if {
    count(recovery_testing_and_drill_coverage) > 0
}

_multi_tier_backup_retention_coverage_def := {
    "name": "Multi Tier Backup Retention Coverage",
    "description": "Provides temporal flexibility in recovery by maintaining multiple versioned backup generations across short, medium, and long retention windows, enabling recovery to any of several historical data states.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

multi_tier_backup_retention_coverage[_multi_tier_backup_retention_coverage_def] if {
    input.backup_retention_tiers_configured == "three_or_more_tiers"
    input.minimum_backup_generations_per_tier >= 2
    input.backup_policy_documented == true
}

multi_tier_backup_retention_coverage[_multi_tier_backup_retention_coverage_def] if {
    input.backup_retention_tiers_configured == "two_tiers"
    input.minimum_backup_generations_per_tier >= 3
    input.backup_policy_documented == true
}

countermeasures contains _multi_tier_backup_retention_coverage_def if {
    count(multi_tier_backup_retention_coverage) > 0
}

_offsite_and_offline_backup_availability_def := {
    "name": "Offsite And Offline Backup Availability",
    "description": "Ensures recovery capability survives localized or networked compromise by maintaining geographically separated or air-gapped backup copies, providing resilience against site-level failures or network-propagated corruption.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

offsite_and_offline_backup_availability[_offsite_and_offline_backup_availability_def] if {
    input.offsite_backup_configured == true
    input.air_gapped_or_offline_backup_exists == true
    input.backup_restoration_tested == true
}

offsite_and_offline_backup_availability[_offsite_and_offline_backup_availability_def] if {
    input.offsite_backup_configured == true
    input.backup_restoration_tested == true
    input.air_gapped_or_offline_backup_exists == false
}

offsite_and_offline_backup_availability[_offsite_and_offline_backup_availability_def] if {
    input.air_gapped_or_offline_backup_exists == true
    input.backup_restoration_tested == true
    input.offsite_backup_configured == false
}

countermeasures contains _offsite_and_offline_backup_availability_def if {
    count(offsite_and_offline_backup_availability) > 0
}

_recovery_logging_and_audit_trail_def := {
    "name": "Recovery Logging And Audit Trail",
    "description": "Provides post-recovery accountability and forensic traceability by logging all recovery actions, operator identities, timestamps, and data states restored, supporting compliance reporting and incident investigations.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

recovery_logging_and_audit_trail[_recovery_logging_and_audit_trail_def] if {
    input.recovery_actions_logged == false
    input.operator_identity_captured == false
}

recovery_logging_and_audit_trail[_recovery_logging_and_audit_trail_def] if {
    input.recovery_actions_logged == true
    input.operator_identity_captured == false
}

recovery_logging_and_audit_trail[_recovery_logging_and_audit_trail_def] if {
    input.recovery_actions_logged == true
    input.operator_identity_captured == true
    input.log_retention_days < 90
}

recovery_logging_and_audit_trail[_recovery_logging_and_audit_trail_def] if {
    input.recovery_actions_logged == true
    input.operator_identity_captured == true
    input.log_retention_days >= 90
    input.log_integrity_protection == "none"
}

countermeasures contains _recovery_logging_and_audit_trail_def if {
    count(recovery_logging_and_audit_trail) > 0
}

_automated_recovery_workflow_execution_def := {
    "name": "Automated Recovery Workflow Execution",
    "description": "Reduces mean time to recovery and human error by automating recovery orchestration steps such as snapshot mounting, data rehydration, and service restoration sequencing through scripted or orchestration-platform-driven workflows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

automated_recovery_workflow_execution[_automated_recovery_workflow_execution_def] if {
    input.recovery_workflow_automation_enabled == true
    input.workflow_coverage_scope == "full"
    input.workflow_last_validated_days <= 180
}

automated_recovery_workflow_execution[_automated_recovery_workflow_execution_def] if {
    input.recovery_workflow_automation_enabled == true
    input.workflow_coverage_scope == "partial"
    input.workflow_last_validated_days <= 90
}

countermeasures contains _automated_recovery_workflow_execution_def if {
    count(automated_recovery_workflow_execution) > 0
}

_post_recovery_data_integrity_verification_def := {
    "name": "Post Recovery Data Integrity Verification",
    "description": "Delivers assurance that restored data is functionally complete and consistent by running automated hash comparisons, application-layer consistency checks, and sanity tests after recovery operations complete.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

post_recovery_data_integrity_verification[_post_recovery_data_integrity_verification_def] if {
    input.automated_hash_verification_enabled == true
    input.application_consistency_checks_enabled == true
    input.post_recovery_sanity_test_coverage in ["partial", "full"]
}

countermeasures contains _post_recovery_data_integrity_verification_def if {
    count(post_recovery_data_integrity_verification) > 0
}

_role_based_recovery_authorization_control_def := {
    "name": "Role Based Recovery Authorization Control",
    "description": "Provides governance over who may initiate or approve recovery operations, preventing unauthorized or accidental data restoration events through defined approval workflows and access controls tied to recovery tooling.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

role_based_recovery_authorization_control[_role_based_recovery_authorization_control_def] if {
    input.recovery_roles_defined == true
    input.recovery_approval_workflow_enforced == true
    input.recovery_access_control_type in ["rbac", "abac"]
}

countermeasures contains _role_based_recovery_authorization_control_def if {
    count(role_based_recovery_authorization_control) > 0
}
