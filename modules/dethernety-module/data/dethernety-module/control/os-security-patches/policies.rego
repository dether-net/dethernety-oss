package _dt_built_in.countermeasures.os_security_patches

_known_vulnerability_closure_rate_def := {
    "name": "Known Vulnerability Closure Rate",
    "description": "Provides measurable reduction in unpatched CVEs by systematically applying vendor security updates, shrinking the window of exposure for publicly disclosed vulnerabilities.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NVA",
            "name": "Network Vulnerability Assessment",
            "relevance": "Directly supports tracking and measuring the closure rate of known vulnerabilities across network assets."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SYSVA",
            "name": "System Vulnerability Assessment",
            "relevance": "Enables identification and tracking of known vulnerabilities on systems to measure remediation closure rates."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Patching and updating software is the primary mechanism for closing known vulnerabilities."
        }
    ]
}

known_vulnerability_closure_rate[_known_vulnerability_closure_rate_def] if {
    input.patch_automation_enabled == true
    input.patch_compliance_percentage >= 95
    input.critical_patch_sla_days <= 14
}

known_vulnerability_closure_rate[_known_vulnerability_closure_rate_def] if {
    input.patch_automation_enabled == true
    input.patch_compliance_percentage >= 98
}

countermeasures contains _known_vulnerability_closure_rate_def if {
    count(known_vulnerability_closure_rate) > 0
}

_patch_deployment_automation_def := {
    "name": "Patch Deployment Automation",
    "description": "Automated scheduling and delivery of patches reduces human latency in remediation cycles, ensuring consistent application across managed endpoints without manual intervention.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Automated patch deployment directly implements the Update Software mitigation at scale."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SJA",
            "name": "Scheduled Job Analysis",
            "relevance": "Monitoring scheduled jobs is relevant to ensuring patch automation tasks execute correctly and are not tampered with."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Proper software configuration management supports consistent and reliable automated patch deployment processes."
        }
    ]
}

patch_deployment_automation[_patch_deployment_automation_def] if {
    input.patch_automation_enabled == true
    input.patch_compliance_tracking_enabled == true
    input.critical_patch_sla_days <= 30
}

patch_deployment_automation[_patch_deployment_automation_def] if {
    input.patch_automation_enabled == true
    input.patch_compliance_tracking_enabled == true
    input.rollback_capability_available == true
}

countermeasures contains _patch_deployment_automation_def if {
    count(patch_deployment_automation) > 0
}

_patch_compliance_visibility_def := {
    "name": "Patch Compliance Visibility",
    "description": "Centralized dashboards and compliance reports provide real-time inventory of patched versus unpatched systems, enabling identification of lagging endpoints and enforcement prioritization.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SYSVA",
            "name": "System Vulnerability Assessment",
            "relevance": "System vulnerability assessments provide direct visibility into patch compliance status across managed systems."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-EHB",
            "name": "Endpoint Health Beacon",
            "relevance": "Endpoint health beacons report patch and compliance status from individual endpoints for centralized visibility."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1016",
            "name": "Vulnerability Scanning",
            "relevance": "Vulnerability scanning is a core method for assessing and reporting patch compliance across the environment."
        }
    ]
}

patch_compliance_visibility[_patch_compliance_visibility_def] if {
    input.compliance_dashboard_enabled == true
    input.unpatched_system_reporting_enabled == true
    input.inventory_coverage_percent >= 90
    input.report_staleness_days <= 7
}

countermeasures contains _patch_compliance_visibility_def if {
    count(patch_compliance_visibility) > 0
}

_zero_day_gap_period_minimization_def := {
    "name": "Zero Day Gap Period Minimization",
    "description": "Accelerated patch cadence shortens the interval between public vulnerability disclosure and remediation deployment, limiting the exploitable window for newly released CVEs.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AVE",
            "name": "Asset Vulnerability Enumeration",
            "relevance": "Enumerating asset vulnerabilities rapidly identifies zero-day exposures to minimize the window of risk."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1050",
            "name": "Exploit Protection",
            "relevance": "Exploit protection controls reduce exploitability during the gap period before a zero-day patch is available."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NVA",
            "name": "Network Vulnerability Assessment",
            "relevance": "Network vulnerability assessments help identify zero-day exposures quickly to minimize the unpatched gap period."
        }
    ]
}

zero_day_gap_period_minimization[_zero_day_gap_period_minimization_def] if {
    input.patch_deployment_cadence_days > 7
}

zero_day_gap_period_minimization[_zero_day_gap_period_minimization_def] if {
    input.patch_automation_enabled == false
}

zero_day_gap_period_minimization[_zero_day_gap_period_minimization_def] if {
    input.patch_compliance_tracking_enabled == false
}

countermeasures contains _zero_day_gap_period_minimization_def if {
    count(zero_day_gap_period_minimization) > 0
}

_rollback_and_stability_assurance_def := {
    "name": "Rollback And Stability Assurance",
    "description": "Patch rollback capability and pre-deployment testing pipelines ensure system stability is maintained after updates, preventing operational disruption caused by incompatible or faulty patches.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SU",
            "name": "Software Update",
            "relevance": "Software update processes include rollback capabilities to restore stable states when patches cause instability."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1053",
            "name": "Data Backup",
            "relevance": "Data backups are essential for enabling rollback and recovery to a stable state after a failed patch deployment."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-TBI",
            "name": "TPM Boot Integrity",
            "relevance": "TPM boot integrity verification ensures system stability and detects unauthorized changes after patch deployment."
        }
    ]
}

rollback_and_stability_assurance[_rollback_and_stability_assurance_def] if {
    input.rollback_capability_enabled == false
}

rollback_and_stability_assurance[_rollback_and_stability_assurance_def] if {
    input.pre_deployment_testing_stage == "none"
}

rollback_and_stability_assurance[_rollback_and_stability_assurance_def] if {
    input.rollback_capability_enabled == true
    input.rollback_test_frequency_days == 0
}

countermeasures contains _rollback_and_stability_assurance_def if {
    count(rollback_and_stability_assurance) > 0
}

_patch_logging_and_audit_trail_def := {
    "name": "Patch Logging And Audit Trail",
    "description": "Detailed logs of patch installation events, timestamps, and system states provide an auditable record supporting incident response, forensic analysis, and compliance verification.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Audit controls directly address the need to maintain logs and audit trails for patch activities and changes."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Monitoring application exceptions during patching contributes to a complete audit trail of patch deployment events."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Software configuration management supports maintaining accurate records and audit trails of patch states."
        }
    ]
}

patch_logging_and_audit_trail[_patch_logging_and_audit_trail_def] if {
    input.patch_logging_enabled == true
    input.log_storage_destination in ["centralized_siem", "centralized_log_aggregator"]
    input.log_retention_days >= 90
    "timestamp" in input.audit_fields_captured
    "patch_id" in input.audit_fields_captured
    "outcome" in input.audit_fields_captured
}

countermeasures contains _patch_logging_and_audit_trail_def if {
    count(patch_logging_and_audit_trail) > 0
}

_third_party_component_coverage_def := {
    "name": "Third Party Component Coverage",
    "description": "Extended patch management that includes OS-bundled third-party libraries and drivers ensures coverage beyond the core kernel, reducing residual exposure in dependent components.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SU",
            "name": "Software Update",
            "relevance": "Software update processes must extend to third-party components to ensure comprehensive patch coverage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Updating third-party software components is a direct mitigation for vulnerabilities in those components."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1033",
            "name": "Limit Software Installation",
            "relevance": "Limiting and controlling third-party software installation reduces the attack surface requiring patch coverage."
        }
    ]
}

third_party_component_coverage[_third_party_component_coverage_def] if {
    input.third_party_patch_scope_enabled == false
}

third_party_component_coverage[_third_party_component_coverage_def] if {
    input.third_party_patch_scope_enabled == true
    input.third_party_patch_compliance_rate < 90
}

third_party_component_coverage[_third_party_component_coverage_def] if {
    input.third_party_patch_scope_enabled == true
    input.third_party_patch_automation_mode == "manual"
    input.third_party_patch_compliance_rate < 95
}

countermeasures contains _third_party_component_coverage_def if {
    count(third_party_component_coverage) > 0
}

_baseline_configuration_enforcement_def := {
    "name": "Baseline Configuration Enforcement",
    "description": "Patches are applied against a defined hardened baseline, ensuring updated systems conform to approved security configurations and preventing configuration drift post-update.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Application configuration hardening directly enforces secure baseline configurations for applications."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PH",
            "name": "Platform Hardening",
            "relevance": "Platform hardening establishes and enforces baseline security configurations across system platforms."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1054",
            "name": "Software Configuration",
            "relevance": "Software configuration management is the primary mechanism for defining and enforcing baseline configurations."
        }
    ]
}

baseline_configuration_enforcement[_baseline_configuration_enforcement_def] if {
    input.hardened_baseline_defined == true
    input.post_patch_compliance_validation == "automated"
    input.configuration_drift_detection_enabled == true
}

baseline_configuration_enforcement[_baseline_configuration_enforcement_def] if {
    input.hardened_baseline_defined == true
    input.post_patch_compliance_validation == "manual"
    input.configuration_drift_detection_enabled == true
}

countermeasures contains _baseline_configuration_enforcement_def if {
    count(baseline_configuration_enforcement) > 0
}
