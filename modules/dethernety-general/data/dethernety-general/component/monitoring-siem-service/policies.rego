package _dt_built_in.exposures.monitoring_siem_service



_log_tampering_deletion_to_blind_detection_def := {
    "name": "Log tampering / deletion to blind detection",
    "description": "Indexed events and audit records are stored on locally mutable disk with no immutability, WORM target, or integrity hashing (Splunk enableDataIntegrityControl off by default), so a compromised host or admin deletes or alters the security record to conceal activity and break timeline reconstruction.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

log_tampering_deletion_to_blind_detection[_log_tampering_deletion_to_blind_detection_def] if {
    not input.audit_log_tamper_evident
}

log_tampering_deletion_to_blind_detection[_log_tampering_deletion_to_blind_detection_def] if {
    not input.log_pipeline_integrity_protected
}

log_tampering_deletion_to_blind_detection[_log_tampering_deletion_to_blind_detection_def] if {
    not input.logs_stored_on_separate_system
}

log_tampering_deletion_to_blind_detection[_log_tampering_deletion_to_blind_detection_def] if {
    not input.file_integrity_monitoring_enabled
}

exposures contains _log_tampering_deletion_to_blind_detection_def if {
    count(log_tampering_deletion_to_blind_detection) > 0
}

_detection_alerting_disabled_or_silently_failing_def := {
    "name": "Detection / alerting disabled or silently failing",
    "description": "Correlation/detection rules are absent or disabled, log forwarders or host logging services are stopped, or the alert delivery path (email/webhook/SOAR) breaks unnoticed \u2014 collection without detection, the most common silent blinding where events are gathered but nothing ever fires.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

detection_alerting_disabled_or_silently_failing[_detection_alerting_disabled_or_silently_failing_def] if {
    not input.detection_rules_present_and_enabled
}

detection_alerting_disabled_or_silently_failing[_detection_alerting_disabled_or_silently_failing_def] if {
    not input.security_events_fully_logged
}

detection_alerting_disabled_or_silently_failing[_detection_alerting_disabled_or_silently_failing_def] if {
    not input.logging_failure_alerting_enabled
}

detection_alerting_disabled_or_silently_failing[_detection_alerting_disabled_or_silently_failing_def] if {
    not input.alert_delivery_path_monitored
}

exposures contains _detection_alerting_disabled_or_silently_failing_def if {
    count(detection_alerting_disabled_or_silently_failing) > 0
}

_spoofed_injected_or_unencrypted_log_ingestion_def := {
    "name": "Spoofed / injected or unencrypted log ingestion",
    "description": "Without authenticated, enrolled forwarders and TLS on the ingest channel (open Wazuh enrollment, plaintext syslog/UDP 514, or default demo certs), an on-path attacker sniffs sensitive event data or an unauthenticated host injects forged events to poison detection and bury real alerts.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "attributes": {
                "justification": "Unauthenticated/spoofed log injection floods or forges events to obstruct and poison detection so real indicators never surface \u2014 Indicator Blocking."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {
                "justification": "Plaintext or downgradable ingest lets an on-path attacker sniff and manipulate event data transmitted from forwarders to the SIEM \u2014 Transmitted Data Manipulation."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

spoofed_injected_or_unencrypted_log_ingestion[_spoofed_injected_or_unencrypted_log_ingestion_def] if {
    not input.authenticated_log_forwarders_required
}

spoofed_injected_or_unencrypted_log_ingestion[_spoofed_injected_or_unencrypted_log_ingestion_def] if {
    not input.tls_only_transport
}

spoofed_injected_or_unencrypted_log_ingestion[_spoofed_injected_or_unencrypted_log_ingestion_def] if {
    not input.log_injection_input_sanitized
}

spoofed_injected_or_unencrypted_log_ingestion[_spoofed_injected_or_unencrypted_log_ingestion_def] if {
    input.weak_tls_versions_enabled == true
}

exposures contains _spoofed_injected_or_unencrypted_log_ingestion_def if {
    count(spoofed_injected_or_unencrypted_log_ingestion) > 0
}

_cleartext_weak_tls_ingest_transport_def := {
    "name": "Cleartext / weak-TLS ingest transport",
    "description": "Ingest and enrollment channels accept plaintext or downgradeable legacy TLS (SSLv3/TLS1.0/1.1, weak ciphers) instead of pinned TLS 1.2+, exposing events in motion to disclosure, modification, and masquerade as named by RFC 5425.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_weak_tls_ingest_transport[_cleartext_weak_tls_ingest_transport_def] if {
    not input.tls_only_transport
}

cleartext_weak_tls_ingest_transport[_cleartext_weak_tls_ingest_transport_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_weak_tls_ingest_transport[_cleartext_weak_tls_ingest_transport_def] if {
    input.min_tls_version in ["SSLv3", "TLSv1.0", "TLSv1.1"]
}

cleartext_weak_tls_ingest_transport[_cleartext_weak_tls_ingest_transport_def] if {
    not input.server_certificate_validated
}

exposures contains _cleartext_weak_tls_ingest_transport_def if {
    count(cleartext_weak_tls_ingest_transport) > 0
}

_stolen_credentials_weak_rbac_on_the_siem_def := {
    "name": "Stolen credentials / weak RBAC on the SIEM",
    "description": "No MFA, shared or default admin credentials, or over-broad analyst roles let a valid-account adversary or insider read sensitive data and disable feeds or delete detection rules from inside the detection backbone. Audit logging of SIEM-self actions and access to audit logs (AU-9) bounds the damage.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

stolen_credentials_weak_rbac_on_the_siem[_stolen_credentials_weak_rbac_on_the_siem_def] if {
    not input.mfa_available
}

stolen_credentials_weak_rbac_on_the_siem[_stolen_credentials_weak_rbac_on_the_siem_def] if {
    not input.least_privilege_access_enforced
}

stolen_credentials_weak_rbac_on_the_siem[_stolen_credentials_weak_rbac_on_the_siem_def] if {
    input.shared_admin_accounts == true
}

stolen_credentials_weak_rbac_on_the_siem[_stolen_credentials_weak_rbac_on_the_siem_def] if {
    not input.default_accounts_removed_or_changed
}

stolen_credentials_weak_rbac_on_the_siem[_stolen_credentials_weak_rbac_on_the_siem_def] if {
    not input.audit_management_restricted_to_privileged_subset
}

exposures contains _stolen_credentials_weak_rbac_on_the_siem_def if {
    count(stolen_credentials_weak_rbac_on_the_siem) > 0
}

_internet_exposed_siem_ui_api_and_unpatched_rce_def := {
    "name": "Internet-exposed SIEM UI/API and unpatched RCE",
    "description": "The SIEM web UI / management/search API reachable from the public internet turns the detection backbone into a directly attackable target, and an unpatched instance is exploited via known SIEM CVEs (e.g. Splunk unsafe-deserialization RCE CVE-2024-53247) for full compromise of the detection capability.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_siem_ui_api_and_unpatched_rce[_internet_exposed_siem_ui_api_and_unpatched_rce_def] if {
    not input.edge_management_interfaces_not_internet_reachable
    input.unpatched_known_rce_cve == true
}

internet_exposed_siem_ui_api_and_unpatched_rce[_internet_exposed_siem_ui_api_and_unpatched_rce_def] if {
    not input.control_plane_api_not_publicly_exposed
    input.unpatched_known_rce_cve == true
}

internet_exposed_siem_ui_api_and_unpatched_rce[_internet_exposed_siem_ui_api_and_unpatched_rce_def] if {
    not input.edge_management_interfaces_not_internet_reachable
    not input.edge_appliance_patched_within_sla
}

exposures contains _internet_exposed_siem_ui_api_and_unpatched_rce_def if {
    count(internet_exposed_siem_ui_api_and_unpatched_rce) > 0
}

_log_flood_index_flooding_denial_of_service_def := {
    "name": "Log flood / index-flooding denial of service",
    "description": "High-volume log injection exhausts index storage or license, drops events, or buries real alerts in noise \u2014 blinding by overload. Bounded queues, per-source volume baselining, and spike alerting are absent, so a flood goes undetected.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

log_flood_index_flooding_denial_of_service[_log_flood_index_flooding_denial_of_service_def] if {
    not input.log_flood_overflow_protection
}

log_flood_index_flooding_denial_of_service[_log_flood_index_flooding_denial_of_service_def] if {
    not input.per_source_volume_baselining
}

log_flood_index_flooding_denial_of_service[_log_flood_index_flooding_denial_of_service_def] if {
    not input.log_storage_sized_for_retention
}

log_flood_index_flooding_denial_of_service[_log_flood_index_flooding_denial_of_service_def] if {
    not input.ddos_protection_in_place
}

exposures contains _log_flood_index_flooding_denial_of_service_def if {
    count(log_flood_index_flooding_denial_of_service) > 0
}

_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def := {
    "name": "Unmasked secrets/PII in the index; coverage and retention gaps",
    "description": "Credentials, tokens, and regulated PII indexed verbatim turn the SIEM into a high-value plaintext store an attacker mines after access (CWE-532), while missing log-source coverage, clock skew (timestomp-enabling), and too-short retention create forensic blind spots that destroy evidence.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Unmasked credentials/tokens indexed verbatim make the SIEM a plaintext credential store an attacker mines after access (T1552.001 Credentials In Files / Unsecured Credentials); CWE-532."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Clock skew enables timestomping (T1070.006) and too-short retention destroys evidence \u2014 both create forensic blind spots aligned to Indicator Removal."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    not input.secrets_masked_in_logs
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    not input.pii_excluded_from_logs
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    not input.security_events_fully_logged
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    input.log_retention_days < 90
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    not input.clocks_synced_to_trusted_time_source
}

unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps[_unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def] if {
    not input.encrypted_at_rest
}

exposures contains _unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps_def if {
    count(unmasked_secrets_pii_in_the_index_coverage_and_retention_gaps) > 0
}
