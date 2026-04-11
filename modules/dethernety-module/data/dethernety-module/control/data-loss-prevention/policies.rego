package _dt_built_in.countermeasures.data_loss_prevention



_content_inspection_accuracy_def := {
    "name": "Content Inspection Accuracy",
    "description": "Provides precise identification of sensitive data through pattern matching, fingerprinting, machine learning classifiers, and exact data matching, reducing false positives and false negatives in data classification decisions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

content_inspection_accuracy[_content_inspection_accuracy_def] if {
    count(input.classification_engines_enabled) >= 2
    input.false_positive_rate_percent <= 10
    input.last_classifier_tuning_days <= 90
}

content_inspection_accuracy[_content_inspection_accuracy_def] if {
    "ml_classifier" in input.classification_engines_enabled
    input.custom_pattern_definitions_count >= 5
    input.false_positive_rate_percent <= 15
}

content_inspection_accuracy[_content_inspection_accuracy_def] if {
    "exact_data_match" in input.classification_engines_enabled
    input.last_classifier_tuning_days <= 90
    input.false_positive_rate_percent <= 15
}

countermeasures contains _content_inspection_accuracy_def if {
    count(content_inspection_accuracy) > 0
}

_network_channel_prevention_coverage_def := {
    "name": "Network Channel Prevention Coverage",
    "description": "Delivers inline blocking capability across HTTP/S, SMTP, FTP, and cloud upload channels, intercepting sensitive data transmissions before they leave the perimeter when SSL/TLS inspection is active.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

network_channel_prevention_coverage[_network_channel_prevention_coverage_def] if {
    input.blocking_mode_enabled == true
    input.ssl_tls_inspection_active == true
    "HTTPS" in input.monitored_channels
    "SMTP" in input.monitored_channels
    "FTP" in input.monitored_channels
}

countermeasures contains _network_channel_prevention_coverage_def if {
    count(network_channel_prevention_coverage) > 0
}

_endpoint_data_movement_control_def := {
    "name": "Endpoint Data Movement Control",
    "description": "Provides enforcement at the endpoint level, controlling copy-paste operations, USB/removable media transfers, print-to-file actions, and local application data handling independent of network path.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

endpoint_data_movement_control[_endpoint_data_movement_control_def] if {
    input.endpoint_dlp_agent_deployed == true
    input.policy_enforcement_mode in ["block", "monitor_and_alert"]
    input.sensitive_data_patterns_configured == true
    count(input.enforced_control_channels) >= 2
}

countermeasures contains _endpoint_data_movement_control_def if {
    count(endpoint_data_movement_control) > 0
}

_cloud_and_saas_visibility_def := {
    "name": "Cloud And Saas Visibility",
    "description": "Extends detection and blocking coverage to sanctioned and unsanctioned cloud services via API integration and CASB coupling, providing policy enforcement for cloud storage uploads and collaboration platform sharing.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

cloud_and_saas_visibility[_cloud_and_saas_visibility_def] if {
    input.casb_integration_enabled == true
    input.cloud_upload_blocking_policy_status == "enforce_block"
    count(input.monitored_cloud_services) > 0
}

countermeasures contains _cloud_and_saas_visibility_def if {
    count(cloud_and_saas_visibility) > 0
}

_incident_response_automation_def := {
    "name": "Incident Response Automation",
    "description": "Automates response actions such as quarantine, block, alert, user notification, and SIEM forwarding upon policy violation detection, reducing mean time to containment without requiring manual analyst intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

incident_response_automation[_incident_response_automation_def] if {
    input.automated_response_actions_enabled == true
    input.policies_in_enforcement_mode >= 1
    count(input.configured_response_actions) >= 2
}

incident_response_automation[_incident_response_automation_def] if {
    input.automated_response_actions_enabled == true
    input.siem_forwarding_configured == true
    input.policies_in_enforcement_mode >= 1
    "block" in input.configured_response_actions
}

countermeasures contains _incident_response_automation_def if {
    count(incident_response_automation) > 0
}

_audit_logging_completeness_def := {
    "name": "Audit Logging Completeness",
    "description": "Generates detailed, tamper-evident event logs capturing sender, recipient, data classification, action taken, timestamp, and content snippet, enabling forensic reconstruction of data handling incidents and regulatory compliance evidence.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

audit_logging_completeness[_audit_logging_completeness_def] if {
    input.audit_logging_enabled == true
    "sender" in input.logged_fields
    "recipient" in input.logged_fields
    "data_classification" in input.logged_fields
    "action_taken" in input.logged_fields
    "timestamp" in input.logged_fields
    "content_snippet" in input.logged_fields
    not input.tamper_protection_mechanism in ["none"]
}

countermeasures contains _audit_logging_completeness_def if {
    count(audit_logging_completeness) > 0
}

_policy_management_and_tuning_maintainability_def := {
    "name": "Policy Management And Tuning Maintainability",
    "description": "Provides structured policy lifecycle management including rule versioning, workflow-based approval, false-positive feedback loops, and staged rollout modes (monitor before enforce), enabling operational sustainability at scale.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

policy_management_and_tuning_maintainability[_policy_management_and_tuning_maintainability_def] if {
    input.rule_versioning_enabled == true
    input.policy_approval_workflow_status == "enabled"
    input.staged_rollout_mode == "monitor_then_enforce"
    input.false_positive_feedback_loop_configured == true
}

policy_management_and_tuning_maintainability[_policy_management_and_tuning_maintainability_def] if {
    input.rule_versioning_enabled == true
    input.policy_approval_workflow_status == "enabled"
    input.false_positive_feedback_loop_configured == true
    input.staged_rollout_mode in ["monitor_then_enforce", "enforce_only"]
}

countermeasures contains _policy_management_and_tuning_maintainability_def if {
    count(policy_management_and_tuning_maintainability) > 0
}

_data_classification_integration_depth_def := {
    "name": "Data Classification Integration Depth",
    "description": "Integrates with enterprise data classification frameworks and identity-aware context (user role, device posture, data sensitivity label) to apply graduated policy enforcement rather than binary block/allow decisions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

data_classification_integration_depth[_data_classification_integration_depth_def] if {
    input.classification_framework_integration_status == "fully_integrated"
    input.identity_context_enforcement_enabled == true
    input.graduated_policy_action_count >= 3
}

data_classification_integration_depth[_data_classification_integration_depth_def] if {
    input.classification_framework_integration_status == "partially_integrated"
    input.identity_context_enforcement_enabled == true
    input.graduated_policy_action_count >= 3
}

countermeasures contains _data_classification_integration_depth_def if {
    count(data_classification_integration_depth) > 0
}

_encrypted_traffic_inspection_capability_def := {
    "name": "Encrypted Traffic Inspection Capability",
    "description": "Provides SSL/TLS interception and decryption capability within DLP inspection pipeline, ensuring sensitive data carried over encrypted channels is subject to the same policy enforcement as plaintext traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

encrypted_traffic_inspection_capability[_encrypted_traffic_inspection_capability_def] if {
    input.ssl_tls_inspection_active == true
    input.inspection_scope == "full"
    input.certificate_trust_chain_valid == true
    input.dlp_policy_applied_to_decrypted_traffic == true
}

encrypted_traffic_inspection_capability[_encrypted_traffic_inspection_capability_def] if {
    input.ssl_tls_inspection_active == true
    input.inspection_scope == "partial"
    input.certificate_trust_chain_valid == true
    input.dlp_policy_applied_to_decrypted_traffic == true
}

countermeasures contains _encrypted_traffic_inspection_capability_def if {
    count(encrypted_traffic_inspection_capability) > 0
}
