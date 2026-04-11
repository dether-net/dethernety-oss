package _dt_built_in.countermeasures.service_to_service_policy

_mutual_tls_enforcement_coverage_def := {
    "name": "Mutual Tls Enforcement Coverage",
    "description": "Provides cryptographic identity binding for all service-to-service calls by requiring valid certificates on both sides of each connection, eliminating unauthenticated lateral paths within the cluster.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CBAN",
            "name": "Certificate-based Authentication",
            "relevance": "Directly addresses mutual TLS enforcement by requiring certificate-based authentication for both client and server."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CP",
            "name": "Certificate Pinning",
            "relevance": "Strengthens mTLS enforcement by pinning expected certificates, preventing impersonation attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "Directly relates to enforcing and inspecting TLS communications to ensure proper mutual TLS coverage."
        }
    ]
}

mutual_tls_enforcement_coverage[_mutual_tls_enforcement_coverage_def] if {
    input.mtls_mode == "STRICT"
    input.mesh_wide_policy_enforced == true
    input.certificate_authority_configured == true
}

countermeasures contains _mutual_tls_enforcement_coverage_def if {
    count(mutual_tls_enforcement_coverage) > 0
}

_service_identity_verification_accuracy_def := {
    "name": "Service Identity Verification Accuracy",
    "description": "Delivers precise workload identity resolution by mapping cryptographic credentials to service principals, enabling high-fidelity attribution of which service initiated each request.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CH",
            "name": "Credential Hardening",
            "relevance": "Hardens service identity credentials to improve accuracy and resistance to compromise in verification processes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1032",
            "name": "Multi-factor Authentication",
            "relevance": "Improves service identity verification accuracy by requiring multiple authentication factors."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CCSA",
            "name": "Credential Compromise Scope Analysis",
            "relevance": "Identifies the scope of compromised service identities to improve verification accuracy."
        }
    ]
}

service_identity_verification_accuracy[_service_identity_verification_accuracy_def] if {
    input.mtls_mode == true
    not input.workload_identity_provider in ["none"]
}

service_identity_verification_accuracy[_service_identity_verification_accuracy_def] if {
    input.mtls_mode == true
    input.service_account_token_projection_enabled == true
}

countermeasures contains _service_identity_verification_accuracy_def if {
    count(service_identity_verification_accuracy) > 0
}

_authorization_policy_granularity_def := {
    "name": "Authorization Policy Granularity",
    "description": "Provides fine-grained, method-level access control between services, ensuring a service can only invoke the specific endpoints it is explicitly permitted to call, minimizing blast radius of any single compromised service.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AMED",
            "name": "Access Mediation",
            "relevance": "Directly supports fine-grained authorization policy enforcement by mediating access decisions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CTS",
            "name": "Credential Transmission Scoping",
            "relevance": "Scopes credential transmission to appropriate contexts, supporting granular authorization policies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Enforces granular network-level access controls aligned with authorization policy requirements."
        }
    ]
}

authorization_policy_granularity[_authorization_policy_granularity_def] if {
    input.authorization_policies_deployed == true
    input.policy_granularity_level == "method"
    input.default_deny_policy_present == true
    input.source_principal_binding_enforced == true
}

authorization_policy_granularity[_authorization_policy_granularity_def] if {
    input.authorization_policies_deployed == true
    input.policy_granularity_level == "service"
    input.default_deny_policy_present == true
    input.source_principal_binding_enforced == true
}

countermeasures contains _authorization_policy_granularity_def if {
    count(authorization_policy_granularity) > 0
}

_unauthorized_call_prevention_coverage_def := {
    "name": "Unauthorized Call Prevention Coverage",
    "description": "Actively blocks service invocations that lack valid credentials or violate authorization policy before request processing occurs, providing pre-execution prevention rather than after-the-fact detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APCA",
            "name": "Application Protocol Command Analysis",
            "relevance": "Detects and prevents unauthorized API/service calls by analyzing application protocol commands."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-EI",
            "name": "Execution Isolation",
            "relevance": "Isolates service execution to prevent unauthorized cross-service calls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Restricts network-level access to services, preventing unauthorized calls from reaching service endpoints."
        }
    ]
}

unauthorized_call_prevention_coverage[_unauthorized_call_prevention_coverage_def] if {
    input.mtls_mode == true
    input.authorization_policy_mode == "deny_by_default"
    input.pre_execution_enforcement_point in ["proxy_layer", "application_middleware"]
}

unauthorized_call_prevention_coverage[_unauthorized_call_prevention_coverage_def] if {
    input.mtls_mode == true
    input.pre_execution_enforcement_point == "proxy_layer"
    input.authorization_policy_mode == "deny_by_default"
}

countermeasures contains _unauthorized_call_prevention_coverage_def if {
    count(unauthorized_call_prevention_coverage) > 0
}

_authentication_event_logging_completeness_def := {
    "name": "Authentication Event Logging Completeness",
    "description": "Generates structured audit logs for every authentication attempt\u2014success and failure\u2014including service identity, target service, timestamp, and policy outcome, supporting forensic reconstruction of lateral movement.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Directly monitors authentication events and thresholds, ensuring completeness of authentication logging."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Captures and analyzes connection attempts to ensure authentication events are fully logged."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly supports completeness of authentication event logging through systematic audit practices."
        }
    ]
}

authentication_event_logging_completeness[_authentication_event_logging_completeness_def] if {
    input.auth_event_logging_enabled == true
    input.logged_fields_coverage == "full"
    input.failure_events_captured == true
}

countermeasures contains _authentication_event_logging_completeness_def if {
    count(authentication_event_logging_completeness) > 0
}

_certificate_lifecycle_management_integration_def := {
    "name": "Certificate Lifecycle Management Integration",
    "description": "Integrates with PKI or certificate authority infrastructure to automate issuance, rotation, and revocation of service certificates, ensuring credentials remain valid and revocation is propagated without manual intervention.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CERO",
            "name": "Certificate Rotation",
            "relevance": "Directly addresses certificate lifecycle management by automating certificate rotation processes."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ACA",
            "name": "Active Certificate Analysis",
            "relevance": "Actively monitors certificate status and validity as part of lifecycle management integration."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CRO",
            "name": "Credential Rotation",
            "relevance": "Supports certificate lifecycle management by ensuring timely rotation of certificate-based credentials."
        }
    ]
}

certificate_lifecycle_management_integration[_certificate_lifecycle_management_integration_def] if {
    input.ca_integration_enabled == true
    input.automatic_rotation_configured == true
    not input.revocation_propagation_mechanism in ["none"]
}

countermeasures contains _certificate_lifecycle_management_integration_def if {
    count(certificate_lifecycle_management_integration) > 0
}

_policy_as_code_maintainability_def := {
    "name": "Policy As Code Maintainability",
    "description": "Supports declarative, version-controlled authorization policies that can be tested, reviewed, and deployed through CI/CD pipelines, reducing configuration drift and enabling rapid policy updates across all enforced services.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APA",
            "name": "Access Policy Administration",
            "relevance": "Directly supports policy-as-code maintainability by providing structured access policy administration frameworks."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CV",
            "name": "Content Validation",
            "relevance": "Validates policy code content to ensure correctness and maintainability of policy definitions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Ensures security policies encoded as software configurations are properly maintained and managed."
        }
    ]
}

policy_as_code_maintainability[_policy_as_code_maintainability_def] if {
    input.authorization_policies_version_controlled == true
    input.cicd_pipeline_enforces_policy_deployment == true
    input.policy_testing_integrated_in_pipeline == true
}

policy_as_code_maintainability[_policy_as_code_maintainability_def] if {
    input.authorization_policies_version_controlled == true
    input.cicd_pipeline_enforces_policy_deployment == true
}

countermeasures contains _policy_as_code_maintainability_def if {
    count(policy_as_code_maintainability) > 0
}

_anomalous_call_pattern_detection_def := {
    "name": "Anomalous Call Pattern Detection",
    "description": "Provides baseline deviation detection by correlating authentication and authorization events against expected service communication graphs, flagging calls to services outside normal peer relationships.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Detects anomalous call patterns by thresholding authorization events and identifying deviations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTCD",
            "name": "Network Traffic Community Deviation",
            "relevance": "Identifies anomalous service call patterns by detecting deviations from established network traffic communities."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Analyzes connection attempts to identify anomalous call patterns between services."
        }
    ]
}

anomalous_call_pattern_detection[_anomalous_call_pattern_detection_def] if {
    input.baseline_communication_graph_defined == true
    input.auth_event_correlation_enabled == true
    input.anomaly_detection_mode == "enforcing"
}

anomalous_call_pattern_detection[_anomalous_call_pattern_detection_def] if {
    input.baseline_communication_graph_defined == true
    input.auth_event_correlation_enabled == true
    input.anomaly_detection_mode == "alerting"
}

countermeasures contains _anomalous_call_pattern_detection_def if {
    count(anomalous_call_pattern_detection) > 0
}
