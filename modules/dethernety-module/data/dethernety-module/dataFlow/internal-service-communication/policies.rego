package _dt_built_in.exposures.internal_service_communication



_mutual_tls_not_enforced_def := {
    "name": "Mutual Tls Not Enforced",
    "description": "Services authenticate only the server certificate (one-way TLS) rather than requiring mutual authentication. A rogue or compromised service can inject itself into the communication path and impersonate a legitimate caller without presenting a valid client certificate.",
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
            "relevance": "Without mutual TLS, attackers can intercept and impersonate either party in a connection, enabling adversary-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Lack of mutual TLS allows attackers to use forged or self-signed certificates to impersonate services since client certificates are not validated."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Without mutual TLS enforcement, malicious services can impersonate legitimate ones as there is no cryptographic proof of identity on both sides."
        }
    ]
}

mutual_tls_not_enforced[_mutual_tls_not_enforced_def] if {
    input.mtls_mode == "one_way_tls"
}

mutual_tls_not_enforced[_mutual_tls_not_enforced_def] if {
    input.mtls_mode == "disabled"
}

mutual_tls_not_enforced[_mutual_tls_not_enforced_def] if {
    input.mtls_mode == "permissive"
    input.plaintext_fallback_allowed == true
}

mutual_tls_not_enforced[_mutual_tls_not_enforced_def] if {
    not input.client_certificate_required
}

exposures contains _mutual_tls_not_enforced_def if {
    count(mutual_tls_not_enforced) > 0
}

_certificate_validation_bypass_def := {
    "name": "Certificate Validation Bypass",
    "description": "Services skip or loosen certificate validation (e.g., accepting self-signed certs without pinning, disabling hostname verification) making them vulnerable to man-in-the-middle interception even when TLS is nominally enabled.",
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
            "relevance": "Bypassing certificate validation can be achieved by installing rogue root certificates, undermining the chain of trust."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Certificate validation bypass allows forged or stolen certificates to be accepted, enabling unauthorized authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.003",
            "name": "Install Digital Certificate",
            "relevance": "Attackers can install malicious digital certificates to exploit systems that skip proper certificate validation."
        }
    ]
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.certificate_validation_mode == "skip_all"
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.certificate_validation_mode == "skip_hostname"
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.certificate_validation_mode == true
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.self_signed_certs_accepted_without_pinning == true
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    input.certificate_validation_mode == "custom_no_pinning"
    not input.trusted_ca_bundle_configured
}

certificate_validation_bypass[_certificate_validation_bypass_def] if {
    not input.trusted_ca_bundle_configured
    input.certificate_validation_mode != "full"
}

exposures contains _certificate_validation_bypass_def if {
    count(certificate_validation_bypass) > 0
}

_tls_protocol_downgrade_def := {
    "name": "Tls Protocol Downgrade",
    "description": "Services accept legacy TLS versions (TLS 1.0/1.1) or weak cipher suites, allowing a network attacker to force negotiation to a deprecated protocol susceptible to known cryptographic attacks such as POODLE or BEAST.",
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
            "relevance": "TLS protocol downgrade directly maps to this technique where attackers force use of weaker protocol versions to enable decryption or exploitation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Downgrading TLS effectively weakens the encryption strength, allowing adversaries to intercept or decrypt traffic."
        }
    ]
}

tls_protocol_downgrade[_tls_protocol_downgrade_def] if {
    input.minimum_tls_version == "TLS_1_0"
}

tls_protocol_downgrade[_tls_protocol_downgrade_def] if {
    input.minimum_tls_version == "TLS_1_1"
}

tls_protocol_downgrade[_tls_protocol_downgrade_def] if {
    input.minimum_tls_version == "UNSPECIFIED"
}

tls_protocol_downgrade[_tls_protocol_downgrade_def] if {
    input.weak_cipher_suites_enabled == true
}

tls_protocol_downgrade[_tls_protocol_downgrade_def] if {
    not input.tls_version_downgrade_protection_enabled
    not input.minimum_tls_version in ["TLS_1_2", "TLS_1_3"]
}

exposures contains _tls_protocol_downgrade_def if {
    count(tls_protocol_downgrade) > 0
}

_missing_message_integrity_signing_def := {
    "name": "Missing Message Integrity Signing",
    "description": "Payloads traversing the service mesh lack application-layer digital signatures or HMACs independent of TLS. If TLS is terminated at an intermediary (e.g., sidecar proxy, load balancer), message content can be altered in transit between the termination point and the destination service without detection.",
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
            "relevance": "Without message integrity signing, adversaries can modify messages in transit without detection, a core adversary-in-the-middle capability."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Absence of message signing allows attackers to craft or alter messages impersonating legitimate services without cryptographic proof of origin."
        }
    ]
}

missing_message_integrity_signing[_missing_message_integrity_signing_def] if {
    input.payload_signing_mechanism == "none"
    input.tls_termination_at_intermediary == true
}

missing_message_integrity_signing[_missing_message_integrity_signing_def] if {
    input.payload_signing_mechanism == "none"
    not input.service_mesh_integrity_policy_enforced
}

exposures contains _missing_message_integrity_signing_def if {
    count(missing_message_integrity_signing) > 0
}

_replay_attack_on_service_requests_def := {
    "name": "Replay Attack On Service Requests",
    "description": "Service-to-service API calls lack nonce values, timestamps, or sequence numbers within the message payload. A captured valid request can be replayed by an attacker to trigger duplicate operations, escalate privileges, or exhaust idempotency controls.",
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
            "relevance": "Replay attacks on service requests often involve reusing captured tokens or credentials to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Captured tokens from service requests can be replayed by attackers to impersonate legitimate service calls."
        }
    ]
}

replay_attack_on_service_requests[_replay_attack_on_service_requests_def] if {
    input.request_replay_protection_mechanism == "none"
    not input.replay_window_enforcement_enabled
}

replay_attack_on_service_requests[_replay_attack_on_service_requests_def] if {
    input.request_replay_protection_mechanism == "timestamp_only"
    not input.replay_window_enforcement_enabled
}

exposures contains _replay_attack_on_service_requests_def if {
    count(replay_attack_on_service_requests) > 0
}

_unencrypted_service_discovery_traffic_def := {
    "name": "Unencrypted Service Discovery Traffic",
    "description": "Service registry queries and responses (e.g., Consul, etcd, DNS-SD) are transmitted without encryption or authentication, allowing an attacker to poison service discovery and redirect traffic to a malicious endpoint.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "name": "Network Service Discovery",
            "relevance": "Unencrypted service discovery traffic exposes service topology and endpoints, aiding adversary network reconnaissance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1526",
            "name": "Cloud Service Discovery",
            "relevance": "Unencrypted cloud service discovery traffic allows attackers to enumerate available cloud services and their configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Unencrypted DNS-based service discovery reveals infrastructure details that adversaries can exploit for targeting."
        }
    ]
}

unencrypted_service_discovery_traffic[_unencrypted_service_discovery_traffic_def] if {
    not input.service_discovery_tls_enabled
    input.service_registry_network_exposure in ["internal_cluster", "public"]
}

unencrypted_service_discovery_traffic[_unencrypted_service_discovery_traffic_def] if {
    not input.service_discovery_auth_enabled
    input.service_registry_network_exposure in ["internal_cluster", "public"]
}

unencrypted_service_discovery_traffic[_unencrypted_service_discovery_traffic_def] if {
    not input.service_discovery_tls_enabled
    not input.service_discovery_auth_enabled
}

exposures contains _unencrypted_service_discovery_traffic_def if {
    count(unencrypted_service_discovery_traffic) > 0
}

_absence_of_per_service_rate_limiting_def := {
    "name": "Absence Of Per Service Rate Limiting",
    "description": "No rate limiting or traffic shaping policies are enforced at the inter-service communication layer. A compromised service or a runaway microservice can flood downstream services with requests, causing denial-of-service conditions across the application fabric.",
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
            "relevance": "Without rate limiting, attackers can flood individual services to exhaust resources and cause denial of service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Lack of per-service rate limiting enables application-layer exhaustion attacks targeting specific microservices."
        }
    ]
}

absence_of_per_service_rate_limiting[_absence_of_per_service_rate_limiting_def] if {
    not input.rate_limiting_policy_enforced
    not input.circuit_breaker_configured
}

absence_of_per_service_rate_limiting[_absence_of_per_service_rate_limiting_def] if {
    not input.rate_limiting_policy_enforced
    input.inter_service_traffic_control_mechanism == "none"
}

exposures contains _absence_of_per_service_rate_limiting_def if {
    count(absence_of_per_service_rate_limiting) > 0
}

_certificate_rotation_gap_def := {
    "name": "Certificate Rotation Gap",
    "description": "Long-lived or non-rotating service certificates remain valid well beyond their operational window. If a private key is compromised, the attacker retains the ability to impersonate the service or decrypt recorded traffic for an extended period without revocation enforced.",
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
            "relevance": "Gaps in certificate rotation extend the window during which compromised private keys can be exploited by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Long-lived certificates due to rotation gaps provide attackers more opportunity to steal or forge authentication certificates."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.003",
            "name": "Digital Certificates",
            "relevance": "Certificate rotation gaps allow adversaries more time to discover and exploit certificate information gathered through reconnaissance."
        }
    ]
}

certificate_rotation_gap[_certificate_rotation_gap_def] if {
    input.certificate_max_validity_days > 90
    not input.crl_or_ocsp_enforced
}

certificate_rotation_gap[_certificate_rotation_gap_def] if {
    not input.automatic_rotation_enabled
    not input.crl_or_ocsp_enforced
}

certificate_rotation_gap[_certificate_rotation_gap_def] if {
    input.certificate_max_validity_days > 365
    not input.automatic_rotation_enabled
}

exposures contains _certificate_rotation_gap_def if {
    count(certificate_rotation_gap) > 0
}

_east_west_traffic_not_segmented_def := {
    "name": "East West Traffic Not Segmented",
    "description": "All microservices can communicate freely with one another without network policy or service mesh authorization policies restricting which services are permitted to call which. A compromised service gains unrestricted lateral communication access to all peers.",
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
            "relevance": "Lack of east-west segmentation allows attackers to bridge network boundaries and move laterally between services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Without east-west segmentation, a compromised service can directly exploit remote services across the environment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Unsegmented east-west traffic enables lateral movement by treating internal services as accessible remote services."
        }
    ]
}

east_west_traffic_not_segmented[_east_west_traffic_not_segmented_def] if {
    not input.network_policy_enforced
    not input.service_mesh_authorization_policy_enforced
    not input.default_deny_posture
}

east_west_traffic_not_segmented[_east_west_traffic_not_segmented_def] if {
    input.network_policy_enforced == true
    not input.default_deny_posture
    not input.service_mesh_authorization_policy_enforced
}

east_west_traffic_not_segmented[_east_west_traffic_not_segmented_def] if {
    input.service_mesh_authorization_policy_enforced == true
    not input.default_deny_posture
    not input.network_policy_enforced
}

exposures contains _east_west_traffic_not_segmented_def if {
    count(east_west_traffic_not_segmented) > 0
}

_tls_termination_at_shared_proxy_def := {
    "name": "Tls Termination At Shared Proxy",
    "description": "TLS is terminated at a shared ingress or sidecar layer before re-encryption to the destination, creating a decrypted segment in transit. If the proxy is shared across trust boundaries or is misconfigured, inter-service traffic is exposed in plaintext at that termination point.",
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
            "relevance": "TLS termination at a shared proxy creates a segment of unencrypted traffic, undermining end-to-end encrypted channel guarantees."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.002",
            "name": "Asymmetric Cryptography",
            "relevance": "Shared proxy TLS termination exposes the asymmetric cryptography keys at a shared trust boundary, increasing risk of key compromise."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "A compromised shared proxy can be abused for protocol tunneling to exfiltrate data decrypted during TLS termination."
        }
    ]
}

tls_termination_at_shared_proxy[_tls_termination_at_shared_proxy_def] if {
    not input.tls_reencryption_to_backend_enabled
}

tls_termination_at_shared_proxy[_tls_termination_at_shared_proxy_def] if {
    input.backend_protocol in ["http", "grpc", "tcp_plaintext"]
}

tls_termination_at_shared_proxy[_tls_termination_at_shared_proxy_def] if {
    input.proxy_trust_boundary_scope == "shared_across_trust_boundaries"
    not input.tls_reencryption_to_backend_enabled
}

tls_termination_at_shared_proxy[_tls_termination_at_shared_proxy_def] if {
    input.proxy_trust_boundary_scope == "unknown"
    not input.tls_reencryption_to_backend_enabled
}

exposures contains _tls_termination_at_shared_proxy_def if {
    count(tls_termination_at_shared_proxy) > 0
}
