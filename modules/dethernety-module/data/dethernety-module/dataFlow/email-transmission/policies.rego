package _dt_built_in.exposures.email_transmission

_opportunistic_tls_downgrade_def := {
    "name": "Opportunistic Tls Downgrade",
    "description": "SMTP connections configured with opportunistic TLS (STARTTLS) can be downgraded to plaintext by an active network adversary who strips the STARTTLS advertisement, exposing email content including PII and credentials in transit.",
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
            "relevance": "Attackers exploiting opportunistic TLS downgrade abuse SMTP mail protocols to intercept communications when encryption is negotiated away."
        }
    ],
    "attack_vector": "NETWORK"
}

opportunistic_tls_downgrade[_opportunistic_tls_downgrade_def] if {
    input.starttls_enforcement_mode in ["opportunistic", "none"]
    not input.dane_tlsa_configured
    not input.mta_sts_policy_mode in ["enforce"]
}

opportunistic_tls_downgrade[_opportunistic_tls_downgrade_def] if {
    input.starttls_enforcement_mode == "opportunistic"
    input.mta_sts_policy_mode in ["none", "testing"]
    not input.dane_tlsa_configured
}

exposures contains _opportunistic_tls_downgrade_def if {
    count(opportunistic_tls_downgrade) > 0
}

_missing_dane_or_mta_sts_enforcement_def := {
    "name": "Missing Dane Or Mta Sts Enforcement",
    "description": "Without DANE (TLSA records) or MTA-STS policies, receiving domains cannot cryptographically enforce TLS usage or certificate validity on inbound SMTP connections, allowing certificate substitution and silent downgrade attacks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Without DANE or MTA-STS enforcement, attackers can present fraudulent certificates during SMTP connections, directly exploiting the absence of certificate validation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Adversaries may develop or obtain forged digital certificates to impersonate mail servers when DANE or MTA-STS policies are absent."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_dane_or_mta_sts_enforcement[_missing_dane_or_mta_sts_enforcement_def] if {
    not input.dane_tlsa_configured
    input.mta_sts_policy_mode in ["testing", "none", "absent"]
}

missing_dane_or_mta_sts_enforcement[_missing_dane_or_mta_sts_enforcement_def] if {
    not input.dane_tlsa_configured
    input.mta_sts_policy_mode == "absent"
}

exposures contains _missing_dane_or_mta_sts_enforcement_def if {
    count(missing_dane_or_mta_sts_enforcement) > 0
}

_weak_or_expired_tls_certificate_on_relay_def := {
    "name": "Weak Or Expired Tls Certificate On Relay",
    "description": "SMTP relays presenting self-signed, expired, or weak-cipher TLS certificates allow connecting MTAs to either reject delivery or silently accept the connection without proper validation, undermining transport confidentiality guarantees.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1608.003",
            "name": "Install Digital Certificate",
            "relevance": "Weak or expired TLS certificates on relays directly relate to improper certificate installation and management, enabling attackers to exploit trust weaknesses."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Expired or weak certificates on mail relays create opportunities for adversaries to forge or substitute fraudulent certificates to perform man-in-the-middle attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_expired_tls_certificate_on_relay[_weak_or_expired_tls_certificate_on_relay_def] if {
    input.tls_certificate_status == "self_signed"
}

weak_or_expired_tls_certificate_on_relay[_weak_or_expired_tls_certificate_on_relay_def] if {
    input.tls_certificate_status == "expired"
}

weak_or_expired_tls_certificate_on_relay[_weak_or_expired_tls_certificate_on_relay_def] if {
    input.tls_certificate_status == "untrusted_ca"
}

weak_or_expired_tls_certificate_on_relay[_weak_or_expired_tls_certificate_on_relay_def] if {
    input.minimum_tls_cipher_strength == "weak"
}

weak_or_expired_tls_certificate_on_relay[_weak_or_expired_tls_certificate_on_relay_def] if {
    not input.tls_certificate_validation_enforced
}

exposures contains _weak_or_expired_tls_certificate_on_relay_def if {
    count(weak_or_expired_tls_certificate_on_relay) > 0
}

_absent_dkim_message_integrity_def := {
    "name": "Absent Dkim Message Integrity",
    "description": "Email messages lacking DKIM signatures have no cryptographic integrity protection in transit. Intermediate relays or network adversaries can modify message headers or body content \u2014 including injecting malicious payloads or altering PII \u2014 without detection at the receiving end.",
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
            "relevance": "Without DKIM signing, message integrity cannot be verified, directly enabling email spoofing where attackers forge sender identity and message content."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_dkim_message_integrity[_absent_dkim_message_integrity_def] if {
    not input.dkim_signing_enabled
}

absent_dkim_message_integrity[_absent_dkim_message_integrity_def] if {
    input.dkim_signing_enabled == true
    input.dkim_key_strength_bits < 1024
}

absent_dkim_message_integrity[_absent_dkim_message_integrity_def] if {
    input.dkim_signing_enabled == true
    not "From" in input.dkim_signed_headers
}

exposures contains _absent_dkim_message_integrity_def if {
    count(absent_dkim_message_integrity) > 0
}

_dns_mx_record_hijacking_def := {
    "name": "Dns Mx Record Hijacking",
    "description": "Without DNSSEC on MX record resolution, an adversary can poison DNS responses to redirect email flow to a rogue mail server under their control, enabling full interception of messages containing PII or credentials before re-injection or silent discard.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1584.002",
            "name": "DNS Server",
            "relevance": "Hijacking DNS MX records involves compromising or manipulating DNS server infrastructure to redirect mail traffic to attacker-controlled servers."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1590.002",
            "name": "DNS",
            "relevance": "Adversaries gather DNS information including MX records as reconnaissance to identify targets for MX record hijacking attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1583.002",
            "name": "DNS Server",
            "relevance": "Attackers may acquire or set up DNS servers to facilitate MX record hijacking and redirect victim email traffic."
        }
    ],
    "attack_vector": "NETWORK"
}

dns_mx_record_hijacking[_dns_mx_record_hijacking_def] if {
    not input.dnssec_enabled_for_domain
}

dns_mx_record_hijacking[_dns_mx_record_hijacking_def] if {
    input.dnssec_enabled_for_domain == true
    input.mx_record_validation_mode in ["dnssec_opportunistic", "none"]
}

dns_mx_record_hijacking[_dns_mx_record_hijacking_def] if {
    not input.dane_tlsa_configured
    input.mx_record_validation_mode == "none"
}

exposures contains _dns_mx_record_hijacking_def if {
    count(dns_mx_record_hijacking) > 0
}

_smtp_relay_hop_plaintext_leg_def := {
    "name": "Smtp Relay Hop Plaintext Leg",
    "description": "Multi-hop email routing through third-party relays or legacy internal MTAs may include individual legs transmitted in plaintext even when end-to-end TLS is assumed. Each unencrypted relay hop exposes full message content to the relay operator and any co-path observer.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "name": "Mail Protocols",
            "relevance": "Plaintext SMTP relay legs expose mail protocol communications to interception, directly relating to unencrypted use of mail protocols."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Attackers can exploit plaintext relay hops to tunnel malicious traffic or exfiltrate data through unencrypted SMTP relay segments."
        }
    ],
    "attack_vector": "NETWORK"
}

smtp_relay_hop_plaintext_leg[_smtp_relay_hop_plaintext_leg_def] if {
    not input.relay_hop_tls_enforced
}

smtp_relay_hop_plaintext_leg[_smtp_relay_hop_plaintext_leg_def] if {
    input.plaintext_relay_hops_detected == true
    not input.dkim_signing_enabled
}

exposures contains _smtp_relay_hop_plaintext_leg_def if {
    count(smtp_relay_hop_plaintext_leg) > 0
}

_missing_spf_dmarc_sender_authentication_def := {
    "name": "Missing Spf Dmarc Sender Authentication",
    "description": "Absence of SPF and DMARC policies on the sending domain allows adversaries to inject spoofed email into the flow that appears to originate from the legitimate sender, enabling credential phishing or PII exfiltration via social engineering over the same channel.",
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
            "relevance": "Missing SPF and DMARC records directly enables email spoofing by allowing unauthenticated senders to impersonate legitimate domains."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "name": "Phishing",
            "relevance": "Absence of SPF/DMARC authentication facilitates phishing attacks by allowing adversaries to send spoofed emails that appear to originate from trusted domains."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_spf_dmarc_sender_authentication[_missing_spf_dmarc_sender_authentication_def] if {
    not input.spf_record_present
}

missing_spf_dmarc_sender_authentication[_missing_spf_dmarc_sender_authentication_def] if {
    input.dmarc_policy == "missing"
}

missing_spf_dmarc_sender_authentication[_missing_spf_dmarc_sender_authentication_def] if {
    input.dmarc_policy == "none"
}

exposures contains _missing_spf_dmarc_sender_authentication_def if {
    count(missing_spf_dmarc_sender_authentication) > 0
}

_tls_protocol_version_cipher_weakness_def := {
    "name": "Tls Protocol Version Cipher Weakness",
    "description": "SMTP connections negotiating deprecated TLS versions (TLS 1.0/1.1) or weak cipher suites (RC4, export-grade, CBC without AEAD) are susceptible to protocol downgrade and cryptanalytic attacks such as BEAST or POODLE, exposing message confidentiality.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.001",
            "name": "Symmetric Cryptography",
            "relevance": "Weak TLS cipher suites using broken symmetric cryptography algorithms can be exploited to decrypt intercepted mail traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1573.002",
            "name": "Asymmetric Cryptography",
            "relevance": "Outdated TLS protocol versions with weak asymmetric cryptography expose key exchange mechanisms to attacks enabling session decryption."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_protocol_version_cipher_weakness[_tls_protocol_version_cipher_weakness_def] if {
    input.minimum_tls_version in ["none", "tls_1_0", "tls_1_1"]
}

tls_protocol_version_cipher_weakness[_tls_protocol_version_cipher_weakness_def] if {
    input.weak_cipher_suites_enabled == true
}

exposures contains _tls_protocol_version_cipher_weakness_def if {
    count(tls_protocol_version_cipher_weakness) > 0
}

_smtp_credential_exposure_in_authenticated_submission_def := {
    "name": "Smtp Credential Exposure In Authenticated Submission",
    "description": "Email submission over SMTP AUTH (port 587/465) without enforced TLS, or with TLS downgrade, transmits SASL credentials in the clear or under breakable encryption, allowing credential harvesting from the authentication exchange within the data flow.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1586.002",
            "name": "Email Accounts",
            "relevance": "Exposed SMTP credentials in authenticated submission directly enables adversaries to compromise and abuse email accounts for malicious purposes."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "name": "Mail Protocols",
            "relevance": "Credential exposure occurs over SMTP mail protocol sessions, making mail protocol abuse the direct vector for credential interception."
        }
    ],
    "attack_vector": "NETWORK"
}

smtp_credential_exposure_in_authenticated_submission[_smtp_credential_exposure_in_authenticated_submission_def] if {
    input.smtp_submission_tls_enforcement in ["none", "opportunistic"]
}

smtp_credential_exposure_in_authenticated_submission[_smtp_credential_exposure_in_authenticated_submission_def] if {
    not input.tls_downgrade_protection_enabled
}

smtp_credential_exposure_in_authenticated_submission[_smtp_credential_exposure_in_authenticated_submission_def] if {
    input.smtp_submission_tls_enforcement in ["enforced", "opportunistic"]
    input.minimum_tls_version in ["tls_1_0", "tls_1_1", "ssl_3_0", "none"]
}

smtp_credential_exposure_in_authenticated_submission[_smtp_credential_exposure_in_authenticated_submission_def] if {
    input.sasl_plaintext_mechanisms_advertised_outside_tls == true
}

exposures contains _smtp_credential_exposure_in_authenticated_submission_def if {
    count(smtp_credential_exposure_in_authenticated_submission) > 0
}

_email_traffic_metadata_leakage_def := {
    "name": "Email Traffic Metadata Leakage",
    "description": "Even with encrypted SMTP, envelope metadata (MAIL FROM, RCPT TO, timestamps, IP routing headers) is exposed to intermediate relay operators and network observers, enabling traffic analysis to identify communication patterns, sender-receiver relationships, and volume of PII-bearing flows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1589.002",
            "name": "Email Addresses",
            "relevance": "Email traffic metadata leakage exposes email addresses and communication patterns that adversaries collect for reconnaissance and targeting."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1114.002",
            "name": "Remote Email Collection",
            "relevance": "Adversaries may remotely collect email metadata leaked through unprotected traffic to build intelligence about organizational communications."
        }
    ],
    "attack_vector": "NETWORK"
}

email_traffic_metadata_leakage[_email_traffic_metadata_leakage_def] if {
    input.smtp_tls_enforced == "none"
    input.pii_bearing_email_flows_present == true
}

email_traffic_metadata_leakage[_email_traffic_metadata_leakage_def] if {
    input.smtp_tls_enforced == "opportunistic"
    not input.envelope_metadata_protection_enabled
    input.pii_bearing_email_flows_present == true
}

email_traffic_metadata_leakage[_email_traffic_metadata_leakage_def] if {
    input.smtp_tls_enforced == "enforced"
    not input.envelope_metadata_protection_enabled
    input.pii_bearing_email_flows_present == true
}

exposures contains _email_traffic_metadata_leakage_def if {
    count(email_traffic_metadata_leakage) > 0
}

_replay_attack_on_smtp_session_def := {
    "name": "Replay Attack On Smtp Session",
    "description": "SMTP sessions lacking replay protection mechanisms allow a network adversary who has captured a valid SMTP transaction to replay it against the receiving MTA, causing duplicate or malicious delivery of messages containing PII or credentials.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1672",
            "name": "Email Spoofing",
            "relevance": "Replaying captured SMTP sessions allows adversaries to resend legitimate email messages in a spoofed manner, impersonating the original sender."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.003",
            "name": "Mail Protocols",
            "relevance": "SMTP session replay attacks directly abuse the SMTP mail protocol by reusing captured protocol exchanges to inject unauthorized messages."
        }
    ],
    "attack_vector": "NETWORK"
}

replay_attack_on_smtp_session[_replay_attack_on_smtp_session_def] if {
    not input.smtp_tls_enforced
}

replay_attack_on_smtp_session[_replay_attack_on_smtp_session_def] if {
    input.smtp_tls_enforced == true
    input.smtp_session_reuse_window_seconds > 3600
}

replay_attack_on_smtp_session[_replay_attack_on_smtp_session_def] if {
    input.smtp_tls_enforced == true
    not input.dkim_signing_enabled
}

exposures contains _replay_attack_on_smtp_session_def if {
    count(replay_attack_on_smtp_session) > 0
}
