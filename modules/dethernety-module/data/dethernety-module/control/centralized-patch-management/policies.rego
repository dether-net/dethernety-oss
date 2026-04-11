package _dt_built_in.countermeasures.centralized_patch_management

_patch_deployment_coverage_def := {
    "name": "Patch Deployment Coverage",
    "description": "Provides measurable enforcement of patch application across all managed devices, ensuring no endpoint is left in an unpatched state due to oversight or manual process gaps.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

patch_deployment_coverage[_patch_deployment_coverage_def] if {
    input.patch_management_enabled == true
    input.fleet_patch_compliance_percent >= 95
    input.patch_scope == "all_devices"
    input.max_patch_age_days <= 30
}

patch_deployment_coverage[_patch_deployment_coverage_def] if {
    input.patch_management_enabled == true
    input.fleet_patch_compliance_percent >= 98
    input.patch_scope == "all_devices"
    input.max_patch_age_days <= 60
}

countermeasures contains _patch_deployment_coverage_def if {
    count(patch_deployment_coverage) > 0
}

_remediation_velocity_def := {
    "name": "Remediation Velocity",
    "description": "Delivers reduced mean-time-to-patch (MTTP) by automating deployment pipelines, compressing the window between patch availability and full fleet remediation from weeks to hours or days.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

remediation_velocity[_remediation_velocity_def] if {
    input.patch_management_enabled == true
    input.automated_deployment_enabled == true
    input.max_patch_deployment_days <= 7
}

remediation_velocity[_remediation_velocity_def] if {
    input.patch_management_enabled == true
    input.automated_deployment_enabled == true
    input.max_patch_deployment_days <= 14
}

countermeasures contains _remediation_velocity_def if {
    count(remediation_velocity) > 0
}

_patch_compliance_reporting_def := {
    "name": "Patch Compliance Reporting",
    "description": "Generates continuous compliance status reports identifying patch levels, missing updates, and deviation from baseline per device, enabling auditable evidence of security posture.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

patch_compliance_reporting[_patch_compliance_reporting_def] if {
    input.compliance_reporting_enabled == true
    input.report_frequency in ["real_time", "daily", "weekly"]
    input.per_device_tracking_enabled == true
    input.audit_trail_retention_days >= 90
}

patch_compliance_reporting[_patch_compliance_reporting_def] if {
    input.compliance_reporting_enabled == true
    input.per_device_tracking_enabled == true
    input.report_frequency in ["real_time", "daily"]
    input.audit_trail_retention_days >= 30
}

countermeasures contains _patch_compliance_reporting_def if {
    count(patch_compliance_reporting) > 0
}

_patch_testing_and_staging_def := {
    "name": "Patch Testing And Staging",
    "description": "Provides pre-production validation pipelines that test patches in isolated environments before fleet-wide deployment, reducing operational risk from faulty or incompatible updates.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

patch_testing_and_staging[_patch_testing_and_staging_def] if {
    input.staging_environment_exists == true
    input.patch_testing_policy == "enforced"
    input.minimum_staging_dwell_days >= 3
}

patch_testing_and_staging[_patch_testing_and_staging_def] if {
    input.staging_environment_exists == true
    input.patch_testing_policy == "enforced"
}

countermeasures contains _patch_testing_and_staging_def if {
    count(patch_testing_and_staging) > 0
}

_rollback_and_recovery_automation_def := {
    "name": "Rollback And Recovery Automation",
    "description": "Enables automated rollback of failed or problematic patches to known-good states, maintaining system availability and providing recovery without manual administrator intervention.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

rollback_and_recovery_automation[_rollback_and_recovery_automation_def] if {
    input.rollback_enabled == true
    input.rollback_trigger_type in ["failure_code_and_health_check", "health_check_only", "failure_code_only"]
    input.known_good_snapshot_policy == "automatic_pre_patch"
}

countermeasures contains _rollback_and_recovery_automation_def if {
    count(rollback_and_recovery_automation) > 0
}

_third_party_and_os_update_integration_def := {
    "name": "Third Party And Os Update Integration",
    "description": "Provides unified patching coverage across operating systems and third-party application catalogs, eliminating coverage gaps that arise from siloed update mechanisms.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

third_party_and_os_update_integration[_third_party_and_os_update_integration_def] if {
    input.patch_management_enabled == true
    input.patch_scope_coverage == "both_os_and_third_party"
    input.max_patch_deployment_days <= 30
}

countermeasures contains _third_party_and_os_update_integration_def if {
    count(third_party_and_os_update_integration) > 0
}

_patch_deployment_scheduling_control_def := {
    "name": "Patch Deployment Scheduling Control",
    "description": "Delivers configurable deployment windows and maintenance scheduling, ensuring patches are applied during approved periods without disrupting business operations.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

patch_deployment_scheduling_control[_patch_deployment_scheduling_control_def] if {
    input.patch_deployment_windows_configured == true
    input.deployment_window_enforcement_mode == "enforced"
    input.max_patch_deployment_delay_days > 0
}

patch_deployment_scheduling_control[_patch_deployment_scheduling_control_def] if {
    input.patch_deployment_windows_configured == true
    input.deployment_window_enforcement_mode == "enforced"
}

countermeasures contains _patch_deployment_scheduling_control_def if {
    count(patch_deployment_scheduling_control) > 0
}

_endpoint_inventory_and_discovery_def := {
    "name": "Endpoint Inventory And Discovery",
    "description": "Maintains a live inventory of managed and unmanaged devices with their current software versions, enabling identification of rogue or unmanaged endpoints missing patch coverage.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

endpoint_inventory_and_discovery[_endpoint_inventory_and_discovery_def] if {
    input.inventory_discovery_enabled == true
    input.inventory_scan_frequency_hours <= 24
    input.unmanaged_device_detection_enabled == true
    input.software_version_tracking_enabled == true
}

endpoint_inventory_and_discovery[_endpoint_inventory_and_discovery_def] if {
    input.inventory_discovery_enabled == true
    input.unmanaged_device_detection_enabled == true
    input.inventory_scan_frequency_hours <= 48
    input.software_version_tracking_enabled == true
}

countermeasures contains _endpoint_inventory_and_discovery_def if {
    count(endpoint_inventory_and_discovery) > 0
}

_patch_authentication_and_integrity_verification_def := {
    "name": "Patch Authentication And Integrity Verification",
    "description": "Provides cryptographic verification of patch authenticity and integrity before installation, ensuring only legitimate vendor-signed updates are applied to managed systems.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

patch_authentication_and_integrity_verification[_patch_authentication_and_integrity_verification_def] if {
    input.signature_verification_enabled == true
    input.trusted_source_enforcement == "enforced"
}

patch_authentication_and_integrity_verification[_patch_authentication_and_integrity_verification_def] if {
    input.signature_verification_enabled == true
    input.hash_validation_enabled == true
}

countermeasures contains _patch_authentication_and_integrity_verification_def if {
    count(patch_authentication_and_integrity_verification) > 0
}
