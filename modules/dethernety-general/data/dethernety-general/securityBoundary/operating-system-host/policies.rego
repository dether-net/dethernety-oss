package _dt_built_in.exposures.operating_system_host



_unpatched_known_vulnerability_exposure_window_def := {
    "name": "Unpatched known-vulnerability exposure window",
    "description": "The host runs an EOL kernel or privileged packages below vendor-fixed builds, leaving public CVEs exploitable because patches lag. The boundary fails its attestation that no known-exploitable privileged code runs on the host.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
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

unpatched_known_vulnerability_exposure_window[_unpatched_known_vulnerability_exposure_window_def] if {
    not input.host_patch_level_current
}

unpatched_known_vulnerability_exposure_window[_unpatched_known_vulnerability_exposure_window_def] if {
    input.host_kernel_eol == true
}

exposures contains _unpatched_known_vulnerability_exposure_window_def if {
    count(unpatched_known_vulnerability_exposure_window) > 0
}

_local_privilege_escalation_to_root_system_def := {
    "name": "Local privilege escalation to root/SYSTEM",
    "description": "An unprivileged on-host user escalates to root via a vulnerable sudo (Baron Samedit / sudoedit), a writable or unexpected setuid binary, an unrestricted unprivileged user namespace (Linux), or \u2014 on Windows \u2014 an unquoted service path, weak service-binary ACL, or disabled UAC. The boundary fails to keep unprivileged user-space separated from ring-0/SYSTEM. OS-specific facets are gated by host_os_family.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

local_privilege_escalation_to_root_system[_local_privilege_escalation_to_root_system_def] if {
    input.host_os_family in ["linux", "macos", "bsd"]
    not input.sudo_least_privilege_configured
}

local_privilege_escalation_to_root_system[_local_privilege_escalation_to_root_system_def] if {
    input.host_os_family in ["linux", "macos", "bsd"]
    not input.setuid_binaries_minimized_and_protected
}

local_privilege_escalation_to_root_system[_local_privilege_escalation_to_root_system_def] if {
    input.host_os_family in ["linux"]
    not input.unprivileged_user_namespaces_restricted
}

local_privilege_escalation_to_root_system[_local_privilege_escalation_to_root_system_def] if {
    input.host_os_family in ["windows"]
    not input.windows_privilege_boundary_enforced
}

exposures contains _local_privilege_escalation_to_root_system_def if {
    count(local_privilege_escalation_to_root_system) > 0
}

_kernel_isolation_bypass_enabler_def := {
    "name": "Kernel-isolation bypass enabler (MAC not enforcing / unprivileged userns)",
    "description": "Mandatory access control (SELinux/AppArmor) is permissive or unloaded and unprivileged user-namespace creation is unrestricted, structurally expanding the reachable kernel attack surface and removing the compensating control that blocks several container-escape and netfilter/overlayfs LPE primitives \u2014 letting a runtime/cgroup escape (e.g. runc) land as host root. Linux-only kernel-hardening posture \u2014 gated by host_os_family.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

kernel_isolation_bypass_enabler[_kernel_isolation_bypass_enabler_def] if {
    input.host_os_family in ["linux"]
    not input.mandatory_access_control_enforcing
}

kernel_isolation_bypass_enabler[_kernel_isolation_bypass_enabler_def] if {
    input.host_os_family in ["linux"]
    not input.unprivileged_user_namespaces_restricted
}

exposures contains _kernel_isolation_bypass_enabler_def if {
    count(kernel_isolation_bypass_enabler) > 0
}

_on_host_credential_secret_exposure_def := {
    "name": "On-host credential / secret exposure",
    "description": "On-host credential stores are readable from a low-privilege or admin foothold \u2014 the Unix shadow store / SSH private keys group/world-readable, or Windows LSASS dumpable because LSA Protection and Credential Guard are off. The boundary fails on-host credential isolation, enabling offline cracking and pass-the-hash lateral movement. OS-specific facets are gated by host_os_family.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
            "value": "T1003.008",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

on_host_credential_secret_exposure[_on_host_credential_secret_exposure_def] if {
    input.host_os_family in ["linux", "macos", "bsd"]
    not input.host_credential_files_access_restricted
}

on_host_credential_secret_exposure[_on_host_credential_secret_exposure_def] if {
    input.host_os_family in ["windows"]
    not input.windows_lsass_credential_protection_enabled
}

exposures contains _on_host_credential_secret_exposure_def if {
    count(on_host_credential_secret_exposure) > 0
}

_cloud_instance_credential_theft_via_imds_def := {
    "name": "Cloud instance-credential theft via IMDS",
    "description": "On a cloud compute instance the link-local metadata endpoint (169.254.169.254) answers a plain GET under IMDSv1, so an SSRF or any low-priv on-host process exfiltrates the instance IAM role credentials. The boundary fails to require IMDSv2 session tokens and a hop limit of 1, voiding cloud-host credential isolation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.005",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cloud_instance_credential_theft_via_imds[_cloud_instance_credential_theft_via_imds_def] if {
    not input.instance_metadata_service_hardened
}

exposures contains _cloud_instance_credential_theft_via_imds_def if {
    count(cloud_instance_credential_theft_via_imds) > 0
}

_exposed_weak_remote_administrative_access_def := {
    "name": "Exposed/weak remote administrative access",
    "description": "Internet-reachable SSH/RDP/WinRM permits password authentication or direct root login (or RDP without NLA), letting an attacker brute-force or hijack administrative access straight into the host. The boundary fails its attestation that the management plane is key-only, no-root, and reachable only via bastion/VPN/allowlist.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.004",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_weak_remote_administrative_access[_exposed_weak_remote_administrative_access_def] if {
    not input.remote_admin_access_hardened
}

exposures contains _exposed_weak_remote_administrative_access_def if {
    count(exposed_weak_remote_administrative_access) > 0
}

_host_integrity_boot_chain_tamper_def := {
    "name": "Host integrity / boot-chain tamper and rootkit persistence",
    "description": "The boot chain and system binaries are unprotected \u2014 Secure/measured boot disabled (unsigned kernel modules loadable), no file-integrity baseline (AIDE), and no host audit logging/EDR (auditd, Sysmon) \u2014 so a bootkit, rootkit, or binary-replace persists invisibly and tamper goes unrecorded. The boundary fails integrity and non-repudiation below the OS.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1014",
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
            "value": "T1547.006",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

host_integrity_boot_chain_tamper[_host_integrity_boot_chain_tamper_def] if {
    not input.boot_chain_integrity_protected
}

host_integrity_boot_chain_tamper[_host_integrity_boot_chain_tamper_def] if {
    not input.host_integrity_monitoring_and_audit_enabled
}

exposures contains _host_integrity_boot_chain_tamper_def if {
    count(host_integrity_boot_chain_tamper) > 0
}

_at_rest_disk_exposure_detached_snapshotted_volume_def := {
    "name": "At-rest disk exposure of a detached/snapshotted volume",
    "description": "Host data-bearing volumes are unencrypted (no LUKS / BitLocker 'Protection Off' / no FileVault), so physical theft, a detached disk, or a cloud snapshot exfil yields cleartext credentials and PII. The boundary fails its at-rest confidentiality attestation for the machine's storage.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
            "attributes": {}
        }
    ],
    "attack_vector": "PHYSICAL"
}

at_rest_disk_exposure_detached_snapshotted_volume[_at_rest_disk_exposure_detached_snapshotted_volume_def] if {
    not input.host_disk_encryption_at_rest_enabled
}

exposures contains _at_rest_disk_exposure_detached_snapshotted_volume_def if {
    count(at_rest_disk_exposure_detached_snapshotted_volume) > 0
}
