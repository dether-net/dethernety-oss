package _dt_built_in.exposures.firewall



_overly_permissive_default_ruleset_def := {
    "name": "Overly Permissive Default Ruleset",
    "description": "Default rules allowing all outbound or broad inbound traffic rather than a deny-all baseline. If the default policy is set to ACCEPT rather than DROP/REJECT, traffic not explicitly matched by rules passes through unchecked.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overly permissive default rules can allow attackers to bridge network boundaries that should be segmented, bypassing intended security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Permissive default rulesets may allow tunneling protocols that would otherwise be blocked, enabling covert communications."
        }
    ],
    "attack_vector": "NETWORK"
}

overly_permissive_default_ruleset[_overly_permissive_default_ruleset_def] if {
    input.default_inbound_policy == "ACCEPT"
}

overly_permissive_default_ruleset[_overly_permissive_default_ruleset_def] if {
    input.default_outbound_policy == "ACCEPT"
}

overly_permissive_default_ruleset[_overly_permissive_default_ruleset_def] if {
    input.default_forward_policy == "ACCEPT"
}

overly_permissive_default_ruleset[_overly_permissive_default_ruleset_def] if {
    not input.explicit_deny_all_rule_present
}

exposures contains _overly_permissive_default_ruleset_def if {
    count(overly_permissive_default_ruleset) > 0
}

_management_interface_network_exposure_def := {
    "name": "Management Interface Network Exposure",
    "description": "The firewall's management interface (GUI, SSH, API) is reachable from untrusted or broad network segments instead of being restricted to a dedicated out-of-band management network or specific IP allowlist.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Exposed management interfaces provide remote service access points that attackers can exploit to gain unauthorized access to network devices."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Network-exposed management interfaces can be leveraged to disable or modify firewall rules on network devices."
        }
    ],
    "attack_vector": "NETWORK"
}

management_interface_network_exposure[_management_interface_network_exposure_def] if {
    input.management_interface_network_scope == "internet_reachable"
}

management_interface_network_exposure[_management_interface_network_exposure_def] if {
    input.management_interface_network_scope == "broad_internal"
    not input.management_source_ip_allowlist_configured
}

management_interface_network_exposure[_management_interface_network_exposure_def] if {
    not input.management_interface_bound_to_dedicated_interface
    not input.management_source_ip_allowlist_configured
}

exposures contains _management_interface_network_exposure_def if {
    count(management_interface_network_exposure) > 0
}

_weak_or_default_management_credentials_def := {
    "name": "Weak Or Default Management Credentials",
    "description": "Administrative accounts retain factory-default usernames and passwords, or password complexity requirements are not enforced, enabling brute-force or credential-stuffing attacks against the management plane.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Default or weak credentials are highly susceptible to password guessing attacks against management interfaces."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Weak or default credentials enable attackers to gain access using valid account credentials without sophisticated techniques."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Default credentials are commonly included in credential stuffing lists, making devices with unchanged defaults easy targets."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_default_management_credentials[_weak_or_default_management_credentials_def] if {
    not input.default_credentials_changed
}

weak_or_default_management_credentials[_weak_or_default_management_credentials_def] if {
    not input.password_complexity_policy_enforced
}

weak_or_default_management_credentials[_weak_or_default_management_credentials_def] if {
    not input.admin_account_lockout_enabled
}

exposures contains _weak_or_default_management_credentials_def if {
    count(weak_or_default_management_credentials) > 0
}

_missing_rule_logging_and_audit_trail_def := {
    "name": "Missing Rule Logging And Audit Trail",
    "description": "Firewall rules lack logging flags, or logging is disabled globally, preventing detection of policy violations, reconnaissance attempts, or lateral movement through traffic pattern analysis.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Without logging and audit trails, unauthorized modifications to firewall rules cannot be detected or investigated."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "The absence of rule logging means adversaries can operate without generating audit evidence that defenders could enumerate."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_rule_logging_and_audit_trail[_missing_rule_logging_and_audit_trail_def] if {
    not input.global_logging_enabled
}

missing_rule_logging_and_audit_trail[_missing_rule_logging_and_audit_trail_def] if {
    input.global_logging_enabled == true
    not input.log_destination_configured
}

missing_rule_logging_and_audit_trail[_missing_rule_logging_and_audit_trail_def] if {
    input.global_logging_enabled == true
    input.log_destination_configured == true
    input.rules_without_logging_count > 0
}

exposures contains _missing_rule_logging_and_audit_trail_def if {
    count(missing_rule_logging_and_audit_trail) > 0
}

_unencrypted_management_channel_def := {
    "name": "Unencrypted Management Channel",
    "description": "Management access uses cleartext protocols (Telnet, HTTP) instead of encrypted alternatives (SSH, HTTPS/TLS), exposing administrative credentials and configuration changes to interception on the management network.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Unencrypted management channels expose credentials and configuration data to network sniffing attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unencrypted management protocols can be abused or intercepted to facilitate data exfiltration over cleartext channels."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_management_channel[_unencrypted_management_channel_def] if {
    "telnet" in input.management_protocols_in_use
}

unencrypted_management_channel[_unencrypted_management_channel_def] if {
    "http" in input.management_protocols_in_use
}

unencrypted_management_channel[_unencrypted_management_channel_def] if {
    not input.encrypted_management_enforced
}

unencrypted_management_channel[_unencrypted_management_channel_def] if {
    input.tls_minimum_version == "none"
}

exposures contains _unencrypted_management_channel_def if {
    count(unencrypted_management_channel) > 0
}

_stale_firmware_or_software_version_def := {
    "name": "Stale Firmware Or Software Version",
    "description": "The firewall OS or firmware is not patched to current vendor-supported versions, leaving known CVEs exploitable. A boolean check on whether auto-update or scheduled patch compliance is enabled reveals this state.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Stale firmware and software versions contain known vulnerabilities that attackers can exploit to compromise public-facing network devices."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601.001",
            "name": "Patch System Image",
            "relevance": "Outdated firmware creates opportunities for attackers to replace or modify the system image with compromised versions."
        }
    ],
    "attack_vector": "NETWORK"
}

stale_firmware_or_software_version[_stale_firmware_or_software_version_def] if {
    not input.firmware_version_current
}

stale_firmware_or_software_version[_stale_firmware_or_software_version_def] if {
    not input.auto_update_or_patch_compliance_enabled
    input.days_since_last_patch > 90
}

exposures contains _stale_firmware_or_software_version_def if {
    count(stale_firmware_or_software_version) > 0
}

_rule_shadowing_and_redundant_rule_accumulation_def := {
    "name": "Rule Shadowing And Redundant Rule Accumulation",
    "description": "Over time, rule sets accumulate conflicting, shadowed, or redundant rules that create unintended permit paths. Without periodic rule-base auditing, intended-deny traffic may be inadvertently permitted by an earlier broad allow rule.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1564.008",
            "name": "Email Hiding Rules",
            "relevance": "Redundant and shadowed rules can obscure malicious rules inserted by attackers, analogous to hiding rules that mask attacker activity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1205",
            "name": "Traffic Signaling",
            "relevance": "Shadowed or redundant firewall rules may inadvertently allow traffic signaling techniques that would otherwise be blocked by correct rule ordering."
        }
    ],
    "attack_vector": "NETWORK"
}

rule_shadowing_and_redundant_rule_accumulation[_rule_shadowing_and_redundant_rule_accumulation_def] if {
    not input.rule_audit_performed
}

rule_shadowing_and_redundant_rule_accumulation[_rule_shadowing_and_redundant_rule_accumulation_def] if {
    input.shadowed_rules_detected == true
}

rule_shadowing_and_redundant_rule_accumulation[_rule_shadowing_and_redundant_rule_accumulation_def] if {
    input.redundant_permit_rules_count > 0
}

exposures contains _rule_shadowing_and_redundant_rule_accumulation_def if {
    count(rule_shadowing_and_redundant_rule_accumulation) > 0
}

_missing_egress_filtering_def := {
    "name": "Missing Egress Filtering",
    "description": "Outbound traffic rules are absent or set to allow-all, enabling data exfiltration, command-and-control callbacks, and lateral movement without restriction. Only ingress rules are defined while egress remains unconstrained.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Without egress filtering, attackers can freely exfiltrate data over alternative protocols that bypass detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "name": "Exfiltration Over Web Service",
            "relevance": "Missing egress filtering allows unrestricted data exfiltration to external web services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Absent egress filtering enables exfiltration over unencrypted protocols without interception or blocking."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_egress_filtering[_missing_egress_filtering_def] if {
    not input.egress_policy_defined
}

missing_egress_filtering[_missing_egress_filtering_def] if {
    input.default_egress_action == "allow"
    input.egress_rule_count < 1
}

exposures contains _missing_egress_filtering_def if {
    count(missing_egress_filtering) > 0
}

_no_multi_factor_authentication_on_admin_access_def := {
    "name": "No Multi Factor Authentication On Admin Access",
    "description": "Administrative authentication relies solely on username and password without a second factor, making the management plane vulnerable to credential compromise without additional verification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1621",
            "name": "Multi-Factor Authentication Request Generation",
            "relevance": "Without MFA enforcement, attackers do not need to bypass MFA challenges to gain administrative access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "name": "Multi-Factor Authentication",
            "relevance": "The absence of MFA on admin access directly relates to MFA bypass techniques used to gain unauthorized privileged access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1111",
            "name": "Multi-Factor Authentication Interception",
            "relevance": "When MFA is absent, attackers face no MFA interception challenge, making admin account compromise significantly easier."
        }
    ],
    "attack_vector": "NETWORK"
}

no_multi_factor_authentication_on_admin_access[_no_multi_factor_authentication_on_admin_access_def] if {
    not input.mfa_enabled
}

no_multi_factor_authentication_on_admin_access[_no_multi_factor_authentication_on_admin_access_def] if {
    input.admin_auth_method in ["local_password", "radius_no_mfa", "tacacs_no_mfa", "ldap_no_mfa"]
}

exposures contains _no_multi_factor_authentication_on_admin_access_def if {
    count(no_multi_factor_authentication_on_admin_access) > 0
}

_unencrypted_or_unsigned_configuration_backups_def := {
    "name": "Unencrypted Or Unsigned Configuration Backups",
    "description": "Configuration backups are stored or transmitted without encryption and without integrity signatures, allowing an attacker with file-system or network access to extract secrets (pre-shared keys, credentials) or tamper with backup files used for restore.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.002",
            "name": "Network Device Configuration Dump",
            "relevance": "Unencrypted configuration backups can be dumped and read by attackers to extract sensitive network device configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Unencrypted configuration backup files often contain credentials that attackers can extract directly."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Unsigned and unencrypted backups may expose private keys stored in configuration files."
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_or_unsigned_configuration_backups[_unencrypted_or_unsigned_configuration_backups_def] if {
    not input.backup_encryption_enabled
}

unencrypted_or_unsigned_configuration_backups[_unencrypted_or_unsigned_configuration_backups_def] if {
    not input.backup_integrity_signing_enabled
}

unencrypted_or_unsigned_configuration_backups[_unencrypted_or_unsigned_configuration_backups_def] if {
    input.backup_transfer_protocol in ["ftp", "tftp", "http", "smb_unencrypted"]
}

exposures contains _unencrypted_or_unsigned_configuration_backups_def if {
    count(unencrypted_or_unsigned_configuration_backups) > 0
}

_log_forwarding_misconfiguration_or_absence_def := {
    "name": "Log Forwarding Misconfiguration Or Absence",
    "description": "Firewall logs are stored only locally without forwarding to a centralized SIEM or syslog server, creating a single point of failure for audit data and enabling log tampering after host compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Misconfigured log forwarding prevents security indicators from reaching SIEM or monitoring systems, effectively blocking detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.002",
            "name": "Clear Linux or Mac System Logs",
            "relevance": "Absent log forwarding means attacker activity that would be detected via centralized logs goes unnoticed, similar to clearing logs."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Without proper log forwarding, attackers can enumerate and manipulate local logs without centralized visibility catching the activity."
        }
    ],
    "attack_vector": "LOCAL"
}

log_forwarding_misconfiguration_or_absence[_log_forwarding_misconfiguration_or_absence_def] if {
    not input.log_forwarding_enabled
}

log_forwarding_misconfiguration_or_absence[_log_forwarding_misconfiguration_or_absence_def] if {
    input.log_forwarding_enabled == true
    count(input.forwarding_destinations) == 0
}

log_forwarding_misconfiguration_or_absence[_log_forwarding_misconfiguration_or_absence_def] if {
    input.local_only_log_storage == true
}

exposures contains _log_forwarding_misconfiguration_or_absence_def if {
    count(log_forwarding_misconfiguration_or_absence) > 0
}

_excessive_administrative_privilege_assignment_def := {
    "name": "Excessive Administrative Privilege Assignment",
    "description": "All administrative accounts are granted full super-admin roles rather than role-based access control scoped to read-only, rule-editor, or auditor functions, increasing the blast radius of compromised credentials.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "name": "Account Manipulation",
            "relevance": "Excessive privilege assignment enables attackers who compromise any admin account to manipulate other accounts with broad permissions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Overly privileged accounts, when compromised, give attackers extensive access using valid account credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Excessive privilege assignment in cloud environments can be abused through temporary elevated access mechanisms."
        }
    ],
    "attack_vector": "NETWORK"
}

excessive_administrative_privilege_assignment[_excessive_administrative_privilege_assignment_def] if {
    not input.rbac_enabled
}

excessive_administrative_privilege_assignment[_excessive_administrative_privilege_assignment_def] if {
    input.rbac_enabled == true
    input.admin_accounts_with_superadmin_role_count >= 2
    not input.least_privilege_policy_enforced
}

exposures contains _excessive_administrative_privilege_assignment_def if {
    count(excessive_administrative_privilege_assignment) > 0
}

_missing_stateful_inspection_or_connection_tracking_disabled_def := {
    "name": "Missing Stateful Inspection Or Connection Tracking Disabled",
    "description": "Stateful inspection is disabled or not enforced, allowing malformed or out-of-state packets (e.g., TCP without SYN) to bypass rule enforcement that would otherwise require valid session establishment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1095",
            "name": "Non-Application Layer Protocol",
            "relevance": "Without stateful inspection, non-application layer protocol abuse for C2 communications cannot be properly detected or blocked."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Disabled connection tracking prevents detection of protocol tunneling used to encapsulate malicious traffic within allowed protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1205",
            "name": "Traffic Signaling",
            "relevance": "Without stateful inspection, traffic signaling techniques like port knocking cannot be properly identified and blocked."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_stateful_inspection_or_connection_tracking_disabled[_missing_stateful_inspection_or_connection_tracking_disabled_def] if {
    not input.stateful_inspection_enabled
}

missing_stateful_inspection_or_connection_tracking_disabled[_missing_stateful_inspection_or_connection_tracking_disabled_def] if {
    input.stateful_inspection_enabled == true
    input.invalid_state_packet_action == "accept"
}

missing_stateful_inspection_or_connection_tracking_disabled[_missing_stateful_inspection_or_connection_tracking_disabled_def] if {
    input.asymmetric_routing_bypass_enabled == true
}

exposures contains _missing_stateful_inspection_or_connection_tracking_disabled_def if {
    count(missing_stateful_inspection_or_connection_tracking_disabled) > 0
}

_no_high_availability_or_failover_configuration_def := {
    "name": "No High Availability Or Failover Configuration",
    "description": "The firewall operates without a redundant peer or failover mechanism. A hardware or software failure causes a complete traffic control outage or, in fail-open configurations, bypasses all enforcement, creating availability and security risk simultaneously.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.013",
            "name": "Disable or Modify Network Device Firewall",
            "relevance": "Without HA/failover, disabling or crashing the firewall creates a complete security gap with no redundant protection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "A single point of failure in firewall configuration can allow attackers to bridge network boundaries when the primary device fails."
        }
    ],
    "attack_vector": "LOCAL"
}

no_high_availability_or_failover_configuration[_no_high_availability_or_failover_configuration_def] if {
    not input.ha_peer_configured
}

no_high_availability_or_failover_configuration[_no_high_availability_or_failover_configuration_def] if {
    input.ha_peer_configured == true
    input.failover_mode == "fail_open"
}

no_high_availability_or_failover_configuration[_no_high_availability_or_failover_configuration_def] if {
    input.failover_mode == "none"
    not input.ha_peer_configured
}

exposures contains _no_high_availability_or_failover_configuration_def if {
    count(no_high_availability_or_failover_configuration) > 0
}

_icmp_and_diagnostic_service_overexposure_def := {
    "name": "Icmp And Diagnostic Service Overexposure",
    "description": "ICMP, SNMP, or other diagnostic protocols are permitted inbound from untrusted zones without restriction, enabling network reconnaissance (host discovery, topology mapping) and potential amplification or information-disclosure attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1018",
            "name": "Remote System Discovery",
            "relevance": "Exposed ICMP services enable attackers to perform remote system discovery and network mapping."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.001",
            "name": "SNMP (MIB Dump)",
            "relevance": "Exposed diagnostic services including SNMP allow attackers to dump MIB data and gather extensive network configuration information."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "ICMP and diagnostic service overexposure enables attackers to discover network configuration and topology details."
        }
    ],
    "attack_vector": "NETWORK"
}

icmp_and_diagnostic_service_overexposure[_icmp_and_diagnostic_service_overexposure_def] if {
    input.inbound_icmp_unrestricted == true
}

icmp_and_diagnostic_service_overexposure[_icmp_and_diagnostic_service_overexposure_def] if {
    input.inbound_snmp_unrestricted == true
}

icmp_and_diagnostic_service_overexposure[_icmp_and_diagnostic_service_overexposure_def] if {
    count(input.diagnostic_protocols_exposed) > 0
}

exposures contains _icmp_and_diagnostic_service_overexposure_def if {
    count(icmp_and_diagnostic_service_overexposure) > 0
}
