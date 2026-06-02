package _dt_built_in.countermeasures.role_based_access_control



_role_only_permission_grants_with_deny_by_default_enforcement_def := {
    "name": "Role-only permission grants with deny-by-default enforcement",
    "description": "All effective permissions trace to a role assignment (no direct user-to-permission grants, no ad-hoc ACEs) and access is denied unless a role explicitly authorizes it, with the engine failing closed on absence of an authorizing role. This is the defining RBAC invariant (INCITS 359 Core RBAC) and blunts privilege escalation via ungoverned exception paths and default-allow fallthrough (T1548).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management \u2014 role-only grants with deny-by-default constrains how privileges are conferred and prevents ungoverned escalation paths."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 all permissions trace to managed role assignments, eliminating direct ad-hoc user grants."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 deny-by-default role-only authorization scopes account permissions to explicitly granted roles."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Fail-closed deny-by-default authorization blunts a valid account's reach to only what an explicit role grants, limiting abuse of valid accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Role-only grants with no direct user-to-permission paths remove the ungoverned exception channels that account-manipulation exploits to escalate."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

role_only_permission_grants_with_deny_by_default_enforcement[_role_only_permission_grants_with_deny_by_default_enforcement_def] if {
    input.permissions_granted_via_roles_only == true
    input.permissions_granted_via_roles_only == true
    input.deny_by_default_authorization == true
}

countermeasures contains _role_only_permission_grants_with_deny_by_default_enforcement_def if {
    count(role_only_permission_grants_with_deny_by_default_enforcement) > 0
}

_rbac_enforced_at_every_resource_path_without_bypass_def := {
    "name": "RBAC enforced at every resource path without bypass",
    "description": "The role decision is enforced at the resource/PEP for every request and cannot be circumvented by reaching the resource through an unauthenticated or non-RBAC path (direct DB connection, object store, admin console), with the same role check applied at system/application/service levels. Closes the back-door bypass that defeats UI-only enforcement (T1078).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged account management \u2014 restricting role-governed access at every enforcement point limits abuse of valid/privileged accounts."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1030",
            "attributes": {
                "justification": "Network segmentation \u2014 closing non-RBAC paths (direct DB/object-store/admin console) isolates the resource so the role check cannot be bypassed."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 enforcing the RBAC decision uniformly at the resource PEP is a permission-hardening control."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 uniform PEP enforcement with no bypass path prevents a valid account from reaching the resource through a non-RBAC route that skips the role check."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {
                "justification": "Abuse Elevation Control Mechanism \u2014 applying the same role check at every layer denies escalation via ungoverned non-RBAC enforcement gaps."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

rbac_enforced_at_every_resource_path_without_bypass[_rbac_enforced_at_every_resource_path_without_bypass_def] if {
    input.rbac_enforced_at_resource_pep == true
    input.rbac_enforced_at_resource_pep == true
}

countermeasures contains _rbac_enforced_at_every_resource_path_without_bypass_def if {
    count(rbac_enforced_at_every_resource_path_without_bypass) > 0
}

_least_privilege_role_scoping_with_privileged_role_minimization_def := {
    "name": "Least-privilege role scoping with privileged-role minimization",
    "description": "Each role authorizes only the accesses its task requires (no wildcard/admin-equivalent grants) and privileged/admin roles are held by a minimal named set who perform routine work from separate non-privileged roles. Limits the blast radius of a compromised principal and curbs standing escalation (T1078, T1548).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management \u2014 minimizing and scoping privileged-role membership is the catalog mitigation this control implements."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 least-privilege role scoping and separate non-privileged accounts realize this mitigation."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 the D3FEND identity of constraining role permissions to least privilege."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Least-privilege scoping limits what a compromised valid account can reach, reducing the impact of Valid Accounts abuse."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {
                "justification": "Minimizing privileged roles and removing wildcard grants curbs standing Abuse Elevation Control Mechanism escalation paths."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134",
            "attributes": {
                "justification": "Constraining privileged-role assignment hardens against Access Token Manipulation by reducing the standing high-privilege tokens available to abuse."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

least_privilege_role_scoping_with_privileged_role_minimization[_least_privilege_role_scoping_with_privileged_role_minimization_def] if {
    input.role_grants_least_privilege == true
    input.role_grants_least_privilege == true
    input.privileged_roles_minimized == true
    input.admins_use_separate_nonprivileged_accounts == true
}

countermeasures contains _least_privilege_role_scoping_with_privileged_role_minimization_def if {
    count(least_privilege_role_scoping_with_privileged_role_minimization) > 0
}

_separation_of_duties_enforced_over_toxic_role_combinations_def := {
    "name": "Separation of duties enforced over toxic role combinations",
    "description": "Documented mutually-exclusive duty pairs are enforced as Static SoD (cannot be assigned both) and/or Dynamic SoD (cannot activate both in one session), so no single principal can complete a sensitive end-to-end action alone (e.g. maker = checker). Prevents unilateral fraud and damaging change (T1098).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {}
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Static/Dynamic SoD blocks a single principal from holding or activating a toxic role combination, preventing unilateral account-manipulation that grants end-to-end sensitive capability."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Enforced separation of duties limits what any single valid account can accomplish alone, constraining abuse of legitimate access to complete privileged end-to-end actions."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484",
            "attributes": {
                "justification": "SSD/DSD constraints prevent a single principal from acquiring the toxic role combination needed to unilaterally modify domain/policy configuration."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

separation_of_duties_enforced_over_toxic_role_combinations[_separation_of_duties_enforced_over_toxic_role_combinations_def] if {
    input.segregation_of_duties_enforced == true
    input.segregation_of_duties_enforced == true
}

countermeasures contains _separation_of_duties_enforced_over_toxic_role_combinations_def if {
    count(separation_of_duties_enforced_over_toxic_role_combinations) > 0
}

_role_definitions_governed_with_role_explosion_hygiene_def := {
    "name": "Role definitions governed with role-explosion hygiene",
    "description": "Each role has a documented purpose, owner, and permission set maintained under change control, and the role model is kept rationalized via role mining/consolidation and hierarchy rather than accreting near-duplicate single-member roles. Prevents ungoverned role-change drift that weakens access control and re-creates direct-grant behaviour (T1484).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User account management \u2014 governed, documented, change-controlled role definitions are the catalog discipline this mitigation prescribes."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged account management \u2014 rationalized role model with documented owners curbs ungoverned privileged-role accretion."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 the control's defensive identity is governing the permission sets bound to roles."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484",
            "attributes": {
                "justification": "Domain/policy modification \u2014 change-controlled, documented role definitions prevent the ungoverned role-change drift that weakens access policy."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account manipulation \u2014 governed role definitions with owners and change control harden against unauthorized permission-set alterations."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

role_definitions_governed_with_role_explosion_hygiene[_role_definitions_governed_with_role_explosion_hygiene_def] if {
    input.role_definitions_documented_and_governed == true
    input.role_change_control_enforced == true
    input.role_model_rationalized_no_explosion == true
}

countermeasures contains _role_definitions_governed_with_role_explosion_hygiene_def if {
    count(role_definitions_governed_with_role_explosion_hygiene) > 0
}

_periodic_access_recertification_with_centralized_authority_def := {
    "name": "Periodic access recertification with centralized authority",
    "description": "Role assignments are reviewed on a defined cadence (attestation campaigns confirm or revoke each grant, results recorded) and access is centralized through a directory/IdP so grants and revocations apply consistently from a single source of truth. Closes the gap where access outlives its need and where N disconnected role tables let stale access linger (T1098).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.3,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User account management \u2014 periodic recertification confirms or revokes each role assignment, the catalog identity of this control."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged account management \u2014 centralized directory authority governs privileged grants from a single source of truth."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 recertification campaigns enforce the permitted permission set per assignment."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AL",
            "attributes": {
                "justification": "Account Locking / governance via centralized authority enabling consistent revocation of stale access."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 recertification + centralized revocation detect and remove unauthorized or stale grants before they persist."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 bounded-cadence recertification revokes access that outlives its need, shrinking the standing-access foothold."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

periodic_access_recertification_with_centralized_authority[_periodic_access_recertification_with_centralized_authority_def] if {
    input.periodic_privilege_recertification == true
    input.recertification_max_interval_days <= 90
    input.centralized_authorization_directory == true
}

countermeasures contains _periodic_access_recertification_with_centralized_authority_def if {
    count(periodic_access_recertification_with_centralized_authority) > 0
}

_joiner_mover_leaver_lifecycle_deprovisioning_enforced_def := {
    "name": "Joiner-mover-leaver lifecycle deprovisioning enforced",
    "description": "Role assignments track identity lifecycle: granted per least privilege on hire, old roles removed on transfer (no privilege accumulation), and all access revoked promptly on termination within the policy window. Removes the orphaned/standing-access foothold that transferred or terminated principals otherwise retain (T1078).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AL",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Prompt deprovisioning on transfer and termination removes the valid-but-orphaned accounts and standing role access an adversary would otherwise reuse as Valid Accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Lifecycle-driven role grants and removals keep account/role membership tied to the authoritative identity source, limiting unauthorized account-manipulation persistence."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1136",
            "attributes": {
                "justification": "Governing all role provisioning through the joiner-mover-leaver lifecycle constrains ungoverned account/role creation outside the authoritative process."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

joiner_mover_leaver_lifecycle_deprovisioning_enforced[_joiner_mover_leaver_lifecycle_deprovisioning_enforced_def] if {
    input.joiner_mover_leaver_lifecycle_enforced == true
    input.joiner_mover_leaver_lifecycle_enforced == true
    input.offboarding_credential_revocation_enforced == true
}

countermeasures contains _joiner_mover_leaver_lifecycle_deprovisioning_enforced_def if {
    count(joiner_mover_leaver_lifecycle_deprovisioning_enforced) > 0
}

_role_assignment_and_change_audit_logging_integrity_def := {
    "name": "Role assignment and change audit logging integrity",
    "description": "Role assignments and changes (grant, revoke, role-definition edits, privileged-membership changes) are logged with actor, target, role, and timestamp to a centralized, tamper-protected store. Makes account manipulation and policy-weakening edits detectable and attributable (T1098, T1484).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Tamper-evident logging of grant/revoke and privileged-membership changes makes account-manipulation events detectable and attributable."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "A tamper-protected, append-only audit store defeats indicator removal / log tampering by preserving the record of role and access changes."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

role_assignment_and_change_audit_logging_integrity[_role_assignment_and_change_audit_logging_integrity_def] if {
    input.identity_access_audit_logging_enabled == true
    input.role_assignment_changes_logged == true
    input.audit_log_tamper_evident == true
}

countermeasures contains _role_assignment_and_change_audit_logging_integrity_def if {
    count(role_assignment_and_change_audit_logging_integrity) > 0
}
