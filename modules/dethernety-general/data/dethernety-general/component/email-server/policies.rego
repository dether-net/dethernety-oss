package _dt_built_in.exposures.email_server



_domain_spoofing_via_missing_or_weak_email_authentication_def := {
    "name": "Domain spoofing via missing or weak email authentication",
    "description": "Absent or permissive SPF (~all/?all/+all), unsigned DKIM, or a DMARC policy of p=none lets an attacker forge the organization's domain in the From header \u2014 the primary phishing delivery channel. Without aligned SPF+DKIM and an enforcing DMARC (p=reject), receivers have no basis to reject spoofed mail.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

domain_spoofing_via_missing_or_weak_email_authentication[_domain_spoofing_via_missing_or_weak_email_authentication_def] if {
    input.spf_policy in ["softfail", "none"]
}

domain_spoofing_via_missing_or_weak_email_authentication[_domain_spoofing_via_missing_or_weak_email_authentication_def] if {
    not input.dkim_signing_enabled
}

domain_spoofing_via_missing_or_weak_email_authentication[_domain_spoofing_via_missing_or_weak_email_authentication_def] if {
    input.dmarc_policy == "none"
}

exposures contains _domain_spoofing_via_missing_or_weak_email_authentication_def if {
    count(domain_spoofing_via_missing_or_weak_email_authentication) > 0
}

_cleartext_transport_starttls_stripping_mitm_def := {
    "name": "Cleartext transport / STARTTLS stripping (MITM)",
    "description": "Opportunistic STARTTLS can be stripped by an active on-path attacker, silently downgrading the session to cleartext and exposing mail contents and credentials in transit. Mitigated only by downgrade-resistant transport (MTA-STS mode:enforce or DANE) backed by TLS-RPT failure visibility.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_transport_starttls_stripping_mitm[_cleartext_transport_starttls_stripping_mitm_def] if {
    input.opportunistic_tls_only == true
    not input.mta_sts_enforce_mode
    not input.dane_outbound_enabled
}

cleartext_transport_starttls_stripping_mitm[_cleartext_transport_starttls_stripping_mitm_def] if {
    input.smtpd_tls_security_level == "none"
}

cleartext_transport_starttls_stripping_mitm[_cleartext_transport_starttls_stripping_mitm_def] if {
    input.smtp_tls_security_level == "none"
}

cleartext_transport_starttls_stripping_mitm[_cleartext_transport_starttls_stripping_mitm_def] if {
    input.weak_tls_versions_enabled == true
}

exposures contains _cleartext_transport_starttls_stripping_mitm_def if {
    count(cleartext_transport_starttls_stripping_mitm) > 0
}

_open_relay_abuse_def := {
    "name": "Open relay abuse",
    "description": "An MTA missing reject_unauth_destination, or with mynetworks scoped to overly broad/public ranges, relays arbitrary mail for any client \u2014 enabling spam/phishing distribution, IP-reputation blacklisting, and backscatter. This is an authorization failure at the relay-control boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

open_relay_abuse[_open_relay_abuse_def] if {
    not input.relay_restrictions_enforced
}

open_relay_abuse[_open_relay_abuse_def] if {
    input.mynetworks_overly_broad == true
}

exposures contains _open_relay_abuse_def if {
    count(open_relay_abuse) > 0
}

_plaintext_smtp_auth_credential_capture_def := {
    "name": "Plaintext SMTP AUTH credential capture",
    "description": "Offering SMTP AUTH on cleartext connections (smtpd_tls_auth_only=no) lets a passive sniffer or MITM harvest mailbox credentials in the clear, yielding account takeover and an authenticated relay/exfil foothold.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_smtp_auth_credential_capture[_plaintext_smtp_auth_credential_capture_def] if {
    input.smtp_auth_allowed_without_tls == true
}

exposures contains _plaintext_smtp_auth_credential_capture_def if {
    count(plaintext_smtp_auth_credential_capture) > 0
}

_inbound_phishing_and_malware_delivery_no_content_filtering_def := {
    "name": "Inbound phishing and malware delivery (no content filtering)",
    "description": "Without a content_filter/milter pipeline (anti-spam/anti-phishing, malware and attachment scanning, link rewriting/detonation), phishing emails and malicious attachments are delivered to users unimpeded \u2014 the email server's role as the primary phishing delivery channel goes undefended.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

inbound_phishing_and_malware_delivery_no_content_filtering[_inbound_phishing_and_malware_delivery_no_content_filtering_def] if {
    not input.content_filtering_enabled
}

inbound_phishing_and_malware_delivery_no_content_filtering[_inbound_phishing_and_malware_delivery_no_content_filtering_def] if {
    not input.attachment_malware_scanning
}

inbound_phishing_and_malware_delivery_no_content_filtering[_inbound_phishing_and_malware_delivery_no_content_filtering_def] if {
    not input.link_detonation
}

exposures contains _inbound_phishing_and_malware_delivery_no_content_filtering_def if {
    count(inbound_phishing_and_malware_delivery_no_content_filtering) > 0
}

_data_exfiltration_over_email_no_egress_dlp_def := {
    "name": "Data exfiltration over email (no egress DLP)",
    "description": "Email is a frequent exfiltration path \u2014 silent auto-forwarding rules, hidden BCC, or bulk attachment egress move sensitive data out of the organization. Absent outbound DLP/content inspection and auto-forward restrictions, exfiltration via mail is undetected.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1020",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

data_exfiltration_over_email_no_egress_dlp[_data_exfiltration_over_email_no_egress_dlp_def] if {
    not input.dlp_egress_controls_enabled
}

data_exfiltration_over_email_no_egress_dlp[_data_exfiltration_over_email_no_egress_dlp_def] if {
    not input.external_auto_forward_blocked
}

data_exfiltration_over_email_no_egress_dlp[_data_exfiltration_over_email_no_egress_dlp_def] if {
    not input.bulk_export_monitored_and_alerted
}

exposures contains _data_exfiltration_over_email_no_egress_dlp_def if {
    count(data_exfiltration_over_email_no_egress_dlp) > 0
}

_recipient_enumeration_and_version_disclosure_def := {
    "name": "Recipient enumeration and version disclosure",
    "description": "Enabled VRFY/EXPN commands let attackers enumerate valid mailboxes for targeted spear-phishing, and a version-bearing SMTP banner fingerprints the MTA software/version to steer CVE targeting. Both are information-disclosure hardening gaps.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1087",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

recipient_enumeration_and_version_disclosure[_recipient_enumeration_and_version_disclosure_def] if {
    input.vrfy_expn_enabled == true
}

recipient_enumeration_and_version_disclosure[_recipient_enumeration_and_version_disclosure_def] if {
    input.version_banner_disclosed == true
}

exposures contains _recipient_enumeration_and_version_disclosure_def if {
    count(recipient_enumeration_and_version_disclosure) > 0
}

_unpatched_mta_remote_code_execution_def := {
    "name": "Unpatched MTA remote code execution",
    "description": "Critical MTA flaws permit unauthenticated remote code execution \u2014 Exim CVE-2019-10149 ('Return of the WIZard', RCE as root, exploited in the wild) and the 2023 SMTP-service CVE-2023-42115 (CVSS 9.8 out-of-bounds write). An internet-facing MTA on an unpatched branch is directly exploitable for full host compromise.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Unauthenticated RCE against an internet-facing MTA (Exim CVE-2019-10149 / CVE-2023-42115) is exploitation of a public-facing application for initial access / full host compromise."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "attributes": {
                "justification": "The MTA's network-reachable SMTP service is the remote service exploited; an attacker leverages the unpatched daemon to execute code on the host."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_mta_remote_code_execution[_unpatched_mta_remote_code_execution_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_mta_remote_code_execution[_unpatched_mta_remote_code_execution_def] if {
    not input.mta_patched_within_sla
    input.mta_internet_facing == true
}

exposures contains _unpatched_mta_remote_code_execution_def if {
    count(unpatched_mta_remote_code_execution) > 0
}

_smtp_borne_dos_connection_flooding_def := {
    "name": "SMTP-borne DoS / connection flooding",
    "description": "Unbounded connection and message rates (no anvil/smtpd client limits) expose the MTA to connection floods, spam-burst abuse, and backscatter amplification, degrading or denying mail availability for the organization.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1667",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

smtp_borne_dos_connection_flooding[_smtp_borne_dos_connection_flooding_def] if {
    not input.rate_limiting_or_lockout_enabled
}

smtp_borne_dos_connection_flooding[_smtp_borne_dos_connection_flooding_def] if {
    not input.ddos_protection_in_place
}

smtp_borne_dos_connection_flooding[_smtp_borne_dos_connection_flooding_def] if {
    input.smtpd_client_connection_rate_limit == 0
}

smtp_borne_dos_connection_flooding[_smtp_borne_dos_connection_flooding_def] if {
    input.smtpd_client_message_rate_limit == 0
}

smtp_borne_dos_connection_flooding[_smtp_borne_dos_connection_flooding_def] if {
    input.smtpd_client_connection_count_limit == 0
}

exposures contains _smtp_borne_dos_connection_flooding_def if {
    count(smtp_borne_dos_connection_flooding) > 0
}

_no_mail_audit_trail_def := {
    "name": "No mail audit trail",
    "description": "If mail transaction and SASL-authentication logging is disabled, not retained, or not shipped to a central SIEM, there is no audit trail to detect or investigate phishing campaigns, open-relay abuse, credential compromise, or data exfiltration after the fact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

no_mail_audit_trail[_no_mail_audit_trail_def] if {
    not input.mail_logging_enabled
}

no_mail_audit_trail[_no_mail_audit_trail_def] if {
    not input.security_events_fully_logged
}

no_mail_audit_trail[_no_mail_audit_trail_def] if {
    not input.access_audit_trail_enabled
}

no_mail_audit_trail[_no_mail_audit_trail_def] if {
    not input.centralized_log_aggregation
}

no_mail_audit_trail[_no_mail_audit_trail_def] if {
    not input.logs_stored_on_separate_system
}

exposures contains _no_mail_audit_trail_def if {
    count(no_mail_audit_trail) > 0
}
