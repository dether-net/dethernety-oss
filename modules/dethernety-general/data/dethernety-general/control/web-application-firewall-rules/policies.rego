package _dt_built_in.countermeasures.web_application_firewall_rules



_managed_core_ruleset_deployed_and_current_def := {
    "name": "Managed core ruleset deployed and current",
    "description": "A maintained managed/core ruleset (OWASP CRS or vendor baseline such as AWSManagedRulesCommonRuleSet) is attached to the WAF policy and kept on a current/auto-updating version, so the OWASP Top 10 injection/XSS/RCE/LFI/RFI/SSRF classes and newly-disclosed exploit signatures are covered. Presence and currency of the baseline blunts exploitation of the public-facing application and reduces the rule-decoding-bypass window.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1050",
            "attributes": {
                "justification": "Exploit Protection \u2014 a maintained WAF core ruleset is an exploit-protection control against public-facing application abuse."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {
                "justification": "Network Intrusion Prevention \u2014 the managed core ruleset is the inline signature set the WAF uses to block exploit traffic."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "attributes": {
                "justification": "Inbound Traffic Filtering \u2014 the core ruleset filters malicious inbound HTTP at the perimeter."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "attributes": {
                "justification": "Network Traffic Filtering \u2014 the managed baseline filters network traffic against known exploit signatures."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A current OWASP-Top-10 core ruleset hardens the public-facing application against exploitation of injection/XSS/RCE/LFI/RFI/SSRF classes."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.003",
            "attributes": {
                "justification": "Body/exploit signatures in the maintained core ruleset blunt web-shell deployment via exploited input on the public-facing app."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

managed_core_ruleset_deployed_and_current[_managed_core_ruleset_deployed_and_current_def] if {
    input.managed_core_ruleset_deployed == true
    input.ruleset_covers_owasp_top10 == true
    input.crs_ruleset_updated == true
}

countermeasures contains _managed_core_ruleset_deployed_and_current_def if {
    count(managed_core_ruleset_deployed_and_current) > 0
}

_blocking_prevention_mode_at_a_tuned_anomaly_threshold_def := {
    "name": "Blocking prevention mode at a tuned anomaly threshold",
    "description": "The engine actively blocks matching traffic (SecRuleEngine On / policy mode Prevention, no managed group forced to Count) at a tuned anomaly-score threshold and deliberate paranoia level with false-positive management, rather than detection-only. Effective blocking enforcement is what actually stops injection/XSS/RCE reaching application logic instead of merely logging it.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1050",
            "attributes": {}
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "attributes": {}
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An actively-blocking WAF at a tuned anomaly threshold drops injection/XSS/RCE exploit traffic at the perimeter, hardening the public-facing application against exploitation before requests reach vulnerable application logic."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

blocking_prevention_mode_at_a_tuned_anomaly_threshold[_blocking_prevention_mode_at_a_tuned_anomaly_threshold_def] if {
    input.waf_engine_mode == "BLOCKING"
    input.waf_anomaly_threshold_effective == true
    input.false_positive_tuning_process == true
}

countermeasures contains _blocking_prevention_mode_at_a_tuned_anomaly_threshold_def if {
    count(blocking_prevention_mode_at_a_tuned_anomaly_threshold) > 0
}

_virtual_patching_custom_rules_maintained_def := {
    "name": "Virtual patching custom rules maintained",
    "description": "App-specific and emerging-CVE custom rules (virtual patching) sit alongside the managed baseline and are reviewed on a cadence, blocking exploit patterns the core ruleset does not cover until the application itself is patched. Presence of a maintained virtual-patch layer blunts targeted exploitation and zero-day windows for the protected app.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1050",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "attributes": {}
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Custom virtual-patching rules block exploit patterns targeting public-facing application vulnerabilities (including emerging CVEs) that the managed baseline does not yet cover, hardening the request-filtering surface against Exploit Public-Facing Application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.003",
            "attributes": {
                "justification": "App-specific custom rules detect and block web-shell upload/interaction patterns that bypass generic signatures, hardening the WAF against Server Software Component: Web Shell."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

virtual_patching_custom_rules_maintained[_virtual_patching_custom_rules_maintained_def] if {
    input.virtual_patching_custom_rules_maintained == true
    input.custom_rule_review_cadence_days <= 90
}

countermeasures contains _virtual_patching_custom_rules_maintained_def if {
    count(virtual_patching_custom_rules_maintained) > 0
}

_inbound_tls_termination_enables_payload_inspection_def := {
    "name": "Inbound TLS termination enables payload inspection",
    "description": "The WAF terminates/decrypts inbound HTTPS on a strong TLS baseline (min TLS 1.2 with 1.3 supported, AEAD/ECDHE ciphers) so request payloads are inspected in cleartext rather than passed through encrypted. Without decryption, attacks ride uninspected inside HTTPS; presence of inbound termination on a strong baseline is what makes every other rule effective.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {}
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "Terminating inbound HTTPS on a strong TLS baseline decrypts request payloads so the WAF can perform network traffic analysis (D3-NTA) on application-layer protocol traffic, exposing malicious use of standard web/application-layer protocols (T1071) that would otherwise be hidden inside the encrypted tunnel."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

inbound_tls_termination_enables_payload_inspection[_inbound_tls_termination_enables_payload_inspection_def] if {
    input.tls_inspection_enabled == true
    input.min_tls_version == "tls1_2_or_higher"
    input.cipher_suites_strong_only == "aead_with_forward_secrecy_only"
}

countermeasures contains _inbound_tls_termination_enables_payload_inspection_def if {
    count(inbound_tls_termination_enables_payload_inspection) > 0
}

_rate_limiting_and_anti_automation_enforced_def := {
    "name": "Rate limiting and anti-automation enforced",
    "description": "Rate-based rules and/or bot mitigation are attached with a Block/CAPTCHA action, throttling abusive request volume. Presence blunts application-layer DoS, credential stuffing, brute force, and scraping against login and search endpoints.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {
                "justification": "Network intrusion prevention: enforcing rate-based/bot rules at the WAF throttles and blocks abusive request volume inline."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1021",
            "attributes": {
                "justification": "Restrict web-based content: bot-mitigation challenges (CAPTCHA/JS) constrain automated abuse against web endpoints."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "attributes": {
                "justification": "Network Traffic Filtering: the WAF inline-filters and blocks/challenges abusive request flows."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {
                "justification": "Rate-based blocking throttles application-layer endpoint denial-of-service floods before they reach origin logic."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498",
            "attributes": {
                "justification": "Rate limiting and bot mitigation blunt network/application-layer DoS request volume at the edge."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {
                "justification": "Per-client rate caps and bot challenges throttle brute-force and credential-stuffing attempts against login endpoints."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

rate_limiting_and_anti_automation_enforced[_rate_limiting_and_anti_automation_enforced_def] if {
    input.request_rate_limiting_enabled == true
    input.rate_limit_action in ["block", "captcha", "challenge"]
}

rate_limiting_and_anti_automation_enforced[_rate_limiting_and_anti_automation_enforced_def] if {
    input.bot_mitigation_enabled == true
    input.rate_limit_action in ["block", "captcha", "challenge"]
}

countermeasures contains _rate_limiting_and_anti_automation_enforced_def if {
    count(rate_limiting_and_anti_automation_enforced) > 0
}

_body_inspection_and_protocol_validation_active_def := {
    "name": "Body inspection and protocol validation active",
    "description": "Request-body access is enabled with size/upload limits and content-type allow-lists, and HTTP protocol-enforcement rules (method allow-list, rejection of ambiguous Content-Length/Transfer-Encoding) are active. Presence blunts web-shell/oversized uploads and HTTP request smuggling (CWE-444) where front-end and origin disagree on request boundaries.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1050",
            "attributes": {
                "justification": "Exploit protection: body inspection with size/content-type limits and protocol enforcement screen exploit payloads at the perimeter."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {
                "justification": "Network intrusion prevention: inline WAF inspection of bodies and HTTP framing rejects malicious/ambiguous traffic before it reaches the origin."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ITF",
            "attributes": {
                "justification": "Inbound Traffic Filtering: rejecting non-conforming methods and ambiguous Content-Length/Transfer-Encoding framing filters inbound requests at the boundary."
            }
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Body inspection with size/content-type limits hardens the public-facing app against exploitation via oversized/web-shell uploads and malformed requests."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071",
            "attributes": {
                "justification": "Protocol-enforcement and smuggling-protection rules surface anomalous/ambiguous application-layer HTTP traffic for the engine to act on."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

body_inspection_and_protocol_validation_active[_body_inspection_and_protocol_validation_active_def] if {
    input.waf_request_body_inspection_enabled == true
    input.file_upload_limits_enforced == true
    input.http_protocol_validation_enabled == true
    input.request_smuggling_protection_enabled == true
}

countermeasures contains _body_inspection_and_protocol_validation_active_def if {
    count(body_inspection_and_protocol_validation_active) > 0
}

_waf_non_bypassable_with_direct_to_origin_blocked_def := {
    "name": "WAF non-bypassable with direct-to-origin blocked",
    "description": "The origin is reachable only through the WAF \u2014 authenticated origin pulls/mTLS, allow-listed WAF egress IPs, or a private origin (OAI/OAC) ensure the origin IP is not directly reachable from the internet. Presence prevents an attacker who discovers the origin IP from routing around every edge protection; a bypassable WAF protects nothing.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1031",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTF",
            "attributes": {}
        }
    ],
    "protects_against": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Forcing all origin traffic through the WAF (authenticated origin pulls/mTLS, WAF egress allow-list, or private OAI/OAC origin) hardens the public-facing application against exploitation by removing the direct-to-origin path an attacker would use to route around every edge protection."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

waf_non_bypassable_with_direct_to_origin_blocked[_waf_non_bypassable_with_direct_to_origin_blocked_def] if {
    input.direct_to_origin_blocked == true
    input.origin_access_restricted_to_waf == true
}

countermeasures contains _waf_non_bypassable_with_direct_to_origin_blocked_def if {
    count(waf_non_bypassable_with_direct_to_origin_blocked) > 0
}

_event_logging_to_siem_with_fail_closed_posture_def := {
    "name": "Event logging to SIEM with fail-closed posture",
    "description": "WAF block/allow events (matched rule, client IP, URI, action) are shipped to a central SIEM with adequate retention (>=90 days), and the fail posture is a deliberate, documented decision (high-risk apps fail-closed when the WAF is unavailable rather than silently passing uninspected traffic). Presence makes attacks detectable and investigable and prevents a WAF outage from silently exposing the origin.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "attributes": {
                "justification": "Auditing of WAF events shipped to a central SIEM is the ATT&CK Audit mitigation \u2014 it makes perimeter attacks detectable and investigable."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {
                "justification": "Shipping WAF block/allow events (matched rule, client IP, URI, action) to a SIEM is Network Traffic Analysis over the inspected HTTP edge."
            }
        }
    ],
    "detects": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Centralized SIEM ingestion of WAF events with >=90d retention detects exploitation of the public-facing application; the fail-closed posture prevents a WAF outage from silently exposing the origin to such exploitation."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

event_logging_to_siem_with_fail_closed_posture[_event_logging_to_siem_with_fail_closed_posture_def] if {
    input.waf_audit_logging_enabled == true
    input.centralized_log_aggregation == true
    input.log_retention_days >= 90
    input.waf_fails_closed_on_error == true
}

countermeasures contains _event_logging_to_siem_with_fail_closed_posture_def if {
    count(event_logging_to_siem_with_fail_closed_posture) > 0
}
