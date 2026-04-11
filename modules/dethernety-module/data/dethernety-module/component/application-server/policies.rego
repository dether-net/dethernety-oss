package _dt_built_in.exposures.application_server

_unauthenticated_management_endpoint_exposure_def := {
    "name": "Unauthenticated Management Endpoint Exposure",
    "description": "Administrative or diagnostic endpoints (health checks, metrics, actuator, debug routes) exposed without authentication on a publicly reachable interface allow unauthorized actors to enumerate internal state, trigger operations, or extract sensitive runtime data.",
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
            "relevance": "Unauthenticated management endpoints are directly exploitable public-facing attack surfaces."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1595",
            "name": "Active Scanning",
            "relevance": "Attackers actively scan for exposed management endpoints to identify unauthenticated access points."
        }
    ]
}

unauthenticated_management_endpoint_exposure[_unauthenticated_management_endpoint_exposure_def] if {
    not input.management_endpoints_require_authentication
    input.management_interface_network_exposure == "public"
}

unauthenticated_management_endpoint_exposure[_unauthenticated_management_endpoint_exposure_def] if {
    not input.management_endpoints_require_authentication
    input.management_interface_network_exposure == "internal_network"
}

exposures contains _unauthenticated_management_endpoint_exposure_def if {
    count(unauthenticated_management_endpoint_exposure) > 0
}

_tls_not_enforced_on_inbound_connections_def := {
    "name": "Tls Not Enforced On Inbound Connections",
    "description": "The server accepts plaintext HTTP connections in addition to or instead of HTTPS, allowing network-position attackers to intercept API credentials, tokens, and payload data in transit.",
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
            "relevance": "Without TLS enforcement, plaintext traffic on inbound connections is vulnerable to interception via network sniffing."
        }
    ]
}

tls_not_enforced_on_inbound_connections[_tls_not_enforced_on_inbound_connections_def] if {
    input.http_plaintext_port_enabled == true
    not input.https_redirect_enforced
}

exposures contains _tls_not_enforced_on_inbound_connections_def if {
    count(tls_not_enforced_on_inbound_connections) > 0
}

_weak_or_default_tls_configuration_def := {
    "name": "Weak Or Default Tls Configuration",
    "description": "Deprecated TLS versions (TLS 1.0/1.1) or weak cipher suites are enabled in the server's TLS configuration, permitting downgrade or protocol-level attacks even when encryption is nominally enforced.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak or default TLS configurations enable downgrade attacks that force use of weaker cipher suites or protocol versions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Default or misconfigured TLS settings directly weaken encryption strength, aligning with this technique."
        }
    ]
}

weak_or_default_tls_configuration[_weak_or_default_tls_configuration_def] if {
    input.minimum_tls_version in ["SSL3.0", "TLS1.0", "TLS1.1"]
}

weak_or_default_tls_configuration[_weak_or_default_tls_configuration_def] if {
    input.weak_cipher_suites_enabled == true
}

exposures contains _weak_or_default_tls_configuration_def if {
    count(weak_or_default_tls_configuration) > 0
}

_process_running_with_excessive_os_privilege_def := {
    "name": "Process Running With Excessive Os Privilege",
    "description": "The application server process runs as root or a privileged system account rather than a dedicated low-privilege service account, so exploitation of the process yields full host compromise rather than a contained sandbox.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Processes with excessive OS privileges provide an elevated foothold that attackers exploit to escalate privileges further."
        }
    ]
}

process_running_with_excessive_os_privilege[_process_running_with_excessive_os_privilege_def] if {
    input.process_run_account == "root"
}

process_running_with_excessive_os_privilege[_process_running_with_excessive_os_privilege_def] if {
    input.process_uid == 0
}

process_running_with_excessive_os_privilege[_process_running_with_excessive_os_privilege_def] if {
    not input.dedicated_service_account_configured
}

exposures contains _process_running_with_excessive_os_privilege_def if {
    count(process_running_with_excessive_os_privilege) > 0
}

_secrets_stored_in_plaintext_on_disk_or_environment_def := {
    "name": "Secrets Stored In Plaintext On Disk Or Environment",
    "description": "API keys, database credentials, or service tokens are stored in plaintext configuration files, shell environment variables, or unencrypted properties files on the host filesystem, accessible to any process or user with read access.",
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
            "relevance": "Secrets stored in plaintext on disk are directly targeted by credential harvesting from files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Plaintext secrets in environment variables or disk represent unsecured credentials that adversaries search for."
        }
    ]
}

secrets_stored_in_plaintext_on_disk_or_environment[_secrets_stored_in_plaintext_on_disk_or_environment_def] if {
    input.plaintext_secrets_on_filesystem == true
}

secrets_stored_in_plaintext_on_disk_or_environment[_secrets_stored_in_plaintext_on_disk_or_environment_def] if {
    input.plaintext_secrets_in_environment_variables == true
}

secrets_stored_in_plaintext_on_disk_or_environment[_secrets_stored_in_plaintext_on_disk_or_environment_def] if {
    not input.secrets_manager_integrated
    input.plaintext_secrets_on_filesystem == true
}

exposures contains _secrets_stored_in_plaintext_on_disk_or_environment_def if {
    count(secrets_stored_in_plaintext_on_disk_or_environment) > 0
}

_missing_or_incomplete_request_and_error_logging_def := {
    "name": "Missing Or Incomplete Request And Error Logging",
    "description": "The server is not configured to log authentication events, authorization failures, or API errors to a centralized, tamper-evident system, preventing detection of abuse and eliminating forensic audit trails.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Missing or incomplete logging is analogous to disabled/modified logs, preventing detection of malicious activity."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Incomplete logging results in blocking of indicators that would otherwise surface attacker activity."
        }
    ]
}

missing_or_incomplete_request_and_error_logging[_missing_or_incomplete_request_and_error_logging_def] if {
    not input.auth_event_logging_enabled
}

missing_or_incomplete_request_and_error_logging[_missing_or_incomplete_request_and_error_logging_def] if {
    not input.authorization_failure_logging_enabled
}

missing_or_incomplete_request_and_error_logging[_missing_or_incomplete_request_and_error_logging_def] if {
    not input.api_error_logging_enabled
}

missing_or_incomplete_request_and_error_logging[_missing_or_incomplete_request_and_error_logging_def] if {
    not input.centralized_log_destination_configured
}

exposures contains _missing_or_incomplete_request_and_error_logging_def if {
    count(missing_or_incomplete_request_and_error_logging) > 0
}

_sensitive_data_leakage_in_log_output_def := {
    "name": "Sensitive Data Leakage In Log Output",
    "description": "Logging configuration captures full request bodies, headers, or stack traces that contain credentials, PII, or session tokens, causing sensitive data to be written to log files accessible to operators and log aggregation systems.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Attackers enumerate logs to harvest sensitive data that has leaked into log output."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.001",
            "name": "Credentials",
            "relevance": "Sensitive data leaked in logs often includes credentials that adversaries collect for reconnaissance or access."
        }
    ]
}

sensitive_data_leakage_in_log_output[_sensitive_data_leakage_in_log_output_def] if {
    input.log_request_body_enabled == true
    not input.log_sensitive_field_redaction_enabled
}

sensitive_data_leakage_in_log_output[_sensitive_data_leakage_in_log_output_def] if {
    input.log_sensitive_headers_enabled == true
    not input.log_sensitive_field_redaction_enabled
}

sensitive_data_leakage_in_log_output[_sensitive_data_leakage_in_log_output_def] if {
    input.log_level in ["DEBUG", "TRACE"]
    not input.log_sensitive_field_redaction_enabled
}

exposures contains _sensitive_data_leakage_in_log_output_def if {
    count(sensitive_data_leakage_in_log_output) > 0
}

_unpatched_runtime_or_framework_def := {
    "name": "Unpatched Runtime Or Framework",
    "description": "The application runtime (JVM, Node.js, Python interpreter) or server framework is not kept current with security patches, leaving known CVEs exploitable by any actor able to reach the service.",
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
            "relevance": "Unpatched runtimes and frameworks in public-facing applications are directly exploited by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Known vulnerabilities in unpatched runtimes are exploited to compromise remote services."
        }
    ]
}

unpatched_runtime_or_framework[_unpatched_runtime_or_framework_def] if {
    input.runtime_version_has_known_cve == true
}

unpatched_runtime_or_framework[_unpatched_runtime_or_framework_def] if {
    input.framework_version_has_known_cve == true
}

unpatched_runtime_or_framework[_unpatched_runtime_or_framework_def] if {
    input.days_since_last_patch_applied > 90
}

exposures contains _unpatched_runtime_or_framework_def if {
    count(unpatched_runtime_or_framework) > 0
}

_overly_permissive_network_binding_def := {
    "name": "Overly Permissive Network Binding",
    "description": "The server binds to 0.0.0.0 or all interfaces including management and internal interfaces that should be network-restricted, unnecessarily increasing the reachable attack surface from untrusted network segments.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "name": "Network Service Discovery",
            "relevance": "Services bound to all interfaces are more easily discovered by adversaries scanning for network services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Overly permissive network binding can bridge internal and external network boundaries, enabling lateral movement."
        }
    ]
}

overly_permissive_network_binding[_overly_permissive_network_binding_def] if {
    "0.0.0.0" in input.bound_addresses
    not input.network_policy_restricts_inbound
}

overly_permissive_network_binding[_overly_permissive_network_binding_def] if {
    "::" in input.bound_addresses
    not input.network_policy_restricts_inbound
}

exposures contains _overly_permissive_network_binding_def if {
    count(overly_permissive_network_binding) > 0
}

_missing_rate_limiting_and_resource_throttling_def := {
    "name": "Missing Rate Limiting And Resource Throttling",
    "description": "No host-level configuration (e.g., connection limits, request queue depth, timeout values) restricts the rate or volume of inbound requests, making the server susceptible to denial-of-service through resource exhaustion.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Without rate limiting, applications are vulnerable to exhaustion floods that overwhelm application-layer resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Missing throttling allows service exhaustion attacks that degrade or deny service availability."
        }
    ]
}

missing_rate_limiting_and_resource_throttling[_missing_rate_limiting_and_resource_throttling_def] if {
    not input.connection_limit_configured
    input.request_timeout_seconds == 0
}

missing_rate_limiting_and_resource_throttling[_missing_rate_limiting_and_resource_throttling_def] if {
    not input.connection_limit_configured
    input.request_queue_depth_limit == 0
}

missing_rate_limiting_and_resource_throttling[_missing_rate_limiting_and_resource_throttling_def] if {
    input.request_timeout_seconds == 0
    input.request_queue_depth_limit == 0
}

exposures contains _missing_rate_limiting_and_resource_throttling_def if {
    count(missing_rate_limiting_and_resource_throttling) > 0
}

_inter_service_mutual_tls_not_configured_def := {
    "name": "Inter Service Mutual Tls Not Configured",
    "description": "Connections from the application server to downstream services (databases, internal APIs, message queues) use one-way TLS or no TLS, allowing a compromised internal host to impersonate a trusted downstream service.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1001.003",
            "name": "Protocol or Service Impersonation",
            "relevance": "Without mutual TLS, services cannot verify peer identity, enabling impersonation of legitimate services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Absence of mTLS allows attackers to intercept or tunnel through inter-service communication undetected."
        }
    ]
}

inter_service_mutual_tls_not_configured[_inter_service_mutual_tls_not_configured_def] if {
    input.downstream_connection_tls_mode == "none"
}

inter_service_mutual_tls_not_configured[_inter_service_mutual_tls_not_configured_def] if {
    input.downstream_connection_tls_mode == "one_way"
}

inter_service_mutual_tls_not_configured[_inter_service_mutual_tls_not_configured_def] if {
    not input.mutual_tls_enforced
    not input.downstream_ca_validation_enforced
}

exposures contains _inter_service_mutual_tls_not_configured_def if {
    count(inter_service_mutual_tls_not_configured) > 0
}

_jwt_or_token_validation_misconfiguration_def := {
    "name": "Jwt Or Token Validation Misconfiguration",
    "description": "The server's token validation settings permit insecure algorithms (e.g., 'none' algorithm), skip signature verification, or use overly long expiry windows, allowing forged or replayed tokens to authenticate successfully at the infrastructure configuration level.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "name": "Forge Web Credentials",
            "relevance": "JWT validation misconfigurations allow attackers to forge or manipulate web tokens to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550",
            "name": "Use Alternate Authentication Material",
            "relevance": "Misconfigured token validation enables use of crafted or stolen tokens as alternate authentication material."
        }
    ]
}

jwt_or_token_validation_misconfiguration[_jwt_or_token_validation_misconfiguration_def] if {
    "none" in input.allowed_jwt_algorithms
}

jwt_or_token_validation_misconfiguration[_jwt_or_token_validation_misconfiguration_def] if {
    not input.signature_verification_enforced
}

jwt_or_token_validation_misconfiguration[_jwt_or_token_validation_misconfiguration_def] if {
    input.token_expiry_max_seconds > 86400
}

exposures contains _jwt_or_token_validation_misconfiguration_def if {
    count(jwt_or_token_validation_misconfiguration) > 0
}

_absence_of_graceful_shutdown_and_circuit_breaker_configuration_def := {
    "name": "Absence Of Graceful Shutdown And Circuit Breaker Configuration",
    "description": "No host-level configuration enforces connection draining, timeout limits, or circuit-breaker thresholds for downstream calls, causing cascading failures and extended unavailability under partial outage conditions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Without circuit breakers, cascading failures from service exhaustion floods are not contained, amplifying impact."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1008",
            "name": "Fallback Channels",
            "relevance": "Lack of circuit breaker configuration leaves no controlled fallback, mirroring the resilience gap exploited by fallback channel techniques."
        }
    ]
}

absence_of_graceful_shutdown_and_circuit_breaker_configuration[_absence_of_graceful_shutdown_and_circuit_breaker_configuration_def] if {
    not input.connection_draining_enabled
}

absence_of_graceful_shutdown_and_circuit_breaker_configuration[_absence_of_graceful_shutdown_and_circuit_breaker_configuration_def] if {
    not input.downstream_timeout_configured
}

absence_of_graceful_shutdown_and_circuit_breaker_configuration[_absence_of_graceful_shutdown_and_circuit_breaker_configuration_def] if {
    not input.circuit_breaker_configured
}

exposures contains _absence_of_graceful_shutdown_and_circuit_breaker_configuration_def if {
    count(absence_of_graceful_shutdown_and_circuit_breaker_configuration) > 0
}

_debug_mode_enabled_in_production_def := {
    "name": "Debug Mode Enabled In Production",
    "description": "The server's debug or development mode flag is active in a production environment, enabling verbose error output, remote debugging ports, or live reloading features that expose internal implementation details and open additional attack vectors.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505",
            "name": "Server Software Component",
            "relevance": "Debug mode in production may expose server internals or enable persistent backdoor-like access through server components."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1622",
            "name": "Debugger Evasion",
            "relevance": "Debug endpoints in production can be leveraged by attackers who are aware of debugging interfaces to inspect or manipulate application state."
        }
    ]
}

debug_mode_enabled_in_production[_debug_mode_enabled_in_production_def] if {
    input.debug_mode_enabled == true
    input.environment_classification == "production"
}

debug_mode_enabled_in_production[_debug_mode_enabled_in_production_def] if {
    input.debug_mode_enabled == true
    input.environment_classification == "unknown"
}

debug_mode_enabled_in_production[_debug_mode_enabled_in_production_def] if {
    input.debug_port_exposed == true
    input.environment_classification == "production"
}

debug_mode_enabled_in_production[_debug_mode_enabled_in_production_def] if {
    input.debug_port_exposed == true
    input.environment_classification == "unknown"
}

exposures contains _debug_mode_enabled_in_production_def if {
    count(debug_mode_enabled_in_production) > 0
}
