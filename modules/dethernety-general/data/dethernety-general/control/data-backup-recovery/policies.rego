package _dt_built_in.countermeasures.data_backup_recovery



_automated_backups_at_adequate_frequency_rpo_def := {
    "name": "Automated backups at adequate frequency (RPO)",
    "description": "The control enforces that backups of in-scope assets run automatically on a schedule at weekly-or-more-frequent cadence, scaled to data sensitivity, bounding the recovery point objective so destruction or ransomware never costs more than the agreed window of data. Presence of a documented recovery process, an enabled scheduled backup job, and a defined RPO is asserted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RD",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Automated, frequency-bounded backups under a documented recovery process preserve recoverable copies so an attacker who deletes snapshots/backups cannot inhibit system recovery (M1053 -> T1490)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {
                "justification": "Regularly-scheduled backups bounding the RPO provide a clean prior copy to restore from after destructive data deletion/overwrite (M1053 -> T1485)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

automated_backups_at_adequate_frequency_rpo[_automated_backups_at_adequate_frequency_rpo_def] if {
    input.automated_backups_configured == true
    input.backup_rpo_hours <= 168
    input.data_recovery_process_documented == true
}

countermeasures contains _automated_backups_at_adequate_frequency_rpo_def if {
    count(automated_backups_at_adequate_frequency_rpo) > 0
}

_backups_encrypted_at_rest_and_in_transit_def := {
    "name": "Backups encrypted at rest and in transit",
    "description": "The control enforces that recovery data receives protection equivalent to the source data \u2014 encryption at rest and in transit with keys held in a separate trust domain \u2014 so a backup copy is not a softer target than primary data. Assessor asserts server-side/client-side encryption is enabled on the backup destination.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "attributes": {
                "justification": "Encrypt Sensitive Information \u2014 backup/recovery data receives encryption equivalent to the source data, the catalog identity of this protection facet (CIS 11.3 / NIST SP 800-209)."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DENCR",
            "attributes": {
                "justification": "Disk Encryption \u2014 encryption-at-rest of the backup storage, the D3FEND Harden identity for protecting backup data at rest."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-FE",
            "attributes": {
                "justification": "File Encryption \u2014 file-level encryption of backup objects, complementing disk encryption for the backup-data-protection identity."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

backups_encrypted_at_rest_and_in_transit[_backups_encrypted_at_rest_and_in_transit_def] if {
    input.backups_encrypted == true
    input.backups_encrypted_in_transit == true
    input.backup_keys_in_separate_trust_domain == true
}

countermeasures contains _backups_encrypted_at_rest_and_in_transit_def if {
    count(backups_encrypted_at_rest_and_in_transit) > 0
}

_backup_immutability_worm_object_lock_def := {
    "name": "Backup immutability (WORM / Object Lock)",
    "description": "The control enforces immutable, WORM-protected backups (S3 Object Lock COMPLIANCE mode with a retention period, vault lock, or equivalent) so an attacker holding valid credentials cannot overwrite or delete historical versions \u2014 the core anti-ransomware property. GOVERNANCE mode is treated as the weaker value because it is bypassable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RO",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Immutable WORM-protected backups (Object Lock COMPLIANCE mode) cannot be deleted or overwritten even by a privileged credential holder, so an adversary cannot inhibit system recovery by destroying historical backup versions."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1486",
            "attributes": {
                "justification": "Immutable point-in-time backup versions survive a ransomware credential compromise, letting the org restore to a clean pre-encryption state rather than pay extortion for impact-encrypted data."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {
                "justification": "COMPLIANCE-mode WORM retention prevents destructive overwrite/deletion of backup object versions, so wiper-style data destruction cannot reach the immutable recovery copies."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

backup_immutability_worm_object_lock[_backup_immutability_worm_object_lock_def] if {
    input.backup_immutability_enabled == true
    input.object_lock_retention_mode == "COMPLIANCE"
}

countermeasures contains _backup_immutability_worm_object_lock_def if {
    count(backup_immutability_worm_object_lock) > 0
}

_isolated_air_gapped_copy_3_2_1_def := {
    "name": "Isolated / air-gapped copy (3-2-1)",
    "description": "The control enforces at least one isolated instance of recovery data \u2014 offline, air-gapped, off-site, or in a separate cloud account/region \u2014 so a compromise of production cannot reach all copies. Presence of a copy living in a trust domain unreachable from production credentials is asserted (3-2-1 rule).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NI",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "An isolated/air-gapped or separate-account/region backup copy cannot be reached and deleted from the production trust domain, so an adversary attempting to inhibit system recovery by destroying backups (T1490) cannot reach all copies."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {
                "justification": "Destructive/wiper actors deleting or overwriting data (T1485) cannot destroy an isolated copy held offline or in a separate cloud account/region, preserving a recoverable instance of the data."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

isolated_air_gapped_copy_3_2_1[_isolated_air_gapped_copy_3_2_1_def] if {
    input.offline_airgapped_backup_exists == true
}

isolated_air_gapped_copy_3_2_1[_isolated_air_gapped_copy_3_2_1_def] if {
    input.backup_copy_in_separate_account_or_region == true
}

countermeasures contains _isolated_air_gapped_copy_3_2_1_def if {
    count(isolated_air_gapped_copy_3_2_1) > 0
}

_backup_access_restricted_to_a_separate_trust_domain_with_mfa_delete_def := {
    "name": "Backup access restricted to a separate trust domain with MFA-delete",
    "description": "The control enforces that backup storage and the restore path authenticate independently of primary-data credentials, with delete/management least-privileged to a dedicated backup role and MFA-delete required to remove versions or change versioning state \u2014 so a single production credential compromise cannot destroy backups.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "attributes": {
                "justification": "Privileged Account Management \u2014 restricting backup delete/management to a dedicated least-privileged backup role in a separate trust domain, with MFA on destructive operations, is the catalog identity of this control facet."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Inhibit System Recovery \u2014 a separate-trust-domain backup access boundary plus MFA-delete means a single production credential compromise cannot delete or alter backup versions, defeating the adversary's attempt to remove the recovery option."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

backup_access_restricted_to_a_separate_trust_domain_with_mfa_delete[_backup_access_restricted_to_a_separate_trust_domain_with_mfa_delete_def] if {
    input.backup_access_restricted == true
    input.mfa_delete_enabled == true
}

countermeasures contains _backup_access_restricted_to_a_separate_trust_domain_with_mfa_delete_def if {
    count(backup_access_restricted_to_a_separate_trust_domain_with_mfa_delete) > 0
}

_restoration_regularly_tested_rto_with_integrity_verification_def := {
    "name": "Restoration regularly tested (RTO) with integrity verification",
    "description": "The control enforces that backup recovery is actually exercised (quarterly or more often for a sampling of assets) with measured RTO and checksum/integrity verification, so an untested or silently-corrupted backup is detected before it is relied on. Presence of dated restore-test records and integrity checks is asserted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.3,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {
                "justification": "Tested restoration with integrity verification is the M1053 Data Backup mitigation's restore-testing procedure \u2014 exercising backups so they are a usable recovery capability when needed."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RD",
            "attributes": {
                "justification": "Integrity-verified, tested restoration implements the D3FEND Restore Database technique \u2014 returning data to a known-good state confirmed via checksum/restore validation."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Regularly tested restoration with integrity verification ensures a viable, uncorrupted recovery path exists, defeating Inhibit System Recovery \u2014 the adversary cannot rely on backups being untested or silently corrupted."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

restoration_regularly_tested_rto_with_integrity_verification[_restoration_regularly_tested_rto_with_integrity_verification_def] if {
    input.restoration_tested_rto == true
    input.restore_test_interval_days <= 90
    input.backup_integrity_verification == true
}

countermeasures contains _restoration_regularly_tested_rto_with_integrity_verification_def if {
    count(restoration_regularly_tested_rto_with_integrity_verification) > 0
}

_retention_versioning_and_point_in_time_recovery_def := {
    "name": "Retention, versioning, and point-in-time recovery",
    "description": "The control enforces version history / PITR and a retention policy long enough to span the realistic detection window, so a clean pre-incident recovery point survives slow-burn corruption or delayed-detonation ransomware rather than restoration being limited to the last full backup.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {
                "justification": "Data Backup mitigation: retention, cloud versioning, and point-in-time recovery preserve a clean recovery point that survives slow-burn corruption and delayed-detonation ransomware."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RD",
            "attributes": {
                "justification": "Restore Database: versioned, point-in-time recovery points enable returning data to a known-good pre-incident state."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Retained version history and PITR provide alternative recovery points an attacker inhibiting system recovery (deleting current snapshots/backups) cannot reach, so a clean pre-incident state survives."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {
                "justification": "Versioned, sufficiently-retained recovery points let the org restore data destroyed/overwritten by a destructive actor from a point before the destruction window."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

retention_versioning_and_point_in_time_recovery[_retention_versioning_and_point_in_time_recovery_def] if {
    input.object_versioning_enabled == true
    input.point_in_time_recovery_enabled == true
    input.backup_retention_days >= 30
}

countermeasures contains _retention_versioning_and_point_in_time_recovery_def if {
    count(retention_versioning_and_point_in_time_recovery) > 0
}

_backup_job_monitoring_and_failure_alerting_def := {
    "name": "Backup job monitoring and failure alerting",
    "description": "The control enforces monitoring of backup job success/failure and of changes to Object Lock / versioning state, alerting on failure so a silently-failing backup or tampering with the protection state is caught before recovery is needed. Presence of wired alerting on backup events is asserted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1053",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PM",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {
                "justification": "Monitoring backup-job success/failure and alerting on changes to Object Lock / versioning state surfaces an adversary's attempt to inhibit system recovery (deleting/tampering with backups) before recovery is needed, supporting the backup-data mitigation (M1053) against Inhibit System Recovery."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

backup_job_monitoring_and_failure_alerting[_backup_job_monitoring_and_failure_alerting_def] if {
    input.backup_job_monitoring_enabled == true
    input.backup_failure_alerting_enabled == true
}

countermeasures contains _backup_job_monitoring_and_failure_alerting_def if {
    count(backup_job_monitoring_and_failure_alerting) > 0
}
