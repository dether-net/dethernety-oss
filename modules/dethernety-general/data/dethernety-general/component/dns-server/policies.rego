package _dt_built_in.exposures.dns_server



_cache_poisoning_spoofed_answer_injection_def := {
    "name": "Cache poisoning / spoofed-answer injection",
    "description": "A resolver that does not validate DNSSEC signatures (or runs a build before the CVE-2025-40778 fix line that is overly lenient in accepting answer records) lets a remote, off-path attacker inject forged domain-to-IP mappings into the cache, silently redirecting clients to attacker-controlled hosts.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cache_poisoning_spoofed_answer_injection[_cache_poisoning_spoofed_answer_injection_def] if {
    input.dnssec_validation == "no"
}

cache_poisoning_spoofed_answer_injection[_cache_poisoning_spoofed_answer_injection_def] if {
    input.named_below_cve_fix_line == true
}

exposures contains _cache_poisoning_spoofed_answer_injection_def if {
    count(cache_poisoning_spoofed_answer_injection) > 0
}

_open_recursive_resolver_amplification_reflection_ddos_def := {
    "name": "Open recursive resolver \u2014 amplification & reflection DDoS",
    "description": "Recursion enabled with no allow-recursion ACL turns the server into an open resolver abused as a reflector: spoofed-source small queries yield large responses flooding a third-party victim. Restricted recursion, Response Rate Limiting, and minimal-responses are the mitigations.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

open_recursive_resolver_amplification_reflection_ddos[_open_recursive_resolver_amplification_reflection_ddos_def] if {
    input.open_recursion_enabled == true
    input.recursion_acl_unrestricted == true
}

open_recursive_resolver_amplification_reflection_ddos[_open_recursive_resolver_amplification_reflection_ddos_def] if {
    input.open_recursion_enabled == true
    not input.ddos_protection_in_place
}

open_recursive_resolver_amplification_reflection_ddos[_open_recursive_resolver_amplification_reflection_ddos_def] if {
    not input.response_rate_limiting_enabled
    not input.minimal_responses_enabled
}

exposures contains _open_recursive_resolver_amplification_reflection_ddos_def if {
    count(open_recursive_resolver_amplification_reflection_ddos) > 0
}

_unrestricted_zone_transfer_axfr_reconnaissance_def := {
    "name": "Unrestricted zone transfer (AXFR) reconnaissance",
    "description": "allow-transfer { any; } (or no TSIG gating) lets anyone pull the full zone via AXFR, exposing the entire internal namespace \u2014 hostnames and internal IPs \u2014 for targeting. Transfers should be limited to TSIG-authenticated secondaries.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "attributes": {
                "justification": "Unrestricted AXFR lets an adversary gather victim DNS/network information by dumping the full zone (hostnames, internal IPs) for targeting."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_zone_transfer_axfr_reconnaissance[_unrestricted_zone_transfer_axfr_reconnaissance_def] if {
    input.zone_transfer_unrestricted == true
}

unrestricted_zone_transfer_axfr_reconnaissance[_unrestricted_zone_transfer_axfr_reconnaissance_def] if {
    not input.tsig_authenticated_transfers
}

exposures contains _unrestricted_zone_transfer_axfr_reconnaissance_def if {
    count(unrestricted_zone_transfer_axfr_reconnaissance) > 0
}

_dns_tunneling_exfiltration_over_dns_undetected_def := {
    "name": "DNS tunneling / exfiltration over DNS undetected",
    "description": "With no query logging or egress anomaly analysis, adversaries encode data and C2 inside high-entropy / high-volume subdomain lookups that slip past egress filtering entirely unobserved. Detection rests on query audit logging shipped off-box.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

dns_tunneling_exfiltration_over_dns_undetected[_dns_tunneling_exfiltration_over_dns_undetected_def] if {
    not input.dns_query_logging_enabled
}

dns_tunneling_exfiltration_over_dns_undetected[_dns_tunneling_exfiltration_over_dns_undetected_def] if {
    not input.access_audit_trail_enabled
}

dns_tunneling_exfiltration_over_dns_undetected[_dns_tunneling_exfiltration_over_dns_undetected_def] if {
    not input.logs_stored_on_separate_system
}

dns_tunneling_exfiltration_over_dns_undetected[_dns_tunneling_exfiltration_over_dns_undetected_def] if {
    not input.security_events_fully_logged
}

exposures contains _dns_tunneling_exfiltration_over_dns_undetected_def if {
    count(dns_tunneling_exfiltration_over_dns_undetected) > 0
}

_exposed_unauthenticated_rndc_control_channel_def := {
    "name": "Exposed / unauthenticated rndc control channel",
    "description": "An rndc administrative control channel bound to a non-loopback address or without an HMAC shared-secret key permits remote takeover of the nameserver \u2014 reconfiguring recursion, dumping cache, or stopping the service.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_unauthenticated_rndc_control_channel[_exposed_unauthenticated_rndc_control_channel_def] if {
    not input.rndc_bound_to_loopback_only
}

exposed_unauthenticated_rndc_control_channel[_exposed_unauthenticated_rndc_control_channel_def] if {
    not input.rndc_key_configured
}

exposures contains _exposed_unauthenticated_rndc_control_channel_def if {
    count(exposed_unauthenticated_rndc_control_channel) > 0
}

_weak_transfer_notify_secret_ip_only_spoofable_trust_def := {
    "name": "Weak transfer/NOTIFY secret \u2014 IP-only spoofable trust",
    "description": "Primary-secondary transfers and NOTIFY gated only by raw source-IP ACLs (no TSIG HMAC key) let an attacker who can spoof a secondary's address pull a zone or inject spoofed zone-change notifications. A shared HMAC-SHA256 key authenticates the transaction.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_transfer_notify_secret_ip_only_spoofable_trust[_weak_transfer_notify_secret_ip_only_spoofable_trust_def] if {
    not input.tsig_authenticated_transfers
    input.transfers_gated_by_ip_only == true
}

weak_transfer_notify_secret_ip_only_spoofable_trust[_weak_transfer_notify_secret_ip_only_spoofable_trust_def] if {
    not input.tsig_authenticated_notify
}

exposures contains _weak_transfer_notify_secret_ip_only_spoofable_trust_def if {
    count(weak_transfer_notify_secret_ip_only_spoofable_trust) > 0
}

_version_disclosure_over_exposed_listener_def := {
    "name": "Version disclosure & over-exposed listener",
    "description": "An unset version directive leaks the precise BIND version via the version.bind CHAOS query, letting attackers match known CVEs; listen-on { any; } on a server meant to be internal-only widens the reachable attack surface beyond its intended networks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "low",
    "score": 3.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1592",
            "attributes": {
                "justification": "A disclosed version.bind string and an over-exposed listener let an adversary gather victim host/software information (precise named build, reachable surface) to match known CVEs and plan exploitation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

version_disclosure_over_exposed_listener[_version_disclosure_over_exposed_listener_def] if {
    input.version_string_disclosed == true
}

version_disclosure_over_exposed_listener[_version_disclosure_over_exposed_listener_def] if {
    input.listener_bound_to_any == true
}

exposures contains _version_disclosure_over_exposed_listener_def if {
    count(version_disclosure_over_exposed_listener) > 0
}

_unpatched_named_remotely_exploitable_poisoning_dos_cves_def := {
    "name": "Unpatched named \u2014 remotely-exploitable poisoning & DoS CVEs",
    "description": "Running a build below the relevant ISC fix line directly enables the attacks this component models \u2014 cache poisoning (CVE-2025-40778, fixed 9.18.41/9.20.15/9.21.14) and resource-exhaustion DoS (DoH flood / malformed DNSKEY / additional-section bloat). Patch level is the supply-chain control floor.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An unpatched named exposes a remotely-exploitable public-facing service flaw (cache poisoning CVE-2025-40778), the classic Exploit Public-Facing Application path."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.004",
            "attributes": {
                "justification": "The unpatched DoS CVEs (DoH flood / malformed DNSKEY / additional-section bloat) are application/system exploitation driving endpoint denial of service against named."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_named_remotely_exploitable_poisoning_dos_cves[_unpatched_named_remotely_exploitable_poisoning_dos_cves_def] if {
    input.named_below_cve_fix_line == true
}

unpatched_named_remotely_exploitable_poisoning_dos_cves[_unpatched_named_remotely_exploitable_poisoning_dos_cves_def] if {
    not input.named_patched_within_sla
}

exposures contains _unpatched_named_remotely_exploitable_poisoning_dos_cves_def if {
    count(unpatched_named_remotely_exploitable_poisoning_dos_cves) > 0
}
