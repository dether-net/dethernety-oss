package _dt_built_in.countermeasures.identity_access_management



_centralized_identity_governance_def := {
    "name": "Centralized identity governance",
    "description": "All in-scope identities are governed through a central directory / SSO / identity service (no unmanaged per-system local accounts), so account creation, policy, and revocation are enforced from one authoritative source. Provisioning follows a documented, approved joiner/role-change workflow rather than ad-hoc grants. Asserts centralized_aaa_enabled and provisioning_requires_approval.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.003",
            "attributes": {
                "justification": "Centralizing identity governance and routing all account creation through an approval-gated central directory eliminates unmanaged per-system local accounts, removing the standalone local credentials adversaries abuse for access and persistence under Valid Accounts: Local Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

centralized_identity_governance[_centralized_identity_governance_def] if {
    input.centralized_aaa_enabled == true
    input.provisioning_requires_approval == true
}

countermeasures contains _centralized_identity_governance_def if {
    count(centralized_identity_governance) > 0
}

_joiner_mover_leaver_lifecycle_enforcement_def := {
    "name": "Joiner-mover-leaver lifecycle enforcement",
    "description": "Access is revoked and accounts disabled promptly on termination or role exit, and dormant / orphaned accounts are auto-disabled within a defined window (e.g. <=45 days). This shrinks the pool of stale-but-valid credentials available for valid-account abuse. Asserts offboarding_credential_revocation_enforced and dormant_admin_accounts_disabled.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
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
            "value": "D3-ANCI",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Prompt offboarding revocation and dormant-account disablement within a <=45-day window shrink the pool of stale, orphaned, and otherwise-valid accounts an adversary can use to authenticate (Valid Accounts)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

joiner_mover_leaver_lifecycle_enforcement[_joiner_mover_leaver_lifecycle_enforcement_def] if {
    input.offboarding_credential_revocation_enforced == true
    input.dormant_admin_accounts_disabled == true
    input.dormant_account_disable_window_days <= 45
}

countermeasures contains _joiner_mover_leaver_lifecycle_enforcement_def if {
    count(joiner_mover_leaver_lifecycle_enforcement) > 0
}

_least_privilege_entitlement_with_periodic_recertification_def := {
    "name": "Least-privilege entitlement with periodic recertification",
    "description": "Entitlements are assigned per least privilege via documented roles and reviewed on a periodic recertification cadence, with unjustified privileges reassigned or removed, catching privilege creep and limiting blast radius of any single compromised identity. Asserts least_privilege_access_enforced and periodic_privilege_recertification.",
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
                "justification": "User Account Management \u2014 least-privilege entitlement assignment plus periodic recertification is the catalog mitigation for governing what accounts may access and removing unjustified privileges."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "User Account Permissions \u2014 scoping entitlements to role/duties and recertifying them is the D3FEND Harden technique that constrains account permissions to the minimum necessary."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 least-privilege scoping limits what privileges an identity can hold, and periodic recertification reviews and removes added/unjustified entitlements, countering privilege accumulation used to maintain or escalate access."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 recertification shrinks the pool of over-privileged standing access an abused valid account can leverage, and least privilege bounds the impact of any single compromised identity."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

least_privilege_entitlement_with_periodic_recertification[_least_privilege_entitlement_with_periodic_recertification_def] if {
    input.least_privilege_access_enforced == true
    input.periodic_privilege_recertification == true
}

countermeasures contains _least_privilege_entitlement_with_periodic_recertification_def if {
    count(least_privilege_entitlement_with_periodic_recertification) > 0
}

_segregation_of_duties_enforced_def := {
    "name": "Segregation of duties enforced",
    "description": "Toxic entitlement combinations (e.g. one identity both requesting and approving, or creating and paying) are blocked at grant or flagged in recertification, so no single identity can complete a sensitive end-to-end action unchecked, and routine admin work uses dedicated individually-attributable admin accounts. Asserts segregation_of_duties_enforced.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "attributes": {
                "justification": "User Account Management \u2014 governing entitlement assignment and SoD/role conflicts plus dedicated individually-attributable admin accounts is the catalog identity of this control."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {
                "justification": "D3FEND User Account Permissions \u2014 constraining the permissions any single account may hold (blocking toxic combinations, separating privileged from primary accounts) is the defensive identity of segregation-of-duties enforcement."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 SoD rules and dedicated attributable admin accounts limit and surface entitlement changes, so a single identity cannot grant itself toxic privilege combinations or escalate unchecked (ATT&CK Mitigation M1018 -> T1098 relation)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

segregation_of_duties_enforced[_segregation_of_duties_enforced_def] if {
    input.segregation_of_duties_enforced == true
}

segregation_of_duties_enforced[_segregation_of_duties_enforced_def] if {
    input.no_shared_privileged_credentials == true
}

countermeasures contains _segregation_of_duties_enforced_def if {
    count(segregation_of_duties_enforced) > 0
}

_strong_central_authentication_policy_def := {
    "name": "Strong central authentication policy",
    "description": "MFA (ideally phishing-resistant) is enforced centrally for administrative, remote, and externally-exposed access, and credential policy follows modern guidance (length, breach screening, salted memory-hard hashing, rate-limiting) \u2014 defeating credential theft, brute force, and password spraying. Asserts centralized_aaa_enabled MFA and 800-63B credential policy.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "attributes": {
                "justification": "Multi-factor Authentication: this control's primary defensive identity \u2014 MFA enforced centrally for admin/remote/external access."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1027",
            "attributes": {
                "justification": "Password Policies: the 800-63B-aligned credential policy facet (breach screening, length, memory-hard hashing, rate-limiting)."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "attributes": {
                "justification": "D3FEND Multi-factor Authentication \u2014 the defensive technique this control implements."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Brute Force: rate-limiting/lockout and MFA defeat online password guessing."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "attributes": {
                "justification": "Password Spraying: breach-password screening, MFA, and failed-attempt throttling defeat low-and-slow spraying against many accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts: MFA on admin/remote/external access prevents a stolen password alone from yielding a usable valid-account login."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

strong_central_authentication_policy[_strong_central_authentication_policy_def] if {
    input.mfa_enforced_for_admin == true
}

strong_central_authentication_policy[_strong_central_authentication_policy_def] if {
    input.breached_password_screening_enabled == true
}

strong_central_authentication_policy[_strong_central_authentication_policy_def] if {
    input.rate_limiting_or_lockout_enabled == true
}

countermeasures contains _strong_central_authentication_policy_def if {
    count(strong_central_authentication_policy) > 0
}

_federation_assertion_security_validated_def := {
    "name": "Federation assertion security validated",
    "description": "Federated / SSO assertions are signed over the full assertion, audience-restricted, time-limited, and validated (signature + audience) by every relying party with per-RP keys, preventing assertion forgery, replay, and cross-RP injection. Asserts federation_trust_validated.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CBAN",
            "attributes": {
                "justification": "Federation assertion validation is fundamentally certificate/key-based authentication of the assertion issuer: per-RP signing keys plus full-assertion signature verification establish the asserting party's identity, which is the D3FEND Certificate-based Authentication countermeasure pattern applied at the federation trust boundary."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {
                "justification": "Full-assertion signature verification with per-RP keys and bounded lifetime prevents adversaries from forging SAML tokens (T1606.002): a forged assertion fails signature validation and is rejected by every RP."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "attributes": {
                "justification": "Signed, audience-restricted, time-limited assertions validated by every RP defeat the broader Forge Web Credentials technique (T1606) \u2014 forged/replayed/cross-RP-injected federation credentials fail signature, audience, or expiry checks."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

federation_assertion_security_validated[_federation_assertion_security_validated_def] if {
    input.federation_trust_validated == true
    input.saml_assertion_signature_verified == true
    input.audience_claim_validated == true
}

countermeasures contains _federation_assertion_security_validated_def if {
    count(federation_assertion_security_validated) > 0
}

_identity_and_access_audit_logging_def := {
    "name": "Identity and access audit logging",
    "description": "Account-lifecycle and authentication/authorization events (creations, privilege changes, logins, MFA, federation) are logged centrally with credential material scrubbed, so account manipulation and abuse are detectable and attributable. Service (non-human) identities are inventoried and governed alongside human accounts. Asserts identity_access_audit_logging_enabled and service_account_inventory_governed.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "ATT&CK mitigation Audit \u2014 collecting and reviewing account-management and authentication event logs is the catalog identity of this audit-logging control."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DAM",
            "attributes": {
                "justification": "D3FEND Domain Account Monitoring \u2014 monitoring directory/account-management events is the defensive-technique identity of centralized identity/access audit logging."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation: centrally logging privilege-change and account-modify events surfaces unauthorized entitlement changes (D3FEND Detect facet via Domain Account Monitoring)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1136",
            "attributes": {
                "justification": "Create Account: centrally logging account-creation events surfaces rogue accounts created for persistence (D3FEND Detect facet via Domain Account Monitoring)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

identity_and_access_audit_logging[_identity_and_access_audit_logging_def] if {
    input.identity_access_audit_logging_enabled == true
}

identity_and_access_audit_logging[_identity_and_access_audit_logging_def] if {
    input.service_account_inventory_governed == true
}

countermeasures contains _identity_and_access_audit_logging_def if {
    count(identity_and_access_audit_logging) > 0
}
