package _dt_built_in.countermeasures.dns_security_extensions_dnssec

_response_integrity_validation_def := {
    "name": "Response Integrity Validation",
    "description": "Provides cryptographic proof that DNS response data has not been modified between the authoritative server and the resolver, delivering byte-level integrity assurance for every signed record.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CA",
            "name": "Certificate Analysis",
            "relevance": "Certificate analysis directly validates the integrity of responses by examining cryptographic certificates used in securing communications."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection ensures encrypted response integrity by validating the authenticity and content of encrypted communications."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1045",
            "name": "Code Signing",
            "relevance": "Code signing enforces integrity validation by ensuring responses and data are cryptographically signed and unaltered."
        }
    ]
}

response_integrity_validation[_response_integrity_validation_def] if {
    input.dnssec_validation_enabled == true
    input.trust_anchor_configured == true
    input.dnssec_validation_mode == "enforce"
}

countermeasures contains _response_integrity_validation_def if {
    count(response_integrity_validation) > 0
}

_origin_authenticity_verification_def := {
    "name": "Origin Authenticity Verification",
    "description": "Delivers verified proof of DNS record origin through digital signatures tied to zone-specific keys, ensuring responses genuinely come from the authoritative zone owner rather than an impersonator.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CA",
            "name": "Certificate Analysis",
            "relevance": "Certificate analysis verifies the authenticity of the origin by examining the cryptographic certificates presented by communicating parties."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection validates origin authenticity by inspecting certificates and encryption parameters during communication establishment."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1045",
            "name": "Code Signing",
            "relevance": "Code signing ensures origin authenticity by cryptographically binding software or data to a verified identity."
        }
    ]
}

origin_authenticity_verification[_origin_authenticity_verification_def] if {
    input.dnssec_enabled == true
    input.ds_record_published == true
    input.dnssec_validation_mode == "enforced"
}

countermeasures contains _origin_authenticity_verification_def if {
    count(origin_authenticity_verification) > 0
}

_chain_of_trust_coverage_def := {
    "name": "Chain Of Trust Coverage",
    "description": "Establishes a hierarchical validation path from root zone through TLD to authoritative zone, providing end-to-end trust continuity measurable by delegation signer record presence at each level.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CA",
            "name": "Certificate Analysis",
            "relevance": "Certificate analysis validates the full chain of trust by examining certificate hierarchies and their cryptographic relationships."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1045",
            "name": "Code Signing",
            "relevance": "Code signing enforces chain of trust by requiring all software components to be signed by trusted authorities throughout the trust hierarchy."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DTP",
            "name": "Domain Trust Policy",
            "relevance": "Domain trust policy directly governs the chain of trust coverage by defining and enforcing trust relationships between domains."
        }
    ]
}

chain_of_trust_coverage[_chain_of_trust_coverage_def] if {
    input.dnssec_enabled_at_zone == true
    input.ds_record_published_at_parent == true
    input.root_to_tld_trust_anchor_validated == true
}

chain_of_trust_coverage[_chain_of_trust_coverage_def] if {
    input.dnssec_validation_chain_status == "secure"
    input.dnssec_enabled_at_zone == true
    input.ds_record_published_at_parent == true
}

countermeasures contains _chain_of_trust_coverage_def if {
    count(chain_of_trust_coverage) > 0
}

_negative_response_authentication_def := {
    "name": "Negative Response Authentication",
    "description": "Authenticates NXDOMAIN and NODATA responses using NSEC or NSEC3 records, preventing false denial-of-existence assertions and ensuring legitimate negative answers are cryptographically verifiable.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CA",
            "name": "Certificate Analysis",
            "relevance": "Certificate analysis can authenticate negative responses by verifying the cryptographic signatures on denial-of-existence records such as NSEC/NSEC3 in DNSSEC."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection helps authenticate negative responses by ensuring encrypted denial responses come from legitimate sources."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DNSAL",
            "name": "DNS Allowlisting",
            "relevance": "DNS allowlisting supports negative response authentication by ensuring only authorized resolvers can provide negative DNS answers."
        }
    ]
}

negative_response_authentication[_negative_response_authentication_def] if {
    input.dnssec_enabled == true
    input.negative_response_proof_type in ["nsec", "nsec3"]
    input.ds_record_published == true
}

countermeasures contains _negative_response_authentication_def if {
    count(negative_response_authentication) > 0
}

_validation_failure_detection_def := {
    "name": "Validation Failure Detection",
    "description": "Provides deterministic detection of signature mismatches or missing signatures at the resolver level, enabling automated identification of tampered or forged DNS responses before they are acted upon.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1040",
            "name": "Behavior Prevention on Endpoint",
            "relevance": "Behavior prevention on endpoint can detect and block actions resulting from validation failures by identifying anomalous behavior patterns."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CA",
            "name": "Certificate Analysis",
            "relevance": "Certificate analysis detects validation failures by identifying invalid, expired, or untrusted certificates in communications."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection enables detection of validation failures by monitoring for certificate errors and handshake anomalies."
        }
    ]
}

validation_failure_detection[_validation_failure_detection_def] if {
    input.dnssec_validation_enabled == true
    input.validation_failure_action == "block"
    input.trust_anchor_configured == true
}

countermeasures contains _validation_failure_detection_def if {
    count(validation_failure_detection) > 0
}

_key_rollover_operational_continuity_def := {
    "name": "Key Rollover Operational Continuity",
    "description": "Supports scheduled key signing key and zone signing key rotation procedures, maintaining continuous validation coverage during cryptographic key lifecycle transitions without service disruption.",
    "type": "misconfiguration",
    "category": "supply_chain",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CERO",
            "name": "Certificate Rotation",
            "relevance": "Certificate rotation directly addresses key rollover operational continuity by managing the lifecycle and replacement of cryptographic certificates."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-CRO",
            "name": "Credential Rotation",
            "relevance": "Credential rotation ensures operational continuity during key rollovers by systematically replacing cryptographic credentials without service disruption."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-ACA",
            "name": "Active Certificate Analysis",
            "relevance": "Active certificate analysis monitors certificate validity and expiration to ensure continuity during key rollover operations."
        }
    ]
}

key_rollover_operational_continuity[_key_rollover_operational_continuity_def] if {
    input.key_rollover_procedure_configured == true
    input.pre_publish_overlap_enabled == true
    input.rollover_automation_status == "automated"
}

key_rollover_operational_continuity[_key_rollover_operational_continuity_def] if {
    input.key_rollover_procedure_configured == true
    input.pre_publish_overlap_enabled == true
    input.rollover_automation_status == "manual_scheduled"
}

countermeasures contains _key_rollover_operational_continuity_def if {
    count(key_rollover_operational_continuity) > 0
}

_resolver_validation_enforcement_def := {
    "name": "Resolver Validation Enforcement",
    "description": "Enables validating resolvers to enforce DNSSEC checking disabled flag behavior, providing configurable hard-fail or permissive validation modes that control whether unsigned zones are accepted.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection enforces resolver validation by inspecting and validating encrypted DNS-over-HTTPS or DNS-over-TLS resolver communications."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-DNSAL",
            "name": "DNS Allowlisting",
            "relevance": "DNS allowlisting directly enforces resolver validation by restricting DNS queries to approved, validated resolvers only."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1035",
            "name": "Limit Access to Resource Over Network",
            "relevance": "Limiting network access to resources enforces resolver validation by restricting which resolvers can query DNS infrastructure."
        }
    ]
}

resolver_validation_enforcement[_resolver_validation_enforcement_def] if {
    input.dnssec_validation_enabled == true
    input.cd_flag_enforcement_mode == "hard_fail"
    input.trust_anchor_configured == true
}

resolver_validation_enforcement[_resolver_validation_enforcement_def] if {
    input.dnssec_validation_enabled == true
    input.cd_flag_enforcement_mode == "permissive"
    input.unsigned_zone_acceptance == "reject_bogus_only"
    input.trust_anchor_configured == true
}

countermeasures contains _resolver_validation_enforcement_def if {
    count(resolver_validation_enforcement) > 0
}

_zone_signing_completeness_def := {
    "name": "Zone Signing Completeness",
    "description": "Measures the proportion of DNS records within a zone that carry valid RRSIG signatures, providing an auditable coverage metric for assessing how completely a zone is protected.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing ensures zone signing completeness by systematically reviewing DNS zones to confirm all records are properly signed."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1015",
            "name": "Active Directory Configuration",
            "relevance": "Active Directory configuration supports zone signing completeness by enforcing proper DNSSEC configuration across DNS zones."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1020",
            "name": "SSL/TLS Inspection",
            "relevance": "SSL/TLS inspection complements zone signing completeness by validating that signed zone data is transmitted securely and intact."
        }
    ]
}

zone_signing_completeness[_zone_signing_completeness_def] if {
    input.dnssec_enabled == true
    input.rrsig_coverage_percentage >= 100
    input.ds_record_published == true
}

countermeasures contains _zone_signing_completeness_def if {
    count(zone_signing_completeness) > 0
}

_signature_expiry_monitoring_def := {
    "name": "Signature Expiry Monitoring",
    "description": "Delivers time-bounded validity windows through RRSIG inception and expiration timestamps, enabling operational monitoring of signature freshness and automated alerting before signatures lapse.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": [
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1047",
            "name": "Audit",
            "relevance": "Auditing enables signature expiry monitoring by regularly reviewing cryptographic signature validity periods and flagging upcoming expirations."
        },
        {
            "label": "MitreDefendTechnique",
            "property": "d3fendId",
            "value": "D3-PMAD",
            "name": "Protocol Metadata Anomaly Detection",
            "relevance": "Protocol metadata anomaly detection can identify expired or soon-to-expire signatures by analyzing anomalous metadata patterns in DNS responses."
        },
        {
            "label": "MitreAttackMitigation",
            "property": "attack_id",
            "value": "M1045",
            "name": "Code Signing",
            "relevance": "Code signing management includes monitoring signature expiry to ensure continuous validity of cryptographic signatures on data and software."
        }
    ]
}

signature_expiry_monitoring[_signature_expiry_monitoring_def] if {
    input.dnssec_enabled == true
    input.signature_expiry_monitoring_enabled == true
    input.alert_threshold_days_before_expiry >= 1
}

countermeasures contains _signature_expiry_monitoring_def if {
    count(signature_expiry_monitoring) > 0
}
