package _dt_built_in.exposures.mobile_device

_weak_or_absent_device_screen_lock_def := {
    "name": "Weak Or Absent Device Screen Lock",
    "description": "Device configured without a PIN, password, biometric, or with a trivially guessable passcode (e.g., '1234'). Physical or brief unattended access grants full device control and access to all cached application data and credentials.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

weak_or_absent_device_screen_lock[_weak_or_absent_device_screen_lock_def] if {
    not input.screen_lock_enabled
}

weak_or_absent_device_screen_lock[_weak_or_absent_device_screen_lock_def] if {
    input.screen_lock_type in ["none", "swipe"]
}

weak_or_absent_device_screen_lock[_weak_or_absent_device_screen_lock_def] if {
    input.screen_lock_enabled == true
    not input.screen_lock_max_attempts_configured
    input.screen_lock_type in ["pin", "pattern"]
}

exposures contains _weak_or_absent_device_screen_lock_def if {
    count(weak_or_absent_device_screen_lock) > 0
}

_unencrypted_device_storage_def := {
    "name": "Unencrypted Device Storage",
    "description": "Full-disk or file-based encryption not enabled on the device. On Android this may be a configurable setting; on older iOS versions it may be tied to passcode status. Without encryption, storage extracted via forensic tools or direct hardware access exposes all application data, tokens, and cached credentials.",
    "type": "missing_control",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

unencrypted_device_storage[_unencrypted_device_storage_def] if {
    not input.device_encryption_enabled
}

unencrypted_device_storage[_unencrypted_device_storage_def] if {
    input.mdm_compliance_encryption_status == "non_compliant"
}

unencrypted_device_storage[_unencrypted_device_storage_def] if {
    input.mdm_compliance_encryption_status == "unknown"
    not input.passcode_set
}

exposures contains _unencrypted_device_storage_def if {
    count(unencrypted_device_storage) > 0
}

_outdated_os_version_with_unpatched_vulnerabilities_def := {
    "name": "Outdated Os Version With Unpatched Vulnerabilities",
    "description": "Device running an OS version that has reached end-of-life or has not received available security patches. Unpatched kernel or framework vulnerabilities can be exploited for privilege escalation, sandbox escape, or malware installation without user interaction.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

outdated_os_version_with_unpatched_vulnerabilities[_outdated_os_version_with_unpatched_vulnerabilities_def] if {
    input.os_end_of_life == true
}

outdated_os_version_with_unpatched_vulnerabilities[_outdated_os_version_with_unpatched_vulnerabilities_def] if {
    input.os_patch_status in ["unpatched", "partially_patched"]
}

outdated_os_version_with_unpatched_vulnerabilities[_outdated_os_version_with_unpatched_vulnerabilities_def] if {
    input.days_since_last_security_patch >= 90
}

exposures contains _outdated_os_version_with_unpatched_vulnerabilities_def if {
    count(outdated_os_version_with_unpatched_vulnerabilities) > 0
}

_device_jailbreak_or_root_status_def := {
    "name": "Device Jailbreak Or Root Status",
    "description": "Device is jailbroken (iOS) or rooted (Android), disabling OS security boundaries including app sandboxing, code-signing enforcement, and secure enclave protections. Applications and their data are exposed to any process running at elevated privilege.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

device_jailbreak_or_root_status[_device_jailbreak_or_root_status_def] if {
    input.jailbreak_root_detected == true
}

device_jailbreak_or_root_status[_device_jailbreak_or_root_status_def] if {
    input.app_sandboxing_bypass_evidence == true
}

device_jailbreak_or_root_status[_device_jailbreak_or_root_status_def] if {
    input.mdm_compliance_status in ["unmanaged", "unknown"]
    input.jailbreak_root_detected == true
}

exposures contains _device_jailbreak_or_root_status_def if {
    count(device_jailbreak_or_root_status) > 0
}

_disabled_or_absent_mobile_device_management_def := {
    "name": "Disabled Or Absent Mobile Device Management",
    "description": "Device not enrolled in an MDM or EMM solution, preventing enforcement of security policy baselines (encryption, passcode complexity, OS version minimums, remote wipe capability). Loss or theft cannot be remotely remediated.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

disabled_or_absent_mobile_device_management[_disabled_or_absent_mobile_device_management_def] if {
    input.mdm_enrollment_status in ["not_enrolled", "pending_enrollment"]
}

disabled_or_absent_mobile_device_management[_disabled_or_absent_mobile_device_management_def] if {
    input.mdm_enrollment_status in ["enrolled_inactive", "not_enrolled"]
    not input.remote_wipe_capability_enabled
}

disabled_or_absent_mobile_device_management[_disabled_or_absent_mobile_device_management_def] if {
    input.security_policy_compliance_state in ["non_compliant", "unknown"]
    not input.mdm_enrollment_status in ["enrolled_active"]
}

exposures contains _disabled_or_absent_mobile_device_management_def if {
    count(disabled_or_absent_mobile_device_management) > 0
}

_insecure_wi_fi_auto_connect_behavior_def := {
    "name": "Insecure Wi Fi Auto Connect Behavior",
    "description": "Device configured to automatically connect to open or previously joined Wi-Fi networks. An adversary broadcasting a known SSID can intercept device traffic, including application communications, through a rogue access point without user awareness.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

insecure_wi_fi_auto_connect_behavior[_insecure_wi_fi_auto_connect_behavior_def] if {
    input.auto_connect_open_networks_enabled == true
    not input.vpn_always_on_enabled
}

insecure_wi_fi_auto_connect_behavior[_insecure_wi_fi_auto_connect_behavior_def] if {
    input.auto_rejoin_known_networks_enabled == true
    not input.vpn_always_on_enabled
}

exposures contains _insecure_wi_fi_auto_connect_behavior_def if {
    count(insecure_wi_fi_auto_connect_behavior) > 0
}

_absence_of_remote_wipe_capability_def := {
    "name": "Absence Of Remote Wipe Capability",
    "description": "Device not configured with a remote wipe mechanism (via MDM, platform find-my service, or application policy). Lost or stolen devices retain all application data, session tokens, and locally cached credentials indefinitely.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

absence_of_remote_wipe_capability[_absence_of_remote_wipe_capability_def] if {
    input.mdm_enrollment_status != "enrolled"
    not input.remote_wipe_capability_enabled
}

absence_of_remote_wipe_capability[_absence_of_remote_wipe_capability_def] if {
    not input.remote_wipe_capability_enabled
    not input.remote_wipe_capability_enabled
}

exposures contains _absence_of_remote_wipe_capability_def if {
    count(absence_of_remote_wipe_capability) > 0
}

_excessive_application_permissions_granted_def := {
    "name": "Excessive Application Permissions Granted",
    "description": "The dedicated application, or other co-installed applications, granted overly broad OS permissions (microphone, camera, contacts, location, storage) that exceed operational requirements. Compromised co-resident apps or malicious SDKs can harvest sensitive data through legitimately granted permissions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

excessive_application_permissions_granted[_excessive_application_permissions_granted_def] if {
    input.app_permissions_exceed_requirements == true
}

excessive_application_permissions_granted[_excessive_application_permissions_granted_def] if {
    count(input.sensitive_permissions_granted) > 0
    not input.permission_review_performed
}

excessive_application_permissions_granted[_excessive_application_permissions_granted_def] if {
    input.co_resident_app_risk_level in ["high", "unknown"]
    count(input.sensitive_permissions_granted) > 0
}

exposures contains _excessive_application_permissions_granted_def if {
    count(excessive_application_permissions_granted) > 0
}

_bluetooth_perpetually_enabled_and_discoverable_def := {
    "name": "Bluetooth Perpetually Enabled And Discoverable",
    "description": "Device Bluetooth is always on and set to discoverable mode. Exposes the device to Bluetooth-based proximity attacks (BlueBorne variants, BIAS) that can be exploited for unauthorized pairing, traffic interception, or lateral movement without network access.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

bluetooth_perpetually_enabled_and_discoverable[_bluetooth_perpetually_enabled_and_discoverable_def] if {
    input.bluetooth_enabled == true
    input.bluetooth_discoverable_mode == true
    not input.bluetooth_policy_enforced
}

bluetooth_perpetually_enabled_and_discoverable[_bluetooth_perpetually_enabled_and_discoverable_def] if {
    input.bluetooth_enabled == true
    input.bluetooth_discoverable_mode == true
    not input.bluetooth_policy_enforced
}

exposures contains _bluetooth_perpetually_enabled_and_discoverable_def if {
    count(bluetooth_perpetually_enabled_and_discoverable) > 0
}

_unmanaged_sideloaded_or_third_party_store_applications_def := {
    "name": "Unmanaged Sideloaded Or Third Party Store Applications",
    "description": "Device permits installation of applications from sources outside official platform stores (APK sideloading on Android, enterprise certificate abuse on iOS). Sideloaded applications bypass platform malware scanning and can contain credential-harvesting or surveillance functionality.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

unmanaged_sideloaded_or_third_party_store_applications[_unmanaged_sideloaded_or_third_party_store_applications_def] if {
    input.unknown_sources_installation_enabled == true
}

unmanaged_sideloaded_or_third_party_store_applications[_unmanaged_sideloaded_or_third_party_store_applications_def] if {
    not input.mdm_app_allowlist_enforced
}

exposures contains _unmanaged_sideloaded_or_third_party_store_applications_def if {
    count(unmanaged_sideloaded_or_third_party_store_applications) > 0
}

_lack_of_certificate_pinning_enforcement_at_device_trust_store_def := {
    "name": "Lack Of Certificate Pinning Enforcement At Device Trust Store",
    "description": "Device trust store contains user-installed or MDM-pushed CA certificates that are not restricted to specific application traffic. A rogue CA installed on the device allows TLS interception of application communications without triggering certificate validation errors.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

lack_of_certificate_pinning_enforcement_at_device_trust_store[_lack_of_certificate_pinning_enforcement_at_device_trust_store_def] if {
    not input.certificate_pinning_enforced
    input.user_installed_ca_certificates_present == true
}

lack_of_certificate_pinning_enforcement_at_device_trust_store[_lack_of_certificate_pinning_enforcement_at_device_trust_store_def] if {
    not input.certificate_pinning_enforced
    not input.network_security_config_restricts_user_cas
}

exposures contains _lack_of_certificate_pinning_enforcement_at_device_trust_store_def if {
    count(lack_of_certificate_pinning_enforcement_at_device_trust_store) > 0
}

_icloud_or_cloud_backup_containing_application_data_def := {
    "name": "Icloud Or Cloud Backup Containing Application Data",
    "description": "Platform cloud backup enabled without exclusion of the dedicated application's data container. Application tokens, cached credentials, and configuration are replicated to cloud infrastructure outside organizational control, expanding the exfiltration surface.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

icloud_or_cloud_backup_containing_application_data[_icloud_or_cloud_backup_containing_application_data_def] if {
    input.platform_cloud_backup_enabled == true
    not input.application_data_excluded_from_backup
    not input.mdm_backup_restriction_enforced
}

exposures contains _icloud_or_cloud_backup_containing_application_data_def if {
    count(icloud_or_cloud_backup_containing_application_data) > 0
}

_developer_mode_or_usb_debugging_enabled_def := {
    "name": "Developer Mode Or Usb Debugging Enabled",
    "description": "Android USB debugging or iOS developer mode left enabled on a production device. Allows any connected host to execute ADB commands, extract application data, or install packages without device unlock on some OS versions.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

developer_mode_or_usb_debugging_enabled[_developer_mode_or_usb_debugging_enabled_def] if {
    input.usb_debugging_enabled == true
    input.device_environment in ["production", "unknown"]
}

developer_mode_or_usb_debugging_enabled[_developer_mode_or_usb_debugging_enabled_def] if {
    input.developer_mode_enabled == true
    input.device_environment in ["production", "unknown"]
}

exposures contains _developer_mode_or_usb_debugging_enabled_def if {
    count(developer_mode_or_usb_debugging_enabled) > 0
}

_insufficient_failed_authentication_lockout_policy_def := {
    "name": "Insufficient Failed Authentication Lockout Policy",
    "description": "Device not configured to wipe or enforce escalating lockout after repeated failed passcode attempts. Enables brute-force of short PINs through physical access over time without triggering protective erasure.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "PHYSICAL"
}

insufficient_failed_authentication_lockout_policy[_insufficient_failed_authentication_lockout_policy_def] if {
    not input.failed_passcode_lockout_enabled
}

insufficient_failed_authentication_lockout_policy[_insufficient_failed_authentication_lockout_policy_def] if {
    input.failed_passcode_lockout_enabled == true
    input.max_failed_attempts_threshold > 10
}

insufficient_failed_authentication_lockout_policy[_insufficient_failed_authentication_lockout_policy_def] if {
    input.max_failed_attempts_threshold == 0
}

exposures contains _insufficient_failed_authentication_lockout_policy_def if {
    count(insufficient_failed_authentication_lockout_policy) > 0
}

_absence_of_device_level_audit_logging_def := {
    "name": "Absence Of Device Level Audit Logging",
    "description": "Device not configured to retain or forward security-relevant events (failed authentication attempts, application installs, permission grants) to a central logging platform. Security incidents on the endpoint cannot be detected, reconstructed, or attributed.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

absence_of_device_level_audit_logging[_absence_of_device_level_audit_logging_def] if {
    not input.central_log_forwarding_enabled
}

absence_of_device_level_audit_logging[_absence_of_device_level_audit_logging_def] if {
    input.local_audit_log_retention_days == 0
}

absence_of_device_level_audit_logging[_absence_of_device_level_audit_logging_def] if {
    count(input.audit_event_types_captured) == 0
}

exposures contains _absence_of_device_level_audit_logging_def if {
    count(absence_of_device_level_audit_logging) > 0
}
