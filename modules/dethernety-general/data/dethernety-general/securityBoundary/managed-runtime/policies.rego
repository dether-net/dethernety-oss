package _dt_built_in.exposures.managed_runtime



_unauthenticated_public_invocation_def := {
    "name": "Unauthenticated invocation of an internet-reachable workload",
    "description": "The workload's endpoint is reachable from the internet and the platform does not authenticate invocations, or an alternate route reaches the code without the authentication gate, so any internet client reaches the organization's code and its flaws become the entry point.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "This condition requires an internet-reachable endpoint. With no platform authentication, or with a gate that can be bypassed, the organization's code is an internet-facing application that any client can exploit. This is Exploit Public-Facing Application."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unauthenticated_public_invocation[_unauthenticated_public_invocation_def] if {
    input.public_endpoint_exposed == true
    not input.invocation_authentication_required
}

unauthenticated_public_invocation[_unauthenticated_public_invocation_def] if {
    input.public_endpoint_exposed == true
    not input.invocation_path_non_bypassable
}

exposures contains _unauthenticated_public_invocation_def if {
    count(unauthenticated_public_invocation) > 0
}

_authenticated_but_unauthorised_callers_def := {
    "name": "Invocation by any authenticated identity",
    "description": "Callers are not restricted to the intended ones. Any account of the identity provider, any holder of a valid token for it, or, on a non-public workload, anyone who can reach it can invoke the workload.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "Any cloud account of the identity provider is accepted as a caller. An adversary holding any such account invokes the workload through a valid cloud account. This is Valid Accounts: Cloud Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

authenticated_but_unauthorised_callers[_authenticated_but_unauthorised_callers_def] if {
    input.public_endpoint_exposed == true
    not object.get(input, "invocation_authentication_required", null) in [false]
    not input.invocation_authorization_scoped
}

authenticated_but_unauthorised_callers[_authenticated_but_unauthorised_callers_def] if {
    not object.get(input, "public_endpoint_exposed", null) in [true]
    not input.invocation_authorization_scoped
}

exposures contains _authenticated_but_unauthorised_callers_def if {
    count(authenticated_but_unauthorised_callers) > 0
}

_deployment_endpoint_takeover_def := {
    "name": "Deployment takeover with long-lived publishing credentials",
    "description": "The platform's deployment endpoint accepts long-lived publishing passwords, or the container registry has an admin user enabled. Whoever obtains a working password can push code into the runtime, and a publishing password also opens its console and file browser.",
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
                "justification": "A basic publishing credential belongs to an account on the cloud platform's deployment endpoint, and a container registry admin user is an account on its registry. An adversary who obtains and reuses either password holds a valid cloud account on that endpoint or registry: a publishing password deploys code straight into the runtime, and a registry admin pushes images the runtime runs the next time it pulls them. This is Valid Accounts: Cloud Accounts."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

deployment_endpoint_takeover[_deployment_endpoint_takeover_def] if {
    not input.deployment_basic_credentials_disabled
}

exposures contains _deployment_endpoint_takeover_def if {
    count(deployment_endpoint_takeover) > 0
}

_unfiltered_workload_egress_def := {
    "name": "Unfiltered egress from deployed code",
    "description": "Code running on the vendor's default network, or without an egress allowlist, can send data to any internet destination, including attacker-controlled cloud storage.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1567.002",
            "attributes": {
                "justification": "This condition lets data leave for any internet destination, including attacker-controlled cloud storage. This is Exfiltration Over Web Service: Exfiltration to Cloud Storage."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unfiltered_workload_egress[_unfiltered_workload_egress_def] if {
    not input.private_network_attached
}

unfiltered_workload_egress[_unfiltered_workload_egress_def] if {
    not input.egress_default_deny_enforced
}

exposures contains _unfiltered_workload_egress_def if {
    count(unfiltered_workload_egress) > 0
}

_over_privileged_execution_identity_def := {
    "name": "Over-privileged execution identity",
    "description": "The workload runs as a shared or default identity with broad rights, so anyone who runs code in it, through a flaw or a malicious dependency, acts with those rights across the cloud account.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.7,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1078.004",
            "attributes": {
                "justification": "The execution identity is a cloud identity whose credentials the platform hands to the running code. An adversary with code execution in the workload gains a valid cloud account with the identity's broad rights."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

over_privileged_execution_identity[_over_privileged_execution_identity_def] if {
    not input.execution_identity_least_privilege
}

exposures contains _over_privileged_execution_identity_def if {
    count(over_privileged_execution_identity) > 0
}

_privileged_identity_attachment_def := {
    "name": "Privilege escalation through a workload's privileged identity",
    "description": "Principals who can deploy code into a workload that runs as a more privileged identity, or attach such an identity to a workload they can deploy to, can run arbitrary code with its rights.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1648",
            "attributes": {
                "justification": "Serverless Execution covers abusing serverless and managed compute to run arbitrary code, including giving a function a more privileged role through pass-role style permissions. Updating the code of a function that already runs as such a role reaches the same rights without that permission."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

privileged_identity_attachment[_privileged_identity_attachment_def] if {
    not input.execution_identity_attachment_restricted
}

exposures contains _privileged_identity_attachment_def if {
    count(privileged_identity_attachment) > 0
}

_secrets_exposed_in_configuration_def := {
    "name": "Secrets exposed in environment variables or code",
    "description": "Credentials stored as literal environment variables, app settings or in the image are returned to anyone with configuration-read rights, and are read by any code that runs in the workload.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1552",
            "attributes": {
                "justification": "Credentials held as plain configuration values or embedded in code are Unsecured Credentials. An adversary with read access to the configuration, or with code execution in the workload, collects them."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

secrets_exposed_in_configuration[_secrets_exposed_in_configuration_def] if {
    not input.secrets_stored_in_dedicated_secret_manager
}

exposures contains _secrets_exposed_in_configuration_def if {
    count(secrets_exposed_in_configuration) > 0
}

_untrusted_third_party_artifact_def := {
    "name": "Compromised third-party artifact run in the workload",
    "description": "Images, packages or layers pulled from public or third-party sources without signature enforcement run whatever their publisher, or an attacker who compromised the publisher, put in them.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1195.002",
            "attributes": {
                "justification": "This condition is a third-party source, where the artifact can be manipulated before the organization receives it. This is Supply Chain Compromise: Compromise Software Supply Chain."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

untrusted_third_party_artifact[_untrusted_third_party_artifact_def] if {
    not input.artifact_source_org_controlled
    not input.artifact_signature_verified_at_deploy
}

exposures contains _untrusted_third_party_artifact_def if {
    count(untrusted_third_party_artifact) > 0
}

_unverified_internal_artifact_def := {
    "name": "Backdoored image in the organization's own registry",
    "description": "Artifacts come from the organization's own registry but their signatures are not enforced, so an adversary with write access to the registry can replace an image the runtime pulls.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
            "attributes": {
                "justification": "This condition is the organization's own registry. An adversary with write access implants a backdoored image that the runtime later pulls. This is Implant Internal Image."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unverified_internal_artifact[_unverified_internal_artifact_def] if {
    input.artifact_source_org_controlled == true
    not input.artifact_signature_verified_at_deploy
}

exposures contains _unverified_internal_artifact_def if {
    count(unverified_internal_artifact) > 0
}

_unsupported_runtime_exploited_def := {
    "name": "Exploitation of an unsupported runtime on a public endpoint",
    "description": "A deprecated runtime or stale base image keeps running without security patches, and its internet-reachable endpoint exposes the unpatched flaws.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 7.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1190",
            "attributes": {
                "justification": "This condition requires an internet-reachable endpoint. Unpatched runtime flaws behind a public endpoint are exploited through Exploit Public-Facing Application."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unsupported_runtime_exploited[_unsupported_runtime_exploited_def] if {
    not input.runtime_version_supported
    input.public_endpoint_exposed == true
}

exposures contains _unsupported_runtime_exploited_def if {
    count(unsupported_runtime_exploited) > 0
}

_workload_log_trail_silenced_def := {
    "name": "Workload log trail silenced",
    "description": "Identities close to the workload can remove its log-write permissions, add exclusion filters or delete its sinks, hiding what an adversary does in it.",
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
                "justification": "Disable or Modify Cloud Log covers disabling or changing cloud logging and its integrations to avoid detection. Log routing that identities near the workload can change is the posture that lets them do it."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

workload_log_trail_silenced[_workload_log_trail_silenced_def] if {
    not input.log_pipeline_tamper_resistant
}

exposures contains _workload_log_trail_silenced_def if {
    count(workload_log_trail_silenced) > 0
}

_workload_logs_not_kept_def := {
    "name": "Workload logs not kept by the organization",
    "description": "The platform's logs for the workload stay only in default vendor-side locations or are not collected, so its activity cannot be investigated with the organization's own retention.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

workload_logs_not_kept[_workload_logs_not_kept_def] if {
    not input.platform_logs_exported_to_org_store
}

exposures contains _workload_logs_not_kept_def if {
    count(workload_logs_not_kept) > 0
}

_unbounded_workload_scaling_def := {
    "name": "Unbounded scaling and cost",
    "description": "Without a ceiling on scale-out or session lifetime, abusive or unauthenticated invocation drives instance counts up to the platform or account limit, and cost with them, and can starve other workloads.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {
                "justification": "With no ceiling set on scale-out or session lifetime, repeated abusive or unauthenticated invocations can use up the account or platform capacity the workload shares and starve other workloads. This is Endpoint Denial of Service."
            }
        }
    ],
    "attack_vector": "NETWORK"
}

unbounded_workload_scaling[_unbounded_workload_scaling_def] if {
    not input.resource_ceiling_configured
}

exposures contains _unbounded_workload_scaling_def if {
    count(unbounded_workload_scaling) > 0
}

_plaintext_http_on_public_endpoint_def := {
    "name": "Plaintext HTTP accepted on a public endpoint",
    "description": "The workload's internet-reachable endpoint serves requests over plain HTTP instead of refusing them or redirecting them to HTTPS. Credentials, tokens and data in any request a client sends to an http:// address therefore cross the network unencrypted, and anyone on the network path can read them.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1040",
            "attributes": {
                "justification": "Network Sniffing depends on this condition. ATT&CK says captured data 'may include user credentials, especially those sent over an insecure, unencrypted protocol'. Plain HTTP on the public endpoint is that protocol for every bearer token, cookie or API key a client sends to it."
            }
        }
    ],
    "attack_vector": "ADJACENT"
}

plaintext_http_on_public_endpoint[_plaintext_http_on_public_endpoint_def] if {
    input.public_endpoint_exposed == true
    not input.tls_only_transport
}

exposures contains _plaintext_http_on_public_endpoint_def if {
    count(plaintext_http_on_public_endpoint) > 0
}

_deployment_site_internet_reachable_def := {
    "name": "Deployment and management site reachable from the internet",
    "description": "The platform's deployment and management site (the advanced-tools site) accepts connections from the internet. Any caller still needs a credential, but a publishing password or a deploy-capable identity then reaches the site's console, file browser and deployment API from any network. Closing the site has two limits. A deploy-capable identity can still deploy and change the site's restrictions through the management API. FTP, which access restrictions cannot close, still accepts publishing passwords while basic credentials are enabled. Disabling basic credentials and limiting deploy roles remain the primary controls.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.3,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

deployment_site_internet_reachable[_deployment_site_internet_reachable_def] if {
    not input.edge_management_interfaces_not_internet_reachable
}

exposures contains _deployment_site_internet_reachable_def if {
    count(deployment_site_internet_reachable) > 0
}
