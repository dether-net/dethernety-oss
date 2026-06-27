package _dt_built_in.exposures.end_user



_credential_stuffing_password_spraying_def := {
    "name": "Credential stuffing / password spraying",
    "description": "Attacker replays breached username/password pairs (or sprays common passwords) against the consumer login endpoint with no breached-password screening and no graduated throttling, taking over accounts that reuse passwords. Mitigated by MFA, Pwned-Passwords screening, and a <=100 consecutive-failure cap with graduated delays.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

credential_stuffing_password_spraying[_credential_stuffing_password_spraying_def] if {
    not input.breached_password_screening_enabled
}

credential_stuffing_password_spraying[_credential_stuffing_password_spraying_def] if {
    not input.mfa_available
}

credential_stuffing_password_spraying[_credential_stuffing_password_spraying_def] if {
    not input.rate_limiting_or_lockout_enabled
}

credential_stuffing_password_spraying[_credential_stuffing_password_spraying_def] if {
    input.max_consecutive_failed_attempts > 100
}

exposures contains _credential_stuffing_password_spraying_def if {
    count(credential_stuffing_password_spraying) > 0
}

_phishing_aitm_credential_and_session_theft_def := {
    "name": "Phishing / AiTM credential and session theft",
    "description": "User is lured to a proxy that relays the real login, capturing the password plus a phishable OTP/push approval or the live session cookie. Without phishing-resistant, origin-bound FIDO/WebAuthn MFA the AiTM proxy succeeds; SMS/TOTP/push are downgraded.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1598.003",
            "attributes": {
                "justification": "Spearphishing link is the AiTM lure that delivers the victim to the relay proxy."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "attributes": {
                "justification": "MFA request generation: the proxy relays/triggers the phishable OTP or push approval that non-phishing-resistant MFA cannot withstand."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Steal web session cookie: the AiTM proxy captures the live authenticated session cookie, bypassing MFA where cookie attributes/revocation are weak."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

phishing_aitm_credential_and_session_theft[_phishing_aitm_credential_and_session_theft_def] if {
    not input.phishing_resistant_authenticator_required
}

phishing_aitm_credential_and_session_theft[_phishing_aitm_credential_and_session_theft_def] if {
    input.phishing_resistant_mfa_offered == "sms_otp_push_only"
}

phishing_aitm_credential_and_session_theft[_phishing_aitm_credential_and_session_theft_def] if {
    not input.mfa_available
}

phishing_aitm_credential_and_session_theft[_phishing_aitm_credential_and_session_theft_def] if {
    input.session_cookie_attributes == "missing_attributes"
    input.session_revocation_on_credential_change == "sessions_survive"
}

exposures contains _phishing_aitm_credential_and_session_theft_def if {
    count(phishing_aitm_credential_and_session_theft) > 0
}

_weak_password_policy_without_breach_screening_def := {
    "name": "Weak password policy without breach screening",
    "description": "Password policy below 800-63B \u00a73.1.1 (short minimum, forced composition rules, forced periodic rotation) and no compromised-password blocklist pushes users to weak predictable secrets that fall to guessing and reuse attacks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_password_policy_without_breach_screening[_weak_password_policy_without_breach_screening_def] if {
    input.password_min_length < 12
}

weak_password_policy_without_breach_screening[_weak_password_policy_without_breach_screening_def] if {
    input.password_max_length_cap_below_64 == true
}

weak_password_policy_without_breach_screening[_weak_password_policy_without_breach_screening_def] if {
    input.composition_rules_or_forced_rotation_imposed == true
}

weak_password_policy_without_breach_screening[_weak_password_policy_without_breach_screening_def] if {
    not input.breached_password_screening_enabled
}

exposures contains _weak_password_policy_without_breach_screening_def if {
    count(weak_password_policy_without_breach_screening) > 0
}

_insecure_account_recovery_kba_def := {
    "name": "Insecure account recovery / KBA",
    "description": "The forgot-password path is the weakest link: guessable/reusable/long-lived or in-band reset tokens, KBA / security-question recovery, account enumeration via differential responses, unthrottled reset requests, or auto-login after reset let an attacker seize the account through recovery rather than login.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
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

insecure_account_recovery_kba[_insecure_account_recovery_kba_def] if {
    not input.recovery_token_csprng_single_use_short_expiry
}

insecure_account_recovery_kba[_insecure_account_recovery_kba_def] if {
    not input.recovery_no_account_enumeration
}

insecure_account_recovery_kba[_insecure_account_recovery_kba_def] if {
    not input.reset_request_rate_limited
}

insecure_account_recovery_kba[_insecure_account_recovery_kba_def] if {
    not input.no_auto_login_after_reset
}

insecure_account_recovery_kba[_insecure_account_recovery_kba_def] if {
    input.kba_security_questions_used == true
}

exposures contains _insecure_account_recovery_kba_def if {
    count(insecure_account_recovery_kba) > 0
}

_session_hijacking_fixation_def := {
    "name": "Session hijacking / fixation",
    "description": "Theft or fixation of the consumer session secret \u2014 plaintext (non-TLS) transport, missing Secure/HttpOnly/SameSite cookie flags, no idle/absolute timeout, or a session surviving a password/MFA change \u2014 lets an attacker ride an authenticated session even after the legitimate credential is rotated.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.tls_only_transport
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.cookie_secure_flag
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.cookie_httponly_flag
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.samesite_attribute_set
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.session_id_regenerated_on_auth
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.session_absolute_timeout_enforced
}

session_hijacking_fixation[_session_hijacking_fixation_def] if {
    not input.server_side_revocation_supported
}

exposures contains _session_hijacking_fixation_def if {
    count(session_hijacking_fixation) > 0
}

_undetected_account_takeover_no_anomaly_alerting_def := {
    "name": "Undetected account takeover (no anomaly alerting)",
    "description": "Compromise of a valid consumer account via a stolen credential or session goes undetected and unalerted with no anomalous-login signals (new device, impossible travel, new IP) and no user notification on credential changes, letting the attacker persist and blend into normal traffic. Compounded if the consumer role is over-privileged rather than least-privilege.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

undetected_account_takeover_no_anomaly_alerting[_undetected_account_takeover_no_anomaly_alerting_def] if {
    not input.anomalous_login_detection_enabled
}

undetected_account_takeover_no_anomaly_alerting[_undetected_account_takeover_no_anomaly_alerting_def] if {
    not input.user_alerted_on_credential_change
}

undetected_account_takeover_no_anomaly_alerting[_undetected_account_takeover_no_anomaly_alerting_def] if {
    not input.least_privilege_authorization_at_crossing
}

exposures contains _undetected_account_takeover_no_anomaly_alerting_def if {
    count(undetected_account_takeover_no_anomaly_alerting) > 0
}

_consumer_pii_over_collection_without_consent_def := {
    "name": "Consumer PII over-collection without consent",
    "description": "The account collects more personal data than the service needs, with no lawful consent basis or stated retention limit, enlarging the breach blast radius and violating purpose-limitation / data-minimisation principles.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

consumer_pii_over_collection_without_consent[_consumer_pii_over_collection_without_consent_def] if {
    not input.pii_minimized_to_purpose
}

consumer_pii_over_collection_without_consent[_consumer_pii_over_collection_without_consent_def] if {
    not input.lawful_consent_basis_recorded
}

consumer_pii_over_collection_without_consent[_consumer_pii_over_collection_without_consent_def] if {
    not input.retention_limit_defined
}

consumer_pii_over_collection_without_consent[_consumer_pii_over_collection_without_consent_def] if {
    not input.retention_schedule_enforced
}

exposures contains _consumer_pii_over_collection_without_consent_def if {
    count(consumer_pii_over_collection_without_consent) > 0
}
