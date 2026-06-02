package _dt_built_in.exposures.load_balancer



_weak_legacy_tls_termination_on_the_client_edge_def := {
    "name": "Weak / legacy TLS termination on the client edge",
    "description": "The LB's client-facing listener still negotiates TLS 1.0/1.1/SSLv3 or weak ciphers (RC4/3DES/CBC, no forward secrecy), or omits HSTS \u2014 letting an active attacker downgrade and decrypt client traffic (POODLE/BEAST/FREAK/LOGJAM) or SSL-strip the connection.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_legacy_tls_termination_on_the_client_edge[_weak_legacy_tls_termination_on_the_client_edge_def] if {
    input.weak_tls_versions_enabled == true
}

weak_legacy_tls_termination_on_the_client_edge[_weak_legacy_tls_termination_on_the_client_edge_def] if {
    input.min_tls_version in ["SSLv3", "TLSv1.0", "TLSv1.1"]
}

weak_legacy_tls_termination_on_the_client_edge[_weak_legacy_tls_termination_on_the_client_edge_def] if {
    input.weak_ciphers_allowed == true
}

weak_legacy_tls_termination_on_the_client_edge[_weak_legacy_tls_termination_on_the_client_edge_def] if {
    not input.hsts_enforced
}

exposures contains _weak_legacy_tls_termination_on_the_client_edge_def if {
    count(weak_legacy_tls_termination_on_the_client_edge) > 0
}

_plaintext_unverified_backend_re_encryption_leg_def := {
    "name": "Plaintext / unverified backend re-encryption leg",
    "description": "After terminating client TLS the LB forwards plaintext to origin, or re-encrypts without validating the backend certificate (nginx proxy_ssl_verify defaults off), leaving the internal hop sniffable/MITM-able and exposing credentials and PII.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Plaintext/unverified backend leg lets an adjacent adversary passively sniff credentials and PII off the internal hop."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Without backend certificate validation the LB accepts any upstream cert, enabling an adversary-in-the-middle on the post-termination connection."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "An unencrypted internal leg permits exfiltration of intercepted sensitive data over an unencrypted non-C2 protocol."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

plaintext_unverified_backend_re_encryption_leg[_plaintext_unverified_backend_re_encryption_leg_def] if {
    not input.back_end_traffic_reencrypted_after_tls_termination
}

plaintext_unverified_backend_re_encryption_leg[_plaintext_unverified_backend_re_encryption_leg_def] if {
    not input.server_certificate_validated
}

exposures contains _plaintext_unverified_backend_re_encryption_leg_def if {
    count(plaintext_unverified_backend_re_encryption_leg) > 0
}

_http_request_smuggling_desync_between_lb_and_backend_def := {
    "name": "HTTP request smuggling / desync between LB and backend",
    "description": "Front-end/back-end disagreement on Content-Length vs Transfer-Encoding (CL.TE/TE.CL/TE.TE, H2.CL/H2.TE downgrades) lets an attacker smuggle a request past edge auth, poison the cache, or hijack sessions. AWS strictest desync mode and drop_invalid_header_fields mitigate.",
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
                "justification": "Request smuggling/desync exploits the public-facing LB->backend HTTP parsing boundary to smuggle a request past edge authorization."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "Abuse of the HTTP/HTTP2 application-layer protocol (CL/TE framing, H2.CL/H2.TE downgrade) to desync front-end and back-end."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

http_request_smuggling_desync_between_lb_and_backend[_http_request_smuggling_desync_between_lb_and_backend_def] if {
    not input.request_framing_normalized_front_back
}

http_request_smuggling_desync_between_lb_and_backend[_http_request_smuggling_desync_between_lb_and_backend_def] if {
    not input.desync_mitigation_strict
}

http_request_smuggling_desync_between_lb_and_backend[_http_request_smuggling_desync_between_lb_and_backend_def] if {
    not input.drop_invalid_header_fields
}

exposures contains _http_request_smuggling_desync_between_lb_and_backend_def if {
    count(http_request_smuggling_desync_between_lb_and_backend) > 0
}

_ddos_connection_exhaustion_of_the_chokepoint_def := {
    "name": "DDoS / connection-exhaustion of the chokepoint",
    "description": "SYN flood, HTTP flood, and slowloris/slow-read held-open connections exhaust the LB's connection/queue capacity; HTTP/2 rapid-reset and stream-multiplexing abuse exhaust CPU/memory. Because the LB is the single point of contact, its saturation takes down all backends. Rate limits, request/idle timeouts, and a patched HTTP/2 stack mitigate.",
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
            "value": "T1499.002",
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

ddos_connection_exhaustion_of_the_chokepoint[_ddos_connection_exhaustion_of_the_chokepoint_def] if {
    not input.ddos_protection_in_place
}

ddos_connection_exhaustion_of_the_chokepoint[_ddos_connection_exhaustion_of_the_chokepoint_def] if {
    not input.rate_limiting_or_lockout_enabled
}

ddos_connection_exhaustion_of_the_chokepoint[_ddos_connection_exhaustion_of_the_chokepoint_def] if {
    not input.connection_idle_timeout_bounded
}

ddos_connection_exhaustion_of_the_chokepoint[_ddos_connection_exhaustion_of_the_chokepoint_def] if {
    not input.request_header_timeout_bounded
}

ddos_connection_exhaustion_of_the_chokepoint[_ddos_connection_exhaustion_of_the_chokepoint_def] if {
    not input.http2_rapid_reset_mitigated
}

exposures contains _ddos_connection_exhaustion_of_the_chokepoint_def if {
    count(ddos_connection_exhaustion_of_the_chokepoint) > 0
}

_x_forwarded_for_spoofing_client_ip_forgery_def := {
    "name": "X-Forwarded-For spoofing / client-IP forgery",
    "description": "If a backend trusts a client-supplied X-Forwarded-For instead of only the value the LB appends, an attacker forges their source IP to bypass IP allowlists, evade rate limits, and poison access logs \u2014 undermining downstream authorization and audit.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

x_forwarded_for_spoofing_client_ip_forgery[_x_forwarded_for_spoofing_client_ip_forgery_def] if {
    not input.xff_client_ip_correctly_handled
}

exposures contains _x_forwarded_for_spoofing_client_ip_forgery_def if {
    count(x_forwarded_for_spoofing_client_ip_forgery) > 0
}

_host_header_routing_confusion_misrouting_def := {
    "name": "Host-header routing confusion / misrouting",
    "description": "Ambiguous Host-header handling at the LB routes a request to an unintended backend or bypasses virtual-host access controls, enabling cache poisoning or cross-tenant/wrong-app access.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Ambiguous Host-header routing at the public-facing LB lets an attacker reach an unintended backend or bypass virtual-host access controls, exploiting the public-facing application's routing layer (Exploit Public-Facing Application)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

host_header_routing_confusion_misrouting[_host_header_routing_confusion_misrouting_def] if {
    not input.host_header_routing_strict
}

exposures contains _host_header_routing_confusion_misrouting_def if {
    count(host_header_routing_confusion_misrouting) > 0
}

_exposed_management_interface_data_plane_running_as_root_def := {
    "name": "Exposed management interface / data plane running as root",
    "description": "An LB admin/management plane (HAProxy stats socket, vendor GUI, cloud control API) reachable from untrusted networks allows config tampering, backend re-pointing, or LB deletion; workers running as root widen the blast radius of any data-plane compromise. Deletion-protection-off makes destroying the chokepoint a one-call availability attack.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
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
            "value": "T1578",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_management_interface_data_plane_running_as_root[_exposed_management_interface_data_plane_running_as_root_def] if {
    not input.control_plane_api_not_publicly_exposed
}

exposed_management_interface_data_plane_running_as_root[_exposed_management_interface_data_plane_running_as_root_def] if {
    not input.endpoint_runs_as_least_privileged_user
}

exposed_management_interface_data_plane_running_as_root[_exposed_management_interface_data_plane_running_as_root_def] if {
    not input.deletion_protection_enabled
}

exposures contains _exposed_management_interface_data_plane_running_as_root_def if {
    count(exposed_management_interface_data_plane_running_as_root) > 0
}

_silent_chokepoint_disabled_access_logging_waf_fail_open_def := {
    "name": "Silent chokepoint \u2014 disabled access logging / WAF fail-open",
    "description": "With access logs off or not shipped off-box, attacks transiting the single busiest traffic point leave no audit trail for detection or forensics; a WAF that fails open (or runs detection-only) silently removes filtering at the same edge.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

silent_chokepoint_disabled_access_logging_waf_fail_open[_silent_chokepoint_disabled_access_logging_waf_fail_open_def] if {
    not input.access_audit_trail_enabled
}

silent_chokepoint_disabled_access_logging_waf_fail_open[_silent_chokepoint_disabled_access_logging_waf_fail_open_def] if {
    not input.logs_stored_on_separate_system
}

silent_chokepoint_disabled_access_logging_waf_fail_open[_silent_chokepoint_disabled_access_logging_waf_fail_open_def] if {
    not input.waf_active_blocking_on_public_web
}

silent_chokepoint_disabled_access_logging_waf_fail_open[_silent_chokepoint_disabled_access_logging_waf_fail_open_def] if {
    input.waf_fails_open == true
}

exposures contains _silent_chokepoint_disabled_access_logging_waf_fail_open_def if {
    count(silent_chokepoint_disabled_access_logging_waf_fail_open) > 0
}

_unpatched_lb_software_firmware_cve_def := {
    "name": "Unpatched LB software / firmware CVE",
    "description": "Running an end-of-life or pre-fix nginx/HAProxy/appliance build exposes the chokepoint to memory-corruption and protocol CVEs (resolver, mp4 module, request-smuggling, HTTP/2 DoS); server_tokens leaking the version aids targeted exploitation.",
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
                "justification": "An unpatched/EOL nginx/HAProxy or appliance build on the internet-facing chokepoint is directly exploitable via Exploit Public-Facing Application; version-banner disclosure (server_tokens on) further enables targeted, version-specific CVE exploitation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_lb_software_firmware_cve[_unpatched_lb_software_firmware_cve_def] if {
    not input.edge_appliance_patched_within_sla
}

unpatched_lb_software_firmware_cve[_unpatched_lb_software_firmware_cve_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_lb_software_firmware_cve[_unpatched_lb_software_firmware_cve_def] if {
    input.version_banner_disclosed == true
}

exposures contains _unpatched_lb_software_firmware_cve_def if {
    count(unpatched_lb_software_firmware_cve) > 0
}
