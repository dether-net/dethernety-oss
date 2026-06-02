package _dt_built_in.countermeasures.encryption_at_rest



_at_rest_encryption_enabled_on_all_persisted_stores_def := {
    "name": "At-rest encryption enabled on all persisted stores",
    "description": "Every persisted store \u2014 database volumes, block/disk, object storage, and snapshots/backups \u2014 has at-rest encryption turned on, so storage-media compromise yields ciphertext rather than readable content. Includes TDE at the database engine level and full-disk/volume encryption (LUKS/EBS) on hosts.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "At-rest encryption of all persisted stores is the Encrypt Sensitive Information mitigation \u2014 protected data is unreadable without the key."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DENCR",
            "attributes": {
                "justification": "Full-disk/volume and block-store at-rest encryption (LUKS/EBS/TDE storage) is D3FEND Disk Encryption."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-FE",
            "attributes": {
                "justification": "Object/file-level at-rest encryption of persisted data and backups is D3FEND File Encryption."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
            "attributes": {
                "justification": "Disk/volume at-rest encryption (Harden facet) renders a stolen disk, decommissioned drive, or compromised host filesystem only ciphertext, defeating Data from Local System collection."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1025",
            "attributes": {
                "justification": "At-rest encryption of removable/portable media and snapshot/backup copies (Harden facet) yields ciphertext on physical-media theft, defeating Data from Removable Media collection."
            }
        }
    ],
    "attack_vector": "PHYSICAL"
}

at_rest_encryption_enabled_on_all_persisted_stores[_at_rest_encryption_enabled_on_all_persisted_stores_def] if {
    input.encrypted_at_rest == true
    input.storage_encryption_enabled == true
    input.tde_enabled == true
    input.backups_encrypted == true
}

countermeasures contains _at_rest_encryption_enabled_on_all_persisted_stores_def if {
    count(at_rest_encryption_enabled_on_all_persisted_stores) > 0
}

_fips_approved_strong_algorithm_and_key_strength_def := {
    "name": "FIPS-approved strong algorithm and key strength",
    "description": "Data at rest is protected by a FIPS-approved symmetric algorithm at adequate strength (AES-256, AES-128 minimum) implemented by a FIPS 140-3 CMVP-validated module, rather than weak/legacy ciphers (DES/3DES/RC4) or non-validated crypto that would permit cryptanalytic recovery.",
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
                "justification": "Encrypt Sensitive Information \u2014 requiring a FIPS-approved strong algorithm via a CMVP-validated module is the at-rest encryption mitigation as catalogued in ATT&CK."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DENCR",
            "attributes": {
                "justification": "Disk Encryption \u2014 D3FEND defensive technique whose identity this strong-algorithm-and-key-strength facet of the at-rest encryption control implements."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

fips_approved_strong_algorithm_and_key_strength[_fips_approved_strong_algorithm_and_key_strength_def] if {
    input.at_rest_encryption_strength == "strong"
    input.fips_validated_module == true
}

countermeasures contains _fips_approved_strong_algorithm_and_key_strength_def if {
    count(fips_approved_strong_algorithm_and_key_strength) > 0
}

_keys_held_in_a_dedicated_kms_hsm_with_envelope_encryption_def := {
    "name": "Keys held in a dedicated KMS/HSM with envelope encryption",
    "description": "Master keys live in a dedicated KMS/HSM in a separate trust domain from the data they protect, and a KEK/DEK key hierarchy wraps per-object/per-volume data-encrypting keys \u2014 so a single storage compromise yields neither plaintext nor the key needed to read it.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Holding keys in a dedicated KMS/HSM with envelope encryption is an instance of Encrypt Sensitive Information \u2014 the master/wrapping keys live in a separate trust domain so compromised storage yields ciphertext only."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-FE",
            "attributes": {
                "justification": "File Encryption (D3FEND Harden) \u2014 DEKs encrypt the data at rest while the KEK in the KMS wraps the DEKs, keeping key material out of the encrypted store."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "attributes": {
                "justification": "KEK/DEK separation with keys in a dedicated KMS/HSM denies Unsecured Credentials: Private Keys \u2014 a single storage compromise no longer yields both the ciphertext and the private key material needed to decrypt it."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

keys_held_in_a_dedicated_kms_hsm_with_envelope_encryption[_keys_held_in_a_dedicated_kms_hsm_with_envelope_encryption_def] if {
    input.keys_managed_in_hsm_or_kms == true
    input.envelope_encryption_kek_dek_split == true
}

countermeasures contains _keys_held_in_a_dedicated_kms_hsm_with_envelope_encryption_def if {
    count(keys_held_in_a_dedicated_kms_hsm_with_envelope_encryption) > 0
}

_key_rotation_on_a_bounded_cryptoperiod_def := {
    "name": "Key rotation on a bounded cryptoperiod",
    "description": "Keys are rotated automatically on a defined, bounded cryptoperiod (e.g. KMS default 365 days per NIST SP 800-57) rather than used indefinitely, limiting the blast radius and exposure window of any single key.",
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
                "justification": "Encrypt Sensitive Information \u2014 at-rest encryption with bounded-cryptoperiod key rotation is the catalog mitigation identity for this control facet."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CRO",
            "attributes": {
                "justification": "Credential Rotation \u2014 automatic key rotation on a bounded cryptoperiod is the D3FEND defensive technique embodied by this facet."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

key_rotation_on_a_bounded_cryptoperiod[_key_rotation_on_a_bounded_cryptoperiod_def] if {
    input.key_rotation_enabled == true
    input.key_rotation_period_days <= 365
}

countermeasures contains _key_rotation_on_a_bounded_cryptoperiod_def if {
    count(key_rotation_on_a_bounded_cryptoperiod) > 0
}

_least_privilege_key_policy_with_separation_of_duties_def := {
    "name": "Least-privilege key policy with separation of duties",
    "description": "Key policies are scoped (no kms:* wildcard) and key administration is split from key usage \u2014 administrator roles that create/delete keys cannot decrypt with them, and data-using services cannot administer keys \u2014 so no single role can both manage keys and read the data.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UAP",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "attributes": {
                "justification": "Least-privilege key policy and separation of duties (key admins cannot decrypt; data services cannot administer keys) constrains which principals can use the key, reducing the blast radius of credential/role compromise seeking private keys (Unsecured Credentials: Private Keys)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

least_privilege_key_policy_with_separation_of_duties[_least_privilege_key_policy_with_separation_of_duties_def] if {
    input.kms_key_protection_policy_enforced == true
    input.kms_admin_separated_from_db_admin == true
}

countermeasures contains _least_privilege_key_policy_with_separation_of_duties_def if {
    count(least_privilege_key_policy_with_separation_of_duties) > 0
}

_customer_managed_keys_with_crypto_shred_deletion_def := {
    "name": "Customer-managed keys with crypto-shred deletion",
    "description": "The org controls the keys (customer-managed/BYOK with org-controlled key policy) rather than relying solely on provider-default keys, and data can be rendered irrecoverable by scheduled key destruction (NIST Purge-level cryptographic erase) \u2014 enabling secure deletion and a data-residency exit path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
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
            "value": "D3-FE",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

customer_managed_keys_with_crypto_shred_deletion[_customer_managed_keys_with_crypto_shred_deletion_def] if {
    input.customer_managed_key_used == true
    input.secure_deletion_or_crypto_shred == true
}

countermeasures contains _customer_managed_keys_with_crypto_shred_deletion_def if {
    count(customer_managed_keys_with_crypto_shred_deletion) > 0
}

_key_usage_and_key_management_audit_logging_def := {
    "name": "Key-usage and key-management audit logging",
    "description": "All KMS API calls (encrypt/decrypt/generate-data-key/rotation/scheduled-deletion) and key-admin events are logged to a tamper-evident audit trail with principal and source IP, so misuse of decrypt rights or key administration is observable and accountable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt Sensitive Information \u2014 the control's at-rest encryption identity; key-usage/key-management audit logging is the accountability facet over the KMS protecting that data."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

key_usage_and_key_management_audit_logging[_key_usage_and_key_management_audit_logging_def] if {
    input.key_management_audit_logging_enabled == true
    input.secret_access_audited == true
}

countermeasures contains _key_usage_and_key_management_audit_logging_def if {
    count(key_usage_and_key_management_audit_logging) > 0
}
