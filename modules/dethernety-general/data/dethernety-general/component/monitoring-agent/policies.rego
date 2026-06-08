package _dt_built_in.exposures.monitoring_agent



_cleartext_telemetry_forwarding_sniffing_mitm_def := {
    "name": "Cleartext telemetry forwarding (sniffing / MITM)",
    "description": "Forwarding logs/metrics without TLS (plain Fluentd forward, http:// Filebeat output, plain TCP/UDP syslog) exposes the telemetry payload and any embedded backend credentials to passive sniffing and active MITM/injection on the network path. Disabling TLS verification (verification_mode: none / Fluentd insecure true) defeats the channel even when 'TLS on' \u2014 a control-bypass that re-enables MITM despite encryption appearing in place.",
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
    "attack_vector": "NETWORK"
}

cleartext_telemetry_forwarding_sniffing_mitm[_cleartext_telemetry_forwarding_sniffing_mitm_def] if {
    not input.encryption_in_transit_enabled
}

cleartext_telemetry_forwarding_sniffing_mitm[_cleartext_telemetry_forwarding_sniffing_mitm_def] if {
    not input.server_certificate_validated
}

cleartext_telemetry_forwarding_sniffing_mitm[_cleartext_telemetry_forwarding_sniffing_mitm_def] if {
    input.tls_min_version in ["TLS1.0", "TLS1.1", "SSLv3"]
}

exposures contains _cleartext_telemetry_forwarding_sniffing_mitm_def if {
    count(cleartext_telemetry_forwarding_sniffing_mitm) > 0
}

_unauthenticated_agent_listening_endpoint_exposure_def := {
    "name": "Unauthenticated agent listening endpoint exposure",
    "description": "node_exporter and most Prometheus exporters serve /metrics with NO auth by default, and Fluentd in_http/in_forward / SNMP can bind 0.0.0.0. A world-reachable, unauthenticated scrape or forward endpoint leaks host inventory, mount points, process/network stats, and gives any network peer an attack surface. Mitigated by loopback binding behind a TLS proxy plus --web.config.file basic_auth/mTLS or a backend <security> block.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1046",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_agent_listening_endpoint_exposure[_unauthenticated_agent_listening_endpoint_exposure_def] if {
    not input.agent_endpoint_bound_loopback_or_internal
    not input.listening_endpoint_authenticated
}

unauthenticated_agent_listening_endpoint_exposure[_unauthenticated_agent_listening_endpoint_exposure_def] if {
    input.metrics_endpoint_internet_reachable == true
    not input.listening_endpoint_authenticated
}

exposures contains _unauthenticated_agent_listening_endpoint_exposure_def if {
    count(unauthenticated_agent_listening_endpoint_exposure) > 0
}

_weak_missing_agent_to_backend_authentication_def := {
    "name": "Weak / missing agent-to-backend authentication",
    "description": "Without a Fluentd <security> shared_key/user_auth block (allow_anonymous_source defaults true), a Filebeat api_key/credential, or an mTLS client cert, a rogue forwarder can inject telemetry into the SIEM and a stolen channel can be replayed. Server-only TLS with no client identity authenticates the backend but not the agent \u2014 anyone on the path can impersonate a forwarder.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
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
            "value": "T1565",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_missing_agent_to_backend_authentication[_weak_missing_agent_to_backend_authentication_def] if {
    not input.agent_to_backend_authentication_enabled
}

weak_missing_agent_to_backend_authentication[_weak_missing_agent_to_backend_authentication_def] if {
    input.anonymous_forwarder_source_allowed == true
}

weak_missing_agent_to_backend_authentication[_weak_missing_agent_to_backend_authentication_def] if {
    not input.mutual_tls_client_auth_enabled
}

exposures contains _weak_missing_agent_to_backend_authentication_def if {
    count(weak_missing_agent_to_backend_authentication) > 0
}

_snmp_cleartext_community_string_read_write_v1_v2c_def := {
    "name": "SNMP cleartext community-string read/write (v1/v2c)",
    "description": "SNMPv1/v2c rocommunity/rwcommunity strings traverse the network in cleartext and are frequently left at default 'public'/'private'. An attacker sniffs or guesses the community to read host/device MIB data (rocommunity) or, with rwcommunity, alter device configuration. Only SNMPv3 with authPriv (SHA auth + AES privacy) protects the polled data; noauth/authNoPriv levels leave it exposed.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1602",
            "attributes": {
                "justification": "Cleartext SNMPv1/v2c community read (rocommunity) lets an adjacent attacker pull device/host MIB configuration data \u2014 Data from Configuration Repository / SNMP (MIB Dump)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Community strings and polled MIB data traverse the network in cleartext on v1/v2c and v3 noauth/authNoPriv, recoverable by passive network sniffing on the ADJACENT segment."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

snmp_cleartext_community_string_read_write_v1_v2c[_snmp_cleartext_community_string_read_write_v1_v2c_def] if {
    input.snmp_version_and_security_level in ["v1", "v2c", "v3_noauth", "v3_authnopriv"]
}

snmp_cleartext_community_string_read_write_v1_v2c[_snmp_cleartext_community_string_read_write_v1_v2c_def] if {
    input.snmp_default_community_string_in_use == true
}

exposures contains _snmp_cleartext_community_string_read_write_v1_v2c_def if {
    count(snmp_cleartext_community_string_read_write_v1_v2c) > 0
}

_plaintext_backend_credentials_in_agent_config_def := {
    "name": "Plaintext backend credentials in agent config",
    "description": "Backend tokens/api_keys/shared_keys/passwords stored inline in a world-readable fluent.conf/filebeat.yml (or readable spooled buffers) grant any local reader the credentials to write to or impersonate against the SIEM/log backend. Mitigated by 0600/0640 root-owned config and secret references via keystore/${ENV} rather than inline literals.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

plaintext_backend_credentials_in_agent_config[_plaintext_backend_credentials_in_agent_config_def] if {
    input.backend_credentials_stored_inline_plaintext == true
}

plaintext_backend_credentials_in_agent_config[_plaintext_backend_credentials_in_agent_config_def] if {
    not input.secrets_stored_in_secret_manager
    not input.config_file_permissions_hardened
}

exposures contains _plaintext_backend_credentials_in_agent_config_def if {
    count(plaintext_backend_credentials_in_agent_config) > 0
}

_agent_root_host_privilege_escalation_def := {
    "name": "Agent-root host privilege escalation",
    "description": "Log agents commonly run as root to read every file under /var/log, so any agent RCE or host local-privesc then yields root and full host compromise. CVE-2021-3156 (sudo Baron Samedit, unprivileged->root, sudo <=1.9.5p1) is a host local-root the agent's root context amplifies. A dedicated unprivileged agent user (adm group / capabilities) plus patch currency shrinks the blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

agent_root_host_privilege_escalation[_agent_root_host_privilege_escalation_def] if {
    not input.agent_runs_as_non_root_least_privilege
}

agent_root_host_privilege_escalation[_agent_root_host_privilege_escalation_def] if {
    not input.host_security_patches_current
}

exposures contains _agent_root_host_privilege_escalation_def if {
    count(agent_root_host_privilege_escalation) > 0
}

_agent_parser_embedded_http_rce_patch_currency_def := {
    "name": "Agent parser / embedded-HTTP RCE (patch currency)",
    "description": "CVE-2024-4323 ('Linguistic Lumberjack', Fluent Bit 2.0.7-3.0.3, CVSS 9.8): a memory-corruption in the embedded HTTP server's /api/v1/traces parser enabling DoS, information disclosure and potentially RCE. A reachable embedded HTTP/monitoring endpoint on an unpatched agent is directly exploitable; fixed in 3.0.4 / backported 2.2.3. Disable/loopback-bind HTTP_Server and keep the agent patched.",
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
            "value": "T1203",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

agent_parser_embedded_http_rce_patch_currency[_agent_parser_embedded_http_rce_patch_currency_def] if {
    not input.known_vulnerabilities_patched
}

agent_parser_embedded_http_rce_patch_currency[_agent_parser_embedded_http_rce_patch_currency_def] if {
    not input.embedded_http_server_disabled_or_loopback
    not input.embedded_http_endpoint_authenticated
}

exposures contains _agent_parser_embedded_http_rce_patch_currency_def if {
    count(agent_parser_embedded_http_rce_patch_currency) > 0
}

_sensitive_data_pii_over_collection_no_masking_def := {
    "name": "Sensitive-data / PII over-collection (no masking)",
    "description": "Without scrub/redact/drop filters at the source, the agent forwards credentials, tokens and PII/PHI verbatim into the monitoring tier, widening exposure to anyone with SIEM access and creating data-residency and retention liabilities. NIST SP 800-122 data minimization; mitigated by mask/redact/drop_fields filters in the agent pipeline before egress.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Unmasked credentials, tokens, and PII/PHI forwarded verbatim into the monitoring/SIEM tier broaden the population of data accessible to anyone with backend access; over-collected sensitive data at rest in the monitoring store maps to Data from Information Repositories / stored-data collection."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

sensitive_data_pii_over_collection_no_masking[_sensitive_data_pii_over_collection_no_masking_def] if {
    not input.sensitive_data_masking_enabled
}

sensitive_data_pii_over_collection_no_masking[_sensitive_data_pii_over_collection_no_masking_def] if {
    not input.pii_redaction_filters_configured
}

exposures contains _sensitive_data_pii_over_collection_no_masking_def if {
    count(sensitive_data_pii_over_collection_no_masking) > 0
}

_agent_config_tamper_siem_blinding_def := {
    "name": "Agent config tamper / SIEM blinding",
    "description": "A writable agent config or unauthenticated reload endpoint lets an attacker disable forwarding (blinding the SIEM during an intrusion), redirect telemetry to an attacker sink, or inject an exec/parser that runs as the agent's (often root) user. Config files and dirs must be writable only by root/admin and remote reload endpoints authenticated \u2014 this is the agent's own control-integrity facet.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.001",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.003",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

agent_config_tamper_siem_blinding[_agent_config_tamper_siem_blinding_def] if {
    not input.agent_config_write_restricted_to_admin
}

agent_config_tamper_siem_blinding[_agent_config_tamper_siem_blinding_def] if {
    not input.config_reload_endpoint_authenticated
}

agent_config_tamper_siem_blinding[_agent_config_tamper_siem_blinding_def] if {
    not input.forwarding_tamper_monitored
}

exposures contains _agent_config_tamper_siem_blinding_def if {
    count(agent_config_tamper_siem_blinding) > 0
}
