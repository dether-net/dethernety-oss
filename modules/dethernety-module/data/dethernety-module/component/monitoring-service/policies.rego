package _dt_built_in.exposures.monitoring_service



_unauthenticated_monitoring_api_endpoint_def := {
    "name": "Unauthenticated Monitoring Api Endpoint",
    "description": "The monitoring agent exposes an API or management interface without requiring authentication, allowing any local or network-accessible process to query telemetry, suppress alerts, or modify detection thresholds.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1119",
            "name": "Automated Collection",
            "relevance": "An unauthenticated API endpoint allows attackers to programmatically collect monitoring data without credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Unauthenticated access to a monitoring API could allow attackers to suppress or block security indicators."
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_monitoring_api_endpoint[_unauthenticated_monitoring_api_endpoint_def] if {
    not input.authentication_required
    input.api_network_exposure in ["internal_network", "public"]
}

unauthenticated_monitoring_api_endpoint[_unauthenticated_monitoring_api_endpoint_def] if {
    not input.authentication_required
    input.sensitive_operations_exposed == true
}

exposures contains _unauthenticated_monitoring_api_endpoint_def if {
    count(unauthenticated_monitoring_api_endpoint) > 0
}

_unencrypted_telemetry_transmission_def := {
    "name": "Unencrypted Telemetry Transmission",
    "description": "Telemetry data and alert payloads are transmitted to aggregators or SIEM systems without TLS/SSL encryption, exposing sensitive system health data and alert content to interception or tampering in transit.",
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
            "relevance": "Unencrypted telemetry can be intercepted via network sniffing, exposing sensitive monitoring data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "name": "Transmitted Data Manipulation",
            "relevance": "Unencrypted telemetry is vulnerable to in-transit manipulation by adversaries."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_telemetry_transmission[_unencrypted_telemetry_transmission_def] if {
    not input.telemetry_transport_tls_enabled
}

unencrypted_telemetry_transmission[_unencrypted_telemetry_transmission_def] if {
    input.telemetry_destination_protocol in ["http", "tcp", "udp", "syslog_tcp", "syslog_udp"]
}

unencrypted_telemetry_transmission[_unencrypted_telemetry_transmission_def] if {
    input.telemetry_transport_tls_enabled == true
    not input.ca_certificate_validation_enforced
}

exposures contains _unencrypted_telemetry_transmission_def if {
    count(unencrypted_telemetry_transmission) > 0
}

_overprivileged_agent_service_account_def := {
    "name": "Overprivileged Agent Service Account",
    "description": "The monitoring agent runs under a highly privileged account (e.g., root or SYSTEM) when only read access to specific subsystems is required, increasing the blast radius if the agent process is compromised.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.002",
            "name": "Bypass User Account Control",
            "relevance": "An overprivileged service account may allow attackers to bypass access controls and escalate privileges."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1546",
            "name": "Event Triggered Execution",
            "relevance": "Overprivileged accounts can be abused to establish persistence via event-triggered execution mechanisms."
        }
    ],
    "attack_vector": "LOCAL"
}

overprivileged_agent_service_account[_overprivileged_agent_service_account_def] if {
    input.agent_process_account in ["root", "SYSTEM"]
    not input.least_privilege_policy_enforced
}

overprivileged_agent_service_account[_overprivileged_agent_service_account_def] if {
    input.agent_process_account == "other_privileged"
    not input.least_privilege_policy_enforced
    not input.process_isolation_enabled
}

overprivileged_agent_service_account[_overprivileged_agent_service_account_def] if {
    input.agent_process_account == "unknown"
    not input.least_privilege_policy_enforced
    not input.process_isolation_enabled
}

exposures contains _overprivileged_agent_service_account_def if {
    count(overprivileged_agent_service_account) > 0
}

_hardcoded_or_default_credentials_def := {
    "name": "Hardcoded Or Default Credentials",
    "description": "The monitoring service uses default credentials or credentials embedded in configuration files for connecting to alerting backends or databases, allowing unauthorized access if files are readable or defaults are not changed.",
    "type": "insecure_default",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "name": "Default Accounts",
            "relevance": "Hardcoded or default credentials directly correspond to exploitation of default accounts for unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Hardcoded credentials stored in configuration files are a primary example of credentials in files."
        }
    ],
    "attack_vector": "LOCAL"
}

hardcoded_or_default_credentials[_hardcoded_or_default_credentials_def] if {
    input.credential_source == "hardcoded_config_file"
    input.config_file_world_readable == true
}

hardcoded_or_default_credentials[_hardcoded_or_default_credentials_def] if {
    input.credential_source == "default_vendor_credentials"
    not input.default_credentials_changed
}

hardcoded_or_default_credentials[_hardcoded_or_default_credentials_def] if {
    input.credential_source == "hardcoded_config_file"
}

exposures contains _hardcoded_or_default_credentials_def if {
    count(hardcoded_or_default_credentials) > 0
}

_alert_suppression_via_unauthorized_config_modification_def := {
    "name": "Alert Suppression Via Unauthorized Config Modification",
    "description": "Alert thresholds, detection rules, or suppression lists are stored in world-writable configuration files or accessible directories, allowing a local attacker to disable or tune down alerting to hide malicious activity.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "name": "Disable or Modify Tools",
            "relevance": "Unauthorized configuration modification can disable or alter security tools to suppress alerts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Modifying alert configurations can block security indicators from being reported or acted upon."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.011",
            "name": "Spoof Security Alerting",
            "relevance": "Unauthorized config changes can be used to spoof or suppress security alerting systems."
        }
    ],
    "attack_vector": "LOCAL"
}

alert_suppression_via_unauthorized_config_modification[_alert_suppression_via_unauthorized_config_modification_def] if {
    input.config_file_world_writable == true
}

alert_suppression_via_unauthorized_config_modification[_alert_suppression_via_unauthorized_config_modification_def] if {
    input.config_directory_world_writable == true
}

alert_suppression_via_unauthorized_config_modification[_alert_suppression_via_unauthorized_config_modification_def] if {
    not input.config_integrity_monitoring_enabled
    not input.config_owner_matches_service_account
}

exposures contains _alert_suppression_via_unauthorized_config_modification_def if {
    count(alert_suppression_via_unauthorized_config_modification) > 0
}

_unpatched_monitoring_agent_software_def := {
    "name": "Unpatched Monitoring Agent Software",
    "description": "The monitoring agent or its dependencies are not maintained on a patch cycle, leaving known CVEs in the agent binary or bundled libraries exploitable by attackers who can reach the agent's network interface or supply crafted inputs.",
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
            "relevance": "Unpatched monitoring agents with known vulnerabilities can be exploited as public-facing applications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched agent software exposes exploitable remote services to adversaries."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_monitoring_agent_software[_unpatched_monitoring_agent_software_def] if {
    input.agent_version_has_known_cve == true
    input.agent_network_interface_exposed == true
}

unpatched_monitoring_agent_software[_unpatched_monitoring_agent_software_def] if {
    input.agent_version_has_known_cve == true
}

unpatched_monitoring_agent_software[_unpatched_monitoring_agent_software_def] if {
    input.days_since_last_patch > 90
    input.agent_network_interface_exposed == true
}

exposures contains _unpatched_monitoring_agent_software_def if {
    count(unpatched_monitoring_agent_software) > 0
}

_excessive_network_exposure_of_agent_listener_def := {
    "name": "Excessive Network Exposure Of Agent Listener",
    "description": "The monitoring agent binds its listener to all network interfaces (0.0.0.0) rather than loopback or a dedicated management network, unnecessarily exposing the service to untrusted networks.",
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
            "relevance": "Excessively exposed agent listeners are discoverable via network service scanning."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1049",
            "name": "System Network Connections Discovery",
            "relevance": "Attackers can enumerate exposed agent listener connections to map network attack surfaces."
        }
    ],
    "attack_vector": "NETWORK"
}

excessive_network_exposure_of_agent_listener[_excessive_network_exposure_of_agent_listener_def] if {
    input.listener_bind_address == "0.0.0.0"
    not input.network_policy_restricts_agent_port
}

excessive_network_exposure_of_agent_listener[_excessive_network_exposure_of_agent_listener_def] if {
    input.listener_bind_address == "0.0.0.0"
    not input.authentication_required
}

exposures contains _excessive_network_exposure_of_agent_listener_def if {
    count(excessive_network_exposure_of_agent_listener) > 0
}

_insufficient_logging_of_alert_and_config_changes_def := {
    "name": "Insufficient Logging Of Alert And Config Changes",
    "description": "Changes to detection rules, alert configurations, or suppression settings are not logged with sufficient detail (user, timestamp, before/after values), preventing forensic reconstruction of tampering events.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "name": "Indicator Removal",
            "relevance": "Insufficient logging allows attackers to remove indicators of compromise without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.011",
            "name": "Spoof Security Alerting",
            "relevance": "Without sufficient logging, alert spoofing or suppression activities go undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Insufficient logging enables indicator blocking to succeed unnoticed in alert and config changes."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_logging_of_alert_and_config_changes[_insufficient_logging_of_alert_and_config_changes_def] if {
    not input.config_change_audit_logging_enabled
}

insufficient_logging_of_alert_and_config_changes[_insufficient_logging_of_alert_and_config_changes_def] if {
    input.config_change_audit_logging_enabled == true
    not "user" in input.audit_log_fields_captured
}

insufficient_logging_of_alert_and_config_changes[_insufficient_logging_of_alert_and_config_changes_def] if {
    input.config_change_audit_logging_enabled == true
    not "before_value" in input.audit_log_fields_captured
}

insufficient_logging_of_alert_and_config_changes[_insufficient_logging_of_alert_and_config_changes_def] if {
    input.config_change_audit_logging_enabled == true
    not "after_value" in input.audit_log_fields_captured
}

insufficient_logging_of_alert_and_config_changes[_insufficient_logging_of_alert_and_config_changes_def] if {
    not input.suppression_change_logging_enabled
}

exposures contains _insufficient_logging_of_alert_and_config_changes_def if {
    count(insufficient_logging_of_alert_and_config_changes) > 0
}

_secrets_stored_in_plaintext_config_files_def := {
    "name": "Secrets Stored In Plaintext Config Files",
    "description": "API keys, tokens, or passwords used by the monitoring agent to authenticate to alerting platforms or cloud services are stored in plaintext on disk, readable to any process with filesystem access to the config directory.",
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
            "relevance": "Plaintext secrets in config files are directly exploitable as credentials stored in files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Config files may contain private keys stored in plaintext, enabling authentication bypass."
        }
    ],
    "attack_vector": "LOCAL"
}

secrets_stored_in_plaintext_config_files[_secrets_stored_in_plaintext_config_files_def] if {
    input.secret_storage_method == "plaintext_file"
    input.config_file_world_readable == true
}

secrets_stored_in_plaintext_config_files[_secrets_stored_in_plaintext_config_files_def] if {
    input.secret_storage_method == "plaintext_file"
    input.plaintext_secret_patterns_found == true
}

exposures contains _secrets_stored_in_plaintext_config_files_def if {
    count(secrets_stored_in_plaintext_config_files) > 0
}

_missing_mutual_tls_for_agent_to_collector_communication_def := {
    "name": "Missing Mutual Tls For Agent To Collector Communication",
    "description": "The agent authenticates the collector endpoint but the collector does not authenticate the agent (one-way TLS only), allowing a rogue agent or man-in-the-middle to inject fabricated telemetry or alerts into the monitoring pipeline.",
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
            "relevance": "Without mutual TLS, agent-to-collector communication is vulnerable to adversary-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Absence of mutual TLS exposes certificate-based authentication to theft or forgery."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_for_agent_to_collector_communication[_missing_mutual_tls_for_agent_to_collector_communication_def] if {
    not input.mutual_tls_enabled
}

missing_mutual_tls_for_agent_to_collector_communication[_missing_mutual_tls_for_agent_to_collector_communication_def] if {
    not input.collector_client_ca_configured
}

missing_mutual_tls_for_agent_to_collector_communication[_missing_mutual_tls_for_agent_to_collector_communication_def] if {
    input.tls_mode in ["server_tls_only", "disabled"]
}

exposures contains _missing_mutual_tls_for_agent_to_collector_communication_def if {
    count(missing_mutual_tls_for_agent_to_collector_communication) > 0
}

_single_point_of_failure_in_alert_delivery_def := {
    "name": "Single Point Of Failure In Alert Delivery",
    "description": "Alert delivery depends on a single notification channel or backend with no failover configured, meaning a disruption (deliberate or accidental) silently disables alerting without detection.",
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
            "relevance": "A single point of failure in alert delivery can be exploited to block all security indicators."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.011",
            "name": "Spoof Security Alerting",
            "relevance": "Single points of failure in alert delivery are targets for spoofing security alerting systems."
        }
    ],
    "attack_vector": "LOCAL"
}

single_point_of_failure_in_alert_delivery[_single_point_of_failure_in_alert_delivery_def] if {
    input.notification_channel_count <= 1
    not input.failover_channel_configured
}

single_point_of_failure_in_alert_delivery[_single_point_of_failure_in_alert_delivery_def] if {
    input.notification_channel_count <= 1
    not input.alert_delivery_health_check_enabled
}

exposures contains _single_point_of_failure_in_alert_delivery_def if {
    count(single_point_of_failure_in_alert_delivery) > 0
}

_weak_role_based_access_to_alert_management_console_def := {
    "name": "Weak Role Based Access To Alert Management Console",
    "description": "The alert management dashboard does not enforce least-privilege role separation, allowing low-privilege users to acknowledge, close, or modify alerts intended only for security operations personnel.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Weak RBAC can allow attackers to gain temporary elevated access to alert management consoles."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.011",
            "name": "Spoof Security Alerting",
            "relevance": "Weak access controls on alert consoles enable unauthorized users to spoof or manipulate security alerts."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_role_based_access_to_alert_management_console[_weak_role_based_access_to_alert_management_console_def] if {
    not input.alert_management_rbac_enabled
}

weak_role_based_access_to_alert_management_console[_weak_role_based_access_to_alert_management_console_def] if {
    input.alert_management_rbac_enabled == true
    input.minimum_role_required_for_alert_write in ["unauthenticated", "any_authenticated_user", "read_only_user"]
}

weak_role_based_access_to_alert_management_console[_weak_role_based_access_to_alert_management_console_def] if {
    count(input.exposed_alert_actions) > 0
}

exposures contains _weak_role_based_access_to_alert_management_console_def if {
    count(weak_role_based_access_to_alert_management_console) > 0
}

_log_rotation_and_retention_misconfiguration_def := {
    "name": "Log Rotation And Retention Misconfiguration",
    "description": "Monitoring agent logs are rotated too aggressively or retained for an insufficient period, causing evidence of anomalous behavior or configuration changes to be overwritten before investigation can occur.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "name": "Indicator Removal",
            "relevance": "Misconfigured log rotation and retention can result in loss of evidence, aiding indicator removal."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.002",
            "name": "Clear Linux or Mac System Logs",
            "relevance": "Log retention misconfigurations mirror the effect of log clearing, removing forensic evidence."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Misconfigured log rotation may effectively disable or truncate cloud logs, reducing visibility."
        }
    ],
    "attack_vector": "LOCAL"
}

log_rotation_and_retention_misconfiguration[_log_rotation_and_retention_misconfiguration_def] if {
    input.log_retention_days < 30
    not input.logs_shipped_to_external_sink
}

log_rotation_and_retention_misconfiguration[_log_rotation_and_retention_misconfiguration_def] if {
    input.log_rotation_kept_files <= 1
    not input.logs_shipped_to_external_sink
}

log_rotation_and_retention_misconfiguration[_log_rotation_and_retention_misconfiguration_def] if {
    input.log_rotation_max_size_mb < 5
    not input.logs_shipped_to_external_sink
}

exposures contains _log_rotation_and_retention_misconfiguration_def if {
    count(log_rotation_and_retention_misconfiguration) > 0
}

_unvalidated_external_input_to_alert_routing_rules_def := {
    "name": "Unvalidated External Input To Alert Routing Rules",
    "description": "Alert routing or notification rules accept external hostname or webhook URL values from configuration without format validation or allowlisting, enabling server-side request forgery via monitoring infrastructure if an attacker can write configuration.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1564.008",
            "name": "Email Hiding Rules",
            "relevance": "Unvalidated input to routing rules can be exploited to create hidden or malicious alert routing similar to email hiding rules."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.004",
            "name": "Exfiltration Over Webhook",
            "relevance": "Unvalidated routing rule input could redirect alerts to attacker-controlled webhooks for exfiltration."
        }
    ],
    "attack_vector": "LOCAL"
}

unvalidated_external_input_to_alert_routing_rules[_unvalidated_external_input_to_alert_routing_rules_def] if {
    not input.webhook_url_validation_enforced
    not input.webhook_url_allowlist_configured
}

unvalidated_external_input_to_alert_routing_rules[_unvalidated_external_input_to_alert_routing_rules_def] if {
    not input.webhook_url_validation_enforced
    not input.external_config_write_access_restricted
}

exposures contains _unvalidated_external_input_to_alert_routing_rules_def if {
    count(unvalidated_external_input_to_alert_routing_rules) > 0
}
