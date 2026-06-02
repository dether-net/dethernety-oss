package _dt_built_in.countermeasures.endpoint_detection_response



_edr_agent_present_on_all_endpoints_with_tamper_protection_def := {
    "name": "EDR agent present on all endpoints with tamper protection",
    "description": "A healthy EDR/anti-malware agent is deployed and checked-in on 100% of inventoried endpoints (coverage reconciled to the asset inventory), and agent self-/tamper-protection prevents users, local admins, or malware from disabling, uninstalling, or altering it. Closes the coverage gap and the Impair-Defenses (T1562.001) evasion path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1049",
            "attributes": {
                "justification": "EDR/anti-malware agent deployed on all inventoried endpoints is the Antivirus/Antimalware mitigation (M1049)."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1040",
            "attributes": {
                "justification": "Behavior Prevention on Endpoint (M1040) \u2014 the tamper-protected behavioral agent prevents malicious on-host activity."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PA",
            "attributes": {
                "justification": "EDR Process Analysis (D3-PA) is the D3FEND identity of the on-endpoint behavioral agent."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {
                "justification": "Agent self-/tamper-protection prevents users, admins, or malware from disabling or modifying the security tool, mitigating Impair Defenses: Disable or Modify Tools (T1562.001)."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {
                "justification": "Tamper protection hardens the endpoint defensive tooling against disablement/modification (D3FEND Harden facet) \u2014 protects against Impair Defenses (T1562.001)."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

edr_agent_present_on_all_endpoints_with_tamper_protection[_edr_agent_present_on_all_endpoints_with_tamper_protection_def] if {
    input.edr_agent_active_with_tamper_protection == true
    input.edr_agent_active_with_tamper_protection == true
}

countermeasures contains _edr_agent_present_on_all_endpoints_with_tamper_protection_def if {
    count(edr_agent_present_on_all_endpoints_with_tamper_protection) > 0
}

_real_time_behavioral_detection_enabled_def := {
    "name": "Real-time behavioral detection enabled",
    "description": "Real-time behavioral/heuristic detection of malicious execution behavior (process injection, suspicious spawn lineage, script execution) is enabled rather than signature-only matching, so novel and stealthy malware is caught. Maps to D3FEND Process Analysis (D3-PA) and ATT&CK mitigation M1040, defending against T1059, T1055, and T1204.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1040",
            "attributes": {
                "justification": "Behavior Prevention on Endpoint \u2014 the ATT&CK mitigation identity of real-time behavioral/heuristic detection of malicious execution behavior."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PA",
            "attributes": {
                "justification": "D3FEND Process Analysis \u2014 observes running processes for adversary behavior (process spawn/lineage, self-modification), the defensive identity of behavioral detection."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SEA",
            "attributes": {
                "justification": "D3FEND Script Execution Analysis \u2014 behavioral detection of malicious script/interpreter execution, a sub-facet of this control's detection identity."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059",
            "attributes": {
                "justification": "Command and Scripting Interpreter \u2014 behavioral Script Execution Analysis (D3-SEA, a Detect facet) catches malicious interpreter/script execution at runtime."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055",
            "attributes": {
                "justification": "Process Injection \u2014 behavioral Process Analysis (D3-PA, a Detect facet) flags anomalous injection/self-modification behavior in legitimate processes."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204",
            "attributes": {
                "justification": "User Execution \u2014 behavioral detection (Detect facet) evaluates payload behavior on execution to catch user-run malware that signature-only scanning misses."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

real_time_behavioral_detection_enabled[_real_time_behavioral_detection_enabled_def] if {
    input.behavior_monitoring_enabled == true
    input.realtime_protection_enabled == true
}

countermeasures contains _real_time_behavioral_detection_enabled_def if {
    count(real_time_behavioral_detection_enabled) > 0
}

_anti_ransomware_mass_change_detection_and_rollback_enabled_def := {
    "name": "Anti-ransomware mass-change detection and rollback enabled",
    "description": "Behavioral anti-ransomware rules detect mass file-modification/encryption patterns and halt + isolate the offending process before widespread encryption, with remediation/rollback restoring files to a known-good state. Mitigates Data Encrypted for Impact (T1486 via M1040); grounded in real ransomware campaigns DeadBolt (CVE-2022-27593) and Qlocker (CVE-2021-28799).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1040",
            "attributes": {
                "justification": "Behavior Prevention on Endpoint \u2014 EDR behavioral anti-ransomware rules block mass-encryption process behavior; the control's ATT&CK mitigation identity."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-FA",
            "attributes": {
                "justification": "D3FEND File Analysis \u2014 analysis of file modification/encryption behavior underpins anti-ransomware mass-change detection; the control's D3FEND identity."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1486",
            "attributes": {
                "justification": "Data Encrypted for Impact \u2014 behavioral mass-change detection halts and isolates the encrypting process and rollback restores files to known-good, directly mitigating ransomware encryption."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

anti_ransomware_mass_change_detection_and_rollback_enabled[_anti_ransomware_mass_change_detection_and_rollback_enabled_def] if {
    input.ransomware_mass_change_detection_enabled == true
    input.endpoint_remediation_rollback_enabled == true
}

countermeasures contains _anti_ransomware_mass_change_detection_and_rollback_enabled_def if {
    count(anti_ransomware_mass_change_detection_and_rollback_enabled) > 0
}

_automated_containment_and_host_isolation_enabled_def := {
    "name": "Automated containment and host isolation enabled",
    "description": "On a confirmed detection the agent can automatically (or via one-click SOC action) isolate/quarantine the host from the network while preserving the management channel, stopping lateral spread and C2. Maps to D3FEND Network Isolation (D3-NI) / Execution Isolation (D3-EI) and NIST SP 800-83r1 \u00a74.3.2/\u00a74.3.4 containment guidance.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NI",
            "attributes": {
                "justification": "Detection-triggered host network isolation/quarantine that severs lateral movement and C2 while preserving the management channel is the D3FEND Isolate-tactic technique Network Isolation (D3-NI), per the dossier config_surface mapping and NIST SP 800-83r1 \u00a74.3.4."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EI",
            "attributes": {
                "justification": "Endpoint containment that isolates/quarantines malicious execution on the host is the D3FEND Isolate-tactic technique Execution Isolation (D3-EI), per the dossier config_surface mapping for automated_containment_host_isolation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

automated_containment_and_host_isolation_enabled[_automated_containment_and_host_isolation_enabled_def] if {
    input.automated_host_isolation_enabled == true
    input.endpoint_containment_response_enabled == true
}

countermeasures contains _automated_containment_and_host_isolation_enabled_def if {
    count(automated_containment_and_host_isolation_enabled) > 0
}

_application_allowlisting_execution_control_enforced_def := {
    "name": "Application allowlisting / execution control enforced",
    "description": "Application allowlisting / execution control restricts which executables and scripts may run, blocking unauthorized or unknown code before signatures exist (defense-in-depth beyond detection). Maps to D3FEND Executable Allowlisting (D3-EAL) / Denylisting (D3-EDL) and ATT&CK mitigation M1038; NIST SP 800-83r1 \u00a73.4.5.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1038",
            "attributes": {
                "justification": "Application allowlisting / execution control IS the ATT&CK Execution Prevention mitigation (M1038): only approved executables and scripts may run."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EAL",
            "attributes": {
                "justification": "Execution control implemented as a positive allowlist maps to D3FEND Executable Allowlisting (D3-EAL)."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204",
            "attributes": {
                "justification": "Allowlisting blocks user-executed malicious files/payloads that are not on the approved list, countering User Execution (T1204)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059",
            "attributes": {
                "justification": "Execution control restricts which scripts and interpreters may run, countering Command and Scripting Interpreter abuse (T1059)."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

application_allowlisting_execution_control_enforced[_application_allowlisting_execution_control_enforced_def] if {
    input.application_allowlisting_enforced == true
}

countermeasures contains _application_allowlisting_execution_control_enforced_def if {
    count(application_allowlisting_execution_control_enforced) > 0
}

_detection_content_and_engine_kept_current_def := {
    "name": "Detection content and engine kept current",
    "description": "Signature, engine, and threat-intel updates are pulled automatically from the vendor on a frequent cadence so newly-discovered threats are recognized; stale or manual-only updates leave a detection gap. Required by CIS Controls v8 Control 10 (automatic vendor content updates) and NIST SP 800-83r1 \u00a73.4.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1049",
            "attributes": {
                "justification": "Keeping anti-malware signatures, engine, and threat intelligence current via automatic vendor updates is the operational core of ATT&CK mitigation M1049 (Antivirus/Antimalware): up-to-date detection content lets the EDR recognize newly-discovered malware. CIS Control 10; NIST SP 800-83r1 \u00a73.4."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

detection_content_and_engine_kept_current[_detection_content_and_engine_kept_current_def] if {
    input.threat_signatures_current == true
}

countermeasures contains _detection_content_and_engine_kept_current_def if {
    count(detection_content_and_engine_kept_current) > 0
}

_centralized_telemetry_forwarded_to_monitored_siem_soc_def := {
    "name": "Centralized telemetry forwarded to monitored SIEM/SOC",
    "description": "EDR alerts and endpoint telemetry are centrally collected, retained (>= 90 days), and forwarded to a SIEM for cross-host correlation, with a monitored response function (in-house SOC or MDR) triaging and acting on detections under defined SLAs rather than leaving alerts unhandled. Grounded in CIS Control 13 and NIST SP 800-83r1 \u00a74.1/\u00a74.2.3.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "responds_with": [],
    "attack_vector": "NETWORK"
}

centralized_telemetry_forwarded_to_monitored_siem_soc[_centralized_telemetry_forwarded_to_monitored_siem_soc_def] if {
    input.endpoint_audit_logs_centralised == true
    input.monitored_response_function_present == true
}

countermeasures contains _centralized_telemetry_forwarded_to_monitored_siem_soc_def if {
    count(centralized_telemetry_forwarded_to_monitored_siem_soc) > 0
}
