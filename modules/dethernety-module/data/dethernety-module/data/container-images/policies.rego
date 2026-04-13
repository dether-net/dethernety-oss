package _dt_built_in.exposures.container_images



_embedded_secrets_in_image_layers_def := {
    "name": "Embedded Secrets In Image Layers",
    "description": "Sensitive credentials, API keys, certificates, or tokens embedded directly into image layers during build time \u2014 including in layers that were subsequently overwritten or deleted \u2014 remain permanently readable from the image manifest. The OCI layered model means deletion in a later layer does not remove data from earlier layer blobs, violating classification handling requirements for secrets.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Secrets embedded in image layers are effectively credentials stored in files within the container image filesystem."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Embedding secrets in image layers represents unsecured credential storage that can be extracted by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "name": "Implant Internal Image",
            "relevance": "Container images with embedded secrets can be implanted or distributed internally, exposing credentials through image layer inspection."
        }
    ],
    "attack_vector": "LOCAL"
}

embedded_secrets_in_image_layers[_embedded_secrets_in_image_layers_def] if {
    input.secrets_detected_in_layers == true
    input.image_secret_scan_enforcement in ["scan_only", "none"]
}

embedded_secrets_in_image_layers[_embedded_secrets_in_image_layers_def] if {
    input.secret_found_in_non_final_layer == true
}

exposures contains _embedded_secrets_in_image_layers_def if {
    count(embedded_secrets_in_image_layers) > 0
}

_missing_classification_label_enforcement_def := {
    "name": "Missing Classification Label Enforcement",
    "description": "Production images designated as high-classification lack enforced metadata labeling at the image manifest or tag level. Without classification labels propagated and verified at push/pull time, downstream consumers cannot apply appropriate handling controls, and audit systems cannot distinguish high-classification images from development or public images.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.003",
            "name": "Malicious Image",
            "relevance": "Without classification label enforcement, malicious or unvetted images can be deployed as there is no policy gate to verify image integrity or classification."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "name": "Implant Internal Image",
            "relevance": "Absence of classification label enforcement allows adversaries to implant tampered images that lack proper metadata controls."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_classification_label_enforcement[_missing_classification_label_enforcement_def] if {
    input.image_classification_tier == "production_high"
    not input.manifest_classification_label_present
}

missing_classification_label_enforcement[_missing_classification_label_enforcement_def] if {
    input.image_classification_tier == "production_high"
    not input.push_pull_classification_verification_enforced
}

exposures contains _missing_classification_label_enforcement_def if {
    count(missing_classification_label_enforcement) > 0
}

_unencrypted_image_layer_storage_at_rest_def := {
    "name": "Unencrypted Image Layer Storage At Rest",
    "description": "Image layer blobs stored in the registry repository without encryption at the data level, relying solely on storage-layer encryption that may not enforce classification-specific key management. High-classification production images require encryption with access-controlled keys; absence of image-level encryption means raw layer data is accessible to anyone with repository storage access.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.013",
            "name": "Encrypted/Encoded File",
            "relevance": "The lack of encryption for image layers at rest is the inverse of this technique, exposing stored data that should be protected with encryption."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1486",
            "name": "Data Encrypted for Impact",
            "relevance": "Unencrypted image layer storage highlights the absence of encryption controls that would otherwise protect data at rest from unauthorized access or ransomware impact."
        }
    ],
    "attack_vector": "LOCAL"
}

unencrypted_image_layer_storage_at_rest[_unencrypted_image_layer_storage_at_rest_def] if {
    input.image_classification_tier in ["confidential", "restricted"]
    not input.image_level_encryption_enabled
}

unencrypted_image_layer_storage_at_rest[_unencrypted_image_layer_storage_at_rest_def] if {
    input.image_classification_tier in ["confidential", "restricted"]
    input.image_level_encryption_enabled == true
    not input.access_controlled_key_management_configured
}

unencrypted_image_layer_storage_at_rest[_unencrypted_image_layer_storage_at_rest_def] if {
    input.image_classification_tier in ["internal", "unclassified"]
    not input.image_level_encryption_enabled
    not input.access_controlled_key_management_configured
}

exposures contains _unencrypted_image_layer_storage_at_rest_def if {
    count(unencrypted_image_layer_storage_at_rest) > 0
}

_absent_image_retention_and_expiry_policy_def := {
    "name": "Absent Image Retention And Expiry Policy",
    "description": "No defined retention schedule governing when old image tags or versions must be deleted or archived. Accumulation of stale images containing deprecated credentials, outdated dependencies with known vulnerabilities, or superseded classification-sensitive data violates data minimization requirements and increases the surface area of sensitive data held beyond its operational necessity.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Absent retention and expiry policies directly relate to the lack of lifecycle-triggered deletion controls for image artifacts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Without expiry policies, stale images accumulate in repositories and can be accessed by adversaries to collect sensitive data from outdated artifacts."
        }
    ],
    "attack_vector": "LOCAL"
}

absent_image_retention_and_expiry_policy[_absent_image_retention_and_expiry_policy_def] if {
    not input.retention_policy_defined
}

absent_image_retention_and_expiry_policy[_absent_image_retention_and_expiry_policy_def] if {
    input.retention_policy_defined == true
    not input.image_expiry_automation_enabled
    input.stale_image_count > 0
}

exposures contains _absent_image_retention_and_expiry_policy_def if {
    count(absent_image_retention_and_expiry_policy) > 0
}

_inadequate_access_control_granularity_for_classified_images_def := {
    "name": "Inadequate Access Control Granularity For Classified Images",
    "description": "Registry access controls applied at the repository or registry level rather than per image tag or classification tier. High-classification production images share access grants with lower-sensitivity images, meaning users or service accounts authorized for development images inherit read access to production image layers containing sensitive runtime configuration and binaries.",
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
            "relevance": "Inadequate access control granularity for classified images in registries mirrors weak repository access controls that allow unauthorized data collection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Insufficient access controls on image repositories enable adversaries to access and exfiltrate classified image data from information repositories."
        }
    ],
    "attack_vector": "LOCAL"
}

inadequate_access_control_granularity_for_classified_images[_inadequate_access_control_granularity_for_classified_images_def] if {
    input.access_control_granularity_level in ["registry", "repository"]
    input.mixed_classification_images_in_shared_repository == true
}

inadequate_access_control_granularity_for_classified_images[_inadequate_access_control_granularity_for_classified_images_def] if {
    input.access_control_granularity_level in ["registry", "repository"]
    input.lower_env_principals_with_production_image_access == true
}

inadequate_access_control_granularity_for_classified_images[_inadequate_access_control_granularity_for_classified_images_def] if {
    input.mixed_classification_images_in_shared_repository == true
    input.lower_env_principals_with_production_image_access == true
}

exposures contains _inadequate_access_control_granularity_for_classified_images_def if {
    count(inadequate_access_control_granularity_for_classified_images) > 0
}

_cross_border_transfer_of_classified_image_data_def := {
    "name": "Cross Border Transfer Of Classified Image Data",
    "description": "Registry replication or image pull operations transmit high-classification image layers across geographic regions or cloud zones without verification that cross-border data transfer rules are satisfied. Image manifests and layer blobs containing sensitive application logic or regulated data may traverse jurisdictions with conflicting data residency requirements without consent or logging.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "name": "Transfer Data to Cloud Account",
            "relevance": "Cross-border transfer of classified image data directly maps to transferring sensitive data to external or foreign cloud accounts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "name": "Data from Cloud Storage",
            "relevance": "Classified image data stored in cloud registries can be accessed and transferred across borders via cloud storage access."
        }
    ],
    "attack_vector": "NETWORK"
}

cross_border_transfer_of_classified_image_data[_cross_border_transfer_of_classified_image_data_def] if {
    input.geo_replication_enabled == true
    input.image_classification_label in ["confidential", "restricted", "secret"]
    not input.cross_border_transfer_policy_enforced
}

cross_border_transfer_of_classified_image_data[_cross_border_transfer_of_classified_image_data_def] if {
    input.geo_replication_enabled == true
    input.image_classification_label in ["confidential", "restricted", "secret"]
    not input.replication_audit_logging_enabled
}

exposures contains _cross_border_transfer_of_classified_image_data_def if {
    count(cross_border_transfer_of_classified_image_data) > 0
}

_non_compliant_image_disposal_without_layer_blob_purge_def := {
    "name": "Non Compliant Image Disposal Without Layer Blob Purge",
    "description": "Image deletion operations remove tags and manifest references but do not trigger garbage collection of unreferenced layer blobs. Sensitive data in decommissioned image layers persists in registry storage indefinitely, violating disposal procedures required for high-classification data. Blobs remain recoverable until an explicit, verified garbage collection cycle is run and confirmed.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Improper disposal without purging layer blobs means residual data remains after deletion attempts, failing the secure file deletion requirement."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485.001",
            "name": "Lifecycle-Triggered Deletion",
            "relevance": "Non-compliant disposal without blob purge represents a failure in lifecycle-triggered deletion controls that should completely remove image data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.009",
            "name": "Clear Persistence",
            "relevance": "Failure to purge layer blobs during image disposal leaves persistent artifacts that adversaries or auditors could recover."
        }
    ],
    "attack_vector": "LOCAL"
}

non_compliant_image_disposal_without_layer_blob_purge[_non_compliant_image_disposal_without_layer_blob_purge_def] if {
    input.deleted_images_with_sensitive_classification == true
    not input.garbage_collection_verified_post_deletion
}

non_compliant_image_disposal_without_layer_blob_purge[_non_compliant_image_disposal_without_layer_blob_purge_def] if {
    input.unreferenced_blob_retention_days > 7
    not input.garbage_collection_verified_post_deletion
}

exposures contains _non_compliant_image_disposal_without_layer_blob_purge_def if {
    count(non_compliant_image_disposal_without_layer_blob_purge) > 0
}
