package _dt_built_in.exposures.core_infrastructure_layer



_dns_recursive_query_exfiltration_via_zone_boundary_def := {
    "name": "Dns Recursive Query Exfiltration Via Zone Boundary",
    "description": "Internal DNS resolvers permitted to forward recursive queries outbound without egress filtering allow adversaries to tunnel data or pivot trust across zone boundaries using DNS-over-HTTPS or encoded TXT records. The boundary fails to distinguish legitimate resolution traffic from covert channel abuse.",
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
            "relevance": "DNS is used as the application layer protocol to exfiltrate data through recursive queries across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "DNS recursive queries can be used to tunnel exfiltrated data through protocol encapsulation across network zone boundaries."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_recursive_query_exfiltration_via_zone_boundary[_dns_recursive_query_exfiltration_via_zone_boundary_def] if {
    not input.recursive_query_egress_filtering_enabled
}

dns_recursive_query_exfiltration_via_zone_boundary[_dns_recursive_query_exfiltration_via_zone_boundary_def] if {
    input.dns_over_https_allowed_unrestricted == true
    not input.inter_zone_dns_traffic_monitored
}

dns_recursive_query_exfiltration_via_zone_boundary[_dns_recursive_query_exfiltration_via_zone_boundary_def] if {
    not input.recursive_query_egress_filtering_enabled
    not input.txt_record_payload_size_limit_enforced
}

exposures contains _dns_recursive_query_exfiltration_via_zone_boundary_def if {
    count(dns_recursive_query_exfiltration_via_zone_boundary) > 0
}

_smtp_relay_open_across_trust_zones_def := {
    "name": "Smtp Relay Open Across Trust Zones",
    "description": "Email relay services that accept SMTP connections from multiple trust zones without strict source zone enforcement allow adversaries to relay messages laterally across zone boundaries, bypassing perimeter controls by abusing trusted relay designations assigned to foundational infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "name": "Mail Protocols",
            "relevance": "Open SMTP relays across trust zones directly exploit mail protocols to traverse security boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "Open SMTP relays across trust zones enable email spoofing by allowing unauthenticated message relay."
        }
    ],
    "attack_vector": "ADJACENT"
}

smtp_relay_open_across_trust_zones[_smtp_relay_open_across_trust_zones_def] if {
    not input.smtp_relay_source_zone_restriction
}

smtp_relay_open_across_trust_zones[_smtp_relay_open_across_trust_zones_def] if {
    count(input.accepted_source_trust_zones) > 1
}

smtp_relay_open_across_trust_zones[_smtp_relay_open_across_trust_zones_def] if {
    not input.relay_smtp_port_ingress_filter_present
}

exposures contains _smtp_relay_open_across_trust_zones_def if {
    count(smtp_relay_open_across_trust_zones) > 0
}

_zone_transfer_unrestricted_between_segments_def := {
    "name": "Zone Transfer Unrestricted Between Segments",
    "description": "DNS zone transfer (AXFR/IXFR) permitted beyond the authoritative segment boundary exposes full zone topology to adjacent or lower-trust zones. Lack of TSIG enforcement or IP-based ACL at the boundary enables enumeration of internal infrastructure from a compromised zone.",
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
            "relevance": "Unrestricted zone transfers expose full DNS zone data, enabling passive DNS reconnaissance across network segments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Unrestricted zone transfers between segments represent a DNS server misconfiguration that can be exploited to compromise DNS infrastructure."
        }
    ],
    "attack_vector": "ADJACENT"
}

zone_transfer_unrestricted_between_segments[_zone_transfer_unrestricted_between_segments_def] if {
    input.axfr_allowed_source_restriction == "none"
}

zone_transfer_unrestricted_between_segments[_zone_transfer_unrestricted_between_segments_def] if {
    input.axfr_allowed_source_restriction == "restricted_cross_segment"
    not input.tsig_authentication_enforced
}

zone_transfer_unrestricted_between_segments[_zone_transfer_unrestricted_between_segments_def] if {
    not input.boundary_firewall_blocks_axfr
    not input.tsig_authentication_enforced
    input.axfr_allowed_source_restriction != "none"
}

exposures contains _zone_transfer_unrestricted_between_segments_def if {
    count(zone_transfer_unrestricted_between_segments) > 0
}

_ingress_filtering_bypass_via_split_horizon_misconfiguration_def := {
    "name": "Ingress Filtering Bypass Via Split Horizon Misconfiguration",
    "description": "Incorrectly configured split-horizon DNS with overlapping view definitions may cause the boundary to respond with internal zone data to queries originating from external or lower-trust segments. The ingress filtering logic fails to enforce view separation at the zone boundary level.",
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
            "relevance": "Split-horizon DNS misconfigurations allow attackers to bypass ingress filtering by bridging network boundaries through improper DNS view separation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.001",
            "name": "Fast Flux DNS",
            "relevance": "Split-horizon misconfigurations can be abused similarly to fast flux techniques to obscure malicious infrastructure and bypass ingress controls."
        }
    ],
    "attack_vector": "NETWORK"
}

ingress_filtering_bypass_via_split_horizon_misconfiguration[_ingress_filtering_bypass_via_split_horizon_misconfiguration_def] if {
    input.split_horizon_views_configured == true
    input.view_acl_overlap_present == true
    not input.ingress_filter_enforces_dns_view_boundary
}

ingress_filtering_bypass_via_split_horizon_misconfiguration[_ingress_filtering_bypass_via_split_horizon_misconfiguration_def] if {
    not input.split_horizon_views_configured
    not input.ingress_filter_enforces_dns_view_boundary
}

exposures contains _ingress_filtering_bypass_via_split_horizon_misconfiguration_def if {
    count(ingress_filtering_bypass_via_split_horizon_misconfiguration) > 0
}

_service_account_credential_propagation_across_zones_def := {
    "name": "Service Account Credential Propagation Across Zones",
    "description": "Shared service accounts or API credentials used by DNS and email services that span multiple trust zones allow a compromise in one zone to propagate authentication context into a higher-trust zone. The boundary lacks credential isolation enforcement preventing cross-zone credential reuse.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.002",
            "name": "Domain Accounts",
            "relevance": "Service account credentials propagating across zones most commonly involve domain accounts whose privileges extend across network segment boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "name": "Trusted Relationship",
            "relevance": "Cross-zone credential propagation exploits trusted relationships between zones that allow service accounts to authenticate across security boundaries."
        }
    ],
    "attack_vector": "ADJACENT"
}

service_account_credential_propagation_across_zones[_service_account_credential_propagation_across_zones_def] if {
    input.credential_zone_scope == "multi_zone"
    not input.cross_zone_credential_reuse_enforced_prevention
}

service_account_credential_propagation_across_zones[_service_account_credential_propagation_across_zones_def] if {
    input.credential_zone_scope == "unknown"
    not input.cross_zone_credential_reuse_enforced_prevention
}

service_account_credential_propagation_across_zones[_service_account_credential_propagation_across_zones_def] if {
    input.credential_zone_scope == "multi_zone"
    not input.credential_rotation_independent_per_zone
}

exposures contains _service_account_credential_propagation_across_zones_def if {
    count(service_account_credential_propagation_across_zones) > 0
}

_management_plane_reachability_from_service_zone_def := {
    "name": "Management Plane Reachability From Service Zone",
    "description": "Management interfaces for DNS and email infrastructure reachable from the same network segment as the service plane collapse the boundary between operational and administrative trust zones. This enables lateral movement from a compromised service host to management infrastructure without crossing an enforced boundary.",
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
            "relevance": "Reachability of the management plane from the service zone represents a network boundary bridging condition that undermines zone separation."
        }
    ],
    "attack_vector": "LOCAL"
}

management_plane_reachability_from_service_zone[_management_plane_reachability_from_service_zone_def] if {
    input.management_service_plane_isolated
    not input.management_service_plane_isolated
}

management_plane_reachability_from_service_zone[_management_plane_reachability_from_service_zone_def] if {
    not input.management_service_plane_isolated
    input.management_service_plane_isolated
}

exposures contains _management_plane_reachability_from_service_zone_def if {
    count(management_plane_reachability_from_service_zone) > 0
}

_dns_dynamic_update_propagation_without_zone_scoping_def := {
    "name": "Dns Dynamic Update Propagation Without Zone Scoping",
    "description": "Dynamic DNS update permissions (RFC 2136) not scoped to specific zones or source segments allow clients in lower-trust zones to modify DNS records that resolve services in higher-trust zones. The boundary fails to enforce zone-scoped update ACLs, enabling trust manipulation through record poisoning.",
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
            "relevance": "Unscoped DNS dynamic updates allow adversaries to manipulate DNS server records across zones, compromising DNS infrastructure integrity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.001",
            "name": "Fast Flux DNS",
            "relevance": "Unrestricted dynamic DNS updates without zone scoping can be leveraged to rapidly alter DNS records in a manner analogous to fast flux techniques."
        }
    ],
    "attack_vector": "ADJACENT"
}

dns_dynamic_update_propagation_without_zone_scoping[_dns_dynamic_update_propagation_without_zone_scoping_def] if {
    not input.dynamic_update_acl_zone_scoped
}

dns_dynamic_update_propagation_without_zone_scoping[_dns_dynamic_update_propagation_without_zone_scoping_def] if {
    not input.update_source_segment_restricted
    not input.tsig_authentication_enforced
}

exposures contains _dns_dynamic_update_propagation_without_zone_scoping_def if {
    count(dns_dynamic_update_propagation_without_zone_scoping) > 0
}

_inter_zone_monitoring_gap_on_foundational_service_traffic_def := {
    "name": "Inter Zone Monitoring Gap On Foundational Service Traffic",
    "description": "Traffic flows between foundational service segments and adjacent trust zones lack dedicated inspection or logging at the boundary, creating blind spots for lateral movement detection. DNS query telemetry and SMTP session metadata are not captured at zone egress points, preventing anomaly detection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Monitoring gaps on foundational service traffic between zones allow adversaries to sniff network traffic without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Monitoring gaps on inter-zone traffic enable undetected network boundary bridging by adversaries traversing zone boundaries."
        }
    ],
    "attack_vector": "ADJACENT"
}

inter_zone_monitoring_gap_on_foundational_service_traffic[_inter_zone_monitoring_gap_on_foundational_service_traffic_def] if {
    not input.zone_boundary_inspection_enabled
    not input.dns_query_telemetry_captured_at_egress
}

inter_zone_monitoring_gap_on_foundational_service_traffic[_inter_zone_monitoring_gap_on_foundational_service_traffic_def] if {
    not input.zone_boundary_inspection_enabled
    not input.smtp_session_metadata_captured_at_egress
}

inter_zone_monitoring_gap_on_foundational_service_traffic[_inter_zone_monitoring_gap_on_foundational_service_traffic_def] if {
    not input.dns_query_telemetry_captured_at_egress
    not input.inter_zone_anomaly_detection_configured
}

inter_zone_monitoring_gap_on_foundational_service_traffic[_inter_zone_monitoring_gap_on_foundational_service_traffic_def] if {
    not input.smtp_session_metadata_captured_at_egress
    not input.inter_zone_anomaly_detection_configured
}

exposures contains _inter_zone_monitoring_gap_on_foundational_service_traffic_def if {
    count(inter_zone_monitoring_gap_on_foundational_service_traffic) > 0
}

_email_header_trust_inheritance_across_zone_boundary_def := {
    "name": "Email Header Trust Inheritance Across Zone Boundary",
    "description": "Internal mail transfer agents that unconditionally preserve or elevate trust indicators (Received headers, internal routing metadata) from lower-trust zones allow adversaries to craft messages that appear to originate from within a higher-trust zone, bypassing zone-aware filtering policies at downstream boundaries.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "Email header trust inheritance across zone boundaries enables spoofing attacks where headers from an inner trusted zone are accepted without re-validation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.003",
            "name": "Email Forwarding Rule",
            "relevance": "Trust inheritance in email headers across zones can be abused in conjunction with forwarding rules to escalate access or leak sensitive communications."
        }
    ],
    "attack_vector": "ADJACENT"
}

email_header_trust_inheritance_across_zone_boundary[_email_header_trust_inheritance_across_zone_boundary_def] if {
    not input.mta_strips_external_received_headers
    not input.zone_trust_classification_enforced_in_filtering
}

email_header_trust_inheritance_across_zone_boundary[_email_header_trust_inheritance_across_zone_boundary_def] if {
    not input.mta_strips_external_received_headers
    input.inter_zone_mta_relay_authentication == "none"
}

exposures contains _email_header_trust_inheritance_across_zone_boundary_def if {
    count(email_header_trust_inheritance_across_zone_boundary) > 0
}

_dns_forwarder_chain_traversal_bypassing_segmentation_def := {
    "name": "Dns Forwarder Chain Traversal Bypassing Segmentation",
    "description": "Chained DNS forwarder configurations where forwarders in one zone relay to resolvers in another without per-hop boundary enforcement allow queries to traverse multiple trust zones unfiltered. An adversary can abuse this chain to resolve internal names from an external zone or to map inter-zone topology.",
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
            "relevance": "DNS forwarder chain traversal allows traffic to bypass network segmentation controls by hopping through forwarder chains across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Exploiting DNS forwarder chains involves compromising or misconfiguring DNS server infrastructure to traverse segmentation."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_forwarder_chain_traversal_bypassing_segmentation[_dns_forwarder_chain_traversal_bypassing_segmentation_def] if {
    input.cross_zone_forwarder_configured == true
    not input.per_hop_acl_enforced
}

dns_forwarder_chain_traversal_bypassing_segmentation[_dns_forwarder_chain_traversal_bypassing_segmentation_def] if {
    input.cross_zone_forwarder_configured == true
    input.internal_zone_resolvable_from_external_forwarder == true
}

exposures contains _dns_forwarder_chain_traversal_bypassing_segmentation_def if {
    count(dns_forwarder_chain_traversal_bypassing_segmentation) > 0
}
