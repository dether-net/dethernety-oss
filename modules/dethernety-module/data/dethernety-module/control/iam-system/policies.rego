package _dt_built_in.countermeasures.iam_system



_centralized_policy_enforcement_coverage_def := {
    "name": "Centralized Policy Enforcement Coverage",
    "description": "Provides uniform application of access policies across all zones and services, eliminating policy gaps that arise from fragmented per-system configurations. Ensures consistent least-privilege enforcement regardless of resource location.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-APA",
            "name": "Access Policy Administration",
            "relevance": "Directly addresses centralized enforcement of access policies across an organization."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AMED",
            "name": "Access Mediation",
            "relevance": "Ensures all access requests are mediated through a central policy enforcement point."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1030",
            "name": "Network Segmentation",
            "relevance": "Supports centralized policy enforcement by segmenting network zones under unified control."
        }
    ]
}

centralized_policy_enforcement_coverage[_centralized_policy_enforcement_coverage_def] if {
    input.centralized_iam_provider_enabled == true
    input.policy_enforcement_scope == "all_zones"
    input.least_privilege_policy_enforced == true
    input.automated_lifecycle_management_enabled == true
}

centralized_policy_enforcement_coverage[_centralized_policy_enforcement_coverage_def] if {
    input.centralized_iam_provider_enabled == true
    input.policy_enforcement_scope == "all_zones"
    input.least_privilege_policy_enforced == true
}

countermeasures contains _centralized_policy_enforcement_coverage_def if {
    count(centralized_policy_enforcement_coverage) > 0
}

_multi_factor_authentication_integration_def := {
    "name": "Multi Factor Authentication Integration",
    "description": "Delivers MFA enforcement as a preventive layer for all user and privileged service authentications. Provides configurable step-up authentication for sensitive operations, reducing credential-only compromise risk.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MFA",
            "name": "Multi-factor Authentication",
            "relevance": "Directly maps to the integration of MFA as an authentication security control."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "name": "Multi-factor Authentication",
            "relevance": "The primary ATT&CK mitigation for requiring MFA across authentication events."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Complements MFA integration by monitoring and thresholding authentication attempts."
        }
    ]
}

multi_factor_authentication_integration[_multi_factor_authentication_integration_def] if {
    input.mfa_enforcement_scope == "none"
}

multi_factor_authentication_integration[_multi_factor_authentication_integration_def] if {
    input.mfa_enforcement_scope == "privileged_only"
    input.step_up_authentication_enabled == false
}

multi_factor_authentication_integration[_multi_factor_authentication_integration_def] if {
    input.mfa_enforcement_scope in ["all_users", "privileged_only"]
    count(input.mfa_bypass_mechanisms) > 0
}

countermeasures contains _multi_factor_authentication_integration_def if {
    count(multi_factor_authentication_integration) > 0
}

_role_based_access_control_granularity_def := {
    "name": "Role Based Access Control Granularity",
    "description": "Provides fine-grained RBAC and ABAC policy models enabling precise permission scoping per user, group, and service identity. Reduces effective permission surface through attribute-driven and context-aware authorization decisions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3F-UGPH",
            "name": "User Group Permissions",
            "relevance": "Directly relates to defining granular role-based permissions for user groups."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AM",
            "name": "Access Modeling",
            "relevance": "Supports designing and validating granular RBAC models."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1018",
            "name": "User Account Management",
            "relevance": "Covers managing user accounts with appropriate role-based access restrictions."
        }
    ]
}

role_based_access_control_granularity[_role_based_access_control_granularity_def] if {
    input.rbac_policy_model_enabled == true
    input.least_privilege_scope == "fine_grained"
    input.service_identity_rbac_coverage == true
}

role_based_access_control_granularity[_role_based_access_control_granularity_def] if {
    input.rbac_policy_model_enabled == true
    input.least_privilege_scope == "moderate"
    input.service_identity_rbac_coverage == true
}

countermeasures contains _role_based_access_control_granularity_def if {
    count(role_based_access_control_granularity) > 0
}

_service_account_lifecycle_management_def := {
    "name": "Service Account Lifecycle Management",
    "description": "Automates provisioning, rotation, and deprovisioning of service account credentials and API keys. Provides detection of dormant or over-privileged service identities and enforces credential expiry policies.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CRO",
            "name": "Credential Rotation",
            "relevance": "Directly addresses rotating credentials for service accounts throughout their lifecycle."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CE",
            "name": "Credential Eviction",
            "relevance": "Supports removing or revoking service account credentials when accounts are decommissioned."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Service accounts often hold privileged access and require lifecycle governance to reduce risk."
        }
    ]
}

service_account_lifecycle_management[_service_account_lifecycle_management_def] if {
    input.credential_rotation_policy_enabled == false
}

service_account_lifecycle_management[_service_account_lifecycle_management_def] if {
    input.credential_rotation_policy_enabled == true
    input.max_credential_age_days > 365
}

service_account_lifecycle_management[_service_account_lifecycle_management_def] if {
    input.credential_rotation_policy_enabled == true
    not input.max_credential_age_days
}

service_account_lifecycle_management[_service_account_lifecycle_management_def] if {
    input.dormant_account_detection_enabled == false
}

countermeasures contains _service_account_lifecycle_management_def if {
    count(service_account_lifecycle_management) > 0
}

_authentication_event_logging_completeness_def := {
    "name": "Authentication Event Logging Completeness",
    "description": "Generates comprehensive audit logs for all authentication attempts, authorization decisions, policy changes, and session activities across zones. Provides tamper-evident log streams suitable for SIEM integration and forensic reconstruction.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Requires comprehensive authentication event logging to detect and threshold anomalies."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly addresses ensuring completeness of audit and logging for authentication events."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Complements authentication logging by capturing and analyzing authorization events."
        }
    ]
}

authentication_event_logging_completeness[_authentication_event_logging_completeness_def] if {
    input.authentication_logging_enabled == true
    input.log_coverage_scope == "full"
    input.tamper_evident_storage_configured == true
}

countermeasures contains _authentication_event_logging_completeness_def if {
    count(authentication_event_logging_completeness) > 0
}

_anomalous_access_pattern_detection_def := {
    "name": "Anomalous Access Pattern Detection",
    "description": "Delivers behavioral analytics on access patterns to identify deviations such as impossible travel, unusual access times, or abnormal resource enumeration. Produces risk scores that trigger automated response workflows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UBA",
            "name": "User Behavior Analysis",
            "relevance": "Directly identifies anomalous access patterns through behavioral analytics."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RAPA",
            "name": "Resource Access Pattern Analysis",
            "relevance": "Analyzes resource access patterns to detect deviations indicative of anomalous activity."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-JFAPA",
            "name": "Job Function Access Pattern Analysis",
            "relevance": "Detects when access patterns deviate from expected job function baselines."
        }
    ]
}

anomalous_access_pattern_detection[_anomalous_access_pattern_detection_def] if {
    input.behavioral_analytics_enabled == true
    input.risk_score_triggers_automated_response == true
    count(input.detection_signals_configured) >= 2
}

countermeasures contains _anomalous_access_pattern_detection_def if {
    count(anomalous_access_pattern_detection) > 0
}

_cross_zone_federated_identity_integration_def := {
    "name": "Cross Zone Federated Identity Integration",
    "description": "Provides federated authentication bridges across trust zones via SAML, OIDC, or SCIM, enabling consistent identity resolution without credential duplication. Reduces shadow identity proliferation across segmented environments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-TBA",
            "name": "Token-based Authentication",
            "relevance": "Token-based authentication is fundamental to federated identity across security zones."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CTS",
            "name": "Credential Transmission Scoping",
            "relevance": "Scopes credential transmission to prevent credential leakage across federated zones."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1026",
            "name": "Privileged Account Management",
            "relevance": "Managing privileged accounts is critical when federating identities across trust zones."
        }
    ]
}

cross_zone_federated_identity_integration[_cross_zone_federated_identity_integration_def] if {
    not input.federated_protocol_configured in ["none"]
    input.cross_zone_sso_enabled == true
    input.zones_without_federation_count == 0
    input.identity_lifecycle_automation in ["full", "partial"]
}

cross_zone_federated_identity_integration[_cross_zone_federated_identity_integration_def] if {
    input.federated_protocol_configured in ["saml", "oidc", "scim", "multiple"]
    input.cross_zone_sso_enabled == true
    input.identity_lifecycle_automation == "full"
    input.zones_without_federation_count == 0
}

countermeasures contains _cross_zone_federated_identity_integration_def if {
    count(cross_zone_federated_identity_integration) > 0
}

_automated_access_review_and_recertification_def := {
    "name": "Automated Access Review And Recertification",
    "description": "Provides scheduled and event-triggered access certification workflows that automatically flag and revoke stale or excessive permissions. Reduces permission accumulation drift and supports compliance reporting automation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CS",
            "name": "Credential Scrubbing",
            "relevance": "Automated scrubbing of stale or unauthorized credentials aligns with access recertification workflows."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CR",
            "name": "Credential Revocation",
            "relevance": "Automated revocation of credentials is a core outcome of access review and recertification processes."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Regular auditing underpins automated access review processes to ensure compliance."
        }
    ]
}

automated_access_review_and_recertification[_automated_access_review_and_recertification_def] if {
    input.access_review_enabled == true
    input.review_schedule_frequency_days <= 180
    input.auto_revocation_on_no_response == true
}

automated_access_review_and_recertification[_automated_access_review_and_recertification_def] if {
    input.access_review_enabled == true
    input.review_schedule_frequency_days <= 90
    input.event_triggered_review_enabled == true
}

countermeasures contains _automated_access_review_and_recertification_def if {
    count(automated_access_review_and_recertification) > 0
}
