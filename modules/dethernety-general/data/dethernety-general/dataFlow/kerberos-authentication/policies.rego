package _dt_built_in.exposures.kerberos_authentication



_missing_pre_authentication_as_rep_roasting_def := {
    "name": "Missing pre-authentication (AS-REP roasting)",
    "description": "Accounts with Kerberos pre-authentication disabled (DONT_REQUIRE_PREAUTH userAccountControl bit) cause the KDC to return an AS-REP encrypted with the account key to any unauthenticated requester, who cracks it offline \u2014 especially fast when RC4 (etype 0x17) is permitted. The AS-REQ/AS-REP leg of the flow fails to authenticate the requester before issuing crackable ciphertext.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

missing_pre_authentication_as_rep_roasting[_missing_pre_authentication_as_rep_roasting_def] if {
    not input.kerberos_preauthentication_required
}

missing_pre_authentication_as_rep_roasting[_missing_pre_authentication_as_rep_roasting_def] if {
    input.accounts_with_preauth_disabled_present == true
}

exposures contains _missing_pre_authentication_as_rep_roasting_def if {
    count(missing_pre_authentication_as_rep_roasting) > 0
}

_weak_legacy_ticket_encryption_types_rc4_des_and_downgrade_def := {
    "name": "Weak / legacy ticket encryption types (RC4/DES) and downgrade",
    "description": "When the KDC fallback (DefaultDomainSupportedEncTypes) or account msDS-SupportedEncryptionTypes / krb5.conf permitted_enctypes still admit RC4 (arcfour-hmac) or single-DES, TGS-REP and AS-REP ciphertext is cheaply crackable (Kerberoasting substrate). Legacy RC4-MD4 (-128) / RC4-HMAC-OLD (-133) preauth types additionally enable a downgrade that extracts a TGT session key for code execution as the target (CVE-2022-33647/33679).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.003",
            "attributes": {
                "justification": "RC4 (etype 0x17) TGS-REP ciphertext for SPN accounts is cheaply offline-crackable \u2014 the direct Kerberoasting substrate."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.004",
            "attributes": {
                "justification": "Weak/legacy RC4 preauth enctypes (incl. RC4-MD4/RC4-HMAC-OLD, CVE-2022-33647/33679) enable AS-REP roasting and the preauth enctype downgrade."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_legacy_ticket_encryption_types_rc4_des_and_downgrade[_weak_legacy_ticket_encryption_types_rc4_des_and_downgrade_def] if {
    input.kerberos_ticket_encryption_type in ["rc4_hmac", "des_cbc_md5", "des_cbc_crc"]
}

weak_legacy_ticket_encryption_types_rc4_des_and_downgrade[_weak_legacy_ticket_encryption_types_rc4_des_and_downgrade_def] if {
    not input.weak_legacy_enctypes_disabled
}

weak_legacy_ticket_encryption_types_rc4_des_and_downgrade[_weak_legacy_ticket_encryption_types_rc4_des_and_downgrade_def] if {
    not input.rc4_preauth_downgrade_patched
}

exposures contains _weak_legacy_ticket_encryption_types_rc4_des_and_downgrade_def if {
    count(weak_legacy_ticket_encryption_types_rc4_des_and_downgrade) > 0
}

_weak_service_account_keys_kerberoasting_def := {
    "name": "Weak service-account keys (Kerberoasting)",
    "description": "SPN-bearing service accounts on ordinary user objects with human-chosen passwords let any authenticated principal request a TGS-REP encrypted with that account key and crack it offline. Without gMSA (240-char auto-rotated) or enforced 25+ char random passwords, the TGS leg of the flow leaks a forgeable service key.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_service_account_keys_kerberoasting[_weak_service_account_keys_kerberoasting_def] if {
    not input.service_accounts_use_gmsa_or_strong_random_keys
}

weak_service_account_keys_kerberoasting[_weak_service_account_keys_kerberoasting_def] if {
    input.spn_accounts_have_weak_passwords == true
}

weak_service_account_keys_kerberoasting[_weak_service_account_keys_kerberoasting_def] if {
    input.spn_account_rc4_tickets_permitted == true
}

exposures contains _weak_service_account_keys_kerberoasting_def if {
    count(weak_service_account_keys_kerberoasting) > 0
}

_krbtgt_key_compromise_no_rotation_golden_ticket_def := {
    "name": "krbtgt key compromise / no rotation (Golden Ticket)",
    "description": "The krbtgt key signs every TGT; if its hash leaks and krbtgt is not reset twice on a rotation schedule, an attacker forges arbitrary TGTs (Golden Tickets) granting unrestricted domain access that survives normal credential resets. A stale krbtgt password means any historical hash leak still forges valid tickets.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.001",
            "attributes": {
                "justification": "Golden Ticket: with the krbtgt account hash an attacker forges arbitrary TGTs granting unrestricted domain access that persists across credential resets until krbtgt is rotated twice. Mitigation per ATT&CK is to reset the krbtgt password twice and rotate on schedule."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

krbtgt_key_compromise_no_rotation_golden_ticket[_krbtgt_key_compromise_no_rotation_golden_ticket_def] if {
    not input.krbtgt_rotated_on_schedule
}

krbtgt_key_compromise_no_rotation_golden_ticket[_krbtgt_key_compromise_no_rotation_golden_ticket_def] if {
    not input.krbtgt_reset_twice_on_rotation
}

krbtgt_key_compromise_no_rotation_golden_ticket[_krbtgt_key_compromise_no_rotation_golden_ticket_def] if {
    input.krbtgt_password_age_days > 180
}

exposures contains _krbtgt_key_compromise_no_rotation_golden_ticket_def if {
    count(krbtgt_key_compromise_no_rotation_golden_ticket) > 0
}

_forged_service_ticket_pass_the_ticket_def := {
    "name": "Forged service ticket / pass-the-ticket",
    "description": "With a service key an attacker forges TGS service tickets (Silver Ticket) directly without any KDC TGS-REQ, evading KDC-side logging; stolen TGT/TGS tickets are also replayed on other hosts (pass-the-ticket). Long/unbounded ticket and renewable lifetimes widen the reuse window for every stolen or forged ticket.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.002",
            "attributes": {
                "justification": "Silver Ticket: with a stolen service account key an attacker forges TGS service tickets directly, without any KDC TGS-REQ, evading KDC-side 4769 logging."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.003",
            "attributes": {
                "justification": "Pass the Ticket: stolen TGT/TGS tickets are replayed on other hosts to authenticate as the victim; long/unbounded ticket and renewable lifetimes widen the reuse window."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

forged_service_ticket_pass_the_ticket[_forged_service_ticket_pass_the_ticket_def] if {
    input.max_ticket_lifetime_hours > 10
}

forged_service_ticket_pass_the_ticket[_forged_service_ticket_pass_the_ticket_def] if {
    input.max_renewable_lifetime_days > 7
}

forged_service_ticket_pass_the_ticket[_forged_service_ticket_pass_the_ticket_def] if {
    not input.pac_validation_enforced
}

forged_service_ticket_pass_the_ticket[_forged_service_ticket_pass_the_ticket_def] if {
    not input.tgs_request_auditing_enabled
}

exposures contains _forged_service_ticket_pass_the_ticket_def if {
    count(forged_service_ticket_pass_the_ticket) > 0
}

_unconstrained_abused_delegation_bronze_bit_def := {
    "name": "Unconstrained / abused delegation (Bronze Bit)",
    "description": "Hosts with unconstrained delegation (TRUSTED_FOR_DELEGATION) cache every forwarded TGT, enabling domain takeover from one compromised host. CVE-2020-17049 (Bronze Bit) lets a constrained-delegation (S4U2Proxy) service tamper a non-forwardable ticket so the KDC accepts it, impersonating users otherwise protected from delegation (Protected Users / 'sensitive and cannot be delegated').",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unconstrained_abused_delegation_bronze_bit[_unconstrained_abused_delegation_bronze_bit_def] if {
    not input.unconstrained_delegation_disabled
}

unconstrained_abused_delegation_bronze_bit[_unconstrained_abused_delegation_bronze_bit_def] if {
    not input.kdc_patched_against_delegation_bypass
}

unconstrained_abused_delegation_bronze_bit[_unconstrained_abused_delegation_bronze_bit_def] if {
    not input.sensitive_accounts_marked_not_delegable
}

exposures contains _unconstrained_abused_delegation_bronze_bit_def if {
    count(unconstrained_abused_delegation_bronze_bit) > 0
}

_unarmored_preauth_exchange_no_pkinit_fast_def := {
    "name": "Unarmored preauth exchange (no PKINIT/FAST)",
    "description": "Without FAST/Kerberos armoring (and PKINIT for sensitive accounts), the AS-REQ/AS-REP preauth exchange is bare password-based and exposed to offline cracking and enctype downgrade. Armoring tunnels the exchange inside an armor key, hardening the flow against AS-REP roasting and downgrade attacks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.004",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

unarmored_preauth_exchange_no_pkinit_fast[_unarmored_preauth_exchange_no_pkinit_fast_def] if {
    not input.kerberos_fast_armoring_enabled
}

unarmored_preauth_exchange_no_pkinit_fast[_unarmored_preauth_exchange_no_pkinit_fast_def] if {
    not input.pkinit_required_for_sensitive_accounts
}

unarmored_preauth_exchange_no_pkinit_fast[_unarmored_preauth_exchange_no_pkinit_fast_def] if {
    not input.kerberos_preauthentication_required
}

exposures contains _unarmored_preauth_exchange_no_pkinit_fast_def if {
    count(unarmored_preauth_exchange_no_pkinit_fast) > 0
}

_insufficient_tgs_request_auditing_kdc_exposure_def := {
    "name": "Insufficient TGS-request auditing & KDC exposure",
    "description": "Without monitoring of 4768/4769 events the flow is unobservable: a burst of RC4 (etype 0x17) service-ticket requests for many SPNs (Kerberoasting) or a service ticket presented with no matching 4769 (Silver Ticket forgery) goes undetected. A KDC reachable on UDP/TCP 88 from untrusted networks further permits anonymous AS-REQ probing from outside the trust boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

insufficient_tgs_request_auditing_kdc_exposure[_insufficient_tgs_request_auditing_kdc_exposure_def] if {
    not input.tgs_request_auditing_enabled
}

insufficient_tgs_request_auditing_kdc_exposure[_insufficient_tgs_request_auditing_kdc_exposure_def] if {
    not input.kerberoasting_detection_alerting_enabled
}

insufficient_tgs_request_auditing_kdc_exposure[_insufficient_tgs_request_auditing_kdc_exposure_def] if {
    not input.kdc_network_exposure_restricted
}

exposures contains _insufficient_tgs_request_auditing_kdc_exposure_def if {
    count(insufficient_tgs_request_auditing_kdc_exposure) > 0
}
