package _dt_built_in.exposures.dns_records

_absence_of_sensitivity_classification_on_zone_data_def := {
    "name": "Absence Of Sensitivity Classification On Zone Data",
    "description": "DNS zone files and configuration records lack a formal sensitivity classification label (e.g., Internal Confidential), causing them to be handled under default or public-tier data policies. This allows internal hostnames, service mappings, and IP-to-name bindings to be shared, retained, or disposed of without appropriate controls.",
    "type": "insecure_default",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Unclassified zone data can be harvested through passive DNS reconnaissance, exposing sensitive internal DNS records to adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Lack of sensitivity classification on zone data facilitates adversary gathering of DNS information about victim infrastructure."
        }
    ],
    "attack_vector": "NETWORK"
}

absence_of_sensitivity_classification_on_zone_data[_absence_of_sensitivity_classification_on_zone_data_def] if {
    not input.sensitivity_classification_assigned
}

absence_of_sensitivity_classification_on_zone_data[_absence_of_sensitivity_classification_on_zone_data_def] if {
    input.sensitivity_classification_assigned == true
    input.data_handling_policy_tier in ["public", "default"]
}

absence_of_sensitivity_classification_on_zone_data[_absence_of_sensitivity_classification_on_zone_data_def] if {
    not input.sensitivity_classification_assigned
    not input.zone_transfer_acl_type
}

exposures contains _absence_of_sensitivity_classification_on_zone_data_def if {
    count(absence_of_sensitivity_classification_on_zone_data) > 0
}

_indefinite_retention_of_decommissioned_dns_records_def := {
    "name": "Indefinite Retention Of Decommissioned Dns Records",
    "description": "DNS records for decommissioned hosts, retired services, or deprecated IP ranges are retained beyond their operational need due to the absence of a defined retention schedule. Stale records accumulate, creating a persistent map of historical network topology usable for subdomain takeover reconnaissance or social engineering.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Retained decommissioned DNS records provide adversaries with historical DNS data useful for passive reconnaissance and identifying stale attack surfaces."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.005",
            "name": "IP Addresses",
            "relevance": "Indefinitely retained DNS records expose historical IP address mappings that adversaries can use to map victim network infrastructure."
        }
    ],
    "attack_vector": "NETWORK"
}

indefinite_retention_of_decommissioned_dns_records[_indefinite_retention_of_decommissioned_dns_records_def] if {
    not input.dns_record_retention_policy_defined
    input.stale_dns_record_count > 0
}

indefinite_retention_of_decommissioned_dns_records[_indefinite_retention_of_decommissioned_dns_records_def] if {
    not input.automated_decommission_dns_cleanup_enabled
    input.stale_dns_record_count > 0
}

exposures contains _indefinite_retention_of_decommissioned_dns_records_def if {
    count(indefinite_retention_of_decommissioned_dns_records) > 0
}

_zone_file_snapshots_stored_without_encryption_at_rest_def := {
    "name": "Zone File Snapshots Stored Without Encryption At Rest",
    "description": "Backup copies and exported zone file snapshots are stored in plaintext on file systems or backup media without encryption at rest. Any party with access to the storage location obtains a complete enumeration of the DNS namespace, internal hostnames, and service infrastructure without needing to query the live DNS service.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1003.003",
            "name": "NTDS",
            "relevance": "Unencrypted zone file snapshots at rest are analogous to credential store dumps, allowing attackers who gain storage access to extract sensitive DNS data in plaintext."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Unencrypted zone file snapshots can expose complete DNS zone data if storage is compromised, enabling full passive DNS intelligence gathering."
        }
    ],
    "attack_vector": "LOCAL"
}

zone_file_snapshots_stored_without_encryption_at_rest[_zone_file_snapshots_stored_without_encryption_at_rest_def] if {
    not input.zone_file_encryption_at_rest_enabled
}

zone_file_snapshots_stored_without_encryption_at_rest[_zone_file_snapshots_stored_without_encryption_at_rest_def] if {
    input.zone_file_encryption_at_rest_enabled == true
    not input.zone_snapshot_access_restricted_to_authorized_roles
}

exposures contains _zone_file_snapshots_stored_without_encryption_at_rest_def if {
    count(zone_file_snapshots_stored_without_encryption_at_rest) > 0
}

_overly_broad_read_access_to_full_zone_data_def := {
    "name": "Overly Broad Read Access To Full Zone Data",
    "description": "Access controls on zone data do not enforce need-to-know; operational staff, scripts, and service accounts are granted read access to entire zone files rather than scoped record subsets. This means the full internal network map is accessible to any compromised account within the broad permission group.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "name": "Valid Accounts",
            "relevance": "Overly broad read access means any compromised valid account can access full zone data, amplifying the impact of credential compromise."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222.001",
            "name": "Windows File and Directory Permissions Modification",
            "relevance": "Misconfigured or excessively permissive access controls on zone data reflect improper permission management that adversaries can exploit."
        }
    ],
    "attack_vector": "LOCAL"
}

overly_broad_read_access_to_full_zone_data[_overly_broad_read_access_to_full_zone_data_def] if {
    input.zone_access_scope in ["full_zone", "unknown"]
}

overly_broad_read_access_to_full_zone_data[_overly_broad_read_access_to_full_zone_data_def] if {
    input.zone_transfer_acl_type in ["open_to_any", "unknown"]
}

overly_broad_read_access_to_full_zone_data[_overly_broad_read_access_to_full_zone_data_def] if {
    input.zone_access_scope == "full_zone"
    input.broad_permission_group_contains_service_accounts == true
}

exposures contains _overly_broad_read_access_to_full_zone_data_def if {
    count(overly_broad_read_access_to_full_zone_data) > 0
}

_no_masking_of_internal_host_metadata_in_logs_and_exports_def := {
    "name": "No Masking Of Internal Host Metadata In Logs And Exports",
    "description": "DNS query logs and diagnostic exports that include resolved hostnames and internal IP addresses are shared with third-party monitoring vendors or exported to log aggregation platforms without anonymization or masking of internal naming conventions. This transfers sensitive network topology data outside the classification boundary without a cross-border or third-party data-sharing control.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Unmasked internal host metadata in logs enables adversaries to gather detailed DNS and network topology information about victim infrastructure."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.005",
            "name": "IP Addresses",
            "relevance": "Exposed internal host metadata in exports reveals internal IP address assignments, aiding adversary network mapping efforts."
        }
    ],
    "attack_vector": "NETWORK"
}

no_masking_of_internal_host_metadata_in_logs_and_exports[_no_masking_of_internal_host_metadata_in_logs_and_exports_def] if {
    input.dns_logs_shared_with_third_party == true
    not input.dns_log_anonymization_enabled
}

no_masking_of_internal_host_metadata_in_logs_and_exports[_no_masking_of_internal_host_metadata_in_logs_and_exports_def] if {
    input.dns_logs_shared_with_third_party == true
    not input.third_party_data_sharing_control_exists
}

exposures contains _no_masking_of_internal_host_metadata_in_logs_and_exports_def if {
    count(no_masking_of_internal_host_metadata_in_logs_and_exports) > 0
}

_absence_of_formal_disposal_procedure_for_dns_record_data_def := {
    "name": "Absence Of Formal Disposal Procedure For Dns Record Data",
    "description": "There is no defined disposal procedure for DNS records and associated zone data when it is no longer operationally required. Records are deleted from the live DNS service but remain in backup snapshots, audit logs, and exported copies without a documented purge schedule, leaving sensitive topology data accessible beyond its intended lifecycle.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.004",
            "name": "File Deletion",
            "relevance": "Without a formal disposal procedure, DNS record data is not properly sanitized or deleted, leaving residual data accessible to adversaries who can recover it."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.001",
            "name": "DNS/Passive DNS",
            "relevance": "Improperly disposed DNS records remain available for passive DNS reconnaissance, exposing historical infrastructure details to adversaries."
        }
    ],
    "attack_vector": "NETWORK"
}

absence_of_formal_disposal_procedure_for_dns_record_data[_absence_of_formal_disposal_procedure_for_dns_record_data_def] if {
    not input.formal_dns_disposal_procedure_documented
}

absence_of_formal_disposal_procedure_for_dns_record_data[_absence_of_formal_disposal_procedure_for_dns_record_data_def] if {
    not input.formal_dns_disposal_procedure_documented
}

exposures contains _absence_of_formal_disposal_procedure_for_dns_record_data_def if {
    count(absence_of_formal_disposal_procedure_for_dns_record_data) > 0
}
