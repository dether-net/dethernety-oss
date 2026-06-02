package _dt_built_in.countermeasures.firewall_policy



_ingress_default_deny_enforced_def := {
    "name": "Ingress default-deny enforced",
    "description": "The inbound ruleset terminates in a deny-all and only explicitly named services are permitted (allow-list, not block-list), so anything not justified is blocked at the perimeter. Implements D3FEND D3-ITF / ATT&CK M1037 and shrinks the public-facing attack surface that T1190/T1133 rely on.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Ingress default-deny is the ingress-filtering implementation of ATT&CK mitigation M1037 (Filter Network Traffic): an allow-list inbound policy terminating in deny-all is exactly what M1037 prescribes at the boundary."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "attributes": {
                "justification": "D3FEND D3-ITF (Inbound Traffic Filtering) \u2014 restricting traffic from untrusted networks toward a private host/enclave \u2014 is the directional defensive technique this default-deny ingress posture realises."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Default-deny ingress with a scoped allow-list keeps unneeded services off the perimeter, removing the public-facing application surface that T1190 (Exploit Public-Facing Application) relies on."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {
                "justification": "Source-scoped inbound permits terminating in deny-all stop remote-access services (RDP/SSH/VPN/SMB) from being reachable from untrusted networks, mitigating T1133 (External Remote Services)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

ingress_default_deny_enforced[_ingress_default_deny_enforced_def] if {
    input.ingress_default_deny_enforced == true
}

countermeasures contains _ingress_default_deny_enforced_def if {
    count(ingress_default_deny_enforced) > 0
}

_egress_default_deny_enforced_def := {
    "name": "Egress default-deny enforced",
    "description": "Outbound traffic from internal/DMZ zones defaults to deny; only approved destinations/ports/protocols are permitted via scoped egress allow-list. Outbound filtering (D3-OTF / M1037) severs C2 callbacks and exfiltration to unapproved destinations.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Egress default-deny is a direct implementation of M1037 Filter Network Traffic \u2014 outbound filtering restricting flows to approved destinations."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-OTF",
            "attributes": {
                "justification": "D3FEND Outbound Traffic Filtering (Isolate tactic) \u2014 restricting traffic from a private enclave toward untrusted networks is exactly the egress default-deny facet."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1041",
            "attributes": {
                "justification": "Egress default-deny blocks exfiltration over the C2 channel by denying outbound to unapproved destinations."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "Scoped egress allow-list denies outbound to non-approved hosts/ports, severing exfiltration over an unencrypted non-C2 protocol."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

egress_default_deny_enforced[_egress_default_deny_enforced_def] if {
    input.egress_default_deny_enforced == true
}

countermeasures contains _egress_default_deny_enforced_def if {
    count(egress_default_deny_enforced) > 0
}

_least_privilege_rules_scoped_def := {
    "name": "Least-privilege rules scoped",
    "description": "Every allow rule names a specific source, destination, port and protocol with a documented business need \u2014 no any/any or any-service permits and no overly broad subnets. Least-privilege rule construction limits exposed surface (T1190) and lateral movement (T1021).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Scoped least-privilege allow rules are the network-traffic-filtering posture M1037 prescribes \u2014 permitting only explicitly justified src/dst/port/protocol flows."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "attributes": {
                "justification": "Per-rule least-privilege scoping is a Network Traffic Filtering control restricting permitted flows to the minimal documented set."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Removing any/any and overly broad permits denies the open inter-host/inter-segment paths an adversary needs to exploit remote services, constraining lateral movement (M1037 Filter Network Traffic against T1210)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

least_privilege_rules_scoped[_least_privilege_rules_scoped_def] if {
    input.least_privilege_rules_scoped == true
    input.no_any_any_permit_rules == true
}

countermeasures contains _least_privilege_rules_scoped_def if {
    count(least_privilege_rules_scoped) > 0
}

_trust_zone_segmentation_and_east_west_filtering_enforced_def := {
    "name": "Trust-zone segmentation and east-west filtering enforced",
    "description": "Distinct trust zones (internet/DMZ/internal/management) are separated by the firewall placed at path splits, with inter-segment (east-west) traffic filtered so lateral-movement protocols (SMB 445, RDP 3389, WinRM) are blocked between segments with no business need. Implements ATT&CK M1030 / NIST SP 800-125B and constrains T1021.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1030",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NI",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.002",
            "attributes": {
                "justification": "East-west filtering blocks SMB/Windows-admin-share lateral movement between internal segments with no business need."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Trust-zone segmentation isolates internal services so an attacker cannot reach and exploit remote services across segment boundaries."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

trust_zone_segmentation_and_east_west_filtering_enforced[_trust_zone_segmentation_and_east_west_filtering_enforced_def] if {
    input.interface_acls_enforce_segmentation == true
    input.east_west_microsegmentation_enforced == true
}

countermeasures contains _trust_zone_segmentation_and_east_west_filtering_enforced_def if {
    count(trust_zone_segmentation_and_east_west_filtering_enforced) > 0
}

_threat_prevention_profiles_on_allow_rules_def := {
    "name": "Threat-prevention profiles on allow rules",
    "description": "Every Allow rule carries threat-prevention / IPS / AV / URL-filtering profiles so permitted traffic is still inspected for exploits and malware \u2014 closing the gap where an allowed port still carries an attack (T1190 inside permitted flows, T1071 C2 over allowed protocols).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {
                "justification": "Network Intrusion Prevention \u2014 IPS/threat-prevention profiles on allow rules inspect permitted traffic for malicious content; this is the control's ATT&CK mitigation identity."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTSA",
            "attributes": {
                "justification": "Network Traffic Signature Analysis \u2014 threat-prevention/IPS signatures inspecting permitted flows are the D3FEND defensive identity of this facet."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Threat-prevention/IPS profiles on Allow rules inspect permitted traffic for exploit payloads, closing the gap where an attack rides an allowed port toward a public-facing application (M1031 Network Intrusion Prevention)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "URL-filtering and IPS inspection on permitted flows detect and block command-and-control tunnelled over allowed application-layer protocols (HTTP/HTTPS/DNS), countering Application Layer Protocol C2."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

threat_prevention_profiles_on_allow_rules[_threat_prevention_profiles_on_allow_rules_def] if {
    input.security_profiles_on_allow_rules == true
    input.ips_threat_prevention_enabled == true
}

countermeasures contains _threat_prevention_profiles_on_allow_rules_def if {
    count(threat_prevention_profiles_on_allow_rules) > 0
}

_denied_and_security_relevant_traffic_logged_def := {
    "name": "Denied and security-relevant traffic logged",
    "description": "Deny rules and security-relevant allowed traffic are logged and forwarded off-box to a central syslog/SIEM, so blocked probes, policy violations and anomalous flows are visible. Supports detection of T1190/T1048 attempts at the boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
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

denied_and_security_relevant_traffic_logged[_denied_and_security_relevant_traffic_logged_def] if {
    input.denied_traffic_logging_enabled == true
    input.implicit_deny_logged == true
}

countermeasures contains _denied_and_security_relevant_traffic_logged_def if {
    count(denied_and_security_relevant_traffic_logged) > 0
}

_ruleset_governance_documented_ownership_recertification_and_change_control_def := {
    "name": "Ruleset governance: documented ownership, recertification and change control",
    "description": "The ruleset is documented from a risk analysis with each rule traceable to a named owner/justification, reviewed on a defined cadence to remove stale/shadowed rules, and all changes pass an approved change-control workflow with security-impact analysis \u2014 preventing rule-base rot from silently re-opening attack surface. Maps to NIST CM-3 and AC-6.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Ruleset governance (documented ownership, periodic recertification, change control) keeps the network-traffic-filtering policy correct and minimal over time \u2014 sustaining the ATT&CK M1037 Filter Network Traffic mitigation that the firewall ruleset implements and preventing rule-base rot from silently widening exposure."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

ruleset_governance_documented_ownership_recertification_and_change_control[_ruleset_governance_documented_ownership_recertification_and_change_control_def] if {
    input.firewall_ruleset_documented_and_owned == true
    input.firewall_rules_recertified_on_cadence == true
    input.firewall_change_control_enforced == true
}

countermeasures contains _ruleset_governance_documented_ownership_recertification_and_change_control_def if {
    count(ruleset_governance_documented_ownership_recertification_and_change_control) > 0
}

_management_plane_not_internet_reachable_and_patch_current_def := {
    "name": "Management plane not internet-reachable and patch-current",
    "description": "The firewall's own admin/management interface is restricted to a permitted-IP list / dedicated management network with plaintext protocols disabled, and the platform runs a vendor-supported patch-current firmware free of known-exploited pre-auth CVEs \u2014 so an attacker cannot reach or exploit the device that enforces the ruleset.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Filter Network Traffic \u2014 confining the management plane to a permitted-IP list / dedicated management network is the network-filtering mitigation this facet implements for the firewall's own admin interface."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "attributes": {
                "justification": "Update Software \u2014 keeping the firewall firmware patch-current free of known-exploited pre-auth CVEs is the software-update mitigation this facet implements for the enforcement appliance itself."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "attributes": {
                "justification": "Network Traffic Filtering \u2014 the D3FEND Isolate technique that restricts management-plane reachability to its trusted source enclave."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "attributes": {
                "justification": "Disable or Modify Network Device Firewall \u2014 an unreachable, patch-current management plane denies the attacker the access and the pre-auth exploit needed to alter or disable the firewall's own ruleset."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Exploit Public-Facing Application \u2014 confining the admin interface off the internet and eliminating known-exploited pre-auth CVEs removes the public-facing exploitation surface on the firewall appliance itself."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

management_plane_not_internet_reachable_and_patch_current[_management_plane_not_internet_reachable_and_patch_current_def] if {
    input.edge_management_interfaces_not_internet_reachable == true
    input.edge_appliance_patched_within_sla == true
}

countermeasures contains _management_plane_not_internet_reachable_and_patch_current_def if {
    count(management_plane_not_internet_reachable_and_patch_current) > 0
}
