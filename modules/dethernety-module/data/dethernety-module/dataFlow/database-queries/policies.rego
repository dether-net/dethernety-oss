package _dt_built_in.exposures.database_queries

_unencrypted_db_transport_def := {
    "name": "Unencrypted Db Transport",
    "description": "Database connections established without TLS/SSL, transmitting queries, result sets, and credentials in plaintext over the network. An attacker with access to the network segment can passively capture all database traffic including authentication material and sensitive data.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Unencrypted database transport allows attackers to capture credentials and query data via network sniffing."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_db_transport[_unencrypted_db_transport_def] if {
    not input.tls_enabled
}

unencrypted_db_transport[_unencrypted_db_transport_def] if {
    input.tls_enabled == true
    input.certificate_verification_mode == "none"
}

unencrypted_db_transport[_unencrypted_db_transport_def] if {
    input.tls_enabled == true
    input.certificate_verification_mode == "partial"
    input.db_network_exposure in ["cross_boundary", "public"]
}

exposures contains _unencrypted_db_transport_def if {
    count(unencrypted_db_transport) > 0
}

_weak_or_deprecated_tls_version_def := {
    "name": "Weak Or Deprecated Tls Version",
    "description": "Database connections negotiating TLS 1.0 or TLS 1.1, or cipher suites with known weaknesses (RC4, 3DES, NULL ciphers, export-grade). Enables downgrade attacks or cryptanalytic compromise of the session, exposing query and response content.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak or deprecated TLS versions can be exploited through downgrade attacks to force use of vulnerable cipher suites."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Using deprecated TLS versions directly weakens encryption strength, enabling interception of communications."
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_or_deprecated_tls_version[_weak_or_deprecated_tls_version_def] if {
    input.minimum_tls_version == "TLS_1_0"
}

weak_or_deprecated_tls_version[_weak_or_deprecated_tls_version_def] if {
    input.minimum_tls_version == "TLS_1_1"
}

weak_or_deprecated_tls_version[_weak_or_deprecated_tls_version_def] if {
    not input.tls_enforced_on_connection
}

weak_or_deprecated_tls_version[_weak_or_deprecated_tls_version_def] if {
    input.weak_cipher_suites_enabled == true
}

exposures contains _weak_or_deprecated_tls_version_def if {
    count(weak_or_deprecated_tls_version) > 0
}

_tls_certificate_validation_bypass_def := {
    "name": "Tls Certificate Validation Bypass",
    "description": "Application driver or connection string is configured to skip server certificate validation (e.g., sslmode=disable or verify-ca disabled). TLS encryption may be present but the channel is fully vulnerable to man-in-the-middle interception since the server identity is not verified.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "name": "Install Root Certificate",
            "relevance": "Bypassing TLS certificate validation can be achieved by installing rogue root certificates to perform man-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Certificate validation bypass enables attackers to forge or misuse certificates to impersonate trusted endpoints."
        }
    ],
    "attack_vector": "ADJACENT"
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    input.ssl_mode in ["disable", "allow"]
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    input.ssl_mode in ["require", "verify-ca"]
    not input.certificate_authority_validation_enforced
}

tls_certificate_validation_bypass[_tls_certificate_validation_bypass_def] if {
    not input.certificate_authority_validation_enforced
    not input.hostname_verification_enabled
}

exposures contains _tls_certificate_validation_bypass_def if {
    count(tls_certificate_validation_bypass) > 0
}

_database_wire_protocol_plaintext_fallback_def := {
    "name": "Database Wire Protocol Plaintext Fallback",
    "description": "Database wire protocols (MySQL, PostgreSQL, MSSQL TDS) support plaintext authentication or unencrypted mode negotiation by default. If the server or client permits a STARTTLS-style downgrade or allows non-SSL connections, an active attacker can force a plaintext session.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Plaintext fallback in database wire protocols exposes all traffic to interception via network sniffing."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Plaintext fallback may allow data exfiltration over unencrypted alternative protocol channels."
        }
    ],
    "attack_vector": "ADJACENT"
}

database_wire_protocol_plaintext_fallback[_database_wire_protocol_plaintext_fallback_def] if {
    input.ssl_mode in ["disabled", "allow"]
}

database_wire_protocol_plaintext_fallback[_database_wire_protocol_plaintext_fallback_def] if {
    input.plaintext_fallback_permitted == true
}

database_wire_protocol_plaintext_fallback[_database_wire_protocol_plaintext_fallback_def] if {
    input.ssl_mode in ["require", "prefer"]
    not input.certificate_authority_validation_enforced
}

exposures contains _database_wire_protocol_plaintext_fallback_def if {
    count(database_wire_protocol_plaintext_fallback) > 0
}

_missing_query_message_integrity_def := {
    "name": "Missing Query Message Integrity",
    "description": "No application-layer signing or MAC is applied to SQL queries in transit beyond the TLS record layer. If TLS termination occurs at an intermediate proxy (e.g., connection pooler, load balancer), queries traverse an internal segment without integrity assurance, enabling undetected query tampering.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Without message integrity checks, database queries can be intercepted and observed or tampered with via network sniffing."
        }
    ],
    "attack_vector": "ADJACENT"
}

missing_query_message_integrity[_missing_query_message_integrity_def] if {
    not input.app_layer_query_signing_enabled
    input.tls_termination_point in ["intermediate_proxy", "load_balancer"]
    not input.internal_segment_encryption_enforced
}

missing_query_message_integrity[_missing_query_message_integrity_def] if {
    not input.app_layer_query_signing_enabled
    input.tls_termination_point == "none"
}

exposures contains _missing_query_message_integrity_def if {
    count(missing_query_message_integrity) > 0
}

_absent_connection_rate_and_query_throttling_def := {
    "name": "Absent Connection Rate And Query Throttling",
    "description": "No rate limiting or connection throttling is enforced on the application-to-database data flow. An attacker who compromises the application tier, or a runaway process, can flood the database with connection requests or query volume, causing denial of service or facilitating brute-force credential attacks against the database listener.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Lack of rate and query throttling leaves the database application vulnerable to exhaustion floods that degrade or deny service."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.002",
            "name": "Service Exhaustion Flood",
            "relevance": "Without throttling, attackers can flood database connections to exhaust service resources."
        }
    ],
    "attack_vector": "LOCAL"
}

absent_connection_rate_and_query_throttling[_absent_connection_rate_and_query_throttling_def] if {
    not input.connection_rate_limiting_enabled
    not input.query_throttling_enabled
}

absent_connection_rate_and_query_throttling[_absent_connection_rate_and_query_throttling_def] if {
    not input.connection_rate_limiting_enabled
    not input.max_connections_per_client_configured
}

absent_connection_rate_and_query_throttling[_absent_connection_rate_and_query_throttling_def] if {
    not input.query_throttling_enabled
    not input.max_connections_per_client_configured
}

exposures contains _absent_connection_rate_and_query_throttling_def if {
    count(absent_connection_rate_and_query_throttling) > 0
}

_unencrypted_connection_pooler_segment_def := {
    "name": "Unencrypted Connection Pooler Segment",
    "description": "A connection pooler (PgBouncer, ProxySQL, RDS Proxy) sits between the application and database with TLS on the client-facing side but unencrypted on the server-facing side. Lateral movement onto the internal network segment exposes all database traffic in plaintext between the pooler and the database.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.001",
            "name": "Internal Proxy",
            "relevance": "An unencrypted connection pooler segment acts as an internal proxy where traffic can be intercepted or manipulated."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Unencrypted traffic between the application and connection pooler can be captured via network sniffing on internal segments."
        }
    ],
    "attack_vector": "ADJACENT"
}

unencrypted_connection_pooler_segment[_unencrypted_connection_pooler_segment_def] if {
    not input.pooler_to_db_tls_enabled
}

unencrypted_connection_pooler_segment[_unencrypted_connection_pooler_segment_def] if {
    input.pooler_server_tls_certificate_validation in ["none", "prefer"]
    input.internal_network_segment_access_control in ["none", "subnet_only"]
}

unencrypted_connection_pooler_segment[_unencrypted_connection_pooler_segment_def] if {
    input.pooler_server_tls_certificate_validation in ["none", "prefer", "require_no_verify"]
    input.internal_network_segment_access_control == "none"
}

exposures contains _unencrypted_connection_pooler_segment_def if {
    count(unencrypted_connection_pooler_segment) > 0
}

_bgp_route_injection_for_traffic_interception_def := {
    "name": "Bgp Route Injection For Traffic Interception",
    "description": "In multi-datacenter or cloud-peered deployments, database traffic routes through dynamic routing infrastructure. BGP route injection or misconfigured peering could redirect application-to-database traffic through an attacker-controlled segment, enabling interception even when TLS is configured if certificate validation is weak.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "BGP route injection redirects traffic flows, enabling attackers to sniff database or application traffic in transit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1599",
            "name": "Network Boundary Bridging",
            "relevance": "BGP route injection can bridge network boundaries to intercept traffic that would otherwise be isolated."
        }
    ],
    "attack_vector": "ADJACENT"
}

bgp_route_injection_for_traffic_interception[_bgp_route_injection_for_traffic_interception_def] if {
    input.multi_datacenter_or_cloud_peered == true
    not input.tls_certificate_validation_enforced
}

bgp_route_injection_for_traffic_interception[_bgp_route_injection_for_traffic_interception_def] if {
    input.multi_datacenter_or_cloud_peered == true
    not input.bgp_route_filtering_configured
}

bgp_route_injection_for_traffic_interception[_bgp_route_injection_for_traffic_interception_def] if {
    input.multi_datacenter_or_cloud_peered == true
    not input.tls_certificate_validation_enforced
    not input.bgp_route_filtering_configured
}

exposures contains _bgp_route_injection_for_traffic_interception_def if {
    count(bgp_route_injection_for_traffic_interception) > 0
}
