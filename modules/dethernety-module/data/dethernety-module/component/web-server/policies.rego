package _dt_built_in.exposures.web_server

_weak_tls_protocol_version_def := {
    "name": "Weak Tls Protocol Version",
    "description": "Server configured to accept deprecated TLS versions (SSLv3, TLS 1.0, TLS 1.1) or weak cipher suites, enabling protocol downgrade attacks or cipher-based decryption of traffic.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Weak TLS protocol versions enable downgrade attacks where an attacker forces the use of older, weaker protocol versions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Using weak TLS protocol versions directly weakens the encryption protecting communications."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    "SSLv3" in input.accepted_tls_versions
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    "TLSv1.0" in input.accepted_tls_versions
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    "TLSv1.1" in input.accepted_tls_versions
}

weak_tls_protocol_version[_weak_tls_protocol_version_def] if {
    input.weak_cipher_suites_enabled == true
}

exposures contains _weak_tls_protocol_version_def if {
    count(weak_tls_protocol_version) > 0
}

_missing_or_invalid_tls_certificate_def := {
    "name": "Missing Or Invalid Tls Certificate",
    "description": "Server using a self-signed, expired, or domain-mismatched TLS certificate, undermining client trust validation and enabling undetected impersonation or interception.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1596.003",
            "name": "Digital Certificates",
            "relevance": "Adversaries can exploit missing or invalid TLS certificates to gather reconnaissance or conduct man-in-the-middle attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1587.003",
            "name": "Digital Certificates",
            "relevance": "Attackers may forge or obtain fraudulent certificates to impersonate servers with missing or invalid certificates."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_or_invalid_tls_certificate[_missing_or_invalid_tls_certificate_def] if {
    not input.tls_configured
}

missing_or_invalid_tls_certificate[_missing_or_invalid_tls_certificate_def] if {
    input.tls_configured == true
    input.certificate_authority_type == "self_signed"
}

missing_or_invalid_tls_certificate[_missing_or_invalid_tls_certificate_def] if {
    input.tls_configured == true
    input.certificate_expired == true
}

missing_or_invalid_tls_certificate[_missing_or_invalid_tls_certificate_def] if {
    input.tls_configured == true
    not input.certificate_domain_match
}

exposures contains _missing_or_invalid_tls_certificate_def if {
    count(missing_or_invalid_tls_certificate) > 0
}

_http_plaintext_enabled_def := {
    "name": "Http Plaintext Enabled",
    "description": "Server accepts unencrypted HTTP on port 80 without redirecting to HTTPS, exposing credentials and session tokens to interception on the network path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "name": "Network Sniffing",
            "relevance": "Plaintext HTTP traffic can be intercepted via network sniffing, exposing all transmitted data to attackers."
        }
    ],
    "attack_vector": "NETWORK"
}

http_plaintext_enabled[_http_plaintext_enabled_def] if {
    input.http_port_open == true
    not input.http_to_https_redirect_enabled
}

http_plaintext_enabled[_http_plaintext_enabled_def] if {
    input.http_port_open == true
    input.http_to_https_redirect_enabled == true
    not input.hsts_enabled
}

exposures contains _http_plaintext_enabled_def if {
    count(http_plaintext_enabled) > 0
}

_server_version_disclosure_def := {
    "name": "Server Version Disclosure",
    "description": "Server headers (e.g., Server:, X-Powered-By:) expose software name and version, providing reconnaissance data that aids targeted exploit selection.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1082",
            "name": "System Information Discovery",
            "relevance": "Server version disclosure allows attackers to gather system information to identify vulnerabilities in specific software versions."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1592.002",
            "name": "Software",
            "relevance": "Disclosed server version information enables adversaries to gather victim host software details for targeted exploitation."
        }
    ],
    "attack_vector": "NETWORK"
}

server_version_disclosure[_server_version_disclosure_def] if {
    input.server_header_disclosure == true
}

server_version_disclosure[_server_version_disclosure_def] if {
    input.x_powered_by_header_disclosure == true
}

exposures contains _server_version_disclosure_def if {
    count(server_version_disclosure) > 0
}

_directory_listing_enabled_def := {
    "name": "Directory Listing Enabled",
    "description": "Auto-index or directory listing is enabled, allowing unauthenticated clients to enumerate file and directory structures not intended for public access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1083",
            "name": "File and Directory Discovery",
            "relevance": "Enabled directory listing allows attackers to enumerate files and directories on the web server."
        }
    ],
    "attack_vector": "NETWORK"
}

directory_listing_enabled[_directory_listing_enabled_def] if {
    input.directory_listing_enabled == true
    input.publicly_accessible == true
    not input.authentication_required
}

directory_listing_enabled[_directory_listing_enabled_def] if {
    input.directory_listing_enabled == true
    input.publicly_accessible == true
    input.authentication_required == true
}

exposures contains _directory_listing_enabled_def if {
    count(directory_listing_enabled) > 0
}

_missing_security_response_headers_def := {
    "name": "Missing Security Response Headers",
    "description": "Security-relevant HTTP response headers (HSTS, X-Content-Type-Options, X-Frame-Options, Content-Security-Policy, Referrer-Policy) absent or misconfigured, reducing client-side enforcement of security policies.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1185",
            "name": "Browser Session Hijacking",
            "relevance": "Missing security headers (e.g., missing HttpOnly or secure flags) can enable browser session hijacking attacks."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027.006",
            "name": "HTML Smuggling",
            "relevance": "Absence of security headers like Content-Security-Policy facilitates HTML smuggling and cross-site scripting attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not "Strict-Transport-Security" in input.present_security_headers
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not "X-Content-Type-Options" in input.present_security_headers
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not "X-Frame-Options" in input.present_security_headers
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not "Referrer-Policy" in input.present_security_headers
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    not input.csp_policy_configured
}

missing_security_response_headers[_missing_security_response_headers_def] if {
    input.hsts_max_age_seconds < 31536000
}

exposures contains _missing_security_response_headers_def if {
    count(missing_security_response_headers) > 0
}

_unrestricted_http_methods_def := {
    "name": "Unrestricted Http Methods",
    "description": "Server permits dangerous HTTP methods (PUT, DELETE, TRACE, CONNECT) on endpoints that should not expose them, enabling unauthorized file writes, cache poisoning, or cross-site tracing.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "name": "Web Protocols",
            "relevance": "Unrestricted HTTP methods allow attackers to leverage web protocols for unauthorized actions such as PUT or DELETE operations."
        }
    ],
    "attack_vector": "NETWORK"
}

unrestricted_http_methods[_unrestricted_http_methods_def] if {
    "PUT" in input.allowed_http_methods
    input.endpoint_is_static_or_readonly == true
}

unrestricted_http_methods[_unrestricted_http_methods_def] if {
    "DELETE" in input.allowed_http_methods
    input.endpoint_is_static_or_readonly == true
}

unrestricted_http_methods[_unrestricted_http_methods_def] if {
    "TRACE" in input.allowed_http_methods
    input.trace_method_response_reflects_headers == true
}

unrestricted_http_methods[_unrestricted_http_methods_def] if {
    "CONNECT" in input.allowed_http_methods
}

exposures contains _unrestricted_http_methods_def if {
    count(unrestricted_http_methods) > 0
}

_privileged_process_execution_def := {
    "name": "Privileged Process Execution",
    "description": "Web server process runs as root or a highly privileged OS account rather than a dedicated low-privilege service account, expanding blast radius if the process is compromised.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "name": "Exploitation for Privilege Escalation",
            "relevance": "Processes running with excessive privileges can be exploited for privilege escalation to gain higher-level access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1543",
            "name": "Create or Modify System Process",
            "relevance": "Privileged process execution may involve creating or modifying system processes to maintain elevated access."
        }
    ],
    "attack_vector": "LOCAL"
}

privileged_process_execution[_privileged_process_execution_def] if {
    input.process_run_uid == 0
}

privileged_process_execution[_privileged_process_execution_def] if {
    input.process_run_user == "root"
}

privileged_process_execution[_privileged_process_execution_def] if {
    not input.dedicated_service_account_configured
    input.process_run_uid < 100
}

exposures contains _privileged_process_execution_def if {
    count(privileged_process_execution) > 0
}

_web_root_permission_misconfiguration_def := {
    "name": "Web Root Permission Misconfiguration",
    "description": "Document root or configuration directories have overly permissive filesystem permissions, allowing unauthorized local users or compromised processes to modify served content or configuration files.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "name": "File and Directory Permissions Modification",
            "relevance": "Misconfigured web root permissions directly relate to improper file and directory permission settings that can be exploited."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1574.010",
            "name": "Services File Permissions Weakness",
            "relevance": "Weak permissions on web root files can be exploited similarly to services file permission weaknesses for unauthorized access."
        }
    ],
    "attack_vector": "LOCAL"
}

web_root_permission_misconfiguration[_web_root_permission_misconfiguration_def] if {
    input.web_root_world_writable == true
}

web_root_permission_misconfiguration[_web_root_permission_misconfiguration_def] if {
    input.config_dir_permissions_octal in ["755", "757", "775", "777", "776", "766", "756", "774", "773", "772", "771", "770", "767", "765", "764", "763", "762", "761", "760"]
}

web_root_permission_misconfiguration[_web_root_permission_misconfiguration_def] if {
    input.web_root_owner == "root"
    input.web_root_world_writable == true
}

exposures contains _web_root_permission_misconfiguration_def if {
    count(web_root_permission_misconfiguration) > 0
}

_insufficient_access_logging_def := {
    "name": "Insufficient Access Logging",
    "description": "Access and error logging is disabled, not capturing client IP, request URI, response codes, or timestamps, preventing forensic analysis and intrusion detection.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "name": "Disable or Modify Cloud Logs",
            "relevance": "Insufficient access logging mirrors the impact of disabled or modified logs, leaving attacker activity undetected."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.006",
            "name": "Indicator Blocking",
            "relevance": "Insufficient logging effectively blocks security indicators from being captured, aiding attacker evasion."
        }
    ],
    "attack_vector": "LOCAL"
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    not input.access_logging_enabled
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "client_ip" in input.log_fields_captured
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "request_uri" in input.log_fields_captured
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "response_code" in input.log_fields_captured
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    input.access_logging_enabled == true
    not "timestamp" in input.log_fields_captured
}

insufficient_access_logging[_insufficient_access_logging_def] if {
    not input.error_logging_enabled
}

exposures contains _insufficient_access_logging_def if {
    count(insufficient_access_logging) > 0
}

_log_injection_via_uncontrolled_log_format_def := {
    "name": "Log Injection Via Uncontrolled Log Format",
    "description": "Server logs user-supplied input (e.g., User-Agent, URI) without sanitization into log files, enabling log tampering or log-parsing attacks that obscure attacker activity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070.002",
            "name": "Clear Linux or Mac System Logs",
            "relevance": "Log injection via uncontrolled format strings can be used to tamper with or corrupt log entries, similar to clearing logs."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1027",
            "name": "Obfuscated Files or Information",
            "relevance": "Attackers can inject obfuscated or misleading entries into logs to hide malicious activity through uncontrolled log formats."
        }
    ],
    "attack_vector": "NETWORK"
}

log_injection_via_uncontrolled_log_format[_log_injection_via_uncontrolled_log_format_def] if {
    not input.log_input_sanitization_enabled
    count(input.logged_user_supplied_fields) > 0
}

exposures contains _log_injection_via_uncontrolled_log_format_def if {
    count(log_injection_via_uncontrolled_log_format) > 0
}

_unpatched_server_software_def := {
    "name": "Unpatched Server Software",
    "description": "Web server binary or bundled modules running a version with known CVEs due to absent or delayed patching process, directly exposing known remote exploitation paths.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Unpatched server software exposes known vulnerabilities that attackers can exploit in public-facing applications."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1588.005",
            "name": "Exploits",
            "relevance": "Attackers obtain or use existing exploits specifically targeting unpatched server software vulnerabilities."
        }
    ],
    "attack_vector": "NETWORK"
}

unpatched_server_software[_unpatched_server_software_def] if {
    input.version_has_known_cve == true
    input.days_since_patch_available > 30
}

unpatched_server_software[_unpatched_server_software_def] if {
    input.version_has_known_cve == true
    input.days_since_patch_available >= 1
}

exposures contains _unpatched_server_software_def if {
    count(unpatched_server_software) > 0
}

_absent_rate_limiting_and_request_throttling_def := {
    "name": "Absent Rate Limiting And Request Throttling",
    "description": "No rate limiting, connection throttling, or request size caps configured at the server level, enabling resource exhaustion via high-volume request floods or oversized body uploads.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "name": "Application Exhaustion Flood",
            "relevance": "Without rate limiting, servers are vulnerable to application exhaustion flood attacks that overwhelm application resources."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1498.002",
            "name": "Reflection Amplification",
            "relevance": "Absent request throttling enables reflection amplification attacks by allowing unlimited requests to be processed."
        }
    ],
    "attack_vector": "NETWORK"
}

absent_rate_limiting_and_request_throttling[_absent_rate_limiting_and_request_throttling_def] if {
    not input.rate_limiting_enabled
}

absent_rate_limiting_and_request_throttling[_absent_rate_limiting_and_request_throttling_def] if {
    not input.connection_throttling_enabled
}

absent_rate_limiting_and_request_throttling[_absent_rate_limiting_and_request_throttling_def] if {
    input.max_request_body_size_bytes <= 0
}

exposures contains _absent_rate_limiting_and_request_throttling_def if {
    count(absent_rate_limiting_and_request_throttling) > 0
}

_default_or_sample_content_present_def := {
    "name": "Default Or Sample Content Present",
    "description": "Default welcome pages, sample scripts, or test endpoints shipped with the server software remain enabled, disclosing software identity and potentially providing exploitable entry points.",
    "type": "insecure_default",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.001",
            "name": "Default Accounts",
            "relevance": "Default or sample content often includes default credentials that attackers can exploit to gain unauthorized access."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "name": "Exploit Public-Facing Application",
            "relevance": "Default and sample content often contain known vulnerabilities that can be directly exploited in public-facing applications."
        }
    ],
    "attack_vector": "NETWORK"
}

default_or_sample_content_present[_default_or_sample_content_present_def] if {
    input.default_welcome_page_active == true
}

default_or_sample_content_present[_default_or_sample_content_present_def] if {
    input.sample_scripts_accessible == true
}

exposures contains _default_or_sample_content_present_def if {
    count(default_or_sample_content_present) > 0
}

_misconfigured_virtual_host_isolation_def := {
    "name": "Misconfigured Virtual Host Isolation",
    "description": "Multiple virtual hosts share the same document root or lack chroot/namespace isolation, allowing a request targeting one vhost to access or traverse content belonging to another.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "name": "Escape to Host",
            "relevance": "Misconfigured virtual host isolation can allow attackers to escape from one virtual host context to access other hosts or the underlying system."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1090.004",
            "name": "Domain Fronting",
            "relevance": "Misconfigured virtual host isolation can be abused similarly to domain fronting to access unintended hosts or bypass controls."
        }
    ],
    "attack_vector": "NETWORK"
}

misconfigured_virtual_host_isolation[_misconfigured_virtual_host_isolation_def] if {
    input.vhosts_share_document_root == true
}

misconfigured_virtual_host_isolation[_misconfigured_virtual_host_isolation_def] if {
    not input.chroot_or_namespace_isolation_enabled
    not input.path_traversal_controls_enabled
}

exposures contains _misconfigured_virtual_host_isolation_def if {
    count(misconfigured_virtual_host_isolation) > 0
}

_private_key_file_exposure_def := {
    "name": "Private Key File Exposure",
    "description": "TLS private key files stored within the web document root or with world-readable permissions, enabling retrieval via HTTP request or local filesystem access.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.004",
            "name": "Private Keys",
            "relevance": "Exposed private key files directly enable attackers to steal private keys for decryption or impersonation."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "name": "Unsecured Credentials",
            "relevance": "Private key file exposure represents a form of unsecured credentials that attackers can harvest for further attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

private_key_file_exposure[_private_key_file_exposure_def] if {
    input.key_file_in_document_root == true
}

private_key_file_exposure[_private_key_file_exposure_def] if {
    input.key_file_world_readable == true
}

exposures contains _private_key_file_exposure_def if {
    count(private_key_file_exposure) > 0
}
