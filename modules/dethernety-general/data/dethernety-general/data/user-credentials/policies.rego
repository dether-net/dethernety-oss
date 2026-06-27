package _dt_built_in.exposures.user_credentials



_plaintext_or_reversibly_encrypted_password_storage_def := {
    "name": "Plaintext or reversibly-encrypted password storage",
    "description": "Passwords stored in cleartext or under a reversible cipher are directly usable the moment the credential store is disclosed, yielding instant mass account takeover with no cracking required. Passwords must be one-way hashed with an adaptive KDF (OWASP Password Storage).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_or_reversibly_encrypted_password_storage[_plaintext_or_reversibly_encrypted_password_storage_def] if {
    not input.passwords_one_way_hashed
}

exposures contains _plaintext_or_reversibly_encrypted_password_storage_def if {
    count(plaintext_or_reversibly_encrypted_password_storage) > 0
}

_weak_unsalted_fast_password_hashes_def := {
    "name": "Weak / unsalted / fast password hashes",
    "description": "MD5, SHA-1, or raw/unsalted SHA-256 with no work factor (versus Argon2id/scrypt/bcrypt/PBKDF2) let an attacker crack the entire dumped credential corpus offline via GPU/ASIC and rainbow tables; missing per-credential salt and a server-side pepper compound the exposure (OWASP Password Storage; NIST SP 800-63B).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.002"
        }
    ],
    "attack_vector": "LOCAL"
}

weak_unsalted_fast_password_hashes[_weak_unsalted_fast_password_hashes_def] if {
    not input.adaptive_memory_hard_hash_used
}

weak_unsalted_fast_password_hashes[_weak_unsalted_fast_password_hashes_def] if {
    not input.per_credential_salt_used
}

weak_unsalted_fast_password_hashes[_weak_unsalted_fast_password_hashes_def] if {
    not input.adequate_work_factor
}

exposures contains _weak_unsalted_fast_password_hashes_def if {
    count(weak_unsalted_fast_password_hashes) > 0
}

_hardcoded_unvaulted_api_ssh_and_private_keys_def := {
    "name": "Hardcoded / unvaulted API, SSH and private keys",
    "description": "Long-lived machine credentials committed to source, baked into container images, or left in plaintext config/.env are harvested from repos and artifacts and replayed for direct impersonation; vaulting in a secret manager is the floor (OWASP Secrets Management / Key Management).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552"
        }
    ],
    "attack_vector": "NETWORK"
}

hardcoded_unvaulted_api_ssh_and_private_keys[_hardcoded_unvaulted_api_ssh_and_private_keys_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
}

hardcoded_unvaulted_api_ssh_and_private_keys[_hardcoded_unvaulted_api_ssh_and_private_keys_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

exposures contains _hardcoded_unvaulted_api_ssh_and_private_keys_def if {
    count(hardcoded_unvaulted_api_ssh_and_private_keys) > 0
}

_credentials_transmitted_in_cleartext_def := {
    "name": "Credentials transmitted in cleartext",
    "description": "A login form served over or posting to HTTP (no TLS/HSTS) lets a network or adjacent attacker sniff and MITM the credential and replay it verbatim (OWASP Authentication).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557"
        }
    ],
    "attack_vector": "ADJACENT"
}

credentials_transmitted_in_cleartext[_credentials_transmitted_in_cleartext_def] if {
    not input.tls_only_transport
}

credentials_transmitted_in_cleartext[_credentials_transmitted_in_cleartext_def] if {
    not input.hsts_enforced
}

exposures contains _credentials_transmitted_in_cleartext_def if {
    count(credentials_transmitted_in_cleartext) > 0
}

_online_brute_force_and_credential_stuffing_def := {
    "name": "Online brute force and credential stuffing",
    "description": "Without account-bound lockout/throttling (NIST caps at <=100 consecutive failures), without breached-password screening (Pwned Passwords k-anonymity check), and without MFA, attackers guess weak passwords and replay prior-breach credentials at scale until they land (OWASP Credential Stuffing; NIST SP 800-63B).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003"
        }
    ],
    "attack_vector": "NETWORK"
}

online_brute_force_and_credential_stuffing[_online_brute_force_and_credential_stuffing_def] if {
    not input.rate_limiting_or_lockout_enabled
    not input.breached_password_screening_enabled
    not input.mfa_available
}

online_brute_force_and_credential_stuffing[_online_brute_force_and_credential_stuffing_def] if {
    input.max_consecutive_failed_attempts > 100
}

exposures contains _online_brute_force_and_credential_stuffing_def if {
    count(online_brute_force_and_credential_stuffing) > 0
}

_username_enumeration_via_differential_responses_def := {
    "name": "Username enumeration via differential responses",
    "description": "Distinct failure messages or measurable timing for valid versus invalid usernames let attackers build a targeting list, sharpening downstream brute-force and stuffing campaigns; responses must be a single generic message (OWASP Authentication).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589"
        }
    ],
    "attack_vector": "NETWORK"
}

username_enumeration_via_differential_responses[_username_enumeration_via_differential_responses_def] if {
    not input.generic_failure_responses
}

username_enumeration_via_differential_responses[_username_enumeration_via_differential_responses_def] if {
    not input.constant_time_login_responses
}

exposures contains _username_enumeration_via_differential_responses_def if {
    count(username_enumeration_via_differential_responses) > 0
}

_weak_credential_strength_policy_def := {
    "name": "Weak credential-strength policy",
    "description": "A short minimum length (below NIST 8 with MFA / 15 without), a max-length cap below 64, stripped characters, mandatory composition rules, forced periodic rotation, or no breach screening all weaken the credential population the store protects (NIST SP 800-63B).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110"
        }
    ],
    "attack_vector": "NETWORK"
}

weak_credential_strength_policy[_weak_credential_strength_policy_def] if {
    input.password_min_length < 8
}

weak_credential_strength_policy[_weak_credential_strength_policy_def] if {
    input.password_max_length_cap_below_64 == true
}

weak_credential_strength_policy[_weak_credential_strength_policy_def] if {
    input.composition_rules_or_forced_rotation_imposed == true
}

weak_credential_strength_policy[_weak_credential_strength_policy_def] if {
    not input.breached_password_screening_enabled
}

exposures contains _weak_credential_strength_policy_def if {
    count(weak_credential_strength_policy) > 0
}

_no_rotation_or_revocation_on_compromise_def := {
    "name": "No rotation or revocation on compromise",
    "description": "Static, never-rotated API/SSH keys and the inability to force a password reset on evidence of compromise extend an attacker's access window indefinitely after a credential is stolen (OWASP Key Management; NIST SP 800-63B).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078"
        }
    ],
    "attack_vector": "NETWORK"
}

no_rotation_or_revocation_on_compromise[_no_rotation_or_revocation_on_compromise_def] if {
    not input.key_rotation_enabled
}

no_rotation_or_revocation_on_compromise[_no_rotation_or_revocation_on_compromise_def] if {
    not input.forced_reset_or_revocation_on_compromise
}

exposures contains _no_rotation_or_revocation_on_compromise_def if {
    count(no_rotation_or_revocation_on_compromise) > 0
}

_credentials_leaked_to_logs_or_urls_def := {
    "name": "Credentials leaked to logs or URLs",
    "description": "Passwords, API keys, private-key blocks, or Basic/Bearer headers written to application logs, error traces, or URL query strings create a secondary harvestable copy of the secret outside the protected store (OWASP Authentication).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552"
        }
    ],
    "attack_vector": "LOCAL"
}

credentials_leaked_to_logs_or_urls[_credentials_leaked_to_logs_or_urls_def] if {
    not input.secrets_masked_in_logs
}

credentials_leaked_to_logs_or_urls[_credentials_leaked_to_logs_or_urls_def] if {
    input.transmitted_in_url_or_query == true
}

exposures contains _credentials_leaked_to_logs_or_urls_def if {
    count(credentials_leaked_to_logs_or_urls) > 0
}

_over_broad_access_to_the_credential_store_def := {
    "name": "Over-broad access to the credential store",
    "description": "Read access to the password-hash table, pepper, or secret store granted beyond the authentication service identity lets ordinary app roles or shared service accounts dump hashes and keys for offline cracking and impersonation; least privilege is the floor (OWASP Secrets Management; NIST SP 800-63B).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003"
        }
    ],
    "attack_vector": "LOCAL"
}

over_broad_access_to_the_credential_store[_over_broad_access_to_the_credential_store_def] if {
    not input.least_privilege_access_enforced
}

over_broad_access_to_the_credential_store[_over_broad_access_to_the_credential_store_def] if {
    not input.pepper_stored_separately
}

exposures contains _over_broad_access_to_the_credential_store_def if {
    count(over_broad_access_to_the_credential_store) > 0
}
