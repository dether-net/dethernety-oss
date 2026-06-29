package _dt_built_in.exposures.api_gateway



_exposed_unauthenticated_admin_management_api_def := {
    "name": "Exposed unauthenticated Admin / management API",
    "description": "The privileged Admin API or management GUI is bound to a public interface (admin_listen=0.0.0.0:8001) and/or RBAC is disabled (enforce_rbac=off, admin_gui_auth unset), letting any reachable caller create routes, plugins and credentials \u2014 total control-plane takeover.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An Admin API bound to a public interface (admin_listen=0.0.0.0:8001) with RBAC disabled is a directly exploitable public-facing administrative endpoint \u2014 control-plane takeover via the exposed application. CVE-2020-11710 (Docker-Kong default Admin API exposure) is a concrete instance."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_unauthenticated_admin_management_api[_exposed_unauthenticated_admin_management_api_def] if {
    input.admin_api_public_bind == true
}

exposed_unauthenticated_admin_management_api[_exposed_unauthenticated_admin_management_api_def] if {
    input.enforce_rbac == "off"
}

exposed_unauthenticated_admin_management_api[_exposed_unauthenticated_admin_management_api_def] if {
    not input.admin_gui_auth_configured
}

exposures contains _exposed_unauthenticated_admin_management_api_def if {
    count(exposed_unauthenticated_admin_management_api) > 0
}

_jwt_oauth_token_validation_bypass_def := {
    "name": "JWT / OAuth token validation bypass",
    "description": "The gateway accepts the 'none' algorithm, takes the alg from the token header (RS256->HS256 key confusion), or skips exp/iss/aud and JWKS signature checks, letting an attacker forge or replay tokens and impersonate any principal at the edge.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {
                "justification": "Forging or replaying a JWT/OAuth token accepted at the edge is use of an application access token to authenticate as a principal without the corresponding credential."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.003",
            "attributes": {
                "justification": "Accepting alg=none / RS256->HS256 key-confusion tokens lets an attacker mint and impersonate an arbitrary principal's token at the gateway."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    input.accepts_alg_none == true
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    input.rs256_to_hs256_confusion_possible == true
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    not input.jwt_signature_verified
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    not input.issuer_claim_validated
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    not input.audience_claim_validated
}

jwt_oauth_token_validation_bypass[_jwt_oauth_token_validation_bypass_def] if {
    not input.expiry_claim_validated
}

exposures contains _jwt_oauth_token_validation_bypass_def if {
    count(jwt_oauth_token_validation_bypass) > 0
}

_missing_edge_authentication_on_routes_def := {
    "name": "Missing edge authentication on routes",
    "description": "A route with no authentication plugin (key-auth/jwt/oauth2/openid-connect/mtls-auth) proxies directly to an internal backend, exposing it unauthenticated to the internet (OWASP API2 broken authentication).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A route with no authentication plugin proxies directly to an internal backend, exposing it unauthenticated to the internet \u2014 an attacker reaches and exploits the public-facing application/backend without credentials (OWASP API2 broken authentication)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

missing_edge_authentication_on_routes[_missing_edge_authentication_on_routes_def] if {
    input.unauthenticated_route_exposed == true
}

missing_edge_authentication_on_routes[_missing_edge_authentication_on_routes_def] if {
    not input.global_auth_plugin_enabled
    input.routes_without_auth_plugin_count > 0
}

exposures contains _missing_edge_authentication_on_routes_def if {
    count(missing_edge_authentication_on_routes) > 0
}

_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def := {
    "name": "Cleartext or weak TLS termination and unverified upstream re-encryption",
    "description": "A proxy listener without the ssl flag, weak ssl_protocols/ssl_cipher_suite (TLS1.0/1.1, CBC/RC4), or plaintext/unverified-TLS upstreams expose credentials, tokens and PII to sniffing and MITM at the edge and on the gateway-to-backend hop.",
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
                "justification": "Unverified upstream re-encryption (plaintext http upstreams or tls_verify disabled) and weak/absent edge TLS allow an adversary positioned on the network path to intercept and relay traffic \u2014 Adversary-in-the-Middle."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Cleartext edge listener (no ssl flag) or downgraded weak TLS versions/ciphers expose credentials, tokens and PII to passive Network Sniffing at the edge and on the gateway-to-backend hop."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "Sensitive data traversing an unencrypted/cleartext gateway-to-backend or edge channel can be exfiltrated over an unencrypted non-C2 protocol."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    not input.flow_tls_encrypted
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    input.min_tls_version == "tls1_0_or_tls1_1_or_sslv3_accepted"
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    not input.cipher_suites_strong_only
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    not input.back_end_traffic_reencrypted_after_tls_termination
}

cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption[_cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def] if {
    not input.server_certificate_validated
}

exposures contains _cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption_def if {
    count(cleartext_or_weak_tls_termination_and_unverified_upstream_re_encryption) > 0
}

_unrestricted_resource_consumption_dos_def := {
    "name": "Unrestricted resource consumption (DoS)",
    "description": "No rate-limiting plugin and an unbounded request body (nginx_http_client_max_body_size=0) allow request floods, large-payload memory/bandwidth exhaustion, brute force and enumeration against backends (OWASP API4).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {
                "justification": "Unbounded request body (nginx_http_client_max_body_size=0) enables large-payload memory/bandwidth exhaustion \u2014 an application-layer exhaustion flood (OWASP API4)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "attributes": {
                "justification": "No rate-limiting plugin permits unlimited request volume, enabling a service-exhaustion flood against the gateway and its backends (OWASP API4)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_resource_consumption_dos[_unrestricted_resource_consumption_dos_def] if {
    not input.rate_limiting_or_lockout_enabled
}

unrestricted_resource_consumption_dos[_unrestricted_resource_consumption_dos_def] if {
    not input.request_body_size_capped
}

unrestricted_resource_consumption_dos[_unrestricted_resource_consumption_dos_def] if {
    not input.request_size_and_complexity_limits_enforced
}

unrestricted_resource_consumption_dos[_unrestricted_resource_consumption_dos_def] if {
    not input.ddos_protection_in_place
}

exposures contains _unrestricted_resource_consumption_dos_def if {
    count(unrestricted_resource_consumption_dos) > 0
}

_http_request_smuggling_desync_and_missing_payload_validation_def := {
    "name": "HTTP request smuggling / desync and missing payload validation",
    "description": "CL.TE/TE.CL/H2.TE disagreement between the gateway and back-end, plus absent request-validator/Content-Type enforcement, enables desync that bypasses edge authorization, poisons caches and forwards malformed payloads to backends.",
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
            "value": "T1071.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

http_request_smuggling_desync_and_missing_payload_validation[_http_request_smuggling_desync_and_missing_payload_validation_def] if {
    not input.request_framing_normalized_front_back
}

http_request_smuggling_desync_and_missing_payload_validation[_http_request_smuggling_desync_and_missing_payload_validation_def] if {
    input.ambiguous_length_headers_forwarded == true
}

http_request_smuggling_desync_and_missing_payload_validation[_http_request_smuggling_desync_and_missing_payload_validation_def] if {
    not input.http2_downgrade_strictly_normalized
}

http_request_smuggling_desync_and_missing_payload_validation[_http_request_smuggling_desync_and_missing_payload_validation_def] if {
    not input.content_type_strict_validation
}

http_request_smuggling_desync_and_missing_payload_validation[_http_request_smuggling_desync_and_missing_payload_validation_def] if {
    not input.request_payload_schema_validated
}

exposures contains _http_request_smuggling_desync_and_missing_payload_validation_def if {
    count(http_request_smuggling_desync_and_missing_payload_validation) > 0
}

_secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def := {
    "name": "Secrets disclosure in logs or config; client-IP spoofing breaking audit",
    "description": "Logging Authorization/apikey headers (CWE-532), hardcoding upstream credentials and the Kong-Admin-Token in kong.yml/images, or disabling access logs destroys the forensic trail and leaks the keys to the kingdom; trusting all upstreams (trusted_ips=0.0.0.0/0) lets clients spoof X-Forwarded-For, defeating IP-based logging and rate limits.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.007",
            "attributes": {
                "justification": "Hardcoded upstream credentials and the Kong-Admin-Token in declarative config / container images are unsecured credentials recoverable from the container/API layer."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Disabling edge access logs (proxy_access_log=off) and IP spoofing via trusted_ips=0.0.0.0/0 impair/defeat logging and defensive monitoring."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Logging Authorization/apikey headers (CWE-532) and committing secrets to config exposes unsecured credentials."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit[_secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def] if {
    not input.secrets_masked_in_logs
}

secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit[_secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit[_secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def] if {
    not input.access_audit_trail_enabled
}

secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit[_secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def] if {
    input.upstream_proxy_ips_unscoped == true
}

exposures contains _secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit_def if {
    count(secrets_disclosure_in_logs_or_config_client_ip_spoofing_breaking_audit) > 0
}

_unverified_gateway_image_plugin_supply_chain_def := {
    "name": "Unverified gateway image / plugin supply chain",
    "description": "Running unsigned gateway images or unpinned third-party plugins lets a tampered or malicious artifact execute in the edge trust position, intercepting all proxied traffic and credentials.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.003",
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
            "value": "T1195.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unverified_gateway_image_plugin_supply_chain[_unverified_gateway_image_plugin_supply_chain_def] if {
    not input.gateway_image_signature_verified
}

unverified_gateway_image_plugin_supply_chain[_unverified_gateway_image_plugin_supply_chain_def] if {
    not input.artifact_supply_chain_signed_provenance_verified
}

unverified_gateway_image_plugin_supply_chain[_unverified_gateway_image_plugin_supply_chain_def] if {
    not input.artifact_references_immutable_digest_pinned
}

unverified_gateway_image_plugin_supply_chain[_unverified_gateway_image_plugin_supply_chain_def] if {
    not input.third_party_plugins_version_pinned
}

unverified_gateway_image_plugin_supply_chain[_unverified_gateway_image_plugin_supply_chain_def] if {
    input.untrusted_plugins_allowed == true
}

exposures contains _unverified_gateway_image_plugin_supply_chain_def if {
    count(unverified_gateway_image_plugin_supply_chain) > 0
}
