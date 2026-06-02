package _dt_built_in.exposures.endpoint_office_environment



_phishing_initial_access_def := {
    "name": "Phishing-driven initial access",
    "description": "Spearphishing email/link/attachment - canonical initial-access path through endpoint/office boundary.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1566",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

phishing_initial_access[_phishing_initial_access_def] if {
    not input.email_phishing_defenses_layered
}

phishing_initial_access[_phishing_initial_access_def] if {
    not input.user_awareness_training_current
}

exposures contains _phishing_initial_access_def if {
    count(phishing_initial_access) > 0
}

_unmanaged_device_crossing_def := {
    "name": "Unmanaged-device crossing without posture check",
    "description": "Personal/unmanaged laptop, phone, or rogue AP reaches corp apps without 802.1X NAC or conditional-access posture check.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

unmanaged_device_crossing[_unmanaged_device_crossing_def] if {
    not input.managed_device_enrollment_enforced
}

unmanaged_device_crossing[_unmanaged_device_crossing_def] if {
    not input.network_access_control_802_1x_enforced
}

exposures contains _unmanaged_device_crossing_def if {
    count(unmanaged_device_crossing) > 0
}

_endpoint_lateral_to_internal_def := {
    "name": "Lateral movement from owned endpoint to internal services",
    "description": "Adversary uses RDP/SMB/WinRM/SSH with harvested creds to pivot from owned laptop to internal services.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

endpoint_lateral_to_internal[_endpoint_lateral_to_internal_def] if {
    not input.user_segment_isolated_from_production_tiers
}

endpoint_lateral_to_internal[_endpoint_lateral_to_internal_def] if {
    not input.admin_protocols_require_pam_and_mfa
}

exposures contains _endpoint_lateral_to_internal_def if {
    count(endpoint_lateral_to_internal) > 0
}

_supply_chain_trusted_rel_def := {
    "name": "Trusted-relationship / supply-chain access abuse",
    "description": "Contractor/MSP/partner access ridden through the boundary after compromising the partner.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

supply_chain_trusted_rel[_supply_chain_trusted_rel_def] if {
    not input.third_party_access_scoped_and_audited
}

supply_chain_trusted_rel[_supply_chain_trusted_rel_def] if {
    not input.third_party_devices_meet_same_posture_bar
}

exposures contains _supply_chain_trusted_rel_def if {
    count(supply_chain_trusted_rel) > 0
}

_stolen_device_data_cookies_def := {
    "name": "Stolen device with cleartext data and live session cookies",
    "description": "Physical theft or infostealer yields local files, cached creds, SSO refresh tokens, replayable session cookies.",
    "type": "EXPOSURE",
    "category": "PHYSICAL",
    "criticality": "high",
    "score": 7.8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        }
    ],
    "attack_vector": "PHYSICAL"
}

stolen_device_data_cookies[_stolen_device_data_cookies_def] if {
    not input.endpoint_full_disk_encryption_on
}

stolen_device_data_cookies[_stolen_device_data_cookies_def] if {
    not input.remote_wipe_and_lost_device_response_tested
}

exposures contains _stolen_device_data_cookies_def if {
    count(stolen_device_data_cookies) > 0
}

_endpoint_ransomware_impact_def := {
    "name": "Endpoint ransomware impact across user segment",
    "description": "Endpoint ransomware encrypts local drive and mapped shares; flat SMB/RDP between endpoints turns single infection into enterprise outage.",
    "type": "EXPOSURE",
    "category": "NETWORK",
    "criticality": "high",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1486",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1021",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

endpoint_ransomware_impact[_endpoint_ransomware_impact_def] if {
    not input.edr_agent_active_with_tamper_protection
}

endpoint_ransomware_impact[_endpoint_ransomware_impact_def] if {
    not input.endpoint_to_endpoint_smb_rdp_restricted
}

exposures contains _endpoint_ransomware_impact_def if {
    count(endpoint_ransomware_impact) > 0
}

_endpoint_credential_capture_def := {
    "name": "Credential and session capture on endpoint",
    "description": "Malware as local user installs keylogger or exfils browser cookie stores; captured creds and cookies bypass MFA via replay.",
    "type": "EXPOSURE",
    "category": "LOCAL",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1056",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1539",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

endpoint_credential_capture[_endpoint_credential_capture_def] if {
    not input.endpoint_runs_as_least_privileged_user
}

endpoint_credential_capture[_endpoint_credential_capture_def] if {
    not input.session_binding_or_short_session_lifetime
}

exposures contains _endpoint_credential_capture_def if {
    count(endpoint_credential_capture) > 0
}

_endpoint_audit_gap_def := {
    "name": "Unmonitored crossing - endpoint audit gap",
    "description": "Endpoint security events live only on host or never reach SIEM; insider misuse and slow-burn intrusions undetectable.",
    "type": "EXPOSURE",
    "category": "LOCAL",
    "criticality": "medium",
    "score": 6.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1070",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

endpoint_audit_gap[_endpoint_audit_gap_def] if {
    not input.endpoint_audit_logs_centralised
}

exposures contains _endpoint_audit_gap_def if {
    count(endpoint_audit_gap) > 0
}
