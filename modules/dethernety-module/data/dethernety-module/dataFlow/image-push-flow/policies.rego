package _dt_built_in.exposures.image_push_flow



_unencrypted_or_downgraded_registry_transport_def := {
    "name": "Unencrypted Or Downgraded Registry Transport",
    "description": "Registry push traffic conducted over plain HTTP or subject to TLS downgrade attacks (STARTTLS stripping, SSLstrip, weak cipher negotiation) allows an on-path attacker to intercept and replace image layers or manifests in transit without detection.",
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
            "relevance": "Unencrypted registry transport allows attackers to capture credentials and layer data via network sniffing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "name": "Web Protocols",
            "relevance": "Downgraded or plaintext HTTP registry communication exposes data to interception over web protocols."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_or_downgraded_registry_transport[_unencrypted_or_downgraded_registry_transport_def] if {
    not input.registry_tls_enforced
}

unencrypted_or_downgraded_registry_transport[_unencrypted_or_downgraded_registry_transport_def] if {
    input.minimum_tls_version in ["ssl3", "tls1.0", "tls1.1"]
}

unencrypted_or_downgraded_registry_transport[_unencrypted_or_downgraded_registry_transport_def] if {
    input.insecure_registry_configured == true
}

unencrypted_or_downgraded_registry_transport[_unencrypted_or_downgraded_registry_transport_def] if {
    not input.registry_ca_validation_enforced
}

exposures contains _unencrypted_or_downgraded_registry_transport_def if {
    count(unencrypted_or_downgraded_registry_transport) > 0
}

_missing_mutual_tls_on_registry_push_def := {
    "name": "Missing Mutual Tls On Registry Push",
    "description": "Registry endpoints that authenticate only the server (standard TLS) but do not require client certificate authentication allow any network-reachable actor with valid credentials to impersonate the CI/CD pipeline and push unauthorized or malicious images, bypassing pipeline-enforced signing and scanning gates.",
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
            "relevance": "Absence of mutual TLS means certificate validation is incomplete, enabling attackers to exploit certificate weaknesses during registry push."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Without mutual TLS, forged or stolen certificates can be used to impersonate clients or servers during registry push operations."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_on_registry_push[_missing_mutual_tls_on_registry_push_def] if {
    not input.mutual_tls_enforced
    input.registry_network_exposure == "public"
}

missing_mutual_tls_on_registry_push[_missing_mutual_tls_on_registry_push_def] if {
    not input.mutual_tls_enforced
    input.registry_network_exposure == "internal"
}

missing_mutual_tls_on_registry_push[_missing_mutual_tls_on_registry_push_def] if {
    input.mutual_tls_enforced == true
    not input.client_cert_validation_configured
    not input.registry_network_exposure in ["isolated"]
}

exposures contains _missing_mutual_tls_on_registry_push_def if {
    count(missing_mutual_tls_on_registry_push) > 0
}

_layer_manifest_integrity_not_verified_in_transit_def := {
    "name": "Layer Manifest Integrity Not Verified In Transit",
    "description": "If the registry client does not verify content-addressable digests (SHA-256) of each layer blob against the manifest during transmission, a network adversary can substitute a layer in transit. The registry may store and serve a tampered image that passes name/tag checks but contains malicious content.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.003",
            "name": "SIP and Trust Provider Hijacking",
            "relevance": "Failure to verify manifest integrity in transit allows attackers to tamper with trust validation mechanisms similar to SIP/trust provider hijacking."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1574.001",
            "name": "DLL Search Order Hijacking",
            "relevance": "Unverified layer manifests in transit can allow substitution of malicious content analogous to hijacking legitimate loading processes."
        }
    ],
    "attack_vector": "NETWORK"
}

layer_manifest_integrity_not_verified_in_transit[_layer_manifest_integrity_not_verified_in_transit_def] if {
    not input.digest_verification_enabled
}

layer_manifest_integrity_not_verified_in_transit[_layer_manifest_integrity_not_verified_in_transit_def] if {
    not input.manifest_digest_pinning_enforced
    input.registry_transport_protocol == "http"
}

layer_manifest_integrity_not_verified_in_transit[_layer_manifest_integrity_not_verified_in_transit_def] if {
    not input.manifest_digest_pinning_enforced
    not input.digest_verification_enabled
}

exposures contains _layer_manifest_integrity_not_verified_in_transit_def if {
    count(layer_manifest_integrity_not_verified_in_transit) > 0
}

_cryptographic_signature_stripped_or_suppressed_in_transit_def := {
    "name": "Cryptographic Signature Stripped Or Suppressed In Transit",
    "description": "Cosign/Notary signature objects or ORAS attestation blobs are transmitted as separate registry API calls after the main manifest push. An on-path attacker or a man-in-the-middle with TLS interception can drop or corrupt these calls so the registry stores the image without attached signatures, causing signature verification to fail silently at deployment if absence is not treated as a policy violation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.002",
            "name": "Code Signing",
            "relevance": "Stripping or suppressing cryptographic signatures subverts code signing verification, allowing unsigned or malicious images to be accepted."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.003",
            "name": "SIP and Trust Provider Hijacking",
            "relevance": "Suppressing signatures in transit mirrors SIP/trust provider hijacking by undermining the integrity verification chain."
        }
    ],
    "attack_vector": "NETWORK"
}

cryptographic_signature_stripped_or_suppressed_in_transit[_cryptographic_signature_stripped_or_suppressed_in_transit_def] if {
    not input.signature_push_atomic_with_manifest
    not input.signature_presence_verified_post_push
}

cryptographic_signature_stripped_or_suppressed_in_transit[_cryptographic_signature_stripped_or_suppressed_in_transit_def] if {
    input.registry_signature_policy_enforcement in ["warn", "none"]
    not input.signature_push_atomic_with_manifest
}

cryptographic_signature_stripped_or_suppressed_in_transit[_cryptographic_signature_stripped_or_suppressed_in_transit_def] if {
    input.tls_inspection_present_on_registry_path == true
    not input.signature_push_atomic_with_manifest
    not input.signature_presence_verified_post_push
}

exposures contains _cryptographic_signature_stripped_or_suppressed_in_transit_def if {
    count(cryptographic_signature_stripped_or_suppressed_in_transit) > 0
}

_replay_attack_on_manifest_or_layer_push_def := {
    "name": "Replay Attack On Manifest Or Layer Push",
    "description": "Registry push APIs that lack request-level nonces, timestamps, or monotonic sequence controls are vulnerable to replay attacks where a captured authenticated push request is retransmitted to re-publish a previously valid but now superseded or vulnerable image version under the same tag, effectively rolling back security fixes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Replay attacks on manifest or layer push can leverage stolen authentication tokens or certificates to re-submit previously captured requests."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601.001",
            "name": "Patch System Image",
            "relevance": "Replaying a manipulated manifest or layer push can result in a patched or substituted image being accepted by the registry."
        }
    ],
    "attack_vector": "NETWORK"
}

replay_attack_on_manifest_or_layer_push[_replay_attack_on_manifest_or_layer_push_def] if {
    not input.push_request_replay_protection_enabled
}

replay_attack_on_manifest_or_layer_push[_replay_attack_on_manifest_or_layer_push_def] if {
    not input.push_request_replay_protection_enabled
    input.push_token_max_validity_seconds > 3600
}

replay_attack_on_manifest_or_layer_push[_replay_attack_on_manifest_or_layer_push_def] if {
    not input.push_request_replay_protection_enabled
    not input.tag_immutability_enforced
}

exposures contains _replay_attack_on_manifest_or_layer_push_def if {
    count(replay_attack_on_manifest_or_layer_push) > 0
}

_dns_or_bgp_route_hijacking_to_rogue_registry_def := {
    "name": "Dns Or Bgp Route Hijacking To Rogue Registry",
    "description": "If the pipeline resolves the registry hostname without DNSSEC validation or certificate pinning, DNS poisoning or BGP route hijacking can redirect push traffic to an attacker-controlled registry endpoint that presents a valid certificate via a compromised CA. The pipeline successfully authenticates and pushes signed artifacts to the wrong registry, which may then serve tampered images.",
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
            "relevance": "DNS hijacking directly redirects registry traffic to a rogue registry by compromising DNS resolution infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Rogue registries reached via DNS/BGP hijacking may present forged certificates to complete the MITM attack."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_or_bgp_route_hijacking_to_rogue_registry[_dns_or_bgp_route_hijacking_to_rogue_registry_def] if {
    not input.dnssec_validation_enabled
    not input.registry_certificate_pinning_configured
}

dns_or_bgp_route_hijacking_to_rogue_registry[_dns_or_bgp_route_hijacking_to_rogue_registry_def] if {
    not input.dnssec_validation_enabled
    not input.registry_endpoint_uses_static_ip_or_verified_hostname
}

exposures contains _dns_or_bgp_route_hijacking_to_rogue_registry_def if {
    count(dns_or_bgp_route_hijacking_to_rogue_registry) > 0
}

_absent_rate_limiting_enabling_layer_flood_or_enumeration_def := {
    "name": "Absent Rate Limiting Enabling Layer Flood Or Enumeration",
    "description": "Registry push endpoints without ingress rate limiting or connection throttling can be abused by an attacker with push credentials to flood the registry with oversized or numerous layer blobs (storage exhaustion) or to enumerate existing layer digests through repeated push probes, mapping the artifact graph of private images.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Without rate limiting, attackers can enumerate registry contents and harvest layer/manifest data from the repository."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.002",
            "name": "Credentials in Registry",
            "relevance": "Unrestricted enumeration requests can expose stored credentials or sensitive configuration within registry metadata."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_rate_limiting_enabling_layer_flood_or_enumeration[_absent_rate_limiting_enabling_layer_flood_or_enumeration_def] if {
    not input.registry_push_rate_limiting_enabled
    not input.registry_push_connection_throttling_enabled
}

absent_rate_limiting_enabling_layer_flood_or_enumeration[_absent_rate_limiting_enabling_layer_flood_or_enumeration_def] if {
    not input.registry_push_rate_limiting_enabled
    not input.push_credential_scope_restriction
}

exposures contains _absent_rate_limiting_enabling_layer_flood_or_enumeration_def if {
    count(absent_rate_limiting_enabling_layer_flood_or_enumeration) > 0
}

_weak_or_reused_registry_push_credentials_over_network_def := {
    "name": "Weak Or Reused Registry Push Credentials Over Network",
    "description": "Long-lived static registry tokens or basic auth credentials transmitted at the start of each TLS session are susceptible to credential harvesting if TLS inspection proxies, logging middleware, or network taps capture request headers. Reused tokens across pipeline stages mean a single credential capture grants persistent unauthorized push access without requiring further network compromise.",
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
            "relevance": "Weak or reused credentials transmitted over the network can be intercepted and reused as application access tokens for unauthorized registry pushes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Compromised registry credentials enable attackers to use application access tokens to authenticate and push malicious images."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_reused_registry_push_credentials_over_network[_weak_or_reused_registry_push_credentials_over_network_def] if {
    input.registry_auth_method in ["static_token", "basic_auth", "none"]
}

weak_or_reused_registry_push_credentials_over_network[_weak_or_reused_registry_push_credentials_over_network_def] if {
    input.credential_shared_across_pipeline_stages == true
    input.credential_rotation_days > 90
}

weak_or_reused_registry_push_credentials_over_network[_weak_or_reused_registry_push_credentials_over_network_def] if {
    input.credential_shared_across_pipeline_stages == true
    input.credential_rotation_days == 0
}

exposures contains _weak_or_reused_registry_push_credentials_over_network_def if {
    count(weak_or_reused_registry_push_credentials_over_network) > 0
}

_tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca_def := {
    "name": "Tls Certificate Pinning Absent Allowing Mitm Via Rogue Ca",
    "description": "Without certificate pinning or HPKP-equivalent controls on the CI/CD pipeline's registry client, an attacker who compromises or coerces a trusted CA can issue a fraudulent certificate for the registry hostname and intercept mutually encrypted push traffic, silently proxying or modifying image layers while the pipeline reports a successful push.",
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
            "relevance": "Without certificate pinning, a rogue CA can install a trusted root certificate to intercept TLS traffic to the registry undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Absence of pinning allows forged certificates from a compromised CA to enable MITM attacks against registry communications."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca[_tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca_def] if {
    not input.registry_certificate_pinning_configured
    input.registry_tls_ca_scope == "system"
}

tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca[_tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca_def] if {
    not input.registry_hostname_verified
}

tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca[_tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca_def] if {
    not input.registry_certificate_pinning_configured
    input.registry_tls_ca_scope == "none"
}

exposures contains _tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca_def if {
    count(tls_certificate_pinning_absent_allowing_mitm_via_rogue_ca) > 0
}

_chunked_upload_resumption_without_integrity_checkpoint_def := {
    "name": "Chunked Upload Resumption Without Integrity Checkpoint",
    "description": "OCI distribution-spec chunked blob uploads using the PATCH endpoint allow resumable transfers. If intermediate chunks are not individually digest-verified before the final POST completes the upload, an on-path attacker can corrupt or replace a middle chunk. The registry assembles and stores a tampered layer whose final digest may not be rechecked against the manifest until client-side verification, which is often skipped.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.001",
            "name": "Upload Malware",
            "relevance": "Chunked upload resumption without integrity checks allows an attacker to inject malicious content into a partially uploaded layer."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1612",
            "name": "Build Image on Host",
            "relevance": "Lack of integrity checkpoints during resumable uploads can enable a malicious image to be assembled and stored in the registry."
        }
    ],
    "attack_vector": "NETWORK"
}

chunked_upload_resumption_without_integrity_checkpoint[_chunked_upload_resumption_without_integrity_checkpoint_def] if {
    not input.chunk_digest_verification_enabled
    not input.final_digest_recheck_enforced
}

chunked_upload_resumption_without_integrity_checkpoint[_chunked_upload_resumption_without_integrity_checkpoint_def] if {
    not input.chunk_digest_verification_enabled
    not input.mutual_tls_enforced
}

exposures contains _chunked_upload_resumption_without_integrity_checkpoint_def if {
    count(chunked_upload_resumption_without_integrity_checkpoint) > 0
}

_insecure_proxy_or_pull_through_cache_in_transit_path_def := {
    "name": "Insecure Proxy Or Pull-Through Cache In Transit Path",
    "description": "Pull-through cache proxies or corporate HTTP proxies inserted between the CI/CD engine and the upstream registry may terminate TLS, cache manifest responses without revalidation, and serve stale or attacker-injected manifest versions. If the pipeline does not validate end-to-end digest continuity, a stale cached manifest pointing to a vulnerable layer digest will be accepted as current.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "An insecure pull-through cache or proxy in the transit path can act as a multi-hop proxy to intercept and modify registry traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "A compromised pull-through cache can serve poisoned image layers to consumers, effectively poisoning the delivery pipeline."
        }
    ],
    "attack_vector": "NETWORK"
}

insecure_proxy_or_pull_through_cache_in_transit_path[_insecure_proxy_or_pull_through_cache_in_transit_path_def] if {
    input.proxy_in_registry_transit_path == true
    input.tls_inspection_present_on_registry_path == true
    not input.manifest_digest_pinning_enforced
}

insecure_proxy_or_pull_through_cache_in_transit_path[_insecure_proxy_or_pull_through_cache_in_transit_path_def] if {
    input.proxy_in_registry_transit_path == true
    not input.tls_inspection_present_on_registry_path
    not input.manifest_digest_pinning_enforced
}

exposures contains _insecure_proxy_or_pull_through_cache_in_transit_path_def if {
    count(insecure_proxy_or_pull_through_cache_in_transit_path) > 0
}
