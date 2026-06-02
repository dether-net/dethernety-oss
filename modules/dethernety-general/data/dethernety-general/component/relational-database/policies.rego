package _dt_built_in.exposures.relational_database



_sql_injection_def := {
    "name": "SQL injection",
    "description": "Untrusted input concatenated into dynamic SQL (no parameterized queries / prepared statements) lets an attacker rewrite query logic to read, alter, or destroy data; combined with an over-privileged app role it escalates to schema tampering and RCE. Grounded in the parameterized_queries control and the documented CVE-2025-1094 libpq/psql invalid-UTF-8 SQLi\u2192shell chain.",
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
                "justification": "SQL injection against the public-facing application's data-access layer exploits a public-facing application weakness; with an over-privileged app role or an unpatched engine (CVE-2025-1094 libpq/psql) it chains to RCE \u2014 corpus-confirmed candidate T1190."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

sql_injection[_sql_injection_def] if {
    not input.parameterized_queries_used
}

sql_injection[_sql_injection_def] if {
    not input.dynamic_sql_avoided
}

sql_injection[_sql_injection_def] if {
    not input.app_role_not_superuser_or_ddl
}

exposures contains _sql_injection_def if {
    count(sql_injection) > 0
}

_weak_or_trust_authentication_def := {
    "name": "Weak or trust authentication",
    "description": "pg_hba.conf using trust/md5/password instead of scram-sha-256, or MySQL accounts on deprecated mysql_native_password / anonymous '' users / default-blank passwords (postgres, root), allow credential bypass, offline cracking of weak verifiers, or default-credential login to the crown-jewel store.",
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
            "value": "T1078.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_trust_authentication[_weak_or_trust_authentication_def] if {
    not input.strong_db_auth_method_enforced
}

weak_or_trust_authentication[_weak_or_trust_authentication_def] if {
    not input.no_blank_or_default_db_passwords
}

weak_or_trust_authentication[_weak_or_trust_authentication_def] if {
    not input.anonymous_db_accounts_removed
}

weak_or_trust_authentication[_weak_or_trust_authentication_def] if {
    not input.default_accounts_removed_or_changed
}

exposures contains _weak_or_trust_authentication_def if {
    count(weak_or_trust_authentication) > 0
}

_over_privileged_application_role_no_least_privilege_def := {
    "name": "Over-privileged application role / no least-privilege",
    "description": "The app connecting as superuser/root or holding DDL/GRANT/ALL \u2014 plus PUBLIC retaining CREATE on the public schema (REVOKE PUBLIC not applied) and no Row-Level Security on multi-tenant tables \u2014 means any injection or app compromise yields full exfiltration, COPY-to/from-program RCE, and cross-tenant reads rather than table-scoped DML impact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "An over-privileged application role means a compromised or injected app session inherits superuser/owner credentials, giving an adversary high-privilege Valid Accounts access to the database rather than table-scoped DML."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {
                "justification": "Absent least-privilege, public-schema lockdown, and row-level security, an attacker with app-level access can read the entire data repository (all tenants/tables) \u2014 Data from Information Repositories \u2014 instead of being scoped to its own rows."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_application_role_no_least_privilege[_over_privileged_application_role_no_least_privilege_def] if {
    not input.least_privilege_access_enforced
}

over_privileged_application_role_no_least_privilege[_over_privileged_application_role_no_least_privilege_def] if {
    not input.role_grants_least_privilege
}

over_privileged_application_role_no_least_privilege[_over_privileged_application_role_no_least_privilege_def] if {
    not input.public_schema_create_revoked
}

over_privileged_application_role_no_least_privilege[_over_privileged_application_role_no_least_privilege_def] if {
    not input.row_level_security_enforced_where_multitenant
}

exposures contains _over_privileged_application_role_no_least_privilege_def if {
    count(over_privileged_application_role_no_least_privilege) > 0
}

_public_network_exposure_of_the_db_port_def := {
    "name": "Public network exposure of the DB port",
    "description": "listen_addresses='*' / MySQL bind_address=0.0.0.0, or managed RDS PubliclyAccessible=true with a permissive pg_hba host all, exposes 5432/3306 directly to the internet \u2014 enabling brute force, direct exploitation, and bulk exfiltration. The store belongs on a private/VPC subnet only.",
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
                "justification": "A DB port (5432/3306) reachable from the internet via PubliclyAccessible=true, listen_addresses='*'/bind 0.0.0.0, pg_hba 0.0.0.0/0, or a public subnet with no firewall is a public-facing service an attacker can directly reach to brute-force, exploit a known engine CVE, and bulk-exfiltrate."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

public_network_exposure_of_the_db_port[_public_network_exposure_of_the_db_port_def] if {
    not input.db_not_publicly_accessible
}

public_network_exposure_of_the_db_port[_public_network_exposure_of_the_db_port_def] if {
    not input.listen_addresses_restricted
}

public_network_exposure_of_the_db_port[_public_network_exposure_of_the_db_port_def] if {
    not input.host_access_rules_scoped
}

public_network_exposure_of_the_db_port[_public_network_exposure_of_the_db_port_def] if {
    not input.network_firewall_restricts_db_port
}

exposures contains _public_network_exposure_of_the_db_port_def if {
    count(public_network_exposure_of_the_db_port) > 0
}

_missing_encryption_in_transit_mitm_def := {
    "name": "Missing encryption in transit / MITM",
    "description": "Server not requiring TLS (PostgreSQL ssl=off, MySQL require_secure_transport=OFF) or clients connecting with sslmode=disable/allow/prefer/require (not verify-full) accept plaintext or an unauthenticated server cert, exposing credentials and PII to sniffing and active man-in-the-middle.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
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
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

missing_encryption_in_transit_mitm[_missing_encryption_in_transit_mitm_def] if {
    not input.tls_only_transport
}

missing_encryption_in_transit_mitm[_missing_encryption_in_transit_mitm_def] if {
    not input.server_certificate_validated
}

missing_encryption_in_transit_mitm[_missing_encryption_in_transit_mitm_def] if {
    input.weak_tls_versions_enabled == true
}

missing_encryption_in_transit_mitm[_missing_encryption_in_transit_mitm_def] if {
    input.min_tls_version in ["TLSv1.0", "TLSv1.1", "SSLv3"]
}

exposures contains _missing_encryption_in_transit_mitm_def if {
    count(missing_encryption_in_transit_mitm) > 0
}

_missing_encryption_at_rest_def := {
    "name": "Missing encryption at rest",
    "description": "Without RDS StorageEncrypted=true backed by a rotated customer-managed KMS CMK (or TDE / encrypted volume), theft of disks, snapshots, or a misconfigured snapshot share exposes the entire dataset; RDS encryption is creation-time-only, so an unencrypted instance is a standing crown-jewel exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {
                "justification": "Unencrypted data files, logs and snapshots are readable from disk/volume/snapshot theft, enabling bulk collection of the structured data repository (Data from Information Repositories)."
            }
        }
    ],
    "attack_vector": "PHYSICAL"
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    not input.storage_encryption_enabled
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    input.encrypted_at_rest == true
    not input.customer_managed_key_used
}

exposures contains _missing_encryption_at_rest_def if {
    count(missing_encryption_at_rest) > 0
}

_exposed_static_database_credentials_def := {
    "name": "Exposed / static database credentials",
    "description": "Hard-coded DB passwords in source, config, env files, or images \u2014 instead of short-lived dynamic credentials from Vault's database secrets engine / a secret manager with rotation \u2014 are harvested from repos or memory and reused for direct DB access without ever exploiting the app.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_static_database_credentials[_exposed_static_database_credentials_def] if {
    not input.db_credentials_in_secret_manager
}

exposed_static_database_credentials[_exposed_static_database_credentials_def] if {
    not input.dynamic_short_lived_db_credentials_used
}

exposed_static_database_credentials[_exposed_static_database_credentials_def] if {
    not input.db_credentials_not_in_code_or_repo
}

exposed_static_database_credentials[_exposed_static_database_credentials_def] if {
    not input.db_credentials_rotated_regularly
}

exposures contains _exposed_static_database_credentials_def if {
    count(exposed_static_database_credentials) > 0
}

_backup_tampering_recovery_destruction_def := {
    "name": "Backup tampering / recovery destruction",
    "description": "Mutable, unencrypted, or over-accessible backups (BackupRetentionPeriod=0, no PITR, world-readable snapshot bucket, no immutability) let an attacker delete or alter recovery data for anti-forensics/ransomware, or exfiltrate the full dataset from a snapshot copy instead of the live DB.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

backup_tampering_recovery_destruction[_backup_tampering_recovery_destruction_def] if {
    not input.backups_encrypted
}

backup_tampering_recovery_destruction[_backup_tampering_recovery_destruction_def] if {
    not input.point_in_time_recovery_enabled
}

backup_tampering_recovery_destruction[_backup_tampering_recovery_destruction_def] if {
    not input.backup_access_restricted
}

backup_tampering_recovery_destruction[_backup_tampering_recovery_destruction_def] if {
    not input.backup_immutability_enabled
}

exposures contains _backup_tampering_recovery_destruction_def if {
    count(backup_tampering_recovery_destruction) > 0
}

_audit_logging_gaps_unpatched_engine_residency_drift_def := {
    "name": "Audit-logging gaps, unpatched engine & residency drift",
    "description": "No pgAudit/MySQL audit plugin and log_connections off, or logs kept only on-host (deletable by the DB account, not shipped to an immutable >=1y store), leaves bulk reads unrecorded and defeats PCI Req 10 / NIST AU-9; compounded by running an EoL or unpatched engine behind a CISA-KEV flaw (CVE-2025-1094) and placing regulated PII or cross-region replicas/snapshots outside the approved residency boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Missing pgAudit/audit plugin, log_connections off, and logs retained only on-host (deletable by the DB account) impair the defender's ability to detect and reconstruct malicious database access (Impair Defenses: Indicator Blocking / Disable or Modify Tools)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An EoL or unpatched engine behind a known-exploited CVE (e.g. CVE-2025-1094 PostgreSQL libpq/psql SQLi-to-RCE chain) leaves a weaponized path to exploit the public-facing data store."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Absent audit trails and residency drift (data/replicas/snapshots outside the approved region) enable bulk exfiltration of the structured store to an external account or web service to proceed undetected."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    not input.database_audit_logging_enabled
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    not input.log_connections_enabled
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    not input.logs_stored_on_separate_system
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    input.log_retention_days < 365
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    input.unpatched_known_rce_cve == true
}

audit_logging_gaps_unpatched_engine_residency_drift[_audit_logging_gaps_unpatched_engine_residency_drift_def] if {
    not input.data_residency_region_pinned
}

exposures contains _audit_logging_gaps_unpatched_engine_residency_drift_def if {
    count(audit_logging_gaps_unpatched_engine_residency_drift) > 0
}
