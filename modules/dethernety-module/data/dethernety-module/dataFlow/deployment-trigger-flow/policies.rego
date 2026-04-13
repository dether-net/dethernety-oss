package _dt_built_in.exposures.deployment_trigger_flow

_missing_mutual_tls_authentication_def := {
    "name": "Missing Mutual Tls Authentication",
    "description": "If only server-side TLS is enforced, the API server cannot cryptographically verify that the caller is a legitimate pipeline engine. An attacker who can route traffic to the API server endpoint (or sit on the same network segment) can submit manifests as if they were the pipeline, injecting arbitrary workloads without a valid pipeline client certificate.",
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
            "relevance": "Absence of mutual TLS allows attackers to bypass certificate-based authentication, enabling forged or stolen certificates to impersonate clients or servers."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    not input.mtls_enforced
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.client_certificate_validation_mode in ["optional", "none"]
}

missing_mutual_tls_authentication[_missing_mutual_tls_authentication_def] if {
    input.mtls_enforced == true
    not input.certificate_pinning_enabled
    input.client_certificate_validation_mode != "required"
}

exposures contains _missing_mutual_tls_authentication_def if {
    count(missing_mutual_tls_authentication) > 0
}

_weak_or_expired_tls_certificate_validation_def := {
    "name": "Weak Or Expired Tls Certificate Validation",
    "description": "If the pipeline engine does not strictly validate the API server's certificate chain, hostname, and expiry \u2014 or accepts self-signed certificates without pinning \u2014 an adversary performing an on-path attack can present a fraudulent certificate. This allows decryption of manifests, exfiltration of image references, and injection of modified deployment payloads.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.003",
            "name": "Digital Certificates",
            "relevance": "Weak or expired certificate validation allows attackers to exploit improperly validated certificates to intercept or spoof communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Failure to properly validate TLS certificates enables attackers to use forged or stolen certificates to impersonate legitimate endpoints."
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_or_expired_tls_certificate_validation[_weak_or_expired_tls_certificate_validation_def] if {
    not input.tls_certificate_validation_enforced
}

weak_or_expired_tls_certificate_validation[_weak_or_expired_tls_certificate_validation_def] if {
    input.api_server_certificate_issuer_type == "self_signed"
    not input.self_signed_certificate_pinning_configured
}

weak_or_expired_tls_certificate_validation[_weak_or_expired_tls_certificate_validation_def] if {
    input.api_server_certificate_issuer_type == "unknown"
    not input.tls_certificate_validation_enforced
}

exposures contains _weak_or_expired_tls_certificate_validation_def if {
    count(weak_or_expired_tls_certificate_validation) > 0
}

_deprecated_tls_protocol_or_weak_cipher_suite_def := {
    "name": "Deprecated Tls Protocol Or Weak Cipher Suite",
    "description": "Use of TLS 1.0/1.1, export-grade ciphers, RC4, or non-AEAD cipher suites on the pipeline-to-API-server channel allows downgrade or cryptanalytic attacks. An adversary who captures traffic can exploit algorithmic weaknesses to recover plaintext deployment manifests and bearer tokens.",
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
            "relevance": "Use of deprecated TLS protocols or weak cipher suites directly corresponds to weakened encryption that attackers can exploit to decrypt traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.001",
            "name": "Symmetric Cryptography",
            "relevance": "Weak cipher suites in TLS sessions undermine the symmetric cryptography used to protect data in transit."
        }
    ],
    "attack_vector": "NETWORK"
}

deprecated_tls_protocol_or_weak_cipher_suite[_deprecated_tls_protocol_or_weak_cipher_suite_def] if {
    input.minimum_tls_version in ["TLS_1_0", "TLS_1_1"]
}

deprecated_tls_protocol_or_weak_cipher_suite[_deprecated_tls_protocol_or_weak_cipher_suite_def] if {
    "RC4" in input.enabled_cipher_suites
}

deprecated_tls_protocol_or_weak_cipher_suite[_deprecated_tls_protocol_or_weak_cipher_suite_def] if {
    not input.weak_cipher_suites_explicitly_restricted
}

exposures contains _deprecated_tls_protocol_or_weak_cipher_suite_def if {
    count(deprecated_tls_protocol_or_weak_cipher_suite) > 0
}

_deployment_manifest_replay_attack_def := {
    "name": "Deployment Manifest Replay Attack",
    "description": "If the API channel does not enforce nonces, timestamps, or sequence numbers on deployment requests, a recorded valid request carrying a signed manifest can be replayed by an attacker. This re-triggers previously authorized deployments \u2014 potentially downgrading images to vulnerable versions or re-deploying deprecated workloads \u2014 without re-authenticating.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1610",
            "name": "Deploy Container",
            "relevance": "Replaying captured deployment manifests can cause unauthorized container deployments, directly exploiting the deployment pipeline."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Replay attacks may reuse captured tokens or credentials embedded in manifests to authenticate and execute deployments."
        }
    ],
    "attack_vector": "NETWORK"
}

deployment_manifest_replay_attack[_deployment_manifest_replay_attack_def] if {
    input.replay_protection_mechanism == "none"
}

deployment_manifest_replay_attack[_deployment_manifest_replay_attack_def] if {
    input.replay_protection_mechanism == "timestamp_only"
    input.deployment_token_max_ttl_seconds > 3600
}

deployment_manifest_replay_attack[_deployment_manifest_replay_attack_def] if {
    not input.replay_protection_mechanism in ["nonce", "sequence_number", "combined"]
    not input.admission_webhook_replay_validation_enabled
}

exposures contains _deployment_manifest_replay_attack_def if {
    count(deployment_manifest_replay_attack) > 0
}

_bearer_token_interception_over_insufficiently_protected_channel_def := {
    "name": "Bearer Token Interception Over Insufficiently Protected Channel",
    "description": "Pipeline engines frequently authenticate to the API server using short-lived bearer tokens or service account JWTs. If TLS termination occurs at an intermediate proxy that does not re-encrypt to the API server, or if tokens appear in URL query parameters logged by network infrastructure, tokens can be harvested from network traffic or logs and replayed to submit unauthorized deployments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Bearer tokens transmitted over unprotected channels can be intercepted and stolen for unauthorized API access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Intercepted bearer tokens can be directly reused by attackers to authenticate as legitimate users without credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_token_interception_over_insufficiently_protected_channel[_bearer_token_interception_over_insufficiently_protected_channel_def] if {
    input.tls_termination_at_proxy_without_reencryption == true
}

bearer_token_interception_over_insufficiently_protected_channel[_bearer_token_interception_over_insufficiently_protected_channel_def] if {
    input.bearer_token_in_url_query_params == true
}

bearer_token_interception_over_insufficiently_protected_channel[_bearer_token_interception_over_insufficiently_protected_channel_def] if {
    not input.mtls_enforced
}

exposures contains _bearer_token_interception_over_insufficiently_protected_channel_def if {
    count(bearer_token_interception_over_insufficiently_protected_channel) > 0
}

_in_transit_manifest_tampering_without_payload_signing_def := {
    "name": "In Transit Manifest Tampering Without Payload Signing",
    "description": "Even over TLS, if deployment manifests are not additionally signed at the application layer (e.g., via Sigstore/cosign attestations or HMAC), a compromised TLS-terminating proxy or an on-path device performing legitimate TLS inspection can silently modify image tags, resource limits, security contexts, or namespace targets before the payload reaches the API server.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.003",
            "name": "SIP and Trust Provider Hijacking",
            "relevance": "Without payload signing, attackers can tamper with manifests in transit by subverting trust verification mechanisms."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Lack of manifest signing means attackers can modify payloads without valid certificate-based integrity checks detecting the tampering."
        }
    ],
    "attack_vector": "ADJACENT"
}

in_transit_manifest_tampering_without_payload_signing[_in_transit_manifest_tampering_without_payload_signing_def] if {
    not input.manifest_payload_signing_enabled
    input.tls_inspection_or_proxy_present == true
}

in_transit_manifest_tampering_without_payload_signing[_in_transit_manifest_tampering_without_payload_signing_def] if {
    not input.manifest_payload_signing_enabled
    not input.admission_controller_attestation_validation
}

exposures contains _in_transit_manifest_tampering_without_payload_signing_def if {
    count(in_transit_manifest_tampering_without_payload_signing) > 0
}

_absence_of_api_rate_limiting_enabling_deployment_flood_def := {
    "name": "Absence Of Api Rate Limiting Enabling Deployment Flood",
    "description": "Without rate limiting or request throttling on the pipeline-to-API-server channel, an attacker who has obtained pipeline credentials \u2014 or who compromises the pipeline engine \u2014 can flood the API server with deployment requests. This exhausts control-plane resources, disrupts scheduling of legitimate workloads, and can force the orchestrator into degraded states where security controls are bypassed.",
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
            "relevance": "Without rate limiting, attackers can flood the API with deployment requests, exhausting control plane resources and causing denial of service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.009",
            "name": "Cloud API",
            "relevance": "Attackers can abuse cloud APIs without rate limiting to programmatically trigger excessive deployments and disrupt operations."
        }
    ],
    "attack_vector": "NETWORK"
}

absence_of_api_rate_limiting_enabling_deployment_flood[_absence_of_api_rate_limiting_enabling_deployment_flood_def] if {
    not input.api_server_rate_limiting_enabled
    not input.pipeline_service_account_quota_enforced
}

absence_of_api_rate_limiting_enabling_deployment_flood[_absence_of_api_rate_limiting_enabling_deployment_flood_def] if {
    not input.api_server_rate_limiting_enabled
    not input.pipeline_service_account_quota_enforced
}

absence_of_api_rate_limiting_enabling_deployment_flood[_absence_of_api_rate_limiting_enabling_deployment_flood_def] if {
    not input.api_server_rate_limiting_enabled
    not input.pipeline_service_account_quota_enforced
}

exposures contains _absence_of_api_rate_limiting_enabling_deployment_flood_def if {
    count(absence_of_api_rate_limiting_enabling_deployment_flood) > 0
}

_unencrypted_or_cleartext_fallback_channel_def := {
    "name": "Unencrypted Or Cleartext Fallback Channel",
    "description": "Some orchestration API configurations permit HTTP fallback or have insecure-port bindings enabled. If the pipeline engine's connection attempt fails and downgrades to plaintext HTTP, all deployment manifests, image references, and authentication tokens traverse the network in cleartext, fully exposing the flow to passive eavesdropping and active injection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "name": "Web Protocols",
            "relevance": "Cleartext fallback channels allow attackers to intercept or inject data into communications using standard web protocols without encryption."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unencrypted fallback channels can be exploited for data exfiltration over alternative unmonitored protocols."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_or_cleartext_fallback_channel[_unencrypted_or_cleartext_fallback_channel_def] if {
    input.insecure_port_enabled == true
}

unencrypted_or_cleartext_fallback_channel[_unencrypted_or_cleartext_fallback_channel_def] if {
    input.api_server_scheme == "http"
}

unencrypted_or_cleartext_fallback_channel[_unencrypted_or_cleartext_fallback_channel_def] if {
    input.tls_skip_verify_enabled == true
}

unencrypted_or_cleartext_fallback_channel[_unencrypted_or_cleartext_fallback_channel_def] if {
    not input.api_server_scheme
}

exposures contains _unencrypted_or_cleartext_fallback_channel_def if {
    count(unencrypted_or_cleartext_fallback_channel) > 0
}

_bgp_or_dns_route_hijacking_redirecting_api_traffic_def := {
    "name": "Bgp Or Dns Route Hijacking Redirecting Api Traffic",
    "description": "The pipeline engine resolves the API server hostname via DNS and routes packets across potentially shared network fabric. DNS poisoning or BGP route hijacking can redirect the pipeline's TLS connection to an adversary-controlled endpoint. Without certificate pinning or DNSSEC validation, the pipeline engine may complete the TLS handshake with the attacker, submitting manifests and credentials to an illegitimate server.",
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
            "relevance": "DNS hijacking directly enables redirection of API traffic by compromising DNS infrastructure to resolve domains to attacker-controlled endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.004",
            "name": "Domain Fronting",
            "relevance": "BGP or DNS route hijacking can be combined with domain fronting techniques to covertly redirect and intercept API communications."
        }
    ],
    "attack_vector": "NETWORK"
}

bgp_or_dns_route_hijacking_redirecting_api_traffic[_bgp_or_dns_route_hijacking_redirecting_api_traffic_def] if {
    input.api_server_endpoint_type == "dns_hostname"
    not input.certificate_pinning_enabled
    not input.dnssec_validation_enforced
}

bgp_or_dns_route_hijacking_redirecting_api_traffic[_bgp_or_dns_route_hijacking_redirecting_api_traffic_def] if {
    input.api_server_endpoint_type == "dns_hostname"
    not input.certificate_pinning_enabled
}

exposures contains _bgp_or_dns_route_hijacking_redirecting_api_traffic_def if {
    count(bgp_or_dns_route_hijacking_redirecting_api_traffic) > 0
}

_absence_of_certificate_revocation_checking_def := {
    "name": "Absence Of Certificate Revocation Checking",
    "description": "If the pipeline engine does not perform OCSP stapling checks or CRL validation when connecting to the API server, a compromised or stolen API server certificate that has been revoked will still be accepted as valid. This allows an attacker using a revoked certificate to impersonate the API server without detection, intercepting deployment payloads.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.003",
            "name": "Install Digital Certificate",
            "relevance": "Without revocation checking, attackers can use previously compromised or revoked certificates to authenticate, as installations of malicious certificates go undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Absence of revocation checking allows stolen or forged certificates to remain valid for authentication indefinitely after compromise."
        }
    ],
    "attack_vector": "NETWORK"
}

absence_of_certificate_revocation_checking[_absence_of_certificate_revocation_checking_def] if {
    not input.certificate_revocation_mode
    not input.certificate_revocation_mode
}

absence_of_certificate_revocation_checking[_absence_of_certificate_revocation_checking_def] if {
    input.certificate_revocation_mode == "none"
}

exposures contains _absence_of_certificate_revocation_checking_def if {
    count(absence_of_certificate_revocation_checking) > 0
}

_oversized_manifest_payload_causing_control_plane_disruption_def := {
    "name": "Oversized Manifest Payload Causing Control Plane Disruption",
    "description": "The API server accepts JSON/YAML manifests of variable size. Without maximum payload size enforcement on the transit channel or API gateway, an attacker or malfunctioning pipeline can submit extremely large manifests that consume API server memory and parsing capacity, degrading availability for legitimate deployments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.013",
            "name": "Container CLI/API",
            "relevance": "Oversized manifest payloads submitted via container APIs can overwhelm and disrupt the control plane processing resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.009",
            "name": "Embedded Payloads",
            "relevance": "Attackers may embed excessively large or malicious content within manifest payloads to disrupt control plane parsing and processing."
        }
    ],
    "attack_vector": "NETWORK"
}

oversized_manifest_payload_causing_control_plane_disruption[_oversized_manifest_payload_causing_control_plane_disruption_def] if {
    input.api_gateway_payload_limit_enforced <= 0
    not input.api_gateway_payload_limit_enforced
    not input.admission_webhook_manifest_size_validation
}

oversized_manifest_payload_causing_control_plane_disruption[_oversized_manifest_payload_causing_control_plane_disruption_def] if {
    not input.api_gateway_payload_limit_enforced
    not input.admission_webhook_manifest_size_validation
    input.api_gateway_payload_limit_enforced == 0
}

exposures contains _oversized_manifest_payload_causing_control_plane_disruption_def if {
    count(oversized_manifest_payload_causing_control_plane_disruption) > 0
}
