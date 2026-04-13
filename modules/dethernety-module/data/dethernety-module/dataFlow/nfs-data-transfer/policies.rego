package _dt_built_in.exposures.nfs_data_transfer



_cleartext_nfs_data_transmission_def := {
    "name": "Cleartext Nfs Data Transmission",
    "description": "NFSv3 and NFSv2 transmit file content, metadata, and credentials entirely in cleartext over the network, enabling passive interception of sensitive data by any observer on the path. An attacker with network access can capture complete file contents without active interference.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

cleartext_nfs_data_transmission[_cleartext_nfs_data_transmission_def] if {
    input.nfs_protocol_version == "v2"
}

cleartext_nfs_data_transmission[_cleartext_nfs_data_transmission_def] if {
    input.nfs_protocol_version == "v3"
}

cleartext_nfs_data_transmission[_cleartext_nfs_data_transmission_def] if {
    input.nfs_protocol_version in ["v4", "v4.1", "v4.2"]
    input.nfs_security_flavor in ["sys", "none"]
    not input.nfs_tls_enabled
}

cleartext_nfs_data_transmission[_cleartext_nfs_data_transmission_def] if {
    input.nfs_protocol_version in ["v4", "v4.1", "v4.2"]
    input.nfs_security_flavor in ["krb5", "krb5i"]
    not input.nfs_tls_enabled
}

exposures contains _cleartext_nfs_data_transmission_def if {
    count(cleartext_nfs_data_transmission) > 0
}

_missing_mutual_authentication_on_mount_def := {
    "name": "Missing Mutual Authentication On Mount",
    "description": "NFSv3 uses AUTH_SYS (AUTH_UNIX) which trusts client-supplied UID/GID values without cryptographic verification. There is no server-side proof of identity either, allowing a rogue NFS server or client to participate in file exchanges without being authenticated. NFSv4 with Kerberos (RPCSEC_GSS) addresses this but is not default.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

missing_mutual_authentication_on_mount[_missing_mutual_authentication_on_mount_def] if {
    input.nfs_protocol_version in ["nfsv2", "nfsv3"]
}

missing_mutual_authentication_on_mount[_missing_mutual_authentication_on_mount_def] if {
    input.nfs_protocol_version in ["nfsv4", "nfsv4.1", "nfsv4.2"]
    input.auth_flavor in ["auth_sys", "auth_none"]
}

missing_mutual_authentication_on_mount[_missing_mutual_authentication_on_mount_def] if {
    input.nfs_protocol_version in ["nfsv4", "nfsv4.1", "nfsv4.2"]
    input.auth_flavor in ["krb5", "krb5i", "krb5p"]
    not input.kerberos_configured
}

exposures contains _missing_mutual_authentication_on_mount_def if {
    count(missing_mutual_authentication_on_mount) > 0
}

_rpc_replay_attack_exposure_def := {
    "name": "Rpc Replay Attack Exposure",
    "description": "RPC messages underlying NFS lack built-in replay protection in NFSv3 and below. A captured RPC request (e.g., write or delete operation) can be retransmitted to the server to repeat the operation. RPCSEC_GSS sequence numbers in NFSv4/Kerberos mitigate this but must be explicitly enabled.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

rpc_replay_attack_exposure[_rpc_replay_attack_exposure_def] if {
    input.nfs_protocol_version in ["NFSv2", "NFSv3"]
}

rpc_replay_attack_exposure[_rpc_replay_attack_exposure_def] if {
    input.nfs_protocol_version in ["NFSv4", "NFSv4.1", "NFSv4.2"]
    not input.rpcsec_gss_enabled
}

rpc_replay_attack_exposure[_rpc_replay_attack_exposure_def] if {
    input.nfs_protocol_version in ["NFSv4", "NFSv4.1", "NFSv4.2"]
    input.nfs_security_flavor in ["sys", "none"]
}

exposures contains _rpc_replay_attack_exposure_def if {
    count(rpc_replay_attack_exposure) > 0
}

_in_transit_data_integrity_absence_def := {
    "name": "In Transit Data Integrity Absence",
    "description": "NFSv3 provides no cryptographic integrity verification on data packets in transit. A MITM attacker can silently modify file content, metadata, or RPC responses without detection by the client or server. NFSv4 with integrity-level RPCSEC_GSS (krb5i) provides per-message MICs but is not universally deployed.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

in_transit_data_integrity_absence[_in_transit_data_integrity_absence_def] if {
    input.nfs_protocol_version in ["NFSv2", "NFSv3"]
}

in_transit_data_integrity_absence[_in_transit_data_integrity_absence_def] if {
    input.nfs_protocol_version in ["NFSv4", "NFSv4.1", "NFSv4.2"]
    not input.rpcsec_gss_integrity_enabled
    not input.nfs_tls_enabled
}

exposures contains _in_transit_data_integrity_absence_def if {
    count(in_transit_data_integrity_absence) > 0
}

_nfs_over_unencrypted_transport_layer_def := {
    "name": "Nfs Over Unencrypted Transport Layer",
    "description": "Even when NFSv4 is used, it may be configured without TLS (NFSv4.1+ with TLS per RFC 9289) or without Kerberos privacy mode (krb5p), leaving the transport layer without encryption. Opportunistic downgrade or misconfiguration exposes the channel to passive capture.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

nfs_over_unencrypted_transport_layer[_nfs_over_unencrypted_transport_layer_def] if {
    input.nfs_protocol_version in ["v2", "v3"]
}

nfs_over_unencrypted_transport_layer[_nfs_over_unencrypted_transport_layer_def] if {
    input.nfs_protocol_version == "v4.0"
    not input.nfs_security_flavor
}

nfs_over_unencrypted_transport_layer[_nfs_over_unencrypted_transport_layer_def] if {
    input.nfs_protocol_version in ["v4.1", "v4.2"]
    not input.nfs_tls_enabled
    not input.nfs_security_flavor
}

exposures contains _nfs_over_unencrypted_transport_layer_def if {
    count(nfs_over_unencrypted_transport_layer) > 0
}

_portmapper_rpcbind_interception_def := {
    "name": "Portmapper Rpcbind Interception",
    "description": "NFS relies on rpcbind/portmapper for service registration and port discovery. An attacker on the network path can intercept or spoof portmapper responses, redirecting NFS clients to a rogue server or denying service by returning invalid port assignments. This affects the initial connection establishment phase.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

portmapper_rpcbind_interception[_portmapper_rpcbind_interception_def] if {
    input.rpcbind_network_exposure == "internet_exposed"
    not input.portmapper_response_authentication_enabled
}

portmapper_rpcbind_interception[_portmapper_rpcbind_interception_def] if {
    input.rpcbind_network_exposure == "untrusted_network"
    not input.portmapper_response_authentication_enabled
}

exposures contains _portmapper_rpcbind_interception_def if {
    count(portmapper_rpcbind_interception) > 0
}

_nfs_traffic_routing_manipulation_def := {
    "name": "Nfs Traffic Routing Manipulation",
    "description": "NFS connections traversing routed network segments are vulnerable to BGP hijacking, ARP spoofing, or ICMP redirect attacks that reroute NFS traffic through attacker-controlled infrastructure. Without source routing restrictions or cryptographic authentication of the path, this enables MITM or traffic interception.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

nfs_traffic_routing_manipulation[_nfs_traffic_routing_manipulation_def] if {
    input.nfs_traverses_routed_segments == true
    input.nfs_protocol_version in ["v2", "v3", "v4_no_krb"]
}

nfs_traffic_routing_manipulation[_nfs_traffic_routing_manipulation_def] if {
    input.nfs_traverses_routed_segments == true
    input.nfs_protocol_version in ["v4_krb5", "v4_krb5i"]
    not input.icmp_redirects_disabled
}

exposures contains _nfs_traffic_routing_manipulation_def if {
    count(nfs_traffic_routing_manipulation) > 0
}

_absence_of_nfs_traffic_rate_limiting_def := {
    "name": "Absence Of Nfs Traffic Rate Limiting",
    "description": "NFS data flows lack built-in rate limiting or bandwidth controls at the protocol level, making the transport channel susceptible to abuse where a single client can saturate the network link with high-volume read/write operations, causing denial of service for other NFS consumers sharing the same path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

absence_of_nfs_traffic_rate_limiting[_absence_of_nfs_traffic_rate_limiting_def] if {
    not input.nfs_client_bandwidth_limit_configured
    not input.nfs_network_qos_policy_applied
}

exposures contains _absence_of_nfs_traffic_rate_limiting_def if {
    count(absence_of_nfs_traffic_rate_limiting) > 0
}

_kerberos_ticket_interception_in_transit_def := {
    "name": "Kerberos Ticket Interception In Transit",
    "description": "When NFSv4 uses Kerberos (RPCSEC_GSS), Kerberos tickets and authenticators travel over the network during session establishment. Without transport encryption (TLS), these messages can be captured for offline analysis, replay attempts, or Kerberoasting if weak encryption types (e.g., RC4-HMAC) are negotiated.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

kerberos_ticket_interception_in_transit[_kerberos_ticket_interception_in_transit_def] if {
    input.rpcsec_gss_enabled == true
    not input.nfs_tls_enabled
}

kerberos_ticket_interception_in_transit[_kerberos_ticket_interception_in_transit_def] if {
    input.rpcsec_gss_enabled == true
    not input.nfs_tls_enabled
    "rc4-hmac" in input.kerberos_encryption_types
}

exposures contains _kerberos_ticket_interception_in_transit_def if {
    count(kerberos_ticket_interception_in_transit) > 0
}
