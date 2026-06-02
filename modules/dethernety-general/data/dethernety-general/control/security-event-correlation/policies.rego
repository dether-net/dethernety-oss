package _dt_built_in.countermeasures.security_event_correlation



_centralized_multi_source_log_aggregation_def := {
    "name": "Centralized multi-source log aggregation",
    "description": "Logs from every logging-capable asset class (host/EDR, network, identity/IdP, cloud, application) are forwarded into one central SIEM/data lake, establishing the correlation substrate so no single source is the only copy and cross-source analysis is possible at all. Effective coverage means each in-scope source class is actively forwarding with fresh last-seen timestamps; an un-onboarded class (e.g. identity or cloud) is a silent blind spot through which a multi-step attack escapes detection entirely.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit/centralized log collection is the mitigation identity of a multi-source aggregation control."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {
                "justification": "Network Traffic Analysis over centrally aggregated multi-source telemetry is the D3FEND defensive identity of this control."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Cross-source aggregation of identity/IdP, host and cloud logs into one substrate makes valid-account abuse visible across sources that single-source views miss."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Forwarding every source's logs into a central store so no single source is the only copy surfaces indicator-removal / log-tampering attempts that local deletion would otherwise hide."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

centralized_multi_source_log_aggregation[_centralized_multi_source_log_aggregation_def] if {
    input.centralized_log_aggregation == true
    input.required_log_source_classes_onboarded == true
}

countermeasures contains _centralized_multi_source_log_aggregation_def if {
    count(centralized_multi_source_log_aggregation) > 0
}

_cross_source_multi_stage_correlation_into_a_single_incident_def := {
    "name": "Cross-source multi-stage correlation into a single incident",
    "description": "Correlation rules stitch events ACROSS repositories and over time into one incident object (IdP brute-force, then host EDR alert, then remote-service lateral movement), surfacing multi-step attack chains invisible to any single-source rule. Protection is present when at least one enabled multi-datamodel rule exists per major attack chain (lateral movement T1021/T1078, C2 T1071, credential access T1110/T1003); only single-source rules means the chain is never linked.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Auditing/correlation of cross-source events is the catalog mitigation identity for surfacing multi-stage attack chains."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {
                "justification": "Network Traffic Analysis \u2014 cross-source correlation of event streams to detect chained activity."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTCD",
            "attributes": {
                "justification": "Network Traffic Community Deviation \u2014 multi-stage cross-source analysis surfacing anomalous chained behavior."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Cross-source multi-stage correlation links remote-service lateral movement to upstream stages."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid-account use in a chain is surfaced by stitching IdP and host/EDR events into one incident."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "C2 application-layer activity is correlated across sources as a stage in the multi-step chain."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

cross_source_multi_stage_correlation_into_a_single_incident[_cross_source_multi_stage_correlation_into_a_single_incident_def] if {
    input.cross_source_correlation_enabled == true
    input.multistage_incident_correlation_enabled == true
}

countermeasures contains _cross_source_multi_stage_correlation_into_a_single_incident_def if {
    count(cross_source_multi_stage_correlation_into_a_single_incident) > 0
}

_att_ck_mapped_detection_coverage_with_gap_measurement_def := {
    "name": "ATT&CK-mapped detection coverage with gap measurement",
    "description": "Every detection rule is tagged with MITRE ATT&CK technique IDs and an ATT&CK Navigator-style coverage heatmap is maintained and trended (e.g. % of in-scope techniques with at least one tested detection), turning detection from assumed to quantified with zero-coverage techniques tracked to closure. Without measurement, coverage is unknown and enterprise SIEMs are documented to miss ~79% of known techniques \u2014 the attacker simply uses an undetected TTP.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UBA",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "ATT&CK-mapped detection coverage with tracked gap closure ensures a tested detection exists for valid-account abuse rather than leaving it an unmeasured blind spot."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Quantified per-technique coverage with zero-coverage techniques tracked to closure ensures remote-services lateral movement is a measured, tested-detection technique rather than an undetected TTP."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

att_ck_mapped_detection_coverage_with_gap_measurement[_att_ck_mapped_detection_coverage_with_gap_measurement_def] if {
    input.detection_rules_attack_mapped == true
    input.attack_coverage_measured_and_trended == true
    input.attack_technique_coverage_pct >= 80
}

countermeasures contains _att_ck_mapped_detection_coverage_with_gap_measurement_def if {
    count(att_ck_mapped_detection_coverage_with_gap_measurement) > 0
}

_behavioral_and_ueba_anomaly_analytics_def := {
    "name": "Behavioral and UEBA anomaly analytics",
    "description": "Behavioral/UEBA analytics baseline normal user and entity activity (trained over a sufficient window) and flag deviations \u2014 impossible-travel logon, authentication-event thresholding, abnormal data transfer, account/credential-reuse anomalies \u2014 complementing static rules to catch novel and credential-abuse attacks signatures miss. Maps to D3FEND D3-UBA (D3-UGLPA geolocation, D3-ANET authentication thresholding); presence is the protection, static-rules-only is the gap that surfaces brute-force (T1110) and valid-account lateral movement (T1078).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UBA",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UGLPA",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-JFAPA",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DAM",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Impossible-travel geolocation analytics and access-pattern baselining detect valid-account abuse and lateral movement that bypass static signatures (D3-UGLPA / D3-UBA Detect facet)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Authentication-event thresholding and login-failure anomaly analysis detect brute-force and password-spray patterns (D3-JFAPA Detect facet)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {
                "justification": "Behavioral baselining of entity activity flags anomalous account-manipulation actions deviating from learned normal profiles (D3-UBA Detect facet)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

behavioral_and_ueba_anomaly_analytics[_behavioral_and_ueba_anomaly_analytics_def] if {
    input.ueba_anomaly_analytics_enabled == true
    input.entity_baseline_trained == true
    input.baseline_training_window_days >= 14
}

behavioral_and_ueba_anomaly_analytics[_behavioral_and_ueba_anomaly_analytics_def] if {
    input.impossible_travel_detection_enabled == true
}

behavioral_and_ueba_anomaly_analytics[_behavioral_and_ueba_anomaly_analytics_def] if {
    input.authentication_thresholding_enabled == true
}

countermeasures contains _behavioral_and_ueba_anomaly_analytics_def if {
    count(behavioral_and_ueba_anomaly_analytics) > 0
}

_detection_as_code_rule_lifecycle_and_content_currency_def := {
    "name": "Detection-as-code rule lifecycle and content currency",
    "description": "Correlation content lives in version control (e.g. Sigma) with peer-reviewed PRs, automated syntax/unit/integration testing in CI/CD, rollback, AND a scheduled update cadence against evolving TTPs (vendor content packs, community Sigma, new CVEs) so rules are reviewed, tested, auditable, and current. Satisfies CM-2/CM-3 change-control; hand-edited console rules frozen at install time silently lose coverage as attackers shift, and the SIEM platform itself must be kept patch-current against RCE/auth CVEs that would let an attacker become the breach.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Audit (M1047): detection-as-code lifecycle keeps correlation content version-controlled, peer-reviewed, CI-tested, and currency-refreshed so detection coverage is continuously audited and maintained against drift."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Current, tested, version-controlled correlation content (vs frozen hand-edited console rules) preserves the detections that surface Indicator Removal / log-tampering activity (T1070) instead of silently losing coverage as attacker TTPs evolve."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

detection_as_code_rule_lifecycle_and_content_currency[_detection_as_code_rule_lifecycle_and_content_currency_def] if {
    input.detection_as_code_version_controlled == true
    input.detection_content_peer_reviewed == true
    input.detection_content_ci_tested == true
    input.detection_content_update_cadence_days <= 90
}

countermeasures contains _detection_as_code_rule_lifecycle_and_content_currency_def if {
    count(detection_as_code_rule_lifecycle_and_content_currency) > 0
}

_synchronized_time_for_reliable_event_sequencing_def := {
    "name": "Synchronized time for reliable event sequencing",
    "description": "All log sources synchronize to at least two approved NTP sources with timestamps normalized to UTC at ingest, so multi-stage correlation can order events across sources reliably. Satisfies CIS 8.4 and AU-8; clock drift or mixed timezones mis-orders the events of a chain and makes cross-source correlation unreliable or impossible, breaking the core protection silently.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Synchronized clocks and UTC-normalized timestamps preserve a reliable, orderable cross-source event timeline, so timestamp manipulation or selective log deletion (Indicator Removal) leaves detectable gaps and mis-orderings in the correlated chain rather than silently breaking sequencing."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

synchronized_time_for_reliable_event_sequencing[_synchronized_time_for_reliable_event_sequencing_def] if {
    input.clocks_synced_to_trusted_time_source == true
    input.timestamps_in_utc == true
}

countermeasures contains _synchronized_time_for_reliable_event_sequencing_def if {
    count(synchronized_time_for_reliable_event_sequencing) > 0
}

_risk_based_alerting_with_threat_intel_enrichment_def := {
    "name": "Risk-based alerting with threat-intel enrichment",
    "description": "Events and entities are enriched with threat intelligence (known-bad IPs/domains/hashes) and asset/identity context, then assigned risk scores so an investigative notable is raised only when accumulated risk crosses a threshold rather than one-alert-per-rule. This is the false-positive-management protection (AU-6(5) integrated analysis) that keeps analysts effective and ensures multi-step chains are scored and prioritized accurately; raw per-rule alerting buries real correlated incidents in fatigue.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "Threat-intel enrichment of network observables against known-bad C2 IPs/domains plus accumulated-risk scoring surfaces application-layer command-and-control channels that per-rule alerting would miss."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003",
            "attributes": {
                "justification": "Risk-based correlation enriched with asset/identity context accumulates the signals of OS credential-dumping activity into a prioritized notable rather than isolated low-confidence per-rule alerts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

risk_based_alerting_with_threat_intel_enrichment[_risk_based_alerting_with_threat_intel_enrichment_def] if {
    input.threat_intel_enrichment_enabled == true
    input.risk_based_alerting_enabled == true
    input.alert_tuning_process_enabled == true
}

countermeasures contains _risk_based_alerting_with_threat_intel_enrichment_def if {
    count(risk_based_alerting_with_threat_intel_enrichment) > 0
}

_alerting_sla_soar_handoff_and_protected_evidence_retention_def := {
    "name": "Alerting SLA, SOAR handoff, and protected evidence retention",
    "description": "Surfaced incidents auto-route to the IR queue/SOAR within a defined response-time SLA (IR-4/IR-5) so detection actually reduces dwell time, AND the correlated-event substrate survives: logs stored on a separate system, integrity-protected (write-once/cryptographic) and access-restricted (AU-9(2)/(3)/(4)), retained at least 90 days hot (CIS 8.10) so slow campaigns can be reconstructed and an attacker who reaches the SIEM cannot erase the multi-step trail (T1070).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Auditing / centralized integrity-protected log retention is the ATT&CK mitigation identity for ensuring the correlation substrate survives and remains analyzable."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UBA",
            "attributes": {
                "justification": "User behavior analysis over the retained, integrity-protected event substrate underpins detection-to-response handoff in this control."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {
                "justification": "Write-once/cryptographic tamper-evidence and access-restricted, off-system retention harden the substrate so an attacker cannot erase the multi-step trail (Indicator Removal)."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "SLA-bound auto-routing and SOAR handoff of correlated notables ensures valid-account abuse surfaced by correlation is actioned promptly rather than lost."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

alerting_sla_soar_handoff_and_protected_evidence_retention[_alerting_sla_soar_handoff_and_protected_evidence_retention_def] if {
    input.alert_response_sla_enforced == true
    input.soar_response_handoff_enabled == true
    input.audit_log_tamper_evident == true
    input.log_retention_days >= 90
}

countermeasures contains _alerting_sla_soar_handoff_and_protected_evidence_retention_def if {
    count(alerting_sla_soar_handoff_and_protected_evidence_retention) > 0
}
