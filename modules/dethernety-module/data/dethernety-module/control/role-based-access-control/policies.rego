package _dt_built_in.countermeasures.role_based_access_control



_least_privilege_enforcement_def := {
    "name": "Least Privilege Enforcement",
    "description": "Provides scoped permission boundaries per role, ensuring users operate only within their minimum required access set, reducing the blast radius of any single compromised account.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

least_privilege_enforcement[_least_privilege_enforcement_def] if {
    input.roles_defined_with_scoped_permissions == true
    input.users_assigned_least_privilege_role == true
    not input.privileged_role_assignment_review_frequency in ["never"]
    input.separation_of_duties_enforced == true
}

least_privilege_enforcement[_least_privilege_enforcement_def] if {
    input.roles_defined_with_scoped_permissions == true
    input.users_assigned_least_privilege_role == true
    input.privileged_role_assignment_review_frequency in ["continuous", "quarterly"]
}

countermeasures contains _least_privilege_enforcement_def if {
    count(least_privilege_enforcement) > 0
}

_permission_consistency_assurance_def := {
    "name": "Permission Consistency Assurance",
    "description": "Ensures uniform application of access rules across all users assigned to a role, eliminating ad-hoc permission grants that create policy drift or privilege inconsistency.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

permission_consistency_assurance[_permission_consistency_assurance_def] if {
    input.role_permission_enforcement_mode == "strict_role_only"
    input.users_with_direct_permission_grants == 0
    input.role_permission_audit_enabled == true
}

permission_consistency_assurance[_permission_consistency_assurance_def] if {
    input.role_permission_enforcement_mode == "strict_role_only"
    input.users_with_direct_permission_grants == 0
}

countermeasures contains _permission_consistency_assurance_def if {
    count(permission_consistency_assurance) > 0
}

_separation_of_duties_coverage_def := {
    "name": "Separation Of Duties Coverage",
    "description": "Supports enforcement of conflicting role assignments to prevent single users from holding permissions that span sensitive operational boundaries (e.g., approver and requester).",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

separation_of_duties_coverage[_separation_of_duties_coverage_def] if {
    input.sod_policy_enforced == true
    input.conflicting_role_pairs_defined > 0
    input.sod_enforcement_scope == "preventive"
}

separation_of_duties_coverage[_separation_of_duties_coverage_def] if {
    input.sod_policy_enforced == true
    input.conflicting_role_pairs_defined > 0
    input.sod_enforcement_scope == "detective"
}

countermeasures contains _separation_of_duties_coverage_def if {
    count(separation_of_duties_coverage) > 0
}

_access_change_auditability_def := {
    "name": "Access Change Auditability",
    "description": "Provides structured logging of role assignments, modifications, and permission changes, enabling forensic reconstruction of who held what access at any point in time.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

access_change_auditability[_access_change_auditability_def] if {
    input.role_change_logging_enabled == true
    input.permission_change_log_retention_days >= 90
    "role_assigned" in input.logged_event_types
    "role_revoked" in input.logged_event_types
    "permission_modified" in input.logged_event_types
}

countermeasures contains _access_change_auditability_def if {
    count(access_change_auditability) > 0
}

_role_lifecycle_manageability_def := {
    "name": "Role Lifecycle Manageability",
    "description": "Enables efficient onboarding, offboarding, and role transitions by modifying a single role definition rather than individual user permissions, reducing misconfiguration risk during personnel changes.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

role_lifecycle_manageability[_role_lifecycle_manageability_def] if {
    input.role_based_permission_assignment == true
    input.offboarding_role_revocation_automated == true
    input.role_definition_review_frequency in ["continuous", "quarterly"]
}

role_lifecycle_manageability[_role_lifecycle_manageability_def] if {
    input.role_based_permission_assignment == true
    input.offboarding_role_revocation_automated == true
    input.role_definition_review_frequency == "annually"
}

countermeasures contains _role_lifecycle_manageability_def if {
    count(role_lifecycle_manageability) > 0
}

_unauthorized_function_prevention_def := {
    "name": "Unauthorized Function Prevention",
    "description": "Blocks execution of privileged operations or access to sensitive functions by users whose role lacks the required permission, providing real-time preventive coverage at the application or system layer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

unauthorized_function_prevention[_unauthorized_function_prevention_def] if {
    input.rbac_enforcement_enabled == true
    input.privileged_function_permission_check == "all"
    input.default_deny_policy == true
}

unauthorized_function_prevention[_unauthorized_function_prevention_def] if {
    input.rbac_enforcement_enabled == true
    input.privileged_function_permission_check == "partial"
    input.default_deny_policy == true
}

countermeasures contains _unauthorized_function_prevention_def if {
    count(unauthorized_function_prevention) > 0
}

_privilege_escalation_detection_def := {
    "name": "Privilege Escalation Detection",
    "description": "Generates access-denial events when users attempt to perform actions outside their role scope, providing detection signals for anomalous privilege-seeking behavior.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

privilege_escalation_detection[_privilege_escalation_detection_def] if {
    input.rbac_enforcement_enabled == true
    input.access_denial_logging_enabled == true
    input.least_privilege_policy_applied == true
}

privilege_escalation_detection[_privilege_escalation_detection_def] if {
    input.rbac_enforcement_enabled == true
    input.access_denial_logging_enabled == true
}

countermeasures contains _privilege_escalation_detection_def if {
    count(privilege_escalation_detection) > 0
}

_cross_system_integration_depth_def := {
    "name": "Cross System Integration Depth",
    "description": "Provides federated role enforcement across integrated systems (e.g., directories, APIs, cloud platforms) when role definitions are synchronized, extending consistent access policy coverage beyond a single boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

cross_system_integration_depth[_cross_system_integration_depth_def] if {
    input.federated_role_sync_enabled == true
    input.role_policy_coverage == "full"
    input.last_sync_status == "success"
}

countermeasures contains _cross_system_integration_depth_def if {
    count(cross_system_integration_depth) > 0
}
