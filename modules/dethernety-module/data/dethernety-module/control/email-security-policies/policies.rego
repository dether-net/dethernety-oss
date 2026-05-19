package _dt_built_in.countermeasures.email_security_policies

_sender_authentication_enforcement_def := {
    "name": "Sender Authentication Enforcement",
    "description": "Provides cryptographic and DNS-based sender identity verification through SPF, DKIM, and DMARC policy enforcement, delivering measurable authenticity validation for inbound mail streams.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MAN",
            "name": "Message Authentication",
            "relevance": "Directly addresses enforcement of sender authentication protocols such as SPF, DKIM, and DMARC for incoming messages."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SRA",
            "name": "Sender Reputation Analysis",
            "relevance": "Evaluates sender identity and trustworthiness as part of authentication enforcement decisions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SMRA",
            "name": "Sender MTA Reputation Analysis",
            "relevance": "Assesses the reputation of the sending mail transfer agent to enforce sender authentication policies."
        }
    ]
}

sender_authentication_enforcement[_sender_authentication_enforcement_def] if {
    input.spf_policy_enforcement in ["reject", "quarantine"]
    input.dkim_validation_enabled == true
    input.dmarc_policy_enforcement in ["reject", "quarantine"]
}

sender_authentication_enforcement[_sender_authentication_enforcement_def] if {
    input.dmarc_policy_enforcement in ["reject", "quarantine"]
    input.dkim_validation_enabled == true
    input.spf_policy_enforcement != "none"
}

countermeasures contains _sender_authentication_enforcement_def if {
    count(sender_authentication_enforcement) > 0
}

_spam_filtering_accuracy_def := {
    "name": "Spam Filtering Accuracy",
    "description": "Delivers probabilistic content scoring and header analysis to classify unwanted bulk mail, with tunable false-positive and false-negative thresholds configurable per domain or user.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CF",
            "name": "Content Filtering",
            "relevance": "Directly applies content-based analysis to identify and filter spam messages accurately."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-SRA",
            "name": "Sender Reputation Analysis",
            "relevance": "Uses sender reputation signals to improve spam detection accuracy and reduce false positives."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MA",
            "name": "Message Analysis",
            "relevance": "Analyzes message content and metadata to distinguish spam from legitimate email."
        }
    ]
}

spam_filtering_accuracy[_spam_filtering_accuracy_def] if {
    input.spam_filter_enabled == true
    input.spam_score_threshold <= 7
    input.spam_action_on_detection in ["reject", "quarantine"]
}

spam_filtering_accuracy[_spam_filtering_accuracy_def] if {
    input.spam_filter_enabled == true
    input.spam_action_on_detection in ["reject", "quarantine"]
    count(input.header_analysis_checks) >= 3
}

countermeasures contains _spam_filtering_accuracy_def if {
    count(spam_filtering_accuracy) > 0
}

_dmarc_policy_disposition_automation_def := {
    "name": "Dmarc Policy Disposition Automation",
    "description": "Provides automated enforcement of quarantine or reject actions based on DMARC policy alignment results, removing manual intervention requirements for unauthenticated mail disposition.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EF",
            "name": "Email Filtering",
            "relevance": "Automates the filtering and disposition of messages based on DMARC policy outcomes (none, quarantine, reject)."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CQ",
            "name": "Content Quarantine",
            "relevance": "Supports automated quarantine disposition for messages that fail DMARC evaluation."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ER",
            "name": "Email Removal",
            "relevance": "Enables automated removal/rejection of messages that fail DMARC policy checks."
        }
    ]
}

dmarc_policy_disposition_automation[_dmarc_policy_disposition_automation_def] if {
    input.dmarc_record_present == true
    input.dmarc_policy_level == "reject"
    input.dmarc_pct_value == 100
}

dmarc_policy_disposition_automation[_dmarc_policy_disposition_automation_def] if {
    input.dmarc_record_present == true
    input.dmarc_policy_level == "quarantine"
    input.dmarc_pct_value == 100
}

countermeasures contains _dmarc_policy_disposition_automation_def if {
    count(dmarc_policy_disposition_automation) > 0
}

_header_inspection_depth_def := {
    "name": "Header Inspection Depth",
    "description": "Provides granular parsing of email header chains including received hops, reply-to mismatches, and display-name spoofing indicators, enabling detection of deceptive routing and identity manipulation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MA",
            "name": "Message Analysis",
            "relevance": "Encompasses deep inspection of email headers to detect anomalies, spoofing, and policy violations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EF",
            "name": "Email Filtering",
            "relevance": "Applies header-based filtering rules to identify and block suspicious or malformed messages."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-HD",
            "name": "Homoglyph Detection",
            "relevance": "Inspects header fields for homoglyph-based deception in sender addresses and display names."
        }
    ]
}

header_inspection_depth[_header_inspection_depth_def] if {
    input.header_inspection_enabled == true
    input.display_name_spoofing_check == true
    input.reply_to_mismatch_action in ["tag", "quarantine", "reject"]
}

header_inspection_depth[_header_inspection_depth_def] if {
    input.header_inspection_enabled == true
    input.display_name_spoofing_check == true
    input.max_received_hops_exceeded > 0
}

countermeasures contains _header_inspection_depth_def if {
    count(header_inspection_depth) > 0
}

_url_and_attachment_sandboxing_integration_def := {
    "name": "Url And Attachment Sandboxing Integration",
    "description": "Delivers pre-delivery detonation and analysis of embedded URLs and file attachments through integration with sandboxing engines, providing verdict-based blocking before message reaches recipient.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1048",
            "name": "Application Isolation and Sandboxing",
            "relevance": "Directly describes sandboxing of URLs and attachments to detect malicious behavior in an isolated environment."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DA",
            "name": "Dynamic Analysis",
            "relevance": "Executes URLs and attachments dynamically in a sandbox to detect malicious activity."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-UA",
            "name": "URL Analysis",
            "relevance": "Analyzes URLs found in messages to identify malicious links before delivery to end users."
        }
    ]
}

url_and_attachment_sandboxing_integration[_url_and_attachment_sandboxing_integration_def] if {
    input.sandboxing_integration_enabled == true
    input.sandbox_verdict_action in ["block", "quarantine", "replace"]
    "urls" in input.sandbox_scope
    "attachments" in input.sandbox_scope
    input.policy_applies_to_inbound == true
}

countermeasures contains _url_and_attachment_sandboxing_integration_def if {
    count(url_and_attachment_sandboxing_integration) > 0
}

_delivery_log_completeness_def := {
    "name": "Delivery Log Completeness",
    "description": "Provides structured, timestamped logging of all inbound and outbound message events including authentication results, filter verdicts, and delivery status, supporting forensic reconstruction and compliance auditing.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Ensures comprehensive logging and auditing of email delivery events to support completeness requirements."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-MA",
            "name": "Message Analysis",
            "relevance": "Supports capturing and analyzing message metadata to ensure delivery log completeness."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ISVA",
            "name": "Inbound Session Volume Analysis",
            "relevance": "Tracks inbound session data that contributes to comprehensive delivery log records."
        }
    ]
}

delivery_log_completeness[_delivery_log_completeness_def] if {
    input.logging_enabled == true
    "authentication_result" in input.logged_fields
    "filter_verdict" in input.logged_fields
    "delivery_status" in input.logged_fields
    "timestamp" in input.logged_fields
    input.log_retention_days >= 90
}

countermeasures contains _delivery_log_completeness_def if {
    count(delivery_log_completeness) > 0
}

_outbound_policy_enforcement_def := {
    "name": "Outbound Policy Enforcement",
    "description": "Delivers egress filtering and signing enforcement to ensure outbound messages carry valid DKIM signatures and originate from authorized IP ranges, protecting organizational sender reputation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Directly enforces policies on outbound email traffic to prevent unauthorized or policy-violating messages."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "name": "Data Loss Prevention",
            "relevance": "Enforces outbound policies to prevent sensitive data from being transmitted via email."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EF",
            "name": "Email Filtering",
            "relevance": "Applies outbound filtering rules to enforce organizational email transmission policies."
        }
    ]
}

outbound_policy_enforcement[_outbound_policy_enforcement_def] if {
    input.dkim_signing_enabled == true
    input.authorized_sending_ip_policy == "enforced"
    input.dmarc_policy_level in ["reject", "quarantine"]
}

outbound_policy_enforcement[_outbound_policy_enforcement_def] if {
    input.dkim_signing_enabled == true
    input.authorized_sending_ip_policy == "enforced"
    input.outbound_spam_filtering_enabled == true
}

countermeasures contains _outbound_policy_enforcement_def if {
    count(outbound_policy_enforcement) > 0
}

_rule_maintainability_and_updateability_def := {
    "name": "Rule Maintainability And Updateability",
    "description": "Provides operational capacity to update filtering rules, blocklists, and authentication policies without service interruption, ensuring the control remains effective as threat patterns evolve.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Keeping filtering rule engines and software updated is essential for rule maintainability and effectiveness."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CF",
            "name": "Content Filtering",
            "relevance": "Content filtering rule sets require ongoing maintenance and updates to remain effective against evolving threats."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Maintainable and updateable network filtering rules are central to sustaining effective security posture."
        }
    ]
}

rule_maintainability_and_updateability[_rule_maintainability_and_updateability_def] if {
    input.live_rule_update_supported == true
    input.rule_update_mechanism in ["automated", "scheduled"]
    input.blocklist_last_updated_days_ago <= 7
}

rule_maintainability_and_updateability[_rule_maintainability_and_updateability_def] if {
    input.live_rule_update_supported == true
    input.rule_update_mechanism == "manual"
    input.blocklist_last_updated_days_ago <= 7
}

countermeasures contains _rule_maintainability_and_updateability_def if {
    count(rule_maintainability_and_updateability) > 0
}

_quarantine_management_workflow_def := {
    "name": "Quarantine Management Workflow",
    "description": "Delivers structured quarantine holding with configurable retention periods, user-accessible release interfaces, and administrative review capabilities, reducing both false-positive impact and missed-detection risk.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CQ",
            "name": "Content Quarantine",
            "relevance": "Directly describes the quarantine of suspicious content as part of a managed workflow for review and disposition."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CF",
            "name": "Content Filtering",
            "relevance": "Content filtering feeds the quarantine workflow by identifying messages requiring manual review or holding."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1049",
            "name": "Antivirus/Antimalware",
            "relevance": "Antimalware scanning integrates with quarantine workflows to identify and isolate malicious email content."
        }
    ]
}

quarantine_management_workflow[_quarantine_management_workflow_def] if {
    input.quarantine_enabled == true
    input.retention_period_days >= 7
    input.user_release_interface_enabled == true
    input.admin_review_notifications_enabled == true
}

quarantine_management_workflow[_quarantine_management_workflow_def] if {
    input.quarantine_enabled == true
    input.retention_period_days >= 7
    input.admin_review_notifications_enabled == true
}

countermeasures contains _quarantine_management_workflow_def if {
    count(quarantine_management_workflow) > 0
}
