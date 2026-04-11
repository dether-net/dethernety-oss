package _dt_built_in.exposures.local_application_data_read_write



_unencrypted_ipc_channel_data_exposure_def := {
    "name": "Unencrypted Ipc Channel Data Exposure",
    "description": "Data flowing through UNIX domain sockets or named pipes between application and filesystem proxy/daemon is transmitted in plaintext, allowing any co-resident process with sufficient privilege to intercept via /proc or kernel tracing interfaces.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

unencrypted_ipc_channel_data_exposure[_unencrypted_ipc_channel_data_exposure_def] if {
    input.ipc_channel_type in ["unix_domain_socket", "named_pipe"]
    not input.ipc_channel_encryption_enabled
    not input.ipc_socket_permissions_restrictive
}

unencrypted_ipc_channel_data_exposure[_unencrypted_ipc_channel_data_exposure_def] if {
    input.ipc_channel_type in ["unix_domain_socket", "named_pipe"]
    not input.ipc_channel_encryption_enabled
    input.kernel_tracing_interfaces_accessible == true
}

exposures contains _unencrypted_ipc_channel_data_exposure_def if {
    count(unencrypted_ipc_channel_data_exposure) > 0
}

_missing_integrity_verification_on_read_path_def := {
    "name": "Missing Integrity Verification On Read Path",
    "description": "Data read from the filesystem is not cryptographically verified (e.g., no HMAC or signature check) before consumption by the application, allowing an attacker who can modify stored bytes to inject tampered data into the transit path without detection.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

missing_integrity_verification_on_read_path[_missing_integrity_verification_on_read_path_def] if {
    not input.integrity_verification_enabled
    input.filesystem_write_accessible_to_non_owner == true
}

missing_integrity_verification_on_read_path[_missing_integrity_verification_on_read_path_def] if {
    not input.integrity_verification_enabled
    input.read_path_on_shared_or_network_filesystem == true
}

exposures contains _missing_integrity_verification_on_read_path_def if {
    count(missing_integrity_verification_on_read_path) > 0
}

_shared_memory_segment_eavesdropping_def := {
    "name": "Shared Memory Segment Eavesdropping",
    "description": "When applications use mmap or POSIX shared memory to move data to/from filesystem buffers, improperly permissioned segments expose in-flight data to unauthorized reader processes on the same host.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

shared_memory_segment_eavesdropping[_shared_memory_segment_eavesdropping_def] if {
    input.shm_world_readable == true
}

shared_memory_segment_eavesdropping[_shared_memory_segment_eavesdropping_def] if {
    not input.shm_owner_isolation_enforced
}

shared_memory_segment_eavesdropping[_shared_memory_segment_eavesdropping_def] if {
    regex.match("^0?[0-7][0-7][1-7][0-7]$|^0?[0-7][0-7][0-7][1-7]$", input.shm_segment_permissions)
}

exposures contains _shared_memory_segment_eavesdropping_def if {
    count(shared_memory_segment_eavesdropping) > 0
}

_named_pipe_hijacking_via_race_condition_def := {
    "name": "Named Pipe Hijacking Via Race Condition",
    "description": "TOCTOU race on named pipe (FIFO) creation allows an attacker to substitute a controlled pipe endpoint before the legitimate reader connects, intercepting or corrupting the transit stream between writer and consumer.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": []
}

named_pipe_hijacking_via_race_condition[_named_pipe_hijacking_via_race_condition_def] if {
    input.pipe_directory_world_writable == true
    not input.pipe_creation_uses_exclusive_flag
}

named_pipe_hijacking_via_race_condition[_named_pipe_hijacking_via_race_condition_def] if {
    input.pipe_directory_world_writable == true
    not input.pipe_ownership_verified_before_open
}

exposures contains _named_pipe_hijacking_via_race_condition_def if {
    count(named_pipe_hijacking_via_race_condition) > 0
}

_kernel_buffer_cache_side_channel_def := {
    "name": "Kernel Buffer Cache Side Channel",
    "description": "Timing differences in page-cache hit/miss behavior during file read operations leak information about data access patterns and potentially data content to co-resident processes via cache-timing side channels.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

kernel_buffer_cache_side_channel[_kernel_buffer_cache_side_channel_def] if {
    not input.cache_side_channel_mitigation_enabled
    input.co_resident_untrusted_processes_permitted == true
    input.sensitive_file_access_pattern == "sensitive"
}

kernel_buffer_cache_side_channel[_kernel_buffer_cache_side_channel_def] if {
    not input.cache_side_channel_mitigation_enabled
    input.co_resident_untrusted_processes_permitted == true
    input.sensitive_file_access_pattern == "non_sensitive"
}

exposures contains _kernel_buffer_cache_side_channel_def if {
    count(kernel_buffer_cache_side_channel) > 0
}

_missing_mutual_authentication_on_abstract_socket_def := {
    "name": "Missing Mutual Authentication On Abstract Socket",
    "description": "Applications communicating over Linux abstract namespace sockets lack peer credential verification, allowing any process in the same network namespace to impersonate the filesystem service endpoint without authentication.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

missing_mutual_authentication_on_abstract_socket[_missing_mutual_authentication_on_abstract_socket_def] if {
    input.uses_abstract_socket == true
    not input.peer_credential_verification_enabled
}

missing_mutual_authentication_on_abstract_socket[_missing_mutual_authentication_on_abstract_socket_def] if {
    input.uses_abstract_socket == true
    input.socket_namespace_isolation in ["host", "shared_container_group"]
    not input.peer_credential_verification_enabled
}

exposures contains _missing_mutual_authentication_on_abstract_socket_def if {
    count(missing_mutual_authentication_on_abstract_socket) > 0
}

_replay_of_cached_filesystem_responses_def := {
    "name": "Replay Of Cached Filesystem Responses",
    "description": "Filesystem abstraction layers or caching daemons (e.g., FUSE, NFS loopback) that do not include freshness tokens or sequence numbers allow replayed stale responses to be injected into the read path, bypassing up-to-date data delivery.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

replay_of_cached_filesystem_responses[_replay_of_cached_filesystem_responses_def] if {
    input.filesystem_layer_type in ["fuse", "nfs_loopback", "overlayfs", "caching_daemon", "other_abstraction"]
    not input.cache_freshness_validation_enabled
}

replay_of_cached_filesystem_responses[_replay_of_cached_filesystem_responses_def] if {
    input.filesystem_layer_type in ["fuse", "nfs_loopback", "overlayfs", "caching_daemon", "other_abstraction"]
    not input.integrity_verification_enabled
}

exposures contains _replay_of_cached_filesystem_responses_def if {
    count(replay_of_cached_filesystem_responses) > 0
}

_unthrottled_io_enabling_denial_of_service_via_transit_saturation_def := {
    "name": "Unthrottled Io Enabling Denial Of Service Via Transit Saturation",
    "description": "Absence of I/O rate limiting or bandwidth controls on the filesystem data path allows a process to saturate kernel I/O queues, starving legitimate data transit operations and constituting a denial-of-service against dependent dataflows.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

unthrottled_io_enabling_denial_of_service_via_transit_saturation[_unthrottled_io_enabling_denial_of_service_via_transit_saturation_def] if {
    not input.io_rate_limiting_enabled
}

unthrottled_io_enabling_denial_of_service_via_transit_saturation[_unthrottled_io_enabling_denial_of_service_via_transit_saturation_def] if {
    not input.io_rate_limiting_enabled
    input.io_queue_depth_limit == 0
}

unthrottled_io_enabling_denial_of_service_via_transit_saturation[_unthrottled_io_enabling_denial_of_service_via_transit_saturation_def] if {
    not input.io_rate_limiting_enabled
    input.process_io_priority_class == "none"
}

exposures contains _unthrottled_io_enabling_denial_of_service_via_transit_saturation_def if {
    count(unthrottled_io_enabling_denial_of_service_via_transit_saturation) > 0
}

_fuse_filesystem_man_in_the_middle_def := {
    "name": "Fuse Filesystem Man In The Middle",
    "description": "A FUSE-mounted filesystem interposes a user-space daemon in the data path without transport-layer integrity guarantees; a compromised or malicious FUSE handler can silently alter data in transit between the application and the underlying storage.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

fuse_filesystem_man_in_the_middle[_fuse_filesystem_man_in_the_middle_def] if {
    input.filesystem_layer_type == true
    not input.integrity_verification_enabled
}

fuse_filesystem_man_in_the_middle[_fuse_filesystem_man_in_the_middle_def] if {
    input.filesystem_layer_type == true
    not input.fuse_handler_integrity_verified
}

fuse_filesystem_man_in_the_middle[_fuse_filesystem_man_in_the_middle_def] if {
    input.filesystem_layer_type == true
    input.fuse_daemon_privilege_level == "root"
    not input.integrity_verification_enabled
}

exposures contains _fuse_filesystem_man_in_the_middle_def if {
    count(fuse_filesystem_man_in_the_middle) > 0
}

_cleartext_data_in_kernel_audit_or_trace_transit_def := {
    "name": "Cleartext Data In Kernel Audit Or Trace Transit",
    "description": "Filesystem data written to kernel audit trails, strace output pipes, or eBPF ring buffers during transit is captured in plaintext with no confidentiality controls, exposing sensitive content to any consumer of those tracing interfaces.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": []
}

cleartext_data_in_kernel_audit_or_trace_transit[_cleartext_data_in_kernel_audit_or_trace_transit_def] if {
    input.kernel_tracing_interfaces_enabled == true
    not input.tracing_access_control_enforced
}

cleartext_data_in_kernel_audit_or_trace_transit[_cleartext_data_in_kernel_audit_or_trace_transit_def] if {
    input.kernel_tracing_interfaces_enabled == true
    not input.audit_log_encryption_at_rest
    not input.tracing_access_control_enforced
}

exposures contains _cleartext_data_in_kernel_audit_or_trace_transit_def if {
    count(cleartext_data_in_kernel_audit_or_trace_transit) > 0
}
