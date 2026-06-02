package _dt_built_in.exposures.web_server



_weak_tls_termination_def := {
    "name": "Weak TLS termination",
    "description": "Offering deprecated protocols (SSLv3/TLS1.0/1.1) or non-PFS/legacy ciphers (RC4, 3DES, EXPORT, NULL), missing HSTS, or serving an expired/self-signed/weak-key certificate lets an on-path attacker downgrade and decrypt or strip TLS, exposing credentials and session tokens. Also covers TLS session-reuse client-cert bypass across virtual hosts.",
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
                "justification": "Missing HSTS or weak TLS lets an on-path attacker intercept and relay traffic (Adversary-in-the-Middle), decrypting credentials/session tokens."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "Accepting SSLv3/TLS1.0/1.1 enables protocol downgrade to a broken cipher/protocol."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "attributes": {
                "justification": "Offering legacy/non-PFS ciphers weakens the negotiated encryption, enabling decryption of intercepted traffic."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_tls_termination[_weak_tls_termination_def] if {
    input.min_tls_version == "tls1_0_or_tls1_1_or_sslv3_accepted"
}

weak_tls_termination[_weak_tls_termination_def] if {
    not input.strong_cipher_suite_enforced
}

weak_tls_termination[_weak_tls_termination_def] if {
    not input.hsts_enabled
}

weak_tls_termination[_weak_tls_termination_def] if {
    not input.server_certificate_validated
}

exposures contains _weak_tls_termination_def if {
    count(weak_tls_termination) > 0
}

_unpatched_server_software_cve_rce_dos_def := {
    "name": "Unpatched server-software CVE (RCE / DoS)",
    "description": "An internet-facing server running a version behind a known advisory is a prime exploit target \u2014 e.g. nginx HTTP/3 (QUIC) use-after-free worker crash, or HTTP/2 Rapid Reset stream-reset flood \u2014 letting a remote attacker crash workers or corrupt memory. Banner/version disclosure accelerates targeting.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An internet-facing server running a version behind a known advisory (HTTP/3 QUIC use-after-free, HTTP/2 Rapid Reset, TLS session-reuse) is the canonical Exploit Public-Facing Application target; version/banner disclosure accelerates targeting."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Remote exploitation of the server's network-exposed software (worker-crash DoS / memory corruption via crafted QUIC or stream-reset traffic) maps to Exploitation of Remote Services against the network-facing process."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_server_software_cve_rce_dos[_unpatched_server_software_cve_rce_dos_def] if {
    not input.software_version_patched
}

unpatched_server_software_cve_rce_dos[_unpatched_server_software_cve_rce_dos_def] if {
    input.days_since_last_security_patch > 30
}

unpatched_server_software_cve_rce_dos[_unpatched_server_software_cve_rce_dos_def] if {
    input.experimental_http3_quic_enabled == true
}

unpatched_server_software_cve_rce_dos[_unpatched_server_software_cve_rce_dos_def] if {
    not input.server_version_tokens_disabled
}

exposures contains _unpatched_server_software_cve_rce_dos_def if {
    count(unpatched_server_software_cve_rce_dos) > 0
}

_web_shell_foothold_via_writable_webroot_excessive_privilege_def := {
    "name": "Web-shell foothold via writable webroot / excessive privilege",
    "description": "Workers running as root, a serving-user-writable webroot, or an enabled PUT/WebDAV method let an attacker drop and execute a server-side script for persistence and privilege amplification, turning any write primitive into code execution.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

web_shell_foothold_via_writable_webroot_excessive_privilege[_web_shell_foothold_via_writable_webroot_excessive_privilege_def] if {
    not input.worker_process_runs_unprivileged
}

web_shell_foothold_via_writable_webroot_excessive_privilege[_web_shell_foothold_via_writable_webroot_excessive_privilege_def] if {
    input.webroot_writable_by_server_user == true
}

web_shell_foothold_via_writable_webroot_excessive_privilege[_web_shell_foothold_via_writable_webroot_excessive_privilege_def] if {
    not input.http_method_allow_list_enforced
}

exposures contains _web_shell_foothold_via_writable_webroot_excessive_privilege_def if {
    count(web_shell_foothold_via_writable_webroot_excessive_privilege) > 0
}

_server_hardening_gaps_info_disclosure_def := {
    "name": "Server hardening gaps & info disclosure",
    "description": "Version/banner tokens (Server header, ServerSignature), directory autoindex/Options Indexes, dangerous methods (TRACE/PUT/DELETE), default/sample files, and exposed status/admin endpoints (server-status, stub_status) fingerprint the stack and leak the file tree and internal metrics for targeted attacks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1592.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1595.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

server_hardening_gaps_info_disclosure[_server_hardening_gaps_info_disclosure_def] if {
    not input.server_version_tokens_disabled
}

server_hardening_gaps_info_disclosure[_server_hardening_gaps_info_disclosure_def] if {
    not input.directory_autoindex_disabled
}

server_hardening_gaps_info_disclosure[_server_hardening_gaps_info_disclosure_def] if {
    not input.http_method_allow_list_enforced
}

server_hardening_gaps_info_disclosure[_server_hardening_gaps_info_disclosure_def] if {
    not input.sample_apps_and_default_content_removed
}

server_hardening_gaps_info_disclosure[_server_hardening_gaps_info_disclosure_def] if {
    not input.status_endpoints_access_restricted
}

exposures contains _server_hardening_gaps_info_disclosure_def if {
    count(server_hardening_gaps_info_disclosure) > 0
}

_sensitive_file_path_exposure_def := {
    "name": "Sensitive-file / path exposure",
    "description": "VCS metadata (.git/config), env files (.env), database/backup dumps, and editor swap/backup files under webroot \u2014 reachable directly or via path traversal \u2014 leak secrets, credentials, and source code, enabling deeper compromise.",
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
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1083",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

sensitive_file_path_exposure[_sensitive_file_path_exposure_def] if {
    not input.dotfiles_and_vcs_metadata_blocked
}

sensitive_file_path_exposure[_sensitive_file_path_exposure_def] if {
    not input.backup_and_swap_files_excluded_from_webroot
}

sensitive_file_path_exposure[_sensitive_file_path_exposure_def] if {
    not input.path_traversal_protection_enabled
}

exposures contains _sensitive_file_path_exposure_def if {
    count(sensitive_file_path_exposure) > 0
}

_missing_security_response_headers_def := {
    "name": "Missing security response headers",
    "description": "Absent browser-side defenses \u2014 X-Content-Type-Options nosniff, X-Frame-Options / CSP frame-ancestors, Referrer-Policy \u2014 leave clients exposed to MIME-sniffing, clickjacking, and referrer leakage, weakening defense-in-depth for served content.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 4.8,
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

missing_security_response_headers[_missing_security_response_headers_def] if {
    not input.x_content_type_options_nosniff_set
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not input.frame_ancestors_restricted
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not input.referrer_policy_set
}

exposures contains _missing_security_response_headers_def if {
    count(missing_security_response_headers) > 0
}

_request_handling_denial_of_service_def := {
    "name": "Request-handling denial of service",
    "description": "No body/header size limits, slack client/keepalive timeouts, and missing per-IP rate/connection limits let a Slowloris/slow-POST or volumetric L7 flood (including HTTP/2 Rapid Reset) exhaust worker and connection capacity, taking the endpoint offline.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

request_handling_denial_of_service[_request_handling_denial_of_service_def] if {
    not input.request_body_size_capped
}

request_handling_denial_of_service[_request_handling_denial_of_service_def] if {
    not input.slowloris_timeouts_configured
}

request_handling_denial_of_service[_request_handling_denial_of_service_def] if {
    not input.request_rate_limiting_enabled
}

exposures contains _request_handling_denial_of_service_def if {
    count(request_handling_denial_of_service) > 0
}

_http_request_smuggling_desync_def := {
    "name": "HTTP request smuggling / desync",
    "description": "Ambiguous Content-Length vs Transfer-Encoding framing (or HTTP/2 downgrade) between the server and an upstream lets requests be smuggled past front-end controls, enabling cache poisoning, auth bypass, and request hijacking. Scoped to the server's own framing hardening, not WAF rules.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.request_framing_normalized_front_back
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.ambiguous_length_headers_rejected
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.http2_downgrade_desync_mitigated
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    input.obsolete_transfer_encoding_tolerated == true
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    input.affected_by_published_smuggling_cve == true
}

exposures contains _http_request_smuggling_desync_def if {
    count(http_request_smuggling_desync) > 0
}

_inadequate_access_error_logging_def := {
    "name": "Inadequate access/error logging",
    "description": "Logging disabled or kept local-only with no central forwarding leaves exploitation (T1190) attempts and post-compromise activity undetected, and gives attackers room to clear local traces, crippling detection and forensics.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

inadequate_access_error_logging[_inadequate_access_error_logging_def] if {
    not input.access_logging_enabled
}

inadequate_access_error_logging[_inadequate_access_error_logging_def] if {
    not input.external_siem_forwarding_enabled
}

exposures contains _inadequate_access_error_logging_def if {
    count(inadequate_access_error_logging) > 0
}
