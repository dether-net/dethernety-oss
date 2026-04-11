package _dt_built_in.countermeasures.ids



_signature_based_detection_coverage_def := {
    "name": "Signature Based Detection Coverage",
    "description": "Provides matching of known threat signatures against traffic payloads, headers, and protocol fields \u2014 coverage determined by signature library currency and breadth of protocol support.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

signature_based_detection_coverage[_signature_based_detection_coverage_def] if {
    input.signature_engine_enabled == true
    input.signature_library_age_days <= 7
    count(input.covered_protocol_categories) >= 3
    input.signature_action_mode in ["block", "alert"]
}

signature_based_detection_coverage[_signature_based_detection_coverage_def] if {
    input.signature_engine_enabled == true
    input.signature_library_age_days <= 30
    count(input.covered_protocol_categories) >= 5
    input.signature_action_mode == "block"
}

countermeasures contains _signature_based_detection_coverage_def if {
    count(signature_based_detection_coverage) > 0
}

_behavioral_anomaly_detection_accuracy_def := {
    "name": "Behavioral Anomaly Detection Accuracy",
    "description": "Delivers statistical and machine-learning-based identification of deviations from baseline traffic patterns, enabling detection of novel threats without prior signatures \u2014 accuracy depends on baseline quality and model training.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

behavioral_anomaly_detection_accuracy[_behavioral_anomaly_detection_accuracy_def] if {
    input.baseline_established == true
    input.model_training_status == "trained_active"
    input.baseline_observation_days >= 7
    input.anomaly_detection_sensitivity in ["low", "medium", "high"]
}

countermeasures contains _behavioral_anomaly_detection_accuracy_def if {
    count(behavioral_anomaly_detection_accuracy) > 0
}

_deep_packet_inspection_depth_def := {
    "name": "Deep Packet Inspection Depth",
    "description": "Provides payload-level inspection beyond header analysis, enabling content-aware detection including protocol anomalies, encoded payloads, and application-layer threats \u2014 coverage depends on encryption handling capability.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

deep_packet_inspection_depth[_deep_packet_inspection_depth_def] if {
    input.dpi_enabled == true
    count(input.inspection_layers) >= 3
    input.encrypted_traffic_inspection_mode in ["full_decryption", "metadata_fingerprinting"]
}

deep_packet_inspection_depth[_deep_packet_inspection_depth_def] if {
    input.dpi_enabled == true
    input.encrypted_traffic_inspection_mode == "full_decryption"
    count(input.inspection_layers) >= 1
}

countermeasures contains _deep_packet_inspection_depth_def if {
    count(deep_packet_inspection_depth) > 0
}

_encrypted_traffic_analysis_capability_def := {
    "name": "Encrypted Traffic Analysis Capability",
    "description": "Delivers detection within TLS/SSL and other encrypted flows through metadata analysis, certificate inspection, JA3 fingerprinting, or SSL/TLS interception \u2014 presence determines monitoring continuity across encrypted channels.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

encrypted_traffic_analysis_capability[_encrypted_traffic_analysis_capability_def] if {
    input.encrypted_traffic_inspection_mode in ["tls_interception", "ja3_fingerprinting", "metadata_analysis", "certificate_inspection"]
    input.inspection_actively_enabled == true
    input.encrypted_traffic_coverage_percentage >= 50
}

countermeasures contains _encrypted_traffic_analysis_capability_def if {
    count(encrypted_traffic_analysis_capability) > 0
}

_automated_response_and_blocking_def := {
    "name": "Automated Response And Blocking",
    "description": "Provides inline prevention capability enabling automatic traffic blocking, session termination, or quarantine actions upon confirmed threat detection \u2014 inline vs. passive deployment mode determines prevention vs. detection-only posture.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

automated_response_and_blocking[_automated_response_and_blocking_def] if {
    input.deployment_mode == "inline"
    input.automated_blocking_enabled == true
    input.prevention_policy_status == "active"
}

automated_response_and_blocking[_automated_response_and_blocking_def] if {
    input.deployment_mode == "inline"
    "block" in input.response_actions_configured
    input.prevention_policy_status == "active"
}

automated_response_and_blocking[_automated_response_and_blocking_def] if {
    input.deployment_mode == "inline"
    "quarantine" in input.response_actions_configured
    input.automated_blocking_enabled == true
    input.prevention_policy_status == "active"
}

countermeasures contains _automated_response_and_blocking_def if {
    count(automated_response_and_blocking) > 0
}

_traffic_logging_and_retention_completeness_def := {
    "name": "Traffic Logging And Retention Completeness",
    "description": "Delivers comprehensive logging of flow records, session metadata, and alert events with configurable retention periods \u2014 completeness enables forensic investigation, compliance reporting, and retrospective threat hunting.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

traffic_logging_and_retention_completeness[_traffic_logging_and_retention_completeness_def] if {
    input.traffic_logging_enabled == true
    input.log_retention_days >= 90
    "flow_records" in input.logged_data_types
    "session_metadata" in input.logged_data_types
    "alert_events" in input.logged_data_types
}

countermeasures contains _traffic_logging_and_retention_completeness_def if {
    count(traffic_logging_and_retention_completeness) > 0
}

_siem_and_orchestration_integration_def := {
    "name": "Siem And Orchestration Integration",
    "description": "Provides structured alert and telemetry export to SIEM, SOAR, and threat intelligence platforms via standardized formats (CEF, LEEF, STIX/TAXII) \u2014 integration depth determines correlation quality and automated response fidelity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

siem_and_orchestration_integration[_siem_and_orchestration_integration_def] if {
    input.siem_export_enabled == true
    not input.export_format in ["none"]
    input.export_destination_count >= 1
    input.last_successful_export_hours_ago <= 24
}

countermeasures contains _siem_and_orchestration_integration_def if {
    count(siem_and_orchestration_integration) > 0
}

_lateral_movement_detection_coverage_def := {
    "name": "Lateral Movement Detection Coverage",
    "description": "Delivers visibility into east-west internal traffic segments enabling identification of anomalous internal scanning, credential relay, and protocol abuse \u2014 dependent on sensor placement across internal segments, not just perimeter.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

lateral_movement_detection_coverage[_lateral_movement_detection_coverage_def] if {
    input.internal_segment_sensor_coverage == "full"
    input.lateral_movement_signatures_enabled == true
    input.east_west_alert_response_integration in ["automated_response", "siem_integrated"]
}

lateral_movement_detection_coverage[_lateral_movement_detection_coverage_def] if {
    input.internal_segment_sensor_coverage == "partial"
    input.lateral_movement_signatures_enabled == true
    input.east_west_alert_response_integration == "automated_response"
}

countermeasures contains _lateral_movement_detection_coverage_def if {
    count(lateral_movement_detection_coverage) > 0
}

_false_positive_tuning_and_alert_fidelity_def := {
    "name": "False Positive Tuning And Alert Fidelity",
    "description": "Provides mechanisms for rule suppression, whitelist management, and threshold calibration to reduce alert noise \u2014 fidelity directly impacts analyst response efficiency and prevents alert fatigue suppression of real threats.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

false_positive_tuning_and_alert_fidelity[_false_positive_tuning_and_alert_fidelity_def] if {
    input.false_positive_tuning_enabled == true
    input.alert_fidelity_review_frequency in ["daily", "weekly", "monthly"]
    input.suppression_rule_count >= 1
}

false_positive_tuning_and_alert_fidelity[_false_positive_tuning_and_alert_fidelity_def] if {
    input.false_positive_tuning_enabled == true
    input.alert_fidelity_review_frequency in ["daily", "weekly"]
}

countermeasures contains _false_positive_tuning_and_alert_fidelity_def if {
    count(false_positive_tuning_and_alert_fidelity) > 0
}

_threat_intelligence_feed_integration_def := {
    "name": "Threat Intelligence Feed Integration",
    "description": "Delivers real-time enrichment of detection decisions using external IOC feeds (IP reputation, domain blacklists, malware hashes) \u2014 feed currency and volume determine detection coverage against known-bad infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

threat_intelligence_feed_integration[_threat_intelligence_feed_integration_def] if {
    input.threat_feed_integration_enabled == true
    input.feed_refresh_interval_hours <= 24
    count(input.active_feed_types) >= 2
}

threat_intelligence_feed_integration[_threat_intelligence_feed_integration_def] if {
    input.threat_feed_integration_enabled == true
    "ip_reputation" in input.active_feed_types
    "domain_blacklist" in input.active_feed_types
    input.feed_refresh_interval_hours <= 24
}

countermeasures contains _threat_intelligence_feed_integration_def if {
    count(threat_intelligence_feed_integration) > 0
}

_sensor_deployment_and_coverage_completeness_def := {
    "name": "Sensor Deployment And Coverage Completeness",
    "description": "Provides monitoring continuity across all critical network segments including cloud, OT, and remote access paths \u2014 gaps in sensor placement create blind spots regardless of detection engine capability.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

sensor_deployment_and_coverage_completeness[_sensor_deployment_and_coverage_completeness_def] if {
    input.internal_segment_sensor_coverage == "full"
    input.sensor_health_verified == true
}

countermeasures contains _sensor_deployment_and_coverage_completeness_def if {
    count(sensor_deployment_and_coverage_completeness) > 0
}
