package _dt_built_in.exposures.certificate_authority



_weak_issuance_authorization_enrollee_supplied_identity_def := {
    "name": "Weak issuance authorization (enrollee-supplied identity)",
    "description": "A template/profile lets a low-privileged requester dictate the certificate Subject/SAN (CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT, EJBCA 'Allow Subject DN Override by CSR') alongside an authentication EKU and no manager approval, so any enrollee can request a certificate bearing a privileged principal's UPN and authenticate as that principal (AD CS ESC1). Also covers Any-Purpose/empty-EKU subordinate-capable templates (ESC2). The core CA confused-deputy: the CA signs identity the requester was never authorized to claim.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "Steal or Forge Authentication Certificates \u2014 an enrollee-supplied-subject template with an auth EKU and no approval (AD CS ESC1), or an Any-Purpose/empty-EKU template (ESC2), lets a low-privileged requester obtain a certificate bearing a privileged principal's identity and authenticate as that principal."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556",
            "attributes": {
                "justification": "Modify Authentication Process \u2014 abusing trusted certificate issuance to mint credentials that authenticate as another principal subverts the certificate-based authentication path."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_issuance_authorization_enrollee_supplied_identity[_weak_issuance_authorization_enrollee_supplied_identity_def] if {
    not input.enrollee_supplies_subject_disabled
    input.template_grants_authentication_eku == true
    not input.enrollee_supplied_san_requires_approval
}

weak_issuance_authorization_enrollee_supplied_identity[_weak_issuance_authorization_enrollee_supplied_identity_def] if {
    input.any_purpose_or_subca_eku_enrollable == true
}

exposures contains _weak_issuance_authorization_enrollee_supplied_identity_def if {
    count(weak_issuance_authorization_enrollee_supplied_identity) > 0
}

_ca_wide_san_injection_issuance_control_bypass_def := {
    "name": "CA-wide SAN injection / issuance-control bypass",
    "description": "A CA-wide policy flag (EDITF_ATTRIBUTESUBJECTALTNAME2) lets ANY request carry a user-defined SAN regardless of per-template hardening, globally re-enabling ESC1-style impersonation across every template at once (ESC6). The bypass facet: every per-template control can look correct yet be silently voided by one CA-scope flag, and an attacker holding ManageCA can flip that flag (ESC7).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "Steal or Forge Authentication Certificates \u2014 ESC6 abuses the CA-wide EDITF_ATTRIBUTESUBJECTALTNAME2 flag to inject an attacker-controlled SAN, obtaining a certificate that authenticates as an arbitrary (privileged) principal across every template at once."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Account Manipulation \u2014 a holder of ManageCA (ESC7) manipulates the CA's issuance policy by flipping the CA-wide SAN flag, re-enabling impersonation issuance that bypasses per-template approval and hardening."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

ca_wide_san_injection_issuance_control_bypass[_ca_wide_san_injection_issuance_control_bypass_def] if {
    not input.ca_wide_san_attribute_flag_disabled
}

ca_wide_san_injection_issuance_control_bypass[_ca_wide_san_injection_issuance_control_bypass_def] if {
    not input.manage_ca_rights_restricted
}

exposures contains _ca_wide_san_injection_issuance_control_bypass_def if {
    count(ca_wide_san_injection_issuance_control_bypass) > 0
}

_unconstrained_over_trusted_issuing_ca_def := {
    "name": "Unconstrained / over-trusted issuing CA",
    "description": "An issuing or subordinate CA lacking X.509 NameConstraints and pathLen=0 can sign certificates for any name it does not own, or spawn rogue subordinate CAs (EJBCA does not enforce pathLen at issuance, so it must be set deliberately). Combined with a flat hierarchy where an online root issues leaf certs, a single compromise forges unlimited trust across namespaces the org never controlled.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "An unconstrained / over-trusted issuing CA lets an adversary forge or obtain authentication certificates for any name the CA does not own, enabling Steal or Forge Authentication Certificates."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "attributes": {
                "justification": "Without NameConstraints and pathLen=0 the CA can spawn rogue subordinate CAs / sign across namespaces, subverting trust controls (Install Root Certificate)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unconstrained_over_trusted_issuing_ca[_unconstrained_over_trusted_issuing_ca_def] if {
    not input.name_constraints_enforced
}

unconstrained_over_trusted_issuing_ca[_unconstrained_over_trusted_issuing_ca_def] if {
    not input.path_length_constraint_set
}

unconstrained_over_trusted_issuing_ca[_unconstrained_over_trusted_issuing_ca_def] if {
    not input.offline_root_ca
}

exposures contains _unconstrained_over_trusted_issuing_ca_def if {
    count(unconstrained_over_trusted_issuing_ca) > 0
}

_ca_signing_key_theft_no_hsm_custody_def := {
    "name": "CA signing-key theft (no HSM custody)",
    "description": "A software/on-disk or DPAPI-protected exportable CA signing key (no HSM/KMS) is exported by any local administrator via certutil or a PFX/system-state backup and used off-box to forge unlimited trusted certificates. A non-exportable HSM/KMS-backed key (FIPS 140-2 L2/L3+, awskms://, gcpkms://, pkcs11:) makes key theft from a disk image worthless; key-bundling backups widen this same exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
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
            "value": "T1649",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

ca_signing_key_theft_no_hsm_custody[_ca_signing_key_theft_no_hsm_custody_def] if {
    input.key_storage in ["software_exportable", "software_non_exportable"]
}

ca_signing_key_theft_no_hsm_custody[_ca_signing_key_theft_no_hsm_custody_def] if {
    input.ca_key_bundled_in_routine_backup == true
}

exposures contains _ca_signing_key_theft_no_hsm_custody_def if {
    count(ca_signing_key_theft_no_hsm_custody) > 0
}

_ntlm_relay_to_http_enrollment_endpoint_def := {
    "name": "NTLM relay to HTTP enrollment endpoint",
    "description": "HTTP-based enrollment endpoints (Web Enrollment /certsrv, CES/CEP, NDES) exposed without HTTPS + Extended Protection for Authentication let an attacker coerce a machine (e.g. a domain controller) to authenticate, relay that NTLM auth to the endpoint, and obtain an authentication-capable certificate impersonating the victim machine \u2014 escalating to DC/forest compromise (AD CS ESC8; related machine-account SAN abuse CVE-2022-26923).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "NTLM relay (adversary-in-the-middle) of coerced authentication to the HTTP enrollment endpoint."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1187",
            "attributes": {
                "justification": "Coerced machine authentication (forced authentication) is the trigger that supplies the credential relayed in ESC8."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "The relay yields an authentication-capable certificate impersonating the victim machine (steal or forge authentication certificates)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

ntlm_relay_to_http_enrollment_endpoint[_ntlm_relay_to_http_enrollment_endpoint_def] if {
    input.http_enrollment_endpoint_exposed == true
    not input.web_enrollment_https_enforced
}

ntlm_relay_to_http_enrollment_endpoint[_ntlm_relay_to_http_enrollment_endpoint_def] if {
    input.http_enrollment_endpoint_exposed == true
    not input.extended_protection_for_authentication_enabled
}

ntlm_relay_to_http_enrollment_endpoint[_ntlm_relay_to_http_enrollment_endpoint_def] if {
    input.http_enrollment_endpoint_exposed == true
    not input.ntlm_authentication_disabled_on_enrollment
}

exposures contains _ntlm_relay_to_http_enrollment_endpoint_def if {
    count(ntlm_relay_to_http_enrollment_endpoint) > 0
}

_weak_default_ca_admin_access_and_role_separation_def := {
    "name": "Weak / default CA admin access and role separation",
    "description": "ManageCA and ManageCertificates rights granted to broad or unprivileged principals, with no MFA and Common-Criteria role separation disabled, give a holder direct paths to full PKI compromise \u2014 ManageCA flips dangerous flags, ManageCertificates self-approves a pending request (ESC7); dangerous WriteDacl/FullControl ACLs on template or PKI objects let an attacker reconfigure a benign template into an ESC1 template (ESC4/ESC5). A control the governed party can simply re-grant or disable is no control.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.manage_ca_rights_restricted
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.manage_certificates_rights_restricted
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.ca_admin_mfa_enforced
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.role_separation_enabled
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.template_acls_hardened
}

weak_default_ca_admin_access_and_role_separation[_weak_default_ca_admin_access_and_role_separation_def] if {
    not input.pki_object_acls_hardened
}

exposures contains _weak_default_ca_admin_access_and_role_separation_def if {
    count(weak_default_ca_admin_access_and_role_separation) > 0
}

_missing_or_stale_revocation_lifecycle_def := {
    "name": "Missing or stale revocation lifecycle",
    "description": "No CRL/OCSP configured, or an unreachable CDP/AIA or an expired (stale) CRL, means a compromised or mis-issued certificate stays trusted until natural expiry \u2014 with no kill-switch, every other issuance weakness becomes durable. Over-long leaf validity and requester-controlled lifetime ('Allow Validity Override') widen that window further.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553",
            "attributes": {
                "justification": "Subvert Trust Controls: with revocation missing or stale, a compromised/mis-issued certificate stays trusted, letting an adversary abuse the trust chain until natural expiry."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "attributes": {
                "justification": "Steal or Forge Authentication Certificates: absent a working kill-switch (revocation), a stolen or mis-issued CA-signed certificate remains durably usable for authentication."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

missing_or_stale_revocation_lifecycle[_missing_or_stale_revocation_lifecycle_def] if {
    not input.crl_or_ocsp_configured
}

missing_or_stale_revocation_lifecycle[_missing_or_stale_revocation_lifecycle_def] if {
    not input.crl_distribution_point_reachable
}

missing_or_stale_revocation_lifecycle[_missing_or_stale_revocation_lifecycle_def] if {
    not input.crl_response_fresh
}

missing_or_stale_revocation_lifecycle[_missing_or_stale_revocation_lifecycle_def] if {
    input.max_leaf_validity_days > 397
}

missing_or_stale_revocation_lifecycle[_missing_or_stale_revocation_lifecycle_def] if {
    not input.requester_validity_override_disabled
}

exposures contains _missing_or_stale_revocation_lifecycle_def if {
    count(missing_or_stale_revocation_lifecycle) > 0
}

_weak_signing_algorithm_def := {
    "name": "Weak signing algorithm",
    "description": "A CA still signing with SHA-1 or issuing RSA-1024 / sub-floor keys undermines the cryptographic integrity of every certificate it signs, enabling forgeable chains. Modern floors are SHA-256+ and RSA >= 2048 (3072+ for long-lived roots) or P-256/P-384 ECDSA.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "attributes": {
                "justification": "Weaken Encryption: a CA signing with SHA-1 or sub-floor RSA keys degrades the cryptographic strength protecting issued certificates, enabling forgeable certificate chains."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_signing_algorithm[_weak_signing_algorithm_def] if {
    input.signing_hash_algorithm in ["sha1", "md5"]
}

weak_signing_algorithm[_weak_signing_algorithm_def] if {
    input.ca_key_algorithm_strength in ["rsa_1024", "rsa_512"]
}

exposures contains _weak_signing_algorithm_def if {
    count(weak_signing_algorithm) > 0
}

_disabled_or_non_attributable_issuance_auditing_def := {
    "name": "Disabled or non-attributable issuance auditing",
    "description": "CA issuance, revocation, template-change, and admin-action auditing is disabled or partial (AD CS AuditFilter off by default; OS object-access policy off) and not centrally retained, so rogue-certificate minting \u2014 the goal of every ESC primitive \u2014 is invisible and unattributable. Without tamper-resistant, SIEM-forwarded issuance logs there is no detection of PKI abuse.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.002",
            "attributes": {
                "justification": "Disable Windows Event Logging \u2014 AD CS AuditFilter off / OS object-access policy off means CA issuance events are never written."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.001",
            "attributes": {
                "justification": "Indicator Removal: Clear Windows Event Logs \u2014 without tamper-resistant, SIEM-forwarded retention, local issuance/admin logs can be cleared to hide rogue-cert minting."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

disabled_or_non_attributable_issuance_auditing[_disabled_or_non_attributable_issuance_auditing_def] if {
    not input.issuance_audit_logging_enabled
}

disabled_or_non_attributable_issuance_auditing[_disabled_or_non_attributable_issuance_auditing_def] if {
    not input.audit_logs_forwarded_to_siem
}

disabled_or_non_attributable_issuance_auditing[_disabled_or_non_attributable_issuance_auditing_def] if {
    not input.admin_action_logging_enabled
}

disabled_or_non_attributable_issuance_auditing[_disabled_or_non_attributable_issuance_auditing_def] if {
    not input.audit_logs_tamper_protected
}

exposures contains _disabled_or_non_attributable_issuance_auditing_def if {
    count(disabled_or_non_attributable_issuance_auditing) > 0
}
