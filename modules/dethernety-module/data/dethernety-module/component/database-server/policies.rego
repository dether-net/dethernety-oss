package _dt_built_in.exposures.database_server



_default_or_weak_database_credentials_def := {
    "name": "Default Or Weak Database Credentials",
    "description": "Database engine deployed with default usernames and passwords, or with accounts configured with trivially guessable credentials. An attacker who reaches the database port can authenticate immediately without any credential brute-force effort.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Default or weak credentials are directly exploitable via password guessing attacks against database authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.002",
            "name": "Password Cracking",
            "relevance": "Weak database credentials are susceptible to offline password cracking techniques."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Default credentials are commonly included in credential stuffing lists used to gain unauthorized database access."
        }
    ],
    "attack_vector": "NETWORK"
}

default_or_weak_database_credentials[_default_or_weak_database_credentials_def] if {
    input.default_credentials_present == true
}

default_or_weak_database_credentials[_default_or_weak_database_credentials_def] if {
    count(input.weak_credential_accounts) > 0
}

default_or_weak_database_credentials[_default_or_weak_database_credentials_def] if {
    not input.password_policy_enforced
}

exposures contains _default_or_weak_database_credentials_def if {
    count(default_or_weak_database_credentials) > 0
}

_unencrypted_client_connections_def := {
    "name": "Unencrypted Client Connections",
    "description": "Database listener configured to accept plaintext connections (e.g., SSL/TLS disabled or not enforced for client sessions). Credentials and sensitive query results traverse the network in cleartext, exposable via passive interception on shared or cloud network segments.",
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
            "relevance": "Unencrypted database connections can be intercepted via network sniffing, exposing credentials and sensitive data in transit."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_client_connections[_unencrypted_client_connections_def] if {
    not input.tls_enabled
}

unencrypted_client_connections[_unencrypted_client_connections_def] if {
    input.tls_enforcement_mode in ["disabled", "optional"]
}

unencrypted_client_connections[_unencrypted_client_connections_def] if {
    input.plaintext_port_open == true
}

exposures contains _unencrypted_client_connections_def if {
    count(unencrypted_client_connections) > 0
}

_unencrypted_data_at_rest_def := {
    "name": "Unencrypted Data At Rest",
    "description": "Database files, tablespaces, or backup archives stored without encryption on disk. An attacker or insider with filesystem or storage-layer access can read raw data pages containing PII and financial records without ever authenticating to the database engine.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.006",
            "name": "Databases",
            "relevance": "Unencrypted data at rest in databases can be directly accessed and exfiltrated if storage is compromised."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "name": "Stored Data Manipulation",
            "relevance": "Unencrypted stored data is vulnerable to manipulation by adversaries who gain access to storage."
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.encryption_at_rest_enabled
    input.storage_volume_encryption_type == "none"
}

unencrypted_data_at_rest[_unencrypted_data_at_rest_def] if {
    not input.backup_encryption_enabled
    input.storage_volume_encryption_type == "none"
}

exposures contains _unencrypted_data_at_rest_def if {
    count(unencrypted_data_at_rest) > 0
}

_database_network_port_publicly_exposed_def := {
    "name": "Database Network Port Publicly Exposed",
    "description": "Database service port (e.g., 3306, 5432, 1433, 27017) bound to a public-facing or insufficiently restricted network interface with no host-based firewall or security group restricting source addresses. Exposes authentication and query surface directly to the internet.",
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
            "relevance": "Publicly exposed database ports can be discovered by adversaries performing network service scanning."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596",
            "name": "Search Open Technical Databases",
            "relevance": "Exposed database ports may be indexed by internet scanning services, enabling adversaries to discover them passively."
        }
    ],
    "attack_vector": "NETWORK"
}

database_network_port_publicly_exposed[_database_network_port_publicly_exposed_def] if {
    input.network_interface_binding == "public"
    not input.inbound_source_restriction_configured
}

database_network_port_publicly_exposed[_database_network_port_publicly_exposed_def] if {
    input.network_interface_binding == "public"
    not input.inbound_source_restriction_configured
}

exposures contains _database_network_port_publicly_exposed_def if {
    count(database_network_port_publicly_exposed) > 0
}

_overprivileged_database_accounts_def := {
    "name": "Overprivileged Database Accounts",
    "description": "Application service accounts or user accounts granted excessive database privileges (e.g., DBA role, SUPERUSER, or broad GRANT ALL) beyond what the application requires. A compromised application credential can be used to exfiltrate all data, drop tables, or modify configurations.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Overprivileged database accounts, once compromised, allow adversaries to abuse valid credentials with excessive permissions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "name": "Account Manipulation",
            "relevance": "Adversaries may manipulate overprivileged database accounts to maintain persistence or escalate privileges."
        }
    ],
    "attack_vector": "NETWORK"
}

overprivileged_database_accounts[_overprivileged_database_accounts_def] if {
    input.has_superuser_or_dba_role == true
}

overprivileged_database_accounts[_overprivileged_database_accounts_def] if {
    "DROP" in input.granted_privileges
    not input.least_privilege_review_performed
}

overprivileged_database_accounts[_overprivileged_database_accounts_def] if {
    "GRANT ALL" in input.granted_privileges
}

overprivileged_database_accounts[_overprivileged_database_accounts_def] if {
    input.privilege_scope in ["global", "database"]
    not input.least_privilege_review_performed
}

exposures contains _overprivileged_database_accounts_def if {
    count(overprivileged_database_accounts) > 0
}

_audit_logging_disabled_or_incomplete_def := {
    "name": "Audit Logging Disabled Or Incomplete",
    "description": "Database audit logging not enabled or configured to omit critical event categories such as authentication attempts, privilege escalations, DDL changes, and access to sensitive tables. Prevents forensic investigation and violates compliance requirements (PCI-DSS, GDPR).",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Disabling or failing to configure audit logging mirrors this technique of suppressing log collection to avoid detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.012",
            "name": "Disable or Modify Linux Audit System",
            "relevance": "Incomplete or disabled database audit logging is analogous to disabling the Linux audit system, hindering forensic investigation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.002",
            "name": "Disable Windows Event Logging",
            "relevance": "Disabled database audit logging reduces visibility into malicious activity, similar to disabling event logging."
        }
    ],
    "attack_vector": "LOCAL"
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    not input.audit_logging_enabled
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_logging_enabled == true
    not "authentication" in input.audited_event_categories
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_logging_enabled == true
    not "privilege_escalation" in input.audited_event_categories
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_logging_enabled == true
    not "ddl" in input.audited_event_categories
}

audit_logging_disabled_or_incomplete[_audit_logging_disabled_or_incomplete_def] if {
    input.audit_logging_enabled == true
    not "sensitive_table_access" in input.audited_event_categories
}

exposures contains _audit_logging_disabled_or_incomplete_def if {
    count(audit_logging_disabled_or_incomplete) > 0
}

_unpatched_database_engine_def := {
    "name": "Unpatched Database Engine",
    "description": "Database software running a version with known CVEs affecting the engine itself (authentication bypass, privilege escalation, remote code execution). Failure to apply vendor security patches leaves exploitable vulnerabilities present in the running service.",
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
            "relevance": "Unpatched database engines are vulnerable to known exploits targeting public-facing database services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Known vulnerabilities in unpatched database engines can be exploited remotely to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Unpatched database engine vulnerabilities may be leveraged for privilege escalation on the host system."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_database_engine[_unpatched_database_engine_def] if {
    input.version_has_known_cve == true
    input.network_accessible == true
}

unpatched_database_engine[_unpatched_database_engine_def] if {
    input.version_has_known_cve == true
    input.days_since_patch_available >= 30
}

exposures contains _unpatched_database_engine_def if {
    count(unpatched_database_engine) > 0
}

_anonymous_or_unauthenticated_access_enabled_def := {
    "name": "Anonymous Or Unauthenticated Access Enabled",
    "description": "Database configured to allow connections without credentials (e.g., MySQL anonymous user account active, MongoDB auth disabled, Redis running without requirepass). Any host that can reach the port obtains immediate data access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.006",
            "name": "Databases",
            "relevance": "Anonymous access to databases allows adversaries to directly query and extract data without any authentication barrier."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Unauthenticated access enables adversaries to collect data from information repositories without needing credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_or_unauthenticated_access_enabled[_anonymous_or_unauthenticated_access_enabled_def] if {
    not input.authentication_required
}

anonymous_or_unauthenticated_access_enabled[_anonymous_or_unauthenticated_access_enabled_def] if {
    input.anonymous_user_accounts_present == true
}

exposures contains _anonymous_or_unauthenticated_access_enabled_def if {
    count(anonymous_or_unauthenticated_access_enabled) > 0
}

_backup_files_stored_without_access_controls_def := {
    "name": "Backup Files Stored Without Access Controls",
    "description": "Database backup dumps or snapshots written to filesystem paths, object storage buckets, or network shares without restrictive access controls or encryption. Backup files contain full copies of PII and financial data accessible outside the database engine's authentication layer.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Backup files without access controls in cloud storage can be accessed by adversaries to exfiltrate sensitive data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Database backup files may contain credentials that adversaries can harvest if stored without proper access controls."
        }
    ],
    "attack_vector": "LOCAL"
}

backup_files_stored_without_access_controls[_backup_files_stored_without_access_controls_def] if {
    input.backup_storage_permissions == "world_readable"
}

backup_files_stored_without_access_controls[_backup_files_stored_without_access_controls_def] if {
    input.backup_storage_permissions == "overly_permissive"
    not input.backup_encryption_enabled
}

exposures contains _backup_files_stored_without_access_controls_def if {
    count(backup_files_stored_without_access_controls) > 0
}

_database_admin_interface_exposed_def := {
    "name": "Database Admin Interface Exposed",
    "description": "Web-based or network-accessible administration tools (e.g., phpMyAdmin, pgAdmin, MySQL Workbench remote port, RPC interfaces) accessible from untrusted networks without IP restriction or multi-factor authentication. Provides a high-value attack surface against administrative functions.",
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
            "relevance": "Exposed database admin interfaces are public-facing applications that can be exploited for initial access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Exposed admin interfaces are targeted with credential stuffing attacks to gain administrative database access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Database admin interfaces exposed remotely can be exploited via vulnerabilities in the remote service."
        }
    ],
    "attack_vector": "NETWORK"
}

database_admin_interface_exposed[_database_admin_interface_exposed_def] if {
    input.admin_interface_network_exposure == "public"
    not input.mfa_enforced
}

database_admin_interface_exposed[_database_admin_interface_exposed_def] if {
    input.admin_interface_network_exposure == "public"
    not input.tls_enforced
}

database_admin_interface_exposed[_database_admin_interface_exposed_def] if {
    input.admin_interface_network_exposure == "restricted"
    not input.mfa_enforced
    not input.tls_enforced
}

exposures contains _database_admin_interface_exposed_def if {
    count(database_admin_interface_exposed) > 0
}

_os_level_database_process_running_as_privileged_user_def := {
    "name": "Os Level Database Process Running As Privileged User",
    "description": "Database daemon running as root or a highly privileged OS user rather than a dedicated low-privilege service account. Exploitation of a database vulnerability would yield OS-level privileges, enabling lateral movement and full host compromise.",
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
            "relevance": "A database process running as a privileged OS user allows exploitation of database vulnerabilities to escalate to full system privileges."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Exploiting a database service running as a privileged user via a public-facing vulnerability grants elevated OS-level access."
        }
    ],
    "attack_vector": "NETWORK"
}

os_level_database_process_running_as_privileged_user[_os_level_database_process_running_as_privileged_user_def] if {
    input.process_uid == 0
}

os_level_database_process_running_as_privileged_user[_os_level_database_process_running_as_privileged_user_def] if {
    input.database_process_os_user == "root"
}

os_level_database_process_running_as_privileged_user[_os_level_database_process_running_as_privileged_user_def] if {
    not input.runs_as_dedicated_service_account
}

exposures contains _os_level_database_process_running_as_privileged_user_def if {
    count(os_level_database_process_running_as_privileged_user) > 0
}

_secrets_stored_in_database_configuration_files_in_plaintext_def := {
    "name": "Secrets Stored In Database Configuration Files In Plaintext",
    "description": "Database connection strings, replication passwords, or encryption key material stored in plaintext within configuration files (e.g., my.cnf, postgresql.conf, environment files) on the host filesystem without appropriate file permission restrictions.",
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
            "relevance": "Plaintext secrets in database configuration files are directly targeted by adversaries searching for credentials in files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Storing secrets in plaintext configuration files represents unsecured credentials that adversaries can easily discover and abuse."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Configuration files may contain private keys or tokens stored in plaintext, exposing cryptographic material to adversaries."
        }
    ],
    "attack_vector": "LOCAL"
}

secrets_stored_in_database_configuration_files_in_plaintext[_secrets_stored_in_database_configuration_files_in_plaintext_def] if {
    input.plaintext_credentials_present == true
    not input.secrets_manager_integration_enabled
}

secrets_stored_in_database_configuration_files_in_plaintext[_secrets_stored_in_database_configuration_files_in_plaintext_def] if {
    input.plaintext_credentials_present == true
    not input.config_file_permission_mode in ["600", "400", "0600", "0400"]
}

exposures contains _secrets_stored_in_database_configuration_files_in_plaintext_def if {
    count(secrets_stored_in_database_configuration_files_in_plaintext) > 0
}

_no_connection_rate_limiting_or_max_connections_enforcement_def := {
    "name": "No Connection Rate Limiting Or Max Connections Enforcement",
    "description": "Database not configured with per-account connection limits or global max_connections tuned appropriately. Enables denial-of-service through connection exhaustion, causing availability loss for a system storing critical financial transaction data.",
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
            "relevance": "Without connection rate limiting, databases are vulnerable to service exhaustion floods that can cause denial of service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Lack of max connection enforcement enables application-layer exhaustion attacks against the database service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Without rate limiting, adversaries can perform unlimited credential stuffing attempts against database authentication."
        }
    ],
    "attack_vector": "NETWORK"
}

no_connection_rate_limiting_or_max_connections_enforcement[_no_connection_rate_limiting_or_max_connections_enforcement_def] if {
    input.global_max_connections > 10000
}

no_connection_rate_limiting_or_max_connections_enforcement[_no_connection_rate_limiting_or_max_connections_enforcement_def] if {
    not input.per_account_connection_limit_enforced
}

exposures contains _no_connection_rate_limiting_or_max_connections_enforcement_def if {
    count(no_connection_rate_limiting_or_max_connections_enforcement) > 0
}

_unnecessary_database_features_or_plugins_enabled_def := {
    "name": "Unnecessary Database Features Or Plugins Enabled",
    "description": "Unused database features enabled by configuration (e.g., FILE privilege in MySQL, dblink in PostgreSQL, xp_cmdshell in SQL Server, HTTP endpoint in MongoDB). Each active feature expands the attack surface beyond core data access requirements.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Unnecessary database features and plugins expand the attack surface for exploitation of remote database services."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Enabled but unnecessary database features may contain vulnerabilities exploitable in public-facing database deployments."
        }
    ],
    "attack_vector": "NETWORK"
}

unnecessary_database_features_or_plugins_enabled[_unnecessary_database_features_or_plugins_enabled_def] if {
    count(input.enabled_privileged_features) > 0
    not input.feature_justified_by_business_requirement
}

unnecessary_database_features_or_plugins_enabled[_unnecessary_database_features_or_plugins_enabled_def] if {
    count(input.enabled_privileged_features) > 0
    not input.feature_justified_by_business_requirement
}

exposures contains _unnecessary_database_features_or_plugins_enabled_def if {
    count(unnecessary_database_features_or_plugins_enabled) > 0
}
