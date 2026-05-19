package _dt_built_in.countermeasures.vpn_access_policy

_cipher_suite_enforcement_def := {
    "name": "Cipher Suite Enforcement",
    "description": "Provides cryptographic strength assurance by mandating approved cipher suites and disabling deprecated algorithms, ensuring all remote sessions use vetted encryption standards.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ET",
            "name": "Encrypted Tunnels",
            "relevance": "Encrypted tunnels directly enforce the use of strong cipher suites for protecting data in transit."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1041",
            "name": "Encrypt Sensitive Information",
            "relevance": "Enforcing cipher suites is a core mechanism for encrypting sensitive information and ensuring strong cryptographic standards."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection directly relates to enforcing and verifying cipher suite configurations in encrypted communications."
        }
    ]
}

cipher_suite_enforcement[_cipher_suite_enforcement_def] if {
    input.approved_cipher_suites_enforced == true
    input.deprecated_algorithms_disabled == true
    input.minimum_tls_version in ["tls_1_2", "tls_1_3"]
}

countermeasures contains _cipher_suite_enforcement_def if {
    count(cipher_suite_enforcement) > 0
}

_protocol_version_restriction_def := {
    "name": "Protocol Version Restriction",
    "description": "Enforces minimum acceptable protocol versions (e.g., TLS 1.2+, SSHv2) by explicitly disabling insecure or legacy protocol variants, reducing the exploitable protocol surface.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Restricting protocol versions is a configuration hardening activity applied at the application level."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1042",
            "name": "Disable or Remove Feature or Program",
            "relevance": "Disabling deprecated or insecure protocol versions is a direct application of removing vulnerable features."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection enables enforcement of acceptable protocol versions and detection of downgrade attempts."
        }
    ]
}

protocol_version_restriction[_protocol_version_restriction_def] if {
    input.minimum_tls_version in ["tls_1_2", "tls_1_3"]
    input.legacy_protocols_disabled == true
}

protocol_version_restriction[_protocol_version_restriction_def] if {
    input.ssh_protocol_version == "ssh_v2_only"
    input.legacy_protocols_disabled == true
}

countermeasures contains _protocol_version_restriction_def if {
    count(protocol_version_restriction) > 0
}

_multi_factor_authentication_requirement_def := {
    "name": "Multi Factor Authentication Requirement",
    "description": "Mandates multi-factor authentication for all remote sessions, ensuring identity claims cannot be satisfied by credential knowledge alone and reducing unauthorized access risk.",
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
            "relevance": "Directly implements the multi-factor authentication requirement for user and system access."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1032",
            "name": "Multi-factor Authentication",
            "relevance": "This mitigation directly mandates MFA to prevent unauthorized access from compromised credentials."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CH",
            "name": "Credential Hardening",
            "relevance": "Credential hardening encompasses MFA as a key control to strengthen authentication mechanisms."
        }
    ]
}

multi_factor_authentication_requirement[_multi_factor_authentication_requirement_def] if {
    input.mfa_enabled == false
}

multi_factor_authentication_requirement[_multi_factor_authentication_requirement_def] if {
    input.mfa_enabled == true
    not input.mfa_enforcement_scope in ["all_users"]
}

multi_factor_authentication_requirement[_multi_factor_authentication_requirement_def] if {
    input.mfa_enabled == true
    input.mfa_enforcement_scope == "all_users"
    input.mfa_bypass_methods_present == true
}

countermeasures contains _multi_factor_authentication_requirement_def if {
    count(multi_factor_authentication_requirement) > 0
}

_access_rule_precision_def := {
    "name": "Access Rule Precision",
    "description": "Provides granular access control through defined rules specifying which users, roles, devices, and source networks are permitted to establish remote connections, limiting lateral reachability.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Precise access rules are implemented through network traffic filtering to allow or deny specific traffic flows."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Inbound traffic filtering enforces granular access rules controlling what traffic can reach protected resources."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Limiting access to resources over the network is the direct goal of precise access rule configuration."
        }
    ]
}

access_rule_precision[_access_rule_precision_def] if {
    input.access_rules_defined == true
    input.rule_specificity_level == "granular"
    input.default_deny_configured == true
    input.source_network_restrictions_applied == true
}

access_rule_precision[_access_rule_precision_def] if {
    input.access_rules_defined == true
    input.rule_specificity_level == "role_based"
    input.default_deny_configured == true
    input.source_network_restrictions_applied == true
}

countermeasures contains _access_rule_precision_def if {
    count(access_rule_precision) > 0
}

_session_timeout_and_idle_control_def := {
    "name": "Session Timeout And Idle Control",
    "description": "Enforces automatic session termination after defined idle or maximum duration thresholds, preventing persistent unauthorized session hijacking or abandoned session exploitation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ST",
            "name": "Session Termination",
            "relevance": "Session termination directly implements timeout and idle session control by ending inactive sessions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-WSAM",
            "name": "Web Session Access Mediation",
            "relevance": "Web session access mediation enforces session lifecycle policies including timeouts and idle controls."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1036",
            "name": "Account Use Policies",
            "relevance": "Account use policies include session timeout and idle lockout controls as part of account management."
        }
    ]
}

session_timeout_and_idle_control[_session_timeout_and_idle_control_def] if {
    input.idle_timeout_enabled == false
}

session_timeout_and_idle_control[_session_timeout_and_idle_control_def] if {
    input.idle_timeout_enabled == true
    input.idle_timeout_seconds > 1800
}

session_timeout_and_idle_control[_session_timeout_and_idle_control_def] if {
    input.max_session_duration_seconds == 0
}

countermeasures contains _session_timeout_and_idle_control_def if {
    count(session_timeout_and_idle_control) > 0
}

_certificate_and_key_management_coverage_def := {
    "name": "Certificate And Key Management Coverage",
    "description": "Defines requirements for certificate validity, key length, rotation schedules, and revocation checking, ensuring cryptographic material supporting remote sessions remains trustworthy over time.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CBAN",
            "name": "Certificate-based Authentication",
            "relevance": "Certificate-based authentication is central to certificate and key management coverage for secure identity verification."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CP",
            "name": "Certificate Pinning",
            "relevance": "Certificate pinning ensures that only trusted certificates are accepted, directly addressing key management integrity."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CERO",
            "name": "Certificate Rotation",
            "relevance": "Certificate rotation is a key management practice that ensures certificates are regularly updated to maintain security coverage."
        }
    ]
}

certificate_and_key_management_coverage[_certificate_and_key_management_coverage_def] if {
    input.minimum_key_length_bits >= 2048
    input.certificate_revocation_checking_enabled == true
    input.key_rotation_period_days <= 365
    input.certificate_validity_enforcement == "enforced"
}

countermeasures contains _certificate_and_key_management_coverage_def if {
    count(certificate_and_key_management_coverage) > 0
}

_remote_session_logging_completeness_def := {
    "name": "Remote Session Logging Completeness",
    "description": "Mandates comprehensive logging of remote session events including authentication attempts, session establishment, duration, and termination, enabling forensic reconstruction and compliance validation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RTSD",
            "name": "Remote Terminal Session Detection",
            "relevance": "Remote terminal session detection directly supports logging completeness by identifying and recording remote sessions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-WSAA",
            "name": "Web Session Activity Analysis",
            "relevance": "Analyzing web session activity contributes to complete logging of remote session events and behaviors."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing ensures comprehensive logging of remote session activities to support accountability and forensic review."
        }
    ]
}

remote_session_logging_completeness[_remote_session_logging_completeness_def] if {
    input.session_logging_enabled == true
    "authentication_attempt" in input.logged_event_types
    "session_established" in input.logged_event_types
    "session_terminated" in input.logged_event_types
    input.log_retention_days >= 90
}

countermeasures contains _remote_session_logging_completeness_def if {
    count(remote_session_logging_completeness) > 0
}

_policy_consistency_and_maintainability_def := {
    "name": "Policy Consistency And Maintainability",
    "description": "Provides operational benefit through formally documented and version-controlled remote access rules, enabling consistent application across endpoints, reducing misconfiguration drift, and supporting audit readiness.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Consistent software configuration management is fundamental to maintaining coherent and maintainable security policies."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Regular auditing validates that policies remain consistent and are correctly implemented across the environment."
        }
    ]
}

policy_consistency_and_maintainability[_policy_consistency_and_maintainability_def] if {
    input.remote_access_policy_documented == true
    input.policy_version_controlled == true
    input.policy_review_frequency_months <= 12
}

countermeasures contains _policy_consistency_and_maintainability_def if {
    count(policy_consistency_and_maintainability) > 0
}
