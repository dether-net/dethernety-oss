package _dt_built_in.countermeasures.network_access_control



_port_identity_admission_8021x_enforced_def := {
    "name": "802.1X port/identity admission enforced",
    "description": "Port-based 802.1X authentication requires a device+identity to authenticate to centralized RADIUS before the access port or SSID forwards any traffic onto a production VLAN, so only known/enrolled devices are admitted (closed / auth-fail = no access). This is the core admission gate that denies an unauthenticated host network reach.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "attributes": {
                "justification": "802.1X port-based NAC is the embodiment of M1035 (Limit Access to Resource Over Network): admission to the production VLAN is gated on authenticated device+identity at the network access layer."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-LAMED",
            "attributes": {
                "justification": "Port-based 802.1X admission is LAN Access Mediation (D3-LAMED): the switch port/SSID mediates LAN access, forwarding traffic only after successful authentication."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CBAN",
            "attributes": {
                "justification": "802.1X device/identity admission backed by machine certificates realises Certificate-based Authentication (D3-CBAN) at the network access layer."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1200",
            "attributes": {
                "justification": "An attacker-introduced rogue device (Hardware Additions, T1200) is denied a production VLAN because 802.1X requires device+identity authentication before the port forwards traffic."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Stolen Valid Accounts (T1078) alone do not yield network access: 802.1X port admission ties the decision to an authenticated device identity, so valid user creds from unauthorized hardware are blocked at the port."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

port_identity_admission_8021x_enforced[_port_identity_admission_8021x_enforced_def] if {
    input.network_access_control_802_1x_enforced == true
}

countermeasures contains _port_identity_admission_8021x_enforced_def if {
    count(port_identity_admission_8021x_enforced) > 0
}

_managed_device_enrollment_rogue_device_denial_enforced_def := {
    "name": "Managed-device enrollment + rogue-device denial enforced",
    "description": "Admission is tied to a device identity (machine certificate / approved-to-connect inventory record), and the NAC actively detects and denies rogue, unmanaged, or MAC-spoofing devices, so stolen user credentials alone do not yield network access from attacker-controlled hardware. Reconciled against the asset inventory's approved-to-connect flag.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NRAM",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1200",
            "attributes": {
                "justification": "Device-identity enrollment plus rogue/unmanaged-device detection and denial blocks Hardware Additions: an attacker-introduced device (malicious USB-Ethernet, drop box, unauthorized AP) cannot match an enrolled inventory record and is detected/denied a production VLAN before it gains access."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

managed_device_enrollment_rogue_device_denial_enforced[_managed_device_enrollment_rogue_device_denial_enforced_def] if {
    input.managed_device_enrollment_enforced == true
    input.rogue_unmanaged_device_detection_enabled == true
}

countermeasures contains _managed_device_enrollment_rogue_device_denial_enforced_def if {
    count(managed_device_enrollment_rogue_device_denial_enforced) > 0
}

_device_posture_check_gates_admission_def := {
    "name": "Device posture check gates admission",
    "description": "The NAC verifies a connecting device's security posture (patch level, EDR/AV running, disk encryption, host firewall) before granting production access; non-compliant devices are routed to remediation rather than placed on a production VLAN. Contractor / third-party / BYOD devices are held to the same posture bar with no relaxed bypass.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
            "value": "D3-NRAM",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Posture-gated admission held to the same bar for third-party/BYOD devices blocks valid (including stolen) credentials presented from an unmanaged or non-compliant device, so credential possession alone does not yield production network access."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

device_posture_check_gates_admission[_device_posture_check_gates_admission_def] if {
    input.client_posture_check_enabled == true
    input.third_party_devices_meet_same_posture_bar == true
}

countermeasures contains _device_posture_check_gates_admission_def if {
    count(device_posture_check_gates_admission) > 0
}

_identity_based_least_privilege_segment_assignment_enforced_def := {
    "name": "Identity-based least-privilege segment assignment enforced",
    "description": "RADIUS/NAC dynamically assigns the VLAN/security-group tag scoped to the authenticated identity+device rather than placing every device on one flat VLAN, confining an admitted (or compromised) host to a least-privilege segment and denying east-west reachability into production tiers.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1030",
            "attributes": {
                "justification": "Identity-scoped dynamic segment assignment is a Network Segmentation control (M1030): RADIUS/NAC returns a least-privilege VLAN/SGT per authenticated identity, isolating segments per NIST SP 800-125B."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NI",
            "attributes": {
                "justification": "Least-privilege per-identity segment placement realises D3FEND Network Isolation (D3-NI) by confining an admitted/compromised host to a scoped segment with no east-west path to production."
            }
        }
    ],
    "isolates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Confining each identity to a least-privilege segment denies the east-west reachability that Remote Services (T1021) lateral movement depends on, isolating a compromised host from production tiers."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Identity-based segmentation removes the flat-LAN reachability an attacker would need to reach a vulnerable production service, isolating the host from the targets of Exploitation of Remote Services (T1210)."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

identity_based_least_privilege_segment_assignment_enforced[_identity_based_least_privilege_segment_assignment_enforced_def] if {
    input.dynamic_segment_assignment_by_identity_enabled == true
}

countermeasures contains _identity_based_least_privilege_segment_assignment_enforced_def if {
    count(identity_based_least_privilege_segment_assignment_enforced) > 0
}

_guest_byod_iot_isolation_from_production_tiers_enforced_def := {
    "name": "Guest/BYOD/IoT isolation from production tiers enforced",
    "description": "Guest, BYOD, and IoT segments are isolated from production/server tiers with no east-west path, and a quarantine/remediation VLAN holds non-compliant or unauthenticated devices, so a compromised user or IoT device cannot pivot into sensitive systems and ARP/LLMNR on-path attack surface is shrunk.",
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
    "isolates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Isolating guest/BYOD/IoT from production shrinks the broadcast/collision domain available for ARP/LLMNR poisoning and on-path interception that a flat LAN would expose."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Segment isolation plus a quarantine VLAN confines an admitted or compromised device to a least-privilege segment, denying east-west reachability into production tiers and limiting lateral movement over remote services."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

guest_byod_iot_isolation_from_production_tiers_enforced[_guest_byod_iot_isolation_from_production_tiers_enforced_def] if {
    input.user_segment_isolated_from_production_tiers == true
    input.quarantine_remediation_vlan_configured == true
}

countermeasures contains _guest_byod_iot_isolation_from_production_tiers_enforced_def if {
    count(guest_byod_iot_isolation_from_production_tiers_enforced) > 0
}

_centralized_aaa_backing_admission_events_audit_logged_def := {
    "name": "Centralized AAA backing + admission events audit-logged",
    "description": "Admission decisions are backed by centralized RADIUS/802.1X AAA (consistent, revocable policy) and every admission/denial/quarantine event \u2014 identity, device, assigned segment \u2014 is forwarded to centralized log collection (SIEM), time-synced, and retained, so admission is reviewable and a host compromise cannot erase the only record.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "attributes": {
                "justification": "Centralized AAA-backed admission limits access to network resources to authenticated, authorized identities/devices."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Central forwarding/retention of admission/denial/quarantine events to SIEM realizes the Audit mitigation for network admission."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NAM",
            "attributes": {
                "justification": "Centralized RADIUS/802.1X AAA mediating every admission decision is Network Access Mediation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

centralized_aaa_backing_admission_events_audit_logged[_centralized_aaa_backing_admission_events_audit_logged_def] if {
    input.centralized_aaa_enabled == true
    input.nac_admission_events_audit_logged == true
}

countermeasures contains _centralized_aaa_backing_admission_events_audit_logged_def if {
    count(centralized_aaa_backing_admission_events_audit_logged) > 0
}

_non_bypassable_admission_no_alternate_path_def := {
    "name": "Non-bypassable admission \u2014 no alternate path",
    "description": "Admission is non-bypassable: no fail-open on RADIUS timeout, no standing MAC-auth-bypass exceptions, and no unmanaged downstream switch extending an authenticated port provides an unauthenticated route into production. Per zero-trust, enforcement happens at the policy-enforcement point for every request with no implicit network-location trust.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NRAM",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "A non-bypassable admission gate (no fail-open, no MAB exception, no unmanaged downstream switch) denies unauthenticated/non-compliant hosts any production-VLAN foothold, so an attacker cannot reach internal hosts/services to enumerate them \u2014 directly limiting Network Service Discovery."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1200",
            "attributes": {
                "justification": "Closing every alternate admission path means a physically-introduced rogue device (drop box, malicious USB-Ethernet, unmanaged switch behind an authenticated port) cannot obtain production access without passing the zero-trust PEP, mitigating Hardware Additions."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

non_bypassable_admission_no_alternate_path[_non_bypassable_admission_no_alternate_path_def] if {
    input.non_bypassable_admission_no_alternate_path == true
}

non_bypassable_admission_no_alternate_path[_non_bypassable_admission_no_alternate_path_def] if {
    input.mac_auth_bypass_exceptions_eliminated == true
}

non_bypassable_admission_no_alternate_path[_non_bypassable_admission_no_alternate_path_def] if {
    input.radius_unreachable_fails_closed == true
}

countermeasures contains _non_bypassable_admission_no_alternate_path_def if {
    count(non_bypassable_admission_no_alternate_path) > 0
}
