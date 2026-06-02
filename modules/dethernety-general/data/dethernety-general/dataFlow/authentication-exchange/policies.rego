package _dt_built_in.exposures.authentication_exchange



_authorization_code_interception_and_replay_def := {
    "name": "Authorization code interception and replay",
    "description": "An authorization code leaks via referrer, mixed-up clients, or a malicious app on the device, and is then exchanged at /token for full credentials because the flow lacks PKCE binding or the code is accepted more than once. The attacker obtains access and ID tokens for the victim's session.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

authorization_code_interception_and_replay[_authorization_code_interception_and_replay_def] if {
    not input.pkce_required
}

authorization_code_interception_and_replay[_authorization_code_interception_and_replay_def] if {
    not input.code_single_use_enforced
}

authorization_code_interception_and_replay[_authorization_code_interception_and_replay_def] if {
    input.authorization_code_ttl_seconds > 120
}

exposures contains _authorization_code_interception_and_replay_def if {
    count(authorization_code_interception_and_replay) > 0
}

_pkce_downgrade_attack_def := {
    "name": "PKCE downgrade attack",
    "description": "An active MITM forces the client (or IdP) to fall back to code_challenge_method=plain or to omit PKCE entirely, turning the eavesdropped challenge into a usable verifier. Defeats the only binding that ties the code to the legitimate client instance.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle on the authorization redirect chain forces a PKCE-method downgrade so the intercepted code_challenge becomes a usable code_verifier at /token."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "The downgrade itself is a defense impairment \u2014 the client/IdP is coerced off the S256-only enforcement that would have bound the code to a verifier the attacker cannot derive."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

pkce_downgrade_attack[_pkce_downgrade_attack_def] if {
    not input.pkce_method_s256_required
}

pkce_downgrade_attack[_pkce_downgrade_attack_def] if {
    input.code_challenge_method_plain_accepted == true
}

exposures contains _pkce_downgrade_attack_def if {
    count(pkce_downgrade_attack) > 0
}

_id_token_replay_via_missing_or_unchecked_nonce_def := {
    "name": "ID Token replay via missing or unchecked nonce",
    "description": "The RP generates a nonce but never compares it against the id_token's nonce claim (or omits it entirely), so a captured ID Token can be replayed into a different user-agent session and the RP cannot detect the substitution. A canonical OIDC implementation bug.",
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
            "value": "T1550",
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

id_token_replay_via_missing_or_unchecked_nonce[_id_token_replay_via_missing_or_unchecked_nonce_def] if {
    not input.oidc_nonce_validated
}

exposures contains _id_token_replay_via_missing_or_unchecked_nonce_def if {
    count(id_token_replay_via_missing_or_unchecked_nonce) > 0
}

_login_csrf_via_missing_or_unbound_state_parameter_def := {
    "name": "Login CSRF via missing or unbound state parameter",
    "description": "Without a high-entropy state value bound to the user-agent session and verified on /callback, an attacker can splice their own /authorize response into the victim's browser, fixing the victim into the attacker's identity (or harvesting the victim's code). The classic CSRF-on-the-authentication-response failure RFC 6749 \u00a710.12 calls out.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

login_csrf_via_missing_or_unbound_state_parameter[_login_csrf_via_missing_or_unbound_state_parameter_def] if {
    not input.oauth_state_bound_and_verified
}

exposures contains _login_csrf_via_missing_or_unbound_state_parameter_def if {
    count(login_csrf_via_missing_or_unbound_state_parameter) > 0
}

_redirect_uri_pattern_match_open_redirect_exploit_def := {
    "name": "redirect_uri pattern-match / open-redirect exploit",
    "description": "Wildcard, regex, prefix, or normalised redirect_uri matching at the IdP \u2014 or an open redirect on the RP's post-login returnTo \u2014 lets the attacker steer the authorization response to an attacker origin and capture the code or fragment-mode token. Repeatedly the root cause of real-world OAuth incidents.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566.002",
            "attributes": {
                "justification": "Spearphishing Link \u2014 broken redirect_uri matching and open returnTo redirects let an attacker craft an IdP-origin link that steers the authorization response (or the post-login navigation) to an attacker-controlled URL, the classic phishing-by-trusted-redirect pattern called out in RFC 9700 \u00a72.1.3 / \u00a74.10."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

redirect_uri_pattern_match_open_redirect_exploit[_redirect_uri_pattern_match_open_redirect_exploit_def] if {
    not input.redirect_uri_exact_match_enforced
}

redirect_uri_pattern_match_open_redirect_exploit[_redirect_uri_pattern_match_open_redirect_exploit_def] if {
    not input.post_login_returnto_allowlisted
}

exposures contains _redirect_uri_pattern_match_open_redirect_exploit_def if {
    count(redirect_uri_pattern_match_open_redirect_exploit) > 0
}

_saml_signature_wrapping_replay_and_audience_confusion_def := {
    "name": "SAML signature wrapping, replay, and audience confusion",
    "description": "Tampered SAMLResponse wraps the original signed Assertion inside attacker XML, replays a still-valid AssertionID, or presents an assertion intended for another SP whose AudienceRestriction is not strictly checked. Any one missing check (signature, AudienceRestriction == SP EntityID, Recipient/InResponseTo, seen-AssertionID cache) yields full SP impersonation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
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
            "value": "T1556",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

saml_signature_wrapping_replay_and_audience_confusion[_saml_signature_wrapping_replay_and_audience_confusion_def] if {
    not input.saml_assertion_signature_verified
}

saml_signature_wrapping_replay_and_audience_confusion[_saml_signature_wrapping_replay_and_audience_confusion_def] if {
    not input.saml_audience_restriction_strict
}

saml_signature_wrapping_replay_and_audience_confusion[_saml_signature_wrapping_replay_and_audience_confusion_def] if {
    not input.saml_recipient_inresponseto_matched
}

saml_signature_wrapping_replay_and_audience_confusion[_saml_signature_wrapping_replay_and_audience_confusion_def] if {
    not input.saml_assertion_replay_cache_active
}

exposures contains _saml_signature_wrapping_replay_and_audience_confusion_def if {
    count(saml_signature_wrapping_replay_and_audience_confusion) > 0
}

_phishing_driven_mfa_bypass_via_aitm_reverse_proxy_def := {
    "name": "Phishing-driven MFA bypass via AiTM reverse proxy",
    "description": "An Evilginx-class reverse-proxy phishing kit relays the full handshake in real time, captures session cookies and bearer tokens after the second factor completes, and replays them from attacker infrastructure. Defeated only by phishing-resistant authenticators (WebAuthn) and sender-constrained tokens (mTLS / DPoP).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
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

phishing_driven_mfa_bypass_via_aitm_reverse_proxy[_phishing_driven_mfa_bypass_via_aitm_reverse_proxy_def] if {
    not input.phishing_resistant_authenticator_required
}

phishing_driven_mfa_bypass_via_aitm_reverse_proxy[_phishing_driven_mfa_bypass_via_aitm_reverse_proxy_def] if {
    not input.sender_constrained
}

exposures contains _phishing_driven_mfa_bypass_via_aitm_reverse_proxy_def if {
    count(phishing_driven_mfa_bypass_via_aitm_reverse_proxy) > 0
}

_credential_stuffing_and_online_brute_force_def := {
    "name": "Credential stuffing and online brute force",
    "description": "An authentication endpoint without per-account and per-IP throttling, progressive delay, or CAPTCHA escalation allows mass replay of breached credential pairs or password guessing against privileged accounts. Per-IP-only limits are defeated by distributed botnets.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
            "value": "T1110.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

credential_stuffing_and_online_brute_force[_credential_stuffing_and_online_brute_force_def] if {
    not input.rate_limiting_or_lockout_enabled
}

credential_stuffing_and_online_brute_force[_credential_stuffing_and_online_brute_force_def] if {
    not input.breached_password_screening_enabled
}

exposures contains _credential_stuffing_and_online_brute_force_def if {
    count(credential_stuffing_and_online_brute_force) > 0
}

_secrets_in_url_leaking_via_referer_logs_and_browser_history_def := {
    "name": "Secrets in URL leaking via Referer, logs, and browser history",
    "description": "Passwords, authorization codes, ID tokens, access tokens, or SAMLResponse carried in URL query strings end up in proxy/access logs, Referer headers to third-party origins, and shared browser history \u2014 exposing post-hoc what TLS protected in flight. Belongs in POST bodies or Authorization headers only.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1217",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_in_url_leaking_via_referer_logs_and_browser_history[_secrets_in_url_leaking_via_referer_logs_and_browser_history_def] if {
    input.transmitted_in_url_or_query == true
}

secrets_in_url_leaking_via_referer_logs_and_browser_history[_secrets_in_url_leaking_via_referer_logs_and_browser_history_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _secrets_in_url_leaking_via_referer_logs_and_browser_history_def if {
    count(secrets_in_url_leaking_via_referer_logs_and_browser_history) > 0
}

_bearer_access_token_theft_and_replay_from_a_different_sender_def := {
    "name": "Bearer access token theft and replay from a different sender",
    "description": "An unbound bearer access token exfiltrated via XSS, log leak, malicious proxy, or browser extension is replayed from attacker infrastructure because the token carries no proof-of-possession (no mTLS x5t#S256 or DPoP jkt cnf claim). Long lifetime amplifies blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
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
            "value": "T1134.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_access_token_theft_and_replay_from_a_different_sender[_bearer_access_token_theft_and_replay_from_a_different_sender_def] if {
    not input.sender_constrained
}

bearer_access_token_theft_and_replay_from_a_different_sender[_bearer_access_token_theft_and_replay_from_a_different_sender_def] if {
    input.access_token_ttl_minutes > 60
}

exposures contains _bearer_access_token_theft_and_replay_from_a_different_sender_def if {
    count(bearer_access_token_theft_and_replay_from_a_different_sender) > 0
}
