package _dt_built_in.exposures.third_party_service



_trusted_relationship_supply_chain_pivot_def := {
    "name": "Trusted-relationship supply-chain pivot",
    "description": "An adversary compromises the third party and abuses the established trust \u2014 granted keys, federation, or network connectivity \u2014 to pivot into the consumer's environment. Inadequate vendor vetting (no current SOC 2/ISO 27001, no inventory entry, no contract security clauses/DPA) leaves the consumer with no assurance the provider protects what it handles.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1484.002",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

trusted_relationship_supply_chain_pivot[_trusted_relationship_supply_chain_pivot_def] if {
    not input.vendor_security_attestations_reviewed
}

trusted_relationship_supply_chain_pivot[_trusted_relationship_supply_chain_pivot_def] if {
    not input.service_provider_inventoried
}

trusted_relationship_supply_chain_pivot[_trusted_relationship_supply_chain_pivot_def] if {
    not input.dpa_and_subprocessors_reviewed
}

trusted_relationship_supply_chain_pivot[_trusted_relationship_supply_chain_pivot_def] if {
    not input.installed_integrations_reviewed_approved
}

exposures contains _trusted_relationship_supply_chain_pivot_def if {
    count(trusted_relationship_supply_chain_pivot) > 0
}

_stolen_or_over_scoped_api_credential_abuse_def := {
    "name": "Stolen or over-scoped API credential abuse",
    "description": "A full-access or hard-coded third-party API key/token is exfiltrated (committed to source, logged in cleartext, never rotated) and replayed to act as the integration with excessive privilege. Least-privilege scoping, secret-manager storage, rotation, and offboarding revocation contain the blast radius.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {
                "justification": "A stolen third-party API key/token is replayed as an application access token to act as the integration with its granted privilege."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "An over-scoped or never-revoked integration credential is valid-account access an adversary reuses, including lingering access after offboarding."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    not input.api_keys_stored_in_secret_manager
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    not input.api_keys_rotated_regularly
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    not input.third_party_app_scope_least_privilege
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    input.full_scope_allowed_clients == true
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    input.api_credential_age_days > 90
}

stolen_or_over_scoped_api_credential_abuse[_stolen_or_over_scoped_api_credential_abuse_def] if {
    not input.offboarding_credential_revocation_enforced
}

exposures contains _stolen_or_over_scoped_api_credential_abuse_def if {
    count(stolen_or_over_scoped_api_credential_abuse) > 0
}

_over_broad_outbound_token_scope_def := {
    "name": "Over-broad outbound token scope",
    "description": "Broad or write-all OAuth scopes / key permissions granted by default exceed the integration's actual functional need, so a leaked or misused credential can perform far more than the integration requires. Least-privilege scope minimization (AC-6) constrains what a compromised token can do.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1550.001",
            "attributes": {
                "justification": "An over-broad outbound token lets an adversary who steals or misuses the application access token act with the integration's excessive privilege across the provider API (Use Alternate Authentication Material: Application Access Token)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_broad_outbound_token_scope[_over_broad_outbound_token_scope_def] if {
    not input.third_party_app_scope_least_privilege
}

over_broad_outbound_token_scope[_over_broad_outbound_token_scope_def] if {
    input.outbound_token_scope_breadth in ["write_all", "full_access"]
}

exposures contains _over_broad_outbound_token_scope_def if {
    count(over_broad_outbound_token_scope) > 0
}

_forged_or_replayed_inbound_webhook_federation_assertion_def := {
    "name": "Forged or replayed inbound webhook / federation assertion",
    "description": "An unverified callback endpoint accepts a forged or replayed payload (e.g. a fake payment-success event), and where the third party is an IdP/RP, forged or replayed SAML/OIDC assertions (Golden SAML / token theft) grant unauthorized cross-federation access. Signature verification over the raw body, replay-window enforcement, source IP allowlisting, and full assertion validation (signature, issuer, audience, expiry) defeat both.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606.002",
            "attributes": {
                "justification": "Unvalidated SAML/OIDC assertions let an adversary forge SAML tokens (Golden SAML) to obtain unauthorized cross-federation access."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1606",
            "attributes": {
                "justification": "Missing signature/replay verification on inbound callbacks and federation assertions enables forging of web credentials / authentication material accepted by the relying endpoint."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.webhook_signature_verified
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.webhook_replay_timestamp_tolerance_enforced
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.saml_assertion_signature_verified
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.audience_claim_validated
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.issuer_claim_validated
}

forged_or_replayed_inbound_webhook_federation_assertion[_forged_or_replayed_inbound_webhook_federation_assertion_def] if {
    not input.expiry_claim_validated
}

exposures contains _forged_or_replayed_inbound_webhook_federation_assertion_def if {
    count(forged_or_replayed_inbound_webhook_federation_assertion) > 0
}

_man_in_the_middle_on_the_integration_channel_def := {
    "name": "Man-in-the-middle on the integration channel",
    "description": "Plaintext (http://) or unverified-TLS calls to the provider (verify=false, -k, TLS<=1.1) let an attacker intercept or alter shared data and credentials in transit. TLS 1.2/1.3 with enforced certificate validation closes the channel.",
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
            "value": "T1001.003",
            "attributes": {}
        }
    ],
    "attack_vector": "ADJACENT"
}

man_in_the_middle_on_the_integration_channel[_man_in_the_middle_on_the_integration_channel_def] if {
    not input.connection_encrypted
}

man_in_the_middle_on_the_integration_channel[_man_in_the_middle_on_the_integration_channel_def] if {
    not input.upstream_tls_verification_enabled
}

man_in_the_middle_on_the_integration_channel[_man_in_the_middle_on_the_integration_channel_def] if {
    input.min_tls_version in ["tls1_0_or_tls1_1_or_sslv3_accepted"]
}

exposures contains _man_in_the_middle_on_the_integration_channel_def if {
    count(man_in_the_middle_on_the_integration_channel) > 0
}

_excessive_data_exposure_across_the_data_sharing_boundary_def := {
    "name": "Excessive data exposure across the data-sharing boundary",
    "description": "Sharing more data than needed (or the provider over-returning), without data minimization, residency restriction, or sub-processor control, widens the blast radius of a provider breach and creates regulatory (GDPR/PII) exposure outside the org's control. SA-9(5) location restriction and data minimization bound what leaves the boundary.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1537",
            "attributes": {
                "justification": "Data shared without minimization, residency restriction, or sub-processor control across the boundary corresponds to adversary transfer of data to an external/cloud account the org does not control, widening breach blast radius."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1030",
            "attributes": {
                "justification": "Absence of data minimization / size and field limits on what leaves the boundary aligns with the lack of data-transfer-size limits that lets bulk data egress to the provider unchecked."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

excessive_data_exposure_across_the_data_sharing_boundary[_excessive_data_exposure_across_the_data_sharing_boundary_def] if {
    not input.pii_minimized_to_purpose
}

excessive_data_exposure_across_the_data_sharing_boundary[_excessive_data_exposure_across_the_data_sharing_boundary_def] if {
    not input.dpa_and_subprocessors_reviewed
}

excessive_data_exposure_across_the_data_sharing_boundary[_excessive_data_exposure_across_the_data_sharing_boundary_def] if {
    not input.subprocessor_list_reviewed
}

excessive_data_exposure_across_the_data_sharing_boundary[_excessive_data_exposure_across_the_data_sharing_boundary_def] if {
    input.data_residency_restriction == "unrestricted"
}

exposures contains _excessive_data_exposure_across_the_data_sharing_boundary_def if {
    count(excessive_data_exposure_across_the_data_sharing_boundary) > 0
}

_availability_dependency_cascading_outage_def := {
    "name": "Availability dependency / cascading outage",
    "description": "A provider outage, rate-limit, or SLA breach with no timeout, circuit breaker, or fallback degrades or halts the dependent system \u2014 a single-vendor hard dependency cascades the failure. Bounded timeouts, a tripping circuit breaker, and graceful degradation fail fast instead.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499.003",
            "attributes": {
                "justification": "Application Exhaustion Flood \u2014 a provider-side exhaustion or rate-limit with no timeout/circuit-breaker exhausts the dependent system's resources (CVE-2023-44487 HTTP/2 rapid reset class)."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1489",
            "attributes": {
                "justification": "Service Stop \u2014 an unmitigated single-vendor hard dependency lets a provider outage halt the dependent service, the cascading-outage end state."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

availability_dependency_cascading_outage[_availability_dependency_cascading_outage_def] if {
    not input.request_timeout_configured
}

availability_dependency_cascading_outage[_availability_dependency_cascading_outage_def] if {
    not input.circuit_breaker_enabled
}

availability_dependency_cascading_outage[_availability_dependency_cascading_outage_def] if {
    not input.graceful_degradation_enabled
}

exposures contains _availability_dependency_cascading_outage_def if {
    count(availability_dependency_cascading_outage) > 0
}

_unmonitored_third_party_interactions_def := {
    "name": "Unmonitored third-party interactions",
    "description": "No logging of outbound calls and inbound callbacks (or secrets logged in cleartext) blinds anomaly detection and incident response, so credential abuse, forged callbacks, or provider compromise go undetected. Correlation-ID logging with credentials redacted and continuous provider monitoring (advisories, release notes) restore visibility.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1562.008",
            "attributes": {
                "justification": "Absent or tampered logging of third-party interactions (and cleartext secret logging) is the impaired-defense condition that lets adversaries Disable or Modify Cloud Logs / evade detection; without interaction logging the very telemetry this technique targets never exists, so credential abuse, forged callbacks, and provider compromise proceed undetected."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unmonitored_third_party_interactions[_unmonitored_third_party_interactions_def] if {
    not input.third_party_interaction_logging_enabled
}

unmonitored_third_party_interactions[_unmonitored_third_party_interactions_def] if {
    not input.secrets_masked_in_logs
}

unmonitored_third_party_interactions[_unmonitored_third_party_interactions_def] if {
    not input.provider_security_monitoring_enabled
}

exposures contains _unmonitored_third_party_interactions_def if {
    count(unmonitored_third_party_interactions) > 0
}
