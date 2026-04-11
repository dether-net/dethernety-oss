package _dt_built_in.countermeasures.privileged_access_management

_just_in_time_access_provisioning_def := {
    "name": "Just In Time Access Provisioning",
    "description": "Provides time-bound, on-demand elevation of privileges that automatically expire, minimizing the window during which privileged credentials are active and reducing standing access exposure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

just_in_time_access_provisioning[_just_in_time_access_provisioning_def] if {
    input.jit_access_enabled == true
    input.max_session_duration_minutes <= 480
    input.standing_privileged_accounts_exist == false
    input.approval_workflow_enabled == true
}

just_in_time_access_provisioning[_just_in_time_access_provisioning_def] if {
    input.jit_access_enabled == true
    input.max_session_duration_minutes <= 60
    input.standing_privileged_accounts_exist == false
}

countermeasures contains _just_in_time_access_provisioning_def if {
    count(just_in_time_access_provisioning) > 0
}

_privileged_session_recording_def := {
    "name": "Privileged Session Recording",
    "description": "Captures full session recordings including keystrokes, commands, and screen activity for all privileged sessions, enabling forensic reconstruction and post-incident investigation with tamper-evident logs.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

privileged_session_recording[_privileged_session_recording_def] if {
    input.session_recording_enabled == true
    input.recording_scope == "all"
    input.tamper_evident_storage == true
}

privileged_session_recording[_privileged_session_recording_def] if {
    input.session_recording_enabled == true
    input.recording_scope == "partial"
    input.tamper_evident_storage == true
}

countermeasures contains _privileged_session_recording_def if {
    count(privileged_session_recording) > 0
}

_credential_vaulting_and_rotation_def := {
    "name": "Credential Vaulting And Rotation",
    "description": "Stores privileged credentials in an encrypted vault and automatically rotates passwords and SSH keys on a scheduled or post-use basis, preventing credential reuse and reducing the value of stolen credentials.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

credential_vaulting_and_rotation[_credential_vaulting_and_rotation_def] if {
    input.vault_enabled == true
    input.rotation_policy in ["scheduled", "both"]
    input.max_rotation_interval_days <= 90
    "password" in input.credential_types_covered
}

credential_vaulting_and_rotation[_credential_vaulting_and_rotation_def] if {
    input.vault_enabled == true
    input.rotation_policy in ["post_use", "both"]
    "password" in input.credential_types_covered
}

credential_vaulting_and_rotation[_credential_vaulting_and_rotation_def] if {
    input.vault_enabled == true
    input.rotation_policy in ["scheduled", "both"]
    input.max_rotation_interval_days <= 90
    "ssh_key" in input.credential_types_covered
}

credential_vaulting_and_rotation[_credential_vaulting_and_rotation_def] if {
    input.vault_enabled == true
    input.rotation_policy in ["post_use", "both"]
    "ssh_key" in input.credential_types_covered
}

countermeasures contains _credential_vaulting_and_rotation_def if {
    count(credential_vaulting_and_rotation) > 0
}

_real_time_behavioral_analytics_def := {
    "name": "Real Time Behavioral Analytics",
    "description": "Continuously baselines normal privileged user behavior and generates alerts when deviations occur, such as unusual access times, atypical resource access, or abnormal command sequences, enabling early detection of account compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

real_time_behavioral_analytics[_real_time_behavioral_analytics_def] if {
    input.behavioral_baselining_enabled == true
    count(input.alert_triggers_configured) >= 2
    input.alert_notification_destination
}

real_time_behavioral_analytics[_real_time_behavioral_analytics_def] if {
    input.behavioral_baselining_enabled == true
    "abnormal_command_sequence" in input.alert_triggers_configured
    "unusual_access_time" in input.alert_triggers_configured
}

countermeasures contains _real_time_behavioral_analytics_def if {
    count(real_time_behavioral_analytics) > 0
}

_multi_factor_authentication_enforcement_def := {
    "name": "Multi Factor Authentication Enforcement",
    "description": "Mandates step-up or continuous MFA for all privileged access attempts, providing an additional verification layer that prevents unauthorized elevation even when primary credentials are compromised.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

multi_factor_authentication_enforcement[_multi_factor_authentication_enforcement_def] if {
    input.mfa_enforcement_scope in ["all_privileged", "continuous"]
    input.mfa_bypass_exceptions_exist == false
    input.mfa_method_strength in ["authenticator_app", "phishing_resistant"]
}

countermeasures contains _multi_factor_authentication_enforcement_def if {
    count(multi_factor_authentication_enforcement) > 0
}

_privileged_access_audit_trail_completeness_def := {
    "name": "Privileged Access Audit Trail Completeness",
    "description": "Generates immutable, timestamped audit logs covering all privileged account authentications, authorization decisions, and actions taken, supporting compliance reporting and forensic investigations.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

privileged_access_audit_trail_completeness[_privileged_access_audit_trail_completeness_def] if {
    input.audit_logging_enabled == false
}

privileged_access_audit_trail_completeness[_privileged_access_audit_trail_completeness_def] if {
    input.audit_logging_enabled == true
    input.log_immutability_mechanism == "none"
}

privileged_access_audit_trail_completeness[_privileged_access_audit_trail_completeness_def] if {
    input.audit_logging_enabled == true
    input.log_retention_days < 90
}

privileged_access_audit_trail_completeness[_privileged_access_audit_trail_completeness_def] if {
    input.audit_logging_enabled == true
    not "authentication" in input.logged_event_types
}

privileged_access_audit_trail_completeness[_privileged_access_audit_trail_completeness_def] if {
    input.audit_logging_enabled == true
    not "authorization" in input.logged_event_types
}

countermeasures contains _privileged_access_audit_trail_completeness_def if {
    count(privileged_access_audit_trail_completeness) > 0
}

_access_request_workflow_and_approval_def := {
    "name": "Access Request Workflow And Approval",
    "description": "Enforces a structured request-and-approval workflow before granting privileged access, ensuring human authorization checkpoints exist for sensitive operations and creating accountability records.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

access_request_workflow_and_approval[_access_request_workflow_and_approval_def] if {
    input.approval_workflow_enabled == true
    input.minimum_approvers_required >= 1
    input.approval_audit_logging_enabled == true
    input.access_expiry_enforcement == "automatic"
}

access_request_workflow_and_approval[_access_request_workflow_and_approval_def] if {
    input.approval_workflow_enabled == true
    input.minimum_approvers_required >= 1
    input.approval_audit_logging_enabled == true
    input.access_expiry_enforcement == "manual"
}

countermeasures contains _access_request_workflow_and_approval_def if {
    count(access_request_workflow_and_approval) > 0
}

_session_termination_and_automated_response_def := {
    "name": "Session Termination And Automated Response",
    "description": "Enables automatic or operator-triggered termination of active privileged sessions upon detection of policy violations or anomalous behavior, limiting damage from ongoing malicious activity in real time.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

session_termination_and_automated_response[_session_termination_and_automated_response_def] if {
    input.automated_session_termination_enabled == true
    count(input.session_termination_triggers) >= 1
    input.termination_audit_logging_enabled == true
}

session_termination_and_automated_response[_session_termination_and_automated_response_def] if {
    input.operator_termination_capability == true
    count(input.session_termination_triggers) >= 1
    input.termination_audit_logging_enabled == true
}

countermeasures contains _session_termination_and_automated_response_def if {
    count(session_termination_and_automated_response) > 0
}

_least_privilege_role_enforcement_def := {
    "name": "Least Privilege Role Enforcement",
    "description": "Enforces granular, role-based privilege scoping that restricts each privileged user to only the minimum permissions required for their function, reducing the blast radius of any single account compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

least_privilege_role_enforcement[_least_privilege_role_enforcement_def] if {
    input.rbac_enabled == true
    input.overprivileged_role_count == 0
    input.privilege_review_frequency in ["continuous", "quarterly"]
}

least_privilege_role_enforcement[_least_privilege_role_enforcement_def] if {
    input.rbac_enabled == true
    input.overprivileged_role_count == 0
    input.privilege_review_frequency == "semi_annual"
}

countermeasures contains _least_privilege_role_enforcement_def if {
    count(least_privilege_role_enforcement) > 0
}

_integration_with_siem_and_soc_tooling_def := {
    "name": "Integration With Siem And Soc Tooling",
    "description": "Provides native or API-based integration with SIEM platforms, forwarding enriched privileged access events for correlation, alerting, and automated playbook triggering, extending detection coverage across the security stack.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

integration_with_siem_and_soc_tooling[_integration_with_siem_and_soc_tooling_def] if {
    input.siem_integration_enabled == true
    not input.event_forwarding_method in ["none"]
    "session_start" in input.forwarded_event_types
    "credential_checkout" in input.forwarded_event_types
}

countermeasures contains _integration_with_siem_and_soc_tooling_def if {
    count(integration_with_siem_and_soc_tooling) > 0
}
