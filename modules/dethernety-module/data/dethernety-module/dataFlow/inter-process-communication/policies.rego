package _dt_built_in.exposures.inter_process_communication



_missing_mutual_authentication_on_ipc_channel_def := {
    "name": "Missing Mutual Authentication On Ipc Channel",
    "description": "IPC endpoints (Unix domain sockets, named pipes, D-Bus services) that authenticate the server to the client but not vice versa allow any local process to connect and inject or receive messages, bypassing access controls intended to restrict communication to authorized application components.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Directly relates to exploiting IPC channels, where missing mutual authentication allows unauthorized processes to communicate."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "name": "Remote Services",
            "relevance": "Lack of mutual authentication on IPC channels mirrors the risk of unauthenticated access to remote services."
        }
    ],
    "attack_vector": "LOCAL"
}

missing_mutual_authentication_on_ipc_channel[_missing_mutual_authentication_on_ipc_channel_def] if {
    not input.client_authentication_enforced
    not input.access_restricted_to_authorized_uids_gids
}

missing_mutual_authentication_on_ipc_channel[_missing_mutual_authentication_on_ipc_channel_def] if {
    not input.client_authentication_enforced
    input.access_restricted_to_authorized_uids_gids == true
}

exposures contains _missing_mutual_authentication_on_ipc_channel_def if {
    count(missing_mutual_authentication_on_ipc_channel) > 0
}

_message_integrity_absence_on_shared_memory_queue_def := {
    "name": "Message Integrity Absence On Shared Memory Queue",
    "description": "Data passed through shared memory segments or POSIX message queues without cryptographic MACs or checksums can be silently tampered by any process with write access to the segment, enabling data corruption or injection without detection by the receiving application.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Shared memory queues are an IPC mechanism; absence of message integrity enables tampering with inter-process messages."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1055.009",
            "name": "Proc Memory",
            "relevance": "Attackers can manipulate shared memory regions without integrity checks, similar to proc memory injection techniques."
        }
    ],
    "attack_vector": "LOCAL"
}

message_integrity_absence_on_shared_memory_queue[_message_integrity_absence_on_shared_memory_queue_def] if {
    input.ipc_channel_type in ["shared_memory", "posix_message_queue", "sysv_message_queue"]
    not input.mac_or_checksum_enforced
    not input.segment_write_access_restricted
}

message_integrity_absence_on_shared_memory_queue[_message_integrity_absence_on_shared_memory_queue_def] if {
    input.ipc_channel_type in ["shared_memory", "posix_message_queue", "sysv_message_queue"]
    not input.mac_or_checksum_enforced
}

exposures contains _message_integrity_absence_on_shared_memory_queue_def if {
    count(message_integrity_absence_on_shared_memory_queue) > 0
}

_replay_attack_on_ipc_messages_def := {
    "name": "Replay Attack On Ipc Messages",
    "description": "IPC messages lacking sequence numbers, timestamps, or nonce-based replay protection can be captured by a local observer and retransmitted to trigger duplicate actions (e.g., repeated financial transactions or command execution) on the receiving application.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Replay attacks targeting IPC messages directly exploit the inter-process communication channel."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Capturing IPC messages for replay requires intercepting/sniffing the communication, analogous to network sniffing."
        }
    ],
    "attack_vector": "LOCAL"
}

replay_attack_on_ipc_messages[_replay_attack_on_ipc_messages_def] if {
    input.replay_protection_mechanism == "none"
    input.message_carries_sensitive_action == true
}

replay_attack_on_ipc_messages[_replay_attack_on_ipc_messages_def] if {
    input.replay_protection_mechanism == "none"
    not input.message_integrity_verification_enabled
    input.message_carries_sensitive_action == true
}

exposures contains _replay_attack_on_ipc_messages_def if {
    count(replay_attack_on_ipc_messages) > 0
}

_dbus_unauthenticated_method_exposure_def := {
    "name": "Dbus Unauthenticated Method Exposure",
    "description": "D-Bus services that expose methods without requiring peer credential verification (UID/GID checks or PolicyKit authorization) allow unprivileged processes to invoke sensitive service operations, effectively bypassing application-level access control on the message bus.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "D-Bus is a core IPC mechanism; unauthenticated method exposure allows unauthorized callers to invoke privileged operations."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1212",
            "name": "Exploitation for Credential Access",
            "relevance": "Exposed unauthenticated D-Bus methods can be exploited to gain credentials or escalate privileges."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1569",
            "name": "System Services",
            "relevance": "D-Bus services often mediate system service interactions; unauthenticated exposure can allow abuse of system services."
        }
    ],
    "attack_vector": "LOCAL"
}

dbus_unauthenticated_method_exposure[_dbus_unauthenticated_method_exposure_def] if {
    not input.credential_verification_enforced
    not input.polkit_authorization_required
    input.exposed_method_privilege_level in ["partially_privileged", "fully_privileged"]
}

exposures contains _dbus_unauthenticated_method_exposure_def if {
    count(dbus_unauthenticated_method_exposure) > 0
}

_named_pipe_squatting_or_hijacking_def := {
    "name": "Named Pipe Squatting Or Hijacking",
    "description": "Named pipes created in world-writable directories or with predictable names can be pre-created by an attacker process, causing the legitimate application to connect to the attacker-controlled pipe endpoint, enabling man-in-the-middle interception and message injection on the IPC channel.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Named pipes are an IPC primitive; squatting or hijacking them is a direct attack on the IPC channel."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1574.009",
            "name": "Path Interception by Unquoted Path",
            "relevance": "Named pipe squatting is conceptually similar to path interception, where an attacker pre-creates a resource at an expected location."
        }
    ],
    "attack_vector": "LOCAL"
}

named_pipe_squatting_or_hijacking[_named_pipe_squatting_or_hijacking_def] if {
    input.pipe_directory_world_writable == true
    input.pipe_name_predictable == true
}

named_pipe_squatting_or_hijacking[_named_pipe_squatting_or_hijacking_def] if {
    input.pipe_directory_world_writable == true
    not input.pipe_ownership_verified
}

exposures contains _named_pipe_squatting_or_hijacking_def if {
    count(named_pipe_squatting_or_hijacking) > 0
}

_absence_of_rate_limiting_on_ipc_endpoints_def := {
    "name": "Absence Of Rate Limiting On Ipc Endpoints",
    "description": "IPC channels (Unix sockets, loopback ports) without ingress rate limiting or connection throttling are susceptible to local denial-of-service through message flooding, exhausting socket buffers or processing queues and disrupting inter-application communication integrity.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.001",
            "name": "OS Exhaustion Flood",
            "relevance": "Without rate limiting, IPC endpoints are vulnerable to flooding attacks that exhaust OS resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "The absence of rate limiting on IPC endpoints directly enables abuse of inter-process communication mechanisms."
        }
    ],
    "attack_vector": "LOCAL"
}

absence_of_rate_limiting_on_ipc_endpoints[_absence_of_rate_limiting_on_ipc_endpoints_def] if {
    not input.ipc_rate_limiting_enabled
    input.ipc_channel_type in ["unix_socket", "loopback_tcp", "dbus", "named_pipe", "message_queue"]
}

absence_of_rate_limiting_on_ipc_endpoints[_absence_of_rate_limiting_on_ipc_endpoints_def] if {
    not input.ipc_rate_limiting_enabled
    not input.socket_buffer_limit_configured
}

exposures contains _absence_of_rate_limiting_on_ipc_endpoints_def if {
    count(absence_of_rate_limiting_on_ipc_endpoints) > 0
}

_weak_or_absent_tls_on_loopback_rpc_def := {
    "name": "Weak Or Absent Tls On Loopback Rpc",
    "description": "gRPC, REST, or RPC frameworks configured to use HTTP/1.1 or HTTP/2 without TLS on loopback, or with TLS configured to accept self-signed certificates without pinning, allow downgrade or certificate substitution attacks by processes intercepting the loopback stack, undermining channel confidentiality assumptions.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Weak or absent TLS on loopback RPC allows local attackers to sniff unencrypted RPC traffic."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.004",
            "name": "Digital Certificates",
            "relevance": "Absence of proper TLS certificates on RPC channels relates to the misuse or absence of digital certificates for securing communications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1572",
            "name": "Protocol Tunneling",
            "relevance": "Weak TLS on loopback RPC can be exploited to tunnel malicious traffic through the unprotected RPC channel."
        }
    ],
    "attack_vector": "LOCAL"
}

weak_or_absent_tls_on_loopback_rpc[_weak_or_absent_tls_on_loopback_rpc_def] if {
    not input.loopback_rpc_tls_enabled
}

weak_or_absent_tls_on_loopback_rpc[_weak_or_absent_tls_on_loopback_rpc_def] if {
    input.loopback_rpc_tls_enabled == true
    input.certificate_validation_mode == "skip_verify"
}

weak_or_absent_tls_on_loopback_rpc[_weak_or_absent_tls_on_loopback_rpc_def] if {
    input.loopback_rpc_tls_enabled == true
    input.certificate_validation_mode == "self_signed_no_pin"
}

exposures contains _weak_or_absent_tls_on_loopback_rpc_def if {
    count(weak_or_absent_tls_on_loopback_rpc) > 0
}

_sensitive_data_in_ipc_metadata_or_headers_def := {
    "name": "Sensitive Data In Ipc Metadata Or Headers",
    "description": "Application-level message headers, D-Bus signal payloads, or RPC metadata transmitted over IPC channels without field-level encryption may inadvertently expose credentials, tokens, or PII to any process capable of observing the channel, even when the primary payload is protected.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1559",
            "name": "Inter-Process Communication",
            "relevance": "Sensitive data leaking through IPC metadata or headers is a direct risk within inter-process communication channels."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
            "relevance": "Sensitive data present in unprotected IPC headers can be exfiltrated over unencrypted protocols by a local attacker."
        }
    ],
    "attack_vector": "LOCAL"
}

sensitive_data_in_ipc_metadata_or_headers[_sensitive_data_in_ipc_metadata_or_headers_def] if {
    count(input.sensitive_field_types_in_headers) > 0
    not input.ipc_header_field_encryption_enabled
    not input.channel_access_restricted_to_intended_processes
}

sensitive_data_in_ipc_metadata_or_headers[_sensitive_data_in_ipc_metadata_or_headers_def] if {
    count(input.sensitive_field_types_in_headers) > 0
    not input.ipc_header_field_encryption_enabled
    input.channel_access_restricted_to_intended_processes == true
    "credentials" in input.sensitive_field_types_in_headers
}

sensitive_data_in_ipc_metadata_or_headers[_sensitive_data_in_ipc_metadata_or_headers_def] if {
    "auth_token" in input.sensitive_field_types_in_headers
    not input.ipc_header_field_encryption_enabled
    not input.channel_access_restricted_to_intended_processes
}

exposures contains _sensitive_data_in_ipc_metadata_or_headers_def if {
    count(sensitive_data_in_ipc_metadata_or_headers) > 0
}
