package _dt_built_in.countermeasures.ztna



_continuous_identity_verification_coverage_def := {
    "name": "Continuous Identity Verification Coverage",
    "description": "Provides persistent, per-session re-authentication enforcement ensuring that authenticated sessions cannot be silently hijacked or reused after credential change events, delivering high prevention coverage across all access attempts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

continuous_identity_verification_coverage[_continuous_identity_verification_coverage_def] if {
    input.continuous_reauthentication_enabled == true
    input.credential_change_session_revocation in ["immediate_revocation", "revocation_on_next_request"]
    input.max_session_duration_minutes > 0
    input.max_session_duration_minutes <= 480
}

countermeasures contains _continuous_identity_verification_coverage_def if {
    count(continuous_identity_verification_coverage) > 0
}

_device_posture_validation_accuracy_def := {
    "name": "Device Posture Validation Accuracy",
    "description": "Delivers real-time assessment of endpoint compliance state including patch level, certificate validity, and security tool presence before granting access, ensuring only healthy devices receive network permissions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

device_posture_validation_accuracy[_device_posture_validation_accuracy_def] if {
    input.posture_assessment_enabled == true
    input.posture_enforcement_mode == "enforce"
    count(input.posture_checks_enforced) >= 3
    input.posture_assessment_max_age_minutes <= 60
}

device_posture_validation_accuracy[_device_posture_validation_accuracy_def] if {
    input.posture_assessment_enabled == true
    input.posture_enforcement_mode == "enforce"
    "patch_level" in input.posture_checks_enforced
    "certificate_validity" in input.posture_checks_enforced
    "antivirus_presence" in input.posture_checks_enforced
    input.posture_assessment_max_age_minutes <= 60
}

countermeasures contains _device_posture_validation_accuracy_def if {
    count(device_posture_validation_accuracy) > 0
}

_micro_segmentation_enforcement_def := {
    "name": "Micro Segmentation Enforcement",
    "description": "Provides granular lateral movement prevention by enforcing per-workload, per-user access boundaries, limiting the blast radius of any single compromised identity or device through fine-grained policy application.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

micro_segmentation_enforcement[_micro_segmentation_enforcement_def] if {
    input.policy_enforcement_mode == "enforced"
    input.default_deny_policy_applied == true
}

micro_segmentation_enforcement[_micro_segmentation_enforcement_def] if {
    input.microsegmentation_policy_enforced == true
    input.policy_enforcement_mode == "enforced"
}

countermeasures contains _micro_segmentation_enforcement_def if {
    count(micro_segmentation_enforcement) > 0
}

_context_aware_authorization_precision_def := {
    "name": "Context Aware Authorization Precision",
    "description": "Delivers dynamic permission scoping based on contextual signals such as user location, time of access, risk score, and behavioral baseline, enabling adaptive access decisions beyond static role assignments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

context_aware_authorization_precision[_context_aware_authorization_precision_def] if {
    input.contextual_signals_enabled == true
    input.adaptive_policy_enforcement_mode == "enforced"
    count(input.contextual_signal_types) >= 2
    input.static_role_only_fallback == false
}

countermeasures contains _context_aware_authorization_precision_def if {
    count(context_aware_authorization_precision) > 0
}

_access_request_logging_completeness_def := {
    "name": "Access Request Logging Completeness",
    "description": "Provides comprehensive audit trails of every access request, decision outcome, policy rule applied, and contextual metadata, enabling forensic reconstruction and compliance reporting for all network interactions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

access_request_logging_completeness[_access_request_logging_completeness_def] if {
    "user_id" in input.access_log_fields_captured
    "decision_outcome" in input.access_log_fields_captured
    "timestamp" in input.access_log_fields_captured
    input.log_storage_destination_configured in ["siem", "immutable_store"]
    input.policy_rule_id_logged == true
    input.log_retention_days >= 90
}

countermeasures contains _access_request_logging_completeness_def if {
    count(access_request_logging_completeness) > 0
}

_policy_automation_and_response_integration_def := {
    "name": "Policy Automation And Response Integration",
    "description": "Delivers automated policy enforcement responses including session termination, privilege reduction, and quarantine actions triggered by anomaly detection or risk threshold breaches without requiring manual intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

policy_automation_and_response_integration[_policy_automation_and_response_integration_def] if {
    input.automated_response_actions_enabled == true
    input.risk_threshold_configured == true
    "session_termination" in input.anomaly_trigger_actions
    "quarantine" in input.anomaly_trigger_actions
}

policy_automation_and_response_integration[_policy_automation_and_response_integration_def] if {
    input.automated_response_actions_enabled == true
    input.risk_threshold_configured == true
    "privilege_reduction" in input.anomaly_trigger_actions
    count(input.anomaly_trigger_actions) >= 2
}

countermeasures contains _policy_automation_and_response_integration_def if {
    count(policy_automation_and_response_integration) > 0
}

_multi_factor_authentication_integration_depth_def := {
    "name": "Multi Factor Authentication Integration Depth",
    "description": "Provides deep MFA integration across all access paths including API, remote, and internal access flows, ensuring no authentication bypass paths exist and that all identity assertions are cryptographically bound.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

multi_factor_authentication_integration_depth[_multi_factor_authentication_integration_depth_def] if {
    input.mfa_coverage_scope != "all"
}

multi_factor_authentication_integration_depth[_multi_factor_authentication_integration_depth_def] if {
    input.authentication_bypass_paths_exist == true
}

multi_factor_authentication_integration_depth[_multi_factor_authentication_integration_depth_def] if {
    input.identity_assertion_binding_method == "none"
    input.mfa_coverage_scope == "all"
}

countermeasures contains _multi_factor_authentication_integration_depth_def if {
    count(multi_factor_authentication_integration_depth) > 0
}

_policy_consistency_and_maintainability_def := {
    "name": "Policy Consistency And Maintainability",
    "description": "Provides centralized policy management with version control, conflict detection, and role-based administration, ensuring access rules remain consistent across distributed environments and reducing configuration drift over time.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

policy_consistency_and_maintainability[_policy_consistency_and_maintainability_def] if {
    input.centralized_policy_management_enabled == true
    input.policy_version_control_enabled == true
    input.conflict_detection_enabled == true
    input.rbac_policy_administration_enabled == true
}

countermeasures contains _policy_consistency_and_maintainability_def if {
    count(policy_consistency_and_maintainability) > 0
}

_privileged_access_scope_limitation_def := {
    "name": "Privileged Access Scope Limitation",
    "description": "Enforces just-in-time and just-enough-access provisioning for privileged users, reducing standing elevated permissions and delivering measurable reduction in privilege abuse exposure windows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

privileged_access_scope_limitation[_privileged_access_scope_limitation_def] if {
    input.jit_access_provisioning_enabled == true
    input.max_privileged_session_duration_minutes <= 60
    input.standing_privileged_accounts_count == 0
}

privileged_access_scope_limitation[_privileged_access_scope_limitation_def] if {
    input.jit_access_provisioning_enabled == true
    input.privileged_access_approval_workflow in ["manager_approval", "peer_approval", "automated_policy"]
    input.standing_privileged_accounts_count == 0
}

countermeasures contains _privileged_access_scope_limitation_def if {
    count(privileged_access_scope_limitation) > 0
}
