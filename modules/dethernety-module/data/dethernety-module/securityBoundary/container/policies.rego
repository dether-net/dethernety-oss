package _dt_built_in.exposures.container



_excessive_linux_capabilities_granted_def := {
    "name": "Excessive Linux Capabilities Granted",
    "description": "Container runtimes configured without dropping non-essential Linux capabilities (e.g., CAP_NET_ADMIN, CAP_SYS_PTRACE, CAP_SYS_MODULE) allow workloads to manipulate host networking, inspect cross-zone processes, or load kernel modules \u2014 effectively dissolving the trust boundary between the container zone and the host or adjacent zones.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Excessive Linux capabilities (e.g., CAP_SYS_ADMIN) directly enable container escape to the host."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1609",
            "name": "Container Administration Command",
            "relevance": "Granted capabilities allow execution of privileged administration commands within or beyond the container boundary."
        }
    ],
    "attack_vector": "LOCAL"
}

excessive_linux_capabilities_granted[_excessive_linux_capabilities_granted_def] if {
    input.privileged_mode_enabled == true
}

excessive_linux_capabilities_granted[_excessive_linux_capabilities_granted_def] if {
    count(input.dangerous_capabilities_granted) > 0
}

excessive_linux_capabilities_granted[_excessive_linux_capabilities_granted_def] if {
    not input.all_capabilities_dropped
    count(input.dropped_capabilities) == 0
    not input.privileged_mode_enabled
}

exposures contains _excessive_linux_capabilities_granted_def if {
    count(excessive_linux_capabilities_granted) > 0
}

_missing_or_permissive_seccomp_profile_def := {
    "name": "Missing Or Permissive Seccomp Profile",
    "description": "Absence of a seccomp filter or use of an unconfined profile permits workloads to invoke privileged syscalls (e.g., ptrace, mount, keyctl, unshare) that can undermine namespace isolation and enable zone traversal. The syscall surface becomes an implicit trust boundary bypass path.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.008",
            "name": "Ptrace System Calls",
            "relevance": "A missing seccomp profile allows unrestricted ptrace syscalls, enabling process injection and container escape."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Without seccomp restrictions, dangerous syscalls can be leveraged to escape the container to the host."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1547.006",
            "name": "Kernel Modules and Extensions",
            "relevance": "Permissive seccomp profiles allow loading of kernel modules, enabling persistent host-level compromise."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_or_permissive_seccomp_profile[_missing_or_permissive_seccomp_profile_def] if {
    input.seccomp_profile_type == "Unconfined"
}

missing_or_permissive_seccomp_profile[_missing_or_permissive_seccomp_profile_def] if {
    not input.seccomp_profile_configured
}

missing_or_permissive_seccomp_profile[_missing_or_permissive_seccomp_profile_def] if {
    input.seccomp_profile_type == "None"
}

exposures contains _missing_or_permissive_seccomp_profile_def if {
    count(missing_or_permissive_seccomp_profile) > 0
}

_shared_pid_or_ipc_namespace_across_zones_def := {
    "name": "Shared Pid Or Ipc Namespace Across Zones",
    "description": "Containers from distinct trust zones sharing a PID or IPC namespace break process isolation, allowing cross-zone signal injection, /proc inspection, and shared memory access. This represents a direct segmentation enforcement failure at the namespace level.",
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
            "relevance": "Shared IPC namespace allows cross-container inter-process communication, breaking zone isolation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.008",
            "name": "Ptrace System Calls",
            "relevance": "Shared PID namespace enables ptrace-based process injection across workloads in different zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Shared PID/IPC namespaces dissolve isolation boundaries, facilitating escape from container to host or adjacent workloads."
        }
    ],
    "attack_vector": "LOCAL"
}

shared_pid_or_ipc_namespace_across_zones[_shared_pid_or_ipc_namespace_across_zones_def] if {
    input.shared_pid_namespace == true
    input.cross_zone_namespace_sharing_detected == true
}

shared_pid_or_ipc_namespace_across_zones[_shared_pid_or_ipc_namespace_across_zones_def] if {
    input.shared_ipc_namespace == true
    input.cross_zone_namespace_sharing_detected == true
}

exposures contains _shared_pid_or_ipc_namespace_across_zones_def if {
    count(shared_pid_or_ipc_namespace_across_zones) > 0
}

_absent_or_weak_lsm_enforcement_def := {
    "name": "Absent Or Weak Lsm Enforcement",
    "description": "Runtime deployments lacking active AppArmor, SELinux, or equivalent LSM profiles lose mandatory access control enforcement between container zones. Without LSM enforcement, discretionary access controls alone govern zone separation, which can be bypassed through capability misuse or filesystem traversal.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Without LSM (AppArmor/SELinux) enforcement, containers lack mandatory access controls preventing host escape."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543.005",
            "name": "Container Service",
            "relevance": "Weak LSM enforcement allows attackers to manipulate or create container services without policy restrictions."
        }
    ],
    "attack_vector": "LOCAL"
}

absent_or_weak_lsm_enforcement[_absent_or_weak_lsm_enforcement_def] if {
    not input.lsm_profile_enforced
}

absent_or_weak_lsm_enforcement[_absent_or_weak_lsm_enforcement_def] if {
    input.lsm_profile_enforced == true
    input.lsm_profile_mode in ["permissive", "disabled", "unknown"]
}

exposures contains _absent_or_weak_lsm_enforcement_def if {
    count(absent_or_weak_lsm_enforcement) > 0
}

_unrestricted_egress_enabling_trust_propagation_def := {
    "name": "Unrestricted Egress Enabling Trust Propagation",
    "description": "Containers lacking egress network policy or CNI-enforced filtering can initiate connections to workloads in higher-trust zones, cloud metadata services, or external command-and-control infrastructure. Unrestricted egress collapses intended zone segmentation by allowing trust to propagate outward from a compromised low-trust zone.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.003",
            "name": "Network Trust Dependencies",
            "relevance": "Unrestricted egress allows attackers to exploit network trust relationships and propagate across trust boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Unrestricted egress enables bridging of network boundaries, allowing lateral movement between zones."
        }
    ],
    "attack_vector": "LOCAL"
}

unrestricted_egress_enabling_trust_propagation[_unrestricted_egress_enabling_trust_propagation_def] if {
    not input.egress_network_policy_enforced
    input.workload_trust_zone in ["untrusted", "low"]
}

unrestricted_egress_enabling_trust_propagation[_unrestricted_egress_enabling_trust_propagation_def] if {
    input.cloud_metadata_service_reachable == true
    not input.egress_network_policy_enforced
}

exposures contains _unrestricted_egress_enabling_trust_propagation_def if {
    count(unrestricted_egress_enabling_trust_propagation) > 0
}

_overly_permissive_ingress_between_zones_def := {
    "name": "Overly Permissive Ingress Between Zones",
    "description": "Network policies that permit broad ingress between trust zones (e.g., allow all within a namespace or cluster) create lateral movement paths. An attacker in a low-trust zone can directly address and attack services in a higher-trust zone without traversing any enforcement point.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Permissive ingress rules between zones effectively bridge network boundaries that should be isolated."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.003",
            "name": "Network Trust Dependencies",
            "relevance": "Overly permissive ingress exploits implicit network trust dependencies between zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "name": "Trust Modification",
            "relevance": "Permissive ingress policies can reflect or enable modification of trust relationships between network zones."
        }
    ],
    "attack_vector": "LOCAL"
}

overly_permissive_ingress_between_zones[_overly_permissive_ingress_between_zones_def] if {
    input.ingress_policy_scope == "none"
    not input.cross_zone_ingress_enforced
}

overly_permissive_ingress_between_zones[_overly_permissive_ingress_between_zones_def] if {
    input.ingress_policy_scope == "cluster_wide"
    not input.cross_zone_ingress_enforced
}

overly_permissive_ingress_between_zones[_overly_permissive_ingress_between_zones_def] if {
    not input.default_deny_ingress_policy_present
    not input.cross_zone_ingress_enforced
    not input.ingress_policy_scope in ["zone_scoped"]
}

exposures contains _overly_permissive_ingress_between_zones_def if {
    count(overly_permissive_ingress_between_zones) > 0
}

_environment_variable_credential_bleed_across_zones_def := {
    "name": "Environment Variable Credential Bleed Across Zones",
    "description": "Secrets and credentials injected as environment variables in one trust zone can propagate into adjacent zones through shared init containers, sidecar injection misconfigurations, or orchestrator secret projection errors. This constitutes a credential isolation failure at the zone boundary, enabling cross-zone authentication.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Credentials stored in environment variables represent unsecured credentials accessible to any process in the container."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Environment variable credentials can be exposed through /proc or mounted filesystems, similar to credentials in files."
        }
    ],
    "attack_vector": "LOCAL"
}

environment_variable_credential_bleed_across_zones[_environment_variable_credential_bleed_across_zones_def] if {
    input.secret_projection_cross_zone == true
}

environment_variable_credential_bleed_across_zones[_environment_variable_credential_bleed_across_zones_def] if {
    input.sidecar_injection_scope in ["multi_zone", "unrestricted"]
}

environment_variable_credential_bleed_across_zones[_environment_variable_credential_bleed_across_zones_def] if {
    input.secret_projection_cross_zone == true
}

exposures contains _environment_variable_credential_bleed_across_zones_def if {
    count(environment_variable_credential_bleed_across_zones) > 0
}

_service_account_token_over_projection_def := {
    "name": "Service Account Token Over Projection",
    "description": "Mounting high-privilege service account tokens into workload containers without audience binding or expiry constraints allows a compromised container to authenticate as a privileged identity against the orchestration API or adjacent zone services. Token scope exceeds zone boundary permissions, enabling trust escalation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.007",
            "name": "Container API",
            "relevance": "Over-projected service account tokens provide excessive API access credentials accessible within the container."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Projected service account tokens are application access tokens that can be stolen and reused by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.006",
            "name": "Additional Container Cluster Roles",
            "relevance": "Over-projected tokens with excessive roles grant attackers additional cluster-level permissions if compromised."
        }
    ],
    "attack_vector": "LOCAL"
}

service_account_token_over_projection[_service_account_token_over_projection_def] if {
    input.service_account_token_projected == true
    not input.token_audience_binding_configured
}

service_account_token_over_projection[_service_account_token_over_projection_def] if {
    input.service_account_token_projected == true
    input.token_long_lived > 86400
}

exposures contains _service_account_token_over_projection_def if {
    count(service_account_token_over_projection) > 0
}

_unmonitored_inter_zone_traffic_paths_def := {
    "name": "Unmonitored Inter Zone Traffic Paths",
    "description": "Absence of network flow logging, eBPF-based runtime monitoring, or service mesh telemetry on paths between trust zones creates a blind spot in which lateral movement and unauthorized trust propagation cannot be detected or audited. Enforcement gaps go unobserved, delaying or preventing incident response.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1665",
            "name": "Hide Infrastructure",
            "relevance": "Unmonitored traffic paths allow attackers to hide malicious inter-zone communication from defenders."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Without monitoring, network sniffing on inter-zone paths goes undetected, enabling credential and data capture."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1205",
            "name": "Traffic Signaling",
            "relevance": "Unmonitored paths can be used for covert traffic signaling between compromised nodes across zones."
        }
    ],
    "attack_vector": "LOCAL"
}

unmonitored_inter_zone_traffic_paths[_unmonitored_inter_zone_traffic_paths_def] if {
    not input.inter_zone_flow_logging_enabled
    input.runtime_network_monitoring_solution == "none"
}

unmonitored_inter_zone_traffic_paths[_unmonitored_inter_zone_traffic_paths_def] if {
    input.runtime_network_monitoring_solution == "flow_logs_only"
    not input.network_policy_enforcement_enabled
}

unmonitored_inter_zone_traffic_paths[_unmonitored_inter_zone_traffic_paths_def] if {
    not input.inter_zone_flow_logging_enabled
    not input.network_policy_enforcement_enabled
}

exposures contains _unmonitored_inter_zone_traffic_paths_def if {
    count(unmonitored_inter_zone_traffic_paths) > 0
}

_privileged_container_flag_dissolving_boundary_def := {
    "name": "Privileged Container Flag Dissolving Boundary",
    "description": "Containers launched with the privileged flag enabled bypass nearly all kernel isolation primitives \u2014 namespaces, capabilities, seccomp, and device restrictions \u2014 effectively removing the container as a trust boundary. Any workload running privileged in a multi-tenant or multi-zone host collapses zone separation for that host.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "The privileged container flag removes isolation boundaries and is the primary vector for container-to-host escape."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1609",
            "name": "Container Administration Command",
            "relevance": "Privileged containers allow execution of host-level administration commands dissolving container boundaries."
        }
    ],
    "attack_vector": "LOCAL"
}

privileged_container_flag_dissolving_boundary[_privileged_container_flag_dissolving_boundary_def] if {
    input.privileged_mode_enabled == true
}

privileged_container_flag_dissolving_boundary[_privileged_container_flag_dissolving_boundary_def] if {
    input.privileged_mode_enabled == true
    input.host_pid_or_ipc_namespace_shared == true
}

exposures contains _privileged_container_flag_dissolving_boundary_def if {
    count(privileged_container_flag_dissolving_boundary) > 0
}

_host_network_namespace_sharing_def := {
    "name": "Host Network Namespace Sharing",
    "description": "Containers configured with hostNetwork:true share the host's network namespace, granting visibility into and the ability to intercept traffic across all co-located zone boundaries. This nullifies network-layer segmentation enforcement for the affected node and exposes cross-zone communication channels.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Sharing the host network namespace grants containers access to sniff all host network traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Host network namespace sharing dissolves the container network boundary, bridging it directly to the host network."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1049",
            "name": "System Network Connections Discovery",
            "relevance": "Access to the host network namespace allows enumeration of all system network connections on the host."
        }
    ],
    "attack_vector": "LOCAL"
}

host_network_namespace_sharing[_host_network_namespace_sharing_def] if {
    input.host_network_enabled == true
}

host_network_namespace_sharing[_host_network_namespace_sharing_def] if {
    input.host_network_enabled == true
    not input.network_policy_enforcement_enabled
}

exposures contains _host_network_namespace_sharing_def if {
    count(host_network_namespace_sharing) > 0
}
