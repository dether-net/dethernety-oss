package _dt_built_in.exposures.source_code_artifact_repository



_weak_access_control_maintainer_account_takeover_def := {
    "name": "Weak access control / maintainer account takeover",
    "description": "Human access not gated by enterprise SSO with phishing-resistant MFA (WebAuthn/FIDO2) \u2014 local accounts allowed, MFA optional or SMS-based \u2014 lets a phished or password-sprayed maintainer credential become a valid-account foothold at the supply-chain root, compounded by over-broad base permissions (Write/Admin default) and many org owners. The attacker can push code, alter settings, and exfiltrate private source.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Weak access control with no phishing-resistant MFA, shared admin accounts, and over-broad roles lets an attacker operate with a legitimate maintainer's valid account at the supply-chain root."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {
                "justification": "Absent phishing-resistant (WebAuthn/FIDO2) MFA, maintainer credentials are takeable via phishing, the primary path to the account-takeover foothold."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    not input.sso_with_phishing_resistant_mfa_enforced
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    not input.mfa_available
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    not input.least_privilege_access_enforced
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    input.shared_admin_accounts == true
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    not input.external_collaborator_access_controlled
}

weak_access_control_maintainer_account_takeover[_weak_access_control_maintainer_account_takeover_def] if {
    not input.no_anonymous_access_to_private_repos
}

exposures contains _weak_access_control_maintainer_account_takeover_def if {
    count(weak_access_control_maintainer_account_takeover) > 0
}

_missing_branch_repo_integrity_controls_def := {
    "name": "Missing branch/repo integrity controls",
    "description": "Without protected-branch rulesets \u2014 no required pull request with approving reviews, no required CODEOWNERS review, force-push and branch deletion permitted, no required_signatures \u2014 an insider or compromised account injects malicious code straight into the default branch or rewrites history, silently tampering the integrity baseline that flows downstream to every consumer.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

missing_branch_repo_integrity_controls[_missing_branch_repo_integrity_controls_def] if {
    not input.branch_protection_required_reviews_enabled
}

missing_branch_repo_integrity_controls[_missing_branch_repo_integrity_controls_def] if {
    not input.force_push_blocked_on_default_branch
}

missing_branch_repo_integrity_controls[_missing_branch_repo_integrity_controls_def] if {
    not input.required_status_checks_enforced
}

missing_branch_repo_integrity_controls[_missing_branch_repo_integrity_controls_def] if {
    not input.signed_commits_required
}

missing_branch_repo_integrity_controls[_missing_branch_repo_integrity_controls_def] if {
    not input.protected_immutable_tags
}

exposures contains _missing_branch_repo_integrity_controls_def if {
    count(missing_branch_repo_integrity_controls) > 0
}

_unsigned_unverified_artifacts_with_no_provenance_def := {
    "name": "Unsigned / unverified artifacts with no provenance",
    "description": "Absent Sigstore/cosign keyless signing with a deploy-time `cosign verify` gate (pinned certificate-identity + oidc-issuer), absent SLSA provenance attestation, and with mutable release tags, a swapped or re-pushed artifact/image propagates to every deployment \u2014 a software supply-chain compromise the consumer cannot detect because origin and integrity are unverifiable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
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

unsigned_unverified_artifacts_with_no_provenance[_unsigned_unverified_artifacts_with_no_provenance_def] if {
    not input.artifact_signing_enabled
}

unsigned_unverified_artifacts_with_no_provenance[_unsigned_unverified_artifacts_with_no_provenance_def] if {
    not input.artifact_signature_verified_at_deploy
}

unsigned_unverified_artifacts_with_no_provenance[_unsigned_unverified_artifacts_with_no_provenance_def] if {
    not input.slsa_provenance_attested
}

unsigned_unverified_artifacts_with_no_provenance[_unsigned_unverified_artifacts_with_no_provenance_def] if {
    not input.immutable_artifact_tags_enforced
}

exposures contains _unsigned_unverified_artifacts_with_no_provenance_def if {
    count(unsigned_unverified_artifacts_with_no_provenance) > 0
}

_over_privileged_ci_tokens_oidc_federation_failures_def := {
    "name": "Over-privileged CI tokens / OIDC federation failures",
    "description": "A write-all default GITHUB_TOKEN (no per-workflow `permissions: { contents: read }` block) or long-lived PATs / static cloud access keys stored as Actions secrets instead of short-lived OIDC (`id-token: write`) scoped by the `sub` claim let compromised workflow code tamper with repos or pivot into cloud; a wildcard OIDC trust subject defeats the federation boundary even when OIDC is used.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
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
            "value": "T1078",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_ci_tokens_oidc_federation_failures[_over_privileged_ci_tokens_oidc_federation_failures_def] if {
    not input.oidc_short_lived_tokens_used
}

over_privileged_ci_tokens_oidc_federation_failures[_over_privileged_ci_tokens_oidc_federation_failures_def] if {
    not input.workflow_token_least_privilege
}

over_privileged_ci_tokens_oidc_federation_failures[_over_privileged_ci_tokens_oidc_federation_failures_def] if {
    not input.ci_secrets_scoped_not_broad
}

exposures contains _over_privileged_ci_tokens_oidc_federation_failures_def if {
    count(over_privileged_ci_tokens_oidc_federation_failures) > 0
}

_secrets_committed_to_repo_with_no_push_protection_def := {
    "name": "Secrets committed to repo with no push protection",
    "description": "With secret scanning and push protection disabled (default-off), API keys and tokens land in git history and build logs and persist after the commit is removed, where they are harvested for lateral movement and further supply-chain access.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "With secret scanning and push protection disabled, credentials committed to the repository (or leaked in build logs / absent a secret manager) become unsecured credentials an attacker harvests."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Secrets committed into git history or printed in build logs are credentials in files, harvested from the repo for lateral movement."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_committed_to_repo_with_no_push_protection[_secrets_committed_to_repo_with_no_push_protection_def] if {
    not input.secret_scanning_enabled
}

secrets_committed_to_repo_with_no_push_protection[_secrets_committed_to_repo_with_no_push_protection_def] if {
    not input.push_protection_enabled
}

secrets_committed_to_repo_with_no_push_protection[_secrets_committed_to_repo_with_no_push_protection_def] if {
    not input.secrets_not_in_build_logs
}

secrets_committed_to_repo_with_no_push_protection[_secrets_committed_to_repo_with_no_push_protection_def] if {
    not input.secrets_in_secret_manager_not_repo
}

exposures contains _secrets_committed_to_repo_with_no_push_protection_def if {
    count(secrets_committed_to_repo_with_no_push_protection) > 0
}

_dependency_confusion_malicious_dependency_def := {
    "name": "Dependency confusion / malicious dependency",
    "description": "Unscoped internal package names plus a private registry that proxies or falls back to the public registry on a miss, with no committed lockfile pinning and no SCA block-on-vulnerability gate, let an attacker publish a higher-versioned public package that resolves into builds and executes attacker code at build time.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "attributes": {
                "justification": "Unscoped internal package names with public-fallback resolution and no SCA blocking gate let an attacker compromise the build by substituting a malicious public dependency for an internal one."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
            "attributes": {
                "justification": "Dependency confusion is a software supply-chain compromise: attacker code is pulled into trusted builds via the dependency-resolution path."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

dependency_confusion_malicious_dependency[_dependency_confusion_malicious_dependency_def] if {
    not input.internal_packages_scoped_no_public_fallback
}

dependency_confusion_malicious_dependency[_dependency_confusion_malicious_dependency_def] if {
    not input.dependency_versions_pinned_lockfile
}

dependency_confusion_malicious_dependency[_dependency_confusion_malicious_dependency_def] if {
    not input.dependency_vuln_scanning_block_on_critical
}

dependency_confusion_malicious_dependency[_dependency_confusion_malicious_dependency_def] if {
    not input.package_sources_allowlisted
}

exposures contains _dependency_confusion_malicious_dependency_def if {
    count(dependency_confusion_malicious_dependency) > 0
}

_webhook_third_party_integration_trust_abuse_def := {
    "name": "Webhook / third-party integration trust abuse",
    "description": "Webhook payloads not authenticated via shared-secret HMAC (no X-Hub-Signature-256 verification) accept spoofed deliveries, and over-scoped installed apps or leaked OAuth tokens give an attacker a trusted-relationship path into the repo without ever taking over a human account.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

webhook_third_party_integration_trust_abuse[_webhook_third_party_integration_trust_abuse_def] if {
    not input.webhook_signature_verified
}

webhook_third_party_integration_trust_abuse[_webhook_third_party_integration_trust_abuse_def] if {
    not input.third_party_app_scope_least_privilege
}

webhook_third_party_integration_trust_abuse[_webhook_third_party_integration_trust_abuse_def] if {
    not input.installed_integrations_reviewed_approved
}

exposures contains _webhook_third_party_integration_trust_abuse_def if {
    count(webhook_third_party_integration_trust_abuse) > 0
}

_missing_encryption_audit_logging_gaps_def := {
    "name": "Missing encryption + audit-logging gaps",
    "description": "Plaintext HTTP/git protocol or non-enforced TLS 1.2+/1.3 exposes clone/push/pull and API traffic, unencrypted at-rest storage exposes repos and artifacts, and with audit-log streaming off (web-only short retention, Git push events not even visible) anomalous access and admin changes go uncaptured off-host and unalerted \u2014 defeating detection of every other vector.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {
                "justification": "Unencrypted in-transit/at-rest repositories plus weak audit visibility ease unauthorized reading and harvesting of source, secrets, and IP from the central information repository."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {
                "justification": "Absent off-host audit-log streaming, short retention, and missing anomaly alerting impair defensive telemetry, letting repository access abuse proceed undetected."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.tls_only_transport
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.encrypted_at_rest
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.audit_log_streaming_enabled
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.logs_stored_on_separate_system
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    input.log_retention_days < 90
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.anomaly_alerting_on_access
}

missing_encryption_audit_logging_gaps[_missing_encryption_audit_logging_gaps_def] if {
    not input.data_residency_region_pinned
}

exposures contains _missing_encryption_audit_logging_gaps_def if {
    count(missing_encryption_audit_logging_gaps) > 0
}

_network_exposure_self_hosted_runner_unpatched_instance_def := {
    "name": "Network exposure / self-hosted runner & unpatched instance",
    "description": "Persistent shared self-hosted runners attached to public repos execute attacker-supplied PR code (a backdoor into the build environment), and an internet-exposed, unpatched self-hosted GitLab/Artifactory/Nexus instance is exploitable via a known CVE (CISA KEV / vendor advisory) \u2014 either path compromises the supply-chain root remotely.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1133",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

network_exposure_self_hosted_runner_unpatched_instance[_network_exposure_self_hosted_runner_unpatched_instance_def] if {
    not input.self_hosted_runner_isolated_ephemeral
}

network_exposure_self_hosted_runner_unpatched_instance[_network_exposure_self_hosted_runner_unpatched_instance_def] if {
    input.unpatched_known_rce_cve == true
}

network_exposure_self_hosted_runner_unpatched_instance[_network_exposure_self_hosted_runner_unpatched_instance_def] if {
    not input.edge_appliance_patched_within_sla
}

network_exposure_self_hosted_runner_unpatched_instance[_network_exposure_self_hosted_runner_unpatched_instance_def] if {
    not input.control_plane_api_not_publicly_exposed
}

network_exposure_self_hosted_runner_unpatched_instance[_network_exposure_self_hosted_runner_unpatched_instance_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposures contains _network_exposure_self_hosted_runner_unpatched_instance_def if {
    count(network_exposure_self_hosted_runner_unpatched_instance) > 0
}
