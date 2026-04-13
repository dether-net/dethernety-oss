package _dt_built_in.exposures.api_calls

_unencrypted_transport_def := {
    "name": "Unencrypted Transport",
    "description": "API calls transmitted over plaintext HTTP or other unencrypted protocols expose request payloads, headers, authentication tokens, and response data to passive interception on any intermediate network node.",
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
            "relevance": "Directly describes data transmission over unencrypted protocols, matching the risk of unencrypted transport channels."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Unencrypted transport exposes data to network sniffing attacks where adversaries can capture plaintext traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_transport[_unencrypted_transport_def] if {
    not input.transport_encryption_enabled
}

unencrypted_transport[_unencrypted_transport_def] if {
    input.minimum_tls_version in ["SSL2", "SSL3", "TLS1.0", "TLS1.1"]
}

unencrypted_transport[_unencrypted_transport_def] if {
    input.plaintext_port_exposed == true
}

exposures contains _unencrypted_transport_def if {
    count(unencrypted_transport) > 0
}

_weak_tls_protocol_negotiation_def := {
    "name": "Weak Tls Protocol Negotiation",
    "description": "Support for deprecated TLS versions (1.0, 1.1) or weak cipher suites (RC4, 3DES, export-grade) during TLS handshake negotiation allows downgrade attacks, enabling decryption of API traffic that appears encrypted.",
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
            "relevance": "Directly describes forcing negotiation to weaker protocol versions, which is the core risk in weak TLS protocol negotiation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Covers adversary techniques to weaken encryption strength, relevant when TLS negotiation allows weak cipher suites or protocol versions."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    input.minimum_tls_version in ["SSL3", "TLS1_0"]
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    input.minimum_tls_version == "TLS1_1"
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    "RC4" in input.enabled_cipher_suites
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    "3DES" in input.enabled_cipher_suites
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    "EXP" in input.enabled_cipher_suites
}

weak_tls_protocol_negotiation[_weak_tls_protocol_negotiation_def] if {
    not input.tls_downgrade_protection_enabled
    input.minimum_tls_version in ["SSL3", "TLS1_0", "TLS1_1"]
}

exposures contains _weak_tls_protocol_negotiation_def if {
    count(weak_tls_protocol_negotiation) > 0
}

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "One-way TLS authenticates only the server, leaving the API endpoint unable to cryptographically verify the client's identity. Absence of mTLS allows unauthorized or spoofed clients to submit requests as if they were legitimate callers.",
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
            "relevance": "Without mutual TLS authentication, adversaries can position themselves between client and server to intercept or manipulate traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Missing mTLS allows attackers to impersonate endpoints; stolen or forged certificates enable bypassing certificate-based authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Absence of mutual authentication enables service impersonation where a malicious endpoint masquerades as a legitimate one."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.mtls_enabled
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_validation_mode in ["optional", "none"]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_enabled == true
    not input.trusted_client_ca_configured
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_tls_certificate_validation_bypass_def := {
    "name": "Tls Certificate Validation Bypass",
    "description": "API consumers that skip certificate chain validation, ignore hostname mismatches, or accept self-signed certificates without pinning are vulnerable to TLS interception via rogue certificates, negating transport encryption protections.",
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
            "relevance": "Installing rogue root certificates is a primary technique to bypass TLS certificate validation by making fraudulent certificates appear trusted."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Forged certificates are used to exploit certificate validation bypass, enabling man-in-the-middle attacks on TLS connections."
        }
    ],
    "attack_vector": "LOCAL"
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    not input.certificate_chain_validation_enabled
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    not input.hostname_verification_enabled
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    input.self_signed_certificate_accepted == true
}

exposures contains _tls_certificate_validation_bypass_def if {
    count(tls_certificate_validation_bypass) > 0
}

_message_integrity_absence_def := {
    "name": "Message Integrity Absence",
    "description": "API payloads lacking cryptographic signatures or HMACs can be silently modified in transit. Without integrity verification on the message body, an active network attacker can alter request parameters or response data without detection.",
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
            "relevance": "Without message integrity controls, adversaries can manipulate transmitted data in transit, directly matching this risk."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Absence of message integrity enables adversary-in-the-middle attacks where messages can be altered without detection."
        }
    ],
    "attack_vector": "NETWORK"
}

message_integrity_absence[_message_integrity_absence_def] if {
    input.message_integrity_mechanism == "none"
}

exposures contains _message_integrity_absence_def if {
    count(message_integrity_absence) > 0
}

_replay_attack_susceptibility_def := {
    "name": "Replay Attack Susceptibility",
    "description": "API requests that omit nonces, timestamps, or short-lived request tokens can be captured and retransmitted by an attacker to repeat a previously authorized operation, such as a financial transaction or state-changing command.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Captured tokens can be replayed to gain unauthorized access, directly representing the replay attack threat."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Adversaries can intercept and replay authentication messages or tokens when replay protection mechanisms are absent."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Stolen tokens lacking replay protection can be reused by attackers to impersonate legitimate sessions."
        }
    ],
    "attack_vector": "NETWORK"
}

replay_attack_susceptibility[_replay_attack_susceptibility_def] if {
    input.replay_protection_mechanism == "none"
}

replay_attack_susceptibility[_replay_attack_susceptibility_def] if {
    input.replay_protection_mechanism in ["timestamp", "signed_token"]
    input.token_expiry_window_seconds > 300
    not input.request_idempotency_enforced
}

replay_attack_susceptibility[_replay_attack_susceptibility_def] if {
    input.replay_protection_mechanism in ["timestamp", "signed_token"]
    input.token_expiry_window_seconds == 0
    not input.request_idempotency_enforced
}

replay_attack_susceptibility[_replay_attack_susceptibility_def] if {
    input.replay_protection_mechanism == "nonce"
    not input.request_idempotency_enforced
}

exposures contains _replay_attack_susceptibility_def if {
    count(replay_attack_susceptibility) > 0
}

_bearer_token_interception_in_transit_def := {
    "name": "Bearer Token Interception In Transit",
    "description": "Authentication credentials such as API keys, JWT bearer tokens, or OAuth access tokens transmitted in HTTP headers or query strings can be harvested from traffic captures, granting full impersonation capability without breaking encryption if the transport is weak.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Directly describes stealing application access tokens including bearer tokens transmitted over the network."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Bearer tokens transmitted in plaintext or interceptable form can be captured via network sniffing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Intercepted bearer tokens can be used by adversaries to authenticate as the legitimate user without credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_token_interception_in_transit[_bearer_token_interception_in_transit_def] if {
    input.transport_protocol_enforced in ["plaintext_allowed"]
}

bearer_token_interception_in_transit[_bearer_token_interception_in_transit_def] if {
    input.transport_protocol_enforced in ["tls_1_0_or_1_1"]
}

bearer_token_interception_in_transit[_bearer_token_interception_in_transit_def] if {
    input.token_transmitted_in_query_string == true
}

bearer_token_interception_in_transit[_bearer_token_interception_in_transit_def] if {
    not input.certificate_chain_validation_enabled
}

exposures contains _bearer_token_interception_in_transit_def if {
    count(bearer_token_interception_in_transit) > 0
}

_missing_transport_rate_limiting_def := {
    "name": "Missing Transport Rate Limiting",
    "description": "Absence of rate limiting or throttling controls at the transport/gateway layer permits high-volume request floods that exhaust API backend capacity, degrade service availability, or enable brute-force enumeration of endpoints and parameters.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Without rate limiting, application-layer flood attacks can exhaust resources, directly exploiting the absence of transport-level controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Missing rate limiting exposes services to exhaustion flood attacks that overwhelm transport-layer service capacity."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_transport_rate_limiting[_missing_transport_rate_limiting_def] if {
    not input.rate_limiting_enabled
}

missing_transport_rate_limiting[_missing_transport_rate_limiting_def] if {
    input.rate_limit_scope == "none"
}

missing_transport_rate_limiting[_missing_transport_rate_limiting_def] if {
    input.api_traffic_uses_public_internet == true
    input.rate_limit_scope == "none"
}

exposures contains _missing_transport_rate_limiting_def if {
    count(missing_transport_rate_limiting) > 0
}

_bgp_route_hijacking_exposure_def := {
    "name": "Bgp Route Hijacking Exposure",
    "description": "API traffic routed over the public internet is susceptible to BGP prefix hijacking, where malicious autonomous systems announce more-specific routes to divert traffic through attacker-controlled infrastructure, enabling mass interception or traffic blackholing.",
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
            "relevance": "BGP route hijacking redirects traffic through adversary-controlled infrastructure, enabling man-in-the-middle interception of network communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "BGP hijacking can bridge network boundaries by rerouting traffic across network perimeters through malicious autonomous systems."
        }
    ],
    "attack_vector": "NETWORK"
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    input.api_traffic_uses_public_internet == true
    not input.bgp_route_origin_validation_enforced
}

bgp_route_hijacking_exposure[_bgp_route_hijacking_exposure_def] if {
    input.api_traffic_uses_public_internet == true
    not input.mtls_enabled
}

exposures contains _bgp_route_hijacking_exposure_def if {
    count(bgp_route_hijacking_exposure) > 0
}

_http_header_injection_in_transit_def := {
    "name": "Http Header Injection In Transit",
    "description": "Intermediate proxies or load balancers that insert or forward attacker-influenced headers (e.g., X-Forwarded-For, Host) without validation can cause the API to act on falsified routing metadata, enabling IP spoofing or request smuggling.",
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
            "relevance": "HTTP header injection in transit is facilitated by adversary-in-the-middle positioning to insert or modify HTTP headers in intercepted traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

http_header_injection_in_transit[_http_header_injection_in_transit_def] if {
    not input.trusted_proxy_header_validation
    count(input.accepted_forwarding_headers) > 0
}

http_header_injection_in_transit[_http_header_injection_in_transit_def] if {
    input.proxy_trust_scope == "all"
    count(input.accepted_forwarding_headers) > 0
}

http_header_injection_in_transit[_http_header_injection_in_transit_def] if {
    not input.header_overwrite_protection_enabled
    count(input.accepted_forwarding_headers) > 0
}

exposures contains _http_header_injection_in_transit_def if {
    count(http_header_injection_in_transit) > 0
}

_insecure_api_gateway_to_backend_leg_def := {
    "name": "Insecure Api Gateway To Backend Leg",
    "description": "TLS is often terminated at an API gateway, and the internal leg to the backend service may revert to plaintext HTTP. An attacker with access to the internal network segment can intercept decrypted API traffic on this unprotected hop.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Insecure backend communication channels can be exploited using protocol tunneling to bypass security controls between the gateway and backend."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unprotected API gateway-to-backend legs can be leveraged for data exfiltration using alternative protocols that bypass monitoring."
        }
    ],
    "attack_vector": "ADJACENT"
}

insecure_api_gateway_to_backend_leg[_insecure_api_gateway_to_backend_leg_def] if {
    input.backend_transport_protocol in ["HTTP", "TCP"]
}

insecure_api_gateway_to_backend_leg[_insecure_api_gateway_to_backend_leg_def] if {
    input.backend_transport_protocol in ["HTTPS", "GRPCS"]
    not input.backend_tls_verification_enabled
}

exposures contains _insecure_api_gateway_to_backend_leg_def if {
    count(insecure_api_gateway_to_backend_leg) > 0
}
