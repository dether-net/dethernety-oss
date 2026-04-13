package _dt_built_in.exposures.email_content



_unclassified_pii_in_email_bodies_def := {
    "name": "Unclassified Pii In Email Bodies",
    "description": "Email message bodies containing PII lack formal sensitivity classification labels, preventing downstream handling controls from being applied. Data cannot be subject to appropriate retention, encryption, or access restrictions if its sensitivity level is never recorded at ingestion.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114",
            "name": "Email Collection",
            "relevance": "Unclassified PII in email bodies is directly at risk of being harvested through email collection techniques by adversaries."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.002",
            "name": "Email Addresses",
            "relevance": "PII in email bodies often includes email addresses that adversaries can gather for reconnaissance or targeting purposes."
        }
    ],
    "attack_vector": "LOCAL"
}

unclassified_pii_in_email_bodies[_unclassified_pii_in_email_bodies_def] if {
    not input.email_body_classification_enforced
    not input.pii_scanning_enabled
}

unclassified_pii_in_email_bodies[_unclassified_pii_in_email_bodies_def] if {
    not input.email_body_classification_enforced
    input.unclassified_email_retention_policy == "indefinite"
}

unclassified_pii_in_email_bodies[_unclassified_pii_in_email_bodies_def] if {
    not input.email_body_classification_enforced
    input.unclassified_email_retention_policy == "default_period"
}

exposures contains _unclassified_pii_in_email_bodies_def if {
    count(unclassified_pii_in_email_bodies) > 0
}

_indefinite_retention_of_pii_bearing_messages_def := {
    "name": "Indefinite Retention Of Pii Bearing Messages",
    "description": "Absence of enforced retention schedules causes PII-containing emails to persist beyond legally permissible periods. Regulations such as GDPR Article 5(1)(e) mandate storage limitation; emails retained without a defined deletion trigger constitute a standing compliance violation and expand the breach impact surface.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114",
            "name": "Email Collection",
            "relevance": "Indefinitely retained PII-bearing messages represent a persistent target for email collection attacks over time."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1564.008",
            "name": "Email Hiding Rules",
            "relevance": "Attackers may use email hiding rules to obscure indefinitely retained PII-bearing messages from detection or compliance review."
        }
    ],
    "attack_vector": "LOCAL"
}

indefinite_retention_of_pii_bearing_messages[_indefinite_retention_of_pii_bearing_messages_def] if {
    not input.retention_policy_enforced
}

indefinite_retention_of_pii_bearing_messages[_indefinite_retention_of_pii_bearing_messages_def] if {
    input.retention_policy_enforced == true
    input.maximum_retention_days == 0
}

indefinite_retention_of_pii_bearing_messages[_indefinite_retention_of_pii_bearing_messages_def] if {
    input.retention_policy_enforced == true
    not input.pii_classification_labels_applied
}

exposures contains _indefinite_retention_of_pii_bearing_messages_def if {
    count(indefinite_retention_of_pii_bearing_messages) > 0
}

_plaintext_pii_in_email_attachments_def := {
    "name": "Plaintext Pii In Email Attachments",
    "description": "Attachments carrying PII (spreadsheets, PDFs, scanned documents) are stored without at-rest encryption or document-level protection. If the mailbox store is accessed without authorization, attachment content is immediately readable without any additional decryption step.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.001",
            "name": "Local Email Collection",
            "relevance": "Plaintext PII in email attachments can be locally collected by adversaries with access to the mail client or storage."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.002",
            "name": "Remote Email Collection",
            "relevance": "Plaintext PII attachments are susceptible to remote email collection by attackers accessing mail servers or cloud email systems."
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_pii_in_email_attachments[_plaintext_pii_in_email_attachments_def] if {
    not input.mailbox_store_encryption_enabled
    not input.attachment_document_protection_enforced
}

plaintext_pii_in_email_attachments[_plaintext_pii_in_email_attachments_def] if {
    not input.mailbox_store_encryption_enabled
    not input.sensitivity_labeling_enforced_on_attachments
}

exposures contains _plaintext_pii_in_email_attachments_def if {
    count(plaintext_pii_in_email_attachments) > 0
}

_excessive_mailbox_access_grants_to_pii_data_def := {
    "name": "Excessive Mailbox Access Grants To Pii Data",
    "description": "Shared mailboxes, delegated access, and broad group policies grant users access to messages containing PII beyond their operational need-to-know. The data-level control \u2014 restricting who can read specific sensitivity classifications \u2014 is absent, so access is governed only by mailbox ownership rather than data content.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.002",
            "name": "Additional Email Delegate Permissions",
            "relevance": "Excessive mailbox access grants directly correspond to the abuse or misconfiguration of email delegate permissions exposing PII data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.003",
            "name": "Email Forwarding Rule",
            "relevance": "Excessive access grants may be exploited to create forwarding rules that exfiltrate PII-containing emails to unauthorized recipients."
        }
    ],
    "attack_vector": "LOCAL"
}

excessive_mailbox_access_grants_to_pii_data[_excessive_mailbox_access_grants_to_pii_data_def] if {
    input.shared_mailbox_pii_access_scope in ["broad", "unrestricted"]
    not input.content_based_access_control_enabled
}

excessive_mailbox_access_grants_to_pii_data[_excessive_mailbox_access_grants_to_pii_data_def] if {
    not input.pii_classification_labels_applied
    not input.content_based_access_control_enabled
    input.shared_mailbox_pii_access_scope in ["broad", "unrestricted"]
}

exposures contains _excessive_mailbox_access_grants_to_pii_data_def if {
    count(excessive_mailbox_access_grants_to_pii_data) > 0
}

_cross_border_pii_transfer_via_email_routing_def := {
    "name": "Cross Border Pii Transfer Via Email Routing",
    "description": "Emails containing PII are routed through relay nodes or archived in geographic regions without verifying that transfers comply with data residency requirements (e.g., GDPR Chapter V restrictions on third-country transfers). The data classification record does not capture transfer destination, making compliance attestation impossible.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114",
            "name": "Email Collection",
            "relevance": "Cross-border PII transfer via email routing can be facilitated or exploited through email collection techniques targeting routed messages."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "name": "Transfer Data to Cloud Account",
            "relevance": "Routing PII-bearing emails across borders may involve transferring data to foreign cloud accounts, aligning with this exfiltration technique."
        }
    ],
    "attack_vector": "NETWORK"
}

cross_border_pii_transfer_via_email_routing[_cross_border_pii_transfer_via_email_routing_def] if {
    not input.transfer_destination_recorded
}

cross_border_pii_transfer_via_email_routing[_cross_border_pii_transfer_via_email_routing_def] if {
    input.transfer_destination_recorded == true
    not input.cross_border_transfer_compliance_verified
}

exposures contains _cross_border_pii_transfer_via_email_routing_def if {
    count(cross_border_pii_transfer_via_email_routing) > 0
}

_inadequate_disposal_of_deleted_pii_emails_def := {
    "name": "Inadequate Disposal Of Deleted Pii Emails",
    "description": "Deleted messages are moved to recoverable deleted-items folders or backup snapshots without a secure erasure policy. PII that users believe has been removed remains recoverable for extended periods, violating data subject erasure rights and creating unmanaged data accumulation outside the active retention scope.",
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
            "relevance": "Inadequate disposal of deleted PII emails directly relates to failures in lifecycle-triggered deletion policies that should permanently remove sensitive data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.008",
            "name": "Clear Mailbox Data",
            "relevance": "Proper disposal of deleted PII emails requires effective mailbox data clearing; inadequacy here leaves residual PII accessible."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "name": "Data Destruction",
            "relevance": "Inadequate disposal procedures fail to ensure complete data destruction of PII-containing emails, leaving them recoverable."
        }
    ],
    "attack_vector": "LOCAL"
}

inadequate_disposal_of_deleted_pii_emails[_inadequate_disposal_of_deleted_pii_emails_def] if {
    not input.secure_erasure_policy_enabled
}

inadequate_disposal_of_deleted_pii_emails[_inadequate_disposal_of_deleted_pii_emails_def] if {
    input.deleted_items_retention_days > 30
    not input.secure_erasure_policy_enabled
}

inadequate_disposal_of_deleted_pii_emails[_inadequate_disposal_of_deleted_pii_emails_def] if {
    input.backup_snapshot_pii_purge_policy == "none"
}

exposures contains _inadequate_disposal_of_deleted_pii_emails_def if {
    count(inadequate_disposal_of_deleted_pii_emails) > 0
}
