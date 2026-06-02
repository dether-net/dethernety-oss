package _dt_built_in.exposures.ci_cd_pipeline



_poisoned_pipeline_execution_script_injection_def := {
    "name": "Poisoned pipeline execution / script injection",
    "description": "Attacker-influenced pipeline code runs with CI privileges \u2014 via pull_request_target checking out untrusted PR head with secrets exposed, or untrusted github.event.* context (PR title, branch name) interpolated into a run: shell step \u2014 executing arbitrary commands on the runner and harvesting tokens (OWASP CICD-SEC-4).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "attributes": {
                "justification": "Poisoned Pipeline Execution \u2014 attacker-influenced pipeline code (untrusted pull_request_target checkout or injected run: context) runs with CI privileges, the direct realization of this vector."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059",
            "attributes": {
                "justification": "Command and Scripting Interpreter \u2014 script injection via untrusted github.event.* interpolated into a run: shell step executes attacker commands on the runner."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

poisoned_pipeline_execution_script_injection[_poisoned_pipeline_execution_script_injection_def] if {
    input.pull_request_target_with_untrusted_checkout == true
}

poisoned_pipeline_execution_script_injection[_poisoned_pipeline_execution_script_injection_def] if {
    input.untrusted_input_in_run_step == true
}

exposures contains _poisoned_pipeline_execution_script_injection_def if {
    count(poisoned_pipeline_execution_script_injection) > 0
}

_mutable_third_party_action_dependency_substitution_def := {
    "name": "Mutable third-party action / dependency substitution",
    "description": "Actions or transitive dependencies referenced by mutable tag/branch (not a full-length commit SHA) are repointed to malicious code by a compromised upstream \u2014 the tj-actions/changed-files supply-chain compromise \u2014 running attacker code in every downstream pipeline (OWASP CICD-SEC-3).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

mutable_third_party_action_dependency_substitution[_mutable_third_party_action_dependency_substitution_def] if {
    not input.third_party_actions_pinned_to_commit_sha
}

mutable_third_party_action_dependency_substitution[_mutable_third_party_action_dependency_substitution_def] if {
    not input.artifact_references_immutable_digest_pinned
}

mutable_third_party_action_dependency_substitution[_mutable_third_party_action_dependency_substitution_def] if {
    input.third_party_action_policy == "allow_all"
}

mutable_third_party_action_dependency_substitution[_mutable_third_party_action_dependency_substitution_def] if {
    not input.frozen_lockfile_with_integrity_hashes
}

exposures contains _mutable_third_party_action_dependency_substitution_def if {
    count(mutable_third_party_action_dependency_substitution) > 0
}

_dependency_confusion_unpinned_dependencies_def := {
    "name": "Dependency confusion / unpinned dependencies",
    "description": "Build resolves an internal package name from a public registry where an attacker has published a higher-version typosquat, or resolves unpinned semver ranges without a frozen lockfile/integrity hashes, pulling malicious code into the build (OWASP CICD-SEC-3).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.005",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

dependency_confusion_unpinned_dependencies[_dependency_confusion_unpinned_dependencies_def] if {
    not input.frozen_lockfile_with_integrity_hashes
}

dependency_confusion_unpinned_dependencies[_dependency_confusion_unpinned_dependencies_def] if {
    not input.internal_scope_registry_namespace_claimed
}

dependency_confusion_unpinned_dependencies[_dependency_confusion_unpinned_dependencies_def] if {
    not input.dependency_vulnerability_scanning_enabled
}

exposures contains _dependency_confusion_unpinned_dependencies_def if {
    count(dependency_confusion_unpinned_dependencies) > 0
}

_over_privileged_pipeline_identity_long_lived_cloud_keys_def := {
    "name": "Over-privileged pipeline identity / long-lived cloud keys",
    "description": "An over-broad GITHUB_TOKEN scope (contents: write / write-all) or long-lived cloud access keys stored as CI secrets instead of short-lived OIDC-federated tokens (id-token: write, claims pinned to repo/ref/environment) give a compromised step standing privilege to push code, mint releases, or move tags (OWASP CICD-SEC-2).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_pipeline_identity_long_lived_cloud_keys[_over_privileged_pipeline_identity_long_lived_cloud_keys_def] if {
    input.github_token_write_scope_granted == true
}

over_privileged_pipeline_identity_long_lived_cloud_keys[_over_privileged_pipeline_identity_long_lived_cloud_keys_def] if {
    not input.cicd_pipeline_identity_per_environment_no_long_lived_keys
}

over_privileged_pipeline_identity_long_lived_cloud_keys[_over_privileged_pipeline_identity_long_lived_cloud_keys_def] if {
    not input.least_privilege_access_enforced
}

exposures contains _over_privileged_pipeline_identity_long_lived_cloud_keys_def if {
    count(over_privileged_pipeline_identity_long_lived_cloud_keys) > 0
}

_credential_hygiene_secrets_leaked_in_logs_artifacts_def := {
    "name": "Credential hygiene \u2014 secrets leaked in logs / artifacts",
    "description": "Long-lived secrets stored as CI variables are exfiltrated via a poisoned step, or derived/decoded secret values are echoed to build logs/artifacts without ::add-mask:: and harvested \u2014 the Codecov breach class (OWASP CICD-SEC-6).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
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
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

credential_hygiene_secrets_leaked_in_logs_artifacts[_credential_hygiene_secrets_leaked_in_logs_artifacts_def] if {
    not input.secrets_masked_in_logs
}

credential_hygiene_secrets_leaked_in_logs_artifacts[_credential_hygiene_secrets_leaked_in_logs_artifacts_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
}

credential_hygiene_secrets_leaked_in_logs_artifacts[_credential_hygiene_secrets_leaked_in_logs_artifacts_def] if {
    not input.secret_scanning_enabled
}

credential_hygiene_secrets_leaked_in_logs_artifacts[_credential_hygiene_secrets_leaked_in_logs_artifacts_def] if {
    not input.per_secret_access_scoping
}

exposures contains _credential_hygiene_secrets_leaked_in_logs_artifacts_def if {
    count(credential_hygiene_secrets_leaked_in_logs_artifacts) > 0
}

_missing_artifact_integrity_no_signed_provenance_def := {
    "name": "Missing artifact integrity / no signed provenance",
    "description": "The pipeline emits no signed SLSA in-toto provenance and deploy admission accepts unsigned, unverified artifacts (no cosign verify / policy gate), so a tampered or substituted build output reaches production \u2014 the SolarWinds build-system tampering class (OWASP CICD-SEC-9).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

missing_artifact_integrity_no_signed_provenance[_missing_artifact_integrity_no_signed_provenance_def] if {
    not input.artifact_supply_chain_signed_provenance_verified
    not input.required_signatures_enforced_on_deploy_ref
}

missing_artifact_integrity_no_signed_provenance[_missing_artifact_integrity_no_signed_provenance_def] if {
    not input.artifact_references_immutable_digest_pinned
}

exposures contains _missing_artifact_integrity_no_signed_provenance_def if {
    count(missing_artifact_integrity_no_signed_provenance) > 0
}

_insufficient_flow_control_weak_change_control_def := {
    "name": "Insufficient flow control / weak change control",
    "description": "Weak branch and environment protection \u2014 no required reviews, unsigned commits accepted, advisory (bypassable) status checks, force-pushes or admin bypass enabled, no environment-scoped reviewers \u2014 lets unreviewed code reach the deploy branch and be built and shipped without approval (OWASP CICD-SEC-1).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "attributes": {
                "justification": "Weak change control lets unreviewed/unsigned code reach the deploy branch and be built and shipped, enabling poisoned pipeline execution."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.deploy_ref_protected_branch_only
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.deploy_required_reviewers_configured
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    input.required_approving_review_count < 1
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.required_status_checks_strict
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.required_signatures_enforced_on_deploy_ref
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    input.force_pushes_allowed_on_deploy_ref == true
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.branch_protection_enforced_for_admins
}

insufficient_flow_control_weak_change_control[_insufficient_flow_control_weak_change_control_def] if {
    not input.deployment_environment_protection_configured
}

exposures contains _insufficient_flow_control_weak_change_control_def if {
    count(insufficient_flow_control_weak_change_control) > 0
}

_self_hosted_runner_compromise_open_egress_def := {
    "name": "Self-hosted runner compromise / open egress",
    "description": "A non-ephemeral self-hosted runner (especially on a public repo, shared across untrusted workloads) is compromised by untrusted PR code and persists as a privileged foothold; combined with unrestricted runner egress it becomes an exfiltration and C2 path (OWASP CICD-SEC-4; T1567).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584",
            "attributes": {
                "justification": "A compromised persistent self-hosted runner is attacker-controlled infrastructure within the victim's build environment \u2014 Compromise Infrastructure used as a privileged foothold for subsequent pipeline runs."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.001",
            "attributes": {
                "justification": "Unrestricted runner egress lets a poisoned build step exfiltrate secrets/source to an external code repository (Exfiltration to Code Repository) and provides a C2 path."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "attributes": {
                "justification": "Untrusted PR code executing on a shared/persistent self-hosted runner is the Poisoned Pipeline Execution primitive that compromises the runner in the first place."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

self_hosted_runner_compromise_open_egress[_self_hosted_runner_compromise_open_egress_def] if {
    input.self_hosted_runner_used == true
    not input.runner_ephemeral_jit
}

self_hosted_runner_compromise_open_egress[_self_hosted_runner_compromise_open_egress_def] if {
    input.self_hosted_runner_used == true
    input.repository_visibility == "public"
}

self_hosted_runner_compromise_open_egress[_self_hosted_runner_compromise_open_egress_def] if {
    input.self_hosted_runner_used == true
    not input.egress_default_deny_enforced
}

self_hosted_runner_compromise_open_egress[_self_hosted_runner_compromise_open_egress_def] if {
    input.self_hosted_runner_used == true
    not input.app_tier_egress_destination_allowlisted
}

exposures contains _self_hosted_runner_compromise_open_egress_def if {
    count(self_hosted_runner_compromise_open_egress) > 0
}

_insufficient_pipeline_logging_and_visibility_def := {
    "name": "Insufficient pipeline logging and visibility",
    "description": "Workflow runs, deployment approvals, secret access, and runner-registration events are not captured in a retained, off-box audit log streamed to a SIEM, so a build-system compromise goes undetected and unreconstructable (OWASP CICD-SEC-10; NIST SP 800-92).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Absent or non-retained off-box pipeline audit logging is precisely the condition an adversary exploits under Disable or Modify (Cloud) Logs \u2014 when logging is already insufficient, the build-system compromise produces no SIEM-visible trail, so the intrusion goes undetected and unreconstructable (OWASP CICD-SEC-10)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    not input.pipeline_run_audit_logging_enabled
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    not input.logs_stored_on_separate_system
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    not input.centralized_log_aggregation
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    not input.security_events_fully_logged
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    not input.access_audit_trail_enabled
}

insufficient_pipeline_logging_and_visibility[_insufficient_pipeline_logging_and_visibility_def] if {
    input.log_retention_days < 90
}

exposures contains _insufficient_pipeline_logging_and_visibility_def if {
    count(insufficient_pipeline_logging_and_visibility) > 0
}
