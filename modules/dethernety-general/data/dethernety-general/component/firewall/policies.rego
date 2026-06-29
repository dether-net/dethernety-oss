package _dt_built_in.exposures.firewall



_unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service_def := {
    "name": "Unpatched firmware pre-auth RCE on exposed VPN/portal service",
    "description": "An unauthenticated remote attacker exploits a firmware flaw in the firewall's internet-facing services (PAN-OS GlobalProtect, FortiOS SSL-VPN) to run arbitrary code as root on the appliance, turning the enforcement engine itself attacker-controlled. Both exemplar CVEs are CISA-KEV-listed and actively exploited.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 10,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Unauthenticated remote attacker exploits a firmware flaw in the firewall's internet-facing GlobalProtect/SSL-VPN service to run code as root on the appliance \u2014 exploitation of a public-facing application (CVE-2024-3400 / CVE-2024-21762, CISA-KEV)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1542.002",
            "attributes": {
                "justification": "Successful pre-auth RCE on the appliance lets the attacker subvert the NGFW firmware/enforcement engine itself, turning the device's component firmware attacker-controlled."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service[_unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service_def] if {
    input.unpatched_known_rce_cve == true
    input.vpn_portal_service_internet_exposed == true
}

unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service[_unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service_def] if {
    not input.edge_appliance_patched_within_sla
    input.vpn_portal_service_internet_exposed == true
}

exposures contains _unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service_def if {
    count(unpatched_firmware_pre_auth_rce_on_exposed_vpn_portal_service) > 0
}

_management_plane_authentication_bypass_def := {
    "name": "Management-plane authentication bypass",
    "description": "Crafted HTTP/HTTPS requests to the admin interface bypass authentication and grant admin-level command execution, letting an attacker rewrite the firewall ruleset and disable enforcement. Demonstrated by CVE-2022-40684 against FortiOS/FortiProxy/FortiSwitchManager.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Crafted HTTP/HTTPS requests to the public-facing admin interface bypass authentication and grant admin-level command execution on the NGFW (CVE-2022-40684) \u2014 exploitation of a public-facing application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "attributes": {
                "justification": "Once authenticated as administrator via the bypass, the attacker rewrites the firewall ruleset and disables enforcement \u2014 disabling/modifying the network device firewall."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

management_plane_authentication_bypass[_management_plane_authentication_bypass_def] if {
    input.admin_interface_internet_reachable == true
}

management_plane_authentication_bypass[_management_plane_authentication_bypass_def] if {
    not input.control_plane_api_not_publicly_exposed
}

management_plane_authentication_bypass[_management_plane_authentication_bypass_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

management_plane_authentication_bypass[_management_plane_authentication_bypass_def] if {
    not input.edge_appliance_patched_within_sla
}

exposures contains _management_plane_authentication_bypass_def if {
    count(management_plane_authentication_bypass) > 0
}

_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def := {
    "name": "Internet-exposed management plane with default or weak admin credentials",
    "description": "The administrative plane reachable from untrusted/internet-facing zones combined with vendor default credentials, no MFA, or no trusted-host (permitted-IP) restriction lets an attacker brute-force or guess their way into firewall admin and take over the boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_management_plane_with_default_or_weak_admin_credentials[_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

internet_exposed_management_plane_with_default_or_weak_admin_credentials[_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def] if {
    not input.default_accounts_removed_or_changed
}

internet_exposed_management_plane_with_default_or_weak_admin_credentials[_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def] if {
    not input.mfa_available
}

internet_exposed_management_plane_with_default_or_weak_admin_credentials[_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def] if {
    not input.admin_trusted_host_restriction_enabled
}

internet_exposed_management_plane_with_default_or_weak_admin_credentials[_internet_exposed_management_plane_with_default_or_weak_admin_credentials_def] if {
    not input.rate_limiting_or_lockout_enabled
}

exposures contains _internet_exposed_management_plane_with_default_or_weak_admin_credentials_def if {
    count(internet_exposed_management_plane_with_default_or_weak_admin_credentials) > 0
}

_cleartext_weak_tls_management_transport_def := {
    "name": "Cleartext / weak-TLS management transport",
    "description": "HTTP or Telnet admin access, legacy TLS 1.0/1.1 on admin HTTPS, a default self-signed management certificate, or SNMP v1/v2c community strings expose admin credentials and config to network sniffing and MITM on the management path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
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
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    input.http_or_telnet_admin_enabled == true
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    input.min_tls_version in ["TLSv1.0", "TLSv1.1"]
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    input.self_signed_admin_cert == true
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    not input.server_certificate_validated
}

cleartext_weak_tls_management_transport[_cleartext_weak_tls_management_transport_def] if {
    input.snmp_v1_v2c_enabled == true
}

exposures contains _cleartext_weak_tls_management_transport_def if {
    count(cleartext_weak_tls_management_transport) > 0
}

_default_permit_posture_no_implicit_deny_logging_def := {
    "name": "Default-permit posture / no implicit-deny logging",
    "description": "A firewall without a terminating default-deny rule (or one that does not log the implicit deny) silently allows unintended traffic across the segmentation boundary and yields no telemetry on blocked attempts, defeating the segmentation it exists to enforce.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {
                "justification": "A default-permit posture (no terminating default-deny) lets unintended traffic traverse the firewall, bridging the trusted/untrusted segmentation boundary the device exists to enforce."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

default_permit_posture_no_implicit_deny_logging[_default_permit_posture_no_implicit_deny_logging_def] if {
    not input.ingress_default_deny_enforced
}

default_permit_posture_no_implicit_deny_logging[_default_permit_posture_no_implicit_deny_logging_def] if {
    not input.implicit_deny_logged
}

exposures contains _default_permit_posture_no_implicit_deny_logging_def if {
    count(default_permit_posture_no_implicit_deny_logging) > 0
}

_insufficient_traffic_admin_logging_to_external_siem_def := {
    "name": "Insufficient traffic & admin logging to external SIEM",
    "description": "Without off-box syslog/SIEM forwarding of denied-traffic, configuration-change and admin-action events, firewall compromise and policy tampering go undetected and logs can be wiped on-device with no tamper-evident retention.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.external_siem_forwarding_enabled
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.perimeter_crossings_logged_and_centralized
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.denied_traffic_logging_enabled
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.admin_action_logging_enabled
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.config_change_logging_enabled
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.logs_stored_on_separate_system
}

insufficient_traffic_admin_logging_to_external_siem[_insufficient_traffic_admin_logging_to_external_siem_def] if {
    not input.audit_log_tamper_evident
}

exposures contains _insufficient_traffic_admin_logging_to_external_siem_def if {
    count(insufficient_traffic_admin_logging_to_external_siem) > 0
}

_firewall_self_dos_connection_table_exhaustion_with_fail_open_def := {
    "name": "Firewall self-DoS / connection-table exhaustion with fail-open",
    "description": "Flooding the device exhausts its session/connection table or CPU, dropping traffic or triggering a fail-open condition that removes the enforcement boundary; a single non-HA device with no link/path monitoring amplifies the availability impact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "attributes": {
                "justification": "Service Exhaustion Flood \u2014 flooding the firewall to exhaust its session/connection table degrades or drops the enforcement service."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.001",
            "attributes": {
                "justification": "OS Exhaustion Flood \u2014 saturating the appliance OS/CPU resources (session table, state memory) until traffic is dropped or the device fails open."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498.001",
            "attributes": {
                "justification": "Direct Network Flood \u2014 a volumetric flood directed at the single non-HA device amplifies the availability impact and can trigger the fail-open condition."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

firewall_self_dos_connection_table_exhaustion_with_fail_open[_firewall_self_dos_connection_table_exhaustion_with_fail_open_def] if {
    not input.session_table_limits_enforced
}

firewall_self_dos_connection_table_exhaustion_with_fail_open[_firewall_self_dos_connection_table_exhaustion_with_fail_open_def] if {
    not input.ddos_protection_in_place
}

firewall_self_dos_connection_table_exhaustion_with_fail_open[_firewall_self_dos_connection_table_exhaustion_with_fail_open_def] if {
    input.fails_open_on_overload == true
}

firewall_self_dos_connection_table_exhaustion_with_fail_open[_firewall_self_dos_connection_table_exhaustion_with_fail_open_def] if {
    not input.ha_failover_configured
}

exposures contains _firewall_self_dos_connection_table_exhaustion_with_fail_open_def if {
    count(firewall_self_dos_connection_table_exhaustion_with_fail_open) > 0
}

_inspection_disabled_stale_signatures_enabling_evasion_def := {
    "name": "Inspection disabled / stale signatures enabling evasion",
    "description": "An NGFW with its IPS/threat-prevention engine disabled, no security profiles on allow rules, or stale signatures becomes a blind passthrough; combined with no TLS inspection, encrypted threats and fragmentation/asymmetric-routing evasion cross the boundary uninspected.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {
                "justification": "A firewall with inspection disabled, stale signatures, or no TLS inspection becomes a blind passthrough, letting traffic bridge the trusted/untrusted boundary uninspected (Network Boundary Bridging)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Disabled IPS/threat-prevention, missing security profiles on allow rules, and stale signatures all impair the defensive enforcement the NGFW is meant to provide (Impair Defenses)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

inspection_disabled_stale_signatures_enabling_evasion[_inspection_disabled_stale_signatures_enabling_evasion_def] if {
    not input.ips_threat_prevention_enabled
}

inspection_disabled_stale_signatures_enabling_evasion[_inspection_disabled_stale_signatures_enabling_evasion_def] if {
    not input.threat_signatures_current
}

inspection_disabled_stale_signatures_enabling_evasion[_inspection_disabled_stale_signatures_enabling_evasion_def] if {
    not input.security_profiles_on_allow_rules
}

inspection_disabled_stale_signatures_enabling_evasion[_inspection_disabled_stale_signatures_enabling_evasion_def] if {
    not input.tls_inspection_enabled
}

exposures contains _inspection_disabled_stale_signatures_enabling_evasion_def if {
    count(inspection_disabled_stale_signatures_enabling_evasion) > 0
}

_unauthorized_config_drift_without_change_control_def := {
    "name": "Unauthorized config drift without change control",
    "description": "Firewall config is a security-critical baseline; ad-hoc rule edits with no version-controlled baseline, change-control workflow, off-box backup, or drift detection let unauthorized or malicious rule changes silently weaken segmentation and remain undetectable and unrecoverable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

unauthorized_config_drift_without_change_control[_unauthorized_config_drift_without_change_control_def] if {
    not input.config_change_detection_enabled
}

unauthorized_config_drift_without_change_control[_unauthorized_config_drift_without_change_control_def] if {
    not input.drift_detection_enabled
}

unauthorized_config_drift_without_change_control[_unauthorized_config_drift_without_change_control_def] if {
    not input.running_config_matches_baseline
}

unauthorized_config_drift_without_change_control[_unauthorized_config_drift_without_change_control_def] if {
    not input.config_backed_up_to_known_good
}

unauthorized_config_drift_without_change_control[_unauthorized_config_drift_without_change_control_def] if {
    not input.out_of_band_changes_controlled
}

exposures contains _unauthorized_config_drift_without_change_control_def if {
    count(unauthorized_config_drift_without_change_control) > 0
}
