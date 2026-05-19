package _dt_built_in.countermeasures.monitoring_alerts_configuration

_detection_sensitivity_tuning_def := {
    "name": "Detection Sensitivity Tuning",
    "description": "Provides the ability to calibrate threshold values so that meaningful deviations from baseline are reliably detected without generating excessive noise, directly controlling the true-positive rate of the alerting system.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Detecting anomalies in protocol metadata requires careful sensitivity tuning to distinguish legitimate from malicious traffic."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Tuning detection sensitivity for administrative network activity helps reduce false positives while catching genuine threats."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Application exception monitoring thresholds must be carefully tuned to balance detection coverage and noise."
        }
    ]
}

detection_sensitivity_tuning[_detection_sensitivity_tuning_def] if {
    input.threshold_configuration_status == "tuned"
    input.false_positive_rate_reviewed == true
}

detection_sensitivity_tuning[_detection_sensitivity_tuning_def] if {
    input.threshold_configuration_status == "tuned"
    input.baseline_deviation_percentage >= 5
    input.baseline_deviation_percentage <= 50
}

countermeasures contains _detection_sensitivity_tuning_def if {
    count(detection_sensitivity_tuning) > 0
}

_alert_fatigue_reduction_def := {
    "name": "Alert Fatigue Reduction",
    "description": "Delivers suppression of low-signal alerts through well-set thresholds, reducing operator desensitization and maintaining analyst focus on genuine high-priority events.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Thresholding authentication events reduces alert fatigue by grouping or suppressing low-signal repeated alerts."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Focused application exception monitoring helps prioritize meaningful alerts and reduce noise-driven fatigue."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Analyzing administrative network activity with proper context reduces spurious alerts from routine operations."
        }
    ]
}

alert_fatigue_reduction[_alert_fatigue_reduction_def] if {
    input.threshold_configuration_status == true
    input.threshold_configuration_status == "tuned"
    input.suppression_rules_count >= 1
}

alert_fatigue_reduction[_alert_fatigue_reduction_def] if {
    input.threshold_configuration_status == true
    input.threshold_configuration_status == "tuned"
    input.suppression_rules_count == 0
}

countermeasures contains _alert_fatigue_reduction_def if {
    count(alert_fatigue_reduction) > 0
}

_baseline_deviation_coverage_def := {
    "name": "Baseline Deviation Coverage",
    "description": "Provides detection coverage across normal operational variance by anchoring thresholds to statistically derived baselines, ensuring alerts fire only when values represent meaningful anomalies relative to historical norms.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Protocol metadata anomaly detection directly identifies deviations from established communication baselines."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Monitoring administrative network activity against baselines helps detect unauthorized or anomalous behavior."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Application exception monitoring detects deviations from normal application behavior patterns."
        }
    ]
}

baseline_deviation_coverage[_baseline_deviation_coverage_def] if {
    input.baseline_calculation_method in ["standard_deviation", "percentile_based", "machine_learning"]
    input.baseline_lookback_days >= 14
    input.threshold_auto_update_enabled == true
}

baseline_deviation_coverage[_baseline_deviation_coverage_def] if {
    input.baseline_calculation_method == "rolling_average"
    input.baseline_lookback_days >= 30
    input.threshold_auto_update_enabled == true
}

countermeasures contains _baseline_deviation_coverage_def if {
    count(baseline_deviation_coverage) > 0
}

_tiered_severity_classification_def := {
    "name": "Tiered Severity Classification",
    "description": "Enables multi-level threshold bands (warning, critical, emergency) that produce graduated alert severities, allowing prioritized response workflows and differentiated escalation paths.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Application exceptions can be classified into severity tiers based on exception type and impact scope."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Authentication events can be tiered by severity based on failure counts, account sensitivity, and access patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-OMM",
            "name": "Operating Mode Monitoring",
            "relevance": "Monitoring operating modes supports tiered severity classification by identifying when systems deviate from expected states."
        }
    ]
}

tiered_severity_classification[_tiered_severity_classification_def] if {
    input.severity_tiers_configured == "multi"
    count(input.tier_thresholds_defined) >= 2
    input.escalation_paths_configured == true
}

tiered_severity_classification[_tiered_severity_classification_def] if {
    input.severity_tiers_configured == "multi"
    "warning" in input.tier_thresholds_defined
    "critical" in input.tier_thresholds_defined
    "emergency" in input.tier_thresholds_defined
}

countermeasures contains _tiered_severity_classification_def if {
    count(tiered_severity_classification) > 0
}

_automated_response_triggering_def := {
    "name": "Automated Response Triggering",
    "description": "Provides integration hooks that allow threshold breaches to automatically initiate remediation actions such as service restarts, traffic blocking, or incident ticket creation, reducing mean time to respond (MTTR).",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CAA",
            "name": "Connection Attempt Analysis",
            "relevance": "Analyzing connection attempts can directly trigger automated responses when suspicious patterns exceed defined thresholds."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Authorization event thresholds can be configured to automatically trigger responses upon policy violations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Detecting anomalous administrative network activity can serve as a trigger for automated defensive responses."
        }
    ]
}

automated_response_triggering[_automated_response_triggering_def] if {
    input.automated_response_enabled == true
    count(input.configured_response_actions) >= 1
    input.response_integration_endpoint_configured == true
    input.response_action_test_status in ["partially_tested", "fully_tested"]
}

automated_response_triggering[_automated_response_triggering_def] if {
    input.automated_response_enabled == true
    count(input.configured_response_actions) >= 1
    input.response_integration_endpoint_configured == true
    input.response_action_test_status == "fully_tested"
}

countermeasures contains _automated_response_triggering_def if {
    count(automated_response_triggering) > 0
}

_threshold_audit_and_change_tracking_def := {
    "name": "Threshold Audit And Change Tracking",
    "description": "Delivers a complete audit trail of threshold configuration changes, including who modified values and when, supporting compliance verification and detection of unauthorized threshold manipulation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-FIM",
            "name": "File Integrity Monitoring",
            "relevance": "File integrity monitoring tracks changes to configuration files where thresholds are stored, ensuring auditability."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Tracking administrative network activity provides an audit trail for threshold changes made by privileged users."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Regular auditing of threshold configurations ensures changes are tracked and reviewed for compliance."
        }
    ]
}

threshold_audit_and_change_tracking[_threshold_audit_and_change_tracking_def] if {
    input.audit_logging_enabled == true
    input.change_record_completeness == "full"
    input.audit_log_retention_days >= 90
}

threshold_audit_and_change_tracking[_threshold_audit_and_change_tracking_def] if {
    input.audit_logging_enabled == true
    input.change_record_completeness == "full"
    input.unauthorized_change_alerting_enabled == true
    input.audit_log_retention_days >= 30
}

countermeasures contains _threshold_audit_and_change_tracking_def if {
    count(threshold_audit_and_change_tracking) > 0
}

_cross_metric_correlation_coverage_def := {
    "name": "Cross Metric Correlation Coverage",
    "description": "Provides the ability to define composite thresholds that span multiple metrics simultaneously, increasing detection accuracy for complex conditions that would be missed by single-metric alerting.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Protocol metadata anomaly detection correlates multiple network metrics to identify complex attack patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Correlating authentication events with other metrics improves coverage for detecting coordinated attack campaigns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Cross-correlating application exceptions with network and authentication metrics provides broader detection coverage."
        }
    ]
}

cross_metric_correlation_coverage[_cross_metric_correlation_coverage_def] if {
    input.composite_alerting_enabled == true
    input.composite_alert_rule_count >= 1
    count(input.metrics_covered_by_composite_rules) >= 2
}

countermeasures contains _cross_metric_correlation_coverage_def if {
    count(cross_metric_correlation_coverage) > 0
}

_time_window_scoping_def := {
    "name": "Time Window Scoping",
    "description": "Delivers temporal precision in alerting by allowing thresholds to be scoped to specific time windows or rate periods, enabling detection of sustained anomalies while suppressing transient spikes that represent normal load patterns.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANET",
            "name": "Authentication Event Thresholding",
            "relevance": "Authentication event thresholding inherently relies on time window scoping to count events within defined periods."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Protocol metadata anomaly detection uses time-scoped windows to identify burst or slow-and-low attack patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AZET",
            "name": "Authorization Event Thresholding",
            "relevance": "Authorization event thresholding depends on time window scoping to detect rapid privilege escalation attempts."
        }
    ]
}

time_window_scoping[_time_window_scoping_def] if {
    input.time_window_defined == true
    input.window_duration_seconds > 0
    input.evaluation_type in ["rate", "rolling_window", "sliding_window"]
}

countermeasures contains _time_window_scoping_def if {
    count(time_window_scoping) > 0
}

_notification_channel_integration_def := {
    "name": "Notification Channel Integration",
    "description": "Provides configurable routing of threshold-triggered alerts to multiple downstream channels (SIEM, email, SMS, ticketing systems), ensuring alert visibility reaches the appropriate responders without manual intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MA",
            "name": "Message Analysis",
            "relevance": "Message analysis is directly relevant to integrating and validating notification channels used for alert delivery."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Application exception monitoring feeds into notification channels to ensure timely alert delivery to responders."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1060",
            "name": "Out-of-Band Communications Channel",
            "relevance": "Out-of-band communications channels provide resilient notification paths when primary channels may be compromised."
        }
    ]
}

notification_channel_integration[_notification_channel_integration_def] if {
    input.alert_routing_enabled == true
    count(input.notification_channels_configured) >= 1
    input.channel_test_status == "passed"
}

countermeasures contains _notification_channel_integration_def if {
    count(notification_channel_integration) > 0
}

_operational_maintainability_through_templating_def := {
    "name": "Operational Maintainability Through Templating",
    "description": "Delivers standardized, reusable threshold templates that can be applied consistently across systems, reducing configuration drift and ensuring uniform detection coverage as the environment scales.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Application configuration hardening templates standardize security settings, improving maintainability across deployments."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AH",
            "name": "Application Hardening",
            "relevance": "Application hardening through reusable templates ensures consistent security posture and reduces operational overhead."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Standardized software configuration templates directly support operational maintainability and consistent security baselines."
        }
    ]
}

operational_maintainability_through_templating[_operational_maintainability_through_templating_def] if {
    input.threshold_templates_defined == true
    input.template_adoption_percentage >= 80
}

operational_maintainability_through_templating[_operational_maintainability_through_templating_def] if {
    input.threshold_templates_defined == true
    input.template_coverage_scope in ["full", "category"]
}

countermeasures contains _operational_maintainability_through_templating_def if {
    count(operational_maintainability_through_templating) > 0
}
