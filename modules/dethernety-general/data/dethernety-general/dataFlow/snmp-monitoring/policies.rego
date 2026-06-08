package _dt_built_in.exposures.snmp_monitoring



_cleartext_snmpv1_v2c_community_on_the_wire_def := {
    "name": "Cleartext SNMPv1/v2c community on the wire",
    "description": "SNMPv1/v2c transmit the community string and all polled MIB data in cleartext with no message authentication or encryption. An on-path attacker sniffs the community and the polled data directly, or replays the community for full read access \u2014 the flow asserts confidentiality/authenticity it does not provide.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "SNMPv1/v2c send the community string and polled MIB data in cleartext, so an adjacent on-path attacker captures credentials and data directly off the wire (Network Sniffing)."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_snmpv1_v2c_community_on_the_wire[_cleartext_snmpv1_v2c_community_on_the_wire_def] if {
    input.snmp_version_and_security_level in ["v1", "v2c"]
}

exposures contains _cleartext_snmpv1_v2c_community_on_the_wire_def if {
    count(cleartext_snmpv1_v2c_community_on_the_wire) > 0
}

_default_guessable_community_string_public_private_def := {
    "name": "Default / guessable community string (public/private)",
    "description": "Vendor-default 'public' (read) and 'private' (read-write) communities \u2014 or other guessable words \u2014 let any scanner that reaches UDP 161 authenticate. The single most-exploited SNMP weakness: a hit dumps the full MIB and, with 'private', enables SNMP SET reconfiguration.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "A default/guessable community string ('public'/'private') is a valid, vendor-shipped credential that lets any scanner reaching UDP 161 authenticate to the SNMP monitoring flow and dump the full MIB \u2014 use of default accounts/credentials (T1078, sub-technique .001 Default Accounts)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Guessable / dictionary community strings are reached by credential spraying and password guessing against UDP 161 \u2014 brute force (T1110) of the SNMP community secret."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

default_guessable_community_string_public_private[_default_guessable_community_string_public_private_def] if {
    input.snmp_default_community_string_in_use == true
}

default_guessable_community_string_public_private[_default_guessable_community_string_public_private_def] if {
    not input.snmp_community_string_strong_unique
}

exposures contains _default_guessable_community_string_public_private_def if {
    count(default_guessable_community_string_public_private) > 0
}

_weak_absent_snmpv3_usm_security_level_noauth_md5_des_def := {
    "name": "Weak/absent SNMPv3 USM security level (noAuth / MD5 / DES)",
    "description": "Only authPriv with SHA + AES both authenticates the message and encrypts the payload (RFC 3414 / RFC 3826). A user at noAuthNoPriv or authNoPriv, or priv backed by legacy MD5/DES, leaves polled data cleartext or weakly protected. CVE-2008-0960 further shows a USM HMAC-length bypass defeats authPriv on unpatched stacks while the config still 'looks' v3-secured.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
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
            "value": "T1556",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_absent_snmpv3_usm_security_level_noauth_md5_des[_weak_absent_snmpv3_usm_security_level_noauth_md5_des_def] if {
    input.snmp_version_and_security_level in ["v3_authnopriv", "v3_noauth"]
}

weak_absent_snmpv3_usm_security_level_noauth_md5_des[_weak_absent_snmpv3_usm_security_level_noauth_md5_des_def] if {
    not input.snmpv3_uses_sha_and_aes_not_md5_des
}

weak_absent_snmpv3_usm_security_level_noauth_md5_des[_weak_absent_snmpv3_usm_security_level_noauth_md5_des_def] if {
    not input.known_vulnerabilities_patched
}

exposures contains _weak_absent_snmpv3_usm_security_level_noauth_md5_des_def if {
    count(weak_absent_snmpv3_usm_security_level_noauth_md5_des) > 0
}

_snmp_set_write_reconfiguration_rwcommunity_rwuser_def := {
    "name": "SNMP SET write reconfiguration (rwcommunity / rwuser)",
    "description": "Write access via rwcommunity or rwuser turns the monitoring flow into a device-control channel: an attacker can change interface/route/ACL state or trigger a TFTP config download/upload. Monitoring should be read-only; any write grant is an authorization escalation over the polling path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565",
            "attributes": {
                "justification": "rwcommunity/rwuser SET write lets an attacker alter device configuration (interface/route/ACL state) over the monitoring channel \u2014 stored/configuration data manipulation."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601",
            "attributes": {
                "justification": "SNMP SET write can trigger a TFTP config upload/download, modifying the device's running configuration / system image over the monitoring flow."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

snmp_set_write_reconfiguration_rwcommunity_rwuser[_snmp_set_write_reconfiguration_rwcommunity_rwuser_def] if {
    not input.snmp_write_community_disabled_or_acl_bound
}

exposures contains _snmp_set_write_reconfiguration_rwcommunity_rwuser_def if {
    count(snmp_set_write_reconfiguration_rwcommunity_rwuser) > 0
}

_full_mib_inventory_disclosure_no_vacm_view_restriction_def := {
    "name": "Full-MIB inventory disclosure (no VACM view restriction)",
    "description": "Without a VACM read view scoped to a needed subtree, any authenticated poller (or default-community holder) reads the complete device inventory \u2014 interfaces, ARP/route tables, running processes, installed software, sometimes config. The flow leaks far more than the monitoring data it is supposed to carry.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "An unrestricted SNMP read view lets a poller enumerate the device's full MIB \u2014 interfaces, listening services, routes, running processes/software \u2014 which is Network Service Discovery over the monitoring channel."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602",
            "attributes": {
                "justification": "With no VACM subtree restriction the full MIB (including configuration-bearing OIDs) is readable via SNMP polling, disclosing device configuration data from the network device's repository."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

full_mib_inventory_disclosure_no_vacm_view_restriction[_full_mib_inventory_disclosure_no_vacm_view_restriction_def] if {
    not input.snmp_mib_view_restricted_to_subtree
}

exposures contains _full_mib_inventory_disclosure_no_vacm_view_restriction_def if {
    count(full_mib_inventory_disclosure_no_vacm_view_restriction) > 0
}

_agent_network_exposure_missing_source_ip_acl_def := {
    "name": "Agent network exposure / missing source-IP ACL",
    "description": "When UDP 161 binds all interfaces and access lines carry no source restriction, any host reaching the agent and holding the credential can poll \u2014 and the agent becomes both a takeover target and a reflection source. agentaddress should pin the management IP and every access line should name the NMS source.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

agent_network_exposure_missing_source_ip_acl[_agent_network_exposure_missing_source_ip_acl_def] if {
    not input.snmp_access_acl_restricted
}

agent_network_exposure_missing_source_ip_acl[_agent_network_exposure_missing_source_ip_acl_def] if {
    not input.snmp_agent_bound_to_management_interface
}

agent_network_exposure_missing_source_ip_acl[_agent_network_exposure_missing_source_ip_acl_def] if {
    input.snmp_agent_internet_reachable == true
}

agent_network_exposure_missing_source_ip_acl[_agent_network_exposure_missing_source_ip_acl_def] if {
    input.snmp_agent_open_reflector == true
}

exposures contains _agent_network_exposure_missing_source_ip_acl_def if {
    count(agent_network_exposure_missing_source_ip_acl) > 0
}

_snmp_getbulk_reflection_amplification_dos_def := {
    "name": "SNMP GETBULK reflection / amplification DoS",
    "description": "A spoofed-source GETBULK with high max-repetitions against an open default-community agent reflects an amplified response (BAF ~6.3:1, far higher on large config tables) at a spoofed victim. Open agents are well-known UDP amplifiers; even authenticated agents are a DoS surface via malformed requests (CVE-2025-20170).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
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
        }
    ],
    "attack_vector": "NETWORK"
}

snmp_getbulk_reflection_amplification_dos[_snmp_getbulk_reflection_amplification_dos_def] if {
    not input.snmp_amplification_exposure_mitigated
}

snmp_getbulk_reflection_amplification_dos[_snmp_getbulk_reflection_amplification_dos_def] if {
    input.snmp_agent_internet_reachable == true
}

snmp_getbulk_reflection_amplification_dos[_snmp_getbulk_reflection_amplification_dos_def] if {
    not input.snmp_access_acl_restricted
}

snmp_getbulk_reflection_amplification_dos[_snmp_getbulk_reflection_amplification_dos_def] if {
    not input.response_rate_limiting_enabled
}

snmp_getbulk_reflection_amplification_dos[_snmp_getbulk_reflection_amplification_dos_def] if {
    not input.known_vulnerabilities_patched
}

exposures contains _snmp_getbulk_reflection_amplification_dos_def if {
    count(snmp_getbulk_reflection_amplification_dos) > 0
}

_spoofed_unauthenticated_trap_inform_injection_def := {
    "name": "Spoofed unauthenticated trap/inform injection",
    "description": "SNMPv1/v2c traps (UDP 162) carry only a cleartext community and no origin authentication, so an attacker can forge traps to the NMS \u2014 masking real events, raising false alarms, or triggering automated (mis)remediation. Authenticated SNMPv3 informs (authPriv) provide the missing origin authentication.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

spoofed_unauthenticated_trap_inform_injection[_spoofed_unauthenticated_trap_inform_injection_def] if {
    input.unauthenticated_v1_v2c_traps_accepted == true
}

spoofed_unauthenticated_trap_inform_injection[_spoofed_unauthenticated_trap_inform_injection_def] if {
    not input.snmp_traps_authenticated_v3_informs
}

exposures contains _spoofed_unauthenticated_trap_inform_injection_def if {
    count(spoofed_unauthenticated_trap_inform_injection) > 0
}
