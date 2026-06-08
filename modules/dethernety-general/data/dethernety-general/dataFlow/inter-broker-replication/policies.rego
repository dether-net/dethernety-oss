package _dt_built_in.exposures.inter_broker_replication



_cleartext_inter_broker_replication_channel_def := {
    "name": "Cleartext inter-broker / replication channel",
    "description": "The east-west replication/distribution link carries full message payloads (and often SASL credentials) in cleartext \u2014 a PLAINTEXT Kafka inter-broker listener, MSK EncryptionInTransit.InCluster=false, missing Pulsar replicationTlsEnabled, RabbitMQ default inet_tcp distribution, NATS routes without tls{}, or Redis tls-replication/tls-cluster no. On-path attackers sniff all replicated data and standing credentials.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
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

cleartext_inter_broker_replication_channel[_cleartext_inter_broker_replication_channel_def] if {
    not input.encryption_in_transit_enabled
}

cleartext_inter_broker_replication_channel[_cleartext_inter_broker_replication_channel_def] if {
    not input.encryption_in_transit_enabled
}

exposures contains _cleartext_inter_broker_replication_channel_def if {
    count(cleartext_inter_broker_replication_channel) > 0
}

_rogue_broker_unauthenticated_cluster_join_def := {
    "name": "Rogue broker / unauthenticated cluster join",
    "description": "Without mutual authentication on the join/route path, an attacker-controlled node joins the cluster as a peer and reads or forges replicated partitions. Vectors: Kafka inter-broker listener without ssl.client.auth=required, NATS cluster/gateway routes without tls verify + authorization, Pulsar replication without a broker client auth plugin, MSK Unauthenticated.Enabled=true.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
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

rogue_broker_unauthenticated_cluster_join[_rogue_broker_unauthenticated_cluster_join_def] if {
    not input.mutual_tls_client_auth_enabled
}

rogue_broker_unauthenticated_cluster_join[_rogue_broker_unauthenticated_cluster_join_def] if {
    input.unauthenticated_cluster_join_allowed == true
}

rogue_broker_unauthenticated_cluster_join[_rogue_broker_unauthenticated_cluster_join_def] if {
    not input.cluster_route_authorization_enforced
}

rogue_broker_unauthenticated_cluster_join[_rogue_broker_unauthenticated_cluster_join_def] if {
    not input.replication_broker_auth_plugin_enabled
}

exposures contains _rogue_broker_unauthenticated_cluster_join_def if {
    count(rogue_broker_unauthenticated_cluster_join) > 0
}

_weak_default_erlang_cookie_enabling_rogue_rabbitmq_node_def := {
    "name": "Weak/default Erlang cookie enabling rogue RabbitMQ node",
    "description": "RabbitMQ cluster membership is gated by the shared Erlang cookie. A default, predictable, or world-readable .erlang.cookie lets any process presenting the value join the Erlang distribution or run rabbitmqctl, taking full cluster control and access to replicated messages \u2014 the canonical shared-secret cluster-membership weakness.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "A default/predictable or world-readable .erlang.cookie is an unsecured credential left exposed in the cluster's configuration/filesystem; an adversary reads or guesses it to authenticate to the Erlang distribution and join the RabbitMQ cluster."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Presenting the shared Erlang cookie lets a rogue node authenticate as a legitimate cluster peer (valid-account/credential reuse), gaining full cluster control and access to replicated messages."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

weak_default_erlang_cookie_enabling_rogue_rabbitmq_node[_weak_default_erlang_cookie_enabling_rogue_rabbitmq_node_def] if {
    not input.erlang_cookie_value_non_default
}

weak_default_erlang_cookie_enabling_rogue_rabbitmq_node[_weak_default_erlang_cookie_enabling_rogue_rabbitmq_node_def] if {
    not input.erlang_cookie_file_permissions_restricted
}

exposures contains _weak_default_erlang_cookie_enabling_rogue_rabbitmq_node_def if {
    count(weak_default_erlang_cookie_enabling_rogue_rabbitmq_node) > 0
}

_over_broad_replication_mirror_credentials_def := {
    "name": "Over-broad replication / mirror credentials",
    "description": "MirrorMaker/federation/shovel principals granted broad ALL/admin or shared with application principals mean a compromised mirror process can read or write arbitrary topics/queues across both source and target clusters, far beyond what replication needs. The replication identity's scope governs the blast radius of any mirror-process compromise.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_replication_mirror_credentials[_over_broad_replication_mirror_credentials_def] if {
    not input.replication_principal_least_privilege
}

over_broad_replication_mirror_credentials[_over_broad_replication_mirror_credentials_def] if {
    not input.replication_credentials_dedicated_not_shared
}

exposures contains _over_broad_replication_mirror_credentials_def if {
    count(over_broad_replication_mirror_credentials) > 0
}

_untrusted_spoofed_federation_or_geo_replication_peer_def := {
    "name": "Untrusted / spoofed federation or geo-replication peer",
    "description": "An over-broad CA trust store, wildcard/unbounded peer acceptance, or unverified remote endpoints let an untrusted (or attacker-impersonated) cluster participate in federation/geo-replication, injecting or exfiltrating messages across the cross-cluster trust boundary \u2014 a data-residency breach as replicated data crosses into an unintended cluster.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

untrusted_spoofed_federation_or_geo_replication_peer[_untrusted_spoofed_federation_or_geo_replication_peer_def] if {
    not input.federation_peers_explicitly_allowlisted
}

untrusted_spoofed_federation_or_geo_replication_peer[_untrusted_spoofed_federation_or_geo_replication_peer_def] if {
    not input.federation_ca_trust_scoped
}

untrusted_spoofed_federation_or_geo_replication_peer[_untrusted_spoofed_federation_or_geo_replication_peer_def] if {
    not input.remote_peer_endpoint_verified
}

exposures contains _untrusted_spoofed_federation_or_geo_replication_peer_def if {
    count(untrusted_spoofed_federation_or_geo_replication_peer) > 0
}

_replication_credential_erlang_cookie_exposure_at_rest_def := {
    "name": "Replication credential / Erlang-cookie exposure at rest",
    "description": "Replication URIs with embedded credentials (RabbitMQ federation/shovel amqps URIs), MirrorMaker keystore passwords in plaintext config, or a loosely-permissioned Erlang cookie on disk give an attacker the standing credentials to impersonate the replication path or join the cluster.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
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
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    input.replication_credentials_embedded_in_uri == true
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    not input.replication_credentials_externalized_from_config
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    not input.secrets_stored_in_secret_manager
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    not input.config_file_permissions_hardened
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    not input.erlang_cookie_file_permissions_restricted
}

replication_credential_erlang_cookie_exposure_at_rest[_replication_credential_erlang_cookie_exposure_at_rest_def] if {
    not input.erlang_cookie_value_non_default
}

exposures contains _replication_credential_erlang_cookie_exposure_at_rest_def if {
    count(replication_credential_erlang_cookie_exposure_at_rest) > 0
}

_inter_broker_listener_not_network_isolated_def := {
    "name": "Inter-broker listener not network-isolated",
    "description": "The inter-broker/replication listener is bound to a public or client-facing interface (0.0.0.0, single shared listener) rather than a private interface firewalled to peer nodes only. A broadly reachable replication port \u2014 even when TLS \u2014 invites rogue-join and sniffing attempts from outside the cluster's trust zone.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

inter_broker_listener_not_network_isolated[_inter_broker_listener_not_network_isolated_def] if {
    not input.inter_broker_listener_network_isolated
}

inter_broker_listener_not_network_isolated[_inter_broker_listener_not_network_isolated_def] if {
    input.replication_listener_internet_reachable == true
}

inter_broker_listener_not_network_isolated[_inter_broker_listener_not_network_isolated_def] if {
    not input.inter_broker_listener_separate_from_client
}

exposures contains _inter_broker_listener_not_network_isolated_def if {
    count(inter_broker_listener_not_network_isolated) > 0
}
