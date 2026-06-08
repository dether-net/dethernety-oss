package _dt_built_in.exposures.ldap_directory_access



_anonymous_unauthenticated_bind_directory_disclosure_def := {
    "name": "Anonymous / unauthenticated bind directory disclosure",
    "description": "The flow asserts that crossing into the directory establishes an authenticated identity, but if anonymous bind is permitted (or anonymous reads are answered because 'require authc' is absent) an unauthenticated network client enumerates the entire DIT \u2014 users, groups, emails, sometimes hashes. RFC 4513 \u00a75.1.2 unauthenticated bind (real DN + zero-length password) silently authenticates as the named DN on lax servers/clients, a direct authentication bypass.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1087",
            "attributes": {
                "justification": "Anonymous/unauthenticated bind lets an attacker enumerate the directory (users, groups, emails) \u2014 Account Discovery."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "RFC 4513 \u00a75.1.2 unauthenticated bind (real DN + zero-length password) silently authenticates as the DN on lax servers \u2014 Valid Accounts / auth bypass."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

anonymous_unauthenticated_bind_directory_disclosure[_anonymous_unauthenticated_bind_directory_disclosure_def] if {
    not input.anonymous_bind_disabled
}

anonymous_unauthenticated_bind_directory_disclosure[_anonymous_unauthenticated_bind_directory_disclosure_def] if {
    not input.directory_access_requires_authentication
}

anonymous_unauthenticated_bind_directory_disclosure[_anonymous_unauthenticated_bind_directory_disclosure_def] if {
    not input.unauthenticated_empty_password_bind_rejected
}

exposures contains _anonymous_unauthenticated_bind_directory_disclosure_def if {
    count(anonymous_unauthenticated_bind_directory_disclosure) > 0
}

_cleartext_ldap_bind_credential_exposure_starttls_downgrade_def := {
    "name": "Cleartext LDAP bind credential exposure / StartTLS downgrade",
    "description": "Simple bind over ldap://389 without enforced TLS sends the bind DN and password (and userPassword on writes) in plaintext across the wire; a network attacker sniffs the credential or MITMs/downgrades an optional StartTLS. The flow fails its confidentiality attestation unless olcSecurity ssf/minssf refuses plaintext binds and ldaps://636 is mandatory.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.4,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

cleartext_ldap_bind_credential_exposure_starttls_downgrade[_cleartext_ldap_bind_credential_exposure_starttls_downgrade_def] if {
    not input.encryption_in_transit_enabled
}

cleartext_ldap_bind_credential_exposure_starttls_downgrade[_cleartext_ldap_bind_credential_exposure_starttls_downgrade_def] if {
    not input.ldap_tls_required
}

cleartext_ldap_bind_credential_exposure_starttls_downgrade[_cleartext_ldap_bind_credential_exposure_starttls_downgrade_def] if {
    not input.starttls_downgrade_prevented
}

exposures contains _cleartext_ldap_bind_credential_exposure_starttls_downgrade_def if {
    count(cleartext_ldap_bind_credential_exposure_starttls_downgrade) > 0
}

_weak_legacy_tls_on_the_directory_channel_def := {
    "name": "Weak/legacy TLS on the directory channel",
    "description": "Even with TLS enabled, permissive cipher lists or old protocol versions (NULL/RC4/DES/export, TLS 1.0) leave the encrypted bind channel breakable, defeating the confidentiality the flow appears to guarantee. olcTLSCipherSuite / olcTLSProtocolMin must constrain negotiation to TLS 1.2+ strong ciphers.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1557",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

weak_legacy_tls_on_the_directory_channel[_weak_legacy_tls_on_the_directory_channel_def] if {
    input.tls_min_version in ["SSLv3", "TLS1.0", "TLS1.1"]
}

weak_legacy_tls_on_the_directory_channel[_weak_legacy_tls_on_the_directory_channel_def] if {
    not input.weak_tls_ciphers_disabled
}

exposures contains _weak_legacy_tls_on_the_directory_channel_def if {
    count(weak_legacy_tls_on_the_directory_channel) > 0
}

_ldap_injection_via_unescaped_search_filters_dns_def := {
    "name": "LDAP injection via unescaped search filters / DNs",
    "description": "User input concatenated into a search filter or DN without RFC 4515/4514 escaping lets an attacker inject filter metachars (uid=*, )(uid=*) to bypass authentication or broaden the filter into full-tree disclosure. This is an application-side property of the flow; mitigated by parameterized filter templates or filter/DN encoders.",
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
                "justification": "Unescaped user input concatenated into an LDAP search filter or DN lets an attacker inject filter metacharacters to bypass authentication or broaden a query into full-tree disclosure on a network-facing application \u2014 Exploit Public-Facing Application."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

ldap_injection_via_unescaped_search_filters_dns[_ldap_injection_via_unescaped_search_filters_dns_def] if {
    not input.ldap_search_filter_input_escaped
}

ldap_injection_via_unescaped_search_filters_dns[_ldap_injection_via_unescaped_search_filters_dns_def] if {
    not input.parameterized_filter_templates_used
}

ldap_injection_via_unescaped_search_filters_dns[_ldap_injection_via_unescaped_search_filters_dns_def] if {
    not input.dn_input_escaped
}

exposures contains _ldap_injection_via_unescaped_search_filters_dns_def if {
    count(ldap_injection_via_unescaped_search_filters_dns) > 0
}

_over_permissive_directory_acl_userpassword_hash_disclosure_def := {
    "name": "Over-permissive directory ACL / userPassword hash disclosure",
    "description": "A catch-all 'access to * by * read' or a missing dedicated userPassword rule exposes the whole DIT \u2014 and password hashes \u2014 to anonymous or low-privilege clients for reconnaissance and offline cracking. ACLs must scope read to required principals, terminate in 'by * none', and gate userPassword to 'self =xw / anonymous auth'.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1087",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

over_permissive_directory_acl_userpassword_hash_disclosure[_over_permissive_directory_acl_userpassword_hash_disclosure_def] if {
    not input.directory_acl_least_privilege
}

over_permissive_directory_acl_userpassword_hash_disclosure[_over_permissive_directory_acl_userpassword_hash_disclosure_def] if {
    not input.userpassword_attribute_read_restricted
}

over_permissive_directory_acl_userpassword_hash_disclosure[_over_permissive_directory_acl_userpassword_hash_disclosure_def] if {
    not input.whole_tree_anonymous_read_disabled
}

exposures contains _over_permissive_directory_acl_userpassword_hash_disclosure_def if {
    count(over_permissive_directory_acl_userpassword_hash_disclosure) > 0
}

_privileged_bind_dn_credential_in_app_config_def := {
    "name": "Privileged bind-DN credential in app config",
    "description": "A service bind-DN password stored plaintext in application config/env is a high-value secret; leaking it grants the app's (often broad) directory privileges. An over-privileged bind account widens the blast radius of any theft. Mitigated by a secret store, a least-privileged read-only bind account, rotation, or SASL/cert bind.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552.001",
            "attributes": {
                "justification": "Plaintext bind-DN password in application config/env is a credential stored in a file, retrievable by an attacker with local/config access."
            }
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078",
            "attributes": {
                "justification": "A leaked privileged bind-DN credential is used as a valid directory account, granting the app's (often broad) LDAP privileges."
            }
        }
    ],
    "attack_vector": "LOCAL"
}

privileged_bind_dn_credential_in_app_config[_privileged_bind_dn_credential_in_app_config_def] if {
    input.bind_dn_credentials_stored_plaintext_in_config == true
}

privileged_bind_dn_credential_in_app_config[_privileged_bind_dn_credential_in_app_config_def] if {
    not input.bind_dn_credentials_externalized
}

privileged_bind_dn_credential_in_app_config[_privileged_bind_dn_credential_in_app_config_def] if {
    not input.bind_account_least_privilege_readonly
}

exposures contains _privileged_bind_dn_credential_in_app_config_def if {
    count(privileged_bind_dn_credential_in_app_config) > 0
}

_weak_password_hash_storage_scheme_def := {
    "name": "Weak password-hash storage scheme",
    "description": "When the directory stores credentials, cleartext userPassword or an unsalted/weak {CRYPT} scheme means any hash leak yields trivially-cracked passwords. olcPasswordHash must use a salted strong scheme ({SSHA}, argon2, or bcrypt).",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Cleartext or weak/unsalted userPassword storage leaves credential material recoverable from any directory/hash disclosure (Unsecured Credentials)."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

weak_password_hash_storage_scheme[_weak_password_hash_storage_scheme_def] if {
    input.userpassword_hash_scheme in ["sha", "crypt", "cleartext"]
}

exposures contains _weak_password_hash_storage_scheme_def if {
    count(weak_password_hash_storage_scheme) > 0
}

_missing_lockout_unbounded_search_brute_force_resource_exhaustion_def := {
    "name": "Missing lockout / unbounded search (brute-force & resource exhaustion)",
    "description": "Without ppolicy lockout (pwdLockout/pwdMaxFailure) the bind endpoint allows unlimited credential brute-force and password spray; without bounded olcSizeLimit/olcTimeLimit/olcLimits a single client can exhaust server resources or mass-exfiltrate the entire DIT in one query. Both are availability attestations of the flow.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1110",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        }
    ],
    "attack_vector": "NETWORK"
}

missing_lockout_unbounded_search_brute_force_resource_exhaustion[_missing_lockout_unbounded_search_brute_force_resource_exhaustion_def] if {
    not input.account_lockout_policy_enabled
}

missing_lockout_unbounded_search_brute_force_resource_exhaustion[_missing_lockout_unbounded_search_brute_force_resource_exhaustion_def] if {
    not input.search_size_and_time_limits_bounded
}

exposures contains _missing_lockout_unbounded_search_brute_force_resource_exhaustion_def if {
    count(missing_lockout_unbounded_search_brute_force_resource_exhaustion) > 0
}
