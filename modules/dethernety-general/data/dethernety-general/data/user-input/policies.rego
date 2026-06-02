package _dt_built_in.exposures.user_input



_missing_server_side_allowlist_input_validation_def := {
    "name": "Missing server-side allow-list input validation",
    "description": "Untrusted input is not validated server-side against an allow-list (syntactic format/length/charset plus semantic business-range) at the trust boundary \u2014 relying on bypassable deny-lists or client-side-only checks. The cross-cutting root cause that lets hostile data reach every downstream interpreter (OWASP Input Validation; A03:2021).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

missing_server_side_allowlist_input_validation[_missing_server_side_allowlist_input_validation_def] if {
    not input.server_side_allowlist_validation
}

missing_server_side_allowlist_input_validation[_missing_server_side_allowlist_input_validation_def] if {
    input.validation_is_client_side_only == true
}

missing_server_side_allowlist_input_validation[_missing_server_side_allowlist_input_validation_def] if {
    input.denylist_filtering_used == true
}

exposures contains _missing_server_side_allowlist_input_validation_def if {
    count(missing_server_side_allowlist_input_validation) > 0
}

_sql_nosql_ldap_injection_def := {
    "name": "SQL / NoSQL / LDAP injection",
    "description": "User input concatenated into SQL, NoSQL, LDAP, or XPath queries instead of being bound via parameterized/prepared statements lets an attacker alter query structure to read, modify, or delete data and bypass authentication. Blast radius widened by an over-privileged DB account (OWASP SQLi Prevention; A03:2021).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

sql_nosql_ldap_injection[_sql_nosql_ldap_injection_def] if {
    not input.parameterized_queries_used
}

sql_nosql_ldap_injection[_sql_nosql_ldap_injection_def] if {
    input.dynamic_query_string_concatenation == true
}

sql_nosql_ldap_injection[_sql_nosql_ldap_injection_def] if {
    not input.server_side_allowlist_validation
    not input.least_privilege_db_account
}

exposures contains _sql_nosql_ldap_injection_def if {
    count(sql_nosql_ldap_injection) > 0
}

_cross_site_scripting_reflected_stored_dom_def := {
    "name": "Cross-site scripting (reflected / stored / DOM)",
    "description": "Untrusted data rendered into a response without context-aware output encoding injects script into victim browsers, enabling session theft, credential capture, and UI redress. Unsafe sinks (innerHTML, eval, dangerouslySetInnerHTML) and missing CSP defense-in-depth compound the risk (OWASP XSS Prevention; OWASP Secure Headers).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059.007"
        }
    ],
    "attack_vector": "NETWORK"
}

cross_site_scripting_reflected_stored_dom[_cross_site_scripting_reflected_stored_dom_def] if {
    not input.contextual_output_encoding_applied
}

cross_site_scripting_reflected_stored_dom[_cross_site_scripting_reflected_stored_dom_def] if {
    input.unsafe_html_sinks_used == true
}

cross_site_scripting_reflected_stored_dom[_cross_site_scripting_reflected_stored_dom_def] if {
    not input.content_security_policy_enforced
}

exposures contains _cross_site_scripting_reflected_stored_dom_def if {
    count(cross_site_scripting_reflected_stored_dom) > 0
}

_os_command_injection_def := {
    "name": "OS command injection",
    "description": "User input concatenated into a shell command string (system(), shell=True, Runtime.exec) executes arbitrary OS commands on the host. Prevented by native library calls or argument-array process invocation with no shell and allow-listed commands (OWASP OS Command Injection Defense; A03:2021).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1059"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

os_command_injection[_os_command_injection_def] if {
    input.user_input_in_shell_command_string == true
}

os_command_injection[_os_command_injection_def] if {
    not input.os_commands_avoided_or_arg_array_used
}

exposures contains _os_command_injection_def if {
    count(os_command_injection) > 0
}

_insecure_deserialization_of_untrusted_data_def := {
    "name": "Insecure deserialization of untrusted data",
    "description": "Native/binary deserialization of attacker-controlled objects (Java ObjectInputStream/XMLDecoder, Python pickle/yaml.load, PHP unserialize, .NET BinaryFormatter/TypeNameHandling) triggers gadget chains to remote code execution. Mitigated by pure-data formats, class allow-listing, and signed-then-verified payloads (OWASP Deserialization).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

insecure_deserialization_of_untrusted_data[_insecure_deserialization_of_untrusted_data_def] if {
    input.native_deserialization_of_untrusted_data == true
}

insecure_deserialization_of_untrusted_data[_insecure_deserialization_of_untrusted_data_def] if {
    not input.deserialization_class_allowlist_or_signed_payloads
}

exposures contains _insecure_deserialization_of_untrusted_data_def if {
    count(insecure_deserialization_of_untrusted_data) > 0
}

_xxe_and_entity_expansion_dos_def := {
    "name": "XXE and entity-expansion DoS",
    "description": "An unhardened XML parser fed untrusted XML resolves external entities to disclose local files, perform SSRF, or exfiltrate data (XXE), and unbounded nested entity expansion exhausts memory/CPU (billion-laughs). Prevented by disabling DOCTYPE/external entities, secure-processing limits, and defusedxml (OWASP XXE Prevention).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499"
        }
    ],
    "attack_vector": "NETWORK"
}

xxe_and_entity_expansion_dos[_xxe_and_entity_expansion_dos_def] if {
    not input.xml_external_entities_disabled
}

xxe_and_entity_expansion_dos[_xxe_and_entity_expansion_dos_def] if {
    not input.entity_expansion_limits_enforced
}

exposures contains _xxe_and_entity_expansion_dos_def if {
    count(xxe_and_entity_expansion_dos) > 0
}

_path_traversal_and_ssrf_from_un_allowlisted_destinations_def := {
    "name": "Path traversal and SSRF from un-allow-listed destinations",
    "description": "User-controlled file paths used without canonicalisation/base-directory containment escape via ../ to read or write arbitrary files (LFI), and raw user-supplied URLs fetched server-side reach internal services or cloud metadata (169.254.169.254) as SSRF. Prevented by server-defined paths and host/scheme allow-lists that block private and link-local ranges (OWASP SSRF Prevention; Input Validation).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.005"
        }
    ],
    "attack_vector": "NETWORK"
}

path_traversal_and_ssrf_from_un_allowlisted_destinations[_path_traversal_and_ssrf_from_un_allowlisted_destinations_def] if {
    not input.file_paths_canonicalized_and_contained
}

path_traversal_and_ssrf_from_un_allowlisted_destinations[_path_traversal_and_ssrf_from_un_allowlisted_destinations_def] if {
    not input.outbound_fetch_destination_allowlisted
}

path_traversal_and_ssrf_from_un_allowlisted_destinations[_path_traversal_and_ssrf_from_un_allowlisted_destinations_def] if {
    not input.private_and_metadata_targets_blocked
}

exposures contains _path_traversal_and_ssrf_from_un_allowlisted_destinations_def if {
    count(path_traversal_and_ssrf_from_un_allowlisted_destinations) > 0
}

_unrestricted_file_upload_web_shell_def := {
    "name": "Unrestricted file upload (web shell)",
    "description": "Uploads validated only by deny-list extension or trusted client Content-Type, stored under their original name in an executable webroot directory, let an attacker plant a web shell for code execution. Prevented by extension allow-list plus magic-byte inspection, random renaming, and non-executable storage outside the webroot (OWASP File Upload).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1505.003"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_file_upload_web_shell[_unrestricted_file_upload_web_shell_def] if {
    not input.upload_extension_allowlist_and_magic_byte_validation
}

unrestricted_file_upload_web_shell[_unrestricted_file_upload_web_shell_def] if {
    not input.uploads_stored_nonexecutable_outside_webroot
}

unrestricted_file_upload_web_shell[_unrestricted_file_upload_web_shell_def] if {
    not input.uploads_randomly_renamed
}

exposures contains _unrestricted_file_upload_web_shell_def if {
    count(unrestricted_file_upload_web_shell) > 0
}

_oversized_complex_payload_dos_and_mass_assignment_def := {
    "name": "Oversized/complex-payload DoS and mass assignment",
    "description": "Missing size/complexity guards allow oversized bodies, decompression bombs, and catastrophic-backtracking regexes (ReDoS) to exhaust resources, while auto-binding request params onto domain objects with no bindable-field allow-list lets an attacker over-post sensitive fields (e.g. isAdmin=true) for privilege escalation. Prevented by enforced size/quantifier limits and DTO/allow-list binding (OWASP Mass Assignment; Input Validation).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003"
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190"
        }
    ],
    "attack_vector": "NETWORK"
}

oversized_complex_payload_dos_and_mass_assignment[_oversized_complex_payload_dos_and_mass_assignment_def] if {
    not input.request_size_and_complexity_limits_enforced
}

oversized_complex_payload_dos_and_mass_assignment[_oversized_complex_payload_dos_and_mass_assignment_def] if {
    not input.redos_safe_regexes
}

oversized_complex_payload_dos_and_mass_assignment[_oversized_complex_payload_dos_and_mass_assignment_def] if {
    not input.bindable_field_allowlist_enforced
}

exposures contains _oversized_complex_payload_dos_and_mass_assignment_def if {
    count(oversized_complex_payload_dos_and_mass_assignment) > 0
}
