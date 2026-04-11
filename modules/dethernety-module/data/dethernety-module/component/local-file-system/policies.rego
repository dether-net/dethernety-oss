package _dt_built_in.exposures.local_file_system

_world_readable_sensitive_files_def := {
    "name": "World Readable Sensitive Files",
    "description": "Files containing credentials, private keys, or sensitive configuration are assigned overly permissive read permissions (e.g., mode 0644 or 0666), allowing any local user or process to read them without authorization.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

world_readable_sensitive_files[_world_readable_sensitive_files_def] if {
    input.file_classification == "private_key"
    input.world_read_bit_set == true
}

world_readable_sensitive_files[_world_readable_sensitive_files_def] if {
    input.file_classification == "credential"
    input.world_read_bit_set == true
}

world_readable_sensitive_files[_world_readable_sensitive_files_def] if {
    input.file_classification == "sensitive_config"
    input.world_read_bit_set == true
}

world_readable_sensitive_files[_world_readable_sensitive_files_def] if {
    not input.file_classification in ["other"]
    input.file_permission_mode >= 420
}

exposures contains _world_readable_sensitive_files_def if {
    count(world_readable_sensitive_files) > 0
}

_world_writable_directories_or_files_def := {
    "name": "World Writable Directories Or Files",
    "description": "Critical directories or executable files are writable by unprivileged users, enabling file tampering, binary replacement, or injection of malicious content that may be executed with elevated privileges.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

world_writable_directories_or_files[_world_writable_directories_or_files_def] if {
    input.world_writable_paths_found == true
}

world_writable_directories_or_files[_world_writable_directories_or_files_def] if {
    input.sticky_bit_missing_on_world_writable_dirs == true
}

exposures contains _world_writable_directories_or_files_def if {
    count(world_writable_directories_or_files) > 0
}

_missing_encryption_at_rest_def := {
    "name": "Missing Encryption At Rest",
    "description": "Sensitive files or entire volumes are stored without encryption, meaning physical access to the storage media or logical access to the raw device allows direct data extraction without authentication.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    not input.encryption_at_rest_enabled
    input.volume_contains_sensitive_paths == true
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    input.filesystem_encryption_type == "none"
    input.volume_contains_sensitive_paths == true
}

exposures contains _missing_encryption_at_rest_def if {
    count(missing_encryption_at_rest) > 0
}

_unprotected_encryption_key_storage_def := {
    "name": "Unprotected Encryption Key Storage",
    "description": "Encryption keys for at-rest data are stored on the same volume they protect, in plaintext, or with overly permissive permissions, negating the benefit of encryption.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unprotected_encryption_key_storage[_unprotected_encryption_key_storage_def] if {
    input.key_storage_location == "same_volume"
}

unprotected_encryption_key_storage[_unprotected_encryption_key_storage_def] if {
    input.key_file_plaintext == true
}

unprotected_encryption_key_storage[_unprotected_encryption_key_storage_def] if {
    regex.match("^0?[0-7][1-7][0-7]$|^0?[0-7][0-7][1-7]$", input.key_file_permissions_octal)
}

exposures contains _unprotected_encryption_key_storage_def if {
    count(unprotected_encryption_key_storage) > 0
}

_suid_sgid_bit_misconfiguration_def := {
    "name": "Suid Sgid Bit Misconfiguration",
    "description": "Executable files have the SUID or SGID bit set unnecessarily, allowing unprivileged users to execute them with the owner's (often root) privileges, creating privilege escalation paths.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

suid_sgid_bit_misconfiguration[_suid_sgid_bit_misconfiguration_def] if {
    count(input.unauthorized_suid_sgid_binaries) > 0
}

suid_sgid_bit_misconfiguration[_suid_sgid_bit_misconfiguration_def] if {
    count(input.unauthorized_suid_sgid_binaries) > 0
    input.suid_sgid_binaries_owned_by_root == true
}

suid_sgid_bit_misconfiguration[_suid_sgid_bit_misconfiguration_def] if {
    input.world_writable_suid_sgid_binary_present == true
}

exposures contains _suid_sgid_bit_misconfiguration_def if {
    count(suid_sgid_bit_misconfiguration) > 0
}

_insufficient_filesystem_audit_logging_def := {
    "name": "Insufficient Filesystem Audit Logging",
    "description": "Access, modification, and deletion events on sensitive files or directories are not audited (e.g., auditd rules absent or inotify-based monitoring not configured), preventing detection of unauthorized access or tampering.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insufficient_filesystem_audit_logging[_insufficient_filesystem_audit_logging_def] if {
    not input.auditd_service_running
    not input.alternative_fs_monitoring_configured
}

insufficient_filesystem_audit_logging[_insufficient_filesystem_audit_logging_def] if {
    input.auditd_service_running == true
    not input.auditd_rules_configured
    not input.alternative_fs_monitoring_configured
}

insufficient_filesystem_audit_logging[_insufficient_filesystem_audit_logging_def] if {
    input.auditd_service_running == true
    input.sensitive_path_watch_count == 0
    not input.alternative_fs_monitoring_configured
}

exposures contains _insufficient_filesystem_audit_logging_def if {
    count(insufficient_filesystem_audit_logging) > 0
}

_insecure_tmp_directory_configuration_def := {
    "name": "Insecure Tmp Directory Configuration",
    "description": "Temporary directories such as /tmp or /var/tmp are not mounted with noexec, nosuid, or nodev options, allowing attackers to write and execute malicious binaries or exploit SUID misuse from world-writable space.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "noexec" in input.tmp_mount_options
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "nosuid" in input.tmp_mount_options
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "nodev" in input.tmp_mount_options
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "noexec" in input.var_tmp_mount_options
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "nosuid" in input.var_tmp_mount_options
}

insecure_tmp_directory_configuration[_insecure_tmp_directory_configuration_def] if {
    not "nodev" in input.var_tmp_mount_options
}

exposures contains _insecure_tmp_directory_configuration_def if {
    count(insecure_tmp_directory_configuration) > 0
}

_sensitive_data_in_unprotected_log_files_def := {
    "name": "Sensitive Data In Unprotected Log Files",
    "description": "Application or system logs written to the file system contain credentials, tokens, PII, or cryptographic material, and log files have overly permissive read permissions allowing unauthorized disclosure.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

sensitive_data_in_unprotected_log_files[_sensitive_data_in_unprotected_log_files_def] if {
    input.sensitive_data_patterns_in_logs == true
    input.log_file_permissions_world_readable == true
}

sensitive_data_in_unprotected_log_files[_sensitive_data_in_unprotected_log_files_def] if {
    not input.log_sanitization_enabled
    input.log_file_permissions_world_readable == true
}

exposures contains _sensitive_data_in_unprotected_log_files_def if {
    count(sensitive_data_in_unprotected_log_files) > 0
}

_missing_filesystem_integrity_monitoring_def := {
    "name": "Missing Filesystem Integrity Monitoring",
    "description": "No file integrity monitoring (e.g., AIDE, Tripwire, or dm-verity) is configured for critical system binaries, libraries, or configuration files, allowing undetected modification by attackers or malware.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

missing_filesystem_integrity_monitoring[_missing_filesystem_integrity_monitoring_def] if {
    not input.fim_tool_installed
}

missing_filesystem_integrity_monitoring[_missing_filesystem_integrity_monitoring_def] if {
    input.fim_tool_installed == true
    not input.fim_monitoring_active
}

missing_filesystem_integrity_monitoring[_missing_filesystem_integrity_monitoring_def] if {
    input.fim_tool_installed == true
    input.fim_monitoring_active == true
    not input.fim_critical_paths_covered
}

exposures contains _missing_filesystem_integrity_monitoring_def if {
    count(missing_filesystem_integrity_monitoring) > 0
}

_unrestricted_mount_options_on_sensitive_partitions_def := {
    "name": "Unrestricted Mount Options On Sensitive Partitions",
    "description": "Sensitive data partitions or removable media are mounted without restrictive options (noexec, nosuid, nodev), enabling execution of attacker-supplied binaries from those mount points.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unrestricted_mount_options_on_sensitive_partitions[_unrestricted_mount_options_on_sensitive_partitions_def] if {
    not input.noexec_option_set
}

unrestricted_mount_options_on_sensitive_partitions[_unrestricted_mount_options_on_sensitive_partitions_def] if {
    not input.nosuid_option_set
}

unrestricted_mount_options_on_sensitive_partitions[_unrestricted_mount_options_on_sensitive_partitions_def] if {
    not input.nodev_option_set
}

exposures contains _unrestricted_mount_options_on_sensitive_partitions_def if {
    count(unrestricted_mount_options_on_sensitive_partitions) > 0
}

_hardcoded_secrets_in_filesystem_plaintext_def := {
    "name": "Hardcoded Secrets In Filesystem Plaintext",
    "description": "Private keys, API tokens, passwords, or certificates are stored as plaintext files on the filesystem (e.g., in home directories, config files) rather than in a secrets manager or encrypted vault.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

hardcoded_secrets_in_filesystem_plaintext[_hardcoded_secrets_in_filesystem_plaintext_def] if {
    input.plaintext_secrets_detected == true
    not input.secrets_manager_in_use
}

hardcoded_secrets_in_filesystem_plaintext[_hardcoded_secrets_in_filesystem_plaintext_def] if {
    input.plaintext_secrets_detected == true
    input.secret_file_world_readable == true
}

exposures contains _hardcoded_secrets_in_filesystem_plaintext_def if {
    count(hardcoded_secrets_in_filesystem_plaintext) > 0
}

_excessive_root_owned_writable_paths_def := {
    "name": "Excessive Root Owned Writable Paths",
    "description": "Directories intended to hold user or application data are owned by root with group or other write access, allowing privilege abuse through symlink attacks, race conditions, or direct write exploitation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

excessive_root_owned_writable_paths[_excessive_root_owned_writable_paths_def] if {
    input.root_owned_world_writable_path_count > 0
}

excessive_root_owned_writable_paths[_excessive_root_owned_writable_paths_def] if {
    input.root_owned_world_writable_path_count > 0
    not input.sticky_bit_enforced_on_writable_paths
}

excessive_root_owned_writable_paths[_excessive_root_owned_writable_paths_def] if {
    input.root_owned_group_writable_path_count > 5
}

exposures contains _excessive_root_owned_writable_paths_def if {
    count(excessive_root_owned_writable_paths) > 0
}

_no_disk_quota_enforcement_def := {
    "name": "No Disk Quota Enforcement",
    "description": "Disk quotas are not enforced per user or process, enabling a compromised process or malicious user to exhaust filesystem space, causing denial of service for critical applications and system processes.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

no_disk_quota_enforcement[_no_disk_quota_enforcement_def] if {
    not input.disk_quota_enabled
}

no_disk_quota_enforcement[_no_disk_quota_enforcement_def] if {
    input.disk_quota_enabled == true
    not input.quota_hard_limit_configured
}

exposures contains _no_disk_quota_enforcement_def if {
    count(no_disk_quota_enforcement) > 0
}

_unpatched_filesystem_driver_or_kernel_vulnerabilities_def := {
    "name": "Unpatched Filesystem Driver Or Kernel Vulnerabilities",
    "description": "The filesystem driver or kernel version contains known unpatched vulnerabilities (e.g., privilege escalation via filesystem syscall bugs), exposing the host to local exploitation by unprivileged processes.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unpatched_filesystem_driver_or_kernel_vulnerabilities[_unpatched_filesystem_driver_or_kernel_vulnerabilities_def] if {
    input.kernel_has_known_cve == true
    not input.live_kernel_patching_enabled
}

unpatched_filesystem_driver_or_kernel_vulnerabilities[_unpatched_filesystem_driver_or_kernel_vulnerabilities_def] if {
    input.kernel_has_known_cve == true
    input.days_since_last_kernel_update > 90
}

exposures contains _unpatched_filesystem_driver_or_kernel_vulnerabilities_def if {
    count(unpatched_filesystem_driver_or_kernel_vulnerabilities) > 0
}

_insecure_backup_file_permissions_def := {
    "name": "Insecure Backup File Permissions",
    "description": "Backup archives of sensitive files (e.g., /etc/shadow, database dumps, key material) are written to the filesystem with overly permissive permissions, making backup artifacts accessible to unauthorized users.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insecure_backup_file_permissions[_insecure_backup_file_permissions_def] if {
    input.backup_contains_sensitive_data == true
    input.backup_world_readable == true
}

insecure_backup_file_permissions[_insecure_backup_file_permissions_def] if {
    input.backup_contains_sensitive_data == true
    input.backup_file_permission_mode >= 640
}

insecure_backup_file_permissions[_insecure_backup_file_permissions_def] if {
    input.backup_world_readable == true
    input.backup_file_permission_mode >= 604
}

exposures contains _insecure_backup_file_permissions_def if {
    count(insecure_backup_file_permissions) > 0
}
