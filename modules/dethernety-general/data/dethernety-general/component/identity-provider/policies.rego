package _dt_built_in.exposures.identity_provider



_signing_key_compromise_golden_token_golden_saml_def := {
    "name": "Signing-key compromise / golden token / golden SAML",
    "description": "A static, unrotated token/assertion signing key stored on disk (not HSM/KMS-backed) lets an attacker who steals it \u2014 or stands up a rogue federation trust \u2014 forge tokens or SAML assertions for any user with any privilege, bypassing MFA across every federated RP (the SolarWinds/UNC2452 golden-SAML pattern).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

signing_key_compromise_golden_token_golden_saml[_signing_key_compromise_golden_token_golden_saml_def] if {
    not input.keys_managed_in_hsm_or_kms
}

signing_key_compromise_golden_token_golden_saml[_signing_key_compromise_golden_token_golden_saml_def] if {
    not input.key_rotation_enabled
}

signing_key_compromise_golden_token_golden_saml[_signing_key_compromise_golden_token_golden_saml_def] if {
    not input.signing_key_high_entropy
}

signing_key_compromise_golden_token_golden_saml[_signing_key_compromise_golden_token_golden_saml_def] if {
    not input.signature_algorithm_pinned_server_side
}

signing_key_compromise_golden_token_golden_saml[_signing_key_compromise_golden_token_golden_saml_def] if {
    not input.federation_trust_validated
}

exposures contains _signing_key_compromise_golden_token_golden_saml_def if {
    count(signing_key_compromise_golden_token_golden_saml) > 0
}

_lax_redirect_uri_open_redirect_code_theft_def := {
    "name": "Lax redirect_uri / open-redirect code theft",
    "description": "Wildcard, localhost, or path-traversable Valid Redirect URIs let an attacker exfiltrate the authorization code or token to an attacker-controlled URL, yielding account takeover \u2014 repeatedly seen as real Keycloak CVEs. RFC 9700 mandates exact-string redirect_uri matching.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

lax_redirect_uri_open_redirect_code_theft[_lax_redirect_uri_open_redirect_code_theft_def] if {
    not input.redirect_uri_exact_match_enforced
}

exposures contains _lax_redirect_uri_open_redirect_code_theft_def if {
    count(lax_redirect_uri_open_redirect_code_theft) > 0
}

_jwt_algorithm_confusion_alg_none_rs256_hs256_def := {
    "name": "JWT algorithm confusion / alg:none / RS256->HS256",
    "description": "Issuing or accepting symmetric (HS256) or 'none' token signatures lets an attacker forge tokens by switching the alg header or signing with the public key as an HS256 secret. RFC 8725 requires asymmetric signing (RS256/ES256) with the verifier pinning the algorithm.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

jwt_algorithm_confusion_alg_none_rs256_hs256[_jwt_algorithm_confusion_alg_none_rs256_hs256_def] if {
    input.accepts_alg_none == true
}

jwt_algorithm_confusion_alg_none_rs256_hs256[_jwt_algorithm_confusion_alg_none_rs256_hs256_def] if {
    input.rs256_to_hs256_confusion_possible == true
}

jwt_algorithm_confusion_alg_none_rs256_hs256[_jwt_algorithm_confusion_alg_none_rs256_hs256_def] if {
    input.access_token_signature_algorithm in ["HS256", "HS384", "HS512", "none"]
}

jwt_algorithm_confusion_alg_none_rs256_hs256[_jwt_algorithm_confusion_alg_none_rs256_hs256_def] if {
    not input.signature_algorithm_pinned_server_side
}

exposures contains _jwt_algorithm_confusion_alg_none_rs256_hs256_def if {
    count(jwt_algorithm_confusion_alg_none_rs256_hs256) > 0
}

_insecure_oauth_flow_authorization_code_interception_without_pkce_def := {
    "name": "Insecure OAuth flow / authorization-code interception without PKCE",
    "description": "Public clients without PKCE (S256), or with the deprecated Implicit or ROPC grants enabled, let an intercepted authorization code be redeemed by an attacker; missing state/nonce additionally enables CSRF and replay. RFC 9700 mandates PKCE for all client types and deprecates Implicit/ROPC.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    not input.pkce_required
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    not input.pkce_method_s256_required
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    input.code_challenge_method_plain_accepted == true
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    input.implicit_or_ropc_grant_enabled == true
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    not input.oauth_state_bound_and_verified
}

insecure_oauth_flow_authorization_code_interception_without_pkce[_insecure_oauth_flow_authorization_code_interception_without_pkce_def] if {
    not input.oidc_nonce_validated
}

exposures contains _insecure_oauth_flow_authorization_code_interception_without_pkce_def if {
    count(insecure_oauth_flow_authorization_code_interception_without_pkce) > 0
}

_saml_assertion_forgery_signature_wrapping_replay_def := {
    "name": "SAML assertion forgery / signature-wrapping / replay",
    "description": "Unsigned or improperly-verified assertions, missing AudienceRestriction, or absent InResponseTo/replay-cache binding let an attacker inject or replay SAML assertions to impersonate users across SPs. NIST SP 800-63C requires signed assertions and that every RP check the audience.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

saml_assertion_forgery_signature_wrapping_replay[_saml_assertion_forgery_signature_wrapping_replay_def] if {
    not input.saml_assertion_signature_verified
}

saml_assertion_forgery_signature_wrapping_replay[_saml_assertion_forgery_signature_wrapping_replay_def] if {
    not input.saml_audience_restriction_strict
}

saml_assertion_forgery_signature_wrapping_replay[_saml_assertion_forgery_signature_wrapping_replay_def] if {
    not input.saml_recipient_inresponseto_matched
}

saml_assertion_forgery_signature_wrapping_replay[_saml_assertion_forgery_signature_wrapping_replay_def] if {
    not input.saml_assertion_replay_cache_active
}

exposures contains _saml_assertion_forgery_signature_wrapping_replay_def if {
    count(saml_assertion_forgery_signature_wrapping_replay) > 0
}

_missing_audience_restriction_cross_rp_token_replay_def := {
    "name": "Missing audience restriction / cross-RP token replay",
    "description": "Assertions or tokens minted without a per-RP audience (aud) bound and signed over iss/aud/sub/exp can be replayed at a different relying party, escalating one RP's token into federated access. NIST SP 800-63C: all RPs SHALL check the audience.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

missing_audience_restriction_cross_rp_token_replay[_missing_audience_restriction_cross_rp_token_replay_def] if {
    not input.audience_claim_validated
}

missing_audience_restriction_cross_rp_token_replay[_missing_audience_restriction_cross_rp_token_replay_def] if {
    not input.issuer_claim_validated
}

missing_audience_restriction_cross_rp_token_replay[_missing_audience_restriction_cross_rp_token_replay_def] if {
    not input.expiry_claim_validated
}

exposures contains _missing_audience_restriction_cross_rp_token_replay_def if {
    count(missing_audience_restriction_cross_rp_token_replay) > 0
}

_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def := {
    "name": "Weak / phishable MFA and credential brute force on the IdP",
    "description": "Password-only or phishable (SMS/push) MFA \u2014 especially on realm/admin accounts \u2014 plus no brute-force lockout leaves the IdP login front door open to credential stuffing and AiTM proxy phishing that mints a federated session. Only phishing-resistant FIDO/WebAuthn defeats AiTM (NIST SP 800-63B AAL2/AAL3).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1598.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_phishable_mfa_and_credential_brute_force_on_the_idp[_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def] if {
    not input.mfa_available
}

weak_phishable_mfa_and_credential_brute_force_on_the_idp[_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def] if {
    not input.phishing_resistant_authenticator_required
}

weak_phishable_mfa_and_credential_brute_force_on_the_idp[_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def] if {
    not input.admin_mfa_enforced
}

weak_phishable_mfa_and_credential_brute_force_on_the_idp[_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def] if {
    not input.rate_limiting_or_lockout_enabled
}

weak_phishable_mfa_and_credential_brute_force_on_the_idp[_weak_phishable_mfa_and_credential_brute_force_on_the_idp_def] if {
    not input.breached_password_screening_enabled
}

exposures contains _weak_phishable_mfa_and_credential_brute_force_on_the_idp_def if {
    count(weak_phishable_mfa_and_credential_brute_force_on_the_idp) > 0
}

_refresh_token_theft_without_rotation_def := {
    "name": "Refresh-token theft without rotation",
    "description": "A stolen long-lived refresh token grants indefinite access when rotation with reuse-detection (and sender-constraining via DPoP/mTLS) is absent; without rotation a reused token is never flagged as compromise. RFC 9700 prescribes refresh-token rotation with reuse detection.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {
                "justification": "A stolen refresh token reused without rotation/reuse-detection or sender-constraining is the Application Access Token sub-technique \u2014 the adversary authenticates with a captured token instead of credentials, indefinitely."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "attributes": {
                "justification": "Steal Application Access Token \u2014 the precondition of this exposure; the long-lived non-rotating refresh token is the high-value token an adversary steals to gain persistent access."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

refresh_token_theft_without_rotation[_refresh_token_theft_without_rotation_def] if {
    not input.refresh_token_rotation_enabled
}

refresh_token_theft_without_rotation[_refresh_token_theft_without_rotation_def] if {
    not input.server_side_revocation_supported
}

refresh_token_theft_without_rotation[_refresh_token_theft_without_rotation_def] if {
    not input.sender_constrained
    not input.refresh_token_rotation_enabled
}

exposures contains _refresh_token_theft_without_rotation_def if {
    count(refresh_token_theft_without_rotation) > 0
}

_over_broad_client_scopes_over_privileged_clients_def := {
    "name": "Over-broad client scopes / over-privileged clients",
    "description": "Full-Scope-Allowed or excessively-scoped clients receive tokens carrying every realm role regardless of need; compromise of one such client then yields broad federated access. Least privilege requires explicitly mapped per-client scopes.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
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
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_client_scopes_over_privileged_clients[_over_broad_client_scopes_over_privileged_clients_def] if {
    input.full_scope_allowed_clients == true
}

over_broad_client_scopes_over_privileged_clients[_over_broad_client_scopes_over_privileged_clients_def] if {
    not input.scopes_least_privilege
}

exposures contains _over_broad_client_scopes_over_privileged_clients_def if {
    count(over_broad_client_scopes_over_privileged_clients) > 0
}

_unencrypted_idp_transport_def := {
    "name": "Unencrypted IdP transport",
    "description": "With SSL not required (Keycloak's default), login credentials, authorization codes, and tokens transit the login/token/admin endpoints in cleartext and are sniffable or MITM-able on the network path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_idp_transport[_unencrypted_idp_transport_def] if {
    input.ssl_required == "none"
}

unencrypted_idp_transport[_unencrypted_idp_transport_def] if {
    not input.tls_only_transport
}

unencrypted_idp_transport[_unencrypted_idp_transport_def] if {
    input.weak_tls_versions_enabled == true
}

unencrypted_idp_transport[_unencrypted_idp_transport_def] if {
    not input.hsts_enforced
}

exposures contains _unencrypted_idp_transport_def if {
    count(unencrypted_idp_transport) > 0
}

_idp_software_exploitation_unpatched_cve_def := {
    "name": "IdP software exploitation (unpatched CVE)",
    "description": "An internet-facing IdP running an unpatched release is exploited directly for redirect-validation bypass, auth bypass, info disclosure, or RCE \u2014 a prime T1190 target. Real Keycloak advisories (e.g. CVE-2024-8883) require staying at/above the fixed release.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1212",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

idp_software_exploitation_unpatched_cve[_idp_software_exploitation_unpatched_cve_def] if {
    not input.software_version_patched
}

idp_software_exploitation_unpatched_cve[_idp_software_exploitation_unpatched_cve_def] if {
    not input.edge_appliance_patched_within_sla
}

idp_software_exploitation_unpatched_cve[_idp_software_exploitation_unpatched_cve_def] if {
    input.unpatched_known_rce_cve == true
}

exposures contains _idp_software_exploitation_unpatched_cve_def if {
    count(idp_software_exploitation_unpatched_cve) > 0
}

_idp_availability_dos_single_point_of_failure_def := {
    "name": "IdP availability / DoS (single point of failure)",
    "description": "Because the IdP gates all authentication, a DoS or single-node failure denies access to every federated application. Clustered HA, health checks, and upstream rate limiting on the public auth/token endpoints bound the blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

idp_availability_dos_single_point_of_failure[_idp_availability_dos_single_point_of_failure_def] if {
    not input.clustered_ha_deployed
}

idp_availability_dos_single_point_of_failure[_idp_availability_dos_single_point_of_failure_def] if {
    not input.ddos_protection_in_place
}

idp_availability_dos_single_point_of_failure[_idp_availability_dos_single_point_of_failure_def] if {
    not input.rate_limiting_or_lockout_enabled
}

exposures contains _idp_availability_dos_single_point_of_failure_def if {
    count(idp_availability_dos_single_point_of_failure) > 0
}
