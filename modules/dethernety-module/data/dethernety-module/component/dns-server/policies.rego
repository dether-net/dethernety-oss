package _dt_built_in.exposures.dns_server

_dnssec_validation_disabled_def := {
    "name": "Dnssec Validation Disabled",
    "description": "DNSSEC validation is not enforced on the resolver, allowing forged or tampered DNS responses to be accepted as valid without cryptographic verification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Disabling DNSSEC validation exposes DNS infrastructure to reconnaissance and manipulation, directly enabling adversaries to gather or spoof DNS information."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1583.002",
            "name": "DNS Server",
            "relevance": "Without DNSSEC validation, attackers can more easily compromise or impersonate DNS servers to redirect traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

dnssec_validation_disabled[_dnssec_validation_disabled_def] if {
    not input.dnssec_validation_enabled
}

dnssec_validation_disabled[_dnssec_validation_disabled_def] if {
    input.dnssec_validation_setting in ["no", "not_configured"]
}

dnssec_validation_disabled[_dnssec_validation_disabled_def] if {
    input.dnssec_validation_enabled == true
    not input.trust_anchors_configured
}

exposures contains _dnssec_validation_disabled_def if {
    count(dnssec_validation_disabled) > 0
}

_open_recursive_resolver_exposure_def := {
    "name": "Open Recursive Resolver Exposure",
    "description": "The resolver accepts recursive queries from any source IP rather than restricting recursion to authorized clients, enabling DNS amplification attacks and unintended query handling.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "An open recursive resolver can be exploited by adversaries for DNS-based communication and amplification attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Exposed recursive resolvers can be compromised or abused by attackers as part of DNS infrastructure attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

open_recursive_resolver_exposure[_open_recursive_resolver_exposure_def] if {
    input.recursion_access_policy == "open"
}

open_recursive_resolver_exposure[_open_recursive_resolver_exposure_def] if {
    count(input.authorized_client_networks) == 0
    not input.rate_limiting_enabled
}

exposures contains _open_recursive_resolver_exposure_def if {
    count(open_recursive_resolver_exposure) > 0
}

_unencrypted_upstream_forwarding_def := {
    "name": "Unencrypted Upstream Forwarding",
    "description": "Queries forwarded to upstream resolvers use plaintext UDP/TCP rather than DNS-over-TLS or DNS-over-HTTPS, exposing query content and responses to interception and tampering in transit.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Unencrypted DNS forwarding exposes query content to interception, enabling adversaries to gather DNS information in transit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Unencrypted upstream forwarding can be exploited for tunneling malicious traffic through DNS without detection."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_upstream_forwarding[_unencrypted_upstream_forwarding_def] if {
    input.upstream_transport_protocol == "udp"
}

unencrypted_upstream_forwarding[_unencrypted_upstream_forwarding_def] if {
    input.upstream_transport_protocol in ["dot", "doh"]
    not input.certificate_validation_enforced
}

exposures contains _unencrypted_upstream_forwarding_def if {
    count(unencrypted_upstream_forwarding) > 0
}

_dns_cache_poisoning_susceptibility_def := {
    "name": "Dns Cache Poisoning Susceptibility",
    "description": "The resolver uses predictable source port or transaction ID randomization, making it susceptible to Kaminsky-style cache poisoning attacks that inject malicious records.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.003",
            "name": "DNS Calculation",
            "relevance": "DNS cache poisoning directly exploits dynamic DNS resolution mechanisms to redirect traffic to adversary-controlled infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568",
            "name": "Dynamic Resolution",
            "relevance": "Cache poisoning susceptibility enables adversaries to manipulate dynamic DNS resolution to serve malicious responses."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_cache_poisoning_susceptibility[_dns_cache_poisoning_susceptibility_def] if {
    not input.source_port_randomization_enabled
    not input.dnssec_validation_enforced
}

dns_cache_poisoning_susceptibility[_dns_cache_poisoning_susceptibility_def] if {
    not input.transaction_id_randomization_enabled
    not input.dnssec_validation_enforced
}

dns_cache_poisoning_susceptibility[_dns_cache_poisoning_susceptibility_def] if {
    not input.source_port_randomization_enabled
    not input.transaction_id_randomization_enabled
}

exposures contains _dns_cache_poisoning_susceptibility_def if {
    count(dns_cache_poisoning_susceptibility) > 0
}

_excessive_negative_cache_ttl_def := {
    "name": "Excessive Negative Cache Ttl",
    "description": "Negative cache TTL values are set too high, prolonging the effect of poisoned NXDOMAIN responses and delaying recovery after DNS infrastructure changes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1583.002",
            "name": "DNS Server",
            "relevance": "Excessive negative cache TTL can be leveraged to sustain denial of legitimate DNS records, supporting adversary DNS infrastructure abuse."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.001",
            "name": "Fast Flux DNS",
            "relevance": "High negative TTL values interact with fast flux techniques by affecting how long false negative responses persist in caches."
        }
    ],
    "attack_vector": "NETWORK"
}

excessive_negative_cache_ttl[_excessive_negative_cache_ttl_def] if {
    input.negative_cache_ttl_seconds > 3600
}

excessive_negative_cache_ttl[_excessive_negative_cache_ttl_def] if {
    not input.negative_ttl_cap_enforced
}

exposures contains _excessive_negative_cache_ttl_def if {
    count(excessive_negative_cache_ttl) > 0
}

_unrestricted_zone_transfer_def := {
    "name": "Unrestricted Zone Transfer",
    "description": "AXFR/IXFR zone transfer requests are not restricted by source IP or TSIG authentication, allowing unauthorized parties to enumerate the full zone contents.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "Unrestricted zone transfers allow adversaries to enumerate the entire DNS zone, revealing internal network topology and configuration."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Zone transfer data can be exfiltrated using DNS protocols, exposing sensitive infrastructure details to attackers."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_zone_transfer[_unrestricted_zone_transfer_def] if {
    not input.zone_transfer_acl_configured
    not input.tsig_authentication_enabled
}

unrestricted_zone_transfer[_unrestricted_zone_transfer_def] if {
    input.zone_transfer_acl_configured == true
    not input.tsig_authentication_enabled
}

exposures contains _unrestricted_zone_transfer_def if {
    count(unrestricted_zone_transfer) > 0
}

_resolver_process_running_with_excessive_privileges_def := {
    "name": "Resolver Process Running With Excessive Privileges",
    "description": "The DNS resolver process runs as root or a highly privileged account rather than a dedicated low-privilege service account, increasing blast radius if the process is compromised.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "A resolver running with excessive privileges amplifies the impact of any exploitation, potentially exposing broader DNS data and system access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Excessive privileges on a DNS resolver process make it a higher-value target for attackers seeking to compromise DNS server infrastructure."
        }
    ],
    "attack_vector": "LOCAL"
}

resolver_process_running_with_excessive_privileges[_resolver_process_running_with_excessive_privileges_def] if {
    input.resolver_process_user == "root"
}

resolver_process_running_with_excessive_privileges[_resolver_process_running_with_excessive_privileges_def] if {
    input.resolver_process_effective_uid == 0
}

resolver_process_running_with_excessive_privileges[_resolver_process_running_with_excessive_privileges_def] if {
    not input.resolver_dedicated_service_account_configured
    input.resolver_process_effective_uid < 100
}

exposures contains _resolver_process_running_with_excessive_privileges_def if {
    count(resolver_process_running_with_excessive_privileges) > 0
}

_missing_rate_limiting_on_responses_def := {
    "name": "Missing Rate Limiting On Responses",
    "description": "Response Rate Limiting (RRL) is not configured, allowing the resolver to be weaponized for DNS-based amplification and reflection denial-of-service attacks against third parties.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498.002",
            "name": "Reflection Amplification",
            "relevance": "Absence of rate limiting directly enables DNS reflection and amplification DDoS attacks using the resolver as an amplifier."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Without rate limiting, DNS servers can be abused as attack infrastructure for large-scale denial-of-service campaigns."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_rate_limiting_on_responses[_missing_rate_limiting_on_responses_def] if {
    not input.rate_limiting_enabled
}

missing_rate_limiting_on_responses[_missing_rate_limiting_on_responses_def] if {
    input.rate_limiting_enabled == true
    input.rrl_responses_per_second == 0
}

missing_rate_limiting_on_responses[_missing_rate_limiting_on_responses_def] if {
    input.rate_limiting_enabled == true
    input.rrl_responses_per_second > 500
}

exposures contains _missing_rate_limiting_on_responses_def if {
    count(missing_rate_limiting_on_responses) > 0
}

_stale_trust_anchors_for_dnssec_def := {
    "name": "Stale Trust Anchors For Dnssec",
    "description": "DNSSEC trust anchors (root KSK) are outdated or not automatically updated, causing DNSSEC validation failures or silent fallback to unvalidated resolution after key rollovers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "name": "Install Root Certificate",
            "relevance": "Stale DNSSEC trust anchors are analogous to outdated root certificates, allowing adversaries to present fraudulent but accepted cryptographic material."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Stale trust anchors represent outdated cryptographic trust material that adversaries can exploit to bypass DNSSEC validation."
        }
    ],
    "attack_vector": "NETWORK"
}

stale_trust_anchors_for_dnssec[_stale_trust_anchors_for_dnssec_def] if {
    not input.trust_anchor_auto_update_enabled
}

stale_trust_anchors_for_dnssec[_stale_trust_anchors_for_dnssec_def] if {
    input.trust_anchor_last_updated_days_ago > 365
}

stale_trust_anchors_for_dnssec[_stale_trust_anchors_for_dnssec_def] if {
    input.dnssec_validation_mode in ["permissive", "disabled"]
}

exposures contains _stale_trust_anchors_for_dnssec_def if {
    count(stale_trust_anchors_for_dnssec) > 0
}

_insufficient_query_logging_and_auditing_def := {
    "name": "Insufficient Query Logging And Auditing",
    "description": "DNS query and response logging is disabled or insufficiently detailed, preventing detection of DNS tunneling, data exfiltration, or command-and-control activity over DNS.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Without adequate query logging, DNS-based command-and-control communication and data exfiltration go undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Insufficient logging prevents passive DNS analysis needed to detect adversary reconnaissance and malicious DNS activity."
        }
    ]
}

insufficient_query_logging_and_auditing[_insufficient_query_logging_and_auditing_def] if {
    not input.query_logging_enabled
}

insufficient_query_logging_and_auditing[_insufficient_query_logging_and_auditing_def] if {
    input.query_logging_enabled == true
    not "client_ip" in input.logged_fields
}

insufficient_query_logging_and_auditing[_insufficient_query_logging_and_auditing_def] if {
    input.query_logging_enabled == true
    input.log_retention_days < 7
}

exposures contains _insufficient_query_logging_and_auditing_def if {
    count(insufficient_query_logging_and_auditing) > 0
}

_unpatched_resolver_software_def := {
    "name": "Unpatched Resolver Software",
    "description": "The DNS resolver software is not kept current with security patches, leaving known vulnerabilities in parsing, validation, or protocol handling exploitable by remote attackers.",
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
            "relevance": "Unpatched resolver software contains known vulnerabilities that adversaries can exploit to compromise the DNS server infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Exploiting unpatched vulnerabilities in DNS resolvers can allow adversaries to manipulate DNS communications and responses."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_resolver_software[_unpatched_resolver_software_def] if {
    input.version_has_known_cve == true
}

unpatched_resolver_software[_unpatched_resolver_software_def] if {
    input.days_since_last_patch > 90
    not input.patch_management_enabled
}

exposures contains _unpatched_resolver_software_def if {
    count(unpatched_resolver_software) > 0
}

_permissive_access_control_list_for_queries_def := {
    "name": "Permissive Access Control List For Queries",
    "description": "The resolver's ACLs permit query access from unauthorized network ranges, enabling information gathering about internal hostnames and infrastructure topology by unauthorized clients.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590",
            "name": "Gather Victim Network Information",
            "relevance": "Permissive ACLs allow unauthorized parties to query the resolver, enabling broad network reconnaissance of the victim environment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "Overly permissive query ACLs enable adversaries to perform network configuration discovery through unrestricted DNS queries."
        }
    ],
    "attack_vector": "NETWORK"
}

permissive_access_control_list_for_queries[_permissive_access_control_list_for_queries_def] if {
    input.query_acl_allows_any == true
}

permissive_access_control_list_for_queries[_permissive_access_control_list_for_queries_def] if {
    "0.0.0.0/0" in input.permitted_query_source_ranges
}

permissive_access_control_list_for_queries[_permissive_access_control_list_for_queries_def] if {
    "::/0" in input.permitted_query_source_ranges
}

exposures contains _permissive_access_control_list_for_queries_def if {
    count(permissive_access_control_list_for_queries) > 0
}

_dns_rebinding_protection_absent_def := {
    "name": "Dns Rebinding Protection Absent",
    "description": "The resolver does not validate or filter responses containing private/loopback addresses for public domain names, enabling DNS rebinding attacks that bypass same-origin policy in browsers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.003",
            "name": "DNS Calculation",
            "relevance": "DNS rebinding attacks exploit DNS resolution logic to bypass same-origin policies, directly relating to DNS calculation and manipulation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Absent DNS rebinding protection allows attackers to leverage DNS as a channel to pivot into internal networks."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_rebinding_protection_absent[_dns_rebinding_protection_absent_def] if {
    not input.dns_rebinding_filter_enabled
    not input.response_policy_zone_configured
}

dns_rebinding_protection_absent[_dns_rebinding_protection_absent_def] if {
    input.private_address_response_policy in ["log_only", "none"]
    not input.response_policy_zone_configured
}

exposures contains _dns_rebinding_protection_absent_def if {
    count(dns_rebinding_protection_absent) > 0
}

_chroot_or_namespace_isolation_not_applied_def := {
    "name": "Chroot Or Namespace Isolation Not Applied",
    "description": "The resolver process is not confined within a chroot jail, container namespace, or mandatory access control profile, allowing a compromised process to access the broader host filesystem.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Without chroot or namespace isolation, a compromised DNS resolver process can escape its intended boundary and access the broader host system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543.005",
            "name": "Container Service",
            "relevance": "Lack of namespace isolation is analogous to missing container isolation controls, enabling privilege escalation and host escape."
        }
    ],
    "attack_vector": "LOCAL"
}

chroot_or_namespace_isolation_not_applied[_chroot_or_namespace_isolation_not_applied_def] if {
    not input.chroot_jail_enabled
    not input.container_namespace_isolated
    not input.mac_profile_enforced
}

exposures contains _chroot_or_namespace_isolation_not_applied_def if {
    count(chroot_or_namespace_isolation_not_applied) > 0
}
