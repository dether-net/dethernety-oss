package _dt_built_in.exposures.object_storage



_public_access_exposure_anonymous_read_write_def := {
    "name": "Public-access exposure (anonymous read/write)",
    "description": "The bucket is effectively public \u2014 an S3 public-read/write ACL or bucket policy with Principal:* (no aws:* condition), all four Block Public Access flags not enforced, MinIO `mc anonymous download/upload/public`, GCS publicAccessPrevention not enforced (allUsers grants), or Azure allowBlobPublicAccess=true. Any unauthenticated party can list and download (or overwrite/plant) all objects \u2014 the canonical object-store breach and a supply-chain poisoning path for served assets.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1619",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.block_public_access_enabled
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.public_bucket_acl_disabled
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.bucket_policy_no_wildcard_principal
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.anonymous_access_disabled
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.public_object_listing_disabled
}

public_access_exposure_anonymous_read_write[_public_access_exposure_anonymous_read_write_def] if {
    not input.acls_disabled_bucket_owner_enforced
}

exposures contains _public_access_exposure_anonymous_read_write_def if {
    count(public_access_exposure_anonymous_read_write) > 0
}

_over_permissive_iam_bucket_policy_weak_presigned_urls_def := {
    "name": "Over-permissive IAM / bucket policy & weak presigned URLs",
    "description": "Wildcard Action s3:* on Resource arn:aws:s3:::* (or broad MinIO PBAC/consoleAdmin grants to app identities), ACLs left active (ObjectOwnership != BucketOwnerEnforced / uniform-bucket-level-access disabled), or long-lived broadly-scoped presigned URLs grant far more than least privilege \u2014 enabling lateral data access, privilege escalation, and durable unauthenticated exfil links.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Over-permissive policies and over-scoped/long-lived presigned URLs let an actor read objects directly from the cloud store \u2014 Data from Cloud Storage."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Wildcard s3:* / broad PBAC grants to app identities let a compromised valid identity exercise far more than its task scope \u2014 Valid Accounts abuse and privilege escalation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_permissive_iam_bucket_policy_weak_presigned_urls[_over_permissive_iam_bucket_policy_weak_presigned_urls_def] if {
    not input.least_privilege_access_enforced
}

over_permissive_iam_bucket_policy_weak_presigned_urls[_over_permissive_iam_bucket_policy_weak_presigned_urls_def] if {
    not input.iam_policy_no_wildcard_actions
}

over_permissive_iam_bucket_policy_weak_presigned_urls[_over_permissive_iam_bucket_policy_weak_presigned_urls_def] if {
    not input.acls_disabled_bucket_owner_enforced
}

over_permissive_iam_bucket_policy_weak_presigned_urls[_over_permissive_iam_bucket_policy_weak_presigned_urls_def] if {
    not input.presigned_url_short_expiry_enforced
    not input.presigned_url_scope_limited
}

exposures contains _over_permissive_iam_bucket_policy_weak_presigned_urls_def if {
    count(over_permissive_iam_bucket_policy_weak_presigned_urls) > 0
}

_missing_encryption_at_rest_def := {
    "name": "Missing encryption at rest",
    "description": "Objects are stored without server-side encryption \u2014 a legacy bucket with no default SSE-S3/SSE-KMS, SSE-C reliance, MinIO without KMS/KES (`mc encrypt info` shows none), or a weak/absent KMS key policy undermining SSE-KMS. Plaintext data is exposed on disk, snapshot, or stolen backup media, and KMS key-usage auditing is lost.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    not input.encrypted_at_rest
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    not input.default_sse_enabled
}

missing_encryption_at_rest[_missing_encryption_at_rest_def] if {
    not input.customer_managed_key_used
}

exposures contains _missing_encryption_at_rest_def if {
    count(missing_encryption_at_rest) > 0
}

_cleartext_weak_tls_transport_def := {
    "name": "Cleartext / weak-TLS transport",
    "description": "No enforcement of in-transit encryption \u2014 missing aws:SecureTransport=false Deny (and s3:TlsVersion < 1.2 floor), Azure supportsHttpsTrafficOnly=false / minimumTlsVersion below TLS1_2, or MinIO served over plain HTTP with no certs. S3-API traffic and credentials traverse plaintext and can be sniffed or tampered (MITM/AiTM).",
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

cleartext_weak_tls_transport[_cleartext_weak_tls_transport_def] if {
    not input.tls_only_transport
}

cleartext_weak_tls_transport[_cleartext_weak_tls_transport_def] if {
    not input.insecure_transport_denied
}

cleartext_weak_tls_transport[_cleartext_weak_tls_transport_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_weak_tls_transport[_cleartext_weak_tls_transport_def] if {
    input.min_tls_version in ["TLS1_0", "TLS1_1"]
}

exposures contains _cleartext_weak_tls_transport_def if {
    count(cleartext_weak_tls_transport) > 0
}

_no_ransomware_resilience_immutability_def := {
    "name": "No ransomware resilience / immutability",
    "description": "Versioning suspended/absent, no Object Lock/WORM (COMPLIANCE retention), and no MFA-Delete (GCS/Azure equivalents likewise absent). A single compromised credential can delete or encrypt-overwrite every object with no recovery path \u2014 destructive ransomware impact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
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
            "value": "T1486",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1490",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_ransomware_resilience_immutability[_no_ransomware_resilience_immutability_def] if {
    not input.object_versioning_enabled
}

no_ransomware_resilience_immutability[_no_ransomware_resilience_immutability_def] if {
    not input.object_lock_worm_enabled
}

no_ransomware_resilience_immutability[_no_ransomware_resilience_immutability_def] if {
    not input.mfa_delete_enabled
}

no_ransomware_resilience_immutability[_no_ransomware_resilience_immutability_def] if {
    not input.backup_or_replication_configured
}

exposures contains _no_ransomware_resilience_immutability_def if {
    count(no_ransomware_resilience_immutability) > 0
}

_exposed_leaked_storage_credentials_root_keys_def := {
    "name": "Exposed / leaked storage credentials & root keys",
    "description": "Default or weak MinIO root creds (historically minioadmin/minioadmin), root creds in plaintext env/compose, root used for routine app access, or static long-lived access keys instead of roles. Also reachable via SSRF in a fronting app coerced to hit the instance metadata endpoint and steal the bucket role's credentials. Unsecured credentials yield full data access.",
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
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

exposed_leaked_storage_credentials_root_keys[_exposed_leaked_storage_credentials_root_keys_def] if {
    not input.default_accounts_removed_or_changed
}

exposed_leaked_storage_credentials_root_keys[_exposed_leaked_storage_credentials_root_keys_def] if {
    not input.root_credentials_not_used_for_routine_access
}

exposed_leaked_storage_credentials_root_keys[_exposed_leaked_storage_credentials_root_keys_def] if {
    not input.access_keys_rotated_regularly
}

exposed_leaked_storage_credentials_root_keys[_exposed_leaked_storage_credentials_root_keys_def] if {
    not input.credentials_not_embedded_in_code_or_env
}

exposures contains _exposed_leaked_storage_credentials_root_keys_def if {
    count(exposed_leaked_storage_credentials_root_keys) > 0
}

_insufficient_logging_undetected_exfiltration_def := {
    "name": "Insufficient logging / undetected exfiltration",
    "description": "No server access logging, no CloudTrail S3 object-level (data) events, or no MinIO audit webhook to a SIEM. Bulk object reads and exfiltration over the storage web service go entirely unobserved, defeating breach detection and forensics.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Exfiltration over the storage web service (S3/GCS/Azure Blob/MinIO API) goes undetected when object-level data-event logging and exfil anomaly detection are absent."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Bulk reads of objects from cloud storage are the exfiltration action that the missing access logging / data events fail to record."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Absent or co-located, deletable cloud logs (no separate tamper-resistant log store) leave the same blind spot an adversary achieves by disabling cloud logs."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

insufficient_logging_undetected_exfiltration[_insufficient_logging_undetected_exfiltration_def] if {
    not input.object_level_data_event_logging_enabled
}

insufficient_logging_undetected_exfiltration[_insufficient_logging_undetected_exfiltration_def] if {
    not input.logs_stored_on_separate_system
}

insufficient_logging_undetected_exfiltration[_insufficient_logging_undetected_exfiltration_def] if {
    not input.exfiltration_anomaly_detection_enabled
}

exposures contains _insufficient_logging_undetected_exfiltration_def if {
    count(insufficient_logging_undetected_exfiltration) > 0
}

_known_cve_exposure_open_network_surface_residency_drift_def := {
    "name": "Known-CVE exposure + open network surface & residency drift",
    "description": "Unpatched MinIO Bootstrap-API info disclosure leaks all env vars including MINIO_ROOT_USER/PASSWORD, chainable to admin takeover of the cluster. Compounded by a publicly-reachable endpoint with no VPC-endpoint / aws:SourceVpce restriction (wide exfil surface) and a bucket created in or replicated to a non-approved Region \u2014 placing regulated PII/backups outside permitted jurisdiction.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Unpatched MinIO CVE-2023-28432 Bootstrap-API info disclosure on a publicly network-reachable object store is exploitation of a public-facing application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Open network surface plus leaked root credentials / residency drift enables unauthenticated access to and theft of data from cloud object storage."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    input.unpatched_known_rce_cve == true
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    not input.edge_appliance_patched_within_sla
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    not input.private_endpoint_only
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    not input.control_plane_api_not_publicly_exposed
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

known_cve_exposure_open_network_surface_residency_drift[_known_cve_exposure_open_network_surface_residency_drift_def] if {
    not input.data_residency_region_pinned
}

exposures contains _known_cve_exposure_open_network_surface_residency_drift_def if {
    count(known_cve_exposure_open_network_surface_residency_drift) > 0
}
