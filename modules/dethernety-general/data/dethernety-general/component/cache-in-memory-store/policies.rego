package _dt_built_in.exposures.cache_in_memory_store



_unauthenticated_internet_exposed_instance_def := {
    "name": "Unauthenticated internet-exposed instance",
    "description": "The cache binds a reachable interface (0.0.0.0) with protected-mode off and the shipped 'default on nopass +@all' user \u2014 no requirepass, no ACL. Any network peer gains full read/write: dumping sessions and tokens, running FLUSHALL/CONFIG/Lua. The classic mass-internet cache compromise.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
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
            "value": "T1133",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_internet_exposed_instance[_unauthenticated_internet_exposed_instance_def] if {
    input.data_store_publicly_routable == true
    input.default_user_unauthenticated == true
}

unauthenticated_internet_exposed_instance[_unauthenticated_internet_exposed_instance_def] if {
    input.data_store_publicly_routable == true
    not input.protected_mode_enabled
}

exposures contains _unauthenticated_internet_exposed_instance_def if {
    count(unauthenticated_internet_exposed_instance) > 0
}

_cleartext_transport_interception_def := {
    "name": "Cleartext transport interception",
    "description": "With no tls-port (and the cleartext port open), session IDs and bearer tokens travel as plaintext RESP, readable by any on-path attacker; harvested tokens are then replayed to impersonate users. Weak/legacy TLS (TLSv1.0/1.1) is the downgradeable variant of the same exposure.",
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
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048.003",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_transport_interception[_cleartext_transport_interception_def] if {
    not input.flow_tls_encrypted
    not input.tls_only_transport
}

cleartext_transport_interception[_cleartext_transport_interception_def] if {
    input.weak_tls_versions_enabled == true
}

cleartext_transport_interception[_cleartext_transport_interception_def] if {
    input.min_tls_version in ["TLSv1.0", "TLSv1.1"]
}

cleartext_transport_interception[_cleartext_transport_interception_def] if {
    not input.cipher_suites_strong_only
}

exposures contains _cleartext_transport_interception_def if {
    count(cleartext_transport_interception) > 0
}

_sensitive_transient_data_exposed_via_persistence_def := {
    "name": "Sensitive transient data exposed via persistence",
    "description": "RDB snapshots and AOF persist in-memory sessions and tokens to disk in cleartext \u2014 the cache has no built-in at-rest encryption. An unencrypted, broadly-readable dump.rdb/appendonly file leaks the very secrets the tier was meant to hold only transiently.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
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

sensitive_transient_data_exposed_via_persistence[_sensitive_transient_data_exposed_via_persistence_def] if {
    input.persistence_enabled == true
    not input.encrypted_at_rest
}

sensitive_transient_data_exposed_via_persistence[_sensitive_transient_data_exposed_via_persistence_def] if {
    input.persistence_enabled == true
    input.dump_files_world_readable == true
}

exposures contains _sensitive_transient_data_exposed_via_persistence_def if {
    count(sensitive_transient_data_exposed_via_persistence) > 0
}

_redishell_lua_sandbox_escape_to_rce_def := {
    "name": "RediShell Lua sandbox escape to RCE",
    "description": "CVE-2025-49844 (RediShell): a ~13-year-old use-after-free in the Lua scripting engine lets an authenticated user craft a script that manipulates the GC to escape the sandbox and execute native code on the host (CVSS 10.0). Mitigated by patching and restricting scripting (-@scripting) for app users.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 10,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.011",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

redishell_lua_sandbox_escape_to_rce[_redishell_lua_sandbox_escape_to_rce_def] if {
    not input.cache_patched_within_sla
    not input.scripting_restricted_for_app_users
}

redishell_lua_sandbox_escape_to_rce[_redishell_lua_sandbox_escape_to_rce_def] if {
    input.unpatched_known_rce_cve == true
    not input.scripting_restricted_for_app_users
}

exposures contains _redishell_lua_sandbox_escape_to_rce_def if {
    count(redishell_lua_sandbox_escape_to_rce) > 0
}

_over_privileged_destructive_command_access_def := {
    "name": "Over-privileged / destructive command access",
    "description": "App credentials with unrestricted command access can run FLUSHALL/FLUSHDB (data loss), CONFIG (re-point the persistence dir or disable protections), or KEYS (full keyspace scrape) \u2014 abuse amplified when dangerous commands are neither ACL-restricted (-@dangerous/-@admin) nor renamed and no least-privilege named users exist.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1485",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_destructive_command_access[_over_privileged_destructive_command_access_def] if {
    not input.dangerous_commands_acl_restricted
    not input.dangerous_commands_renamed_or_disabled
}

over_privileged_destructive_command_access[_over_privileged_destructive_command_access_def] if {
    not input.least_privilege_access_enforced
}

exposures contains _over_privileged_destructive_command_access_def if {
    count(over_privileged_destructive_command_access) > 0
}

_memory_exhaustion_denial_of_service_def := {
    "name": "Memory-exhaustion denial of service",
    "description": "With maxmemory unset (0) and/or a noeviction policy mismatched to TTL usage, an attacker or runaway client floods writes until the host OOMs \u2014 taking down the hot-data tier that fronts authentication and session state.",
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

memory_exhaustion_denial_of_service[_memory_exhaustion_denial_of_service_def] if {
    not input.maxmemory_limit_set
}

memory_exhaustion_denial_of_service[_memory_exhaustion_denial_of_service_def] if {
    input.maxmemory_policy == "noeviction"
    not input.maxmemory_limit_set
}

exposures contains _memory_exhaustion_denial_of_service_def if {
    count(memory_exhaustion_denial_of_service) > 0
}

_insufficient_audit_logging_def := {
    "name": "Insufficient audit logging",
    "description": "With no persistent logfile/syslog (volatile stdout-only) and the slowlog disabled (-1), there is no durable record of who connected or which abusive/expensive commands (KEYS, big SORT, repeated AUTH failures) ran \u2014 blinding detection of scraping, brute-force, and DoS against the cache.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.persistent_logging_absent == true
}

insufficient_audit_logging[_insufficient_audit_logging_def] if {
    input.slowlog_log_slower_than < 0
}

exposures contains _insufficient_audit_logging_def if {
    count(insufficient_audit_logging) > 0
}
