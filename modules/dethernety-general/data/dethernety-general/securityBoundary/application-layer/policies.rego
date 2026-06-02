package _dt_built_in.exposures.application_layer



_bypass_dmz_data_def := {
    "name": "Boundary bypass via direct DMZ-to-data path",
    "description": "A misconfigured firewall/security-group, shared subnet, or forgotten failover path lets DMZ/presentation hosts reach the data tier directly, skipping the application boundary's authn/authz and audit entirely.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

bypass_dmz_data[_bypass_dmz_data_def] if {
    not input.boundary_non_bypassable
}

bypass_dmz_data[_bypass_dmz_data_def] if {
    input.dmz_to_data_tier_path_exists == true
}

exposures contains _bypass_dmz_data_def if {
    count(bypass_dmz_data) > 0
}

_exploit_public_facing_to_app_tier_def := {
    "name": "Exploit public-facing application into app tier",
    "description": "A vulnerability in the internet-facing edge is exploited to land attacker traffic on app-tier processes that implicitly trust calls from the presentation tier instead of re-authenticating at the internal interface.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Exploit Public-Facing Application \u2014 the canonical edge-to-app-tier entry technique this boundary failure enables."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

exploit_public_facing_to_app_tier[_exploit_public_facing_to_app_tier_def] if {
    not input.internal_interface_reauthenticates_calls
}

exploit_public_facing_to_app_tier[_exploit_public_facing_to_app_tier_def] if {
    not input.server_side_allowlist_validation
}

exposures contains _exploit_public_facing_to_app_tier_def if {
    count(exploit_public_facing_to_app_tier) > 0
}

_trusted_relationship_at_internal_interface_def := {
    "name": "Trusted-relationship abuse at the internal interface",
    "description": "The boundary accepts unsigned identity headers, IP-based allow-lists, or shared service credentials from the presentation tier, so an attacker reaching the internal interface forges the principal and acts as any user.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
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

trusted_relationship_at_internal_interface[_trusted_relationship_at_internal_interface_def] if {
    not input.identity_propagated_cryptographically
}

trusted_relationship_at_internal_interface[_trusted_relationship_at_internal_interface_def] if {
    input.shared_service_credentials_used == true
}

exposures contains _trusted_relationship_at_internal_interface_def if {
    count(trusted_relationship_at_internal_interface) > 0
}

_east_west_lateral_on_flat_trust_def := {
    "name": "East-west lateral movement on flat app-tier trust",
    "description": "After landing on one app service, the attacker pivots to peers because the tier is a flat trust zone with no mTLS, no per-peer authorization, and overly permissive NetworkPolicy.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Remote Services \u2014 adversaries pivot between peers in a flat trust zone via legitimate remote-access services."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 when peer authn is network-position-only, a stolen workload credential is indistinguishable from a legitimate caller."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

east_west_lateral_on_flat_trust[_east_west_lateral_on_flat_trust_def] if {
    not input.east_west_microsegmentation_enforced
}

east_west_lateral_on_flat_trust[_east_west_lateral_on_flat_trust_def] if {
    not input.service_to_service_mtls_enforced
}

exposures contains _east_west_lateral_on_flat_trust_def if {
    count(east_west_lateral_on_flat_trust) > 0
}

_valid_account_abuse_at_crossing_def := {
    "name": "Valid-account abuse crossing the boundary",
    "description": "Stolen credentials, leaked service tokens, or default accounts grant a real authenticated session indistinguishable from a legitimate one; coarse authz roles let the session reach sensitive data.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

valid_account_abuse_at_crossing[_valid_account_abuse_at_crossing_def] if {
    not input.mfa_enforced_at_boundary_crossing
}

valid_account_abuse_at_crossing[_valid_account_abuse_at_crossing_def] if {
    not input.least_privilege_authorization_at_crossing
}

exposures contains _valid_account_abuse_at_crossing_def if {
    count(valid_account_abuse_at_crossing) > 0
}

_unrestricted_egress_ssrf_c2_def := {
    "name": "Unrestricted egress enabling SSRF/exfil/C2",
    "description": "An SSRF or RCE in an app process is amplified because outbound traffic is unrestricted - the process reaches cloud-metadata to steal instance credentials, exfiltrates to arbitrary internet endpoints, or beacons to C2.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Unsecured Credentials: Cloud Instance Metadata \u2014 the canonical SSRF-to-cloud-credentials pivot enabled when egress to IMDS is unrestricted."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_egress_ssrf_c2[_unrestricted_egress_ssrf_c2_def] if {
    not input.app_tier_egress_destination_allowlisted
}

unrestricted_egress_ssrf_c2[_unrestricted_egress_ssrf_c2_def] if {
    not input.cloud_metadata_endpoint_blocked
}

exposures contains _unrestricted_egress_ssrf_c2_def if {
    count(unrestricted_egress_ssrf_c2) > 0
}

_cleartext_on_backend_post_termination_def := {
    "name": "Cleartext on the back end after TLS termination",
    "description": "The edge proxy terminates TLS and forwards plaintext to app or data services, assuming the internal network is trusted; any attacker with an internal foothold reads credentials and sensitive payloads off the wire.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_on_backend_post_termination[_cleartext_on_backend_post_termination_def] if {
    not input.back_end_traffic_reencrypted_after_tls_termination
}

exposures contains _cleartext_on_backend_post_termination_def if {
    count(cleartext_on_backend_post_termination) > 0
}

_management_plane_bridging_def := {
    "name": "Management-plane compromise bridging the boundary",
    "description": "A management interface of the boundary itself is reachable from user-traffic networks or guarded by weak credentials; compromise lets the attacker rewrite policy and bridge zones.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

management_plane_bridging[_management_plane_bridging_def] if {
    not input.management_plane_isolated_from_data_plane
}

management_plane_bridging[_management_plane_bridging_def] if {
    not input.boundary_admin_actions_require_mfa_and_audited
}

exposures contains _management_plane_bridging_def if {
    count(management_plane_bridging) > 0
}
