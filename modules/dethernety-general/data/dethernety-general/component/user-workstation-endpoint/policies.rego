package _dt_built_in.exposures.user_workstation_endpoint



_phishing_driven_user_execution_initial_access_def := {
    "name": "Phishing-driven user execution (initial access)",
    "description": "A spearphishing email lures the user into opening a malicious attachment, link, or macro that executes a payload, giving the attacker an initial foothold on the endpoint. Mitigated by macro/script policy, DNS/web content filtering, application allowlisting, and EDR behavior monitoring.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

phishing_driven_user_execution_initial_access[_phishing_driven_user_execution_initial_access_def] if {
    not input.office_macro_execution_blocked
}

phishing_driven_user_execution_initial_access[_phishing_driven_user_execution_initial_access_def] if {
    not input.script_execution_constrained
}

phishing_driven_user_execution_initial_access[_phishing_driven_user_execution_initial_access_def] if {
    not input.application_allowlisting_enforced
}

phishing_driven_user_execution_initial_access[_phishing_driven_user_execution_initial_access_def] if {
    not input.web_dns_content_filtering_enabled
}

phishing_driven_user_execution_initial_access[_phishing_driven_user_execution_initial_access_def] if {
    not input.behavior_monitoring_enabled
}

exposures contains _phishing_driven_user_execution_initial_access_def if {
    count(phishing_driven_user_execution_initial_access) > 0
}

_malware_execution_with_disabled_or_stale_endpoint_protection_def := {
    "name": "Malware execution with disabled or stale endpoint protection",
    "description": "Malware runs because EDR/AV is disabled, real-time/behavior monitoring is off, tamper protection is absent, or signatures are stale \u2014 or a local actor uses Impair-Defenses techniques to silently disable the agent. Removable-media ingress can also seed the payload. Mitigated by always-on real-time protection, current signatures, tamper protection, and device control.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Disabled AV/EDR, missing tamper protection, and disabled real-time/behavior monitoring are the conditions an Impair Defenses actor either exploits or creates to run malware undetected."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {
                "justification": "Absent tamper protection lets a local actor disable or modify the AV/EDR tools, the sub-technique most directly enabled by edr_tamper_protection_enabled=false."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1091",
            "attributes": {
                "justification": "Without removable-media device control, USB mass storage seeds the malware payload via Replication Through Removable Media."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    not input.edr_av_present
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    not input.realtime_protection_enabled
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    not input.behavior_monitoring_enabled
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    not input.edr_tamper_protection_enabled
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    input.antivirus_signature_age_days > 3
}

malware_execution_with_disabled_or_stale_endpoint_protection[_malware_execution_with_disabled_or_stale_endpoint_protection_def] if {
    not input.removable_media_control_enabled
}

exposures contains _malware_execution_with_disabled_or_stale_endpoint_protection_def if {
    count(malware_execution_with_disabled_or_stale_endpoint_protection) > 0
}

_exploitation_of_unpatched_os_third_party_client_software_def := {
    "name": "Exploitation of unpatched OS / third-party client software",
    "description": "Known-vulnerable client software (OS, browser, document readers) is exploited via web or document content on an out-of-date endpoint to gain code execution. Mitigated by patching within SLA and automatic updates.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1203",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exploitation_of_unpatched_os_third_party_client_software[_exploitation_of_unpatched_os_third_party_client_software_def] if {
    not input.os_patch_current
}

exploitation_of_unpatched_os_third_party_client_software[_exploitation_of_unpatched_os_third_party_client_software_def] if {
    not input.automatic_updates_enabled
}

exploitation_of_unpatched_os_third_party_client_software[_exploitation_of_unpatched_os_third_party_client_software_def] if {
    input.days_since_last_security_patch > 30
}

exposures contains _exploitation_of_unpatched_os_third_party_client_software_def if {
    count(exploitation_of_unpatched_os_third_party_client_software) > 0
}

_local_credential_theft_and_reuse_def := {
    "name": "Local credential theft and reuse",
    "description": "An attacker on the host harvests cached domain credentials, LSASS secrets, tokens, or browser-stored credentials, then reuses them (valid accounts) to move to other systems. Mitigated by Credential Guard / LSA protection, least-privilege local-admin minimization, and phishing-resistant MFA.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

local_credential_theft_and_reuse[_local_credential_theft_and_reuse_def] if {
    not input.credential_guard_enabled
}

local_credential_theft_and_reuse[_local_credential_theft_and_reuse_def] if {
    not input.lsa_protection_enabled
}

local_credential_theft_and_reuse[_local_credential_theft_and_reuse_def] if {
    not input.endpoint_runs_as_least_privileged_user
}

local_credential_theft_and_reuse[_local_credential_theft_and_reuse_def] if {
    not input.phishing_resistant_mfa_enabled
}

exposures contains _local_credential_theft_and_reuse_def if {
    count(local_credential_theft_and_reuse) > 0
}

_lost_or_stolen_device_data_exposure_def := {
    "name": "Lost or stolen device data exposure",
    "description": "Physical loss or theft of an unencrypted (or suspended-protector) device exposes local data and cached credentials to an offline attacker. Mitigated by full-disk encryption (BitLocker/FileVault) anchored to a TPM, short screen-lock timeout, and MDM remote wipe.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 6.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052",
            "attributes": {
                "justification": "Offline attacker with physical possession of a lost/stolen unencrypted device exfiltrates local data over a physical medium."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052.001",
            "attributes": {
                "justification": "Data on the unprotected device is copied off over USB / removable media once the attacker has physical access."
            }
        }
    ],
    "attack_vector": "PHYSICAL"
}

lost_or_stolen_device_data_exposure[_lost_or_stolen_device_data_exposure_def] if {
    not input.endpoint_full_disk_encryption_on
}

lost_or_stolen_device_data_exposure[_lost_or_stolen_device_data_exposure_def] if {
    not input.tpm_present_and_ready
}

lost_or_stolen_device_data_exposure[_lost_or_stolen_device_data_exposure_def] if {
    input.screen_lock_timeout_minutes > 15
}

lost_or_stolen_device_data_exposure[_lost_or_stolen_device_data_exposure_def] if {
    not input.remote_wipe_enabled
}

exposures contains _lost_or_stolen_device_data_exposure_def if {
    count(lost_or_stolen_device_data_exposure) > 0
}

_boot_level_persistence_firmware_bootkit_def := {
    "name": "Boot-level persistence / firmware bootkit",
    "description": "An adversary configures boot/logon autostart or installs a bootkit that survives reboots and evades OS-level defenses. Mitigated by UEFI Secure Boot (only signed boot components run) and a present, ready TPM anchoring boot integrity, with EDR autostart monitoring.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1547",
            "attributes": {}
        }
    ],
    "attack_vector": "PHYSICAL"
}

boot_level_persistence_firmware_bootkit[_boot_level_persistence_firmware_bootkit_def] if {
    not input.secure_boot_enabled
}

boot_level_persistence_firmware_bootkit[_boot_level_persistence_firmware_bootkit_def] if {
    not input.tpm_present_and_ready
}

boot_level_persistence_firmware_bootkit[_boot_level_persistence_firmware_bootkit_def] if {
    not input.realtime_protection_enabled
}

exposures contains _boot_level_persistence_firmware_bootkit_def if {
    count(boot_level_persistence_firmware_bootkit) > 0
}

_unmanaged_unmonitored_endpoint_with_network_exposure_def := {
    "name": "Unmanaged / unmonitored endpoint with network exposure",
    "description": "An unenrolled or non-compliant device with no SIEM/EDR log forwarding, a disabled host firewall, or direct off-network exposure (no VPN/ZTNA posture gating) lets a compromise go undetected and enables inbound exposure and lateral movement. Mitigated by MDM enrollment, log forwarding, host firewall on all profiles, and VPN/ZTNA with device-compliance gating.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1091",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unmanaged_unmonitored_endpoint_with_network_exposure[_unmanaged_unmonitored_endpoint_with_network_exposure_def] if {
    not input.managed_device_enrollment_enforced
}

unmanaged_unmonitored_endpoint_with_network_exposure[_unmanaged_unmonitored_endpoint_with_network_exposure_def] if {
    not input.endpoint_audit_logs_centralised
}

unmanaged_unmonitored_endpoint_with_network_exposure[_unmanaged_unmonitored_endpoint_with_network_exposure_def] if {
    not input.host_firewall_enabled
}

unmanaged_unmonitored_endpoint_with_network_exposure[_unmanaged_unmonitored_endpoint_with_network_exposure_def] if {
    not input.vpn_ztna_posture_gating_enabled
}

exposures contains _unmanaged_unmonitored_endpoint_with_network_exposure_def if {
    count(unmanaged_unmonitored_endpoint_with_network_exposure) > 0
}
