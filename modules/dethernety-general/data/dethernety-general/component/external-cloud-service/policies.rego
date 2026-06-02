package _dt_built_in.exposures.external_cloud_service



_over_privileged_wildcard_iam_to_the_service_def := {
    "name": "Over-privileged / wildcard IAM to the service",
    "description": "The consuming identities/roles hold wildcard '*:*' or full-admin policies instead of least-privilege, per-action/per-resource scoping; once any such credential is leaked or assumed, an attacker inherits broad valid-account access to the service that looks like normal traffic.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "Wildcard/over-privileged IAM means a single leaked or assumed credential confers broad, legitimate-looking access to the cloud service \u2014 valid-account abuse via cloud accounts that bypasses access controls and blends with normal traffic."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.003",
            "attributes": {
                "justification": "Full-admin / wildcard policies attached to consuming roles are the standing over-privilege that Additional Cloud Roles abuse depends on \u2014 an actor who can assume or has been granted such a role inherits broad cloud-service privileges."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_wildcard_iam_to_the_service[_over_privileged_wildcard_iam_to_the_service_def] if {
    input.wildcard_iam_policy_used == true
}

over_privileged_wildcard_iam_to_the_service[_over_privileged_wildcard_iam_to_the_service_def] if {
    not input.least_privilege_access_enforced
}

exposures contains _over_privileged_wildcard_iam_to_the_service_def if {
    count(over_privileged_wildcard_iam_to_the_service) > 0
}

_long_lived_static_credentials_instead_of_federation_def := {
    "name": "Long-lived static credentials instead of federation",
    "description": "Access uses long-lived static access keys (or a root access key) embedded in the consumer rather than short-lived federated/workload-identity credentials, widening the theft window and enabling persistent valid-account abuse if the key leaks.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
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

long_lived_static_credentials_instead_of_federation[_long_lived_static_credentials_instead_of_federation_def] if {
    not input.federated_short_lived_credentials_used
}

long_lived_static_credentials_instead_of_federation[_long_lived_static_credentials_instead_of_federation_def] if {
    input.long_lived_static_keys_used == true
}

exposures contains _long_lived_static_credentials_instead_of_federation_def if {
    count(long_lived_static_credentials_instead_of_federation) > 0
}

_public_exposure_insecure_default_config_of_the_consumed_resource_def := {
    "name": "Public exposure / insecure-default config of the consumed resource",
    "description": "The consumer-controlled surface is left at insecure defaults \u2014 a public object-store bucket, a PubliclyAccessible managed DB, or a 0.0.0.0/0 security group \u2014 letting attackers read or exfiltrate data directly from the cloud store. Public buckets are a top critical cloud misconfiguration.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
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
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

public_exposure_insecure_default_config_of_the_consumed_resource[_public_exposure_insecure_default_config_of_the_consumed_resource_def] if {
    not input.config_object_storage_not_publicly_accessible
}

public_exposure_insecure_default_config_of_the_consumed_resource[_public_exposure_insecure_default_config_of_the_consumed_resource_def] if {
    not input.cloud_objects_not_anonymously_public
}

public_exposure_insecure_default_config_of_the_consumed_resource[_public_exposure_insecure_default_config_of_the_consumed_resource_def] if {
    input.data_store_publicly_routable == true
}

public_exposure_insecure_default_config_of_the_consumed_resource[_public_exposure_insecure_default_config_of_the_consumed_resource_def] if {
    not input.ingress_default_deny_enforced
}

exposures contains _public_exposure_insecure_default_config_of_the_consumed_resource_def if {
    count(public_exposure_insecure_default_config_of_the_consumed_resource) > 0
}

_connectivity_over_the_public_internet_instead_of_private_link_def := {
    "name": "Connectivity over the public internet instead of private link",
    "description": "Traffic to the managed service traverses the public internet (no PrivateLink/Private Service Connect/private endpoint) and connections that don't enforce TLS or skip certificate validation expose data and credentials to interception and AiTM.",
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
    "attack_vector": "NETWORK"
}

connectivity_over_the_public_internet_instead_of_private_link[_connectivity_over_the_public_internet_instead_of_private_link_def] if {
    not input.private_link_for_managed_services
}

connectivity_over_the_public_internet_instead_of_private_link[_connectivity_over_the_public_internet_instead_of_private_link_def] if {
    not input.flow_tls_encrypted
}

connectivity_over_the_public_internet_instead_of_private_link[_connectivity_over_the_public_internet_instead_of_private_link_def] if {
    not input.server_certificate_validated
}

exposures contains _connectivity_over_the_public_internet_instead_of_private_link_def if {
    count(connectivity_over_the_public_internet_instead_of_private_link) > 0
}

_missing_encryption_at_rest_no_customer_managed_key_def := {
    "name": "Missing encryption at rest / no customer-managed key",
    "description": "Sensitive data stored in the managed service is unencrypted at rest or relies on a provider-default key with no customer key custody, so the org cannot control rotation, revocation, or cryptographic deletion of its data.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

missing_encryption_at_rest_no_customer_managed_key[_missing_encryption_at_rest_no_customer_managed_key_def] if {
    not input.encrypted_at_rest
}

missing_encryption_at_rest_no_customer_managed_key[_missing_encryption_at_rest_no_customer_managed_key_def] if {
    not input.keys_managed_in_hsm_or_kms
}

missing_encryption_at_rest_no_customer_managed_key[_missing_encryption_at_rest_no_customer_managed_key_def] if {
    not input.key_rotation_enabled
}

missing_encryption_at_rest_no_customer_managed_key[_missing_encryption_at_rest_no_customer_managed_key_def] if {
    not input.envelope_encryption_kek_dek_split
}

exposures contains _missing_encryption_at_rest_no_customer_managed_key_def if {
    count(missing_encryption_at_rest_no_customer_managed_key) > 0
}

_service_credentials_harvested_from_files_or_cloud_metadata_def := {
    "name": "Service credentials harvested from files or cloud metadata",
    "description": "Service credentials embedded in source, config, IaC, or reachable via the instance-metadata endpoint (SSRF to 169.254.169.254) are harvested by an attacker who then pivots to the managed service.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.005",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1555.006",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

service_credentials_harvested_from_files_or_cloud_metadata[_service_credentials_harvested_from_files_or_cloud_metadata_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

service_credentials_harvested_from_files_or_cloud_metadata[_service_credentials_harvested_from_files_or_cloud_metadata_def] if {
    not input.cloud_metadata_endpoint_blocked
}

exposures contains _service_credentials_harvested_from_files_or_cloud_metadata_def if {
    count(service_credentials_harvested_from_files_or_cloud_metadata) > 0
}

_unmonitored_access_exfiltration_over_the_trusted_service_def := {
    "name": "Unmonitored access / exfiltration over the trusted service",
    "description": "Control-plane API, object-level data-event, and network-flow logging are disabled, so anomalous or bulk access goes undetected and adversaries route stolen data out through the legitimate cloud service under cover of existing firewall rules and TLS.",
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
            "value": "T1567.002",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.access_audit_trail_enabled
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.control_plane_api_logging_enabled
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.object_level_data_event_logging_enabled
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.network_flow_logging_enabled
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.perimeter_crossings_logged_and_centralized
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.bulk_export_monitored_and_alerted
}

unmonitored_access_exfiltration_over_the_trusted_service[_unmonitored_access_exfiltration_over_the_trusted_service_def] if {
    not input.logs_stored_on_separate_system
}

exposures contains _unmonitored_access_exfiltration_over_the_trusted_service_def if {
    count(unmonitored_access_exfiltration_over_the_trusted_service) > 0
}

_data_residency_cross_border_processing_violation_no_dpa_def := {
    "name": "Data-residency / cross-border processing violation, no DPA",
    "description": "Data is silently replicated or processed outside approved regions (or by unreviewed sub-processors) without an executed DPA/SCCs, breaching residency requirements and GDPR transfer obligations.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

data_residency_cross_border_processing_violation_no_dpa[_data_residency_cross_border_processing_violation_no_dpa_def] if {
    not input.residency_confined_to_approved_regions
}

data_residency_cross_border_processing_violation_no_dpa[_data_residency_cross_border_processing_violation_no_dpa_def] if {
    not input.governed_transfer_safeguards
}

data_residency_cross_border_processing_violation_no_dpa[_data_residency_cross_border_processing_violation_no_dpa_def] if {
    not input.storage_destinations_documented
}

data_residency_cross_border_processing_violation_no_dpa[_data_residency_cross_border_processing_violation_no_dpa_def] if {
    not input.dpa_and_subprocessors_reviewed
}

exposures contains _data_residency_cross_border_processing_violation_no_dpa_def if {
    count(data_residency_cross_border_processing_violation_no_dpa) > 0
}

_availability_dependency_without_sla_aware_failover_def := {
    "name": "Availability dependency without SLA-aware failover",
    "description": "The managed dependency degrades, fails, or enters a provider maintenance window; without multi-AZ/region deployment, retries, and a tested failover plan the consumer inherits the outage.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

availability_dependency_without_sla_aware_failover[_availability_dependency_without_sla_aware_failover_def] if {
    not input.multi_region_or_az_deployed
}

availability_dependency_without_sla_aware_failover[_availability_dependency_without_sla_aware_failover_def] if {
    not input.failover_plan_tested
}

availability_dependency_without_sla_aware_failover[_availability_dependency_without_sla_aware_failover_def] if {
    not input.dependency_sla_defined
}

availability_dependency_without_sla_aware_failover[_availability_dependency_without_sla_aware_failover_def] if {
    not input.retry_with_backoff_configured
}

exposures contains _availability_dependency_without_sla_aware_failover_def if {
    count(availability_dependency_without_sla_aware_failover) > 0
}

_unreviewed_vendor_posture_shared_responsibility_gap_def := {
    "name": "Unreviewed vendor posture / shared-responsibility gap",
    "description": "Assuming the provider secures everything (and not reviewing its SOC 2 / ISO 27001 / CSA STAR attestations) leaves customer-side duties \u2014 IAM, encryption choices, configuration, applying maintenance windows on single-tenant managed services \u2014 unowned, producing exploitable gaps.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unreviewed_vendor_posture_shared_responsibility_gap[_unreviewed_vendor_posture_shared_responsibility_gap_def] if {
    not input.vendor_security_attestations_reviewed
    not input.shared_responsibility_boundary_documented
    not input.customer_side_duties_owned
}

exposures contains _unreviewed_vendor_posture_shared_responsibility_gap_def if {
    count(unreviewed_vendor_posture_shared_responsibility_gap) > 0
}
