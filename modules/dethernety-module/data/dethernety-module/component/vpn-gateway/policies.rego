package _dt_built_in.exposures.vpn_gateway



_weak_authentication_mechanism_def := {
    "name": "Weak Authentication Mechanism",
    "description": "Accepting single-factor authentication (password-only) for remote access without requiring MFA or certificate-based authentication, allowing compromised credentials to grant direct network access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Weak authentication mechanisms are directly susceptible to password guessing attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550",
            "name": "Use Alternate Authentication Material",
            "relevance": "Weak authentication may allow attackers to bypass proper credential checks using alternate material."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "name": "Multi-Factor Authentication",
            "relevance": "Weak authentication often involves missing or bypassable MFA, which attackers can exploit or modify."
        }
    ]
}

weak_authentication_mechanism[_weak_authentication_mechanism_def] if {
    input.authentication_method == "password_only"
}

weak_authentication_mechanism[_weak_authentication_mechanism_def] if {
    not input.mfa_enforced
    not input.certificate_based_auth_enabled
}

exposures contains _weak_authentication_mechanism_def if {
    count(weak_authentication_mechanism) > 0
}

_deprecated_cipher_suite_enabled_def := {
    "name": "Deprecated Cipher Suite Enabled",
    "description": "VPN service configured to accept deprecated or weak encryption algorithms (e.g., DES, 3DES, RC4, MD5 HMAC) or TLS 1.0/1.1, enabling downgrade attacks or offline decryption of captured sessions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Deprecated cipher suites often use reduced key spaces, making encryption easier to break."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Enabling deprecated cipher suites directly weakens encryption protecting communications."
        }
    ]
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    "DES" in input.enabled_cipher_suites
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    "3DES" in input.enabled_cipher_suites
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    "RC4" in input.enabled_cipher_suites
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    "NULL" in input.enabled_cipher_suites
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    "EXPORT" in input.enabled_cipher_suites
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    input.minimum_tls_version in ["SSLv3", "TLS1.0"]
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    input.minimum_tls_version == "TLS1.1"
}

deprecated_cipher_suite_enabled[_deprecated_cipher_suite_enabled_def] if {
    input.weak_hmac_algorithms_enabled == true
}

exposures contains _deprecated_cipher_suite_enabled_def if {
    count(deprecated_cipher_suite_enabled) > 0
}

_unrestricted_split_tunneling_def := {
    "name": "Unrestricted Split Tunneling",
    "description": "Split tunneling enabled without policy enforcement, allowing remote clients to simultaneously access internal resources and untrusted external networks, creating a bridging vector into the corporate network.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Unrestricted split tunneling allows traffic to bypass network security boundaries, enabling boundary bridging."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Split tunneling can be exploited to tunnel traffic outside of monitored VPN channels."
        }
    ]
}

unrestricted_split_tunneling[_unrestricted_split_tunneling_def] if {
    input.split_tunneling_enabled == true
    not input.split_tunnel_policy_enforced
}

unrestricted_split_tunneling[_unrestricted_split_tunneling_def] if {
    input.split_tunneling_enabled == true
    not input.endpoint_security_posture_check
}

exposures contains _unrestricted_split_tunneling_def if {
    count(unrestricted_split_tunneling) > 0
}

_overly_broad_network_access_policy_def := {
    "name": "Overly Broad Network Access Policy",
    "description": "VPN access profile grants authenticated users unrestricted access to all internal subnets rather than applying least-privilege segmentation or role-based network ACLs, amplifying lateral movement impact post-compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overly broad network access policies allow attackers to cross network boundaries they should not be able to reach."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.009",
            "name": "Conditional Access Policies",
            "relevance": "Weak or broad access policies fail to enforce conditional access restrictions, enabling unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Broad network access exposes more remote services to potential exploitation."
        }
    ]
}

overly_broad_network_access_policy[_overly_broad_network_access_policy_def] if {
    input.network_access_scope == "unrestricted"
}

overly_broad_network_access_policy[_overly_broad_network_access_policy_def] if {
    not input.role_based_acl_enforced
    "0.0.0.0/0" in input.permitted_destination_subnets
}

overly_broad_network_access_policy[_overly_broad_network_access_policy_def] if {
    not input.role_based_acl_enforced
    "10.0.0.0/8" in input.permitted_destination_subnets
}

overly_broad_network_access_policy[_overly_broad_network_access_policy_def] if {
    not input.role_based_acl_enforced
    "172.16.0.0/12" in input.permitted_destination_subnets
}

overly_broad_network_access_policy[_overly_broad_network_access_policy_def] if {
    not input.role_based_acl_enforced
    "192.168.0.0/16" in input.permitted_destination_subnets
}

exposures contains _overly_broad_network_access_policy_def if {
    count(overly_broad_network_access_policy) > 0
}

_self_signed_or_expired_server_certificate_def := {
    "name": "Self Signed Or Expired Server Certificate",
    "description": "Remote access service using self-signed, expired, or improperly validated server certificates, making clients susceptible to machine-in-the-middle attacks or preventing certificate-based authentication verification.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Attackers can forge or use self-signed certificates similar to those accepted by misconfigured servers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.003",
            "name": "Digital Certificates",
            "relevance": "Self-signed or expired certificates can be reconnaissance targets to identify certificate mismanagement."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Environments accepting self-signed certificates are susceptible to certificate forgery attacks."
        }
    ]
}

self_signed_or_expired_server_certificate[_self_signed_or_expired_server_certificate_def] if {
    input.certificate_type == "self_signed"
}

self_signed_or_expired_server_certificate[_self_signed_or_expired_server_certificate_def] if {
    input.certificate_type == "none"
}

self_signed_or_expired_server_certificate[_self_signed_or_expired_server_certificate_def] if {
    input.certificate_expired == true
}

self_signed_or_expired_server_certificate[_self_signed_or_expired_server_certificate_def] if {
    not input.client_certificate_validation_enforced
}

exposures contains _self_signed_or_expired_server_certificate_def if {
    count(self_signed_or_expired_server_certificate) > 0
}

_unpatched_vpn_service_def := {
    "name": "Unpatched Vpn Service",
    "description": "Remote access daemon or firmware running a version with known CVEs, including pre-authentication remote code execution or authentication bypass vulnerabilities that are actively exploited in the wild.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Unpatched VPN services expose known vulnerabilities in public-facing applications to exploitation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched VPN services can be exploited through known vulnerabilities in remote service components."
        }
    ]
}

unpatched_vpn_service[_unpatched_vpn_service_def] if {
    input.version_has_known_cve == true
    input.patch_lag_days > 7
}

unpatched_vpn_service[_unpatched_vpn_service_def] if {
    input.version_has_known_cve == true
    input.cve_allows_preauthentication_exploit == true
}

exposures contains _unpatched_vpn_service_def if {
    count(unpatched_vpn_service) > 0
}

_excessive_session_lifetime_and_no_idle_timeout_def := {
    "name": "Excessive Session Lifetime And No Idle Timeout",
    "description": "VPN sessions configured with no idle timeout or excessively long session validity windows, leaving authenticated tunnels open and exploitable if a client endpoint is compromised or left unattended.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Long-lived sessions on external remote services increase the window of opportunity for session hijacking."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Excessive session lifetimes increase exposure of session tokens that can be captured via network sniffing."
        }
    ]
}

excessive_session_lifetime_and_no_idle_timeout[_excessive_session_lifetime_and_no_idle_timeout_def] if {
    input.idle_timeout_minutes == 0
}

excessive_session_lifetime_and_no_idle_timeout[_excessive_session_lifetime_and_no_idle_timeout_def] if {
    input.idle_timeout_minutes > 60
}

excessive_session_lifetime_and_no_idle_timeout[_excessive_session_lifetime_and_no_idle_timeout_def] if {
    input.max_session_duration_hours == 0
}

excessive_session_lifetime_and_no_idle_timeout[_excessive_session_lifetime_and_no_idle_timeout_def] if {
    input.max_session_duration_hours > 24
    not input.session_reauthentication_enforced
}

exposures contains _excessive_session_lifetime_and_no_idle_timeout_def if {
    count(excessive_session_lifetime_and_no_idle_timeout) > 0
}

_vpn_management_interface_exposed_externally_def := {
    "name": "Vpn Management Interface Exposed Externally",
    "description": "Administrative or management interface (SSH, web UI, SNMP) accessible from untrusted networks rather than restricted to a dedicated management VLAN or bastion host, exposing privileged configuration endpoints.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Externally exposed management interfaces are directly vulnerable to exploitation as public-facing applications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Exposed management interfaces can be exploited as remote services by external attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Externally exposed management interfaces represent an accessible remote service attack surface."
        }
    ]
}

vpn_management_interface_exposed_externally[_vpn_management_interface_exposed_externally_def] if {
    input.management_interface_network_exposure in ["any", "internet_facing"]
}

vpn_management_interface_exposed_externally[_vpn_management_interface_exposed_externally_def] if {
    not input.management_acl_configured
    count(input.management_protocols_enabled) > 0
}

vpn_management_interface_exposed_externally[_vpn_management_interface_exposed_externally_def] if {
    input.insecure_protocol_exposed == true
    not input.management_interface_network_exposure in ["restricted"]
}

exposures contains _vpn_management_interface_exposed_externally_def if {
    count(vpn_management_interface_exposed_externally) > 0
}

_default_or_shared_pre_shared_key_def := {
    "name": "Default Or Shared Pre Shared Key",
    "description": "IPsec or other tunnel configuration using default, vendor-supplied, or shared pre-shared keys rather than unique strong secrets or certificate-based authentication, enabling unauthorized tunnel establishment.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Default or shared pre-shared keys are equivalent to compromised private keys that attackers can exploit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.001",
            "name": "Symmetric Cryptography",
            "relevance": "Pre-shared keys underpin symmetric cryptography; default or shared keys compromise the encryption."
        }
    ]
}

default_or_shared_pre_shared_key[_default_or_shared_pre_shared_key_def] if {
    input.psk_authentication_used == true
    input.psk_uniqueness in ["default_vendor_key", "shared_across_peers"]
}

default_or_shared_pre_shared_key[_default_or_shared_pre_shared_key_def] if {
    input.psk_authentication_used == true
    input.psk_minimum_length < 20
}

default_or_shared_pre_shared_key[_default_or_shared_pre_shared_key_def] if {
    input.psk_authentication_used == true
    input.psk_uniqueness == "unknown"
}

exposures contains _default_or_shared_pre_shared_key_def if {
    count(default_or_shared_pre_shared_key) > 0
}

_insufficient_authentication_logging_def := {
    "name": "Insufficient Authentication Logging",
    "description": "Failed authentication attempts, successful logins, session initiations, and disconnects not logged with sufficient detail (timestamp, source IP, username, device), preventing detection of brute-force or credential-stuffing campaigns.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "name": "Brute Force",
            "relevance": "Insufficient logging prevents detection of brute force authentication attacks against the VPN."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Attackers may exploit insufficient logging to avoid detection while enumerating or attacking authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Without adequate logging, credential stuffing attacks against authentication endpoints go undetected."
        }
    ]
}

insufficient_authentication_logging[_insufficient_authentication_logging_def] if {
    not input.auth_event_logging_enabled
}

insufficient_authentication_logging[_insufficient_authentication_logging_def] if {
    input.auth_event_logging_enabled == true
    not "timestamp" in input.logged_auth_fields
}

insufficient_authentication_logging[_insufficient_authentication_logging_def] if {
    input.auth_event_logging_enabled == true
    not "source_ip" in input.logged_auth_fields
}

insufficient_authentication_logging[_insufficient_authentication_logging_def] if {
    input.auth_event_logging_enabled == true
    not "username" in input.logged_auth_fields
}

insufficient_authentication_logging[_insufficient_authentication_logging_def] if {
    input.auth_event_logging_enabled == true
    input.log_retention_days < 30
}

exposures contains _insufficient_authentication_logging_def if {
    count(insufficient_authentication_logging) > 0
}

_no_client_endpoint_posture_check_def := {
    "name": "No Client Endpoint Posture Check",
    "description": "Remote access gateway does not enforce device health or posture assessment (OS patch level, EDR presence, disk encryption state) before granting tunnel access, allowing unmanaged or compromised endpoints to connect.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Without endpoint posture checks, compromised or non-compliant devices can freely access external remote services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1219",
            "name": "Remote Access Tools",
            "relevance": "Lack of posture checks allows devices with unauthorized remote access tools to connect to the VPN."
        }
    ]
}

no_client_endpoint_posture_check[_no_client_endpoint_posture_check_def] if {
    not input.endpoint_posture_check_enabled
}

no_client_endpoint_posture_check[_no_client_endpoint_posture_check_def] if {
    input.endpoint_posture_check_enabled == true
    input.posture_enforcement_scope == "partial"
}

no_client_endpoint_posture_check[_no_client_endpoint_posture_check_def] if {
    input.endpoint_posture_check_enabled == true
    input.unmanaged_device_access_allowed == true
}

exposures contains _no_client_endpoint_posture_check_def if {
    count(no_client_endpoint_posture_check) > 0
}

_privileged_account_used_for_vpn_service_identity_def := {
    "name": "Privileged Account Used For Vpn Service Identity",
    "description": "VPN service process or service account configured with elevated OS privileges (root, LocalSystem, Domain Admin) beyond what is required to operate, expanding blast radius if the service process is exploited.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.002",
            "name": "Bypass User Account Control",
            "relevance": "Using privileged accounts for VPN service identity enables privilege escalation if the service is compromised."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1569.002",
            "name": "Service Execution",
            "relevance": "A VPN service running as a privileged account can be abused for privileged service execution by attackers."
        }
    ]
}

privileged_account_used_for_vpn_service_identity[_privileged_account_used_for_vpn_service_identity_def] if {
    input.vpn_service_account_privilege_level == "root_or_system"
}

privileged_account_used_for_vpn_service_identity[_privileged_account_used_for_vpn_service_identity_def] if {
    input.vpn_service_account_privilege_level == "domain_admin"
}

privileged_account_used_for_vpn_service_identity[_privileged_account_used_for_vpn_service_identity_def] if {
    input.vpn_service_account_privilege_level == "local_admin"
    input.service_account_is_shared == true
}

exposures contains _privileged_account_used_for_vpn_service_identity_def if {
    count(privileged_account_used_for_vpn_service_identity) > 0
}

_hardcoded_secrets_in_configuration_files_def := {
    "name": "Hardcoded Secrets In Configuration Files",
    "description": "Pre-shared keys, private key passphrases, or service account credentials stored in plaintext within configuration files on disk without adequate access controls or secrets management integration.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Hardcoded secrets in configuration files are directly exposed as credentials stored in files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Configuration files may contain hardcoded private keys that attackers can extract and misuse."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Hardcoded secrets represent unsecured credentials accessible to anyone with file system access."
        }
    ]
}

hardcoded_secrets_in_configuration_files[_hardcoded_secrets_in_configuration_files_def] if {
    input.plaintext_secrets_detected == true
    not input.secrets_manager_integrated
}

hardcoded_secrets_in_configuration_files[_hardcoded_secrets_in_configuration_files_def] if {
    input.plaintext_secrets_detected == true
    regex.match("^[0-7]*[2367][0-7]{2}$|^[0-7]{2}[4-7][0-7]$", input.config_file_permission_mode)
}

exposures contains _hardcoded_secrets_in_configuration_files_def if {
    count(hardcoded_secrets_in_configuration_files) > 0
}

_no_account_lockout_or_rate_limiting_on_authentication_def := {
    "name": "No Account Lockout Or Rate Limiting On Authentication",
    "description": "Remote access authentication endpoint does not enforce lockout policies or rate limiting after repeated failed attempts, permitting sustained brute-force or password-spray attacks against user credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Without lockout or rate limiting, attackers can freely guess passwords without consequence."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Lack of rate limiting enables high-volume credential stuffing attacks against the authentication endpoint."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "name": "Password Spraying",
            "relevance": "No account lockout allows password spraying attacks across multiple accounts without triggering security controls."
        }
    ]
}

no_account_lockout_or_rate_limiting_on_authentication[_no_account_lockout_or_rate_limiting_on_authentication_def] if {
    not input.account_lockout_enabled
    not input.rate_limiting_enabled
}

no_account_lockout_or_rate_limiting_on_authentication[_no_account_lockout_or_rate_limiting_on_authentication_def] if {
    input.account_lockout_enabled == true
    input.max_failed_auth_attempts > 100
    not input.rate_limiting_enabled
}

exposures contains _no_account_lockout_or_rate_limiting_on_authentication_def if {
    count(no_account_lockout_or_rate_limiting_on_authentication) > 0
}
