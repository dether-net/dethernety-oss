package _dt_built_in.exposures.vpn_gateway



_unpatched_kev_appliance_exploit_auth_bypass_rce_chain_def := {
    "name": "Unpatched KEV appliance exploit (auth-bypass / RCE chain)",
    "description": "Internet-facing VPN gateways are mass-exploited via pre-auth memory-safety and injection flaws that yield unauthenticated RCE or file access \u2014 e.g. the Ivanti Connect Secure auth-bypass-plus-command-injection chain. An affected, unpatched, or end-of-support firmware image is the single highest risk, ceding the gateway to attackers who steal config, plant webshells, and reverse-tunnel into the trusted zone.",
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
                "justification": "Pre-auth memory-safety/injection flaws in the internet-facing VPN gateway yield unauthenticated RCE/file access \u2014 exploitation of a public-facing application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "An auth-bypass + command-injection chain against the remote-access service exploits the gateway to gain code execution and pivot into the trusted zone."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_kev_appliance_exploit_auth_bypass_rce_chain[_unpatched_kev_appliance_exploit_auth_bypass_rce_chain_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_kev_appliance_exploit_auth_bypass_rce_chain[_unpatched_kev_appliance_exploit_auth_bypass_rce_chain_def] if {
    input.firmware_end_of_support == true
}

unpatched_kev_appliance_exploit_auth_bypass_rce_chain[_unpatched_kev_appliance_exploit_auth_bypass_rce_chain_def] if {
    input.days_since_last_firmware_update > 90
}

exposures contains _unpatched_kev_appliance_exploit_auth_bypass_rce_chain_def if {
    count(unpatched_kev_appliance_exploit_auth_bypass_rce_chain) > 0
}

_session_token_theft_bypassing_mfa_def := {
    "name": "Session token theft bypassing MFA",
    "description": "A memory-disclosure flaw on the gateway (Citrix Bleed) leaks session authentication tokens, letting an attacker hijack an established authenticated session and bypass MFA entirely. Long-lived or never-expiring sessions and absent session monitoring widen the abuse window even after patching.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "Leaked session authentication token is replayed as a web session cookie to ride the authenticated session and bypass MFA (Citrix Bleed CVE-2023-4966)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {
                "justification": "The memory-disclosure flaw steals web session tokens directly from gateway memory rather than from the client."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550",
            "attributes": {
                "justification": "Stolen session material is used as alternate authentication material, sidestepping the password+MFA login flow entirely."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

session_token_theft_bypassing_mfa[_session_token_theft_bypassing_mfa_def] if {
    input.session_idle_timeout_minutes > 15
}

session_token_theft_bypassing_mfa[_session_token_theft_bypassing_mfa_def] if {
    input.max_session_lifetime_hours > 24
}

session_token_theft_bypassing_mfa[_session_token_theft_bypassing_mfa_def] if {
    not input.session_monitoring_enabled
}

session_token_theft_bypassing_mfa[_session_token_theft_bypassing_mfa_def] if {
    input.unpatched_known_rce_cve == true
}

session_token_theft_bypassing_mfa[_session_token_theft_bypassing_mfa_def] if {
    not input.concurrent_session_limit_enforced
}

exposures contains _session_token_theft_bypassing_mfa_def if {
    count(session_token_theft_bypassing_mfa) > 0
}

_valid_account_abuse_missing_mfa_def := {
    "name": "Valid-account abuse / missing MFA",
    "description": "Stolen, sprayed, or stuffed credentials used against the public VPN login grant External Remote Services access into the network when MFA is single-factor, optional, or bypassable, and when no lockout or failed-auth alerting blunts the spraying. Stolen credentials alone remain a leading VPN intrusion vector.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

valid_account_abuse_missing_mfa[_valid_account_abuse_missing_mfa_def] if {
    not input.mfa_enforced_for_vpn_login
}

valid_account_abuse_missing_mfa[_valid_account_abuse_missing_mfa_def] if {
    not input.rate_limiting_or_lockout_enabled
    not input.failed_auth_alerting_enabled
}

valid_account_abuse_missing_mfa[_valid_account_abuse_missing_mfa_def] if {
    input.vpn_auth_source == "local_appliance_accounts"
}

exposures contains _valid_account_abuse_missing_mfa_def if {
    count(valid_account_abuse_missing_mfa) > 0
}

_weak_cryptography_downgrade_def := {
    "name": "Weak cryptography / downgrade",
    "description": "IKEv1 aggressive mode exposing the PSK hash to offline cracking, weak ciphers (DES/3DES/MD5/SHA1), missing PFS, low Diffie-Hellman groups (1/2/5), or SSLv3/TLS1.0/1.1 on the SSL-VPN portal enable offline key recovery and on-path interception of the supposedly encrypted tunnel.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_cryptography_downgrade[_weak_cryptography_downgrade_def] if {
    not input.vpn_ikev1_aggressive_mode_disabled
}

weak_cryptography_downgrade[_weak_cryptography_downgrade_def] if {
    not input.vpn_cipher_suites_strong_only
}

weak_cryptography_downgrade[_weak_cryptography_downgrade_def] if {
    not input.perfect_forward_secrecy_enabled
}

weak_cryptography_downgrade[_weak_cryptography_downgrade_def] if {
    not input.strong_dh_group_enforced
}

weak_cryptography_downgrade[_weak_cryptography_downgrade_def] if {
    input.min_tls_version == "tls1_0_or_tls1_1_or_sslv3_accepted"
}

exposures contains _weak_cryptography_downgrade_def if {
    count(weak_cryptography_downgrade) > 0
}

_flat_internal_access_after_admission_def := {
    "name": "Flat internal access after admission",
    "description": "When any admitted VPN session reaches the whole internal network (permit-any from the VPN pool, no per-user least-privilege policy), a single compromised user or device pivots laterally across the trusted zone. The gateway is a boundary device, so over-broad post-admission reachability collapses the trust boundary it exists to enforce.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {
                "justification": "Flat internal reachability from the VPN pool lets a compromised admitted session use Remote Services to move laterally across the trusted zone."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "Broad post-admission reachability exposes the full internal service surface to Exploitation of Remote Services for lateral movement once a single device or credential is compromised."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.001",
            "attributes": {
                "justification": "An admitted VPN session with flat internal access can be used as an internal proxy to relay/pivot traffic deeper into the trusted network."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

flat_internal_access_after_admission[_flat_internal_access_after_admission_def] if {
    not input.least_privilege_access_enforced
}

flat_internal_access_after_admission[_flat_internal_access_after_admission_def] if {
    input.permit_any_from_vpn_pool == true
}

exposures contains _flat_internal_access_after_admission_def if {
    count(flat_internal_access_after_admission) > 0
}

_internet_exposed_management_interface_default_credentials_def := {
    "name": "Internet-exposed management interface / default credentials",
    "description": "An admin GUI or SSH reachable from the WAN is the entry point most appliance exploits target and enables default-credential and brute-force attacks against the public-facing login. Unrotated factory credentials or vendor maintenance accounts compound the exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An internet-reachable admin GUI/SSH is the public-facing application surface that appliance RCE/auth-bypass exploits target (Ivanti, Citrix, Fortinet, PAN-OS)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {
                "justification": "Internet-exposed admin/VPN login with unrotated default credentials or no lockout enables external-remote-services access via default-credential and brute-force/credential-stuffing attacks."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_management_interface_default_credentials[_internet_exposed_management_interface_default_credentials_def] if {
    input.management_ui_internet_exposed == true
}

internet_exposed_management_interface_default_credentials[_internet_exposed_management_interface_default_credentials_def] if {
    not input.default_accounts_removed_or_changed
}

internet_exposed_management_interface_default_credentials[_internet_exposed_management_interface_default_credentials_def] if {
    not input.admin_access_ip_restricted
}

internet_exposed_management_interface_default_credentials[_internet_exposed_management_interface_default_credentials_def] if {
    not input.rate_limiting_or_lockout_enabled
}

exposures contains _internet_exposed_management_interface_default_credentials_def if {
    count(internet_exposed_management_interface_default_credentials) > 0
}

_no_connection_auth_logging_to_siem_def := {
    "name": "No connection / auth logging to SIEM",
    "description": "When VPN connect/disconnect and authentication events (success and failure) are not logged and forwarded to a central SIEM with failed-auth alerting, credential abuse, anomalous session sources, and the post-exploit reverse-tunneling seen in appliance compromises go undetected \u2014 and a compromised gateway can impair its own local logging to evade detection.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

no_connection_auth_logging_to_siem[_no_connection_auth_logging_to_siem_def] if {
    not input.auth_events_logged
}

no_connection_auth_logging_to_siem[_no_connection_auth_logging_to_siem_def] if {
    not input.external_siem_forwarding_enabled
}

no_connection_auth_logging_to_siem[_no_connection_auth_logging_to_siem_def] if {
    not input.failed_auth_alerting_enabled
}

exposures contains _no_connection_auth_logging_to_siem_def if {
    count(no_connection_auth_logging_to_siem) > 0
}

_no_client_posture_device_compliance_gating_def := {
    "name": "No client posture / device-compliance gating",
    "description": "Without endpoint health/posture evaluation (AV, OS patch level, disk encryption, managed certificate) before admission, any device with valid credentials \u2014 including unmanaged or compromised personal hosts \u2014 is admitted into the trusted zone, extending the attack surface inside the boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
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

no_client_posture_device_compliance_gating[_no_client_posture_device_compliance_gating_def] if {
    not input.client_posture_check_enabled
}

no_client_posture_device_compliance_gating[_no_client_posture_device_compliance_gating_def] if {
    not input.vpn_ztna_posture_gating_enabled
}

no_client_posture_device_compliance_gating[_no_client_posture_device_compliance_gating_def] if {
    not input.managed_certificate_required_for_admission
}

exposures contains _no_client_posture_device_compliance_gating_def if {
    count(no_client_posture_device_compliance_gating) > 0
}
