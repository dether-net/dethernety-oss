package _dt_built_in.exposures.network_perimeter



_exploit_public_facing_app_def := {
    "name": "Exploit of public-facing application",
    "description": "Unauthenticated vuln (SQLi/deserialization/RCE) in internet-exposed app.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.8,
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

exploit_public_facing_app[_exploit_public_facing_app_def] if {
    not input.ingress_default_deny_enforced
}

exploit_public_facing_app[_exploit_public_facing_app_def] if {
    not input.waf_active_blocking_on_public_web
}

exposures contains _exploit_public_facing_app_def if {
    count(exploit_public_facing_app) > 0
}

_external_remote_service_no_mfa_def := {
    "name": "External remote service compromise without MFA",
    "description": "Internet-facing VPN/RDP/Citrix accepts valid creds w/o MFA; flat internal LAN.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.1,
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
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

external_remote_service_no_mfa[_external_remote_service_no_mfa_def] if {
    not input.remote_access_via_ztna_or_mfa_vpn
}

exposures contains _external_remote_service_no_mfa_def if {
    count(external_remote_service_no_mfa) > 0
}

_edge_appliance_kev_chain_def := {
    "name": "Unpatched edge-appliance KEV chain",
    "description": "Mass-exploited n-day in perimeter device chains auth-bypass + RCE.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
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
            "value": "T1133",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

edge_appliance_kev_chain[_edge_appliance_kev_chain_def] if {
    not input.edge_appliance_patched_within_sla
}

edge_appliance_kev_chain[_edge_appliance_kev_chain_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposures contains _edge_appliance_kev_chain_def if {
    count(edge_appliance_kev_chain) > 0
}

_network_dos_def := {
    "name": "Network denial of service",
    "description": "Volumetric L3/L4 or L7 flood saturates internet link or origin.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

network_dos[_network_dos_def] if {
    not input.ddos_protection_in_place
}

exposures contains _network_dos_def if {
    count(network_dos) > 0
}

_app_layer_egress_c2_def := {
    "name": "Application-layer egress C2",
    "description": "Foothold beacons over HTTPS/DNS/SMTP to attacker C2.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

app_layer_egress_c2[_app_layer_egress_c2_def] if {
    not input.egress_default_deny_enforced
}

exposures contains _app_layer_egress_c2_def if {
    count(app_layer_egress_c2) > 0
}

_dns_hijack_takeover_def := {
    "name": "DNS hijack or subdomain takeover",
    "description": "Registrar/zone hijack or claim of deprovisioned cloud resource via dangling CNAME.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

dns_hijack_takeover[_dns_hijack_takeover_def] if {
    not input.dns_hardened
}

exposures contains _dns_hijack_takeover_def if {
    count(dns_hijack_takeover) > 0
}

_cloud_object_anon_exposure_def := {
    "name": "Cloud-object anonymous exposure",
    "description": "S3/Blob/GCS with anonymous read/write ACL.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cloud_object_anon_exposure[_cloud_object_anon_exposure_def] if {
    not input.cloud_objects_not_anonymously_public
}

exposures contains _cloud_object_anon_exposure_def if {
    count(cloud_object_anon_exposure) > 0
}

_perimeter_crossings_unmonitored_def := {
    "name": "Unmonitored perimeter crossings",
    "description": "Ingress/egress logs only on edge device; can be erased by attacker.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
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

perimeter_crossings_unmonitored[_perimeter_crossings_unmonitored_def] if {
    not input.perimeter_crossings_logged_and_centralized
}

exposures contains _perimeter_crossings_unmonitored_def if {
    count(perimeter_crossings_unmonitored) > 0
}
