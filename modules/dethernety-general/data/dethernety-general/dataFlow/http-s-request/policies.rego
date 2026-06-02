package _dt_built_in.exposures.http_s_request



_cleartext_http_downgrade_missing_hsts_def := {
    "name": "Cleartext HTTP downgrade / missing HSTS",
    "description": "Without HTTPS-only enforcement and a Strict-Transport-Security header (with sufficient max-age and includeSubDomains), an active network attacker can SSL-strip the flow onto plaintext HTTP and capture cookies, credentials, and bodies in transit.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
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
            "value": "T1071.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_http_downgrade_missing_hsts[_cleartext_http_downgrade_missing_hsts_def] if {
    not input.tls_only_transport
}

cleartext_http_downgrade_missing_hsts[_cleartext_http_downgrade_missing_hsts_def] if {
    not input.hsts_enforced
}

cleartext_http_downgrade_missing_hsts[_cleartext_http_downgrade_missing_hsts_def] if {
    input.hsts_max_age_seconds < 31536000
}

exposures contains _cleartext_http_downgrade_missing_hsts_def if {
    count(cleartext_http_downgrade_missing_hsts) > 0
}

_missing_weak_content_security_policy_enabling_xss_def := {
    "name": "Missing/weak Content-Security-Policy enabling XSS",
    "description": "When CSP is absent or weakened by 'unsafe-inline' / 'unsafe-eval' / wildcard script-src (and X-Content-Type-Options: nosniff is missing to permit MIME-confusion script execution), reflected/stored/DOM XSS payloads run in the victim's browser with full session authority.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.007",
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

missing_weak_content_security_policy_enabling_xss[_missing_weak_content_security_policy_enabling_xss_def] if {
    not input.content_security_policy_enforced
}

missing_weak_content_security_policy_enabling_xss[_missing_weak_content_security_policy_enabling_xss_def] if {
    input.csp_allows_unsafe_inline_or_eval == true
}

missing_weak_content_security_policy_enabling_xss[_missing_weak_content_security_policy_enabling_xss_def] if {
    not input.x_content_type_options_nosniff_set
}

exposures contains _missing_weak_content_security_policy_enabling_xss_def if {
    count(missing_weak_content_security_policy_enabling_xss) > 0
}

_clickjacking_via_missing_frame_ancestors_x_frame_options_def := {
    "name": "Clickjacking via missing frame-ancestors / X-Frame-Options",
    "description": "Without CSP frame-ancestors 'none' or X-Frame-Options: DENY/SAMEORIGIN, an attacker page frames the authenticated UI and hijacks click events to perform state-changing actions as the victim.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

clickjacking_via_missing_frame_ancestors_x_frame_options[_clickjacking_via_missing_frame_ancestors_x_frame_options_def] if {
    not input.frame_ancestors_or_x_frame_options_restricted
}

exposures contains _clickjacking_via_missing_frame_ancestors_x_frame_options_def if {
    count(clickjacking_via_missing_frame_ancestors_x_frame_options) > 0
}

_permissive_cors_allowing_cross_origin_data_theft_def := {
    "name": "Permissive CORS allowing cross-origin data theft",
    "description": "Access-Control-Allow-Origin set to '*' on credentialed endpoints, a reflected Origin without allow-list validation, or accepting 'null' lets any origin read authenticated JSON responses cross-site, defeating same-origin protection.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Permissive CORS lets an attacker-origin page read authenticated JSON responses, enabling Steal Web Session Cookie / web-session data exfiltration cross-site."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

permissive_cors_allowing_cross_origin_data_theft[_permissive_cors_allowing_cross_origin_data_theft_def] if {
    not input.cors_origin_allowlist_strict
}

permissive_cors_allowing_cross_origin_data_theft[_permissive_cors_allowing_cross_origin_data_theft_def] if {
    input.cors_credentials_with_wildcard_origin == true
}

exposures contains _permissive_cors_allowing_cross_origin_data_theft_def if {
    count(permissive_cors_allowing_cross_origin_data_theft) > 0
}

_missing_csrf_protection_on_state_changing_requests_def := {
    "name": "Missing CSRF protection on state-changing requests",
    "description": "Absent anti-CSRF tokens, strict Content-Type validation, and SameSite=Strict/Lax cookies, an attacker page triggers POST/PUT/PATCH/DELETE requests with the victim's ambient session cookies, performing actions in their name.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "attributes": {
                "justification": "Browser Session Hijacking \u2014 attacker page leverages the victim's authenticated browser session to issue state-changing requests with ambient cookies, the canonical CSRF kill-chain step."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

missing_csrf_protection_on_state_changing_requests[_missing_csrf_protection_on_state_changing_requests_def] if {
    not input.csrf_token_or_double_submit_enforced
}

missing_csrf_protection_on_state_changing_requests[_missing_csrf_protection_on_state_changing_requests_def] if {
    not input.samesite_attribute_set
}

missing_csrf_protection_on_state_changing_requests[_missing_csrf_protection_on_state_changing_requests_def] if {
    not input.content_type_strict_validation
}

exposures contains _missing_csrf_protection_on_state_changing_requests_def if {
    count(missing_csrf_protection_on_state_changing_requests) > 0
}

_session_cookies_missing_httponly_secure_samesite_def := {
    "name": "Session cookies missing HttpOnly / Secure / SameSite",
    "description": "Auth cookies without HttpOnly are readable from JavaScript on any XSS, without Secure they leak over plaintext HTTP, and without SameSite they ride cross-site requests \u2014 each missing attribute opens a documented session-hijack or CSRF path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
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
        }
    ],
    "attack_vector": "NETWORK"
}

session_cookies_missing_httponly_secure_samesite[_session_cookies_missing_httponly_secure_samesite_def] if {
    not input.cookie_httponly_flag
}

session_cookies_missing_httponly_secure_samesite[_session_cookies_missing_httponly_secure_samesite_def] if {
    not input.cookie_secure_flag
}

session_cookies_missing_httponly_secure_samesite[_session_cookies_missing_httponly_secure_samesite_def] if {
    not input.samesite_attribute_set
}

exposures contains _session_cookies_missing_httponly_secure_samesite_def if {
    count(session_cookies_missing_httponly_secure_samesite) > 0
}

_http_request_smuggling_cl_te_te_cl_h2_desync_def := {
    "name": "HTTP request smuggling (CL.TE / TE.CL / H2 desync)",
    "description": "Front-end CDN/proxy and back-end origin disagree on Content-Length vs Transfer-Encoding (or on HTTP/2-to-HTTP/1 downgrade framing), letting an attacker smuggle a follow-up request that bypasses edge auth/WAF, poisons the cache, and hijacks other users' sessions.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

http_request_smuggling_cl_te_te_cl_h2_desync[_http_request_smuggling_cl_te_te_cl_h2_desync_def] if {
    not input.request_framing_normalized_front_back
}

exposures contains _http_request_smuggling_cl_te_te_cl_h2_desync_def if {
    count(http_request_smuggling_cl_te_te_cl_h2_desync) > 0
}

_permissive_http_methods_verb_tampering_trace_track_def := {
    "name": "Permissive HTTP methods / verb tampering (TRACE/TRACK)",
    "description": "Endpoints accepting TRACE/TRACK enable cross-site tracing and cookie reflection; arbitrary unsupported verbs slipping through can bypass auth filters scoped only to GET/POST, granting unintended access.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

permissive_http_methods_verb_tampering_trace_track[_permissive_http_methods_verb_tampering_trace_track_def] if {
    not input.http_method_allow_list_enforced
}

permissive_http_methods_verb_tampering_trace_track[_permissive_http_methods_verb_tampering_trace_track_def] if {
    not input.trace_track_methods_blocked
}

exposures contains _permissive_http_methods_verb_tampering_trace_track_def if {
    count(permissive_http_methods_verb_tampering_trace_track) > 0
}

_waf_in_detect_only_absent_on_public_web_flow_def := {
    "name": "WAF in detect-only / absent on public web flow",
    "description": "With no WAF or a WAF left in monitor/detect-only mode (or anomaly threshold tuned high enough to never block), injection, XSS, and command payloads in request parameters/headers/body reach the back-end interpreter unimpeded.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A WAF in detect-only / absent on the public web flow leaves injection, XSS, and command payloads in client requests to reach the back-end interpreter \u2014 the textbook Exploit Public-Facing Application path."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

waf_in_detect_only_absent_on_public_web_flow[_waf_in_detect_only_absent_on_public_web_flow_def] if {
    not input.waf_active_blocking_on_public_web
}

exposures contains _waf_in_detect_only_absent_on_public_web_flow_def if {
    count(waf_in_detect_only_absent_on_public_web_flow) > 0
}

_oversized_request_bodies_enabling_resource_exhaustion_def := {
    "name": "Oversized request bodies enabling resource exhaustion",
    "description": "Without an edge-enforced request-body size limit (e.g. nginx client_max_body_size), a single client can submit unbounded uploads or JSON/decompression bombs that exhaust memory, disk, or CPU at the edge or origin.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

oversized_request_bodies_enabling_resource_exhaustion[_oversized_request_bodies_enabling_resource_exhaustion_def] if {
    not input.request_size_and_complexity_limits_enforced
}

exposures contains _oversized_request_bodies_enabling_resource_exhaustion_def if {
    count(oversized_request_bodies_enabling_resource_exhaustion) > 0
}
