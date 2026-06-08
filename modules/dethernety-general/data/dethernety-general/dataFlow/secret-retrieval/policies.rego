package _dt_built_in.exposures.secret_retrieval



_secret_zero_leak_static_approle_secret_id_def := {
    "name": "Secret-zero leak (static AppRole secret_id)",
    "description": "The flow bootstraps trust with a static, long-lived AppRole secret_id staged in plaintext config / env var / image layer / CI variable instead of platform identity (Kubernetes ServiceAccount JWT, cloud IAM) or a response-wrapped single-use secret_id. An attacker who reads the staged secret_id logs in as the workload and retrieves every secret the role permits.",
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
                "justification": "A static AppRole secret_id staged in plaintext config/env/image-layer/CI-variable is unsecured credential material in files \u2014 an attacker reading the staged secret_id obtains the workload's bootstrap credential."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "With the leaked static secret_id the attacker authenticates as the legitimate workload (valid account) to the secrets manager and retrieves every secret the role's policy permits."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

secret_zero_leak_static_approle_secret_id[_secret_zero_leak_static_approle_secret_id_def] if {
    not input.client_auth_uses_platform_identity
    input.static_approle_secret_id_in_config == true
}

secret_zero_leak_static_approle_secret_id[_secret_zero_leak_static_approle_secret_id_def] if {
    not input.client_auth_uses_platform_identity
    not input.secret_id_response_wrapped
}

exposures contains _secret_zero_leak_static_approle_secret_id_def if {
    count(secret_zero_leak_static_approle_secret_id) > 0
}

_long_lived_over_broad_token_def := {
    "name": "Long-lived / over-broad token",
    "description": "The login token has no expiry (token_ttl=0 / no max_ttl) and/or carries an over-broad ACL policy (wildcard mounts like secret/*, any sys/ grant, sudo, or the root policy). A single leaked token becomes indefinite, wide-blast-radius access to many secrets rather than time-boxed read on one path.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
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
            "value": "T1528",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

long_lived_over_broad_token[_long_lived_over_broad_token_def] if {
    not input.token_ttl_bounded_short
}

long_lived_over_broad_token[_long_lived_over_broad_token_def] if {
    input.token_max_ttl_minutes > 240
}

long_lived_over_broad_token[_long_lived_over_broad_token_def] if {
    input.token_policy_over_broad == true
}

exposures contains _long_lived_over_broad_token_def if {
    count(long_lived_over_broad_token) > 0
}

_no_revocation_on_teardown_def := {
    "name": "No revocation on teardown",
    "description": "Tokens and dynamic-secret leases are never explicitly revoked at logout/teardown, so leaked or decommissioned-workload credentials stay usable until natural TTL expiry \u2014 or forever when TTL is unbounded. For dynamic engines the upstream credential is never deleted.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_revocation_on_teardown[_no_revocation_on_teardown_def] if {
    not input.lease_revocation_on_teardown
}

no_revocation_on_teardown[_no_revocation_on_teardown_def] if {
    not input.token_revoked_on_logout
}

no_revocation_on_teardown[_no_revocation_on_teardown_def] if {
    not input.credential_lease_ttl_bounded
}

no_revocation_on_teardown[_no_revocation_on_teardown_def] if {
    not input.dynamic_secret_upstream_deleted_on_teardown
}

exposures contains _no_revocation_on_teardown_def if {
    count(no_revocation_on_teardown) > 0
}

_unverified_tls_to_secrets_manager_mitm_def := {
    "name": "Unverified TLS to secrets manager (MITM)",
    "description": "The flow disables TLS verification (VAULT_SKIP_VERIFY=true) or uses a plaintext http VAULT_ADDR, letting an on-path attacker present a rogue cert and intercept the read flow \u2014 capturing both the auth token and the retrieved secret in transit. HashiCorp docs state skipping verification voids the Vault security model.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

unverified_tls_to_secrets_manager_mitm[_unverified_tls_to_secrets_manager_mitm_def] if {
    not input.encryption_in_transit_enabled
}

unverified_tls_to_secrets_manager_mitm[_unverified_tls_to_secrets_manager_mitm_def] if {
    not input.server_certificate_validated
}

unverified_tls_to_secrets_manager_mitm[_unverified_tls_to_secrets_manager_mitm_def] if {
    input.tls_verification_skipped == true
}

exposures contains _unverified_tls_to_secrets_manager_mitm_def if {
    count(unverified_tls_to_secrets_manager_mitm) > 0
}

_retrieved_secret_exposed_via_environment_variable_def := {
    "name": "Retrieved secret exposed via environment variable",
    "description": "The retrieved secret is injected as an env var rather than written to a tmpfs file (Vault Agent sidecar / CSI provider). Env-injected secrets are readable via /proc/<pid>/environ, leak into crash dumps and child processes, and are exposed across all replicas.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Unsecured Credentials: Credentials In Files / process environment \u2014 an env-injected secret is readable via /proc/<pid>/environ and leaks into crash dumps, child processes, and replica environments."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

retrieved_secret_exposed_via_environment_variable[_retrieved_secret_exposed_via_environment_variable_def] if {
    input.secret_injected_as_env_var == true
}

exposures contains _retrieved_secret_exposed_via_environment_variable_def if {
    count(retrieved_secret_exposed_via_environment_variable) > 0
}

_retrieved_secret_echoed_into_consumer_logs_def := {
    "name": "Retrieved secret echoed into consumer logs",
    "description": "The consuming application or CI job prints the retrieved secret/token to stdout, debug logs, stack traces, or unmasked build output, exposing a securely-retrieved secret to every downstream log sink and operator.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

retrieved_secret_echoed_into_consumer_logs[_retrieved_secret_echoed_into_consumer_logs_def] if {
    not input.secret_not_logged_by_consumer
}

retrieved_secret_echoed_into_consumer_logs[_retrieved_secret_echoed_into_consumer_logs_def] if {
    not input.sensitive_data_masking_enabled
}

exposures contains _retrieved_secret_echoed_into_consumer_logs_def if {
    count(retrieved_secret_echoed_into_consumer_logs) > 0
}

_no_audit_device_unattributable_access_def := {
    "name": "No audit device \u2014 unattributable access",
    "description": "No Vault audit device (file/syslog) is enabled (the default on a fresh cluster), so secret reads are unlogged: a compromise of this flow cannot be detected, scoped, or attributed. Audit devices HMAC-hash sensitive values so attribution does not store cleartext secrets.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_audit_device_unattributable_access[_no_audit_device_unattributable_access_def] if {
    not input.secrets_manager_audit_device_enabled
}

no_audit_device_unattributable_access[_no_audit_device_unattributable_access_def] if {
    not input.audit_logs_forwarded_to_siem
}

exposures contains _no_audit_device_unattributable_access_def if {
    count(no_audit_device_unattributable_access) > 0
}

_static_long_lived_secret_instead_of_dynamic_def := {
    "name": "Static long-lived secret instead of dynamic",
    "description": "The flow reads a long-lived static KV secret shared across workloads with no lease and no rotation, where the secret type (database/PKI/cloud/transit) supports per-request leased dynamic credentials. Static secrets are non-attributable, never auto-expire, and broaden blast radius on any single leak.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

static_long_lived_secret_instead_of_dynamic[_static_long_lived_secret_instead_of_dynamic_def] if {
    input.secret_type_supports_dynamic_credentials == true
    not input.dynamic_secrets_preferred_over_static
}

static_long_lived_secret_instead_of_dynamic[_static_long_lived_secret_instead_of_dynamic_def] if {
    not input.static_secret_rotation_enabled
}

exposures contains _static_long_lived_secret_instead_of_dynamic_def if {
    count(static_long_lived_secret_instead_of_dynamic) > 0
}
