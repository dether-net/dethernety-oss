package _dt_built_in.countermeasures.log_retention_policies

_forensic_investigation_window_def := {
    "name": "Forensic Investigation Window",
    "description": "Provides a defined time horizon within which historical log data remains accessible for incident investigation, ensuring analysts can reconstruct events across the full scope of a breach or compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

forensic_investigation_window[_forensic_investigation_window_def] if {
    input.retention_policy_enforced == true
    input.log_retention_days >= 90
    "authentication" in input.log_types_covered
    "network" in input.log_types_covered
}

forensic_investigation_window[_forensic_investigation_window_def] if {
    input.retention_policy_enforced == true
    input.log_retention_days >= 365
}

countermeasures contains _forensic_investigation_window_def if {
    count(forensic_investigation_window) > 0
}

_compliance_retention_coverage_def := {
    "name": "Compliance Retention Coverage",
    "description": "Ensures log retention durations align with regulatory and contractual requirements (e.g., PCI-DSS, HIPAA, SOX), providing documented evidence that audit trails are preserved for mandated periods.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

compliance_retention_coverage[_compliance_retention_coverage_def] if {
    input.retention_policy_documented == true
    input.log_retention_days >= 365
    input.archival_integrity_verified == true
    count(input.applicable_compliance_frameworks) >= 1
}

countermeasures contains _compliance_retention_coverage_def if {
    count(compliance_retention_coverage) > 0
}

_archival_integrity_assurance_def := {
    "name": "Archival Integrity Assurance",
    "description": "Provides guarantees that logs moved to archival storage maintain integrity and retrievability, enabling trust in archived evidence through checksumming, immutable storage, or write-once mechanisms.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

archival_integrity_assurance[_archival_integrity_assurance_def] if {
    input.archival_integrity_mechanism in ["checksumming", "cryptographic_signing"]
    input.archival_integrity_verified == true
}

archival_integrity_assurance[_archival_integrity_assurance_def] if {
    input.archival_integrity_mechanism in ["immutable_storage", "write_once"]
    input.archival_retention_lock_enforced == true
}

archival_integrity_assurance[_archival_integrity_assurance_def] if {
    input.archival_storage_type == "immutable_object_store"
    input.archival_retention_lock_enforced == true
}

archival_integrity_assurance[_archival_integrity_assurance_def] if {
    input.archival_storage_type == "worm_appliance"
    input.archival_integrity_verified == true
}

countermeasures contains _archival_integrity_assurance_def if {
    count(archival_integrity_assurance) > 0
}

_log_continuity_across_storage_tiers_def := {
    "name": "Log Continuity Across Storage Tiers",
    "description": "Delivers uninterrupted audit trail availability by defining transition conditions between hot, warm, and cold storage tiers, preventing coverage gaps during log lifecycle transitions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

log_continuity_across_storage_tiers[_log_continuity_across_storage_tiers_def] if {
    input.storage_tier_transitions_defined == true
    input.tier_overlap_or_continuity_guarantee in ["overlap_window", "atomic_cutover"]
    input.minimum_hot_tier_retention_days >= 1
}

countermeasures contains _log_continuity_across_storage_tiers_def if {
    count(log_continuity_across_storage_tiers) > 0
}

_storage_capacity_management_def := {
    "name": "Storage Capacity Management",
    "description": "Provides predictable log storage utilization by defining purge schedules and archival triggers, preventing log loss due to storage exhaustion while maintaining operational continuity.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

storage_capacity_management[_storage_capacity_management_def] if {
    input.retention_policy_defined == true
    input.log_retention_days >= 90
    input.archival_trigger_configured == true
}

countermeasures contains _storage_capacity_management_def if {
    count(storage_capacity_management) > 0
}

_retention_policy_auditability_def := {
    "name": "Retention Policy Auditability",
    "description": "Enables verification that the retention policy itself is documented, versioned, and consistently enforced across all log sources, supporting audit readiness and policy governance.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

retention_policy_auditability[_retention_policy_auditability_def] if {
    input.retention_policy_documented == true
    input.retention_policy_versioned == true
    input.enforcement_scope == "all_sources"
}

countermeasures contains _retention_policy_auditability_def if {
    count(retention_policy_auditability) > 0
}

_log_tamper_detection_via_retention_gaps_def := {
    "name": "Log Tamper Detection Via Retention Gaps",
    "description": "Provides detection capability for unauthorized log deletion or manipulation by enabling comparison of expected log volume and time ranges against actual retained records, surfacing coverage anomalies.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

log_tamper_detection_via_retention_gaps[_log_tamper_detection_via_retention_gaps_def] if {
    input.log_retention_days >= 90
    input.log_integrity_verification_enabled == true
    input.integrity_failure_alerting == true
    input.log_access_control_restricted == true
}

log_tamper_detection_via_retention_gaps[_log_tamper_detection_via_retention_gaps_def] if {
    input.log_retention_days >= 90
    input.log_integrity_verification_enabled == true
    input.log_access_control_restricted == true
    input.integrity_failure_alerting == true
}

countermeasures contains _log_tamper_detection_via_retention_gaps_def if {
    count(log_tamper_detection_via_retention_gaps) > 0
}

_rapid_retrieval_of_archived_logs_def := {
    "name": "Rapid Retrieval Of Archived Logs",
    "description": "Delivers operational efficiency during incident response by specifying retrieval procedures and SLAs for archived logs, reducing investigation delay when historical data must be accessed quickly.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

rapid_retrieval_of_archived_logs[_rapid_retrieval_of_archived_logs_def] if {
    input.retrieval_procedure_documented == true
    input.archived_log_retrieval_sla_minutes <= 480
    input.retrieval_mechanism_type in ["automated_api", "self_service_portal"]
}

rapid_retrieval_of_archived_logs[_rapid_retrieval_of_archived_logs_def] if {
    input.retrieval_procedure_documented == true
    input.archived_log_retrieval_sla_minutes <= 480
    input.retrieval_mechanism_type == "manual_request"
}

countermeasures contains _rapid_retrieval_of_archived_logs_def if {
    count(rapid_retrieval_of_archived_logs) > 0
}
