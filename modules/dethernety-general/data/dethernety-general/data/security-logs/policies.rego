package _dt_built_in.exposures.security_logs



_logs_not_tamper_evident_def := {
    "name": "Logs not tamper-evident",
    "description": "Audit records are mutable files an adversary can edit or selectively delete without trace \u2014 no append-only/WORM media, hash-chaining, signing, or file-integrity monitoring alerts on alteration. The headline cover-tracks failure: indicator removal and selective record modification go undetected (NIST SP 800-53 AU-9(1)/(3); PCI 10.5.5).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001"
        }
    ],
    "attack_vector": "LOCAL"
}

logs_not_tamper_evident[_logs_not_tamper_evident_def] if {
    not input.audit_log_tamper_evident
}

logs_not_tamper_evident[_logs_not_tamper_evident_def] if {
    not input.file_integrity_monitoring_enabled
}

exposures contains _logs_not_tamper_evident_def if {
    count(logs_not_tamper_evident) > 0
}

_logs_stored_only_locally_erased_on_host_compromise_def := {
    "name": "Logs stored only locally \u2014 erased on host compromise",
    "description": "Audit records never leave the generating host (no off-host storage, no central aggregation), so a single host compromise lets the adversary clear logging and destroy the only copy of the evidence (NIST AU-9(2); CIS 8.9).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.001"
        }
    ],
    "attack_vector": "LOCAL"
}

logs_stored_only_locally_erased_on_host_compromise[_logs_stored_only_locally_erased_on_host_compromise_def] if {
    not input.logs_stored_on_separate_system
}

logs_stored_only_locally_erased_on_host_compromise[_logs_stored_only_locally_erased_on_host_compromise_def] if {
    not input.centralized_log_aggregation
}

exposures contains _logs_stored_only_locally_erased_on_host_compromise_def if {
    count(logs_stored_only_locally_erased_on_host_compromise) > 0
}

_over_broad_read_modify_delete_access_to_logs_def := {
    "name": "Over-broad read/modify/delete access to logs",
    "description": "Read and management access to the audit store is not least-privilege or periodically reviewed, letting an adversary discover what is logged to plan evasion, exfiltrate sensitive log contents, and modify or delete records \u2014 and access to the logs is itself unmonitored, so tampering goes unseen (NIST AU-9(4); PCI 10.5.1/10.2.3).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008"
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_read_modify_delete_access_to_logs[_over_broad_read_modify_delete_access_to_logs_def] if {
    not input.least_privilege_access_enforced
}

over_broad_read_modify_delete_access_to_logs[_over_broad_read_modify_delete_access_to_logs_def] if {
    not input.audit_management_restricted_to_privileged_subset
}

over_broad_read_modify_delete_access_to_logs[_over_broad_read_modify_delete_access_to_logs_def] if {
    not input.log_access_monitored
}

exposures contains _over_broad_read_modify_delete_access_to_logs_def if {
    count(over_broad_read_modify_delete_access_to_logs) > 0
}

_insufficient_security_event_coverage_def := {
    "name": "Insufficient security-event coverage",
    "description": "Security-relevant events (authentication success/failure, authorization failures, privileged/admin actions, account and auth-mechanism changes, access to the audit logs, audit start/stop/pause, object create/delete) are not captured or carry incomplete fields, so malicious activity goes unrecorded and records are unusable for investigation/correlation (NIST AU-2/AU-3/AU-12; PCI 10.2/10.3; CIS 8.2/8.5).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

insufficient_security_event_coverage[_insufficient_security_event_coverage_def] if {
    not input.security_events_fully_logged
}

insufficient_security_event_coverage[_insufficient_security_event_coverage_def] if {
    not input.required_record_fields_complete
}

exposures contains _insufficient_security_event_coverage_def if {
    count(insufficient_security_event_coverage) > 0
}

_unsynchronized_clocks_defeating_correlation_def := {
    "name": "Unsynchronized clocks defeating correlation",
    "description": "System clocks generating timestamps are free-running or attacker-manipulated rather than synced to a trusted UTC/atomic time source, making cross-source event sequencing impossible and frustrating investigation (NIST AU-8; PCI 10.6; CIS 8.4).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

unsynchronized_clocks_defeating_correlation[_unsynchronized_clocks_defeating_correlation_def] if {
    not input.clocks_synced_to_trusted_time_source
}

unsynchronized_clocks_defeating_correlation[_unsynchronized_clocks_defeating_correlation_def] if {
    not input.timestamps_in_utc
}

unsynchronized_clocks_defeating_correlation[_unsynchronized_clocks_defeating_correlation_def] if {
    not input.time_source_access_restricted
}

exposures contains _unsynchronized_clocks_defeating_correlation_def if {
    count(unsynchronized_clocks_defeating_correlation) > 0
}

_short_or_absent_retention_destroying_evidence_def := {
    "name": "Short or absent retention destroying evidence",
    "description": "Logs are rotated or aged out below the required window (PCI 12-month / CIS 90-day floors) or the store is undersized \u2014 including via adversary log-flooding to force overwrite \u2014 so evidence of slow or late-discovered intrusions is destroyed within the investigation window (NIST AU-4/AU-11; PCI 10.7).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070"
        }
    ],
    "attack_vector": "NETWORK"
}

short_or_absent_retention_destroying_evidence[_short_or_absent_retention_destroying_evidence_def] if {
    input.log_retention_days < 365
}

short_or_absent_retention_destroying_evidence[_short_or_absent_retention_destroying_evidence_def] if {
    not input.log_storage_sized_for_retention
}

short_or_absent_retention_destroying_evidence[_short_or_absent_retention_destroying_evidence_def] if {
    not input.log_flood_overflow_protection
}

exposures contains _short_or_absent_retention_destroying_evidence_def if {
    count(short_or_absent_retention_destroying_evidence) > 0
}

_logs_unencrypted_in_transit_at_rest_def := {
    "name": "Logs unencrypted in transit / at rest",
    "description": "Log data is forwarded in cleartext (e.g. UDP syslog) over untrusted networks or stored/archived unencrypted, allowing interception, tampering, or spoofing in transit and confidentiality breach of sensitive log contents at rest (NIST SP 800-92; AU-9(3); OWASP Logging).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002"
        }
    ],
    "attack_vector": "ADJACENT"
}

logs_unencrypted_in_transit_at_rest[_logs_unencrypted_in_transit_at_rest_def] if {
    not input.tls_only_transport
}

logs_unencrypted_in_transit_at_rest[_logs_unencrypted_in_transit_at_rest_def] if {
    not input.encrypted_at_rest
}

exposures contains _logs_unencrypted_in_transit_at_rest_def if {
    count(logs_unencrypted_in_transit_at_rest) > 0
}

_sensitive_data_captured_in_readable_logs_def := {
    "name": "Sensitive data captured in readable logs",
    "description": "Passwords, tokens, keys, connection strings, PAN, or sensitive PII are written into the broadly-visible, long-lived audit store, turning it into a confidentiality breach and a credential-harvest target rather than only an evidence record (OWASP Logging exclude/mask; NIST SP 800-92 / SP 800-122).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552"
        }
    ],
    "attack_vector": "LOCAL"
}

sensitive_data_captured_in_readable_logs[_sensitive_data_captured_in_readable_logs_def] if {
    not input.pii_excluded_from_logs
}

sensitive_data_captured_in_readable_logs[_sensitive_data_captured_in_readable_logs_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _sensitive_data_captured_in_readable_logs_def if {
    count(sensitive_data_captured_in_readable_logs) > 0
}

_logging_pipeline_failures_undetected_def := {
    "name": "Logging-pipeline failures undetected",
    "description": "Logging can be stopped, paused, or reconfigured (or the pipeline silently fails) without an alert, and collected logs are never reviewed on a defined cadence \u2014 so disabled logging, tampering, and indicators of compromise are collected-but-unseen or not produced at all (NIST AU-5/AU-6; PCI 10.2.6/10.7.2; CIS 8.11).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

logging_pipeline_failures_undetected[_logging_pipeline_failures_undetected_def] if {
    not input.logging_failure_alerting_enabled
}

logging_pipeline_failures_undetected[_logging_pipeline_failures_undetected_def] if {
    not input.log_review_cadence_defined
}

exposures contains _logging_pipeline_failures_undetected_def if {
    count(logging_pipeline_failures_undetected) > 0
}
