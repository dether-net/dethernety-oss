package _dt_built_in.countermeasures.multi_factor_authentication



_mfa_enforced_on_all_high_risk_access_def := {
    "name": "MFA enforced on all high-risk access",
    "description": "A second factor is mandatory across every high-risk login class \u2014 administrative/privileged accounts, remote/VPN access, and internet-exposed enterprise apps \u2014 with no password-only path left open. Presence of this facet blunts credential theft, reuse, and password spraying because a stolen password alone cannot grant access.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {
                "justification": "ATT&CK Mitigation M1032 Multi-factor Authentication \u2014 the catalog identity of this control: require a second verification factor across high-risk access (admin, remote/VPN, internet-exposed apps)."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {
                "justification": "D3FEND D3-MFA Multi-factor Authentication \u2014 the defensive technique this control implements, requiring more than one authentication factor for high-risk logins."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "M1032 MFA\u2192Technique relation: a required second factor stops stolen/leaked passwords from authenticating as a Valid Account on high-risk access paths."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "M1032 MFA\u2192Technique relation: a second factor required after the password defeats Brute Force credential guessing even when the guessed password is correct."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "attributes": {
                "justification": "M1032 MFA\u2192Technique relation: mandatory MFA blunts Password Spraying across admin/VPN/external-app logins \u2014 the correct password alone no longer grants access."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

mfa_enforced_on_all_high_risk_access[_mfa_enforced_on_all_high_risk_access_def] if {
    input.mfa_enforced_for_admin == true
    input.mfa_enforced_for_vpn_login == true
    input.mfa_enforced_for_externally_exposed_apps == true
}

countermeasures contains _mfa_enforced_on_all_high_risk_access_def if {
    count(mfa_enforced_on_all_high_risk_access) > 0
}

_phishing_resistant_authenticator_required_for_high_value_access_def := {
    "name": "Phishing-resistant authenticator required for high-value access",
    "description": "Privileged and high-assurance access mandates an origin-bound, phishing-resistant authenticator (FIDO2/WebAuthn or PIV/PKI smart card) on the strength ladder, rather than accepting phishable factors. Presence defeats phishing and adversary-in-the-middle relay, which proxy passwords, OTP codes, and push approvals against the real domain.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CBAN",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1111",
            "attributes": {
                "justification": "Origin-bound FIDO2/PIV authenticators are not interceptable/relayable, defeating MFA interception (SS7/SIM-swap/OTP relay) that succeeds against SMS-OTP and push."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1598.003",
            "attributes": {
                "justification": "Phishing-resistant authenticators are cryptographically bound to the real domain, so credentials harvested via spearphishing links / AiTM proxies cannot be replayed against the legitimate service."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "attributes": {
                "justification": "Requiring FIDO2/PIV removes the user-approval push step entirely, so prompt-bombing / MFA-fatigue request generation cannot coerce an approval."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

phishing_resistant_authenticator_required_for_high_value_access[_phishing_resistant_authenticator_required_for_high_value_access_def] if {
    input.phishing_resistant_authenticator_required == "fido2_or_piv"
}

countermeasures contains _phishing_resistant_authenticator_required_for_high_value_access_def if {
    count(phishing_resistant_authenticator_required_for_high_value_access) > 0
}

_weak_phishable_factors_disabled_demoted_def := {
    "name": "Weak phishable factors disabled / demoted",
    "description": "SMS-OTP and voice-call factors are removed or blocked as a permitted second factor for admin and high-value accounts, given their exposure to SS7 interception and SIM-swap. Presence closes the false-assurance path where a weak factor satisfies the MFA requirement but is trivially intercepted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1111",
            "attributes": {
                "justification": "Disabling/demoting SMS-OTP and voice-call factors for high-value accounts removes the interceptable channels (SS7, SIM-swap, OTP relay) that T1111 (Multi-Factor Authentication Interception) abuses, forcing reliance on phishing-resistant authenticators."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_phishable_factors_disabled_demoted[_weak_phishable_factors_disabled_demoted_def] if {
    input.weak_sms_voice_mfa_disabled == true
}

countermeasures contains _weak_phishable_factors_disabled_demoted_def if {
    count(weak_phishable_factors_disabled_demoted) > 0
}

_no_mfa_bypass_fail_closed_legacy_auth_blocked_exclusions_minimized_def := {
    "name": "No MFA bypass \u2014 fail-closed, legacy auth blocked, exclusions minimized",
    "description": "The MFA system fails closed on service error (no password-only fallback), legacy/basic-auth protocols that skip modern MFA are blocked tenant-wide, and conditional-access exclusions are restricted to a single documented break-glass account. Presence denies the post-foothold bypass paths an adversary uses to defeat MFA by modification rather than satisfying it.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {
                "justification": "MFA mitigation grounding the fail-closed configuration and conditional-access restriction of this control (M1032: configure MFA to fail closed; require MFA across critical systems)."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit mitigation grounding verification that MFA is enforced and not bypassed via legacy auth or broad CA exclusions (M1047: review MFA actions, verify MFA enabled)."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {
                "justification": "D3FEND Multi-factor Authentication \u2014 the defensive identity of this control facet."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "attributes": {
                "justification": "ATT&CK Mitigation\u2192Technique relation: M1032/M1047 mitigate Modify Authentication Process: MFA. Fail-closed config defeats fail-open exploitation, blocked legacy auth closes the MFA-skip path, and minimized audited CA exclusions deny the conditional-access carve-out bypass."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "attributes": {
                "justification": "D3FEND Harden facet: hardening the authentication process (fail-closed, no legacy-auth skip, minimal exclusions) prevents adversary modification/bypass of MFA post-foothold."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

no_mfa_bypass_fail_closed_legacy_auth_blocked_exclusions_minimized[_no_mfa_bypass_fail_closed_legacy_auth_blocked_exclusions_minimized_def] if {
    input.mfa_fail_closed == true
    input.legacy_auth_protocols_disabled == true
    input.conditional_access_exclusions_minimized == true
}

countermeasures contains _no_mfa_bypass_fail_closed_legacy_auth_blocked_exclusions_minimized_def if {
    count(no_mfa_bypass_fail_closed_legacy_auth_blocked_exclusions_minimized) > 0
}

_anti_mfa_fatigue_number_matching_and_push_rate_limiting_def := {
    "name": "Anti-MFA-fatigue \u2014 number-matching and push rate-limiting",
    "description": "Push-based MFA enforces number-matching (challenge-code entry) so a user cannot blindly approve a fraudulent prompt, and push generation is throttled per account with anomalous-prompt alerting. Presence defeats prompt-bombing / MFA-fatigue attacks where an attacker holding the password floods the user until they accept.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "attributes": {
                "justification": "Number-matching forces explicit challenge-code entry so a user cannot blindly approve a fraudulent push, and per-account push rate-limiting with anomalous-prompt alerting throttles the prompt floods used in MFA-fatigue / prompt-bombing (e.g. LAPSUS$) \u2014 directly countering Multi-Factor Authentication Request Generation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

anti_mfa_fatigue_number_matching_and_push_rate_limiting[_anti_mfa_fatigue_number_matching_and_push_rate_limiting_def] if {
    input.push_number_matching_enabled == true
    input.push_request_rate_limiting_enabled == true
}

countermeasures contains _anti_mfa_fatigue_number_matching_and_push_rate_limiting_def if {
    count(anti_mfa_fatigue_number_matching_and_push_rate_limiting) > 0
}

_step_up_re_auth_and_bounded_mfa_session_lifetime_def := {
    "name": "Step-up re-auth and bounded MFA session lifetime",
    "description": "Sensitive operations (privilege elevation, secret access, config change) trigger a fresh MFA challenge, and authenticated sessions carry an AAL-appropriate bounded lifetime with a reauthentication interval. Presence limits the value of a stolen session token that would otherwise replay an already-MFA'd session without re-challenge.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 bounded session lifetime and step-up reauthentication for sensitive operations are part of managing the assurance/lifetime of authenticated user sessions."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SDA",
            "attributes": {
                "justification": "Session Duration Analysis \u2014 the defensive identity of bounding session lifetime and reauthentication intervals to constrain the validity window of an authenticated session."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Steal Web Session Cookie \u2014 bounded session lifetime and step-up reauth for sensitive actions limit how long a stolen session cookie/token (e.g. CVE-2023-4966 Citrix Bleed) can replay an already-MFA'd session, reducing the value of the theft."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "Use Alternate Authentication Material: Web Session Cookie \u2014 a bounded session and step-up re-auth force revalidation, so a hijacked session cookie cannot indefinitely authenticate as the victim without a fresh MFA challenge on sensitive operations."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

step_up_re_auth_and_bounded_mfa_session_lifetime[_step_up_re_auth_and_bounded_mfa_session_lifetime_def] if {
    input.step_up_reauth_for_sensitive_actions == true
}

step_up_re_auth_and_bounded_mfa_session_lifetime[_step_up_re_auth_and_bounded_mfa_session_lifetime_def] if {
    input.mfa_session_lifetime_bounded == true
}

step_up_re_auth_and_bounded_mfa_session_lifetime[_step_up_re_auth_and_bounded_mfa_session_lifetime_def] if {
    input.session_idle_timeout_minutes <= 30
}

countermeasures contains _step_up_re_auth_and_bounded_mfa_session_lifetime_def if {
    count(step_up_re_auth_and_bounded_mfa_session_lifetime) > 0
}

_secure_enrollment_recovery_and_mfa_event_auditing_def := {
    "name": "Secure enrollment, recovery, and MFA event auditing",
    "description": "Authenticator enrollment is identity-proofed and account recovery re-establishes equivalent assurance (no weak knowledge-based self-service reset or unverified factor self-registration), while MFA sign-ins, factor registrations, denied/ignored prompts, and policy changes are logged and alerted. Presence prevents attacker self-registration of a rogue factor and gives the visibility needed to detect fatigue attacks and bypass tampering.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "Secure authenticator enrollment and deactivation (User Account Management) prevents rogue-factor self-registration and weak-recovery MFA bypass."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit of MFA actions \u2014 factor registrations, denied/ignored prompts, and MFA-policy changes \u2014 provides detection of fatigue and bypass tampering."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DAM",
            "attributes": {
                "justification": "Domain Account Monitoring detects anomalous account/authenticator changes such as rogue-factor registration and MFA-policy modification."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "attributes": {
                "justification": "Secure enrollment/recovery blocks attacker-controlled factor registration, and MFA-event auditing surfaces MFA-modification/bypass attempts (Modify Authentication Process: MFA)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Identity-proofed enrollment and logged factor registrations counter Account Manipulation that persists access by adding attacker-controlled authenticators."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

secure_enrollment_recovery_and_mfa_event_auditing[_secure_enrollment_recovery_and_mfa_event_auditing_def] if {
    input.secure_mfa_enrollment_and_recovery == true
    input.mfa_authentication_events_audited == true
}

countermeasures contains _secure_enrollment_recovery_and_mfa_event_auditing_def if {
    count(secure_enrollment_recovery_and_mfa_event_auditing) > 0
}
