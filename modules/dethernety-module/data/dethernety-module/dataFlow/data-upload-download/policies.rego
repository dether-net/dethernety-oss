package _dt_built_in.exposures.data_upload_download

_tls_version_downgrade_attack_def := {
    "name": "Tls Version Downgrade Attack",
    "description": "Adversaries exploit protocol negotiation weaknesses to force connections to use deprecated TLS versions (1.0, 1.1) or SSL, exposing data to known cryptographic attacks such as POODLE, BEAST, and DROWN. Absence of enforced minimum TLS version policies enables this vector.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    input.minimum_tls_version in ["ssl_3_0", "tls_1_0", "tls_1_1"]
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    input.minimum_tls_version == "not_configured"
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    not input.tls_version_policy_enforced
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    "ssl_3_0" in input.accepted_tls_versions
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    "tls_1_0" in input.accepted_tls_versions
}

tls_version_downgrade_attack[_tls_version_downgrade_attack_def] if {
    "tls_1_1" in input.accepted_tls_versions
}

exposures contains _tls_version_downgrade_attack_def if {
    count(tls_version_downgrade_attack) > 0
}

_absent_or_improper_certificate_validation_def := {
    "name": "Absent Or Improper Certificate Validation",
    "description": "Client-side failure to properly validate server certificates \u2014 including chain verification, hostname matching, and revocation checking \u2014 allows adversaries to present fraudulent certificates and intercept encrypted traffic undetected. Observable via traffic analysis showing connection to mismatched or self-signed certificates.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

absent_or_improper_certificate_validation[_absent_or_improper_certificate_validation_def] if {
    not input.certificate_chain_validation_enabled
}

absent_or_improper_certificate_validation[_absent_or_improper_certificate_validation_def] if {
    not input.hostname_verification_enabled
}

absent_or_improper_certificate_validation[_absent_or_improper_certificate_validation_def] if {
    input.certificate_revocation_check_method == "none"
}

absent_or_improper_certificate_validation[_absent_or_improper_certificate_validation_def] if {
    input.allows_self_signed_certificates == true
}

exposures contains _absent_or_improper_certificate_validation_def if {
    count(absent_or_improper_certificate_validation) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "One-way TLS authentication (server-only) leaves the server unable to cryptographically verify client identity at the transport layer. This allows unauthorized or spoofed clients to initiate sessions and potentially access or inject data into cloud storage flows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.mtls_enabled
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_validation_mode == "none"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_validation_mode == "optional"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_enabled == true
    not input.trusted_client_ca_configured
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_weak_or_deprecated_cipher_suite_negotiation_def := {
    "name": "Weak Or Deprecated Cipher Suite Negotiation",
    "description": "Support for weak cipher suites (e.g., RC4, NULL, export-grade ciphers, DHE with small key sizes) during TLS negotiation allows adversaries capturing traffic to decrypt data offline or in real time. Verifiable by scanning negotiated cipher suites during handshake.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    input.weak_cipher_suite_accepted == true
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    "RC4" in input.negotiated_cipher_suites
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    "NULL" in input.negotiated_cipher_suites
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    "EXPORT" in input.negotiated_cipher_suites
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    "anon" in input.negotiated_cipher_suites
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    "DES" in input.negotiated_cipher_suites
}

weak_or_deprecated_cipher_suite_negotiation[_weak_or_deprecated_cipher_suite_negotiation_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

exposures contains _weak_or_deprecated_cipher_suite_negotiation_def if {
    count(weak_or_deprecated_cipher_suite_negotiation) > 0
}

_missing_http_strict_transport_security_def := {
    "name": "Missing Http Strict Transport Security",
    "description": "Absence of HSTS headers or preloading allows initial plaintext HTTP requests before redirect to HTTPS, creating a window for SSL stripping attacks. Traffic analysis can confirm whether the first request is sent in cleartext before secure channel establishment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

missing_http_strict_transport_security[_missing_http_strict_transport_security_def] if {
    not input.hsts_header_present
}

missing_http_strict_transport_security[_missing_http_strict_transport_security_def] if {
    input.hsts_header_present == true
    input.hsts_max_age_seconds < 31536000
}

exposures contains _missing_http_strict_transport_security_def if {
    count(missing_http_strict_transport_security) > 0
}

_tls_session_replay_and_ticket_reuse_def := {
    "name": "Tls Session Replay And Ticket Reuse",
    "description": "TLS session resumption mechanisms (session tickets, session IDs) without proper expiry or rotation allow adversaries who compromise session ticket keys to decrypt past and future sessions, or replay captured resumption tokens to hijack storage access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

tls_session_replay_and_ticket_reuse[_tls_session_replay_and_ticket_reuse_def] if {
    input.session_resumption_mechanism in ["session_ticket", "both"]
    not input.session_ticket_rotation_enabled
}

tls_session_replay_and_ticket_reuse[_tls_session_replay_and_ticket_reuse_def] if {
    input.session_resumption_mechanism in ["session_ticket", "session_id", "both"]
    input.session_resumption_max_lifetime_seconds > 86400
}

tls_session_replay_and_ticket_reuse[_tls_session_replay_and_ticket_reuse_def] if {
    input.session_resumption_mechanism in ["session_ticket", "both"]
    input.shared_ticket_key_across_instances == true
}

exposures contains _tls_session_replay_and_ticket_reuse_def if {
    count(tls_session_replay_and_ticket_reuse) > 0
}

_absence_of_perfect_forward_secrecy_def := {
    "name": "Absence Of Perfect Forward Secrecy",
    "description": "TLS configurations that do not enforce ephemeral key exchange (ECDHE, DHE) allow adversaries who later obtain the server's private key to retroactively decrypt all previously captured traffic. Verifiable by inspecting whether non-PFS cipher suites are permitted.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

absence_of_perfect_forward_secrecy[_absence_of_perfect_forward_secrecy_def] if {
    not input.pfs_enforcement_enabled
}

absence_of_perfect_forward_secrecy[_absence_of_perfect_forward_secrecy_def] if {
    regex.match("(?i)TLS_RSA_WITH|^RSA_|_WITH_RSA_|AES.*SHA(?:$|\\b)(?!.*ECDHE)(?!.*DHE)", input.negotiated_cipher_suites)
}

exposures contains _absence_of_perfect_forward_secrecy_def if {
    count(absence_of_perfect_forward_secrecy) > 0
}

_insufficient_message_integrity_beyond_tls_def := {
    "name": "Insufficient Message Integrity Beyond Tls",
    "description": "Reliance solely on TLS-layer integrity means that once the TLS session terminates at a proxy or CDN node, data integrity is only re-established on the next hop. Without application-layer signatures or checksums, data can be silently tampered between TLS termination points.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

insufficient_message_integrity_beyond_tls[_insufficient_message_integrity_beyond_tls_def] if {
    not input.application_layer_integrity_enabled
    count(input.tls_termination_points) > 0
}

insufficient_message_integrity_beyond_tls[_insufficient_message_integrity_beyond_tls_def] if {
    not input.application_layer_integrity_enabled
    not input.payload_checksum_validation_enforced
}

exposures contains _insufficient_message_integrity_beyond_tls_def if {
    count(insufficient_message_integrity_beyond_tls) > 0
}

_bgp_route_hijacking_exposure_def := {
    "name": "Bgp Route Hijacking Exposure",
    "description": "Absence of BGP route origin validation (RPKI) or path monitoring leaves cloud storage traffic susceptible to prefix hijacking, redirecting data flows through adversary-controlled infrastructure. Traffic analysis showing unexpected autonomous system paths indicates this exposure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.rpki_route_origin_validation_enabled
    not input.bgp_path_monitoring_enabled
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.rpki_route_origin_validation_enabled
    input.unexpected_asn_hops_detected == true
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    input.unexpected_asn_hops_detected == true
    input.bgp_path_monitoring_enabled == true
}

exposures contains _bgp_route_hijacking_exposure_def if {
    count(bgp_route_hijacking_exposure) > 0
}

_dns_hijacking_and_spoofing_of_storage_endpoints_def := {
    "name": "Dns Hijacking And Spoofing Of Storage Endpoints",
    "description": "Without DNSSEC validation or DNS-over-HTTPS/TLS, adversaries can poison DNS responses to redirect client connections to fraudulent cloud storage endpoints, enabling credential harvesting or data interception before any TLS handshake with the legitimate server.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

dns_hijacking_and_spoofing_of_storage_endpoints[_dns_hijacking_and_spoofing_of_storage_endpoints_def] if {
    not input.dnssec_validation_enabled
    input.encrypted_dns_protocol == "none"
}

dns_hijacking_and_spoofing_of_storage_endpoints[_dns_hijacking_and_spoofing_of_storage_endpoints_def] if {
    not input.dnssec_validation_enabled
    not input.encrypted_dns_protocol in ["doh", "dot", "dnscrypt"]
    not input.certificate_pinning_enabled
}

exposures contains _dns_hijacking_and_spoofing_of_storage_endpoints_def if {
    count(dns_hijacking_and_spoofing_of_storage_endpoints) > 0
}

_absence_of_api_rate_limiting_on_data_transfer_channel_def := {
    "name": "Absence Of Api Rate Limiting On Data Transfer Channel",
    "description": "Data flow channels lacking bandwidth throttling or per-client rate limiting are vulnerable to bulk data exfiltration in a single session and to abuse by compromised credentials performing high-volume transfers. Observable by monitoring for anomalous transfer volumes in traffic metadata.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

absence_of_api_rate_limiting_on_data_transfer_channel[_absence_of_api_rate_limiting_on_data_transfer_channel_def] if {
    not input.api_rate_limiting_enabled
}

absence_of_api_rate_limiting_on_data_transfer_channel[_absence_of_api_rate_limiting_on_data_transfer_channel_def] if {
    input.max_transfer_rate_bytes_per_second == 0
}

exposures contains _absence_of_api_rate_limiting_on_data_transfer_channel_def if {
    count(absence_of_api_rate_limiting_on_data_transfer_channel) > 0
}

_cleartext_metadata_leakage_in_tls_sni_def := {
    "name": "Cleartext Metadata Leakage In Tls Sni",
    "description": "TLS Server Name Indication transmitted in cleartext during handshake exposes the target cloud storage domain to passive observers, enabling traffic classification and targeted attack staging even when payload is encrypted. Absence of Encrypted Client Hello (ECH) confirms this exposure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

cleartext_metadata_leakage_in_tls_sni[_cleartext_metadata_leakage_in_tls_sni_def] if {
    not input.encrypted_client_hello_enabled
}

cleartext_metadata_leakage_in_tls_sni[_cleartext_metadata_leakage_in_tls_sni_def] if {
    input.minimum_tls_version in ["TLS_1_0", "TLS_1_1", "TLS_1_2"]
}

exposures contains _cleartext_metadata_leakage_in_tls_sni_def if {
    count(cleartext_metadata_leakage_in_tls_sni) > 0
}
