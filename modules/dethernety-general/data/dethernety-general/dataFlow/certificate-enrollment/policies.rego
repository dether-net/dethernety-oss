package _dt_built_in.exposures.certificate_enrollment



_spoofable_acme_domain_control_validation_def := {
    "name": "Spoofable ACME domain-control validation",
    "description": "The CA validates http-01/dns-01 domain control from a single vantage point, so a localized BGP route hijack or DNS-path interception lets an attacker host the challenge token / forge the TXT record and obtain a valid cert for a domain they do not control. Multi-Perspective Issuance Corroboration (SC-067) plus CAA validationmethods binding are the defenses.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

spoofable_acme_domain_control_validation[_spoofable_acme_domain_control_validation_def] if {
    not input.acme_multi_perspective_validation_enabled
    not input.caa_method_binding_enforced
    not input.dnssec_validated_for_dns_challenge
}

exposures contains _spoofable_acme_domain_control_validation_def if {
    count(spoofable_acme_domain_control_validation) > 0
}

_weak_enrollment_authentication_open_issuance_oracle_def := {
    "name": "Weak enrollment authentication / open issuance oracle",
    "description": "An ACME provisioner without required External Account Binding (EAB), an EST endpoint missing mTLS/Basic-over-TLS client auth, or SCEP with a static shared challenge-password lets any party that reaches the endpoint create accounts and mint certs \u2014 turning the enrollment flow into an unauthenticated issuance oracle.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1136",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_enrollment_authentication_open_issuance_oracle[_weak_enrollment_authentication_open_issuance_oracle_def] if {
    not input.enrollment_client_authentication_required
}

weak_enrollment_authentication_open_issuance_oracle[_weak_enrollment_authentication_open_issuance_oracle_def] if {
    not input.acme_external_account_binding_required
}

weak_enrollment_authentication_open_issuance_oracle[_weak_enrollment_authentication_open_issuance_oracle_def] if {
    not input.est_mutual_tls_client_auth_required
}

weak_enrollment_authentication_open_issuance_oracle[_weak_enrollment_authentication_open_issuance_oracle_def] if {
    input.scep_static_challenge_password_in_use == true
}

exposures contains _weak_enrollment_authentication_open_issuance_oracle_def if {
    count(weak_enrollment_authentication_open_issuance_oracle) > 0
}

_requester_supplied_san_subject_honored_at_issuance_def := {
    "name": "Requester-supplied SAN/Subject honored at issuance",
    "description": "ESC1 analogue: the CA honors the requester's CSR Subject/SAN without constraining it to the authorized identity (step-ca X5C/JWK 'any Subject' default, cloud disableCustomSANs off, no template/name policy), letting a low-privilege enrollee mint a cert impersonating any host or user.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "Steal or Forge Authentication Certificates: an unconstrained CA that honors requester-supplied Subject/SAN lets a low-privilege enrollee forge a certificate impersonating an arbitrary host or user (the AD-CS ESC1 pattern generalized to step-ca X5C/JWK and EJBCA Subject-DN override)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556",
            "attributes": {
                "justification": "Modify Authentication Process: forging a certificate for an arbitrary identity at issuance subverts certificate-based authentication, letting the adversary present a trusted credential for a principal they do not legitimately control."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

requester_supplied_san_subject_honored_at_issuance[_requester_supplied_san_subject_honored_at_issuance_def] if {
    not input.enrollee_supplies_subject_disabled
}

requester_supplied_san_subject_honored_at_issuance[_requester_supplied_san_subject_honored_at_issuance_def] if {
    input.custom_sans_allowed_unconstrained == true
}

requester_supplied_san_subject_honored_at_issuance[_requester_supplied_san_subject_honored_at_issuance_def] if {
    not input.issuance_template_or_name_policy_enforced
}

exposures contains _requester_supplied_san_subject_honored_at_issuance_def if {
    count(requester_supplied_san_subject_honored_at_issuance) > 0
}

_issued_private_key_exposed_in_transit_def := {
    "name": "Issued private key exposed in transit",
    "description": "Server-side key generation with PKCS#12 delivery puts the issued private key on the wire and in CA memory; combined with weak SCEP encryptionAlgorithmIdentifier (default 0 = DES-CBC), the key is exposed to MITM and CA compromise rather than staying client-side as only the CSR (public key) should traverse the channel.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

issued_private_key_exposed_in_transit[_issued_private_key_exposed_in_transit_def] if {
    input.private_key_delivered_in_transit == true
}

issued_private_key_exposed_in_transit[_issued_private_key_exposed_in_transit_def] if {
    not input.client_side_key_generation
}

issued_private_key_exposed_in_transit[_issued_private_key_exposed_in_transit_def] if {
    input.scep_payload_encryption_algorithm in ["des_cbc", "3des_cbc"]
}

exposures contains _issued_private_key_exposed_in_transit_def if {
    count(issued_private_key_exposed_in_transit) > 0
}

_cleartext_enrollment_transport_def := {
    "name": "Cleartext enrollment transport",
    "description": "Enrollment over plain HTTP (legacy SCEP) or an EST/ACME endpoint negotiating NULL/anon ciphers exposes CSRs, challenge-passwords, and issued material to network interception and tampering. ACME mandates HTTPS and EST mandates TLS 1.1+ with NULL/anon forbidden.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_enrollment_transport[_cleartext_enrollment_transport_def] if {
    not input.encryption_in_transit_enabled
}

cleartext_enrollment_transport[_cleartext_enrollment_transport_def] if {
    input.null_or_anon_ciphers_permitted == true
}

cleartext_enrollment_transport[_cleartext_enrollment_transport_def] if {
    input.tls_min_version in ["SSLv3", "TLS1.0", "TLS1.1"]
}

exposures contains _cleartext_enrollment_transport_def if {
    count(cleartext_enrollment_transport) > 0
}

_provisioner_enrollment_token_compromise_def := {
    "name": "Provisioner / enrollment-token compromise",
    "description": "Theft of a JWK/OIDC/X5C provisioner signing key or a long-lived, reusable bearer enrollment token lets an attacker mint trusted certificates at will, fully bypassing challenge validation. Tokens must be short-lived, single-use, and bound to SAN/CN + root fingerprint.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

provisioner_enrollment_token_compromise[_provisioner_enrollment_token_compromise_def] if {
    not input.enrollment_tokens_short_lived_single_use
}

provisioner_enrollment_token_compromise[_provisioner_enrollment_token_compromise_def] if {
    not input.enrollment_token_bound_to_identity
}

provisioner_enrollment_token_compromise[_provisioner_enrollment_token_compromise_def] if {
    not input.provisioner_signing_key_protected
}

provisioner_enrollment_token_compromise[_provisioner_enrollment_token_compromise_def] if {
    not input.oidc_id_token_claims_validated
}

exposures contains _provisioner_enrollment_token_compromise_def if {
    count(provisioner_enrollment_token_compromise) > 0
}

_unbounded_validity_missing_revocation_def := {
    "name": "Unbounded validity + missing revocation",
    "description": "Unbounded or multi-year certificate lifetimes from an automated enrollment flow, combined with no OCSP/CRL path, mean a single mis-issuance or compromised key stays trusted for years with no recall \u2014 short maxTLSCertDuration and a revocation path bound the blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "Steal or Forge Authentication Certificates: an enrollment flow that mints long-lived certs with no revocation path lets a forged/mis-issued or key-compromised certificate remain a trusted, unrecallable authentication credential for years."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553",
            "attributes": {
                "justification": "Subvert Trust Controls: unbounded validity plus a missing OCSP/CRL recall path defeats the trust-control lifecycle, so a subverted certificate cannot be invalidated and continues to be honored."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unbounded_validity_missing_revocation[_unbounded_validity_missing_revocation_def] if {
    input.max_leaf_validity_days > 397
    not input.crl_or_ocsp_configured
}

exposures contains _unbounded_validity_missing_revocation_def if {
    count(unbounded_validity_missing_revocation) > 0
}

_unmonitored_unthrottled_issuance_def := {
    "name": "Unmonitored / unthrottled issuance",
    "description": "No per-account/per-IP issuance rate limiting lets a compromised credential or buggy client flood the CA (resource exhaustion) and mass-mint certs, while absent immutable issuance audit logging (provisioner, principal, requested vs issued SAN, serial, validity) leaves mis-issuance and provisioner abuse undetectable and unattributable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unmonitored_unthrottled_issuance[_unmonitored_unthrottled_issuance_def] if {
    not input.issuance_rate_limiting_enabled
}

unmonitored_unthrottled_issuance[_unmonitored_unthrottled_issuance_def] if {
    not input.issuance_audit_logging_enabled
}

unmonitored_unthrottled_issuance[_unmonitored_unthrottled_issuance_def] if {
    not input.audit_logs_forwarded_to_siem
}

exposures contains _unmonitored_unthrottled_issuance_def if {
    count(unmonitored_unthrottled_issuance) > 0
}
