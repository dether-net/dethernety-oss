package _dt_built_in.exposures.reverse_proxy_waf_appliance



_weak_tls_termination_def := {
    "name": "Weak TLS termination",
    "description": "The proxy terminates client TLS with legacy versions (ssl_protocols including SSLv3/TLSv1/TLSv1.1) or weak ciphers (ssl_ciphers permitting RC4/3DES/EXPORT/aNULL), lacks ssl_prefer_server_ciphers on, omits the HSTS header (add_header Strict-Transport-Security ... always), serves an invalid/expired certificate, or disables OCSP stapling (ssl_stapling off). This enables protocol/cipher downgrade, BEAST/POODLE-class attacks, SSL-strip, and skipped revocation checks against every client the appliance fronts.",
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
    "attack_vector": "NETWORK"
}

weak_tls_termination[_weak_tls_termination_def] if {
    input.min_tls_version in ["SSLv3", "TLSv1.0", "TLSv1.1"]
}

weak_tls_termination[_weak_tls_termination_def] if {
    input.weak_tls_versions_enabled == true
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

_waf_disabled_detection_only_fail_open_def := {
    "name": "WAF disabled / detection-only / fail-open",
    "description": "ModSecurity left at SecRuleEngine DetectionOnly or Off, SecRequestBodyAccess Off (POST/JSON/multipart payloads skip inspection), CRS not deployed, or anomaly scoring neutered (tx.blocking_paranoia_level unset / tx.inbound_anomaly_score_threshold raised so high nothing ever reaches the block threshold). The appliance logs attacks but never denies them, leaving fronted applications fully exposed to injection/XSS the WAF is meant to stop.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A non-blocking, detection-only, or fail-open WAF leaves the fronted public-facing application exposed to injection/XSS exploitation of public-facing application weaknesses that the appliance is meant to stop."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

waf_disabled_detection_only_fail_open[_waf_disabled_detection_only_fail_open_def] if {
    not input.waf_blocking_mode_enabled
}

waf_disabled_detection_only_fail_open[_waf_disabled_detection_only_fail_open_def] if {
    not input.waf_request_body_inspection_enabled
}

waf_disabled_detection_only_fail_open[_waf_disabled_detection_only_fail_open_def] if {
    not input.waf_anomaly_threshold_effective
}

waf_disabled_detection_only_fail_open[_waf_disabled_detection_only_fail_open_def] if {
    not input.waf_fails_closed_on_error
}

exposures contains _waf_disabled_detection_only_fail_open_def if {
    count(waf_disabled_detection_only_fail_open) > 0
}

_http_request_smuggling_desync_def := {
    "name": "HTTP request smuggling / desync",
    "description": "Inconsistent parsing of ambiguous Content-Length vs Transfer-Encoding between the proxy and backend, HTTP/2-to-HTTP/1.1 downgrade desync, or error_page-redirect mishandling (nginx CVE-2019-20372) lets an attacker smuggle a hidden request, poison the shared connection, and bypass the WAF entirely to reach the upstream.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "HTTP request smuggling / desync exploits inconsistent parsing in the internet-facing proxy/WAF to bypass it and reach the backend \u2014 exploitation of a public-facing application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "The smuggled request is carried in the standard HTTP/HTTP/2 web-protocol channel the proxy fronts, abusing application-layer web protocols to slip a hidden request past the WAF."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.ambiguous_length_headers_rejected
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.http_parsing_strict_consistent
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    not input.http2_downgrade_desync_mitigated
}

http_request_smuggling_desync[_http_request_smuggling_desync_def] if {
    input.affected_by_published_smuggling_cve == true
}

exposures contains _http_request_smuggling_desync_def if {
    count(http_request_smuggling_desync) > 0
}

_unverified_upstream_trust_ssrf_def := {
    "name": "Unverified upstream trust & SSRF",
    "description": "proxy_ssl_verify off (the default) leaves the proxy-to-backend leg unauthenticated and MITM-able, and proxy_ssl_protocols permitting legacy TLS downgrades that leg; permissive proxy_pass / open forwarding can be abused to reach internal services (SSRF), and backends directly reachable on the network bypass the appliance altogether \u2014 undermining the end-to-end transport trust the proxy is supposed to enforce.",
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
            "value": "T1090",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unverified_upstream_trust_ssrf[_unverified_upstream_trust_ssrf_def] if {
    not input.upstream_tls_verification_enabled
}

unverified_upstream_trust_ssrf[_unverified_upstream_trust_ssrf_def] if {
    not input.backend_only_reachable_via_proxy
}

unverified_upstream_trust_ssrf[_unverified_upstream_trust_ssrf_def] if {
    not input.ssrf_protection_on_proxied_requests
}

exposures contains _unverified_upstream_trust_ssrf_def if {
    count(unverified_upstream_trust_ssrf) > 0
}

_forwarded_header_spoofing_host_attacks_def := {
    "name": "Forwarded-header spoofing / Host attacks",
    "description": "Passing attacker-controlled X-Forwarded-For / X-Forwarded-Proto / X-Real-IP / Host through unchanged (instead of authoritatively setting them via proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for and Host $host) lets the backend trust spoofed client IPs and origins \u2014 enabling IP-allowlist bypass, cache poisoning, and authentication confusion. merge_slashes off additionally enables path-confusion WAF-bypass against the upstream.",
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
                "justification": "Spoofed X-Forwarded-* / Host headers passed unchanged to the backend exploit the public-facing proxy to bypass IP allowlists and inject crafted Host values (cache poisoning, auth-confusion routing) against the fronted application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "Abuse of trusted HTTP application-layer headers (forwarded-for / Host) to forge client origin and identity over the otherwise-legitimate proxied web protocol."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

forwarded_header_spoofing_host_attacks[_forwarded_header_spoofing_host_attacks_def] if {
    not input.forwarded_headers_sanitized
}

forwarded_header_spoofing_host_attacks[_forwarded_header_spoofing_host_attacks_def] if {
    not input.host_header_validated
}

forwarded_header_spoofing_host_attacks[_forwarded_header_spoofing_host_attacks_def] if {
    not input.trusted_proxy_chain_configured
}

exposures contains _forwarded_header_spoofing_host_attacks_def if {
    count(forwarded_header_spoofing_host_attacks) > 0
}

_information_leakage_missing_response_hardening_def := {
    "name": "Information leakage & missing response hardening",
    "description": "server_tokens on (default) leaks the nginx version in the Server header and error pages, missing security response headers, verbose error_page output, and directory autoindex expose version and internal detail that aids version-specific exploitation and bypass targeting of the appliance.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Leaked version/stack identity and missing response hardening on the public-facing proxy directly aid targeting and exploitation of the internet-facing application surface (Exploit Public-Facing Application)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

information_leakage_missing_response_hardening[_information_leakage_missing_response_hardening_def] if {
    not input.server_version_tokens_disabled
}

information_leakage_missing_response_hardening[_information_leakage_missing_response_hardening_def] if {
    not input.security_response_headers_enforced
}

information_leakage_missing_response_hardening[_information_leakage_missing_response_hardening_def] if {
    not input.error_responses_sanitized
}

information_leakage_missing_response_hardening[_information_leakage_missing_response_hardening_def] if {
    not input.backend_identifying_headers_stripped
}

exposures contains _information_leakage_missing_response_hardening_def if {
    count(information_leakage_missing_response_hardening) > 0
}

_l7_rate_limit_dos_gaps_def := {
    "name": "L7 rate-limit & DoS gaps",
    "description": "No limit_req_zone / limit_req rate zones, loose client_body_timeout / client_header_timeout / keepalive_timeout, and unbounded client_max_body_size / large_client_header_buffers let an attacker exhaust connections or flood the appliance (slowloris, slow-POST, request floods), taking down every backend behind it.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
            "value": "T1499",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

l7_rate_limit_dos_gaps[_l7_rate_limit_dos_gaps_def] if {
    not input.request_rate_limiting_enabled
}

l7_rate_limit_dos_gaps[_l7_rate_limit_dos_gaps_def] if {
    not input.connection_limits_enforced
}

l7_rate_limit_dos_gaps[_l7_rate_limit_dos_gaps_def] if {
    not input.slowloris_timeouts_configured
}

l7_rate_limit_dos_gaps[_l7_rate_limit_dos_gaps_def] if {
    not input.request_size_limits_enforced
}

l7_rate_limit_dos_gaps[_l7_rate_limit_dos_gaps_def] if {
    not input.ddos_protection_in_place
}

exposures contains _l7_rate_limit_dos_gaps_def if {
    count(l7_rate_limit_dos_gaps) > 0
}

_exposed_admin_status_surface_excess_privilege_def := {
    "name": "Exposed admin/status surface & excess privilege",
    "description": "Unauthenticated stub_status / admin / metrics endpoints reachable from untrusted networks, world-writable or unprotected config, or worker processes running as root (user not set to an unprivileged account like nginx/www-data) expose the appliance's own control surface and amplify the blast radius of any compromise.",
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
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.status_endpoints_access_restricted
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.control_plane_api_not_publicly_exposed
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.worker_process_runs_unprivileged
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.least_privilege_access_enforced
}

exposed_admin_status_surface_excess_privilege[_exposed_admin_status_surface_excess_privilege_def] if {
    not input.config_file_permissions_restricted
}

exposures contains _exposed_admin_status_surface_excess_privilege_def if {
    count(exposed_admin_status_surface_excess_privilege) > 0
}

_logging_gaps_blinded_detection_def := {
    "name": "Logging gaps & blinded detection",
    "description": "access_log off (or no SIEM forwarding) on proxied requests and SecAuditEngine Off / SecAuditLog unset mean blocked-attack and access events are never recorded or alerted, blinding detection and incident response for the most attack-exposed appliance in the path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Disabled nginx access logging and ModSecurity SecAuditEngine Off, with no off-host shipping or alerting, impair the appliance's own defensive visibility (Impair Defenses) so attacks against protected apps go unseen."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Without access/audit logging and SIEM alerting at the proxy, web-service exfiltration of data through the fronted apps passes the appliance unrecorded and undetected."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

logging_gaps_blinded_detection[_logging_gaps_blinded_detection_def] if {
    not input.access_logging_enabled
}

logging_gaps_blinded_detection[_logging_gaps_blinded_detection_def] if {
    not input.waf_audit_logging_enabled
}

logging_gaps_blinded_detection[_logging_gaps_blinded_detection_def] if {
    not input.logs_stored_on_separate_system
}

logging_gaps_blinded_detection[_logging_gaps_blinded_detection_def] if {
    not input.blocked_request_alerting_enabled
}

exposures contains _logging_gaps_blinded_detection_def if {
    count(logging_gaps_blinded_detection) > 0
}

_unpatched_eol_proxy_or_waf_engine_def := {
    "name": "Unpatched / EoL proxy or WAF engine",
    "description": "Running an nginx or ModSecurity v3 build affected by a published nginx security advisory (e.g. CVE-2019-20372) or past end-of-life leaves known, often CISA-KEV-listed, exploit paths open on the internet-facing appliance. The running build must be at or above all relevant advisory fix versions.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An EoL or unpatched nginx/libModSecurity build affected by a published advisory (e.g. CVE-2019-20372, often CISA-KEV-listed) gives an attacker a known exploit path against the public-facing proxy/WAF appliance."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_eol_proxy_or_waf_engine[_unpatched_eol_proxy_or_waf_engine_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_eol_proxy_or_waf_engine[_unpatched_eol_proxy_or_waf_engine_def] if {
    not input.proxy_engine_supported_version
}

unpatched_eol_proxy_or_waf_engine[_unpatched_eol_proxy_or_waf_engine_def] if {
    not input.crs_ruleset_updated
    not input.edge_appliance_patched_within_sla
}

exposures contains _unpatched_eol_proxy_or_waf_engine_def if {
    count(unpatched_eol_proxy_or_waf_engine) > 0
}
