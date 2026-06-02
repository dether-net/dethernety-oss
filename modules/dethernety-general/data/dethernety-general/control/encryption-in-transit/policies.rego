package _dt_built_in.countermeasures.encryption_in_transit



_tls_enforced_on_all_flows_no_cleartext_fallback_def := {
    "name": "TLS enforced on all flows (no cleartext fallback)",
    "description": "Every sensitive flow runs over TLS or an equivalent encrypted tunnel with no plaintext fallback: HTTP is redirected to HTTPS, internal/DB links use TLS, and object-store access is gated by a TLS-required policy. Presence of this facet means intercepted traffic is never readable in cleartext.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt Sensitive Information \u2014 enforcing TLS on all flows with no cleartext fallback is the catalog mitigation for protecting data in transit."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "attributes": {
                "justification": "Encrypted Tunnels \u2014 D3FEND defensive identity for transporting sensitive flows over encrypted channels with no plaintext path."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Network Sniffing \u2014 TLS on every flow renders intercepted traffic unreadable in cleartext, denying passive on-path capture of credentials, tokens, and PII."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle \u2014 TLS with peer authentication plus a closed cleartext path defeats active on-path interception, downgrade-to-plaintext, and traffic substitution."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tls_enforced_on_all_flows_no_cleartext_fallback[_tls_enforced_on_all_flows_no_cleartext_fallback_def] if {
    input.tls_only_transport == true
    input.insecure_transport_denied == true
}

countermeasures contains _tls_enforced_on_all_flows_no_cleartext_fallback_def if {
    count(tls_enforced_on_all_flows_no_cleartext_fallback) > 0
}

_minimum_tls_version_enforced_tls_1_2_floor_1_3_preferred_def := {
    "name": "Minimum TLS version enforced (TLS 1.2 floor, 1.3 preferred)",
    "description": "The control negotiates only TLS 1.2 or higher with TLS 1.3 supported, while SSLv3 and TLS 1.0/1.1 (deprecated by RFC 8996) are refused. Presence prevents protocol-downgrade plaintext recovery (POODLE/BEAST-class).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "Enforcing a TLS 1.2 floor with 1.3 preferred and refusing SSLv3/TLS 1.0/1.1 defeats protocol-downgrade attacks (POODLE/BEAST) that force negotiation to a deprecated, breakable version."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Refusing legacy protocol versions removes the downgrade foothold an adversary-in-the-middle uses to coerce a weak channel before intercepting or altering traffic."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

minimum_tls_version_enforced_tls_1_2_floor_1_3_preferred[_minimum_tls_version_enforced_tls_1_2_floor_1_3_preferred_def] if {
    input.min_tls_version == "tls1_2_or_higher"
}

countermeasures contains _minimum_tls_version_enforced_tls_1_2_floor_1_3_preferred_def if {
    count(minimum_tls_version_enforced_tls_1_2_floor_1_3_preferred) > 0
}

_strong_forward_secret_aead_cipher_suites_only_def := {
    "name": "Strong forward-secret AEAD cipher suites only",
    "description": "Only forward-secret (ECDHE/DHE) AEAD cipher suites (GCM / ChaCha20-Poly1305) are offered; RC4, 3DES, NULL, anonymous, EXPORT and static-RSA suites are disabled. Presence removes weak-cipher plaintext recovery (Sweet32/FREAK/Logjam-class) and guarantees per-session forward secrecy.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Enforcing forward-secret AEAD-only suites (ECDHE/DHE + GCM/ChaCha20-Poly1305) removes RC4 biases, 3DES Sweet32, and NULL/anonymous suites, so passively captured traffic cannot be recovered to plaintext via weak-cipher cryptanalysis."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "Disabling legacy/weak (RC4/3DES/NULL/EXPORT/static-RSA) suites and offering only strong forward-secret AEAD suites denies the attacker any acceptable weakened-cipher landing point, hardening the channel against cipher-downgrade negotiation (FREAK/Logjam-class)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

strong_forward_secret_aead_cipher_suites_only[_strong_forward_secret_aead_cipher_suites_only_def] if {
    input.cipher_suites_strong_only == "aead_with_forward_secrecy_only"
    input.perfect_forward_secrecy_enabled == true
}

countermeasures contains _strong_forward_secret_aead_cipher_suites_only_def if {
    count(strong_forward_secret_aead_cipher_suites_only) > 0
}

_server_certificate_validated_trusted_chain_hostname_def := {
    "name": "Server certificate validated (trusted chain + hostname)",
    "description": "The peer certificate chains to a trusted CA, matches the hostname in subjectAlternativeName, is in-date, and uses an adequate key (RSA>=2048 / ECDSA P-256) with a SHA-256 signature; clients perform full chain and hostname validation. Presence authenticates the endpoint and defeats adversary-in-the-middle certificate substitution.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CP",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Full chain + hostname (SAN) validation against a managed trust store authenticates the peer endpoint, so a fraudulent or substituted certificate fails validation \u2014 defeating adversary-in-the-middle / TLS interception (T1557)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

server_certificate_validated_trusted_chain_hostname[_server_certificate_validated_trusted_chain_hostname_def] if {
    input.server_certificate_validated == true
    input.tls_root_trust_managed == true
}

countermeasures contains _server_certificate_validated_trusted_chain_hostname_def if {
    count(server_certificate_validated_trusted_chain_hostname) > 0
}

_mutual_tls_client_authentication_where_required_def := {
    "name": "Mutual TLS / client authentication where required",
    "description": "Flows that demand it (service-to-service, east-west, privileged APIs) authenticate the client with a certificate, not server-only TLS, and the TLS session cache is scoped per server so session reuse cannot bypass per-vhost client-cert verification. Presence enforces bidirectional endpoint authenticity.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CBAN",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Mutual TLS / client-certificate authentication binds both peers to verified certificate identities, so an adversary-in-the-middle cannot impersonate the client (or the server) or splice into the flow without a trusted certificate; per-server session-cache scoping prevents reuse-based bypass of the client-cert check (CVE-2025-23419)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

mutual_tls_client_authentication_where_required[_mutual_tls_client_authentication_where_required_def] if {
    input.service_to_service_mtls_enforced == true
    input.peer_authentication_mtls_mode_strict == true
}

countermeasures contains _mutual_tls_client_authentication_where_required_def if {
    count(mutual_tls_client_authentication_where_required) > 0
}

_downgrade_renegotiation_protection_hsts_def := {
    "name": "Downgrade & renegotiation protection + HSTS",
    "description": "The control honours TLS_FALLBACK_SCSV, permits only secure (RFC 5746) renegotiation, and sends HSTS (Strict-Transport-Security: max-age=63072000; includeSubDomains; preload) so browsers never fall back to HTTP. Presence resists forced protocol/cipher downgrade and HTTP fallback.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt Sensitive Information \u2014 the control's catalog identity for transport encryption; downgrade/renegotiation protection and HSTS preserve the encrypted-channel guarantee against forced fallback to weak/plaintext transport."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "attributes": {
                "justification": "Encrypted Tunnels (D3FEND Harden) \u2014 the defensive identity for maintaining an encrypted transport channel that resists downgrade and HTTP fallback."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {
                "justification": "Downgrade Attack \u2014 honouring TLS_FALLBACK_SCSV, permitting only secure (RFC 5746) renegotiation, and sending HSTS prevents an on-path attacker from forcing negotiation down to a weak protocol/cipher or to cleartext HTTP."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle \u2014 preventing forced downgrade and HTTP fallback denies an on-path adversary the weakened/plaintext channel needed to intercept and alter traffic."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

downgrade_renegotiation_protection_hsts[_downgrade_renegotiation_protection_hsts_def] if {
    input.downgrade_and_renegotiation_protected == "downgrade_sentinel_absent_and_secure_renegotiation_only"
    input.hsts_enabled == true
}

countermeasures contains _downgrade_renegotiation_protection_hsts_def if {
    count(downgrade_renegotiation_protection_hsts) > 0
}

_managed_certificate_lifecycle_rotation_key_size_not_expired_def := {
    "name": "Managed certificate lifecycle (rotation, key size, not expired)",
    "description": "Certificates are managed and rotated before expiry on a short cadence (ideally automated via ACME/cert-manager) with adequate key sizes; the control does not rely on long-lived hand-managed certs that silently expire (IPsec/non-TLS flows rekey with approved crypto). Presence prevents expiry-driven outages and stale-key exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Managed certificate rotation with adequate key sizes sustains the integrity of encrypted-in-transit channels, keeping sensitive information encrypted under valid, trusted credentials \u2014 ATT&CK mitigation M1041 (Encrypt Sensitive Information)."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CERO",
            "attributes": {
                "justification": "Automated, short-cadence rotation before expiry is the D3FEND Certificate Rotation (D3-CERO) defensive technique \u2014 preventing silent-expiry gaps and limiting credential-exposure windows."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

managed_certificate_lifecycle_rotation_key_size_not_expired[_managed_certificate_lifecycle_rotation_key_size_not_expired_def] if {
    input.certificate_lifecycle_managed == true
}

managed_certificate_lifecycle_rotation_key_size_not_expired[_managed_certificate_lifecycle_rotation_key_size_not_expired_def] if {
    input.certificate_max_validity_days <= 398
}

countermeasures contains _managed_certificate_lifecycle_rotation_key_size_not_expired_def if {
    count(managed_certificate_lifecycle_rotation_key_size_not_expired) > 0
}
