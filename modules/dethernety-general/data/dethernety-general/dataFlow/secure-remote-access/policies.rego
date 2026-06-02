package _dt_built_in.exposures.secure_remote_access



_single_factor_remote_authentication_at_boundary_def := {
    "name": "Single-factor remote authentication at boundary",
    "description": "The VPN/bastion crossing accepts password-only or otherwise single-factor authentication, letting credential-stuffed or phished credentials terminate a tunnel directly into the trusted zone with no second factor at the trust edge.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Single-factor remote authentication at the boundary directly enables adversary use of Valid Accounts \u2014 stolen or guessed credentials yield a full remote-access session without a second factor to block reuse."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {
                "justification": "External Remote Services (VPN, bastion, ZTNA portal) accepting password-only authentication present the canonical external-remote-services exposure abused for initial access and persistence."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Password-only boundary authentication is the precondition for Brute Force / credential stuffing succeeding into the trusted zone; MFA is the standard defeater."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

single_factor_remote_authentication_at_boundary[_single_factor_remote_authentication_at_boundary_def] if {
    not input.mfa_enforced_at_boundary_crossing
}

exposures contains _single_factor_remote_authentication_at_boundary_def if {
    count(single_factor_remote_authentication_at_boundary) > 0
}

_phishable_mfa_factor_sms_totp_push_on_vpn_portal_def := {
    "name": "Phishable MFA factor (SMS/TOTP/push) on VPN portal",
    "description": "Second factor is SMS, voice, email OTP, or push-only, allowing adversary-in-the-middle proxies to relay credentials and OTP/push approval in real time and capture a working VPN session token (T1557).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Adversary-in-the-Middle: phishable second factors (SMS/TOTP/push) on the VPN portal allow an AiTM proxy to relay credentials and OTP/push approval, defeating non-domain-bound MFA."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

phishable_mfa_factor_sms_totp_push_on_vpn_portal[_phishable_mfa_factor_sms_totp_push_on_vpn_portal_def] if {
    not input.phishing_resistant_authenticator_required
}

exposures contains _phishable_mfa_factor_sms_totp_push_on_vpn_portal_def if {
    count(phishable_mfa_factor_sms_totp_push_on_vpn_portal) > 0
}

_weak_or_legacy_vpn_protocol_and_cipher_suite_def := {
    "name": "Weak or legacy VPN protocol and cipher suite",
    "description": "Tunnel negotiates PPTP, bare L2TP, IKEv1 aggressive-mode PSK, or legacy ciphers (3DES/SHA-1/RC4), permitting offline cracking, downgrade, and MITM of the encrypted crossing (T1040).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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
            "value": "T1562.010",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_legacy_vpn_protocol_and_cipher_suite[_weak_or_legacy_vpn_protocol_and_cipher_suite_def] if {
    not input.vpn_protocol_modern_strong
}

weak_or_legacy_vpn_protocol_and_cipher_suite[_weak_or_legacy_vpn_protocol_and_cipher_suite_def] if {
    not input.vpn_cipher_suites_strong_only
}

exposures contains _weak_or_legacy_vpn_protocol_and_cipher_suite_def if {
    count(weak_or_legacy_vpn_protocol_and_cipher_suite) > 0
}

_split_tunnel_dns_traffic_leak_bridging_trust_zones_def := {
    "name": "Split-tunnel DNS / traffic leak bridging trust zones",
    "description": "Client retains a parallel cleartext path to the internet while connected, so a compromised endpoint can be used to pivot untrusted traffic into the trusted zone or exfiltrate around the tunnel (T1572).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "attributes": {
                "justification": "Protocol Tunneling \u2014 a split-tunnel/DNS-leak path on the VPN-connected host gives an adversary a parallel, uncontrolled channel they can tunnel C2 or pivot traffic through, bridging the untrusted internet egress into the trusted zone the VPN is meant to gate."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

split_tunnel_dns_traffic_leak_bridging_trust_zones[_split_tunnel_dns_traffic_leak_bridging_trust_zones_def] if {
    not input.split_tunnel_disabled
}

exposures contains _split_tunnel_dns_traffic_leak_bridging_trust_zones_def if {
    count(split_tunnel_dns_traffic_leak_bridging_trust_zones) > 0
}

_no_device_posture_endpoint_health_attestation_def := {
    "name": "No device posture / endpoint health attestation",
    "description": "Admission to the tunnel/bastion is granted on user credential alone with no managed-device, EDR, patch, or disk-encryption signal, so a malware-infected or unmanaged endpoint becomes a trusted-zone foothold (T1133).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_device_posture_endpoint_health_attestation[_no_device_posture_endpoint_health_attestation_def] if {
    not input.admin_endpoint_health_attested_at_elevation
}

no_device_posture_endpoint_health_attestation[_no_device_posture_endpoint_health_attestation_def] if {
    not input.managed_device_enrollment_enforced
}

exposures contains _no_device_posture_endpoint_health_attestation_def if {
    count(no_device_posture_endpoint_health_attestation) > 0
}

_bastion_bypass_via_direct_admin_path_to_backend_def := {
    "name": "Bastion bypass via direct admin path to backend",
    "description": "Production hosts accept SSH/RDP from sources other than the bastion, so an administrator (or attacker with admin creds) can reach the trusted zone directly \u2014 defeating mediation, session recording, and JIT (T1133).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

bastion_bypass_via_direct_admin_path_to_backend[_bastion_bypass_via_direct_admin_path_to_backend_def] if {
    not input.bastion_mediates_all_admin_access
}

exposures contains _bastion_bypass_via_direct_admin_path_to_backend_def if {
    count(bastion_bypass_via_direct_admin_path_to_backend) > 0
}

_standing_admin_privilege_with_no_jit_and_no_session_recording_def := {
    "name": "Standing admin privilege with no JIT and no session recording",
    "description": "Permanent admin entitlements on production combined with absent bastion/PAM session recording let an attacker who phishes an admin escalate immediately and leave no forensic record of the crossing (T1078).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Standing admin entitlements without JIT or session recording let an adversary leverage Valid Accounts (T1078) \u2014 particularly compromised privileged user accounts \u2014 to operate with persistent, unaudited admin authority across the trusted zone."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

standing_admin_privilege_with_no_jit_and_no_session_recording[_standing_admin_privilege_with_no_jit_and_no_session_recording_def] if {
    not input.no_standing_admin_privileges_jit_required
}

standing_admin_privilege_with_no_jit_and_no_session_recording[_standing_admin_privilege_with_no_jit_and_no_session_recording_def] if {
    not input.privileged_access_via_pam_with_session_recording
}

exposures contains _standing_admin_privilege_with_no_jit_and_no_session_recording_def if {
    count(standing_admin_privilege_with_no_jit_and_no_session_recording) > 0
}

_unpatched_management_exposed_vpn_edge_appliance_def := {
    "name": "Unpatched / management-exposed VPN edge appliance",
    "description": "SSL-VPN or IPsec edge runs a version affected by known KEV-listed CVEs, or exposes its admin/management interface to the internet, yielding pre-auth RCE or session-token theft against the boundary itself (T1190).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Unpatched VPN edge appliances with KEV-listed CVEs (FortiOS, PAN-OS, Ivanti Connect Secure) and internet-exposed management interfaces are the canonical target of Exploit Public-Facing Application \u2014 pre-auth RCE or session-token theft against the edge."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_management_exposed_vpn_edge_appliance[_unpatched_management_exposed_vpn_edge_appliance_def] if {
    not input.edge_appliance_patched_within_sla
}

unpatched_management_exposed_vpn_edge_appliance[_unpatched_management_exposed_vpn_edge_appliance_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposures contains _unpatched_management_exposed_vpn_edge_appliance_def if {
    count(unpatched_management_exposed_vpn_edge_appliance) > 0
}
