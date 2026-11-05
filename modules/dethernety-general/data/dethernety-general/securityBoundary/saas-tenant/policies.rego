package _dt_built_in.exposures.saas_tenant



_tenant_admin_account_takeover_def := {
    "name": "Tenant admin account takeover",
    "description": "When admins can sign in without a phishing-resistant factor, or hold their roles permanently, an admin password obtained by phishing or password spraying where no second factor applies, or a session captured by an adversary-in-the-middle proxy where the factor is phishable, gives full control of the tenant.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "A SaaS tenant admin account is a cloud account. Without a phishing-resistant factor, or with standing role assignments, an adversary uses a stolen or phished admin credential directly as a valid cloud account with tenant-wide rights. This is Valid Accounts: Cloud Accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "Without a phishing-resistant factor, an adversary-in-the-middle proxy captures an admin's session cookie during sign-in, and the adversary replays it to use the admin session without needing the password or the second factor. This is Use Alternate Authentication Material: Web Session Cookie."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tenant_admin_account_takeover[_tenant_admin_account_takeover_def] if {
    not input.admin_phishing_resistant_mfa_enforced
}

tenant_admin_account_takeover[_tenant_admin_account_takeover_def] if {
    not input.no_standing_admin_privileges_jit_required
}

exposures contains _tenant_admin_account_takeover_def if {
    count(tenant_admin_account_takeover) > 0
}

_mfa_bypass_legacy_or_local_sign_in_def := {
    "name": "Missing MFA, or MFA bypassed through legacy protocols or local sign-in",
    "description": "Without MFA, or over a legacy protocol that cannot carry it, a stolen or sprayed password alone opens a tenant account. A local service password also sidesteps the identity provider's MFA, device and lifecycle controls.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "Without MFA, or over a legacy protocol that cannot carry MFA, a password alone authenticates a tenant user. A local password also sidesteps the identity provider's controls. The adversary then acts through a valid cloud account of the tenant."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

mfa_bypass_legacy_or_local_sign_in[_mfa_bypass_legacy_or_local_sign_in_def] if {
    not input.all_user_mfa_enforced
}

mfa_bypass_legacy_or_local_sign_in[_mfa_bypass_legacy_or_local_sign_in_def] if {
    not input.legacy_auth_protocols_disabled
}

mfa_bypass_legacy_or_local_sign_in[_mfa_bypass_legacy_or_local_sign_in_def] if {
    input.sso_federation_enabled == true
    not input.local_signin_restricted_to_break_glass
}

exposures contains _mfa_bypass_legacy_or_local_sign_in_def if {
    count(mfa_bypass_legacy_or_local_sign_in) > 0
}

_weak_or_unmonitored_emergency_access_accounts_def := {
    "name": "Weakly protected or unmonitored emergency-access accounts",
    "description": "Emergency-access accounts are excluded from the normal sign-in controls by design. When they are protected no better than other accounts, are tied to one person's device, or can be used without raising an alert, they give full tenant access without anyone noticing.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "An emergency-access account is a cloud account with standing top-level rights that is exempt from conditional sign-in controls. An adversary who uses it without raising an alert holds a valid cloud account with full tenant access."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_or_unmonitored_emergency_access_accounts[_weak_or_unmonitored_emergency_access_accounts_def] if {
    not input.emergency_access_accounts_monitored
}

exposures contains _weak_or_unmonitored_emergency_access_accounts_def if {
    count(weak_or_unmonitored_emergency_access_accounts) > 0
}

_illicit_oauth_consent_grant_def := {
    "name": "Illicit OAuth consent grant",
    "description": "An attacker registers an OAuth app and phishes users into consenting to it. When users may consent to any app, or grants to unused or over-scoped apps are left in place, the app keeps token access to organizational data after the phishing ends.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1528",
            "attributes": {
                "justification": "Steal Application Access Token covers malicious OAuth applications that users are tricked into authorizing, which then hold access tokens to the user's data. Open user consent lets such an app obtain its token, and stale grants left in place let it keep the token."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

illicit_oauth_consent_grant[_illicit_oauth_consent_grant_def] if {
    not input.user_app_consent_restricted
}

illicit_oauth_consent_grant[_illicit_oauth_consent_grant_def] if {
    not input.stale_app_grants_revoked
}

exposures contains _illicit_oauth_consent_grant_def if {
    count(illicit_oauth_consent_grant) > 0
}

_ungoverned_integration_credentials_def := {
    "name": "Ungoverned integration credentials",
    "description": "Service principals, OAuth clients, API keys and integration users with long-lived secrets, broad scopes or no owner let a stolen token or key be replayed against the tenant's APIs without any interactive sign-in or MFA.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {
                "justification": "Integration tokens and API keys are application access material. When they are long-lived and broadly scoped, an adversary replays a stolen one against the tenant's APIs and never meets MFA. This is Use Alternate Authentication Material: Application Access Token."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "Service principals and integration users with long-lived secrets are cloud accounts. An adversary who obtains such a secret signs in as the integration identity and acts with its scopes. This is Valid Accounts: Cloud Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

ungoverned_integration_credentials[_ungoverned_integration_credentials_def] if {
    not input.integration_credentials_governed
}

exposures contains _ungoverned_integration_credentials_def if {
    count(ungoverned_integration_credentials) > 0
}

_cross_tenant_share_exfiltration_def := {
    "name": "Data shared into another tenant of the service",
    "description": "With collaboration open to any tenant of the same service, data can be shared or synced to an account the adversary controls on that service. The transfer stays inside the provider and never crosses the organization's network egress.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "attributes": {
                "justification": "This condition is a provider-side share into another account on the same service. Transfer Data to Cloud Account covers moving data to an adversary-controlled account on the same cloud provider, which avoids network egress monitoring."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

cross_tenant_share_exfiltration[_cross_tenant_share_exfiltration_def] if {
    not input.cross_tenant_collaboration_restricted
}

exposures contains _cross_tenant_share_exfiltration_def if {
    count(cross_tenant_share_exfiltration) > 0
}

_anonymous_link_exposure_def := {
    "name": "Content exposed through anonymous links",
    "description": "Unauthenticated anyone-with-the-link URLs without expiry let whoever obtains a link read the content, and with edit permission change it, with no identity recorded.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1530",
            "attributes": {
                "justification": "Data from Cloud Storage includes the document storage of SaaS platforms such as Office 365 and Google Workspace. An anyone-link is an unauthenticated read path into that storage."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_link_exposure[_anonymous_link_exposure_def] if {
    not input.anonymous_link_sharing_disabled
}

exposures contains _anonymous_link_exposure_def if {
    count(anonymous_link_exposure) > 0
}

_guest_directory_reconnaissance_def := {
    "name": "Directory reconnaissance by guests",
    "description": "A guest, or a compromised partner identity, with member-level directory access enumerates the tenant's users, groups and memberships to plan phishing and privilege escalation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1087.004",
            "attributes": {
                "justification": "Account Discovery: Cloud Account covers listing cloud accounts. Member-level directory access for guests is the posture that lets an outside identity enumerate the tenant's accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

guest_directory_reconnaissance[_guest_directory_reconnaissance_def] if {
    not input.guest_directory_access_restricted
}

exposures contains _guest_directory_reconnaissance_def if {
    count(guest_directory_reconnaissance) > 0
}

_tenant_activity_unrecorded_def := {
    "name": "Tenant activity not recorded or not kept",
    "description": "With auditing off, or audit records kept for less than a year, admin and user activity in the tenant cannot be investigated after the fact.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

tenant_activity_unrecorded[_tenant_activity_unrecorded_def] if {
    not input.tenant_audit_logging_enabled
}

tenant_activity_unrecorded[_tenant_activity_unrecorded_def] if {
    input.log_retention_days < 365
}

exposures contains _tenant_activity_unrecorded_def if {
    count(tenant_activity_unrecorded) > 0
}

_tenant_audit_trail_removable_def := {
    "name": "Tenant audit trail can be removed from inside the tenant",
    "description": "When the audit logs exist only inside the vendor console, on services that allow it an adversary with admin rights can turn auditing off, so later activity goes unrecorded, or shorten retention, so older records age out.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1685.002",
            "attributes": {
                "justification": "Disable or Modify Cloud Log covers disabling or changing cloud and SaaS logging to avoid detection. Logs that exist only inside the tenant are what an admin-level adversary can switch off or shorten. An export to the organization's own store keeps the record."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tenant_audit_trail_removable[_tenant_audit_trail_removable_def] if {
    not input.audit_log_streaming_enabled
}

exposures contains _tenant_audit_trail_removable_def if {
    count(tenant_audit_trail_removable) > 0
}

_tenant_data_outside_required_region_def := {
    "name": "Tenant data held outside the required region",
    "description": "The tenant's data-at-rest or processing region is unknown or differs from the organization's residency obligations. Regulated data can then be held or processed under a jurisdiction the organization's contracts or regulators do not allow.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 4.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

tenant_data_outside_required_region[_tenant_data_outside_required_region_def] if {
    not input.residency_confined_to_approved_regions
}

exposures contains _tenant_data_outside_required_region_def if {
    count(tenant_data_outside_required_region) > 0
}

_untrusted_inbound_identity_trust_def := {
    "name": "Sign-in trusted from an unrecognized identity provider",
    "description": "The tenant accepts sign-in assertions or certificates from an identity provider, certificate authority or external MFA provider the organization does not run, or its default inbound settings trust MFA and device claims from any external tenant. Whoever controls an unrecognized provider can issue sign-ins the tenant accepts for any user the trust covers, admins included. A default inbound MFA or device trust lets a guest from any external tenant satisfy the tenant's own MFA and device checks with claims its home tenant issued.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {
                "justification": "A federated identity provider or token-signing certificate the tenant trusts but the organization does not run lets whoever holds the signing key produce SAML tokens that the tenant accepts for any user the trust covers, admins included. This is Forge Web Credentials: SAML Tokens."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "A default inbound MFA or device trust lets a guest from any external tenant satisfy this tenant's MFA and device checks with claims its home tenant issued. An adversary who holds a guest's external account, or controls its home tenant, passes those checks and acts as that guest with the guest's access in this tenant. This is Valid Accounts: Cloud Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

untrusted_inbound_identity_trust[_untrusted_inbound_identity_trust_def] if {
    not input.inbound_identity_trust_restricted
}

exposures contains _untrusted_inbound_identity_trust_def if {
    count(untrusted_inbound_identity_trust) > 0
}

_unalerted_admin_role_and_setting_changes_def := {
    "name": "Admin-role grants and security-setting changes raise no alert",
    "description": "Granting a tenant admin role, turning auditing off, loosening app consent, or adding a federation or cross-tenant trust is at most written to the audit log; no alert reaches the security team. An adversary with admin rights can add roles or weaken settings to keep access. The change then goes unnoticed until someone happens to read the log.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1098.003",
            "attributes": {
                "justification": "Without an alert on role grants, an adversary who adds roles or permissions to an account they control, such as a new global administrator, keeps persistent access to the tenant unnoticed. ATT&CK's detection strategy for this technique is role addition to cloud accounts."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1685.002",
            "attributes": {
                "justification": "Turning tenant auditing off raises no alert, so an adversary with admin rights disables or changes the tenant's cloud logging, and no one is told until someone reads the log. This is Disable or Modify Cloud Log."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "attributes": {
                "justification": "Adding a federation or cross-tenant trust raises no alert, so an adversary with admin rights adds a federated identity provider or trust to the tenant, which can let them authenticate as users the trust covers and keep access. No one is told until someone reads the log. This is Domain or Tenant Policy Modification: Trust Modification."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unalerted_admin_role_and_setting_changes[_unalerted_admin_role_and_setting_changes_def] if {
    not input.admin_role_and_security_setting_changes_alerted
}

exposures contains _unalerted_admin_role_and_setting_changes_def if {
    count(unalerted_admin_role_and_setting_changes) > 0
}

_admin_sessions_usable_from_any_device_def := {
    "name": "Admin sessions usable from any device or network",
    "description": "Admin sign-in carries no device or location condition. An admin session cookie stolen from the admin's browser or device, or captured by an adversary-in-the-middle proxy where the second factor is phishable, is then accepted from the adversary's own device and network.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.004",
            "attributes": {
                "justification": "With no device or location condition on admin sign-in, a stolen admin web session cookie is accepted from the adversary's own device and network, so the adversary uses the session without needing the password or the second factor. This is Use Alternate Authentication Material: Web Session Cookie."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

admin_sessions_usable_from_any_device[_admin_sessions_usable_from_any_device_def] if {
    not input.admin_signin_device_or_location_restricted
}

exposures contains _admin_sessions_usable_from_any_device_def if {
    count(admin_sessions_usable_from_any_device) > 0
}
