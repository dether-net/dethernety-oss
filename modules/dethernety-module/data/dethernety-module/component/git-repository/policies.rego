package _dt_built_in.exposures.git_repository

_anonymous_access_enabled_def := {
    "name": "Anonymous Access Enabled",
    "description": "The Git service is configured to allow unauthenticated users to browse, clone, or search repositories. If public visibility is enabled globally or per-repository without deliberate intent, any network-reachable user can exfiltrate source code, IaC definitions, and pipeline secrets without credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Anonymous access to code repositories allows unauthenticated users to read sensitive data from information repositories without credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Enabling anonymous access exposes repository data to collection by any unauthenticated actor."
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_access_enabled[_anonymous_access_enabled_def] if {
    input.anonymous_access_enabled == true
    input.network_exposure == "internet"
}

anonymous_access_enabled[_anonymous_access_enabled_def] if {
    input.anonymous_access_enabled == true
    input.network_exposure == "internal"
}

exposures contains _anonymous_access_enabled_def if {
    count(anonymous_access_enabled) > 0
}

_weak_or_missing_admin_authentication_def := {
    "name": "Weak Or Missing Admin Authentication",
    "description": "The administrative interface (web UI or API) permits login with default credentials, weak passwords, or without multi-factor authentication enforced. An attacker who compromises an admin account gains full control over repositories, webhooks, user accounts, and CI/CD integrations.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Weak or missing admin authentication allows adversaries to gain access using valid or easily guessed credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "name": "Default Accounts",
            "relevance": "Missing authentication often leaves default admin accounts exploitable by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Weak authentication mechanisms are susceptible to credential stuffing attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_missing_admin_authentication[_weak_or_missing_admin_authentication_def] if {
    not input.mfa_enforced_for_admins
}

weak_or_missing_admin_authentication[_weak_or_missing_admin_authentication_def] if {
    not input.default_credentials_changed
}

weak_or_missing_admin_authentication[_weak_or_missing_admin_authentication_def] if {
    input.admin_password_policy in ["none", "weak"]
}

exposures contains _weak_or_missing_admin_authentication_def if {
    count(weak_or_missing_admin_authentication) > 0
}

_ssh_host_key_exposure_or_weak_configuration_def := {
    "name": "Ssh Host Key Exposure Or Weak Configuration",
    "description": "SSH is configured with weak key exchange algorithms, deprecated ciphers, or password-based authentication enabled instead of public-key-only. Additionally, if host keys are not rotated after infrastructure migration or compromise, impersonation attacks become viable. Misconfigured SSH exposes the Git clone/push surface to interception or brute-force.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Exposure of SSH host keys allows adversaries to obtain private keys used for authentication and secure communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1563.001",
            "name": "SSH Hijacking",
            "relevance": "Weak SSH configuration or key exposure enables session hijacking of existing SSH connections."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.004",
            "name": "SSH",
            "relevance": "Weak SSH configuration enables attackers to leverage SSH for unauthorized remote access."
        }
    ],
    "attack_vector": "NETWORK"
}

ssh_host_key_exposure_or_weak_configuration[_ssh_host_key_exposure_or_weak_configuration_def] if {
    input.password_authentication_enabled == true
}

ssh_host_key_exposure_or_weak_configuration[_ssh_host_key_exposure_or_weak_configuration_def] if {
    input.weak_algorithms_present == true
}

ssh_host_key_exposure_or_weak_configuration[_ssh_host_key_exposure_or_weak_configuration_def] if {
    input.host_key_rotation_status in ["not_rotated", "unknown"]
}

exposures contains _ssh_host_key_exposure_or_weak_configuration_def if {
    count(ssh_host_key_exposure_or_weak_configuration) > 0
}

_tls_not_enforced_on_http_interface_def := {
    "name": "Tls Not Enforced On Http Interface",
    "description": "The web and Git-over-HTTP interface is accessible over plaintext HTTP, or TLS is configured with expired certificates, weak cipher suites, or protocol versions below TLS 1.2. Credentials, session tokens, and repository content transmitted over unencrypted connections are subject to interception.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unencrypted HTTP allows interception and exfiltration of data transmitted over plaintext protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Without TLS enforcement, attackers can tunnel malicious traffic through unencrypted HTTP connections."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_not_enforced_on_http_interface[_tls_not_enforced_on_http_interface_def] if {
    not input.https_enforced
}

tls_not_enforced_on_http_interface[_tls_not_enforced_on_http_interface_def] if {
    input.tls_min_version in ["none", "tls1.0", "tls1.1"]
}

tls_not_enforced_on_http_interface[_tls_not_enforced_on_http_interface_def] if {
    input.tls_certificate_expired == true
}

tls_not_enforced_on_http_interface[_tls_not_enforced_on_http_interface_def] if {
    input.weak_cipher_suites_enabled == true
}

exposures contains _tls_not_enforced_on_http_interface_def if {
    count(tls_not_enforced_on_http_interface) > 0
}

_overly_permissive_repository_visibility_defaults_def := {
    "name": "Overly Permissive Repository Visibility Defaults",
    "description": "The platform default for new repositories is set to 'public' or 'internal' rather than 'private'. Developers creating repositories without explicitly restricting access inadvertently expose code, configurations, and secrets to all authenticated users or the internet, depending on network placement.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Overly permissive visibility defaults expose code repository contents to unauthorized users who can collect sensitive data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.001",
            "name": "Exfiltration to Code Repository",
            "relevance": "Public repository visibility can facilitate unintended data exposure and exfiltration of sensitive source code."
        }
    ],
    "attack_vector": "NETWORK"
}

overly_permissive_repository_visibility_defaults[_overly_permissive_repository_visibility_defaults_def] if {
    input.default_repository_visibility == "public"
}

overly_permissive_repository_visibility_defaults[_overly_permissive_repository_visibility_defaults_def] if {
    input.default_repository_visibility == "internal"
    input.anonymous_access_enabled == true
}

exposures contains _overly_permissive_repository_visibility_defaults_def if {
    count(overly_permissive_repository_visibility_defaults) > 0
}

_unrestricted_api_token_issuance_def := {
    "name": "Unrestricted Api Token Issuance",
    "description": "Personal access tokens or deploy tokens can be created without expiration dates, without scope restrictions, and without administrator oversight. Long-lived, broadly scoped tokens that are leaked in code or logs provide persistent, credential-independent access to repositories and APIs.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Unrestricted API token issuance allows adversaries to use stolen or generated tokens to authenticate and access resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Unrestricted token issuance increases attack surface for stealing application access tokens to impersonate users or services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134",
            "name": "Access Token Manipulation",
            "relevance": "Without restrictions on API token issuance, adversaries can manipulate or forge tokens to escalate privileges."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_api_token_issuance[_unrestricted_api_token_issuance_def] if {
    input.token_expiry_enforcement == "not_enforced"
    input.tokens_without_expiry_exist == true
}

unrestricted_api_token_issuance[_unrestricted_api_token_issuance_def] if {
    input.token_expiry_enforcement == "not_enforced"
    not input.token_scope_restriction_enforced
}

unrestricted_api_token_issuance[_unrestricted_api_token_issuance_def] if {
    input.tokens_without_expiry_exist == true
    not input.token_scope_restriction_enforced
    not input.token_audit_logging_enabled
}

exposures contains _unrestricted_api_token_issuance_def if {
    count(unrestricted_api_token_issuance) > 0
}

_unprotected_default_branch_configuration_def := {
    "name": "Unprotected Default Branch Configuration",
    "description": "Default branches (main, master) lack push protection rules, required code review approvals, or signed-commit enforcement. An attacker or malicious insider with write access can directly push code to production branches, injecting malicious changes without review \u2014 a direct software supply chain attack vector.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Unprotected default branches allow adversaries to inject malicious code that executes in CI/CD pipelines."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Unprotected branches enable supply chain compromise by allowing unauthorized modifications to source code and dependencies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
            "name": "Supply Chain Compromise",
            "relevance": "Lack of branch protection allows attackers to tamper with code, compromising the software supply chain."
        }
    ],
    "attack_vector": "NETWORK"
}

unprotected_default_branch_configuration[_unprotected_default_branch_configuration_def] if {
    not input.branch_protection_rule_exists
}

unprotected_default_branch_configuration[_unprotected_default_branch_configuration_def] if {
    input.branch_protection_rule_exists == true
    not input.push_restrictions_enabled
}

unprotected_default_branch_configuration[_unprotected_default_branch_configuration_def] if {
    input.branch_protection_rule_exists == true
    input.required_review_count < 1
}

exposures contains _unprotected_default_branch_configuration_def if {
    count(unprotected_default_branch_configuration) > 0
}

_webhook_ssrf_via_unrestricted_targets_def := {
    "name": "Webhook Ssrf Via Unrestricted Targets",
    "description": "The platform allows users to configure webhooks pointing to arbitrary internal URLs without an allowlist or network-level restriction. An attacker with repository access can create webhooks that cause the Git server to make HTTP requests to internal services, enabling server-side request forgery against the internal network.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.004",
            "name": "Exfiltration Over Webhook",
            "relevance": "Unrestricted webhook targets can be abused to exfiltrate data to attacker-controlled endpoints via SSRF."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Webhook SSRF via unrestricted targets can be used to trigger internal services and manipulate pipeline execution."
        }
    ],
    "attack_vector": "NETWORK"
}

webhook_ssrf_via_unrestricted_targets[_webhook_ssrf_via_unrestricted_targets_def] if {
    not input.webhook_url_allowlist_enforced
    not input.internal_network_requests_blocked
}

webhook_ssrf_via_unrestricted_targets[_webhook_ssrf_via_unrestricted_targets_def] if {
    not input.webhook_url_allowlist_enforced
    input.webhook_creation_permission_scope == "any_member"
}

webhook_ssrf_via_unrestricted_targets[_webhook_ssrf_via_unrestricted_targets_def] if {
    not input.internal_network_requests_blocked
    input.webhook_creation_permission_scope == "any_member"
}

exposures contains _webhook_ssrf_via_unrestricted_targets_def if {
    count(webhook_ssrf_via_unrestricted_targets) > 0
}

_git_service_process_running_as_root_or_privileged_user_def := {
    "name": "Git Service Process Running As Root Or Privileged User",
    "description": "The Git service daemon or container runs as root or a privileged OS user rather than a dedicated low-privilege service account. If the application is compromised, the attacker immediately obtains elevated host-level privileges, enabling escape from the service context and lateral movement.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "A git service running as root or privileged user facilitates container or sandbox escape to the underlying host."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1609",
            "name": "Container Administration Command",
            "relevance": "Privileged process execution enables attackers to run administrative commands within the container environment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543.005",
            "name": "Container Service",
            "relevance": "Running as root allows adversaries to create or modify container services for persistence and privilege escalation."
        }
    ],
    "attack_vector": "LOCAL"
}

git_service_process_running_as_root_or_privileged_user[_git_service_process_running_as_root_or_privileged_user_def] if {
    input.service_process_user == "root"
}

git_service_process_running_as_root_or_privileged_user[_git_service_process_running_as_root_or_privileged_user_def] if {
    input.container_privileged_mode_enabled == true
}

git_service_process_running_as_root_or_privileged_user[_git_service_process_running_as_root_or_privileged_user_def] if {
    not input.run_as_non_root_enforced
}

exposures contains _git_service_process_running_as_root_or_privileged_user_def if {
    count(git_service_process_running_as_root_or_privileged_user) > 0
}

_unencrypted_or_publicly_accessible_backup_storage_def := {
    "name": "Unencrypted Or Publicly Accessible Backup Storage",
    "description": "Repository backup archives are stored in plaintext on network shares, object storage buckets with public ACLs, or backup directories without access controls. Backups contain the complete repository history including any secrets or sensitive data ever committed, making them equivalent in value to live access.",
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
            "relevance": "Publicly accessible or unencrypted backup storage allows adversaries to directly access and exfiltrate stored backup data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Unencrypted backups expose repository data that can be collected by unauthorized actors."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_or_publicly_accessible_backup_storage[_unencrypted_or_publicly_accessible_backup_storage_def] if {
    not input.backup_encryption_enabled
}

unencrypted_or_publicly_accessible_backup_storage[_unencrypted_or_publicly_accessible_backup_storage_def] if {
    input.backup_storage_access_policy == "public"
}

unencrypted_or_publicly_accessible_backup_storage[_unencrypted_or_publicly_accessible_backup_storage_def] if {
    input.backup_storage_access_policy == "overly_permissive"
    not input.backup_encryption_enabled
}

exposures contains _unencrypted_or_publicly_accessible_backup_storage_def if {
    count(unencrypted_or_publicly_accessible_backup_storage) > 0
}

_audit_logging_disabled_or_incomplete_def := {
    "name": "Audit Logging Disabled Or Incomplete",
    "description": "The platform is configured without comprehensive audit logging of authentication events, repository access, permission changes, webhook creation, and administrative actions. Absence of audit logs prevents detection of unauthorized access, insider exfiltration, or supply chain tampering during incident investigation.",
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
            "relevance": "Disabled or incomplete audit logging mirrors the impact of adversaries disabling logs to avoid detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.002",
            "name": "Disable Windows Event Logging",
            "relevance": "Incomplete audit logging reduces visibility into attacker activity, analogous to disabling event logging."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Without complete audit logs, adversaries can enumerate and exploit gaps in logging coverage to evade detection."
        }
    ]
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    not input.audit_log_enabled
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_log_enabled == true
    not "authentication" in input.audit_log_categories_covered
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_log_enabled == true
    input.audit_log_retention_days <= 0
}

exposures contains _audit_logging_disabled_or_incomplete_def if {
    count(audit_logging_disabled_or_incomplete) > 0
}

_outdated_platform_version_without_patch_management_def := {
    "name": "Outdated Platform Version Without Patch Management",
    "description": "The self-hosted Git service is running a version with known unpatched CVEs due to absence of a patch management process or update policy. Git platform vulnerabilities have historically allowed unauthenticated RCE, authentication bypass, and privilege escalation, making version currency a critical host configuration requirement.",
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
            "relevance": "Outdated platform versions contain known vulnerabilities that adversaries exploit in public-facing applications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unpatched software exposes known vulnerabilities in remote services that attackers can exploit for access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Lack of patch management leaves vulnerable dependencies in place, enabling supply chain compromise."
        }
    ],
    "attack_vector": "NETWORK"
}

outdated_platform_version_without_patch_management[_outdated_platform_version_without_patch_management_def] if {
    input.version_has_known_cve == true
}

outdated_platform_version_without_patch_management[_outdated_platform_version_without_patch_management_def] if {
    not input.patch_management_policy_exists
    input.days_since_last_version_update >= 90
}

exposures contains _outdated_platform_version_without_patch_management_def if {
    count(outdated_platform_version_without_patch_management) > 0
}

_network_exposure_to_untrusted_segments_def := {
    "name": "Network Exposure To Untrusted Segments",
    "description": "The Git service's web interface, SSH port, and API are bound to interfaces reachable from untrusted network segments (public internet, guest networks) without a network-layer control such as a firewall rule, VPN requirement, or reverse proxy with IP allowlisting. This maximizes the attack surface available to external threat actors.",
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
            "relevance": "Exposing services to untrusted network segments increases risk of exploitation of public-facing application vulnerabilities."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "name": "External Remote Services",
            "relevance": "Network exposure to untrusted segments allows adversaries to access external remote services without proper network controls."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Untrusted network access enables adversaries to leverage remote services for lateral movement or initial access."
        }
    ],
    "attack_vector": "NETWORK"
}

network_exposure_to_untrusted_segments[_network_exposure_to_untrusted_segments_def] if {
    input.network_binding_scope == "public"
    not input.network_layer_control_present
}

network_exposure_to_untrusted_segments[_network_exposure_to_untrusted_segments_def] if {
    input.publicly_resolvable_hostname == true
    not input.network_layer_control_present
}

exposures contains _network_exposure_to_untrusted_segments_def if {
    count(network_exposure_to_untrusted_segments) > 0
}

_secrets_stored_in_repository_configuration_or_history_def := {
    "name": "Secrets Stored In Repository Configuration Or History",
    "description": "The platform's own configuration files (database credentials, SMTP passwords, LDAP bind passwords, object storage keys) are stored in the repository or on-disk without encryption at rest, or historical commits containing secrets are not purged. A read-only repository compromise can yield infrastructure-level credentials.",
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
            "relevance": "Secrets stored in repository configuration or history represent credentials stored in files that adversaries can discover."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Storing secrets in repository configuration or commit history constitutes unsecured credential storage accessible to attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Adversaries search code repositories specifically to find secrets and credentials stored in configuration files or git history."
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_stored_in_repository_configuration_or_history[_secrets_stored_in_repository_configuration_or_history_def] if {
    not input.config_secrets_encrypted_at_rest
}

secrets_stored_in_repository_configuration_or_history[_secrets_stored_in_repository_configuration_or_history_def] if {
    input.secrets_detected_in_repository_commits == true
    not input.secret_scanning_enabled
}

exposures contains _secrets_stored_in_repository_configuration_or_history_def if {
    count(secrets_stored_in_repository_configuration_or_history) > 0
}
