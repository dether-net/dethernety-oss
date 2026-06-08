package _dt_built_in.exposures.message_publish_consume



_anonymous_unauthenticated_broker_access_def := {
    "name": "Anonymous / unauthenticated broker access",
    "description": "The flow fails to authenticate its endpoints: a PLAINTEXT/anonymous Kafka listener, Mosquitto allow_anonymous true, or a remotely reachable RabbitMQ guest/guest lets any client connect and produce/consume without proving identity, enabling injection, replay and tampering of the message channel.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Anonymous/default (guest/guest) broker login is use of a valid-but-unauthenticated or default account to access the message flow."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A remotely reachable broker listener accepting anonymous produce/consume is exploitation of a public-facing application service over the network."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_unauthenticated_broker_access[_anonymous_unauthenticated_broker_access_def] if {
    not input.broker_client_authentication_required
}

anonymous_unauthenticated_broker_access[_anonymous_unauthenticated_broker_access_def] if {
    not input.anonymous_broker_access_disabled
}

exposures contains _anonymous_unauthenticated_broker_access_def if {
    count(anonymous_unauthenticated_broker_access) > 0
}

_wildcard_missing_topic_authorization_def := {
    "name": "Wildcard / missing topic authorization",
    "description": "The crossing enforces authentication without scoped authorization: a default-allow authorizer (Kafka allow.everyone.if.no.acl.found=true, no Mosquitto acl_file) or a universal grant (Kafka User:*/Topic:*, RabbitMQ '.*'/'.*'/'.*', NATS '>') gives any authenticated client full read/write across all topics/queues/subjects, defeating least-privilege.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

wildcard_missing_topic_authorization[_wildcard_missing_topic_authorization_def] if {
    not input.topic_authorization_enforced
}

wildcard_missing_topic_authorization[_wildcard_missing_topic_authorization_def] if {
    input.default_allow_authorizer == true
}

wildcard_missing_topic_authorization[_wildcard_missing_topic_authorization_def] if {
    input.wildcard_topic_acl_present == true
}

exposures contains _wildcard_missing_topic_authorization_def if {
    count(wildcard_missing_topic_authorization) > 0
}

_plaintext_transport_sniffing_unverified_tls_mitm_def := {
    "name": "Plaintext transport sniffing / unverified-TLS MITM",
    "description": "Produce/consume over a plaintext listener (9092/5672/1883/4222) or unverified TLS (ssl.client.auth=none/requested, require_certificate false, no truststore validation) exposes credentials and message PII to network sniffing and man-in-the-middle, so the channel is unauthenticated against an active attacker.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

plaintext_transport_sniffing_unverified_tls_mitm[_plaintext_transport_sniffing_unverified_tls_mitm_def] if {
    not input.encryption_in_transit_enabled
}

plaintext_transport_sniffing_unverified_tls_mitm[_plaintext_transport_sniffing_unverified_tls_mitm_def] if {
    not input.broker_tls_certificate_verified
}

plaintext_transport_sniffing_unverified_tls_mitm[_plaintext_transport_sniffing_unverified_tls_mitm_def] if {
    input.tls_min_version in ["SSLv3", "TLS1.0", "TLS1.1"]
}

exposures contains _plaintext_transport_sniffing_unverified_tls_mitm_def if {
    count(plaintext_transport_sniffing_unverified_tls_mitm) > 0
}

_shared_static_broker_credential_theft_def := {
    "name": "Shared static broker credential theft",
    "description": "A single shared static broker credential (SASL/nkey/token) reused across all services and embedded in code/images, once leaked, grants any holder the full access of every service, with no per-service scoping or revocation, so one disclosure compromises the entire flow's identity surface.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

shared_static_broker_credential_theft[_shared_static_broker_credential_theft_def] if {
    input.shared_static_broker_credential_in_use == true
}

shared_static_broker_credential_theft[_shared_static_broker_credential_theft_def] if {
    not input.per_service_broker_credentials_used
}

shared_static_broker_credential_theft[_shared_static_broker_credential_theft_def] if {
    not input.broker_credentials_externalized
}

exposures contains _shared_static_broker_credential_theft_def if {
    count(shared_static_broker_credential_theft) > 0
}

_mass_unauthorized_consumption_def := {
    "name": "Mass unauthorized consumption",
    "description": "Without consumer-group/read authorization (no READ on Topic + Group, NATS subscribe scoped to '>'), an authenticated-but-unscoped client joins a consumer group or subscribes broadly and drains topics it should never read, exfiltrating the entire event stream in motion.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

mass_unauthorized_consumption[_mass_unauthorized_consumption_def] if {
    not input.consumer_group_read_authorization_enforced
}

mass_unauthorized_consumption[_mass_unauthorized_consumption_def] if {
    not input.subscribe_scope_least_privilege
}

exposures contains _mass_unauthorized_consumption_def if {
    count(mass_unauthorized_consumption) > 0
}

_unsafe_message_deserialization_rce_def := {
    "name": "Unsafe message deserialization -> RCE",
    "description": "A consumer that reflectively/polymorphically deserializes untrusted message bodies (Java ObjectInputStream, jsonpickle, pickle, Jackson default typing) without schema validation executes attacker gadget chains carried as payload, yielding remote code execution on the consumer (CWE-502).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1203",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unsafe_message_deserialization_rce[_unsafe_message_deserialization_rce_def] if {
    not input.safe_deserialization_enforced
}

unsafe_message_deserialization_rce[_unsafe_message_deserialization_rce_def] if {
    input.unsafe_polymorphic_deserialization_used == true
}

unsafe_message_deserialization_rce[_unsafe_message_deserialization_rce_def] if {
    not input.message_schema_validation_enabled
}

exposures contains _unsafe_message_deserialization_rce_def if {
    count(unsafe_message_deserialization_rce) > 0
}

_pii_secrets_in_messages_and_broker_logs_def := {
    "name": "PII / secrets in messages and broker logs",
    "description": "Sensitive data carried in cleartext payloads or echoed into broker/consumer logs with long/unbounded retention is readable by anyone with broker or log access, a data-exposure path independent of transport encryption that violates data minimisation in transit and at the hop.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

pii_secrets_in_messages_and_broker_logs[_pii_secrets_in_messages_and_broker_logs_def] if {
    not input.sensitive_data_in_payload_minimized_or_encrypted
}

pii_secrets_in_messages_and_broker_logs[_pii_secrets_in_messages_and_broker_logs_def] if {
    not input.sensitive_data_masking_enabled
}

pii_secrets_in_messages_and_broker_logs[_pii_secrets_in_messages_and_broker_logs_def] if {
    not input.message_log_retention_bounded
}

exposures contains _pii_secrets_in_messages_and_broker_logs_def if {
    count(pii_secrets_in_messages_and_broker_logs) > 0
}

_publicly_reachable_broker_listener_def := {
    "name": "Publicly reachable broker listener",
    "description": "A broker port (9092/9093/5672/1883/4222/6650) bound to 0.0.0.0 and routable from the internet turns every other weakness (anonymous access, default creds, oversized payloads) into a remotely exploitable one and invites resource-exhaustion DoS against the flow's availability.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

publicly_reachable_broker_listener[_publicly_reachable_broker_listener_def] if {
    not input.broker_listener_network_restricted
}

publicly_reachable_broker_listener[_publicly_reachable_broker_listener_def] if {
    input.broker_listener_internet_reachable == true
}

publicly_reachable_broker_listener[_publicly_reachable_broker_listener_def] if {
    not input.broker_listener_network_restricted
    not input.message_size_limit_bounded
}

exposures contains _publicly_reachable_broker_listener_def if {
    count(publicly_reachable_broker_listener) > 0
}
