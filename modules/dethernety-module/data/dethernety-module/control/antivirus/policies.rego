package _dt_built_in.countermeasures.antivirus

_signature_detection_coverage_def := {
    "name": "Signature Detection Coverage",
    "description": "Provides identification of known malware variants through up-to-date signature databases; measured by signature update frequency, database size, and detection rate against known threat libraries.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

signature_detection_coverage[_signature_detection_coverage_def] if {
    input.realtime_protection_enabled == false
}

signature_detection_coverage[_signature_detection_coverage_def] if {
    input.signature_db_age_hours > 48
}

signature_detection_coverage[_signature_detection_coverage_def] if {
    input.signature_update_interval_hours > 24
}

countermeasures contains _signature_detection_coverage_def if {
    count(signature_detection_coverage) > 0
}

_heuristic_and_behavioral_detection_accuracy_def := {
    "name": "Heuristic And Behavioral Detection Accuracy",
    "description": "Delivers detection of unknown or zero-day malware through behavioral analysis and heuristic rules; reduces false negatives for novel threats while controlling false positive rates that impact operations.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

heuristic_and_behavioral_detection_accuracy[_heuristic_and_behavioral_detection_accuracy_def] if {
    input.heuristic_engine_enabled == false
}

heuristic_and_behavioral_detection_accuracy[_heuristic_and_behavioral_detection_accuracy_def] if {
    input.behavioral_monitoring_enabled == false
}

heuristic_and_behavioral_detection_accuracy[_heuristic_and_behavioral_detection_accuracy_def] if {
    input.detection_sensitivity_level in ["disabled", "low"]
}

heuristic_and_behavioral_detection_accuracy[_heuristic_and_behavioral_detection_accuracy_def] if {
    not input.heuristic_engine_enabled
    not input.behavioral_monitoring_enabled
}

countermeasures contains _heuristic_and_behavioral_detection_accuracy_def if {
    count(heuristic_and_behavioral_detection_accuracy) > 0
}

_real_time_on_access_scanning_def := {
    "name": "Real Time On Access Scanning",
    "description": "Provides continuous file and process inspection at execution time, preventing malicious payloads from running before they can cause harm; controlled by enabled/disabled scan-on-access configuration.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

real_time_on_access_scanning[_real_time_on_access_scanning_def] if {
    input.real_time_scanning_enabled == false
}

real_time_on_access_scanning[_real_time_on_access_scanning_def] if {
    input.antimalware_service_state in ["stopped", "disabled"]
}

real_time_on_access_scanning[_real_time_on_access_scanning_def] if {
    input.real_time_scanning_enabled == true
    input.antimalware_service_state == "running"
    input.signature_definitions_age_days > 7
}

countermeasures contains _real_time_on_access_scanning_def if {
    count(real_time_on_access_scanning) > 0
}

_automated_quarantine_and_remediation_def := {
    "name": "Automated Quarantine And Remediation",
    "description": "Delivers automated isolation of detected threats into a secured quarantine store and removal or rollback of malicious changes, reducing dwell time without requiring manual intervention.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

automated_quarantine_and_remediation[_automated_quarantine_and_remediation_def] if {
    input.realtime_protection_enabled == false
}

automated_quarantine_and_remediation[_automated_quarantine_and_remediation_def] if {
    input.realtime_protection_enabled == true
    input.automatic_quarantine_enabled == false
}

automated_quarantine_and_remediation[_automated_quarantine_and_remediation_def] if {
    input.realtime_protection_enabled == true
    input.automatic_quarantine_enabled == true
    input.remediation_mode in ["audit", "disabled"]
}

countermeasures contains _automated_quarantine_and_remediation_def if {
    count(automated_quarantine_and_remediation) > 0
}

_scheduled_and_on_demand_scan_coverage_def := {
    "name": "Scheduled And On Demand Scan Coverage",
    "description": "Provides periodic full-system and targeted scans to detect dormant or previously missed malware; coverage completeness measured by scan scope configuration and scheduled execution frequency.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

scheduled_and_on_demand_scan_coverage[_scheduled_and_on_demand_scan_coverage_def] if {
    input.scheduled_scan_enabled == false
}

scheduled_and_on_demand_scan_coverage[_scheduled_and_on_demand_scan_coverage_def] if {
    input.scheduled_scan_enabled == true
    input.scan_frequency_days > 7
}

scheduled_and_on_demand_scan_coverage[_scheduled_and_on_demand_scan_coverage_def] if {
    input.scheduled_scan_enabled == true
    input.scan_scope in ["none", "custom"]
}

countermeasures contains _scheduled_and_on_demand_scan_coverage_def if {
    count(scheduled_and_on_demand_scan_coverage) > 0
}

_detection_event_logging_and_alerting_def := {
    "name": "Detection Event Logging And Alerting",
    "description": "Delivers structured audit logs and real-time alerts for all detection, quarantine, and remediation events, enabling SOC visibility, forensic analysis, and compliance reporting.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    input.event_logging_enabled == false
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    input.real_time_alerting_enabled == false
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    input.log_destination in ["local_only", "none"]
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    not "detection" in input.logged_event_types
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    not "quarantine" in input.logged_event_types
}

detection_event_logging_and_alerting[_detection_event_logging_and_alerting_def] if {
    not "remediation" in input.logged_event_types
}

countermeasures contains _detection_event_logging_and_alerting_def if {
    count(detection_event_logging_and_alerting) > 0
}

_signature_update_currency_def := {
    "name": "Signature Update Currency",
    "description": "Provides timeliness of threat intelligence integration through automated signature and engine updates; measured by update interval, last-update timestamp, and connectivity to update infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

signature_update_currency[_signature_update_currency_def] if {
    input.automatic_updates_enabled == false
}

signature_update_currency[_signature_update_currency_def] if {
    input.automatic_updates_enabled == true
    input.signature_update_interval_hours > 24
}

signature_update_currency[_signature_update_currency_def] if {
    input.automatic_updates_enabled == true
    input.hours_since_last_successful_update > 24
}

signature_update_currency[_signature_update_currency_def] if {
    input.automatic_updates_enabled == true
    input.update_infrastructure_reachable == false
}

countermeasures contains _signature_update_currency_def if {
    count(signature_update_currency) > 0
}

_centralized_management_and_policy_enforcement_def := {
    "name": "Centralized Management And Policy Enforcement",
    "description": "Delivers uniform policy deployment, configuration compliance, and fleet-wide visibility across all protected endpoints through a central management console; measured by agent check-in frequency and policy deviation detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

centralized_management_and_policy_enforcement[_centralized_management_and_policy_enforcement_def] if {
    input.management_console_connected == true
    input.policy_compliance_status == "compliant"
    input.agent_check_in_interval_minutes <= 60
}

countermeasures contains _centralized_management_and_policy_enforcement_def if {
    count(centralized_management_and_policy_enforcement) > 0
}

_network_traffic_and_download_scanning_def := {
    "name": "Network Traffic And Download Scanning",
    "description": "Provides inspection of files transferred over network protocols and browser downloads before they reach the filesystem, extending detection coverage to the network delivery layer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

network_traffic_and_download_scanning[_network_traffic_and_download_scanning_def] if {
    input.network_scanning_enabled == true
    input.download_scanning_enabled == true
    input.scan_engine_mode in ["signature_and_heuristic", "signature_heuristic_behavioral"]
}

network_traffic_and_download_scanning[_network_traffic_and_download_scanning_def] if {
    input.network_scanning_enabled == true
    input.download_scanning_enabled == true
    input.scan_engine_mode == "signature_only"
}

countermeasures contains _network_traffic_and_download_scanning_def if {
    count(network_traffic_and_download_scanning) > 0
}

_exclusion_and_allowlist_accuracy_def := {
    "name": "Exclusion And Allowlist Accuracy",
    "description": "Provides controlled reduction of false positives through scoped file, process, and path exclusions; misconfigured or overly broad exclusions directly reduce detection coverage, making exclusion list auditing operationally critical.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

exclusion_and_allowlist_accuracy[_exclusion_and_allowlist_accuracy_def] if {
    input.exclusion_list_reviewed == true
    input.exclusion_scope in ["none", "scoped"]
    input.exclusions_business_justified == true
    input.wildcard_exclusion_count == 0
}

countermeasures contains _exclusion_and_allowlist_accuracy_def if {
    count(exclusion_and_allowlist_accuracy) > 0
}
