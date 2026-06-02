package _dt_built_in.exposures.system_configuration



_hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs_def := {
    "name": "Hardcoded plaintext secrets in config/IaC committed to VCS",
    "description": "API keys, passwords, tokens, and private keys embedded in plaintext in source, config, or IaC manifests are committed to version control and recoverable from history \u2014 leaking credentials wholesale (and to the world if the repo is public). No vaulting, no pre-commit/CI secret scanning (OWASP Secrets Management / IaC).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552"
        }
    ],
    "attack_vector": "NETWORK"
}

hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs[_hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs[_hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
    not input.secret_scanning_enabled
}

exposures contains _hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs_def if {
    count(hardcoded_plaintext_secrets_in_config_iac_committed_to_vcs) > 0
}

_secrets_in_environment_variables_env_or_baked_into_image_layers_def := {
    "name": "Secrets in environment variables / .env or baked into image layers",
    "description": "Secrets kept in flat .env files, env vars, or baked into container image layers/build args are readable by processes, logs, crash dumps, and metadata endpoints and ship with the artifact \u2014 an anti-pattern for production secrets that should be injected at runtime from a managed store (OWASP Secrets Management).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.007"
        }
    ],
    "attack_vector": "LOCAL"
}

secrets_in_environment_variables_env_or_baked_into_image_layers[_secrets_in_environment_variables_env_or_baked_into_image_layers_def] if {
    input.secrets_in_env_or_image_layers == true
}

secrets_in_environment_variables_env_or_baked_into_image_layers[_secrets_in_environment_variables_env_or_baked_into_image_layers_def] if {
    not input.secrets_injected_at_runtime_not_baked_in
}

secrets_in_environment_variables_env_or_baked_into_image_layers[_secrets_in_environment_variables_env_or_baked_into_image_layers_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
}

exposures contains _secrets_in_environment_variables_env_or_baked_into_image_layers_def if {
    count(secrets_in_environment_variables_env_or_baked_into_image_layers) > 0
}

_configuration_iac_tampering_with_no_change_detection_or_change_control_def := {
    "name": "Configuration / IaC tampering with no change detection or change control",
    "description": "Unauthorized or out-of-band modification of config/IaC with no integrity monitoring, no required peer-reviewed PRs, and no signed commits lets an attacker silently weaken controls and reach production without provenance or approval (NIST CM-3/CM-5/CM-14).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1578"
        }
    ],
    "attack_vector": "NETWORK"
}

configuration_iac_tampering_with_no_change_detection_or_change_control[_configuration_iac_tampering_with_no_change_detection_or_change_control_def] if {
    not input.iac_version_controlled_with_required_review
}

configuration_iac_tampering_with_no_change_detection_or_change_control[_configuration_iac_tampering_with_no_change_detection_or_change_control_def] if {
    not input.commits_signed
}

configuration_iac_tampering_with_no_change_detection_or_change_control[_configuration_iac_tampering_with_no_change_detection_or_change_control_def] if {
    not input.config_change_detection_enabled
}

exposures contains _configuration_iac_tampering_with_no_change_detection_or_change_control_def if {
    count(configuration_iac_tampering_with_no_change_detection_or_change_control) > 0
}

_over_broad_write_access_to_config_and_secret_stores_def := {
    "name": "Over-broad write access to config and secret stores",
    "description": "Wildcard IAM/Vault policies granting blanket read/write to all secrets or config \u2014 rather than per-secret/per-scope least privilege \u2014 let one compromised principal read or rewrite everything, with no audit trail of who accessed or changed what (NIST CM-5; OWASP Secrets Management).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078"
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_write_access_to_config_and_secret_stores[_over_broad_write_access_to_config_and_secret_stores_def] if {
    not input.least_privilege_access_enforced
}

over_broad_write_access_to_config_and_secret_stores[_over_broad_write_access_to_config_and_secret_stores_def] if {
    not input.per_secret_access_scoping
}

over_broad_write_access_to_config_and_secret_stores[_over_broad_write_access_to_config_and_secret_stores_def] if {
    not input.secret_access_audited
}

exposures contains _over_broad_write_access_to_config_and_secret_stores_def if {
    count(over_broad_write_access_to_config_and_secret_stores) > 0
}

_config_and_secrets_unencrypted_at_rest_or_in_transit_def := {
    "name": "Config and secrets unencrypted at rest or in transit",
    "description": "Secrets and sensitive config stored without AES-256/envelope encryption (keys co-located with data) or retrieved over plaintext HTTP rather than TLS are exposed to anyone with store or network access \u2014 including IaC state files that hold plaintext secrets (OWASP Cryptographic Storage / Key Management).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040"
        }
    ],
    "attack_vector": "ADJACENT"
}

config_and_secrets_unencrypted_at_rest_or_in_transit[_config_and_secrets_unencrypted_at_rest_or_in_transit_def] if {
    not input.encrypted_at_rest
}

config_and_secrets_unencrypted_at_rest_or_in_transit[_config_and_secrets_unencrypted_at_rest_or_in_transit_def] if {
    not input.tls_only_transport
}

config_and_secrets_unencrypted_at_rest_or_in_transit[_config_and_secrets_unencrypted_at_rest_or_in_transit_def] if {
    not input.iac_state_secrets_encrypted
}

exposures contains _config_and_secrets_unencrypted_at_rest_or_in_transit_def if {
    count(config_and_secrets_unencrypted_at_rest_or_in_transit) > 0
}

_insecure_default_settings_shipped_to_production_def := {
    "name": "Insecure default settings shipped to production",
    "description": "No documented hardened baseline: default accounts/passwords, sample apps, debug/verbose error endpoints, and unnecessary ports/services/protocols left enabled in prod \u2014 OWASP A05 Security Misconfiguration and a failure of NIST CM-2/CM-6/CM-7 least-functionality.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001"
        }
    ],
    "attack_vector": "NETWORK"
}

insecure_default_settings_shipped_to_production[_insecure_default_settings_shipped_to_production_def] if {
    not input.hardened_baseline_documented
}

insecure_default_settings_shipped_to_production[_insecure_default_settings_shipped_to_production_def] if {
    not input.default_accounts_removed_or_changed
}

insecure_default_settings_shipped_to_production[_insecure_default_settings_shipped_to_production_def] if {
    not input.unnecessary_services_disabled
}

insecure_default_settings_shipped_to_production[_insecure_default_settings_shipped_to_production_def] if {
    not input.debug_and_verbose_errors_disabled_in_prod
}

insecure_default_settings_shipped_to_production[_insecure_default_settings_shipped_to_production_def] if {
    not input.sample_apps_and_default_content_removed
}

exposures contains _insecure_default_settings_shipped_to_production_def if {
    count(insecure_default_settings_shipped_to_production) > 0
}

_configuration_drift_from_the_reviewed_baseline_undetected_def := {
    "name": "Configuration drift from the reviewed baseline undetected",
    "description": "Running configuration silently diverges from the hardened baseline through manual hotfixes and out-of-band changes, reintroducing removed vulnerabilities, with no continuous comparison or drift alerting (NIST CM-6 monitoring; SP 800-128).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

configuration_drift_from_the_reviewed_baseline_undetected[_configuration_drift_from_the_reviewed_baseline_undetected_def] if {
    not input.drift_detection_enabled
}

configuration_drift_from_the_reviewed_baseline_undetected[_configuration_drift_from_the_reviewed_baseline_undetected_def] if {
    not input.running_config_matches_baseline
}

configuration_drift_from_the_reviewed_baseline_undetected[_configuration_drift_from_the_reviewed_baseline_undetected_def] if {
    not input.out_of_band_changes_controlled
}

exposures contains _configuration_drift_from_the_reviewed_baseline_undetected_def if {
    count(configuration_drift_from_the_reviewed_baseline_undetected) > 0
}

_publicly_exposed_config_iac_and_embedded_secrets_def := {
    "name": "Publicly exposed config / IaC and embedded secrets",
    "description": "Public git repos, world-readable .env files, open object-storage buckets, IaC state in VCS, and exposed metadata endpoints disclose configuration and the secrets it references to unauthenticated attackers (OWASP A05 / IaC Security).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.005"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530"
        }
    ],
    "attack_vector": "NETWORK"
}

publicly_exposed_config_iac_and_embedded_secrets[_publicly_exposed_config_iac_and_embedded_secrets_def] if {
    not input.config_repo_private
}

publicly_exposed_config_iac_and_embedded_secrets[_publicly_exposed_config_iac_and_embedded_secrets_def] if {
    not input.config_files_not_world_readable
}

publicly_exposed_config_iac_and_embedded_secrets[_publicly_exposed_config_iac_and_embedded_secrets_def] if {
    not input.config_object_storage_not_publicly_accessible
}

publicly_exposed_config_iac_and_embedded_secrets[_publicly_exposed_config_iac_and_embedded_secrets_def] if {
    not input.metadata_endpoint_access_restricted
}

publicly_exposed_config_iac_and_embedded_secrets[_publicly_exposed_config_iac_and_embedded_secrets_def] if {
    not input.iac_state_not_publicly_exposed
}

exposures contains _publicly_exposed_config_iac_and_embedded_secrets_def if {
    count(publicly_exposed_config_iac_and_embedded_secrets) > 0
}

_no_config_backup_or_rollback_to_a_known_good_state_def := {
    "name": "No config backup or rollback to a known-good state",
    "description": "Without VCS history plus backed-up secret-store and IaC state, tampering, accidental deletion, or ransomware leaves no reviewed known-good configuration to restore \u2014 there is no recovery path (NIST SP 800-128 recoverability).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490"
        }
    ],
    "attack_vector": "NETWORK"
}

no_config_backup_or_rollback_to_a_known_good_state[_no_config_backup_or_rollback_to_a_known_good_state_def] if {
    not input.config_backed_up_to_known_good
}

no_config_backup_or_rollback_to_a_known_good_state[_no_config_backup_or_rollback_to_a_known_good_state_def] if {
    not input.secret_store_and_state_backed_up
}

no_config_backup_or_rollback_to_a_known_good_state[_no_config_backup_or_rollback_to_a_known_good_state_def] if {
    not input.rollback_tested
}

exposures contains _no_config_backup_or_rollback_to_a_known_good_state_def if {
    count(no_config_backup_or_rollback_to_a_known_good_state) > 0
}
