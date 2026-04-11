package _dt_built_in.exposures.container_orchestration_platform

_api_server_unauthenticated_ingress_exposure_def := {
    "name": "Api Server Unauthenticated Ingress Exposure",
    "description": "The Kubernetes API server is reachable from workload network segments or external networks without enforced network-layer ingress filtering, allowing unauthenticated or weakly authenticated requests to reach the control plane boundary. Absence of network policy or firewall rules permitting workload pods to initiate connections to the API server port removes the first enforcement layer before RBAC applies.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

api_server_unauthenticated_ingress_exposure[_api_server_unauthenticated_ingress_exposure_def] if {
    not input.network_policy_restricts_api_server_egress
    input.anonymous_auth_enabled == true
}

api_server_unauthenticated_ingress_exposure[_api_server_unauthenticated_ingress_exposure_def] if {
    not input.api_server_firewall_ingress_restricted
    input.anonymous_auth_enabled == true
}

api_server_unauthenticated_ingress_exposure[_api_server_unauthenticated_ingress_exposure_def] if {
    not input.network_policy_restricts_api_server_egress
    not input.api_server_firewall_ingress_restricted
}

exposures contains _api_server_unauthenticated_ingress_exposure_def if {
    count(api_server_unauthenticated_ingress_exposure) > 0
}

_overpermissive_rbac_role_binding_propagation_def := {
    "name": "Overpermissive Rbac Role Binding Propagation",
    "description": "RBAC role bindings granting cluster-scoped or cross-namespace permissions (e.g., cluster-admin, wildcard resource verbs) to workload service accounts enable trust propagation from the workload zone into the control plane zone. A compromised pod inheriting such bindings can issue API server requests that cross the intended zone boundary, achieving lateral movement to control plane authority without exploiting a vulnerability.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

overpermissive_rbac_role_binding_propagation[_overpermissive_rbac_role_binding_propagation_def] if {
    input.binding_scope == "cluster"
    input.bound_role_has_wildcard_or_admin == true
    input.subject_type == "ServiceAccount"
    input.service_account_automounts_token == true
}

overpermissive_rbac_role_binding_propagation[_overpermissive_rbac_role_binding_propagation_def] if {
    input.binding_scope == "namespace"
    input.bound_role_has_wildcard_or_admin == true
    input.subject_type == "ServiceAccount"
    input.service_account_automounts_token == true
}

exposures contains _overpermissive_rbac_role_binding_propagation_def if {
    count(overpermissive_rbac_role_binding_propagation) > 0
}

_etcd_direct_access_bypass_of_api_server_boundary_def := {
    "name": "Etcd Direct Access Bypass Of Api Server Boundary",
    "description": "etcd is reachable directly from within the cluster network or from nodes without strict network segmentation enforcing that only the API server communicates with etcd. Direct access bypasses all API server authn/authz and admission controls, allowing an attacker with network access to read or write all cluster state including secrets, reducing the control plane boundary to the etcd network perimeter alone.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

etcd_direct_access_bypass_of_api_server_boundary[_etcd_direct_access_bypass_of_api_server_boundary_def] if {
    not input.etcd_network_access_restricted_to_api_server
    not input.etcd_client_cert_auth_enabled
}

etcd_direct_access_bypass_of_api_server_boundary[_etcd_direct_access_bypass_of_api_server_boundary_def] if {
    not input.etcd_network_access_restricted_to_api_server
    input.etcd_listen_address_scope == "all_interfaces"
}

etcd_direct_access_bypass_of_api_server_boundary[_etcd_direct_access_bypass_of_api_server_boundary_def] if {
    input.etcd_listen_address_scope == "all_interfaces"
    not input.etcd_client_cert_auth_enabled
}

exposures contains _etcd_direct_access_bypass_of_api_server_boundary_def if {
    count(etcd_direct_access_bypass_of_api_server_boundary) > 0
}

_admission_webhook_bypass_via_scope_gap_def := {
    "name": "Admission Webhook Bypass Via Scope Gap",
    "description": "Admission webhooks are scoped to specific resource types, namespaces, or operations. Gaps in webhook rule coverage \u2014 such as missing rules for UPDATE operations, subresources (e.g., pods/exec, pods/ephemeralcontainers), or certain API groups \u2014 allow policy-violating requests to transit the control plane boundary without inspection. Attackers can craft requests targeting uncovered surfaces to install privileged workloads or escalate without triggering enforcement.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

admission_webhook_bypass_via_scope_gap[_admission_webhook_bypass_via_scope_gap_def] if {
    not "UPDATE" in input.webhook_covered_operations
}

admission_webhook_bypass_via_scope_gap[_admission_webhook_bypass_via_scope_gap_def] if {
    not "pods/exec" in input.webhook_covered_subresources
}

admission_webhook_bypass_via_scope_gap[_admission_webhook_bypass_via_scope_gap_def] if {
    not "pods/ephemeralcontainers" in input.webhook_covered_subresources
}

admission_webhook_bypass_via_scope_gap[_admission_webhook_bypass_via_scope_gap_def] if {
    input.webhook_namespace_selector_present == true
}

admission_webhook_bypass_via_scope_gap[_admission_webhook_bypass_via_scope_gap_def] if {
    not input.high_risk_api_groups_covered
}

exposures contains _admission_webhook_bypass_via_scope_gap_def if {
    count(admission_webhook_bypass_via_scope_gap) > 0
}

_service_account_token_cross_zone_exfiltration_def := {
    "name": "Service Account Token Cross Zone Exfiltration",
    "description": "Service account tokens are automatically mounted into pods by default, and their network egress to the API server is unrestricted by egress network policy. A compromised pod can exfiltrate its token and use it from any network location to authenticate against the API server, crossing the workload-to-control-plane trust boundary. The absence of egress filtering on port 443/6443 toward control plane IPs from workload namespaces removes a countermeasure layer.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

service_account_token_cross_zone_exfiltration[_service_account_token_cross_zone_exfiltration_def] if {
    not input.service_account_automounts_token
    not input.egress_network_policy_controls_control_plane_ports
}

service_account_token_cross_zone_exfiltration[_service_account_token_cross_zone_exfiltration_def] if {
    not input.service_account_automounts_token
    not input.egress_network_policy_controls_control_plane_ports
    not input.token_bound_to_audience
}

exposures contains _service_account_token_cross_zone_exfiltration_def if {
    count(service_account_token_cross_zone_exfiltration) > 0
}

_admission_webhook_server_trust_inversion_def := {
    "name": "Admission Webhook Server Trust Inversion",
    "description": "The API server calls out to admission webhook servers that may reside in the workload zone or be operated by workload owners. If a webhook server is compromised or maliciously configured, it can return allow decisions for policy-violating objects or deny decisions for legitimate ones, inverting the trust relationship at the policy enforcement boundary. The control plane trusts the webhook response without independent verification of enforcement correctness.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

admission_webhook_server_trust_inversion[_admission_webhook_server_trust_inversion_def] if {
    input.webhook_server_zone == "workload_zone"
    not input.webhook_ca_bundle_configured
}

admission_webhook_server_trust_inversion[_admission_webhook_server_trust_inversion_def] if {
    input.webhook_server_zone == "workload_zone"
    input.webhook_failure_policy == "Ignore"
}

admission_webhook_server_trust_inversion[_admission_webhook_server_trust_inversion_def] if {
    input.webhook_server_zone in ["workload_zone", "shared_zone"]
    not input.webhook_ca_bundle_configured
    input.webhook_operator_rbac_unrestricted == true
}

exposures contains _admission_webhook_server_trust_inversion_def if {
    count(admission_webhook_server_trust_inversion) > 0
}

_network_policy_enforcement_gap_at_control_plane_egress_def := {
    "name": "Network Policy Enforcement Gap At Control Plane Egress",
    "description": "Kubernetes NetworkPolicy operates at the pod level and is enforced by the CNI plugin, but control plane components (API server, controller-manager, scheduler) typically run outside NetworkPolicy scope or in namespaces without egress restrictions. Egress from control plane components to arbitrary workload endpoints is unrestricted, enabling exploitation of SSRF or callback vulnerabilities in control plane software to reach workload-zone resources, blurring the directional trust boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

network_policy_enforcement_gap_at_control_plane_egress[_network_policy_enforcement_gap_at_control_plane_egress_def] if {
    not input.control_plane_namespace_egress_networkpolicy_configured
    input.cni_plugin_enforces_networkpolicy_in_control_plane_namespace == true
}

network_policy_enforcement_gap_at_control_plane_egress[_network_policy_enforcement_gap_at_control_plane_egress_def] if {
    not input.cni_plugin_enforces_networkpolicy_in_control_plane_namespace
    not input.control_plane_namespace_egress_networkpolicy_configured
}

network_policy_enforcement_gap_at_control_plane_egress[_network_policy_enforcement_gap_at_control_plane_egress_def] if {
    input.control_plane_components_run_as_static_pods_outside_cni == true
    not input.control_plane_namespace_egress_networkpolicy_configured
}

exposures contains _network_policy_enforcement_gap_at_control_plane_egress_def if {
    count(network_policy_enforcement_gap_at_control_plane_egress) > 0
}

_kubeconfig_credential_isolation_failure_def := {
    "name": "Kubeconfig Credential Isolation Failure",
    "description": "Kubeconfig files granting cluster-admin or elevated API server access are stored in CI/CD systems, developer workstations, or shared namespaces without isolation from workload-accessible paths. Credential leakage crosses the zone boundary by granting workload-zone actors direct control plane authentication without exploiting any API server vulnerability. Absence of short-lived credential rotation and namespace-scoped credential stores is the enforcement gap.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

kubeconfig_credential_isolation_failure[_kubeconfig_credential_isolation_failure_def] if {
    input.kubeconfig_privilege_level in ["cluster_admin", "elevated"]
    input.workload_accessible_storage == true
    not input.short_lived_credential_rotation_enabled
}

kubeconfig_credential_isolation_failure[_kubeconfig_credential_isolation_failure_def] if {
    input.kubeconfig_privilege_level == "cluster_admin"
    input.workload_accessible_storage == true
    count(input.kubeconfig_storage_locations) > 0
}

exposures contains _kubeconfig_credential_isolation_failure_def if {
    count(kubeconfig_credential_isolation_failure) > 0
}

_control_plane_audit_log_blind_spot_in_lateral_movement_detection_def := {
    "name": "Control Plane Audit Log Blind Spot In Lateral Movement Detection",
    "description": "API server audit logging may be configured with incomplete policy \u2014 omitting RequestResponse level logging for sensitive verbs (get secrets, exec, bind, escalate) or specific API groups. This monitoring gap means lateral movement across the control plane boundary via legitimate-looking API calls is not recorded or alerted on, preventing detection of trust zone boundary crossing even when enforcement controls fail.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

control_plane_audit_log_blind_spot_in_lateral_movement_detection[_control_plane_audit_log_blind_spot_in_lateral_movement_detection_def] if {
    not input.audit_policy_configured
}

control_plane_audit_log_blind_spot_in_lateral_movement_detection[_control_plane_audit_log_blind_spot_in_lateral_movement_detection_def] if {
    input.audit_policy_configured == true
    not input.audit_log_backend_enabled
}

control_plane_audit_log_blind_spot_in_lateral_movement_detection[_control_plane_audit_log_blind_spot_in_lateral_movement_detection_def] if {
    input.audit_policy_configured == true
    input.audit_log_backend_enabled == true
    input.audit_policy_sensitive_verb_coverage in ["partial", "none"]
}

exposures contains _control_plane_audit_log_blind_spot_in_lateral_movement_detection_def if {
    count(control_plane_audit_log_blind_spot_in_lateral_movement_detection) > 0
}

_node_to_control_plane_impersonation_via_kubelet_credential_reuse_def := {
    "name": "Node To Control Plane Impersonation Via Kubelet Credential Reuse",
    "description": "Kubelet credentials (node certificates) authorize node-scoped API server access, but if these credentials are accessible from workload pods on the node (e.g., via host path mounts or node filesystem access) they can be reused to impersonate the node identity against the API server. This crosses the workload-to-control-plane boundary using a credential that the control plane trusts as a node-zone principal, bypassing workload-level RBAC restrictions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

node_to_control_plane_impersonation_via_kubelet_credential_reuse[_node_to_control_plane_impersonation_via_kubelet_credential_reuse_def] if {
    input.kubelet_credential_host_path_mount_present == true
    not input.node_restriction_admission_plugin_enabled
}

node_to_control_plane_impersonation_via_kubelet_credential_reuse[_node_to_control_plane_impersonation_via_kubelet_credential_reuse_def] if {
    input.kubelet_credential_host_path_mount_present == true
}

node_to_control_plane_impersonation_via_kubelet_credential_reuse[_node_to_control_plane_impersonation_via_kubelet_credential_reuse_def] if {
    input.node_certificate_file_permissions_world_readable == true
    not input.node_restriction_admission_plugin_enabled
}

node_to_control_plane_impersonation_via_kubelet_credential_reuse[_node_to_control_plane_impersonation_via_kubelet_credential_reuse_def] if {
    input.node_certificate_file_permissions_world_readable == true
}

exposures contains _node_to_control_plane_impersonation_via_kubelet_credential_reuse_def if {
    count(node_to_control_plane_impersonation_via_kubelet_credential_reuse) > 0
}

_ingress_controller_privilege_escalation_to_control_plane_def := {
    "name": "Ingress Controller Privilege Escalation To Control Plane",
    "description": "Ingress controllers often hold cluster-scoped RBAC permissions to read Ingress, Secret, and Service resources across namespaces, and run in positions exposed to external traffic. Compromise of the ingress controller propagates trust from the external zone through the workload zone to the control plane zone via its service account, as a single component straddles multiple trust boundaries without segmentation of its credential scope.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

ingress_controller_privilege_escalation_to_control_plane[_ingress_controller_privilege_escalation_to_control_plane_def] if {
    input.ingress_controller_cluster_scoped_secret_access == true
    input.ingress_controller_exposed_to_external_traffic == true
    input.ingress_controller_automount_service_account_token == true
}

ingress_controller_privilege_escalation_to_control_plane[_ingress_controller_privilege_escalation_to_control_plane_def] if {
    not input.ingress_controller_namespace_isolation_enforced
    input.ingress_controller_exposed_to_external_traffic == true
    input.ingress_controller_automount_service_account_token == true
}

exposures contains _ingress_controller_privilege_escalation_to_control_plane_def if {
    count(ingress_controller_privilege_escalation_to_control_plane) > 0
}

_namespace_boundary_non_enforcement_in_multi_tenant_control_plane_def := {
    "name": "Namespace Boundary Non Enforcement In Multi Tenant Control Plane",
    "description": "Namespaces provide logical but not enforced network or RBAC isolation by default. Absence of NetworkPolicy between namespaces, combined with lack of hierarchical namespace policies, allows a tenant in one namespace to reach API server endpoints or shared admission webhook services and interact with control plane boundary surfaces intended to be scoped to other tenants, enabling cross-tenant trust zone traversal at the boundary layer.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

namespace_boundary_non_enforcement_in_multi_tenant_control_plane[_namespace_boundary_non_enforcement_in_multi_tenant_control_plane_def] if {
    not input.default_network_policy_present
}

namespace_boundary_non_enforcement_in_multi_tenant_control_plane[_namespace_boundary_non_enforcement_in_multi_tenant_control_plane_def] if {
    input.cross_namespace_rbac_bindings_present == true
}

exposures contains _namespace_boundary_non_enforcement_in_multi_tenant_control_plane_def if {
    count(namespace_boundary_non_enforcement_in_multi_tenant_control_plane) > 0
}
