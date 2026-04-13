package _dt_built_in.exposures.network_file_system_nfs

_unrestricted_export_scope_def := {
    "name": "Unrestricted Export Scope",
    "description": "NFS exports configured with wildcard hosts (e.g., '*' or '0.0.0.0/0') in /etc/exports allow any host on the network or internet to mount the share, exposing file contents to unauthorized clients.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unrestricted_export_scope[_unrestricted_export_scope_def] if {
    input.export_host_spec == "*"
}

unrestricted_export_scope[_unrestricted_export_scope_def] if {
    input.export_host_spec == "0.0.0.0/0"
}

unrestricted_export_scope[_unrestricted_export_scope_def] if {
    startswith(input.export_host_spec, "*.")
}

exposures contains _unrestricted_export_scope_def if {
    count(unrestricted_export_scope) > 0
}

_no_auth_sys_replacement_with_kerberos_def := {
    "name": "No Auth Sys Replacement With Kerberos",
    "description": "NFS using AUTH_SYS (AUTH_UNIX) relies solely on client-reported UIDs/GIDs with no cryptographic verification, allowing any client with root access to impersonate any user. NFSv4 with Kerberos (krb5, krb5i, krb5p) provides cryptographic authentication.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

no_auth_sys_replacement_with_kerberos[_no_auth_sys_replacement_with_kerberos_def] if {
    "sys" in input.nfs_security_flavors
    not "krb5" in input.nfs_security_flavors
    not "krb5i" in input.nfs_security_flavors
    not "krb5p" in input.nfs_security_flavors
}

no_auth_sys_replacement_with_kerberos[_no_auth_sys_replacement_with_kerberos_def] if {
    input.nfs_version in ["4", "4.1", "4.2"]
    "sys" in input.nfs_security_flavors
    not input.kerberos_realm_configured
}

exposures contains _no_auth_sys_replacement_with_kerberos_def if {
    count(no_auth_sys_replacement_with_kerberos) > 0
}

_root_squash_disabled_def := {
    "name": "Root Squash Disabled",
    "description": "Exporting shares without 'root_squash' (or with 'no_root_squash') allows a remote root user on a client to act as root on the NFS server, granting full control over exported file system contents.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

root_squash_disabled[_root_squash_disabled_def] if {
    input.no_root_squash_enabled == true
}

root_squash_disabled[_root_squash_disabled_def] if {
    not input.root_squash_explicitly_set
}

exposures contains _root_squash_disabled_def if {
    count(root_squash_disabled) > 0
}

_missing_transport_encryption_def := {
    "name": "Missing Transport Encryption",
    "description": "NFS traffic transmitted without encryption (e.g., not using NFSv4 over TLS/RPCSEC_GSS with krb5p, or not tunneled through VPN/stunnel) exposes file contents and credentials to interception on the network path.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

missing_transport_encryption[_missing_transport_encryption_def] if {
    input.nfs_version in ["NFSv2", "NFSv3"]
    not input.tunnel_encryption_in_use
}

missing_transport_encryption[_missing_transport_encryption_def] if {
    input.nfs_version in ["NFSv4", "NFSv4.1", "NFSv4.2"]
    not input.rpcsec_gss_krb5p_enabled
    not input.tunnel_encryption_in_use
}

exposures contains _missing_transport_encryption_def if {
    count(missing_transport_encryption) > 0
}

_write_permission_on_sensitive_exports_def := {
    "name": "Write Permission On Sensitive Exports",
    "description": "Exports configured as read-write (rw) when read-only (ro) is sufficient grant clients the ability to modify, overwrite, or delete files, increasing the blast radius of compromised or rogue clients.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "high",
    "score": 8,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

write_permission_on_sensitive_exports[_write_permission_on_sensitive_exports_def] if {
    input.export_access_mode == "rw"
    input.export_path_is_sensitive == true
    input.client_scope == "world"
}

write_permission_on_sensitive_exports[_write_permission_on_sensitive_exports_def] if {
    input.export_access_mode == "rw"
    input.export_path_is_sensitive == true
    input.client_scope == "subnet"
}

exposures contains _write_permission_on_sensitive_exports_def if {
    count(write_permission_on_sensitive_exports) > 0
}

_nfs_service_exposed_on_public_interface_def := {
    "name": "Nfs Service Exposed On Public Interface",
    "description": "The NFS daemon (and associated RPC services: rpcbind, mountd, statd) bound to all network interfaces including public-facing ones, rather than restricted to internal/private interfaces, increases the attack surface to untrusted networks.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

nfs_service_exposed_on_public_interface[_nfs_service_exposed_on_public_interface_def] if {
    "0.0.0.0" in input.nfs_bound_interfaces
    not input.firewall_restricts_nfs_ports
}

nfs_service_exposed_on_public_interface[_nfs_service_exposed_on_public_interface_def] if {
    "*" in input.nfs_bound_interfaces
    not input.firewall_restricts_nfs_ports
}

nfs_service_exposed_on_public_interface[_nfs_service_exposed_on_public_interface_def] if {
    input.public_interface_exposure_confirmed == true
    not input.firewall_restricts_nfs_ports
}

exposures contains _nfs_service_exposed_on_public_interface_def if {
    count(nfs_service_exposed_on_public_interface) > 0
}

_unpatched_nfs_server_software_def := {
    "name": "Unpatched Nfs Server Software",
    "description": "Running outdated NFS server software (kernel NFS module, nfs-utils, rpcbind) with known CVEs exposes the host to exploitation of buffer overflows, denial-of-service, or privilege escalation vulnerabilities.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

unpatched_nfs_server_software[_unpatched_nfs_server_software_def] if {
    input.nfs_service_is_running == true
    input.nfs_software_has_known_cve == true
}

unpatched_nfs_server_software[_unpatched_nfs_server_software_def] if {
    input.nfs_service_is_running == true
    input.days_since_last_nfs_package_update >= 180
}

exposures contains _unpatched_nfs_server_software_def if {
    count(unpatched_nfs_server_software) > 0
}

_insecure_mount_options_on_client_def := {
    "name": "Insecure Mount Options On Client",
    "description": "Client-side mounts using insecure options such as 'nosuid' not enforced, 'noexec' absent, or 'dev' allowed enable attackers who can write to the share to place setuid binaries or device files for local privilege escalation on the client.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

insecure_mount_options_on_client[_insecure_mount_options_on_client_def] if {
    not input.nosuid_enforced
}

insecure_mount_options_on_client[_insecure_mount_options_on_client_def] if {
    not input.noexec_enforced
}

insecure_mount_options_on_client[_insecure_mount_options_on_client_def] if {
    input.dev_allowed == true
}

exposures contains _insecure_mount_options_on_client_def if {
    count(insecure_mount_options_on_client) > 0
}

_rpcbind_portmapper_unrestricted_def := {
    "name": "Rpcbind Portmapper Unrestricted",
    "description": "The rpcbind/portmapper service required by NFSv3 accessible without host-based firewall restrictions allows attackers to enumerate RPC services and redirect or probe auxiliary NFS daemons (mountd, statd, lockd).",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "NETWORK"
}

rpcbind_portmapper_unrestricted[_rpcbind_portmapper_unrestricted_def] if {
    "0.0.0.0" in input.rpcbind_listening_interfaces
    not input.firewall_restricts_nfs_ports
}

rpcbind_portmapper_unrestricted[_rpcbind_portmapper_unrestricted_def] if {
    "::" in input.rpcbind_listening_interfaces
    not input.firewall_restricts_nfs_ports
}

rpcbind_portmapper_unrestricted[_rpcbind_portmapper_unrestricted_def] if {
    "0.0.0.0" in input.rpcbind_listening_interfaces
    not input.firewall_restricts_nfs_ports
    not input.rpcbind_tcp_wrappers_configured
}

exposures contains _rpcbind_portmapper_unrestricted_def if {
    count(rpcbind_portmapper_unrestricted) > 0
}

_insufficient_nfs_audit_logging_def := {
    "name": "Insufficient Nfs Audit Logging",
    "description": "NFS server not configured to log mount events, access attempts, and export requests (via rpcdebug, auditd rules on NFS-related syscalls, or server-side logging flags) prevents detection of unauthorized access or reconnaissance.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": []
}

insufficient_nfs_audit_logging[_insufficient_nfs_audit_logging_def] if {
    not input.nfs_mount_event_logging_enabled
    not input.auditd_nfs_syscall_rules_configured
}

insufficient_nfs_audit_logging[_insufficient_nfs_audit_logging_def] if {
    not input.nfs_mount_event_logging_enabled
    not input.nfs_access_attempt_logging_enabled
}

insufficient_nfs_audit_logging[_insufficient_nfs_audit_logging_def] if {
    not input.auditd_nfs_syscall_rules_configured
    not input.nfs_access_attempt_logging_enabled
}

exposures contains _insufficient_nfs_audit_logging_def if {
    count(insufficient_nfs_audit_logging) > 0
}

_all_squash_misconfiguration_def := {
    "name": "All Squash Misconfiguration",
    "description": "Use of 'all_squash' mapped to an overly privileged anonymous UID/GID (e.g., uid=0) effectively grants all connecting clients elevated file system permissions, undermining intended access control.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "medium",
    "score": 5,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

all_squash_misconfiguration[_all_squash_misconfiguration_def] if {
    input.all_squash_enabled == true
    input.anon_uid == 0
}

all_squash_misconfiguration[_all_squash_misconfiguration_def] if {
    input.all_squash_enabled == true
    input.anon_gid == 0
}

exposures contains _all_squash_misconfiguration_def if {
    count(all_squash_misconfiguration) > 0
}

_nfsv2_or_nfsv3_enabled_unnecessarily_def := {
    "name": "Nfsv2 Or Nfsv3 Enabled Unnecessarily",
    "description": "Older NFS protocol versions (v2, v3) enabled alongside or instead of NFSv4 expose the server to weaker security models lacking stateful access controls, compound operations security, and ACL support present in NFSv4.",
    "type": "misconfiguration",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

nfsv2_or_nfsv3_enabled_unnecessarily[_nfsv2_or_nfsv3_enabled_unnecessarily_def] if {
    input.nfsv2_enabled == true
}

nfsv2_or_nfsv3_enabled_unnecessarily[_nfsv2_or_nfsv3_enabled_unnecessarily_def] if {
    input.nfsv3_enabled == true
    not input.nfsv4_enabled
}

exposures contains _nfsv2_or_nfsv3_enabled_unnecessarily_def if {
    count(nfsv2_or_nfsv3_enabled_unnecessarily) > 0
}

_weak_idmapping_configuration_def := {
    "name": "Weak Idmapping Configuration",
    "description": "NFSv4 idmapping service (idmapd) misconfigured with an incorrect or absent NFSv4 domain causes UID/GID translation failures, potentially mapping users to nobody or incorrect identities, leading to access control bypass or denial of access.",
    "type": "missing_control",
    "category": "host_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "LOCAL"
}

weak_idmapping_configuration[_weak_idmapping_configuration_def] if {
    not input.idmapd_service_running
}

weak_idmapping_configuration[_weak_idmapping_configuration_def] if {
    input.idmapd_service_running == true
    not input.nfsv4_domain_configured
}

exposures contains _weak_idmapping_configuration_def if {
    count(weak_idmapping_configuration) > 0
}

_no_export_filesystem_isolation_def := {
    "name": "No Export Filesystem Isolation",
    "description": "Exporting a directory that is not a mount point boundary (missing 'fsid=' or not a separate filesystem) can allow clients traversing the export to access parent or sibling directories beyond the intended scope.",
    "type": "missing_control",
    "category": "network_security",
    "criticality": "low",
    "score": 2,
    "exploited_by": [],
    "attack_vector": "ADJACENT"
}

no_export_filesystem_isolation[_no_export_filesystem_isolation_def] if {
    not input.is_dedicated_mount_point
    not input.fsid_option_configured
}

no_export_filesystem_isolation[_no_export_filesystem_isolation_def] if {
    not input.is_dedicated_mount_point
    input.crossmnt_option_configured == true
}

exposures contains _no_export_filesystem_isolation_def if {
    count(no_export_filesystem_isolation) > 0
}
