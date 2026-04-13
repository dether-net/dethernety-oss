package _dt_built_in.exposures.artifact_repository



_unauthenticated_repository_access_def := {
    "name": "Unauthenticated Repository Access",
    "description": "Repository configured to allow anonymous read or write access, enabling unauthenticated retrieval of proprietary artifacts or injection of malicious packages into internal repositories without credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1593.003",
            "name": "Code Repositories",
            "relevance": "Unauthenticated access allows adversaries to enumerate and access code repositories without credentials."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Lack of authentication enables direct data collection from code repositories."
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_repository_access[_unauthenticated_repository_access_def] if {
    input.anonymous_access_enabled == true
    input.anonymous_access_scope in ["write", "read_write"]
}

unauthenticated_repository_access[_unauthenticated_repository_access_def] if {
    input.anonymous_access_enabled == true
    input.anonymous_access_scope in ["read", "read_write"]
    input.repository_visibility == "public"
}

exposures contains _unauthenticated_repository_access_def if {
    count(unauthenticated_repository_access) > 0
}

_dependency_confusion_via_proxy_routing_def := {
    "name": "Dependency Confusion Via Proxy Routing",
    "description": "Proxy or virtual repository configured to resolve package names against public registries before internal ones, allowing an attacker to publish a higher-versioned malicious package with the same internal package name on a public registry and have it served to build pipelines.",
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
            "relevance": "Dependency confusion attacks exploit proxy routing to substitute malicious packages for legitimate dependencies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Routing proxy misconfigurations can introduce poisoned dependencies into the build pipeline."
        }
    ],
    "attack_vector": "NETWORK"
}

dependency_confusion_via_proxy_routing[_dependency_confusion_via_proxy_routing_def] if {
    input.proxy_resolution_order in ["public_first", "public_only", "undefined"]
}

dependency_confusion_via_proxy_routing[_dependency_confusion_via_proxy_routing_def] if {
    input.upstream_public_registries_included == true
    not input.internal_package_namespaces_scoped
    not input.version_pinning_enforced
}

exposures contains _dependency_confusion_via_proxy_routing_def if {
    count(dependency_confusion_via_proxy_routing) > 0
}

_artifact_signing_not_enforced_def := {
    "name": "Artifact Signing Not Enforced",
    "description": "Repository does not require or validate artifact signatures (e.g., GPG, PGP, Sigstore) on upload or download, allowing unsigned or tampered binaries, libraries, or Helm charts to be stored and served without integrity verification.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036.001",
            "name": "Invalid Code Signature",
            "relevance": "Without enforced artifact signing, adversaries can distribute artifacts with invalid or missing signatures."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.001",
            "name": "Gatekeeper Bypass",
            "relevance": "Absence of signing enforcement allows bypassing trust controls that verify artifact authenticity."
        }
    ],
    "attack_vector": "NETWORK"
}

artifact_signing_not_enforced[_artifact_signing_not_enforced_def] if {
    not input.signature_verification_enforced
}

artifact_signing_not_enforced[_artifact_signing_not_enforced_def] if {
    not input.unsigned_artifact_upload_blocked
    not input.signature_verification_enforced
}

artifact_signing_not_enforced[_artifact_signing_not_enforced_def] if {
    input.proxy_remote_repositories_configured == true
    not input.signature_verification_enforced
}

exposures contains _artifact_signing_not_enforced_def if {
    count(artifact_signing_not_enforced) > 0
}

_overprivileged_service_account_credentials_def := {
    "name": "Overprivileged Service Account Credentials",
    "description": "Service accounts or API tokens used by CI/CD pipelines granted repository-wide write or admin permissions rather than scoped to specific repositories or artifact types, allowing a compromised pipeline to overwrite artifacts across all namespaces.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "name": "Cloud Accounts",
            "relevance": "Overprivileged service accounts provide attackers with excessive cloud access upon credential compromise."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.005",
            "name": "Temporary Elevated Cloud Access",
            "relevance": "Overprivileged service accounts may be abused to obtain or maintain elevated cloud access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Compromised overprivileged service account tokens can be used directly for unauthorized access."
        }
    ],
    "attack_vector": "NETWORK"
}

overprivileged_service_account_credentials[_overprivileged_service_account_credentials_def] if {
    input.service_account_permission_scope == "global_admin"
}

overprivileged_service_account_credentials[_overprivileged_service_account_credentials_def] if {
    input.service_account_permission_scope == "repository_wide_write"
}

overprivileged_service_account_credentials[_overprivileged_service_account_credentials_def] if {
    input.service_account_permission_scope == "scoped_write"
    input.permission_grant_uses_wildcard == true
}

overprivileged_service_account_credentials[_overprivileged_service_account_credentials_def] if {
    input.pipeline_token_can_overwrite_artifacts == true
    input.permission_grant_uses_wildcard == true
}

exposures contains _overprivileged_service_account_credentials_def if {
    count(overprivileged_service_account_credentials) > 0
}

_unencrypted_artifact_transport_def := {
    "name": "Unencrypted Artifact Transport",
    "description": "Repository accessible over plain HTTP rather than HTTPS, or TLS certificate validation disabled in client configurations, exposing artifact downloads to interception and modification in transit.",
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
            "relevance": "Unencrypted transport exposes artifacts to interception and exfiltration over unprotected channels."
        }
    ],
    "attack_vector": "NETWORK"
}

unencrypted_artifact_transport[_unencrypted_artifact_transport_def] if {
    input.repository_url_scheme == "http"
}

unencrypted_artifact_transport[_unencrypted_artifact_transport_def] if {
    not input.tls_certificate_validation_enabled
}

exposures contains _unencrypted_artifact_transport_def if {
    count(unencrypted_artifact_transport) > 0
}

_storage_at_rest_encryption_disabled_def := {
    "name": "Storage At Rest Encryption Disabled",
    "description": "Underlying storage backend for artifact blobs and metadata not encrypted at rest, allowing physical or logical access to storage volumes to expose proprietary binaries, internal package content, or credential-embedded artifacts.",
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
            "relevance": "Disabled encryption at rest makes cloud-stored artifacts directly readable if storage is accessed."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.006",
            "name": "Cloud Secrets Management Stores",
            "relevance": "Unencrypted storage may expose secrets and credentials stored alongside artifacts."
        }
    ],
    "attack_vector": "LOCAL"
}

storage_at_rest_encryption_disabled[_storage_at_rest_encryption_disabled_def] if {
    not input.storage_encryption_enabled
}

storage_at_rest_encryption_disabled[_storage_at_rest_encryption_disabled_def] if {
    input.storage_encryption_enabled == true
    input.encryption_key_management == "none"
}

exposures contains _storage_at_rest_encryption_disabled_def if {
    count(storage_at_rest_encryption_disabled) > 0
}

_unrestricted_artifact_overwrite_def := {
    "name": "Unrestricted Artifact Overwrite",
    "description": "Repository permits overwriting immutable or released artifact versions (e.g., disabling immutable releases), enabling an attacker with write access to silently replace a production artifact version with a backdoored one without version number change.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1554",
            "name": "Compromise Host Software Binary",
            "relevance": "Unrestricted overwrite allows adversaries to replace legitimate artifacts with malicious binaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1677",
            "name": "Poisoned Pipeline Execution",
            "relevance": "Overwriting artifacts in a repository can inject malicious content into the build/delivery pipeline."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Unrestricted overwrite enables supply chain compromise by replacing trusted dependencies."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_artifact_overwrite[_unrestricted_artifact_overwrite_def] if {
    not input.immutable_artifacts_enforced
}

unrestricted_artifact_overwrite[_unrestricted_artifact_overwrite_def] if {
    input.write_access_scope in ["internal_users", "external_or_anonymous"]
    not input.artifact_signing_verified_on_publish
    not input.immutable_artifacts_enforced
}

exposures contains _unrestricted_artifact_overwrite_def if {
    count(unrestricted_artifact_overwrite) > 0
}

_insufficiently_scoped_proxy_allow_list_def := {
    "name": "Insufficiently Scoped Proxy Allow List",
    "description": "Remote proxy repositories configured without domain or package-name allow lists, permitting download of arbitrary external packages including known-malicious or typosquatted packages directly through the internal repository.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.002",
            "name": "External Proxy",
            "relevance": "An overly broad proxy allow list can permit traffic routing through unauthorized external proxies."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "Insufficient scoping allows adversaries to chain proxies to obscure malicious traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

insufficiently_scoped_proxy_allow_list[_insufficiently_scoped_proxy_allow_list_def] if {
    not input.proxy_allow_list_enabled
    not input.upstream_url_restricted
}

insufficiently_scoped_proxy_allow_list[_insufficiently_scoped_proxy_allow_list_def] if {
    not input.proxy_allow_list_enabled
    input.proxy_repository_type in ["npm", "pypi", "go", "nuget"]
}

exposures contains _insufficiently_scoped_proxy_allow_list_def if {
    count(insufficiently_scoped_proxy_allow_list) > 0
}

_secrets_embedded_in_artifact_metadata_def := {
    "name": "Secrets Embedded In Artifact Metadata",
    "description": "Build metadata, POM files, Helm chart values, or package descriptors stored in the repository contain embedded secrets such as API keys or database credentials, which are indexable and retrievable by any user with read access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Secrets embedded in artifact metadata represent unsecured credentials exposed to anyone accessing the artifact."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Artifact metadata in repositories can be mined to extract embedded secrets and credentials."
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_embedded_in_artifact_metadata[_secrets_embedded_in_artifact_metadata_def] if {
    count(input.detected_secret_patterns_in_metadata) > 0
    not input.secret_scanning_enabled
    input.metadata_read_access_scope in ["anonymous", "authenticated_users"]
}

secrets_embedded_in_artifact_metadata[_secrets_embedded_in_artifact_metadata_def] if {
    count(input.detected_secret_patterns_in_metadata) > 0
    input.metadata_read_access_scope == "anonymous"
}

exposures contains _secrets_embedded_in_artifact_metadata_def if {
    count(secrets_embedded_in_artifact_metadata) > 0
}

_missing_or_incomplete_audit_logging_def := {
    "name": "Missing Or Incomplete Audit Logging",
    "description": "Repository not configured to log artifact upload, download, deletion, or permission change events, or logs not forwarded to a SIEM, preventing detection of unauthorized access, artifact tampering, or data exfiltration.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1654",
            "name": "Log Enumeration",
            "relevance": "Incomplete audit logging limits detection of adversarial log enumeration and tampering activities."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602",
            "name": "Data from Configuration Repository",
            "relevance": "Without complete audit logs, unauthorized access to configuration repositories goes undetected."
        }
    ]
}

missing_or_incomplete_audit_logging[_missing_or_incomplete_audit_logging_def] if {
    not input.audit_logging_enabled
}

missing_or_incomplete_audit_logging[_missing_or_incomplete_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "upload" in input.audit_log_event_coverage
}

missing_or_incomplete_audit_logging[_missing_or_incomplete_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "delete" in input.audit_log_event_coverage
}

missing_or_incomplete_audit_logging[_missing_or_incomplete_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "permission_change" in input.audit_log_event_coverage
}

missing_or_incomplete_audit_logging[_missing_or_incomplete_audit_logging_def] if {
    input.audit_logging_enabled == true
    not input.siem_forwarding_configured
}

exposures contains _missing_or_incomplete_audit_logging_def if {
    count(missing_or_incomplete_audit_logging) > 0
}

_repository_software_not_patched_def := {
    "name": "Repository Software Not Patched",
    "description": "Artifact repository software running outdated versions with known CVEs, including vulnerabilities in dependency resolution engines, metadata parsers, or REST API endpoints, increasing exploitation risk.",
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
            "relevance": "Unpatched repository software contains known vulnerabilities that can be exploited by attackers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Unpatched repository tools can be compromised to affect software dependencies distributed through them."
        }
    ],
    "attack_vector": "NETWORK"
}

repository_software_not_patched[_repository_software_not_patched_def] if {
    input.version_has_known_cve == true
    input.patch_available == true
}

repository_software_not_patched[_repository_software_not_patched_def] if {
    input.version_has_known_cve == true
    input.days_since_last_patch > 30
}

exposures contains _repository_software_not_patched_def if {
    count(repository_software_not_patched) > 0
}

_network_exposure_without_segmentation_def := {
    "name": "Network Exposure Without Segmentation",
    "description": "Repository admin interface or artifact API exposed on public or flat network segments without firewall rules, IP allowlists, or VPN requirements, increasing the attack surface for credential brute-forcing or exploitation.",
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
            "relevance": "Network exposure without segmentation makes the repository directly reachable for exploitation attempts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Unsegmented network access allows broader adversarial access to collect data from code repositories."
        }
    ],
    "attack_vector": "NETWORK"
}

network_exposure_without_segmentation[_network_exposure_without_segmentation_def] if {
    input.network_exposure_scope == "public_internet"
    not input.ip_allowlist_enforced
    not input.vpn_or_bastion_required
}

network_exposure_without_segmentation[_network_exposure_without_segmentation_def] if {
    input.network_exposure_scope == "flat_internal"
    not input.ip_allowlist_enforced
    not input.vpn_or_bastion_required
}

exposures contains _network_exposure_without_segmentation_def if {
    count(network_exposure_without_segmentation) > 0
}

_inadequate_repository_permission_segmentation_def := {
    "name": "Inadequate Repository Permission Segmentation",
    "description": "All artifact repositories grouped under a single permission scope rather than separated by sensitivity (e.g., release artifacts vs. internal dev artifacts), allowing a user with access to one artifact type to read or write all others.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Poor permission segmentation allows unauthorized users to access and collect data from code repositories."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1069.003",
            "name": "Cloud Groups",
            "relevance": "Adversaries can enumerate cloud permission groups to identify and exploit inadequate repository segmentation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1069",
            "name": "Permission Groups Discovery",
            "relevance": "Insufficient permission segmentation enables discovery and abuse of overly permissive repository access groups."
        }
    ],
    "attack_vector": "NETWORK"
}

inadequate_repository_permission_segmentation[_inadequate_repository_permission_segmentation_def] if {
    input.repository_permission_scopes_count == 1
    count(input.sensitivity_tiers_represented) > 1
}

inadequate_repository_permission_segmentation[_inadequate_repository_permission_segmentation_def] if {
    input.cross_tier_write_access_permitted == true
    count(input.sensitivity_tiers_represented) > 1
}

exposures contains _inadequate_repository_permission_segmentation_def if {
    count(inadequate_repository_permission_segmentation) > 0
}

_checksum_validation_disabled_on_proxy_cache_def := {
    "name": "Checksum Validation Disabled On Proxy Cache",
    "description": "Proxied or cached artifacts not validated against upstream-published checksums (SHA-256, MD5) before being served to clients, allowing corrupted or tampered cached artifacts to be distributed internally.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.004",
            "name": "CDNs",
            "relevance": "Disabled checksum validation on proxy caches enables serving of tampered artifacts from cached/CDN content."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.003",
            "name": "Multi-hop Proxy",
            "relevance": "Without checksum validation, malicious content can be injected through proxy cache manipulation."
        }
    ],
    "attack_vector": "NETWORK"
}

checksum_validation_disabled_on_proxy_cache[_checksum_validation_disabled_on_proxy_cache_def] if {
    input.proxy_cache_enabled == true
    not input.checksum_validation_enabled
}

exposures contains _checksum_validation_disabled_on_proxy_cache_def if {
    count(checksum_validation_disabled_on_proxy_cache) > 0
}

_excessive_retention_without_cleanup_policies_def := {
    "name": "Excessive Retention Without Cleanup Policies",
    "description": "No artifact retention or cleanup policies configured, causing unbounded accumulation of stale, vulnerable, or deprecated artifact versions that remain accessible and consumable by build pipelines without review.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Missing lifecycle/cleanup policies directly relate to uncontrolled artifact retention and deletion management."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1564",
            "name": "Hide Artifacts",
            "relevance": "Excessive retention without cleanup can allow stale or malicious artifacts to persist and remain hidden."
        }
    ]
}

excessive_retention_without_cleanup_policies[_excessive_retention_without_cleanup_policies_def] if {
    not input.cleanup_policies_configured
}

excessive_retention_without_cleanup_policies[_excessive_retention_without_cleanup_policies_def] if {
    not input.cleanup_policies_configured
    input.oldest_artifact_age_days > 365
}

exposures contains _excessive_retention_without_cleanup_policies_def if {
    count(excessive_retention_without_cleanup_policies) > 0
}

_tls_certificate_expiry_not_monitored_def := {
    "name": "Tls Certificate Expiry Not Monitored",
    "description": "TLS certificates for repository HTTPS endpoints not monitored for expiry, leading to service outages or insecure fallback behavior in clients configured to ignore certificate errors when certs expire.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Unmonitored certificate expiry creates opportunities for adversaries to exploit expired or substituted certificates."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.003",
            "name": "Digital Certificates",
            "relevance": "Expired TLS certificates can be identified and exploited by adversaries through reconnaissance of digital certificates."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_certificate_expiry_not_monitored[_tls_certificate_expiry_not_monitored_def] if {
    not input.cert_expiry_monitoring_enabled
    input.days_until_cert_expiry <= 30
}

tls_certificate_expiry_not_monitored[_tls_certificate_expiry_not_monitored_def] if {
    not input.cert_expiry_monitoring_enabled
    input.client_tls_verification_disabled == true
}

exposures contains _tls_certificate_expiry_not_monitored_def if {
    count(tls_certificate_expiry_not_monitored) > 0
}

_backup_and_recovery_not_configured_def := {
    "name": "Backup And Recovery Not Configured",
    "description": "Artifact repository storage not backed up, or backups untested for restoration, creating a single point of failure where ransomware, accidental deletion, or storage failure results in permanent loss of build artifacts critical to software delivery.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "name": "Inhibit System Recovery",
            "relevance": "Without backup and recovery configuration, adversaries can more effectively inhibit system recovery after an attack."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Absence of backup policies amplifies the impact of data destruction attacks against the repository."
        }
    ]
}

backup_and_recovery_not_configured[_backup_and_recovery_not_configured_def] if {
    not input.backup_enabled
}

backup_and_recovery_not_configured[_backup_and_recovery_not_configured_def] if {
    input.backup_enabled == true
    not input.backup_restoration_tested
}

backup_and_recovery_not_configured[_backup_and_recovery_not_configured_def] if {
    input.backup_enabled == true
    input.backup_retention_days == 0
}

exposures contains _backup_and_recovery_not_configured_def if {
    count(backup_and_recovery_not_configured) > 0
}
