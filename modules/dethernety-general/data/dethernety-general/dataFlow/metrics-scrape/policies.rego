package _dt_built_in.exposures.metrics_scrape



_unauthenticated_metrics_endpoint_exposure_def := {
    "name": "Unauthenticated /metrics endpoint exposure",
    "description": "node_exporter and most exporters serve /metrics with no auth and no --web.config.file by default; an open, broadly-reachable endpoint lets anyone who can route to it pull internal counters, build/version info (go_info, *_build_info), process and environment detail, internal hostnames/IPs, and any accidentally-labelled secret. The flow's server side fails to authenticate the puller, so reconnaissance and info-leak follow.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {
                "justification": "An open, unauthenticated /metrics endpoint reachable over the network lets an actor enumerate the internal service (build/version, process detail, internal hostnames) \u2014 Network Service Discovery against the exposed exporter."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_metrics_endpoint_exposure[_unauthenticated_metrics_endpoint_exposure_def] if {
    not input.exporter_endpoint_authenticated
    not input.exporter_endpoint_network_restricted
}

exposures contains _unauthenticated_metrics_endpoint_exposure_def if {
    count(unauthenticated_metrics_endpoint_exposure) > 0
}

_sensitive_data_leaked_in_metric_labels_def := {
    "name": "Sensitive data leaked in metric labels",
    "description": "The Prometheus security model assumes /metrics readers are untrusted, yet label values often carry secrets, credentials, internal hostnames/IPs, or environment data. On any reachable endpoint this is a direct confidentiality breach of data in motion across the scrape flow, independent of whether the cardinality is bounded.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1592",
            "attributes": {
                "justification": "Sensitive label values (internal hostnames/IPs, build/version, environment data) exposed on a reachable /metrics endpoint provide adversary-usable host/environment information \u2014 Gather Victim Host Information."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

sensitive_data_leaked_in_metric_labels[_sensitive_data_leaked_in_metric_labels_def] if {
    not input.metric_labels_free_of_sensitive_data
}

sensitive_data_leaked_in_metric_labels[_sensitive_data_leaked_in_metric_labels_def] if {
    not input.sensitive_data_masking_enabled
}

exposures contains _sensitive_data_leaked_in_metric_labels_def if {
    count(sensitive_data_leaked_in_metric_labels) > 0
}

_cardinality_bomb_tsdb_resource_exhaustion_def := {
    "name": "Cardinality bomb / TSDB resource exhaustion",
    "description": "All six scrape guards (sample_limit, label_limit, label_name_length_limit, label_value_length_limit, target_limit, body_size_limit) default to 0/unset, so Prometheus trusts whatever volume an untrusted or compromised target returns. A malicious target ships millions of high-cardinality series or oversized labels/body, OOMing or exhausting the TSDB \u2014 a denial of service against the monitoring plane.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cardinality_bomb_tsdb_resource_exhaustion[_cardinality_bomb_tsdb_resource_exhaustion_def] if {
    not input.scrape_sample_and_label_limits_set
}

cardinality_bomb_tsdb_resource_exhaustion[_cardinality_bomb_tsdb_resource_exhaustion_def] if {
    not input.scrape_body_size_limit_set
}

exposures contains _cardinality_bomb_tsdb_resource_exhaustion_def if {
    count(cardinality_bomb_tsdb_resource_exhaustion) > 0
}

_ssrf_via_editable_scrape_config_service_discovery_def := {
    "name": "SSRF via editable scrape config / service discovery",
    "description": "Scrape targets are determined entirely by scrape_config + service discovery (http_sd/file_sd/Consul) + relabeling. Any party able to edit SD data or relabel rules can point Prometheus \u2014 or a proxying exporter like Blackbox/SNMP \u2014 at arbitrary internal URLs, reaching internal services and leaking client-side basic_auth secrets. The flow fails to constrain who authorizes its destinations.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

ssrf_via_editable_scrape_config_service_discovery[_ssrf_via_editable_scrape_config_service_discovery_def] if {
    not input.scrape_config_edit_restricted
}

ssrf_via_editable_scrape_config_service_discovery[_ssrf_via_editable_scrape_config_service_discovery_def] if {
    not input.service_discovery_source_trusted
}

ssrf_via_editable_scrape_config_service_discovery[_ssrf_via_editable_scrape_config_service_discovery_def] if {
    not input.proxying_exporter_target_allowlisted
}

exposures contains _ssrf_via_editable_scrape_config_service_discovery_def if {
    count(ssrf_via_editable_scrape_config_service_discovery) > 0
}

_metrics_not_network_restricted_to_the_monitoring_segment_def := {
    "name": "/metrics not network-restricted to the monitoring segment",
    "description": "The Prometheus security model explicitly warns that instrumented-binary /metrics endpoints must not be exposed to public networks. When the exporter binds 0.0.0.0 with no firewall/security-group/network-policy limiting ingress to the Prometheus server, the endpoint's primary mitigation (network restriction) is absent and the open-endpoint exposure becomes internet-reachable.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1592",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

metrics_not_network_restricted_to_the_monitoring_segment[_metrics_not_network_restricted_to_the_monitoring_segment_def] if {
    not input.exporter_endpoint_network_restricted
}

exposures contains _metrics_not_network_restricted_to_the_monitoring_segment_def if {
    count(metrics_not_network_restricted_to_the_monitoring_segment) > 0
}

_plaintext_scrape_transport_def := {
    "name": "Plaintext scrape transport",
    "description": "scrape_config.scheme defaults to http; scraping over plaintext exposes the (often sensitive-labelled) metrics and any basic_auth credential the scraper presents to the target on the wire. An adjacent or on-path attacker sniffs the flow. Mirrored on the server side by exporters served without tls_server_config.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

plaintext_scrape_transport[_plaintext_scrape_transport_def] if {
    not input.scrape_scheme_https
}

plaintext_scrape_transport[_plaintext_scrape_transport_def] if {
    not input.encryption_in_transit_enabled
}

plaintext_scrape_transport[_plaintext_scrape_transport_def] if {
    input.tls_min_version in ["SSLv3", "TLS1.0", "TLS1.1"]
}

exposures contains _plaintext_scrape_transport_def if {
    count(plaintext_scrape_transport) > 0
}

_unverified_target_tls_insecure_skip_verify_mitm_def := {
    "name": "Unverified target TLS (insecure_skip_verify / MITM)",
    "description": "scrape_config.tls_config.insecure_skip_verify: true disables target-certificate validation, letting a MITM impersonate the scrape target over a secure-looking HTTPS scrape \u2014 serving poisoned metrics or capturing presented credentials. The flow asserts an authenticated server endpoint but does not enforce it.",
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
        }
    ],
    "attack_vector": "NETWORK"
}

unverified_target_tls_insecure_skip_verify_mitm[_unverified_target_tls_insecure_skip_verify_mitm_def] if {
    not input.scrape_target_tls_certificate_verified
}

exposures contains _unverified_target_tls_insecure_skip_verify_mitm_def if {
    count(unverified_target_tls_insecure_skip_verify_mitm) > 0
}
