package _dt_built_in.countermeasures.intrusion_detection_system



_sensor_coverage_at_chokepoints_and_critical_hosts_def := {
    "name": "Sensor coverage at chokepoints and critical hosts",
    "description": "Network IDS sensors are positioned at all major ingress/egress and inter-zone chokepoints, and host-based sensors run on critical hosts, so traffic to and from critical assets (including east-west) is actually inspected with no unmonitored path. The detection engine is enabled and actively analyzing, not installed-but-passive.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
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
            "value": "T1210",
            "attributes": {
                "justification": "Chokepoint NIDS plus HIDS on critical hosts inspects the (incl. east-west) traffic and host activity through which remote-service exploitation traverses, surfacing it where a perimeter-only deployment would be blind \u2014 D3FEND D3-NTA Detect facet."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "Full sensor coverage at chokepoints sees the connection-attempt / port-scan patterns of network service discovery across monitored segments \u2014 D3FEND D3-NTA connection-attempt analysis, Detect facet."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

sensor_coverage_at_chokepoints_and_critical_hosts[_sensor_coverage_at_chokepoints_and_critical_hosts_def] if {
    input.nids_sensor_coverage_at_chokepoints == true
    input.hids_on_critical_hosts == true
}

countermeasures contains _sensor_coverage_at_chokepoints_and_critical_hosts_def if {
    count(sensor_coverage_at_chokepoints_and_critical_hosts) > 0
}

_signature_detection_enabled_with_current_rulesets_def := {
    "name": "Signature detection enabled with current rulesets",
    "description": "Signature/detection rulesets are loaded with relevant categories enabled (exploits, C2, scanning, lateral movement) and kept current via automatic, frequent (at least daily) updates, so the engine matches newly-weaponized exploits rather than running an empty, default-only, or stale ruleset.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTSA",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "Current signature rulesets with C2/application-layer categories enabled let the IDS flag command-and-control beaconing over web protocols (D3-NTSA signature analysis), which a stale or empty ruleset would miss."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Loaded exploit-category signatures kept current via daily updates let the IDS detect exploitation attempts against public-facing applications in chokepoint traffic before or during compromise."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

signature_detection_enabled_with_current_rulesets[_signature_detection_enabled_with_current_rulesets_def] if {
    input.detection_rules_present_and_enabled == true
    input.threat_signatures_current == true
}

countermeasures contains _signature_detection_enabled_with_current_rulesets_def if {
    count(signature_detection_enabled_with_current_rulesets) > 0
}

_anomaly_and_behavioral_detection_complementing_signatures_def := {
    "name": "Anomaly and behavioral detection complementing signatures",
    "description": "Anomaly/behavioral (baseline-deviation, NBA, protocol-anomaly) detection runs alongside signatures and is fed by network flow telemetry (NetFlow/IPFIX/flow logs), so novel, zero-day, and slow-and-low activity that no signature matches is still flagged and connection records exist for hunting.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {
                "justification": "Network Intrusion Prevention \u2014 the ATT&CK mitigation identity of the IDS/IDPS detection control whose behavioral/flow-analytics facet this rule attests."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTCD",
            "attributes": {
                "justification": "Network Traffic Community Deviation \u2014 statistical inter-community flow-deviation analysis, the D3FEND identity of behavioral/anomaly detection fed by flow telemetry."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ANAA",
            "attributes": {
                "justification": "Administrative Network Activity Analysis \u2014 baseline-deviation detection of anomalous activity, complementing signature analysis as this facet provides."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "Behavioral/flow-deviation analytics (D3-NTCD/D3-ANAA Detect facet) surface Network Service Discovery / scanning patterns that no inbound signature matches."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1041",
            "attributes": {
                "justification": "Volume/flow anomalies over established baselines (D3-NTCD Detect facet) flag Exfiltration Over C2 Channel that policy allows but connection behavior betrays."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

anomaly_and_behavioral_detection_complementing_signatures[_anomaly_and_behavioral_detection_complementing_signatures_def] if {
    input.behavior_monitoring_enabled == true
    input.network_flow_logging_enabled == true
}

countermeasures contains _anomaly_and_behavioral_detection_complementing_signatures_def if {
    count(anomaly_and_behavioral_detection_complementing_signatures) > 0
}

_encrypted_traffic_visibility_def := {
    "name": "Encrypted-traffic visibility",
    "description": "The IDS retains visibility into TLS traffic via decryption/inspection at the chokepoint or via host-based sensors that see cleartext on the endpoint, closing the encrypted-traffic blind spot where signature analysis otherwise suffers false negatives.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
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
            "value": "T1071.001",
            "attributes": {
                "justification": "TLS inspection / host-sensor visibility lets network traffic analysis observe C2 over web protocols that would otherwise be hidden inside encryption."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573",
            "attributes": {
                "justification": "Decryption at the chokepoint or host-based cleartext visibility closes the encrypted-channel blind spot, restoring detection of activity tunneled through an encrypted channel."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

encrypted_traffic_visibility[_encrypted_traffic_visibility_def] if {
    input.tls_inspection_enabled == true
}

countermeasures contains _encrypted_traffic_visibility_def if {
    count(encrypted_traffic_visibility) > 0
}

_alerts_aggregated_and_acted_on_under_sla_def := {
    "name": "Alerts aggregated and acted on under SLA",
    "description": "IDS/IPS alerts and logs are forwarded to a centralized, monitored SIEM/SOC and feed a triage/escalation runbook with defined response SLAs, so detection translates into response rather than alerts accumulating unread on the sensor. Clocks are NTP-synchronized so multi-sensor timestamps correlate during investigation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
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
            "value": "T1041",
            "attributes": {
                "justification": "Centralized aggregation of IDS flow/volume alerts into a monitored SIEM/SOC, with time-correlated multi-sensor timestamps and an SLA-bound triage process, surfaces the outbound volume/flow anomalies that betray exfiltration over the C2 channel (T1041) \u2014 D3-NTA network-traffic analysis turned into acted-upon detection."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

alerts_aggregated_and_acted_on_under_sla[_alerts_aggregated_and_acted_on_under_sla_def] if {
    input.centralized_log_aggregation == true
    input.monitored_response_function_present == true
    input.clocks_synced_to_trusted_time_source == true
}

countermeasures contains _alerts_aggregated_and_acted_on_under_sla_def if {
    count(alerts_aggregated_and_acted_on_under_sla) > 0
}

_detection_tuned_for_accuracy_def := {
    "name": "Detection tuned for accuracy",
    "description": "The IDS is tuned per-environment with documented suppression/threshold rationale and periodic alert-quality review, keeping the false-positive rate low enough that analysts act on alerts while the over-suppression false-negative rate stays acceptable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

detection_tuned_for_accuracy[_detection_tuned_for_accuracy_def] if {
    input.ids_detection_tuned_and_reviewed == true
}

countermeasures contains _detection_tuned_for_accuracy_def if {
    count(detection_tuned_for_accuracy) > 0
}

_sensor_integrity_and_fail_safe_behavior_def := {
    "name": "Sensor integrity and fail-safe behavior",
    "description": "The IDPS itself is hardened (restricted management access, patched), has a deliberate fail-open/fail-closed decision for inline deployments, and its health/heartbeat is monitored, so a compromised or silently-dead sensor does not blind detection.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
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
            "value": "D3-PM",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "attributes": {
                "justification": "Sensor-health/heartbeat monitoring (D3-PM Platform Monitoring) detects when the IDPS sensor is disabled or impaired \u2014 the platform-monitoring facet surfaces a silently-dead or attacker-killed sensor, the network-device-defense-impairment pattern of T1562.013."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "attributes": {
                "justification": "Auditing the hardened/patched sensor and its defined fail behavior (M1047 Audit) reduces the chance an adversary can quietly disable or modify the inline network-defense device (T1562.013) without the impairment being recorded and reviewed."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

sensor_integrity_and_fail_safe_behavior[_sensor_integrity_and_fail_safe_behavior_def] if {
    input.ids_sensor_hardened_and_patched == true
    input.ids_sensor_fail_mode_defined == true
    input.ids_sensor_health_monitored == true
}

countermeasures contains _sensor_integrity_and_fail_safe_behavior_def if {
    count(sensor_integrity_and_fail_safe_behavior) > 0
}
