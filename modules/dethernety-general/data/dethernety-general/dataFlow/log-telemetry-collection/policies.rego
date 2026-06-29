package _dt_built_in.exposures.log_telemetry_collection



_cleartext_log_transport_sniffing_and_disclosure_def := {
    "name": "Cleartext log transport (sniffing and disclosure)",
    "description": "Plain syslog (UDP/TCP 514) or unencrypted OTLP exposes event bodies \u2014 credentials, PII, session data \u2014 to any on-path observer. RFC 5425 names disclosure as a primary threat to syslog transport.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_log_transport_sniffing_and_disclosure[_cleartext_log_transport_sniffing_and_disclosure_def] if {
    not input.flow_tls_encrypted
}

exposures contains _cleartext_log_transport_sniffing_and_disclosure_def if {
    count(cleartext_log_transport_sniffing_and_disclosure) > 0
}

_mitm_modification_of_events_in_transit_def := {
    "name": "MITM modification of events in transit",
    "description": "Without TLS plus integrity protection, an on-path attacker rewrites, drops, or injects events to hide a campaign \u2014 the RFC 5425 'modification' threat and a direct enabler of ATT&CK T1565.002 transmitted-data manipulation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {
                "justification": "Transmitted Data Manipulation \u2014 the direct ATT&CK mapping for an on-path rewrite of events in transit."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle \u2014 the umbrella technique establishing the on-path position required to modify events."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

mitm_modification_of_events_in_transit[_mitm_modification_of_events_in_transit_def] if {
    not input.server_certificate_validated
}

mitm_modification_of_events_in_transit[_mitm_modification_of_events_in_transit_def] if {
    not input.log_pipeline_integrity_protected
}

exposures contains _mitm_modification_of_events_in_transit_def if {
    count(mitm_modification_of_events_in_transit) > 0
}

_forwarder_masquerade_spoofed_log_source_def := {
    "name": "Forwarder masquerade / spoofed log source",
    "description": "Without mTLS or unique per-workload identity, an attacker pushes fabricated events to poison the SIEM or impersonate another workload's logs, defeating non-repudiation (OWASP ASVS V7) and enabling T1565.001.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "attributes": {
                "justification": "Stored Data Manipulation \u2014 fabricated/spoofed events poison the SIEM's stored audit record, manipulating the data investigators rely on."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

forwarder_masquerade_spoofed_log_source[_forwarder_masquerade_spoofed_log_source_def] if {
    not input.service_to_service_mtls_enforced
}

forwarder_masquerade_spoofed_log_source[_forwarder_masquerade_spoofed_log_source_def] if {
    not input.identity_propagated_cryptographically
}

exposures contains _forwarder_masquerade_spoofed_log_source_def if {
    count(forwarder_masquerade_spoofed_log_source) > 0
}

_secrets_and_pii_leakage_into_log_bodies_cwe_532_def := {
    "name": "Secrets and PII leakage into log bodies (CWE-532)",
    "description": "Tokens, passwords, PAN, JWTs end up in event payloads because redaction is absent or only enforced at the central SIEM after exposure. Violates OWASP ASVS V7 and PCI DSS Req 3.4/10; enables T1552.001 credential-in-files harvesting from the log store.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_and_pii_leakage_into_log_bodies_cwe_532[_secrets_and_pii_leakage_into_log_bodies_cwe_532_def] if {
    not input.secrets_masked_in_logs
}

secrets_and_pii_leakage_into_log_bodies_cwe_532[_secrets_and_pii_leakage_into_log_bodies_cwe_532_def] if {
    not input.pii_excluded_from_logs
}

exposures contains _secrets_and_pii_leakage_into_log_bodies_cwe_532_def if {
    count(secrets_and_pii_leakage_into_log_bodies_cwe_532) > 0
}

_indicator_removal_at_destination_mutable_log_archive_def := {
    "name": "Indicator removal at destination \u2014 mutable log archive",
    "description": "Without WORM / S3 Object Lock / append-only indices, a compromised admin or attacker silently deletes or rewrites history (ATT&CK T1070), defeating forensics. NIST AU-9 requires audit information be protected from unauthorized modification.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Indicator Removal \u2014 without WORM / Object Lock / append-only storage at the log archive, an adversary with admin access deletes or rewrites event history to defeat forensics; this attestation directly counters T1070's destination-side variants."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

indicator_removal_at_destination_mutable_log_archive[_indicator_removal_at_destination_mutable_log_archive_def] if {
    not input.audit_log_tamper_evident
}

exposures contains _indicator_removal_at_destination_mutable_log_archive_def if {
    count(indicator_removal_at_destination_mutable_log_archive) > 0
}

_silent_collection_failure_no_dead_man_switch_alarm_def := {
    "name": "Silent collection failure \u2014 no dead-man-switch alarm",
    "description": "Adversary disables the local forwarder or chokes the pipeline (T1562.006 Indicator Blocking); without alerting on source silence / ingest-rate drop, the SIEM goes blind without anyone noticing. NIST AU-5 requires response to audit-processing failures.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

silent_collection_failure_no_dead_man_switch_alarm[_silent_collection_failure_no_dead_man_switch_alarm_def] if {
    not input.logging_failure_alerting_enabled
}

exposures contains _silent_collection_failure_no_dead_man_switch_alarm_def if {
    count(silent_collection_failure_no_dead_man_switch_alarm) > 0
}

_backdated_clock_skewed_events_break_correlation_def := {
    "name": "Backdated / clock-skewed events break correlation",
    "description": "Without UTC timestamps and bounded NTP-synced clock skew, an attacker backdates evasion-window events or shifts timelines so cross-source correlation fails (T1070.006 timestomp-adjacent). NIST SP 800-92 \u00a74.4 mandates time sync.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.006",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

backdated_clock_skewed_events_break_correlation[_backdated_clock_skewed_events_break_correlation_def] if {
    not input.clocks_synced_to_trusted_time_source
}

backdated_clock_skewed_events_break_correlation[_backdated_clock_skewed_events_break_correlation_def] if {
    not input.timestamps_in_utc
}

exposures contains _backdated_clock_skewed_events_break_correlation_def if {
    count(backdated_clock_skewed_events_break_correlation) > 0
}

_telemetry_flood_dos_of_siem_ingest_def := {
    "name": "Telemetry flood \u2014 DoS of SIEM ingest",
    "description": "A compromised or noisy source emits at unbounded rate; absent rate limits, bounded queues, and backpressure (OpenTelemetry memory_limiter / sending_queue), the SIEM drops other tenants' signal or crashes (T1499) \u2014 an availability attack that doubles as evasion cover.",
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
        }
    ],
    "attack_vector": "NETWORK"
}

telemetry_flood_dos_of_siem_ingest[_telemetry_flood_dos_of_siem_ingest_def] if {
    not input.log_flood_overflow_protection
}

exposures contains _telemetry_flood_dos_of_siem_ingest_def if {
    count(telemetry_flood_dos_of_siem_ingest) > 0
}
