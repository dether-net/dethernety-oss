package _dt_built_in.countermeasures.multi_factor_authentication

_credential_theft_prevention_coverage_def := {
    "name": "Credential Theft Prevention Coverage",
    "description": "Provides prevention coverage against authentication attempts using stolen or guessed passwords alone; even valid credentials fail authentication without the second factor, reducing the attack surface of exposed password stores.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

credential_theft_prevention_coverage[_credential_theft_prevention_coverage_def] if {
    input.mfa_enforcement_status == "required"
    input.mfa_enrolled_user_percentage >= 95
    input.mfa_bypass_mechanisms_present == false
}

credential_theft_prevention_coverage[_credential_theft_prevention_coverage_def] if {
    input.mfa_enforcement_status == "required"
    input.privileged_accounts_mfa_enforced == true
    input.mfa_enrolled_user_percentage >= 95
    input.mfa_bypass_mechanisms_present == false
}

countermeasures contains _credential_theft_prevention_coverage_def if {
    count(credential_theft_prevention_coverage) > 0
}

_factor_diversity_strength_def := {
    "name": "Factor Diversity Strength",
    "description": "Delivers identity assurance proportional to the diversity and strength of enrolled factors; hardware tokens and biometrics provide stronger assurance than SMS-based OTPs, directly affecting the control's prevention efficacy.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

factor_diversity_strength[_factor_diversity_strength_def] if {
    input.phishing_resistant_factor_required == true
    input.privileged_accounts_mfa_enforced == true
    count(input.mfa_bypass_mechanisms_present) == 0
}

factor_diversity_strength[_factor_diversity_strength_def] if {
    input.strongest_enrolled_factor_type in ["hardware_token", "biometric"]
    input.privileged_accounts_mfa_enforced == true
    count(input.mfa_bypass_mechanisms_present) == 0
}

countermeasures contains _factor_diversity_strength_def if {
    count(factor_diversity_strength) > 0
}

_authentication_event_logging_completeness_def := {
    "name": "Authentication Event Logging Completeness",
    "description": "Generates detailed authentication event logs including factor type used, success/failure status, timestamp, device fingerprint, and source IP, enabling forensic reconstruction of authentication activity.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

authentication_event_logging_completeness[_authentication_event_logging_completeness_def] if {
    input.auth_event_logging_enabled == true
    "factor_type" in input.logged_event_fields
    "success_failure_status" in input.logged_event_fields
    "timestamp" in input.logged_event_fields
    "source_ip" in input.logged_event_fields
}

countermeasures contains _authentication_event_logging_completeness_def if {
    count(authentication_event_logging_completeness) > 0
}

_anomalous_login_detection_accuracy_def := {
    "name": "Anomalous Login Detection Accuracy",
    "description": "Provides detection capability for unusual authentication patterns such as out-of-region logins, rapid factor-retry sequences, or simultaneous logins, enabling risk-based step-up challenges or automated blocks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

anomalous_login_detection_accuracy[_anomalous_login_detection_accuracy_def] if {
    input.anomalous_login_detection_enabled == true
    "out_of_region" in input.detection_signal_coverage
    not input.automated_response_action in ["none"]
}

anomalous_login_detection_accuracy[_anomalous_login_detection_accuracy_def] if {
    input.anomalous_login_detection_enabled == true
    "impossible_travel" in input.detection_signal_coverage
    "simultaneous_sessions" in input.detection_signal_coverage
    not input.automated_response_action in ["none"]
}

anomalous_login_detection_accuracy[_anomalous_login_detection_accuracy_def] if {
    input.anomalous_login_detection_enabled == true
    "rapid_factor_retry" in input.detection_signal_coverage
    input.automated_response_action in ["step_up_challenge", "block"]
}

countermeasures contains _anomalous_login_detection_accuracy_def if {
    count(anomalous_login_detection_accuracy) > 0
}

_privileged_account_protection_depth_def := {
    "name": "Privileged Account Protection Depth",
    "description": "Extends additional verification enforcement to privileged and administrative accounts, ensuring high-value targets require stronger factor combinations and increasing operational coverage across critical access paths.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

privileged_account_protection_depth[_privileged_account_protection_depth_def] if {
    input.privileged_accounts_mfa_enforced == true
    input.privileged_mfa_factor_strength in ["hardware_key_fido2", "totp_authenticator_app"]
    input.privileged_account_mfa_coverage_percent >= 95
    input.privileged_mfa_bypass_paths_exist == false
}

privileged_account_protection_depth[_privileged_account_protection_depth_def] if {
    input.privileged_accounts_mfa_enforced == true
    input.privileged_account_mfa_coverage_percent >= 100
    input.privileged_mfa_bypass_paths_exist == false
}

countermeasures contains _privileged_account_protection_depth_def if {
    count(privileged_account_protection_depth) > 0
}

_enrollment_coverage_completeness_def := {
    "name": "Enrollment Coverage Completeness",
    "description": "Measures the proportion of user accounts with MFA fully enrolled and enforced; gaps in coverage leave unprotected accounts as bypass paths, directly limiting overall prevention effectiveness.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

enrollment_coverage_completeness[_enrollment_coverage_completeness_def] if {
    input.mfa_enrolled_user_percentage >= 95
    input.mfa_enforcement_status == "enforced"
    input.privileged_accounts_mfa_enforced == true
    input.mfa_bypass_mechanisms_present == false
}

countermeasures contains _enrollment_coverage_completeness_def if {
    count(enrollment_coverage_completeness) > 0
}

_bypass_resistance_configuration_def := {
    "name": "Bypass Resistance Configuration",
    "description": "Provides resistance to MFA circumvention through configuration of fallback restrictions; disabling insecure recovery paths, legacy protocol authentication, and trusted device exceptions prevents control bypass.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

bypass_resistance_configuration[_bypass_resistance_configuration_def] if {
    input.legacy_protocol_auth_disabled == false
}

bypass_resistance_configuration[_bypass_resistance_configuration_def] if {
    input.insecure_recovery_paths_disabled == false
}

bypass_resistance_configuration[_bypass_resistance_configuration_def] if {
    input.trusted_device_exceptions_restricted == false
}

countermeasures contains _bypass_resistance_configuration_def if {
    count(bypass_resistance_configuration) > 0
}

_integration_depth_across_applications_def := {
    "name": "Integration Depth Across Applications",
    "description": "Delivers consistent authentication enforcement by integrating with SSO, VPN, cloud services, and on-premises applications; shallow integration creates unprotected authentication entry points that reduce overall coverage.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "responds_with": []
}

integration_depth_across_applications[_integration_depth_across_applications_def] if {
    not "sso" in input.mfa_integrated_systems
    not "vpn" in input.mfa_integrated_systems
    not "cloud_services" in input.mfa_integrated_systems
}

integration_depth_across_applications[_integration_depth_across_applications_def] if {
    input.unprotected_authentication_entry_points > 0
}

integration_depth_across_applications[_integration_depth_across_applications_def] if {
    input.mfa_bypass_paths_exist == true
}

integration_depth_across_applications[_integration_depth_across_applications_def] if {
    count(input.mfa_integrated_systems) < 2
}

countermeasures contains _integration_depth_across_applications_def if {
    count(integration_depth_across_applications) > 0
}

_automated_response_on_failed_factor_attempts_def := {
    "name": "Automated Response On Failed Factor Attempts",
    "description": "Provides automated response capabilities including account lockout, alerting, and session termination triggered by repeated failed second-factor attempts, limiting brute-force feasibility against enrolled accounts.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

automated_response_on_failed_factor_attempts[_automated_response_on_failed_factor_attempts_def] if {
    input.failed_mfa_lockout_enabled == true
    input.failed_mfa_attempt_threshold >= 1
    count(input.automated_response_actions) >= 1
}

countermeasures contains _automated_response_on_failed_factor_attempts_def if {
    count(automated_response_on_failed_factor_attempts) > 0
}

_phishing_resistant_factor_availability_def := {
    "name": "Phishing Resistant Factor Availability",
    "description": "Provides protection through deployment of phishing-resistant factors such as FIDO2/WebAuthn hardware keys, which cryptographically bind authentication to the legitimate origin and cannot be intercepted by adversary-in-the-middle proxies.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "responds_with": []
}

phishing_resistant_factor_availability[_phishing_resistant_factor_availability_def] if {
    count(input.phishing_resistant_factor_types) > 0
    input.phishing_resistant_factor_enrollment_percentage >= 90
    input.phishing_resistant_factor_enforcement_scope == "all_users"
    input.fallback_to_phishable_factor_permitted == false
}

phishing_resistant_factor_availability[_phishing_resistant_factor_availability_def] if {
    count(input.phishing_resistant_factor_types) > 0
    input.phishing_resistant_factor_enrollment_percentage >= 90
    input.phishing_resistant_factor_enforcement_scope == "privileged_users_only"
    input.fallback_to_phishable_factor_permitted == false
}

countermeasures contains _phishing_resistant_factor_availability_def if {
    count(phishing_resistant_factor_availability) > 0
}

_operational_maintainability_and_user_friction_def := {
    "name": "Operational Maintainability And User Friction",
    "description": "Reflects the control's long-term operational sustainability through self-service enrollment, device management, help desk integration, and balanced user friction; poor usability drives shadow IT workarounds that erode enforcement.",
    "type": "misconfiguration",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "responds_with": []
}

operational_maintainability_and_user_friction[_operational_maintainability_and_user_friction_def] if {
    input.self_service_enrollment_available == true
    input.user_friction_level in ["low", "medium"]
    input.mfa_bypass_workarounds_detected == false
}

countermeasures contains _operational_maintainability_and_user_friction_def if {
    count(operational_maintainability_and_user_friction) > 0
}
