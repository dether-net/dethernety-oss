package _dt_built_in.exposures.nas_appliance



_default_or_weak_admin_credentials_def := {
    "name": "Default Or Weak Admin Credentials",
    "description": "The NAS management interface or share access retains factory-default credentials or is configured with weak passwords, allowing unauthorized administrative takeover or data access without brute-force resistance.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

default_or_weak_admin_credentials[_default_or_weak_admin_credentials_def] if {
    input.default_credentials_unchanged == true
}

default_or_weak_admin_credentials[_default_or_weak_admin_credentials_def] if {
    not input.password_complexity_policy_enforced
    not input.admin_account_lockout_enabled
}

exposures contains _default_or_weak_admin_credentials_def if {
    count(default_or_weak_admin_credentials) > 0
}

_unauthenticated_or_guest_share_access_def := {
    "name": "Unauthenticated Or Guest Share Access",
    "description": "Network shares (SMB, NFS, FTP) are configured to allow guest or anonymous access without credentials, exposing file data to any host that can reach the appliance on the network.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unauthenticated_or_guest_share_access[_unauthenticated_or_guest_share_access_def] if {
    input.guest_access_enabled == true
    input.network_exposure_scope == "external"
}

unauthenticated_or_guest_share_access[_unauthenticated_or_guest_share_access_def] if {
    input.guest_access_enabled == true
    input.network_exposure_scope == "internal"
}

unauthenticated_or_guest_share_access[_unauthenticated_or_guest_share_access_def] if {
    input.guest_access_enabled == true
    input.share_write_permission_granted == true
}

exposures contains _unauthenticated_or_guest_share_access_def if {
    count(unauthenticated_or_guest_share_access) > 0
}

_unencrypted_data_at_rest_def := {
    "name": "Unencrypted Data At Rest",
    "description": "Volumes or shares are not encrypted at the storage layer, so physical removal of drives or direct storage access yields plaintext data without requiring authentication bypass.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.volume_encryption_enabled
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    input.encryption_scope in ["partial", "none"]
}

exposures contains _unencrypted_data_at_rest_def if {
    count(unencrypted_data_at_rest) > 0
}

_unencrypted_backup_streams_def := {
    "name": "Unencrypted Backup Streams",
    "description": "Backup jobs transmitted to remote destinations or written to external media do not use encryption, exposing backup data to interception in transit or theft of backup media.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_backup_streams[_unencrypted_backup_streams_def] if {
    input.backup_destination_type == "network"
    not input.backup_encryption_enabled
}

unencrypted_backup_streams[_unencrypted_backup_streams_def] if {
    input.backup_destination_type == "network"
    input.transport_protocol in ["ftp", "http", "rsync_unencrypted", "smb_unencrypted", "nfs_unencrypted"]
}

unencrypted_backup_streams[_unencrypted_backup_streams_def] if {
    input.backup_destination_type == "local_media"
    not input.backup_encryption_enabled
}

exposures contains _unencrypted_backup_streams_def if {
    count(unencrypted_backup_streams) > 0
}

_insecure_management_interface_exposure_def := {
    "name": "Insecure Management Interface Exposure",
    "description": "The web-based or API management interface is bound to all network interfaces including untrusted segments, uses HTTP instead of HTTPS, or does not enforce certificate validation, enabling credential interception or unauthorized management access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

insecure_management_interface_exposure[_insecure_management_interface_exposure_def] if {
    not input.management_interface_tls_enabled
}

insecure_management_interface_exposure[_insecure_management_interface_exposure_def] if {
    input.management_interface_network_binding == "all_interfaces"
}

insecure_management_interface_exposure[_insecure_management_interface_exposure_def] if {
    input.management_interface_tls_enabled == true
    not input.certificate_validation_enforced
}

exposures contains _insecure_management_interface_exposure_def if {
    count(insecure_management_interface_exposure) > 0
}

_unpatched_firmware_and_os_def := {
    "name": "Unpatched Firmware And Os",
    "description": "The NAS appliance runs outdated firmware or embedded OS versions containing known CVEs, allowing attackers to exploit published vulnerabilities to achieve remote code execution or privilege escalation on the device.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unpatched_firmware_and_os[_unpatched_firmware_and_os_def] if {
    input.firmware_version_has_known_cve == true
}

unpatched_firmware_and_os[_unpatched_firmware_and_os_def] if {
    input.days_since_last_firmware_update > 180
    not input.auto_update_enabled
}

exposures contains _unpatched_firmware_and_os_def if {
    count(unpatched_firmware_and_os) > 0
}

_overly_permissive_share_acls_def := {
    "name": "Overly Permissive Share Acls",
    "description": "Share-level or filesystem ACLs grant write or full-control permissions to broad groups (e.g., Everyone, Domain Users) beyond operational need, enabling data tampering, ransomware encryption of shares, or privilege escalation through writable paths.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

overly_permissive_share_acls[_overly_permissive_share_acls_def] if {
    count(input.broad_write_principals) > 0
    input.permission_level_granted == "read_write"
}

overly_permissive_share_acls[_overly_permissive_share_acls_def] if {
    count(input.broad_write_principals) > 0
    input.permission_level_granted == "full_control"
}

exposures contains _overly_permissive_share_acls_def if {
    count(overly_permissive_share_acls) > 0
}

_insecure_legacy_protocol_enablement_def := {
    "name": "Insecure Legacy Protocol Enablement",
    "description": "Insecure or deprecated protocols such as SMBv1, NFSv2, FTPv1, or Telnet are enabled, exposing the appliance to known exploitation frameworks (e.g., EternalBlue) and plaintext credential capture.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    "SMBv1" in input.enabled_protocols
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    "NFSv2" in input.enabled_protocols
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    "FTP" in input.enabled_protocols
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    "Telnet" in input.enabled_protocols
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    input.plaintext_management_enabled == true
}

insecure_legacy_protocol_enablement[_insecure_legacy_protocol_enablement_def] if {
    input.insecure_protocol_enforcement_disabled == true
}

exposures contains _insecure_legacy_protocol_enablement_def if {
    count(insecure_legacy_protocol_enablement) > 0
}

_missing_or_disabled_audit_logging_def := {
    "name": "Missing Or Disabled Audit Logging",
    "description": "File access, authentication events, administrative changes, and share permission modifications are not logged or logs are stored only locally without forwarding to a SIEM, preventing detection and forensic reconstruction of incidents.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

missing_or_disabled_audit_logging[_missing_or_disabled_audit_logging_def] if {
    not input.audit_logging_enabled
}

missing_or_disabled_audit_logging[_missing_or_disabled_audit_logging_def] if {
    input.audit_logging_enabled == true
    not input.log_forwarding_configured
}

missing_or_disabled_audit_logging[_missing_or_disabled_audit_logging_def] if {
    input.audit_logging_enabled == true
    input.log_forwarding_configured == true
    not "file_access" in input.logged_event_categories
}

missing_or_disabled_audit_logging[_missing_or_disabled_audit_logging_def] if {
    input.audit_logging_enabled == true
    input.log_forwarding_configured == true
    not "authentication" in input.logged_event_categories
}

exposures contains _missing_or_disabled_audit_logging_def if {
    count(missing_or_disabled_audit_logging) > 0
}

_snapshot_and_backup_misconfiguration_def := {
    "name": "Snapshot And Backup Misconfiguration",
    "description": "Snapshots are disabled, set to insufficient retention intervals, or stored on the same volume they protect, removing the ability to recover from ransomware or accidental deletion and negating recovery SLAs.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

snapshot_and_backup_misconfiguration[_snapshot_and_backup_misconfiguration_def] if {
    not input.snapshots_enabled
}

snapshot_and_backup_misconfiguration[_snapshot_and_backup_misconfiguration_def] if {
    input.snapshots_enabled == true
    input.snapshot_retention_days < 3
}

snapshot_and_backup_misconfiguration[_snapshot_and_backup_misconfiguration_def] if {
    input.snapshots_enabled == true
    input.snapshot_stored_on_same_volume == true
}

exposures contains _snapshot_and_backup_misconfiguration_def if {
    count(snapshot_and_backup_misconfiguration) > 0
}

_excessive_privileged_local_accounts_def := {
    "name": "Excessive Privileged Local Accounts",
    "description": "Multiple local administrator accounts exist beyond operational requirements, service accounts are granted administrator roles, or shared administrative credentials are used, increasing the blast radius of any single credential compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

excessive_privileged_local_accounts[_excessive_privileged_local_accounts_def] if {
    input.local_admin_account_count > 2
}

excessive_privileged_local_accounts[_excessive_privileged_local_accounts_def] if {
    input.service_accounts_with_admin_role == true
}

excessive_privileged_local_accounts[_excessive_privileged_local_accounts_def] if {
    input.shared_admin_credentials_in_use == true
}

exposures contains _excessive_privileged_local_accounts_def if {
    count(excessive_privileged_local_accounts) > 0
}

_hardcoded_or_plaintext_stored_credentials_def := {
    "name": "Hardcoded Or Plaintext Stored Credentials",
    "description": "Backup job credentials, LDAP bind passwords, or remote replication credentials are stored in plaintext configuration files or embedded in scripts accessible on the appliance filesystem.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

hardcoded_or_plaintext_stored_credentials[_hardcoded_or_plaintext_stored_credentials_def] if {
    not input.credential_files_encrypted
}

hardcoded_or_plaintext_stored_credentials[_hardcoded_or_plaintext_stored_credentials_def] if {
    input.scripts_contain_hardcoded_credentials == true
}

hardcoded_or_plaintext_stored_credentials[_hardcoded_or_plaintext_stored_credentials_def] if {
    input.credential_store_type == "plaintext_file"
}

exposures contains _hardcoded_or_plaintext_stored_credentials_def if {
    count(hardcoded_or_plaintext_stored_credentials) > 0
}

_unrestricted_nfs_exports_by_host_def := {
    "name": "Unrestricted Nfs Exports By Host",
    "description": "NFS exports are configured with wildcard host specifications (e.g., *) or overly broad IP ranges rather than specific trusted client addresses, allowing any reachable host to mount and access exported filesystems.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unrestricted_nfs_exports_by_host[_unrestricted_nfs_exports_by_host_def] if {
    input.export_host_specification == "*"
}

unrestricted_nfs_exports_by_host[_unrestricted_nfs_exports_by_host_def] if {
    regex.match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/[0-9]$", input.export_host_specification)
}

unrestricted_nfs_exports_by_host[_unrestricted_nfs_exports_by_host_def] if {
    regex.match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/1[0-6]$", input.export_host_specification)
}

unrestricted_nfs_exports_by_host[_unrestricted_nfs_exports_by_host_def] if {
    contains(input.export_host_specification, "*")
    input.export_options_include_no_root_squash == true
}

exposures contains _unrestricted_nfs_exports_by_host_def if {
    count(unrestricted_nfs_exports_by_host) > 0
}

_missing_multi_factor_authentication_on_management_def := {
    "name": "Missing Multi Factor Authentication On Management",
    "description": "The administrative management interface does not enforce multi-factor authentication, relying solely on username and password, making it vulnerable to credential stuffing, phishing-obtained passwords, or brute-force attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

missing_multi_factor_authentication_on_management[_missing_multi_factor_authentication_on_management_def] if {
    not input.mfa_enforced_on_management_ui
}

missing_multi_factor_authentication_on_management[_missing_multi_factor_authentication_on_management_def] if {
    not "totp" in input.authentication_methods_enabled
    not "hardware_token" in input.authentication_methods_enabled
    not "push_notification" in input.authentication_methods_enabled
    not "saml_mfa" in input.authentication_methods_enabled
}

exposures contains _missing_multi_factor_authentication_on_management_def if {
    count(missing_multi_factor_authentication_on_management) > 0
}

_network_binding_to_untrusted_interfaces_def := {
    "name": "Network Binding To Untrusted Interfaces",
    "description": "Storage protocols and the management interface are bound to all network interfaces including DMZ or internet-facing adapters rather than restricted to trusted VLANs, unnecessarily expanding the reachable attack surface.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

network_binding_to_untrusted_interfaces[_network_binding_to_untrusted_interfaces_def] if {
    "all" in input.storage_protocol_bound_interfaces
    count(input.untrusted_interface_types_present) > 0
}

network_binding_to_untrusted_interfaces[_network_binding_to_untrusted_interfaces_def] if {
    "dmz" in input.storage_protocol_bound_interfaces
}

network_binding_to_untrusted_interfaces[_network_binding_to_untrusted_interfaces_def] if {
    "internet-facing" in input.storage_protocol_bound_interfaces
}

network_binding_to_untrusted_interfaces[_network_binding_to_untrusted_interfaces_def] if {
    input.management_interface_bound_to_all == true
    count(input.untrusted_interface_types_present) > 0
}

exposures contains _network_binding_to_untrusted_interfaces_def if {
    count(network_binding_to_untrusted_interfaces) > 0
}

_physical_access_without_disk_lock_or_chassis_security_def := {
    "name": "Physical Access Without Disk Lock Or Chassis Security",
    "description": "Drives can be hot-removed without authentication challenge, or the appliance chassis has no intrusion detection, enabling physical theft of disks to access data without operating system authentication.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

physical_access_without_disk_lock_or_chassis_security[_physical_access_without_disk_lock_or_chassis_security_def] if {
    not input.volume_encryption_enabled
    not input.drive_hot_removal_authentication_required
}

physical_access_without_disk_lock_or_chassis_security[_physical_access_without_disk_lock_or_chassis_security_def] if {
    not input.volume_encryption_enabled
    not input.chassis_intrusion_detection_enabled
}

exposures contains _physical_access_without_disk_lock_or_chassis_security_def if {
    count(physical_access_without_disk_lock_or_chassis_security) > 0
}

_absence_of_failed_login_lockout_or_rate_limiting_def := {
    "name": "Absence Of Failed Login Lockout Or Rate Limiting",
    "description": "The management interface and share authentication do not enforce account lockout or rate limiting after repeated failed login attempts, enabling unrestricted brute-force or password-spray attacks against local and domain accounts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

absence_of_failed_login_lockout_or_rate_limiting[_absence_of_failed_login_lockout_or_rate_limiting_def] if {
    not input.account_lockout_enabled
    not input.rate_limiting_enabled
}

exposures contains _absence_of_failed_login_lockout_or_rate_limiting_def if {
    count(absence_of_failed_login_lockout_or_rate_limiting) > 0
}
