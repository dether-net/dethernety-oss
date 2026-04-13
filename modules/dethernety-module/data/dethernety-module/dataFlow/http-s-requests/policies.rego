package _dt_built_in.exposures.http_s_requests



_plaintext_transmission_def := {
    "name": "Plaintext Transmission",
    "description": "PII is transmitted without transport-layer encryption (e.g., HTTP instead of HTTPS, unencrypted TCP), exposing data contents to any passive observer on the network path including intermediary nodes, ISPs, and co-located network participants.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Directly describes data transmitted in plaintext over unencrypted protocols, matching the core concern of plaintext transmission."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Plaintext transmission enables network sniffing attacks where adversaries can capture unencrypted data in transit."
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_transmission[_plaintext_transmission_def] if {
    not input.transport_encryption_enabled
}

plaintext_transmission[_plaintext_transmission_def] if {
    input.protocol_scheme in ["http", "ftp", "smtp", "ws", "telnet", "tcp_plain", "other_plain"]
    not input.tls_redirect_enforced
}

exposures contains _plaintext_transmission_def if {
    count(plaintext_transmission) > 0
}

_tls_downgrade_attack_def := {
    "name": "Tls Downgrade Attack",
    "description": "The channel is susceptible to protocol version downgrade attacks (e.g., POODLE, DROWN, BEAST) where an active adversary forces negotiation to a weak or deprecated TLS/SSL version, undermining the confidentiality guarantees of the transport layer.",
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
            "relevance": "Directly describes downgrade attacks that force systems to use weaker protocol versions, exactly matching a TLS downgrade attack."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "TLS downgrade attacks aim to weaken encryption by forcing negotiation of older, less secure TLS versions or cipher suites."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_downgrade_attack[_tls_downgrade_attack_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

tls_downgrade_attack[_tls_downgrade_attack_def] if {
    not input.downgrade_protection_enabled
}

tls_downgrade_attack[_tls_downgrade_attack_def] if {
    count(input.deprecated_ssl_protocols_enabled) > 0
}

exposures contains _tls_downgrade_attack_def if {
    count(tls_downgrade_attack) > 0
}

_weak_cipher_suite_negotiation_def := {
    "name": "Weak Cipher Suite Negotiation",
    "description": "The TLS handshake permits selection of cryptographically weak cipher suites (e.g., RC4, NULL, export-grade, anonymous DH) that allow an attacker to decrypt or tamper with in-transit PII after capture or during an active interception session.",
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
            "relevance": "Weak cipher suite negotiation directly results in weakened encryption, aligning with this technique's description of reducing cryptographic strength."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.001",
            "name": "Symmetric Cryptography",
            "relevance": "Cipher suite negotiation governs which symmetric cryptographic algorithms are used, making this directly relevant to weak cipher selection."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    regex.match("(?i)(RC4|NULL|EXP|EXPORT|ADH|AECDH|aNULL|DES(?!3)|_DES_|eNULL|IDEA|SEED|RC2|ANON)", input.allowed_cipher_suites)
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

weak_cipher_suite_negotiation[_weak_cipher_suite_negotiation_def] if {
    not input.cipher_suite_policy_enforced
}

exposures contains _weak_cipher_suite_negotiation_def if {
    count(weak_cipher_suite_negotiation) > 0
}

_missing_certificate_validation_def := {
    "name": "Missing Certificate Validation",
    "description": "Clients do not strictly validate the server certificate chain, subject, or revocation status, making the flow vulnerable to man-in-the-middle attacks using fraudulent or self-signed certificates without client detection.",
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
            "relevance": "Missing certificate validation can be exploited by installing rogue root certificates to perform man-in-the-middle attacks without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Adversaries can develop forged digital certificates to exploit systems that lack proper certificate validation."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_certificate_validation[_missing_certificate_validation_def] if {
    not input.certificate_chain_validation_enabled
}

missing_certificate_validation[_missing_certificate_validation_def] if {
    not input.hostname_verification_enabled
}

missing_certificate_validation[_missing_certificate_validation_def] if {
    input.certificate_chain_validation_enabled == true
    input.certificate_revocation_check_mode == "none"
}

missing_certificate_validation[_missing_certificate_validation_def] if {
    input.self_signed_certificates_accepted == true
}

exposures contains _missing_certificate_validation_def if {
    count(missing_certificate_validation) > 0
}

_absent_mutual_tls_authentication_def := {
    "name": "Absent Mutual Tls Authentication",
    "description": "Only the server is authenticated during TLS handshake; no client certificate is required. This allows any unauthenticated client to inject data into the flow and prevents the server from cryptographically binding transmitted PII to a verified client identity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Absence of mutual TLS allows adversaries to obtain and use certificates without needing to authenticate mutually, enabling impersonation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Without mutual TLS, stolen or forged certificates can be used to impersonate clients or servers in the communication channel."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_mutual_tls_authentication[_absent_mutual_tls_authentication_def] if {
    input.transport_encryption_enabled == true
    not input.mutual_tls_required
}

absent_mutual_tls_authentication[_absent_mutual_tls_authentication_def] if {
    not input.transport_encryption_enabled
}

exposures contains _absent_mutual_tls_authentication_def if {
    count(absent_mutual_tls_authentication) > 0
}

_replay_attack_on_pii_requests_def := {
    "name": "Replay Attack On Pii Requests",
    "description": "The data flow lacks replay protection mechanisms (e.g., nonces, sequence numbers, timestamps with strict validation), enabling an attacker who captures a valid PII-bearing message to retransmit it at a later time to trigger repeated processing or unauthorized actions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "name": "Transmitted Data Manipulation",
            "relevance": "Replay attacks involve capturing and retransmitting previously valid PII requests, which constitutes manipulation of transmitted data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020.001",
            "name": "Traffic Duplication",
            "relevance": "Replay attacks on PII requests involve duplicating captured network traffic and replaying it to gain unauthorized access."
        }
    ],
    "attack_vector": "NETWORK"
}

replay_attack_on_pii_requests[_replay_attack_on_pii_requests_def] if {
    input.replay_protection_mechanism == "none"
}

replay_attack_on_pii_requests[_replay_attack_on_pii_requests_def] if {
    input.replay_protection_mechanism != "none"
    not input.server_side_replay_validation_enforced
    not input.request_idempotency_key_required
}

exposures contains _replay_attack_on_pii_requests_def if {
    count(replay_attack_on_pii_requests) > 0
}

_message_integrity_not_enforced_def := {
    "name": "Message Integrity Not Enforced",
    "description": "The data flow does not apply application-layer message authentication codes (MACs) or digital signatures beyond transport-layer protections. If TLS is terminated at an intermediary (e.g., load balancer, proxy), PII payloads may be forwarded without integrity guarantees to the backend application.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "name": "Transmitted Data Manipulation",
            "relevance": "Without message integrity enforcement, adversaries can modify transmitted data in transit without detection."
        }
    ],
    "attack_vector": "NETWORK"
}

message_integrity_not_enforced[_message_integrity_not_enforced_def] if {
    input.app_layer_integrity_mechanism == "none"
    input.tls_terminated_at_intermediary == true
    not input.backend_transport_reencrypted
}

message_integrity_not_enforced[_message_integrity_not_enforced_def] if {
    input.app_layer_integrity_mechanism == "none"
    not input.tls_terminated_at_intermediary
}

exposures contains _message_integrity_not_enforced_def if {
    count(message_integrity_not_enforced) > 0
}

_http_strict_transport_security_absent_def := {
    "name": "Http Strict Transport Security Absent",
    "description": "The flow does not enforce HSTS or equivalent channel pinning policies, allowing clients to initiate unencrypted connections that can be intercepted before a TLS upgrade occurs, particularly on first connection or after cache expiry.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "name": "Encrypted Channel",
            "relevance": "Absence of HSTS allows connections to be downgraded from encrypted HTTPS to plaintext HTTP, undermining encrypted channel requirements."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Missing HSTS headers enable protocol downgrade attacks where HTTPS connections are forced to unencrypted HTTP."
        }
    ],
    "attack_vector": "NETWORK"
}

http_strict_transport_security_absent[_http_strict_transport_security_absent_def] if {
    not input.hsts_header_present
}

http_strict_transport_security_absent[_http_strict_transport_security_absent_def] if {
    input.hsts_header_present == true
    input.hsts_max_age_seconds < 31536000
}

http_strict_transport_security_absent[_http_strict_transport_security_absent_def] if {
    input.http_plaintext_accessible == true
}

exposures contains _http_strict_transport_security_absent_def if {
    count(http_strict_transport_security_absent) > 0
}

_missing_rate_limiting_on_pii_channel_def := {
    "name": "Missing Rate Limiting On Pii Channel",
    "description": "The data flow imposes no bandwidth or request rate controls, enabling adversaries to exfiltrate large volumes of PII at high throughput once access is obtained, or to conduct automated enumeration and data harvesting attacks against the channel without throttling.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020",
            "name": "Automated Exfiltration",
            "relevance": "Without rate limiting, adversaries can automate high-volume PII exfiltration without triggering throttling controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1030",
            "name": "Data Transfer Size Limits",
            "relevance": "Absence of rate limiting means there are no data transfer size constraints, enabling large-scale PII extraction."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_rate_limiting_on_pii_channel[_missing_rate_limiting_on_pii_channel_def] if {
    not input.rate_limiting_enabled
    not input.channel_authentication_required
}

missing_rate_limiting_on_pii_channel[_missing_rate_limiting_on_pii_channel_def] if {
    not input.rate_limiting_enabled
    input.bulk_export_endpoint_exposed == true
}

exposures contains _missing_rate_limiting_on_pii_channel_def if {
    count(missing_rate_limiting_on_pii_channel) > 0
}

_bgp_route_hijacking_exposure_def := {
    "name": "Bgp Route Hijacking Exposure",
    "description": "The data flow traverses public internet routing infrastructure susceptible to BGP prefix hijacking, where an adversary announces more-specific routes to redirect traffic through attacker-controlled autonomous systems, enabling passive interception or active manipulation of PII in transit.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "BGP route hijacking redirects network traffic through adversary-controlled infrastructure, enabling adversary-in-the-middle interception."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "BGP hijacking can bridge network boundaries by rerouting traffic across network perimeters through malicious route announcements."
        }
    ],
    "attack_vector": "NETWORK"
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.traffic_path_uses_private_interconnect
    not input.rpki_route_origin_validation_enabled
    not input.transport_encryption_enforced
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    not input.traffic_path_uses_private_interconnect
    not input.rpki_route_origin_validation_enabled
}

exposures contains _bgp_route_hijacking_exposure_def if {
    count(bgp_route_hijacking_exposure) > 0
}

_dns_spoofing_redirect_of_flow_def := {
    "name": "Dns Spoofing Redirect Of Flow",
    "description": "Client DNS resolution for the application endpoint is not protected by DNSSEC or equivalent, allowing DNS spoofing or cache poisoning attacks that redirect the PII data flow to an adversary-controlled server before TLS is established.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "DNS spoofing involves compromising or manipulating DNS servers to redirect traffic flow to adversary-controlled destinations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Adversaries gather DNS information to perform targeted DNS spoofing attacks that redirect legitimate traffic flows."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_spoofing_redirect_of_flow[_dns_spoofing_redirect_of_flow_def] if {
    not input.dnssec_validation_enabled
    not input.dns_over_encrypted_transport
    not input.certificate_pinning_enabled
}

dns_spoofing_redirect_of_flow[_dns_spoofing_redirect_of_flow_def] if {
    not input.dnssec_validation_enabled
    not input.dns_over_encrypted_transport
}

exposures contains _dns_spoofing_redirect_of_flow_def if {
    count(dns_spoofing_redirect_of_flow) > 0
}
