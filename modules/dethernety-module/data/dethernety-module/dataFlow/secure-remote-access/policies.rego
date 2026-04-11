package _dt_built_in.exposures.secure_remote_access

_weak_tls_protocol_version_def := {
    "name": "Weak Tls Protocol Version",
    "description": "The channel permits negotiation of deprecated TLS versions (TLS 1.0, TLS 1.1, or SSL 3.0), exposing the flow to known protocol-level attacks such as POODLE, BEAST, or DROWN. An attacker performing active MitM can downgrade the handshake to a vulnerable version if the server accepts legacy offers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak TLS protocol versions enable downgrade attacks where an adversary forces use of older, weaker protocol versions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Using weak TLS protocol versions directly weakens the encryption protecting the channel."
        }
    ]
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    input.minimum_tls_version in ["ssl_3.0", "tls_1.0", "tls_1.1"]
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    input.minimum_tls_version in ["tls_1.2", "tls_1.3"]
    not input.deprecated_versions_explicitly_disabled
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    not input.tls_downgrade_protection_enabled
    not input.deprecated_versions_explicitly_disabled
}

exposures contains _weak_tls_protocol_version_def if {
    count(weak_tls_protocol_version) > 0
}

_insufficient_cipher_suite_strength_def := {
    "name": "Insufficient Cipher Suite Strength",
    "description": "The TLS negotiation allows weak or export-grade cipher suites (e.g., RC4, 3DES, NULL ciphers, EXPORT suites), reducing effective key strength below acceptable thresholds. Traffic captured today can be decrypted via brute force or known cryptanalytic attacks on the selected cipher.",
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
            "relevance": "Weak cipher suites directly weaken encryption, allowing adversaries to exploit reduced cryptographic strength."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Insufficient cipher suite strength reduces the effective key space, making brute-force or cryptanalytic attacks feasible."
        }
    ]
}

insufficient_cipher_suite_strength[_insufficient_cipher_suite_strength_def] if {
    regex.match("(?i)(RC4|3DES|DES(?!_EDE3_CBC_WITH_AES)|EXPORT|NULL|aNULL|eNULL|ADH|AECDH|RC2|IDEA|SEED|MD5|CAMELLIA128|DES-CBC)", input.allowed_cipher_suites)
}

insufficient_cipher_suite_strength[_insufficient_cipher_suite_strength_def] if {
    not input.weak_cipher_suites_explicitly_disabled
}

insufficient_cipher_suite_strength[_insufficient_cipher_suite_strength_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

exposures contains _insufficient_cipher_suite_strength_def if {
    count(insufficient_cipher_suite_strength) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "The encrypted channel relies solely on server-side certificate authentication. Clients are not required to present a valid certificate for mutual TLS (mTLS), meaning any client that can reach the endpoint can initiate an encrypted session. This permits unauthorized actors to tunnel malicious traffic through otherwise encrypted flows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "name": "Encrypted Channel",
            "relevance": "Missing mutual TLS authentication means only one side is verified, undermining the trust model of encrypted channels."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.002",
            "name": "Asymmetric Cryptography",
            "relevance": "Mutual TLS relies on asymmetric cryptography for certificate-based authentication; its absence allows impersonation attacks."
        }
    ]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.client_certificate_required
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_required == true
    not input.client_ca_certificate_configured
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_certificate_validation_bypass_def := {
    "name": "Certificate Validation Bypass",
    "description": "The flow does not enforce strict certificate chain validation, hostname matching, or OCSP/CRL revocation checking, allowing an attacker to present a rogue or expired certificate without rejection. This enables MitM interception even when TLS is nominally in use.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "name": "Install Root Certificate",
            "relevance": "Bypassing certificate validation can be achieved by installing rogue root certificates to intercept encrypted traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Certificate validation bypass enables or results from forged certificates used to impersonate legitimate endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Adversaries may develop or use fraudulent digital certificates when certificate validation is bypassed."
        }
    ]
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    not input.certificate_chain_validation_enforced
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    not input.hostname_verification_enforced
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.revocation_check_method == "none"
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.expired_certificates_accepted == true
}

exposures contains _certificate_validation_bypass_def if {
    count(certificate_validation_bypass) > 0
}

_tls_session_replay_attack_def := {
    "name": "Tls Session Replay Attack",
    "description": "Captured TLS session tickets or pre-shared keys (PSK) can be replayed if session resumption mechanisms lack freshness controls. Absence of session ticket rotation or short ticket lifetimes allows an attacker who obtains a valid ticket to resume authenticated sessions without re-authenticating.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558",
            "name": "Steal or Forge Kerberos Tickets",
            "relevance": "Session replay attacks share the same conceptual model as ticket/credential replay, reusing captured session tokens to authenticate."
        }
    ]
}

tls_session_replay_attack[_tls_session_replay_attack_def] if {
    not input.session_resumption_mechanism in ["none"]
    not input.tls_anti_replay_enforced
}

tls_session_replay_attack[_tls_session_replay_attack_def] if {
    input.session_resumption_mechanism in ["session_tickets", "psk"]
    input.session_ticket_lifetime_seconds > 3600
}

tls_session_replay_attack[_tls_session_replay_attack_def] if {
    input.session_resumption_mechanism in ["session_tickets", "psk"]
    not input.session_ticket_rotation_enabled
}

exposures contains _tls_session_replay_attack_def if {
    count(tls_session_replay_attack) > 0
}

_no_forward_secrecy_on_channel_def := {
    "name": "No Forward Secrecy On Channel",
    "description": "The cipher suites in use do not require ephemeral key exchange (ECDHE/DHE), meaning the long-term private key can decrypt retrospectively captured traffic. Bulk traffic interception today combined with future key compromise exposes all historical communications.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Without forward secrecy, compromise of a private key allows decryption of all past recorded sessions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.002",
            "name": "Asymmetric Cryptography",
            "relevance": "Forward secrecy is a property of asymmetric key exchange; its absence means long-term asymmetric keys can decrypt past traffic."
        }
    ]
}

no_forward_secrecy_on_channel[_no_forward_secrecy_on_channel_def] if {
    not input.forward_secrecy_enforced
}

no_forward_secrecy_on_channel[_no_forward_secrecy_on_channel_def] if {
    regex.match("(?i)TLS_RSA_WITH_", input.allowed_cipher_suites)
}

exposures contains _no_forward_secrecy_on_channel_def if {
    count(no_forward_secrecy_on_channel) > 0
}

_missing_hsts_or_protocol_downgrade_protection_def := {
    "name": "Missing Hsts Or Protocol Downgrade Protection",
    "description": "The flow lacks HTTP Strict Transport Security (HSTS) or equivalent channel pinning, allowing protocol downgrade attacks where clients are redirected to unencrypted channels by a network-level adversary. First-contact interception can silently strip encryption before the client enforces it.",
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
            "relevance": "Missing HSTS directly enables protocol downgrade attacks forcing browsers to use insecure HTTP instead of HTTPS."
        }
    ]
}

missing_hsts_or_protocol_downgrade_protection[_missing_hsts_or_protocol_downgrade_protection_def] if {
    not input.hsts_header_configured
}

missing_hsts_or_protocol_downgrade_protection[_missing_hsts_or_protocol_downgrade_protection_def] if {
    not input.http_to_https_redirect_enforced
}

missing_hsts_or_protocol_downgrade_protection[_missing_hsts_or_protocol_downgrade_protection_def] if {
    input.minimum_tls_version in ["ssl_3_0", "tls_1_0", "tls_1_1"]
}

exposures contains _missing_hsts_or_protocol_downgrade_protection_def if {
    count(missing_hsts_or_protocol_downgrade_protection) > 0
}

_absence_of_message_integrity_controls_def := {
    "name": "Absence Of Message Integrity Controls",
    "description": "Individual messages traversing the encrypted channel lack application-layer MAC or HMAC signatures independent of TLS record-layer integrity. If TLS terminates at an intermediate proxy, decrypted payloads can be tampered with before re-encryption without the final endpoint detecting modification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Absence of message integrity controls (e.g., MACs) weakens the overall cryptographic protection, enabling tampering."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "name": "Encrypted Channel",
            "relevance": "Encrypted channels without integrity controls are vulnerable to message manipulation even if confidentiality is preserved."
        }
    ]
}

absence_of_message_integrity_controls[_absence_of_message_integrity_controls_def] if {
    not input.app_layer_message_integrity_enabled
    input.tls_termination_at_proxy == true
}

absence_of_message_integrity_controls[_absence_of_message_integrity_controls_def] if {
    not input.app_layer_message_integrity_enabled
}

exposures contains _absence_of_message_integrity_controls_def if {
    count(absence_of_message_integrity_controls) > 0
}

_missing_rate_limiting_on_encrypted_channel_def := {
    "name": "Missing Rate Limiting On Encrypted Channel",
    "description": "No rate limiting or connection throttling is applied to incoming encrypted sessions, enabling volumetric abuse such as TLS handshake exhaustion (THC-SSL-DoS) or resource exhaustion attacks that degrade availability for legitimate clients. The encryption overhead amplifies the cost asymmetry in favor of the attacker.",
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
            "relevance": "Without rate limiting, encrypted channels are susceptible to service exhaustion floods that overwhelm server resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Lack of rate limiting on encrypted channels can be exploited for high-volume tunneling of malicious traffic."
        }
    ]
}

missing_rate_limiting_on_encrypted_channel[_missing_rate_limiting_on_encrypted_channel_def] if {
    not input.tls_connection_rate_limit_enabled
}

missing_rate_limiting_on_encrypted_channel[_missing_rate_limiting_on_encrypted_channel_def] if {
    input.tls_connection_rate_limit_enabled == true
    input.max_concurrent_tls_handshakes == 0
}

missing_rate_limiting_on_encrypted_channel[_missing_rate_limiting_on_encrypted_channel_def] if {
    input.ddos_protection_tier in ["none", "basic"]
    input.max_concurrent_tls_handshakes == 0
    not input.tls_connection_rate_limit_enabled
}

exposures contains _missing_rate_limiting_on_encrypted_channel_def if {
    count(missing_rate_limiting_on_encrypted_channel) > 0
}

_bgp_route_hijacking_exposure_def := {
    "name": "Bgp Route Hijacking Exposure",
    "description": "The network path for the encrypted flow is not protected by RPKI (Route Origin Validation) or BGP path filtering, allowing an adversary to advertise more-specific prefixes and redirect encrypted traffic through attacker-controlled infrastructure for offline decryption or selective dropping.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "BGP route hijacking allows adversaries to bridge network boundaries by redirecting traffic through attacker-controlled infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "BGP hijacking can redirect traffic through adversary-controlled nodes, effectively functioning as a multi-hop interception proxy."
        }
    ]
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.rpki_route_origin_validation_enabled
    not input.bgp_prefix_filter_policy_applied
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.rpki_route_origin_validation_enabled
    not input.protected_prefix_max_prefix_length
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.bgp_prefix_filter_policy_applied
    not input.protected_prefix_max_prefix_length
}

exposures contains _bgp_route_hijacking_exposure_def if {
    count(bgp_route_hijacking_exposure) > 0
}

_dns_based_traffic_interception_def := {
    "name": "Dns Based Traffic Interception",
    "description": "The flow relies on DNS resolution without DNSSEC validation or DNS-over-HTTPS/TLS, allowing DNS spoofing to redirect clients to a rogue endpoint. Even with certificate pinning absent, a trusted CA can issue a certificate for the spoofed destination, enabling transparent decryption.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "DNS-based traffic interception exploits the DNS protocol to redirect or intercept communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Adversaries compromise DNS servers to perform traffic interception by poisoning DNS responses."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.004",
            "name": "Domain Fronting",
            "relevance": "Domain fronting abuses DNS and CDN infrastructure to disguise and intercept traffic."
        }
    ]
}

dns_based_traffic_interception[_dns_based_traffic_interception_def] if {
    not input.dnssec_validation_enabled
    input.dns_transport_security == "none"
    not input.certificate_pinning_enforced
}

dns_based_traffic_interception[_dns_based_traffic_interception_def] if {
    not input.dnssec_validation_enabled
    input.dns_transport_security == "DoT"
    not input.certificate_pinning_enforced
}

dns_based_traffic_interception[_dns_based_traffic_interception_def] if {
    not input.dnssec_validation_enabled
    input.dns_transport_security == "DoH"
    not input.certificate_pinning_enforced
}

exposures contains _dns_based_traffic_interception_def if {
    count(dns_based_traffic_interception) > 0
}

_insecure_renegotiation_vulnerability_def := {
    "name": "Insecure Renegotiation Vulnerability",
    "description": "The TLS implementation permits insecure renegotiation (pre-RFC 5746), enabling a MitM attacker to inject plaintext into the beginning of a TLS session that is then processed as authenticated client data. This exposes request smuggling and authentication bypass vectors.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Insecure TLS renegotiation can be exploited by an adversary-in-the-middle to inject malicious data into established sessions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Insecure renegotiation vulnerabilities may expose session data to network sniffing during the renegotiation handshake."
        }
    ]
}

insecure_renegotiation_vulnerability[_insecure_renegotiation_vulnerability_def] if {
    not input.secure_renegotiation_supported
}

insecure_renegotiation_vulnerability[_insecure_renegotiation_vulnerability_def] if {
    input.legacy_renegotiation_permitted == true
}

insecure_renegotiation_vulnerability[_insecure_renegotiation_vulnerability_def] if {
    not input.secure_renegotiation_supported
    input.client_initiated_renegotiation_allowed == true
}

exposures contains _insecure_renegotiation_vulnerability_def if {
    count(insecure_renegotiation_vulnerability) > 0
}

_traffic_metadata_leakage_via_timing_def := {
    "name": "Traffic Metadata Leakage Via Timing",
    "description": "Although payload content is encrypted, packet size, timing patterns, and flow duration remain observable. A passive adversary can perform traffic analysis to infer communication patterns, session frequency, and potentially reconstruct application-layer behaviors without decrypting content.",
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
            "relevance": "Timing-based metadata leakage is observable through network traffic analysis similar to network sniffing techniques."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001",
            "name": "Data Obfuscation",
            "relevance": "Timing side-channels leak metadata about obfuscated communications, undermining data obfuscation protections."
        }
    ]
}

traffic_metadata_leakage_via_timing[_traffic_metadata_leakage_via_timing_def] if {
    not input.traffic_padding_enabled
    not input.traffic_shaping_or_dummy_traffic_enabled
}

exposures contains _traffic_metadata_leakage_via_timing_def if {
    count(traffic_metadata_leakage_via_timing) > 0
}
