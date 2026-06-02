package _dt_built_in.exposures.payment_service_provider



_leaked_or_over_privileged_api_key_def := {
    "name": "Leaked or over-privileged API key",
    "description": "A secret/restricted PSP key (sk_live_/rk_live_) embedded in client bundles or mobile apps, committed to a repo, or shared via chat \u2014 or a single unrestricted full-access key with no restricted-key scoping, no vault storage, no rotation, and test/live confusion \u2014 lets an attacker call the PSP API as us to create charges, refunds, or exfiltrate customer/transaction data. Mitigated by least-privilege restricted keys (rk_*), vault storage, secret scanning, IP allowlisting, periodic rotation, and strict test/live separation.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "A leaked or over-privileged PSP secret/restricted key is an unsecured credential an attacker harvests to call the PSP API as us."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Hard-coded sk_/rk_ keys in client code or committed source are credentials stored in files, directly discoverable via repo/bundle scanning."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {
                "justification": "The PSP is a trusted external entity; a compromised broad-scope key lets the attacker act as us against the PSP, abusing the trusted relationship."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

leaked_or_over_privileged_api_key[_leaked_or_over_privileged_api_key_def] if {
    not input.api_keys_not_in_client_code_or_repo
}

leaked_or_over_privileged_api_key[_leaked_or_over_privileged_api_key_def] if {
    not input.restricted_least_privilege_keys_used
}

leaked_or_over_privileged_api_key[_leaked_or_over_privileged_api_key_def] if {
    not input.api_keys_stored_in_secret_manager
}

leaked_or_over_privileged_api_key[_leaked_or_over_privileged_api_key_def] if {
    not input.api_keys_rotated_regularly
}

leaked_or_over_privileged_api_key[_leaked_or_over_privileged_api_key_def] if {
    not input.test_live_keys_separated
}

exposures contains _leaked_or_over_privileged_api_key_def if {
    count(leaked_or_over_privileged_api_key) > 0
}

_forged_or_unverified_webhook_events_def := {
    "name": "Forged or unverified webhook events",
    "description": "An attacker POSTs fabricated events (e.g. payment_intent.succeeded) to an endpoint that does not verify the Stripe-Signature v1 HMAC-SHA256 over the raw body with the whsec_ endpoint secret (no constructEvent/construct_event call, or verification over a parsed/modified body), fulfilling orders without payment. Mitigated by signature verification with the endpoint signing secret over the unmodified raw request body before any handling.",
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
                "justification": "Forging or replaying unverified webhook events POSTs crafted requests to the public-facing webhook handler to trigger fulfilment without payment."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565",
            "attributes": {
                "justification": "A forged payment_intent.succeeded event manipulates the application's payment/order state, falsifying that payment occurred."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1656",
            "attributes": {
                "justification": "An unsigned/unverified event lets the attacker impersonate the PSP (Stripe) as the trusted event source."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

forged_or_unverified_webhook_events[_forged_or_unverified_webhook_events_def] if {
    not input.webhook_signature_verified
}

forged_or_unverified_webhook_events[_forged_or_unverified_webhook_events_def] if {
    not input.webhook_endpoint_https_only
}

forged_or_unverified_webhook_events[_forged_or_unverified_webhook_events_def] if {
    not input.webhook_source_ip_allowlisted
}

exposures contains _forged_or_unverified_webhook_events_def if {
    count(forged_or_unverified_webhook_events) > 0
}

_webhook_replay_attack_def := {
    "name": "Webhook replay attack",
    "description": "A captured legitimate event with its valid Stripe-Signature is re-sent to re-trigger side effects; setting the timestamp tolerance to 0 (disabling the ~5-minute recency check), serving the endpoint over non-HTTPS, or omitting event.id deduplication enables it. Mitigated by keeping the default 5-minute tolerance, HTTPS-only endpoints, and idempotent event handling keyed on event.id.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565",
            "attributes": {
                "justification": "Replaying a captured signed event duplicates fulfilment / manipulates transaction state \u2014 data manipulation via the trusted webhook channel."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "The replay is delivered over the legitimate HTTPS webhook (web protocols) channel, blending with normal Stripe delivery traffic."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

webhook_replay_attack[_webhook_replay_attack_def] if {
    not input.webhook_replay_timestamp_tolerance_enforced
}

webhook_replay_attack[_webhook_replay_attack_def] if {
    not input.webhook_event_idempotency_enforced
}

exposures contains _webhook_replay_attack_def if {
    count(webhook_replay_attack) > 0
}

_cardholder_data_exposure_pci_scope_creep_def := {
    "name": "Cardholder data exposure / PCI scope creep",
    "description": "Accepting raw PAN server-side instead of tokenizing client-side via Stripe.js/Elements (or Checkout/hosted fields), letting raw PAN cross our server, or writing full PAN to application/access logs brings our environment fully into PCI scope (SAQ-D, 300+ controls) and creates a high-value breach target. Mitigated by client-side tokenization (server only sees pm_/tok_), never storing or logging PAN (PCI DSS Req 3.4 / Req 10), keeping SAQ-A scope.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1005",
            "attributes": {
                "justification": "Untokenized PAN handled/stored server-side becomes Data from Local System \u2014 cardholder data resident on our hosts is a direct collection target once the environment is breached."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Full PAN / sensitive auth data written to application and access logs is Unsecured Credentials In Files \u2014 sensitive financial secrets recoverable from on-disk log files."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1213",
            "attributes": {
                "justification": "Cardholder data stored at rest in our repositories/databases (rather than held only by the PSP) is Data from Information Repositories \u2014 a centralized store of sensitive payment data to mine."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

cardholder_data_exposure_pci_scope_creep[_cardholder_data_exposure_pci_scope_creep_def] if {
    not input.client_side_tokenization_used
}

cardholder_data_exposure_pci_scope_creep[_cardholder_data_exposure_pci_scope_creep_def] if {
    not input.raw_pan_not_stored
}

cardholder_data_exposure_pci_scope_creep[_cardholder_data_exposure_pci_scope_creep_def] if {
    not input.cardholder_data_not_logged
}

cardholder_data_exposure_pci_scope_creep[_cardholder_data_exposure_pci_scope_creep_def] if {
    not input.encrypted_at_rest
}

exposures contains _cardholder_data_exposure_pci_scope_creep_def if {
    count(cardholder_data_exposure_pci_scope_creep) > 0
}

_tls_downgrade_mitm_on_psp_transport_def := {
    "name": "TLS downgrade / MITM on PSP transport",
    "description": "Plaintext HTTP, TLS below 1.2, or disabled certificate verification (verify=False / rejectUnauthorized:false) on calls to the PSP API or payment pages lets an adversary-in-the-middle intercept tokens, credentials, and transaction data. Mitigated by TLS 1.2+ with a validated certificate chain and HTTPS-only resources for all server-to-PSP and webhook traffic.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {
                "justification": "Disabled certificate validation or a TLS downgrade lets an adversary-in-the-middle intercept and relay server-to-PSP traffic, capturing payment tokens and credentials in motion."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Plaintext HTTP or weak/un-validated TLS on the PSP transport exposes transaction data and tokens to network sniffing of the cleartext or downgraded channel."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

tls_downgrade_mitm_on_psp_transport[_tls_downgrade_mitm_on_psp_transport_def] if {
    not input.tls_only_transport
}

tls_downgrade_mitm_on_psp_transport[_tls_downgrade_mitm_on_psp_transport_def] if {
    input.weak_tls_versions_enabled == true
}

tls_downgrade_mitm_on_psp_transport[_tls_downgrade_mitm_on_psp_transport_def] if {
    input.min_tls_version in ["TLSv1.0", "TLSv1.1", "SSLv3"]
}

tls_downgrade_mitm_on_psp_transport[_tls_downgrade_mitm_on_psp_transport_def] if {
    not input.server_certificate_validated
}

exposures contains _tls_downgrade_mitm_on_psp_transport_def if {
    count(tls_downgrade_mitm_on_psp_transport) > 0
}

_double_charge_amount_tampering_via_missing_integrity_controls_def := {
    "name": "Double-charge / amount tampering via missing integrity controls",
    "description": "Without an Idempotency-Key header on mutating PSP requests, network-error retries create duplicate charges; trusting a client-supplied amount or currency to set the charge lets a buyer pay an attacker-chosen price. Mitigated by an Idempotency-Key (V4 UUID or order-derived) on every POST and authoritative server-side computation of amount/currency from trusted order data.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1565.001",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

double_charge_amount_tampering_via_missing_integrity_controls[_double_charge_amount_tampering_via_missing_integrity_controls_def] if {
    not input.idempotency_key_used_on_charges
}

double_charge_amount_tampering_via_missing_integrity_controls[_double_charge_amount_tampering_via_missing_integrity_controls_def] if {
    not input.amount_currency_validated_server_side
}

double_charge_amount_tampering_via_missing_integrity_controls[_double_charge_amount_tampering_via_missing_integrity_controls_def] if {
    not input.order_total_not_client_trusted
}

exposures contains _double_charge_amount_tampering_via_missing_integrity_controls_def if {
    count(double_charge_amount_tampering_via_missing_integrity_controls) > 0
}

_payment_fraud_via_missing_sca_3ds_def := {
    "name": "Payment fraud via missing SCA / 3DS",
    "description": "Card-not-present fraud and chargebacks rise where 3D Secure 2 / PSD2 Strong Customer Authentication is not applied to in-scope card payments, where no velocity/anomaly fraud rules exist, or where SCA exemptions are misapplied \u2014 shifting liability to the merchant. Mitigated by enforcing 3DS2/SCA via the PaymentIntents next_action flow, active fraud/velocity controls, and deliberate exemption use.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

payment_fraud_via_missing_sca_3ds[_payment_fraud_via_missing_sca_3ds_def] if {
    not input.three_ds_sca_enforced
}

payment_fraud_via_missing_sca_3ds[_payment_fraud_via_missing_sca_3ds_def] if {
    not input.fraud_velocity_anomaly_checks_enabled
}

payment_fraud_via_missing_sca_3ds[_payment_fraud_via_missing_sca_3ds_def] if {
    not input.sca_exemptions_applied_deliberately
}

exposures contains _payment_fraud_via_missing_sca_3ds_def if {
    count(payment_fraud_via_missing_sca_3ds) > 0
}

_trusted_relationship_abuse_of_the_psp_integration_def := {
    "name": "Trusted-relationship abuse of the PSP integration",
    "description": "Because the PSP is a trusted external entity, a long-lived broad-scope bearer token (no OAuth2 client-credentials / mTLS-bound short-lived tokens per RFC 8705, no IP allowlist) or compromised integration credentials are leveraged to act as us against the PSP and pivot into financial operations. Mitigated by least-privilege restricted keys, short-lived certificate-bound OAuth2/mTLS tokens, and source-IP allowlisting.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1199",
            "attributes": {
                "justification": "The PSP integration is a trusted external relationship; long-lived static credentials, no IP allowlist, and over-broad trust scope let a compromise of the integration be leveraged to act as us against the PSP and pivot into financial operations."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "Static long-lived PSP credentials usable from any source IP are valid accounts an attacker reuses to operate within the trusted relationship undetected."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

trusted_relationship_abuse_of_the_psp_integration[_trusted_relationship_abuse_of_the_psp_integration_def] if {
    not input.psp_auth_short_lived_tokens_or_mtls
}

trusted_relationship_abuse_of_the_psp_integration[_trusted_relationship_abuse_of_the_psp_integration_def] if {
    not input.psp_integration_ip_allowlisted
}

trusted_relationship_abuse_of_the_psp_integration[_trusted_relationship_abuse_of_the_psp_integration_def] if {
    not input.least_privilege_access_enforced
}

trusted_relationship_abuse_of_the_psp_integration[_trusted_relationship_abuse_of_the_psp_integration_def] if {
    not input.psp_trust_scope_least_privilege
}

exposures contains _trusted_relationship_abuse_of_the_psp_integration_def if {
    count(trusted_relationship_abuse_of_the_psp_integration) > 0
}

_transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def := {
    "name": "Transaction-data exfiltration over the PSP channel without audit trail",
    "description": "Stolen API credentials or a compromised integration pull customer and transaction data out over the legitimate HTTPS PSP API/webhook channel, blending with normal traffic, while the absence of a PCI Req 10 audit trail, webhook event log, alerting, or documented data residency/retention controls leaves the exfiltration undetected and residency obligations unmet. Mitigated by least-privilege keys, complete time-synced audit logging of payment ops and webhook event IDs (no CHD in logs), anomaly alerting, and documented residency/minimization (tokens + last4/brand/exp only).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567",
            "attributes": {
                "justification": "Stolen PSP credentials or a compromised integration pull customer/transaction data out over the legitimate HTTPS PSP API/webhook (web service) channel; absence of PCI Req 10 audit trail and anomaly alerting lets it go undetected."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1071.001",
            "attributes": {
                "justification": "Exfiltration blends with normal traffic by riding the trusted application-layer HTTPS web protocol of the PSP integration, evading transport-level distinction without dedicated audit logging and alerting."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

transaction_data_exfiltration_over_the_psp_channel_without_audit_trail[_transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def] if {
    not input.transaction_audit_trail_enabled
}

transaction_data_exfiltration_over_the_psp_channel_without_audit_trail[_transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def] if {
    not input.anomaly_alerting_on_payment_events
}

transaction_data_exfiltration_over_the_psp_channel_without_audit_trail[_transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def] if {
    input.log_retention_days < 365
}

transaction_data_exfiltration_over_the_psp_channel_without_audit_trail[_transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def] if {
    not input.payment_data_residency_pinned
}

exposures contains _transaction_data_exfiltration_over_the_psp_channel_without_audit_trail_def if {
    count(transaction_data_exfiltration_over_the_psp_channel_without_audit_trail) > 0
}
