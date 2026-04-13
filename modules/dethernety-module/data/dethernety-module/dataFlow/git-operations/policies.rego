package _dt_built_in.exposures.git_operations

_plaintext_git_protocol_exposure_def := {
    "name": "Plaintext Git Protocol Exposure",
    "description": "Use of unencrypted git:// or http:// transport protocols exposes full repository content, commit history, and any inadvertently embedded credentials to passive interception on the network path between developer workstations and remote repository hosts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Plaintext git protocol exposes repository data in transit, enabling unauthorized access to code repositories."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Unencrypted git protocol can be intercepted to exfiltrate source code over an alternative, insecure protocol channel."
        }
    ],
    "attack_vector": "NETWORK"
}

plaintext_git_protocol_exposure[_plaintext_git_protocol_exposure_def] if {
    "git" in input.configured_remote_protocols
}

plaintext_git_protocol_exposure[_plaintext_git_protocol_exposure_def] if {
    "http" in input.configured_remote_protocols
}

plaintext_git_protocol_exposure[_plaintext_git_protocol_exposure_def] if {
    not input.plaintext_protocol_enforcement_blocked
    "git" in input.configured_remote_protocols
}

plaintext_git_protocol_exposure[_plaintext_git_protocol_exposure_def] if {
    not input.plaintext_protocol_enforcement_blocked
    "http" in input.configured_remote_protocols
}

exposures contains _plaintext_git_protocol_exposure_def if {
    count(plaintext_git_protocol_exposure) > 0
}

_tls_downgrade_attack_on_git_https_def := {
    "name": "Tls Downgrade Attack On Git Https",
    "description": "Absence of enforced minimum TLS version (e.g., TLS 1.2+) on HTTPS git endpoints allows an active man-in-the-middle to negotiate legacy TLS 1.0/1.1 or SSLv3, exposing traffic to known cipher-suite attacks such as BEAST or POODLE during push and fetch operations.",
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
            "relevance": "Directly describes forcing a connection to use a weaker TLS version, which is the core concern of this vector."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "A TLS downgrade attack typically requires an adversary-in-the-middle position to intercept and manipulate the TLS handshake."
        }
    ],
    "attack_vector": "NETWORK"
}

tls_downgrade_attack_on_git_https[_tls_downgrade_attack_on_git_https_def] if {
    not input.tls_version_enforcement_configured
}

tls_downgrade_attack_on_git_https[_tls_downgrade_attack_on_git_https_def] if {
    input.tls_version_enforcement_configured == true
    input.minimum_tls_version_enforced == "SSLv3"
}

tls_downgrade_attack_on_git_https[_tls_downgrade_attack_on_git_https_def] if {
    input.tls_version_enforcement_configured == true
    input.minimum_tls_version_enforced == "TLS_1_0"
}

tls_downgrade_attack_on_git_https[_tls_downgrade_attack_on_git_https_def] if {
    input.tls_version_enforcement_configured == true
    input.minimum_tls_version_enforced == "TLS_1_1"
}

exposures contains _tls_downgrade_attack_on_git_https_def if {
    count(tls_downgrade_attack_on_git_https) > 0
}

_unauthenticated_webhook_delivery_def := {
    "name": "Unauthenticated Webhook Delivery",
    "description": "Webhook payloads delivered from repository hosts to CI/CD pipeline engines without HMAC signature validation or shared-secret verification allow an attacker to forge or replay webhook events, triggering unauthorized build jobs that inject malicious pipeline steps into the software supply chain.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.004",
            "name": "Exfiltration Over Webhook",
            "relevance": "Unauthenticated webhook delivery can be abused to receive or exfiltrate data without proper identity verification."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Unauthenticated webhooks in CI/CD pipelines can allow attackers to inject malicious events into development toolchains."
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_webhook_delivery[_unauthenticated_webhook_delivery_def] if {
    not input.hmac_signature_validation_enabled
    not input.shared_secret_configured
}

unauthenticated_webhook_delivery[_unauthenticated_webhook_delivery_def] if {
    input.shared_secret_configured == true
    not input.hmac_signature_validation_enabled
    not input.webhook_source_ip_allowlist_enforced
}

unauthenticated_webhook_delivery[_unauthenticated_webhook_delivery_def] if {
    not input.hmac_signature_validation_enabled
    not input.webhook_source_ip_allowlist_enforced
}

exposures contains _unauthenticated_webhook_delivery_def if {
    count(unauthenticated_webhook_delivery) > 0
}

_missing_mutual_tls_on_ci_repository_connection_def := {
    "name": "Missing Mutual Tls On Ci Repository Connection",
    "description": "CI/CD pipeline engines authenticate to repository hosts using only server-side TLS without client certificate validation, permitting an attacker who compromises network routing to impersonate the pipeline client and replay captured authentication tokens or SSH keys to exfiltrate repository contents.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1649",
            "name": "Steal or Forge Authentication Certificates",
            "relevance": "Absence of mutual TLS means certificates are not required for both sides, enabling forged or stolen certificates to impersonate legitimate endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Without mutual TLS, an attacker can intercept CI-to-repository traffic acting as a man-in-the-middle."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_mutual_tls_on_ci_repository_connection[_missing_mutual_tls_on_ci_repository_connection_def] if {
    input.configured_remote_protocols == "https"
    not input.mutual_tls_enabled
}

missing_mutual_tls_on_ci_repository_connection[_missing_mutual_tls_on_ci_repository_connection_def] if {
    input.configured_remote_protocols == "https"
    not input.client_certificate_path_configured
}

exposures contains _missing_mutual_tls_on_ci_repository_connection_def if {
    count(missing_mutual_tls_on_ci_repository_connection) > 0
}

_ssh_host_key_verification_bypass_def := {
    "name": "Ssh Host Key Verification Bypass",
    "description": "Git operations over SSH with StrictHostKeyChecking disabled or with no trusted known_hosts baseline allow an active network adversary to present a spoofed SSH host key, intercepting credentials and repository content during developer push and fetch operations without triggering client-side warnings.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1563.001",
            "name": "SSH Hijacking",
            "relevance": "Bypassing SSH host key verification allows an attacker to hijack SSH sessions by impersonating the legitimate server."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021.004",
            "name": "SSH",
            "relevance": "SSH host key verification bypass directly undermines the authentication mechanism of the SSH remote access protocol."
        }
    ],
    "attack_vector": "NETWORK"
}

ssh_host_key_verification_bypass[_ssh_host_key_verification_bypass_def] if {
    input.strict_host_key_checking in ["no", "off"]
    input.ssh_git_remote_urls_present == true
}

ssh_host_key_verification_bypass[_ssh_host_key_verification_bypass_def] if {
    input.strict_host_key_checking == "accept-new"
    not input.known_hosts_baseline_configured
    input.ssh_git_remote_urls_present == true
}

ssh_host_key_verification_bypass[_ssh_host_key_verification_bypass_def] if {
    not input.known_hosts_baseline_configured
    input.strict_host_key_checking in ["yes", "ask"]
    input.ssh_git_remote_urls_present == true
}

exposures contains _ssh_host_key_verification_bypass_def if {
    count(ssh_host_key_verification_bypass) > 0
}

_webhook_replay_without_timestamp_validation_def := {
    "name": "Webhook Replay Without Timestamp Validation",
    "description": "Webhook consumers that validate HMAC signatures but do not enforce delivery timestamp windows allow an attacker who captures a legitimate signed webhook payload to replay it arbitrarily, re-triggering pipeline builds with previously valid but stale event data.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "name": "Forge Web Credentials",
            "relevance": "Without timestamp validation, previously captured webhook payloads can be replayed as if they were freshly forged legitimate requests."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1497.003",
            "name": "Time Based Checks",
            "relevance": "Absence of timestamp validation is the failure of time-based checks that would otherwise prevent replay attacks."
        }
    ],
    "attack_vector": "NETWORK"
}

webhook_replay_without_timestamp_validation[_webhook_replay_without_timestamp_validation_def] if {
    input.hmac_signature_validation_enabled == true
    not input.timestamp_window_enforcement_enabled
}

webhook_replay_without_timestamp_validation[_webhook_replay_without_timestamp_validation_def] if {
    not input.hmac_signature_validation_enabled
    not input.timestamp_window_enforcement_enabled
}

exposures contains _webhook_replay_without_timestamp_validation_def if {
    count(webhook_replay_without_timestamp_validation) > 0
}

_commit_object_integrity_gap_in_transit_def := {
    "name": "Commit Object Integrity Gap In Transit",
    "description": "Absence of enforced GPG or SSH commit signing verification at the server receive-pack layer means that unsigned or improperly signed commits accepted over an otherwise encrypted transport lack object-level integrity guarantees, allowing a compromised intermediate proxy to alter commit content before it reaches the repository.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Tampering with commit objects in transit can compromise the integrity of software dependencies delivered through version control."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.006",
            "name": "Code Signing Policy Modification",
            "relevance": "Lack of commit integrity verification in transit mirrors weaknesses in code signing policies that allow unsigned or tampered code to pass."
        }
    ],
    "attack_vector": "NETWORK"
}

commit_object_integrity_gap_in_transit[_commit_object_integrity_gap_in_transit_def] if {
    not input.commit_signing_verification_enforced
}

commit_object_integrity_gap_in_transit[_commit_object_integrity_gap_in_transit_def] if {
    input.commit_signing_verification_enforced == true
    input.signing_verification_scope in ["none", "default_branch_only"]
}

exposures contains _commit_object_integrity_gap_in_transit_def if {
    count(commit_object_integrity_gap_in_transit) > 0
}

_weak_cipher_suite_negotiation_on_git_tls_def := {
    "name": "Weak Cipher Suite Negotiation On Git Tls",
    "description": "Repository servers or CI/CD consumers advertising export-grade, RC4, or NULL cipher suites alongside strong ciphers during TLS handshake allow a downgrade to weak encryption even when modern TLS versions are nominally enforced, reducing effective confidentiality of transmitted repository data.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600",
            "name": "Weaken Encryption",
            "relevance": "Negotiating weak cipher suites directly weakens the encryption protecting git traffic in transit."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1600.001",
            "name": "Reduce Key Space",
            "relevance": "Weak cipher suites typically involve reduced key spaces, making encrypted git traffic vulnerable to brute-force decryption."
        }
    ],
    "attack_vector": "NETWORK"
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    "RC4" in input.advertised_cipher_suites
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    "NULL" in input.advertised_cipher_suites
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    "EXPORT" in input.advertised_cipher_suites
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    "DES" in input.advertised_cipher_suites
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    "ADH" in input.advertised_cipher_suites
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    not input.tls_downgrade_protection_enabled
}

weak_cipher_suite_negotiation_on_git_tls[_weak_cipher_suite_negotiation_on_git_tls_def] if {
    input.minimum_tls_version_enforced in ["TLS1.0", "TLS1.1"]
}

exposures contains _weak_cipher_suite_negotiation_on_git_tls_def if {
    count(weak_cipher_suite_negotiation_on_git_tls) > 0
}

_git_lfs_transit_without_separate_authentication_def := {
    "name": "Git Lfs Transit Without Separate Authentication",
    "description": "Large File Storage (LFS) pointer resolution uses a separate HTTP transfer endpoint that may be served without the same authentication controls as the core git HTTPS transport, exposing binary assets (build artifacts, certificates, model files) to unauthenticated retrieval or injection by a network adversary who intercepts redirect responses.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1048",
            "name": "Exfiltration Over Alternative Protocol",
            "relevance": "Git LFS uses a separate HTTP-based protocol; without authentication, large files can be exfiltrated or injected over this alternative channel."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1187",
            "name": "Forced Authentication",
            "relevance": "Unauthenticated LFS endpoints can be abused to force authentication credential capture from clients connecting to a rogue LFS server."
        }
    ],
    "attack_vector": "NETWORK"
}

git_lfs_transit_without_separate_authentication[_git_lfs_transit_without_separate_authentication_def] if {
    not input.lfs_transfer_endpoint_auth_required
}

git_lfs_transit_without_separate_authentication[_git_lfs_transit_without_separate_authentication_def] if {
    input.lfs_transfer_protocol == "http"
}

git_lfs_transit_without_separate_authentication[_git_lfs_transit_without_separate_authentication_def] if {
    input.lfs_transfer_endpoint_auth_required == true
    not input.lfs_redirect_auth_forwarded
}

exposures contains _git_lfs_transit_without_separate_authentication_def if {
    count(git_lfs_transit_without_separate_authentication) > 0
}

_missing_hsts_on_repository_https_endpoint_def := {
    "name": "Missing Hsts On Repository Https Endpoint",
    "description": "Repository HTTPS endpoints that do not set HTTP Strict-Transport-Security headers with adequate max-age allow a network adversary to strip TLS on first contact or after expiry, redirecting developer tooling to a plaintext channel before a secure session is established.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "Without HSTS, browsers can be downgraded to HTTP, enabling adversary-in-the-middle attacks on repository HTTPS endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.010",
            "name": "Downgrade Attack",
            "relevance": "Missing HSTS allows protocol downgrade from HTTPS to HTTP, which is a classic downgrade attack vector."
        }
    ],
    "attack_vector": "NETWORK"
}

missing_hsts_on_repository_https_endpoint[_missing_hsts_on_repository_https_endpoint_def] if {
    input.https_endpoint_accessible == true
    not input.hsts_header_present
}

missing_hsts_on_repository_https_endpoint[_missing_hsts_on_repository_https_endpoint_def] if {
    input.https_endpoint_accessible == true
    input.hsts_header_present == true
    input.hsts_max_age_seconds < 31536000
}

exposures contains _missing_hsts_on_repository_https_endpoint_def if {
    count(missing_hsts_on_repository_https_endpoint) > 0
}

_webhook_fanout_ssrf_via_untrusted_target_urls_def := {
    "name": "Webhook Fanout Ssrf Via Untrusted Target Urls",
    "description": "Repository platforms that allow user-defined webhook destination URLs without egress filtering can be manipulated to deliver signed webhook payloads to internal CI/CD infrastructure or cloud metadata endpoints, using the repository host as a trusted relay to bypass perimeter controls.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.004",
            "name": "Exfiltration Over Webhook",
            "relevance": "Webhook fanout to untrusted URLs can be used to exfiltrate data by directing webhook payloads to attacker-controlled endpoints."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "SSRF via untrusted webhook targets can be used to access internal information repositories not otherwise reachable."
        }
    ],
    "attack_vector": "NETWORK"
}

webhook_fanout_ssrf_via_untrusted_target_urls[_webhook_fanout_ssrf_via_untrusted_target_urls_def] if {
    not input.webhook_egress_filtering_enabled
    input.webhook_url_validation_mode in ["none", "syntax_only"]
}

webhook_fanout_ssrf_via_untrusted_target_urls[_webhook_fanout_ssrf_via_untrusted_target_urls_def] if {
    not input.webhook_egress_filtering_enabled
    not input.webhook_auth_required_on_delivery
    input.webhook_url_validation_mode in ["none", "syntax_only"]
}

exposures contains _webhook_fanout_ssrf_via_untrusted_target_urls_def if {
    count(webhook_fanout_ssrf_via_untrusted_target_urls) > 0
}

_absence_of_rate_limiting_on_git_clone_endpoint_def := {
    "name": "Absence Of Rate Limiting On Git Clone Endpoint",
    "description": "Git repository endpoints without per-source-IP or per-token clone rate limiting expose the full repository history to high-speed bulk exfiltration by an attacker with any valid credential, and enable amplification of bandwidth consumption that degrades service availability for legitimate CI/CD consumers.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213.003",
            "name": "Code Repositories",
            "relevance": "Without rate limiting, attackers can repeatedly clone repositories to harvest all available source code data."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "name": "Data from Information Repositories",
            "relevance": "Unrestricted cloning enables bulk data collection from code repositories as an information repository data source."
        }
    ],
    "attack_vector": "NETWORK"
}

absence_of_rate_limiting_on_git_clone_endpoint[_absence_of_rate_limiting_on_git_clone_endpoint_def] if {
    not input.clone_rate_limiting_enabled
    input.clone_bandwidth_limit_mbps == 0
}

absence_of_rate_limiting_on_git_clone_endpoint[_absence_of_rate_limiting_on_git_clone_endpoint_def] if {
    not input.clone_rate_limiting_enabled
    input.repository_visibility == "public"
}

exposures contains _absence_of_rate_limiting_on_git_clone_endpoint_def if {
    count(absence_of_rate_limiting_on_git_clone_endpoint) > 0
}

_bgp_route_hijack_redirecting_git_traffic_def := {
    "name": "Bgp Route Hijack Redirecting Git Traffic",
    "description": "Lack of RPKI or BGP origin validation on network paths serving repository hosts allows an autonomous-system-level adversary to hijack route announcements, transparently redirecting git clone and push traffic through attacker-controlled infrastructure where TLS interception or traffic analysis can be performed.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "name": "Adversary-in-the-Middle",
            "relevance": "BGP route hijacking redirects git traffic through attacker-controlled infrastructure, achieving an adversary-in-the-middle position."
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.001",
            "name": "Compromise Software Dependencies and Development Tools",
            "relevance": "Redirecting git traffic via BGP hijack can enable tampering with software dependencies fetched through version control systems."
        }
    ],
    "attack_vector": "NETWORK"
}

bgp_route_hijack_redirecting_git_traffic[_bgp_route_hijack_redirecting_git_traffic_def] if {
    not input.rpki_validation_enforced
    input.git_transport_protocol in ["http", "git"]
}

bgp_route_hijack_redirecting_git_traffic[_bgp_route_hijack_redirecting_git_traffic_def] if {
    not input.rpki_validation_enforced
    input.git_transport_protocol in ["https", "ssh"]
    not input.tls_certificate_pinning_enabled
}

exposures contains _bgp_route_hijack_redirecting_git_traffic_def if {
    count(bgp_route_hijack_redirecting_git_traffic) > 0
}
