package _dt_built_in.exposures.log_data_collection

_plaintext_log_transport_def := {
    "name": "Plaintext Log Transport",
    "description": "Log data transmitted over unencrypted channels (e.g., plain TCP syslog, UDP syslog, HTTP) exposes sensitive operational data, stack traces, tokens, and internal IP topology to passive network interception.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Plaintext log transport allows attackers to capture log data in transit via network sniffing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Unencrypted log transport mirrors the risk of data exfiltration over unencrypted protocols."
        }
    ]
}

plaintext_log_transport[_plaintext_log_transport_def] if {
    input.log_transport_protocol in ["udp_syslog", "tcp_syslog_plain", "http"]
}

plaintext_log_transport[_plaintext_log_transport_def] if {
    not input.tls_enabled
}

exposures contains _plaintext_log_transport_def if {
    count(plaintext_log_transport) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "One-way TLS or no TLS means either endpoint cannot cryptographically verify the other's identity. An attacker can impersonate the monitoring service to collect logs or inject a rogue log source to poison the aggregation pipeline.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Without mutual TLS authentication, attackers can intercept and manipulate communications via adversary-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Absence of mutual TLS allows attackers to impersonate legitimate services or clients without certificate verification."
        }
    ]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_mode == "disabled"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_mode == "server_only"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_mode == "mutual"
    not input.client_certificate_validation_enforced
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_mode == "mutual"
    not input.ca_certificate_pinned_or_validated
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_weak_or_deprecated_tls_cipher_suites_def := {
    "name": "Weak Or Deprecated Tls Cipher Suites",
    "description": "Use of TLS 1.0/1.1, RC4, NULL ciphers, export-grade ciphers, or anonymous Diffie-Hellman on the log transport channel enables downgrade attacks and offline decryption of captured log traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Weak or deprecated cipher suites directly weaken the encryption protecting communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Deprecated cipher suites often use reduced key spaces making them vulnerable to cryptanalytic attacks."
        }
    ]
}

weak_or_deprecated_tls_cipher_suites[_weak_or_deprecated_tls_cipher_suites_def] if {
    input.minimum_tls_version in ["TLS1.0", "TLS1.1"]
}

weak_or_deprecated_tls_cipher_suites[_weak_or_deprecated_tls_cipher_suites_def] if {
    regex.match("(?i)(RC4|NULL|EXPORT|aNULL|ADH|EXP-)", input.enabled_cipher_suites)
}

weak_or_deprecated_tls_cipher_suites[_weak_or_deprecated_tls_cipher_suites_def] if {
    not input.weak_cipher_explicitly_disabled
}

exposures contains _weak_or_deprecated_tls_cipher_suites_def if {
    count(weak_or_deprecated_tls_cipher_suites) > 0
}

_log_message_integrity_absence_def := {
    "name": "Log Message Integrity Absence",
    "description": "Log records transmitted without per-message MACs, HMACs, or signed envelopes can be silently modified in transit \u2014 field values altered, severity levels downgraded, or entries deleted \u2014 without detection by the receiver.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "name": "Transmitted Data Manipulation",
            "relevance": "Without integrity controls, log messages in transit can be tampered with or manipulated by attackers."
        }
    ]
}

log_message_integrity_absence[_log_message_integrity_absence_def] if {
    input.per_message_integrity_mechanism == "none"
    not input.log_receiver_integrity_verification_enabled
}

log_message_integrity_absence[_log_message_integrity_absence_def] if {
    not input.per_message_integrity_mechanism in ["none"]
    not input.log_receiver_integrity_verification_enabled
    not input.log_transport_tls_enabled
}

exposures contains _log_message_integrity_absence_def if {
    count(log_message_integrity_absence) > 0
}

_replay_attack_on_log_stream_def := {
    "name": "Replay Attack On Log Stream",
    "description": "Absence of sequence numbers, timestamps validated server-side, or nonce-based anti-replay mechanisms allows an attacker who captures a log stream segment to retransmit it, causing duplicate alerting, masking real events, or triggering false incident response.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.011",
            "name": "Spoof Security Alerting",
            "relevance": "Replaying old log messages can be used to spoof security alerts or mask current malicious activity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Replay attacks on log streams can flood or confuse monitoring systems, effectively blocking legitimate indicators."
        }
    ]
}

replay_attack_on_log_stream[_replay_attack_on_log_stream_def] if {
    not input.anti_replay_mechanism_enabled
}

replay_attack_on_log_stream[_replay_attack_on_log_stream_def] if {
    input.log_transport_protocol == "udp"
    input.server_side_timestamp_validation_window_seconds == 0
}

replay_attack_on_log_stream[_replay_attack_on_log_stream_def] if {
    input.log_transport_protocol in ["tcp", "tls", "https", "other"]
    not input.anti_replay_mechanism_enabled
    input.server_side_timestamp_validation_window_seconds == 0
}

exposures contains _replay_attack_on_log_stream_def if {
    count(replay_attack_on_log_stream) > 0
}

_log_injection_via_malformed_messages_def := {
    "name": "Log Injection Via Malformed Messages",
    "description": "No transport-layer framing validation or schema enforcement allows a compromised service or MITM to inject crafted log records containing newline characters, format-string sequences, or structured-data overrides that corrupt parsing at the monitoring service.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Malformed log messages can be crafted to impersonate legitimate protocol traffic and inject false log entries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Log injection via malformed messages can be facilitated through adversary-in-the-middle positioning to alter log data."
        }
    ]
}

log_injection_via_malformed_messages[_log_injection_via_malformed_messages_def] if {
    not input.log_message_sanitization_enforced
}

log_injection_via_malformed_messages[_log_injection_via_malformed_messages_def] if {
    not input.log_schema_validation_enforced
}

exposures contains _log_injection_via_malformed_messages_def if {
    count(log_injection_via_malformed_messages) > 0
}

_insecure_protocol_selection_udp_syslog_def := {
    "name": "Insecure Protocol Selection Udp Syslog",
    "description": "UDP-based syslog (RFC 3164) provides no delivery guarantee, no connection state, and no encryption. Logs can be dropped silently, spoofed with forged source IPs, or flooded by any host on the same broadcast domain.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "UDP syslog is an unencrypted protocol that can be abused for data exfiltration or interception."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.002",
            "name": "File Transfer Protocols",
            "relevance": "Insecure protocol selection like UDP syslog exposes log data similar to risks from unencrypted application layer protocols."
        }
    ]
}

insecure_protocol_selection_udp_syslog[_insecure_protocol_selection_udp_syslog_def] if {
    input.syslog_transport_protocol == "udp"
    not input.tls_enabled
}

insecure_protocol_selection_udp_syslog[_insecure_protocol_selection_udp_syslog_def] if {
    input.syslog_transport_protocol == "udp"
}

exposures contains _insecure_protocol_selection_udp_syslog_def if {
    count(insecure_protocol_selection_udp_syslog) > 0
}

_absent_rate_limiting_and_bandwidth_controls_def := {
    "name": "Absent Rate Limiting And Bandwidth Controls",
    "description": "No per-source rate limiting or backpressure on the log transport path allows a single misconfigured or compromised service to flood the channel, causing log loss for all other services and creating blind spots in monitoring coverage.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Without rate limiting, log endpoints are vulnerable to flooding attacks that exhaust service resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020.001",
            "name": "Traffic Duplication",
            "relevance": "Absence of bandwidth controls can enable attackers to duplicate and flood log traffic overwhelming the logging infrastructure."
        }
    ]
}

absent_rate_limiting_and_bandwidth_controls[_absent_rate_limiting_and_bandwidth_controls_def] if {
    not input.per_source_rate_limiting_enabled
}

absent_rate_limiting_and_bandwidth_controls[_absent_rate_limiting_and_bandwidth_controls_def] if {
    not input.backpressure_mechanism_configured
    input.log_channel_overflow_policy in ["drop_oldest", "drop_newest", "not_configured"]
}

exposures contains _absent_rate_limiting_and_bandwidth_controls_def if {
    count(absent_rate_limiting_and_bandwidth_controls) > 0
}

_internal_routing_path_exposure_def := {
    "name": "Internal Routing Path Exposure",
    "description": "Log traffic routed across untrusted internal VLANs, shared transit segments, or through network devices without network segmentation controls expands the interception surface beyond the intended producer-to-collector path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Exposed internal routing paths can enable attackers to bridge network boundaries and access internal segments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "name": "Network Address Translation Traversal",
            "relevance": "Internal routing path exposure can facilitate NAT traversal attacks to reach otherwise inaccessible network segments."
        }
    ]
}

internal_routing_path_exposure[_internal_routing_path_exposure_def] if {
    not input.log_transport_tls_enabled
}

internal_routing_path_exposure[_internal_routing_path_exposure_def] if {
    input.log_network_path_type in ["untrusted_vlan", "shared_internal", "public_transit"]
    not input.network_segmentation_controls_present
}

exposures contains _internal_routing_path_exposure_def if {
    count(internal_routing_path_exposure) > 0
}

_certificate_validation_bypass_in_log_agent_def := {
    "name": "Certificate Validation Bypass In Log Agent",
    "description": "Log shipping agents configured to skip hostname verification or accept self-signed certificates without pinning are vulnerable to TLS interception via rogue certificates, nullifying transport encryption protections.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Bypassing certificate validation allows attackers to use forged or self-signed certificates to impersonate log collectors."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Certificate validation bypass in log agents enables attackers to use stolen or forged certificates without detection."
        }
    ]
}

certificate_validation_bypass_in_log_agent[_certificate_validation_bypass_in_log_agent_def] if {
    not input.hostname_verification_enabled
}

certificate_validation_bypass_in_log_agent[_certificate_validation_bypass_in_log_agent_def] if {
    input.tls_verification_mode in ["none", "skip"]
}

certificate_validation_bypass_in_log_agent[_certificate_validation_bypass_in_log_agent_def] if {
    input.tls_verification_mode == "certificate"
    not input.certificate_authority_pinning_configured
}

exposures contains _certificate_validation_bypass_in_log_agent_def if {
    count(certificate_validation_bypass_in_log_agent) > 0
}

_log_stream_eavesdropping_via_span_or_tap_def := {
    "name": "Log Stream Eavesdropping Via Span Or Tap",
    "description": "Physical or virtual port mirroring (SPAN) on the transit switch segment can silently copy log traffic to an attacker-controlled destination without disrupting the flow, enabling long-term passive collection of log contents.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "SPAN ports and network taps are classic mechanisms for network sniffing to eavesdrop on log stream traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020.001",
            "name": "Traffic Duplication",
            "relevance": "SPAN and TAP configurations duplicate network traffic, directly enabling eavesdropping on log streams."
        }
    ]
}

log_stream_eavesdropping_via_span_or_tap[_log_stream_eavesdropping_via_span_or_tap_def] if {
    not input.log_transport_tls_enabled
    input.log_network_path_type == "shared"
}

log_stream_eavesdropping_via_span_or_tap[_log_stream_eavesdropping_via_span_or_tap_def] if {
    not input.log_transport_tls_enabled
    not input.switch_port_mirror_audit_enabled
}

exposures contains _log_stream_eavesdropping_via_span_or_tap_def if {
    count(log_stream_eavesdropping_via_span_or_tap) > 0
}
