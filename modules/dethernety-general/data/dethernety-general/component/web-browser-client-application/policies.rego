package _dt_built_in.exposures.web_browser_client_application



_cross_site_scripting_dom_script_injection_def := {
    "name": "Cross-site scripting / DOM script injection",
    "description": "Attacker-controlled script executes in the victim's browser via reflected, stored, or DOM-based XSS \u2014 rewriting the DOM, performing actions as the user, or exfiltrating tokens. The server's client-side defenses are output encoding/safe templating, a CSP without 'unsafe-inline'/'unsafe-eval', Trusted Types on DOM sinks, and X-Content-Type-Options: nosniff; absence of these leaves the untrusted client exploitable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
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
            "value": "T1189",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cross_site_scripting_dom_script_injection[_cross_site_scripting_dom_script_injection_def] if {
    not input.content_security_policy_enforced
}

cross_site_scripting_dom_script_injection[_cross_site_scripting_dom_script_injection_def] if {
    input.csp_allows_unsafe_inline_or_eval == true
}

cross_site_scripting_dom_script_injection[_cross_site_scripting_dom_script_injection_def] if {
    not input.trusted_types_enforced
}

cross_site_scripting_dom_script_injection[_cross_site_scripting_dom_script_injection_def] if {
    not input.contextual_output_encoding_applied
}

cross_site_scripting_dom_script_injection[_cross_site_scripting_dom_script_injection_def] if {
    not input.x_content_type_options_nosniff_set
}

exposures contains _cross_site_scripting_dom_script_injection_def if {
    count(cross_site_scripting_dom_script_injection) > 0
}

_token_session_theft_from_insecure_client_storage_def := {
    "name": "Token / session theft from insecure client storage",
    "description": "A session token or JWT held in localStorage/sessionStorage or a non-HttpOnly cookie is readable by injected script (or a hostile extension) and replayed to hijack the account. Mitigated by keeping tokens in HttpOnly+Secure+SameSite cookies (or a BFF pattern), short-lived rotated access tokens, and never persisting tokens in JS-readable storage.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Steal Web Session Cookie \u2014 directly models exfiltrating a session cookie/token readable by injected script or a hostile extension."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "Web Session Cookie \u2014 the adversary replays the stolen session cookie/token to authenticate and hijack the account without credentials."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.003",
            "attributes": {
                "justification": "Credentials from Web Browsers \u2014 tokens/JWTs persisted in JS-readable browser storage are harvested by a malicious extension or local access."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

token_session_theft_from_insecure_client_storage[_token_session_theft_from_insecure_client_storage_def] if {
    input.stored_in_js_accessible_storage == true
}

token_session_theft_from_insecure_client_storage[_token_session_theft_from_insecure_client_storage_def] if {
    not input.cookie_httponly_flag
}

token_session_theft_from_insecure_client_storage[_token_session_theft_from_insecure_client_storage_def] if {
    not input.cookie_secure_flag
}

token_session_theft_from_insecure_client_storage[_token_session_theft_from_insecure_client_storage_def] if {
    input.samesite_mode == "None"
}

token_session_theft_from_insecure_client_storage[_token_session_theft_from_insecure_client_storage_def] if {
    not input.access_token_short_lived_rotated
}

exposures contains _token_session_theft_from_insecure_client_storage_def if {
    count(token_session_theft_from_insecure_client_storage) > 0
}

_session_hijacking_over_insecure_transport_mixed_content_def := {
    "name": "Session hijacking over insecure transport / mixed content",
    "description": "A network attacker SSL-strips, downgrades, or injects active mixed content to read session cookies and tokens transmitted in cleartext, then rides the authenticated browser session. Mitigated by HSTS (long max-age, includeSubDomains), the Secure cookie attribute, and CSP upgrade-insecure-requests with no http:// subresources.",
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
                "justification": "Adversary-in-the-Middle: SSL-strip/downgrade and active mixed content let a network attacker intercept cleartext session cookies and tokens."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "attributes": {
                "justification": "Browser Session Hijacking: the attacker rides the authenticated browser session after capturing the session material in transit."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "Steal Web Session Cookie: a session cookie lacking the Secure flag and transmitted over cleartext is captured and replayed."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

session_hijacking_over_insecure_transport_mixed_content[_session_hijacking_over_insecure_transport_mixed_content_def] if {
    not input.hsts_enabled
}

session_hijacking_over_insecure_transport_mixed_content[_session_hijacking_over_insecure_transport_mixed_content_def] if {
    not input.cookie_secure_flag
}

session_hijacking_over_insecure_transport_mixed_content[_session_hijacking_over_insecure_transport_mixed_content_def] if {
    not input.upgrade_insecure_requests_enabled
}

session_hijacking_over_insecure_transport_mixed_content[_session_hijacking_over_insecure_transport_mixed_content_def] if {
    input.mixed_content_present == true
}

exposures contains _session_hijacking_over_insecure_transport_mixed_content_def if {
    count(session_hijacking_over_insecure_transport_mixed_content) > 0
}

_client_side_supply_chain_compromise_cdn_npm_no_sri_def := {
    "name": "Client-side supply-chain compromise (CDN/npm, no SRI)",
    "description": "A tampered third-party or CDN script (Magecart-style dependency swap, or a compromised npm package) executes in every visitor's browser, harvesting form data and tokens. Mitigated by Subresource Integrity hashes on every cross-origin script, pinned lockfiles, and SCA/dependency scanning; a CDN script with no integrity attribute is the exposed state.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.005",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

client_side_supply_chain_compromise_cdn_npm_no_sri[_client_side_supply_chain_compromise_cdn_npm_no_sri_def] if {
    not input.subresource_integrity_enforced
}

client_side_supply_chain_compromise_cdn_npm_no_sri[_client_side_supply_chain_compromise_cdn_npm_no_sri_def] if {
    not input.dependency_versions_pinned_lockfile
}

client_side_supply_chain_compromise_cdn_npm_no_sri[_client_side_supply_chain_compromise_cdn_npm_no_sri_def] if {
    not input.dependency_vulnerability_scanning_enabled
}

exposures contains _client_side_supply_chain_compromise_cdn_npm_no_sri_def if {
    count(client_side_supply_chain_compromise_cdn_npm_no_sri) > 0
}

_clickjacking_ui_redress_def := {
    "name": "Clickjacking / UI redress",
    "description": "The application is embedded in an attacker-controlled iframe that overlays decoy UI to trick the user into authenticated clicks. Mitigated by CSP frame-ancestors 'none'/'self' (modern primary) plus X-Frame-Options: DENY/SAMEORIGIN for legacy clients; neither header present means the page is framable by any origin.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "attributes": {
                "justification": "A framable page enables an attacker iframe to overlay decoy UI and ride the authenticated browser session via tricked clicks (browser session hijacking)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1056.002",
            "attributes": {
                "justification": "UI-redress overlays a decoy interface to capture the user's intended GUI input/clicks on the embedded application."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

clickjacking_ui_redress[_clickjacking_ui_redress_def] if {
    not input.frame_ancestors_restricted
}

clickjacking_ui_redress[_clickjacking_ui_redress_def] if {
    not input.x_frame_options_set
}

exposures contains _clickjacking_ui_redress_def if {
    count(clickjacking_ui_redress) > 0
}

_overly_permissive_cors_unvalidated_postmessage_origin_def := {
    "name": "Overly-permissive CORS / unvalidated postMessage origin",
    "description": "A wildcard or reflected Access-Control-Allow-Origin (especially with Allow-Credentials: true), or a window.postMessage handler with no event.origin check / a '*' targetOrigin, lets a malicious origin read authenticated responses or inject/steal cross-frame data. Mitigated by explicit origin allow-lists, Vary: Origin, and strict event.origin validation.",
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

overly_permissive_cors_unvalidated_postmessage_origin[_overly_permissive_cors_unvalidated_postmessage_origin_def] if {
    input.cors_allow_origin_wildcard == true
}

overly_permissive_cors_unvalidated_postmessage_origin[_overly_permissive_cors_unvalidated_postmessage_origin_def] if {
    input.cors_origin_reflected == true
}

overly_permissive_cors_unvalidated_postmessage_origin[_overly_permissive_cors_unvalidated_postmessage_origin_def] if {
    input.cors_allow_credentials == true
    not input.cors_origin_allowlist_strict
}

overly_permissive_cors_unvalidated_postmessage_origin[_overly_permissive_cors_unvalidated_postmessage_origin_def] if {
    not input.postmessage_origin_validated
}

overly_permissive_cors_unvalidated_postmessage_origin[_overly_permissive_cors_unvalidated_postmessage_origin_def] if {
    input.postmessage_target_origin_wildcard == true
}

exposures contains _overly_permissive_cors_unvalidated_postmessage_origin_def if {
    count(overly_permissive_cors_unvalidated_postmessage_origin) > 0
}

_sensitive_data_cached_persisted_client_side_def := {
    "name": "Sensitive data cached / persisted client-side",
    "description": "PII or tokens linger in the browser disk cache, back-button history, shared proxies, or localStorage on a shared/compromised device. Mitigated by Cache-Control: no-store on authenticated/sensitive responses, autocomplete=off on secret fields, and not persisting PII client-side.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1217",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

sensitive_data_cached_persisted_client_side[_sensitive_data_cached_persisted_client_side_def] if {
    not input.cache_control_no_store_on_sensitive
}

sensitive_data_cached_persisted_client_side[_sensitive_data_cached_persisted_client_side_def] if {
    input.stored_in_js_accessible_storage == true
}

sensitive_data_cached_persisted_client_side[_sensitive_data_cached_persisted_client_side_def] if {
    not input.sensitive_field_autocomplete_off
}

exposures contains _sensitive_data_cached_persisted_client_side_def if {
    count(sensitive_data_cached_persisted_client_side) > 0
}

_server_relying_on_client_side_validation_authorization_def := {
    "name": "Server relying on client-side validation / authorization",
    "description": "The cardinal client-trust violation: the server honors client-asserted roles/flags or enforces rules only in the UI, so an attacker modifies the client or calls the API directly to bypass validation and escalate authorization. Mitigated by re-validating all input and enforcing authentication, authorization, and business rules server-side, independent of the untrusted client.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565",
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

server_relying_on_client_side_validation_authorization[_server_relying_on_client_side_validation_authorization_def] if {
    not input.server_side_input_validation_enforced
}

server_relying_on_client_side_validation_authorization[_server_relying_on_client_side_validation_authorization_def] if {
    not input.authz_enforced_server_side_centrally
}

server_relying_on_client_side_validation_authorization[_server_relying_on_client_side_validation_authorization_def] if {
    input.client_asserted_state_trusted_serverside == true
}

exposures contains _server_relying_on_client_side_validation_authorization_def if {
    count(server_relying_on_client_side_validation_authorization) > 0
}
