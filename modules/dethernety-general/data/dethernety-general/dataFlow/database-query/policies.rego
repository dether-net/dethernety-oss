package _dt_built_in.exposures.database_query



_sql_injection_enabling_bulk_exfiltration_def := {
    "name": "SQL injection enabling bulk exfiltration",
    "description": "A code path on this flow concatenates untrusted input into SQL text, allowing an attacker to alter query structure (UNION SELECT / stacked statements) and use the flow's own legitimate result-set channel to dump entire tables. Canonical OWASP A03 failure on a database-query dataFlow.",
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
                "justification": "Exploit Public-Facing Application \u2014 SQL injection on an application-fronted database query flow is the canonical T1190 vector: an attacker abuses an exposed application input to inject SQL and reach the data tier through the application's own legitimate flow."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

sql_injection_enabling_bulk_exfiltration[_sql_injection_enabling_bulk_exfiltration_def] if {
    not input.parameterized_queries_used
}

sql_injection_enabling_bulk_exfiltration[_sql_injection_enabling_bulk_exfiltration_def] if {
    input.dynamic_query_string_concatenation == true
}

exposures contains _sql_injection_enabling_bulk_exfiltration_def if {
    count(sql_injection_enabling_bulk_exfiltration) > 0
}

_cleartext_db_transport_sniffing_def := {
    "name": "Cleartext DB transport sniffing",
    "description": "The app-to-DB channel is plaintext (sslmode=disable, 'host' rather than 'hostssl' in pg_hba.conf), so any on-path attacker \u2014 a rogue VPC node, a compromised network appliance, a misconfigured peering \u2014 reads every query and every result-set row off the wire.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
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
            "value": "T1048.003",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_db_transport_sniffing[_cleartext_db_transport_sniffing_def] if {
    not input.flow_tls_encrypted
}

cleartext_db_transport_sniffing[_cleartext_db_transport_sniffing_def] if {
    not input.data_tier_transit_encrypted
}

exposures contains _cleartext_db_transport_sniffing_def if {
    count(cleartext_db_transport_sniffing) > 0
}

_tls_without_server_certificate_validation_aitm_def := {
    "name": "TLS without server certificate validation (AiTM)",
    "description": "The flow negotiates TLS but the client uses sslmode=require/prefer or a 'trust all certs' TrustManager, so any on-path attacker terminating TLS with a self-signed cert harvests credentials and queries and re-originates to the real DB \u2014 TLS without verify-full is theatre.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557"
        }
    ],
    "attack_vector": "ADJACENT"
}

tls_without_server_certificate_validation_aitm[_tls_without_server_certificate_validation_aitm_def] if {
    not input.server_certificate_validated
}

tls_without_server_certificate_validation_aitm[_tls_without_server_certificate_validation_aitm_def] if {
    not input.tls_root_trust_managed
}

exposures contains _tls_without_server_certificate_validation_aitm_def if {
    count(tls_without_server_certificate_validation_aitm) > 0
}

_long_lived_shared_db_credentials_reused_indefinitely_def := {
    "name": "Long-lived shared DB credentials reused indefinitely",
    "description": "The flow authenticates with a static, long-lived password (or a shared service account used by every workload) stored in .env, k8s Secret, or git history. Anyone who reads any of those reuses the credential indefinitely, indistinguishable from the legitimate app, and audit cannot attribute actions to a specific workload.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Credentials In Files \u2014 long-lived static DB passwords stored in .env, k8s Secrets, or git history are exactly the credential-exposure pattern T1552.001 describes; an adversary who reads any such file reuses the credential on this dataFlow indefinitely."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts \u2014 a leaked static, shared DB credential is reused as a legitimate account on this flow, indistinguishable from the authorised application; this is the canonical Valid-Accounts pattern on the data tier."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

long_lived_shared_db_credentials_reused_indefinitely[_long_lived_shared_db_credentials_reused_indefinitely_def] if {
    not input.per_workload_db_identity_used
}

long_lived_shared_db_credentials_reused_indefinitely[_long_lived_shared_db_credentials_reused_indefinitely_def] if {
    not input.data_tier_credentials_short_lived
}

exposures contains _long_lived_shared_db_credentials_reused_indefinitely_def if {
    count(long_lived_shared_db_credentials_reused_indefinitely) > 0
}

_over_privileged_db_account_turns_small_bug_into_database_wide_breach_def := {
    "name": "Over-privileged DB account turns small bug into database-wide breach",
    "description": "The app principal on this flow holds SUPERUSER / GRANT ALL / db_owner. Any application-side bug (SSRF, path traversal, leaked token, minor SQLi) that lets an attacker run one DB call now lets them run any DB call \u2014 dump every table, create a backdoor role, disable RLS.",
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
                "justification": "Valid Accounts \u2014 a legitimately-authenticated but over-privileged application principal (SUPERUSER / GRANT ALL / db_owner) is the canonical Valid Accounts abuse on the data tier: one compromised credential or one app-side bug becomes database-wide read/write because the account's authorisation envelope is unbounded."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_db_account_turns_small_bug_into_database_wide_breach[_over_privileged_db_account_turns_small_bug_into_database_wide_breach_def] if {
    not input.least_privilege_db_account
}

exposures contains _over_privileged_db_account_turns_small_bug_into_database_wide_breach_def if {
    count(over_privileged_db_account_turns_small_bug_into_database_wide_breach) > 0
}

_mass_data_egress_through_legitimate_flow_no_limit_no_quota_def := {
    "name": "Mass-data egress through legitimate flow (no LIMIT / no quota)",
    "description": "No row/byte cap is enforced on result sets and no per-principal volume anomaly detection watches this flow. A compromised app instance, leaked credential, or insider issues SELECT * over the customer table and the entire dataset flows out as a single 'normal' query response.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1030",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

mass_data_egress_through_legitimate_flow_no_limit_no_quota[_mass_data_egress_through_legitimate_flow_no_limit_no_quota_def] if {
    not input.bulk_read_volume_anomaly_alerted
}

mass_data_egress_through_legitimate_flow_no_limit_no_quota[_mass_data_egress_through_legitimate_flow_no_limit_no_quota_def] if {
    not input.bulk_export_monitored_and_alerted
}

exposures contains _mass_data_egress_through_legitimate_flow_no_limit_no_quota_def if {
    count(mass_data_egress_through_legitimate_flow_no_limit_no_quota) > 0
}

_pii_leakage_via_pgaudit_driver_query_logs_def := {
    "name": "PII leakage via pgaudit / driver query logs",
    "description": "pgaudit.log_parameter=on in production, or the application driver logs full bind values at DEBUG, causes raw PII (emails, card numbers, SSNs) to be mirrored from the database into the log store. A breach of the log store then exposes the same PII the DB protects but without the DB's access controls.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Credentials In Files \u2014 when bind values containing secrets/PII are mirrored into database or driver log files, the log store becomes a credential/PII file an attacker can read without database access controls."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Data from Cloud Storage / log store \u2014 a breach of the centralized log backend (S3, CloudWatch, Elasticsearch) exposes the same PII the database protects, but stripped of the DB's row/column ACLs."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

pii_leakage_via_pgaudit_driver_query_logs[_pii_leakage_via_pgaudit_driver_query_logs_def] if {
    not input.pii_excluded_from_logs
}

pii_leakage_via_pgaudit_driver_query_logs[_pii_leakage_via_pgaudit_driver_query_logs_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _pii_leakage_via_pgaudit_driver_query_logs_def if {
    count(pii_leakage_via_pgaudit_driver_query_logs) > 0
}

_publicly_reachable_db_listener_scanned_and_brute_forced_def := {
    "name": "Publicly reachable DB listener scanned and brute-forced",
    "description": "The DB security-group / firewall is open to 0.0.0.0/0 on the DB port (5432/3306/1433), or listen_addresses is bound to all interfaces. Mass internet scanners discover it within hours and credential-stuff against any known or leaked role, turning a private flow into an internet-facing one.",
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
                "justification": "A publicly-reachable DB listener is the canonical Exploit Public-Facing Application surface \u2014 the DB service is directly exposed to internet scanners and any auth/protocol weakness becomes a direct internet-borne exploit path."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {
                "justification": "Opening the DB port to 0.0.0.0/0 (or binding listen_addresses to all interfaces on a public NIC) creates an External Remote Service \u2014 the database listener becomes a remote service reachable from outside the trust boundary, available for credential brute-force and reuse."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

publicly_reachable_db_listener_scanned_and_brute_forced[_publicly_reachable_db_listener_scanned_and_brute_forced_def] if {
    input.data_store_publicly_routable == true
}

publicly_reachable_db_listener_scanned_and_brute_forced[_publicly_reachable_db_listener_scanned_and_brute_forced_def] if {
    not input.data_tier_ingress_scoped_per_workload_identity
}

exposures contains _publicly_reachable_db_listener_scanned_and_brute_forced_def if {
    count(publicly_reachable_db_listener_scanned_and_brute_forced) > 0
}
