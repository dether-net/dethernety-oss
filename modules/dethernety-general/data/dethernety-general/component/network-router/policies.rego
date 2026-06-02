package _dt_built_in.exposures.network_router



_exposed_unauthenticated_management_plane_def := {
    "name": "Exposed / unauthenticated management plane",
    "description": "Cleartext or internet-reachable admin interfaces \u2014 Telnet on vty (transport input telnet/all), the cleartext HTTP web UI (ip http server), SSHv1, or vty lines with no access-class \u2014 let an unauthenticated remote attacker reach the control surface. The Cisco IOS-XE Web UI chain (CVE-2023-20198 \u2192 CVE-2023-20273) is the canonical case: an unauthenticated web request created a priv-15 user, then command injection wrote a persistent root implant.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 10,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_unauthenticated_management_plane[_exposed_unauthenticated_management_plane_def] if {
    not input.http_admin_ui_disabled
}

exposed_unauthenticated_management_plane[_exposed_unauthenticated_management_plane_def] if {
    not input.telnet_disabled_ssh_only
}

exposed_unauthenticated_management_plane[_exposed_unauthenticated_management_plane_def] if {
    not input.ssh_v2_only_enforced
}

exposed_unauthenticated_management_plane[_exposed_unauthenticated_management_plane_def] if {
    not input.vty_access_class_restricted
}

exposed_unauthenticated_management_plane[_exposed_unauthenticated_management_plane_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposures contains _exposed_unauthenticated_management_plane_def if {
    count(exposed_unauthenticated_management_plane) > 0
}

_weak_snmp_community_string_abuse_def := {
    "name": "Weak SNMP community-string abuse",
    "description": "SNMP v1/v2c community strings are cleartext, shared, and frequently left at defaults (public RO / private RW). A read community enables config and topology exfiltration; a RW community without an ACL allows remote configuration modification of the device. SNMPv3 with auth+priv (and ACL-bound, RO-only any retained v2c) is the mitigation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.002",
            "attributes": {
                "justification": "Cleartext SNMP v1/v2c read community enables Network Device Configuration Dump \u2014 config/topology exfiltration over SNMP."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Shared/default community strings function as a credential (community-as-credential); a captured or default community grants illegitimate SNMP access, including RW config modification."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_snmp_community_string_abuse[_weak_snmp_community_string_abuse_def] if {
    not input.snmpv3_auth_priv_required
}

weak_snmp_community_string_abuse[_weak_snmp_community_string_abuse_def] if {
    not input.snmp_default_communities_removed
}

weak_snmp_community_string_abuse[_weak_snmp_community_string_abuse_def] if {
    not input.snmp_write_community_disabled_or_acl_bound
}

weak_snmp_community_string_abuse[_weak_snmp_community_string_abuse_def] if {
    not input.snmp_access_acl_restricted
}

exposures contains _weak_snmp_community_string_abuse_def if {
    count(weak_snmp_community_string_abuse) > 0
}

_weak_cleartext_management_credentials_and_missing_aaa_def := {
    "name": "Weak / cleartext management credentials and missing AAA",
    "description": "Default or reused passwords, 'enable password' (reversible Type 7) instead of 'enable secret', plaintext creds with no service password-encryption, and no centralized AAA (aaa new-model + TACACS+/RADIUS) permit credential capture or brute force and grant persistent admin control with no per-admin accountability. Secrets sit in the running-config in recoverable form.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_cleartext_management_credentials_and_missing_aaa[_weak_cleartext_management_credentials_and_missing_aaa_def] if {
    not input.centralized_aaa_enabled
}

weak_cleartext_management_credentials_and_missing_aaa[_weak_cleartext_management_credentials_and_missing_aaa_def] if {
    not input.strong_password_hashing_enabled
}

weak_cleartext_management_credentials_and_missing_aaa[_weak_cleartext_management_credentials_and_missing_aaa_def] if {
    not input.service_password_encryption_enabled
}

weak_cleartext_management_credentials_and_missing_aaa[_weak_cleartext_management_credentials_and_missing_aaa_def] if {
    not input.default_accounts_removed_or_changed
}

weak_cleartext_management_credentials_and_missing_aaa[_weak_cleartext_management_credentials_and_missing_aaa_def] if {
    input.shared_admin_accounts == true
}

exposures contains _weak_cleartext_management_credentials_and_missing_aaa_def if {
    count(weak_cleartext_management_credentials_and_missing_aaa) > 0
}

_routing_protocol_injection_route_hijack_def := {
    "name": "Routing-protocol injection / route hijack",
    "description": "Unauthenticated BGP sessions (no TCP-MD5 neighbor password / TCP-AO key-chain), unauthenticated OSPF/EIGRP adjacencies (no message-digest/md5 key-chain), and missing RPKI origin validation (no bgp rpki server) let an adversary spoof a peer or originate bogus prefixes to hijack, blackhole, or reroute transiting traffic across the segments the router joins.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

routing_protocol_injection_route_hijack[_routing_protocol_injection_route_hijack_def] if {
    not input.bgp_session_authentication_enabled
}

routing_protocol_injection_route_hijack[_routing_protocol_injection_route_hijack_def] if {
    not input.igp_neighbor_authentication_enabled
}

routing_protocol_injection_route_hijack[_routing_protocol_injection_route_hijack_def] if {
    not input.bgp_rpki_origin_validation_enabled
}

exposures contains _routing_protocol_injection_route_hijack_def if {
    count(routing_protocol_injection_route_hijack) > 0
}

_on_path_interception_and_boundary_bridging_pivot_def := {
    "name": "On-path interception and boundary bridging pivot",
    "description": "A compromised or misconfigured router becomes an adversary-in-the-middle and a cross-boundary pivot: ip proxy-arp / ip redirects on edge interfaces and ACL gaps enable on-path interception, while an attacker with control can create GRE/tunnel interfaces, rewrite ACLs, or proxy traffic to bridge the trust boundaries the router was meant to separate (T1557/T1599/T1090).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

on_path_interception_and_boundary_bridging_pivot[_on_path_interception_and_boundary_bridging_pivot_def] if {
    not input.proxy_arp_disabled_on_edge
}

on_path_interception_and_boundary_bridging_pivot[_on_path_interception_and_boundary_bridging_pivot_def] if {
    not input.icmp_redirects_disabled
}

on_path_interception_and_boundary_bridging_pivot[_on_path_interception_and_boundary_bridging_pivot_def] if {
    not input.interface_acls_enforce_segmentation
}

on_path_interception_and_boundary_bridging_pivot[_on_path_interception_and_boundary_bridging_pivot_def] if {
    not input.unauthorized_tunnel_interfaces_blocked
}

exposures contains _on_path_interception_and_boundary_bridging_pivot_def if {
    count(on_path_interception_and_boundary_bridging_pivot) > 0
}

_firmware_tampering_unsigned_image_implant_def := {
    "name": "Firmware tampering / unsigned-image implant",
    "description": "Loading an unsigned or modified IOS/IOS-XE image undermines the device integrity foundation. Without Secure Boot / Trust Anchor signature verification ('Digital signature successfully verified') an attacker can install a tampered image or bootkit (the IOS-XE Web UI implant family), establishing firmware-resident persistence below detection (T1542/T1601).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

firmware_tampering_unsigned_image_implant[_firmware_tampering_unsigned_image_implant_def] if {
    not input.firmware_integrity_verified
}

firmware_tampering_unsigned_image_implant[_firmware_tampering_unsigned_image_implant_def] if {
    not input.secure_boot_image_verification_enabled
}

firmware_tampering_unsigned_image_implant[_firmware_tampering_unsigned_image_implant_def] if {
    not input.signed_images_only_enforced
}

exposures contains _firmware_tampering_unsigned_image_implant_def if {
    count(firmware_tampering_unsigned_image_implant) > 0
}

_unpatched_known_exploited_cves_and_legacy_services_def := {
    "name": "Unpatched known-exploited CVEs and legacy services",
    "description": "Running an EoL/unpatched IOS-XE train vulnerable to a CISA-KEV router CVE (CVE-2023-20198/20273 Web UI chain, CVE-2018-0171 Smart Install on TCP/4786) or leaving legacy services enabled (Smart Install / vstack, tcp-small-servers, finger, bootp, mop, source-routing, CDP on edges) hands an attacker mass-scanned, unauthenticated remote code execution and config exfiltration paths.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_known_exploited_cves_and_legacy_services[_unpatched_known_exploited_cves_and_legacy_services_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_known_exploited_cves_and_legacy_services[_unpatched_known_exploited_cves_and_legacy_services_def] if {
    not input.edge_appliance_patched_within_sla
}

unpatched_known_exploited_cves_and_legacy_services[_unpatched_known_exploited_cves_and_legacy_services_def] if {
    not input.smart_install_disabled
}

unpatched_known_exploited_cves_and_legacy_services[_unpatched_known_exploited_cves_and_legacy_services_def] if {
    not input.legacy_services_disabled
}

exposures contains _unpatched_known_exploited_cves_and_legacy_services_def if {
    count(unpatched_known_exploited_cves_and_legacy_services) > 0
}

_control_plane_network_denial_of_service_def := {
    "name": "Control-plane / network denial of service",
    "description": "Without Control Plane Policing (no service-policy under control-plane), protocol floods and punted-traffic storms exhaust the route-processor CPU and drop legitimate routing and management, taking the segment offline (T1498/T1499). Smart Install (CVE-2018-0171) can additionally force a device reload from an unauthenticated remote packet.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

control_plane_network_denial_of_service[_control_plane_network_denial_of_service_def] if {
    not input.control_plane_policing_enabled
    not input.ddos_protection_in_place
}

control_plane_network_denial_of_service[_control_plane_network_denial_of_service_def] if {
    not input.management_plane_protection_enabled
    not input.infrastructure_acl_mgmt_access
}

control_plane_network_denial_of_service[_control_plane_network_denial_of_service_def] if {
    not input.smart_install_disabled
}

exposures contains _control_plane_network_denial_of_service_def if {
    count(control_plane_network_denial_of_service) > 0
}

_logging_change_audit_and_ntp_gaps_def := {
    "name": "Logging, change-audit, and NTP gaps",
    "description": "Absent remote syslog (no logging host / inadequate logging trap), no configuration-change archive (archive log config), missing log timestamps, and unauthenticated NTP let an attacker operate on the router and tamper with config and routing without producing trustworthy, time-correlatable evidence \u2014 enabling timestomping and forensic blind spots that defeat detection of every vector above (T1562.006).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.006",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

logging_change_audit_and_ntp_gaps[_logging_change_audit_and_ntp_gaps_def] if {
    not input.logs_stored_on_separate_system
}

logging_change_audit_and_ntp_gaps[_logging_change_audit_and_ntp_gaps_def] if {
    not input.config_change_audit_logging_enabled
}

logging_change_audit_and_ntp_gaps[_logging_change_audit_and_ntp_gaps_def] if {
    not input.clocks_synced_to_trusted_time_source
}

logging_change_audit_and_ntp_gaps[_logging_change_audit_and_ntp_gaps_def] if {
    not input.authenticated_ntp_enabled
}

exposures contains _logging_change_audit_and_ntp_gaps_def if {
    count(logging_change_audit_and_ntp_gaps) > 0
}
