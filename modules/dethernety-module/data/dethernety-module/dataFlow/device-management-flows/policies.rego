package _dt_built_in.exposures.device_management_flows

_unencrypted_or_weak_transport_encryption_def := {
    "name": "Unencrypted Or Weak Transport Encryption",
    "description": "Configuration update traffic transmitted without TLS or using deprecated TLS versions (1.0/1.1) or weak cipher suites (RC4, DES, export-grade), enabling passive interception and decryption of configuration payloads including credentials, policy rules, and sensitive parameters.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unencrypted_or_weak_transport_encryption[_unencrypted_or_weak_transport_encryption_def] if {
    not input.tls_enabled
}

unencrypted_or_weak_transport_encryption[_unencrypted_or_weak_transport_encryption_def] if {
    input.tls_enabled == true
    input.minimum_tls_version in ["TLSv1.0", "TLSv1.1"]
}

unencrypted_or_weak_transport_encryption[_unencrypted_or_weak_transport_encryption_def] if {
    input.tls_enabled == true
    "RC4" in input.enabled_cipher_suites
}

unencrypted_or_weak_transport_encryption[_unencrypted_or_weak_transport_encryption_def] if {
    input.tls_enabled == true
    "DES" in input.enabled_cipher_suites
}

unencrypted_or_weak_transport_encryption[_unencrypted_or_weak_transport_encryption_def] if {
    input.tls_enabled == true
    "NULL" in input.enabled_cipher_suites
}

exposures contains _unencrypted_or_weak_transport_encryption_def if {
    count(unencrypted_or_weak_transport_encryption) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "Management channel relies solely on server-side TLS certificate validation without requiring client certificate authentication from devices. An attacker can impersonate a legitimate device to receive configuration updates or inject fabricated device state, or impersonate the management server to push malicious configurations to devices that do not validate server identity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.client_certificate_authentication_required
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.device_server_certificate_validation_enforced
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_configuration_payload_replay_attack_def := {
    "name": "Configuration Payload Replay Attack",
    "description": "Absence of replay protection mechanisms (nonces, timestamps, sequence numbers, or session tokens) in configuration update messages allows a captured legitimate update packet to be retransmitted, forcing devices to revert to a known-vulnerable configuration state or re-apply a previously revoked policy.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

configuration_payload_replay_attack[_configuration_payload_replay_attack_def] if {
    input.replay_protection_mechanism == "none"
}

configuration_payload_replay_attack[_configuration_payload_replay_attack_def] if {
    not input.replay_protection_mechanism in ["none"]
    not input.replay_token_server_side_validation_enabled
}

configuration_payload_replay_attack[_configuration_payload_replay_attack_def] if {
    input.replay_protection_mechanism in ["timestamp", "multiple"]
    input.message_timestamp_window_seconds == 0
}

exposures contains _configuration_payload_replay_attack_def if {
    count(configuration_payload_replay_attack) > 0
}

_transit_message_integrity_bypass_def := {
    "name": "Transit Message Integrity Bypass",
    "description": "Configuration payloads lack cryptographic message authentication codes (HMAC, AEAD) or digital signatures independent of the transport layer. If TLS is terminated at an intermediary (load balancer, proxy) without re-signing payloads, an attacker controlling the internal segment can modify configuration values before delivery without detection by the receiving device.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

transit_message_integrity_bypass[_transit_message_integrity_bypass_def] if {
    input.payload_integrity_mechanism == "none"
    input.tls_terminated_at_intermediary == true
}

transit_message_integrity_bypass[_transit_message_integrity_bypass_def] if {
    not input.payload_integrity_mechanism in ["none"]
    not input.endpoint_validates_payload_integrity
    input.tls_terminated_at_intermediary == true
}

transit_message_integrity_bypass[_transit_message_integrity_bypass_def] if {
    input.payload_integrity_mechanism == "none"
    not input.endpoint_validates_payload_integrity
}

exposures contains _transit_message_integrity_bypass_def if {
    count(transit_message_integrity_bypass) > 0
}

_tls_certificate_validation_failure_def := {
    "name": "Tls Certificate Validation Failure",
    "description": "Devices or management clients fail to properly validate server TLS certificates \u2014 accepting self-signed, expired, or hostname-mismatched certificates, or disabling certificate pinning. This exposes the channel to interception via a rogue server presenting a fraudulent certificate.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

tls_certificate_validation_failure[_tls_certificate_validation_failure_def] if {
    input.certificate_validation_mode in ["disabled", "skip_hostname", "skip_expiry"]
}

tls_certificate_validation_failure[_tls_certificate_validation_failure_def] if {
    "self_signed" in input.accepted_certificate_types
}

tls_certificate_validation_failure[_tls_certificate_validation_failure_def] if {
    "expired" in input.accepted_certificate_types
}

tls_certificate_validation_failure[_tls_certificate_validation_failure_def] if {
    "hostname_mismatched" in input.accepted_certificate_types
}

tls_certificate_validation_failure[_tls_certificate_validation_failure_def] if {
    not input.certificate_pinning_enforced
    input.certificate_validation_mode != "full"
}

exposures contains _tls_certificate_validation_failure_def if {
    count(tls_certificate_validation_failure) > 0
}

_management_channel_protocol_downgrade_def := {
    "name": "Management Channel Protocol Downgrade",
    "description": "Absence of protocol version enforcement allows an active attacker to negotiate a weaker protocol version or cipher suite during the TLS handshake (e.g., POODLE-style downgrade to SSL 3.0, BEAST via CBC ciphers). Management protocols lacking strict minimum version policies are susceptible even when strong protocols are theoretically supported.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

management_channel_protocol_downgrade[_management_channel_protocol_downgrade_def] if {
    input.minimum_tls_version in ["SSL_2_0", "SSL_3_0", "TLS_1_0", "TLS_1_1"]
}

management_channel_protocol_downgrade[_management_channel_protocol_downgrade_def] if {
    not input.downgrade_attack_protection_enabled
}

management_channel_protocol_downgrade[_management_channel_protocol_downgrade_def] if {
    input.enabled_cipher_suites == true
}

exposures contains _management_channel_protocol_downgrade_def if {
    count(management_channel_protocol_downgrade) > 0
}

_bandwidth_exhaustion_via_update_flooding_def := {
    "name": "Bandwidth Exhaustion Via Update Flooding",
    "description": "Management channel lacks rate limiting on configuration update requests. An attacker with network access or a compromised device can flood the management server or intermediate network segments with spurious update requests, causing denial of service that prevents legitimate configuration updates from reaching devices.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

bandwidth_exhaustion_via_update_flooding[_bandwidth_exhaustion_via_update_flooding_def] if {
    not input.rate_limiting_enabled
}

bandwidth_exhaustion_via_update_flooding[_bandwidth_exhaustion_via_update_flooding_def] if {
    input.rate_limiting_enabled == true
    input.max_update_requests_per_minute == 0
}

bandwidth_exhaustion_via_update_flooding[_bandwidth_exhaustion_via_update_flooding_def] if {
    not input.source_authentication_required
    not input.rate_limiting_enabled
}

exposures contains _bandwidth_exhaustion_via_update_flooding_def if {
    count(bandwidth_exhaustion_via_update_flooding) > 0
}

_bgp_route_hijacking_of_management_traffic_def := {
    "name": "Bgp Route Hijacking Of Management Traffic",
    "description": "Management server IP ranges are not protected by RPKI or BGP route filtering, enabling a malicious autonomous system to advertise more-specific routes and redirect configuration update traffic to attacker-controlled infrastructure, allowing interception or payload substitution before delivery to devices.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

bgp_route_hijacking_of_management_traffic[_bgp_route_hijacking_of_management_traffic_def] if {
    input.management_ip_ranges_publicly_routed == true
    not input.rpki_validation_enabled
    not input.bgp_prefix_filter_configured
}

bgp_route_hijacking_of_management_traffic[_bgp_route_hijacking_of_management_traffic_def] if {
    input.management_ip_ranges_publicly_routed == true
    not input.rpki_validation_enabled
    input.bgp_prefix_filter_configured == true
}

bgp_route_hijacking_of_management_traffic[_bgp_route_hijacking_of_management_traffic_def] if {
    input.management_ip_ranges_publicly_routed == true
    input.rpki_validation_enabled == true
    not input.bgp_prefix_filter_configured
}

exposures contains _bgp_route_hijacking_of_management_traffic_def if {
    count(bgp_route_hijacking_of_management_traffic) > 0
}

_dns_spoofing_of_management_server_resolution_def := {
    "name": "Dns Spoofing Of Management Server Resolution",
    "description": "Devices resolve the management server hostname via DNS without DNSSEC validation. An attacker capable of DNS poisoning or intercepting DNS responses can redirect devices to a rogue management server, even when TLS is used \u2014 effective if certificate validation is also weak or pinning is absent.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

dns_spoofing_of_management_server_resolution[_dns_spoofing_of_management_server_resolution_def] if {
    input.management_hostname_resolution_method == "dns_dynamic"
    not input.dnssec_validation_enabled
    input.management_server_certificate_pinning in ["system_ca", "none"]
}

dns_spoofing_of_management_server_resolution[_dns_spoofing_of_management_server_resolution_def] if {
    input.management_hostname_resolution_method == "dns_dynamic"
    not input.dnssec_validation_enabled
    input.management_server_certificate_pinning == "none"
}

exposures contains _dns_spoofing_of_management_server_resolution_def if {
    count(dns_spoofing_of_management_server_resolution) > 0
}

_sensitive_configuration_data_in_cleartext_headers_def := {
    "name": "Sensitive Configuration Data In Cleartext Headers",
    "description": "Configuration update protocols transmit authentication tokens, API keys, device identifiers, or policy parameters in HTTP headers or query strings that are visible to TLS-terminating intermediaries or logged by network appliances, even when the body is encrypted.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

sensitive_configuration_data_in_cleartext_headers[_sensitive_configuration_data_in_cleartext_headers_def] if {
    input.sensitive_data_in_headers == true
    input.tls_terminated_at_intermediary == true
}

sensitive_configuration_data_in_cleartext_headers[_sensitive_configuration_data_in_cleartext_headers_def] if {
    input.sensitive_data_in_headers == true
    input.header_logging_enabled == true
}

exposures contains _sensitive_configuration_data_in_cleartext_headers_def if {
    count(sensitive_configuration_data_in_cleartext_headers) > 0
}

_update_channel_session_fixation_or_hijacking_def := {
    "name": "Update Channel Session Fixation Or Hijacking",
    "description": "Long-lived management sessions without session token rotation or binding to client IP/certificate fingerprint allow an attacker who obtains a valid session token (via sniffing or log exposure) to hijack the configuration update session and push unauthorized configuration changes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

update_channel_session_fixation_or_hijacking[_update_channel_session_fixation_or_hijacking_def] if {
    not input.session_token_rotation_enabled
    input.session_binding_mechanism == "none"
}

update_channel_session_fixation_or_hijacking[_update_channel_session_fixation_or_hijacking_def] if {
    input.session_token_max_lifetime_seconds > 86400
    input.session_binding_mechanism == "none"
}

update_channel_session_fixation_or_hijacking[_update_channel_session_fixation_or_hijacking_def] if {
    not input.session_token_rotation_enabled
    input.session_binding_mechanism in ["none", "ip_address"]
}

exposures contains _update_channel_session_fixation_or_hijacking_def if {
    count(update_channel_session_fixation_or_hijacking) > 0
}

_insufficient_update_channel_segmentation_def := {
    "name": "Insufficient Update Channel Segmentation",
    "description": "Management update traffic traverses the same network segment as untrusted or user traffic without dedicated VLAN, VPN tunnel, or network micro-segmentation. This increases the attack surface for lateral movement actors to intercept or inject traffic on the shared segment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

insufficient_update_channel_segmentation[_insufficient_update_channel_segmentation_def] if {
    input.update_channel_network_isolation == "none"
    input.update_traffic_colocated_with_user_traffic == true
}

insufficient_update_channel_segmentation[_insufficient_update_channel_segmentation_def] if {
    input.update_channel_network_isolation == "none"
    not input.acl_restricts_update_channel_access
}

exposures contains _insufficient_update_channel_segmentation_def if {
    count(insufficient_update_channel_segmentation) > 0
}

_update_payload_compression_oracle_attack_def := {
    "name": "Update Payload Compression Oracle Attack",
    "description": "Configuration update channels that compress payloads before encryption (e.g., DEFLATE within TLS) are susceptible to CRIME/BREACH-style compression oracle attacks, allowing an attacker who can inject partial known content and observe ciphertext length to recover sensitive values from configuration payloads over repeated requests.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

update_payload_compression_oracle_attack[_update_payload_compression_oracle_attack_def] if {
    input.payload_compression_enabled == true
    input.attacker_can_inject_partial_content == true
    input.ciphertext_length_observable == true
}

exposures contains _update_payload_compression_oracle_attack_def if {
    count(update_payload_compression_oracle_attack) > 0
}
