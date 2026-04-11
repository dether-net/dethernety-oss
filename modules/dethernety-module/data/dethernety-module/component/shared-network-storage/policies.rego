package _dt_built_in.exposures.shared_network_storage

_unrestricted_nfs_export_policy_def := {
    "name": "Unrestricted Nfs Export Policy",
    "description": "NFS exports configured with wildcard host entries (e.g., '*' or '0.0.0.0/0') allow any host on the network to mount the share, bypassing intended access control boundaries.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unrestricted_nfs_export_policy[_unrestricted_nfs_export_policy_def] if {
    input.export_host_pattern == "*"
}

unrestricted_nfs_export_policy[_unrestricted_nfs_export_policy_def] if {
    input.export_host_pattern == "0.0.0.0/0"
}

unrestricted_nfs_export_policy[_unrestricted_nfs_export_policy_def] if {
    regex.match("^(\\*|0\\.0\\.0\\.0/0)$", input.export_host_pattern)
    "no_root_squash" in input.export_options
}

exposures contains _unrestricted_nfs_export_policy_def if {
    count(unrestricted_nfs_export_policy) > 0
}

_nfs_root_squash_disabled_def := {
    "name": "Nfs Root Squash Disabled",
    "description": "When root_squash or all_squash is not enabled on NFS exports, remote root users retain root-level privileges on the mounted share, enabling privilege escalation and unauthorized file modification.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

nfs_root_squash_disabled[_nfs_root_squash_disabled_def] if {
    not input.root_squash_enabled
    not input.all_squash_enabled
}

exposures contains _nfs_root_squash_disabled_def if {
    count(nfs_root_squash_disabled) > 0
}

_unencrypted_data_in_transit_def := {
    "name": "Unencrypted Data In Transit",
    "description": "NFS or SMB traffic transmitted without TLS/Kerberos encryption or SMB signing allows network attackers to intercept, read, or modify data in transit through packet capture or man-in-the-middle attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_data_in_transit[_unencrypted_data_in_transit_def] if {
    not input.transport_encryption_enabled
}

unencrypted_data_in_transit[_unencrypted_data_in_transit_def] if {
    not input.smb_signing_enabled
    input.protocol_version in ["smbv1", "smbv2", "smbv3"]
}

unencrypted_data_in_transit[_unencrypted_data_in_transit_def] if {
    input.protocol_version in ["nfsv2", "nfsv3", "smbv1"]
}

exposures contains _unencrypted_data_in_transit_def if {
    count(unencrypted_data_in_transit) > 0
}

_missing_or_weak_authentication_mechanism_def := {
    "name": "Missing Or Weak Authentication Mechanism",
    "description": "NFS configured in AUTH_SYS (host-based UID/GID trust) rather than Kerberos (krb5, krb5i, krb5p) allows any client that spoofs a UID to impersonate any user without cryptographic verification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_or_weak_authentication_mechanism[_missing_or_weak_authentication_mechanism_def] if {
    input.nfs_auth_flavor in ["auth_sys", "none"]
}

missing_or_weak_authentication_mechanism[_missing_or_weak_authentication_mechanism_def] if {
    not input.nfs_auth_flavor in ["krb5", "krb5i", "krb5p"]
    not input.kerberos_configured
}

exposures contains _missing_or_weak_authentication_mechanism_def if {
    count(missing_or_weak_authentication_mechanism) > 0
}

_overly_permissive_smb_share_permissions_def := {
    "name": "Overly Permissive Smb Share Permissions",
    "description": "SMB shares configured with full write access granted to all authenticated users or domain groups beyond operational need allow unauthorized data modification or deletion.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Everyone" in input.write_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Everyone" in input.full_control_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Authenticated Users" in input.write_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Authenticated Users" in input.full_control_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Domain Users" in input.write_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "Domain Users" in input.full_control_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "BUILTIN\\Users" in input.write_principals
}

overly_permissive_smb_share_permissions[_overly_permissive_smb_share_permissions_def] if {
    "BUILTIN\\Users" in input.full_control_principals
}

exposures contains _overly_permissive_smb_share_permissions_def if {
    count(overly_permissive_smb_share_permissions) > 0
}

_unpatched_storage_server_software_def := {
    "name": "Unpatched Storage Server Software",
    "description": "Failure to apply OS and storage daemon patches (e.g., nfsd, samba) leaves the system vulnerable to publicly known CVEs, including remote code execution and privilege escalation vulnerabilities.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unpatched_storage_server_software[_unpatched_storage_server_software_def] if {
    count(input.known_unpatched_cves) > 0
}

unpatched_storage_server_software[_unpatched_storage_server_software_def] if {
    input.days_since_last_patch > 90
}

unpatched_storage_server_software[_unpatched_storage_server_software_def] if {
    input.storage_daemon_version_eol == true
}

exposures contains _unpatched_storage_server_software_def if {
    count(unpatched_storage_server_software) > 0
}

_network_exposure_without_firewall_restriction_def := {
    "name": "Network Exposure Without Firewall Restriction",
    "description": "Storage ports (NFS: 2049, mountd: 111; SMB: 445; iSCSI: 3260) accessible from broad network segments rather than restricted to specific client subnets increases the attack surface for unauthorized mount or connection attempts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

network_exposure_without_firewall_restriction[_network_exposure_without_firewall_restriction_def] if {
    not input.client_subnet_restriction_enforced
}

network_exposure_without_firewall_restriction[_network_exposure_without_firewall_restriction_def] if {
    count(input.exposed_storage_protocols) > 0
    input.storage_ports_allowed_cidr == "0.0.0.0/0"
}

network_exposure_without_firewall_restriction[_network_exposure_without_firewall_restriction_def] if {
    count(input.exposed_storage_protocols) > 0
    input.storage_ports_allowed_cidr == "::/0"
}

exposures contains _network_exposure_without_firewall_restriction_def if {
    count(network_exposure_without_firewall_restriction) > 0
}

_inadequate_access_logging_and_auditing_def := {
    "name": "Inadequate Access Logging And Auditing",
    "description": "Insufficient logging of mount events, file access, permission changes, and failed authentication attempts prevents detection of unauthorized access and complicates forensic investigation after a breach.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

inadequate_access_logging_and_auditing[_inadequate_access_logging_and_auditing_def] if {
    not input.mount_event_logging_enabled
}

inadequate_access_logging_and_auditing[_inadequate_access_logging_and_auditing_def] if {
    not input.file_access_audit_logging_enabled
}

inadequate_access_logging_and_auditing[_inadequate_access_logging_and_auditing_def] if {
    not input.failed_auth_logging_enabled
}

inadequate_access_logging_and_auditing[_inadequate_access_logging_and_auditing_def] if {
    not input.permission_change_logging_enabled
}

exposures contains _inadequate_access_logging_and_auditing_def if {
    count(inadequate_access_logging_and_auditing) > 0
}

_unencrypted_data_at_rest_def := {
    "name": "Unencrypted Data At Rest",
    "description": "Storage volumes lacking at-rest encryption (e.g., dm-crypt/LUKS, ZFS native encryption) expose raw data to anyone with physical or hypervisor-level access to the underlying storage media.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.volume_encryption_enabled
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.volume_encryption_enabled
    input.volume_accessible_over_network == true
}

exposures contains _unencrypted_data_at_rest_def if {
    count(unencrypted_data_at_rest) > 0
}

_world_readable_sensitive_exports_def := {
    "name": "World Readable Sensitive Exports",
    "description": "Export options such as 'ro' applied globally without host or user scoping allow any mounting client to read sensitive data, including backup archives and configuration files, without authorization.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

world_readable_sensitive_exports[_world_readable_sensitive_exports_def] if {
    input.export_scope == "global"
    input.export_access_mode == "ro"
    input.exports_contain_sensitive_paths == true
    input.auth_mechanism in ["none", "sys"]
}

world_readable_sensitive_exports[_world_readable_sensitive_exports_def] if {
    input.export_scope == "global"
    input.export_access_mode == "rw"
    input.exports_contain_sensitive_paths == true
    input.auth_mechanism in ["none", "sys"]
}

exposures contains _world_readable_sensitive_exports_def if {
    count(world_readable_sensitive_exports) > 0
}

_insecure_backup_credential_storage_def := {
    "name": "Insecure Backup Credential Storage",
    "description": "Backup agent credentials or service account passwords stored in plaintext configuration files on the storage server can be harvested by attackers with local file read access.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insecure_backup_credential_storage[_insecure_backup_credential_storage_def] if {
    input.credential_storage_format == "plaintext"
}

insecure_backup_credential_storage[_insecure_backup_credential_storage_def] if {
    not input.credential_storage_format in ["plaintext", "secrets_manager_reference", "none"]
    input.config_file_world_readable == true
    not input.secrets_manager_enforced
}

exposures contains _insecure_backup_credential_storage_def if {
    count(insecure_backup_credential_storage) > 0
}

_absence_of_snapshot_or_immutable_backup_protection_def := {
    "name": "Absence Of Snapshot Or Immutable Backup Protection",
    "description": "Storage systems without read-only snapshots or WORM (write-once-read-many) policies allow ransomware or insider threats to overwrite or delete all backup copies stored on the share.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absence_of_snapshot_or_immutable_backup_protection[_absence_of_snapshot_or_immutable_backup_protection_def] if {
    not input.snapshot_policy_enabled
    not input.worm_policy_enabled
}

absence_of_snapshot_or_immutable_backup_protection[_absence_of_snapshot_or_immutable_backup_protection_def] if {
    input.snapshot_policy_enabled == true
    not input.worm_policy_enabled
    input.snapshot_retention_days < 7
}

exposures contains _absence_of_snapshot_or_immutable_backup_protection_def if {
    count(absence_of_snapshot_or_immutable_backup_protection) > 0
}

_excessive_daemon_privileges_def := {
    "name": "Excessive Daemon Privileges",
    "description": "NFS or SMB daemons running as root rather than a dedicated low-privilege service account amplify the impact of any daemon-level vulnerability, potentially granting full system compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

excessive_daemon_privileges[_excessive_daemon_privileges_def] if {
    input.daemon_process_user == "root"
}

excessive_daemon_privileges[_excessive_daemon_privileges_def] if {
    not input.dedicated_service_account_exists
    input.daemon_process_user == "root"
}

excessive_daemon_privileges[_excessive_daemon_privileges_def] if {
    input.daemon_process_user == "root"
    input.daemon_has_cap_net_bind_or_sys_admin == true
}

exposures contains _excessive_daemon_privileges_def if {
    count(excessive_daemon_privileges) > 0
}

_smb_signing_disabled_def := {
    "name": "Smb Signing Disabled",
    "description": "SMB connections without mandatory message signing are vulnerable to relay and NTLM relay attacks, allowing an attacker to impersonate a storage client and access shares under a legitimate identity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

smb_signing_disabled[_smb_signing_disabled_def] if {
    not input.smb_signing_required
    not input.smb_signing_enabled
}

smb_signing_disabled[_smb_signing_disabled_def] if {
    not input.smb_signing_required
    input.smb_signing_enabled == true
}

exposures contains _smb_signing_disabled_def if {
    count(smb_signing_disabled) > 0
}

_default_or_shared_service_account_credentials_def := {
    "name": "Default Or Shared Service Account Credentials",
    "description": "Storage management interfaces or backup agents using default vendor credentials or shared service accounts across multiple systems create a single point of credential compromise for broad storage access.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

default_or_shared_service_account_credentials[_default_or_shared_service_account_credentials_def] if {
    input.uses_default_vendor_credentials == true
}

default_or_shared_service_account_credentials[_default_or_shared_service_account_credentials_def] if {
    input.service_account_shared_across_systems == true
    not input.credential_rotation_enforced
}

exposures contains _default_or_shared_service_account_credentials_def if {
    count(default_or_shared_service_account_credentials) > 0
}

_missing_disk_quota_enforcement_def := {
    "name": "Missing Disk Quota Enforcement",
    "description": "Absence of per-user or per-share disk quotas allows any authorized or compromised client to fill storage volumes, causing denial of service for all dependent systems including backup targets.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

missing_disk_quota_enforcement[_missing_disk_quota_enforcement_def] if {
    not input.disk_quotas_enabled
}

missing_disk_quota_enforcement[_missing_disk_quota_enforcement_def] if {
    input.disk_quotas_enabled == true
    input.quota_scope == "none"
}

exposures contains _missing_disk_quota_enforcement_def if {
    count(missing_disk_quota_enforcement) > 0
}

_unused_protocols_and_services_enabled_def := {
    "name": "Unused Protocols And Services Enabled",
    "description": "Enabling unused storage protocols (e.g., FTP, rsh, telnet management interfaces) on the storage server unnecessarily expands the attack surface with services that may lack hardening or receive less patch attention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

unused_protocols_and_services_enabled[_unused_protocols_and_services_enabled_def] if {
    "ftp" in input.enabled_storage_protocols
    not input.insecure_legacy_protocols_justified
}

unused_protocols_and_services_enabled[_unused_protocols_and_services_enabled_def] if {
    "telnet" in input.enabled_storage_protocols
    not input.insecure_legacy_protocols_justified
}

unused_protocols_and_services_enabled[_unused_protocols_and_services_enabled_def] if {
    "rsh" in input.enabled_storage_protocols
    not input.insecure_legacy_protocols_justified
}

unused_protocols_and_services_enabled[_unused_protocols_and_services_enabled_def] if {
    "http" in input.enabled_storage_protocols
    not input.insecure_legacy_protocols_justified
}

exposures contains _unused_protocols_and_services_enabled_def if {
    count(unused_protocols_and_services_enabled) > 0
}
