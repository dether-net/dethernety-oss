package _dt_built_in.exposures.load_balancer

_unencrypted_backend_traffic_def := {
    "name": "Unencrypted Backend Traffic",
    "description": "SSL/TLS termination at the load balancer with plaintext HTTP forwarded to backend servers exposes sensitive data to interception on the internal network segment if that segment is compromised or monitored.",
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
            "relevance": "Unencrypted backend traffic can be captured by an attacker performing network sniffing to intercept sensitive data in transit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unencrypted backend channels may be exploited to exfiltrate data over alternative protocols without detection."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_backend_traffic[_unencrypted_backend_traffic_def] if {
    input.ssl_termination_at_load_balancer == true
    input.backend_protocol == "HTTP"
    not input.internal_network_encryption_enforced
}

exposures contains _unencrypted_backend_traffic_def if {
    count(unencrypted_backend_traffic) > 0
}

_weak_tls_configuration_def := {
    "name": "Weak Tls Configuration",
    "description": "Acceptance of deprecated TLS versions (TLS 1.0, 1.1) or weak cipher suites (RC4, DES, NULL) on the client-facing listener allows downgrade attacks and session decryption.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak TLS configurations can be exploited through downgrade attacks to force use of weaker cipher suites or protocol versions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Weak TLS configuration directly relates to weakened encryption that adversaries can exploit to decrypt communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Weak TLS configurations often involve reduced key lengths, which corresponds to reducing the effective key space attackers need to break."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "TLSv1.0" in input.accepted_tls_versions
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "TLSv1.1" in input.accepted_tls_versions
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "RC4" in input.accepted_cipher_suites
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "DES" in input.accepted_cipher_suites
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "NULL" in input.accepted_cipher_suites
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "EXPORT" in input.accepted_cipher_suites
}

weak_tls_configuration[_weak_tls_configuration_def] if {
    "3DES" in input.accepted_cipher_suites
}

exposures contains _weak_tls_configuration_def if {
    count(weak_tls_configuration) > 0
}

_exposed_management_interface_def := {
    "name": "Exposed Management Interface",
    "description": "Administrative console or API endpoint accessible from untrusted or public network segments rather than restricted to a dedicated management network or specific IP allowlist.",
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
            "relevance": "An exposed management interface is a public-facing application that adversaries can directly exploit to gain access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Exposed management interfaces typically provide remote service access that adversaries can abuse for lateral movement or initial access."
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_management_interface[_exposed_management_interface_def] if {
    input.management_interface_network_exposure == "public"
}

exposed_management_interface[_exposed_management_interface_def] if {
    input.management_interface_network_exposure == "all_interfaces"
    not input.ip_allowlist_enforced
}

exposures contains _exposed_management_interface_def if {
    count(exposed_management_interface) > 0
}

_default_or_weak_admin_credentials_def := {
    "name": "Default Or Weak Admin Credentials",
    "description": "Management interface using vendor default usernames and passwords or weak credentials without enforcement of strong password policy, enabling unauthorized administrative access.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "name": "Default Accounts",
            "relevance": "Default or weak admin credentials directly correspond to the use of default accounts that have not been changed from factory settings."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Weak admin credentials are susceptible to password guessing attacks by adversaries attempting to gain unauthorized access."
        }
    ],
    "attack_vector": "NETWORK"
}

default_or_weak_admin_credentials[_default_or_weak_admin_credentials_def] if {
    input.default_credentials_in_use == true
}

default_or_weak_admin_credentials[_default_or_weak_admin_credentials_def] if {
    not input.password_policy_enforced
    not input.admin_account_lockout_enabled
}

exposures contains _default_or_weak_admin_credentials_def if {
    count(default_or_weak_admin_credentials) > 0
}

_missing_mutual_tls_on_backend_def := {
    "name": "Missing Mutual Tls On Backend",
    "description": "Backend connections use one-way TLS or no TLS, allowing any host on the internal network to masquerade as a legitimate backend server if ARP/DNS is compromised, without certificate-based mutual authentication.",
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
            "relevance": "Without mutual TLS, backend communications are vulnerable to adversary-in-the-middle attacks where traffic can be intercepted and manipulated."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Missing mutual TLS means certificates are not used for backend authentication, enabling certificate forgery attacks to impersonate backend services."
        }
    ],
    "attack_vector": "ADJACENT"
}

missing_mutual_tls_on_backend[_missing_mutual_tls_on_backend_def] if {
    input.backend_tls_mode == "none"
}

missing_mutual_tls_on_backend[_missing_mutual_tls_on_backend_def] if {
    input.backend_tls_mode == "one_way_tls"
}

missing_mutual_tls_on_backend[_missing_mutual_tls_on_backend_def] if {
    input.backend_tls_mode == "mutual_tls"
    not input.backend_client_certificate_configured
}

missing_mutual_tls_on_backend[_missing_mutual_tls_on_backend_def] if {
    not input.backend_ca_validation_enforced
    input.backend_tls_mode != "none"
}

exposures contains _missing_mutual_tls_on_backend_def if {
    count(missing_mutual_tls_on_backend) > 0
}

_health_check_information_disclosure_def := {
    "name": "Health Check Information Disclosure",
    "description": "Health check endpoints on backend servers return verbose application or system status information that is reachable from untrusted networks via the load balancer, leaking topology and versioning data.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Health check endpoints exposed publicly can be exploited to gather intelligence for further attacks against the application."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "Health check endpoints often disclose network configuration and topology information useful for adversary reconnaissance."
        }
    ],
    "attack_vector": "NETWORK"
}

health_check_information_disclosure[_health_check_information_disclosure_def] if {
    input.health_check_endpoint_network_exposure == "external_unrestricted"
    input.health_check_response_verbosity == "verbose"
    not input.health_check_authentication_required
}

health_check_information_disclosure[_health_check_information_disclosure_def] if {
    input.health_check_endpoint_network_exposure == "external_unrestricted"
    input.health_check_response_verbosity == "verbose"
    input.health_check_authentication_required == true
}

exposures contains _health_check_information_disclosure_def if {
    count(health_check_information_disclosure) > 0
}

_insufficient_access_logging_def := {
    "name": "Insufficient Access Logging",
    "description": "Load balancer not configured to log client source IP, request method, URI, response code, and backend destination, preventing forensic reconstruction of traffic patterns or attack campaigns.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Insufficient access logging relates directly to log management weaknesses that adversaries exploit or benefit from to avoid detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1665",
            "name": "Hide Infrastructure",
            "relevance": "Insufficient logging enables adversaries to hide their infrastructure and activities by operating in environments with poor visibility."
        }
    ],
    "attack_vector": "UNSPECIFIED"
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    not input.access_logging_enabled
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "client_ip" in input.logged_fields
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "request_method" in input.logged_fields
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "uri" in input.logged_fields
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "response_code" in input.logged_fields
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "backend_destination" in input.logged_fields
}

exposures contains _insufficient_access_logging_def if {
    count(insufficient_access_logging) > 0
}

_missing_rate_limiting_and_connection_throttling_def := {
    "name": "Missing Rate Limiting And Connection Throttling",
    "description": "No per-source connection rate limits or maximum concurrent session caps configured, allowing a single client to exhaust connection pools and degrade service availability for all users.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Missing rate limiting and connection throttling allows service exhaustion flood attacks to overwhelm the load balancer or backend services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "name": "Network Denial of Service",
            "relevance": "Without connection throttling, the load balancer is vulnerable to network-level denial of service attacks that saturate available resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Lack of rate limiting enables application-layer exhaustion floods targeting specific application resources through the load balancer."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_rate_limiting_and_connection_throttling[_missing_rate_limiting_and_connection_throttling_def] if {
    not input.per_source_connection_rate_limit_configured
    not input.max_concurrent_sessions_per_source_configured
}

exposures contains _missing_rate_limiting_and_connection_throttling_def if {
    count(missing_rate_limiting_and_connection_throttling) > 0
}

_unvalidated_or_spoofable_forwarded_headers_def := {
    "name": "Unvalidated Or Spoofable Forwarded Headers",
    "description": "X-Forwarded-For and similar proxy headers accepted from clients without sanitization or override, allowing attackers to inject false source IPs that bypass IP-based access controls on backend applications.",
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
            "relevance": "Spoofable forwarded headers enable adversary-in-the-middle scenarios where attackers manipulate IP or routing information seen by backend services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090",
            "name": "Proxy",
            "relevance": "Unvalidated forwarded headers can be manipulated by attackers using proxies to spoof source addresses and bypass IP-based access controls."
        }
    ],
    "attack_vector": "NETWORK"
}

unvalidated_or_spoofable_forwarded_headers[_unvalidated_or_spoofable_forwarded_headers_def] if {
    not input.trusted_proxy_header_override_enabled
    not input.client_supplied_forwarded_headers_stripped
}

unvalidated_or_spoofable_forwarded_headers[_unvalidated_or_spoofable_forwarded_headers_def] if {
    not input.trusted_proxy_header_override_enabled
    count(input.trusted_upstream_cidr_ranges) == 0
}

unvalidated_or_spoofable_forwarded_headers[_unvalidated_or_spoofable_forwarded_headers_def] if {
    not input.client_supplied_forwarded_headers_stripped
    count(input.trusted_upstream_cidr_ranges) == 0
}

exposures contains _unvalidated_or_spoofable_forwarded_headers_def if {
    count(unvalidated_or_spoofable_forwarded_headers) > 0
}

_privileged_process_execution_def := {
    "name": "Privileged Process Execution",
    "description": "Load balancer daemon running as root or a highly privileged OS user rather than a dedicated low-privilege service account, increasing blast radius if the process is compromised.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Privileged process execution can be exploited to escalate privileges when vulnerabilities exist in processes running with elevated permissions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543",
            "name": "Create or Modify System Process",
            "relevance": "Adversaries may abuse privileged process execution contexts to create or modify system processes for persistence or escalation."
        }
    ],
    "attack_vector": "LOCAL"
}

privileged_process_execution[_privileged_process_execution_def] if {
    input.process_run_user == "root"
}

privileged_process_execution[_privileged_process_execution_def] if {
    input.process_effective_uid == 0
}

privileged_process_execution[_privileged_process_execution_def] if {
    not input.dedicated_service_account_exists
    input.process_effective_uid < 1000
}

exposures contains _privileged_process_execution_def if {
    count(privileged_process_execution) > 0
}

_hardcoded_secrets_in_configuration_def := {
    "name": "Hardcoded Secrets In Configuration",
    "description": "TLS private keys, backend API tokens, or administrative passwords stored in plaintext within configuration files without file-permission restrictions or secrets management integration.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Hardcoded secrets in configuration files are directly exploitable as credentials stored in files that adversaries can discover and use."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Hardcoded secrets often include private keys embedded in configuration files that adversaries can extract for authentication or decryption."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Hardcoded secrets represent unsecured credentials that adversaries can find and leverage to gain unauthorized access."
        }
    ],
    "attack_vector": "LOCAL"
}

hardcoded_secrets_in_configuration[_hardcoded_secrets_in_configuration_def] if {
    input.plaintext_secrets_present == true
    not input.secrets_manager_integrated
}

hardcoded_secrets_in_configuration[_hardcoded_secrets_in_configuration_def] if {
    input.plaintext_secrets_present == true
    not input.config_file_permissions_restricted
}

exposures contains _hardcoded_secrets_in_configuration_def if {
    count(hardcoded_secrets_in_configuration) > 0
}

_unpatched_load_balancer_software_def := {
    "name": "Unpatched Load Balancer Software",
    "description": "Running a version of the load balancer software with known CVEs due to absence of a defined patching cadence or automated update mechanism, exposing the host to remote exploitation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Unpatched load balancer software contains known vulnerabilities that adversaries can exploit as a public-facing application entry point."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched software vulnerabilities in load balancers can be exploited through remote service exploitation techniques."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_load_balancer_software[_unpatched_load_balancer_software_def] if {
    input.version_has_known_cve == true
}

unpatched_load_balancer_software[_unpatched_load_balancer_software_def] if {
    not input.patching_cadence_defined
    input.days_since_last_patch > 90
}

exposures contains _unpatched_load_balancer_software_def if {
    count(unpatched_load_balancer_software) > 0
}

_missing_multi_factor_authentication_on_admin_def := {
    "name": "Missing Multi Factor Authentication On Admin",
    "description": "Management interface authenticated by username and password alone without MFA enforcement, making credential theft sufficient for full administrative compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1556.006",
            "name": "Multi-Factor Authentication",
            "relevance": "Missing MFA on admin interfaces directly corresponds to the absence of multi-factor authentication controls that adversaries can bypass or exploit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1111",
            "name": "Multi-Factor Authentication Interception",
            "relevance": "When MFA is absent on admin interfaces, adversaries do not need to intercept MFA tokens, making credential-based attacks trivially successful."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Without MFA, admin interfaces are vulnerable to credential stuffing attacks that can achieve account takeover with stolen credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_multi_factor_authentication_on_admin[_missing_multi_factor_authentication_on_admin_def] if {
    not input.mfa_enforced_on_admin_interface
}

missing_multi_factor_authentication_on_admin[_missing_multi_factor_authentication_on_admin_def] if {
    input.admin_auth_method in ["local_password", "ldap_no_mfa", "radius_no_mfa"]
}

exposures contains _missing_multi_factor_authentication_on_admin_def if {
    count(missing_multi_factor_authentication_on_admin) > 0
}

_no_session_timeout_on_management_session_def := {
    "name": "No Session Timeout On Management Session",
    "description": "Administrative sessions do not expire after inactivity, leaving authenticated console sessions open indefinitely and susceptible to session hijacking or unauthorized reuse on shared terminals.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "name": "Steal Web Session Cookie",
            "relevance": "Sessions without timeout remain valid indefinitely, making stolen session cookies permanently usable for unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "name": "Web Session Cookie",
            "relevance": "Long-lived management sessions allow adversaries to use captured web session cookies to maintain persistent unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1563",
            "name": "Remote Service Session Hijacking",
            "relevance": "Without session timeouts, hijacked remote management sessions remain valid, enabling persistent unauthorized control of the load balancer."
        }
    ],
    "attack_vector": "ADJACENT"
}

no_session_timeout_on_management_session[_no_session_timeout_on_management_session_def] if {
    input.management_session_timeout_seconds == 0
}

no_session_timeout_on_management_session[_no_session_timeout_on_management_session_def] if {
    not input.session_timeout_enforced
}

exposures contains _no_session_timeout_on_management_session_def if {
    count(no_session_timeout_on_management_session) > 0
}

_backend_pool_auto_discovery_without_authentication_def := {
    "name": "Backend Pool Auto Discovery Without Authentication",
    "description": "Dynamic backend registration or service-discovery integration (e.g., Consul, Kubernetes API) configured without authentication, allowing an attacker who reaches the discovery service to inject malicious backend nodes.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "name": "Network Service Discovery",
            "relevance": "Unauthenticated backend pool auto-discovery exposes network services to enumeration by adversaries performing network service discovery."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1580",
            "name": "Cloud Infrastructure Discovery",
            "relevance": "Auto-discovery without authentication in cloud environments enables adversaries to enumerate cloud infrastructure components and backend pools."
        }
    ],
    "attack_vector": "ADJACENT"
}

backend_pool_auto_discovery_without_authentication[_backend_pool_auto_discovery_without_authentication_def] if {
    not input.discovery_service_auth_enabled
}

backend_pool_auto_discovery_without_authentication[_backend_pool_auto_discovery_without_authentication_def] if {
    not input.backend_node_registration_validation_enabled
    input.discovery_service_auth_enabled == true
}

exposures contains _backend_pool_auto_discovery_without_authentication_def if {
    count(backend_pool_auto_discovery_without_authentication) > 0
}

_missing_certificate_validity_monitoring_def := {
    "name": "Missing Certificate Validity Monitoring",
    "description": "No alerting or automated rotation for TLS certificates approaching expiry on either client-facing or backend listeners, risking service outage or continued operation with expired, untrusted certificates.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Without certificate validity monitoring, forged or stolen certificates may go undetected, enabling long-term impersonation attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Missing certificate monitoring allows adversaries to develop and use fraudulent digital certificates without timely detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "name": "Install Root Certificate",
            "relevance": "Lack of certificate validity monitoring may allow unauthorized root certificate installation to go undetected."
        }
    ],
    "attack_vector": "UNSPECIFIED"
}

missing_certificate_validity_monitoring[_missing_certificate_validity_monitoring_def] if {
    not input.certificate_expiry_alerting_enabled
}

missing_certificate_validity_monitoring[_missing_certificate_validity_monitoring_def] if {
    input.certificate_expiry_alerting_enabled == true
    input.minimum_days_before_expiry_alert == 0
}

missing_certificate_validity_monitoring[_missing_certificate_validity_monitoring_def] if {
    not input.automated_certificate_rotation_enabled
    not input.certificate_expiry_alerting_enabled
}

exposures contains _missing_certificate_validity_monitoring_def if {
    count(missing_certificate_validity_monitoring) > 0
}

_unrestricted_icmp_and_diagnostic_protocols_def := {
    "name": "Unrestricted Icmp And Diagnostic Protocols",
    "description": "ICMP, SNMP, or other diagnostic protocols enabled on the load balancer interface without source restriction, enabling network mapping and potential exploitation of SNMP community string weaknesses.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1095",
            "name": "Non-Application Layer Protocol",
            "relevance": "Unrestricted ICMP and diagnostic protocols can be abused as non-application layer protocol channels for covert communication or reconnaissance."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602.001",
            "name": "SNMP (MIB Dump)",
            "relevance": "Unrestricted diagnostic protocols including SNMP allow adversaries to dump MIB data and gather detailed network configuration information."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1016",
            "name": "System Network Configuration Discovery",
            "relevance": "Unrestricted ICMP and diagnostic protocols enable adversaries to perform network configuration discovery and map the infrastructure."
        }
    ],
    "attack_vector": "ADJACENT"
}

unrestricted_icmp_and_diagnostic_protocols[_unrestricted_icmp_and_diagnostic_protocols_def] if {
    input.icmp_unrestricted == true
}

unrestricted_icmp_and_diagnostic_protocols[_unrestricted_icmp_and_diagnostic_protocols_def] if {
    input.snmp_enabled == true
    not input.snmp_source_restricted
}

unrestricted_icmp_and_diagnostic_protocols[_unrestricted_icmp_and_diagnostic_protocols_def] if {
    input.snmp_enabled == true
    input.snmp_community_string_strength in ["default", "weak"]
}

exposures contains _unrestricted_icmp_and_diagnostic_protocols_def if {
    count(unrestricted_icmp_and_diagnostic_protocols) > 0
}
