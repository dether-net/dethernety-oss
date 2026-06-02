package _dt_built_in.exposures.mobile_device



_insecure_local_credential_token_storage_def := {
    "name": "Insecure local credential/token storage",
    "description": "Tokens or credentials persisted in plaintext SharedPreferences/NSUserDefaults/plist/SQLite/files instead of the hardware-backed keystore (iOS Keychain/Secure Enclave, Android Keystore/StrongBox), so a lost, stolen, or rooted device yields the credentials directly to an attacker.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
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
    "attack_vector": "PHYSICAL"
}

insecure_local_credential_token_storage[_insecure_local_credential_token_storage_def] if {
    not input.hardware_backed_credential_storage_used
}

insecure_local_credential_token_storage[_insecure_local_credential_token_storage_def] if {
    input.tokens_in_plaintext_device_storage == true
}

insecure_local_credential_token_storage[_insecure_local_credential_token_storage_def] if {
    not input.encrypted_at_rest
}

exposures contains _insecure_local_credential_token_storage_def if {
    count(insecure_local_credential_token_storage) > 0
}

_cleartext_transport_no_certificate_pinning_def := {
    "name": "Cleartext transport / no certificate pinning",
    "description": "Cleartext HTTP permitted (cleartextTrafficPermitted=true / NSAllowsArbitraryLoads=true) or system-trust-only with no certificate/SPKI pinning lets a rogue or user-installed root CA on the hostile device MITM the channel and intercept tokens and PII in transit.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1553.004",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

cleartext_transport_no_certificate_pinning[_cleartext_transport_no_certificate_pinning_def] if {
    not input.tls_only_transport
}

cleartext_transport_no_certificate_pinning[_cleartext_transport_no_certificate_pinning_def] if {
    input.cleartext_http_permitted == true
}

cleartext_transport_no_certificate_pinning[_cleartext_transport_no_certificate_pinning_def] if {
    not input.certificate_pinning_enabled
}

cleartext_transport_no_certificate_pinning[_cleartext_transport_no_certificate_pinning_def] if {
    not input.server_certificate_validated
}

exposures contains _cleartext_transport_no_certificate_pinning_def if {
    count(cleartext_transport_no_certificate_pinning) > 0
}

_no_jailbreak_root_detection_or_app_integrity_attestation_def := {
    "name": "No jailbreak/root detection or app-integrity attestation",
    "description": "The app runs identically on a rooted/jailbroken runtime and the backend trusts any client claiming to be the app, because no root/jailbreak detection and no server-verified Play Integrity / iOS App Attest is in place \u2014 OS sandbox guarantees protecting the keystore and screen are silently undermined.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

no_jailbreak_root_detection_or_app_integrity_attestation[_no_jailbreak_root_detection_or_app_integrity_attestation_def] if {
    not input.root_jailbreak_detection_enabled
}

no_jailbreak_root_detection_or_app_integrity_attestation[_no_jailbreak_root_detection_or_app_integrity_attestation_def] if {
    not input.server_verified_app_integrity_attestation
}

exposures contains _no_jailbreak_root_detection_or_app_integrity_attestation_def if {
    count(no_jailbreak_root_detection_or_app_integrity_attestation) > 0
}

_app_repackaging_hardcoded_secret_extraction_def := {
    "name": "App repackaging & hardcoded-secret extraction",
    "description": "API keys, signing secrets, or backend shared secrets hardcoded in the APK/IPA are recoverable by decompiling on the attacker's own device, and without anti-tamper/attestation a repackaged forged app is indistinguishable from the genuine one to the backend.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1036.001",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

app_repackaging_hardcoded_secret_extraction[_app_repackaging_hardcoded_secret_extraction_def] if {
    input.secrets_hardcoded_in_config_or_iac == true
}

app_repackaging_hardcoded_secret_extraction[_app_repackaging_hardcoded_secret_extraction_def] if {
    not input.server_verified_app_integrity_attestation
}

exposures contains _app_repackaging_hardcoded_secret_extraction_def if {
    count(app_repackaging_hardcoded_secret_extraction) > 0
}

_long_lived_bearer_token_theft_and_replay_def := {
    "name": "Long-lived bearer token theft and replay",
    "description": "Long-lived plain bearer tokens \u2014 lacking short TTL, refresh rotation, and sender-constraint (DPoP/mTLS) \u2014 stolen off a lost or compromised device can be replayed trivially from attacker hardware, and with no server-side revocation path the access persists until expiry.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

long_lived_bearer_token_theft_and_replay[_long_lived_bearer_token_theft_and_replay_def] if {
    input.access_token_ttl_minutes > 60
    not input.sender_constrained
    not input.refresh_token_rotation_enabled
    not input.server_side_revocation_supported
}

exposures contains _long_lived_bearer_token_theft_and_replay_def if {
    count(long_lived_bearer_token_theft_and_replay) > 0
}

_sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def := {
    "name": "Sensitive data leakage via backups, logs, clipboard, screen capture",
    "description": "Secrets/PII leak through iCloud/Android backups (allowBackup=true, not ThisDeviceOnly), device logs (logcat/NSLog/crash SDKs), the shared clipboard, or unprotected screen capture/overlay (FLAG_SECURE missing), each readable by other apps or harvested on a rooted device.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1115",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

sensitive_data_leakage_via_backups_logs_clipboard_screen_capture[_sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def] if {
    not input.excluded_from_device_backup
}

sensitive_data_leakage_via_backups_logs_clipboard_screen_capture[_sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def] if {
    not input.screen_capture_protection_enabled
}

sensitive_data_leakage_via_backups_logs_clipboard_screen_capture[_sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def] if {
    not input.sensitive_clipboard_hygiene
}

sensitive_data_leakage_via_backups_logs_clipboard_screen_capture[_sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def] if {
    not input.secrets_masked_in_logs
}

exposures contains _sensitive_data_leakage_via_backups_logs_clipboard_screen_capture_def if {
    count(sensitive_data_leakage_via_backups_logs_clipboard_screen_capture) > 0
}

_malicious_deep_link_untrusted_client_supplied_data_def := {
    "name": "Malicious deep link & untrusted client-supplied data",
    "description": "Crafted deep links / custom URL schemes / intents drive sensitive actions or leak data when handlers don't validate origin and re-check authorization; more broadly the backend that trusts client-asserted state (entitlements, prices, jailbreak/integrity claims) is bypassed by a tampered or instrumented app.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1204.001",
            "attributes": {
                "justification": "Crafted deep links / custom URL schemes lure a user into activating a malicious link that an unvalidated handler treats as trusted, driving sensitive actions."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "A backend that trusts client-asserted state and lacks server-side allow-list validation exposes an application-layer weakness exploitable by a tampered/instrumented app supplying crafted input."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

malicious_deep_link_untrusted_client_supplied_data[_malicious_deep_link_untrusted_client_supplied_data_def] if {
    not input.deep_link_origin_validated
}

malicious_deep_link_untrusted_client_supplied_data[_malicious_deep_link_untrusted_client_supplied_data_def] if {
    input.deep_link_url_scheme_validation == "unvalidated_deep_links"
}

malicious_deep_link_untrusted_client_supplied_data[_malicious_deep_link_untrusted_client_supplied_data_def] if {
    not input.server_side_allowlist_validation
}

malicious_deep_link_untrusted_client_supplied_data[_malicious_deep_link_untrusted_client_supplied_data_def] if {
    input.client_asserted_state_trusted_serverside == true
}

exposures contains _malicious_deep_link_untrusted_client_supplied_data_def if {
    count(malicious_deep_link_untrusted_client_supplied_data) > 0
}

_missing_local_auth_biometric_gating_of_secrets_def := {
    "name": "Missing local-auth (biometric) gating of secrets",
    "description": "Keystore-held secrets and sensitive in-app actions are usable with no biometric/local-auth challenge (keys not created with setUserAuthenticationRequired / no biometry-bound SecAccessControl), so an attacker with a momentarily unlocked or stolen device can exercise stored credentials.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Keystore-held secrets usable without a biometric/local-auth challenge are unsecured credentials an attacker can recover and exercise from a momentarily-unlocked or stolen device; dossier attack vector 'Device theft / loss with local credential extraction' (mitre_hint T1552)."
            }
        }
    ],
    "attack_vector": "PHYSICAL"
}

missing_local_auth_biometric_gating_of_secrets[_missing_local_auth_biometric_gating_of_secrets_def] if {
    not input.biometric_local_auth_gates_secrets
}

missing_local_auth_biometric_gating_of_secrets[_missing_local_auth_biometric_gating_of_secrets_def] if {
    not input.keys_bound_to_user_authentication
}

exposures contains _missing_local_auth_biometric_gating_of_secrets_def if {
    count(missing_local_auth_biometric_gating_of_secrets) > 0
}
