package _dt_built_in.exposures.message_queue



_default_anonymous_weak_broker_authentication_def := {
    "name": "Default / anonymous / weak broker authentication",
    "description": "The broker ships with default-allow access \u2014 RabbitMQ's built-in guest:guest user reachable remotely (loopback_users = none) or the ANONYMOUS SASL mechanism, Kafka with no authorizer or allow.everyone.if.no.acl.found = true. An attacker connects with no or well-known credentials and reads or injects messages directly.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "attributes": {
                "justification": "Default broker accounts (RabbitMQ guest:guest) and default-allow authorization let an attacker authenticate with shipped/known credentials \u2014 Valid Accounts: Default Accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.005",
            "attributes": {
                "justification": "Once connected anonymously, the attacker abuses the broker's publish/subscribe protocol (AMQP/Kafka) to read or inject messages \u2014 Application Layer Protocol: Publish/Subscribe Protocols."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

default_anonymous_weak_broker_authentication[_default_anonymous_weak_broker_authentication_def] if {
    not input.default_accounts_removed_or_changed
}

default_anonymous_weak_broker_authentication[_default_anonymous_weak_broker_authentication_def] if {
    input.default_guest_remotely_reachable == true
}

default_anonymous_weak_broker_authentication[_default_anonymous_weak_broker_authentication_def] if {
    input.anonymous_access_allowed == true
}

default_anonymous_weak_broker_authentication[_default_anonymous_weak_broker_authentication_def] if {
    not input.kafka_authorizer_enabled
}

default_anonymous_weak_broker_authentication[_default_anonymous_weak_broker_authentication_def] if {
    input.kafka_allow_everyone_if_no_acl_found == true
}

exposures contains _default_anonymous_weak_broker_authentication_def if {
    count(default_anonymous_weak_broker_authentication) > 0
}

_over_broad_authorization_no_per_topic_least_privilege_def := {
    "name": "Over-broad authorization / no per-topic least privilege",
    "description": "Application principals hold wildcard rights \u2014 RabbitMQ configure/write/read all set to '.*', or Kafka with no per-topic ACLs \u2014 so any authenticated client can publish, consume, or reconfigure any queue/topic. A compromised low-privilege producer becomes a confused deputy able to read or tamper with every other service's messages.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.005",
            "attributes": {
                "justification": "With wildcard rights / no per-topic ACLs, any authenticated client abuses the broker's publish/subscribe protocol to inject, consume, or reconfigure arbitrary topics/queues \u2014 a compromised low-privilege producer acts as a confused deputy over the messaging channel."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_authorization_no_per_topic_least_privilege[_over_broad_authorization_no_per_topic_least_privilege_def] if {
    not input.least_privilege_access_enforced
}

over_broad_authorization_no_per_topic_least_privilege[_over_broad_authorization_no_per_topic_least_privilege_def] if {
    input.wildcard_acls_used == true
}

over_broad_authorization_no_per_topic_least_privilege[_over_broad_authorization_no_per_topic_least_privilege_def] if {
    not input.per_topic_acls_enforced
}

exposures contains _over_broad_authorization_no_per_topic_least_privilege_def if {
    count(over_broad_authorization_no_per_topic_least_privilege) > 0
}

_cleartext_transport_interception_mitm_def := {
    "name": "Cleartext transport interception / MITM",
    "description": "Plaintext AMQP (5672), Kafka PLAINTEXT (9092), or PLAINTEXT inter-broker replication exposes credentials and message payloads to network sniffing and man-in-the-middle modification. Without verify_peer / pinned TLS 1.2+, a network attacker reads and alters traffic in transit.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Plaintext AMQP/Kafka listeners expose credentials and message payloads to passive network sniffing."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Without peer-certificate verification or pinned TLS 1.2+, an active attacker performs adversary-in-the-middle to read and alter broker traffic."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {
                "justification": "Cleartext broker transport enables exfiltration of message data over an unencrypted protocol."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_transport_interception_mitm[_cleartext_transport_interception_mitm_def] if {
    not input.flow_tls_encrypted
}

cleartext_transport_interception_mitm[_cleartext_transport_interception_mitm_def] if {
    not input.tls_only_transport
}

cleartext_transport_interception_mitm[_cleartext_transport_interception_mitm_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_transport_interception_mitm[_cleartext_transport_interception_mitm_def] if {
    not input.server_certificate_validated
}

cleartext_transport_interception_mitm[_cleartext_transport_interception_mitm_def] if {
    not input.service_to_service_mtls_enforced
}

exposures contains _cleartext_transport_interception_mitm_def if {
    count(cleartext_transport_interception_mitm) > 0
}

_internet_exposed_broker_management_plane_def := {
    "name": "Internet-exposed broker / management plane",
    "description": "AMQP 5672, Kafka 9092, the RabbitMQ management UI on 15672, or ActiveMQ OpenWire on 61616 bound to 0.0.0.0 and reachable from the internet give attackers a direct surface for credential abuse, admin takeover, and known-CVE exploitation rather than a private/management-network-only footprint.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "An internet-exposed broker / management plane is a public-facing application surface; attackers exploit it directly for credential abuse, admin takeover, and known-CVE exploitation (e.g. ActiveMQ OpenWire RCE CVE-2023-46604)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

internet_exposed_broker_management_plane[_internet_exposed_broker_management_plane_def] if {
    input.data_store_publicly_routable == true
}

internet_exposed_broker_management_plane[_internet_exposed_broker_management_plane_def] if {
    input.management_ui_internet_exposed == true
}

internet_exposed_broker_management_plane[_internet_exposed_broker_management_plane_def] if {
    not input.segment_boundary_enforced
}

internet_exposed_broker_management_plane[_internet_exposed_broker_management_plane_def] if {
    not input.control_plane_api_not_publicly_exposed
}

exposures contains _internet_exposed_broker_management_plane_def if {
    count(internet_exposed_broker_management_plane) > 0
}

_message_tampering_malicious_injection_def := {
    "name": "Message tampering / malicious injection",
    "description": "On an unauthenticated or wildcard-authorized queue with no per-message integrity protection, an attacker injects forged messages or alters in-flight payloads, driving downstream consumers to act on attacker-controlled data. Brokers do not sign message bodies natively, so integrity must be enforced at transport (TLS) and application layers.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1659",
            "attributes": {
                "justification": "Content Injection \u2014 an attacker on an unauthenticated/wildcard-authorized queue with no per-message integrity protection injects forged messages so downstream consumers act on attacker-controlled content."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.002",
            "attributes": {
                "justification": "Transmitted Data Manipulation \u2014 in-flight broker messages are altered/forged because bodies are unsigned, corrupting the data consumers process."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

message_tampering_malicious_injection[_message_tampering_malicious_injection_def] if {
    not input.message_integrity_protected
}

message_tampering_malicious_injection[_message_tampering_malicious_injection_def] if {
    not input.producer_authentication_required
}

message_tampering_malicious_injection[_message_tampering_malicious_injection_def] if {
    input.wildcard_publish_authorization == true
}

exposures contains _message_tampering_malicious_injection_def if {
    count(message_tampering_malicious_injection) > 0
}

_message_replay_def := {
    "name": "Message replay",
    "description": "Captured legitimate messages are re-submitted to trigger duplicate side-effects (repeated payments, commands) when consumers lack idempotency/dedup and messages carry no nonce/sequence binding or freshness window.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

message_replay[_message_replay_def] if {
    not input.consumer_idempotency_or_dedup_enforced
}

message_replay[_message_replay_def] if {
    not input.message_freshness_nonce_bound
}

exposures contains _message_replay_def if {
    count(message_replay) > 0
}

_sensitive_payloads_unencrypted_at_rest_unbounded_retention_def := {
    "name": "Sensitive payloads unencrypted at rest / unbounded retention",
    "description": "Cleartext PII/secrets in message bodies persist on unencrypted broker disk (Kafka log segments, RabbitMQ mnesia/quorum data) and, with no TTL/retention bound, are retained indefinitely \u2014 leaking into logs, backups, or readable cloud storage. Coverage relies on volume encryption since brokers do not encrypt bodies natively.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

sensitive_payloads_unencrypted_at_rest_unbounded_retention[_sensitive_payloads_unencrypted_at_rest_unbounded_retention_def] if {
    not input.encrypted_at_rest
}

sensitive_payloads_unencrypted_at_rest_unbounded_retention[_sensitive_payloads_unencrypted_at_rest_unbounded_retention_def] if {
    not input.retention_schedule_enforced
}

sensitive_payloads_unencrypted_at_rest_unbounded_retention[_sensitive_payloads_unencrypted_at_rest_unbounded_retention_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _sensitive_payloads_unencrypted_at_rest_unbounded_retention_def if {
    count(sensitive_payloads_unencrypted_at_rest_unbounded_retention) > 0
}

_queue_flooding_resource_exhaustion_dos_def := {
    "name": "Queue flooding / resource-exhaustion DoS",
    "description": "With no queue-length cap, memory/disk watermark, or producer quota, a producer or attacker floods the broker with messages or connections, exhausting memory/disk and denying service to legitimate consumers.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
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
            "value": "T1499.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

queue_flooding_resource_exhaustion_dos[_queue_flooding_resource_exhaustion_dos_def] if {
    not input.queue_length_limit_enforced
}

queue_flooding_resource_exhaustion_dos[_queue_flooding_resource_exhaustion_dos_def] if {
    not input.memory_disk_watermark_configured
}

queue_flooding_resource_exhaustion_dos[_queue_flooding_resource_exhaustion_dos_def] if {
    not input.rate_limiting_or_lockout_enabled
}

queue_flooding_resource_exhaustion_dos[_queue_flooding_resource_exhaustion_dos_def] if {
    not input.ddos_protection_in_place
}

exposures contains _queue_flooding_resource_exhaustion_dos_def if {
    count(queue_flooding_resource_exhaustion_dos) > 0
}

_unpatched_broker_rce_activemq_openwire_def := {
    "name": "Unpatched broker RCE (ActiveMQ OpenWire)",
    "description": "Known broker vulnerabilities \u2014 notably the ActiveMQ OpenWire deserialization flaw \u2014 let an unauthenticated remote attacker instantiate arbitrary classes and run shell commands on the broker. Actively exploited for ransomware; the broker software must be at a patched release.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 10,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Unauthenticated remote exploitation of a known broker RCE (ActiveMQ OpenWire deserialization, CVE-2023-46604) against a network-facing broker is exploitation of a public-facing application."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_broker_rce_activemq_openwire[_unpatched_broker_rce_activemq_openwire_def] if {
    input.unpatched_known_rce_cve == true
}

unpatched_broker_rce_activemq_openwire[_unpatched_broker_rce_activemq_openwire_def] if {
    not input.edge_appliance_patched_within_sla
}

unpatched_broker_rce_activemq_openwire[_unpatched_broker_rce_activemq_openwire_def] if {
    input.native_deserialization_of_untrusted_data == true
}

exposures contains _unpatched_broker_rce_activemq_openwire_def if {
    count(unpatched_broker_rce_activemq_openwire) > 0
}

_no_audit_logging_of_connections_publish_consume_admin_events_def := {
    "name": "No audit logging of connections / publish-consume / admin events",
    "description": "Default local-only logging with no auth/connection/admin (vhost/user/ACL change) or publish/consume audit shipped off-box leaves anonymous access, message tampering, and abuse undetectable \u2014 there is no forensic trail when the queue is misused.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
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

no_audit_logging_of_connections_publish_consume_admin_events[_no_audit_logging_of_connections_publish_consume_admin_events_def] if {
    not input.access_audit_trail_enabled
}

no_audit_logging_of_connections_publish_consume_admin_events[_no_audit_logging_of_connections_publish_consume_admin_events_def] if {
    not input.security_events_fully_logged
}

no_audit_logging_of_connections_publish_consume_admin_events[_no_audit_logging_of_connections_publish_consume_admin_events_def] if {
    not input.logs_stored_on_separate_system
}

no_audit_logging_of_connections_publish_consume_admin_events[_no_audit_logging_of_connections_publish_consume_admin_events_def] if {
    not input.broker_admin_events_audited
}

exposures contains _no_audit_logging_of_connections_publish_consume_admin_events_def if {
    count(no_audit_logging_of_connections_publish_consume_admin_events) > 0
}
