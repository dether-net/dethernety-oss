package _dt_built_in.exposures.dns_queries

_plaintext_dns_query_interception_def := {
    "name": "Plaintext Dns Query Interception",
    "description": "Standard DNS queries transmitted over UDP/TCP port 53 are unencrypted, allowing passive network observers to intercept internal hostnames, service names, and infrastructure topology from query content without active attack.",
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
            "relevance": "Plaintext DNS queries can be intercepted via network sniffing since they are transmitted unencrypted."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "DNS is the protocol used in plaintext query interception, making this technique directly relevant."
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_dns_query_interception[_plaintext_dns_query_interception_def] if {
    not input.encrypted_dns_enabled
}

plaintext_dns_query_interception[_plaintext_dns_query_interception_def] if {
    input.dns_transport_protocol == "udp_plaintext"
}

plaintext_dns_query_interception[_plaintext_dns_query_interception_def] if {
    input.dns_transport_protocol == "tcp_plaintext"
}

exposures contains _plaintext_dns_query_interception_def if {
    count(plaintext_dns_query_interception) > 0
}

_dns_response_spoofing_no_dnssec_def := {
    "name": "Dns Response Spoofing No Dnssec",
    "description": "Absence of DNSSEC validation means DNS responses carry no cryptographic signatures, enabling an on-path or off-path attacker to inject forged responses and redirect clients to attacker-controlled infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Compromising or spoofing DNS server responses is the core mechanism of DNS response spoofing without DNSSEC."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1583.002",
            "name": "DNS Server",
            "relevance": "Attackers can acquire DNS server infrastructure to conduct spoofing attacks when DNSSEC is absent."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_response_spoofing_no_dnssec[_dns_response_spoofing_no_dnssec_def] if {
    not input.dnssec_validation_enabled
}

dns_response_spoofing_no_dnssec[_dns_response_spoofing_no_dnssec_def] if {
    not input.dnssec_signing_configured
}

exposures contains _dns_response_spoofing_no_dnssec_def if {
    count(dns_response_spoofing_no_dnssec) > 0
}

_dns_over_tls_dot_not_enforced_def := {
    "name": "Dns Over Tls Dot Not Enforced",
    "description": "DNS-over-TLS (DoT) on port 853 is not enforced, allowing clients to fall back to cleartext DNS. Without mandatory DoT, transport encryption is absent and downgrade attacks are possible by blocking port 853 and forcing port 53 fallback.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Without enforced DNS-over-TLS, DNS traffic is unencrypted and susceptible to interception and manipulation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Lack of DoT enforcement allows attackers to exploit unencrypted DNS channels for covert communication or tunneling."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_over_tls_dot_not_enforced[_dns_over_tls_dot_not_enforced_def] if {
    input.dot_enforcement_mode == "disabled"
}

dns_over_tls_dot_not_enforced[_dns_over_tls_dot_not_enforced_def] if {
    input.dot_enforcement_mode == "opportunistic"
}

dns_over_tls_dot_not_enforced[_dns_over_tls_dot_not_enforced_def] if {
    input.dot_enforcement_mode != "enforced"
    not input.dot_upstream_resolver_configured
}

dns_over_tls_dot_not_enforced[_dns_over_tls_dot_not_enforced_def] if {
    input.dot_enforcement_mode != "disabled"
    not input.plaintext_dns_port_53_blocked
}

exposures contains _dns_over_tls_dot_not_enforced_def if {
    count(dns_over_tls_dot_not_enforced) > 0
}

_dns_cache_poisoning_via_birthday_attack_def := {
    "name": "Dns Cache Poisoning Via Birthday Attack",
    "description": "Insufficiently randomized transaction IDs or source ports in DNS queries expose the channel to birthday-attack-based cache poisoning, where an attacker floods the resolver with forged responses to win the race before the legitimate reply arrives.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "DNS cache poisoning via birthday attack targets DNS server infrastructure to inject malicious records."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.003",
            "name": "DNS Calculation",
            "relevance": "DNS Calculation involves manipulating DNS responses, directly relevant to birthday attack-based cache poisoning."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_cache_poisoning_via_birthday_attack[_dns_cache_poisoning_via_birthday_attack_def] if {
    not input.source_port_randomization_enabled
    not input.dnssec_validation_enabled
}

dns_cache_poisoning_via_birthday_attack[_dns_cache_poisoning_via_birthday_attack_def] if {
    input.transaction_id_entropy_bits < 16
    not input.dnssec_validation_enabled
}

exposures contains _dns_cache_poisoning_via_birthday_attack_def if {
    count(dns_cache_poisoning_via_birthday_attack) > 0
}

_zone_transfer_over_unencrypted_channel_def := {
    "name": "Zone Transfer Over Unencrypted Channel",
    "description": "AXFR/IXFR zone transfers transmitted without TLS expose complete internal DNS zone data \u2014 including all hostnames, IP mappings, and service records \u2014 in cleartext, providing a full network map to any passive observer on the path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Zone transfers expose DNS records which attackers can collect through passive DNS reconnaissance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Unencrypted zone transfers leak DNS information that adversaries can gather for target reconnaissance."
        }
    ],
    "attack_vector": "ADJACENT"
}

zone_transfer_over_unencrypted_channel[_zone_transfer_over_unencrypted_channel_def] if {
    input.zone_transfer_enabled == true
    not input.zone_transfer_tls_enabled
}

zone_transfer_over_unencrypted_channel[_zone_transfer_over_unencrypted_channel_def] if {
    input.zone_transfer_enabled == true
    not input.transfer_acl_restricted
    not input.zone_transfer_tls_enabled
}

zone_transfer_over_unencrypted_channel[_zone_transfer_over_unencrypted_channel_def] if {
    input.zone_transfer_enabled == true
    not input.zone_transfer_tls_enabled
    not input.tsig_authentication_enabled
}

exposures contains _zone_transfer_over_unencrypted_channel_def if {
    count(zone_transfer_over_unencrypted_channel) > 0
}

_lack_of_mutual_authentication_between_client_and_resolver_def := {
    "name": "Lack Of Mutual Authentication Between Client And Resolver",
    "description": "DNS clients authenticate the server only by IP address and transaction ID match; no mutual TLS or TSIG-based authentication is performed, allowing a rogue DNS server to impersonate the legitimate resolver without detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Without mutual authentication, attackers can compromise or impersonate DNS resolvers to intercept queries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Lack of mutual authentication enables adversaries to gather DNS information by impersonating legitimate resolvers."
        }
    ],
    "attack_vector": "ADJACENT"
}

lack_of_mutual_authentication_between_client_and_resolver[_lack_of_mutual_authentication_between_client_and_resolver_def] if {
    not input.encrypted_dns_enabled
    not input.tsig_authentication_enabled
}

lack_of_mutual_authentication_between_client_and_resolver[_lack_of_mutual_authentication_between_client_and_resolver_def] if {
    input.encrypted_dns_enabled == true
    not input.resolver_certificate_validation_enforced
    not input.tsig_authentication_enabled
}

exposures contains _lack_of_mutual_authentication_between_client_and_resolver_def if {
    count(lack_of_mutual_authentication_between_client_and_resolver) > 0
}

_tsig_shared_secret_replay_or_weak_mac_def := {
    "name": "Tsig Shared Secret Replay Or Weak Mac",
    "description": "TSIG-protected DNS messages rely on a shared HMAC secret; if weak algorithms (e.g., HMAC-MD5) are negotiated or the time window for replay protection is overly permissive, an attacker capturing signed messages can replay or forge them within the allowed window.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Replaying or exploiting weak TSIG MACs enables adversary-in-the-middle attacks on DNS zone update transactions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Compromising TSIG secrets allows attackers to manipulate DNS server zone data through forged authenticated updates."
        }
    ],
    "attack_vector": "ADJACENT"
}

tsig_shared_secret_replay_or_weak_mac[_tsig_shared_secret_replay_or_weak_mac_def] if {
    input.tsig_key_configured == true
    input.tsig_algorithm in ["hmac-md5", "hmac-sha1"]
}

tsig_shared_secret_replay_or_weak_mac[_tsig_shared_secret_replay_or_weak_mac_def] if {
    input.tsig_key_configured == true
    input.tsig_clock_skew_seconds > 300
}

exposures contains _tsig_shared_secret_replay_or_weak_mac_def if {
    count(tsig_shared_secret_replay_or_weak_mac) > 0
}

_dns_query_amplification_and_reflection_def := {
    "name": "Dns Query Amplification And Reflection",
    "description": "UDP-based DNS queries with spoofed source IPs allow attackers to use the DNS channel as an amplification vector; large responses to small queries can be directed at victims, and the absence of rate limiting on the transit path exacerbates the amplification ratio.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "DNS amplification and reflection attacks abuse the DNS protocol to generate high-volume traffic against targets."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Open DNS servers are leveraged as reflectors in amplification attacks, making server infrastructure central to this vector."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_query_amplification_and_reflection[_dns_query_amplification_and_reflection_def] if {
    input.recursive_queries_publicly_accessible == true
    not input.dns_response_rate_limiting_enabled
}

dns_query_amplification_and_reflection[_dns_query_amplification_and_reflection_def] if {
    input.recursive_queries_publicly_accessible == true
    input.dnssec_enabled == true
}

exposures contains _dns_query_amplification_and_reflection_def if {
    count(dns_query_amplification_and_reflection) > 0
}

_dns_over_https_doh_inspection_bypass_def := {
    "name": "Dns Over Https Doh Inspection Bypass",
    "description": "When DNS-over-HTTPS is used without proper certificate pinning or channel validation, the encrypted DNS channel may bypass network-level monitoring controls, preventing detection of data exfiltration or C2 beaconing encoded in DNS queries.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "DoH tunnels DNS queries over HTTPS to bypass network inspection and DNS monitoring controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "DNS-over-HTTPS encapsulates DNS within HTTPS traffic, representing a protocol tunneling technique to evade inspection."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_over_https_doh_inspection_bypass[_dns_over_https_doh_inspection_bypass_def] if {
    input.doh_enabled == true
    not input.certificate_pinning_enforced
}

dns_over_https_doh_inspection_bypass[_dns_over_https_doh_inspection_bypass_def] if {
    input.doh_enabled == true
    input.dns_monitoring_bypass_risk == true
}

exposures contains _dns_over_https_doh_inspection_bypass_def if {
    count(dns_over_https_doh_inspection_bypass) > 0
}

_information_leakage_via_query_name_minimisation_absence_def := {
    "name": "Information Leakage Via Query Name Minimisation Absence",
    "description": "Without QNAME minimisation (RFC 7816), full internal query names are sent to each recursive resolver hop in the resolution chain, leaking sensitive internal hostnames to intermediate resolvers that do not need that information.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Without query name minimisation, full query names are exposed to intermediate resolvers enabling passive DNS reconnaissance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Absence of query name minimisation leaks full DNS query details to upstream servers, facilitating information gathering."
        }
    ],
    "attack_vector": "NETWORK"
}

information_leakage_via_query_name_minimisation_absence[_information_leakage_via_query_name_minimisation_absence_def] if {
    not input.qname_minimisation_enabled
    input.internal_domains_resolved == true
}

exposures contains _information_leakage_via_query_name_minimisation_absence_def if {
    count(information_leakage_via_query_name_minimisation_absence) > 0
}

_dns_query_flood_no_rate_limiting_def := {
    "name": "Dns Query Flood No Rate Limiting",
    "description": "The DNS communication channel lacks source-based rate limiting, enabling a volumetric flood of malformed or legitimate-looking queries to exhaust resolver capacity, degrading availability and potentially triggering misconfigurations that weaken security posture.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "DNS query floods without rate limiting target DNS server infrastructure availability, making server compromise central."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Flooding DNS queries abuses the DNS protocol to exhaust resolver resources due to absent rate limiting."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_query_flood_no_rate_limiting[_dns_query_flood_no_rate_limiting_def] if {
    not input.dns_source_rate_limiting_enabled
}

dns_query_flood_no_rate_limiting[_dns_query_flood_no_rate_limiting_def] if {
    input.dns_source_rate_limiting_enabled == true
    input.dns_resolver_max_queries_per_second == 0
}

exposures contains _dns_query_flood_no_rate_limiting_def if {
    count(dns_query_flood_no_rate_limiting) > 0
}

_unvalidated_routing_path_for_dns_traffic_def := {
    "name": "Unvalidated Routing Path For Dns Traffic",
    "description": "DNS queries routed over BGP-announced paths without RPKI or route filtering are subject to BGP hijacking, silently redirecting DNS traffic to attacker-controlled resolvers without the client detecting the routing change.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1583.002",
            "name": "DNS Server",
            "relevance": "Attackers can establish malicious DNS servers along unvalidated routing paths to intercept and manipulate DNS traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Unvalidated DNS routing paths allow adversaries to compromise intermediate DNS infrastructure to redirect traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

unvalidated_routing_path_for_dns_traffic[_unvalidated_routing_path_for_dns_traffic_def] if {
    not input.rpki_validation_enabled
    input.bgp_route_filtering_policy in ["permissive", "none"]
    not input.dns_traffic_uses_encrypted_transport
}

unvalidated_routing_path_for_dns_traffic[_unvalidated_routing_path_for_dns_traffic_def] if {
    not input.rpki_validation_enabled
    input.bgp_route_filtering_policy == "none"
}

exposures contains _unvalidated_routing_path_for_dns_traffic_def if {
    count(unvalidated_routing_path_for_dns_traffic) > 0
}
