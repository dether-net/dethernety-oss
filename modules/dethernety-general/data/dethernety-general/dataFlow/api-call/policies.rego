package _dt_built_in.exposures.api_call



_cleartext_transport_tls_strip_def := {
    "name": "Cleartext transport / TLS strip",
    "description": "The flow is carried over plaintext HTTP, or is downgradeable to HTTP via TLS-strip in the absence of HSTS, letting a network attacker passively read credentials, tokens, and PII or actively inject responses.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Network sniffing of plaintext credentials/tokens/PII when the flow is carried over cleartext HTTP."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "TLS-strip / downgrade attack succeeds when HSTS is absent, forcing the flow back to plaintext."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "Cleartext channel enables exfiltration over an unencrypted non-C2 protocol observable to any on-path attacker."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "Plain HTTP web-protocol traffic is trivially read and tampered with on the wire by an adversary on path."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_transport_tls_strip[_cleartext_transport_tls_strip_def] if {
    not input.flow_tls_encrypted
}

cleartext_transport_tls_strip[_cleartext_transport_tls_strip_def] if {
    not input.hsts_enforced
}

exposures contains _cleartext_transport_tls_strip_def if {
    count(cleartext_transport_tls_strip) > 0
}

_tls_protocol_cipher_downgrade_def := {
    "name": "TLS protocol/cipher downgrade",
    "description": "Server accepts SSLv3/TLS1.0/1.1 or weak (RC4/3DES/CBC/EXPORT) ciphers, or permits insecure renegotiation, enabling POODLE/FREAK/LOGJAM/CRIME-style attacks that weaken or hijack the encrypted session.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "Downgrade Attack \u2014 accepting SSLv3/TLS1.0/1.1 or weak cipher suites lets an on-path adversary force the flow onto a weaker protocol/cipher (POODLE/FREAK/LOGJAM), the canonical ATT&CK technique for this exposure."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tls_protocol_cipher_downgrade[_tls_protocol_cipher_downgrade_def] if {
    input.min_tls_version == "tls1_0_or_tls1_1_or_sslv3_accepted"
}

tls_protocol_cipher_downgrade[_tls_protocol_cipher_downgrade_def] if {
    input.cipher_suites_strong_only == "any_legacy_cbc_rc4_3des_null_or_export_suite_accepted"
}

tls_protocol_cipher_downgrade[_tls_protocol_cipher_downgrade_def] if {
    input.downgrade_and_renegotiation_protected == "insecure_renegotiation_or_downgrade_observed"
}

exposures contains _tls_protocol_cipher_downgrade_def if {
    count(tls_protocol_cipher_downgrade) > 0
}

_adversary_in_the_middle_via_skipped_certificate_validation_def := {
    "name": "Adversary-in-the-Middle via skipped certificate validation",
    "description": "Client disables chain/hostname verification (InsecureSkipVerify, verify=False, rejectUnauthorized:false, curl -k) or trusts an overly broad CA bundle, so an on-path attacker presents an arbitrary certificate and reads/modifies the entire flow.",
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
            "value": "T1553.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

adversary_in_the_middle_via_skipped_certificate_validation[_adversary_in_the_middle_via_skipped_certificate_validation_def] if {
    not input.server_certificate_validated
}

adversary_in_the_middle_via_skipped_certificate_validation[_adversary_in_the_middle_via_skipped_certificate_validation_def] if {
    not input.tls_root_trust_managed
}

exposures contains _adversary_in_the_middle_via_skipped_certificate_validation_def if {
    count(adversary_in_the_middle_via_skipped_certificate_validation) > 0
}

_stolen_bearer_token_replay_def := {
    "name": "Stolen-bearer-token replay",
    "description": "Plain bearer tokens (no DPoP/mTLS binding) lifted from a compromised client, log, or proxy can be replayed from any host until expiry, granting the attacker the caller's full privileges on the flow.",
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

stolen_bearer_token_replay[_stolen_bearer_token_replay_def] if {
    not input.sender_constrained
}

stolen_bearer_token_replay[_stolen_bearer_token_replay_def] if {
    not input.sender_constrained
    input.access_token_ttl_minutes > 60
}

exposures contains _stolen_bearer_token_replay_def if {
    count(stolen_bearer_token_replay) > 0
}

_jwt_signature_bypass_alg_none_alg_confusion_def := {
    "name": "JWT signature bypass (alg=none / alg-confusion)",
    "description": "Receiver trusts the JWT's own 'alg' header, accepts 'none', or confuses HS256 with RS256 \u2014 attacker forges tokens with arbitrary claims and impersonates any principal authenticating on the flow.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.3,
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
            "value": "T1134.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

jwt_signature_bypass_alg_none_alg_confusion[_jwt_signature_bypass_alg_none_alg_confusion_def] if {
    not input.jwt_signature_verified
}

jwt_signature_bypass_alg_none_alg_confusion[_jwt_signature_bypass_alg_none_alg_confusion_def] if {
    input.accepts_alg_none == true
}

jwt_signature_bypass_alg_none_alg_confusion[_jwt_signature_bypass_alg_none_alg_confusion_def] if {
    not input.signature_algorithm_pinned_server_side
}

jwt_signature_bypass_alg_none_alg_confusion[_jwt_signature_bypass_alg_none_alg_confusion_def] if {
    input.rs256_to_hs256_confusion_possible == true
}

exposures contains _jwt_signature_bypass_alg_none_alg_confusion_def if {
    count(jwt_signature_bypass_alg_none_alg_confusion) > 0
}

_bearer_token_sensitive_data_leakage_via_url_def := {
    "name": "Bearer token / sensitive data leakage via URL",
    "description": "Tokens, API keys, session ids, or PII carried in URL query strings end up in web-server access logs, proxy logs, CDN logs, Referer headers, and browser history \u2014 readable and replayable by anyone with log access.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_token_sensitive_data_leakage_via_url[_bearer_token_sensitive_data_leakage_via_url_def] if {
    input.transmitted_in_url_or_query == true
}

bearer_token_sensitive_data_leakage_via_url[_bearer_token_sensitive_data_leakage_via_url_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _bearer_token_sensitive_data_leakage_via_url_def if {
    count(bearer_token_sensitive_data_leakage_via_url) > 0
}

_server_side_request_forgery_via_outbound_flow_def := {
    "name": "Server-Side Request Forgery via outbound flow",
    "description": "Application uses user-influenced input as the destination of an outbound API call with no egress allowlist, letting attackers reach internal RFC1918 services or cloud metadata (169.254.169.254) to exfiltrate IAM credentials.",
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
            "value": "T1552.005",
            "attributes": {
                "justification": "Unrestricted outbound fetch reaches 169.254.169.254 to steal IAM role credentials from the cloud instance metadata API."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "attributes": {
                "justification": "SSRF-driven egress to attacker-controlled cloud storage enables data exfiltration to an external cloud account."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

server_side_request_forgery_via_outbound_flow[_server_side_request_forgery_via_outbound_flow_def] if {
    not input.outbound_fetch_destination_allowlisted
}

server_side_request_forgery_via_outbound_flow[_server_side_request_forgery_via_outbound_flow_def] if {
    not input.private_and_metadata_targets_blocked
}

server_side_request_forgery_via_outbound_flow[_server_side_request_forgery_via_outbound_flow_def] if {
    not input.cloud_metadata_endpoint_blocked
}

exposures contains _server_side_request_forgery_via_outbound_flow_def if {
    count(server_side_request_forgery_via_outbound_flow) > 0
}

_over_scoped_wrong_audience_token_abuse_def := {
    "name": "Over-scoped / wrong-audience token abuse",
    "description": "Access token issued with wildcard scopes or an audience broader than this flow's target is accepted by unrelated services, turning a single token compromise into a wide privilege blast radius (BOLA/BFLA amplifier).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
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
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_scoped_wrong_audience_token_abuse[_over_scoped_wrong_audience_token_abuse_def] if {
    not input.scopes_least_privilege
}

over_scoped_wrong_audience_token_abuse[_over_scoped_wrong_audience_token_abuse_def] if {
    not input.audience_claim_validated
}

over_scoped_wrong_audience_token_abuse[_over_scoped_wrong_audience_token_abuse_def] if {
    not input.least_privilege_authorization_at_crossing
}

exposures contains _over_scoped_wrong_audience_token_abuse_def if {
    count(over_scoped_wrong_audience_token_abuse) > 0
}
