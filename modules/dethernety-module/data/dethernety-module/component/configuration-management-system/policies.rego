package _dt_built_in.exposures.configuration_management_system

_unencrypted_secrets_in_configuration_files_def := {
    "name": "Unencrypted Secrets In Configuration Files",
    "description": "Plaintext passwords, API keys, or certificates embedded directly in configuration manifests, playbooks, or state files on disk, allowing any user or process with file read access to harvest credentials.",
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
            "relevance": "Directly describes adversaries finding credentials stored in plaintext within configuration files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Parent technique covering the broader risk of secrets stored without encryption in accessible locations."
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_secrets_in_configuration_files[_unencrypted_secrets_in_configuration_files_def] if {
    input.plaintext_secrets_detected == true
    not input.secrets_vault_or_encryption_in_use
}

exposures contains _unencrypted_secrets_in_configuration_files_def if {
    count(unencrypted_secrets_in_configuration_files) > 0
}

_unauthenticated_configuration_agent_api_def := {
    "name": "Unauthenticated Configuration Agent Api",
    "description": "The local or remote management API exposed by the configuration agent accepts commands without requiring authentication, enabling arbitrary state changes or command execution by any reachable client.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Unauthenticated access to a configuration agent API can allow adversaries to abuse deployment tools to execute commands across managed systems."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1651",
            "name": "Cloud Administration Command",
            "relevance": "Attackers can leverage unauthenticated agent APIs to issue administrative commands similar to cloud administration command abuse."
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_configuration_agent_api[_unauthenticated_configuration_agent_api_def] if {
    not input.api_authentication_enabled
    input.api_network_exposure in ["internal", "all_interfaces"]
}

unauthenticated_configuration_agent_api[_unauthenticated_configuration_agent_api_def] if {
    not input.api_authentication_enabled
    not input.tls_enforced
}

exposures contains _unauthenticated_configuration_agent_api_def if {
    count(unauthenticated_configuration_agent_api) > 0
}

_overprivileged_deployment_service_account_def := {
    "name": "Overprivileged Deployment Service Account",
    "description": "The account or service principal used by the configuration agent runs with root, SYSTEM, or excessively broad OS privileges beyond what is required to apply configurations, amplifying the blast radius of any compromise.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Overprivileged service accounts represent valid accounts that adversaries can compromise and abuse for broad access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Overprivileged deployment accounts tied to software deployment tools amplify the blast radius if those tools are compromised."
        }
    ],
    "attack_vector": "LOCAL"
}

overprivileged_deployment_service_account[_overprivileged_deployment_service_account_def] if {
    input.agent_runtime_user in ["root", "SYSTEM", "Administrator", "LocalSystem"]
}

overprivileged_deployment_service_account[_overprivileged_deployment_service_account_def] if {
    not input.agent_runtime_user in ["root", "SYSTEM", "Administrator", "LocalSystem"]
    input.agent_sudoers_unrestricted == true
}

overprivileged_deployment_service_account[_overprivileged_deployment_service_account_def] if {
    not input.least_privilege_policy_applied
}

exposures contains _overprivileged_deployment_service_account_def if {
    count(overprivileged_deployment_service_account) > 0
}

_unsigned_or_unverified_configuration_content_def := {
    "name": "Unsigned Or Unverified Configuration Content",
    "description": "Configuration manifests, modules, or packages are applied without cryptographic signature verification, allowing a tampered or malicious configuration to be silently applied if the distribution channel is compromised.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.006",
            "name": "Code Signing Policy Modification",
            "relevance": "Lack of signature verification on configuration content mirrors the risk exploited when code signing policies are bypassed or absent."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Unsigned configuration content delivered through deployment tools can allow adversaries to inject malicious configurations at scale."
        }
    ],
    "attack_vector": "NETWORK"
}

unsigned_or_unverified_configuration_content[_unsigned_or_unverified_configuration_content_def] if {
    not input.signature_verification_enabled
}

unsigned_or_unverified_configuration_content[_unsigned_or_unverified_configuration_content_def] if {
    input.signature_verification_enabled == true
    not input.trusted_key_store_configured
}

unsigned_or_unverified_configuration_content[_unsigned_or_unverified_configuration_content_def] if {
    input.unsigned_content_action in ["allow", "warn"]
    not input.signature_verification_enabled
}

exposures contains _unsigned_or_unverified_configuration_content_def if {
    count(unsigned_or_unverified_configuration_content) > 0
}

_unencrypted_transport_to_configuration_server_def := {
    "name": "Unencrypted Transport To Configuration Server",
    "description": "Communication between the host agent and its central configuration server occurs over plaintext protocols, exposing configuration payloads and credentials to interception and enabling injection of malicious directives.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Unencrypted transport exposes configuration data to interception, analogous to data exfiltration over unencrypted protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1095",
            "name": "Non-Application Layer Protocol",
            "relevance": "Use of unencrypted or non-standard protocols for configuration server communication enables traffic interception and manipulation."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_transport_to_configuration_server[_unencrypted_transport_to_configuration_server_def] if {
    input.transport_protocol == "http"
}

unencrypted_transport_to_configuration_server[_unencrypted_transport_to_configuration_server_def] if {
    input.transport_protocol == "plaintext_tcp"
}

unencrypted_transport_to_configuration_server[_unencrypted_transport_to_configuration_server_def] if {
    not input.tls_enabled
}

unencrypted_transport_to_configuration_server[_unencrypted_transport_to_configuration_server_def] if {
    input.tls_enabled == true
    not input.certificate_verification_enabled
}

exposures contains _unencrypted_transport_to_configuration_server_def if {
    count(unencrypted_transport_to_configuration_server) > 0
}

_configuration_drift_not_detected_or_remediated_def := {
    "name": "Configuration Drift Not Detected Or Remediated",
    "description": "The system lacks scheduled enforcement or drift detection, allowing manual or unauthorized changes to host state to persist indefinitely without alerting operators, undermining the security baseline.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "name": "Disable or Modify Tools",
            "relevance": "Configuration drift can result from adversaries disabling or modifying security and configuration management tools without detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601.001",
            "name": "Patch System Image",
            "relevance": "Undetected configuration drift may mask unauthorized modifications to system images or configurations by adversaries."
        }
    ],
    "attack_vector": "LOCAL"
}

configuration_drift_not_detected_or_remediated[_configuration_drift_not_detected_or_remediated_def] if {
    not input.drift_detection_enabled
}

configuration_drift_not_detected_or_remediated[_configuration_drift_not_detected_or_remediated_def] if {
    input.drift_detection_enabled == true
    input.drift_remediation_mode == "none"
    not input.drift_alerting_configured
}

configuration_drift_not_detected_or_remediated[_configuration_drift_not_detected_or_remediated_def] if {
    input.drift_detection_enabled == true
    input.max_drift_check_interval_hours > 24
}

configuration_drift_not_detected_or_remediated[_configuration_drift_not_detected_or_remediated_def] if {
    input.drift_detection_enabled == true
    input.drift_remediation_mode == "alert_only"
    not input.drift_alerting_configured
}

exposures contains _configuration_drift_not_detected_or_remediated_def if {
    count(configuration_drift_not_detected_or_remediated) > 0
}

_world_readable_configuration_state_files_def := {
    "name": "World Readable Configuration State Files",
    "description": "State files, cached facts, or compiled catalogs stored on the host have overly permissive filesystem permissions, exposing system topology, sensitive variable values, or credentials to low-privileged local users.",
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
            "relevance": "World-readable configuration state files containing credentials are directly exploited by adversaries seeking credentials in files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1083",
            "name": "File and Directory Discovery",
            "relevance": "Adversaries use file and directory discovery to locate world-readable configuration state files containing sensitive information."
        }
    ],
    "attack_vector": "LOCAL"
}

world_readable_configuration_state_files[_world_readable_configuration_state_files_def] if {
    input.state_file_world_readable == true
    input.sensitive_data_in_state_files == "credentials"
}

world_readable_configuration_state_files[_world_readable_configuration_state_files_def] if {
    input.state_file_world_readable == true
    input.sensitive_data_in_state_files == "topology"
    input.state_file_owner_is_root == true
}

exposures contains _world_readable_configuration_state_files_def if {
    count(world_readable_configuration_state_files) > 0
}

_insufficient_configuration_change_logging_def := {
    "name": "Insufficient Configuration Change Logging",
    "description": "Applied changes, agent runs, and configuration errors are not logged or are logged with insufficient detail, preventing detection of unauthorized modifications and complicating incident response.",
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
            "relevance": "Insufficient logging of configuration changes mirrors the technique of disabling or modifying logs to evade detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "name": "Indicator Removal",
            "relevance": "Without adequate logging, adversaries can make configuration changes and remove indicators of compromise without detection."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_configuration_change_logging[_insufficient_configuration_change_logging_def] if {
    not input.audit_logging_enabled
}

insufficient_configuration_change_logging[_insufficient_configuration_change_logging_def] if {
    input.audit_logging_enabled == true
    not "config_change" in input.logged_event_types
}

insufficient_configuration_change_logging[_insufficient_configuration_change_logging_def] if {
    input.audit_logging_enabled == true
    input.log_retention_days < 30
}

insufficient_configuration_change_logging[_insufficient_configuration_change_logging_def] if {
    input.audit_logging_enabled == true
    input.log_detail_level in ["none", "minimal"]
}

exposures contains _insufficient_configuration_change_logging_def if {
    count(insufficient_configuration_change_logging) > 0
}

_unpatched_configuration_management_agent_def := {
    "name": "Unpatched Configuration Management Agent",
    "description": "The agent binary or its dependencies are not kept current, leaving known exploitable vulnerabilities in a process that typically runs with elevated privileges and broad network access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched configuration management agents expose known vulnerabilities that adversaries can exploit as remote services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Configuration management agents exposed to the network represent public-facing applications exploitable via unpatched vulnerabilities."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_configuration_management_agent[_unpatched_configuration_management_agent_def] if {
    input.agent_version_has_known_cve == true
}

unpatched_configuration_management_agent[_unpatched_configuration_management_agent_def] if {
    input.days_since_last_agent_update > 90
    not input.automatic_agent_updates_enabled
}

exposures contains _unpatched_configuration_management_agent_def if {
    count(unpatched_configuration_management_agent) > 0
}

_untrusted_external_module_or_plugin_sources_def := {
    "name": "Untrusted External Module Or Plugin Sources",
    "description": "The configuration system pulls modules, roles, or plugins from public repositories or unverified URLs without pinning versions or verifying integrity, enabling dependency confusion or module hijacking attacks.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Loading modules or plugins from untrusted sources directly maps to supply chain compromise of software dependencies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Untrusted external modules introduced via deployment tools can propagate malicious code across all managed systems."
        }
    ],
    "attack_vector": "NETWORK"
}

untrusted_external_module_or_plugin_sources[_untrusted_external_module_or_plugin_sources_def] if {
    input.source_urls_use_unverified_external_repos == true
    input.integrity_verification_method == "none"
}

untrusted_external_module_or_plugin_sources[_untrusted_external_module_or_plugin_sources_def] if {
    input.source_urls_use_unverified_external_repos == true
    not input.version_pinning_enforced
}

exposures contains _untrusted_external_module_or_plugin_sources_def if {
    count(untrusted_external_module_or_plugin_sources) > 0
}

_excessive_network_exposure_of_agent_listener_def := {
    "name": "Excessive Network Exposure Of Agent Listener",
    "description": "The configuration agent binds its management or reporting port to all network interfaces rather than localhost or a dedicated management network, unnecessarily expanding the attack surface.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1571",
            "name": "Non-Standard Port",
            "relevance": "Configuration agents listening on exposed ports can be targeted by adversaries probing non-standard ports for attack surfaces."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "Excessive network exposure of agent listeners can allow adversaries to bridge network boundaries and access otherwise isolated systems."
        }
    ],
    "attack_vector": "NETWORK"
}

excessive_network_exposure_of_agent_listener[_excessive_network_exposure_of_agent_listener_def] if {
    input.listener_bind_address in ["0.0.0.0", "::", "*", "0:0:0:0:0:0:0:0"]
    not input.firewall_restricts_management_port
}

excessive_network_exposure_of_agent_listener[_excessive_network_exposure_of_agent_listener_def] if {
    input.listener_bind_address in ["0.0.0.0", "::", "*", "0:0:0:0:0:0:0:0"]
    not input.firewall_restricts_management_port
}

exposures contains _excessive_network_exposure_of_agent_listener_def if {
    count(excessive_network_exposure_of_agent_listener) > 0
}

_weak_host_identity_verification_by_server_def := {
    "name": "Weak Host Identity Verification By Server",
    "description": "The configuration server does not strictly validate host certificates or tokens before issuing configuration, enabling a rogue or cloned host to receive configurations intended for a legitimate system or inject false inventory data.",
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
            "relevance": "Weak host identity verification enables adversaries to forge or steal certificates to impersonate legitimate hosts to the configuration server."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.003",
            "name": "Install Digital Certificate",
            "relevance": "Adversaries can install fraudulent digital certificates to pass weak host identity checks by the configuration server."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_host_identity_verification_by_server[_weak_host_identity_verification_by_server_def] if {
    not input.host_certificate_validation_enforced
}

weak_host_identity_verification_by_server[_weak_host_identity_verification_by_server_def] if {
    input.host_token_validation_mode in ["partial", "none"]
}

weak_host_identity_verification_by_server[_weak_host_identity_verification_by_server_def] if {
    input.auto_sign_enabled == true
}

exposures contains _weak_host_identity_verification_by_server_def if {
    count(weak_host_identity_verification_by_server) > 0
}

_no_rollback_capability_for_failed_deployments_def := {
    "name": "No Rollback Capability For Failed Deployments",
    "description": "The deployment system lacks an automated rollback mechanism, meaning a misconfigured or malicious configuration that breaks service or security controls cannot be rapidly reversed, prolonging exposure windows.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Absence of rollback capability means malicious or broken configurations pushed via deployment tools cannot be quickly reversed."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.004",
            "name": "Application or System Exploitation",
            "relevance": "Without rollback, failed or malicious deployments can leave systems in a degraded or exploitable state indefinitely."
        }
    ],
    "attack_vector": "LOCAL"
}

no_rollback_capability_for_failed_deployments[_no_rollback_capability_for_failed_deployments_def] if {
    not input.rollback_mechanism_configured
}

no_rollback_capability_for_failed_deployments[_no_rollback_capability_for_failed_deployments_def] if {
    input.rollback_mechanism_configured == true
    input.deployment_history_versions_retained == 0
}

no_rollback_capability_for_failed_deployments[_no_rollback_capability_for_failed_deployments_def] if {
    input.rollback_trigger_type == "none"
}

exposures contains _no_rollback_capability_for_failed_deployments_def if {
    count(no_rollback_capability_for_failed_deployments) > 0
}

_environment_variable_leakage_in_deployment_context_def := {
    "name": "Environment Variable Leakage In Deployment Context",
    "description": "Sensitive environment variables injected during deployment runs are visible in process listings, logged to deployment output, or persisted in shell history on the host, leaking credentials to local users.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.003",
            "name": "Shell History",
            "relevance": "Environment variables containing secrets in deployment contexts can leak through shell history, exposing credentials to adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Environment variable leakage in deployment contexts is a form of unsecured credentials accessible to adversaries with system access."
        }
    ],
    "attack_vector": "LOCAL"
}

environment_variable_leakage_in_deployment_context[_environment_variable_leakage_in_deployment_context_def] if {
    input.env_vars_passed_as_plaintext_args == true
    not input.secrets_manager_integration_used
}

environment_variable_leakage_in_deployment_context[_environment_variable_leakage_in_deployment_context_def] if {
    input.deployment_output_logging_level == "verbose_with_secrets"
    not input.secrets_manager_integration_used
}

environment_variable_leakage_in_deployment_context[_environment_variable_leakage_in_deployment_context_def] if {
    input.env_vars_passed_as_plaintext_args == true
    not input.shell_history_persistence_disabled
}

exposures contains _environment_variable_leakage_in_deployment_context_def if {
    count(environment_variable_leakage_in_deployment_context) > 0
}

_missing_idempotency_enforcement_allowing_partial_state_def := {
    "name": "Missing Idempotency Enforcement Allowing Partial State",
    "description": "Configuration runs are not enforced to be idempotent, allowing repeated or interrupted runs to leave the host in a partially configured state that bypasses security controls such as firewall rules or file permissions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1578.005",
            "name": "Modify Cloud Compute Configurations",
            "relevance": "Lack of idempotency can result in partial or inconsistent configuration states that adversaries can exploit by manipulating cloud compute configurations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1546",
            "name": "Event Triggered Execution",
            "relevance": "Partial configuration states from non-idempotent deployments may create unintended event triggers that adversaries can abuse for persistent execution."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_idempotency_enforcement_allowing_partial_state[_missing_idempotency_enforcement_allowing_partial_state_def] if {
    not input.idempotency_enforcement_enabled
    count(input.security_critical_resources_managed) > 0
}

missing_idempotency_enforcement_allowing_partial_state[_missing_idempotency_enforcement_allowing_partial_state_def] if {
    not input.idempotency_enforcement_enabled
    not input.partial_run_detection_enabled
}

exposures contains _missing_idempotency_enforcement_allowing_partial_state_def if {
    count(missing_idempotency_enforcement_allowing_partial_state) > 0
}
