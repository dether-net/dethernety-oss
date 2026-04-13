package _dt_built_in.exposures.container_registry

_unauthenticated_registry_access_def := {
    "name": "Unauthenticated Registry Access",
    "description": "Registry configured to allow anonymous pull or push operations without requiring authentication credentials, permitting any network-adjacent actor to retrieve potentially sensitive images or inject malicious layers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.002",
            "name": "Credentials in Registry",
            "relevance": "Unauthenticated access to a registry can expose credentials stored within it, making this the most directly relevant technique."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1012",
            "name": "Query Registry",
            "relevance": "Unauthenticated registry access enables adversaries to query the registry for sensitive configuration and credential information."
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_registry_access[_unauthenticated_registry_access_def] if {
    input.anonymous_pull_enabled == true
    input.network_exposure == "public"
}

unauthenticated_registry_access[_unauthenticated_registry_access_def] if {
    input.anonymous_pull_enabled == true
    input.network_exposure in ["internal", "localhost"]
}

unauthenticated_registry_access[_unauthenticated_registry_access_def] if {
    input.anonymous_push_enabled == true
}

exposures contains _unauthenticated_registry_access_def if {
    count(unauthenticated_registry_access) > 0
}

_missing_tls_enforcement_def := {
    "name": "Missing Tls Enforcement",
    "description": "Registry endpoint accessible over plaintext HTTP or configured with TLS versions below 1.2, enabling interception and modification of image manifests and layer blobs in transit between clients and the registry.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.002",
            "name": "Credentials in Registry",
            "relevance": "Without TLS enforcement, credentials transmitted to or from the registry can be intercepted in transit."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_tls_enforcement[_missing_tls_enforcement_def] if {
    not input.tls_enabled
}

missing_tls_enforcement[_missing_tls_enforcement_def] if {
    input.tls_enabled == true
    input.minimum_tls_version in ["TLS_1_0", "TLS_1_1"]
}

missing_tls_enforcement[_missing_tls_enforcement_def] if {
    input.tls_enabled == true
    not input.certificate_valid
}

exposures contains _missing_tls_enforcement_def if {
    count(missing_tls_enforcement) > 0
}

_overly_permissive_push_authorization_def := {
    "name": "Overly Permissive Push Authorization",
    "description": "Role-based access controls grant push permissions to broad groups (e.g., all authenticated users, service accounts) rather than scoped pipeline identities, allowing unauthorized parties to overwrite production image tags with malicious content.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.003",
            "name": "Additional Cloud Roles",
            "relevance": "Overly permissive push authorization reflects excessive cloud role assignments that allow unauthorized parties to push images."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.006",
            "name": "Additional Container Cluster Roles",
            "relevance": "Excessive push permissions map directly to container cluster role abuse, enabling adversaries to introduce malicious images."
        }
    ],
    "attack_vector": "NETWORK"
}

overly_permissive_push_authorization[_overly_permissive_push_authorization_def] if {
    input.push_permission_scope in ["all_authenticated_users", "wildcard_group", "anonymous"]
}

overly_permissive_push_authorization[_overly_permissive_push_authorization_def] if {
    "human_user" in input.push_identity_types_granted
    not input.production_tag_overwrite_protected
}

overly_permissive_push_authorization[_overly_permissive_push_authorization_def] if {
    "broad_group" in input.push_identity_types_granted
    not input.production_tag_overwrite_protected
}

exposures contains _overly_permissive_push_authorization_def if {
    count(overly_permissive_push_authorization) > 0
}

_image_signing_and_verification_disabled_def := {
    "name": "Image Signing And Verification Disabled",
    "description": "Registry lacks enforcement of image signature verification (e.g., Notary/Cosign policy) at push or pull time, allowing unsigned or tampered images to be stored and served without integrity validation.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.006",
            "name": "Code Signing Policy Modification",
            "relevance": "Disabling image signing and verification is analogous to subverting code signing policies, allowing unsigned or malicious images to run."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036.001",
            "name": "Invalid Code Signature",
            "relevance": "Without signing enforcement, adversaries can deploy images with invalid or absent signatures to masquerade as legitimate content."
        }
    ],
    "attack_vector": "NETWORK"
}

image_signing_and_verification_disabled[_image_signing_and_verification_disabled_def] if {
    not input.signature_verification_policy_enforced
}

image_signing_and_verification_disabled[_image_signing_and_verification_disabled_def] if {
    input.signature_verification_policy_enforced == true
    input.signature_enforcement_mode in ["audit", "disabled"]
}

image_signing_and_verification_disabled[_image_signing_and_verification_disabled_def] if {
    input.signature_verification_policy_enforced == true
    input.signature_enforcement_mode == "enforce"
    not input.trusted_signing_keys_configured
}

exposures contains _image_signing_and_verification_disabled_def if {
    count(image_signing_and_verification_disabled) > 0
}

_secrets_embedded_in_image_layers_def := {
    "name": "Secrets Embedded In Image Layers",
    "description": "Production images stored in the registry contain hardcoded credentials, API keys, or certificates embedded in filesystem layers or image history. Without layer scanning controls, these secrets are exfiltrable by any authenticated pull client.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Secrets embedded in image layers are stored as files within those layers, directly matching credentials-in-files exposure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Private keys are a common type of secret embedded in container image layers, representing a high-value credential exposure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "name": "Implant Internal Image",
            "relevance": "Adversaries can implant images containing embedded secrets to persist access or exfiltrate credentials via the registry."
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_embedded_in_image_layers[_secrets_embedded_in_image_layers_def] if {
    not input.layer_secret_scanning_enabled
    input.secrets_detected_in_layers > 0
}

secrets_embedded_in_image_layers[_secrets_embedded_in_image_layers_def] if {
    not input.layer_secret_scanning_enabled
    input.image_pull_access_scope in ["authenticated_users", "public"]
}

secrets_embedded_in_image_layers[_secrets_embedded_in_image_layers_def] if {
    input.secrets_detected_in_layers > 0
    input.image_pull_access_scope == "public"
}

exposures contains _secrets_embedded_in_image_layers_def if {
    count(secrets_embedded_in_image_layers) > 0
}

_missing_vulnerability_scanning_integration_def := {
    "name": "Missing Vulnerability Scanning Integration",
    "description": "Registry is not integrated with a container image vulnerability scanner, allowing images with known CVEs in OS packages or application dependencies to be promoted to production orchestration platforms without detection.",
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
            "relevance": "Without vulnerability scanning, malicious or vulnerable images can be implanted into the registry and go undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1612",
            "name": "Build Image on Host",
            "relevance": "Lack of scanning integration allows adversaries to build and push vulnerable images that evade detection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Unscanned images may contain vulnerabilities that enable container escape to the host system."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_vulnerability_scanning_integration[_missing_vulnerability_scanning_integration_def] if {
    not input.vulnerability_scanner_integrated
}

missing_vulnerability_scanning_integration[_missing_vulnerability_scanning_integration_def] if {
    input.vulnerability_scanner_integrated == true
    not input.scan_on_push_enforced
    input.promotion_gate_cve_threshold == "none"
}

exposures contains _missing_vulnerability_scanning_integration_def if {
    count(missing_vulnerability_scanning_integration) > 0
}

_weak_or_shared_service_account_credentials_def := {
    "name": "Weak Or Shared Service Account Credentials",
    "description": "Pipeline and orchestration platform integrations authenticate to the registry using long-lived, shared credentials or tokens without rotation policies, increasing the blast radius of a single credential compromise.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.001",
            "name": "Additional Cloud Credentials",
            "relevance": "Weak or shared service account credentials can be leveraged to add or escalate cloud credentials for persistent access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "name": "Steal Application Access Token",
            "relevance": "Shared service account tokens are prime targets for theft, enabling adversaries to authenticate as the service account."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "name": "Application Access Token",
            "relevance": "Weak service account credentials may result in token reuse or theft, allowing adversaries to use application access tokens for lateral movement."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_shared_service_account_credentials[_weak_or_shared_service_account_credentials_def] if {
    input.credential_scope == "shared"
    not input.credential_rotation_policy_enabled
}

weak_or_shared_service_account_credentials[_weak_or_shared_service_account_credentials_def] if {
    input.credential_max_age_days > 90
}

weak_or_shared_service_account_credentials[_weak_or_shared_service_account_credentials_def] if {
    not input.credential_rotation_policy_enabled
    input.credential_max_age_days == 0
}

exposures contains _weak_or_shared_service_account_credentials_def if {
    count(weak_or_shared_service_account_credentials) > 0
}

_unrestricted_network_exposure_def := {
    "name": "Unrestricted Network Exposure",
    "description": "Registry API and storage endpoints are reachable from untrusted network segments without firewall rules or network policies restricting access to known CI/CD and orchestration platform CIDR ranges.",
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
            "relevance": "An unrestricted network-exposed registry acts like a deployment tool accessible to adversaries for pushing or pulling malicious images."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_network_exposure[_unrestricted_network_exposure_def] if {
    input.registry_network_exposure_scope == "public"
}

unrestricted_network_exposure[_unrestricted_network_exposure_def] if {
    not input.network_policy_enforced
    input.registry_network_exposure_scope != "restricted_trusted"
}

unrestricted_network_exposure[_unrestricted_network_exposure_def] if {
    not input.network_policy_enforced
    count(input.approved_source_cidr_ranges) == 0
}

exposures contains _unrestricted_network_exposure_def if {
    count(unrestricted_network_exposure) > 0
}

_unencrypted_backend_storage_def := {
    "name": "Unencrypted Backend Storage",
    "description": "Image layer blobs and manifests stored on backend object storage or block volumes are not encrypted at rest, enabling direct exfiltration of image data through storage-layer access bypassing registry authentication.",
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
            "relevance": "Unencrypted backend storage allows adversaries to directly access and exfiltrate image data from cloud storage buckets."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.002",
            "name": "Exfiltration to Cloud Storage",
            "relevance": "Unencrypted storage facilitates exfiltration of sensitive image layers or embedded secrets to external cloud storage."
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_backend_storage[_unencrypted_backend_storage_def] if {
    not input.storage_encryption_at_rest_enabled
}

unencrypted_backend_storage[_unencrypted_backend_storage_def] if {
    not input.storage_encryption_at_rest_enabled
    input.storage_publicly_accessible == true
}

exposures contains _unencrypted_backend_storage_def if {
    count(unencrypted_backend_storage) > 0
}

_insufficient_audit_logging_def := {
    "name": "Insufficient Audit Logging",
    "description": "Registry does not record push, pull, delete, or authentication events with sufficient detail (timestamp, client identity, image reference), preventing forensic investigation of unauthorized access or supply-chain tampering.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1574.011",
            "name": "Services Registry Permissions Weakness",
            "relevance": "Insufficient logging fails to detect permission weaknesses being exploited within registry services."
        }
    ],
    "attack_vector": "UNSPECIFIED"
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    not input.audit_logging_enabled
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "push" in input.logged_event_types
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "pull" in input.logged_event_types
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "auth" in input.logged_event_types
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "client_identity" in input.log_detail_fields
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "image_reference" in input.log_detail_fields
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.audit_logging_enabled == true
    not "timestamp" in input.log_detail_fields
}

exposures contains _insufficient_audit_logging_def if {
    count(insufficient_audit_logging) > 0
}

_tag_mutability_without_immutability_enforcement_def := {
    "name": "Tag Mutability Without Immutability Enforcement",
    "description": "Mutable image tags (e.g., 'latest') can be overwritten by any authorized push client, allowing silent replacement of a known-good image reference with a malicious image without changing the tag reference consumed by orchestration.",
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
            "relevance": "Without immutable tags, adversaries can overwrite existing image tags to implant malicious images in place of legitimate ones."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.003",
            "name": "Malicious Image",
            "relevance": "Mutable tags allow adversaries to silently replace legitimate images with malicious ones, causing users to execute malicious content."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1601.001",
            "name": "Patch System Image",
            "relevance": "Tag mutability enables adversaries to patch or replace system images without detection, similar to system image patching attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

tag_mutability_without_immutability_enforcement[_tag_mutability_without_immutability_enforcement_def] if {
    not input.tag_immutability_enabled
    count(input.mutable_tags_in_use) > 0
}

tag_mutability_without_immutability_enforcement[_tag_mutability_without_immutability_enforcement_def] if {
    not input.tag_immutability_enabled
    input.push_permission_scope in ["team_wide", "organization_wide"]
}

exposures contains _tag_mutability_without_immutability_enforcement_def if {
    count(tag_mutability_without_immutability_enforcement) > 0
}

_missing_garbage_collection_and_retention_policy_def := {
    "name": "Missing Garbage Collection And Retention Policy",
    "description": "No automated garbage collection or retention policy is configured, causing unreferenced blobs containing deleted but sensitive layer data to persist on storage indefinitely, expanding the exfiltration surface.",
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
            "relevance": "Missing retention policies mean lifecycle-triggered deletion controls are absent, leaving stale or sensitive data indefinitely accessible."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Without garbage collection, orphaned image layers containing sensitive data remain in cloud storage and can be accessed by adversaries."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_garbage_collection_and_retention_policy[_missing_garbage_collection_and_retention_policy_def] if {
    not input.garbage_collection_enabled
    not input.retention_policy_configured
}

missing_garbage_collection_and_retention_policy[_missing_garbage_collection_and_retention_policy_def] if {
    not input.garbage_collection_enabled
    input.retention_policy_configured == true
}

missing_garbage_collection_and_retention_policy[_missing_garbage_collection_and_retention_policy_def] if {
    input.garbage_collection_enabled == true
    not input.retention_policy_configured
}

exposures contains _missing_garbage_collection_and_retention_policy_def if {
    count(missing_garbage_collection_and_retention_policy) > 0
}

_registry_running_with_excessive_host_privileges_def := {
    "name": "Registry Running With Excessive Host Privileges",
    "description": "Registry process or container runs as root or with host-mounted volumes and elevated Linux capabilities, increasing the impact of a registry process compromise to potential host takeover or data store manipulation.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1574.011",
            "name": "Services Registry Permissions Weakness",
            "relevance": "Running the registry with excessive host privileges reflects a registry service permissions weakness that adversaries can exploit for escalation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1547.001",
            "name": "Registry Run Keys / Startup Folder",
            "relevance": "Excessive host privileges on the registry process can be abused to establish persistence via run keys or startup mechanisms."
        }
    ],
    "attack_vector": "LOCAL"
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    input.registry_process_user == "root"
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    input.privileged_mode_enabled == true
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    "/var/run/docker.sock" in input.host_volumes_mounted
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    "/etc" in input.host_volumes_mounted
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    "SYS_ADMIN" in input.added_linux_capabilities
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    "NET_ADMIN" in input.added_linux_capabilities
}

registry_running_with_excessive_host_privileges[_registry_running_with_excessive_host_privileges_def] if {
    "DAC_OVERRIDE" in input.added_linux_capabilities
}

exposures contains _registry_running_with_excessive_host_privileges_def if {
    count(registry_running_with_excessive_host_privileges) > 0
}

_unpatched_registry_software_def := {
    "name": "Unpatched Registry Software",
    "description": "Registry software version is not kept current with vendor security patches, leaving known vulnerabilities in the distribution specification implementation or dependent libraries exploitable by network-accessible attackers.",
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
            "relevance": "Unpatched registry software is directly exploitable as a public-facing application, allowing remote code execution or unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Known vulnerabilities in unpatched registry software can be exploited to escalate privileges on the host system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.006",
            "name": "Vulnerabilities",
            "relevance": "Adversaries can acquire or leverage known vulnerabilities in unpatched registry software to plan and execute attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_registry_software[_unpatched_registry_software_def] if {
    input.version_has_known_cve == true
}

unpatched_registry_software[_unpatched_registry_software_def] if {
    input.days_since_last_patch > 90
}

exposures contains _unpatched_registry_software_def if {
    count(unpatched_registry_software) > 0
}

_missing_pull_rate_limiting_and_abuse_controls_def := {
    "name": "Missing Pull Rate Limiting And Abuse Controls",
    "description": "Registry applies no rate limits or request throttling on pull or authentication endpoints, enabling brute-force credential attacks or resource exhaustion that degrades availability for production image pulls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "name": "Brute Force",
            "relevance": "Without pull rate limiting, adversaries can perform brute force attacks against the registry authentication mechanisms without throttling."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_pull_rate_limiting_and_abuse_controls[_missing_pull_rate_limiting_and_abuse_controls_def] if {
    not input.pull_rate_limiting_enabled
    not input.auth_endpoint_rate_limiting_enabled
}

missing_pull_rate_limiting_and_abuse_controls[_missing_pull_rate_limiting_and_abuse_controls_def] if {
    input.anonymous_pull_enabled == true
    not input.pull_rate_limiting_enabled
}

exposures contains _missing_pull_rate_limiting_and_abuse_controls_def if {
    count(missing_pull_rate_limiting_and_abuse_controls) > 0
}
