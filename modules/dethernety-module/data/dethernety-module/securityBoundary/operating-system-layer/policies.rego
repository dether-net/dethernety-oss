package _dt_built_in.exposures.operating_system_layer

_syscall_ingress_filter_bypass_def := {
    "name": "Syscall Ingress Filter Bypass",
    "description": "Absence of mandatory syscall filtering (e.g., seccomp policy) allows unprivileged processes to invoke privileged kernel interfaces, effectively crossing the user-space to kernel-space trust boundary without enforcement.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1106",
            "name": "Native API",
            "relevance": "Directly relates to bypassing syscall filters by invoking system calls or native APIs directly, circumventing higher-level security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.008",
            "name": "Ptrace System Calls",
            "relevance": "Ptrace syscalls can be used to bypass ingress filters by manipulating process execution and intercepting/modifying system calls."
        }
    ],
    "attack_vector": "LOCAL"
}

syscall_ingress_filter_bypass[_syscall_ingress_filter_bypass_def] if {
    not input.seccomp_policy_enforced
}

syscall_ingress_filter_bypass[_syscall_ingress_filter_bypass_def] if {
    input.seccomp_profile_mode == "none"
}

syscall_ingress_filter_bypass[_syscall_ingress_filter_bypass_def] if {
    input.privileged_syscalls_accessible == true
}

exposures contains _syscall_ingress_filter_bypass_def if {
    count(syscall_ingress_filter_bypass) > 0
}

_ipc_trust_boundary_permeability_def := {
    "name": "Ipc Trust Boundary Permeability",
    "description": "Inter-process communication channels (pipes, shared memory, Unix domain sockets) lack mandatory labeling or policy enforcement, permitting processes in lower-trust zones to send unsanitized data or signals to higher-trust zone processes.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Directly addresses abuse of IPC mechanisms to cross trust boundaries between processes."
        }
    ],
    "attack_vector": "LOCAL"
}

ipc_trust_boundary_permeability[_ipc_trust_boundary_permeability_def] if {
    not input.ipc_mandatory_labeling_enforced
    input.ipc_cross_trust_zone_channels_present == true
}

ipc_trust_boundary_permeability[_ipc_trust_boundary_permeability_def] if {
    input.ipc_input_sanitization_policy == "none"
    input.ipc_cross_trust_zone_channels_present == true
}

ipc_trust_boundary_permeability[_ipc_trust_boundary_permeability_def] if {
    input.privileged_process_ipc_socket_permissions == "world_accessible"
    input.ipc_cross_trust_zone_channels_present == true
}

ipc_trust_boundary_permeability[_ipc_trust_boundary_permeability_def] if {
    input.ipc_input_sanitization_policy == "partial"
    not input.ipc_mandatory_labeling_enforced
    input.ipc_cross_trust_zone_channels_present == true
}

exposures contains _ipc_trust_boundary_permeability_def if {
    count(ipc_trust_boundary_permeability) > 0
}

_namespace_segmentation_escape_def := {
    "name": "Namespace Segmentation Escape",
    "description": "Misconfigured or absent OS namespace isolation (PID, network, mount, IPC namespaces) allows processes to observe or interact with resources belonging to adjacent trust zones, undermining zone segmentation enforcement.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Directly describes techniques for escaping namespace or container segmentation to access the host environment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.008",
            "name": "Ptrace System Calls",
            "relevance": "Ptrace can be leveraged to escape namespace boundaries by attaching to processes in different namespaces."
        }
    ],
    "attack_vector": "LOCAL"
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    not input.namespace_isolation_enabled
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    "pid" in input.shared_namespaces
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    "network" in input.shared_namespaces
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    "ipc" in input.shared_namespaces
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    "mount" in input.shared_namespaces
}

namespace_segmentation_escape[_namespace_segmentation_escape_def] if {
    input.privileged_execution_mode == true
}

exposures contains _namespace_segmentation_escape_def if {
    count(namespace_segmentation_escape) > 0
}

_credential_store_zone_leakage_def := {
    "name": "Credential Store Zone Leakage",
    "description": "OS credential caches (e.g., /proc memory maps, keyring, LSA secrets) accessible across trust zone boundaries due to insufficient access control on memory-mapped credential storage, enabling lateral movement through credential harvesting.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003.005",
            "name": "Cached Domain Credentials",
            "relevance": "Specifically addresses leakage of credentials from cached stores across security zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Relates to credential leakage where credentials stored in files can be accessed across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1558.005",
            "name": "Ccache Files",
            "relevance": "Ccache files represent a credential store that can leak Kerberos tickets across security zones."
        }
    ],
    "attack_vector": "LOCAL"
}

credential_store_zone_leakage[_credential_store_zone_leakage_def] if {
    not input.credential_store_access_control_enforced
}

credential_store_zone_leakage[_credential_store_zone_leakage_def] if {
    input.unprivileged_proc_mem_access_enabled == true
}

credential_store_zone_leakage[_credential_store_zone_leakage_def] if {
    not input.keyring_namespace_isolation_enabled
}

exposures contains _credential_store_zone_leakage_def if {
    count(credential_store_zone_leakage) > 0
}

_privilege_escalation_via_suid_boundary_crossing_def := {
    "name": "Privilege Escalation Via Suid Boundary Crossing",
    "description": "Setuid/setgid binaries operating as trust zone crossing points lack integrity verification or argument sanitization, allowing untrusted-zone processes to acquire elevated privileges by abusing these controlled entry points.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.001",
            "name": "Setuid and Setgid",
            "relevance": "Directly describes privilege escalation via SUID/SGID bit abuse to cross privilege boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Covers exploitation of vulnerabilities including SUID misconfigurations to escalate privileges across boundaries."
        }
    ],
    "attack_vector": "LOCAL"
}

privilege_escalation_via_suid_boundary_crossing[_privilege_escalation_via_suid_boundary_crossing_def] if {
    input.suid_sgid_binary_count > 0
    not input.suid_binary_argument_sanitization_enforced
}

privilege_escalation_via_suid_boundary_crossing[_privilege_escalation_via_suid_boundary_crossing_def] if {
    input.suid_sgid_binary_count > 0
    not input.suid_binary_integrity_verification_enabled
}

privilege_escalation_via_suid_boundary_crossing[_privilege_escalation_via_suid_boundary_crossing_def] if {
    input.nosuid_mount_coverage in ["partial", "none"]
    not input.suid_binary_integrity_verification_enabled
}

exposures contains _privilege_escalation_via_suid_boundary_crossing_def if {
    count(privilege_escalation_via_suid_boundary_crossing) > 0
}

_procfs_egress_information_exposure_def := {
    "name": "Procfs Egress Information Exposure",
    "description": "The /proc filesystem exposes process metadata, environment variables, and memory mappings across trust zones without per-zone access restrictions, enabling reconnaissance and trust-boundary mapping by lower-privilege zone actors.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003.007",
            "name": "Proc Filesystem",
            "relevance": "Directly describes information exposure through the proc filesystem, which can leak sensitive process and system data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.009",
            "name": "Proc Memory",
            "relevance": "Specifically addresses reading process memory via /proc, enabling egress of sensitive information."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1057",
            "name": "Process Discovery",
            "relevance": "Proc filesystem is commonly used for process discovery to enumerate running processes and their attributes."
        }
    ],
    "attack_vector": "LOCAL"
}

procfs_egress_information_exposure[_procfs_egress_information_exposure_def] if {
    input.hidepid_mount_option == "0"
}

procfs_egress_information_exposure[_procfs_egress_information_exposure_def] if {
    input.hidepid_mount_option == "1"
    not input.proc_gid_restriction_configured
}

procfs_egress_information_exposure[_procfs_egress_information_exposure_def] if {
    input.unprivileged_container_proc_access == true
}

exposures contains _procfs_egress_information_exposure_def if {
    count(procfs_egress_information_exposure) > 0
}

_cgroup_resource_boundary_sidechannel_def := {
    "name": "Cgroup Resource Boundary Sidechannel",
    "description": "Improperly isolated control group hierarchies allow processes in adjacent zones to infer workload behavior or resource contention patterns of higher-trust zone processes through shared cgroup accounting interfaces.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1057",
            "name": "Process Discovery",
            "relevance": "Cgroup resource information can be observed to infer process activity and create side-channel information leakage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1615",
            "name": "Group Policy Discovery",
            "relevance": "Relates to discovery of group/cgroup policies that define resource boundaries which could be exploited for side-channel attacks."
        }
    ],
    "attack_vector": "LOCAL"
}

cgroup_resource_boundary_sidechannel[_cgroup_resource_boundary_sidechannel_def] if {
    not input.cgroup_namespace_isolation_enabled
    input.cgroup_accounting_readable_by_unprivileged == true
}

exposures contains _cgroup_resource_boundary_sidechannel_def if {
    count(cgroup_resource_boundary_sidechannel) > 0
}

_audit_and_monitoring_gap_at_zone_boundary_def := {
    "name": "Audit And Monitoring Gap At Zone Boundary",
    "description": "Absence of mandatory audit logging at OS-enforced zone transition points (privilege changes, namespace crossings, capability grants) creates blind spots that prevent detection of lateral movement and unauthorized zone traversal.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.002",
            "name": "Disable Windows Event Logging",
            "relevance": "Represents exploitation of monitoring gaps by disabling or evading audit logging at security zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Directly addresses disabling monitoring at zone boundaries to create blind spots for security operations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Attackers may enumerate logs to identify gaps in monitoring coverage at zone boundaries."
        }
    ],
    "attack_vector": "LOCAL"
}

audit_and_monitoring_gap_at_zone_boundary[_audit_and_monitoring_gap_at_zone_boundary_def] if {
    not input.privilege_transition_audit_enabled
}

audit_and_monitoring_gap_at_zone_boundary[_audit_and_monitoring_gap_at_zone_boundary_def] if {
    not input.namespace_crossing_audit_enabled
}

audit_and_monitoring_gap_at_zone_boundary[_audit_and_monitoring_gap_at_zone_boundary_def] if {
    input.ipc_syscall_audit_coverage == "none"
}

audit_and_monitoring_gap_at_zone_boundary[_audit_and_monitoring_gap_at_zone_boundary_def] if {
    input.ipc_syscall_audit_coverage == "partial"
    not input.namespace_crossing_audit_enabled
}

audit_and_monitoring_gap_at_zone_boundary[_audit_and_monitoring_gap_at_zone_boundary_def] if {
    not input.audit_log_integrity_protection
    not input.privilege_transition_audit_enabled
}

exposures contains _audit_and_monitoring_gap_at_zone_boundary_def if {
    count(audit_and_monitoring_gap_at_zone_boundary) > 0
}

_capability_propagation_across_exec_boundary_def := {
    "name": "Capability Propagation Across Exec Boundary",
    "description": "Linux capabilities or Windows privileges inherited across exec() boundaries without explicit policy reset allow child processes spawned in lower-trust zones to retain elevated capabilities from parent execution contexts.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "name": "Abuse Elevation Control Mechanism",
            "relevance": "Directly relates to propagation of elevated capabilities across execution boundaries through abuse of elevation controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134.004",
            "name": "Parent PID Spoofing",
            "relevance": "Parent PID spoofing can cause improper capability propagation across exec boundaries by inheriting privileges from spoofed parents."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1546.004",
            "name": "Unix Shell Configuration Modification",
            "relevance": "Modifying shell configuration can enable capability propagation across exec boundaries when new shells or processes are spawned."
        }
    ],
    "attack_vector": "LOCAL"
}

capability_propagation_across_exec_boundary[_capability_propagation_across_exec_boundary_def] if {
    not input.capability_reset_on_exec_enforced
    input.inheritable_capabilities_count > 0
}

capability_propagation_across_exec_boundary[_capability_propagation_across_exec_boundary_def] if {
    not input.no_new_privs_bit_set
    not input.capability_reset_on_exec_enforced
    input.inheritable_capabilities_count > 0
}

exposures contains _capability_propagation_across_exec_boundary_def if {
    count(capability_propagation_across_exec_boundary) > 0
}

_device_file_ingress_path_to_kernel_def := {
    "name": "Device File Ingress Path To Kernel",
    "description": "Device node access controls insufficiently restrict which trust zones can open character or block device files, providing lower-zone processes a direct ingress path to kernel driver interfaces that bypass application-layer segmentation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Device files provide a direct ingress path to the kernel that can be exploited for privilege escalation attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553",
            "name": "Subvert Trust Controls",
            "relevance": "Accessing kernel via device files may involve subverting trust controls that protect kernel interfaces."
        }
    ],
    "attack_vector": "LOCAL"
}

device_file_ingress_path_to_kernel[_device_file_ingress_path_to_kernel_def] if {
    input.device_file_world_readable_writable == true
    not input.udev_device_acl_enforcement_enabled
}

device_file_ingress_path_to_kernel[_device_file_ingress_path_to_kernel_def] if {
    count(input.sensitive_device_nodes_with_open_acl) > 0
    not input.udev_device_acl_enforcement_enabled
}

exposures contains _device_file_ingress_path_to_kernel_def if {
    count(device_file_ingress_path_to_kernel) > 0
}
