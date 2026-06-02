package _dt_built_in.exposures.administrator



_weak_non_phishing_resistant_admin_authentication_def := {
    "name": "Weak / non-phishing-resistant admin authentication",
    "description": "Privileged logins gated by only a password or a phishable second factor (SMS/OTP/push) are captured via AiTM proxy phishing or credential stuffing, yielding direct admin account takeover. Phishing-resistant FIDO2/WebAuthn or PKI authenticators (AAL2/AAL3) defeat the proxy.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1056.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_non_phishing_resistant_admin_authentication[_weak_non_phishing_resistant_admin_authentication_def] if {
    not input.mfa_enforced_for_admin
}

weak_non_phishing_resistant_admin_authentication[_weak_non_phishing_resistant_admin_authentication_def] if {
    input.phishing_resistant_authenticator_required == "sms_otp_or_push"
}

weak_non_phishing_resistant_admin_authentication[_weak_non_phishing_resistant_admin_authentication_def] if {
    not input.admin_credential_hygiene
}

exposures contains _weak_non_phishing_resistant_admin_authentication_def if {
    count(weak_non_phishing_resistant_admin_authentication) > 0
}

_compromise_abuse_of_valid_privileged_credentials_def := {
    "name": "Compromise / abuse of valid privileged credentials",
    "description": "An adversary obtains an admin's legitimate credentials and abuses the valid account for escalation, persistence, and defense evasion, blending into normal traffic. Without privileged-session anomaly monitoring (off-hours, impossible-travel, atypical resource access) the abuse goes undetected.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

compromise_abuse_of_valid_privileged_credentials[_compromise_abuse_of_valid_privileged_credentials_def] if {
    not input.mfa_enforced_for_admin
}

compromise_abuse_of_valid_privileged_credentials[_compromise_abuse_of_valid_privileged_credentials_def] if {
    input.phishing_resistant_authenticator_required == "sms_otp_or_push"
}

compromise_abuse_of_valid_privileged_credentials[_compromise_abuse_of_valid_privileged_credentials_def] if {
    not input.no_shared_privileged_credentials
}

compromise_abuse_of_valid_privileged_credentials[_compromise_abuse_of_valid_privileged_credentials_def] if {
    not input.privileged_session_anomaly_monitoring
}

compromise_abuse_of_valid_privileged_credentials[_compromise_abuse_of_valid_privileged_credentials_def] if {
    not input.admin_credential_hygiene
}

exposures contains _compromise_abuse_of_valid_privileged_credentials_def if {
    count(compromise_abuse_of_valid_privileged_credentials) > 0
}

_standing_over_broad_privilege_exploited_for_lateral_movement_def := {
    "name": "Standing / over-broad privilege exploited for lateral movement",
    "description": "Always-on admin rights and blanket global-admin scope let an attacker who lands one foothold pivot via legitimate remote-access services (RDP, SSH, WinRM, cloud consoles) across the trust zone. Just-in-time elevation (Zero Standing Privileges) and least-privilege role scoping shrink the blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.008",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1563",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

standing_over_broad_privilege_exploited_for_lateral_movement[_standing_over_broad_privilege_exploited_for_lateral_movement_def] if {
    not input.no_standing_admin_privileges_jit_required
}

standing_over_broad_privilege_exploited_for_lateral_movement[_standing_over_broad_privilege_exploited_for_lateral_movement_def] if {
    not input.least_privilege_admin_scoping
}

standing_over_broad_privilege_exploited_for_lateral_movement[_standing_over_broad_privilege_exploited_for_lateral_movement_def] if {
    not input.privileged_access_via_pam_with_session_recording
}

exposures contains _standing_over_broad_privilege_exploited_for_lateral_movement_def if {
    count(standing_over_broad_privilege_exploited_for_lateral_movement) > 0
}

_privilege_creep_dormant_admin_accounts_def := {
    "name": "Privilege creep / dormant admin accounts",
    "description": "Unreviewed entitlements accumulate and terminated or role-changed operators retain admin access; dormant privileged accounts become quiet footholds for re-entry. Periodic recertification (AC-6(7)), prompt revocation on termination, and dormant-account disablement counter this.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

privilege_creep_dormant_admin_accounts[_privilege_creep_dormant_admin_accounts_def] if {
    not input.periodic_privilege_recertification
}

privilege_creep_dormant_admin_accounts[_privilege_creep_dormant_admin_accounts_def] if {
    not input.dormant_admin_accounts_disabled
}

exposures contains _privilege_creep_dormant_admin_accounts_def if {
    count(privilege_creep_dormant_admin_accounts) > 0
}

_shared_un_vaulted_privileged_credentials_def := {
    "name": "Shared / un-vaulted privileged credentials",
    "description": "A generic shared 'admin' login used by multiple operators (or raw long-lived secrets held outside a PAM vault) makes actions non-attributable and multiplies the credential-theft surface. Per-operator named identities and PAM-brokered, session-recorded access restore attribution.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Raw long-lived privileged secrets held outside a PAM vault are unsecured credentials an adversary can recover and reuse."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Shared, un-vaulted privileged credentials let an adversary operate as a valid (non-attributable) account, evading defenses and blending into normal admin activity."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

shared_un_vaulted_privileged_credentials[_shared_un_vaulted_privileged_credentials_def] if {
    input.shared_admin_accounts == true
}

shared_un_vaulted_privileged_credentials[_shared_un_vaulted_privileged_credentials_def] if {
    not input.privileged_access_via_pam_with_session_recording
}

shared_un_vaulted_privileged_credentials[_shared_un_vaulted_privileged_credentials_def] if {
    input.operators_hold_raw_longlived_admin_secrets == true
}

exposures contains _shared_un_vaulted_privileged_credentials_def if {
    count(shared_un_vaulted_privileged_credentials) > 0
}

_internet_exposed_admin_management_interface_def := {
    "name": "Internet-exposed admin / management interface",
    "description": "An admin console, SSH/RDP, or control-plane API reachable directly from the internet is an external-remote-services initial-access surface, frequently entered with valid creds and no exploit signature. Restricting the management plane to internal/VPN/ZTNA and requiring MFA on remote access mitigates it.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.008",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_admin_management_interface[_internet_exposed_admin_management_interface_def] if {
    not input.control_plane_api_not_publicly_exposed
}

internet_exposed_admin_management_interface[_internet_exposed_admin_management_interface_def] if {
    not input.remote_admin_access_requires_mfa
}

internet_exposed_admin_management_interface[_internet_exposed_admin_management_interface_def] if {
    not input.remote_access_via_ztna_or_mfa_vpn
}

exposures contains _internet_exposed_admin_management_interface_def if {
    count(internet_exposed_admin_management_interface) > 0
}

_non_attributable_unlogged_privileged_actions_def := {
    "name": "Non-attributable / unlogged privileged actions",
    "description": "Missing or admin-modifiable audit logs make malicious privileged actions undetectable and unreconstructable, defeating incident response. Tamper-resistant centralized logging of privileged-function execution (AC-6(9)), attributable to a named identity, closes the gap.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

non_attributable_unlogged_privileged_actions[_non_attributable_unlogged_privileged_actions_def] if {
    not input.audit_log_tamper_evident
}

non_attributable_unlogged_privileged_actions[_non_attributable_unlogged_privileged_actions_def] if {
    not input.no_shared_privileged_credentials
}

exposures contains _non_attributable_unlogged_privileged_actions_def if {
    count(non_attributable_unlogged_privileged_actions) > 0
}
