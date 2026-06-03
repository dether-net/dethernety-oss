package _dt_built_in.exposures.container



_privileged_mode_excessive_capabilities_def := {
    "name": "Privileged mode / excessive capabilities",
    "description": "The sandbox is privileged (--privileged dissolves seccomp/MAC/all caps + device access) or re-adds dangerous capabilities (CAP_SYS_ADMIN/CAP_SYS_PTRACE/CAP_SYS_MODULE/CAP_DAC_READ_SEARCH) \u2014 each a direct container-escape-to-host-root primitive.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.3,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

privileged_mode_excessive_capabilities[_privileged_mode_excessive_capabilities_def] if {
    not input.container_privileged_mode_disabled
}

privileged_mode_excessive_capabilities[_privileged_mode_excessive_capabilities_def] if {
    not input.container_capabilities_dropped_to_minimal
}

exposures contains _privileged_mode_excessive_capabilities_def if {
    count(privileged_mode_excessive_capabilities) > 0
}

_host_namespace_sharing_and_sensitive_mounts_def := {
    "name": "Host namespace sharing & sensitive host bind-mounts",
    "description": "PidMode/IpcMode/NetworkMode=host collapse namespace isolation, or host /, /proc, /sys, or especially /var/run/docker.sock is bind-mounted \u2014 the Docker socket grants full daemon control and trivial host takeover with no kernel bug.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9.6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1610",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

host_namespace_sharing_and_sensitive_mounts[_host_namespace_sharing_and_sensitive_mounts_def] if {
    not input.container_host_namespaces_not_shared
}

host_namespace_sharing_and_sensitive_mounts[_host_namespace_sharing_and_sensitive_mounts_def] if {
    not input.container_no_sensitive_host_mounts
}

exposures contains _host_namespace_sharing_and_sensitive_mounts_def if {
    count(host_namespace_sharing_and_sensitive_mounts) > 0
}

_weak_kernel_sharing_confinement_def := {
    "name": "Weak kernel-sharing confinement",
    "description": "Defence-in-depth confinement broken: seccomp=unconfined, AppArmor/SELinux unconfined/disabled, no-new-privileges absent, or running as root with no userns-remap (container-root == host-root) \u2014 the precondition stack for cgroup release_agent escape and in-container setuid privesc.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.2,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1068",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

weak_kernel_sharing_confinement[_weak_kernel_sharing_confinement_def] if {
    not input.container_seccomp_and_mac_profile_enforced
}

weak_kernel_sharing_confinement[_weak_kernel_sharing_confinement_def] if {
    not input.container_no_new_privileges_and_nonroot
}

exposures contains _weak_kernel_sharing_confinement_def if {
    count(weak_kernel_sharing_confinement) > 0
}

_unpatched_container_runtime_def := {
    "name": "Unpatched container runtime",
    "description": "An out-of-date runc allows escape to host root \u2014 CVE-2019-5736 (/proc/self/exe overwrite of host runc) and CVE-2024-21626 (leaked fd \u2192 working dir in host fs; fixed runc 1.1.12). Either yields host root from inside the sandbox.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "critical",
    "score": 9,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1611",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

unpatched_container_runtime[_unpatched_container_runtime_def] if {
    not input.container_runtime_patch_current
}

exposures contains _unpatched_container_runtime_def if {
    count(unpatched_container_runtime) > 0
}

_writable_root_filesystem_def := {
    "name": "Writable root filesystem / weak post-compromise hardening",
    "description": "ReadonlyRootfs=false leaves the entire image filesystem mutable at runtime, so an attacker with code execution can persist tooling, overwrite in-container binaries, or stage the binary-overwrite step of runc-escape CVEs.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 5.5,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1222",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1610",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

writable_root_filesystem[_writable_root_filesystem_def] if {
    not input.container_readonly_root_filesystem
}

exposures contains _writable_root_filesystem_def if {
    count(writable_root_filesystem) > 0
}

_missing_cgroup_resource_limits_def := {
    "name": "Missing cgroup resource limits (noisy-neighbour DoS)",
    "description": "Without memory, CPU, and PIDs cgroup limits a single container can exhaust host RAM (OOM-kill neighbours), starve CPU, or fork-bomb host PIDs \u2014 denying service to every other workload sharing the host.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "medium",
    "score": 6,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1499",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1496",
            "attributes": {}
        }
    ],
    "attack_vector": "LOCAL"
}

missing_cgroup_resource_limits[_missing_cgroup_resource_limits_def] if {
    not input.container_resource_limits_enforced
}

exposures contains _missing_cgroup_resource_limits_def if {
    count(missing_cgroup_resource_limits) > 0
}

_untrusted_unverified_image_def := {
    "name": "Untrusted / unverified image at the supply-chain boundary",
    "description": "Image not pinned to an immutable @sha256 digest (a mutable :latest tag can be re-pointed to a malicious build), signature/content-trust unverified (no Cosign/Sigstore or DOCKER_CONTENT_TRUST=1), or secrets baked into layers \u2014 letting untrusted or credential-leaking code into the sandbox regardless of runtime hardening.",
    "type": "misconfiguration",
    "category": "",
    "criticality": "high",
    "score": 8.1,
    "exploited_by": [
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1610",
            "attributes": {}
        },
        {
            "label": "MitreAttackTechnique",
            "property": "attack_id",
            "value": "T1525",
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

untrusted_unverified_image[_untrusted_unverified_image_def] if {
    not input.container_image_pinned_and_signature_verified
}

untrusted_unverified_image[_untrusted_unverified_image_def] if {
    not input.container_image_free_of_embedded_secrets
}

exposures contains _untrusted_unverified_image_def if {
    count(untrusted_unverified_image) > 0
}
