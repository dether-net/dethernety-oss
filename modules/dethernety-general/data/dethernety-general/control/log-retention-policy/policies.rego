package _dt_built_in.countermeasures.log_retention_policy



_adequate_retention_period_enforced_def := {
    "name": "Adequate retention period enforced",
    "description": "Audit and security logs are preserved in hot, queryable storage for at least 90 days (with explicit compliance archival beyond), enforced by an automated, auditable retention schedule (ILM/lifecycle/retention-lock) rather than left to rotation or manual cleanup. Ensures evidence survives the dwell time of an intrusion discovered later. Workspace vocab: log_retention_days, retention_schedule_enforced.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Enforced >=90-day hot retention on an auditable schedule preserves audit/security log evidence beyond intrusion dwell time, so adversary indicator-removal (clearing/deleting/truncating logs) cannot erase the retained record that survives the compromise."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

adequate_retention_period_enforced[_adequate_retention_period_enforced_def] if {
    input.log_retention_days >= 90
    input.retention_schedule_enforced == true
}

countermeasures contains _adequate_retention_period_enforced_def if {
    count(adequate_retention_period_enforced) > 0
}

_off_box_centralized_aggregation_enforced_def := {
    "name": "Off-box centralized aggregation enforced",
    "description": "Audit records are forwarded to and retained in a centralized store on a physically/logically separate system in a distinct trust domain, so a compromise of an audited host cannot erase the only copy of its logs and all sources are governed under one retention policy. Workspace vocab: logs_stored_on_separate_system, centralized_log_aggregation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1029",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.001",
            "attributes": {
                "justification": "Off-box centralized retention in a separate trust domain preserves a copy of host event logs that an adversary clearing/deleting Windows Event Logs on the compromised host cannot reach (ATT&CK Mitigation M1029 Remote Data Storage)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Centralized aggregation across assets means logs forwarded off-box before a local logging service is disabled or modified survive in the central store, defeating attempts to blind defenders by tampering with logging at the source."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

off_box_centralized_aggregation_enforced[_off_box_centralized_aggregation_enforced_def] if {
    input.logs_stored_on_separate_system == true
    input.centralized_log_aggregation == true
}

countermeasures contains _off_box_centralized_aggregation_enforced_def if {
    count(off_box_centralized_aggregation_enforced) > 0
}

_log_integrity_tamper_evidence_enforced_def := {
    "name": "Log integrity / tamper-evidence enforced",
    "description": "Stored audit information is protected by write-once (WORM) / immutable retention-lock media and/or cryptographic integrity mechanisms, so an attacker who reaches the store cannot silently alter or delete records within the retention window. Workspace vocab: audit_log_tamper_evident.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1029",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "attributes": {
                "justification": "WORM/write-once media (AU-9(1)) and cryptographic integrity protection (AU-9(3)) on stored audit records make stored-data manipulation of log records preventable or evident, so an adversary cannot silently falsify the forensic record."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Immutable retention-lock plus integrity-protected, authenticated off-box forwarding mean an adversary who disables or modifies logging at the source cannot alter or delete the retained, tamper-evident copies in the central store within the retention window."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

log_integrity_tamper_evidence_enforced[_log_integrity_tamper_evidence_enforced_def] if {
    input.audit_log_tamper_evident == true
}

log_integrity_tamper_evidence_enforced[_log_integrity_tamper_evidence_enforced_def] if {
    input.log_pipeline_integrity_protected == true
}

countermeasures contains _log_integrity_tamper_evidence_enforced_def if {
    count(log_integrity_tamper_evidence_enforced) > 0
}

_audit_data_access_and_management_restricted_def := {
    "name": "Audit-data access and management restricted",
    "description": "Read access to audit data and management of audit-logging functionality (retention, forwarding, deletion settings) are limited to a defined subset of privileged roles under least-privilege RBAC, with alerting on unauthorized access/modification/deletion. Prevents unauthorized browsing, export, or reconfiguration of the log estate. Workspace vocab: audit_data_access_restricted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1022",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-LFP",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Restricting management of audit-logging functionality (retention/forwarding/deletion) to a privileged subset under least-privilege RBAC (AU-9(4)), with alerting on unauthorized modification, prevents an unauthorized principal from disabling, deleting, or altering cloud logging."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "attributes": {
                "justification": "Limiting read access to audit data to the privileged subset (AU-9(6)) prevents unauthorized enumeration/browsing of logs by principals who should not be able to query the audit record."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

audit_data_access_and_management_restricted[_audit_data_access_and_management_restricted_def] if {
    input.audit_management_restricted_to_privileged_subset == true
}

countermeasures contains _audit_data_access_and_management_restricted_def if {
    count(audit_data_access_and_management_restricted) > 0
}

_authenticated_encrypted_log_forwarding_enforced_def := {
    "name": "Authenticated, encrypted log forwarding enforced",
    "description": "Log forwarders mutually authenticate to the central collector and transmit over a TLS-protected, integrity-protected channel, so logs in transit cannot be intercepted, spoofed, or have forged records injected (vs plain UDP syslog). Workspace vocab: authenticated_log_forwarders_required.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1029",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "attributes": {
                "justification": "Authenticated, TLS/integrity-protected log forwarding prevents an adversary on the adjacent network from intercepting log contents or injecting/altering forged records in transit, defeating stored-data-manipulation attempts against the central log store fed by these forwarders."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

authenticated_encrypted_log_forwarding_enforced[_authenticated_encrypted_log_forwarding_enforced_def] if {
    input.authenticated_log_forwarders_required == true
    input.log_pipeline_integrity_protected == true
}

countermeasures contains _authenticated_encrypted_log_forwarding_enforced_def if {
    count(authenticated_encrypted_log_forwarding_enforced) > 0
}

_storage_sized_for_the_retention_window_def := {
    "name": "Storage sized for the retention window",
    "description": "Logging destinations are provisioned with capacity to hold the full documented retention period and capacity is monitored/alerted, so logs are not silently dropped or rotated out before retention elapses. Workspace vocab: log_storage_sized_for_retention.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "ATT&CK Mitigation Audit \u2014 provisioning logging storage for the full retention window and monitoring capacity is an audit-management practice that keeps log evidence available."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Sizing storage to the retention window prevents logs from rotating out before an investigation, so evidence survives even when an adversary attempts Indicator Removal \u2014 the silent loss path that early rotation would otherwise create."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

storage_sized_for_the_retention_window[_storage_sized_for_the_retention_window_def] if {
    input.log_storage_sized_for_retention == true
}

storage_sized_for_the_retention_window[_storage_sized_for_the_retention_window_def] if {
    input.log_flood_overflow_protection == true
}

countermeasures contains _storage_sized_for_the_retention_window_def if {
    count(storage_sized_for_the_retention_window) > 0
}

_trusted_time_synchronization_and_secure_end_of_retention_disposal_def := {
    "name": "Trusted time synchronization and secure end-of-retention disposal",
    "description": "Logging assets synchronize clocks to at least two approved time sources so cross-source forensic timelines are trustworthy, and logs are securely sanitized (Clear/Purge/Destroy matched to media and impact) at end of retention so sensitive audit data is neither left recoverable nor kept indefinitely without basis. Workspace vocab: clocks_synced_to_trusted_time_source.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit (M1047): trusted clock synchronization across logging assets makes cross-source forensic timelines reliable, and disciplined end-of-retention sanitization governs the audit-data lifecycle \u2014 both strengthen the audit posture that detects and constrains adversary activity."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

trusted_time_synchronization_and_secure_end_of_retention_disposal[_trusted_time_synchronization_and_secure_end_of_retention_disposal_def] if {
    input.clocks_synced_to_trusted_time_source == true
    input.secure_disposal_at_end_of_retention == true
}

countermeasures contains _trusted_time_synchronization_and_secure_end_of_retention_disposal_def if {
    count(trusted_time_synchronization_and_secure_end_of_retention_disposal) > 0
}
