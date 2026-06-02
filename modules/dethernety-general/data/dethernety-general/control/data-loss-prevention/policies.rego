package _dt_built_in.countermeasures.data_loss_prevention



_sensitive_data_classified_and_discovered_def := {
    "name": "Sensitive data classified and discovered",
    "description": "A documented data-classification scheme is maintained and a sensitive-data inventory with data-at-rest discovery scanning feeds the DLP engine, so 'sensitive content' is defined and shadow repositories are visible to enforcement. Without this floor the tool has nothing to recognize or protect.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 6.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {
                "justification": "Data Loss Prevention \u2014 the catalog identity of this control; classifying and discovering sensitive data is the prerequisite that lets DLP identify and categorize the content it must monitor and control."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
            "attributes": {
                "justification": "Maintaining a sensitive-data inventory with data-at-rest discovery scanning surfaces where sensitive content lives on local systems so DLP enforcement can detect and block collection of data from the local system (T1005)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1025",
            "attributes": {
                "justification": "A classified, discovered sensitive-data inventory lets DLP recognize and control sensitive content moving to/from removable media, countering collection of data from removable media (T1025)."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

sensitive_data_classified_and_discovered[_sensitive_data_classified_and_discovered_def] if {
    input.data_classification_scheme_established == true
    input.sensitive_data_inventory_and_discovery == "maintained_with_discovery_scans"
}

countermeasures contains _sensitive_data_classified_and_discovered_def if {
    count(sensitive_data_classified_and_discovered) > 0
}

_egress_network_dlp_enforced_in_blocking_mode_def := {
    "name": "Egress network DLP enforced in blocking mode",
    "description": "A DLP solution inspects outbound traffic at managed interfaces/perimeter and high-severity sensitive-data policies are set to Block/Prevent (not monitor-only), so detected exfiltration is actually stopped rather than merely logged. Verified by a controlled egress test with synthetic sensitive content.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 8.6,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {
                "justification": "The control IS an ATT&CK Data Loss Prevention mitigation \u2014 egress inspection that identifies, categorizes, and blocks movement of sensitive data."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1037",
            "attributes": {
                "justification": "Egress network DLP in blocking mode also filters network traffic (protocol/application-layer egress filtering) to prevent unauthorized outbound transfer of sensitive data."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-OTF",
            "attributes": {
                "justification": "Outbound Traffic Filtering \u2014 D3FEND identity of an enforcing egress DLP/filter that inspects and blocks sensitive content leaving managed interfaces."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "attributes": {
                "justification": "Blocking-mode egress DLP inspects and stops sensitive payloads moving out over alternative protocols/ports at the perimeter (M1057/M1037 \u2192 T1048)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "Deep-packet content inspection at the egress point detects and blocks sensitive data exfiltrated over unencrypted non-C2 protocols before it leaves the boundary."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Egress DLP enforcement blocks uploads of sensitive content to external web services at the managed interface (M1057 \u2192 T1567)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

egress_network_dlp_enforced_in_blocking_mode[_egress_network_dlp_enforced_in_blocking_mode_def] if {
    input.network_egress_dlp_enabled == true
    input.dlp_enforcement_mode == "block"
}

countermeasures contains _egress_network_dlp_enforced_in_blocking_mode_def if {
    count(egress_network_dlp_enforced_in_blocking_mode) > 0
}

_tls_ssl_inspection_on_the_dlp_egress_path_def := {
    "name": "TLS/SSL inspection on the DLP egress path",
    "description": "TLS/SSL inspection (decrypt-inspect-re-encrypt) with appropriate exclusions and protocol-format adherence / deep packet inspection is enabled so encrypted outbound channels are not a blind spot. Without it, sensitive data tunnels past network DLP inside TLS.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1041",
            "attributes": {
                "justification": "TLS/SSL inspection plus deep packet inspection decrypts and content-inspects encrypted outbound traffic, so sensitive payloads tunneled over an existing encrypted C2 channel are detectable and blockable rather than passing the DLP egress point uninspected."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Inspecting decrypted TLS egress lets the DLP engine see sensitive content uploaded to external web services (paste sites, file-sharing, webhooks) over HTTPS that would otherwise blend in as opaque encrypted traffic."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tls_ssl_inspection_on_the_dlp_egress_path[_tls_ssl_inspection_on_the_dlp_egress_path_def] if {
    input.tls_inspection_enabled == true
    input.deep_packet_inspection_enabled == true
}

countermeasures contains _tls_ssl_inspection_on_the_dlp_egress_path_def if {
    count(tls_ssl_inspection_on_the_dlp_egress_path) > 0
}

_endpoint_and_removable_media_dlp_coverage_def := {
    "name": "Endpoint and removable-media DLP coverage",
    "description": "Endpoint DLP agents on all managed endpoints (reconciled to the asset inventory) detect/block local exfiltration network DLP cannot see, and device-control policy blocks or encrypts sensitive writes to USB/removable media \u2014 closing off-network and physical-medium exfiltration.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 6.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {
                "justification": "Endpoint + removable-media DLP is the catalog identity of ATT&CK Mitigation M1057 Data Loss Prevention \u2014 deploy DLP on endpoints to identify, monitor, and control sensitive-data movement including local and physical-medium channels."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052",
            "attributes": {
                "justification": "Removable-media control blocks/encrypts sensitive writes to physical media, preventing Exfiltration Over Physical Medium that bypasses the network entirely."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1052.001",
            "attributes": {
                "justification": "Device-control policy on USB ports specifically blocks or encrypts sensitive copies to USB devices, countering Exfiltration over USB."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1025",
            "attributes": {
                "justification": "Endpoint DLP + removable-media control restricts reading/copying sensitive content from removable media, mitigating Data from Removable Media collection that precedes physical exfiltration."
            }
        }
    ],
    "attack_vector": "PHYSICAL"
}

endpoint_and_removable_media_dlp_coverage[_endpoint_and_removable_media_dlp_coverage_def] if {
    input.endpoint_dlp_agent_coverage == true
    input.removable_media_control_enabled == true
}

countermeasures contains _endpoint_and_removable_media_dlp_coverage_def if {
    count(endpoint_and_removable_media_dlp_coverage) > 0
}

_email_web_and_cloud_casb_channel_coverage_def := {
    "name": "Email, web, and cloud (CASB) channel coverage",
    "description": "Outbound email routes through a DLP-inspecting mail gateway and web uploads / sanctioned-and-unsanctioned cloud apps are inspected via secure web gateway / CASB with enforce-mode policies, so the primary modern exfiltration channels (email, paste/file-share sites, attacker cloud accounts) are covered.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {
                "justification": "Data Loss Prevention \u2014 the catalog mitigation this control embodies; DLP identifies, categorizes, monitors, and controls movement of sensitive data across email, web, and cloud channels."
            }
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1021",
            "attributes": {
                "justification": "Restrict Web-Based Content \u2014 secure web gateway / CASB enforce-mode policies restrict sensitive uploads to web services and unsanctioned cloud apps, the web/cloud-channel coverage of this control."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-EF",
            "attributes": {
                "justification": "Email Filtering \u2014 the D3FEND defensive technique matching the DLP-inspecting mail gateway facet that inspects and blocks sensitive content leaving over outbound email."
            }
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Exfiltration Over Web Service \u2014 web/CASB DLP inspects outbound web traffic and blocks sensitive-content uploads to legitimate external web services (paste sites, file-sharing, webhooks)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "attributes": {
                "justification": "Transfer Data to Cloud Account \u2014 CASB/cloud DLP and egress inspection block sensitive content being copied to attacker-controlled or unsanctioned cloud accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "attributes": {
                "justification": "Exfiltration Over Alternative Protocol \u2014 DLP inspection across the email and web/cloud egress channels detects and blocks sensitive payloads moving over alternate outbound protocols and services."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

email_web_and_cloud_casb_channel_coverage[_email_web_and_cloud_casb_channel_coverage_def] if {
    input.email_dlp_gateway_enabled == true
    input.web_cloud_casb_dlp_enabled == true
}

countermeasures contains _email_web_and_cloud_casb_channel_coverage_def if {
    count(email_web_and_cloud_casb_channel_coverage) > 0
}

_information_flow_rules_bound_to_classification_with_governed_exceptions_def := {
    "name": "Information-flow rules bound to classification with governed exceptions",
    "description": "DLP operationalizes information-flow enforcement (AC-4): rules regulate where classified/export-controlled data may travel, and any policy exceptions/allow-lists are documented, approved, time-bound, and periodically recertified so exceptions don't become permanent exfiltration holes.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {}
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTPM",
            "attributes": {}
        }
    ],
    "mitigates": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "attributes": {
                "justification": "Information-flow rules bound to classification and governed exceptions enforce where classified/export-controlled data may travel, blocking exfiltration over alternative protocols/channels to unauthorized destinations (NIST AC-4 information-flow enforcement operationalized by DLP M1057)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

information_flow_rules_bound_to_classification_with_governed_exceptions[_information_flow_rules_bound_to_classification_with_governed_exceptions_def] if {
    input.information_flow_rules_bound_to_classification == true
    input.dlp_exceptions_governed_and_recertified == true
}

countermeasures contains _information_flow_rules_bound_to_classification_with_governed_exceptions_def if {
    count(information_flow_rules_bound_to_classification_with_governed_exceptions) > 0
}

_policy_hit_alerting_tuning_and_exfiltration_testing_def := {
    "name": "Policy-hit alerting, tuning, and exfiltration testing",
    "description": "DLP policy hits raise alerts into a monitored SOC/incident workflow (SI-4), rules are tuned on a review cadence to keep detection trusted, and exfiltration-capability tests run on a defined frequency (synthetic sensitive data per covered channel) to prove enforcement actually holds \u2014 a control unverified is a control assumed.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1057",
            "attributes": {
                "justification": "Data Loss Prevention \u2014 the ATT&CK mitigation identity of this control; policy-hit alerting and periodic exfiltration testing operationalize DLP so its enforcement is monitored and verified."
            }
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-NTA",
            "attributes": {
                "justification": "Network Traffic Analysis \u2014 DLP egress alerting feeds analysis of outbound traffic for sensitive-content detections, the D3FEND detect-facet identity backing this monitoring/testing control."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

policy_hit_alerting_tuning_and_exfiltration_testing[_policy_hit_alerting_tuning_and_exfiltration_testing_def] if {
    input.dlp_policy_hit_alerting_enabled == true
    input.exfiltration_testing_performed == true
}

countermeasures contains _policy_hit_alerting_tuning_and_exfiltration_testing_def if {
    count(policy_hit_alerting_tuning_and_exfiltration_testing) > 0
}
