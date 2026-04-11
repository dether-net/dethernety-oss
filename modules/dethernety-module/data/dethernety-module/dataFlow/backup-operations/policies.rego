package _dt_built_in.exposures.backup_operations

_unencrypted_backup_channel_def := {
    "name": "Unencrypted Backup Channel",
    "description": "Backup data transmitted in plaintext over the network, exposing full database contents to passive interception on any shared segment between source and storage.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_backup_channel[_unencrypted_backup_channel_def] if {
    not input.backup_transport_encryption_enabled
}

unencrypted_backup_channel[_unencrypted_backup_channel_def] if {
    input.backup_protocol in ["ftp", "http", "nfs", "smb_unencrypted", "rsync_plain"]
}

exposures contains _unencrypted_backup_channel_def if {
    count(unencrypted_backup_channel) > 0
}

_transport_protocol_downgrade_def := {
    "name": "Transport Protocol Downgrade",
    "description": "Absence of strict TLS version enforcement allows an active attacker to negotiate a deprecated protocol version (e.g., TLS 1.0, SSLv3) with known cryptographic weaknesses, weakening channel confidentiality.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

transport_protocol_downgrade[_transport_protocol_downgrade_def] if {
    input.minimum_tls_version_enforced == "none_configured"
}

transport_protocol_downgrade[_transport_protocol_downgrade_def] if {
    input.minimum_tls_version_enforced in ["SSLv3", "TLSv1.0", "TLSv1.1"]
}

transport_protocol_downgrade[_transport_protocol_downgrade_def] if {
    input.deprecated_protocol_fallback_enabled == true
}

transport_protocol_downgrade[_transport_protocol_downgrade_def] if {
    input.cipher_suite_policy in ["weak_permitted", "not_configured"]
}

exposures contains _transport_protocol_downgrade_def if {
    count(transport_protocol_downgrade) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "Only server-side TLS certificates are validated during channel establishment; the storage endpoint does not authenticate the backup client, allowing any network host to inject data into or redirect the backup stream.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.mutual_tls_enforced
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_validation_mode in ["none", "optional"]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.backup_transport_encryption_enabled
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_weak_cipher_suite_negotiation_def := {
    "name": "Weak Cipher Suite Negotiation",
    "description": "Permitted cipher suites include export-grade, NULL, RC4, or non-AEAD ciphers, enabling an attacker who captures traffic to decrypt backup content offline or perform real-time decryption with sufficient resources.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    "NULL" in input.weak_cipher_categories_present
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    "EXPORT" in input.weak_cipher_categories_present
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    "RC4" in input.weak_cipher_categories_present
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    "non-AEAD" in input.weak_cipher_categories_present
}

exposures contains _weak_cipher_suite_negotiation_def if {
    count(weak_cipher_suite_negotiation) > 0
}

_absent_message_integrity_verification_def := {
    "name": "Absent Message Integrity Verification",
    "description": "No cryptographic checksum or HMAC is applied to backup data segments in transit beyond transport-layer protection, so corruption or targeted in-stream modification of backup blocks goes undetected at the application layer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absent_message_integrity_verification[_absent_message_integrity_verification_def] if {
    not input.application_layer_integrity_verification_enabled
}

absent_message_integrity_verification[_absent_message_integrity_verification_def] if {
    not input.application_layer_integrity_verification_enabled
    input.transport_layer_protection_mechanism in ["tls", "ipsec", "vpn"]
}

exposures contains _absent_message_integrity_verification_def if {
    count(absent_message_integrity_verification) > 0
}

_replay_attack_on_backup_stream_def := {
    "name": "Replay Attack On Backup Stream",
    "description": "Backup transfer sessions lack nonce-based or sequence-number-based anti-replay controls, allowing a captured legitimate backup session to be replayed to overwrite newer backup data on the storage endpoint with stale content.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

replay_attack_on_backup_stream[_replay_attack_on_backup_stream_def] if {
    not input.anti_replay_mechanism_enabled
}

replay_attack_on_backup_stream[_replay_attack_on_backup_stream_def] if {
    input.anti_replay_mechanism_enabled == true
    input.backup_session_integrity_verification in ["none", "timestamp_only"]
}

replay_attack_on_backup_stream[_replay_attack_on_backup_stream_def] if {
    not input.anti_replay_mechanism_enabled
    not input.mutual_tls_enforced
}

exposures contains _replay_attack_on_backup_stream_def if {
    count(replay_attack_on_backup_stream) > 0
}

_certificate_validation_bypass_def := {
    "name": "Certificate Validation Bypass",
    "description": "The backup agent is configured to skip certificate chain validation or hostname verification for the storage endpoint, rendering TLS encryption ineffective against impersonation and man-in-the-middle interception.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    not input.certificate_chain_validation_enabled
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    not input.hostname_verification_enabled
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.tls_mode in ["no_verify", "ca_only"]
}

exposures contains _certificate_validation_bypass_def if {
    count(certificate_validation_bypass) > 0
}

_uncontrolled_backup_transfer_bandwidth_def := {
    "name": "Uncontrolled Backup Transfer Bandwidth",
    "description": "No rate limiting or traffic shaping is applied to the backup data flow, enabling exfiltration of bulk database copies at full line speed without triggering anomaly detection thresholds, or allowing the flow to be exploited as a denial-of-service amplification path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

uncontrolled_backup_transfer_bandwidth[_uncontrolled_backup_transfer_bandwidth_def] if {
    not input.backup_transfer_rate_limiting_enabled
    not input.backup_anomaly_detection_enabled
}

exposures contains _uncontrolled_backup_transfer_bandwidth_def if {
    count(uncontrolled_backup_transfer_bandwidth) > 0
}

_bgp_route_hijacking_of_backup_path_def := {
    "name": "Bgp Route Hijacking Of Backup Path",
    "description": "The network routing path between database and storage is subject to BGP prefix hijacking or route injection, diverting backup traffic through an adversary-controlled transit segment without the endpoints detecting the path change.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

bgp_route_hijacking_of_backup_path[_bgp_route_hijacking_of_backup_path_def] if {
    not input.bgp_route_origin_validation_enabled
    input.backup_network_segment_type in ["shared_internal", "public_internet"]
}

bgp_route_hijacking_of_backup_path[_bgp_route_hijacking_of_backup_path_def] if {
    not input.mutual_tls_enforced
    input.backup_network_segment_type == "public_internet"
}

bgp_route_hijacking_of_backup_path[_bgp_route_hijacking_of_backup_path_def] if {
    not input.bgp_route_origin_validation_enabled
    not input.mutual_tls_enforced
    input.backup_network_segment_type == "shared_internal"
}

exposures contains _bgp_route_hijacking_of_backup_path_def if {
    count(bgp_route_hijacking_of_backup_path) > 0
}

_predictable_backup_scheduling_timing_def := {
    "name": "Predictable Backup Scheduling Timing",
    "description": "Backup transfers occur on fixed, discoverable schedules, enabling an attacker who identifies the timing window to position a network interception tool precisely when high-value bulk data is in transit, rather than monitoring continuously.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

predictable_backup_scheduling_timing[_predictable_backup_scheduling_timing_def] if {
    input.backup_schedule_type == "fixed"
    input.backup_transfer_jitter_minutes == 0
}

predictable_backup_scheduling_timing[_predictable_backup_scheduling_timing_def] if {
    input.backup_schedule_type == "fixed"
    input.backup_schedule_publicly_documented == true
}

exposures contains _predictable_backup_scheduling_timing_def if {
    count(predictable_backup_scheduling_timing) > 0
}

_insecure_key_exchange_for_backup_encryption_def := {
    "name": "Insecure Key Exchange For Backup Encryption",
    "description": "Symmetric encryption keys used for backup stream protection are exchanged out-of-band over an unauthenticated or weakly authenticated channel (e.g., plain HTTP API, unencrypted email), allowing key material interception prior to use.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insecure_key_exchange_for_backup_encryption[_insecure_key_exchange_for_backup_encryption_def] if {
    input.key_exchange_channel_protocol in ["http_plaintext", "email_plaintext", "ftp_plaintext"]
}

insecure_key_exchange_for_backup_encryption[_insecure_key_exchange_for_backup_encryption_def] if {
    input.key_exchange_channel_protocol in ["https_unauthenticated"]
    not input.key_exchange_server_authentication_enforced
}

insecure_key_exchange_for_backup_encryption[_insecure_key_exchange_for_backup_encryption_def] if {
    input.key_material_appears_in_plaintext_logs_or_config == true
}

insecure_key_exchange_for_backup_encryption[_insecure_key_exchange_for_backup_encryption_def] if {
    input.key_exchange_channel_protocol == "manual_out_of_band"
    not input.key_exchange_server_authentication_enforced
}

exposures contains _insecure_key_exchange_for_backup_encryption_def if {
    count(insecure_key_exchange_for_backup_encryption) > 0
}
