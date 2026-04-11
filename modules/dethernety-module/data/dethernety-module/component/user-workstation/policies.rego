package _dt_built_in.exposures.user_workstation

_disk_encryption_disabled_or_partial_def := {
    "name": "Disk Encryption Disabled Or Partial",
    "description": "Full-disk or volume-level encryption is not enabled, or is only applied to select partitions, leaving data readable if the device is physically seized or the storage is removed.",
    "type": "missing_control",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

disk_encryption_disabled_or_partial[_disk_encryption_disabled_or_partial_def] if {
    not input.full_disk_encryption_enabled
}

disk_encryption_disabled_or_partial[_disk_encryption_disabled_or_partial_def] if {
    input.full_disk_encryption_enabled == true
    input.encryption_scope == "partial"
}

disk_encryption_disabled_or_partial[_disk_encryption_disabled_or_partial_def] if {
    input.encryption_scope == "none"
}

exposures contains _disk_encryption_disabled_or_partial_def if {
    count(disk_encryption_disabled_or_partial) > 0
}

_weak_or_absent_screen_lock_authentication_def := {
    "name": "Weak Or Absent Screen Lock Authentication",
    "description": "Device lock screen uses no PIN/password, a trivially guessable credential, or biometric bypass is possible without a fallback strong factor, allowing unauthorized local access.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

weak_or_absent_screen_lock_authentication[_weak_or_absent_screen_lock_authentication_def] if {
    not input.screen_lock_enabled
}

weak_or_absent_screen_lock_authentication[_weak_or_absent_screen_lock_authentication_def] if {
    input.screen_lock_enabled == true
    input.screen_lock_type in ["none", "swipe"]
}

weak_or_absent_screen_lock_authentication[_weak_or_absent_screen_lock_authentication_def] if {
    input.screen_lock_enabled == true
    input.screen_lock_type in ["pin", "password", "pattern_simple"]
    input.minimum_passcode_length < 4
}

weak_or_absent_screen_lock_authentication[_weak_or_absent_screen_lock_authentication_def] if {
    input.screen_lock_enabled == true
    input.screen_lock_type == "biometric_only"
    input.biometric_fallback_factor in ["none", "swipe", "weak_pin"]
}

weak_or_absent_screen_lock_authentication[_weak_or_absent_screen_lock_authentication_def] if {
    input.screen_lock_enabled == true
    input.screen_lock_type == "biometric_with_fallback"
    input.biometric_fallback_factor in ["none", "swipe", "weak_pin"]
}

exposures contains _weak_or_absent_screen_lock_authentication_def if {
    count(weak_or_absent_screen_lock_authentication) > 0
}

_local_administrator_privileges_granted_to_standard_users_def := {
    "name": "Local Administrator Privileges Granted To Standard Users",
    "description": "End users operate with local administrator rights rather than standard user accounts, enabling malware installation, privilege escalation, and bypass of security controls without additional authentication.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

local_administrator_privileges_granted_to_standard_users[_local_administrator_privileges_granted_to_standard_users_def] if {
    input.standard_users_have_local_admin == true
    not input.privileged_access_management_enforced
}

exposures contains _local_administrator_privileges_granted_to_standard_users_def if {
    count(local_administrator_privileges_granted_to_standard_users) > 0
}

_endpoint_protection_disabled_or_tampered_def := {
    "name": "Endpoint Protection Disabled Or Tampered",
    "description": "Antivirus, EDR, or host-based IPS is absent, disabled, excluded for broad directories, or running with outdated signatures, leaving the device without detection and prevention capabilities.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

endpoint_protection_disabled_or_tampered[_endpoint_protection_disabled_or_tampered_def] if {
    input.endpoint_protection_status in ["not_installed", "disabled", "tampered"]
}

endpoint_protection_disabled_or_tampered[_endpoint_protection_disabled_or_tampered_def] if {
    input.endpoint_protection_status == "active"
    input.signature_age_days > 7
}

endpoint_protection_disabled_or_tampered[_endpoint_protection_disabled_or_tampered_def] if {
    input.endpoint_protection_status == "active"
    count(input.broad_exclusion_paths) > 0
}

exposures contains _endpoint_protection_disabled_or_tampered_def if {
    count(endpoint_protection_disabled_or_tampered) > 0
}

_os_and_firmware_patching_lag_def := {
    "name": "Os And Firmware Patching Lag",
    "description": "Operating system, drivers, or UEFI/BIOS firmware are not updated within a defined window after critical patches are released, leaving known exploitable vulnerabilities available to attackers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

os_and_firmware_patching_lag[_os_and_firmware_patching_lag_def] if {
    input.days_since_critical_patch_available > 0
    input.days_since_critical_patch_available
    count(input.patch_scope) > 0
}

os_and_firmware_patching_lag[_os_and_firmware_patching_lag_def] if {
    "uefi_bios" in input.patch_scope
    input.days_since_critical_patch_available > 0
}

exposures contains _os_and_firmware_patching_lag_def if {
    count(os_and_firmware_patching_lag) > 0
}

_secure_boot_disabled_or_misconfigured_def := {
    "name": "Secure Boot Disabled Or Misconfigured",
    "description": "UEFI Secure Boot is turned off or configured to accept untrusted certificates, allowing bootkit or rootkit implants to persist below the OS layer and survive reimaging.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

secure_boot_disabled_or_misconfigured[_secure_boot_disabled_or_misconfigured_def] if {
    not input.secure_boot_enabled
}

secure_boot_disabled_or_misconfigured[_secure_boot_disabled_or_misconfigured_def] if {
    input.secure_boot_enabled == true
    input.secure_boot_custom_db_state == "untrusted_or_unknown"
}

exposures contains _secure_boot_disabled_or_misconfigured_def if {
    count(secure_boot_disabled_or_misconfigured) > 0
}

_unmanaged_byod_without_mdm_enrollment_def := {
    "name": "Unmanaged Byod Without Mdm Enrollment",
    "description": "Personally owned devices access corporate resources without enrollment in a Mobile Device Management or Unified Endpoint Management solution, preventing policy enforcement, remote wipe, and compliance verification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unmanaged_byod_without_mdm_enrollment[_unmanaged_byod_without_mdm_enrollment_def] if {
    input.mdm_enrollment_status in ["not_enrolled", "enrollment_pending"]
    not input.byod_policy_enforced
}

unmanaged_byod_without_mdm_enrollment[_unmanaged_byod_without_mdm_enrollment_def] if {
    input.mdm_enrollment_status in ["not_enrolled", "enrollment_pending"]
    not input.remote_wipe_capability_available
}

exposures contains _unmanaged_byod_without_mdm_enrollment_def if {
    count(unmanaged_byod_without_mdm_enrollment) > 0
}

_cleartext_credential_storage_on_device_def := {
    "name": "Cleartext Credential Storage On Device",
    "description": "Credentials, API keys, or session tokens are stored in plaintext files, browser saved-password stores without a master password, or unprotected OS credential managers, making them accessible to local attackers or malware.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

cleartext_credential_storage_on_device[_cleartext_credential_storage_on_device_def] if {
    input.plaintext_credential_files_found == true
}

cleartext_credential_storage_on_device[_cleartext_credential_storage_on_device_def] if {
    not input.browser_master_password_enforced
}

cleartext_credential_storage_on_device[_cleartext_credential_storage_on_device_def] if {
    not input.os_credential_manager_protection_enabled
}

exposures contains _cleartext_credential_storage_on_device_def if {
    count(cleartext_credential_storage_on_device) > 0
}

_host_firewall_disabled_or_overly_permissive_def := {
    "name": "Host Firewall Disabled Or Overly Permissive",
    "description": "The OS-level host firewall is disabled or configured to allow all inbound connections, exposing listening services to network-based exploitation from other hosts on the same LAN or VPN segment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

host_firewall_disabled_or_overly_permissive[_host_firewall_disabled_or_overly_permissive_def] if {
    not input.host_firewall_enabled
}

host_firewall_disabled_or_overly_permissive[_host_firewall_disabled_or_overly_permissive_def] if {
    input.host_firewall_enabled == true
    input.inbound_default_policy == "allow_all"
}

exposures contains _host_firewall_disabled_or_overly_permissive_def if {
    count(host_firewall_disabled_or_overly_permissive) > 0
}

_removable_media_unrestricted_def := {
    "name": "Removable Media Unrestricted",
    "description": "USB storage and other removable media interfaces are not blocked or audited via policy, enabling data exfiltration, malware introduction, and BadUSB-style hardware attacks.",
    "type": "misconfiguration",
    "category": "physical_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

removable_media_unrestricted[_removable_media_unrestricted_def] if {
    input.usb_storage_policy == "unrestricted"
}

removable_media_unrestricted[_removable_media_unrestricted_def] if {
    not input.device_control_tool_deployed
}

removable_media_unrestricted[_removable_media_unrestricted_def] if {
    input.usb_storage_policy != "blocked"
    not input.removable_media_audit_enabled
}

exposures contains _removable_media_unrestricted_def if {
    count(removable_media_unrestricted) > 0
}

_endpoint_logging_and_telemetry_not_forwarded_def := {
    "name": "Endpoint Logging And Telemetry Not Forwarded",
    "description": "Device event logs (authentication, process execution, network connections) are stored only locally without forwarding to a SIEM or log aggregator, allowing log tampering and preventing detection of compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

endpoint_logging_and_telemetry_not_forwarded[_endpoint_logging_and_telemetry_not_forwarded_def] if {
    not input.log_forwarding_enabled
}

endpoint_logging_and_telemetry_not_forwarded[_endpoint_logging_and_telemetry_not_forwarded_def] if {
    input.log_forwarding_enabled == true
    input.siem_last_event_age_hours > 24
}

endpoint_logging_and_telemetry_not_forwarded[_endpoint_logging_and_telemetry_not_forwarded_def] if {
    not input.log_forwarding_enabled
    not input.log_tamper_protection_enabled
}

exposures contains _endpoint_logging_and_telemetry_not_forwarded_def if {
    count(endpoint_logging_and_telemetry_not_forwarded) > 0
}

_automatic_wifi_association_with_untrusted_networks_def := {
    "name": "Automatic Wifi Association With Untrusted Networks",
    "description": "Device is configured to auto-connect to previously seen or open Wi-Fi networks, enabling evil-twin attacks where an attacker impersonates a known SSID to intercept traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

automatic_wifi_association_with_untrusted_networks[_automatic_wifi_association_with_untrusted_networks_def] if {
    input.auto_connect_to_open_networks_enabled == true
    not input.wifi_security_policy_enforced_via_mdm
}

automatic_wifi_association_with_untrusted_networks[_automatic_wifi_association_with_untrusted_networks_def] if {
    input.auto_reconnect_to_known_networks_enabled == true
    not input.wifi_security_policy_enforced_via_mdm
}

exposures contains _automatic_wifi_association_with_untrusted_networks_def if {
    count(automatic_wifi_association_with_untrusted_networks) > 0
}

_shadow_it_software_and_unvetted_application_installation_def := {
    "name": "Shadow It Software And Unvetted Application Installation",
    "description": "Users can install arbitrary third-party applications without IT approval or software allowlisting controls, introducing unvetted code with potential for supply-chain compromise or bundled malware.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

shadow_it_software_and_unvetted_application_installation[_shadow_it_software_and_unvetted_application_installation_def] if {
    not input.software_allowlisting_enforced
}

shadow_it_software_and_unvetted_application_installation[_shadow_it_software_and_unvetted_application_installation_def] if {
    not input.it_approved_software_policy_exists
}

shadow_it_software_and_unvetted_application_installation[_shadow_it_software_and_unvetted_application_installation_def] if {
    input.endpoint_admin_rights_scope in ["local_admin", "full_admin"]
    not input.software_allowlisting_enforced
}

exposures contains _shadow_it_software_and_unvetted_application_installation_def if {
    count(shadow_it_software_and_unvetted_application_installation) > 0
}

_absence_of_device_compliance_check_before_resource_access_def := {
    "name": "Absence Of Device Compliance Check Before Resource Access",
    "description": "No network access control (NAC) or conditional access policy verifies device health posture (patch level, encryption status, EDR health) before granting access to corporate applications or VPN.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

absence_of_device_compliance_check_before_resource_access[_absence_of_device_compliance_check_before_resource_access_def] if {
    not input.nac_or_conditional_access_enabled
}

absence_of_device_compliance_check_before_resource_access[_absence_of_device_compliance_check_before_resource_access_def] if {
    input.nac_or_conditional_access_enabled == true
    not input.device_health_checks_enforced
}

absence_of_device_compliance_check_before_resource_access[_absence_of_device_compliance_check_before_resource_access_def] if {
    input.nac_or_conditional_access_enabled == true
    input.device_health_checks_enforced == true
    input.non_compliant_device_action in ["allow_with_warning", "allow_unrestricted"]
}

exposures contains _absence_of_device_compliance_check_before_resource_access_def if {
    count(absence_of_device_compliance_check_before_resource_access) > 0
}
