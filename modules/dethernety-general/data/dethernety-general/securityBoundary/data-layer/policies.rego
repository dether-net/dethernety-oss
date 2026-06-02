package _dt_built_in.exposures.data_layer



_data_store_direct_public_exposure_def := {
    "name": "Direct public exposure of the data store",
    "description": "Data-tier service becomes directly reachable from the internet through a misconfigured security group, a forgotten 0.0.0.0/0 rule, or a developer-convenience public IP.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

data_store_direct_public_exposure[_data_store_direct_public_exposure_def] if {
    input.data_store_publicly_routable == true
}

data_store_direct_public_exposure[_data_store_direct_public_exposure_def] if {
    not input.data_tier_crossing_only_via_app_pep
}

exposures contains _data_store_direct_public_exposure_def if {
    count(data_store_direct_public_exposure) > 0
}

_shared_credential_crossing_def := {
    "name": "Anonymous/shared-credential crossing of the boundary",
    "description": "Per-request workload identity fails: a shared DB superuser credential is reused across all app instances and baked into images/IaC/.env.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

shared_credential_crossing[_shared_credential_crossing_def] if {
    not input.per_workload_db_identity_used
}

shared_credential_crossing[_shared_credential_crossing_def] if {
    not input.data_tier_credentials_short_lived
}

exposures contains _shared_credential_crossing_def if {
    count(shared_credential_crossing) > 0
}

_over_privileged_grants_bulk_harvest_def := {
    "name": "Broken authorization at the crossing - over-privileged grants enabling bulk harvesting",
    "description": "App-tier role holds wildcard grants beyond per-query need, and no volume/rate monitoring exists.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {
                "justification": "Wildcard grants + absent volume/rate monitoring let an authorised identity (or anyone who steals it) scrape the information repository wholesale."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_grants_bulk_harvest[_over_privileged_grants_bulk_harvest_def] if {
    not input.least_privilege_db_account
}

over_privileged_grants_bulk_harvest[_over_privileged_grants_bulk_harvest_def] if {
    not input.bulk_read_volume_anomaly_alerted
}

exposures contains _over_privileged_grants_bulk_harvest_def if {
    count(over_privileged_grants_bulk_harvest) > 0
}

_dba_mgmt_path_bypass_def := {
    "name": "Boundary bypass via trusted DBA / management-path channel",
    "description": "A DBA workstation, third-party DBaaS support account, management VLAN, monitoring agent, or replication link reaches the data tier on a trusted path that skips the app-tier PEP.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

dba_mgmt_path_bypass[_dba_mgmt_path_bypass_def] if {
    not input.privileged_access_via_pam_with_session_recording
}

dba_mgmt_path_bypass[_dba_mgmt_path_bypass_def] if {
    not input.mgmt_paths_subject_to_same_pep_controls
}

exposures contains _dba_mgmt_path_bypass_def if {
    count(dba_mgmt_path_bypass) > 0
}

_peer_lateral_into_data_tier_def := {
    "name": "Lateral movement from a compromised peer workload",
    "description": "A flat app-tier->all-databases allow rule means an attacker who lands RCE in one app workload can pivot east-west into a peer service's store.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "M1035 mitigation expression at the boundary - per-workload-identity ingress scoping."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

peer_lateral_into_data_tier[_peer_lateral_into_data_tier_def] if {
    not input.data_tier_ingress_scoped_per_workload_identity
}

exposures contains _peer_lateral_into_data_tier_def if {
    count(peer_lateral_into_data_tier) > 0
}

_cleartext_intra_vpc_data_tier_def := {
    "name": "Cleartext intra-VPC capture",
    "description": "App-to-data-store traffic is unencrypted on the assumption that the private network is safe.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_intra_vpc_data_tier[_cleartext_intra_vpc_data_tier_def] if {
    not input.data_tier_transit_encrypted
}

exposures contains _cleartext_intra_vpc_data_tier_def if {
    count(cleartext_intra_vpc_data_tier) > 0
}

_backup_snapshot_exfil_def := {
    "name": "Backup / snapshot exfiltration outside the boundary",
    "description": "Backups or snapshots shared with an untrusted account, written to a public bucket, or copied to an unrestricted region. The boundary's runtime controls don't see the egress.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

backup_snapshot_exfil[_backup_snapshot_exfil_def] if {
    not input.backup_destinations_in_approved_region_and_account
}

backup_snapshot_exfil[_backup_snapshot_exfil_def] if {
    not input.backup_egress_audited_separately
}

exposures contains _backup_snapshot_exfil_def if {
    count(backup_snapshot_exfil) > 0
}

_kms_key_admin_no_sod_def := {
    "name": "KMS / key-administrator compromise (no separation of duties)",
    "description": "The same identity that operates the database also administers the wrapping KMS key.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "The wrapping key is the master credential for at-rest plaintext."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {
                "justification": "ScheduleKeyDeletion by a compromised key-admin renders all data wrapped by the key permanently unrecoverable."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Attack premise: an attacker operating with the over-scoped identity that holds both DB-operator and KMS-key-admin permissions."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

kms_key_admin_no_sod[_kms_key_admin_no_sod_def] if {
    not input.kms_admin_separated_from_db_admin
}

kms_key_admin_no_sod[_kms_key_admin_no_sod_def] if {
    not input.kms_key_protection_policy_enforced
}

exposures contains _kms_key_admin_no_sod_def if {
    count(kms_key_admin_no_sod) > 0
}

_data_tier_audit_gap_def := {
    "name": "Unmonitored crossings - audit gap at the boundary",
    "description": "Connection, DDL/DML, and failed-auth events at the data-tier ingress are not logged, or logs ship to a destination within the DBA's own administrative scope.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Without tamper-resistant off-box log shipping, a data-tier compromise can disable or wipe audit telemetry within DBA scope."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Indicator Removal - logs within the same administrative scope can be deleted/altered by an attacker who reaches that scope."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

data_tier_audit_gap[_data_tier_audit_gap_def] if {
    not input.data_tier_crossings_audit_logged_to_tamper_resistant_store
}

data_tier_audit_gap[_data_tier_audit_gap_def] if {
    not input.failed_auth_and_admin_events_alerted
}

exposures contains _data_tier_audit_gap_def if {
    count(data_tier_audit_gap) > 0
}
