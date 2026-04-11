package _dt_built_in.countermeasures.endpoint_security_software

_real_time_malware_detection_accuracy_def := {
    "name": "Real Time Malware Detection Accuracy",
    "description": "Provides continuous on-access scanning with signature, heuristic, and behavioral detection engines, determining the percentage of malicious files and processes correctly identified before execution.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

real_time_malware_detection_accuracy[_real_time_malware_detection_accuracy_def] if {
    input.realtime_scanning_enabled == false
}

real_time_malware_detection_accuracy[_real_time_malware_detection_accuracy_def] if {
    input.realtime_scanning_enabled == true
    not "heuristic" in input.detection_engines_active
    not "behavioral" in input.detection_engines_active
}

real_time_malware_detection_accuracy[_real_time_malware_detection_accuracy_def] if {
    input.realtime_scanning_enabled == true
    input.signature_definition_age_days > 3
}

real_time_malware_detection_accuracy[_real_time_malware_detection_accuracy_def] if {
    input.realtime_scanning_enabled == true
    input.policy_tamper_protection_enabled == false
}

countermeasures contains _real_time_malware_detection_accuracy_def if {
    count(real_time_malware_detection_accuracy) > 0
}

_configuration_baseline_enforcement_def := {
    "name": "Configuration Baseline Enforcement",
    "description": "Delivers automated enforcement of secure configuration baselines (CIS, STIG, or custom policies), preventing unauthorized setting changes and drift from hardened states.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

configuration_baseline_enforcement[_configuration_baseline_enforcement_def] if {
    not input.baseline_framework in ["none"]
    input.enforcement_mode == "enforce"
    input.compliance_percentage >= 90
    input.drift_detection_enabled == true
}

configuration_baseline_enforcement[_configuration_baseline_enforcement_def] if {
    not input.baseline_framework in ["none"]
    input.enforcement_mode == "enforce"
    input.compliance_percentage >= 95
}

countermeasures contains _configuration_baseline_enforcement_def if {
    count(configuration_baseline_enforcement) > 0
}

_behavioral_execution_prevention_def := {
    "name": "Behavioral Execution Prevention",
    "description": "Provides pre-execution and runtime behavioral analysis to block suspicious process behavior such as code injection, privilege escalation attempts, and fileless execution patterns.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

behavioral_execution_prevention[_behavioral_execution_prevention_def] if {
    input.behavioral_protection_enabled == false
}

behavioral_execution_prevention[_behavioral_execution_prevention_def] if {
    input.behavioral_protection_enabled == true
    not input.prevention_mode in ["prevent"]
}

behavioral_execution_prevention[_behavioral_execution_prevention_def] if {
    input.behavioral_protection_enabled == true
    input.prevention_mode == "prevent"
    not "code_injection_prevention" in input.protection_capabilities
}

behavioral_execution_prevention[_behavioral_execution_prevention_def] if {
    input.behavioral_protection_enabled == true
    input.prevention_mode == "prevent"
    not "fileless_execution_detection" in input.protection_capabilities
}

countermeasures contains _behavioral_execution_prevention_def if {
    count(behavioral_execution_prevention) > 0
}

_automated_threat_response_coverage_def := {
    "name": "Automated Threat Response Coverage",
    "description": "Delivers automated containment actions including process termination, file quarantine, and network isolation upon threat detection, reducing mean time to contain without requiring manual intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

automated_threat_response_coverage[_automated_threat_response_coverage_def] if {
    input.automated_response_enabled == true
    input.prevention_mode == "enforce"
    count(input.response_actions_configured) >= 2
}

countermeasures contains _automated_threat_response_coverage_def if {
    count(automated_threat_response_coverage) > 0
}

_application_control_whitelist_enforcement_def := {
    "name": "Application Control Whitelist Enforcement",
    "description": "Provides allow-list or deny-list enforcement restricting which executables, scripts, and libraries may run, preventing unauthorized software execution on the workstation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

application_control_whitelist_enforcement[_application_control_whitelist_enforcement_def] if {
    input.allowlist_enforcement_enabled == true
    input.enforcement_scope == "full"
    input.policy_applies_to_standard_users == true
}

application_control_whitelist_enforcement[_application_control_whitelist_enforcement_def] if {
    input.allowlist_enforcement_enabled == true
    input.enforcement_scope == "partial"
    input.policy_applies_to_standard_users == true
}

countermeasures contains _application_control_whitelist_enforcement_def if {
    count(application_control_whitelist_enforcement) > 0
}

_telemetry_and_logging_completeness_def := {
    "name": "Telemetry And Logging Completeness",
    "description": "Generates comprehensive endpoint telemetry including process creation, file operations, registry changes, and network connections, providing audit trails for forensic investigation and SIEM integration.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

telemetry_and_logging_completeness[_telemetry_and_logging_completeness_def] if {
    input.telemetry_logging_enabled == true
    "process_creation" in input.telemetry_event_types_covered
    "file_operations" in input.telemetry_event_types_covered
    "network_connections" in input.telemetry_event_types_covered
    input.siem_integration_status == "active"
}

telemetry_and_logging_completeness[_telemetry_and_logging_completeness_def] if {
    input.telemetry_logging_enabled == true
    "process_creation" in input.telemetry_event_types_covered
    "file_operations" in input.telemetry_event_types_covered
    "registry_changes" in input.telemetry_event_types_covered
    "network_connections" in input.telemetry_event_types_covered
    input.siem_integration_status == "configured_not_verified"
}

countermeasures contains _telemetry_and_logging_completeness_def if {
    count(telemetry_and_logging_completeness) > 0
}

_siem_and_edr_integration_depth_def := {
    "name": "Siem And Edr Integration Depth",
    "description": "Provides structured event forwarding, API connectivity, and alert enrichment to centralized SIEM and EDR platforms, enabling correlated detection across the enterprise endpoint fleet.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

siem_and_edr_integration_depth[_siem_and_edr_integration_depth_def] if {
    input.siem_integration_status == true
    input.edr_api_integration_status == "active"
    input.alert_enrichment_configured == true
}

siem_and_edr_integration_depth[_siem_and_edr_integration_depth_def] if {
    input.siem_integration_status == true
    input.edr_api_integration_status == "active"
}

countermeasures contains _siem_and_edr_integration_depth_def if {
    count(siem_and_edr_integration_depth) > 0
}

_signature_update_and_definition_currency_def := {
    "name": "Signature Update And Definition Currency",
    "description": "Delivers timely threat intelligence updates to detection engines, with measurable update frequency and lag time between threat publication and workstation policy application.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

signature_update_and_definition_currency[_signature_update_and_definition_currency_def] if {
    input.signature_update_enabled == true
    input.signature_age_hours <= 24
    input.update_source_reachable == true
}

countermeasures contains _signature_update_and_definition_currency_def if {
    count(signature_update_and_definition_currency) > 0
}

_operational_policy_maintainability_def := {
    "name": "Operational Policy Maintainability",
    "description": "Provides centralized management console capabilities for policy deployment, exception handling, and agent health monitoring, reducing administrative overhead and configuration inconsistency across workstation fleet.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

operational_policy_maintainability[_operational_policy_maintainability_def] if {
    input.centralized_console_enabled == true
    input.policy_deployment_status == "fully_deployed"
    input.unhealthy_agent_percentage <= 5
}

countermeasures contains _operational_policy_maintainability_def if {
    count(operational_policy_maintainability) > 0
}
