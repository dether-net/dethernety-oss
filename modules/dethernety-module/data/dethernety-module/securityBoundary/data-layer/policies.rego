package _dt_built_in.exposures.data_layer



_unrestricted_ingress_to_storage_endpoints_def := {
    "name": "Unrestricted Ingress To Storage Endpoints",
    "description": "Absence of strict ingress filtering rules on the boundary allows traffic from untrusted or semi-trusted zones to reach database and object storage service ports directly, bypassing intended access tiers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Unrestricted ingress to storage endpoints directly enables attackers to access and exfiltrate data from cloud storage without barriers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "name": "Exfiltration Over Web Service",
            "relevance": "Open ingress to storage endpoints can be exploited to exfiltrate data over web-based storage services."
        }
    ]
}

unrestricted_ingress_to_storage_endpoints[_unrestricted_ingress_to_storage_endpoints_def] if {
    input.storage_port_ingress_restriction == "none"
}

unrestricted_ingress_to_storage_endpoints[_unrestricted_ingress_to_storage_endpoints_def] if {
    input.storage_port_ingress_restriction == "partial"
    input.untrusted_zone_direct_access_allowed == true
}

unrestricted_ingress_to_storage_endpoints[_unrestricted_ingress_to_storage_endpoints_def] if {
    not input.ingress_default_deny_enforced
    input.untrusted_zone_direct_access_allowed == true
}

exposures contains _unrestricted_ingress_to_storage_endpoints_def if {
    count(unrestricted_ingress_to_storage_endpoints) > 0
}

_missing_egress_filtering_from_storage_zone_def := {
    "name": "Missing Egress Filtering From Storage Zone",
    "description": "Lack of egress controls on the storage zone boundary permits outbound connections initiated by storage services to arbitrary external or internal destinations, enabling data exfiltration channels or C2 beacon paths if a storage component is compromised.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.002",
            "name": "Exfiltration to Cloud Storage",
            "relevance": "Absence of egress filtering allows attackers to exfiltrate data directly to external cloud storage destinations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Without egress filtering, attackers can use alternative protocols to exfiltrate data from the storage zone undetected."
        }
    ]
}

missing_egress_filtering_from_storage_zone[_missing_egress_filtering_from_storage_zone_def] if {
    not input.egress_policy_enforced
}

missing_egress_filtering_from_storage_zone[_missing_egress_filtering_from_storage_zone_def] if {
    input.egress_policy_enforced == true
    input.default_egress_action == "allow"
}

missing_egress_filtering_from_storage_zone[_missing_egress_filtering_from_storage_zone_def] if {
    input.egress_policy_enforced == true
    input.default_egress_action == "deny"
    "0.0.0.0/0" in input.allowed_egress_destinations
}

exposures contains _missing_egress_filtering_from_storage_zone_def if {
    count(missing_egress_filtering_from_storage_zone) > 0
}

_overly_broad_cross_zone_trust_propagation_def := {
    "name": "Overly Broad Cross Zone Trust Propagation",
    "description": "Implicit trust granted at the boundary level propagates to all services within the storage zone without per-service validation, allowing a single boundary crossing to authorize access to both database and object storage without additional zone-internal enforcement.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "name": "Trusted Relationship",
            "relevance": "Overly broad cross-zone trust allows attackers to leverage trusted relationships to move laterally across zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "name": "Trust Modification",
            "relevance": "Broad trust propagation can be abused by modifying trust settings to escalate privileges across zone boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overly permissive cross-zone trust effectively bridges network boundaries, enabling attackers to bypass segmentation controls."
        }
    ]
}

overly_broad_cross_zone_trust_propagation[_overly_broad_cross_zone_trust_propagation_def] if {
    input.zone_boundary_authentication_mode in ["boundary_only", "none"]
    not input.intra_zone_service_authorization_enforced
}

overly_broad_cross_zone_trust_propagation[_overly_broad_cross_zone_trust_propagation_def] if {
    input.storage_services_sharing_single_trust_credential == true
    not input.lateral_movement_controls_present
}

overly_broad_cross_zone_trust_propagation[_overly_broad_cross_zone_trust_propagation_def] if {
    input.zone_boundary_authentication_mode in ["boundary_only", "none"]
    not input.lateral_movement_controls_present
}

exposures contains _overly_broad_cross_zone_trust_propagation_def if {
    count(overly_broad_cross_zone_trust_propagation) > 0
}

_shared_credential_plane_across_zone_boundary_def := {
    "name": "Shared Credential Plane Across Zone Boundary",
    "description": "Credentials or service accounts used to authenticate across the zone boundary are shared between the storage zone and adjacent zones, eliminating credential isolation and enabling lateral movement if credentials are harvested outside the boundary.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Shared credentials across zone boundaries allow attackers who compromise one set of credentials to access multiple zones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.001",
            "name": "Additional Cloud Credentials",
            "relevance": "Shared credential planes can be exploited to create or abuse additional cloud credentials spanning multiple zones."
        }
    ]
}

shared_credential_plane_across_zone_boundary[_shared_credential_plane_across_zone_boundary_def] if {
    not input.credential_scope_isolation
}

shared_credential_plane_across_zone_boundary[_shared_credential_plane_across_zone_boundary_def] if {
    count(input.shared_service_account_zones) > 0
}

shared_credential_plane_across_zone_boundary[_shared_credential_plane_across_zone_boundary_def] if {
    not input.credential_scope_isolation
    not input.cross_zone_credential_rotation_independent
}

exposures contains _shared_credential_plane_across_zone_boundary_def if {
    count(shared_credential_plane_across_zone_boundary) > 0
}

_insufficient_micro_segmentation_between_database_and_object_storage_def := {
    "name": "Insufficient Micro Segmentation Between Database And Object Storage",
    "description": "The boundary treats all storage components as a single flat segment, permitting unrestricted east-west traffic between the database service and object storage service within the zone, increasing lateral movement radius if one component is compromised.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Insufficient micro-segmentation allows attackers who compromise a database to directly access adjacent cloud object storage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1619",
            "name": "Cloud Storage Object Discovery",
            "relevance": "Lack of segmentation enables attackers to enumerate cloud storage objects from a compromised database tier."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Insufficient micro-segmentation effectively bridges the network boundary between database and object storage zones."
        }
    ]
}

insufficient_micro_segmentation_between_database_and_object_storage[_insufficient_micro_segmentation_between_database_and_object_storage_def] if {
    input.intra_zone_default_traffic_policy == "allow_all"
    not input.network_policy_enforced_between_db_and_object_storage
}

insufficient_micro_segmentation_between_database_and_object_storage[_insufficient_micro_segmentation_between_database_and_object_storage_def] if {
    input.shared_network_segment_with_database_and_object_storage == true
    not input.lateral_movement_controls_present
}

insufficient_micro_segmentation_between_database_and_object_storage[_insufficient_micro_segmentation_between_database_and_object_storage_def] if {
    input.intra_zone_default_traffic_policy == "partial_restriction"
    not input.network_policy_enforced_between_db_and_object_storage
    not input.lateral_movement_controls_present
}

exposures contains _insufficient_micro_segmentation_between_database_and_object_storage_def if {
    count(insufficient_micro_segmentation_between_database_and_object_storage) > 0
}

_boundary_monitoring_blind_spots_on_east_west_traffic_def := {
    "name": "Boundary Monitoring Blind Spots On East West Traffic",
    "description": "Traffic inspection and logging is only applied to north-south flows entering or leaving the boundary perimeter; lateral east-west traffic between storage zone components is not monitored, creating detection gaps for intra-zone movement.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Blind spots in east-west traffic monitoring allow attackers to block or evade detection indicators during lateral movement."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Monitoring gaps on east-west traffic enable attackers to sniff internal network communications without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Blind spots on east-west traffic allow boundary bridging activities to go undetected between internal zones."
        }
    ]
}

boundary_monitoring_blind_spots_on_east_west_traffic[_boundary_monitoring_blind_spots_on_east_west_traffic_def] if {
    not input.east_west_traffic_inspection_enabled
    not input.east_west_traffic_logging_enabled
}

boundary_monitoring_blind_spots_on_east_west_traffic[_boundary_monitoring_blind_spots_on_east_west_traffic_def] if {
    not input.east_west_traffic_logging_enabled
    input.intra_zone_default_traffic_policy == "none"
}

boundary_monitoring_blind_spots_on_east_west_traffic[_boundary_monitoring_blind_spots_on_east_west_traffic_def] if {
    not input.east_west_traffic_inspection_enabled
    input.intra_zone_default_traffic_policy == "none"
}

exposures contains _boundary_monitoring_blind_spots_on_east_west_traffic_def if {
    count(boundary_monitoring_blind_spots_on_east_west_traffic) > 0
}

_management_plane_not_isolated_from_data_plane_at_boundary_def := {
    "name": "Management Plane Not Isolated From Data Plane At Boundary",
    "description": "Administrative and management traffic (e.g., backup orchestration, replication control) traverses the same boundary path and network segment as application data traffic, allowing boundary bypass by targeting management protocols when data-plane filtering is enforced.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "When management and data planes share a boundary, attackers can tunnel management traffic through data plane channels to evade controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Lack of isolation between planes allows attackers to sniff management traffic that traverses the data plane boundary."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Failure to isolate management from data plane effectively creates a boundary bridge that can be exploited for privilege escalation."
        }
    ]
}

management_plane_not_isolated_from_data_plane_at_boundary[_management_plane_not_isolated_from_data_plane_at_boundary_def] if {
    not input.management_traffic_network_segment_separated
}

management_plane_not_isolated_from_data_plane_at_boundary[_management_plane_not_isolated_from_data_plane_at_boundary_def] if {
    not input.boundary_acl_differentiates_management_protocols
}

management_plane_not_isolated_from_data_plane_at_boundary[_management_plane_not_isolated_from_data_plane_at_boundary_def] if {
    input.management_protocol_source_restriction in ["shared_subnet", "none"]
}

exposures contains _management_plane_not_isolated_from_data_plane_at_boundary_def if {
    count(management_plane_not_isolated_from_data_plane_at_boundary) > 0
}

_object_storage_presigned_url_bypass_of_boundary_controls_def := {
    "name": "Object Storage Presigned Url Bypass Of Boundary Controls",
    "description": "Object storage services that issue time-limited presigned URLs or delegated access tokens allow external or cross-zone clients to access storage objects without traversing the enforced boundary ingress controls, creating a logical bypass of zone separation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Presigned URLs function as time-limited access tokens that can bypass boundary controls when intercepted or leaked."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Presigned URLs directly enable unauthorized access to cloud storage objects, bypassing normal boundary authentication controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Presigned URLs act as application access tokens that can be stolen to bypass storage boundary controls."
        }
    ]
}

object_storage_presigned_url_bypass_of_boundary_controls[_object_storage_presigned_url_bypass_of_boundary_controls_def] if {
    input.presigned_url_generation_enabled == true
    input.presigned_url_accessible_from_external_zone == true
}

object_storage_presigned_url_bypass_of_boundary_controls[_object_storage_presigned_url_bypass_of_boundary_controls_def] if {
    input.presigned_url_generation_enabled == true
    input.presigned_url_accessible_from_external_zone == true
    input.presigned_url_max_validity_seconds > 86400
}

exposures contains _object_storage_presigned_url_bypass_of_boundary_controls_def if {
    count(object_storage_presigned_url_bypass_of_boundary_controls) > 0
}

_boundary_rule_permitting_broad_source_cidr_ranges_def := {
    "name": "Boundary Rule Permitting Broad Source Cidr Ranges",
    "description": "Ingress and egress filter rules on the storage zone boundary are defined with overly broad source or destination CIDR ranges rather than specific service IP addresses or service tags, allowing any host within a large network block to initiate connections to storage endpoints.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1595.001",
            "name": "Scanning IP Blocks",
            "relevance": "Broad CIDR ranges in boundary rules expose the storage environment to IP block scanning from a wide range of sources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Permissive CIDR rules effectively weaken network boundary controls, enabling attackers from broad IP ranges to bridge into protected zones."
        }
    ]
}

boundary_rule_permitting_broad_source_cidr_ranges[_boundary_rule_permitting_broad_source_cidr_ranges_def] if {
    input.ingress_cidr_prefix_length <= 16
    not input.service_tag_or_specific_ip_used
}

boundary_rule_permitting_broad_source_cidr_ranges[_boundary_rule_permitting_broad_source_cidr_ranges_def] if {
    input.egress_cidr_prefix_length <= 16
    not input.service_tag_or_specific_ip_used
}

exposures contains _boundary_rule_permitting_broad_source_cidr_ranges_def if {
    count(boundary_rule_permitting_broad_source_cidr_ranges) > 0
}

_lack_of_mutual_authentication_at_zone_boundary_def := {
    "name": "Lack Of Mutual Authentication At Zone Boundary",
    "description": "The storage zone boundary enforces only one-directional authentication (inbound clients authenticate to the boundary), without requiring mutual TLS or equivalent two-way verification, enabling spoofed service-to-service connections that appear to originate from trusted internal zones.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Without mutual authentication, forged or stolen certificates cannot be detected at the zone boundary, enabling impersonation attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "name": "Trusted Relationship",
            "relevance": "Lack of mutual authentication allows attackers to abuse trusted relationships by impersonating legitimate zone endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Without mutual authentication, attackers can tunnel traffic through the zone boundary by masquerading as trusted services."
        }
    ]
}

lack_of_mutual_authentication_at_zone_boundary[_lack_of_mutual_authentication_at_zone_boundary_def] if {
    not input.mutual_tls_enforced
}

lack_of_mutual_authentication_at_zone_boundary[_lack_of_mutual_authentication_at_zone_boundary_def] if {
    input.client_certificate_validation_mode in ["optional", "none"]
}

lack_of_mutual_authentication_at_zone_boundary[_lack_of_mutual_authentication_at_zone_boundary_def] if {
    input.internal_zone_traffic_authentication_bypass == true
}

exposures contains _lack_of_mutual_authentication_at_zone_boundary_def if {
    count(lack_of_mutual_authentication_at_zone_boundary) > 0
}

_dns_resolution_not_constrained_within_storage_zone_def := {
    "name": "Dns Resolution Not Constrained Within Storage Zone",
    "description": "The storage zone boundary does not restrict DNS queries to an authoritative internal resolver, allowing storage components to perform external DNS resolution that can be exploited for DNS-based data exfiltration or command-and-control communication bypassing egress IP filters.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.004",
            "name": "DNS",
            "relevance": "Unconstrained DNS resolution enables attackers to use DNS as a covert command-and-control channel from within the storage zone."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.001",
            "name": "Fast Flux DNS",
            "relevance": "Without DNS constraints in the storage zone, attackers can leverage fast flux DNS to evade detection and maintain persistent access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Unconstrained DNS allows attackers to redirect storage zone queries to attacker-controlled DNS servers for data interception or exfiltration."
        }
    ]
}

dns_resolution_not_constrained_within_storage_zone[_dns_resolution_not_constrained_within_storage_zone_def] if {
    not input.dns_resolver_restricted_to_internal
    not input.egress_dns_port_restricted
}

dns_resolution_not_constrained_within_storage_zone[_dns_resolution_not_constrained_within_storage_zone_def] if {
    not input.dns_resolver_restricted_to_internal
}

dns_resolution_not_constrained_within_storage_zone[_dns_resolution_not_constrained_within_storage_zone_def] if {
    not input.egress_dns_port_restricted
}

exposures contains _dns_resolution_not_constrained_within_storage_zone_def if {
    count(dns_resolution_not_constrained_within_storage_zone) > 0
}
