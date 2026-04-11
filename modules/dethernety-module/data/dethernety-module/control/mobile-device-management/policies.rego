package _dt_built_in.countermeasures.mobile_device_management



_device_enrollment_authentication_coverage_def := {
    "name": "Device Enrollment Authentication Coverage",
    "description": "Provides verified identity binding during device enrollment, ensuring only authorized users and compliant devices gain managed status and network access credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

device_enrollment_authentication_coverage[_device_enrollment_authentication_coverage_def] if {
    input.enrollment_authentication_method in ["mfa", "conditional_access_with_mfa"]
    input.user_identity_binding_enforced == true
    input.open_enrollment_allowed == false
}

device_enrollment_authentication_coverage[_device_enrollment_authentication_coverage_def] if {
    input.enrollment_authentication_method == "certificate"
    input.user_identity_binding_enforced == true
    input.open_enrollment_allowed == false
}

countermeasures contains _device_enrollment_authentication_coverage_def if {
    count(device_enrollment_authentication_coverage) > 0
}

_policy_enforcement_compliance_accuracy_def := {
    "name": "Policy Enforcement Compliance Accuracy",
    "description": "Delivers continuous enforcement of security configurations such as screen lock, encryption, OS version requirements, and application restrictions, with measurable compliance state per device.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

policy_enforcement_compliance_accuracy[_policy_enforcement_compliance_accuracy_def] if {
    input.mdm_policy_enforcement_enabled == true
    input.policy_scope_coverage == "all_devices"
    input.non_compliant_device_action in ["block_access", "notify_and_block"]
    input.device_compliance_rate_percent >= 90
}

policy_enforcement_compliance_accuracy[_policy_enforcement_compliance_accuracy_def] if {
    input.mdm_policy_enforcement_enabled == true
    input.policy_scope_coverage == "partial"
    input.non_compliant_device_action in ["block_access", "notify_and_block"]
    input.device_compliance_rate_percent >= 95
}

countermeasures contains _policy_enforcement_compliance_accuracy_def if {
    count(policy_enforcement_compliance_accuracy) > 0
}

_remote_wipe_and_lock_automation_def := {
    "name": "Remote Wipe And Lock Automation",
    "description": "Provides automated and on-demand remote wipe, selective wipe of corporate data, and device lock capabilities triggered by compliance violations or loss/theft events.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

remote_wipe_and_lock_automation[_remote_wipe_and_lock_automation_def] if {
    input.remote_wipe_enabled == true
    input.automated_wipe_trigger in ["compliance_violation", "loss_theft_reported", "both"]
}

remote_wipe_and_lock_automation[_remote_wipe_and_lock_automation_def] if {
    input.selective_wipe_enabled == true
    input.remote_lock_enabled == true
    input.automated_wipe_trigger in ["compliance_violation", "loss_theft_reported", "both"]
}

countermeasures contains _remote_wipe_and_lock_automation_def if {
    count(remote_wipe_and_lock_automation) > 0
}

_application_allowlist_and_blocklist_control_def := {
    "name": "Application Allowlist And Blocklist Control",
    "description": "Enforces approved application inventories and blocks unauthorized or blacklisted applications from being installed or executed on managed devices.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

application_allowlist_and_blocklist_control[_application_allowlist_and_blocklist_control_def] if {
    input.app_allowlist_enforcement_enabled == true
    input.app_blocklist_enforcement_enabled == true
    input.policy_scope_coverage == "all_devices"
}

application_allowlist_and_blocklist_control[_application_allowlist_and_blocklist_control_def] if {
    input.app_allowlist_enforcement_enabled == true
    input.policy_scope_coverage == "all_devices"
}

application_allowlist_and_blocklist_control[_application_allowlist_and_blocklist_control_def] if {
    input.app_blocklist_enforcement_enabled == true
    input.policy_scope_coverage == "all_devices"
}

countermeasures contains _application_allowlist_and_blocklist_control_def if {
    count(application_allowlist_and_blocklist_control) > 0
}

_corporate_data_containerization_def := {
    "name": "Corporate Data Containerization",
    "description": "Provides logical separation of corporate data from personal data through containerization, preventing unauthorized cross-boundary data leakage between personal and enterprise contexts.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

corporate_data_containerization[_corporate_data_containerization_def] if {
    input.containerization_enabled == true
    input.cross_boundary_data_sharing_policy in ["blocked", "policy_managed_apps_only"]
    input.container_compliance_status == "compliant"
}

countermeasures contains _corporate_data_containerization_def if {
    count(corporate_data_containerization) > 0
}

_jailbreak_and_root_detection_accuracy_def := {
    "name": "Jailbreak And Root Detection Accuracy",
    "description": "Detects compromised device integrity states including jailbroken or rooted devices, triggering compliance alerts or automated quarantine actions upon detection.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

jailbreak_and_root_detection_accuracy[_jailbreak_and_root_detection_accuracy_def] if {
    input.jailbreak_root_detection_enabled == true
    input.compromised_device_action in ["quarantine", "block_access", "wipe"]
    input.detection_check_interval_hours <= 24
}

jailbreak_and_root_detection_accuracy[_jailbreak_and_root_detection_accuracy_def] if {
    input.jailbreak_root_detection_enabled == true
    input.compromised_device_action in ["quarantine", "block_access", "wipe"]
    not input.detection_check_interval_hours
}

countermeasures contains _jailbreak_and_root_detection_accuracy_def if {
    count(jailbreak_and_root_detection_accuracy) > 0
}

_device_inventory_and_visibility_completeness_def := {
    "name": "Device Inventory And Visibility Completeness",
    "description": "Maintains a comprehensive real-time inventory of all managed devices including hardware attributes, OS versions, installed applications, and compliance state for audit and governance purposes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

device_inventory_and_visibility_completeness[_device_inventory_and_visibility_completeness_def] if {
    input.inventory_collection_enabled == true
    input.inventory_sync_interval_hours <= 24
    "hardware" in input.inventory_data_scope
    "os_version" in input.inventory_data_scope
    "installed_apps" in input.inventory_data_scope
    "compliance_state" in input.inventory_data_scope
}

countermeasures contains _device_inventory_and_visibility_completeness_def if {
    count(device_inventory_and_visibility_completeness) > 0
}

_network_access_conditional_enforcement_def := {
    "name": "Network Access Conditional Enforcement",
    "description": "Integrates with network access control systems to grant, restrict, or revoke network connectivity based on real-time device compliance posture, reducing non-compliant device access to sensitive resources.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

network_access_conditional_enforcement[_network_access_conditional_enforcement_def] if {
    input.nac_integration_enabled == true
    input.compliance_enforcement_action in ["block", "quarantine"]
    input.compliance_check_frequency_minutes <= 60
}

countermeasures contains _network_access_conditional_enforcement_def if {
    count(network_access_conditional_enforcement) > 0
}

_over_the_air_configuration_management_def := {
    "name": "Over The Air Configuration Management",
    "description": "Enables centralized deployment of security configurations, certificates, VPN profiles, and Wi-Fi settings to all managed devices without physical access, ensuring consistent and maintainable security baselines.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

over_the_air_configuration_management[_over_the_air_configuration_management_def] if {
    input.ota_configuration_deployment_enabled == true
    input.configuration_profile_enforcement_scope in ["all_devices"]
    input.configuration_compliance_check_frequency_hours <= 24
}

over_the_air_configuration_management[_over_the_air_configuration_management_def] if {
    input.ota_configuration_deployment_enabled == true
    input.configuration_profile_enforcement_scope in ["all_devices", "group"]
    input.certificate_provisioning_enabled == true
    input.configuration_compliance_check_frequency_hours <= 24
}

countermeasures contains _over_the_air_configuration_management_def if {
    count(over_the_air_configuration_management) > 0
}

_audit_logging_and_event_completeness_def := {
    "name": "Audit Logging And Event Completeness",
    "description": "Generates comprehensive logs of device activity, policy changes, compliance events, administrator actions, and remote commands, supporting forensic investigation and compliance reporting.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

audit_logging_and_event_completeness[_audit_logging_and_event_completeness_def] if {
    input.audit_logging_enabled == true
    "policy_changes" in input.logged_event_categories
    "admin_actions" in input.logged_event_categories
    "compliance_events" in input.logged_event_categories
    "remote_commands" in input.logged_event_categories
    input.log_retention_days >= 90
}

countermeasures contains _audit_logging_and_event_completeness_def if {
    count(audit_logging_and_event_completeness) > 0
}
