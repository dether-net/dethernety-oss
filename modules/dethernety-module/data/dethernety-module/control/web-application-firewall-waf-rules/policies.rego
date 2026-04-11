package _dt_built_in.countermeasures.web_application_firewall_waf_rules

_rule_set_coverage_depth_def := {
    "name": "Rule Set Coverage Depth",
    "description": "Provides breadth and precision of detection across application-layer attack categories through managed or custom rule sets, determining how completely the WAF identifies malicious request patterns.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-APCA",
            "name": "Application Protocol Command Analysis",
            "relevance": "Directly assesses the depth of protocol-level inspection coverage within rule sets."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FAPA",
            "name": "File Access Pattern Analysis",
            "relevance": "Evaluates breadth of rule coverage by analyzing patterns across file access behaviors."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ANAA",
            "name": "Administrative Network Activity Analysis",
            "relevance": "Measures coverage depth by monitoring administrative network activities that rule sets must address."
        }
    ]
}

rule_set_coverage_depth[_rule_set_coverage_depth_def] if {
    input.managed_rule_groups_enabled == true
    input.owasp_top10_categories_covered >= 7
    input.rule_action_mode == "enforcement"
}

rule_set_coverage_depth[_rule_set_coverage_depth_def] if {
    input.managed_rule_groups_enabled == true
    input.owasp_top10_categories_covered >= 8
    input.rule_action_mode == "mixed"
}

countermeasures contains _rule_set_coverage_depth_def if {
    count(rule_set_coverage_depth) > 0
}

_false_positive_minimization_def := {
    "name": "False Positive Minimization",
    "description": "Delivers accurate traffic classification that distinguishes legitimate from malicious requests, ensuring production traffic is not incorrectly blocked and reducing operational disruption.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-DNSTA",
            "name": "DNS Traffic Analysis",
            "relevance": "Granular DNS traffic analysis helps distinguish legitimate from malicious activity, reducing false positives."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Precise filtering rules reduce erroneous alerts by accurately classifying benign network traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Restricting network resource access scopes detection to relevant traffic, minimizing false positive noise."
        }
    ]
}

false_positive_minimization[_false_positive_minimization_def] if {
    input.waf_operation_mode == "blocking"
    input.false_positive_tuning_enabled == true
    input.anomaly_score_threshold >= 5
}

false_positive_minimization[_false_positive_minimization_def] if {
    input.waf_operation_mode == "detection"
    input.false_positive_tuning_enabled == true
    input.anomaly_score_threshold >= 5
}

countermeasures contains _false_positive_minimization_def if {
    count(false_positive_minimization) > 0
}

_inline_blocking_enforcement_def := {
    "name": "Inline Blocking Enforcement",
    "description": "Provides real-time prevention capability by operating in blocking mode, automatically dropping or rejecting requests that match malicious rule conditions before they reach the web server.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Inline inbound traffic filtering directly enforces blocking of malicious requests in real time."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FRIDL",
            "name": "Forward Resolution IP Denylisting",
            "relevance": "IP-based denylisting enforces inline blocking by preventing connections to known malicious destinations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-FRDDL",
            "name": "Forward Resolution Domain Denylisting",
            "relevance": "Domain denylisting enforces inline blocking at the DNS resolution layer before connections are established."
        }
    ]
}

inline_blocking_enforcement[_inline_blocking_enforcement_def] if {
    input.waf_operation_mode == "blocking"
    input.waf_inline_deployment == true
    input.active_blocking_rule_count > 0
}

countermeasures contains _inline_blocking_enforcement_def if {
    count(inline_blocking_enforcement) > 0
}

_request_inspection_completeness_def := {
    "name": "Request Inspection Completeness",
    "description": "Provides thorough analysis coverage across all HTTP components including headers, URI, query strings, POST body, and cookies, ensuring no request element escapes rule evaluation.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SEA",
            "name": "Script Execution Analysis",
            "relevance": "Inspects script content within requests to ensure completeness of threat detection coverage."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-DQSA",
            "name": "Database Query String Analysis",
            "relevance": "Analyzes query strings in requests to detect injection attacks, ensuring thorough request inspection."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "Decrypting SSL/TLS traffic is essential for complete inspection of encrypted request payloads."
        }
    ]
}

request_inspection_completeness[_request_inspection_completeness_def] if {
    "HEADERS" in input.inspected_request_components
    "URI" in input.inspected_request_components
    "QUERY_STRING" in input.inspected_request_components
    "COOKIES" in input.inspected_request_components
    input.post_body_inspection_enabled == true
    input.inspection_rule_coverage_mode == "full"
}

countermeasures contains _request_inspection_completeness_def if {
    count(request_inspection_completeness) > 0
}

_custom_rule_configurability_def := {
    "name": "Custom Rule Configurability",
    "description": "Enables organization-specific protection outcomes by allowing administrators to define, tune, and deploy custom rules tailored to the application's unique traffic patterns and risk profile.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ACH",
            "name": "Application Configuration Hardening",
            "relevance": "Custom rule configurability directly relates to hardening application security configurations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTPM",
            "name": "Network Traffic Policy Mapping",
            "relevance": "Policy mapping supports the creation and management of custom traffic inspection rules."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Custom filter rules are the primary mechanism through which network traffic filtering is configured."
        }
    ]
}

custom_rule_configurability[_custom_rule_configurability_def] if {
    input.custom_rules_enabled == true
    input.active_custom_rule_count > 0
    input.custom_rule_enforcement_mode == "block"
}

countermeasures contains _custom_rule_configurability_def if {
    count(custom_rule_configurability) > 0
}

_logging_and_audit_completeness_def := {
    "name": "Logging And Audit Completeness",
    "description": "Produces comprehensive, structured logs of all inspected requests, rule matches, and enforcement actions, supporting forensic investigation, compliance reporting, and threat intelligence enrichment.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-WSAA",
            "name": "Web Session Activity Analysis",
            "relevance": "Web session logging provides critical audit data for completeness of security event records."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-PA",
            "name": "Process Analysis",
            "relevance": "Process-level logging ensures audit completeness by capturing endpoint execution events."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Directly addresses the need for comprehensive logging and audit trail completeness."
        }
    ]
}

logging_and_audit_completeness[_logging_and_audit_completeness_def] if {
    input.logging_enabled == true
    input.log_detail_level in ["full", "standard"]
    input.log_destination_configured == true
    "blocked_requests" in input.logged_event_types
    "rule_matches" in input.logged_event_types
}

countermeasures contains _logging_and_audit_completeness_def if {
    count(logging_and_audit_completeness) > 0
}

_rate_limiting_and_throttling_enforcement_def := {
    "name": "Rate Limiting And Throttling Enforcement",
    "description": "Delivers automated response to high-volume or anomalous request rates by throttling or blocking sources that exceed defined thresholds, reducing impact from volumetric application-layer abuse.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ISVA",
            "name": "Inbound Session Volume Analysis",
            "relevance": "Session volume analysis directly supports rate limiting by detecting abnormal request rates."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Inbound traffic filtering enforces throttling policies by controlling the flow of incoming requests."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTF",
            "name": "Network Traffic Filtering",
            "relevance": "Network-level filtering enforces rate limiting rules across all traffic entering the environment."
        }
    ]
}

rate_limiting_and_throttling_enforcement[_rate_limiting_and_throttling_enforcement_def] if {
    input.rate_limiting_enabled == true
    input.rate_limit_threshold > 0
    input.rate_limit_action in ["block", "throttle", "challenge"]
}

countermeasures contains _rate_limiting_and_throttling_enforcement_def if {
    count(rate_limiting_and_throttling_enforcement) > 0
}

_ssl_tls_traffic_inspection_def := {
    "name": "Ssl Tls Traffic Inspection",
    "description": "Provides protection coverage over encrypted traffic by performing TLS termination and decryption prior to rule evaluation, ensuring HTTPS requests are not exempt from inspection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Outbound traffic filtering requires SSL/TLS inspection to analyze encrypted egress communications."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Network traffic analysis depends on SSL/TLS inspection to examine encrypted traffic content."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "Directly defines the capability of intercepting and inspecting encrypted SSL/TLS traffic."
        }
    ]
}

ssl_tls_traffic_inspection[_ssl_tls_traffic_inspection_def] if {
    input.tls_inspection_enabled == true
    input.https_traffic_inspection_scope == "all"
    input.tls_certificate_validation_enabled == true
}

ssl_tls_traffic_inspection[_ssl_tls_traffic_inspection_def] if {
    input.tls_inspection_enabled == true
    input.https_traffic_inspection_scope == "all"
}

countermeasures contains _ssl_tls_traffic_inspection_def if {
    count(ssl_tls_traffic_inspection) > 0
}

_siem_and_alerting_integration_def := {
    "name": "Siem And Alerting Integration",
    "description": "Enables operational maintainability and response automation by forwarding WAF events to SIEM platforms and triggering alerts, supporting centralized security monitoring and incident workflows.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-AEM",
            "name": "Application Exception Monitoring",
            "relevance": "Application exception monitoring feeds critical security events into SIEM alerting pipelines."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-WSAA",
            "name": "Web Session Activity Analysis",
            "relevance": "Web session activity data is a primary source for SIEM correlation rules and alerting."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Audit logging is the foundational data source required for effective SIEM integration and alerting."
        }
    ]
}

siem_and_alerting_integration[_siem_and_alerting_integration_def] if {
    input.siem_forwarding_enabled == true
    input.alerting_configured == true
}

countermeasures contains _siem_and_alerting_integration_def if {
    count(siem_and_alerting_integration) > 0
}

_rule_update_and_patch_currency_def := {
    "name": "Rule Update And Patch Currency",
    "description": "Maintains detection effectiveness over time through timely updates to managed rule sets, ensuring newly discovered attack patterns are incorporated without requiring manual analyst intervention.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-SFA",
            "name": "System File Analysis",
            "relevance": "System file analysis detects outdated or tampered rule files requiring updates or patches."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1051",
            "name": "Update Software",
            "relevance": "Keeping rule sets and WAF software updated is directly addressed by this patching mitigation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "M1019",
            "name": "Threat Intelligence Program",
            "relevance": "Threat intelligence drives timely rule updates by providing current adversary TTPs and indicators."
        }
    ]
}

rule_update_and_patch_currency[_rule_update_and_patch_currency_def] if {
    input.auto_update_enabled == true
    input.rule_set_version_age_days <= 30
}

rule_update_and_patch_currency[_rule_update_and_patch_currency_def] if {
    input.auto_update_enabled == true
    input.update_notification_configured == true
    input.rule_set_version_age_days <= 30
}

countermeasures contains _rule_update_and_patch_currency_def if {
    count(rule_update_and_patch_currency) > 0
}

_geo_ip_and_reputation_based_filtering_def := {
    "name": "Geo Ip And Reputation Based Filtering",
    "description": "Provides preemptive prevention coverage by blocking or flagging traffic from known malicious IP ranges, Tor exit nodes, or high-risk geographies based on continuously updated threat intelligence feeds.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-NTA",
            "name": "Network Traffic Analysis",
            "relevance": "Network traffic analysis provides the visibility needed to apply geo-IP and reputation-based filtering decisions."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-ITF",
            "name": "Inbound Traffic Filtering",
            "relevance": "Inbound traffic filtering is the enforcement mechanism for geo-IP and reputation-based block rules."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "defense_id",
            "value": "D3-OTF",
            "name": "Outbound Traffic Filtering",
            "relevance": "Outbound filtering applies reputation-based controls to prevent connections to known malicious destinations."
        }
    ]
}

geo_ip_and_reputation_based_filtering[_geo_ip_and_reputation_based_filtering_def] if {
    input.geo_ip_filtering_enabled == true
    input.ip_reputation_filtering_enabled == true
    input.filtering_action_mode in ["block", "challenge"]
    input.threat_feed_update_frequency_days <= 7
}

countermeasures contains _geo_ip_and_reputation_based_filtering_def if {
    count(geo_ip_and_reputation_based_filtering) > 0
}
