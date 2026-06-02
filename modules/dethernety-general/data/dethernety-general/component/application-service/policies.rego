package _dt_built_in.exposures.application_service



_broken_access_control_idor_bola_missing_function_level_authz_def := {
    "name": "Broken access control (IDOR / BOLA / missing function-level authz)",
    "description": "Authorization is client-side-only, scattered per-handler, or absent on POST/PUT/DELETE, letting a user read/modify another principal's records by id (IDOR/BOLA), invoke privileged functions, or force-browse protected pages. A01:2021 \u2014 the most prevalent web risk.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Broken access control (IDOR/BOLA, missing function-level authz, force-browsing) is an authorization weakness in a public-facing application that an attacker exploits over the network to reach data/functions for which they are not authorized \u2014 A01:2021."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1548",
            "attributes": {
                "justification": "Missing function-level authorization lets a low-privilege principal invoke privileged functions, abusing the application's elevation/access-control mechanism to perform actions beyond their assigned role."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

broken_access_control_idor_bola_missing_function_level_authz[_broken_access_control_idor_bola_missing_function_level_authz_def] if {
    not input.authz_enforced_server_side_centrally
}

broken_access_control_idor_bola_missing_function_level_authz[_broken_access_control_idor_bola_missing_function_level_authz_def] if {
    not input.object_level_authz_ownership_enforced
}

broken_access_control_idor_bola_missing_function_level_authz[_broken_access_control_idor_bola_missing_function_level_authz_def] if {
    not input.authn_enforced_on_every_endpoint
}

broken_access_control_idor_bola_missing_function_level_authz[_broken_access_control_idor_bola_missing_function_level_authz_def] if {
    not input.access_control_failures_logged_and_alerted
}

exposures contains _broken_access_control_idor_bola_missing_function_level_authz_def if {
    count(broken_access_control_idor_bola_missing_function_level_authz) > 0
}

_privilege_escalation_via_metadata_parameter_tampering_mass_assignment_def := {
    "name": "Privilege escalation via metadata/parameter tampering & mass assignment",
    "description": "The server trusts client-supplied state \u2014 tampered JWT/cookie/hidden-field role claims or over-posted privileged fields (isAdmin/role) bound wholesale onto domain objects \u2014 elevating the caller's privileges.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {
                "justification": "Trusting client-supplied role claims / over-posted privileged fields lets a caller exploit the application's privilege model to elevate from a normal account to admin (Exploitation for Privilege Escalation)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

privilege_escalation_via_metadata_parameter_tampering_mass_assignment[_privilege_escalation_via_metadata_parameter_tampering_mass_assignment_def] if {
    not input.bindable_field_allowlist_enforced
}

privilege_escalation_via_metadata_parameter_tampering_mass_assignment[_privilege_escalation_via_metadata_parameter_tampering_mass_assignment_def] if {
    not input.jwt_signature_verified
}

privilege_escalation_via_metadata_parameter_tampering_mass_assignment[_privilege_escalation_via_metadata_parameter_tampering_mass_assignment_def] if {
    not input.authz_enforced_server_side_centrally
}

exposures contains _privilege_escalation_via_metadata_parameter_tampering_mass_assignment_def if {
    count(privilege_escalation_via_metadata_parameter_tampering_mass_assignment) > 0
}

_injection_sqli_nosqli_os_command_ldap_def := {
    "name": "Injection (SQLi / NoSQLi / OS command / LDAP)",
    "description": "Unvalidated input concatenated into queries or shell strings lets attackers read/alter store data or execute commands on the host. A03:2021 \u2014 defeated by parameterized statements, argument-array execution, and server-side allow-list validation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Injection (SQLi/NoSQLi/OS command/LDAP) against a network-facing application service is exploitation of a public-facing application; corpus-confirmed candidate for this vector."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.001",
            "attributes": {
                "justification": "SQL injection that pivots to executing or abusing SQL stored procedures on the backend store maps to SQL Stored Procedures (T1505.001); corpus-confirmed candidate for this injection vector."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    input.dynamic_query_string_concatenation == true
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    not input.parameterized_queries_used
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    input.user_input_in_shell_command_string == true
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    not input.os_commands_avoided_or_arg_array_used
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    input.validation_is_client_side_only == true
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    not input.server_side_allowlist_validation
}

injection_sqli_nosqli_os_command_ldap[_injection_sqli_nosqli_os_command_ldap_def] if {
    input.denylist_filtering_used == true
}

exposures contains _injection_sqli_nosqli_os_command_ldap_def if {
    count(injection_sqli_nosqli_os_command_ldap) > 0
}

_server_side_request_forgery_ssrf_def := {
    "name": "Server-side request forgery (SSRF)",
    "description": "User-influenced outbound fetch is steered at internal services or the cloud metadata endpoint (169.254.169.254) to harvest workload credentials or pivot into the internal network when destinations are not allow-listed and private/link-local targets blocked.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.005",
            "attributes": {
                "justification": "SSRF against 169.254.169.254 harvests cloud workload credentials via the instance metadata API."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Server-side request forgery in a public-facing application service is exploited to reach internal services and pivot."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

server_side_request_forgery_ssrf[_server_side_request_forgery_ssrf_def] if {
    not input.outbound_fetch_destination_allowlisted
}

server_side_request_forgery_ssrf[_server_side_request_forgery_ssrf_def] if {
    not input.private_and_metadata_targets_blocked
}

server_side_request_forgery_ssrf[_server_side_request_forgery_ssrf_def] if {
    not input.cloud_metadata_endpoint_blocked
}

exposures contains _server_side_request_forgery_ssrf_def if {
    count(server_side_request_forgery_ssrf) > 0
}

_insecure_deserialization_rce_def := {
    "name": "Insecure deserialization & RCE",
    "description": "Native deserialization of attacker-controlled bytes (Java readObject, Python pickle, unsafe YAML/PHP unserialize) triggers gadget chains leading to remote code execution in the business-logic tier.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Insecure deserialization of attacker-controlled bytes is exploited against the public-facing business-logic service to gain code execution (Exploit Public-Facing Application)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059",
            "attributes": {
                "justification": "A deserialization gadget chain culminates in arbitrary command/script execution in the application tier (Command and Scripting Interpreter)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

insecure_deserialization_rce[_insecure_deserialization_rce_def] if {
    input.native_deserialization_of_untrusted_data == true
}

insecure_deserialization_rce[_insecure_deserialization_rce_def] if {
    not input.deserialization_class_allowlist_or_signed_payloads
}

exposures contains _insecure_deserialization_rce_def if {
    count(insecure_deserialization_rce) > 0
}

_cross_site_scripting_xss_missing_output_encoding_def := {
    "name": "Cross-site scripting (XSS) / missing output encoding",
    "description": "Untrusted data reflected/stored without contextual output encoding (raw-HTML escape-hatches, no CSP/nosniff headers) executes attacker script in victim browsers, enabling session theft and action-on-behalf-of-user.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.007",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cross_site_scripting_xss_missing_output_encoding[_cross_site_scripting_xss_missing_output_encoding_def] if {
    not input.contextual_output_encoding_applied
}

cross_site_scripting_xss_missing_output_encoding[_cross_site_scripting_xss_missing_output_encoding_def] if {
    input.unsafe_html_sinks_used == true
}

cross_site_scripting_xss_missing_output_encoding[_cross_site_scripting_xss_missing_output_encoding_def] if {
    not input.content_security_policy_enforced
}

cross_site_scripting_xss_missing_output_encoding[_cross_site_scripting_xss_missing_output_encoding_def] if {
    input.csp_allows_unsafe_inline_or_eval == true
}

exposures contains _cross_site_scripting_xss_missing_output_encoding_def if {
    count(cross_site_scripting_xss_missing_output_encoding) > 0
}

_broken_authentication_session_hijacking_weak_jwt_validation_def := {
    "name": "Broken authentication / session hijacking & weak JWT validation",
    "description": "Unauthenticated forced-browsing to privileged routes, weak session-cookie flags (missing Secure/HttpOnly/SameSite), non-rotated session ids, sessions not invalidated on logout, or trusting the token-declared alg (alg=none / RS256->HS256 key confusion) enable session fixation/hijacking and token forgery.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.authn_enforced_on_every_endpoint
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.jwt_signature_verified
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    input.accepts_alg_none == true
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    input.rs256_to_hs256_confusion_possible == true
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.cookie_secure_flag
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.cookie_httponly_flag
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.samesite_attribute_set
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.session_id_regenerated_on_auth
}

broken_authentication_session_hijacking_weak_jwt_validation[_broken_authentication_session_hijacking_weak_jwt_validation_def] if {
    not input.server_side_revocation_supported
}

exposures contains _broken_authentication_session_hijacking_weak_jwt_validation_def if {
    count(broken_authentication_session_hijacking_weak_jwt_validation) > 0
}

_hardcoded_leaked_secrets_over_privileged_service_identity_def := {
    "name": "Hardcoded / leaked secrets & over-privileged service identity",
    "description": "Credentials/keys committed to source/config/IaC or written to logs are harvested and reused against downstream stores; a shared superuser/root workload identity (no least-privilege scoping) turns any foothold into broad downstream compromise. Cleartext or skip-verify downstream TLS compounds the exposure.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Credentials In Files: secrets hardcoded in source/config/IaC are harvested from the repo/artifact."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Unsecured Credentials: cleartext/skip-verify downstream TLS and unmasked logs expose reusable credentials."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Valid Accounts: a shared superuser/root workload identity is reused as a valid account for broad downstream compromise."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

hardcoded_leaked_secrets_over_privileged_service_identity[_hardcoded_leaked_secrets_over_privileged_service_identity_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

hardcoded_leaked_secrets_over_privileged_service_identity[_hardcoded_leaked_secrets_over_privileged_service_identity_def] if {
    input.least_privilege_service_identity == "shared_admin_or_root"
}

hardcoded_leaked_secrets_over_privileged_service_identity[_hardcoded_leaked_secrets_over_privileged_service_identity_def] if {
    input.downstream_tls_enforced_and_validated == "plaintext_or_skip_verify"
}

exposures contains _hardcoded_leaked_secrets_over_privileged_service_identity_def if {
    count(hardcoded_leaked_secrets_over_privileged_service_identity) > 0
}

_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def := {
    "name": "Security misconfiguration \u2014 verbose errors, debug, defaults & unpatched components",
    "description": "Production stack traces/debug pages leak internals (paths, queries, versions), default accounts and unnecessary features remain enabled, and known-vulnerable/unsupported dependencies (direct + nested) go un-inventoried and unpatched \u2014 each a ready exploit path. A05:2021 + A06:2021.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "Verbose errors, default accounts, unnecessary services, and unpatched/known-vulnerable components on a network-reachable application service are directly exploited via Exploit Public-Facing Application."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "attributes": {
                "justification": "Un-inventoried/unscanned vulnerable dependencies and unverified artifact provenance enable Compromise Software Dependencies and Development Tools (A06:2021 supply-chain exposure)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.debug_and_verbose_errors_disabled_in_prod
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.default_accounts_removed_or_changed
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.unnecessary_services_disabled
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.hardened_baseline_documented
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.dependency_vulnerability_scanning_enabled
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    input.known_vulnerable_dependencies_present == true
}

security_misconfiguration_verbose_errors_debug_defaults_unpatched_components[_security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def] if {
    not input.artifact_supply_chain_signed_provenance_verified
}

exposures contains _security_misconfiguration_verbose_errors_debug_defaults_unpatched_components_def if {
    count(security_misconfiguration_verbose_errors_debug_defaults_unpatched_components) > 0
}
