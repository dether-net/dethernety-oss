package _dt_built_in.countermeasures.encryption_in_transit

_encryption_strength_coverage_def := {
    "name": "Encryption Strength Coverage",
    "description": "Provides strong cipher suite enforcement ensuring transmitted data is rendered unreadable without the correct decryption key. Measured by key length, algorithm selection, and absence of weak ciphers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

encryption_strength_coverage[_encryption_strength_coverage_def] if {
    input.minimum_tls_version in ["SSLv2", "SSLv3", "TLS1.0", "TLS1.1"]
}

encryption_strength_coverage[_encryption_strength_coverage_def] if {
    input.weak_ciphers_enabled == true
}

encryption_strength_coverage[_encryption_strength_coverage_def] if {
    input.minimum_key_length_bits < 128
}

encryption_strength_coverage[_encryption_strength_coverage_def] if {
    input.minimum_tls_version in ["TLS1.2", "TLS1.3"]
    input.ephemeral_key_exchange_enabled == false
}

countermeasures contains _encryption_strength_coverage_def if {
    count(encryption_strength_coverage) > 0
}

_data_integrity_assurance_def := {
    "name": "Data Integrity Assurance",
    "description": "Provides cryptographic message authentication codes (MACs) or AEAD schemes that detect any in-transit modification of data, ensuring receivers can verify payload has not been altered.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

data_integrity_assurance[_data_integrity_assurance_def] if {
    input.cipher_suite_mac_type in ["aead"]
    input.null_cipher_or_mac_permitted == false
    input.minimum_tls_version in ["tls1.2", "tls1.3"]
}

data_integrity_assurance[_data_integrity_assurance_def] if {
    input.cipher_suite_mac_type in ["hmac"]
    input.null_cipher_or_mac_permitted == false
    input.minimum_tls_version in ["tls1.2", "tls1.3"]
}

countermeasures contains _data_integrity_assurance_def if {
    count(data_integrity_assurance) > 0
}

_certificate_based_authentication_def := {
    "name": "Certificate Based Authentication",
    "description": "Delivers mutual or server-side certificate validation to confirm endpoint identity before establishing a secure channel, preventing impersonation of trusted services.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

certificate_based_authentication[_certificate_based_authentication_def] if {
    input.certificate_validation_enabled == true
    input.mutual_tls_mode in ["mutual", "server_only"]
    input.trusted_ca_store_configured == true
}

countermeasures contains _certificate_based_authentication_def if {
    count(certificate_based_authentication) > 0
}

_forward_secrecy_provision_def := {
    "name": "Forward Secrecy Provision",
    "description": "Provides ephemeral key exchange mechanisms (e.g., ECDHE) ensuring that compromise of long-term private keys does not retroactively expose previously recorded session traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

forward_secrecy_provision[_forward_secrecy_provision_def] if {
    input.ephemeral_key_exchange_enabled == true
    input.non_pfs_cipher_suites_present == false
}

forward_secrecy_provision[_forward_secrecy_provision_def] if {
    input.minimum_tls_version == "TLS_1_3"
    input.ephemeral_key_exchange_enabled == true
}

forward_secrecy_provision[_forward_secrecy_provision_def] if {
    "ECDHE" in input.configured_cipher_suites
    input.non_pfs_cipher_suites_present == false
    input.ephemeral_key_exchange_enabled == true
}

countermeasures contains _forward_secrecy_provision_def if {
    count(forward_secrecy_provision) > 0
}

_protocol_version_enforcement_def := {
    "name": "Protocol Version Enforcement",
    "description": "Enforces minimum acceptable protocol versions (e.g., TLS 1.2+), blocking negotiation of deprecated or vulnerable protocol versions that would reduce protection quality.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

protocol_version_enforcement[_protocol_version_enforcement_def] if {
    input.minimum_tls_version in ["TLS_1_2", "TLS_1_3"]
    input.deprecated_versions_explicitly_disabled == true
}

protocol_version_enforcement[_protocol_version_enforcement_def] if {
    input.minimum_tls_version in ["TLS_1_2", "TLS_1_3"]
    input.protocol_downgrade_protection_enabled == true
}

countermeasures contains _protocol_version_enforcement_def if {
    count(protocol_version_enforcement) > 0
}

_certificate_lifecycle_management_def := {
    "name": "Certificate Lifecycle Management",
    "description": "Provides operational capability to track certificate expiry, automate renewal, and maintain valid revocation status (OCSP/CRL), ensuring continuous authentication coverage without lapses.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

certificate_lifecycle_management[_certificate_lifecycle_management_def] if {
    input.certificate_monitoring_enabled == true
    input.auto_renewal_configured == true
    not input.revocation_check_method in ["none"]
}

countermeasures contains _certificate_lifecycle_management_def if {
    count(certificate_lifecycle_management) > 0
}

_handshake_logging_and_visibility_def := {
    "name": "Handshake Logging And Visibility",
    "description": "Delivers logging of TLS handshake events, negotiated cipher suites, certificate details, and connection metadata, enabling audit trails and anomaly detection for encrypted sessions.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

handshake_logging_and_visibility[_handshake_logging_and_visibility_def] if {
    input.tls_handshake_logging_enabled == true
    count(input.logged_handshake_fields) >= 3
    input.log_destination in ["siem", "centralized_aggregator"]
}

handshake_logging_and_visibility[_handshake_logging_and_visibility_def] if {
    input.tls_handshake_logging_enabled == true
    "cipher_suite" in input.logged_handshake_fields
    "tls_version" in input.logged_handshake_fields
    input.log_destination != "none"
}

countermeasures contains _handshake_logging_and_visibility_def if {
    count(handshake_logging_and_visibility) > 0
}

_integration_depth_with_application_layer_def := {
    "name": "Integration Depth With Application Layer",
    "description": "Measures how completely the encryption control is applied across all application endpoints and APIs, ensuring no unencrypted communication paths exist within the protected system scope.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

integration_depth_with_application_layer[_integration_depth_with_application_layer_def] if {
    input.all_endpoints_tls_enforced == true
    input.tls_enforcement_scope == "full"
    input.unencrypted_endpoint_count == 0
}

countermeasures contains _integration_depth_with_application_layer_def if {
    count(integration_depth_with_application_layer) > 0
}
