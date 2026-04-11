package _dt_built_in.exposures.email_server

_open_relay_misconfiguration_def := {
    "name": "Open Relay Misconfiguration",
    "description": "SMTP server configured to relay email for any sender or destination without authentication, enabling abuse as a spam or phishing relay. Detectable by testing relay acceptance from unauthenticated external IPs.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "An open relay allows attackers to send spoofed emails through the misconfigured server without authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1667",
            "name": "Email Bombing",
            "relevance": "Open relays are commonly abused to send large volumes of spam or bombing emails by relaying through the misconfigured server."
        }
    ]
}

open_relay_misconfiguration[_open_relay_misconfiguration_def] if {
    input.relay_restriction_policy == "open"
}

open_relay_misconfiguration[_open_relay_misconfiguration_def] if {
    not input.smtp_auth_required
}

open_relay_misconfiguration[_open_relay_misconfiguration_def] if {
    input.open_relay_test_result == true
}

exposures contains _open_relay_misconfiguration_def if {
    count(open_relay_misconfiguration) > 0
}

_missing_or_weak_smtp_authentication_def := {
    "name": "Missing Or Weak Smtp Authentication",
    "description": "SMTP AUTH not enforced or permits weak mechanisms (PLAIN without TLS, LOGIN over cleartext), allowing credential interception or brute-force attacks to gain authenticated relay access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.001",
            "name": "Password Guessing",
            "relevance": "Weak or missing SMTP authentication enables attackers to guess credentials to gain unauthorized access to the mail server."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "name": "Password Spraying",
            "relevance": "Absent or weak SMTP authentication makes the service susceptible to password spraying attacks across multiple accounts."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.004",
            "name": "Credential Stuffing",
            "relevance": "Weak SMTP authentication allows credential stuffing attacks using previously breached username/password pairs."
        }
    ]
}

missing_or_weak_smtp_authentication[_missing_or_weak_smtp_authentication_def] if {
    not input.smtp_auth_enabled
}

missing_or_weak_smtp_authentication[_missing_or_weak_smtp_authentication_def] if {
    not input.tls_required_before_auth
    "PLAIN" in input.permitted_auth_mechanisms
}

missing_or_weak_smtp_authentication[_missing_or_weak_smtp_authentication_def] if {
    not input.tls_required_before_auth
    "LOGIN" in input.permitted_auth_mechanisms
}

exposures contains _missing_or_weak_smtp_authentication_def if {
    count(missing_or_weak_smtp_authentication) > 0
}

_cleartext_smtp_transmission_def := {
    "name": "Cleartext Smtp Transmission",
    "description": "SMTP connections permitted without STARTTLS or TLS enforcement (opportunistic only), exposing email content and credentials to interception on transit paths.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "name": "Mail Protocols",
            "relevance": "Cleartext SMTP transmission exposes mail protocol communications to interception and monitoring."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.002",
            "name": "Remote Email Collection",
            "relevance": "Unencrypted SMTP traffic allows attackers to collect email content and credentials through network interception."
        }
    ]
}

cleartext_smtp_transmission[_cleartext_smtp_transmission_def] if {
    input.starttls_enforcement == "disabled"
}

cleartext_smtp_transmission[_cleartext_smtp_transmission_def] if {
    input.starttls_enforcement == "opportunistic"
    not input.tls_wrapper_mode_enabled
}

cleartext_smtp_transmission[_cleartext_smtp_transmission_def] if {
    input.plaintext_auth_permitted_without_tls == true
    not input.starttls_enforcement in ["required"]
}

exposures contains _cleartext_smtp_transmission_def if {
    count(cleartext_smtp_transmission) > 0
}

_weak_tls_cipher_or_protocol_version_def := {
    "name": "Weak Tls Cipher Or Protocol Version",
    "description": "MTA configured to accept deprecated TLS versions (TLS 1.0, 1.1) or weak cipher suites, making encrypted sessions vulnerable to downgrade or decryption attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak TLS cipher support enables downgrade attacks forcing connections to use weaker encryption protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Weak TLS ciphers reduce the effective key space, making encrypted communications easier to break."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Using outdated TLS protocol versions or weak ciphers directly weakens the encryption protecting email in transit."
        }
    ]
}

weak_tls_cipher_or_protocol_version[_weak_tls_cipher_or_protocol_version_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"]
}

weak_tls_cipher_or_protocol_version[_weak_tls_cipher_or_protocol_version_def] if {
    input.weak_cipher_suites_enabled == true
}

weak_tls_cipher_or_protocol_version[_weak_tls_cipher_or_protocol_version_def] if {
    input.tls_security_level == "none"
}

exposures contains _weak_tls_cipher_or_protocol_version_def if {
    count(weak_tls_cipher_or_protocol_version) > 0
}

_missing_spf_dkim_dmarc_enforcement_def := {
    "name": "Missing Spf Dkim Dmarc Enforcement",
    "description": "MTA does not validate inbound SPF, DKIM signatures, or DMARC policies, allowing spoofed sender domains to reach recipients. Outbound signing also absent, undermining delivery reputation.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "Missing SPF, DKIM, and DMARC policies allow attackers to spoof the domain in phishing and fraud campaigns."
        }
    ]
}

missing_spf_dkim_dmarc_enforcement[_missing_spf_dkim_dmarc_enforcement_def] if {
    not input.inbound_spf_validation_enabled
}

missing_spf_dkim_dmarc_enforcement[_missing_spf_dkim_dmarc_enforcement_def] if {
    not input.inbound_dkim_verification_enabled
}

missing_spf_dkim_dmarc_enforcement[_missing_spf_dkim_dmarc_enforcement_def] if {
    input.dmarc_policy_enforcement_mode == "none"
}

missing_spf_dkim_dmarc_enforcement[_missing_spf_dkim_dmarc_enforcement_def] if {
    not input.outbound_dkim_signing_enabled
}

exposures contains _missing_spf_dkim_dmarc_enforcement_def if {
    count(missing_spf_dkim_dmarc_enforcement) > 0
}

_insufficient_rate_limiting_and_connection_throttling_def := {
    "name": "Insufficient Rate Limiting And Connection Throttling",
    "description": "No per-IP connection rate limits or message volume thresholds configured, enabling brute-force credential attacks and denial-of-service via connection exhaustion or queue flooding.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Without rate limiting, attackers can flood the SMTP service with connections to cause a denial of service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "name": "Brute Force",
            "relevance": "Insufficient throttling allows unrestricted brute force attacks against mail server authentication."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110.003",
            "name": "Password Spraying",
            "relevance": "Lack of connection throttling enables password spraying attacks against multiple accounts without lockout."
        }
    ]
}

insufficient_rate_limiting_and_connection_throttling[_insufficient_rate_limiting_and_connection_throttling_def] if {
    not input.per_ip_connection_rate_limit_configured
    not input.auth_failure_rate_limit_configured
}

insufficient_rate_limiting_and_connection_throttling[_insufficient_rate_limiting_and_connection_throttling_def] if {
    not input.per_ip_connection_rate_limit_configured
    not input.concurrent_connection_limit_configured
}

insufficient_rate_limiting_and_connection_throttling[_insufficient_rate_limiting_and_connection_throttling_def] if {
    not input.max_messages_per_connection_configured
    not input.concurrent_connection_limit_configured
}

exposures contains _insufficient_rate_limiting_and_connection_throttling_def if {
    count(insufficient_rate_limiting_and_connection_throttling) > 0
}

_overprivileged_mta_service_account_def := {
    "name": "Overprivileged Mta Service Account",
    "description": "MTA daemon runs as root or a high-privilege OS account rather than a dedicated least-privilege user, expanding the blast radius if the process is compromised.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "name": "Abuse Elevation Control Mechanism",
            "relevance": "An overprivileged MTA service account can be abused to escalate privileges or perform privileged actions on the host system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548.002",
            "name": "Bypass User Account Control",
            "relevance": "Excessive privileges on the MTA service account may allow bypassing access controls to perform unauthorized system operations."
        }
    ]
}

overprivileged_mta_service_account[_overprivileged_mta_service_account_def] if {
    input.mta_process_run_user == "root"
}

overprivileged_mta_service_account[_overprivileged_mta_service_account_def] if {
    input.mta_process_run_uid == 0
}

overprivileged_mta_service_account[_overprivileged_mta_service_account_def] if {
    not input.mta_dedicated_service_account_configured
}

exposures contains _overprivileged_mta_service_account_def if {
    count(overprivileged_mta_service_account) > 0
}

_unpatched_mta_software_def := {
    "name": "Unpatched Mta Software",
    "description": "Mail server software (e.g., Postfix, Sendmail, Exim) running outdated versions with known CVEs, exposing the host to remote code execution or privilege escalation via protocol parsing flaws.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Unpatched MTA software exposes known vulnerabilities that attackers can exploit to compromise the public-facing mail server."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1210",
            "name": "Exploitation of Remote Services",
            "relevance": "Known vulnerabilities in unpatched MTA software can be exploited remotely to gain unauthorized access."
        }
    ]
}

unpatched_mta_software[_unpatched_mta_software_def] if {
    input.version_has_known_cve == true
}

unpatched_mta_software[_unpatched_mta_software_def] if {
    input.days_since_last_update > 180
    input.mta_version
}

exposures contains _unpatched_mta_software_def if {
    count(unpatched_mta_software) > 0
}

_plaintext_credential_storage_in_config_def := {
    "name": "Plaintext Credential Storage In Config",
    "description": "SMTP relay credentials, API keys, or TLS private keys stored in cleartext within configuration files with overly permissive filesystem permissions, accessible to local users or during config backups.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "name": "Credentials In Files",
            "relevance": "Storing SMTP credentials in plaintext configuration files allows attackers to directly harvest them from the filesystem."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Plaintext credentials in config files represent unsecured credentials that can be easily extracted by adversaries."
        }
    ]
}

plaintext_credential_storage_in_config[_plaintext_credential_storage_in_config_def] if {
    input.credentials_stored_in_cleartext == true
    input.config_file_permissions == "world_readable"
}

plaintext_credential_storage_in_config[_plaintext_credential_storage_in_config_def] if {
    input.credentials_stored_in_cleartext == true
    input.config_file_permissions == "group_readable"
}

exposures contains _plaintext_credential_storage_in_config_def if {
    count(plaintext_credential_storage_in_config) > 0
}

_inadequate_mail_queue_and_audit_logging_def := {
    "name": "Inadequate Mail Queue And Audit Logging",
    "description": "MTA logging not capturing sender, recipient, message ID, source IP, and authentication outcome per message, preventing forensic analysis of relay abuse, data exfiltration, or spam campaigns.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.008",
            "name": "Clear Mailbox Data",
            "relevance": "Inadequate logging makes it difficult to detect or investigate mailbox data manipulation or deletion events."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.002",
            "name": "Transport Agent",
            "relevance": "Insufficient audit logging may fail to detect malicious transport agents installed on the mail server to intercept messages."
        }
    ]
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    not input.log_level_configured
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    input.log_level_configured == true
    not "sender" in input.logged_fields
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    input.log_level_configured == true
    not "recipient" in input.logged_fields
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    input.log_level_configured == true
    not "source_ip" in input.logged_fields
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    input.log_level_configured == true
    not "auth_outcome" in input.logged_fields
}

inadequate_mail_queue_and_audit_logging[_inadequate_mail_queue_and_audit_logging_def] if {
    input.log_level_configured == true
    not "message_id" in input.logged_fields
}

exposures contains _inadequate_mail_queue_and_audit_logging_def if {
    count(inadequate_mail_queue_and_audit_logging) > 0
}

_unrestricted_management_interface_exposure_def := {
    "name": "Unrestricted Management Interface Exposure",
    "description": "Administrative interfaces (e.g., Postfix admin, web console, postsuper CLI) accessible from untrusted networks without IP allowlisting or VPN requirement, enabling unauthorized configuration changes.",
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
            "relevance": "Exposing MTA management interfaces publicly allows attackers to exploit vulnerabilities in those interfaces directly."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Unrestricted management interface exposure allows attackers to remotely access and control the MTA using legitimate remote service protocols."
        }
    ]
}

unrestricted_management_interface_exposure[_unrestricted_management_interface_exposure_def] if {
    input.admin_interface_exposed == true
    input.admin_interface_network_restriction == "none"
}

unrestricted_management_interface_exposure[_unrestricted_management_interface_exposure_def] if {
    input.admin_interface_exposed == true
    input.admin_interface_authentication == "none"
}

exposures contains _unrestricted_management_interface_exposure_def if {
    count(unrestricted_management_interface_exposure) > 0
}

_missing_mta_sts_or_dane_policy_def := {
    "name": "Missing Mta Sts Or Dane Policy",
    "description": "MTA-STS or DANE (DNSSEC-authenticated certificates) not configured for outbound delivery, allowing active adversaries to strip TLS and intercept email via SMTP downgrade attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "Without MTA-STS or DANE, attackers can perform downgrade or spoofing attacks on email transport security."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Absence of DANE leaves certificate validation reliant on CA trust, enabling attacks with fraudulent certificates during email transit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Missing DANE/MTA-STS policies that rely on DNS for enforcement can be undermined by DNS server compromise or manipulation."
        }
    ]
}

missing_mta_sts_or_dane_policy[_missing_mta_sts_or_dane_policy_def] if {
    not input.mta_sts_policy_configured
    not input.dane_tlsa_records_configured
}

exposures contains _missing_mta_sts_or_dane_policy_def if {
    count(missing_mta_sts_or_dane_policy) > 0
}

_attachment_and_content_filtering_disabled_def := {
    "name": "Attachment And Content Filtering Disabled",
    "description": "No content inspection policy enforced at the MTA layer for dangerous attachment types or malformed MIME structures, increasing exposure to malware delivery through email.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.009",
            "name": "Embedded Payloads",
            "relevance": "Disabled content filtering allows emails with embedded malicious payloads to reach end users undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.006",
            "name": "HTML Smuggling",
            "relevance": "Without attachment and content filtering, HTML smuggling techniques in email attachments bypass security controls."
        }
    ]
}

attachment_and_content_filtering_disabled[_attachment_and_content_filtering_disabled_def] if {
    not input.attachment_type_filtering_enabled
}

attachment_and_content_filtering_disabled[_attachment_and_content_filtering_disabled_def] if {
    input.antimalware_scan_integration == "none"
}

attachment_and_content_filtering_disabled[_attachment_and_content_filtering_disabled_def] if {
    not input.mime_structure_validation_enabled
    not input.antimalware_scan_integration in ["full"]
}

exposures contains _attachment_and_content_filtering_disabled_def if {
    count(attachment_and_content_filtering_disabled) > 0
}

_dns_reverse_lookup_validation_absent_def := {
    "name": "Dns Reverse Lookup Validation Absent",
    "description": "MTA does not perform reverse DNS (PTR) validation or reject connections from IPs with no matching PTR record, reducing friction for spam and phishing sources using ephemeral infrastructure.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1568.001",
            "name": "Fast Flux DNS",
            "relevance": "Without reverse DNS validation, fast flux DNS techniques can be used to obscure the true origin of malicious sending servers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Absent reverse lookup validation allows attackers to exploit DNS misconfigurations to misrepresent sending server identity."
        }
    ]
}

dns_reverse_lookup_validation_absent[_dns_reverse_lookup_validation_absent_def] if {
    not input.ptr_validation_enabled
}

dns_reverse_lookup_validation_absent[_dns_reverse_lookup_validation_absent_def] if {
    input.ptr_validation_enabled == true
    input.no_ptr_rejection_policy in ["accept", "tag"]
}

exposures contains _dns_reverse_lookup_validation_absent_def if {
    count(dns_reverse_lookup_validation_absent) > 0
}

_mail_queue_directory_permission_misconfiguration_def := {
    "name": "Mail Queue Directory Permission Misconfiguration",
    "description": "Mail spool or queue directories writable by non-MTA users, enabling local users to inject or tamper with queued messages before delivery.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.002",
            "name": "Additional Email Delegate Permissions",
            "relevance": "Misconfigured mail queue directory permissions may allow unauthorized users to access or manipulate queued email data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.002",
            "name": "Remote Email Collection",
            "relevance": "Loose permissions on mail queue directories enable unauthorized collection of emails staged in the queue."
        }
    ]
}

mail_queue_directory_permission_misconfiguration[_mail_queue_directory_permission_misconfiguration_def] if {
    input.queue_directory_world_writable == true
}

mail_queue_directory_permission_misconfiguration[_mail_queue_directory_permission_misconfiguration_def] if {
    input.queue_directory_group_writable_by_non_mta == true
}

mail_queue_directory_permission_misconfiguration[_mail_queue_directory_permission_misconfiguration_def] if {
    not input.queue_directory_owner in ["postfix", "mail", "smmsp", "mailnull", "exim", "qmail"]
}

exposures contains _mail_queue_directory_permission_misconfiguration_def if {
    count(mail_queue_directory_permission_misconfiguration) > 0
}
