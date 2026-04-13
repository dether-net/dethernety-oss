package _dt_built_in.exposures.artifact_promotion_flow



_absent_mutual_tls_on_artifact_push_def := {
    "name": "Absent Mutual Tls On Artifact Push",
    "description": "The pipeline pushes artifacts to the registry using one-way TLS (server-authenticated only), allowing a network-positioned adversary to impersonate the registry endpoint, accept uploaded artifacts, and return forged responses without the pipeline detecting the substitution.",
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
            "relevance": "Absence of mutual TLS allows an attacker to bypass certificate-based authentication, enabling theft or forgery of credentials used during artifact push."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.003",
            "name": "SIP and Trust Provider Hijacking",
            "relevance": "Without mutual TLS, trust validation during artifact push can be subverted, similar to hijacking trust providers to accept unauthorized artifacts."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_mutual_tls_on_artifact_push[_absent_mutual_tls_on_artifact_push_def] if {
    not input.mutual_tls_enforced
}

absent_mutual_tls_on_artifact_push[_absent_mutual_tls_on_artifact_push_def] if {
    not input.mutual_tls_enforced
}

absent_mutual_tls_on_artifact_push[_absent_mutual_tls_on_artifact_push_def] if {
    input.registry_transport_protocol == "http_plaintext"
}

absent_mutual_tls_on_artifact_push[_absent_mutual_tls_on_artifact_push_def] if {
    input.registry_transport_protocol == "https_one_way_tls"
}

exposures contains _absent_mutual_tls_on_artifact_push_def if {
    count(absent_mutual_tls_on_artifact_push) > 0
}

_weak_or_expired_tls_cipher_negotiation_def := {
    "name": "Weak Or Expired Tls Cipher Negotiation",
    "description": "The TLS session between the pipeline and registry negotiates deprecated cipher suites (e.g., RC4, 3DES, CBC-mode without AEAD) or uses TLS 1.1 or below, exposing artifact streams to passive decryption or active downgrade attacks by a network adversary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.001",
            "name": "Symmetric Cryptography",
            "relevance": "Weak or expired TLS cipher negotiation undermines the symmetric encryption layer protecting data in transit, enabling interception or decryption of communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.002",
            "name": "Asymmetric Cryptography",
            "relevance": "Expired or weak TLS ciphers compromise asymmetric key exchange mechanisms, allowing adversaries to perform downgrade or man-in-the-middle attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_expired_tls_cipher_negotiation[_weak_or_expired_tls_cipher_negotiation_def] if {
    input.minimum_tls_version in ["TLS_1_0", "TLS_1_1"]
}

weak_or_expired_tls_cipher_negotiation[_weak_or_expired_tls_cipher_negotiation_def] if {
    count(input.deprecated_cipher_suites_enabled) > 0
}

weak_or_expired_tls_cipher_negotiation[_weak_or_expired_tls_cipher_negotiation_def] if {
    not input.tls_downgrade_protection_enabled
}

exposures contains _weak_or_expired_tls_cipher_negotiation_def if {
    count(weak_or_expired_tls_cipher_negotiation) > 0
}

_pipeline_service_identity_overprivileged_write_token_def := {
    "name": "Pipeline Service Identity Overprivileged Write Token",
    "description": "The pipeline authenticates to the registry using a broadly scoped credential (e.g., a registry admin token or wildcard repository write permission) rather than a least-privilege service identity scoped to specific repositories. If the credential is captured in transit or via replay, the attacker gains write access to all registry namespaces.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.002",
            "name": "Credentials in Registry",
            "relevance": "Overprivileged write tokens for pipeline service identities are a form of excessive credential exposure that attackers can harvest and abuse."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "An overprivileged pipeline service token can be stolen or forged to gain unauthorized write access to registries or artifact repositories."
        }
    ],
    "attack_vector": "NETWORK"
}

pipeline_service_identity_overprivileged_write_token[_pipeline_service_identity_overprivileged_write_token_def] if {
    input.registry_credential_scope in ["namespace_scoped", "registry_admin"]
}

pipeline_service_identity_overprivileged_write_token[_pipeline_service_identity_overprivileged_write_token_def] if {
    not input.pipeline_uses_dedicated_service_identity
    input.registry_credential_scope != "repository_scoped"
}

exposures contains _pipeline_service_identity_overprivileged_write_token_def if {
    count(pipeline_service_identity_overprivileged_write_token) > 0
}

_bearer_token_replay_on_registry_push_def := {
    "name": "Bearer Token Replay On Registry Push",
    "description": "Short-lived bearer tokens used to authenticate artifact push operations lack replay protection mechanisms (e.g., no nonce binding, no token binding extension, insufficient expiry windows). A token captured from a prior session or via TLS inspection can be replayed to push malicious artifacts under the pipeline's identity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Bearer token replay directly maps to the use of stolen application access tokens to authenticate and push artifacts to a registry without valid credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "The attack vector involves stealing a bearer token to replay it for unauthorized registry push operations."
        }
    ],
    "attack_vector": "NETWORK"
}

bearer_token_replay_on_registry_push[_bearer_token_replay_on_registry_push_def] if {
    input.token_max_lifetime_seconds > 300
    not input.token_binding_enforced
    not input.mutual_tls_enforced
}

bearer_token_replay_on_registry_push[_bearer_token_replay_on_registry_push_def] if {
    not input.token_binding_enforced
    not input.mutual_tls_enforced
    not input.token_max_lifetime_seconds
}

exposures contains _bearer_token_replay_on_registry_push_def if {
    count(bearer_token_replay_on_registry_push) > 0
}

_sbom_and_signature_stripped_in_transit_def := {
    "name": "Sbom And Signature Stripped In Transit",
    "description": "SBOMs and detached cryptographic signatures are transmitted as separate HTTP requests or metadata fields after the primary artifact upload. A man-in-the-middle or a protocol-level proxy can selectively drop these requests, causing the registry to store unsigned, uninventoried artifacts that downstream systems may accept if signature presence is not enforced at ingestion.",
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
            "relevance": "Stripping signatures in transit undermines code signing trust, analogous to subverting trust providers that validate artifact integrity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.002",
            "name": "Code Signing Certificates",
            "relevance": "Removing SBOM and signatures from artifacts in transit directly targets the code signing verification chain used to authenticate artifact provenance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "name": "Indicator Removal",
            "relevance": "Stripping SBOMs and signatures is a form of indicator removal, eliminating evidence of tampering and provenance metadata from artifacts."
        }
    ],
    "attack_vector": "NETWORK"
}

sbom_and_signature_stripped_in_transit[_sbom_and_signature_stripped_in_transit_def] if {
    not input.mutual_tls_enforced
    not input.signature_presence_enforced_at_ingestion
}

sbom_and_signature_stripped_in_transit[_sbom_and_signature_stripped_in_transit_def] if {
    input.sbom_upload_mechanism == "separate_request"
    not input.registry_sbom_presence_required
}

sbom_and_signature_stripped_in_transit[_sbom_and_signature_stripped_in_transit_def] if {
    input.sbom_upload_mechanism == "not_uploaded"
    not input.registry_sbom_presence_required
}

sbom_and_signature_stripped_in_transit[_sbom_and_signature_stripped_in_transit_def] if {
    not input.mutual_tls_enforced
    input.sbom_upload_mechanism == "separate_request"
    not input.signature_presence_enforced_at_ingestion
}

exposures contains _sbom_and_signature_stripped_in_transit_def if {
    count(sbom_and_signature_stripped_in_transit) > 0
}

_unencrypted_or_plaintext_protocol_fallback_def := {
    "name": "Unencrypted Or Plaintext Protocol Fallback",
    "description": "The registry client or pipeline tooling permits fallback to HTTP when HTTPS negotiation fails (e.g., misconfigured registry mirror, DNS spoofing redirecting to a rogue HTTP endpoint). Artifact content and credentials are transmitted in cleartext, directly enabling interception and substitution.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Fallback to plaintext protocols creates an unencrypted channel that adversaries can exploit for data exfiltration over alternative, unprotected protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Plaintext protocol fallback can be abused by attackers to tunnel malicious traffic through unencrypted channels, bypassing security controls."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_or_plaintext_protocol_fallback[_unencrypted_or_plaintext_protocol_fallback_def] if {
    input.registry_transport_protocol == true
}

unencrypted_or_plaintext_protocol_fallback[_unencrypted_or_plaintext_protocol_fallback_def] if {
    input.registry_transport_protocol == "http"
}

unencrypted_or_plaintext_protocol_fallback[_unencrypted_or_plaintext_protocol_fallback_def] if {
    not input.tls_certificate_verification_enforced
}

exposures contains _unencrypted_or_plaintext_protocol_fallback_def if {
    count(unencrypted_or_plaintext_protocol_fallback) > 0
}

_missing_content_addressable_integrity_verification_on_push_def := {
    "name": "Missing Content Addressable Integrity Verification On Push",
    "description": "The pipeline does not verify that the content-addressable digest (e.g., SHA-256 manifest hash) returned by the registry after a push matches the locally computed digest before marking the build successful. A rogue registry or MITM can acknowledge a push while storing a different artifact, with no in-transit integrity check catching the discrepancy.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036.001",
            "name": "Invalid Code Signature",
            "relevance": "Without content-addressable integrity verification, artifacts with invalid or absent signatures can be pushed undetected, directly relating to this technique."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.003",
            "name": "SIP and Trust Provider Hijacking",
            "relevance": "Missing integrity verification on push allows substitution of artifacts by bypassing or subverting trust validation mechanisms."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Without content-addressable integrity checks, malicious artifacts can be injected into the pipeline, enabling poisoned pipeline execution."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_content_addressable_integrity_verification_on_push[_missing_content_addressable_integrity_verification_on_push_def] if {
    not input.push_digest_verification_enabled
    not input.post_push_signature_verification_enabled
}

missing_content_addressable_integrity_verification_on_push[_missing_content_addressable_integrity_verification_on_push_def] if {
    not input.push_digest_verification_enabled
    not input.mutual_tls_enforced
}

exposures contains _missing_content_addressable_integrity_verification_on_push_def if {
    count(missing_content_addressable_integrity_verification_on_push) > 0
}

_absent_rate_limiting_on_artifact_write_path_def := {
    "name": "Absent Rate Limiting On Artifact Write Path",
    "description": "The registry endpoint imposes no rate limits or anomaly thresholds on artifact push operations from pipeline service identities. An adversary who obtains pipeline credentials can bulk-push malicious artifacts or overwrite existing tags at high velocity without triggering alerting, enabling rapid supply-chain contamination before detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "Absent rate limiting on the write path allows automated, high-volume operations such as bulk artifact uploads or automated abuse of the write API."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Without rate limiting, adversaries can rapidly overwrite or flood the artifact write path to inject malicious artifacts into the pipeline."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_rate_limiting_on_artifact_write_path[_absent_rate_limiting_on_artifact_write_path_def] if {
    not input.push_rate_limit_enabled
    not input.push_anomaly_alerting_enabled
}

absent_rate_limiting_on_artifact_write_path[_absent_rate_limiting_on_artifact_write_path_def] if {
    not input.push_rate_limit_enabled
    input.tag_overwrite_policy == "allow"
}

exposures contains _absent_rate_limiting_on_artifact_write_path_def if {
    count(absent_rate_limiting_on_artifact_write_path) > 0
}

_dns_spoofing_redirecting_push_to_rogue_registry_def := {
    "name": "Dns Spoofing Redirecting Push To Rogue Registry",
    "description": "The pipeline resolves registry hostnames via DNS without DNSSEC validation or certificate pinning. An adversary with control over the DNS path (e.g., compromised resolver, BGP hijack) can redirect push operations to a rogue registry that accepts artifacts, stores tampered versions, and proxies pulls \u2014 transparent to the pipeline.",
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
            "relevance": "DNS spoofing to redirect artifact push traffic directly involves compromising or manipulating DNS infrastructure to point to a rogue registry."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "The attack leverages DNS protocol manipulation to redirect artifact push operations to an attacker-controlled registry."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_spoofing_redirecting_push_to_rogue_registry[_dns_spoofing_redirecting_push_to_rogue_registry_def] if {
    not input.dnssec_validation_enabled
    not input.registry_tls_certificate_pinning_enforced
}

dns_spoofing_redirecting_push_to_rogue_registry[_dns_spoofing_redirecting_push_to_rogue_registry_def] if {
    not input.dnssec_validation_enabled
    not input.post_push_signature_verification_enabled
}

dns_spoofing_redirecting_push_to_rogue_registry[_dns_spoofing_redirecting_push_to_rogue_registry_def] if {
    not input.registry_tls_certificate_pinning_enforced
    not input.post_push_signature_verification_enabled
}

exposures contains _dns_spoofing_redirecting_push_to_rogue_registry_def if {
    count(dns_spoofing_redirecting_push_to_rogue_registry) > 0
}
