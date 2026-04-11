package _dt_built_in.countermeasures.security_event_correlation_rules



_rule_based_detection_accuracy_def := {
    "name": "Rule Based Detection Accuracy",
    "description": "Provides precise identification of known threat patterns through deterministic rule logic, reducing false positive rates when rules are tuned to the environment. Accuracy is measurable by true positive rate and false positive ratio across rule sets.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTSA",
            "name": "Network Traffic Signature Analysis",
            "relevance": "Signature-based analysis directly supports rule-based detection accuracy by matching traffic patterns against known threat signatures."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FCR",
            "name": "File Content Rules",
            "relevance": "File content rules are a core mechanism for rule-based detection, enabling precise identification of malicious content."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1038",
            "name": "Execution Prevention",
            "relevance": "Execution prevention relies on accurate rule-based detection to block malicious execution attempts."
        }
    ]
}

rule_based_detection_accuracy[_rule_based_detection_accuracy_def] if {
    input.rules_deployed_and_enabled == true
    input.rule_tuning_status in ["fully_tuned", "partially_tuned"]
    input.false_positive_rate_percent <= 20
    input.last_rule_review_days_ago <= 90
}

countermeasures contains _rule_based_detection_accuracy_def if {
    count(rule_based_detection_accuracy) > 0
}

_behavioral_baseline_deviation_detection_def := {
    "name": "Behavioral Baseline Deviation Detection",
    "description": "Delivers detection capability for anomalous activity by establishing statistical baselines and flagging deviations, enabling identification of low-and-slow attacks or novel behaviors not captured by static rules.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Anomaly detection in protocol metadata directly identifies deviations from established behavioral baselines."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Analyzing administrative network activity helps detect deviations from normal administrative behavior patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-WSAA",
            "name": "Web Session Activity Analysis",
            "relevance": "Web session activity analysis identifies anomalous user behavior deviating from established baselines."
        }
    ]
}

behavioral_baseline_deviation_detection[_behavioral_baseline_deviation_detection_def] if {
    input.baseline_modeling_enabled == true
    input.deviation_detection_rules_count >= 1
    input.baseline_coverage_scope in ["partial", "full"]
}

countermeasures contains _behavioral_baseline_deviation_detection_def if {
    count(behavioral_baseline_deviation_detection) > 0
}

_multi_source_log_correlation_def := {
    "name": "Multi Source Log Correlation",
    "description": "Provides the ability to correlate events across disparate log sources (endpoints, network devices, applications, cloud) to construct attack chains that no single source would reveal independently.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Network traffic analysis aggregates data from multiple sources, enabling correlation across logs for threat detection."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PLA",
            "name": "Process Lineage Analysis",
            "relevance": "Process lineage analysis correlates process-related log events across sources to identify attack chains."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing enables comprehensive log collection across sources, which is foundational for multi-source log correlation."
        }
    ]
}

multi_source_log_correlation[_multi_source_log_correlation_def] if {
    count(input.log_source_types_integrated) >= 3
    input.cross_source_correlation_rules_enabled == true
    input.active_cross_source_rule_count >= 1
    input.alert_output_configured == true
}

multi_source_log_correlation[_multi_source_log_correlation_def] if {
    count(input.log_source_types_integrated) >= 2
    input.active_cross_source_rule_count >= 5
    input.alert_output_configured == true
}

countermeasures contains _multi_source_log_correlation_def if {
    count(multi_source_log_correlation) > 0
}

_alert_triage_and_prioritization_def := {
    "name": "Alert Triage And Prioritization",
    "description": "Delivers structured severity scoring and prioritization of generated alerts, enabling analyst workflows to focus on highest-risk events first and reducing mean time to detection and response.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Thresholding authentication events helps prioritize alerts by identifying anomalous authentication volumes requiring triage."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Authorization event thresholding supports alert prioritization by flagging abnormal authorization patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Monitoring application exceptions provides critical signals for triaging and prioritizing security alerts."
        }
    ]
}

alert_triage_and_prioritization[_alert_triage_and_prioritization_def] if {
    input.severity_scoring_enabled == true
    input.alert_prioritization_workflow_configured == true
    input.severity_levels_defined == "multi_tier"
    input.coverage_percentage_of_rules_with_severity >= 80
}

alert_triage_and_prioritization[_alert_triage_and_prioritization_def] if {
    input.severity_scoring_enabled == true
    input.alert_prioritization_workflow_configured == true
    input.severity_levels_defined in ["binary", "multi_tier"]
    input.coverage_percentage_of_rules_with_severity >= 60
}

countermeasures contains _alert_triage_and_prioritization_def if {
    count(alert_triage_and_prioritization) > 0
}

_automated_response_orchestration_def := {
    "name": "Automated Response Orchestration",
    "description": "Provides automated response action triggers (e.g., account lockout, firewall rule push, ticket creation) upon rule match, reducing dwell time without requiring manual analyst intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AL",
            "name": "Account Locking",
            "relevance": "Account locking is a direct automated response action that can be orchestrated in response to detected threats."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Authorization event thresholding triggers automated responses when authorization anomalies exceed defined thresholds."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1037",
            "name": "Filter Network Traffic",
            "relevance": "Filtering network traffic is a common automated response action orchestrated to block malicious activity."
        }
    ]
}

automated_response_orchestration[_automated_response_orchestration_def] if {
    input.automated_response_actions_enabled == true
    input.rules_with_response_coverage_pct >= 50
    count(input.response_action_types) >= 1
}

countermeasures contains _automated_response_orchestration_def if {
    count(automated_response_orchestration) > 0
}

_detection_rule_coverage_breadth_def := {
    "name": "Detection Rule Coverage Breadth",
    "description": "Provides measurable coverage of the threat landscape through the quantity and quality of active detection rules, mapped to frameworks such as MITRE ATT&CK, ensuring gaps in detection are identifiable and addressable.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Network traffic analysis provides broad coverage across multiple attack vectors, expanding detection rule breadth."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Analyzing administrative network activity broadens detection coverage to include privileged action abuse."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Connection attempt analysis extends detection coverage to network-based intrusion attempts across many techniques."
        }
    ]
}

detection_rule_coverage_breadth[_detection_rule_coverage_breadth_def] if {
    input.active_detection_rule_count >= 50
    input.mitre_attack_tactic_coverage_count >= 8
    input.rules_reviewed_within_90_days == true
}

detection_rule_coverage_breadth[_detection_rule_coverage_breadth_def] if {
    input.active_detection_rule_count >= 150
    input.mitre_attack_tactic_coverage_count >= 11
}

countermeasures contains _detection_rule_coverage_breadth_def if {
    count(detection_rule_coverage_breadth) > 0
}

_log_ingestion_completeness_def := {
    "name": "Log Ingestion Completeness",
    "description": "Ensures all relevant data sources are onboarded and continuously streaming into the SIEM, providing full visibility coverage across the environment and preventing detection blind spots caused by missing log feeds.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SDM",
            "name": "System Daemon Monitoring",
            "relevance": "Monitoring system daemons ensures comprehensive log ingestion from critical system-level processes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1029",
            "name": "Remote Data Storage",
            "relevance": "Remote data storage ensures logs are completely ingested and preserved even if local systems are compromised."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Connection attempt analysis requires complete ingestion of network logs to ensure no connection events are missed."
        }
    ]
}

log_ingestion_completeness[_log_ingestion_completeness_def] if {
    input.critical_sources_onboarded == true
    input.log_feed_health_percent >= 95
    input.stale_or_silent_source_count == 0
}

countermeasures contains _log_ingestion_completeness_def if {
    count(log_ingestion_completeness) > 0
}

_rule_tuning_and_operational_maintainability_def := {
    "name": "Rule Tuning And Operational Maintainability",
    "description": "Provides ongoing capability to update, version-control, test, and deprecate detection rules in response to environmental changes and emerging threats, maintaining detection efficacy over time without operational debt accumulation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FIM",
            "name": "File Integrity Monitoring",
            "relevance": "File integrity monitoring rules require regular tuning to maintain accuracy and reduce false positives over time."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Administrative activity analysis rules need ongoing tuning to reflect evolving administrative patterns and maintain operational accuracy."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1016",
            "name": "Vulnerability Scanning",
            "relevance": "Regular vulnerability scanning informs rule updates and tuning to address newly discovered threats and maintain coverage."
        }
    ]
}

rule_tuning_and_operational_maintainability[_rule_tuning_and_operational_maintainability_def] if {
    input.rule_version_control_enabled == true
    input.rule_review_cycle_days <= 90
    input.rule_testing_process in ["manual", "automated"]
    input.deprecated_rules_removed == true
}

rule_tuning_and_operational_maintainability[_rule_tuning_and_operational_maintainability_def] if {
    input.rule_version_control_enabled == true
    input.rule_testing_process == "automated"
    input.deprecated_rules_removed == true
}

countermeasures contains _rule_tuning_and_operational_maintainability_def if {
    count(rule_tuning_and_operational_maintainability) > 0
}

_threat_intelligence_integration_def := {
    "name": "Threat Intelligence Integration",
    "description": "Delivers enriched detection by correlating log events against ingested threat intelligence feeds (IOCs, malicious IPs, known bad hashes), increasing detection fidelity for known threat actor infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-IHN",
            "name": "Integrated Honeynet",
            "relevance": "Integrated honeynets generate threat intelligence from attacker interactions, directly supporting threat intelligence integration."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTSA",
            "name": "Network Traffic Signature Analysis",
            "relevance": "Network traffic signature analysis leverages threat intelligence feeds to update signatures and improve detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1019",
            "name": "Threat Intelligence Program",
            "relevance": "A threat intelligence program is the foundational mitigation for integrating external threat data into security operations."
        }
    ]
}

threat_intelligence_integration[_threat_intelligence_integration_def] if {
    input.threat_intel_feeds_enabled == true
    input.active_feed_count >= 1
    input.ioc_correlation_rules_status == "enabled"
}

threat_intelligence_integration[_threat_intelligence_integration_def] if {
    input.threat_intel_feeds_enabled == true
    input.active_feed_count >= 1
    input.ioc_correlation_rules_status == "partial"
}

countermeasures contains _threat_intelligence_integration_def if {
    count(threat_intelligence_integration) > 0
}

_historical_log_retention_and_forensic_querying_def := {
    "name": "Historical Log Retention And Forensic Querying",
    "description": "Provides indexed historical log storage with query capability, enabling post-incident forensic analysis, retroactive hunting against newly identified IOCs, and compliance-driven evidence preservation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1029",
            "name": "Remote Data Storage",
            "relevance": "Remote data storage is essential for retaining historical logs in a tamper-resistant location for forensic investigations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1053",
            "name": "Data Backup",
            "relevance": "Data backup ensures historical logs are preserved and recoverable for forensic querying after incidents."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FAPA",
            "name": "File Access Pattern Analysis",
            "relevance": "File access pattern analysis supports forensic investigations by enabling historical querying of file access logs."
        }
    ]
}

historical_log_retention_and_forensic_querying[_historical_log_retention_and_forensic_querying_def] if {
    input.log_retention_days >= 90
    input.log_indexing_status == "healthy"
    input.forensic_query_capability_enabled == true
}

countermeasures contains _historical_log_retention_and_forensic_querying_def if {
    count(historical_log_retention_and_forensic_querying) > 0
}
