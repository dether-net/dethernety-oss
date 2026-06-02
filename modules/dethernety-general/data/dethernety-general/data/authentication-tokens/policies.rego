package _dt_built_in.exposures.authentication_tokens



_jwt_signature_algorithm_confusion_def := {
    "name": "JWT signature algorithm confusion",
    "description": "Verifier accepts attacker-controlled alg header (alg=none, RS256\u2192HS256 key-confusion using the public key as HMAC secret, or kid header injection pointing at attacker-chosen keys), letting an attacker forge tokens that pass signature checks. Defeats authentication entirely.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

jwt_signature_algorithm_confusion[_jwt_signature_algorithm_confusion_def] if {
    not input.signature_algorithm_pinned_server_side
}

jwt_signature_algorithm_confusion[_jwt_signature_algorithm_confusion_def] if {
    input.accepts_alg_none == true
}

jwt_signature_algorithm_confusion[_jwt_signature_algorithm_confusion_def] if {
    input.rs256_to_hs256_confusion_possible == true
}

jwt_signature_algorithm_confusion[_jwt_signature_algorithm_confusion_def] if {
    not input.jwt_signature_verified
}

exposures contains _jwt_signature_algorithm_confusion_def if {
    count(jwt_signature_algorithm_confusion) > 0
}

_weak_hmac_secret_brute_force_def := {
    "name": "Weak HMAC secret brute-force",
    "description": "HS256/HS384/HS512 tokens signed with a low-entropy or guessable shared secret allow offline cracking of a captured JWT, after which the attacker mints arbitrary tokens with any claims. The signature is honest; the secret is the failure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.002"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110"
        }
    ],
    "attack_vector": "NETWORK"
}

weak_hmac_secret_brute_force[_weak_hmac_secret_brute_force_def] if {
    not input.signing_key_high_entropy
}

weak_hmac_secret_brute_force[_weak_hmac_secret_brute_force_def] if {
    not input.signing_key_csprng_generated
}

weak_hmac_secret_brute_force[_weak_hmac_secret_brute_force_def] if {
    input.identifier_entropy_bits < 128
}

exposures contains _weak_hmac_secret_brute_force_def if {
    count(weak_hmac_secret_brute_force) > 0
}

_missing_or_permissive_token_claim_validation_def := {
    "name": "Missing or permissive token claim validation",
    "description": "Verifier fails to enforce exp/nbf (expired or not-yet-valid tokens accepted), aud (token issued for a different audience replayed here), iss (untrusted issuer), or sub binding. Each gap converts a legitimately issued token into a long-lived skeleton key across services.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

missing_or_permissive_token_claim_validation[_missing_or_permissive_token_claim_validation_def] if {
    not input.expiry_claim_validated
}

missing_or_permissive_token_claim_validation[_missing_or_permissive_token_claim_validation_def] if {
    not input.audience_claim_validated
}

missing_or_permissive_token_claim_validation[_missing_or_permissive_token_claim_validation_def] if {
    not input.issuer_claim_validated
}

exposures contains _missing_or_permissive_token_claim_validation_def if {
    count(missing_or_permissive_token_claim_validation) > 0
}

_bearer_token_theft_and_replay_without_sender_constraint_def := {
    "name": "Bearer token theft and replay without sender constraint",
    "description": "Access tokens carried as plain bearers (no DPoP, no mTLS binding, no token-binding) are valid for whoever presents them. A token captured via XSS, malicious browser extension, AiTM proxy, or log scrape is replayed verbatim from the attacker's host \u2014 the API cannot tell.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528"
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_token_theft_and_replay_without_sender_constraint[_bearer_token_theft_and_replay_without_sender_constraint_def] if {
    not input.sender_constrained
}

exposures contains _bearer_token_theft_and_replay_without_sender_constraint_def if {
    count(bearer_token_theft_and_replay_without_sender_constraint) > 0
}

_refresh_token_replay_with_no_rotation_or_reuse_detection_def := {
    "name": "Refresh-token replay with no rotation or reuse detection",
    "description": "Long-lived refresh tokens are accepted repeatedly without rotation-on-use, or rotation is enforced but reuse of an already-rotated token is not detected and revoked. A stolen refresh token grants the attacker indefinite access alongside the legitimate user.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

refresh_token_replay_with_no_rotation_or_reuse_detection[_refresh_token_replay_with_no_rotation_or_reuse_detection_def] if {
    not input.refresh_token_rotation_enabled
}

refresh_token_replay_with_no_rotation_or_reuse_detection[_refresh_token_replay_with_no_rotation_or_reuse_detection_def] if {
    not input.server_side_revocation_supported
}

exposures contains _refresh_token_replay_with_no_rotation_or_reuse_detection_def if {
    count(refresh_token_replay_with_no_rotation_or_reuse_detection) > 0
}

_excessive_token_lifetime_with_no_revocation_channel_def := {
    "name": "Excessive token lifetime with no revocation channel",
    "description": "Access tokens with multi-hour or multi-day lifetimes, and no working revocation/introspection endpoint, mean a logout, password change, or compromise notification cannot cut off a stolen token until natural expiry. Persistence is the design, not an accident.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

excessive_token_lifetime_with_no_revocation_channel[_excessive_token_lifetime_with_no_revocation_channel_def] if {
    input.access_token_ttl_minutes > 60
}

excessive_token_lifetime_with_no_revocation_channel[_excessive_token_lifetime_with_no_revocation_channel_def] if {
    not input.server_side_revocation_supported
}

excessive_token_lifetime_with_no_revocation_channel[_excessive_token_lifetime_with_no_revocation_channel_def] if {
    not input.session_absolute_timeout_enforced
}

exposures contains _excessive_token_lifetime_with_no_revocation_channel_def if {
    count(excessive_token_lifetime_with_no_revocation_channel) > 0
}

_token_exfiltration_via_xss_js_accessible_storage_def := {
    "name": "Token exfiltration via XSS / JS-accessible storage",
    "description": "Tokens placed in localStorage, sessionStorage, or non-HttpOnly cookies are reachable by injected script. A single XSS sink \u2014 first-party bug or compromised third-party library \u2014 drains live access and refresh tokens to an attacker endpoint, and the API still sees a legitimate bearer presentation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004"
        }
    ],
    "attack_vector": "NETWORK"
}

token_exfiltration_via_xss_js_accessible_storage[_token_exfiltration_via_xss_js_accessible_storage_def] if {
    input.stored_in_js_accessible_storage == true
}

token_exfiltration_via_xss_js_accessible_storage[_token_exfiltration_via_xss_js_accessible_storage_def] if {
    not input.cookie_httponly_flag
}

token_exfiltration_via_xss_js_accessible_storage[_token_exfiltration_via_xss_js_accessible_storage_def] if {
    input.long_lived_token_in_browser_storage == true
}

exposures contains _token_exfiltration_via_xss_js_accessible_storage_def if {
    count(token_exfiltration_via_xss_js_accessible_storage) > 0
}

_token_leakage_via_url_referer_or_telemetry_sinks_def := {
    "name": "Token leakage via URL, Referer, or telemetry sinks",
    "description": "Tokens carried in query strings, fragments, or appearing in access logs, error reports, distributed-tracing spans, or third-party Referer headers are harvested by anyone with read access to those sinks \u2014 log aggregators, CDN edges, APM vendors, browser history. Transport may be TLS-clean and the token still leaks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

token_leakage_via_url_referer_or_telemetry_sinks[_token_leakage_via_url_referer_or_telemetry_sinks_def] if {
    input.transmitted_in_url_or_query == true
}

token_leakage_via_url_referer_or_telemetry_sinks[_token_leakage_via_url_referer_or_telemetry_sinks_def] if {
    not input.tls_only_transport
}

token_leakage_via_url_referer_or_telemetry_sinks[_token_leakage_via_url_referer_or_telemetry_sinks_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _token_leakage_via_url_referer_or_telemetry_sinks_def if {
    count(token_leakage_via_url_referer_or_telemetry_sinks) > 0
}

_session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions_def := {
    "name": "Session fixation and cross-site request forgery on cookie-borne sessions",
    "description": "Session/bearer cookies issued before authentication and not rotated on login allow an attacker to plant a known session id, then ride the victim's authenticated session. Missing SameSite/anti-CSRF lets cross-origin pages spend the victim's session on state-changing endpoints. Both abuse a token the user legitimately holds.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "Web Session Cookie \u2014 replaying/fixating a session cookie to ride an authenticated session is precisely what unrotated-on-auth session ids and SameSite=None cookies enable."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Steal Web Session Cookie \u2014 CSRF-spent cookies and fixated session ids let an adversary obtain/abuse a valid session cookie from the victim's browser context."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.001",
            "attributes": {
                "justification": "Web Cookies \u2014 forging or planting a session cookie value (fixation) that the server later treats as authenticated falls under forged web cookies."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions[_session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions_def] if {
    not input.session_id_regenerated_on_auth
}

session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions[_session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions_def] if {
    not input.samesite_attribute_set
}

session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions[_session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions_def] if {
    input.samesite_mode == "None"
}

exposures contains _session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions_def if {
    count(session_fixation_and_cross_site_request_forgery_on_cookie_borne_sessions) > 0
}
