package _dt_built_in.exposures.network_router

_unauthenticated_dynamic_routing_protocol_def := {
    "name": "Unauthenticated Dynamic Routing Protocol",
    "description": "Dynamic routing protocols (OSPF, BGP, EIGRP, RIP) configured without MD5 or stronger cryptographic authentication allow an attacker on the network to inject malicious route advertisements, redirecting traffic through attacker-controlled nodes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Unauthenticated routing protocols allow an attacker to inject false routing updates and intercept or redirect traffic, enabling adversary-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557.003",
            "name": "DHCP Spoofing",
            "relevance": "Lack of authentication in dynamic routing protocols is analogous to spoofing-based AitM techniques where an attacker injects malicious routing information to redirect network traffic."
        }
    ],
    "attack_vector": "ADJACENT"
}

unauthenticated_dynamic_routing_protocol[_unauthenticated_dynamic_routing_protocol_def] if {
    not input.routing_protocol_in_use in ["none"]
    not input.routing_protocol_authentication_enabled
}

unauthenticated_dynamic_routing_protocol[_unauthenticated_dynamic_routing_protocol_def] if {
    not input.routing_protocol_in_use in ["none"]
    input.routing_authentication_strength in ["none", "plaintext"]
}

exposures contains _unauthenticated_dynamic_routing_protocol_def if {
    count(unauthenticated_dynamic_routing_protocol) > 0
}

_weak_bgp_session_authentication_def := {
    "name": "Weak Bgp Session Authentication",
    "description": "BGP peering sessions using plain-text or no TCP MD5 authentication expose sessions to BGP hijacking. An attacker can inject fraudulent route prefixes, causing traffic to be misdirected or blackholed at an internet or inter-AS level.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Weak BGP session authentication enables route hijacking, allowing an adversary to intercept or redirect internet traffic flows."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Exploiting weak BGP authentication can allow an attacker to manipulate routing tables and bridge or bypass network boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Weak BGP authentication may expose session credentials and routing data to network sniffing attacks."
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_bgp_session_authentication[_weak_bgp_session_authentication_def] if {
    not input.bgp_md5_authentication_enabled
    input.bgp_session_type in ["ebgp", "mixed"]
}

weak_bgp_session_authentication[_weak_bgp_session_authentication_def] if {
    not input.bgp_md5_authentication_enabled
    input.bgp_session_type == "ibgp"
}

exposures contains _weak_bgp_session_authentication_def if {
    count(weak_bgp_session_authentication) > 0
}

_unrestricted_management_plane_access_def := {
    "name": "Unrestricted Management Plane Access",
    "description": "Management interfaces (SSH, Telnet, SNMP, web UI) accessible from untrusted or overly broad network ranges without IP-based access control lists allow unauthorized actors to attempt configuration changes or credential attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Unrestricted management plane access exposes the device to brute-force password guessing attacks against administrative interfaces."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Unrestricted management plane access allows attackers to leverage remote service protocols (SSH, Telnet, etc.) to compromise the device."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Open management plane access enables credential stuffing attacks using previously compromised credentials against management interfaces."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_management_plane_access[_unrestricted_management_plane_access_def] if {
    not input.management_acl_configured
}

unrestricted_management_plane_access[_unrestricted_management_plane_access_def] if {
    input.management_acl_configured == true
    input.management_source_network in ["0.0.0.0/0", "::/0", "any"]
}

unrestricted_management_plane_access[_unrestricted_management_plane_access_def] if {
    not input.management_acl_configured
    "telnet" in input.management_protocols_enabled
}

unrestricted_management_plane_access[_unrestricted_management_plane_access_def] if {
    not input.management_acl_configured
    "snmp_v2c" in input.management_protocols_enabled
}

exposures contains _unrestricted_management_plane_access_def if {
    count(unrestricted_management_plane_access) > 0
}

_cleartext_management_protocol_enabled_def := {
    "name": "Cleartext Management Protocol Enabled",
    "description": "Use of unencrypted management protocols such as Telnet or SNMPv1/v2c transmits credentials and configuration data in plaintext, enabling credential theft and configuration disclosure via passive network sniffing.",
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
            "relevance": "Cleartext management protocols expose credentials and configuration data to network sniffing by any attacker with access to the network path."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.002",
            "name": "Network Device Configuration Dump",
            "relevance": "Cleartext protocols allow attackers to capture and extract full device configurations transmitted in plaintext."
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_management_protocol_enabled[_cleartext_management_protocol_enabled_def] if {
    input.telnet_enabled == true
}

cleartext_management_protocol_enabled[_cleartext_management_protocol_enabled_def] if {
    input.snmp_version == "v1"
}

cleartext_management_protocol_enabled[_cleartext_management_protocol_enabled_def] if {
    input.snmp_version == "v2c"
}

cleartext_management_protocol_enabled[_cleartext_management_protocol_enabled_def] if {
    not input.ssh_enforced_as_exclusive
}

exposures contains _cleartext_management_protocol_enabled_def if {
    count(cleartext_management_protocol_enabled) > 0
}

_default_or_weak_device_credentials_def := {
    "name": "Default Or Weak Device Credentials",
    "description": "Factory-default or easily guessable usernames and passwords on the routing device allow unauthenticated access to configuration and routing policy, enabling full device takeover.",
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
            "relevance": "Default or weak credentials are trivially guessed, making password guessing the most direct attack vector."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.004",
            "name": "Network Device Authentication",
            "relevance": "Weak credentials on network devices directly relate to subverting network device authentication mechanisms."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.002",
            "name": "Password Cracking",
            "relevance": "Weak or default passwords are easily cracked offline if hashed credentials are obtained from the device configuration."
        }
    ],
    "attack_vector": "NETWORK"
}

default_or_weak_device_credentials[_default_or_weak_device_credentials_def] if {
    input.default_credentials_unchanged == true
}

default_or_weak_device_credentials[_default_or_weak_device_credentials_def] if {
    not input.password_complexity_enforced
    not input.privileged_access_requires_authentication
}

exposures contains _default_or_weak_device_credentials_def if {
    count(default_or_weak_device_credentials) > 0
}

_missing_route_filtering_prefix_lists_def := {
    "name": "Missing Route Filtering Prefix Lists",
    "description": "Absence of prefix-list or route-map filters on routing protocol neighbors allows the router to accept and propagate any received route, enabling route injection attacks that manipulate traffic flow across subnets.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Missing route filters allow unauthorized routes to propagate across network boundaries, enabling boundary bridging attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Without prefix list filtering, attackers can advertise routes that facilitate tunneling traffic through unintended network paths."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1665",
            "name": "Hide Infrastructure",
            "relevance": "Absent route filtering can allow adversaries to inject routes that obscure or hide malicious infrastructure within the routing domain."
        }
    ],
    "attack_vector": "ADJACENT"
}

missing_route_filtering_prefix_lists[_missing_route_filtering_prefix_lists_def] if {
    not input.prefix_list_filter_configured
    not input.route_map_filter_configured
}

exposures contains _missing_route_filtering_prefix_lists_def if {
    count(missing_route_filtering_prefix_lists) > 0
}

_excessive_privilege_on_operator_accounts_def := {
    "name": "Excessive Privilege On Operator Accounts",
    "description": "Operator or read-only accounts assigned full administrative privilege levels allow configuration changes by personnel who should only have monitoring access, violating least-privilege principles.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Excessively privileged operator accounts, if compromised, provide attackers with valid high-privilege access to network infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "name": "Account Manipulation",
            "relevance": "Excessive privileges allow an attacker who gains access to manipulate accounts and maintain or escalate their access on the device."
        }
    ],
    "attack_vector": "LOCAL"
}

excessive_privilege_on_operator_accounts[_excessive_privilege_on_operator_accounts_def] if {
    input.operator_account_privilege_level in ["full_admin", "elevated"]
}

excessive_privilege_on_operator_accounts[_excessive_privilege_on_operator_accounts_def] if {
    not input.least_privilege_policy_enforced
}

exposures contains _excessive_privilege_on_operator_accounts_def if {
    count(excessive_privilege_on_operator_accounts) > 0
}

_insufficient_routing_change_logging_def := {
    "name": "Insufficient Routing Change Logging",
    "description": "Routing table changes, session resets, and configuration modifications not forwarded to a centralized syslog or SIEM prevent detection of unauthorized route manipulation or protocol state changes.",
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
            "relevance": "Insufficient logging of routing changes prevents detection of malicious route modifications, effectively blocking indicators of compromise."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.007",
            "name": "Clear Network Connection History and Configurations",
            "relevance": "Lack of routing change logs mirrors the impact of an attacker clearing network history, leaving no audit trail for unauthorized routing modifications."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_routing_change_logging[_insufficient_routing_change_logging_def] if {
    not input.centralized_syslog_configured
    not input.routing_change_logging_enabled
}

insufficient_routing_change_logging[_insufficient_routing_change_logging_def] if {
    input.centralized_syslog_configured == true
    not input.routing_change_logging_enabled
}

insufficient_routing_change_logging[_insufficient_routing_change_logging_def] if {
    not input.centralized_syslog_configured
    input.routing_change_logging_enabled == true
}

insufficient_routing_change_logging[_insufficient_routing_change_logging_def] if {
    not input.centralized_syslog_configured
    not input.config_change_logging_enabled
}

exposures contains _insufficient_routing_change_logging_def if {
    count(insufficient_routing_change_logging) > 0
}

_unpatched_routing_software_or_firmware_def := {
    "name": "Unpatched Routing Software Or Firmware",
    "description": "Failure to apply vendor security patches to the routing OS or firmware leaves known vulnerabilities exploitable, including protocol parsing flaws and privilege escalation bugs that can compromise the device.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched routing software contains known vulnerabilities that can be exploited remotely to compromise the device."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601.001",
            "name": "Patch System Image",
            "relevance": "Unpatched firmware is directly related to system image integrity; attackers may also modify firmware when patch management is absent."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Known vulnerabilities in unpatched routing software can be exploited to gain elevated privileges on the device."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_routing_software_or_firmware[_unpatched_routing_software_or_firmware_def] if {
    input.firmware_patch_status in ["significantly_behind", "unknown"]
}

unpatched_routing_software_or_firmware[_unpatched_routing_software_or_firmware_def] if {
    input.known_cve_unpatched == true
}

unpatched_routing_software_or_firmware[_unpatched_routing_software_or_firmware_def] if {
    input.firmware_patch_status == "minor_behind"
    not input.patch_management_policy_enforced
}

exposures contains _unpatched_routing_software_or_firmware_def if {
    count(unpatched_routing_software_or_firmware) > 0
}

_snmp_community_string_exposure_def := {
    "name": "Snmp Community String Exposure",
    "description": "SNMP community strings using default values (e.g., 'public', 'private') or configured with read-write access allow attackers to enumerate routing tables or modify device configuration via SNMP SET operations.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.001",
            "name": "SNMP (MIB Dump)",
            "relevance": "Exposed SNMP community strings directly enable attackers to perform MIB dumps and extract sensitive device configuration and network topology data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.002",
            "name": "Network Device Configuration Dump",
            "relevance": "SNMP community string exposure allows attackers to dump full network device configurations using SNMP write/read access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Cleartext SNMP community strings can be captured via network sniffing, providing attackers with credentials for further exploitation."
        }
    ],
    "attack_vector": "ADJACENT"
}

snmp_community_string_exposure[_snmp_community_string_exposure_def] if {
    "public" in input.snmp_community_strings
}

snmp_community_string_exposure[_snmp_community_string_exposure_def] if {
    "private" in input.snmp_community_strings
}

snmp_community_string_exposure[_snmp_community_string_exposure_def] if {
    input.snmp_write_access_enabled == true
    not input.snmp_acl_configured
}

exposures contains _snmp_community_string_exposure_def if {
    count(snmp_community_string_exposure) > 0
}

_missing_control_plane_policing_def := {
    "name": "Missing Control Plane Policing",
    "description": "Absence of control plane policing (CoPP) or rate limiting on traffic destined to the router's CPU allows volumetric attacks targeting routing protocol processing to exhaust CPU resources, causing routing instability or denial of service.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.001",
            "name": "OS Exhaustion Flood",
            "relevance": "Without control plane policing, an attacker can flood the router CPU with crafted packets, exhausting OS resources and causing denial of service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "name": "Endpoint Denial of Service",
            "relevance": "Missing control plane policing leaves network devices vulnerable to denial-of-service attacks targeting the control plane processor."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_control_plane_policing[_missing_control_plane_policing_def] if {
    not input.copp_policy_configured
    not input.cpu_rate_limit_configured
}

exposures contains _missing_control_plane_policing_def if {
    count(missing_control_plane_policing) > 0
}

_hardcoded_routing_credentials_in_config_def := {
    "name": "Hardcoded Routing Credentials In Config",
    "description": "Routing protocol keys, SNMP community strings, or management passwords stored in plaintext within configuration files on the device or in backup repositories expose secrets to anyone with file read access.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Hardcoded routing credentials stored in configuration files are directly equivalent to credentials stored in files, easily extracted by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.002",
            "name": "Network Device Configuration Dump",
            "relevance": "Dumping the network device configuration directly exposes any hardcoded credentials present in the running or stored configuration."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Hardcoded credentials may include private keys or shared secrets embedded in configuration files that can be extracted and reused by attackers."
        }
    ],
    "attack_vector": "LOCAL"
}

hardcoded_routing_credentials_in_config[_hardcoded_routing_credentials_in_config_def] if {
    count(input.plaintext_credential_types_found) > 0
}

hardcoded_routing_credentials_in_config[_hardcoded_routing_credentials_in_config_def] if {
    not input.credential_storage_encrypted
}

exposures contains _hardcoded_routing_credentials_in_config_def if {
    count(hardcoded_routing_credentials_in_config) > 0
}

_ip_source_routing_enabled_def := {
    "name": "Ip Source Routing Enabled",
    "description": "IP source routing option enabled on the router allows external senders to specify an explicit forwarding path, potentially bypassing security controls and facilitating traffic redirection or reconnaissance.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "IP source routing allows attackers to specify arbitrary packet paths, potentially bypassing network boundaries and security controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "IP source routing can be abused to force packets through attacker-controlled hops, effectively creating a multi-hop proxy for traffic redirection."
        }
    ],
    "attack_vector": "NETWORK"
}

ip_source_routing_enabled[_ip_source_routing_enabled_def] if {
    input.ip_source_routing_enabled == true
    not input.acl_blocks_source_routed_packets
}

ip_source_routing_enabled[_ip_source_routing_enabled_def] if {
    input.source_routing_scope == "all"
    input.ip_source_routing_enabled == true
}

exposures contains _ip_source_routing_enabled_def if {
    count(ip_source_routing_enabled) > 0
}

_icmp_redirect_messages_enabled_def := {
    "name": "Icmp Redirect Messages Enabled",
    "description": "ICMP redirect messages enabled on routing interfaces allow a malicious host on a connected subnet to redirect traffic for specific destinations through an attacker-controlled gateway.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "ICMP redirect messages can be spoofed by attackers to redirect victim traffic through attacker-controlled infrastructure, enabling adversary-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "Malicious ICMP redirects can force traffic through additional hops controlled by an attacker, functioning as a network-layer proxy mechanism."
        }
    ],
    "attack_vector": "ADJACENT"
}

icmp_redirect_messages_enabled[_icmp_redirect_messages_enabled_def] if {
    input.icmp_redirects_enabled == true
    input.interface_role in ["external", "dmz"]
}

icmp_redirect_messages_enabled[_icmp_redirect_messages_enabled_def] if {
    input.icmp_redirects_enabled == true
    not input.secure_redirects_enabled
}

exposures contains _icmp_redirect_messages_enabled_def if {
    count(icmp_redirect_messages_enabled) > 0
}

_ntp_unauthenticated_synchronization_def := {
    "name": "Ntp Unauthenticated Synchronization",
    "description": "NTP configured without authentication allows an attacker to manipulate the router's system clock, which can invalidate certificate validity windows, corrupt log timestamps, and disrupt time-sensitive routing protocol operations.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Unauthenticated NTP allows attackers to perform NTP spoofing/poisoning attacks, manipulating time to disrupt authentication and logging systems."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1124",
            "name": "System Time Discovery",
            "relevance": "Unauthenticated NTP exposes time synchronization data and can be abused to discover or manipulate system time for further attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

ntp_unauthenticated_synchronization[_ntp_unauthenticated_synchronization_def] if {
    input.ntp_servers_configured == true
    not input.ntp_authentication_enabled
}

ntp_unauthenticated_synchronization[_ntp_unauthenticated_synchronization_def] if {
    input.ntp_servers_configured == true
    not input.ntp_authentication_enabled
    not input.ntp_access_group_configured
}

exposures contains _ntp_unauthenticated_synchronization_def if {
    count(ntp_unauthenticated_synchronization) > 0
}
