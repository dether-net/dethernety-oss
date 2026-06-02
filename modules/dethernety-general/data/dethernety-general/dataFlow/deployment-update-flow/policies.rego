package _dt_built_in.exposures.deployment_update_flow



_unsigned_unverified_artifact_admitted_slsa_bypass_def := {
    "name": "Unsigned/unverified artifact admitted (SLSA bypass)",
    "description": "The deploying environment pulls an image by tag without verifying a SLSA provenance attestation or cosign signature against a pinned builder identity, allowing a tampered or substituted artifact to land in production. Mitigated by mandatory admission-side cosign verify-attestation with pinned issuer/identity and digest-pinned subject matching.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.6,
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
            "value": "T1677",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unsigned_unverified_artifact_admitted_slsa_bypass[_unsigned_unverified_artifact_admitted_slsa_bypass_def] if {
    not input.artifact_supply_chain_signed_provenance_verified
}

exposures contains _unsigned_unverified_artifact_admitted_slsa_bypass_def if {
    count(unsigned_unverified_artifact_admitted_slsa_bypass) > 0
}

_unsigned_commits_reach_deploy_branch_def := {
    "name": "Unsigned commits reach deploy branch",
    "description": "Commits on the deploy ref are not cryptographically signed and the branch ruleset does not enforce required_signatures, so an attacker with push access (or a stolen PAT) can introduce unattributable changes that ride the channel into production. Mitigated by gitsign/GPG-signed commits plus a required_signatures branch rule on the deploy ref.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unsigned_commits_reach_deploy_branch[_unsigned_commits_reach_deploy_branch_def] if {
    not input.commits_signed
}

unsigned_commits_reach_deploy_branch[_unsigned_commits_reach_deploy_branch_def] if {
    not input.required_signatures_enforced_on_deploy_ref
}

exposures contains _unsigned_commits_reach_deploy_branch_def if {
    count(unsigned_commits_reach_deploy_branch) > 0
}

_shared_long_lived_ci_key_compromises_all_environments_def := {
    "name": "Shared long-lived CI key compromises all environments",
    "description": "CI authenticates to every target environment with a single static cloud credential rather than per-environment OIDC workload-identity-federation; a leaked or exfiltrated token collapses blast-radius to one key and gives the attacker deploy rights everywhere. Mitigated by federating short-lived OIDC tokens with trust pinned on repo/ref/environment subject claims.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078"
        }
    ],
    "attack_vector": "NETWORK"
}

shared_long_lived_ci_key_compromises_all_environments[_shared_long_lived_ci_key_compromises_all_environments_def] if {
    not input.cicd_pipeline_identity_per_environment_no_long_lived_keys
}

exposures contains _shared_long_lived_ci_key_compromises_all_environments_def if {
    count(shared_long_lived_ci_key_compromises_all_environments) > 0
}

_deploy_triggered_from_unprotected_branch_fork_def := {
    "name": "Deploy triggered from unprotected branch / fork",
    "description": "The deploy workflow fires on push to any branch with no environment protection rule restricting to protected branches and required reviewers, so an attacker who lands a feature branch or PR can ship malicious code straight to prod. Mitigated by GitHub environment deployment_branch_policy.protected_branches=true with required reviewers and a deploy-ref ruleset.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
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
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

deploy_triggered_from_unprotected_branch_fork[_deploy_triggered_from_unprotected_branch_fork_def] if {
    not input.deploy_ref_protected_branch_only
}

deploy_triggered_from_unprotected_branch_fork[_deploy_triggered_from_unprotected_branch_fork_def] if {
    not input.deploy_required_reviewers_configured
}

exposures contains _deploy_triggered_from_unprotected_branch_fork_def if {
    count(deploy_triggered_from_unprotected_branch_fork) > 0
}

_secrets_baked_into_artifact_instead_of_runtime_injected_def := {
    "name": "Secrets baked into artifact instead of runtime-injected",
    "description": "Credentials embedded in source, Dockerfile, or ConfigMap ride the channel into every environment and are exposed to anyone who pulls the image \u2014 the channel propagates the leak rather than containing it. Mitigated by deploy-time secret scanning (gitleaks/trufflehog/trivy) plus runtime-only injection from Vault/CSI/External-Secrets.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_baked_into_artifact_instead_of_runtime_injected[_secrets_baked_into_artifact_instead_of_runtime_injected_def] if {
    not input.secrets_injected_at_runtime_not_baked_in
}

secrets_baked_into_artifact_instead_of_runtime_injected[_secrets_baked_into_artifact_instead_of_runtime_injected_def] if {
    not input.secret_scanning_enabled
}

exposures contains _secrets_baked_into_artifact_instead_of_runtime_injected_def if {
    count(secrets_baked_into_artifact_instead_of_runtime_injected) > 0
}

_cleartext_or_downgraded_tls_on_registry_apiserver_channel_def := {
    "name": "Cleartext or downgraded TLS on registry/apiserver channel",
    "description": "The artifact pull or kube-apiserver deploy call traverses cleartext or accepts self-signed/legacy TLS, opening a classic AiTM substitution of the artifact or hijack of the deploy verb. Mitigated by TLS 1.2+ with strict cert chain validation and pinned CA bundles on every hop the flow traverses.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Cleartext or unvalidated TLS on the registry/apiserver channel is the textbook precondition for Adversary-in-the-Middle (T1557): the attacker interposes on the deploy flow and either substitutes the artifact in flight or hijacks the deploy API call."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_or_downgraded_tls_on_registry_apiserver_channel[_cleartext_or_downgraded_tls_on_registry_apiserver_channel_def] if {
    not input.flow_tls_encrypted
}

cleartext_or_downgraded_tls_on_registry_apiserver_channel[_cleartext_or_downgraded_tls_on_registry_apiserver_channel_def] if {
    not input.server_certificate_validated
}

exposures contains _cleartext_or_downgraded_tls_on_registry_apiserver_channel_def if {
    count(cleartext_or_downgraded_tls_on_registry_apiserver_channel) > 0
}

_mutable_tag_swap_after_verification_no_digest_pinning_def := {
    "name": "Mutable tag swap after verification (no digest pinning)",
    "description": "Manifests reference artifacts by mutable tag (`:latest`, `:prod`) rather than immutable `@sha256:` digest; policy verifies the tag at admission but the registry can later repoint that tag to a malicious digest that restarting pods will pull. Mitigated by digest-pinning every image reference so what was verified is exactly what runs.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036",
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

mutable_tag_swap_after_verification_no_digest_pinning[_mutable_tag_swap_after_verification_no_digest_pinning_def] if {
    not input.artifact_references_immutable_digest_pinned
}

exposures contains _mutable_tag_swap_after_verification_no_digest_pinning_def if {
    count(mutable_tag_swap_after_verification_no_digest_pinning) > 0
}

_no_central_audit_of_deploy_events_def := {
    "name": "No central audit of deploy events",
    "description": "Deploy events (actor, artifact digest, target env, signature-verification outcome) are not streamed to an out-of-account, tamper-evident SIEM, so post-incident attribution is guesswork and a compromised cluster admin can clear local logs. Mitigated by Kubernetes/cloud audit logs forwarded to immutable retention with the deploying account holding no delete rights.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
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
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_central_audit_of_deploy_events[_no_central_audit_of_deploy_events_def] if {
    not input.centralized_log_aggregation
}

no_central_audit_of_deploy_events[_no_central_audit_of_deploy_events_def] if {
    not input.audit_log_tamper_evident
}

exposures contains _no_central_audit_of_deploy_events_def if {
    count(no_central_audit_of_deploy_events) > 0
}

_out_of_band_drift_in_running_config_undetected_def := {
    "name": "Out-of-band drift in running config undetected",
    "description": "Direct kubectl/console changes in production bypass the audited flow and persist because there is no continuous reconciliation against the declared source-of-truth (GitOps, IaC) \u2014 the channel hides tampering done outside it. Mitigated by Argo CD/Flux self-heal reconciliation with drift alerts wired to SIEM.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.006",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

out_of_band_drift_in_running_config_undetected[_out_of_band_drift_in_running_config_undetected_def] if {
    not input.drift_detection_enabled
}

out_of_band_drift_in_running_config_undetected[_out_of_band_drift_in_running_config_undetected_def] if {
    not input.running_config_matches_baseline
}

exposures contains _out_of_band_drift_in_running_config_undetected_def if {
    count(out_of_band_drift_in_running_config_undetected) > 0
}
