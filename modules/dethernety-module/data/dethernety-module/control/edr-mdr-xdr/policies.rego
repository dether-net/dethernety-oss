package _dt_built_in.countermeasures.edr_mdr_xdr



_behavioral_anomaly_detection_accuracy_def := {
    "name": "Behavioral Anomaly Detection Accuracy",
    "description": "Provides statistical baseline modeling and deviation scoring to identify abnormal user, process, and network behaviors that signature-based tools miss. Accuracy is measurable by false positive rate and detection precision metrics.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

behavioral_anomaly_detection_accuracy[_behavioral_anomaly_detection_accuracy_def] if {
    input.behavioral_baseline_modeling_enabled == true
    input.false_positive_rate_percent <= 10
    count(input.monitored_entity_scopes) >= 3
}

behavioral_anomaly_detection_accuracy[_behavioral_anomaly_detection_accuracy_def] if {
    input.behavioral_baseline_modeling_enabled == true
    "user_accounts" in input.monitored_entity_scopes
    "network_flows" in input.monitored_entity_scopes
    input.false_positive_rate_percent <= 10
}

countermeasures contains _behavioral_anomaly_detection_accuracy_def if {
    count(behavioral_anomaly_detection_accuracy) > 0
}

_endpoint_telemetry_coverage_def := {
    "name": "Endpoint Telemetry Coverage",
    "description": "Delivers continuous process, file, registry, memory, and network activity collection from enrolled endpoints, ensuring forensic completeness for investigation and detection. Coverage measured by percentage of endpoints with active sensor deployment.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

endpoint_telemetry_coverage[_endpoint_telemetry_coverage_def] if {
    input.sensor_deployment_percentage >= 95
    "process" in input.telemetry_collection_channels
    "file" in input.telemetry_collection_channels
    "network" in input.telemetry_collection_channels
    input.sensor_health_status == "healthy"
}

endpoint_telemetry_coverage[_endpoint_telemetry_coverage_def] if {
    input.sensor_deployment_percentage >= 95
    count(input.telemetry_collection_channels) >= 5
    input.sensor_health_status == "healthy"
}

countermeasures contains _endpoint_telemetry_coverage_def if {
    count(endpoint_telemetry_coverage) > 0
}

_automated_threat_containment_def := {
    "name": "Automated Threat Containment",
    "description": "Provides policy-driven automated isolation, process termination, and network quarantine actions triggered on confirmed detections without requiring analyst intervention, reducing mean time to contain.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

automated_threat_containment[_automated_threat_containment_def] if {
    input.automated_response_enabled == true
    input.response_trigger_mode == "automatic"
    "network_quarantine" in input.response_action_types_configured
}

automated_threat_containment[_automated_threat_containment_def] if {
    input.automated_response_enabled == true
    input.response_trigger_mode == "automatic"
    "host_isolation" in input.response_action_types_configured
}

automated_threat_containment[_automated_threat_containment_def] if {
    input.automated_response_enabled == true
    input.response_trigger_mode == "automatic"
    "process_termination" in input.response_action_types_configured
}

countermeasures contains _automated_threat_containment_def if {
    count(automated_threat_containment) > 0
}

_threat_intelligence_integration_depth_def := {
    "name": "Threat Intelligence Integration Depth",
    "description": "Enables real-time enrichment of alerts with external and internal threat feeds, IOC matching, and contextual reputation scoring, improving detection relevance and reducing investigation time.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

threat_intelligence_integration_depth[_threat_intelligence_integration_depth_def] if {
    input.threat_feed_integration_enabled == true
    input.ioc_matching_scope == "full"
    input.reputation_scoring_active == true
}

threat_intelligence_integration_depth[_threat_intelligence_integration_depth_def] if {
    input.threat_feed_integration_enabled == true
    input.ioc_matching_scope == "partial"
    input.reputation_scoring_active == true
}

countermeasures contains _threat_intelligence_integration_depth_def if {
    count(threat_intelligence_integration_depth) > 0
}

_cross_source_log_correlation_def := {
    "name": "Cross Source Log Correlation",
    "description": "Aggregates and normalizes logs from endpoints, network devices, cloud services, and identity providers into a unified timeline, enabling multi-hop attack chain reconstruction and improving detection of low-and-slow campaigns.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

cross_source_log_correlation[_cross_source_log_correlation_def] if {
    input.log_normalization_enabled == true
    count(input.log_source_types_ingested) >= 3
    input.cross_source_correlation_rules_count >= 5
}

cross_source_log_correlation[_cross_source_log_correlation_def] if {
    input.log_normalization_enabled == true
    count(input.log_source_types_ingested) >= 2
    "identity_provider" in input.log_source_types_ingested
    "endpoint" in input.log_source_types_ingested
    input.cross_source_correlation_rules_count >= 1
}

countermeasures contains _cross_source_log_correlation_def if {
    count(cross_source_log_correlation) > 0
}

_alert_triage_automation_def := {
    "name": "Alert Triage Automation",
    "description": "Provides ML-driven alert scoring, deduplication, and case enrichment to reduce analyst alert fatigue and prioritize high-confidence incidents, measurable by mean time to triage and false positive closure rate.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

alert_triage_automation[_alert_triage_automation_def] if {
    input.ml_alert_scoring_enabled == true
    input.alert_deduplication_enabled == true
    count(input.case_enrichment_integrations) >= 1
    input.false_positive_auto_closure_enabled == true
}

alert_triage_automation[_alert_triage_automation_def] if {
    input.ml_alert_scoring_enabled == true
    input.alert_deduplication_enabled == true
    count(input.case_enrichment_integrations) >= 2
}

countermeasures contains _alert_triage_automation_def if {
    count(alert_triage_automation) > 0
}

_forensic_evidence_preservation_def := {
    "name": "Forensic Evidence Preservation",
    "description": "Captures and retains full process execution trees, memory snapshots, network packet captures, and file change history with tamper-evident logging to support incident reconstruction and legal hold requirements.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

forensic_evidence_preservation[_forensic_evidence_preservation_def] if {
    input.evidence_collection_enabled == true
    input.tamper_evident_logging_mode in ["signed", "immutable", "worm"]
    input.retention_days >= 90
    "process_execution_tree" in input.covered_evidence_types
    "memory_snapshot" in input.covered_evidence_types
    "network_packet_capture" in input.covered_evidence_types
    "file_change_history" in input.covered_evidence_types
}

countermeasures contains _forensic_evidence_preservation_def if {
    count(forensic_evidence_preservation) > 0
}

_detection_rule_tuning_maintainability_def := {
    "name": "Detection Rule Tuning Maintainability",
    "description": "Provides mechanisms for continuous detection content management including rule versioning, A/B testing of detection logic, and feedback loops from closed incidents to reduce rule decay and maintain detection effectiveness over time.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

detection_rule_tuning_maintainability[_detection_rule_tuning_maintainability_def] if {
    input.rule_versioning_enabled == true
    input.feedback_loop_mechanism in ["automated", "manual_documented"]
    input.rule_review_frequency_days <= 90
}

detection_rule_tuning_maintainability[_detection_rule_tuning_maintainability_def] if {
    input.rule_versioning_enabled == true
    input.feedback_loop_mechanism == "automated"
}

countermeasures contains _detection_rule_tuning_maintainability_def if {
    count(detection_rule_tuning_maintainability) > 0
}

_cloud_workload_visibility_def := {
    "name": "Cloud Workload Visibility",
    "description": "Extends telemetry collection and detection coverage to cloud-native workloads, serverless functions, and container environments, ensuring consistent detection parity between on-premises and cloud infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

cloud_workload_visibility[_cloud_workload_visibility_def] if {
    input.cloud_workload_agent_deployed == true
    input.container_runtime_monitoring_enabled == true
    input.detection_coverage_scope == "full"
}

countermeasures contains _cloud_workload_visibility_def if {
    count(cloud_workload_visibility) > 0
}

_siem_soar_integration_coverage_def := {
    "name": "Siem Soar Integration Coverage",
    "description": "Delivers bidirectional API integrations with SIEM, SOAR, ITSM, and identity platforms enabling coordinated response playbooks, ticket automation, and enrichment workflows across the security toolchain.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

siem_soar_integration_coverage[_siem_soar_integration_coverage_def] if {
    input.bidirectional_api_integrations_enabled == true
    count(input.integrated_platform_types) >= 2
    input.automated_playbook_or_ticket_workflow_active == true
}

siem_soar_integration_coverage[_siem_soar_integration_coverage_def] if {
    input.bidirectional_api_integrations_enabled == true
    "SIEM" in input.integrated_platform_types
    "SOAR" in input.integrated_platform_types
    input.automated_playbook_or_ticket_workflow_active == true
}

countermeasures contains _siem_soar_integration_coverage_def if {
    count(siem_soar_integration_coverage) > 0
}
