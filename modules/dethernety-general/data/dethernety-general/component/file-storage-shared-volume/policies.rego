package _dt_built_in.exposures.file_storage_shared_volume



_smbv1_wormable_remote_code_execution_def := {
    "name": "SMBv1 wormable remote code execution",
    "description": "The legacy SMBv1/CIFS dialect is left enabled, exposing the file server to the wormable EternalBlue (MS17-010) remote-code-execution flaw that propagated WannaCry and NotPetya. SMBv1 lacks signing, encryption, and pre-auth integrity, so its presence also enables protocol downgrade from hardened SMB3.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

smbv1_wormable_remote_code_execution[_smbv1_wormable_remote_code_execution_def] if {
    input.smbv1_enabled == true
}

smbv1_wormable_remote_code_execution[_smbv1_wormable_remote_code_execution_def] if {
    input.min_smb_dialect in ["SMB1", "SMB1.0", "CIFS"]
}

exposures contains _smbv1_wormable_remote_code_execution_def if {
    count(smbv1_wormable_remote_code_execution) > 0
}

_over_broad_world_readable_shares_least_privilege_failure_def := {
    "name": "Over-broad / world-readable shares (least-privilege failure)",
    "description": "Shares grant Everyone or Authenticated Users Full Control, or NFS exports use a wildcard '*'/0.0.0.0/0 client spec and blanket rw, so any reachable principal can read, tamper with, or mass-encrypt files. Access-Based Enumeration disabled further exposes sensitive file/folder names for reconnaissance.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1039",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1135",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_world_readable_shares_least_privilege_failure[_over_broad_world_readable_shares_least_privilege_failure_def] if {
    input.everyone_full_control_share == true
}

over_broad_world_readable_shares_least_privilege_failure[_over_broad_world_readable_shares_least_privilege_failure_def] if {
    input.nfs_export_wildcard_rw == true
}

over_broad_world_readable_shares_least_privilege_failure[_over_broad_world_readable_shares_least_privilege_failure_def] if {
    not input.least_privilege_access_enforced
}

over_broad_world_readable_shares_least_privilege_failure[_over_broad_world_readable_shares_least_privilege_failure_def] if {
    input.access_based_enumeration_disabled == true
}

exposures contains _over_broad_world_readable_shares_least_privilege_failure_def if {
    count(over_broad_world_readable_shares_least_privilege_failure) > 0
}

_anonymous_guest_null_session_access_def := {
    "name": "Anonymous / guest / null-session access",
    "description": "Insecure SMB guest logons (AllowInsecureGuestAuth=1), null sessions, or AUTH_SYS NFS (sec=sys) permit unauthenticated enumeration and access of shares without valid credentials. Guest logons also carry no password and disable signing/encryption, enabling AiTM and malicious-server attacks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1135",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_guest_null_session_access[_anonymous_guest_null_session_access_def] if {
    input.insecure_guest_auth_allowed == true
}

anonymous_guest_null_session_access[_anonymous_guest_null_session_access_def] if {
    input.null_session_access_allowed == true
}

anonymous_guest_null_session_access[_anonymous_guest_null_session_access_def] if {
    input.nfs_auth_sys_only == true
}

exposures contains _anonymous_guest_null_session_access_def if {
    count(anonymous_guest_null_session_access) > 0
}

_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def := {
    "name": "SMB relay / signing-downgrade and cleartext interception (AiTM)",
    "description": "Without mandatory SMB signing (RequireSecuritySignature) and SMB3 encryption (EncryptData/RejectUnencryptedAccess), or with NTLM permitted, an adjacent attacker relays credentials, downgrades the session, or sniffs/MITMs SMB and AUTH_SYS NFS traffic to steal credentials and data in transit.",
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
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1187",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.002",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

smb_relay_signing_downgrade_and_cleartext_interception_aitm[_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def] if {
    not input.smb_signing_required
}

smb_relay_signing_downgrade_and_cleartext_interception_aitm[_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def] if {
    not input.smb3_encryption_required
}

smb_relay_signing_downgrade_and_cleartext_interception_aitm[_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def] if {
    not input.reject_unencrypted_access
}

smb_relay_signing_downgrade_and_cleartext_interception_aitm[_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def] if {
    not input.smb_ntlm_blocked
}

smb_relay_signing_downgrade_and_cleartext_interception_aitm[_smb_relay_signing_downgrade_and_cleartext_interception_aitm_def] if {
    input.nfs_export_security_flavor == "sys"
}

exposures contains _smb_relay_signing_downgrade_and_cleartext_interception_aitm_def if {
    count(smb_relay_signing_downgrade_and_cleartext_interception_aitm) > 0
}

_nfs_no_root_squash_privilege_escalation_data_tampering_def := {
    "name": "NFS no_root_squash privilege escalation / data tampering",
    "description": "An NFS export configured with no_root_squash trusts the client's root (UID 0), letting a client-root attacker read and modify server-side files as root \u2014 drop SUID binaries, alter ACLs, or tamper with data \u2014 escalating privilege on the storage host.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {
                "justification": "An NFS export with no_root_squash trusts client-supplied UID 0, letting a client-root attacker write files as root on the server (e.g. drop a SUID-root binary) to escalate privilege on the storage host."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "attributes": {
                "justification": "Client root retained via no_root_squash can modify server-side file and directory permissions/ACLs and tamper with data, matching File and Directory Permissions Modification."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

nfs_no_root_squash_privilege_escalation_data_tampering[_nfs_no_root_squash_privilege_escalation_data_tampering_def] if {
    input.nfs_no_root_squash_set == true
}

exposures contains _nfs_no_root_squash_privilege_escalation_data_tampering_def if {
    count(nfs_no_root_squash_privilege_escalation_data_tampering) > 0
}

_ransomware_mass_encryption_of_shares_def := {
    "name": "Ransomware mass-encryption of shares",
    "description": "Compromised credentials or unpatched NAS firmware/app flaws let ransomware enumerate and encrypt every reachable share and delete writable snapshots/online backups (Qlocker, DeadBolt, eCh0raix on QNAP/Synology). Without immutable/WORM snapshots and an offline/air-gapped backup, recovery is impossible.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1486",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.immutable_worm_snapshots_enabled
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.offline_airgapped_backup_exists
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.ransomware_mass_change_detection_enabled
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.edge_appliance_patched_within_sla
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.config_backed_up_to_known_good
}

ransomware_mass_encryption_of_shares[_ransomware_mass_encryption_of_shares_def] if {
    not input.rollback_tested
}

exposures contains _ransomware_mass_encryption_of_shares_def if {
    count(ransomware_mass_encryption_of_shares) > 0
}

_internet_exposed_unsegmented_file_sharing_service_def := {
    "name": "Internet-exposed / unsegmented file-sharing service",
    "description": "SMB (TCP 445/139) or NFS (TCP/UDP 2049 + rpcbind 111) listening on a public interface or reachable from untrusted VLANs exposes the store to direct exploitation, brute force, and ransomware scanners \u2014 the network condition behind the mass NAS-ransomware campaigns.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1135",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_unsegmented_file_sharing_service[_internet_exposed_unsegmented_file_sharing_service_def] if {
    input.data_store_publicly_routable == true
}

internet_exposed_unsegmented_file_sharing_service[_internet_exposed_unsegmented_file_sharing_service_def] if {
    input.file_sharing_ports_internet_exposed == true
}

internet_exposed_unsegmented_file_sharing_service[_internet_exposed_unsegmented_file_sharing_service_def] if {
    not input.segment_boundary_enforced
}

exposures contains _internet_exposed_unsegmented_file_sharing_service_def if {
    count(internet_exposed_unsegmented_file_sharing_service) > 0
}

_unencrypted_data_at_rest_data_remanence_on_decommissioned_media_def := {
    "name": "Unencrypted data at rest / data remanence on decommissioned media",
    "description": "The underlying volume is stored in plaintext (no BitLocker/LUKS/NAS volume encryption \u2014 in-transit SMB/NFS encryption does NOT cover at-rest), so stolen, lost, or improperly sanitized disks leak sensitive files. Drives reused or disposed without NIST SP 800-88 sanitization leave recoverable data remanence.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

unencrypted_data_at_rest_data_remanence_on_decommissioned_media[_unencrypted_data_at_rest_data_remanence_on_decommissioned_media_def] if {
    not input.encrypted_at_rest
}

unencrypted_data_at_rest_data_remanence_on_decommissioned_media[_unencrypted_data_at_rest_data_remanence_on_decommissioned_media_def] if {
    not input.media_sanitized_before_disposal
}

unencrypted_data_at_rest_data_remanence_on_decommissioned_media[_unencrypted_data_at_rest_data_remanence_on_decommissioned_media_def] if {
    not input.secure_deletion_or_crypto_shred
}

exposures contains _unencrypted_data_at_rest_data_remanence_on_decommissioned_media_def if {
    count(unencrypted_data_at_rest_data_remanence_on_decommissioned_media) > 0
}

_bulk_data_exfiltration_without_dlp_or_access_auditing_def := {
    "name": "Bulk data exfiltration without DLP or access auditing",
    "description": "An attacker or insider with read access copies sensitive files at volume; with no file-access/object-access audit logging (Windows SACL / Linux auditd shipped to SIEM) and no DLP on egress paths, the abnormal bulk read goes undetected and unattributed.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1039",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

bulk_data_exfiltration_without_dlp_or_access_auditing[_bulk_data_exfiltration_without_dlp_or_access_auditing_def] if {
    not input.access_audit_trail_enabled
}

bulk_data_exfiltration_without_dlp_or_access_auditing[_bulk_data_exfiltration_without_dlp_or_access_auditing_def] if {
    not input.dlp_egress_controls_enabled
}

bulk_data_exfiltration_without_dlp_or_access_auditing[_bulk_data_exfiltration_without_dlp_or_access_auditing_def] if {
    not input.bulk_export_monitored_and_alerted
}

exposures contains _bulk_data_exfiltration_without_dlp_or_access_auditing_def if {
    count(bulk_data_exfiltration_without_dlp_or_access_auditing) > 0
}

_unpatched_nas_appliance_firmware_online_brute_force_surface_def := {
    "name": "Unpatched NAS appliance firmware (online brute force surface)",
    "description": "Outdated NAS firmware and bundled apps carry KEV-listed CVEs mass-exploited by ransomware (QNAP HBS 3 / Photo Station). Combined with an unthrottled SMB authentication rate limiter, exposed admin UIs and shares also permit high-rate online credential brute force against the store.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_nas_appliance_firmware_online_brute_force_surface[_unpatched_nas_appliance_firmware_online_brute_force_surface_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_nas_appliance_firmware_online_brute_force_surface[_unpatched_nas_appliance_firmware_online_brute_force_surface_def] if {
    not input.edge_appliance_patched_within_sla
}

unpatched_nas_appliance_firmware_online_brute_force_surface[_unpatched_nas_appliance_firmware_online_brute_force_surface_def] if {
    input.unnecessary_nas_apps_enabled == true
}

unpatched_nas_appliance_firmware_online_brute_force_surface[_unpatched_nas_appliance_firmware_online_brute_force_surface_def] if {
    not input.rate_limiting_or_lockout_enabled
}

exposures contains _unpatched_nas_appliance_firmware_online_brute_force_surface_def if {
    count(unpatched_nas_appliance_firmware_online_brute_force_surface) > 0
}
