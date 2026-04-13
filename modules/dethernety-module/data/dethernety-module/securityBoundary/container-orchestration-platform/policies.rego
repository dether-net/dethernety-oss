package _dt_built_in.exposures.container_orchestration_platform

_unauthenticated_api_server_ingress_def := {
    "name": "Unauthenticated Api Server Ingress",
    "description": "API server reachable from workload network segments without mutual TLS or token authentication enforced, allowing unauthenticated requests to traverse the workload-to-control-plane trust boundary. Presence detectable by checking whether anonymous-auth is enabled and whether network policy restricts workload-to-apiserver traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Unauthenticated API server access allows adversaries to exploit missing token validation to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Exposed unauthenticated API endpoints enable adversaries to bridge network boundaries and access internal cluster resources."
        }
    ],
    "attack_vector": "ADJACENT"
}

unauthenticated_api_server_ingress[_unauthenticated_api_server_ingress_def] if {
    input.anonymous_auth_enabled == true
    not input.workload_to_apiserver_network_policy_enforced
}

unauthenticated_api_server_ingress[_unauthenticated_api_server_ingress_def] if {
    input.anonymous_auth_enabled == true
    not input.mutual_tls_enforced
}

unauthenticated_api_server_ingress[_unauthenticated_api_server_ingress_def] if {
    input.api_server_insecure_port > 0
    not input.workload_to_apiserver_network_policy_enforced
}

exposures contains _unauthenticated_api_server_ingress_def if {
    count(unauthenticated_api_server_ingress) > 0
}

_etcd_exposed_outside_control_plane_zone_def := {
    "name": "Etcd Exposed Outside Control Plane Zone",
    "description": "etcd endpoints accessible from zones beyond the control plane boundary (e.g., node network, workload network) without zone-level network filtering, bypassing the API server's authn/authz gateway entirely. Detectable by whether etcd listen addresses are bound to interfaces reachable from non-control-plane segments and whether firewall rules enforce control-plane-only ingress.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "etcd exposed outside the control plane zone is vulnerable to network sniffing attacks that can intercept sensitive cluster state data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Exposing etcd outside its designated zone allows adversaries to bridge network boundaries and directly access cluster secrets and configurations."
        }
    ],
    "attack_vector": "ADJACENT"
}

etcd_exposed_outside_control_plane_zone[_etcd_exposed_outside_control_plane_zone_def] if {
    input.etcd_listen_address_scope == "all_interfaces"
    not input.firewall_restricts_etcd_to_control_plane
}

etcd_exposed_outside_control_plane_zone[_etcd_exposed_outside_control_plane_zone_def] if {
    input.etcd_listen_address_scope == "node_network"
    not input.firewall_restricts_etcd_to_control_plane
}

exposures contains _etcd_exposed_outside_control_plane_zone_def if {
    count(etcd_exposed_outside_control_plane_zone) > 0
}

_overpermissive_rbac_cluster_role_binding_def := {
    "name": "Overpermissive Rbac Cluster Role Binding",
    "description": "ClusterRoleBindings granting broad verbs (get/list/watch/create on secrets, pods, or nodes) to service accounts operating within workload trust zones, enabling privilege propagation across the control plane boundary without additional authentication steps. Detectable by enumerating ClusterRoleBindings referencing default or workload-namespace service accounts with wildcard resource or verb grants.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.006",
            "name": "Additional Container Cluster Roles",
            "relevance": "Overpermissive ClusterRoleBindings directly correspond to attackers adding or abusing excessive container cluster roles to escalate privileges."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Overly broad RBAC bindings grant elevated permissions that can be exploited for privilege escalation within the cluster."
        }
    ],
    "attack_vector": "LOCAL"
}

overpermissive_rbac_cluster_role_binding[_overpermissive_rbac_cluster_role_binding_def] if {
    "ServiceAccount" in input.bound_subject_types
    not input.subject_namespace in ["kube-system", "kube-public", "kube-node-lease"]
    "*" in input.granted_verbs
    "*" in input.granted_resources
}

overpermissive_rbac_cluster_role_binding[_overpermissive_rbac_cluster_role_binding_def] if {
    "ServiceAccount" in input.bound_subject_types
    not input.subject_namespace in ["kube-system", "kube-public", "kube-node-lease"]
    "secrets" in input.granted_resources
    "list" in input.granted_verbs
}

overpermissive_rbac_cluster_role_binding[_overpermissive_rbac_cluster_role_binding_def] if {
    "ServiceAccount" in input.bound_subject_types
    not input.subject_namespace in ["kube-system", "kube-public", "kube-node-lease"]
    "create" in input.granted_verbs
    "nodes" in input.granted_resources
}

overpermissive_rbac_cluster_role_binding[_overpermissive_rbac_cluster_role_binding_def] if {
    "ServiceAccount" in input.bound_subject_types
    not input.subject_namespace in ["kube-system", "kube-public", "kube-node-lease"]
    "*" in input.granted_verbs
    "pods" in input.granted_resources
}

overpermissive_rbac_cluster_role_binding[_overpermissive_rbac_cluster_role_binding_def] if {
    "ServiceAccount" in input.bound_subject_types
    not input.subject_namespace in ["kube-system", "kube-public", "kube-node-lease"]
    "*" in input.granted_resources
    "get" in input.granted_verbs
}

exposures contains _overpermissive_rbac_cluster_role_binding_def if {
    count(overpermissive_rbac_cluster_role_binding) > 0
}

_admission_webhook_bypass_via_missing_coverage_def := {
    "name": "Admission Webhook Bypass Via Missing Coverage",
    "description": "Policy admission webhooks (OPA/Gatekeeper, Kyverno) configured with namespace selectors or object selectors that exempt system namespaces, specific workload namespaces, or resource types, creating uncovered ingress paths through the policy enforcement boundary. Detectable by inspecting webhook matchPolicy, namespaceSelector, and failurePolicy fields for gap-inducing configurations.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484",
            "name": "Domain or Tenant Policy Modification",
            "relevance": "Missing admission webhook coverage allows adversaries to bypass policy enforcement, effectively circumventing domain-level security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1480",
            "name": "Execution Guardrails",
            "relevance": "Gaps in admission webhook coverage remove execution guardrails that would otherwise restrict malicious workload deployment."
        }
    ],
    "attack_vector": "LOCAL"
}

admission_webhook_bypass_via_missing_coverage[_admission_webhook_bypass_via_missing_coverage_def] if {
    input.webhook_failure_policy == "Ignore"
}

admission_webhook_bypass_via_missing_coverage[_admission_webhook_bypass_via_missing_coverage_def] if {
    input.namespace_selector_exempts_system_namespaces == true
}

admission_webhook_bypass_via_missing_coverage[_admission_webhook_bypass_via_missing_coverage_def] if {
    input.webhook_match_policy == "Exact"
}

admission_webhook_bypass_via_missing_coverage[_admission_webhook_bypass_via_missing_coverage_def] if {
    count(input.uncovered_resource_types) > 0
}

exposures contains _admission_webhook_bypass_via_missing_coverage_def if {
    count(admission_webhook_bypass_via_missing_coverage) > 0
}

_service_account_token_auto_mount_across_trust_zones_def := {
    "name": "Service Account Token Auto Mount Across Trust Zones",
    "description": "Service account tokens automatically mounted into pods grant API server credentials to workloads regardless of whether those workloads require control plane access, collapsing the workload-to-control-plane trust boundary by distributing credentials into the lower trust zone. Detectable by checking automountServiceAccountToken field on pod specs and service account objects.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Auto-mounted service account tokens across trust zones expose tokens that can be stolen from compromised pods to escalate access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Automatically mounted tokens can be directly used by adversaries as application access tokens to authenticate to the Kubernetes API."
        }
    ],
    "attack_vector": "LOCAL"
}

service_account_token_auto_mount_across_trust_zones[_service_account_token_auto_mount_across_trust_zones_def] if {
    input.automount_service_account_token == true
    input.service_account_has_elevated_rbac == true
}

service_account_token_auto_mount_across_trust_zones[_service_account_token_auto_mount_across_trust_zones_def] if {
    input.automount_service_account_token == true
    not input.service_account_has_elevated_rbac
    input.workload_namespace_trust_zone in ["restricted", "administrative"]
}

exposures contains _service_account_token_auto_mount_across_trust_zones_def if {
    count(service_account_token_auto_mount_across_trust_zones) > 0
}

_cross_tenant_namespace_rbac_propagation_def := {
    "name": "Cross Tenant Namespace Rbac Propagation",
    "description": "RBAC roles or bindings in one tenant namespace grant access to resources in peer tenant namespaces or to cluster-scoped resources, violating horizontal trust zone separation between tenants. Detectable by checking whether RoleBindings reference subjects from foreign namespaces and whether any Role grants access to cross-namespace resource paths.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.006",
            "name": "Additional Container Cluster Roles",
            "relevance": "Cross-tenant RBAC propagation allows adversaries to gain additional container cluster roles across namespace boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "name": "Trust Modification",
            "relevance": "Propagating RBAC across tenant namespaces constitutes modification of trust relationships between isolated tenants."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "name": "Trusted Relationship",
            "relevance": "Cross-namespace RBAC propagation exploits trusted relationships between namespaces to gain unauthorized access."
        }
    ],
    "attack_vector": "LOCAL"
}

cross_tenant_namespace_rbac_propagation[_cross_tenant_namespace_rbac_propagation_def] if {
    input.foreign_namespace_subjects_in_rolebindings == true
}

cross_tenant_namespace_rbac_propagation[_cross_tenant_namespace_rbac_propagation_def] if {
    input.role_grants_cluster_scoped_resources == true
}

cross_tenant_namespace_rbac_propagation[_cross_tenant_namespace_rbac_propagation_def] if {
    input.subject_namespace
}

exposures contains _cross_tenant_namespace_rbac_propagation_def if {
    count(cross_tenant_namespace_rbac_propagation) > 0
}

_admission_webhook_failure_open_policy_def := {
    "name": "Admission Webhook Failure Open Policy",
    "description": "Admission webhooks configured with failurePolicy: Ignore allow policy enforcement to be bypassed when the webhook endpoint is unavailable, creating an intermittent open path through the admission control boundary during outages or targeted denial-of-service against the webhook service. Detectable by inspecting failurePolicy field on MutatingWebhookConfiguration and ValidatingWebhookConfiguration objects.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.009",
            "name": "Conditional Access Policies",
            "relevance": "A failure-open admission webhook policy allows adversaries to bypass conditional access enforcement by triggering webhook failures."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.004",
            "name": "Exfiltration Over Webhook",
            "relevance": "Failure-open webhook policies can be abused to deploy malicious workloads that exfiltrate data via webhook channels."
        }
    ],
    "attack_vector": "LOCAL"
}

admission_webhook_failure_open_policy[_admission_webhook_failure_open_policy_def] if {
    input.webhook_failure_policy == "Ignore"
}

exposures contains _admission_webhook_failure_open_policy_def if {
    count(admission_webhook_failure_open_policy) > 0
}

_kubeconfig_credential_not_isolated_by_zone_def := {
    "name": "Kubeconfig Credential Not Isolated By Zone",
    "description": "Administrative kubeconfig files or service account credentials with cluster-admin or broad namespace rights are stored or accessible in zones below the control plane trust boundary (e.g., CI/CD runners, developer workstations, monitoring agents in workload namespaces), allowing credential theft to collapse zone separation. Detectable by auditing where high-privilege kubeconfig files are stored and whether workload-zone systems can access credential stores holding control-plane-scoped credentials.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Kubeconfig files contain credentials stored on disk that can be discovered and exfiltrated if not properly isolated by zone."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "name": "Cloud Accounts",
            "relevance": "Kubeconfig credentials not isolated by zone can be leveraged to authenticate as valid cloud or cluster accounts from unauthorized zones."
        }
    ],
    "attack_vector": "LOCAL"
}

kubeconfig_credential_not_isolated_by_zone[_kubeconfig_credential_not_isolated_by_zone_def] if {
    "ci_cd_runner" in input.high_privilege_kubeconfig_zones
    input.credential_scope in ["cluster_admin", "broad_namespace"]
}

kubeconfig_credential_not_isolated_by_zone[_kubeconfig_credential_not_isolated_by_zone_def] if {
    "developer_workstation" in input.high_privilege_kubeconfig_zones
    input.credential_scope in ["cluster_admin", "broad_namespace"]
}

kubeconfig_credential_not_isolated_by_zone[_kubeconfig_credential_not_isolated_by_zone_def] if {
    "workload_namespace" in input.high_privilege_kubeconfig_zones
    input.credential_scope in ["cluster_admin", "broad_namespace"]
}

kubeconfig_credential_not_isolated_by_zone[_kubeconfig_credential_not_isolated_by_zone_def] if {
    "monitoring_agent" in input.high_privilege_kubeconfig_zones
    input.credential_scope in ["cluster_admin", "broad_namespace"]
}

kubeconfig_credential_not_isolated_by_zone[_kubeconfig_credential_not_isolated_by_zone_def] if {
    input.workload_zone_credential_store_accessible == true
    input.credential_scope in ["cluster_admin", "broad_namespace"]
}

exposures contains _kubeconfig_credential_not_isolated_by_zone_def if {
    count(kubeconfig_credential_not_isolated_by_zone) > 0
}

_control_plane_ingress_not_restricted_by_network_policy_def := {
    "name": "Control Plane Ingress Not Restricted By Network Policy",
    "description": "Absence of NetworkPolicy or external firewall rules restricting which workload namespaces or pods may initiate connections to the API server, etcd, or scheduler, leaving the control plane ingress boundary defined solely by logical authn/authz rather than enforced network zone separation. Detectable by checking for NetworkPolicy or firewall rules explicitly denying workload-to-control-plane traffic on control plane ports.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.007",
            "name": "Disable or Modify Cloud Firewall",
            "relevance": "Missing network policy restrictions on control plane ingress is analogous to a missing or disabled cloud firewall allowing unrestricted access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Unrestricted control plane ingress enables adversaries to bridge network boundaries and directly attack control plane components."
        }
    ],
    "attack_vector": "ADJACENT"
}

control_plane_ingress_not_restricted_by_network_policy[_control_plane_ingress_not_restricted_by_network_policy_def] if {
    not input.network_policy_restricts_control_plane_ingress
    not input.external_firewall_restricts_control_plane_ingress
}

exposures contains _control_plane_ingress_not_restricted_by_network_policy_def if {
    count(control_plane_ingress_not_restricted_by_network_policy) > 0
}

_audit_log_gap_at_control_plane_boundary_def := {
    "name": "Audit Log Gap At Control Plane Boundary",
    "description": "Kubernetes audit policy configured with None or metadata-only logging for sensitive control plane operations (secret reads, RBAC modifications, privileged pod creation), leaving boundary-crossing events undetected in monitoring coverage. Detectable by inspecting the audit policy file for rules applying None or Metadata level to secrets, clusterrolebindings, or pods/exec resources.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Audit log gaps at the control plane boundary represent missing or incomplete logging that adversaries can exploit to operate undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.012",
            "name": "Disable or Modify Linux Audit System",
            "relevance": "Gaps in audit logging at the control plane boundary effectively disable audit visibility, mirroring the impact of modifying the audit system."
        }
    ]
}

audit_log_gap_at_control_plane_boundary[_audit_log_gap_at_control_plane_boundary_def] if {
    input.audit_log_path_configured == true
    input.audit_policy_file_present == true
    input.audit_policy_sensitive_resources_log_level == "None"
}

audit_log_gap_at_control_plane_boundary[_audit_log_gap_at_control_plane_boundary_def] if {
    input.audit_log_path_configured == true
    input.audit_policy_file_present == true
    input.audit_policy_sensitive_resources_log_level == "Metadata"
}

audit_log_gap_at_control_plane_boundary[_audit_log_gap_at_control_plane_boundary_def] if {
    input.audit_log_path_configured == true
    not input.audit_policy_file_present
}

audit_log_gap_at_control_plane_boundary[_audit_log_gap_at_control_plane_boundary_def] if {
    not input.audit_log_path_configured
}

exposures contains _audit_log_gap_at_control_plane_boundary_def if {
    count(audit_log_gap_at_control_plane_boundary) > 0
}

_scheduler_and_controller_manager_unauthenticated_endpoints_def := {
    "name": "Scheduler And Controller Manager Unauthenticated Endpoints",
    "description": "Scheduler or controller manager components exposing health/metrics endpoints on 0.0.0.0 without authentication, accessible from workload or node networks, leaking cluster topology and providing a reconnaissance surface at the control plane zone boundary. Detectable by checking --bind-address and --port flags on kube-scheduler and kube-controller-manager for non-loopback bindings with authentication disabled.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1613",
            "name": "Container and Resource Discovery",
            "relevance": "Unauthenticated scheduler and controller manager endpoints allow adversaries to enumerate container resources and cluster topology."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.013",
            "name": "Container CLI/API",
            "relevance": "Exposed unauthenticated endpoints can be accessed via container CLI/API calls to manipulate scheduling and controller decisions."
        }
    ],
    "attack_vector": "ADJACENT"
}

scheduler_and_controller_manager_unauthenticated_endpoints[_scheduler_and_controller_manager_unauthenticated_endpoints_def] if {
    input.bind_address_non_loopback == true
    input.authentication_disabled_on_endpoint == true
}

exposures contains _scheduler_and_controller_manager_unauthenticated_endpoints_def if {
    count(scheduler_and_controller_manager_unauthenticated_endpoints) > 0
}
