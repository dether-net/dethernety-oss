package _dt_built_in.exposures.internal_service_communication



_plaintext_east_west_traffic_no_mtls_def := {
    "name": "Plaintext east-west traffic (no mTLS)",
    "description": "East-west service-to-service traffic traverses the pod network in cleartext (no PeerAuthentication STRICT, no mesh sidecar). Any attacker with a pod or node foothold can tcpdump credentials, session tokens and PII off the CNI overlay.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

plaintext_east_west_traffic_no_mtls[_plaintext_east_west_traffic_no_mtls_def] if {
    not input.service_to_service_mtls_enforced
}

exposures contains _plaintext_east_west_traffic_no_mtls_def if {
    count(plaintext_east_west_traffic_no_mtls) > 0
}

_mtls_permissive_downgrade_def := {
    "name": "mTLS PERMISSIVE downgrade",
    "description": "PeerAuthentication left in PERMISSIVE mode (or unset, which defaults to PERMISSIVE) accepts plaintext alongside mTLS, letting an unattested caller establish a cleartext session, observe traffic, or inject calls under no identity.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle: PERMISSIVE mode lets an attacker on the pod network terminate or observe plaintext east-west sessions alongside the mTLS-protected flow, positioning between caller and callee."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

mtls_permissive_downgrade[_mtls_permissive_downgrade_def] if {
    not input.peer_authentication_mtls_mode_strict
}

exposures contains _mtls_permissive_downgrade_def if {
    count(mtls_permissive_downgrade) > 0
}

_no_per_workload_identity_ip_or_shared_token_trust_def := {
    "name": "No per-workload identity (IP- or shared-token trust)",
    "description": "Workloads authenticate to peers by source IP, hostname, or a shared bearer token rather than per-workload SPIFFE/mesh identity. A compromised pod can impersonate any neighbour to backends that only check 'caller is in the cluster'.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

no_per_workload_identity_ip_or_shared_token_trust[_no_per_workload_identity_ip_or_shared_token_trust_def] if {
    not input.identity_propagated_cryptographically
}

exposures contains _no_per_workload_identity_ip_or_shared_token_trust_def if {
    count(no_per_workload_identity_ip_or_shared_token_trust) > 0
}

_flat_pod_network_no_default_deny_networkpolicy_def := {
    "name": "Flat pod network (no default-deny NetworkPolicy)",
    "description": "No namespace-scoped default-deny NetworkPolicy means any-to-any pod reachability across the cluster. A single RCE in any pod yields lateral movement to every service in every namespace.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Any-to-any pod reachability with no default-deny NetworkPolicy lets an adversary on one compromised pod reach vulnerable peer services and exploit them to move laterally through the cluster (Exploitation of Remote Services, T1210)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "Without a default-deny NetworkPolicy, a compromised pod can scan the entire pod and service network and enumerate every listening service in the cluster (Network Service Discovery, T1046)."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

flat_pod_network_no_default_deny_networkpolicy[_flat_pod_network_no_default_deny_networkpolicy_def] if {
    not input.east_west_microsegmentation_enforced
}

flat_pod_network_no_default_deny_networkpolicy[_flat_pod_network_no_default_deny_networkpolicy_def] if {
    not input.east_west_within_segment_restricted
}

exposures contains _flat_pod_network_no_default_deny_networkpolicy_def if {
    count(flat_pod_network_no_default_deny_networkpolicy) > 0
}

_no_per_call_service_to_service_authorization_def := {
    "name": "No per-call service-to-service authorization",
    "description": "No AuthorizationPolicy gates east-west calls on caller identity \u2014 any mTLS-authenticated peer can reach any endpoint. A compromised low-privilege service can pivot directly to high-privilege APIs (databases, secret stores, admin endpoints).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

no_per_call_service_to_service_authorization[_no_per_call_service_to_service_authorization_def] if {
    not input.least_privilege_authorization_at_crossing
}

no_per_call_service_to_service_authorization[_no_per_call_service_to_service_authorization_def] if {
    not input.internal_interface_reauthenticates_calls
}

exposures contains _no_per_call_service_to_service_authorization_def if {
    count(no_per_call_service_to_service_authorization) > 0
}

_shared_long_lived_service_credentials_reused_everywhere_def := {
    "name": "Shared long-lived service credentials reused everywhere",
    "description": "The same long-lived API key or bearer token is baked into multiple Deployments / images / ConfigMaps. Theft from any single pod yields credentials usable across the entire service fabric, defeating any per-workload identity.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

shared_long_lived_service_credentials_reused_everywhere[_shared_long_lived_service_credentials_reused_everywhere_def] if {
    input.shared_service_credentials_used == true
}

exposures contains _shared_long_lived_service_credentials_reused_everywhere_def if {
    count(shared_long_lived_service_credentials_reused_everywhere) > 0
}

_unmonitored_east_west_silent_lateral_movement_def := {
    "name": "Unmonitored east-west \u2014 silent lateral movement",
    "description": "No central capture of source/destination principals on east-west calls and no anomaly rules on new caller-callee pairs. Lateral movement leaves no trace until impact is realised; attribution is impossible after the fact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unmonitored_east_west_silent_lateral_movement[_unmonitored_east_west_silent_lateral_movement_def] if {
    not input.centralized_log_aggregation
}

unmonitored_east_west_silent_lateral_movement[_unmonitored_east_west_silent_lateral_movement_def] if {
    not input.access_audit_trail_enabled
}

exposures contains _unmonitored_east_west_silent_lateral_movement_def if {
    count(unmonitored_east_west_silent_lateral_movement) > 0
}

_privileged_control_plane_reachable_from_app_pods_def := {
    "name": "Privileged control-plane reachable from app pods",
    "description": "App-namespace pods can reach kube-apiserver, etcd, kubelet (10250) or cloud metadata (169.254.169.254). A single RCE escalates to cluster-admin or cloud-credential theft via the unrestricted east-west path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
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
            "value": "T1552.007",
            "attributes": {
                "justification": "App-namespace pods that can reach kube-apiserver, etcd or the kubelet let an adversary in a compromised workload query those container APIs to retrieve Secrets and service-account tokens (Container API, T1552.007)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1609",
            "attributes": {
                "justification": "Reachable kube-apiserver and kubelet (10250) endpoints let an adversary in an application pod use exec and run APIs to execute commands inside other containers (Container Administration Command, T1609)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

privileged_control_plane_reachable_from_app_pods[_privileged_control_plane_reachable_from_app_pods_def] if {
    not input.management_plane_isolated_from_data_plane
}

privileged_control_plane_reachable_from_app_pods[_privileged_control_plane_reachable_from_app_pods_def] if {
    not input.cloud_metadata_endpoint_blocked
}

exposures contains _privileged_control_plane_reachable_from_app_pods_def if {
    count(privileged_control_plane_reachable_from_app_pods) > 0
}
