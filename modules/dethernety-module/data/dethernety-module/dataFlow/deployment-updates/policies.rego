package _dt_built_in.exposures.deployment_updates

_unencrypted_update_channel_def := {
    "name": "Unencrypted Update Channel",
    "description": "Configuration update traffic transmitted over plaintext protocols (e.g., HTTP, Telnet, unencrypted SNMP) allows any on-path observer to read configuration payloads, credentials, or secrets embedded in updates.",
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
            "relevance": "An unencrypted update channel allows attackers to intercept and read update traffic through network sniffing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Unencrypted update channels can be leveraged to exfiltrate data over plaintext protocols without detection."
        }
    ]
}

unencrypted_update_channel[_unencrypted_update_channel_def] if {
    input.update_channel_protocol in ["http", "telnet", "snmp_v1", "snmp_v2c", "ftp", "tftp", "other_plaintext"]
}

unencrypted_update_channel[_unencrypted_update_channel_def] if {
    not input.update_channel_protocol in ["http", "telnet", "snmp_v1", "snmp_v2c", "ftp", "tftp", "other_plaintext"]
    not input.mutual_tls_enforced
    not input.payload_integrity_verification
}

exposures contains _unencrypted_update_channel_def if {
    count(unencrypted_update_channel) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "Update channel uses server-only TLS without client certificate authentication, allowing any host to impersonate a legitimate management controller and push malicious configurations to managed components, or allowing rogue components to receive authoritative update payloads.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Without mutual TLS, attackers can impersonate clients or servers by forging or stealing certificates used for authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.001",
            "name": "Domain Controller Authentication",
            "relevance": "Missing mutual TLS authentication enables adversaries to bypass or manipulate authentication mechanisms on managed components."
        }
    ]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.tls_enabled
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.tls_enabled == true
    not input.client_certificate_authentication_required
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.tls_enabled == true
    input.client_certificate_authentication_required == true
    not input.client_ca_certificate_configured
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_weak_or_deprecated_tls_ciphers_def := {
    "name": "Weak Or Deprecated Tls Ciphers",
    "description": "Transport layer negotiates deprecated cipher suites (e.g., RC4, 3DES, export-grade ciphers) or TLS versions below 1.2, enabling downgrade or brute-force decryption of configuration payloads in transit.",
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
            "relevance": "Weak or deprecated TLS ciphers directly weaken the encryption protecting communications, enabling adversaries to decrypt traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Deprecated ciphers with reduced key space make brute-force or cryptanalytic attacks feasible against TLS-protected channels."
        }
    ]
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "RC4" in input.allowed_cipher_suites
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "3DES" in input.allowed_cipher_suites
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "EXPORT" in input.allowed_cipher_suites
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "NULL" in input.allowed_cipher_suites
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "aNULL" in input.allowed_cipher_suites
}

weak_or_deprecated_tls_ciphers[_weak_or_deprecated_tls_ciphers_def] if {
    "DES" in input.allowed_cipher_suites
}

exposures contains _weak_or_deprecated_tls_ciphers_def if {
    count(weak_or_deprecated_tls_ciphers) > 0
}

_replay_of_configuration_update_messages_def := {
    "name": "Replay Of Configuration Update Messages",
    "description": "Update channel lacks per-message nonces, timestamps, or sequence numbers, permitting an attacker who captures a legitimate update to retransmit it at a later time, reverting components to a known-vulnerable or misconfigured state.",
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
            "relevance": "Replay attacks on configuration updates exploit weak or absent cryptographic protections such as missing nonces or timestamps."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "name": "Encrypted Channel",
            "relevance": "Replay attacks target the integrity and freshness of encrypted channel messages used for configuration updates."
        }
    ]
}

replay_of_configuration_update_messages[_replay_of_configuration_update_messages_def] if {
    input.replay_protection_mechanism == "none"
}

replay_of_configuration_update_messages[_replay_of_configuration_update_messages_def] if {
    not input.replay_protection_mechanism in ["none"]
    not input.update_deduplication_enforced
}

replay_of_configuration_update_messages[_replay_of_configuration_update_messages_def] if {
    not input.message_integrity_verification_enabled
    input.replay_protection_mechanism == "none"
}

exposures contains _replay_of_configuration_update_messages_def if {
    count(replay_of_configuration_update_messages) > 0
}

_missing_payload_integrity_verification_def := {
    "name": "Missing Payload Integrity Verification",
    "description": "Configuration update payloads are not signed or HMAC-protected at the message layer, so transport-layer protection alone guards integrity. An attacker performing a TLS termination or protocol downgrade can modify configuration content without detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Without payload integrity verification, attackers can tamper with or downgrade update payloads without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Missing integrity checks allow adversaries to modify payloads, effectively bypassing cryptographic protections."
        }
    ]
}

missing_payload_integrity_verification[_missing_payload_integrity_verification_def] if {
    input.payload_integrity_mechanism == "none"
    not input.transport_tls_enforced
}

missing_payload_integrity_verification[_missing_payload_integrity_verification_def] if {
    input.payload_integrity_mechanism == "none"
    input.transport_tls_enforced == true
}

exposures contains _missing_payload_integrity_verification_def if {
    count(missing_payload_integrity_verification) > 0
}

_unauthenticated_update_source_routing_def := {
    "name": "Unauthenticated Update Source Routing",
    "description": "The update distribution channel does not enforce source IP validation or BGP route filtering, allowing an attacker to advertise more-specific routes and redirect update traffic to a rogue distribution point that serves tampered configurations.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557.003",
            "name": "DHCP Spoofing",
            "relevance": "Unauthenticated source routing enables man-in-the-middle attacks via network spoofing techniques like DHCP spoofing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.008",
            "name": "Network Devices",
            "relevance": "Attackers can compromise network devices to manipulate unauthenticated update source routing paths."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Unauthenticated routing allows adversaries to bridge network boundaries and redirect update traffic."
        }
    ]
}

unauthenticated_update_source_routing[_unauthenticated_update_source_routing_def] if {
    not input.bgp_route_filtering_enabled
    not input.update_server_ip_allowlist_enforced
}

unauthenticated_update_source_routing[_unauthenticated_update_source_routing_def] if {
    not input.bgp_route_filtering_enabled
    not input.payload_integrity_verification
}

unauthenticated_update_source_routing[_unauthenticated_update_source_routing_def] if {
    not input.bgp_route_filtering_enabled
    not input.mutual_tls_enforced
}

exposures contains _unauthenticated_update_source_routing_def if {
    count(unauthenticated_update_source_routing) > 0
}

_absence_of_rate_limiting_on_update_channel_def := {
    "name": "Absence Of Rate Limiting On Update Channel",
    "description": "No bandwidth or request-rate controls are enforced on the configuration update channel, enabling an attacker or compromised component to flood the channel with spurious update requests, causing denial of service to the management plane.",
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
            "relevance": "Without rate limiting, the update channel is vulnerable to service exhaustion floods that degrade availability."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "name": "Network Denial of Service",
            "relevance": "Absence of rate limiting enables network-level denial of service attacks against the update channel."
        }
    ]
}

absence_of_rate_limiting_on_update_channel[_absence_of_rate_limiting_on_update_channel_def] if {
    not input.rate_limiting_enabled
    input.update_channel_exposure in ["public", "internal_unrestricted"]
}

absence_of_rate_limiting_on_update_channel[_absence_of_rate_limiting_on_update_channel_def] if {
    not input.rate_limiting_enabled
    not input.connection_limit_configured
    input.update_channel_exposure in ["public", "internal_unrestricted", "management_network_only"]
}

exposures contains _absence_of_rate_limiting_on_update_channel_def if {
    count(absence_of_rate_limiting_on_update_channel) > 0
}

_certificate_validation_bypass_on_managed_component_def := {
    "name": "Certificate Validation Bypass On Managed Component",
    "description": "Managed components accept self-signed or expired certificates from the management controller without proper chain-of-trust validation, making them susceptible to man-in-the-middle substitution of a fraudulent update server presenting a lookalike certificate.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "name": "Install Root Certificate",
            "relevance": "Bypassing certificate validation can be achieved by installing rogue root certificates on managed components."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Certificate validation bypass enables attackers to use forged or stolen certificates without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.003",
            "name": "Install Digital Certificate",
            "relevance": "Attackers can install malicious digital certificates to facilitate certificate validation bypass on managed components."
        }
    ]
}

certificate_validation_bypass_on_managed_component[_certificate_validation_bypass_on_managed_component_def] if {
    not input.ca_chain_validation_enforced
}

certificate_validation_bypass_on_managed_component[_certificate_validation_bypass_on_managed_component_def] if {
    not input.certificate_expiry_validation_enforced
}

certificate_validation_bypass_on_managed_component[_certificate_validation_bypass_on_managed_component_def] if {
    not input.pinned_certificate_or_ca_configured
    not input.ca_chain_validation_enforced
}

exposures contains _certificate_validation_bypass_on_managed_component_def if {
    count(certificate_validation_bypass_on_managed_component) > 0
}

_update_channel_over_untrusted_network_segment_def := {
    "name": "Update Channel Over Untrusted Network Segment",
    "description": "Configuration update traffic traverses untrusted or flat network segments without VPN encapsulation or network-layer isolation, increasing the exposure window for interception and injection compared to a dedicated out-of-band management network.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Update channels traversing untrusted network segments are exposed to sniffing by adversaries on the same segment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Untrusted network segments enable adversaries to bridge network boundaries and intercept update traffic."
        }
    ]
}

update_channel_over_untrusted_network_segment[_update_channel_over_untrusted_network_segment_def] if {
    input.network_segment_type in ["flat_shared", "untrusted_public"]
    not input.transport_encryption_enabled
}

update_channel_over_untrusted_network_segment[_update_channel_over_untrusted_network_segment_def] if {
    input.network_segment_type in ["flat_shared", "untrusted_public"]
    input.transport_encryption_enabled == true
    not input.mutual_authentication_enforced
}

exposures contains _update_channel_over_untrusted_network_segment_def if {
    count(update_channel_over_untrusted_network_segment) > 0
}

_protocol_metadata_leakage_def := {
    "name": "Protocol Metadata Leakage",
    "description": "Even when payload is encrypted, unencrypted protocol headers (e.g., SNI, HTTP Host header, SNMP community strings, unencrypted MQTT topics) reveal management plane topology, component identities, and update frequencies to passive observers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Network sniffing directly captures protocol metadata such as headers, timing, and connection details from the wire."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Protocol metadata leakage over unencrypted channels can expose sensitive information to passive observers."
        }
    ]
}

protocol_metadata_leakage[_protocol_metadata_leakage_def] if {
    input.protocol_supports_sni_or_plaintext_headers == true
    not input.encrypted_client_hello_enabled
}

exposures contains _protocol_metadata_leakage_def if {
    count(protocol_metadata_leakage) > 0
}
