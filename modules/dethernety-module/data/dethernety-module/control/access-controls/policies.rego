package _dt_built_in.countermeasures.access_controls



_least_privilege_enforcement_def := {
    "name": "Least Privilege Enforcement",
    "description": "Ensures users are granted only the minimum permissions required for their role, preventing over-privileged accounts from accessing unnecessary application functions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AMED",
            "name": "Access Mediation",
            "relevance": "Access mediation directly enforces least privilege by controlling and restricting access decisions at the policy level."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Managing privileged accounts is a core component of least privilege enforcement to limit excessive permissions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3F-UGPH",
            "name": "User Group Permissions",
            "relevance": "Defining and enforcing group-based permissions supports least privilege by scoping access to only what is needed."
        }
    ]
}

least_privilege_enforcement[_least_privilege_enforcement_def] if {
    input.role_permission_scope in ["minimal", "appropriate"]
    input.wildcard_permissions_present == false
    input.separation_of_duties_enforced == true
}

least_privilege_enforcement[_least_privilege_enforcement_def] if {
    input.role_permission_scope == "minimal"
    input.privilege_review_frequency in ["continuous", "quarterly"]
    input.separation_of_duties_enforced == true
    input.wildcard_permissions_present == false
}

countermeasures contains _least_privilege_enforcement_def if {
    count(least_privilege_enforcement) > 0
}

_role_assignment_accuracy_def := {
    "name": "Role Assignment Accuracy",
    "description": "Provides precise mapping between users and roles, ensuring role memberships reflect current organizational responsibilities and reducing permission drift over time.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-JFAPA",
            "name": "Job Function Access Pattern Analysis",
            "relevance": "Analyzing access patterns relative to job functions directly validates that role assignments match actual user responsibilities."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1015",
            "name": "Active Directory Configuration",
            "relevance": "Proper Active Directory configuration ensures roles and group memberships are accurately assigned and maintained."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3F-UGPH",
            "name": "User Group Permissions",
            "relevance": "User group permissions management ensures that role assignments accurately reflect organizational access requirements."
        }
    ]
}

role_assignment_accuracy[_role_assignment_accuracy_def] if {
    input.role_review_process_exists == true
    input.role_review_frequency_days <= 90
    input.orphaned_role_assignments_remediated == true
}

role_assignment_accuracy[_role_assignment_accuracy_def] if {
    input.role_review_process_exists == true
    input.role_review_frequency_days <= 180
    input.orphaned_role_assignments_remediated == true
}

countermeasures contains _role_assignment_accuracy_def if {
    count(role_assignment_accuracy) > 0
}

_permission_boundary_coverage_def := {
    "name": "Permission Boundary Coverage",
    "description": "Delivers comprehensive coverage of all application actions under role-based gates, ensuring no functionality is left unprotected by the access control model.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AM",
            "name": "Access Modeling",
            "relevance": "Access modeling defines and validates the boundaries of permissions across systems, ensuring comprehensive coverage."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-JFAPA",
            "name": "Job Function Access Pattern Analysis",
            "relevance": "Analyzing access patterns by job function identifies gaps or overreach in permission boundaries."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Managing privileged accounts ensures that permission boundaries are enforced and not exceeded by high-risk accounts."
        }
    ]
}

permission_boundary_coverage[_permission_boundary_coverage_def] if {
    input.rbac_enforcement_scope == "all_actions"
    input.unprotected_action_count == 0
    input.default_deny_policy_enabled == true
    input.bypass_mechanisms_present == false
}

countermeasures contains _permission_boundary_coverage_def if {
    count(permission_boundary_coverage) > 0
}

_separation_of_duties_support_def := {
    "name": "Separation Of Duties Support",
    "description": "Enables enforcement of dual-control and mutually exclusive role constraints, preventing any single user from holding conflicting permissions that could enable fraud or error.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3F-UGPH",
            "name": "User Group Permissions",
            "relevance": "User group permissions enable separation of duties by assigning distinct permission sets to different roles or groups."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Privileged account management supports separation of duties by restricting who can perform sensitive administrative actions."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "name": "User Account Management",
            "relevance": "User account management enforces separation of duties by controlling account creation, modification, and access rights."
        }
    ]
}

separation_of_duties_support[_separation_of_duties_support_def] if {
    input.sod_constraints_defined == true
    input.sod_enforcement_mode == "preventive"
}

separation_of_duties_support[_separation_of_duties_support_def] if {
    input.sod_constraints_defined == true
    input.dual_control_workflows_enabled == true
    input.sod_enforcement_mode in ["preventive", "detective"]
}

countermeasures contains _separation_of_duties_support_def if {
    count(separation_of_duties_support) > 0
}

_access_decision_logging_def := {
    "name": "Access Decision Logging",
    "description": "Produces complete audit trails of role-based access decisions, including both granted and denied action attempts, supporting forensic investigation and compliance reporting.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RAPA",
            "name": "Resource Access Pattern Analysis",
            "relevance": "Resource access pattern analysis relies on and supports logging of access decisions to detect anomalous behavior."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing directly addresses the need to log and review access decisions for security monitoring and compliance."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AM",
            "name": "Access Modeling",
            "relevance": "Access modeling uses logged access decision data to build baselines and detect deviations."
        }
    ]
}

access_decision_logging[_access_decision_logging_def] if {
    input.access_decision_logging_enabled == true
    "granted" in input.logged_decision_types
    "denied" in input.logged_decision_types
    input.log_includes_user_and_resource == true
}

countermeasures contains _access_decision_logging_def if {
    count(access_decision_logging) > 0
}

_role_lifecycle_maintainability_def := {
    "name": "Role Lifecycle Maintainability",
    "description": "Provides structured mechanisms for creating, modifying, and retiring roles, enabling administrators to respond quickly to organizational changes without introducing permission gaps or accumulation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-APA",
            "name": "Access Policy Administration",
            "relevance": "Access policy administration directly supports the lifecycle management of roles by enabling policy creation, modification, and retirement."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AM",
            "name": "Access Modeling",
            "relevance": "Access modeling provides the framework needed to maintain and evolve role definitions throughout their lifecycle."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "name": "User Account Management",
            "relevance": "User account management encompasses the processes for maintaining, updating, and deprovisioning roles over time."
        }
    ]
}

role_lifecycle_maintainability[_role_lifecycle_maintainability_def] if {
    input.role_creation_process_defined == true
    input.role_retirement_process_defined == true
    input.role_review_frequency in ["continuous", "quarterly", "semi_annually", "annually"]
    input.orphaned_roles_present == false
}

countermeasures contains _role_lifecycle_maintainability_def if {
    count(role_lifecycle_maintainability) > 0
}

_centralized_policy_enforcement_def := {
    "name": "Centralized Policy Enforcement",
    "description": "Applies role-based rules consistently from a single enforcement point across all application modules, eliminating per-feature permission logic inconsistencies.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Application configuration hardening supports centralized policy enforcement by standardizing security settings across systems."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Centrally managing privileged accounts ensures consistent policy enforcement across the enterprise."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1036",
            "name": "Account Use Policies",
            "relevance": "Account use policies provide the centralized rules governing how accounts and access are managed organization-wide."
        }
    ]
}

centralized_policy_enforcement[_centralized_policy_enforcement_def] if {
    input.centralized_enforcement_point_exists == true
    input.enforcement_coverage_scope == "full"
    input.per_feature_permission_logic_present == false
}

countermeasures contains _centralized_policy_enforcement_def if {
    count(centralized_policy_enforcement) > 0
}

_privileged_action_prevention_coverage_def := {
    "name": "Privileged Action Prevention Coverage",
    "description": "Restricts destructive or sensitive operations such as deletion, export, and administrative configuration to explicitly authorized roles, reducing blast radius of compromised standard accounts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-OPR",
            "name": "Operating Mode Restriction",
            "relevance": "Operating mode restriction limits the conditions under which privileged actions can be executed, reducing the attack surface."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AL",
            "name": "Account Locking",
            "relevance": "Account locking prevents unauthorized or malicious privileged actions by disabling accounts upon suspicious activity."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Privileged account management is the primary control for preventing unauthorized privileged actions across systems."
        }
    ]
}

privileged_action_prevention_coverage[_privileged_action_prevention_coverage_def] if {
    input.privileged_roles_defined == true
    input.sensitive_operations_role_enforced == "full"
    input.standard_user_privilege_separation == true
}

countermeasures contains _privileged_action_prevention_coverage_def if {
    count(privileged_action_prevention_coverage) > 0
}

_integration_with_identity_provider_def := {
    "name": "Integration With Identity Provider",
    "description": "Synchronizes role assignments with authoritative identity sources, ensuring role memberships are automatically updated when users change positions or leave the organization.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AA",
            "name": "Agent Authentication",
            "relevance": "Agent authentication directly relates to integrating with identity providers to verify user and service identities."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1015",
            "name": "Active Directory Configuration",
            "relevance": "Active Directory configuration is central to identity provider integration for authentication and authorization services."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "name": "Multi-factor Authentication",
            "relevance": "Multi-factor authentication is a key capability enabled through identity provider integration to strengthen access security."
        }
    ]
}

integration_with_identity_provider[_integration_with_identity_provider_def] if {
    input.idp_sync_enabled == true
    input.sync_frequency_minutes <= 1440
    input.deprovisioning_action in ["immediate_revocation", "deactivate_account"]
}

integration_with_identity_provider[_integration_with_identity_provider_def] if {
    input.idp_sync_enabled == true
    input.sync_frequency_minutes == 0
    input.deprovisioning_action in ["immediate_revocation", "deactivate_account"]
}

countermeasures contains _integration_with_identity_provider_def if {
    count(integration_with_identity_provider) > 0
}

_role_review_and_recertification_def := {
    "name": "Role Review And Recertification",
    "description": "Supports periodic access reviews where managers certify or revoke role assignments, providing a preventive control against accumulated entitlements and orphaned permissions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-JFAPA",
            "name": "Job Function Access Pattern Analysis",
            "relevance": "Job function access pattern analysis identifies misaligned access rights, directly supporting periodic role recertification processes."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AM",
            "name": "Access Modeling",
            "relevance": "Access modeling provides the baseline needed to evaluate and recertify whether current role assignments remain appropriate."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing is the foundational process that enables systematic review and recertification of roles and access rights."
        }
    ]
}

role_review_and_recertification[_role_review_and_recertification_def] if {
    input.role_review_process_enabled == true
    input.revocation_action_supported == true
    input.review_frequency_days <= 365
    input.last_review_completed_days_ago <= 365
}

countermeasures contains _role_review_and_recertification_def if {
    count(role_review_and_recertification) > 0
}
