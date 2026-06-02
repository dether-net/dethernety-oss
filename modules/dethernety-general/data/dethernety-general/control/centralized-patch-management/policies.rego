package _dt_built_in.countermeasures.centralized_patch_management



_automated_patch_deployment_on_cadence_def := {
    "name": "Automated patch deployment on cadence",
    "description": "The control enforces automated operating-system AND application patch management running on a defined monthly-or-more-frequent schedule (CIS 7.3/7.4, every <=30 days), so known-vulnerability windows are closed systematically rather than left to ad-hoc manual patching. Presence of an automated patch job on cadence is what removes the standing vulnerable surface that wormable RCEs and KEV exploits target.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "attributes": {
                "justification": "Centralized patch management IS ATT&CK mitigation M1051 (Update Software) \u2014 automated, scheduled deployment of OS and application patches across enterprise assets."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SU",
            "attributes": {
                "justification": "Automated patch deployment on cadence is the D3FEND Software Update (D3-SU) defensive technique \u2014 replacing outdated software to remove known-vulnerability surface."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Deploying OS/application patches on a <=30-day cadence closes the known-vulnerability window that Exploit Public-Facing Application (T1190) targets (per M1051 mapping)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Automated patching removes the standing vulnerable surface in remote/network services that Exploitation of Remote Services (T1210) \u2014 including wormable RCEs \u2014 relies on (per M1051 mapping)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {
                "justification": "Keeping OS, applications, and drivers current eliminates the vulnerable components that Exploitation for Privilege Escalation (T1068) abuses (per M1051 mapping)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

automated_patch_deployment_on_cadence[_automated_patch_deployment_on_cadence_def] if {
    input.automated_os_patch_management_enabled == true
    input.automated_application_patch_management_enabled == true
    input.os_patch_deployment_cadence_days <= 30
}

countermeasures contains _automated_patch_deployment_on_cadence_def if {
    count(automated_patch_deployment_on_cadence) > 0
}

_risk_based_critical_sla_and_emergency_out_of_band_patch_path_def := {
    "name": "Risk-based critical-SLA and emergency out-of-band patch path",
    "description": "The control enforces a documented risk-based remediation timeline that assigns shorter windows to higher-severity/actively-exploited vulnerabilities, plus an emergency out-of-band maintenance plan that fast-tracks KEV/zero-day fixes (M1051 ~24h) outside the routine cycle. Presence of this expedited path is what shrinks the exposure window for actively-exploited CVEs instead of making them wait for the next monthly run.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SU",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A short critical-patch SLA plus an emergency out-of-band path shrinks the window during which a public-facing application stays on a known-vulnerable version, removing the unpatched surface attackers exploit for initial access (M1051; KEV CVEs e.g. CVE-2024-3400, CVE-2024-21762)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Fast-tracking patches for actively-exploited CVEs closes the known-vulnerability window in remote services before adversaries can exploit them for lateral movement / remote-service exploitation."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {
                "justification": "Deploying critical fixes within a short risk-based SLA removes the vulnerable code paths adversaries leverage for exploitation-for-privilege-escalation (M1051 applies vendor patches across OS, applications, drivers, and firmware)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

risk_based_critical_sla_and_emergency_out_of_band_patch_path[_risk_based_critical_sla_and_emergency_out_of_band_patch_path_def] if {
    input.emergency_out_of_band_patch_path == true
    input.critical_patch_window_days <= 7
}

countermeasures contains _risk_based_critical_sla_and_emergency_out_of_band_patch_path_def if {
    count(risk_based_critical_sla_and_emergency_out_of_band_patch_path) > 0
}

_complete_patch_coverage_across_the_asset_and_software_inventory_def := {
    "name": "Complete patch coverage across the asset and software inventory",
    "description": "The control enforces that patch-management coverage is reconciled against the authoritative enterprise asset (CIS Control 1) and software (CIS Control 2) inventory \u2014 including firmware, network/edge appliances, third-party/dependency software, and management agents \u2014 so no enrolled-but-unmanaged or off-inventory asset becomes an unpatched exposure. Presence of near-zero coverage gaps is what keeps appliances, data-tier services, and infrastructure software from being left behind on vulnerable versions.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.3,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SU",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AI",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Reconciling patch coverage against the full asset/software inventory removes unpatched, enrolled-but-unmanaged services that adversaries exploit to move laterally via remote services (e.g. wormable RCE on unpatched OS/appliance services)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.002",
            "attributes": {
                "justification": "Including firmware and network/edge appliances in patch scope removes outdated firmware that adversaries target to implant component firmware persistence."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1495",
            "attributes": {
                "justification": "Tracking and patching firmware/appliance currency reduces exposure to firmware corruption (M1051 maps to T1495 \u2014 update firmware to protect against corruption of vulnerable versions)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

complete_patch_coverage_across_the_asset_and_software_inventory[_complete_patch_coverage_across_the_asset_and_software_inventory_def] if {
    input.patch_coverage_of_inventory_complete == true
    input.firmware_and_network_device_patch_coverage == true
    input.third_party_and_agent_patch_coverage == true
}

countermeasures contains _complete_patch_coverage_across_the_asset_and_software_inventory_def if {
    count(complete_patch_coverage_across_the_asset_and_software_inventory) > 0
}

_vulnerability_scanning_feeds_risk_based_prioritization_def := {
    "name": "Vulnerability scanning feeds risk-based prioritization",
    "description": "The control enforces automated vulnerability scanning on cadence (authenticated internal <=quarterly, external <=monthly per CIS 7.5/7.6) whose findings drive remediation priority (7.7), so the program patches what is actually exposed and exploitable first. Presence of scanning wired into prioritization is what ensures the patch effort tracks real exposure rather than a blind schedule.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1016",
            "attributes": {
                "justification": "ATT&CK Mitigation M1016 (Vulnerability Scanning) is the catalog identity of this protection facet \u2014 automated scanning whose findings drive risk-based remediation prioritization."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-AVE",
            "attributes": {
                "justification": "D3FEND D3-AVE (Asset Vulnerability Enumeration) is the defensive technique this facet implements \u2014 enumerating vulnerabilities across assets so remediation can be prioritized by actual exposure."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Scanning-driven prioritization shrinks the known-vulnerability exposure window on public-facing applications by ensuring exploitable, internet-reachable findings are remediated first (CIS 7.5/7.6/7.7)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Authenticated internal scanning on cadence surfaces exploitable remote-service vulnerabilities on internal hosts so they are prioritized for patching before they can be exploited for lateral movement."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

vulnerability_scanning_feeds_risk_based_prioritization[_vulnerability_scanning_feeds_risk_based_prioritization_def] if {
    input.vulnerability_scanning_feeds_prioritization == true
}

vulnerability_scanning_feeds_risk_based_prioritization[_vulnerability_scanning_feeds_risk_based_prioritization_def] if {
    input.internal_scan_interval_days <= 90
    input.external_scan_interval_days <= 30
}

countermeasures contains _vulnerability_scanning_feeds_risk_based_prioritization_def if {
    count(vulnerability_scanning_feeds_risk_based_prioritization) > 0
}

_patch_testing_staged_rollout_and_rollback_def := {
    "name": "Patch testing, staged rollout, and rollback",
    "description": "The control enforces a documented test/staging ring before broad production rollout, with a rollback/recovery path to a known-good configuration (NIST SP 800-40r4 verify-installation, SP 800-128 recoverability). Presence of test+rollback is what prevents a bad patch from causing an outage that pressures teams to disable patching \u2014 protecting availability so the patch program stays running.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.4,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-RC",
            "attributes": {
                "justification": "Restore Configuration \u2014 the rollback/recovery-to-known-good path that reverts a faulty patch is the D3FEND Restore-tactic identity of this test/staging+rollback facet."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

patch_testing_staged_rollout_and_rollback[_patch_testing_staged_rollout_and_rollback_def] if {
    input.patch_tested_in_staging_before_production == true
    input.patch_rollback_path_exists == true
}

countermeasures contains _patch_testing_staged_rollout_and_rollback_def if {
    count(patch_testing_staged_rollout_and_rollback) > 0
}

_change_controlled_deployment_from_a_verified_update_source_def := {
    "name": "Change-controlled deployment from a verified update source",
    "description": "The control enforces that patch deployments flow through documented change control with security-impact analysis and authorization (NIST CM-3), and are delivered only from an integrity-verified, signed update source (CM-14). Presence of change control + source verification keeps the patch channel itself trusted, preventing a spoofed/backdoored 'patch' from being deployed enterprise-wide.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1045",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SBV",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {
                "justification": "Signature-verified delivery from an integrity-verified update source plus change-controlled authorization prevents a compromised or spoofed update channel from delivering a backdoored 'patch' enterprise-wide (software supply-chain compromise)."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1554",
            "attributes": {
                "justification": "Code-signing verification of the update source rejects tampered/backdoored binaries, hardening hosts against deployment of a compromised host software binary via the patch channel (D3FEND harden facet)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

change_controlled_deployment_from_a_verified_update_source[_change_controlled_deployment_from_a_verified_update_source_def] if {
    input.patch_change_control_enforced == true
    input.update_source_integrity_verified == true
}

countermeasures contains _change_controlled_deployment_from_a_verified_update_source_def if {
    count(change_controlled_deployment_from_a_verified_update_source) > 0
}

_patch_compliance_reporting_and_metrics_def := {
    "name": "Patch compliance reporting and metrics",
    "description": "The control enforces a documented vulnerability-management process (reviewed >=annually, CIS 7.1) and risk-based remediation process (reviewed monthly-or-more, 7.2) that produce regular patch-compliance metrics \u2014 percent patched, mean-time-to-patch, and remediation rate between consecutive scans (7.7, M1051). Presence of these metrics makes the exposure window measurable and gaps visible rather than the patch state being unknown.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "attributes": {
                "justification": "ATT&CK M1051 (Update Software) recommends a centralized patch-management system that produces compliance reports; the documented vulnerability-management/remediation process and its patch-compliance metrics are the reporting facet of that mitigation."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PM",
            "attributes": {
                "justification": "D3FEND D3-PM (Platform Monitoring) \u2014 producing and reviewing patch-compliance/coverage metrics (percent patched, MTTR, remediation rate between scans) is continuous monitoring of platform patch state, making the exposure window measurable."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

patch_compliance_reporting_and_metrics[_patch_compliance_reporting_and_metrics_def] if {
    input.patch_compliance_reporting_and_metrics == true
    input.documented_vulnerability_and_remediation_process == true
}

countermeasures contains _patch_compliance_reporting_and_metrics_def if {
    count(patch_compliance_reporting_and_metrics) > 0
}
