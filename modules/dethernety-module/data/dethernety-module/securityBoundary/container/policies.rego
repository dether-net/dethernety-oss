package _dt_built_in.exposures.container

_privileged_flag_zone_collapse_def := {
    "name": "Privileged Flag Zone Collapse",
    "description": "A container launched with --privileged dissolves the enforcement boundary between the container trust zone and the host zone, granting full capability sets and disabling seccomp/AppArmor enforcement. Any workload in a privileged container effectively operates within the host trust zone, enabling unrestricted lateral movement to sibling containers and host resources.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

privileged_flag_zone_collapse[_privileged_flag_zone_collapse_def] if {
    input.privileged_mode_enabled == true
}

exposures contains _privileged_flag_zone_collapse_def if {
    count(privileged_flag_zone_collapse) > 0
}

_excessive_capability_grant_boundary_bypass_def := {
    "name": "Excessive Capability Grant Boundary Bypass",
    "description": "Granting capabilities beyond workload requirements (e.g., CAP_NET_ADMIN, CAP_SYS_PTRACE, CAP_SYS_MODULE) allows a container to manipulate network interfaces, inspect cross-zone process memory, or load kernel modules \u2014 directly undermining the segmentation boundary without requiring full privileged mode. Each granted capability represents a discrete boundary enforcement hole.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

excessive_capability_grant_boundary_bypass[_excessive_capability_grant_boundary_bypass_def] if {
    "CAP_SYS_ADMIN" in input.granted_capabilities
}

excessive_capability_grant_boundary_bypass[_excessive_capability_grant_boundary_bypass_def] if {
    "CAP_NET_ADMIN" in input.granted_capabilities
}

excessive_capability_grant_boundary_bypass[_excessive_capability_grant_boundary_bypass_def] if {
    "CAP_SYS_PTRACE" in input.granted_capabilities
}

excessive_capability_grant_boundary_bypass[_excessive_capability_grant_boundary_bypass_def] if {
    "CAP_SYS_MODULE" in input.granted_capabilities
}

excessive_capability_grant_boundary_bypass[_excessive_capability_grant_boundary_bypass_def] if {
    not input.capability_drop_all_enforced
    count(input.granted_capabilities) > 0
}

exposures contains _excessive_capability_grant_boundary_bypass_def if {
    count(excessive_capability_grant_boundary_bypass) > 0
}

_missing_seccomp_profile_syscall_exposure_def := {
    "name": "Missing Seccomp Profile Syscall Exposure",
    "description": "Absence of a restrictive seccomp profile leaves the full host kernel syscall surface exposed to container workloads. Syscalls such as unshare, ptrace, keyctl, and mount can be leveraged to manipulate namespace boundaries, extract credentials from adjacent zones, or remount filesystem layers \u2014 bypassing logical segmentation without exploiting a specific CVE.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_seccomp_profile_syscall_exposure[_missing_seccomp_profile_syscall_exposure_def] if {
    input.seccomp_profile_type == "Unconfined"
}

missing_seccomp_profile_syscall_exposure[_missing_seccomp_profile_syscall_exposure_def] if {
    input.seccomp_profile_type == "Unconfined"
    count(input.granted_capabilities) > 0
}

exposures contains _missing_seccomp_profile_syscall_exposure_def if {
    count(missing_seccomp_profile_syscall_exposure) > 0
}

_lsm_profile_absence_lateral_access_def := {
    "name": "Lsm Profile Absence Lateral Access",
    "description": "Without an AppArmor or SELinux mandatory access control profile, container processes are governed only by discretionary controls. This permits unrestricted access to shared kernel objects, IPC namespaces, and device nodes visible within the zone boundary, enabling cross-workload information flow that MAC profiles would otherwise deny.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

lsm_profile_absence_lateral_access[_lsm_profile_absence_lateral_access_def] if {
    not input.lsm_profile_assigned
}

lsm_profile_absence_lateral_access[_lsm_profile_absence_lateral_access_def] if {
    input.lsm_profile_assigned == true
    input.lsm_profile_mode == "unconfined"
}

lsm_profile_absence_lateral_access[_lsm_profile_absence_lateral_access_def] if {
    input.lsm_profile_assigned == true
    input.lsm_profile_mode == "permissive"
}

lsm_profile_absence_lateral_access[_lsm_profile_absence_lateral_access_def] if {
    input.privileged_mode_enabled == true
}

exposures contains _lsm_profile_absence_lateral_access_def if {
    count(lsm_profile_absence_lateral_access) > 0
}

_writable_root_filesystem_boundary_persistence_def := {
    "name": "Writable Root Filesystem Boundary Persistence",
    "description": "A read-write root filesystem allows a compromised container workload to modify binaries, install tooling, and establish persistence within the zone boundary. A writable layer also enables manipulation of shared filesystem mount points that may bridge trust zones, enabling staged lateral movement preparation within the boundary enforcement layer.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

writable_root_filesystem_boundary_persistence[_writable_root_filesystem_boundary_persistence_def] if {
    not input.read_only_root_filesystem
}

writable_root_filesystem_boundary_persistence[_writable_root_filesystem_boundary_persistence_def] if {
    not input.read_only_root_filesystem
    input.privileged_mode_enabled == true
}

exposures contains _writable_root_filesystem_boundary_persistence_def if {
    count(writable_root_filesystem_boundary_persistence) > 0
}

_network_namespace_ingress_egress_gap_def := {
    "name": "Network Namespace Ingress Egress Gap",
    "description": "Containers sharing a network namespace (e.g., via --network=host or sidecar namespace sharing) eliminate the network-layer zone boundary. Without per-container network namespace isolation, ingress/egress filtering applied at the container boundary is bypassed \u2014 traffic flows directly through the host or shared namespace without passing defined segmentation controls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

network_namespace_ingress_egress_gap[_network_namespace_ingress_egress_gap_def] if {
    input.host_network_enabled == true
}

network_namespace_ingress_egress_gap[_network_namespace_ingress_egress_gap_def] if {
    input.network_mode == "host"
}

network_namespace_ingress_egress_gap[_network_namespace_ingress_egress_gap_def] if {
    input.network_mode == "container_shared"
    not input.network_policy_enforced
}

exposures contains _network_namespace_ingress_egress_gap_def if {
    count(network_namespace_ingress_egress_gap) > 0
}

_absent_egress_filtering_trust_zone_exfiltration_def := {
    "name": "Absent Egress Filtering Trust Zone Exfiltration",
    "description": "Lack of enforced egress network policy at the container boundary permits workloads to initiate arbitrary outbound connections to adjacent trust zones or external endpoints. Without egress filtering, a compromised container can exfiltrate data, establish C2 channels, or probe sibling zone services \u2014 all traversing zone boundaries without detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

absent_egress_filtering_trust_zone_exfiltration[_absent_egress_filtering_trust_zone_exfiltration_def] if {
    not input.egress_network_policy_enforced
    input.cni_policy_enforcement_capable == true
}

absent_egress_filtering_trust_zone_exfiltration[_absent_egress_filtering_trust_zone_exfiltration_def] if {
    not input.cni_policy_enforcement_capable
}

absent_egress_filtering_trust_zone_exfiltration[_absent_egress_filtering_trust_zone_exfiltration_def] if {
    input.egress_network_policy_enforced == true
    not input.egress_policy_default_deny
    input.cni_policy_enforcement_capable == true
}

exposures contains _absent_egress_filtering_trust_zone_exfiltration_def if {
    count(absent_egress_filtering_trust_zone_exfiltration) > 0
}

_credential_bleed_via_mounted_secret_paths_def := {
    "name": "Credential Bleed Via Mounted Secret Paths",
    "description": "Secrets, tokens, or credentials mounted into the container filesystem (e.g., service account tokens, TLS keys) create a credential propagation pathway. If the container boundary is breached, these credentials grant trust in adjacent zones without requiring additional authentication \u2014 enabling trust propagation across zone boundaries beyond the container's intended scope.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

credential_bleed_via_mounted_secret_paths[_credential_bleed_via_mounted_secret_paths_def] if {
    count(input.mounted_secret_paths) > 0
    input.secret_mount_scope in ["adjacent_zone", "cluster_wide"]
}

credential_bleed_via_mounted_secret_paths[_credential_bleed_via_mounted_secret_paths_def] if {
    input.automount_service_account_token == true
    input.secret_mount_scope in ["adjacent_zone", "cluster_wide"]
}

credential_bleed_via_mounted_secret_paths[_credential_bleed_via_mounted_secret_paths_def] if {
    count(input.mounted_secret_paths) > 0
    not input.read_only_secret_mounts_enforced
    input.secret_mount_scope in ["adjacent_zone", "cluster_wide"]
}

exposures contains _credential_bleed_via_mounted_secret_paths_def if {
    count(credential_bleed_via_mounted_secret_paths) > 0
}

_ipc_namespace_cross_zone_signal_injection_def := {
    "name": "Ipc Namespace Cross Zone Signal Injection",
    "description": "Containers sharing an IPC namespace (e.g., --ipc=host or shared pod IPC) expose shared memory segments and semaphores across zone boundaries. An attacker in one zone can inspect or manipulate IPC objects belonging to workloads in adjacent zones, undermining zone separation without any network-layer traversal.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

ipc_namespace_cross_zone_signal_injection[_ipc_namespace_cross_zone_signal_injection_def] if {
    input.ipc_namespace_mode == "host"
}

ipc_namespace_cross_zone_signal_injection[_ipc_namespace_cross_zone_signal_injection_def] if {
    input.ipc_namespace_mode in ["shared_pod", "shareable"]
    input.cross_zone_workloads_share_ipc == true
}

ipc_namespace_cross_zone_signal_injection[_ipc_namespace_cross_zone_signal_injection_def] if {
    input.ipc_namespace_mode in ["host", "shared_pod", "shareable"]
    input.cross_zone_workloads_share_ipc == true
    not input.seccomp_ipc_syscalls_restricted
}

exposures contains _ipc_namespace_cross_zone_signal_injection_def if {
    count(ipc_namespace_cross_zone_signal_injection) > 0
}

_monitoring_blind_spot_intra_zone_lateral_movement_def := {
    "name": "Monitoring Blind Spot Intra Zone Lateral Movement",
    "description": "Absence of runtime behavioral monitoring (syscall auditing, eBPF-based observation) within the container boundary creates detection gaps for lateral movement attempts. An attacker pivoting between zones through the container boundary can exploit the lack of visibility to perform reconnaissance, credential harvesting, and staged movement without triggering alerts.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

monitoring_blind_spot_intra_zone_lateral_movement[_monitoring_blind_spot_intra_zone_lateral_movement_def] if {
    not input.syscall_auditing_enabled
    not input.ebpf_runtime_monitoring_enabled
}

monitoring_blind_spot_intra_zone_lateral_movement[_monitoring_blind_spot_intra_zone_lateral_movement_def] if {
    not input.container_network_flow_logging_enabled
    not input.ebpf_runtime_monitoring_enabled
}

monitoring_blind_spot_intra_zone_lateral_movement[_monitoring_blind_spot_intra_zone_lateral_movement_def] if {
    not input.syscall_auditing_enabled
    not input.container_network_flow_logging_enabled
}

exposures contains _monitoring_blind_spot_intra_zone_lateral_movement_def if {
    count(monitoring_blind_spot_intra_zone_lateral_movement) > 0
}

_cgroup_resource_limit_absence_noisy_neighbor_zone_disruption_def := {
    "name": "Cgroup Resource Limit Absence Noisy Neighbor Zone Disruption",
    "description": "Without enforced cgroup resource limits, a container within one trust zone can exhaust shared kernel resources (CPU, memory, PID space), degrading boundary enforcement capabilities and availability of security controls for adjacent zones. Resource exhaustion can be exploited to degrade monitoring, logging, or policy enforcement at the boundary layer.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

cgroup_resource_limit_absence_noisy_neighbor_zone_disruption[_cgroup_resource_limit_absence_noisy_neighbor_zone_disruption_def] if {
    not input.cpu_limit_enforced
}

cgroup_resource_limit_absence_noisy_neighbor_zone_disruption[_cgroup_resource_limit_absence_noisy_neighbor_zone_disruption_def] if {
    not input.memory_limit_enforced
}

cgroup_resource_limit_absence_noisy_neighbor_zone_disruption[_cgroup_resource_limit_absence_noisy_neighbor_zone_disruption_def] if {
    not input.pid_limit_enforced
}

exposures contains _cgroup_resource_limit_absence_noisy_neighbor_zone_disruption_def if {
    count(cgroup_resource_limit_absence_noisy_neighbor_zone_disruption) > 0
}
