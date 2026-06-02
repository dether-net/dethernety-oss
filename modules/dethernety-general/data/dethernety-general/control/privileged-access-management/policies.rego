package _dt_built_in.countermeasures.privileged_access_management



_credential_vaulting_rotation_and_secrets_management_def := {
    "name": "credential_vaulting_rotation_and_secrets_management",
    "description": "All human and non-human privileged credentials (admin passwords, root/DB keys, service-account secrets, API keys, SSH keys, tokens) live only in a central encrypted vault \u2014 AES-256 at rest \u2014 are automatically rotated on a 30-90d cycle with rotate-after-checkin one-time-use for high-value accounts, and are never hardcoded in code or config; applications fetch them at runtime. PRESENT, this blunts valid-account abuse, OS credential dumping, and theft from password stores by leaving an attacker only short-lived, vaulted secrets with no human-held standing passwords to steal.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged account management \u2014 vaulting and runtime fetch of privileged credentials."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1027",
            "attributes": {
                "justification": "Password policies \u2014 automatic rotation and one-time-use checkout for high-value accounts."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt sensitive information \u2014 AES-256 vault encryption at rest."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CRO",
            "attributes": {
                "justification": "Credential Rotation \u2014 enforced rotation cycle."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PR",
            "attributes": {
                "justification": "Pointer/credential reference handling \u2014 runtime secret fetch instead of hardcoded secrets."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SPP",
            "attributes": {
                "justification": "Strong Password Policy \u2014 vaulted, rotated privileged credentials."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003",
            "attributes": {
                "justification": "OS Credential Dumping is blunted as privileged credentials are vaulted and rotated rather than left as standing reusable secrets."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555",
            "attributes": {
                "justification": "Credentials from Password Stores is mitigated by centralizing credentials in an encrypted vault with runtime-only retrieval."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Unsecured Credentials is mitigated by ensuring secrets are never hardcoded in code or config."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts abuse is limited by rotation and one-time-use checkout shortening the window a stolen credential remains valid."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

credential_vaulting_rotation_and_secrets_management[_credential_vaulting_rotation_and_secrets_management_def] if {
    input.privileged_credentials_vaulted == true
    input.credential_rotation_enforced == true
    input.credential_rotation_max_days <= 90
    input.secrets_in_secret_manager_not_repo == true
    input.vault_at_rest_encryption_strength == "AES_256"
}

countermeasures contains _credential_vaulting_rotation_and_secrets_management_def if {
    count(credential_vaulting_rotation_and_secrets_management) > 0
}

_just_in_time_zero_standing_privilege_elevation_def := {
    "name": "just_in_time_zero_standing_privilege_elevation",
    "description": "Admins hold no persistent elevated rights; privilege is granted just-in-time for a bounded window (e.g. <=4h) and auto-revoked at task end/timeout, with no permanent membership in Domain Admins / root / cloud Owner groups, scoped to least privilege and recertified quarterly. PRESENT, this eliminates the standing-admin surface that privilege-escalation and elevation-control abuse depend on and removes always-on memberships an attacker could hijack.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.3,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management \u2014 JIT elevation with zero standing privilege is the canonical realization of this mitigation."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 removing permanent membership in privileged groups and scoping access to least privilege."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 the control's D3FEND identity for constraining what an account may do."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AL",
            "attributes": {
                "justification": "Account Locking / lifecycle constraint \u2014 auto-revocation of time-bounded elevation."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 zero standing privilege denies attackers persistent elevated accounts to abuse."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {
                "justification": "Abuse Elevation Control Mechanism \u2014 bounded JIT elevation removes the standing elevated context such abuse relies on."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134",
            "attributes": {
                "justification": "Access Token Manipulation \u2014 eliminating standing privileged tokens limits token theft/impersonation impact."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

just_in_time_zero_standing_privilege_elevation[_just_in_time_zero_standing_privilege_elevation_def] if {
    input.no_standing_admin_privileges_jit_required == true
    input.no_standing_admin_privileges_jit_required == true
    input.max_elevation_window_hours <= 4
    input.periodic_privilege_recertification == true
}

countermeasures contains _just_in_time_zero_standing_privilege_elevation_def if {
    count(just_in_time_zero_standing_privilege_elevation) > 0
}

_non_bypassable_session_brokering_with_phishing_resistant_mfa_def := {
    "name": "non_bypassable_session_brokering_with_phishing_resistant_mfa",
    "description": "All RDP/SSH/DB/cloud-CLI admin access is proxied through a central PAM gateway/jump host that enforces protocol and command filtering, and direct-to-target admin paths are network-blocked by segmentation so the broker cannot be bypassed; the broker requires phishing-resistant MFA (PIV/FIDO2/WebAuthn, AAL2/AAL3) bound per-user with no SMS/OTP fallback before any session begins. PRESENT, this defeats AiTM/token-replay, valid-account abuse, and direct-to-target connection bypass.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {
                "justification": "Phishing-resistant MFA on the PAM broker is multi-factor authentication enforcing strong identity assurance before any privileged session."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Centralized brokering of all privileged access through a non-bypassable PAM gateway is privileged account management."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {
                "justification": "The broker enforces multi-factor authentication with phishing-resistant authenticators bound per-user."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Phishing-resistant MFA with no weak fallback defeats credential brute-forcing/password-guessing against the broker."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Origin-bound FIDO2/WebAuthn authenticators with no SMS/OTP fallback defeat adversary-in-the-middle token relay/replay at the broker."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Non-bypassable brokering plus per-user phishing-resistant MFA blocks valid-account abuse and direct-to-target access using stolen credentials."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

non_bypassable_session_brokering_with_phishing_resistant_mfa[_non_bypassable_session_brokering_with_phishing_resistant_mfa_def] if {
    input.bastion_mediates_all_admin_access == true
    input.bastion_mediates_all_admin_access == true
    input.phishing_resistant_authenticator_required == true
    input.phishing_resistant_authenticator_required == true
}

countermeasures contains _non_bypassable_session_brokering_with_phishing_resistant_mfa_def if {
    count(non_bypassable_session_brokering_with_phishing_resistant_mfa) > 0
}

_governed_approval_workflow_with_separation_and_break_glass_dual_control_def := {
    "name": "governed_approval_workflow_with_separation_and_break_glass_dual_control",
    "description": "Every privileged grant requires a formal request with business justification and tiered approval (requester/approver separated, security-admin separated from audit per AC-5), auto-revokes on expiry, and is recertified periodically; emergency break-glass access is pre-defined, requires dual-control activation, fires immediate alerts, is fully recorded, auto-expires (e.g. 4h), and mandates post-use review. PRESENT, this prevents confused-deputy escalation and converts ungoverned shared emergency credentials into a tightly governed, auditable path.",
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
                "justification": "Privileged account management \u2014 governed request/approval, separation of duties, and break-glass dual control restrict and audit the use of privileged accounts."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User account management \u2014 formal grant lifecycle with expiry, recertification, and SoD enforces least-privilege account governance."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 the workflow constrains and governs which principals receive privileged permissions and for how long."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 governed, auditable, auto-expiring grants and elimination of shared ungoverned emergency credentials reduce abuse of legitimate accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {
                "justification": "Abuse Elevation Control Mechanism \u2014 tiered approval with separation of duties blocks unilateral privilege elevation (confused-deputy escalation)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 formal request/approval gate, SoD, and recertification prevent unauthorized or self-granted permission changes."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

governed_approval_workflow_with_separation_and_break_glass_dual_control[_governed_approval_workflow_with_separation_and_break_glass_dual_control_def] if {
    input.provisioning_requires_approval == true
    input.segregation_of_duties_enforced == true
    input.break_glass_dual_control_enforced == true
    input.break_glass_max_window_hours <= 4
}

countermeasures contains _governed_approval_workflow_with_separation_and_break_glass_dual_control_def if {
    count(governed_approval_workflow_with_separation_and_break_glass_dual_control) > 0
}

_dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement_def := {
    "name": "dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement",
    "description": "Privileged actions run from dedicated, individually-attributable admin accounts (never the daily account, never shared) so every action maps to one human; all privileged and service accounts across Windows/Unix/DB/cloud/network are auto-discovered monthly+, newly-created privileged accounts are detected within 24-48h, dormant accounts auto-disable within a bounded window (<=45d) and access is revoked same-day on departure. PRESENT, this denies persistence via rogue/orphaned admin accounts and account-manipulation, and keeps no latent foothold.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 dedicated attributable admin accounts, dormant-account disablement, and same-day departure revocation are account-management controls."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management \u2014 discovery, attribution, and lifecycle control of privileged/service accounts."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DAM",
            "attributes": {
                "justification": "Domain Account Monitoring \u2014 auto-discovery of privileged and service accounts across the estate."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AL",
            "attributes": {
                "justification": "Account Locking \u2014 auto-disable of dormant accounts and same-day departure revocation."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 restricting privileged actions to dedicated attributable accounts."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 discovery and lifecycle control surface and remove rogue/orphaned privileged accounts created or modified for persistence."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 monthly+ discovery and 24-48h new-account detection surface unauthorized use of privileged/dormant accounts."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement[_dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement_def] if {
    input.dedicated_attributable_admin_accounts_enforced == true
    input.service_account_inventory_governed == true
    input.dormant_account_disable_window_days <= 45
    input.offboarding_credential_revocation_enforced == true
}

countermeasures contains _dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement_def if {
    count(dedicated_attributable_admin_accounts_with_discovery_and_dormant_disablement) > 0
}

_tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring_def := {
    "name": "tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring",
    "description": "Every privileged session is fully recorded (screen/keystroke/command) and every privileged action is logged with full context to centralized, externally-stored, signed/immutable logs (retained >=90d) that the recorded admin cannot alter or delete, with audit administration separated from the audited per AU-9; privileged sessions/accounts are monitored in real time for atypical usage (off-hours, mass account creation, unusual targets) with alerting. PRESENT, this makes privileged misuse non-repudiable and detects account-manipulation persistence rather than discovering it post-incident.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit: privileged session recording, full-context audit logging, and real-time anomaly monitoring constitute auditing of privileged activity."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management: tamper-evident logging and monitoring of privileged sessions/accounts governs and surveils privileged use."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SDA",
            "attributes": {
                "justification": "System Daemon / session activity analysis \u2014 anomaly monitoring of privileged sessions for atypical usage patterns."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Tamper-evident, externally-stored immutable logs that the recorded admin cannot alter or delete defeat Indicator Removal / log deletion and make tampering detectable."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Real-time anomaly monitoring for mass account creation and unusual privileged targets detects Account Manipulation persistence."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Privileged session recording plus off-hours/atypical-usage monitoring detects misuse of Valid Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring[_tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring_def] if {
    input.privileged_access_via_pam_with_session_recording == true
    input.identity_access_audit_logging_enabled == true
    input.audit_log_tamper_evident == true
    input.log_retention_days >= 90
    input.privileged_session_anomaly_monitoring == true
}

countermeasures contains _tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring_def if {
    count(tamper_evident_privileged_session_recording_audit_logging_and_anomaly_monitoring) > 0
}

_hardened_broker_transport_tls_def := {
    "name": "hardened_broker_transport_tls",
    "description": "Connections to the PAM broker and between broker and vault use TLS 1.2+ (TLS 1.3 supported) with ECDHE forward secrecy, AEAD ciphers, and validated certificates, with SSLv3/early-TLS and weak suites disabled. PRESENT, this prevents interception of brokered credentials and live privileged sessions in transit by an adjacent or on-path attacker.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt Sensitive Information \u2014 TLS 1.2+ with AEAD/ECDHE on the broker transport protects brokered credentials and privileged sessions in transit."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "attributes": {
                "justification": "Encrypted Tunnels \u2014 D3FEND identity for enforcing validated TLS on the PAM broker channels."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle \u2014 hardened, validated TLS on the broker transport (D3FEND Harden facet) prevents an adjacent/on-path attacker from intercepting brokered credentials and live privileged sessions."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

hardened_broker_transport_tls[_hardened_broker_transport_tls_def] if {
    input.min_tls_version in ["TLS1.2", "TLS1.3"]
    input.cipher_suites_strong_only == true
    input.server_certificate_validated == true
}

countermeasures contains _hardened_broker_transport_tls_def if {
    count(hardened_broker_transport_tls) > 0
}
