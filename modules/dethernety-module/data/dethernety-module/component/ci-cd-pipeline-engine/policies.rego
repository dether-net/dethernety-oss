package _dt_built_in.exposures.ci_cd_pipeline_engine



_pipeline_definition_untrusted_execution_def := {
    "name": "Pipeline Definition Untrusted Execution",
    "description": "Pipeline definition files (e.g., .gitlab-ci.yml, Jenkinsfile, GitHub Actions workflows) sourced from forked repositories or unreviewed branches are executed with the same privileges as trusted pipelines, enabling pipeline poisoning by external contributors or compromised branches.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Untrusted code execution in pipeline definitions is the core concept of poisoned pipeline execution attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Attackers can inject untrusted execution through compromised development tools or dependencies in pipeline definitions."
        }
    ],
    "attack_vector": "NETWORK"
}

pipeline_definition_untrusted_execution[_pipeline_definition_untrusted_execution_def] if {
    input.fork_pipeline_execution_enabled == true
    not input.branch_protection_pipeline_review_required
    input.secrets_exposed_to_fork_pipelines == true
}

pipeline_definition_untrusted_execution[_pipeline_definition_untrusted_execution_def] if {
    input.pipeline_definition_source == "fork_or_unreviewed_branch"
    not input.branch_protection_pipeline_review_required
}

pipeline_definition_untrusted_execution[_pipeline_definition_untrusted_execution_def] if {
    input.fork_pipeline_execution_enabled == true
    not input.branch_protection_pipeline_review_required
    input.pipeline_definition_source in ["fork_or_unreviewed_branch", "unknown"]
}

exposures contains _pipeline_definition_untrusted_execution_def if {
    count(pipeline_definition_untrusted_execution) > 0
}

_runner_excessive_host_privileges_def := {
    "name": "Runner Excessive Host Privileges",
    "description": "Pipeline runners configured with privileged container mode, host network access, host filesystem mounts, or running as root on the host node grant pipeline jobs the ability to escape container boundaries and compromise the underlying host or cluster.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Excessive host privileges on runners enables container escape to the underlying host system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543.005",
            "name": "Container Service",
            "relevance": "Misconfigured container services with excessive privileges can be abused for privilege escalation on the host."
        }
    ],
    "attack_vector": "LOCAL"
}

runner_excessive_host_privileges[_runner_excessive_host_privileges_def] if {
    input.privileged_mode_enabled == true
}

runner_excessive_host_privileges[_runner_excessive_host_privileges_def] if {
    count(input.host_namespace_access) > 0
}

runner_excessive_host_privileges[_runner_excessive_host_privileges_def] if {
    count(input.host_path_mounts) > 0
}

runner_excessive_host_privileges[_runner_excessive_host_privileges_def] if {
    input.runner_run_as_root == true
}

exposures contains _runner_excessive_host_privileges_def if {
    count(runner_excessive_host_privileges) > 0
}

_secrets_exposed_in_pipeline_logs_def := {
    "name": "Secrets Exposed In Pipeline Logs",
    "description": "Secrets injected as environment variables or passed via command-line arguments are inadvertently echoed into build logs. Log masking is disabled or improperly configured, exposing credentials to anyone with log read access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Secrets exposed in pipeline logs represent unsecured credentials accessible to anyone with log access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Attackers can enumerate pipeline logs specifically to discover exposed secrets and credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_exposed_in_pipeline_logs[_secrets_exposed_in_pipeline_logs_def] if {
    not input.log_masking_enabled
}

secrets_exposed_in_pipeline_logs[_secrets_exposed_in_pipeline_logs_def] if {
    input.secrets_passed_as_plaintext_args == true
}

secrets_exposed_in_pipeline_logs[_secrets_exposed_in_pipeline_logs_def] if {
    not input.log_masking_enabled
    input.pipeline_log_access_scope in ["public", "all_authenticated_users"]
}

exposures contains _secrets_exposed_in_pipeline_logs_def if {
    count(secrets_exposed_in_pipeline_logs) > 0
}

_dependency_confusion_unvalidated_package_resolution_def := {
    "name": "Dependency Confusion Unvalidated Package Resolution",
    "description": "Build processes resolve dependencies from public registries without enforcing private registry precedence, hash pinning, or allowlisting. An attacker can publish a malicious package with a higher version number matching an internal package name, causing automatic malicious code execution during builds.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Dependency confusion attacks directly exploit unvalidated package resolution to compromise software dependencies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1546.016",
            "name": "Installer Packages",
            "relevance": "Malicious packages introduced via dependency confusion can execute code through installer package mechanisms."
        }
    ],
    "attack_vector": "NETWORK"
}

dependency_confusion_unvalidated_package_resolution[_dependency_confusion_unvalidated_package_resolution_def] if {
    not input.registry_precedence_enforced
    not input.dependency_hash_pinning_enabled
}

dependency_confusion_unvalidated_package_resolution[_dependency_confusion_unvalidated_package_resolution_def] if {
    not input.dependency_hash_pinning_enabled
    not input.public_registry_access_restricted
}

dependency_confusion_unvalidated_package_resolution[_dependency_confusion_unvalidated_package_resolution_def] if {
    not input.registry_precedence_enforced
    not input.public_registry_access_restricted
}

exposures contains _dependency_confusion_unvalidated_package_resolution_def if {
    count(dependency_confusion_unvalidated_package_resolution) > 0
}

_pipeline_secrets_overprivileged_scope_def := {
    "name": "Pipeline Secrets Overprivileged Scope",
    "description": "Secrets and credentials stored in the pipeline secret manager are scoped to all pipelines and all branches rather than being restricted to specific jobs, stages, or protected branches, violating least-privilege and exposing production credentials to untrusted pipeline contexts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Overprivileged pipeline secrets represent unsecured credentials with excessive access scope."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.006",
            "name": "Cloud Secrets Management Stores",
            "relevance": "Overprivileged pipeline secrets often include cloud secrets management store credentials with excessive permissions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Pipeline secret scoping issues can lead to credentials being accessible in pipeline definition files."
        }
    ],
    "attack_vector": "NETWORK"
}

pipeline_secrets_overprivileged_scope[_pipeline_secrets_overprivileged_scope_def] if {
    input.secret_scope == "all_branches"
    input.production_secrets_present == true
    input.unprotected_branch_pipeline_trigger_allowed == true
}

pipeline_secrets_overprivileged_scope[_pipeline_secrets_overprivileged_scope_def] if {
    not input.secret_scope in ["protected_branches_only", "specific_environments", "specific_jobs"]
    input.production_secrets_present == true
}

exposures contains _pipeline_secrets_overprivileged_scope_def if {
    count(pipeline_secrets_overprivileged_scope) > 0
}

_artifact_integrity_verification_absent_def := {
    "name": "Artifact Integrity Verification Absent",
    "description": "Build artifacts, container images, and binaries are promoted through pipeline stages without cryptographic signing or hash verification. A compromised intermediary stage or artifact storage can substitute malicious artifacts without detection before deployment.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Absent artifact integrity verification allows compromised dependencies and build artifacts to enter the pipeline undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Without artifact integrity checks, poisoned pipeline execution via tampered artifacts becomes possible."
        }
    ],
    "attack_vector": "NETWORK"
}

artifact_integrity_verification_absent[_artifact_integrity_verification_absent_def] if {
    not input.artifact_signing_enabled
    not input.artifact_hash_verification_enabled
}

artifact_integrity_verification_absent[_artifact_integrity_verification_absent_def] if {
    input.artifact_signing_enabled == true
    not input.artifact_hash_verification_enabled
}

artifact_integrity_verification_absent[_artifact_integrity_verification_absent_def] if {
    not input.artifact_signing_enabled
    input.artifact_hash_verification_enabled == true
}

exposures contains _artifact_integrity_verification_absent_def if {
    count(artifact_integrity_verification_absent) > 0
}

_pipeline_api_authentication_weak_def := {
    "name": "Pipeline Api Authentication Weak",
    "description": "The pipeline orchestration API accepts long-lived static tokens, lacks multi-factor enforcement for human accounts, or allows unauthenticated webhook triggers without HMAC signature verification, enabling unauthorized pipeline execution or manipulation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Weak pipeline API authentication enables attackers to steal application access tokens for unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Weak authentication allows abuse of application access tokens to authenticate to pipeline APIs."
        }
    ],
    "attack_vector": "NETWORK"
}

pipeline_api_authentication_weak[_pipeline_api_authentication_weak_def] if {
    input.static_token_lifetime_days > 365
}

pipeline_api_authentication_weak[_pipeline_api_authentication_weak_def] if {
    input.static_token_lifetime_days == 0
}

pipeline_api_authentication_weak[_pipeline_api_authentication_weak_def] if {
    not input.mfa_enforced_for_pipeline_triggers
}

pipeline_api_authentication_weak[_pipeline_api_authentication_weak_def] if {
    not input.webhook_hmac_validation_enabled
}

pipeline_api_authentication_weak[_pipeline_api_authentication_weak_def] if {
    input.unauthenticated_trigger_allowed == true
}

exposures contains _pipeline_api_authentication_weak_def if {
    count(pipeline_api_authentication_weak) > 0
}

_runner_registration_token_unrestricted_def := {
    "name": "Runner Registration Token Unrestricted",
    "description": "Runner registration tokens are shared broadly, never rotated, or lack binding to specific pipeline groups or projects, allowing an attacker who obtains a token to register a malicious runner that intercepts pipeline jobs and exfiltrates secrets.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Unrestricted runner registration tokens allow attackers to register malicious runners to intercept and manipulate pipeline execution."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Runner registration tokens are a form of application access token that can be stolen and abused for unauthorized runner registration."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1134",
            "name": "Access Token Manipulation",
            "relevance": "Unrestricted registration tokens can be manipulated to gain elevated access within the CI/CD pipeline environment."
        }
    ],
    "attack_vector": "NETWORK"
}

runner_registration_token_unrestricted[_runner_registration_token_unrestricted_def] if {
    input.token_scope == "instance"
    not input.token_rotation_enforced
}

runner_registration_token_unrestricted[_runner_registration_token_unrestricted_def] if {
    input.token_scope == "instance"
    not input.runner_registration_protected
}

runner_registration_token_unrestricted[_runner_registration_token_unrestricted_def] if {
    input.token_scope == "group"
    not input.token_rotation_enforced
    not input.runner_registration_protected
}

exposures contains _runner_registration_token_unrestricted_def if {
    count(runner_registration_token_unrestricted) > 0
}

_build_cache_poisoning_unverified_restore_def := {
    "name": "Build Cache Poisoning Unverified Restore",
    "description": "Pipeline build caches are restored from shared or remote storage without integrity verification. An attacker with write access to the cache store can inject malicious compiled artifacts or dependency files that are reused in subsequent builds.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "name": "Implant Internal Image",
            "relevance": "Poisoned build caches can implant malicious content into internal images used by subsequent pipeline runs."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Unverified cache restoration can introduce compromised build tools and dependencies into the pipeline."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Build cache poisoning is a direct vector for poisoned pipeline execution through malicious cached artifacts."
        }
    ],
    "attack_vector": "NETWORK"
}

build_cache_poisoning_unverified_restore[_build_cache_poisoning_unverified_restore_def] if {
    not input.cache_integrity_verification_enabled
    input.cache_scope == "shared"
}

build_cache_poisoning_unverified_restore[_build_cache_poisoning_unverified_restore_def] if {
    not input.cache_integrity_verification_enabled
    input.cache_storage_access_control in ["none", "authenticated"]
}

exposures contains _build_cache_poisoning_unverified_restore_def if {
    count(build_cache_poisoning_unverified_restore) > 0
}

_network_segmentation_absent_for_runners_def := {
    "name": "Network Segmentation Absent For Runners",
    "description": "Pipeline runner nodes have unrestricted network access to production infrastructure, internal secrets managers, and cloud metadata services rather than being isolated to build-time resources only, allowing a compromised build step to enumerate and exfiltrate production credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Without network segmentation, compromised runners can leverage deployment tools to move laterally across environments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1648",
            "name": "Serverless Execution",
            "relevance": "Absent network segmentation allows pipeline runners unrestricted access to internal services and cloud execution environments."
        }
    ],
    "attack_vector": "LOCAL"
}

network_segmentation_absent_for_runners[_network_segmentation_absent_for_runners_def] if {
    not input.runner_network_isolation_enforced
}

network_segmentation_absent_for_runners[_network_segmentation_absent_for_runners_def] if {
    not input.metadata_service_access_blocked
    not input.runner_network_isolation_enforced
}

network_segmentation_absent_for_runners[_network_segmentation_absent_for_runners_def] if {
    input.secrets_manager_reachable_from_runner == true
}

exposures contains _network_segmentation_absent_for_runners_def if {
    count(network_segmentation_absent_for_runners) > 0
}

_pipeline_audit_logging_insufficient_def := {
    "name": "Pipeline Audit Logging Insufficient",
    "description": "Pipeline execution events, including job triggers, secret access, artifact promotions, and runner registrations, are not forwarded to a centralized immutable audit log, preventing forensic reconstruction of malicious pipeline activity.",
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
            "relevance": "Insufficient pipeline audit logging mirrors the impact of disabling cloud logs, leaving pipeline activities undetectable."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Insufficient logging means attackers can operate without their actions being captured or reviewed."
        }
    ],
    "attack_vector": "NETWORK"
}

pipeline_audit_logging_insufficient[_pipeline_audit_logging_insufficient_def] if {
    not input.audit_log_forwarding_enabled
}

pipeline_audit_logging_insufficient[_pipeline_audit_logging_insufficient_def] if {
    input.audit_log_forwarding_enabled == true
    not input.audit_log_immutability_enforced
}

pipeline_audit_logging_insufficient[_pipeline_audit_logging_insufficient_def] if {
    input.audit_log_forwarding_enabled == true
    input.audit_log_immutability_enforced == true
    not "secret_access" in input.audited_event_types
    not "job_trigger" in input.audited_event_types
}

exposures contains _pipeline_audit_logging_insufficient_def if {
    count(pipeline_audit_logging_insufficient) > 0
}

_deployment_approval_gates_bypassed_def := {
    "name": "Deployment Approval Gates Bypassed",
    "description": "Automated deployment triggers to production environments lack mandatory human approval steps or environment protection rules, enabling a single compromised pipeline job to deploy malicious artifacts to production without review.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Bypassing deployment approval gates is a key enabler of poisoned pipeline execution reaching production environments."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Deployment approval gate bypass abuses software deployment tools to push unauthorized changes to production."
        }
    ],
    "attack_vector": "NETWORK"
}

deployment_approval_gates_bypassed[_deployment_approval_gates_bypassed_def] if {
    not input.production_approval_required
}

deployment_approval_gates_bypassed[_deployment_approval_gates_bypassed_def] if {
    input.production_approval_required == true
    input.direct_production_deploy_allowed == true
}

deployment_approval_gates_bypassed[_deployment_approval_gates_bypassed_def] if {
    input.production_approval_required == true
    input.approval_bypass_roles_count > 2
}

exposures contains _deployment_approval_gates_bypassed_def if {
    count(deployment_approval_gates_bypassed) > 0
}

_pipeline_orchestrator_patching_deferred_def := {
    "name": "Pipeline Orchestrator Patching Deferred",
    "description": "The CI/CD orchestration platform (e.g., Jenkins, GitLab Runner, Tekton controller) is not enrolled in a regular patching cadence, leaving known CVEs in the execution engine unpatched and exploitable by attackers with pipeline job execution access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1072",
            "name": "Software Deployment Tools",
            "relevance": "Unpatched pipeline orchestrators expose vulnerabilities in software deployment tools that attackers can exploit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Deferred patching of orchestrators leaves known vulnerabilities in development tools open to exploitation."
        }
    ],
    "attack_vector": "LOCAL"
}

pipeline_orchestrator_patching_deferred[_pipeline_orchestrator_patching_deferred_def] if {
    input.version_has_known_cve == true
    input.days_since_last_patch >= 30
}

pipeline_orchestrator_patching_deferred[_pipeline_orchestrator_patching_deferred_def] if {
    not input.patching_cadence_policy_defined
    input.days_since_last_patch >= 30
}

exposures contains _pipeline_orchestrator_patching_deferred_def if {
    count(pipeline_orchestrator_patching_deferred) > 0
}

_inter_stage_data_exfiltration_unmonitored_def := {
    "name": "Inter Stage Data Exfiltration Unmonitored",
    "description": "Egress network traffic from runner nodes during job execution is not monitored or restricted by allowlist rules, permitting a malicious build step to exfiltrate source code, secrets, or build artifacts to external attacker-controlled endpoints.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020",
            "name": "Automated Exfiltration",
            "relevance": "Unmonitored inter-stage data transfer enables automated exfiltration of sensitive data between pipeline stages."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.001",
            "name": "Exfiltration to Code Repository",
            "relevance": "Pipeline stage data can be exfiltrated to external code repositories without monitoring controls in place."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unmonitored inter-stage communication channels can be exploited for exfiltration over alternative protocols."
        }
    ],
    "attack_vector": "LOCAL"
}

inter_stage_data_exfiltration_unmonitored[_inter_stage_data_exfiltration_unmonitored_def] if {
    not input.egress_network_policy_enforced
    not input.egress_traffic_monitoring_enabled
}

inter_stage_data_exfiltration_unmonitored[_inter_stage_data_exfiltration_unmonitored_def] if {
    input.runner_network_isolation_mode == "shared_unrestricted"
    not input.egress_traffic_monitoring_enabled
}

inter_stage_data_exfiltration_unmonitored[_inter_stage_data_exfiltration_unmonitored_def] if {
    not input.egress_network_policy_enforced
    input.runner_network_isolation_mode == "shared_unrestricted"
}

exposures contains _inter_stage_data_exfiltration_unmonitored_def if {
    count(inter_stage_data_exfiltration_unmonitored) > 0
}

_hardcoded_credentials_in_pipeline_definitions_def := {
    "name": "Hardcoded Credentials In Pipeline Definitions",
    "description": "Pipeline definition files contain hardcoded credentials, API keys, or private registry passwords committed to source control rather than referencing the secrets management facility, exposing credentials to anyone with repository read access.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Hardcoded credentials in pipeline definition files are directly an instance of credentials stored in files."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Hardcoded credentials in pipeline definitions represent unsecured credentials accessible to repository readers."
        }
    ],
    "attack_vector": "NETWORK"
}

hardcoded_credentials_in_pipeline_definitions[_hardcoded_credentials_in_pipeline_definitions_def] if {
    input.hardcoded_secret_patterns_detected == true
}

hardcoded_credentials_in_pipeline_definitions[_hardcoded_credentials_in_pipeline_definitions_def] if {
    not input.secrets_manager_references_used
    input.hardcoded_secret_patterns_detected == true
}

exposures contains _hardcoded_credentials_in_pipeline_definitions_def if {
    count(hardcoded_credentials_in_pipeline_definitions) > 0
}

_build_environment_base_image_unpinned_def := {
    "name": "Build Environment Base Image Unpinned",
    "description": "Pipeline jobs reference base container images by mutable tags (e.g., 'latest') rather than immutable digest references, causing non-deterministic builds and enabling an attacker who compromises the upstream registry to substitute a malicious image on the next pipeline run.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.003",
            "name": "Malicious Image",
            "relevance": "Unpinned base images can be replaced with malicious images that execute attacker-controlled code in the build environment."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "name": "Implant Internal Image",
            "relevance": "Unpinned base images allow attackers to implant malicious content into images used by the build environment."
        }
    ],
    "attack_vector": "NETWORK"
}

build_environment_base_image_unpinned[_build_environment_base_image_unpinned_def] if {
    not input.image_reference_uses_digest
}

build_environment_base_image_unpinned[_build_environment_base_image_unpinned_def] if {
    count(input.mutable_tag_patterns_found) > 0
}

exposures contains _build_environment_base_image_unpinned_def if {
    count(build_environment_base_image_unpinned) > 0
}

_runner_job_isolation_disabled_def := {
    "name": "Runner Job Isolation Disabled",
    "description": "Runners reuse the same execution environment across sequential jobs without workspace cleanup or ephemeral runner enforcement, enabling cross-job data leakage where a malicious job reads artifacts, environment variables, or files left by a prior legitimate job.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Disabled job isolation allows malicious pipeline jobs to interfere with other jobs' execution and steal their data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1564.006",
            "name": "Run Virtual Instance",
            "relevance": "Lack of runner job isolation can be exploited by running virtual instances to escape job boundaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Disabled job isolation increases the risk of container/job escape to the underlying runner host."
        }
    ],
    "attack_vector": "LOCAL"
}

runner_job_isolation_disabled[_runner_job_isolation_disabled_def] if {
    not input.ephemeral_runners_enforced
    not input.workspace_cleanup_enabled
}

exposures contains _runner_job_isolation_disabled_def if {
    count(runner_job_isolation_disabled) > 0
}
