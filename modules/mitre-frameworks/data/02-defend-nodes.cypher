MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Harden"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The harden tactic is used to increase the opportunity cost of computer network exploitation. Hardening differs from Detection in that it generally is conducted before a system is online and operational.", n.name = "Harden";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Deceive"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The deceive tactic is used to advertise, entice, and allow potential attackers access to an observed or controlled environment.", n.name = "Deceive";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Detect"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The detect tactic is used to identify adversary access to or unauthorized activity on computer networks.", n.name = "Detect";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Model"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The model tactic is used to apply security engineering, vulnerability, threat, and risk analyses to digital systems. This is accomplished by creating and maintaining a common understanding of the systems being defended, the operations on those systems, actors using the systems, and the relationships and interactions between these elements.", n.name = "Model";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Evict"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The eviction tactic is used to remove an adversary from a computer network.", n.name = "Evict";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Isolate"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The isolate tactic creates logical or physical barriers in a system which reduces opportunities for adversaries to create further accesses.", n.name = "Isolate";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DefensiveTactic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A plan for attaining a particular goal.", n.name = "Defensive Tactic";

MERGE (n:MitreDefendTactic {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Restore"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The restore tactic is used to return the system to a better state.", n.name = "Restore";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OSM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The operating system software, for D3FEND's purposes, includes the kernel and its process management functions, hardware drivers, initialization or boot logic. It also includes and other key system daemons and their configuration. The monitoring or analysis of these components for unauthorized activity constitute **Operating System Monitoring**.", n.name = "Operating System Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network Isolation techniques prevent network hosts from accessing non-essential system network resources.", n.name = "Network Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CHN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A decoy service, system, or environment, that is connected to the enterprise network, and simulates or emulates certain functionality to the network, without exposing full access to a production system.", n.name = "Connected Honeynet", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ConnectedHoneynet";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-LLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Logical link mapping creates a model of existing or previous node-to-node connections using network-layer data or metadata.", n.name = "Logical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#LogicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RTA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the activity of remote procedure calls in communication traffic to establish standard protocol operations and potential attacker activities.", n.name = "RPC Traffic Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RPCTrafficAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The application of security controls to user-to-user and system-to-system communications so messages remain confidential, unaltered, and verifiable while resisting injection, replay, and tampering.", n.name = "Message Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MessageHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Agent authentication is the process of verifying the identities of agents to ensure they are authorized and trustworthy participants within a system.", n.name = "Agent Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AgentAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ULA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring a user account's access to resources by unlocking a locked User Account.", n.name = "Unlock Account", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UnlockAccount";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OVAR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Assign read/write access controls on designated registers or data tags to prevent unauthorized writes.", n.name = "OT Variable Access Restriction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OTVariableAccessRestriction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FISV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The process of checking specific static values within a file, such as file signatures or magic numbers, to ensure they match the expected values defined by the file format specification.", n.name = "File Internal Structure Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileInternalStructureVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ET"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Encrypted encapsulation of routable network traffic.", n.name = "Encrypted Tunnels", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#EncryptedTunnels";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ANAA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detection of unauthorized use of administrative network protocols by analyzing network activity against a baseline.", n.name = "Administrative Network Activity Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AdministrativeNetworkActivityAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-BMA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Applies cryptographic primitives to individual bus frames to verify the sender's identity and ensure the integrity of the data payload.", n.name = "Bus Message Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#BusMessageAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NNI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network node inventorying identifies and records all the network nodes (hosts, routers, switches, firewalls, etc.) in the organization's architecture.", n.name = "Network Node Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkNodeInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Initiating a host's shutdown sequence to terminate all running processes.", n.name = "Host Shutdown", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HostShutdown";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PSMD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detects processes that modify, change, or replace their own code at runtime.", n.name = "Process Self-Modification Detection", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSelf-ModificationDetection";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AEM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the failures of system counters and timers.", n.name = "Application Exception Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationExceptionMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Application Hardening makes an executable application more resilient to a class of exploits which either introduce new code or execute unwanted existing code. These techniques may be applied at compile-time or on an application binary.", n.name = "Application Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modify content that does not comply with policy.", n.name = "Content Modification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentModification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Hardening components of a Platform with the intention of making them more difficult to exploit.  Platforms includes components such as: * BIOS UEFI Subsystems * Hardware security devices such as Trusted Platform Modules * Boot process logic or code * Kernel software components", n.name = "Platform Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PlatformHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTSA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing network traffic and compares it to known signatures", n.name = "Network Traffic Signature Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficSignatureAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IPCTA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing standard inter process communication (IPC) protocols to detect deviations from normal protocol activity.", n.name = "IPC Traffic Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IPCTrafficAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SJA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analysis of source files, processes, destination files, or destination servers associated with a scheduled job to detect unauthorized use of job scheduling.", n.name = "Scheduled Job Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DPLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Direct physical link mapping creates a physical link map by direct observation and recording of the physical network links.", n.name = "Direct Physical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DirectPhysicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IOPR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Limiting access to computer input/output (IO) ports to restrict unauthorized devices.", n.name = "IO Port Restriction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IOPortRestriction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-WSAA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring changes in user web session behavior by comparing current web session activity to a baseline behavior profile or a catalog of predetermined malicious behavior.", n.name = "Web Session Activity Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#WebSessionActivityAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Password rotation is a security policy that mandates the periodic change of user account passwords to mitigate the risk of unauthorized access due to compromised credentials.", n.name = "Password Rotation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordRotation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-TBI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Assuring the integrity of a platform by demonstrating that the boot process starts from a trusted combination of hardware and software and continues until the operating system has fully booted and applications are running.  Sometimes called Static Root of Trust Measurement (STRM).", n.name = "TPM Boot Integrity", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#TPMBootIntegrity";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PSA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing spawn arguments or attributes of a process to detect processes that are unauthorized.", n.name = "Process Spawn Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSpawnAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FMBV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Utilizing the magic number to verify the file", n.name = "File Magic Byte Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMagicByteVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ORA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Operational risk assessment identifies and models the vulnerabilities of, and risks to, an organization's activities individually and as a whole.", n.name = "Operational Risk Assessment", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationalRiskAssessment";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CIA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing a Container Image with respect to a set of policies.", n.name = "Container Image Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerImageAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ABPI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Application code which prevents its own subroutines from accessing intra-process / internal memory space.", n.name = "Application-based Process Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Application-basedProcessIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SYSVA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "System vulnerability assessment relates all the vulnerabilities of a system's components in the context of their configuration and internal dependencies and can also include assessing risk emerging from the system's design as a whole, not just the sum of individual component vulnerabilities.", n.name = "System Vulnerability Assessment", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemVulnerabilityAssessment";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SCF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Controlling access to local computer system resources with kernel-level capabilities.", n.name = "System Call Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemCallFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FFV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Verifying that a file conforms to its expected format specifications", n.name = "File Format Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileFormatVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SFCV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing a value stored in a stack frame with a known good value in order to prevent or detect a memory segment overwrite.", n.name = "Stack Frame Canary Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#StackFrameCanaryValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CQ"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Transfer content that does not comply with policy to a quarantine zone.", n.name = "Content Quarantine", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentQuarantine";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NPC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Checking if a pointer is NULL.", n.name = "Null Pointer Checking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NullPointerChecking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring platform components such as operating systems software, hardware devices, or firmware.", n.name = "Platform Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PlatformMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-UGLPA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring geolocation data of user logon attempts and comparing it to a baseline user behavior profile to identify anomalies in logon location.", n.name = "User Geolocation Logon Pattern Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserGeolocationLogonPatternAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DST"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authentication token created for the purposes of deceiving an adversary.", n.name = "Decoy Session Token", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoySessionToken";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ascertaining sender reputation based on information associated with a message (e.g. email/instant messaging).", n.name = "Sender Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SenderReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SAOR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Randomizing the base (start) address of one or more segments of memory during the initialization of a process.", n.name = "Segment Address Offset Randomization", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SegmentAddressOffsetRandomization";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-LAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing local user accounts to detect unauthorized activity.", n.name = "Local Account Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalAccountMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EHB"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the security status of an endpoint by sending periodic messages with health status, where absence of a response may indicate that the endpoint has been compromised.", n.name = "Endpoint Health Beacon", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#EndpointHealthBeacon";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Executing or opening a file in a synthetic \"sandbox\" environment to determine if the file is a malicious program or if the file exploits another program such as a document reader.", n.name = "Dynamic Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DynamicAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Initiating a host's reboot sequence to terminate all running processes.", n.name = "Host Reboot", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HostReboot";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DKE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Disk Erasure is the process of securely deleting all data on a disk to ensure that it cannot be recovered by any means.", n.name = "Disk Erasure", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DiskErasure";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DQSA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing database queries to detect [SQL Injection](https://capec.mitre.org/data/definitions/66.html).", n.name = "Database Query String Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseQueryStringAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DKP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Disk Partitioning is the process of dividing a disk into multiple distinct sections, known as partitions.", n.name = "Disk Partitioning", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DiskPartitioning";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Encrypting a file using a cryptographic key.", n.name = "File Encryption", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileEncryption";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Routing access mediation is a network security approach that manages and controls access at the network layer using VPNs, tunneling protocols, firewall rules, and traffic inspection to ensure secure and efficient data routing.", n.name = "Routing Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RoutingAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IDA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Operating system level mechanisms to prevent abusive input device exploitation.", n.name = "Input Device Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#InputDeviceAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the reputation of an identifier.", n.name = "Identifier Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IdentifierReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EBWSAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Endpoint-based web server access mediation regulates web server access directly from user endpoints by implementing mechanisms such as client-side certificates and endpoint security software to authenticate devices and ensure compliant access.", n.name = "Endpoint-based Web Server Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Endpoint-basedWebServerAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNSTA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analysis of domain name metadata, including name and DNS records, to determine whether the domain is likely to resolve to an undesirable host.", n.name = "DNS Traffic Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSTrafficAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring an software configuration.", n.name = "Restore Configuration", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreConfiguration";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Invalidating all pointers that reference a specific memory block, ensuring that the block cannot be accessed or modified after deallocation.", n.name = "Reference Nullification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ReferenceNullification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CAA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing failed connections in a network to detect unauthorized activity.", n.name = "Connection Attempt Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ConnectionAttemptAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Radiation hardening is the process of making electronic components and circuits resistant to damage or malfunction caused by high levels of ionizing radiation.", n.name = "Radiation Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RadiationHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FCDC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Checking if compressed or encoded data sections can be successfully decompressed or decoded. Can follow with further analysis with semantic knowledge", n.name = "File Content Decompression Checking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentDecompressionChecking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FRDDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking a lookup based on the query's domain name value.", n.name = "Forward Resolution Domain Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ForwardResolutionDomainDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Deleting a set of credentials permanently to prevent them from being used to authenticate.", n.name = "Credential Revocation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialRevocation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CBAN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Requiring a digital certificate in order to authenticate a user.", n.name = "Certificate-based Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Certificate-basedAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensuring that a pointer variable has the required properties for use.", n.name = "Pointer Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PointerValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cryptographically verifying firmware integrity.", n.name = "Firmware Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FirmwareVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MENCR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Encrypting a message body using a cryptographic key.", n.name = "Message Encryption", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MessageEncryption";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ANET"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collecting authentication events, creating a baseline user profile, and determining whether authentication events are consistent with the baseline profile.", n.name = "Authentication Event Thresholding", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationEventThresholding";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PSEP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Preventing execution of any address in a memory region other than the code segment.", n.name = "Process Segment Execution Prevention", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSegmentExecutionPrevention";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting network traffic originating from any location.", n.name = "Network Traffic Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MBSV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensuring that a pointer accurately references the beginning of a designated memory block.", n.name = "Memory Block Start Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryBlockStartValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DO"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Decoy Object is created and deployed for the purposes of deceiving attackers.", n.name = "Decoy Object", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyObject";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing strings using a variety of techniques to determine if a deceptive or malicious string is being presented to a user.", n.name = "Homoglyph Detection", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HomoglyphDetection";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FCR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Employing a pattern matching rule language to analyze the content of files.", n.name = "File Content Rules", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentRules";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Employing file hash comparisons to detect known malware.", n.name = "File Hashing", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHashing";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SDA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the duration of user sessions in order to detect unauthorized  activity.", n.name = "Session Duration Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SessionDurationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network mapping encompasses the techniques to identify and model the physical layer, network layer, and data exchange layers of the organization's network and their physical location, and determine allowed pathways through that network.", n.name = "Network Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SCH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Hardening source code with the intention of making it more difficult to exploit and less error prone.", n.name = "Source Code Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SourceCodeHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-LFP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Local file permissions is the systematic process of defining, implementing, and managing access control policies that dictate user permissions for accessing files on a local system through the configuration of operating system functionality.", n.name = "Local File Permissions", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalFilePermissions";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ALLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Active logical link mapping sends and receives network traffic as a means to map the whole data link layer, where the links represent logical data flows rather than physical connection", n.name = "Active Logical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ActiveLogicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring software to a host.", n.name = "Restore Software", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreSoftware";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The systematic removal of hard-coded credentials from source code to prevent accidental exposure and unauthorized access.", n.name = "Credential Scrubbing", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialScrubbing";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Enforce one-way network communication by preventing two-way communication.", n.name = "Directional Network Link", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DirectionalNetworkLink";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking the execution of files on a host in accordance with defined application policy rules.", n.name = "Executable Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutableDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ANCI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Removing tokens or credentials from an authentication cache to prevent further user associated account accesses.", n.name = "Authentication Cache Invalidation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationCacheInvalidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-TBA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Token-based authentication is an authentication protocol where users verify their identity in exchange for a unique access token. Users can then access the website, application, or resource for the life of the token without having to re-enter their credentials.", n.name = "Token-based Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Token-basedAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PEH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Physical changes to a computer enclosure which reduce the ability for agents or the environment to affect the contained computer system.", n.name = "Physical Enclosure Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalEnclosureHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IPRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the reputation of an IP address.", n.name = "IP Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IPReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-VTV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensuring that a variable has the correct type.", n.name = "Variable Type Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#VariableTypeValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-KBPI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Using kernel-level capabilities to isolate processes.", n.name = "Kernel-based Process Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Kernel-basedProcessIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SICA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analysis of any system process startup configuration.", n.name = "System Init Config Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemInitConfigAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CFI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Enforcing legal control flow transfers during application process execution.", n.name = "Control Flow Integrity", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ControlFlowIntegrity";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Asset inventorying identifies and records the organization's assets and enriches each inventory item with knowledge about their vulnerabilities.", n.name = "Asset Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AssetInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FEV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "File eviction techniques delete files from system storage.", n.name = "File Eviction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileEviction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SEA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the execution of a script to detect unauthorized user activity.", n.name = "Script Execution Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ScriptExecutionAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SU"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Replacing old software on a computer system component.", n.name = "Software Update", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareUpdate";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OTF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting network traffic originating from a private host or enclave destined towards untrusted networks.", n.name = "Outbound Traffic Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundTrafficFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DLIC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensuring the integrity of drivers loaded during initialization of the operating system.", n.name = "Driver Load Integrity Checking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DriverLoadIntegrityChecking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AMED"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Access mediation is the process of granting or denying specific requests to: 1) obtain and use information and related information processing services; and 2) enter specific physical facilities (e.g., Federal buildings, military establishments, border crossing entrances). Access mediation decisions should enforce least privilege by granting access for scoped durations to prevent privilege creep and, where applicable, implement just-in-time (JIT) access. Denial decisions may prevent initial access or terminate access that has already been granted, ensuring continuous enforcement of security policies.", n.name = "Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FHRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the reputation of a file hash.", n.name = "File Hash Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHashReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PFV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cryptographically verifying peripheral firmware integrity.", n.name = "Peripheral Firmware Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PeripheralFirmwareVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EHPV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Validates that a referenced exception handler pointer is a valid exception handler.", n.name = "Exception Handler Pointer Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ExceptionHandlerPointerValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Configuration inventory identifies and records the configuration of software and hardware and their components throughout the organization.", n.name = "Configuration Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SWI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Software inventorying identifies and records the software items in the organization's architecture.", n.name = "Software Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DCE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Removing unreachable or \"dead code\" from compiled source code.", n.name = "Dead Code Elimination", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DeadCodeElimination";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Credential Hardening techniques modify system or network properties in order to protect system or network/domain credentials.", n.name = "Credential Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RUAA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring a user account's access to resources.", n.name = "Restore User Account Access", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreUserAccountAccess";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNSAL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Permitting only approved domains and their subdomains to be resolved.", n.name = "DNS Allowlisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSAllowlisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Persisting either a server's X.509 certificate or their public key and comparing that to server's presented identity to allow for greater client confidence in the remote server's identity for SSL connections.", n.name = "Certificate Pinning", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CertificatePinning";

MERGE (n:MitreDefendTechnique {d3fendId: "D3F-UGPH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Access control where access is determined based on attributes associated with users and the objects being accessed.", n.name = "User Group Permissions", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserGroupPermissions";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Identifying and extracting files from network application protocols through the use of network stream reassembly software.", n.name = "File Carving", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileCarving";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DRT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The process of performing a takedown of the attacker's domain registration infrastructure.", n.name = "Domain Registration Takedown", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainRegistrationTakedown";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OMM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detects operating modes such as Program, Run, Remote, or Stop.", n.name = "Operating Mode Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingModeMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DEM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Data exchange mapping identifies and models the organization's intended design for the flows of the data types, formats, and volumes between systems at the application layer.", n.name = "Data Exchange Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DataExchangeMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CSPP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing client-server request and response payloads to a baseline profile to identify outliers.", n.name = "Client-server Payload Profiling", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Client-serverPayloadProfiling";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking DNS queries that are deceptively similar to legitimate domain names.", n.name = "Homoglyph Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HomoglyphDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IBCA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing vendor specific branch call recording in order to detect ROP style attacks.", n.name = "Indirect Branch Call Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IndirectBranchCallAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FIM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detecting any suspicious changes to files in a computer system.", n.name = "File Integrity Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileIntegrityMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RFAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Remote file access mediation is the process of managing and securing access to file systems over a network to ensure that only authorized users or processes can interact with remote files.", n.name = "Remote File Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteFileAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PLA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Identification of suspicious processes executing on an end-point device by examining the ancestry and siblings of a process, and the associated metadata of each node on the tree, such as process execution, duration, and order relative to siblings and ancestors.", n.name = "Process Lineage Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessLineageAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PLLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Passive logical link mapping only listens to network traffic as a means to map the the whole data link layer, where the links represent logical data flows rather than physical connections.", n.name = "Passive Logical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PassiveLogicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PHDURA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detecting anomalies that indicate malicious activity by comparing the amount of data downloaded versus data uploaded by a host.", n.name = "Per Host Download-Upload Ratio Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PerHostDownload-UploadRatioAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OLV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Validation of variable state in the context of the control logic of the operational application.", n.name = "Operational Logic Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationalLogicValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DENCR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Encrypting a hard disk partition to prevent cleartext access to a file system.", n.name = "Disk Encryption", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DiskEncryption";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Process Analysis consists of observing a running application process and analyzing it to watch for certain behaviors or conditions which may indicate adversary activity. Analysis can occur inside of the process or through a third-party monitoring application. Examples include monitoring system and privileged calls, monitoring process initiation chains, and memory boundary allocations.", n.name = "Process Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-JFAPA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detecting anomalies in user access patterns by comparing user access activity to behavioral profiles that categorize users by role such as job title, function, department.", n.name = "Job Function Access Pattern Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#JobFunctionAccessPatternAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SMRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Characterizing the reputation of mail transfer agents (MTA) to determine the security risk in emails.", n.name = "Sender MTA Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SenderMTAReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PCSV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing the \"text\" or \"code\" memory segments to a source of truth.", n.name = "Process Code Segment Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessCodeSegmentVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-BDI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Broadcast isolation restricts the number of computers a host can contact on their LAN.", n.name = "Broadcast Domain Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#BroadcastDomainIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CNE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Removing specific, potentially malicious, parts of content", n.name = "Content Excision", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentExcision";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FMCV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The process of validating the consistency between a file's metadata and its actual content, ensuring that elements like declared lengths, pointers, and checksums accurately describe the file's content.", n.name = "File Metadata Consistency Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMetadataConsistencyValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-APLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Active physical link mapping sends and receives network traffic as a means to map the physical layer.", n.name = "Active Physical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ActivePhysicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RRID"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking a reverse lookup based on the query's IP address value.", n.name = "Reverse Resolution IP Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ReverseResolutionIPDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CERO"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Certificate rotation involves replacing digital certificates and their private keys to maintain cryptographic integrity and trust, mitigating key compromise risks and ensuring continuous secure communications.", n.name = "Certificate Rotation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CertificateRotation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ID"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing identifier artifacts such as IP address, domain names, or URL(I)s.", n.name = "Identifier Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IdentifierAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HCI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Hardware component inventorying identifies and records the hardware items in the organization's architecture.", n.name = "Hardware Component Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareComponentInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RO"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring an object for an entity to access. This is the broadest class for object restoral.", n.name = "Restore Object", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreObject";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DTP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting inter-domain trust by modifying domain configuration.", n.name = "Domain Trust Policy", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainTrustPolicy";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HBWP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Physical methods of preventing data from being written to computer storage.", n.name = "Hardware-based Write Protection", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Hardware-basedWriteProtection";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RNA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring a entity's access to a computer network.", n.name = "Restore Network Access", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreNetworkAccess";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SFA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring system files such as authentication databases, configuration files, system logs, and system executables for modification or tampering.", n.name = "System File Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemFileAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CDP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Changing the default password means replacing the factory-set credentials with a strong, unique password before the device is deployed, preventing unauthorized access.", n.name = "Change Default Password", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ChangeDefaultPassword";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-BSE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing sequences of bytes and determining if they likely represent malicious shellcode.", n.name = "Byte Sequence Emulation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ByteSequenceEmulation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTPM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network traffic policy mapping identifies and models the allowed pathways of data at the network, transport, and/or application levels.", n.name = "Network Traffic Policy Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficPolicyMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RKD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Delete a registry key.", n.name = "Registry Key Deletion", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RegistryKeyDeletion";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Execution Isolation techniques prevent application processes from accessing non-essential system resources, such as memory, devices, or files.", n.name = "Execution Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutionIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MBT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing a call stack for return addresses which point to unexpected  memory locations.", n.name = "Memory Boundary Tracking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryBoundaryTracking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HBPI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Preventing one process from writing to the memory space of another process through hardware based address manager implementations.", n.name = "Hardware-based Process Isolation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Hardware-basedProcessIsolation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ITF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting network traffic originating from untrusted networks destined towards a private host or enclave.", n.name = "Inbound Traffic Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundTrafficFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CNS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modifies specific digital content information by replacing it with something else.", n.name = "Content Substitution", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentSubstitution";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-HDDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking the resolution of any subdomain of a specified domain name.", n.name = "Hierarchical Domain Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#HierarchicalDomainDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SFV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cryptographically verifying installed system firmware integrity.", n.name = "System Firmware Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemFirmwareVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ACH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modifying an application's configuration to reduce its attack surface.", n.name = "Application Configuration Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfigurationHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file created for the purposes of deceiving an adversary.", n.name = "Decoy File", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyFile";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the existence of or changes to Domain User Accounts.", n.name = "Domain Account Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainAccountMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring an email for an entity to access.", n.name = "Restore Email", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreEmail";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNSCE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Flushing DNS to clear any IP addresses or other DNS records from the cache.", n.name = "DNS Cache Eviction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSCacheEviction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IHN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The practice of setting decoys in a production environment to entice interaction from attackers.", n.name = "Integrated Honeynet", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IntegratedHoneynet";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MSM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring events from motion detectors (e.g., passive IR, microwave, dual-technology) to detect presence or movement within protected areas.", n.name = "Motion Sensor Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MotionSensorMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ER"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The email removal technique deletes email files from system storage.", n.name = "Email Removal", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailRemoval";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MFA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Requiring proof of two or more pieces of evidence in order to authenticate a user.", n.name = "Multi-factor Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Multi-factorAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PBWSAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Proxy-based web server access mediation focuses on the regulation of web server access through intermediary proxy servers.", n.name = "Proxy-based Web Server Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#Proxy-basedWebServerAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-LFAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Local file access mediation is the process of an operating system granting or denying a specific access request to a local file.", n.name = "Local File Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalFileAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CRO"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Credential rotation is a security procedure in which authentication credentials, such as passwords, API keys, or certificates, are regularly changed or replaced to minimize the risk of unauthorized access.", n.name = "Credential Rotation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialRotation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EMH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The application of physical and material-level design measures to electronic systems, components, or facilities to reduce their susceptibility to damage or disruption from electromagnetic threats.", n.name = "Electromagnetic Radiation Hardening", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ElectromagneticRadiationHardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Credential Eviction techniques disable or remove compromised credentials from a computer network.", n.name = "Credential Eviction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialEviction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FBA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the behavior of embedded code in firmware and looking for anomalous behavior and suspicious activity.", n.name = "Firmware Behavior Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FirmwareBehaviorAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SCP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting system configuration modifications to a specific user or group of users.", n.name = "System Configuration Permissions", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigurationPermissions";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FEMC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring code is injected into firmware for integrity monitoring of firmware and firmware data.", n.name = "Firmware Embedded Monitoring Code", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FirmwareEmbeddedMonitoringCode";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-TL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A trusted library is a collection of pre-verified and secure code modules or components that are used within software applications to perform specific functions. These libraries are considered reliable and have been vetted for security vulnerabilities, ensuring they do not introduce risks into the application.", n.name = "Trusted Library", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#TrustedLibrary";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PWA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Password authentication is a security mechanism used to verify the identity of a user or entity attempting to access a system or resource by requiring the input of a secret string of characters, known as a password, that is associated with the user or entity.", n.name = "Password Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring a file for an entity to access.", n.name = "Restore File", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreFile";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-UA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Determining if a URL is benign or malicious by analyzing the URL or its components.", n.name = "URL Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#URLAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SCA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing system calls to determine whether a process is exhibiting unauthorized behavior.", n.name = "System Call Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemCallAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FAPA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the files accessed by a process to identify unauthorized activity.", n.name = "File Access Pattern Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileAccessPatternAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DUC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Credential created for the purpose of deceiving an adversary.", n.name = "Decoy User Credential", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyUserCredential";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ACA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Actively collecting PKI certificates by connecting to the server and downloading its server certificates for analysis.", n.name = "Active Certificate Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ActiveCertificateAnalysis";

MERGE (n:MitreDefendTechnique {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DefensiveTechnique"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A method which makes a computer system more difficult to attack.", n.name = "Defensive Technique";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Terminating a running application process on a computer system.", n.name = "Process Termination", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessTermination";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SYSM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "System mapping encompasses the techniques to identify the organization's systems, how they are configured and decomposed into subsystems and components, how they are dependent on one another, and where they are physically located.", n.name = "System Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PUM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitor the amount of time since the last power cycle or restart.", n.name = "Platform Uptime Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PlatformUptimeMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FCA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the properties of file create system call invocations.", n.name = "File Creation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileCreationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing email or instant message content to detect unauthorized activity.", n.name = "Message Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MessageAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-MAN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Authenticating the sender of a message and ensuring message integrity.", n.name = "Message Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#MessageAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Establishing a fake online identity to misdirect, deceive, and or interact with adversaries.", n.name = "Decoy Persona", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyPersona";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CFC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Content format conversion is mechanical transformation from one format to another which may be normalization or specifically flattening.", n.name = "Content Format Conversion", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentFormatConversion";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CNR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Rebuild the file according to the spec so any unreferenced components or objects are removed.", n.name = "Content Rebuild", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentRebuild";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-APCA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing application protocol level remote commands to detect unauthorized activity.", n.name = "Application Protocol Command Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationProtocolCommandAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SHN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An environment created for the purpose of attracting attackers and eliciting their behaviors that is not connected to any production enterprise systems.", n.name = "Standalone Honeynet", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#StandaloneHoneynet";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-APA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Access policy administration is the systematic process of defining, implementing, and managing access control policies that dictate user permissions to resources.", n.name = "Access Policy Administration", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessPolicyAdministration";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IAA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Taking known malicious identifiers and determining if they are present in a system.", n.name = "Identifier Activity Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IdentifierActivityAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Decoy Environment comprises hosts and networks for the purposes of deceiving an attacker.", n.name = "Decoy Environment", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyEnvironment";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing intercepted or summarized computer network traffic to detect unauthorized activity.", n.name = "Network Traffic Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-WSAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Web session access mediation secures user sessions in web applications by employing robust authentication and integrity validation, along with adaptive threat mitigation techniques, to ensure that access to web resources is authorized and protected from session-related attacks.", n.name = "Web Session Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#WebSessionAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-UAP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting a user account's access to resources.", n.name = "User Account Permissions", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountPermissions";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-BAN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Using biological measures in order to authenticate a user.", n.name = "Biometric Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#BiometricAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Data inventorying identifies and records the schemas, formats, volumes, and locations of data stored and used on the organization's architecture.", n.name = "Data Inventory", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DataInventory";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RTSD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Detection of an unauthorized remote live terminal console session by examining network traffic to a network host.", n.name = "Remote Terminal Session Detection", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteTerminalSessionDetection";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-USICA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing modifications to user session config files such as .bashrc or .bash_profile.", n.name = "User Session Init Config Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserSessionInitConfigAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-TAAN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Validating that server components of a messaging infrastructure are authorized to send a particular message.", n.name = "Transfer Agent Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#TransferAgentAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NTCD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Establishing baseline communities of network hosts and identifying statistically divergent inter-community communication.", n.name = "Network Traffic Community Deviation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficCommunityDeviation";

MERGE (n:MitreDefendTechnique {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ParticleRadiationHardening"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The application of material, process, layout, or circuit-level design measures to electronic systems and components to reduce susceptibility to total ionizing dose degradation and single-event effects caused by ionizing particles such as protons, heavy ions, neutrons, or electrons.", n.name = "Particle Radiation Hardening";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Content Filtering techniques aid in the process of analyzing an input file for malicious or erroneous content and outputing a sanitized version.", n.name = "Content Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Deploying a network resource for the purposes of deceiving an adversary.", n.name = "Decoy Network Resource", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyNetworkResource";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EAL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Using a digital signature to authenticate a file before opening.", n.name = "Executable Allowlisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutableAllowlisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SVCDM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Service dependency mapping determines the services on which each given service relies.", n.name = "Service Dependency Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceDependencyMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-VS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring of physical areas via camera video feeds to deter, detect, and investigate unauthorized access and related security events.", n.name = "Video Surveillance", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#VideoSurveillance";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AZET"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collecting authorization events, creating a baseline user profile, and determining whether authorization events are consistent with the baseline profile.", n.name = "Authorization Event Thresholding", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthorizationEventThresholding";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SSC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing a call stack in system memory with a shadow call stack maintained by the processor to determine unauthorized shellcode activity.", n.name = "Shadow Stack Comparisons", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ShadowStackComparisons";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Physical access mediation is the process of granting or denying specific requests to enter specific physical facilities (e.g., Federal buildings, military establishments, border crossing entrances.)", n.name = "Physical Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RFUM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring of remote firmware update commands to identify unauthorized software installations.", n.name = "Remote Firmware Update Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteFirmwareUpdateMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PHAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the physical access of a specified environment through detection, recording, reviewing, and logging of who/what enters and exists areas.", n.name = "Physical Access Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalAccessMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DLV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Validation of variable state in the context of the domain application.", n.name = "Domain Logic Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainLogicValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ST"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Forcefully end all active sessions associated with compromised accounts or devices.", n.name = "Session Termination", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SessionTermination";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-URA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the reputation of a URL.", n.name = "URL Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#URLReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SYSDM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "System dependency mapping identifies and models the dependencies of system components on each other to carry out their function.", n.name = "System Dependency Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemDependencyMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "File Analysis is an analytic process to determine a file's status. For example: virus, trojan, benign, malicious, trusted, unauthorized, sensitive, etc.", n.name = "File Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The process of temporarily disabling user accounts on a system or domain.", n.name = "Account Locking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AccountLocking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-UDTA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the amount of data transferred by a user.", n.name = "User Data Transfer Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserDataTransferAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PMAD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collecting network communication protocol metadata and identifying statistical outliers.", n.name = "Protocol Metadata Anomaly Detection", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProtocolMetadataAnomalyDetection";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNSDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking DNS Network Traffic based on criteria such as IP address, domain name, or DNS query type.", n.name = "DNS Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RFS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Adding physical barriers to a platform to prevent undesired radio interference.", n.name = "RF Shielding", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RFShielding";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SBV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing changes in service binary files by comparing to a source of truth.", n.name = "Service Binary Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceBinaryVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Organization mapping identifies and models the people, roles, and groups with an organization and the relations between them.", n.name = "Organization Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OrganizationMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Operational activity mapping identifies activities of the organization and the organization's suborganizations, groups, roles, and individuals that carry out the activities and then establishes the dependencies of the activities on the systems and people that perform those activities.", n.name = "Operational Activity Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationalActivityMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-TB"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Token binding is a security mechanism used to enhance the protection of tokens, such as cookies or OAuth tokens, by binding them to a specific connection.", n.name = "Token Binding", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#TokenBinding";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EPL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Employ a mechanical locking device for securing moveable portions of physical barriers (e.g., doors, gates, drawers) in a secured position.", n.name = "Physical Locking", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLocking";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AVE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Asset vulnerability enumeration enriches inventory items with knowledge identifying their vulnerabilities.", n.name = "Asset Vulnerability Enumeration", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AssetVulnerabilityEnumeration";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-BA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cryptographically authenticating the bootloader software before system boot.", n.name = "Bootloader Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#BootloaderAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PAN"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Comparing the cryptographic hash or derivative of a pointer's value to an expected value.", n.name = "Pointer Authentication", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PointerAuthentication";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-UBA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "User behavior analytics (\"UBA\") as defined by Gartner, is a cybersecurity process about detection of insider threats, targeted attacks, and financial fraud. UBA solutions look at patterns of human behavior, and then apply algorithms and statistical analysis to detect meaningful anomalies from those patterns-anomalies that indicate potential threats.' Instead of tracking devices or security events, UBA tracks a system's users. Big data platforms are increasing UBA functionality by allowing them to analyze petabytes worth of data to detect insider threats and advanced persistent threats.", n.name = "User Behavior Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#UserBehaviorAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ISVA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing inbound network session or connection attempt volume.", n.name = "Inbound Session Volume Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundSessionVolumeAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Verify and validate contents complies with policy", n.name = "Content Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-AM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Access modeling captures and records the access permissions granted to identities (e.g., administrators, users, groups, systems) and optionally includes details on how these identities are stored, managed, and shared across systems.", n.name = "Access Modeling", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessModeling";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring the data in a database.", n.name = "Restore Database", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreDatabase";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OPR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restricting unauthorized changes to the operating mode prevents devices from switching into inappropriate or vulnerable states during normal use.", n.name = "Operating Mode Restriction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingModeRestriction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ODM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Operational dependency mapping identifies and models the dependencies of the organization's activities on each other and on the organization's performers (people, systems, and services.)  This may include modeling the higher- and lower-level activities of an organization forming a hierarchy, or layering, of the dependencies in an organization's activities.", n.name = "Operational Dependency Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationalDependencyMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RIC"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Issue a new credential to a user which supercedes their old credential.", n.name = "Reissue Credential", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ReissueCredential";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PSM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring events from proximity sensors that indicate a credential or tagged asset is within the sensor's read range or a defined zone. Common enabling technologies include RFID, Bluetooth Low Energy (BLE), and Ultra-Wideband (UWB).", n.name = "Proximity Sensor Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProximitySensorMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DKF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Disk Formatting is the process of preparing a data storage device, such as a hard drive, solid-state drive, or USB flash drive, for initial use.", n.name = "Disk Formatting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DiskFormatting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FMVV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The process of checking specific static values within a file, such as file signatures or magic numbers, to ensure they match the expected values defined by the file format specification.", n.name = "File Metadata Value Verification", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMetadataValueVerification";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SPP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modifying system configuration to increase password strength.", n.name = "Strong Password Policy", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#StrongPasswordPolicy";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-SDM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Tracking changes to the state or configuration of critical system level processes.", n.name = "System Daemon Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemDaemonMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NRAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Control of access to organizational systems and services by users or processes over a network.", n.name = "Network Resource Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkResourceAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CTS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Limiting the transmission of a credential to a scoped set of relying parties.", n.name = "Credential Transmission Scoping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialTransmissionScoping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OPM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring physical parameters and operator actions related to an operational environment.", n.name = "Operational Process Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationalProcessMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FRIDL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Blocking a DNS lookup's answer's IP address value.", n.name = "Forward Resolution IP Denylisting", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ForwardResolutionIPDenylisting";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CCSA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Determining which credentials may have been compromised by analyzing the user logon history of a particular system.", n.name = "Credential Compromise Scope Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialCompromiseScopeAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RPA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The detection of an internal host relaying traffic between the internal network and the external network.", n.name = "Relay Pattern Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RelayPatternAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DPR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Issuing publicly released media to deceive adversaries.", n.name = "Decoy Public Release", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyPublicRelease";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Process eviction techniques terminate or remove running process.", n.name = "Process Eviction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessEviction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PLM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Physical link mapping identifies and models the link connectivity of the network devices within a physical network.", n.name = "Physical Link Mapping", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkMapping";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DNRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the reputation of a domain name.", n.name = "Domain Name Reputation Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainNameReputationAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-LAMED"})
ON CREATE SET n.id = randomUUID()
SET n.description = "LAN access mediation encompasses the application of strict access control policies, systematic verification of devices, and authentication mechanisms to govern connectivity to a Local Area Network.", n.name = "LAN Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#LANAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OTP"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A one-time password is valid for only one user authentication.", n.name = "One-time Password", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#One-timePassword";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-CA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing Public Key Infrastructure certificates to detect if they have been misconfigured or spoofed using both network traffic, certificate fields and third-party logs.", n.name = "Certificate Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#CertificateAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network access mediation is the control method for authorizing access to a system by a user (or a process acting on behalf of a user) communicating through a network, including a local area network, a wide area network, and the Internet.", n.name = "Network Access Mediation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkAccessMediation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-FCOA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Employing a pattern matching algorithm to statically analyze the content of files.", n.name = "File Content Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring an entity's access to resources.", n.name = "Restore Access", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreAccess";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RDI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restoring a previously captured disk image a hard drive.", n.name = "Restore Disk Image", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#RestoreDiskImage";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-APM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring the count and duration of the application or program cycle.", n.name = "Application Performance Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationPerformanceMonitoring";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-DRA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Limiting access to a computing device which is not required through or from a non-organization-controlled network.", n.name = "Disable Remote Access", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#DisableRemoteAccess";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EF"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Filtering incoming email traffic based on specific criteria.", n.name = "Email Filtering", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailFiltering";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-OE"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Terminate or remove an object from a host machine. This is the broadest class for object eviction.", n.name = "Object Eviction", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ObjectEviction";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PCA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collecting host certificates from network traffic or other passive sources like a certificate transparency log and analyzing them for unauthorized activity.", n.name = "Passive Certificate Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#PassiveCertificateAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-NVA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network vulnerability assessment relates all the vulnerabilities of a network's components in the context of their configuration and interdependencies and can also include assessing risk emerging from the network's design as a whole, not just the sum of individual network node or network segment vulnerabilities.", n.name = "Network Vulnerability Assessment", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkVulnerabilityAssessment";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-EFA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Emulating instructions in a file looking for specific patterns.", n.name = "Emulated File Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#EmulatedFileAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-VI"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Setting variables to a known value before use.", n.name = "Variable Initialization", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#VariableInitialization";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-RAPA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Analyzing the resources accessed by a user to identify unauthorized activity.", n.name = "Resource Access Pattern Analysis", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ResourceAccessPatternAnalysis";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-IRV"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensuring that an integer is within a valid range.", n.name = "Integer Range Validation", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#IntegerRangeValidation";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-PS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Suspending a running process on a computer system.", n.name = "Process Suspension", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSuspension";

MERGE (n:MitreDefendTechnique {d3fendId: "D3-ELM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitoring electronic lock and door hardware states and access events (e.g., locked/unlocked, access granted/denied, door forced/held, tamper) to detect and respond to unauthorized entry.", n.name = "Electronic Lock Monitoring", n.uri = "http://d3fend.mitre.org/ontologies/d3fend.owl#ElectronicLockMonitoring";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScriptApplicationProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A script application process is an application process interpreting an executable script.", n.name = "Script Application Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database service interacts with a database, either retrieving data through queries or making modifications to its contents.", n.name = "Database Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalAuthenticationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A local authentication service running on a host can authenticate a user logged into just that local host computer.", n.name = "Local Authentication Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalAuthorizationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A local authorization service running on a host can authorize a user logged into just that local host computer.", n.name = "Local Authorization Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A running instance of a container image.", n.name = "Container Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlLogicProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The instructions and algorithms within an OT Controller defined by user programming to interpret inputs, process information, and determine outputs.", n.name = "OT Control Logic Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user process is a process running to perform functions in the name of on particular user and user account, such as run an application or application service serving any number users.  This is in contrast to a system process, which executes software to fulfill operating system functions.", n.name = "User Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HMIApplicationProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The instructions within an HMI defined by user programming to interpret visual (and potentially audio) inputs and define visual (and potentially) audio outputs.", n.name = "HMI Application Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application process is an instance of an application computer program that is being executed.", n.name = "Application Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MailService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A mail service provides the ability to send and receive mail across a computer network.  The mail service runs on message transfer agents (i.e., mail servers) and is accessed by users through an email client.", n.name = "Mail Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MessageTransferAgent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A message transfer agent or mail transfer agent (MTA) or mail relay is software that transfers electronic mail messages from one computer to another using a client-server application architecture. An MTA implements both the client (sending) and server (receiving) portions of the Simple Mail Transfer Protocol.", n.name = "Message Transfer Agent";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authentication service is a mechanism, analogous to the use of passwords on time-sharing systems, for the secure authentication of the identity of network clients by servers and vice versa, without presuming the operating system integrity of either (e.g., Kerberos).", n.name = "Authentication Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DirectoryService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, directory service or name service maps the names of network resources to their respective network addresses. It is a shared information infrastructure for locating, managing, administering and organizing everyday items and network resources, which can include volumes, folders, files, printers, users, groups, devices, telephone numbers and other objects. A directory service is a critical component of a network operating system. A directory server or name server is a server which provides such a service. Each resource on the network is considered an object by the directory server. Information about a particular resource is stored as a collection of attributes associated with that resource or object.", n.name = "Directory Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteAuthenticationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote authentication service provides for the authentication of a user across a network (i.e., remotely).", n.name = "Remote Authentication Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthorizationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authorization service ensures that the user is authorized to have access to a particular resource. Authorization can be done through role-based access control (RBAC) or list-based access control (LBAC).", n.name = "Authorization Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer networking, a network service is an application running at the network application layer and above, that provides data storage, manipulation, presentation, communication or other capability which is often implemented using a client-server or peer-to-peer architecture based on application layer network protocols. Clients and servers will often have a user interface, and sometimes other hardware associated with it.", n.name = "Network Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system process, or system process, is a process running to perform operating system functions.", n.name = "Operating System Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileShareService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file sharing service (or file share service) provides the ability to share data across a network.", n.name = "File Share Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteAuthorizationService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote authorization service provides for the authorization of a user across a network (i.e., remotely).", n.name = "Remote Authorization Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPService"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A DHCP service assigns IP address and modifies network configurations.", n.name = "DHCP Service";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemInitProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system initialization process is a process that executes to initialize (boot) an operating system.", n.name = "System Init Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJob"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A task scheduler process is an operating system process that executes scheduled tasks (time-scheduling in the sense of wall clock time; not operating system scheduling of processes for multitasking).", n.name = "Scheduled Job";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceApplicationProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Service Application Process performs specific tasks or provides functionality to support other processes, applications, or users.", n.name = "Service Application Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ParentProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a parent process is a process that has created one or more child processes.", n.name = "Parent Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ChildProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A child process in computing is a process created by another process (the parent process). This technique pertains to multitasking operating systems, and is sometimes called a subprocess or traditionally a subtask. There are two major procedures for creating a child process: the fork system call (preferred in Unix-like systems and the POSIX standard) and the spawn (preferred in the modern (NT) kernel of Microsoft Windows, as well as in some historical operating systems).", n.name = "Child Process";

MERGE (n:MitreDefendProcessEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Process"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process is an instance of a computer program that is being executed. It contains the program code and its current activity. Depending on the operating system (OS), a process may be made up of multiple threads of execution that execute instructions concurrently. A computer program is a passive collection of instructions, while a process is the actual execution of those instructions. Several processes may be associated with the same program; for example, opening up several instances of the same program often means more than one process is being executed.", n.name = "Process";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessorRegister"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A processor register is a quickly accessible location available to a computer's processor. Registers usually consist of a small amount of fast storage, although some registers have specific hardware functions, and may be read-only or write-only.", n.name = "Processor Register";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RAM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Random-access memory (RAM) is a form of computer memory that can be read and changed in any order, typically used to store working data and machine code.", n.name = "RAM";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SecondaryStorage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Secondary memory (storage, hard disk) is the computer component holding information that does not need to be accessed quickly and that needs to be retained long-term.", n.name = "Secondary Storage";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudStorage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cloud storage is storage held within a computing cloud.", n.name = "Cloud Storage";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ROM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read-only memory (ROM) is a type of non-volatile memory used in computers and other electronic devices. Data stored in ROM cannot be electronically modified after the manufacture of the memory device. Read-only memory is useful for storing software that is rarely changed during the life of the system, also known as firmware.", n.name = "ROM";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BootROM"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Boot ROM is a piece of read-only memory (ROM) that is used for booting a computer system. It contains instructions that are run after the CPU is reset to the reset vector, and it typically loads a bootloader.", n.name = "Boot ROM";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PrimaryStorage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Primary memory of a computer is memory that is wired directly to the processor, consisting of RAM and possibly ROM.  These terms are used in contrast to mass storage devices and cache memory (although we may note that when a program accesses main memory, it is often actually interacting with a cache).", n.name = "Primary Storage";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FlashMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Flash memory is an electronic non-volatile computer memory storage medium that can be electrically erased and reprogrammed.", n.name = "Flash Memory";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CacheMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cache memory is temporary storage that is more readily available to the processor than the computer's main memory source, located between the main memory and the processor.  It is typically either integrated directly into the CPU chip (level 1 cache) or placed on a separate chip with a bus interconnect with the CPU (level 2 cache).", n.name = "Processor Cache Memory";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Storage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Computer data storage, often called storage or memory, is a technology consisting of computer components and recording media used to retain digital data. It is a core function and fundamental component of computers. In the Von Neumann architecture, the CPU consists of two main parts: The control unit and the arithmetic / logic unit (ALU). The former controls the flow of data between the CPU and memory, while the latter performs arithmetic and logical operations on data.", n.name = "Storage";

MERGE (n:MitreDefendStorageEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TertiaryStorage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Tertiary storage or tertiary memory is memory primarily used for archiving rarely accessed information. It is primarily useful for extraordinarily large data stores. Typical examples include tape libraries and optical jukeboxes.", n.name = "Tertiary Storage";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyImportEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where registry key data is imported into the Windows Registry from an external source.", n.name = "Windows Registry Key Import Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelModuleLoadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the loading of a kernel module, such as a device driver or dynamically linked extension, into the operating system kernel to extend or modify its capabilities.", n.name = "Kernel Module Load Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileOpenIfEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is opened if it exists, or created if it does not. This operation merges file creation and access behavior.", n.name = "SMB File Open If Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkErrorDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The device automatically disables the link in response to fault conditions such as excessive faults or signal degradation.", n.name = "Physical Link Error Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the event logging service is enabled, allowing it to actively collect and record logs.", n.name = "Event Log Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that captures the behavior, state, or interactions of software applications or services operating within a system. Application events encompass lifecycle changes, configuration updates, and operational anomalies, providing insight into the health and performance of software components.", n.name = "Application Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPGetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is downloaded from an FTP server to a client, retrieving data from the remote system to the local destination.", n.name = "FTP Get Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionResetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an attempt is made to establish a network connection.", n.name = "Network Connection Reset Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessTerminationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event marking the cessation of a process, including resource deallocation and cleanup, either due to normal completion or abnormal termination.", n.name = "Process Termination Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Network Time Protocol (NTP), a protocol designed to synchronize the clocks of computer systems over packet-switched, variable-latency data networks, UDP as its transport protocol.", n.name = "NTP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TCPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Transmission Control Protocol (TCP), providing reliable, ordered, and error-checked delivery of data between applications.", n.name = "TCP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GroupDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an existing group is permanently removed from the system, dissolving its associated memberships and privileges.", n.name = "Group Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPRequestEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP client sends a REQUEST message to confirm or renew its desired IP configuration with a specific DHCP server.", n.name = "DHCP Request Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an existing scheduled task is updated, altering parameters such as timing, conditions, or actions.", n.name = "Scheduled Job Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryReadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process retrieves data from a specific memory address, either from its own allocated space or that of another process.", n.name = "Memory Read Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the permanent deletion of a user account from a system or domain.", n.name = "User Account Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadDeviceConfigurationCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read device configuration.", n.name = "OT Read Device Configuration Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceBindEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a device is logically bound to a system or process, typically for exclusive use or integration with specific software components.", n.name = "Hardware Device Bind Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceEnabledEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a device becomes operational and available for use, typically following initialization, activation, or repair.", n.name = "Hardware Device Enabled Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the activation of a service application, allowing it to start and provide its background or networked functionality.", n.name = "Service Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceMoveEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a device is relocated or reassigned within a system or network, potentially affecting its operational scope or connectivity.", n.name = "Hardware Device Move Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessMediationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the intermediary control mechanism that evaluates access requests and enforces access control decisions, ensuring that subjects' resource interactions comply with the established access policies.", n.name = "Access Mediation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTRunCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to start or resume a service/program.", n.name = "OT Run Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyDeviceOperatingModeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modifies the running state of an application or program on a device.", n.name = "OT Modify Device Operating Mode Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountPasswordResetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user account's password is reset, typically due to a forgotten password or administrative action.", n.name = "User Account Password Reset Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimerConfigurationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a watchdog timer's timeout period or recovery action is configured.", n.name = "Watchdog Timer Configuration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHConnectionResetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the abrupt termination of an SSH connection due to protocol errors, network disruptions, or administrative actions.", n.name = "SSH Connection Reset Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RevokePrivilegesFromGroupEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where specific privileges or rights are removed from a group, restricting its members from performing actions or accessing resources previously allowed by those privileges.", n.name = "Revoke Privileges from Group Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPOfferEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP server sends an OFFER message to a client in response to a DISCOVER request, proposing an IP address and associated configuration parameters.", n.name = "DHCP Offer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving operations performed on digital files, encompassing actions such as creation, modification, deletion, access, and attribute or permission changes.", n.name = "File Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Dynamic Host Configuration Protocol (DHCP), a UDP-based protocol used to dynamically assign IP addresses and configure network parameters, enabling devices to communicate efficiently on a network.", n.name = "DHCP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceIdentificationMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Identify devices on the network.", n.name = "OT Device Identification Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyControlProgramCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that adds, removes, or changes, process data on a remote device.", n.name = "OT Modify Control Program Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountPasswordChangeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user account's password is modified, typically by the user or an administrator.", n.name = "User Account Password Change Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValueGetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the data of a registry value is retrieved, typically to read its configuration or state.", n.name = "Windows Registry Value Get Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPPostEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP POST method is used to submit data to the specified resource, often causing a change in state or side effects on the server.", n.name = "HTTP POST Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogRotateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the event log is rotated, often as part of log rotation policies to manage storage and ensure continuity.", n.name = "Event Log Rotate Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UnloadLibraryEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process unloads a dynamically linked library or module, reducing its memory footprint or functionality.", n.name = "Unload Library Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTestCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a  device to run a program in Test mode.", n.name = "OT Test Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValueEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Events representing actions performed on Windows Registry values, which store configuration data within registry keys.", n.name = "Windows Registry Value Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogStopEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating that the event logging service has been stopped, halting the recording of system events.", n.name = "Event Log Stop Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyRenamingEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the name of a registry key is changed, altering its identifier within the registry hierarchy.", n.name = "Windows Registry Key Renaming Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPConnectRequestEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an RDP client sends a connection request specifying session parameters, such as display settings, compression preferences, and security requirements, to prepare for an interactive session.", n.name = "RDP Connect Request Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceManagementMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage devices and their configurations.", n.name = "OT Device Management Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutputDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing the activity or state of output devices, including sound cards, display adapters, or media controllers. These events relate to audio, video, or graphics functionality.", n.name = "Output Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkUpEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Auto-negotiation and signal detection complete; carrier is present and the link can forward frames.", n.name = "Physical Link Up Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountMFAEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where multi-factor authentication (MFA) is enabled for a user account.", n.name = "User Account MFA Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the disabling of an application, preventing it from being operational or accessed until re-enabled.", n.name = "Application Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTAbortCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.name = "OT Abort Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailReceiveEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an email is delivered to a recipient's mail server or mailbox. This includes receiving messages from internal or external sources via protocols such as IMAP, POP3, or their secure variants.", n.name = "Email Receive Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LoadLibraryEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process dynamically loads a library or module into its memory space, extending its capabilities.", n.name = "Load Library Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeySetSecurityEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the application or modification of access controls or security settings to a registry key.", n.name = "Windows Registry Key Set Security Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTStopCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to stop a service/program.", n.name = "OT Stop Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareTimerInterruptEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a hardware timer generates an interrupt signal upon expiration or interval completion.", n.name = "Hardware Timer Interrupt Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkDisconnectEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The transmission medium is removed or power is cut, physically breaking the path between the two interfaces.", n.name = "Physical Link Disconnect Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileUnmountEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file system or storage volume is unmounted, disconnecting its files and directories from the operating system or applications.", n.name = "File Unmount Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionRefuseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network connection is refused.", n.name = "Network Connection Refuse Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PermissionRevokingEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An administrative event entailing the withdrawal of previously granted access rights, reconfiguring permissions to prevent a subject from performing specific actions on a resource, in accordance with updated access policies.", n.name = "Permission Revoking Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileAccessEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is accessed for operations such as reading, opening, or inspecting its contents or metadata, without necessarily modifying its state.", n.name = "File Access Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event marking the removal of a scheduled task from the system, terminating its execution schedule.", n.name = "Scheduled Job Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving operations at the kernel level of an operating system, encompassing interactions with core system resources such as drivers, modules, system calls, and other privileged processes. Kernel events are critical for understanding low-level system behavior and ensuring the integrity of the operating environment.", n.name = "Kernel Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing operations on the memory resources of a system, encompassing allocation, modification, access, protection, or deallocation.", n.name = "Memory Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command and control the managed process.", n.name = "OT Control Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the removal of a registry key from the Windows Registry, including its hierarchical structure and associated metadata.", n.name = "Windows Registry Key Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationRestartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an application is sequentially stopped and started, typically to refresh its state, apply updates, or resolve issues while preserving its availability.", n.name = "Application Restart Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the File Transfer Protocol (FTP), a standard network protocol used to transfer files between a client and server over a TCP/IP network. FTP facilitates operations such as file uploads, downloads, directory listing, and remote file management.", n.name = "FTP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadTimeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read timing mechanisms.", n.name = "OT Read Time Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProcessDataCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage data associated with a controlled process.", n.name = "OT Process Data Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a scheduled task is activated, allowing it to execute according to its defined parameters.", n.name = "Scheduled Job Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationInstallationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the installation of an application onto a system, making it available for use and interaction.", n.name = "Application Installation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPAckEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP server sends an ACK message to acknowledge a client's REQUEST, confirming the allocation of an IP address and associated network settings.", n.name = "DHCP Ack Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSetTimeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Set timing mechanisms.", n.name = "OT Set Time Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileSupersedeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is overwritten if it exists or created if it does not. This operation combines file creation and modification semantics.", n.name = "SMB File Supersede Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileCreateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is created if it does not already exist, failing if the file is already present. This operation strictly enforces new file creation.", n.name = "SMB File Create Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHConnectionCloseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the termination of an SSH connection, signaling the end of a secure session.", n.name = "SSH Connection Close Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogoffEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authentication event where an active session is conclusively terminated, resulting in the cessation of access and deallocation of resources associated with the session, ensuring that the connection to the system, application, or resource no longer exists.", n.name = "Logoff Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioRFStateChangeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software-defined radio (SDR) event where one or more radio-frequency (RF) parameters have been changed in a way that affects reception or emission (e.g., center frequency retune, gain/attenuation update, bandwidth/filter selection, antenna/port switch, TX enable/disable, etc).", n.name = "Software-defined Radio RF State Change Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessControlEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that captures the implementation or evaluation of access control measures, including the application of rules and policies to govern the accessibility of resources by agents within a digital system.", n.name = "Access Control Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RTCUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a Real-Time Clock's stored time value is read from or written to its battery-backed storage.", n.name = "RTC Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPRequestEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an HTTP request is sent from a client to a server over an established TCP connection.", n.name = "HTTP Request Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryMapEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the mapping of memory regions into a process's virtual address space, enabling efficient access to shared or reserved memory.", n.name = "Memory Map Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPBroadcastEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP server broadcasts time synchronization messages to multiple clients simultaneously, enabling synchronization without individual request-response cycles.", n.name = "NTP Broadcast Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the creation of a new file within the system, establishing its existence and initial attributes in the file system or storage medium.", n.name = "File Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a scheduled task is deactivated, preventing further execution until re-enabled.", n.name = "Scheduled Job Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValueSetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where data is assigned to a registry value, either creating it or updating its existing content.", n.name = "Windows Registry Value Set Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing updates to a user account, including changes to its attributes or configuration.", n.name = "User Account Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTAlarmMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Report danger, hazards, or serious errors.", n.name = "OT Alarm Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDisconnectRemoteConnectionCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The Disconnect Request message is sent to the message receiver to indicate that the transmitter is terminating its TCP socket.", n.name = "OT Disconnect Remote Connection Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogStartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the event logging service is started, enabling the collection and recording of system events.", n.name = "Event Log Start Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountAttachPolicyEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an IAM policy is attached to a user account.", n.name = "User Account Attach Policy Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPLeaseExpireEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating that a DHCP lease has expired, rendering the previously assigned IP address available for reassignment to other devices.", n.name = "DHCP Lease Expire Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the removal of an application from a system, ensuring its binaries, configuration files, and registry entries are deleted or deactivated.", n.name = "Application Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPConnectEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP CONNECT method is used to establish a tunnel to the server identified by the target resource.", n.name = "HTTP CONNECT Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationLayerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event occurring at the application layer, involving protocols that support application-specific communication.", n.name = "Application Layer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyReadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a registry key is accessed to query its structure, properties, or associated metadata without modifying its state.", n.name = "Windows Registry Key Read Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionFailEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network connection attempt fails.", n.name = "Network Connection Fail Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareTimerConfigurationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a hardware timer's registers or operational parameters are programmed or modified.", n.name = "Hardware Timer Configuration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileGetAttributesEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file's metadata attributes, such as size, creation date, or type, are queried or retrieved without altering its content.", n.name = "File Get Attributes Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoveUserFromGroupEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user is removed from a group, revoking the permissions and privileges associated with the group from the user.", n.name = "Remove User from Group Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileDecryptionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a previously encrypted file is decoded, rendering its content accessible to authorized users or processes.", n.name = "File Decryption Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPHeadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP HEAD method is used to request metadata about the specified resource without the response body.", n.name = "HTTP HEAD Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadFileCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads data in specified chuncks or the contents of a specified file stored in the file device connected to the PC.", n.name = "OT Read File Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process modifies allocated memory, potentially altering its content, behavior, or state.", n.name = "Memory Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessDeniedEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the refusal of access to a resource, where an access request has been evaluated and denied based on current authorization policies, preventing operations by the requesting agent.", n.name = "Access Denied Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an existing registry key is updated or reconfigured, reflecting changes to its metadata or properties.", n.name = "Windows Registry Key Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryAllocationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the allocation of memory resources to a process, providing it with the capacity to store data or execute instructions.", n.name = "Memory Allocation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceInstallationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the installation or registration of a service application within the system, enabling it to provide background or reusable functionality.", n.name = "Service Installation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyDeviceConfigurationCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modify device configuration.", n.name = "OT Modify Device Configuration Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceDisabledEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a device transitions to an inactive or unavailable state, often due to deactivation, failure, or maintenance.", n.name = "Hardware Device Disabled Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DetectionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the identification of a potential security issue, such as unauthorized access attempts, policy violations, or anomalous activities. Detection events form the foundation of cybersecurity monitoring and response.", n.name = "Detection Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimerModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which the duration or expiration time of an active timer is changed.", n.name = "Timer Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountDetachPolicyEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an IAM policy is detached from a user account.", n.name = "User Account Detach Policy Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEstablishRemoteConnectionCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Used to establish an TCP/IP Connection to the target device.", n.name = "OT Establish Remote Connection Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPRenameEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where files or directories on an FTP server are renamed, modifying their identifiers without altering their content or location.", n.name = "FTP Rename Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailSendEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an email is transmitted from a client to a recipient via a mail server. This process often involves protocols such as SMTP or its secure variants, with potential authentication and encryption for secure delivery.", n.name = "Email Send Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPGetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP GET method is used to request a representation of the specified resource.", n.name = "HTTP GET Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TransportLayerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event occurring at the transport layer, responsible for end-to-end communication and data transfer management.", n.name = "Transport Layer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StorageDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing the activity, configuration, or errors of storage devices, including physical disks, SSDs, or logical partitions. These events often pertain to data availability, integrity, and storage health.", n.name = "Storage Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing operations or state changes performed on user accounts, including lifecycle management, access control modifications, and policy assignments.", n.name = "User Account Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogDeleteEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the event log database, file, or cache is deleted from the system, removing the log's historical records.", n.name = "Event Log Delete Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user account is enabled, granting it active use within the system.", n.name = "User Account Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceStartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the initiation of a service application, transitioning it from an inactive state to an active state, enabling its background or networked operations.", n.name = "Service Start Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MotionDetectedEvent"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Motion Detected Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalAccessAlarmEvent"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Physical Access Alarm Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user account is disabled, preventing its active use within the system.", n.name = "User Account Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSynchronizeTimeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Used to align timing mechanisms.", n.name = "OT Synchronize Time Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AddUserToGroupEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user is added to a group, granting the user the permissions and privileges associated with the group.", n.name = "Add User to Group Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValueDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a registry value is deleted from the Windows Registry, permanently removing its associated data.", n.name = "Windows Registry Value Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the operation, configuration, or lifecycle of a service application. Services are specialized applications designed to provide reusable functionality to clients, systems, or other applications, often operating in the background or across networks.", n.name = "Service Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceDescriptionMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Describe features, abilities, or performance of system components.", n.name = "OT Device Description Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareClockEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A clock event involving a software-based timekeeping mechanism maintained by an operating system or application.", n.name = "Software Clock Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimerServiceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which the watchdog timer is serviced (kicked/pet), extending the time until expiry.", n.name = "Watchdog Timer Service Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTChangeDataCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that modifies existing data on a remote device.", n.name = "OT Change Data Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDownloadControlProgramCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to download a control program.", n.name = "OT Download Control Program Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ClockSynchronizationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a software clock adjusts its value based on an external time reference (e.g., NTP server, GPS time signal).", n.name = "Clock Synchronization Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareClockEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A clock event involving a physical timekeeping mechanism implemented in hardware components.", n.name = "Hardware Clock Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTPauseCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to pause a service/program.", n.name = "OT Pause Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving email communication, including sending, receiving, and processing emails. Email events encapsulate activities essential to the transmission and analysis of email messages in a networked environment.", n.name = "Email Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is permanently removed from the file system or storage medium, potentially triggering actions related to data retention or recovery.", n.name = "File Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogonEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authentication event where a new session is initiated, signifying the successful validation of credentials and establishment of an authorized connection to a system, application, or resource. This marks the beginning of the subject's authenticated interaction with the system.", n.name = "Logon Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that changes the persisted state of configuration resources by adding, updating, or removing parameters, impacting the target component's behavior.", n.name = "Configuration Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPDiscoverEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP client broadcasts a DISCOVER message to identify available DHCP servers capable of providing IP configuration.", n.name = "DHCP Discover Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationStartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an application transitions from an inactive state to an active state, initializing its resources and becoming operational for user interaction or automated processes.", n.name = "Application Start Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InputDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving human-machine interface devices, such as keyboards, mice, or touchscreens.", n.name = "Input Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPTLSHandshakeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the cryptographic exchange of keys and certificates between an RDP client and server to establish a secure communication channel. The handshake ensures encryption, integrity, and authentication for the session.", n.name = "RDP TLS Handshake Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TunnelEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the establishment, usage, or termination of a network tunnel. Tunnels provide encapsulated communication pathways across various layers, enabling secure, isolated, or virtualized transport of data.", n.name = "Tunnel Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemCallEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user-space process requests a service or resource from the operating system kernel through a system call interface, enabling controlled interactions with hardware or kernel-level operations.", n.name = "System Call Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareTimerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A clock event involving a software-based timekeeping mechanism maintained by an operating system or application.", n.name = "Software Timer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing changes made to an application, such as updates, reconfigurations, or patch installations, while maintaining its presence on the system.", n.name = "Application Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPPutEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is uploaded from a client to an FTP server, transferring data from the local system to the remote destination.", n.name = "FTP Put Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the lifecycle or management of scheduled tasks within a system, including creation, modification, execution, or removal.", n.name = "Scheduled Job Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyExportEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the export of registry key data from the Windows Registry to an external file or format.", n.name = "Windows Registry Key Export Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPSymmetricActiveExchangeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP peer operating in symmetric active mode initiates clock synchronization messages to a peer in symmetric passive mode, enabling time synchronization between equal-status systems.", n.name = "NTP Symmetric Active Exchange Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPInitialRequestEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an RDP client initiates communication with a server by sending a request to establish a session and negotiate protocol capabilities for remote interaction.", n.name = "RDP Initial Request Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A discrete event that creates, applies, modifies, or deletes configuration resources to determine or alter the function of a system, device, application, or service.", n.name = "Configuration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceConfigurationCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Configure or administer managed devices.", n.name = "OT Device Configuration Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPPollEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a client queries an FTP server to check for the presence of specific files or directories without initiating a transfer.", n.name = "FTP Poll Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital event represents an observable occurrence, action, or state change within digital systems, networks, or their interactions. These events are characterized by their impact on the confidentiality, integrity, availability, or functionality of digital resources, processes, identities, or communications. Digital events are essential units of information in cybersecurity, serving as the basis for detecting threats, analyzing anomalies, and orchestrating responses in complex, interconnected environments.", n.name = "Digital Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing changes made to a service application, such as updates, reconfigurations, or patch installations, ensuring its continued availability and functionality.", n.name = "Service Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailScanEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an email is inspected or analyzed for content, security, or compliance purposes. Scanning often involves identifying spam, detecting malware, or ensuring policy adherence before delivery or after reception.", n.name = "Email Scan Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTCreateDataCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that creates data on a remote device.", n.name = "OT Create Data Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating that the event logging service has been disabled, preventing it from collecting or recording logs.", n.name = "Event Log Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSResponseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DNS server responds to a query with resolution data.", n.name = "DNS Response Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RestorationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing actions to return a compromised system or resource to a trusted operational state, such as through backup restoration, system reinstallation, or repair.", n.name = "Restoration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkConnectEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The medium is attached or the port is enabled, establishing electrical or optical continuity so that link negotiation can begin.", n.name = "Physical Link Connect Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHConnectionRefuseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating that an SSH connection attempt was refused, typically due to server-side restrictions or closed ports.", n.name = "SSH Connection Refuse Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTNetworkManagementCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage message routing or network connection mechanisms.", n.name = "OT Network Management Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileEncryptionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the application of cryptographic techniques to a file, ensuring its content is securely encoded and inaccessible without proper decryption keys.", n.name = "File Encryption Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a new registry key is added to the Windows Registry, establishing a new hierarchical node for configuration.", n.name = "Windows Registry Key Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AssignPrivilegesToGroupEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where specific privileges or rights are granted to a group, enabling its members to perform actions or access resources as defined by the privileges.", n.name = "Assign Privileges to Group Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPClientSyncEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP client requests and adjusts its clock based on time synchronization data provided by an NTP server, ensuring alignment with a standard time source.", n.name = "NTP Client Synchronization Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDiagnosticsMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Relay error, exception, alarm, or log information.", n.name = "OT Diagnostics Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Hypertext Transfer Protocol (HTTP), which operates over TCP to transmit hypermedia documents.", n.name = "HTTP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileOverwriteIfEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is opened and truncated if it exists, or created otherwise. This operation combines destructive overwrite and creation behaviors.", n.name = "SMB File Overwrite If Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionOpenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network connection is successfully opened.", n.name = "Network Connection Open Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfigurationModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which the configuration of a specific software application is changed, affecting how that application executes, interacts with other components, or exposes functionality to users or services.", n.name = "Application Configuration Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioWaveformLoadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An SDR event where a waveform application (software/firmware/FPGA image and associated descriptors) has been installed or selected on the SDR and is available to be configured.", n.name = "Software-defined Radio Waveform Application Load Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UDPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the User Datagram Protocol (UDP), providing a connectionless datagram service with minimal protocol mechanisms.", n.name = "UDP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioWaveformConfigurationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An SDR event where the waveform application's operational parameters have been applied and validated (e.g., sample rate, bandwidth, channel selection, framing/modulation options), placing the waveform in a state ready to run.", n.name = "Software-defined Radio Waveform Application Configuration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceStateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving a change to a device's state, such as connection, disconnection, modification, or operational state transitions (e.g., online or offline). Device state events provide visibility into device availability and operational conditions.", n.name = "Hardware Device State Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogExportEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the export of event log data to a file or external system for backup or analysis purposes.", n.name = "Event Log Export Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputeDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the operation, state, or performance of computational hardware, such as CPUs, GPUs, or accelerators. These events reflect processing capacity changes, utilization anomalies, or device health.", n.name = "Compute Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudConfigurationModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that updates cloud-hosted resource configurations such as IAM policies, virtual network constructs, storage settings, or managed-service parameters; impacting resource provisioning, access control, functionality, or compliance.", n.name = "Cloud Configuration Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDebugCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Investigate or analyze the current state of the system.", n.name = "OT Debug Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing activity in primary storage devices, such as DRAM or SRAM memory initialization, reconfiguration, or failures.", n.name = "Memory Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPControlMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP client or server exchanges control messages used for diagnostic, monitoring, or administrative management of the NTP protocol, rather than time synchronization.", n.name = "NTP Control Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimerExpirationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a software timer reaches its configured duration and triggers associated actions (callbacks, interrupts, or signals).", n.name = "Timer Expiration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Server Message Block (SMB) protocol, a network file sharing protocol that allows client-server communication for accessing files, printers, and other shared network resources. SMB supports both transactional file operations and communication over reliable transport layers.", n.name = "SMB Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An administrator issues a shutdown or disable command, forcing the link out of service regardless of signal status.", n.name = "Physical Link Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Events involving interactions with the Windows Registry, including keys, values, and associated security configurations.", n.name = "Windows Registry Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the uninstallation or deregistration of a service application, ensuring it is no longer operational or available to clients.", n.name = "Service Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTWriteCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Write or store data.", n.name = "OT Write Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemConfigurationModificationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that alters persistent operating-system configuration resources such as kernel options, registry keys, service definitions, or security policies; affecting system startup, hardware interfaces, or global security enforcement.", n.name = "Operating System Configuration Modification Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPResponseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an HTTP response is sent from a server to a client over an established TCP connection.", n.name = "HTTP Response Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTCreateNewControlProgramCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to create an control program.", n.name = "OT Create New Control Program Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A discrete occurrence within an operational technology environment that denotes a significant change in state, execution of a command, or transmission of information.", n.name = "OT Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTransportConfigurationCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Configure transport settings for a communication channel.", n.name = "OT Transport Configuration Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSetAttributesEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file's metadata attributes are modified, such as changing its timestamps, labels, or categorization within the system.", n.name = "File Set Attributes Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMountEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file system or storage volume is mounted, making its files and directories accessible to the operating system or applications.", n.name = "File Mount Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceUnbindEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a device is logically unbound from a system or process, releasing it from exclusive use or integration.", n.name = "Hardware Device Unbind Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GroupCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a new group is established within the system, defining an entity to manage users and permissions collectively.", n.name = "Group Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemClockUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which the operating system's primary timekeeping value is modified or synchronized.", n.name = "System Clock Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileRenamingEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the renaming of a file, modifying its identifier within the file system while retaining its content and metadata.", n.name = "File Renaming Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the creation of a new user account within a system or domain.", n.name = "User Account Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event that captures actions or operations related to the management of system event logs, including modifications, access, and service state changes.", n.name = "Event Log Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProgramModeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command that places the controller in a mode capable of reprogramming logic. This may or may not stop the program.", n.name = "OT Program Mode Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTRemoteModeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command that places the controller in a mode capable of receiving read/write communication from a networked entity.", n.name = "OT Remote Mode Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IsolationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving actions to create logical or physical barriers that isolate compromised components, preventing adversary movement and reducing attack surfaces.", n.name = "Isolation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelModuleUnloadEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the removal of a kernel module from the operating system kernel, deallocating resources and potentially altering system functionality.", n.name = "Kernel Module Unload Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceConnectionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the physical or logical attachment of a device to a system, enabling its operational functionality.", n.name = "Hardware Device Connection Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileCopyEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is duplicated, creating a new file in a different location or under a different name while preserving the original file's content and attributes.", n.name = "File Copy Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPDeleteEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP DELETE method is used to delete the specified resource.", n.name = "HTTP DELETE Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimerExpirationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the watchdog timer was not serviced in time and triggers a reset or escalation action.", n.name = "Watchdog Timer Expiration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Secure Shell (SSH) protocol, a cryptographic network protocol designed to provide secure remote login, command execution, and data transfer. SSH facilitates encrypted communication between clients and servers, ensuring confidentiality, integrity, and authenticity.", n.name = "SSH Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileOpenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is opened if it exists, failing otherwise. This operation is used to access or query the existing file.", n.name = "SMB File Open Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelModuleEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the management of kernel modules, such as the loading or unloading of device drivers, extensions, or other dynamically linked components essential for kernel functionality.", n.name = "Kernel Module Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing lifecycle transitions, interactions, or activities of computer processes, including their creation, termination, and inter-process communication.", n.name = "Process Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHConnectionOpenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the successful establishment of an SSH connection between a client and a server, marking the initiation of a secure session.", n.name = "SSH Connection Open Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogClearEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the event log data is cleared from the system, often as part of log maintenance or potentially to cover tracks.", n.name = "Event Log Clear Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkDownEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Carrier or negotiation is lost, or the port is shut, rendering the link non-operational while the medium remains connected.", n.name = "Physical Link Down Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceDisconnectionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the removal of a device from a system, ceasing its operational functionality or availability.", n.name = "Hardware Device Disconnection Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogRestartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the restarting of the event logging service, often performed during system maintenance or troubleshooting.", n.name = "Event Log Restart Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValueUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating changes to the data or configuration of an existing registry value within the Windows Registry.", n.name = "Windows Registry Value Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ElectronicCombinationLockEvent"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Electronic Combination Lock Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EvictionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing actions to remove adversaries or malicious resources from a system, re-establishing security and operational integrity.", n.name = "Eviction Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PermissionGrantingEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An administrative event where authorization is given, allowing a subject to perform specific operations on a protected resource, effectuating a policy decision to allow access rights.", n.name = "Permission Granting Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthorizationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event reflecting the decision-making process and actions concerning access control, recording whether agents are permitted or denied access to resources based on pre-defined access control policies.", n.name = "Authorization Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountLockEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a user account is locked out due to failed authentication attempts or administrative action.", n.name = "User Account Lock Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the addition of a new task to the system's scheduler, defining its execution criteria and associated actions.", n.name = "Scheduled Job Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSetUserIDEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process changes or adopts a specific user identity, modifying its access privileges or operational context.", n.name = "Process Set User ID Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ClockEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving a clock artifact, characterized by changes to or readings from a timekeeping mechanism that maintains a representation of temporal progression.", n.name = "Clock Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPSymmetricPassiveExchangeEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP peer operating in symmetric passive mode responds to clock synchronization messages initiated by a symmetric active peer, facilitating mutual timekeeping.", n.name = "NTP Symmetric Passive Exchange Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Domain Name System (DNS), which translates domain names to IP addresses and operates over UDP and TCP.", n.name = "DNS Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryDeletionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event marking the release or deallocation of memory resources, reclaiming them for reuse within the system.", n.name = "Memory Deletion Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPReleaseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP client sends a RELEASE message to relinquish its assigned IP address and cancel any remaining lease duration.", n.name = "DHCP Release Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving changes to the content or metadata of an existing file, reflecting updates that alter its state or properties.", n.name = "File Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessAccessEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where one process interacts with another, such as reading memory, inspecting state, or altering behavior.", n.name = "Process Access Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPTraceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP TRACE method is used to perform a message loop-back test along the path to the target resource.", n.name = "HTTP TRACE Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event related to the establishment, maintenance, or termination of a network connection.", n.name = "Network Connection Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationStopEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the cessation of an application's operations, transitioning it to an inactive state and releasing any allocated resources.", n.name = "Application Stop Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TunnelOpenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network tunnel is established, enabling encapsulated communication between endpoints. This marks the initiation of secure or isolated data transport through the tunnel.", n.name = "Tunnel Open Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTErrorMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An anticipated, reproducible defect occurred within the system.", n.name = "OT Error Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionListenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network endpoint begins listening for new network connections.", n.name = "Network Connection Listen Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeleteControlProgramCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to remove an existing control program.", n.name = "OT Delete Control Program Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryWriteEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a process writes data to a memory address, storing new information or updating existing content.", n.name = "Memory Write Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the systematic process of verifying an agent's identity within a system, involving credential validation and identity confirmation.", n.name = "Authentication Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTimeCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read, set, or calculate timing mechanisms.", n.name = "OT Time Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TunnelCloseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network tunnel is terminated, ending encapsulated communication and releasing the associated resources.", n.name = "Tunnel Close Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPInitialResponseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an RDP server responds to an initial request from a client, presenting its supported capabilities and agreeing to proceed with session negotiation.", n.name = "RDP Initial Response Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Events representing actions performed on Windows Registry keys, such as creation, modification, or deletion, which define hierarchical nodes for storing configuration data.", n.name = "Windows Registry Key Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the Remote Desktop Protocol (RDP), a communication protocol developed by Microsoft that facilitates secure remote access to graphical interfaces on desktops or applications hosted on remote servers. RDP supports multi-channel communication for transferring input, output, and management commands.", n.name = "RDP Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPDeleteEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where files or directories are removed from an FTP server, resulting in their permanent deletion from the remote system.", n.name = "FTP Delete Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ScheduledJobStartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating the execution of a scheduled task, triggered either automatically by the scheduler or manually by a user.", n.name = "Scheduled Job Start Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GroupManagementEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the creation, modification, or deletion of a group, or changes to its membership and privileges. Group management events facilitate the enforcement of role-based access control by organizing users and permissions into logical units for streamlined administration and policy enforcement.", n.name = "Group Management Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHListenEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating that an SSH server has started listening for incoming connection requests, enabling potential clients to initiate secure sessions.", n.name = "SSH Listen Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPInformEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP client sends an INFORM message to request configuration parameters, such as DNS or gateway information, without requiring IP address assignment.", n.name = "DHCP Inform Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationEnableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing the enabling of an application, allowing it to be started or accessed when required.", n.name = "Application Enable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FTPListEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the contents of a directory on an FTP server are listed, providing metadata such as file names, sizes, and timestamps.", n.name = "FTP List Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPPutEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP PUT method is used to replace all current representations of the target resource with the request payload.", n.name = "HTTP PUT Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLogArchiveEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the archiving of event log data, typically to preserve historical records in a compressed or secure format.", n.name = "Event Log Archive Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceRestartEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing the sequential stopping and starting of a service application to refresh its state, apply updates, or resolve operational issues.", n.name = "Service Restart Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTTPOptionsEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the HTTP OPTIONS method is used to describe the communication options for the target resource.", n.name = "HTTP OPTIONS Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving a timer artifact, characterized by the initiation, expiration, modification, or cancellation of a countdown or interval-based temporal mechanism.", n.name = "Timer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimerResetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a watchdog timer is reset as a consequence of watchdog timer expiry or watchdog timer escalation policy.", n.name = "Watchdog Timer Reset Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceDisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the deactivation of a service application, preventing it from being started or accessed until re-enabled.", n.name = "Service Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileGetPermissionsEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file's security settings or access control list (ACL) is retrieved, detailing permissions granted to users or processes.", n.name = "File Get Permissions Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareTimerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A timer event involving a physical timer mechanism implemented in hardware components.", n.name = "Hardware Timer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardeningEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving actions to strengthen defenses, such as applying patches or implementing secure configurations, reducing attack surfaces, and increasing the difficulty of exploitation by adversaries.", n.name = "Hardening Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSQueryEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DNS query is made to resolve a domain name.", n.name = "DNS Query Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SMBFileOverwriteEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a file is opened and truncated if it exists, failing if the file does not already exist. This operation is destructive and focuses on replacing the file's contents.", n.name = "SMB File Overwrite Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimerSetEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event in which a software timer is initialized with a specific duration or expiration time.", n.name = "Timer Set Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProprietaryMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Vendor specific and may not be publicly documented, or values left for device specific configuration.", n.name = "OT Proprietary Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSetPermissionsEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving the modification of a file's permissions or access control list (ACL), specifying which users or processes are granted or restricted access.", n.name = "File Set Permissions Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTChangeControlProgramCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to modify an existing control program.", n.name = "OT Change Control Program Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccountMFADisableEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where multi-factor authentication (MFA) is disabled for a user account.", n.name = "User Account MFA Disable Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLinkEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A discrete event that changes either the presence of the transmission medium or the operational state of a single-hop layer-1 link between two network nodes.", n.name = "Physical Link Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeleteDataCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that removes data on a remote device.", n.name = "OT Delete Data Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceFirmwareCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Interact with the software responsible for low-level control of the system.", n.name = "OT Device Firmware Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the existence, state, or interaction of hardware or virtual devices within a system. Device events encompass activities such as discovery, connection, disconnection, operational state changes, or configuration modifications, providing visibility into device behavior and health.", n.name = "Hardware Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceUpdateEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing updates or changes to a device's configuration, properties, or state, including firmware updates, reconfigurations, or optimizations.", n.name = "Hardware Device Update Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessGrantedEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event signifying that access to a resource has been authorized and successfully enforced, allowing the requesting agent to perform specified operations based on the access control policies.", n.name = "Access Granted Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SecurityEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event describing occurrences related to cybersecurity, including detection, remediation, or enforcement actions. Security events provide critical insights into the state, behavior, and resilience of digital systems.", n.name = "Security Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProximitySensorEvent"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Proximity Sensor Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkConnectionCloseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a network connection is closed.", n.name = "Network Connection Close Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimerEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A watchdog timer event is any occurrence in which a watchdog timer is started, updated, reset, expired, or otherwise interacts with the system it monitors, resulting in a state change, status report, or corrective action intended to detect, signal, or recover from abnormal or stalled system behavior.", n.name = "Watchdog Timer Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTConnectionCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Establish a network connection with a device.", n.name = "OT Connection Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHConnectionFailEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event indicating a failure to establish an SSH connection, often due to issues such as authentication errors, network timeouts, or server unavailability.", n.name = "SSH Connection Fail Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TunnelRenewEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where the lifecycle of a network tunnel is extended, ensuring continued encapsulated communication and avoiding session expiration.", n.name = "Tunnel Renew Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving a software-defined radio (SDR) device indicating that the SDR's lifecycle state, operational state, configuration, data-streaming status, timing/reference status, or fault condition has changed.", n.name = "Software-defined Radio Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadValueCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads the contents of the specified number of consecutive parameter areawords starting from the specified word.", n.name = "OT Read Value Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTExceptionMessageEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An unknown or anomalous condition occurred in the system.", n.name = "OT Exception Message Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the activity or state of network devices, such as Ethernet adapters, Wi-Fi modules, or virtual interfaces. These events highlight connectivity, configuration, or performance changes.", n.name = "Network Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessCreationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a new process is spawned, initializing its execution context and resource allocation.", n.name = "Process Creation Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PeripheralDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving external or auxiliary devices, such as USB drives, Thunderbolt peripherals, or Bluetooth devices. Peripheral events provide visibility into resource availability and potential unauthorized access.", n.name = "Peripheral Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PowerAndThermalDeviceEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving power supplies, batteries, or thermal management devices. These events represent changes in power states, temperature thresholds, or cooling system activity.", n.name = "Power and Thermal Device Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTPServerResponseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an NTP server sends time synchronization data to a client, enabling the client to align its local clock with the server's reference time.", n.name = "NTP Server Response Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceStopEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event capturing the cessation of a service application's operations, transitioning it to an inactive state while ceasing its functionality to clients or dependent systems.", n.name = "Service Stop Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read or retrieve data.", n.name = "OT Read Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event involving network communications within or between digital systems.", n.name = "Network Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSecurityCommandEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensure confidentiality, integrity, or availability of system information.", n.name = "OT Security Command Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKeyRestoreEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a registry key is restored to a previous state using a backup or recovery mechanism.", n.name = "Windows Registry Key Restore Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PreAuthenticationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event representing preparatory steps or processes conducted prior to the primary authentication operation. Pre-authentication often involves initial protocol exchanges, cryptographic challenges, or the validation of supplemental factors (e.g., pre-shared keys) to ensure the readiness and security of the authentication workflow.", n.name = "Pre-Authentication Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPConnectResponseEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where an RDP server acknowledges a connection request, finalizing session parameters and confirming the transition to an interactive remote session.", n.name = "RDP Connect Response Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessControlAdministrationEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event concerning the administrative actions of setting, modifying, or abolishing permissions, configuring access control settings, and managing user access rights to ensure alignment with access control policies.", n.name = "Access Control Administration Event";

MERGE (n:MitreDefendDigitalEventEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPNakEvent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An event where a DHCP server sends a NAK message to reject a client's REQUEST, indicating that the requested configuration cannot be granted.", n.name = "DHCP Nak Event";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Sensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In the broadest definition, a sensor is a device, module, machine, or subsystem that detects events or changes in its environment and sends the information to other electronics, frequently a computer.", n.name = "Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FirmwareSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collects information on firmware installed on an Endpoint.", n.name = "Firmware Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT Sensor is an industrial-grade sensing device engineered for operational technology (OT) environments (e.g. SCADA, ICS). It measures physical variables--such as pressure, temperature, or flow--under demanding conditions, converting them into reliable signals for real-time monitoring and process control loops.", n.name = "OT Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MotionDetector"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An electrical device that utilizes a sensor to detect nearby motion.", n.name = "Motion Detector";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationInventorySensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collects information on applications on an endpoint.", n.name = "Application Inventory Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EndpointSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A sensor application installed on a endpoint (platform) to collect information on platform components.", n.name = "Endpoint Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkFlowSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitors network traffic and produces summaries of data flows traversing the network.", n.name = "Network Flow Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProximitySensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A sensor able to detect the presence of nearby objects without any physical contact.", n.name = "Proximity Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSystemSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collects files and file metadata on an endpoint.", n.name = "File System Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TransducerSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Transducer Sensor converts physical signals into digital data for monitoring purposes.", n.name = "Transducer Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelAPISensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitors system calls (operating system api functions).", n.name = "Kernel API Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkScanner"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network scanner is a computer program used to retrieve usernames and info on groups, shares, and services of networked computers. This type of program scans networks for vulnerabilities in the security of that network. If there is a vulnerability with the security of the network, it will send a report back to a hacker who may use this info to exploit that network glitch to gain entry to the network or for other malicious activities. Ethical hackers often also use the information to remove the glitches and strengthen their network.", n.name = "Network Scanner";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HostConfigurationSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collects the configuration data on an endpoint.", n.name = "Host Configuration Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CyberSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A cyber sensor collects and monitors data related to cyber activities, events, or environments.", n.name = "Cyber Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudServiceSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Senses data from cloud service platforms. Including data from cloud service  authentications, authorizations, and other activities.", n.name = "Cloud Service Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkSensor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Network Sensor monitors network traffic and communication patterns.", n.name = "Network Sensor";

MERGE (n:MitreDefendSensorEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkProtocolAnalyzer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Monitors and parses network protocols to extract values from various network protocol layers.", n.name = "Network Protocol Analyzer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DataArtifactServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A data artifact server provides access services to content in a content repository.  The content repository or content store is a database of digital content with an associated set of data management, search and access methods allowing application-independent access to the content, rather like a digital library, but with the ability to store and modify content in addition to searching and retrieving. The content repository acts as the storage engine for a larger application such as a content management system or a document management system, which adds a user interface on top of the repository's application programming interface.", n.name = "Data Artifact Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VPNServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A VPN server is a type of server that enables hosting and delivery of VPN services.  It is a combination of VPN hardware and software technologies that provides VPN clients with connectivity to a secure and/or private network, or rather, the VPN.", n.name = "VPN Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Router"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A router is a networking device that forwards data packets between computer networks. Routers perform the traffic directing functions on the Internet. Data sent through the internet, such as a web page or email, is in the form of data packets. A packet is typically forwarded from one router to another router through the networks that constitute an internetwork (e.g. the Internet) until it reaches its destination node.", n.name = "Router";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TabletComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A tablet computer, commonly shortened to tablet, is a mobile device, typically with a mobile operating system and touchscreen display processing circuitry, and a rechargeable battery in a single, thin and flat package. Tablets, being computers, do what other personal computers do, but lack some input/output (I/O) abilities that others have. Modern tablets largely resemble modern smartphones, the only differences being that tablets are relatively larger than smartphones, with screens 7 inches (18 cm) or larger, measured diagonally, and may not support access to a cellular network.", n.name = "Tablet Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DialUpModem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A dial-up modem transmits computer data over an ordinary switched telephone line that has not been designed for data use. This contrasts with leased line modems, which also operate over lines provided by a telephone company, but ones which are intended for data use and do not impose the same signaling constraints. The modulated data must fit the frequency constraints of a normal voice audio signal, and the modem must be able to perform the actions needed to connect a call through a telephone exchange, namely: picking up the line, dialing, understanding signals sent back by phone company equipment (dial tone, ringing, busy signal,) and on the far end of the call, the second modem in the connection must be able to recognize the incoming ring signal and answer the line.", n.name = "Dial Up Modem";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEmbeddedComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A ruggedized computational device, embedded in industrial control systems, designed to handle real-time tasks and environmental stressors common in OT.", n.name = "OT Embedded Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IPPhone"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A VoIP phone or IP phone uses voice over IP technologies for placing and transmitting telephone calls over an IP network, such as the Internet, instead of the traditional public switched telephone network (PSTN). Digital IP-based telephone service uses control protocols such as the Session Initiation Protocol (SIP), Skinny Client Control Protocol (SCCP) or various other proprietary protocols.", n.name = "IP Phone";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OnboardComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A self-contained, embedded computing unit installed within a vehicle or other autonomous platform that executes real-time control, data-handling, and mission-management software. It interfaces directly with the platform's sensors, actuators, and communication links, processes and stores operational data, and issues commands to subsystems, enabling the system to function independently of external computing resources.", n.name = "Onboard Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LaptopComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A laptop computer (also laptop), is a small, portable personal computer (PC) with a \"clamshell\" form factor, typically having a thin LCD or LED computer screen mounted on the inside of the upper lid of the clamshell and an alphanumeric keyboard on the inside of the lower lid. The clamshell is opened up to use the computer. Laptops are folded shut for transportation, and thus are suitable for mobile use. Its name comes from lap, as it was deemed to be placed on a person's lap when being used. Although originally there was a distinction between laptops and notebooks (the former being bigger and heavier than the latter), as of 2014, there is often no longer any difference. Today, laptops are commonly used in a variety of settings, such as at work, in education, for playing games, web browsing", n.name = "Laptop Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTHumanMachineInterface"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Human-Machine Interfaces (HMIs) are systems used by an operator to monitor the real-time status of an operational process and to perform necessary control functions, including the adjustment of device parameters.", n.name = "OT Human Machine Interface";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database server is a server which uses a database application that provides database services to other computer programs or to computers, as defined by the client-server model. Database management systems (DBMSs) frequently provide database-server functionality, and some database management systems (such as MySQL) rely exclusively on the client-server model for database access (while others e.g. SQLite are meant for using as an embedded database). For clarification, a database server is simply a server that maintains services related to clients via database applications.", n.name = "Database Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MediaServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A media server is a computer appliance or an application software that stores digital media (video, audio or images) and makes it available over a network. Media servers range from servers that provide video on demand to smaller personal computers or NAS (Network Attached Storage) for the home.", n.name = "Media Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputingServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A compute server is a system specifically designed to undertake large amounts of computation, usually but not necessarily in a client/server environment.", n.name = "Computing Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkPrinter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a network printer is a device that can be accessed over a network which makes a persistent representation of graphics or text, usually on paper. While most output is human-readable, bar code printers are an example of an expanded use for printers. The different types of printers include 3D printer, inkjet printer, laser printer, thermal printer, etc.  Note that not all printers are networked and the digital information to be printed must be passed either by removable media or as directly connecting the printer to a computer (e.g., by USB.)", n.name = "Network Printer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MobilePhone"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A mobile phone, cellular phone, cell phone, cellphone or hand phone, sometimes shortened to simply mobile, cell or just phone, is a portable telephone that can make and receive calls over a radio frequency link while the user is moving within a telephone service area. The radio frequency link establishes a connection to the switching systems of a mobile phone operator, which provides access to the public switched telephone network (PSTN). Modern mobile telephone services use a cellular network architecture and, therefore, mobile telephones are called cellular telephones or cell phones in North America. In addition to telephony, digital mobile phones (2G) support a variety of other services, such as text messaging, MMS, email, Internet access, short-range wireless communications (infrared,", n.name = "Mobile Phone";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TFTPServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Trivial File Transfer Protocol (TFTP) is a simple file transfer protocol, typically used to automatically transfer configuration or boot files between machines.  It is used where user authentication and directory visibility are not required.", n.name = "TFTP Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ForwardProxyServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An forward (or open) proxy is a proxy server that is accessible by any Internet user. Generally, a proxy server only allows users within a network group (i.e. a closed proxy) to store and forward Internet services such as DNS or web pages to reduce and control the bandwidth used by the group. With an open proxy, however, any user on the Internet is able to use this forwarding service.", n.name = "Forward Proxy Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WirelessRouter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A wireless router is a device that performs the functions of a router and also includes the functions of a wireless access point. It is used to provide access to the Internet or a private computer network. Depending on the manufacturer and model, it can function in a wired local area network, in a wireless-only LAN, or in a mixed wired and wireless network.", n.name = "Wireless Router";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PrintServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A print server, or printer server, is a device that connects printers to client computers over a network. It accepts print jobs from the computers and sends the jobs to the appropriate printers, queuing the jobs locally to accommodate the fact that work may arrive more quickly than the printer can actually handle.", n.name = "Print Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmbeddedComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An embedded computer is a computer system -- a combination of a computer processor, computer memory, and input/output peripheral devices-that has a dedicated function within a larger mechanical or electrical system. It is embedded as part of a complete device often including electrical or electronic hardware and mechanical parts. Because an embedded system typically controls physical operations of the machine that it is embedded within, it often has real-time computing constraints. Embedded systems control many devices in common use today. Ninety-eight percent of all microprocessors manufactured are used in embedded systems.", n.name = "Embedded Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ThinClientComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A thin client is a lightweight computer that has been optimized for establishing a remote connection with a server-based computing environment. The server does most of the work, which can include launching software programs, performing calculations, and storing data. This contrasts with a fat client or a conventional personal computer; the former is also intended for working in a client-server model but has significant local processing power, while the latter aims to perform its function mostly locally. Thin clients are shared computers as the thin client's computing resources are provided by a remote server.", n.name = "Thin Client Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTController"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT Controller is an industrial control device that automatically regulates one or more controlled variables in response to command inputs and real-time feedback signals.", n.name = "OT Controller";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PersonalComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A personal computer (PC) is a multi-purpose computer whose size, capabilities, and price make it feasible for individual use. Personal computers are intended to be operated directly by an end user, rather than by a computer expert or technician. Unlike large, costly minicomputers and mainframes, time-sharing by many people at the same time is not used with personal computers. PCs have in practice become powerful enough that they may be shared by multiple users at any given time, though this is not common practice nor the primary purpose of a PC.", n.name = "Personal Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web server is server software, or hardware dedicated to running this software, that can satisfy client requests on the World Wide Web. A web server can, in general, contain one or more websites. A web server processes incoming network requests over HTTP and several other related protocols. While the major function is to serve content, a full implementation of HTTP also includes ways of receiving content from clients. This feature is used for submitting web forms, including uploading of files.", n.name = "Web Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An authentication server provides a network service that applications use to authenticate the credentials, usually account names and passwords, of their users. When a client submits a valid set of credentials, it receives a cryptographic ticket that it can subsequently use to access various services. Major authentication algorithms include passwords, Kerberos, and public key encryption.", n.name = "Authentication Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProxyServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer networking, a proxy server is a server application or appliance that acts as an intermediary for requests from clients seeking resources from servers that provide those resources. A proxy server thus functions on behalf of the client when requesting service, potentially masking the true origin of the request to the resource server.", n.name = "Proxy Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OpticalModem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A modem that connects to a fiber optic network is known as an optical network terminal (ONT) or optical network unit (ONU). These are commonly used in fiber to the home installations, installed inside or outside a house to convert the optical medium to a copper Ethernet interface, after which a router or gateway is often installed to perform authentication, routing, NAT, and other typical consumer internet functions, in addition to \"triple play\" features such as telephony and television service.", n.name = "Optical Modem";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Switch"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network switch (also called switching hub, bridging hub, and by the IEEE MAC bridge) is networking hardware that connects devices on a computer network by using packet switching to receive and forward data to the destination device. A network switch is a multiport network bridge that uses MAC addresses to forward data at the data link layer (layer 2) of the OSI model. Some switches can also forward data at the network layer (layer 3) by additionally incorporating routing functionality. Such switches are commonly known as layer-3 switches or multilayer switches.", n.name = "Switch";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTimeServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network time server is a server computer that reads the actual time from a reference clock and distributes this information to its clients using a computer network. The time server may be a local network time server or an internet time server. The time server may also be a stand-alone hardware device. It can use NTP (RFC5905) or other protocols.", n.name = "Network Time Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The term server highlights the role of the machine in the traditional client-server scheme, where the clients are the workstations using the storage. A file server does not normally perform computational tasks or run programs on behalf of its client workstations. File servers are commonly found in schools and offices, where users use a local area network to connect their client computers.", n.name = "File Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ReverseProxyServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer networks, a reverse proxy is a type of proxy server that retrieves resources on behalf of a client from one or more servers. These resources are then returned to the client, appearing as if they originated from the proxy server itself. Unlike a forward proxy, which is an intermediary for its associated clients to contact any server, a reverse proxy is an intermediary for its associated servers to be contacted by any client. In other words, a proxy acts on behalf of the client(s), while a reverse proxy acts on behalf of the server(s); a reverse proxy is usually an internal-facing proxy used as a 'front-end' to control and protect access to a server on a private network.", n.name = "Reverse Proxy Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Host"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A host is a computer or other device, typically connected to a computer network. A network host may offer information resources, services, and applications to users or other nodes on the network. A network host is a network node that is assigned a network layer host address. Network hosts that participate in applications that use the client-server model of computing, are classified as server or client systems. Network hosts may also function as nodes in peer-to-peer applications, in which all nodes share and consume resources in an equipotent manner.", n.name = "Host";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RadioModem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A radio modem provides the means to send digital data wirelessly.  Radio modems are used to communicate by direct broadcast satellite, WiFi, WiMax, mobile phones, GPS, Bluetooth and NFC. Modern telecommunications and data networks also make extensive use of radio modems where long distance data links are required. Such systems are an important part of the PSTN, and are also in common use for high-speed computer network links to outlying areas where fiber optic is not economical.", n.name = "Radio Modem";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputerNetworkNode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network node running on a computer platform.", n.name = "Computer Network Node";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ArtifactServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital artifact server provides access services to digital artifacts in a repository.  It provides an associated set of data management, search and access methods allowing application-independent access to the content.", n.name = "Artifact Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Modem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A modem -- a portmanteau of \"modulator-demodulator\" -- is a hardware device that converts data into a format suitable for a transmission medium so that it can be transmitted from one computer to another (historically along telephone wires). A modem modulates one or more carrier wave signals to encode digital information for transmission and demodulates signals to decode the transmitted information. The goal is to produce a signal that can be transmitted easily and decoded reliably to reproduce the original digital data. Modems can be used with almost any means of transmitting analog signals from light-emitting diodes to radio. A common type of modem is one that turns the digital data of a computer into modulated electrical signal for transmission over telephone lines and demodulated by another modem at the receiver side to recover the digital data.", n.name = "Modem";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperationsCenterComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Mainframe computers or mainframes (colloquially referred to as \"big iron\") are computers used primarily by large organizations for critical applications; bulk data processing, such as census, industry and consumer statistics, and enterprise resource planning; and transaction processing. They are larger and have more processing power than some other classes of computers: minicomputers, servers, workstations, and personal computers.", n.name = "Operations Center Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OrchestrationController"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An orchestration server provides orchestration services that automate the configuration, coordination, and management of computer systems and software.", n.name = "Orchestration Controller";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Domain Name System (DNS) name server is a kind of name server.  Domain names are one of the two principal namespaces of the Internet. The most important function of DNS servers is the translation (resolution) of human-memorable domain names and hostnames into the corresponding numeric Internet Protocol (IP) addresses, the second principal name space of the Internet which is used to identify and locate computer systems and resources on the Internet. (en).  More generally, a name server is a computer application that implements a network service for providing responses to queries against a directory service. It translates an often humanly meaningful, text-based identifier to a system-internal, often numeric identification or addressing component. This service is performed by the server in response to a service protocol request.", n.name = "DNS Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusNetworkNode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device or logical endpoint whose interface is directly connected to a bus and exchanges data over the shared medium using the protocol implemented on that interface.", n.name = "Bus Network Node";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEngineeringWorkstation"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An Engineering Workstation (EWS) is used to perform various maintenance, configuration, or diagnostics functions for a control system. The EWS will likely require dedicated application software to interface with various devices (e.g., RTUs, PLCs), and may be used to transfer data or files between the control system devices and other networks.", n.name = "OT Engineering Workstation";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareArtifactServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software artifact server provides access to the software artifacts in a software repository. A software repository, or \"repo\" for short, is a storage location for software packages. Often a table of contents is stored, as well as metadata. Repositories group packages. Sometimes the grouping is for a programming language, such as CPAN for the Perl programming language, sometimes for an entire operating system, sometimes the license of the contents is the criteria. At client side, a package manager helps installing from and updating the repositories.", n.name = "Software Artifact Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OrchestrationServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A d3f:Server which is involved with the orchestration of workloads or the execution of orchestrated workloads.", n.name = "Orchestration Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ZeroClientComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Zero client is also referred as ultra thin client, contains no moving parts but centralizes all processing and storage to just what is running on the server. As a result, it requires no local driver to install, no patch management, and no local operating system licensing fees or updates. The device consumes very little power and is tamper-resistant and completely incapable of storing any data locally, providing a more secure endpoint.", n.name = "Zero Client Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KioskComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An interactive kiosk is a computer terminal featuring specialized hardware and software that provides access to information and applications for communication, commerce, entertainment, or education. Early interactive kiosks sometimes resembled telephone booths, but have been embraced by retail, food service and hospitality to improve customer service and streamline operations. Interactive kiosks are typically placed in high foot traffic settings such as shops, hotel lobbies or airports.", n.name = "Kiosk Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OrchestrationWorker"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A d3f:Server which receives commands from a d3f:OrchestrationController to execute workloads.", n.name = "Orchestration Worker";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MailServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Within the Internet email system, a message transfer agent or mail transfer agent (MTA) or mail relay is software that transfers electronic mail messages from one computer to another using SMTP. The terms mail server, mail exchanger, and MX host are also used in some contexts. Messages exchanged across networks are passed between mail servers, including any attached data files (such as images, multimedia or documents). These servers also often keep mailboxes for email. Access to this email by end users is typically either via webmail or an email client.", n.name = "Mail Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebApplicationFirewall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web application firewall (or WAF) filters, monitors, and blocks HTTP traffic to and from a web application. A WAF is differentiated from a regular firewall in that a WAF is able to filter the content of specific web applications while regular firewalls serve as a safety gate between servers. By inspecting HTTP traffic, it can prevent attacks stemming from web application security flaws, such as SQL injection, cross-site scripting (XSS), file inclusion, and security misconfigurations.", n.name = "Web Application Firewall";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WirelessAccessPoint"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer networking, a wireless access point (WAP), or more generally just access point (AP), is a networking hardware device that allows other Wi-Fi devices to connect to a wired network. The AP usually connects to a router (via a wired network) as a standalone device, but it can also be an integral component of the router itself. An AP is differentiated from a hotspot which is a physical location where Wi-Fi access is available.", n.name = "Wireless Access Point";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ClientComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A client computer is a host that accesses a service made available by a server. The server is often (but not always) on another computer system, in which case the client accesses the service by way of a network.", n.name = "Client Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebApplicationServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web application server is a web server that hosts applications. Application server frameworks are software frameworks for building application servers. An application server framework provides both facilities to create web applications and a server environment to run them. In the case of Java application servers, the server behaves like an extended virtual machine for running applications, transparently handling connections to the database on one side, and, often, connections to the Web client on the other.", n.name = "Web Application Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SharedComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer whose resources are intended to be shared widely.", n.name = "Shared Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Firewall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a firewall is a network security system that monitors and controls incoming and outgoing network traffic based on predetermined security rules. A firewall typically establishes a barrier between a trusted internal network and untrusted external network, such as the Internet. Firewalls are often categorized as either network firewalls or host-based firewalls. Network firewalls filter traffic between two or more networks and run on network hardware. Host-based firewalls run on host computers and control network traffic in and out of those machines. This definition refers to network firewalls.", n.name = "Firewall";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Server"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a server is a piece of computer hardware or software (computer program) that provides functionality for other programs or devices, called \"clients\". This architecture is called the client-server model. Servers can provide various functionalities, often called \"services\", such as sharing data or resources among multiple clients, or performing computation for a client. A single server can serve multiple clients, and a single client can use multiple servers. A client process may run on the same device or may connect over a network to a server on a different device. Typical servers are database servers, file servers, mail servers, print servers, web servers, game servers, and application servers.", n.name = "Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DesktopComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A desktop computer is a personal computer designed for regular use at a single location on or near a desk or table due to its size and power requirements. The most common configuration has a case that houses the power supply, motherboard (a printed circuit board with a microprocessor as the central processing unit (CPU), memory, bus, and other electronic components, disk storage (usually one or more hard disk drives, solid state drives, optical disc drives, and in early models a floppy disk drive); a keyboard and mouse for input; and a computer monitor, speakers, and, often, a printer for output. The case may be oriented horizontally or vertically and placed either underneath, beside, or on top of a desk.", n.name = "Desktop Computer";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationLayerFirewall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application firewall is a form of firewall that controls input, output, and/or access from, to, or by an application or service. It operates by monitoring and potentially blocking the input, output, or system service calls that do not meet the configured policy of the firewall. The application firewall is typically built to control all network traffic on any OSI layer up to the application layer. It is able to control applications or services specifically, unlike a stateful network firewall, which is - without additional software - unable to control network traffic regarding a specific application. There are two primary categories of application firewalls, network-based application firewalls and host-based application firewalls.", n.name = "Application Layer Firewall";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Dynamic Host Configuration Protocol (DHCP) server is a type of server that assigns IP addresses to computers.  DHCP servers are used to assign IP addresses to computers and other devices automatically.  The DHCP server is responsible for assigning the unique IP address to each device.", n.name = "DHCP Server";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkNode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In telecommunications networks, a node (Latin nodus, 'knot') is either a redistribution point or a communication endpoint. The definition of a node depends on the network and protocol layer referred to. A physical network node is an electronic device that is attached to a network, and is capable of creating, receiving, or transmitting information over a communications channel. A passive distribution point such as a distribution frame or patch panel is consequently not a node.", n.name = "Network Node";

MERGE (n:MitreDefendNetworkNodeEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioComputer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An embedded computer that includes a self-contained radio system, onboard compute (e.g., SoC/CPU/DSP/FPGA), and software/firmware sufficient to run waveforms and manage RF functions without requiring a continuously attached host PC. It typically exposes control and data via network or other external interfaces and may run an embedded OS.", n.name = "Software-Defined Radio Computer";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TransportLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Transport Link is a type of logical link that exists at the transport layer of a network or system architecture.", n.name = "Transport Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network link is a link within the network layer, which is responsible for packet forwarding including routing through intermediate routers.", n.name = "Network Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WiredLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A physical link that uses a physical conductor or waveguide to constrain and direct signal propagation between endpoints. The signal is confined within or along a manufactured medium such as metal conductors, optical fibers, or coaxial structures.", n.name = "Wired Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogicalLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Logical Link is an abstract or virtual connection between two entities that facilitates communication or data exchange without requiring a direct physical connection.", n.name = "Logical Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Link"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A link is a connection or association between two entities that facilitates communication, interaction, or data transfer.", n.name = "Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationLayerLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An Application Layer Link is a type of logical link that exists at the application layer of a network or system architecture.", n.name = "Application Layer Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A physical link is a dedicated connection for communication that uses some physical media (electrical, electromagnetic, optical, to include clear spaces or vacuums.)  A physical link represents only a single hop (link) in any larger communcations path, circuit, or network.  NOTE: not synonymous with data link as a data link can be over a telecommunications circuit, which may be a virtual circuit composed of multiple phyical links.", n.name = "Physical Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DataLinkLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A communication link between two network devices connected directly at the physical layer and on the same network segment; i.e., an OSI Layer 2 link.", n.name = "Data Link Link";

MERGE (n:MitreDefendLinkEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WirelessLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A physical link that transmits signals through free space or an unguided medium without physical connectors between endpoints. The signal propagates through air, vacuum, water, or other natural media using electromagnetic waves or acoustic energy.", n.name = "Wireless Link";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetEncryptedRemoteTerminalTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet encrypted remote terminal traffic is encrypted network traffic for a standard remote terminal protocol on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet Encrypted Remote Terminal Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound internet traffic is network traffic from a host outside a given network initiated on an incoming connection to a host inside that network.", n.name = "Inbound Internet Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetFileTransferTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet file transfer traffic is file transfer traffic that does not cross a given network's boundaries and uses a standard file transfer protocol.", n.name = "Intranet File Transfer Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RPCNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "RPC network traffic is network traffic related to remote procedure calls between network nodes..This includes only network traffic conforming to a standard RPC protocol; not custom protocols.", n.name = "RPC Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetEncryptedWebTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet encrypted web traffic is network traffic using a standard web protocol on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet Encrypted Web Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetRPCTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet RPC traffic is RPC traffic that is: (a) on an outgoing connection initiated from a host within a network to a host outside the network, and (b) using a standard RPC protocol.", n.name = "Outbound Internet RPC Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IPCNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "IPC network traffic is network traffic related to inter-process communication (IPC) between network nodes..This includes only network traffic conforming to a standard IPC protocol; not custom protocols.", n.name = "IPC Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "DHCP Network Traffic is network traffic related to the DHCP protocol, used by network nodes to negotiate and configure either IPv4 or IPv6 addresses.", n.name = "DHCP Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MailNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Mail traffic is network traffic that uses a standard mail transfer protocol.", n.name = "Mail Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "DNS network traffic is network traffic related to queries and responses involving the Domain Name System. DNS traffic can involve clients, servers such as relays or resolvers. This includes only network traffic conforming to standard DNS protocol; not custom protocols.", n.name = "DNS Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetWebTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound internet web traffic is network traffic that is: (a) on an incoming connection initiated from a host outside the network to a host within a network, and (b) using a standard web protocol.", n.name = "Inbound Internet Web Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound traffic is network traffic originating from another host (client), to the host of interest (server).", n.name = "Inbound Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet network traffic is network traffic traversing that does not traverse a given network's boundaries.", n.name = "Intranet Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetMailTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet DNS lookup traffic is network traffic using a standard email protocol on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet Mail Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileTransferNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "File transfer network traffic is network traffic related to file transfers between network nodes. This includes only network traffic conforming to standard file transfer protocols, not custom transfer protocols.", n.name = "File Transfer Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetAdministrativeNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet administrative network traffic is administrative network traffic that does not cross a given network's boundaries and uses a standard administrative protocol.", n.name = "Intranet Administrative Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet network traffic is network traffic on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network traffic generated by operational technology devices, e.g., programmable logic controllers.", n.name = "OT Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetEncryptedWebTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound internet web traffic is network traffic that is: (a) on an incoming connection initiated from a host outside the network to a host within a network, and (b) using a standard web encryption protocol.", n.name = "Inbound Internet Encrypted Web Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AdministrativeNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Administrative network traffic is network traffic related to the remote administration or control of hosts or devices through a standard remote administrative protocol.  Remote shells, terminals, RDP, and VNC are examples of these protocols, which are typically only used by administrators.", n.name = "Administrative Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalAreaNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet local area network (LAN) traffic is network traffic that does not cross a given network's boundaries; where that network is defined as a LAN.", n.name = "Local Area Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetRPCNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet RPC network traffic is network traffic that does not cross a given network's boundaries and uses a standard remote procedure call (e.g., RFC 1050) protocol.", n.name = "Intranet RPC Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetMulticastNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet IPC network traffic is multicast network traffic that does not cross a given network's boundaries.", n.name = "Intranet Multicast Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound traffic is network traffic originating from a host of interest (client), to another host (server).", n.name = "Outbound Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetIPCNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet IPC network traffic is network traffic that does not cross a given network's boundaries and uses a standard inter-process communication (IPC) networking protocol.", n.name = "Intranet IPC Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetFileTransferTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet file transfer traffic is file transfer traffic that is: (a) on an outgoing connection initiated from a host within a network to a host outside the network, and (b) using a standard file transfer protocol.", n.name = "Outbound Internet File Transfer Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Web network traffic is network traffic that uses a standard web protocol.", n.name = "Web Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InternetNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Internet network traffic is network traffic that crosses a boundary between networks. [This is the general sense of inter-networking; It may or may not cross to or from the Internet]", n.name = "Internet Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetMailTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound internet mail traffic is network traffic that is: (a) coming from a host outside a given network via an incoming connection to a host inside that same network, and (b) using a standard protocol for email.", n.name = "Inbound Internet Mail Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network traffic or data traffic is the data, or alternatively the amount of data, moving across a network at a given point of time.  Network data in computer networks is mostly encapsulated in network packets, which provide the load in the network.", n.name = "Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetDNSLookupTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet DNS lookup traffic is network traffic using the DNS protocol on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet DNS Lookup Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InternetFileTransferTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Internet file transfer network traffic is network traffic related to file transfers between network nodes that crosses a boundary between networks. This includes only network traffic conforming to standard file transfer protocols, not custom transfer protocols.", n.name = "Internet File Transfer Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetEncryptedTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet encrypted traffic is encrypted network traffic on an outgoing connection initiated from a host within a network to a host outside the network.", n.name = "Outbound Internet Encrypted Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetDNSResponseTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound internet DNS response traffic is DNS response traffic from a host outside a given network initiated on an incoming connection to a host inside that network.", n.name = "Inbound Internet DNS Response Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InboundInternetEncryptedTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Inbound  internet encrypted traffic is encrypted network traffic on an incoming connection initiated from a host outside the network to a host within a network .", n.name = "Inbound Internet Encrypted Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetWebNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intranet web network traffic is network traffic that does not cross a given network's boundaries and uses a standard web protocol.", n.name = "Intranet Web Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TFTPNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "TFTP Network Traffic is network traffic typically used to automatically transfer configuration or boot files between machines.", n.name = "TFTP Network Traffic";

MERGE (n:MitreDefendNetworkTrafficEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutboundInternetWebTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outbound internet web traffic is network traffic that is: (a) on an outgoing connection initiated from a host within a network to a host outside the network, and (b) using a standard web protocol.", n.name = "Outbound Internet Web Traffic";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CreateThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Threads are an execution model that exists independently from a language, as well as a parallel execution model. They enable a program to control multiple different flows of work that overlap in time.", n.name = "Create Thread";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TraceProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A trace system call provides a means by which one process (the \"tracer\") may observe and control the execution of another process (the \"tracee\"), and examine and change the tracee's memory and registers. It is primarily used to implement breakpoint debugging and system call tracing.", n.name = "Trace Process";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetScreenCapture"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get Screen Capture";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FreeMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Free Memory";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetSystemNetworkConfigValue"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get System Network Config Value";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetSystemConfigValue"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get System Config Value";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TraceThread"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Trace Thread";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetRunningProcesses"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get Running Processes";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ReadMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Read Memory";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DeleteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Remove a file from a machine.", n.name = "Delete File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UnloadModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system call that unloads a driver or extension from the kernel.", n.name = "Unload Module";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticateUser"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Authenticate User";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Access Process";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigSystemCall"})
ON CREATE SET n.id = randomUUID()
SET n.name = "System Config System Call";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CreateSocket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A create socket system call creates an endpoint for communication and returns a file descriptor that refers to that endpoint.", n.name = "Create Socket";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MoveFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system call to rename or move a file.  Linux's rename() is an example of this kind of system call. Another way of handling it is to call a copy file system call followed by a delete file system call.", n.name = "Move File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OpenFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "For most file systems, a program initializes access to a file in a file system using the open system call. This allocates resources associated to the file (the file descriptor), and returns a handle that the process will use to refer to that file. In some cases the open is performed by the first access. During the open, the filesystem may allocate memory for buffers, or it may wait until the first operation. Various other errors which may occur during the open include directory update failures, un-permitted multiple connections, media failures, communication link failures and device failures.", n.name = "Open File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SuspendThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Suspending a thread causes the thread to stop executing user-mode code.", n.name = "Suspend Thread";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Set Thread Context";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CopyToken"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Copy Token";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConnectSocket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The connect socket system call connects the socket to a target address.", n.name = "Connect Socket";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WriteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The write is one of the most basic routines provided by a Unix-like operating system kernel. It writes data from a buffer declared by the user to a given device, such as a file. This is the primary way to output data from a program by directly using a system call. The destination is identified by a numeric code. The data to be written, for instance a piece of text, is defined by a pointer and a size, given in number of bytes. write thus takes three arguments.", n.name = "Write File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get Thread Context";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemCall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system call is the programmatic way in which a computer program requests a service from the kernel of the operating system it is executed on. This may include hardware-related services (for example, accessing a hard disk drive), creation and execution of new processes, and communication with integral kernel services such as process scheduling. System calls provide an essential interface between a process and the operating system.", n.name = "System Call";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AllocateMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Allocate Memory";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SetSystemConfigValue"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Set System Config Value";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImpersonateUser"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Impersonate User";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Exec"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Exec";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ResumeThread"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Resume Thread";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LoadModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system call that loads a driver or extension into the kernel.", n.name = "Load Module";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TerminateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "On many computer operating systems, a computer process terminates its execution by making an exit system call. More generally, an exit in a multithreading environment means that a thread of execution has stopped running. For resource management, the operating system reclaims resources (memory, files, etc.) that were used by the process. The process is said to be a dead process after it terminates.", n.name = "Terminate Process";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogonUser"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Logon User";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SaveRegister"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Save Registers";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CreateFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "System call to create a new file on a file system. Some operating systems implement this functionality as part of their d3f:OpenFile system call.", n.name = "Create File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ResumeProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Resume Process";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ReadFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A program that needs to access data from a file stored in a file system uses the read system call. The file is identified by a file descriptor that is normally obtained from a previous call to open. This system call reads in data in bytes, the number of which is specified by the caller, from the file and stores then into a buffer supplied by the calling process.", n.name = "Read File";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WriteMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Write Memory";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetOpenSockets"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get Open Sockets";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetSystemTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system call that gets the system time.  For POSIX.1 systems, time() invokes a call to get the system time.", n.name = "Get System Time";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CreateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process spawn refers to a function that loads and executes a new child process.The current process may wait for the child to terminate or may continue to execute asynchronously. Creating a new subprocess requires enough memory in which both the child process and the current program can execute. There is a family of spawn functions in DOS, inherited by Microsoft Windows. There is also a different family of spawn functions in an optional extension of the POSIX standards.  Fork-exec is another technique combining two Unix system calls, which can effect a process spawn.", n.name = "Create Process";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GetOpenWindows"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Get Open Windows";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SetRegisters"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Set Registers";

MERGE (n:MitreDefendSystemCallEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SuspendProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Suspend Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtDuplicateToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NtDuplicateToken function creates a handle to a new access token that duplicates an existing token. This function can create either a primary token or an impersonation token.", n.name = "Windows NtDuplicateToken";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Linux_Exit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Terminate the calling process.", n.name = "Linux _Exit";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxUnlinkat"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Delete a name and possibly the file it refers to. Different parameter handling than Linux Unlink", n.name = "Linux Unlinkat";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtOpenProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Opens a handle to process object and sets the access rights to this object.", n.name = "Windows NtOpenProcess";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsResumeThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Decrements a thread's suspend count. When the suspend count is decremented to zero, the execution of the thread is resumed.", n.name = "Windows ResumeThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxSocketcallArgumentSYS_SOCKET"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Linux Socketcall Argument SYS_SOCKET";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsGetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Retrieves the context of the specified thread.", n.name = "Windows GetThreadContext";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPICreateSocket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that creates a socket.", n.name = "OS API Create Socket";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateThread"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtCreateThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsSuspendThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Suspends the specified thread.", n.name = "Windows SuspendThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxReadv"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read data into multiple buffers.", n.name = "Linux Readv";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIFreeMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that releases or deallocates memory that was previously allocated by the program.", n.name = "OS API Free Memory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIExec"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that replaces the current process image with a new processs image, executing a specified program.", n.name = "OS API Exec";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISuspendProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that pauses the execution of a process.", n.name = "OS API Suspend Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtProtectVirtualMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtProtectVirtualMemory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsWriteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Writes data to the specified file or input/output (I/O) device.", n.name = "Windows WriteFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIConnectSocket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that establishes a connection between a socket and a endpooint.", n.name = "OS API Connect Socket";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateNamedPipeFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates Named Pipe File Object.", n.name = "Windows NtCreateNamedPipeFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxMunmap"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Unmap files or devices from memory.", n.name = "Linux Munmap";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxUnlink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Delete a name and possibly the file it refers to.", n.name = "Linux Unlink";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenAt2ArgumentO_CREAT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Create a regular file. Extension of Linux Openat.", n.name = "Linux OpenAt2 Argument O_CREAT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPICreateFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that creates a file.", n.name = "OS API Create File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNTGetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtGetThreadContext";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that modifies the execution context of a thread.", n.name = "OS API Set Thread Context";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsQueryPerformanceCounter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Retrieves the current value of the performance counter, which is a high resolution (<1us) time stamp that can be used for time-interval measurements.", n.name = "Windows QueryPerformanceCounter";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtOpenThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Opens a handle to a thread object with the access specified.", n.name = "Windows NtOpenThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIGetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that retrieves the execution context or state of a specific thread in a process.", n.name = "OS API Get Thread Context";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxRename"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Change the name or location of a file.", n.name = "Linux Rename";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPICopyToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that creates a duplicate or copy of an existing security token.", n.name = "OS API Copy Token";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPITraceProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that enables a program to monitor, control, or interact with the execution of a process.", n.name = "OS API Trace Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISuspendThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that pauses the execution of a thread.", n.name = "OS API Suspend Thread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPauseThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Causes the calling thread to sleep until a signal is delivered that either terminates the thread or causes the invocation of a signal-catching function.", n.name = "Linux Pause Thread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtSetInformationFileArgumentFileDispositionInformation"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Request to delete the file when it is closed or cancel a previously requested deletion.", n.name = "Windows NtSetInformationFile Argument FileDispositionInformation";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPILoadModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that loads a module into memory and makes it available for execution.", n.name = "OS API Load Module";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsWriteProcessMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Writes data to an area of memory in a specified process. The entire area to be written to must be accessible or the operation fails.", n.name = "Windows WriteProcessMemory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPICreateThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that creates a new thread of execution within a process.", n.name = "OS API Create Thread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsOpenProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Opens an existing local process object.", n.name = "Windows OpenProcess";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIMoveFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that moves or renames a file or directory from one location to another within the file system.", n.name = "OS API Move File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtQuerySystemTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Returns current time in Coordinated Universal Time (UTC) 8-bytes format.", n.name = "Windows NtQuerySystemTime";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIResumeProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that resumes the execution of a paused, stopped, or suspended process.", n.name = "OS API Resume Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsDeleteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Deletes an existing file.", n.name = "Windows DeleteFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsCreateThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a thread to execute within the virtual address space of the calling process.", n.name = "Windows CreateThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPauseProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Causes the calling process to sleep until a signal is delivered that either terminates the process or causes the invocation of a signal-catching function.", n.name = "Linux Pause Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPITraceThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that enables a program to monitor, control, or interact with the execution of a thread.", n.name = "OS API Trace Thread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateProcessEx"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtCreateProcessEx";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenAtArgumentO_CREAT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Create a regular file. Same functionality as Linux Open but slight differences in parameter.", n.name = "Linux OpenAt Argument O_CREAT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsCreateRemoteThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a thread that runs in the virtual address space of another process.", n.name = "Windows CreateRemoteThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsVirtualFree"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Releases, decommits, or releases and decommits a region of pages within the virtual address space of the calling process.", n.name = "Windows VirtualFree";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsReadFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads data from the specified file or input/output (I/O) device. Reads occur at the position specified by the file pointer if supported by the device.", n.name = "Windows ReadFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxClone3ArgumentCLONE_THREAD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A flag parameter to the Clone3 syscall. If set, the child is placed in the same thread group as the calling process.", n.name = "Linux Clone3 Argument CLONE_THREAD";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateThreadEx"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtCreateThreadEx";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsVirtualProtectEx"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Changes the protection on a region of committed pages in the virtual address space of a specified process.", n.name = "Windows VirtualProtectEx";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIUnloadModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that removes a previously loaded module from memory.", n.name = "OS API Unload Module";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtCreateProcess";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreatePagingFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Typically used by Control Panel's \"System\" applet for creating new paged files.", n.name = "Windows NtCreatePagingFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIWriteMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that writes data into the memory space of another process or into specific regions of memory.", n.name = "OS API Write Memory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsCreateProcessA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a new process and its primary thread. The new process runs in the security context of the calling process.", n.name = "Windows CreateProcessA";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtWriteVirtualMemory"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtWriteVirtualMemory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtReadFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NtReadFile routine reads data from an open file.", n.name = "Windows NtReadFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxRenameat"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Change the name or location of a file. Different parameter handling than Linux Rename.", n.name = "Linux Renameat";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtTerminateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtTerminateProcess";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACEGETREGS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Copy the tracee's general-purpose or floating-point registers, respectively, to the address data in the tracer.", n.name = "Linux Ptrace Argument PTRACE_GETREGS";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxCloneArgumentCLONE_THREAD"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A flag parameter to the Clone syscall. If set, the child is placed in the same thread group as the calling process.", n.name = "Linux Clone Argument CLONE_THREAD";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxVfork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Create child process that temp suspends parent process until it terminates.", n.name = "Linux Vfork";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxConnect"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Initiate a connection on a socket.", n.name = "Linux Connect";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISystemFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Indirect System calls are made through an OS-specific library (like glibc in Linux) that provides a higher-level API for the system calls.", n.name = "OS API System Function";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIWriteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that writes data from a buffer in memory to a file or output stream.", n.name = "OS API Write File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxInitModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Loads an ELF image into kernel space, performs any necessary symbol relocations, initializes module parameters to values provided by the caller, and then runs the module's init function.", n.name = "Linux Init_Module";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxMmap2"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Map files or devices into memory.", n.name = "Linux Mmap2";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtSetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtSetThreadContext";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A callable interface provided by an operating system that allows applications or other software components to interact with and utilize the underlying system resources, services, or functionalities.", n.name = "OS API Function";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACEPEEKTEXT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read a word at the address addr in the tracee's memory, returning the word as the result of the ptrace() call.", n.name = "Linux Ptrace Argument PTRACE_PEEKTEXT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsDuplicateToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The DuplicateToken function creates a new access token that duplicates one already in existence.", n.name = "Windows DuplicateToken";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtWriteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Writes data to an open file.", n.name = "Windows NtWriteFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenArgumentO_RDONLY-O_WRONLY-O_RDWR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Opens a file specified by pathname.", n.name = "Linux Open Argument O_RDONLY, O_WRONLY, O_RDWR";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxFork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a child process with unique PID but retains parent PID as Parent Process Identifier (PPID).", n.name = "Linux Fork";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowOpenFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates, opens, reopens, or deletes a file.", n.name = "Windows OpenFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxCreat"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Equivalent to calling Linux Open with flags equal to O_CREAT|O_WRONLY|O_TRUNC.", n.name = "Linux Creat";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Get time in seconds.", n.name = "Linux Time";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACE_TRACEME"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Indicates that the process is to be traced by its parent.", n.name = "Linux Ptrace Argument PTRACE_TRACEME";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxExecve"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Executes a program by replacing the calling process with a new program, with newly initialized stack, heap, and (initialized and uninitialized) data segments. The PID stays the same.", n.name = "Linux Execve";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtReadFileScatter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads specified block from file into multiple buffers. Each buffer must have one page length.", n.name = "Windows NtReadFileScatter";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtDeleteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Deletes the specified file.", n.name = "Windows NtDeleteFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIReadMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that reads the contents of memory from a specific address or region.", n.name = "OS API Read Memory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtResumeThread"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtResumeThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACEATTACH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Attach to the process specified in pid, making it a tracee of the calling process.", n.name = "Linux Ptrace Argument PTRACE_ATTACH";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtAllocateVirtualMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NtAllocateVirtualMemory routine reserves, commits, or both, a region of pages within the user-mode virtual address space of a specified process.", n.name = "Windows NtAllocateVirtualMemory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxExecveat"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Execute program relative to a directory file descriptor. Behavior is similar to Linux Execve.", n.name = "Linux Execveat";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxClone3"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a child process and provides more precise control over the data shared between the parent and child processes.  Newer system call.", n.name = "Linux Clone3";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIOpenFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that opens a file for reading, writing, or both, and return a handle or descriptor that can be used to interact with the file.", n.name = "OS API Open File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxSocketcallArgumentSYS_CONNECT"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Linux Socketcall Argument SYS_CONNECT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACESETREGS"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modify the tracee's general-purpose or floating-point registers, respectively, from the address data in the tracer.", n.name = "Linux Ptrace Argument PTRACE_SETREGS";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIAccessProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function for interacting with processes.", n.name = "OS API Access Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtFlushInstructionCache"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtFlushInstructionCache";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxMmap"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Map files or devices into memory.", n.name = "Linux Mmap";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPICreateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that creates a new process within the system.", n.name = "OS API Create Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxSocket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Create an endpoint for communication.", n.name = "Linux Socket";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxRenameat2"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Change the name or location of a file. Additional flags argument.", n.name = "Linux Renameat2";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtFreeVirtualMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NtFreeVirtualMemory routine releases, decommits, or both releases and decommits, a region of pages within the virtual address space of a specified process.", n.name = "Windows NtFreeVirtualMemory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a new file or directory, or opens an existing file, device, directory, or volume.", n.name = "Windows NtCreateFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtOpenFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NtOpenFile routine opens an existing file, directory, device, or volume.", n.name = "Windows NtOpenFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACEINTERRUPT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Stops a tracee.", n.name = "Linux Ptrace Argument PTRACE_INTERRUPT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsOpenThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Opens an existing thread object.", n.name = "Windows OpenThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenArgumentO_CREAT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Create a regular file.", n.name = "Linux Open Argument O_CREAT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIDeleteFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that removes a file from the file system.", n.name = "OS API Delete File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxClone"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a child process and provides more precise control over the data shared between the parent and child processes.", n.name = "Linux Clone";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIGetSystemTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that retrieves the current system time or timestamp.", n.name = "OS API Get System Time";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtWriteFileGather"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Writes specified block of file with data from memory pages.", n.name = "Windows NtWriteFileGather";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsSetThreadContext"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Sets the context for the specified thread.", n.name = "Windows SetThreadContext";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACE_DETACH"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restart the stopped tracee as for PTRACE_CONT, but first detach from it.", n.name = "Linux Ptrace Argument PTRACE_DETACH";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISaveRegisters"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that retrieves and saves the values of CPU registers for a specific process or thread.", n.name = "OS API Save Registers";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsCreateFileA"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates or opens a file or I/O device. The most commonly used I/O devices are as follows: file, file stream, directory, physical disk, volume, console buffer, tape drive, communications resource, mailslot, and pipe. The function returns a handle that can be used to access the file or device for various types of I/O depending on the file or device and the flags and attributes specified.", n.name = "Windows CreateFileA";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxKillArgumentSIGKILL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Send SIGKILL signal to a process.", n.name = "Linux Kill Argument SIGKILL";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIReadFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that reads data from a file or input stream into memory.", n.name = "OS API Read File";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenAt2ArgumentO_RDONLY-O_WRONLY-O_RDWR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Extension of Linux Openat.", n.name = "Linux OpenAt2 Argument O_RDONLY, O_WRONLY, O_RDWR";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsVirtualAllocEx"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reserves, commits, or changes the state of a region of memory within the virtual address space of a specified process. The function initializes the memory it allocates to zero.", n.name = "Windows VirtualAllocEx";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtCreateMailslotFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Creates a special File Object called Mailslot.", n.name = "Windows NtCreateMailslotFile";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIAllocateMemory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that requests and allocates a region of memory for use by a process or application.", n.name = "OS API Allocate Memory";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxDeleteModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Attempts to remove the unused loadable module entry identified by name. If the module has an exit function, then that function is executed before unloading the module.", n.name = "Linux Delete Module";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtSuspendThread"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtSuspendThread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxOpenAtArgumentO_RDONLY-O_WRONLY-O_RDWR"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Same functionality as Linux Open but slight differences in parameter.", n.name = "Linux OpenAt Argument O_RDONLY, O_WRONLY, O_RDWR";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxRead"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read from a file descriptor.", n.name = "Linux Read";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxWritev"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Write data into multiple buffers.", n.name = "Linux Writev";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACECONT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Restart the stopped tracee process.", n.name = "Linux Ptrace Argument PTRACE_CONT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxWrite"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Write to a file descriptor.", n.name = "Linux Write";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LinuxPtraceArgumentPTRACEPOKETEXT"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Copy the word data to the address addr in the tracee's memory.", n.name = "Linux Ptrace Argument PTRACE_POKETEXT";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtAllocateVirtualMemoryEx"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtAllocateVirtualMemoryEx";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPITerminateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "OS API Terminate Process";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPIResumeThread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that resumes the execution of a paused, stopped, or suspended thread.", n.name = "OS API Resume Thread";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsNtSuspendProcess"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Windows NtSuspendProcess";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OSAPISetRegisters"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OS API function that modifies the values of CPU registers.", n.name = "OS API Set Registers";

MERGE (n:MitreDefendOSAPIFunctionEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsTerminateProcess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Terminates the specified process and all of its threads.", n.name = "Windows TerminateProcess";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ExceptionHandler"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An exception handler is a code segment that processes an exception.", n.name = "Exception Handler";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RawMemoryAccessFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which accesses raw memory, usually using memory addresses.", n.name = "Raw Memory Access Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Subroutine"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In different programming languages, a subroutine may be called a procedure, a function, a routine, a method, or a subprogram. The generic term callable unit is sometimes used.", n.name = "Subroutine";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SharedResourceAccessFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which access a shared resource.", n.name = "Shared Resource Access Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which accesses OT Control Variables", n.name = "OT Control Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SerializationFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which has an operation that serializes data.", n.name = "Serialization Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StoredProcedure"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A stored procedure (also termed proc, storp, sproc, StoPro, StoredProc, StoreProc, sp, or SP) is a subroutine available to applications that access a relational database management system (RDBMS). Such procedures are stored in the database data dictionary.", n.name = "Stored Procedure";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessStartFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function creates a new computer process, usually by invoking a create process system call.", n.name = "Process Start Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserInputFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Generic function that receives direct user input from an untrusted source.", n.name = "User Input Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MathematicalFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Computes mathematical expressions.", n.name = "Mathematical Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ExternalContentInclusionFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A subroutine which handles a content inclusion directive from an original file. When invoked, the external content is included in the resulting open file.", n.name = "External Content Inclusion Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InputFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Generic function that receives input from an untrusted source.", n.name = "Input Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CopyMemoryFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Copies a memory block from one location to another.", n.name = "Copy Memory Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FilePathOpenFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Has an input of a file path, and opens a file handle for reading or writing.", n.name = "File Path Open Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryAllocationFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reserves memory for a running process to use.", n.name = "Memory Allocation Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EvalFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Takes inputs of strings and evaluations them as expressions.", n.name = "Eval Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StringFormatFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which creates a new string based on a format specification and correspondingi specified values.", n.name = "String Format Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DeserializationFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Function with an input of serialized data which deserializes that data, usually with data parsing methods.", n.name = "Deserialization Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Authenticates a user account by verifying a presented credential.", n.name = "Authentication Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryFreeFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Releases previously reserved memory associated with a process.", n.name = "Memory Free Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConsoleOutputFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Outputs characters to a computer console.", n.name = "Console Output Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ThreadStartFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which invokes a create thread system call.", n.name = "Thread Start Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogMessageFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Produces an entry in a log.", n.name = "Log Message Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImportLibraryFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Loads an external software library to enable the invocations of its methods.", n.name = "Import Library Function";

MERGE (n:MitreDefendSubroutineEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PointerDereferencingFunction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A function which has an operation which dereferences a pointer.", n.name = "Pointer Dereferencing Function";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HumanInputDeviceFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on an HCI device such as a mouse or keyboard.", n.name = "Human Input Device Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Microcode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Microcode is a computer hardware technique that interposes a layer of organization between the CPU hardware and the programmer-visible instruction set architecture of the computer. As such, the microcode is a layer of hardware-level instructions that implement higher-level machine code instructions or internal state machine sequencing in many digital processing elements.", n.name = "Microcode";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardDiskFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on a hard disk device.", n.name = "Hard Disk Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PeripheralHubFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on peripheral hub device such as a USB or Firewire hub.", n.name = "Peripheral Hub Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkCardFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on a network card (network interface controller).", n.name = "Network Card Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PeripheralFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on computer peripheral devices.", n.name = "Peripheral Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on a computer's main board which manages the initial boot process. It can also continue to run or function after the operating system boots.", n.name = "System Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Firmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In electronic systems and computing, firmware is a type of software that provides control, monitoring and data manipulation of engineered products and systems. Typical examples of devices containing firmware are embedded systems (such as traffic lights, consumer appliances, remote controls and digital watches), computers, computer peripherals, mobile phones, and digital cameras. The firmware contained in these devices provides the low-level control program for the device.", n.name = "Firmware";

MERGE (n:MitreDefendFirmwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GraphicsCardFirmware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Firmware that is installed on computer graphics card.", n.name = "Graphics Card Firmware";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GlobalUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A type of user account in Microsoft Windows (NT) that has a domain-wide scope.defines that user's access to a logical group of network objects (computers, users, devices) that share the same Active Directory databases; that is, a user's access to the domain.", n.name = "Global User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KerberosTicketGrantingTicketAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "KRBTGT is an account used by Key Distribution Center (KDC) service to issue Ticket Granting Tickets (TGTs) as part of the Kerberos authentication protocol.", n.name = "Kerberos Ticket Granting Ticket Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DefaultUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Default accounts are those that are built-into an OS, such as the Guest or Administrator accounts on Windows systems or default factory/provider set accounts on other types of systems, software, or devices.", n.name = "Default User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user account on a given host is a local user account for that specific host.", n.name = "Local User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A service account is a type of account used by an application or service to interact with the operating system.", n.name = "Service Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user account on a given host is a local user account for a given cloud and specified resources within that cloud.", n.name = "Cloud User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user account allows a user to authenticate to a system and potentially to receive authorization to access resources provided by or connected to that system; however, authentication does not imply authorization. To log into an account, a user is typically required to authenticate oneself with a password or other credentials for the purposes of accounting, security, logging, and resource management.", n.name = "User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A domain user account in Microsoft Windows (2000) defines that user's access to a logical group of network objects (computers, users, devices) that share the same Active Directory databases; that is, a user's access to a domain.", n.name = "Domain User Account";

MERGE (n:MitreDefendUserAccountEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PrivilegedUserAccount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A privileged account is a user account that has more privileges than ordinary users. Privileged accounts might, for example, be able to install or remove software, upgrade the operating system, or modify system or application configurations. They might also have access to files that are not normally accessible to standard users. Typical examples are root and administrator accounts. But there also service accounts, system accounts, etc. Privileged accounts are especially powerful, and should be monitored especially closely.", n.name = "Privileged User Account";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KerberosTicket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An access ticket/token issued by a Kerberos system.", n.name = "Kerberos Ticket";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SessionToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, a session identifier, session ID or session token is a piece of data that is used in network communications (often over HTTPS) to identify a session, a series of related message exchanges.", n.name = "Session Token";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KerberosTicketGrantingTicket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A ticket granting ticket issued by a Kerberos system; that is, a ticket that grants a user domain admin access.", n.name = "Kerberos Ticket Granting Ticket";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SessionCookie"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A session cookie, also known as an in-memory cookie, transient cookie or non-persistent cookie, exists only in temporary memory while the user navigates the website. Web browsers normally delete session cookies when the user closes the browser. Unlike other cookies, session cookies do not have an expiration date assigned to them, which is how the browser knows to treat them as session cookies.", n.name = "Session Cookie";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer systems, an access token contains the security credentials for a login session and identifies the user, the user's groups, the user's privileges, and, in some cases, a particular application. Typically one may be asked to enter the access token (e.g. 40 random characters) rather than the usual password (it therefore should be kept secret just like a password).", n.name = "Access Token";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KerberosTicketGrantingServiceTicket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Kerberos ticket-granting service (TGS) ticket is given in response to requesting a Kerberos TGS request.", n.name = "Kerberos Ticket Granting Service Ticket";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebAccessToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web access token is a credential that allows a web client application to access a specific resource to perform specific actions on behalf of the user.", n.name = "Web Access Token";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EncryptedCredential"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A credential that is encrypted.", n.name = "Encrypted Credential";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Password"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password, sometimes called a passcode, is a memorized secret, typically a string of characters, usually used to confirm the identity of a user. Using the terminology of the NIST Digital Identity Guidelines, the secret is memorized by a party called the claimant while the party verifying the identity of the claimant is called the verifier. When the claimant successfully demonstrates knowledge of the password to the verifier through an established authentication protocol, the verifier is able to infer the claimant's identity.", n.name = "Password";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebIdentityToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An ID token is an artifact that proves that the user has been authenticated.", n.name = "Web Identity Token";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalAccessBadge"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A credential used to gain entry to an area having automated access control entry points. Example media being magnetic stripe, proximity, barcode, or smart cards are examples.", n.name = "Digital Access Badge";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EncryptedPassword"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password that is encrypted.", n.name = "Encrypted Password";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TicketGrantingTicket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In some computer security systems, a Ticket Granting Ticket or Ticket to Get Tickets (TGT) is a small, encrypted identification file with a limited validity period. After authentication, this file is granted to a user for data traffic protection by the key distribution center (KDC) subsystem of authentication services such as Kerberos. The TGT file contains the session key, its expiration date, and the user's IP address, which protects the user from man-in-the-middle attacks. The TGT is used to obtain a service ticket from Ticket Granting Service (TGS). User is granted access to network services only after this service ticket is provided.", n.name = "Ticket Granting Ticket";

MERGE (n:MitreDefendCredentialEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Credential"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A credential is a physical/tangible object, a piece of knowledge, or a facet of a person's physical being that enables an individual access to a given physical facility or computer-based information system. Typically, credentials can be something a person knows (such as a number or PIN), something they have (such as an access badge), something they are (such as a biometric feature), something they do (measurable behavioral patterns) or some combination of these items. This is known as multi-factor authentication. The typical credential is an access card or key-fob, and newer software can also turn users' smartphones into access devices.", n.name = "Credential";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PowerSupply"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A power supply is an electrical device or module that converts and regulates energy from a source (e.g., the power grid or batteries) to an appropriate voltage, current, and frequency for one or more loads. It may stand alone or be integrated into its host appliance, often providing overcurrent protection, voltage regulation, or power conditioning for safe, stable operation.", n.name = "Power Supply";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalCamera"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An optical instrument that can capture an image. A digital camera that captures photographs in digital memory.", n.name = "Digital Camera";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GraphicsProcessingUnit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Graphics Processing Unit (GPU) is a specialized processor designed to efficiently perform parallel computations, primarily for rendering graphics and visual data.", n.name = "Graphics Processing Unit";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BarcodeScannerInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A barcode reader (or barcode scanner) is an optical scanner that can read printed barcodes, decode the data contained in the barcode and send the data to a computer. Like a flatbed scanner, it consists of a light source, a lens and a light sensor translating for optical impulses into electrical signals. Additionally, nearly all barcode readers contain decoder circuitry that can analyze the barcode's image data provided by the sensor and sending the barcode's content to the scanner's output port.", n.name = "Barcode Scanner Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WriteProtectSwitch"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A physical device used to restrict configuration of a device.", n.name = "Write Protect Switch";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Transceiver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A transceiver is a device that contains both a transmitter and receiver.", n.name = "Transceiver";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTIOModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT I/O Module is an industrial-grade interface designed for harsh Operational Technology (OT) environments. It reliably connects sensors and actuators to industrial control systems, ensuring precise, real-time data exchange in applications such as SCADA or ICS. Engineered for ruggedness and consistent performance, it can manage analog, digital, or other specialized signal types while enduring demanding conditions.", n.name = "OT I/O Module";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Receiver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A receiver is a device or system that acquires signals and converts them into usable information. It senses a physical carrier (such as electromagnetic fields, light, electrical currents, or acoustic waves), conditions the input, and extracts the intended content through operations like filtering, amplification, detection, synchronization, demodulation, decoding, and error correction. A receiver may be analog or digital, implemented in hardware, software, or both, and is designed to mitigate impairments such as noise, interference, and distortion while delivering recovered data or media to downstream processes.", n.name = "Receiver";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A hardware device that functions primarily as an RF front end plus data conversion and transport, relying on an external host computer to run most waveform/DSP processing and to control operation. It is commonly connected via USB, PCIe, or similar links and behaves like a high-speed radio peripheral.", n.name = "Software-Defined Radio Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Processor"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A processor is a hardware component or integrated circuit that performs computations, executes instructions, and processes data to carry out tasks within a computing system.", n.name = "Processor";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DataAcquisitionUnit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The hardware component which connects to data sources to gather raw, time-stamped data. It often connects to databases or historian gateways for storage and analysis.", n.name = "Data Acquisition Unit";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, an input device is a piece of equipment used to provide data and control signals to an information processing system such as a computer or information appliance. Examples of input devices include keyboards, mouse, scanners, digital cameras, joysticks, and microphones.", n.name = "Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CentralProcessingUnit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A central processing unit (CPU), also called a central processor, main processor or just processor, is the electronic circuitry that executes instructions comprising a computer program. The CPU performs basic arithmetic, logic, controlling, and input/output (I/O) operations specified by the instructions in the program. This contrasts with external components such as main memory and I/O circuitry, and specialized processors such as graphics", n.name = "Central Processing Unit";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VideoInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Video input devices are used to digitize images or video from the outside world into the computer. The information can be stored in a multitude of formats depending on the user's requirement.", n.name = "Video Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GNSSReceiver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A GNSS (Global Navigation Satellite System) receiver is an electronic device that picks up signals from one or more satellite constellations (like GPS, GLONASS, Galileo, BeiDou) to calculate precise location, velocity, and time.", n.name = "GNSS Receiver";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkInterfaceCard"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network interface card (NIC, also known as a network interface controller, network adapter, LAN adapter or physical network interface, and by similar terms) is a computer hardware component that connects a computer to a computer network.", n.name = "Network Interface Card";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TranslationLookasideBuffer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A translation lookaside buffer (TLB) is a memory cache that is used to reduce the time taken to access a user memory location. It is a part of the chip's memory-management unit (MMU).", n.name = "Translation Lookaside Buffer";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessorComponent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Processor Component is a functional subunit or module within a processor that performs specific tasks to support the processor's overall operation.", n.name = "Processor Component";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalDataDiode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device that physically enforces one-way (unidirectional) network communication.", n.name = "Physical Data Diode";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryManagementUnitComponent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Memory Management Unit Component is a hardware or software element that contributes to the functionality of a Memory Management Unit, which is responsible for managing and translating memory addresses in a computing system.", n.name = "Memory Management Unit Component";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Hardware devices are the physical artifacts that constitute a network or computer system. Hardware devices are the physical parts or components of a computer, such as the monitor, keyboard, computer data storage, hard disk drive (HDD), graphic cards, sound cards, memory (RAM), motherboard, and so on, all of which are tangible physical objects. By contrast, software is instructions that can be stored and run by hardware. Hardware is directed by the software to execute any command or instruction. A combination of hardware and software forms a usable computing system.", n.name = "Hardware Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareClock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A clock implemented using physical electronic components, typically providing timekeeping independent of system power or software state.", n.name = "Hardware Clock";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTPowerSupply"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT power supply is a power supply whose control amplifier is optimized for signal-processing tasks rather than supplying mere steady-state power to a load. It is a self-contained combination of operational amplifiers, power amplifiers, and integral power circuits designed for higher-level operations in industrial or OT contexts.", n.name = "OT Power Supply";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OutputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An output device is any piece of computer hardware equipment which converts information into human-readable form. It can be text, graphics, tactile, audio, and video. Some of the output devices are Visual Display Units (VDU) i.e. a Monitor, Printer, Graphic Output devices, Plotters, Speakers etc. A new type of Output device is been developed these days, known as Speech synthesizer, a mechanism attached to the computer which produces verbal output sounding almost like human speeches.", n.name = "Output Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A hardware timer is defined as an electronic component that serves as an 8-bit or 16-bit counter, capable of measuring time intervals, generating timed outputs, and driving loads through mechanisms such as pulse width modulation (PWM).", n.name = "Hardware Timer";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTActuator"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT actuator is an industrial-grade actuator optimized for operational technology (OT) environments, such as SCADA or process-control systems. It tolerates harsher conditions, meets stricter safety and reliability standards, and integrates seamlessly with ICS protocols to enable real-time mechanical motion or adjustments in production lines and critical infrastructure.", n.name = "OT Actuator";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RealtimeClock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A real-time clock (RTC) is an electronic device (most often in the form of an integrated circuit) that measures the passage of time.", n.name = "Real-time Clock";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryProtectionUnit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Memory Protection Unit (MPU) is a processor component that enforces access control policies on memory regions to ensure the integrity, security, and proper operation of a computing system.", n.name = "Memory Protection Unit";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemovableMediaDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A removable media device is a hardware device used for computer storage and that is designed to be inserted and removed from the system.  It is distinct from other removable media in that all the hardware required to read the data are built into the device.  So USB flash drives and external hard drives are removable media devices, whereas tapes and disks are not, as they require additional hardware to perform read/write operations.", n.name = "Removable Media Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AudioInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Audio input devices allow a user to send audio info to a computer for processing, recording, or carrying out commands. Devices such as microphones allow users to speak to the computer in order to record a voice message or navigate software. Aside from recording, audio input devices are also used with speech recognition software.", n.name = "Audio Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MouseInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer mouse (plural mice or mouses) is a hand-held pointing device that detects two-dimensional motion relative to a surface. This motion is typically translated into the motion of a pointer on a display, which allows a smooth control of the graphical user interface of a computer. In addition to moving a cursor, computer mice have one or more buttons to allow operations such as selection of a menu item on a display. Mice often also feature other elements, such as touch surfaces and scroll wheels, which enable additional control and dimensional input.", n.name = "Mouse Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadio"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Software-defined radio (SDR) is a radio communication system where components that conventionally have been implemented in analog hardware (e.g. mixers, filters, amplifiers, modulators/demodulators, detectors, etc.) are instead implemented by means of software on a computer or embedded system.", n.name = "Software-defined Radio";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Actuator"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An actuator is a mechanical or electromechanical device that, upon receiving a relatively low-energy control signal (e.g., electrical voltage, fluid pressure, or human force), translates its primary energy source (electric, hydraulic, or pneumatic) into targeted mechanical motion or adjustment. It typically works in conjunction with a control device (like a valve or logic driver) and is central to automation, enabling machines or systems to move, open, close, or otherwise manipulate their components or environment. By amplifying or redirecting energy from one form to another, the actuator executes control commands, thereby automating processes in industrial, automotive, aerospace, and other domains where precise mechanical action is essential.", n.name = "Actuator";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareWatchdogTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A hardware watchdog timer is a watchdog timer implemented using electronic components.", n.name = "Hardware Watchdog Timer";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DisplayAdapter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A graphics card (also called a display card, video card, display adapter, or graphics adapter) is an expansion card which generates a feed of output images to a display device (such as a computer monitor). Frequently, these are advertised as discrete or dedicated graphics cards, emphasizing the distinction between these and integrated graphics. At the core of both is the graphics processing unit (GPU), which is the main part that does the actual computations, but should not be confused with the video card as a whole, although \"GPU\" is often used to refer to video cards.", n.name = "Display Adapter";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IOModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An I/O Module is a hardware device that translates signals between external sensors or actuators and control systems. It typically handles analog-to-digital (and vice versa) conversion, serving as the data interface that allows physical processes to be monitored and controlled by digital controllers.", n.name = "I/O Module";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FingerPrintScannerInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A fingerprint sensor is an electronic device used to capture a digital image of the fingerprint pattern. The captured image is called a live scan. This live scan is digitally processed to create a biometric template (a collection of extracted features) which is stored and used for matching. Many technologies have been used including optical, capacitive, RF, thermal, piezoresistive, ultrasonic, piezoelectric, and MEMS.", n.name = "Finger Print Scanner Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Transponder"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In telecommunications, a transponder is a device that, upon receiving a signal, emits a different signal in response.", n.name = "Transponder";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KeyboardInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer keyboard is a typewriter-style device which uses an arrangement of buttons or keys to act as mechanical levers or electronic switches. Following the decline of punch cards and paper tape, interaction via teleprinter-style keyboards became the main input method for computers. A keyboard is also used to give commands to the operating system of a computer, such as Windows' Control-Alt-Delete combination. Although on Pre-Windows 95 Microsoft operating systems this forced a re-boot, now it brings up a system security options screen.", n.name = "Keyboard Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SatelliteTransponder"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A communications satellite's transponder is the series of interconnected units that form a communications channel between the receiving and the transmitting antennas.", n.name = "Satellite Transponder";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImageScannerInputDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An image scanner -- often abbreviated to just scanner, is a device that optically scans images, printed text, handwriting or an object and converts it to a digital image. Commonly used in offices are variations of the desktop flatbed scanner where the document is placed on a glass window for scanning. Hand-held scanners, where the device is moved by hand, have evolved from text scanning \"wands\" to 3D scanners used for industrial design, reverse engineering, test and measurement, orthotics, gaming and other applications. Mechanically driven scanners that move the document are typically used for large-format documents, where a flatbed design would be impractical.", n.name = "Image Scanner Input Device";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Transmitter"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device or system that takes information and generates a signal suitable for propagation. It encodes and formats the content, impresses it on a physical carrier (such as electromagnetic fields, light, electrical currents, or acoustic waves), and performs signal conditioning--such as modulation, pulse shaping, pre-emphasis, and power amplification--to meet spectral, timing, and power requirements. A transmitter may be analog or digital, implemented in hardware, software, or both, and is designed to launch the signal into the chosen medium with characteristics that enable reliable reception.", n.name = "Transmitter";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryManagementUnit"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer's memory management unit (MMU) is the physical hardware that handles its virtual memory and caching operations. The MMU is usually located within the computer's central processing unit (CPU), but sometimes operates in a separate integrated chip (IC).", n.name = "Memory Management Unit";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ElectronicCombinationLock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system comprised of an automatic door closer on the door, an input device, a controlling device, and a lock, usually mechanical, which is released or activated when the correct combination is entered or correct token is presented.", n.name = "Electronic Combination Lock";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SecurityToken"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Security tokens are peripheral devices used to prove one's identity electronically (as in the case of a customer trying to access their bank account). The token is used in addition to or in place of a password to prove that the customer is who they claim to be. The token acts like an electronic key to access something.", n.name = "Security Token";

MERGE (n:MitreDefendHardwareDeviceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AtomicClock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An atomic clock is a clock that measures time by monitoring the resonant frequency of atoms.", n.name = "Atomic Clock";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEngineeringSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Software used in an industrial process to help engineers design, test, and maintain OT. This software enables the programming of OT controllers.", n.name = "OT Engineering Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Compiler"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a compiler is a computer program that translates computer code written in one programming language (the source language) into another language (the target language). The name \"compiler\" is primarily used for programs that translate source code from a high-level programming language to a lower level language (e.g., assembly language, object code, or machine code) to create an executable program.", n.name = "Compiler";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CodeAnalyzer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Code analyzers automatically analyze the composition or behavior of computer programs regarding a property such as correctness, robustness, security, and safety. Program analysis can be performed without executing the program (static program analysis), during runtime (dynamic program analysis) or in a combination of both.", n.name = "Code Analyzer";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationShim"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application shim adapts an application program to run on a version of a platform for which they were not originally created. Most commonly \"Application Shimming\" refers to use of The Windows Application Compatibility Toolkit (ACT) provides backward compatibility by simulating the behavior of older version of Windows.", n.name = "Application Shim";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HMIApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Application software which runs the main program in an HMI.", n.name = "HMI Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OfficeApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An office application is one that is part of an application suite (e.g., Microsoft Office, Open Office).", n.name = "Office Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationServiceApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software application designed to verify the identity of users or devices.", n.name = "Authentication Service Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BuildTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A tool that automates the process of creating a software build and the associated processes including: compiling computer source code into binary code, packaging binary code, and running automated tests.", n.name = "Build Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BootLoader"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A bootloader is software that is responsible for booting a computer. When a computer is turned off, its software‍-‌including operating systems, application code, and data‍-‌remains stored on non-volatile memory. When the computer is powered on, it typically does not have an operating system or its loader in random-access memory (RAM). The computer first executes a relatively small program stored in read-only memory (ROM, and later EEPROM, NOR flash) along with some needed data, to initialize RAM (especially on x86 systems) to access the nonvolatile device (usually block device, eg NAND flash) or devices from which the operating system programs and data can be loaded into RAM.", n.name = "Boot Loader";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DynamicAnalysisTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Dynamic program analysis is the analysis of computer software that is performed by executing programs on a real or virtual processor.", n.name = "Dynamic Analysis Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerRuntime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software layer between a container process and a kernel which often mediates the invocation of a system call.", n.name = "Container Runtime";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Application"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A program that gives a computer instructions that provide the user with tools to accomplish a task; \"he has tried several different word processing applications\".  Distinct from system software that is intrinsically part of the operating system.  An application can be made up of executable files, configuration files, shared libraries, etc.", n.name = "Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwarePackagingTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A tool that automates the process of packaging either or both binary code  and source code for use on one or more target platforms.", n.name = "Software Packaging Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user application is executed for that an individual user on a user's personal computer or remotely by means of virtualization.  This is in contrast to service applications or enterprise software.", n.name = "User Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareDeploymentTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Software that coordinates the deployment process of software to systems, typically remotely.", n.name = "Software Deployment Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DeveloperApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application used to develop computer software including applications used for software construction, analysis, testing, packaging, or management.", n.name = "Developer Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InstantMessagingClient"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Client software used to engage in Instant Messaging, a type of online chat that offers real-time text transmission over the Internet. A LAN messenger operates in a similar way over a local area network. Short messages are typically transmitted between two parties, when each user chooses to complete a thought and select \"send\". Some IM applications can use push technology to provide real-time text, which transmits messages character by character, as they are composed. More advanced instant messaging can add file transfer, clickable hyperlinks, Voice over IP, or video chat.", n.name = "Instant Messaging Client";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Host-basedFirewall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software firewall which controls network inbound and outbound network traffic to the host computer.", n.name = "Host-based Firewall";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UnitTestExecutionTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An unit test execution tool automatically performs unit testing.  Unit testing is a software testing method by which individual units of source code are tested to determine whether they are fit for use.  Unit test execution tools work with sets of one or more computer program modules together with associated control data, usage procedures, and operating procedures. This contrasts with integration testing, which tests inter-unit dependencies and the modules as a group.", n.name = "Unit Test Execution Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkTrafficAnalysisSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A packet analyzer, also known as packet sniffer, protocol analyzer, or network analyzer, is a computer program or computer hardware such as a packet capture appliance, that can intercept and log traffic that passes over a computer network or part of a network.\"", n.name = "Network Traffic Analysis Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SourceCodeAnalyzerTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A source code analyzer tool is a static analysis tool that operates specifically on source code, but not object code.", n.name = "Source Code Analyzer Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Cloud-basedDatabaseApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database application where the underlying infrastructure is managed by a third-party cloud provider. Examples include DynamoDB, Firestore, and CosmosDB.", n.name = "Cloud-based Database Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntegrationTestExecutionTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An integration test execution tool automatically performs integration testing.  Integration testing (sometimes called integration and testing, abbreviated I&T) is the phase in software testing in which individual software modules are combined and tested as a group.", n.name = "Integration Test Execution Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TestExecutionTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A test execution tool is a type of software used to test software, hardware or complete systems.  Synonyms of test execution tool include test execution engine, test executive, test manager, test sequencer.  Two common forms in which a test execution engine may appear are as a: (a) module of a test software suite (test bench) or an integrated development environment, or (b) stand-alone application software.", n.name = "Test Execution Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database application is a computer program whose primary purpose is retrieving information from a computerized database.", n.name = "Database Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerBuildTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software build tool that creates a container (e.g., Docker container) for deployment.", n.name = "Container Build Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Second-stageBootLoader"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An optional, often feature rich,  second stage set of routines run in order to load the operating system.", n.name = "Second-stage Boot Loader";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordManager"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password manager is a software application or hardware that helps a user store and organize passwords. Password managers usually store passwords encrypted, requiring the user to create a master password: a single, ideally very strong password which grants the user access to their entire password database. Some password managers store passwords on the user's computer (called offline password managers), whereas others store data in the provider's cloud (often called online password managers). However offline password managers also offer data storage in the user's own cloud accounts rather than the provider's cloud. While the core functionality of a password manager is to securely store large collections of passwords, many provide additional features such as form filling and password generation.", n.name = "Password Manager";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ClientApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A client application is software that accesses a service made available by a server. The server is often (but not always) on another computer system, in which case the client accesses the service by way of a network. The term applies to the role that programs or devices play in the client-server model", n.name = "Client Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Computer software which enables operating system or platform functionality.", n.name = "System Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Browser"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web browser (commonly referred to as a browser) is a software application for retrieving, presenting, and traversing information resources on the World Wide Web. An information resource is identified by a Uniform Resource Identifier (URI/URL) and may be a web page, image, video or other piece of content. Hyperlinks present in resources enable users easily to navigate their browsers to related resources. Although browsers are primarily intended to use the World Wide Web, they can also be used to access information provided by web servers in private networks or files in file systems.", n.name = "Browser";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VersionControlTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Version control tools are tools that used to conduct version control. A  component of software configuration management, version control, also known as revision control, source control, or source code management systems are systems responsible for the management of changes to documents, computer programs, large web sites, and other collections of information. Changes are usually identified by a number or letter code, termed the \"revision number\", \"revision level\", or simply \"revision\". For example, an initial set of files is \"revision 1\". When the first change is made, the resulting set is \"revision 2\", and so on. Each revision is associated with a timestamp and the person making the change. Revisions can be compared, restored, and with some types of files, merged.", n.name = "Version Control Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialManagementSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Credential Management, also referred to as a Credential Management System (CMS), is an established form of software that is used for issuing and managing credentials as part of public key infrastructure (PKI).", n.name = "Credential Management System";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalSignalProcessingApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Digital Signal Processing (DSP) application is a software system that ingests discrete-time or discrete-space signals (from sensors, ADCs, or files) and applies digital signal processing algorithms to analyze, transform, synthesize, or make decisions about those signals, often under real-time throughput and latency constraints. It encompasses capabilities such as filtering, spectral analysis, modulation/demodulation, channelization, synchronization, detection and estimation, compression, beamforming, and reconstruction, and spans domains including software-defined radio (e.g., waveform generation and physical-layer stacks), audio and speech, image and video, radar/sonar/LiDAR, biomedical signals, instrumentation, and control.", n.name = "Digital Signal Processing Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StaticAnalysisTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A static [program] analysis tool performs an automated analysis of computer software without actually executing programs, in contrast with dynamic analysis, which is analysis performed on programs while they are executing. In most cases the analysis is performed on some version of the source code, and in the other cases, some form of the object code.", n.name = "Static Analysis Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerOrchestrationSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A d3f:Software which manages and coordinates running one or more d3f:ContainerProcess.", n.name = "Container Orchestration Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ChatroomClient"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Client software used to describe conduct any form of synchronous conferencing, occasionally even asynchronous conferencing. The term can thus mean any technology ranging from real-time online chat and online interaction with strangers (e.g., online forums) to fully immersive graphical social environments.", n.name = "Chatroom Client";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CodecApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application that encodes and decodes digital data.", n.name = "Codec Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EncoderApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application that encodes digital data.", n.name = "Encoder Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#First-stageBootLoader"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The very first routine run in order to load the operating system.", n.name = "First-stage Boot Loader";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Computer software, or simply software, is that part of a computer system that consists of encoded information or computer instructions, in contrast to the physical hardware from which the system is built.", n.name = "Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoderApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application that decodes digital data.", n.name = "Decoder Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DHCPServiceApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application that automates the assignment of IP addresses and other network configuration parameters to devices on a network", n.name = "DHCP Service Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemServiceSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Software services provided as part of the operating system, typically accessed through system calls.", n.name = "System Service Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkAgent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network agent is software installed on a network node or device that transmits information back to a collector agent or management system.  Kinds of network agents include SNMP Agent, IPMI agents, WBEM agents, and many proprietary agents capturing network monitoring and management information.", n.name = "Network Agent";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#JobSchedulerSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A job scheduler software is operating system software that when run executes scheduled tasks (time-scheduling in the sense of wall clock time; not operating system scheduling of processes for multitasking). Processes running such software are task scheduler processes. In Windows, Scheduled Tasks are created and managed by the Task Scheduler. In Unix-like OSes, the `cron` utitility serves a similar role.", n.name = "Job Scheduler Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CodecLibrary"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software component that encodes or decodes a data stream of signal.", n.name = "Codec Library";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioWaveformApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software implementation of a radio waveform that executes on the programmable processing elements of a software-defined radio and realizes the signal processing functions necessary to transmit and receive a specific radio signal. On peripheral SDRs, this can take the form of a compiled flowgraph that runs on the host PC, whereas in stand-alone SDRs it may be an FPGA bitstream or waveform package that executes on the SDR's processing elements.", n.name = "Software-defined Radio Waveform Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebServerApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web server application handles HTTP requests from clients, serves static content, and may act as a reverse proxy or load balancer.", n.name = "Web Server Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AssetInventoryAgent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An asset inventory agent is a software tool which captures and transmits information about the devices on a network, including their hostnames, MAC addresses, software they may be running, etc.", n.name = "Asset Inventory Agent";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application which is delivered by a web server over HTTP protocols that is presented to a client web browser.", n.name = "Web Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BrowserExtension"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A browser extension is a plug-in that extends the functionality of a web browser in some way. Some extensions are authored using web technologies such as HTML, JavaScript, and CSS. Browser extensions can change the user interface of the web browser without directly affecting viewable content of a web page; for example, by adding a \"toolbar.\"", n.name = "Browser Extension";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UtilitySoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Utility applications are software applications designed to help to analyze, configure, optimize or maintain a computer. It is used to support the computer infrastructure - in contrast to application software, which is aimed at directly performing tasks that benefit ordinary users. However, utilities often form part of the application systems. For example, a batch job may run user-written code to update a database and may then include a step that runs a utility to back up the database, or a job may run a utility to compress a disk before copying files.", n.name = "Utility Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Shim"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer programming, a shim is a small library that transparently intercepts API calls and changes the arguments passed, handles the operation itself, or redirects the operation elsewhere. Shims can be used to support an old API in a newer environment, or a new API in an older environment. Shims can also be used for running programs on different software platforms than those for which they were developed.", n.name = "Shim";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareLibrary"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software library is a collection of software components that are used to build a software product.", n.name = "Software Library";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationInstaller"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application installer is a user application designed to install, configure, and deploy another application.", n.name = "Application Installer";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An application that provides a set of software functionalities so that multiple clients who can reuse the functionality, provided they are authorized for use of the service.", n.name = "Service Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DataAcquisitionAgent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software component which connects to data sources to gather raw, time-stamped data. It often connects to databases or historian gateways for storage and analysis.", n.name = "Data Acquisition Agent";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProcessDataHistorian"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system used to collect and store data, including telemetry, events, alerts, and alarms about the operational process and supporting devices.", n.name = "OT Process Data Historian";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Kernel"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The kernel is a computer program that constitutes the central core of a computer's operating system. It has complete control over everything that occurs in the system. As such, it is the first program loaded on startup, and then manages the remainder of the startup, as well as input/output requests from software, translating them into data processing instructions for the central processing unit. It is also responsible for managing memory, and for managing and communicating with computing peripherals, like printers, speakers, etc. The kernel is a fundamental part of a modern computer's operating system.", n.name = "Kernel";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmbeddedDatabaseApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software application that integrates a database management system (DBMS) directly within its own structure, rather than relying on a separate, standalone database server. Examples include SQLite and Berkeley DB.", n.name = "Embedded Database Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseServiceApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software application that interacts with a database management system (DBMS) hosted as a separate, standalone service or server.", n.name = "Database Service Application";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwarePatch"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A patch is a piece of software designed to update a computer program or its supporting data, to fix or improve it. This includes fixing security vulnerabilities and other bugs, with such patches usually called bugfixes or bug fixes, and improving the usability or performance. Although meant to fix problems, poorly designed patches can sometimes introduce new problems (see software regressions). In some special cases updates may knowingly break the functionality, for instance, by removing components for which the update provider is no longer licensed or disabling a device.", n.name = "Software Patch";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CollaborativeSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Collaborative software or groupware is application software designed to help people working on a common task to attain their goals. One of the earliest definitions of groupware is \"intentional group processes plus software to support them\". Collaborative software is a broad concept that overlaps considerably with computer-supported cooperative work (CSCW). According to Carstensen and Schmidt (1999) groupware is part of CSCW. The authors claim that CSCW, and thereby groupware, addresses \"how collaborative activities and their coordination can be supported by means of computer systems.\"", n.name = "Collaborative Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlProgram"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The file stored in controller memory that is used to operate the controller.", n.name = "OT Control Program";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VirtualizationSoftware"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Virtualization software allows a single host computer to create and run one or more virtual environments. Virtualization software is most often used to emulate a complete computer system in order to allow a guest operating system to be run, for example allowing Linux to run as a guest on top of a PC that is natively running a Microsoft Windows operating system (or the inverse, running Windows as a guest on Linux).", n.name = "Virtualization Software";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemPackagingTool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software packaging tool oriented on building a software package for a particular operating system (e.g. rpmbuild.)", n.name = "Operating System Packaging Tool";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusinessCommunicationPlatformClient"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Client software to enable the process of sharing information between employees within and outside a company.  Business communication encompasses topics such as marketing, brand management, customer relations, consumer behavior, advertising, public relations, corporate communication, community engagement, reputation management, interpersonal communication, employee engagement, and event management. It is closely related to the fields of professional communication and technical communication.", n.name = "Business Communication Platform Client";

MERGE (n:MitreDefendSoftwareEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemTimeApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system time utility is utility software that can get the system time, such as the Unix date command or Windows' Net utility.", n.name = "System Time Application";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SymbolicLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A symbolic link (also symlink or soft link) is a term for any file that contains a reference to another file or directory in the form of an absolute or relative path and that affects pathname resolution.", n.name = "Symbolic Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system file is a file that is part of, or used to store information about, the operating system itself.", n.name = "Operating System File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImageFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file that contains graphics data.", n.name = "Image File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareLibraryFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software library is a collection of software components that are used to build a software product.", n.name = "Software Library File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserInitScript"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A script used to initialize and configure elements of the user's applications and user environment.", n.name = "User Init Script";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OpticalDiscImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An optical disc image (or ISO image, from the ISO 9660 file system used with CD-ROM media) is a disk image that contains everything that would be written to an optical disc, disk sector by disc sector, including the optical disc file system.", n.name = "Optical Disc Image";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InitScript"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An init script (or initialization script) is an executable script that initializes the an application, a process, or a service's state.  Examples include scripts run at boot by Unix or Windows, or those run to initialize a shell.", n.name = "Init Script";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BitmapImageFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file that contains graphics data represented in a bitmap.", n.name = "Bitmap Image File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTFSLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The NTFS filesystem defines various ways to link files, i.e. to make a file point to another file or its contents. The object being pointed to is called the target. There are three classes of NTFS links: (a) Hard links, which have files share the same MFT entry (inode), in the same filesystem; (b) Symbolic links, which record the path of another file that the links contents should show and can accept relative paths; and (c) Junction points, which are similar to symlinks but defined only for directories and only accepts local absolute paths", n.name = "NTFS Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PropertyListFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In the OS X, iOS, NeXTSTEP, and GNUstep programming frameworks, property list files are files that store serialized objects. Property list files use the filename extension .plist, and thus are often referred to as p-list files. Property list files are often used to store a user's settings. They are also used to store information about bundles and applications, a task served by the resource fork in the old Mac OS.", n.name = "Property List File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SlowSymbolicLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A slow symbolic link is any symbolic link on a Unix filesystem that is not a fast symbolic link; slow symlink is thus retroactively termed from fast symlink.  Slow symbolic links stored the symbolic link information as data in regular files.", n.name = "Slow Symbolic Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserStartupScriptFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user startup script file is a shortcut file that is executed when a user logs in and starts a session on the host.  These indicate applications the user wants started at login.  For Windows, these are typically found in the user's startup directory.", n.name = "User Startup Script File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#JavaArchive"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A JAR (Java ARchive) is a package file format typically used to aggregate many Java class files and associated metadata and resources (text, images, etc.) into one file for distribution.", n.name = "Java Archive";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ObjectFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An object file is a file that contains relocatable machine code.", n.name = "Object File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CustomArchiveFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A custom archive file is an archive file conforming to a custom format; that is, an archive file that does not conform to a common standard.", n.name = "Custom Archive File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Simple form of password database held in a single file (e.g., /etc/password)", n.name = "Password File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTFSSymbolicLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An NTFS symbolic link records the path of another file that the links contents should show. Can accept relative paths. SMB networking (UNC path) and directory support added in NTFS 3.1.", n.name = "NTFS Symbolic Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MultimediaFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file that contains digital multimedia.", n.name = "Multimedia File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PacketCaptureFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file which contains raw representations of collected packets.", n.name = "Packet Capture File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsShortcutFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Microsoft Windows shortcut file.", n.name = "Windows Shortcut File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StorageImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A storage image is a complete, encapsulated representation of a storage medium or system environment. It contains all the data, files, and configurations necessary to replicate or deploy a specific system state or software setup.", n.name = "Storage Image";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SharedLibraryFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A shared library file is a file that is intended to be shared by executable files and further shared library (object) files. Modules used by a program are loaded from individual shared objects into memory at load time or runtime, rather than being copied by a linker when it creates a single monolithic executable file for the program", n.name = "Shared Library File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DocumentFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A document is a written, drawn, presented or recorded representation of thoughts. An electronic document file is usually used to describe a primarily textual file, along with its structure and design, such as fonts, colors and additional images.", n.name = "Document File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkInitScriptFileResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer file resource made available from one host to other hosts on a computer network that is also an initialization script.", n.name = "Network Init Script File Resource";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemExecutableFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system executable is a critical executable that is part of the operating system, and without which, the operating system may not operate correctly.", n.name = "Operating System Executable File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CertificateFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing a digital certificate. In cryptography, a public key certificate (also known as a digital certificate or identity certificate) is an electronic document used to prove the ownership of a public key. The certificate includes information about the key, information about its owner's identity, and the digital signature of an entity that has verified the certificate's contents are correct. If the signature is valid, and the person examining the certificate trusts the signer, then they know they can use that key to communicate with its owner.", n.name = "Certificate File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutableFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, executable code or an executable file or executable program, sometimes simply an executable, causes a computer \"to perform indicated tasks according to encoded instructions,\" as opposed to a data file that must be parsed by a program to be meaningful. These instructions are traditionally machine code instructions for a physical CPU. However, in a more general sense, a file containing instructions (such as bytecode) for a software interpreter may also be considered executable; even a scripting language source file may therefore be considered executable in this sense. The exact interpretation depends upon the use; while the term often refers only to machine code files, in the context of protection against computer viruses all files which cause potentially hazardous instruction", n.name = "Executable File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelModule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A loadable kernel module (LKM) is an object file that contains code to extend the running kernel, or so-called base kernel, of an operating system. LKMs are typically used to add support for new hardware (as device drivers) and/or filesystems, or for adding system calls. When the functionality provided by a LKM is no longer required, it can be unloaded in order to free memory and other resources.  Most current Unix-like systems and Microsoft Windows support loadable kernel modules, although they might use a different name for them, such as kernel loadable module (kld) in FreeBSD, kernel extension (kext) in macOS,[1] kernel extension module in AIX, kernel-mode driver in Windows NT[2] and downloadable kernel module (DKM) in VxWorks. They are also known as kernel loadable modules (or KLM), and simply as kernel modules (KMOD).", n.name = "Kernel Module";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DiskImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A disk image is a snapshot of a storage device's structure and data typically stored in one or more computer files on another storage device.", n.name = "Disk Image";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VMImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Virtual Machine Image (VMI) is a file that encapsulates the entire state of a virtual machine at a given point in time. This includes the operating system, applications, data, and configurations. VMIs are used to create and replicate virtual machines, ensuring consistency and reliability across different environments.", n.name = "Virtual Machine Image";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CompilerConfigurationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing Information used to configure the parameters and initial settings for a compiler.", n.name = "Compiler Configuration File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FastSymbolicLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Fast symbolic links, allow storage of the target path within the data structures used for storing file information on disk (e.g., within the inodes). This space normally stores a list of disk block addresses allocated to a file. Thus, symlinks with short target paths are accessed quickly. Systems with fast symlinks often fall back to using the original method if the target path exceeds the available inode space.", n.name = "Fast Symbolic Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LogFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A log file is a file that records either events that occur in an operating system or other software runs, or messages between different users of a communication software. Logging is the act of keeping a log. In the simplest case, messages are written to a single log file.  A transaction log is a file (i.e., log) of the communications between a system and the users of that system, or a data collection method that automatically captures the type, content, or time of transactions made by a person from a terminal with that system. For Web searching, a transaction log is an electronic record of interactions that have occurred during a searching episode between a Web search engine and users searching for information on that Web search engine.  Many operating systems, software frameworks and programs include a logging system. A widely used logging standard is syslog, defined in Internet Engineering Task Force (IETF) RFC 5424). The syslog standard enables a dedicated, standardized subsystem to generate, filter, record, and analyze log messages. This relieves software developers of having to design and code their own ad hoc logging systems.", n.name = "Log File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MicrosoftHTMLApplication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An HTML Application (HTA) is a Microsoft Windows program whose source code consists of HTML, Dynamic HTML, and one or more scripting languages supported by Internet Explorer, such as VBScript or JScript.", n.name = "Microsoft HTML Application";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ShortcutFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A shortcut file, or shortcut, is a handle that allows the user to find a file or resource located in a different directory or folder from the place where the shortcut is located.  Shortcuts, which are supported by the graphical file browsers of some operating systems, may resemble symbolic links but differ in a number of important ways. One difference is what type of software is able to follow them:   - Symbolic links are automatically resolved by the file system. Any software program, upon accessing a symbolic link, will see the target instead, whether the program is aware of symbolic links or not.   - Shortcuts are treated like ordinary files by the file system and by software programs that are not aware of them. Only software programs that understand shortcuts (such as the Windows shell and file browsers) treat them as references to other files.  Another difference are the capabilities of the mechanism:   - Microsoft Windows shortcuts normally refer to a destination by an absolute path (starting from the root directory), whereas POSIX symbolic links can refer to destinations via either an absolute or a relative path. The latter is useful if both the location and destination of the symbolic link share a common path prefix[clarification needed], but that prefix is not yet known when the symbolic link is created (e.g., in an archive file that can be unpacked anywhere).  - Microsoft Windows application shortcuts contain additional metadata that can be associated with the destination, whereas POSIX symbolic links are just strings that will be interpreted as absolute or relative pathnames.  - Unlike symbolic links, Windows shortcuts maintain their references to their targets even when the target is moved or renamed. Windows domain clients may subscribe to a Windows service called Distributed Link Tracking to track the changes in files and folders to which they are interested. The service maintains the integrity of shortcuts, even when files and folders are moved across the network.[14] Additionally, in Windows 9x and later, Windows shell tries to find the target of a broken shortcut before proposing to delete it.", n.name = "Shortcut File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CommandHistoryLogFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A command history log file is a file containing a command history, which the history of commands run in an operating system shell.", n.name = "Command History Log File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemConfigurationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system configuration file is a file used to configure the operating system.", n.name = "Operating System Configuration File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebScriptFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing a script in a web-scripting programming language. Web scripts may be present and run on the client or on the server side.", n.name = "Web Script File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutableScript"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An executable script is written in a scripting language and interpreted at run time. This is in contrast with an executable binary, which contains machine code instructions for a physical CPU or byte code for a virtual machine.", n.name = "Executable Script";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PowerShellProfileScript"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A PowerShell profile script is a script that runs when PowerShell starts and can be used as a logon script to customize user environments.", n.name = "PowerShell Profile Script";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemInitScript"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A script used to initialize and configure elements of the system's environment, applications, services, or its operating system.", n.name = "System Init Script";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTFSHardLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An NTFS hard link points to another file, and files share the same MFT entry (inode), in the same filesystem.", n.name = "NTFS Hard Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file that stores data and metadata in an organized format, managed by a database management system.", n.name = "Database File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ExecutableBinary"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An executable binary contains machine code instructions for a physical CPU. D3FEND also considers byte code for a virtual machine to be binary code.  This is in contrast to executable scripts written in a scripting language.", n.name = "Executable Binary";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Alias"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In macOS, an alias is a small file that represents another object in a local, remote, or removable[1] file system and provides a dynamic link to it; the target object may be moved or renamed, and the alias will still link to it (unless the original file is recreated; such an alias is ambiguous and how it is resolved depends on the version of macOS).", n.name = "Alias";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#POSIXSymbolicLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A POSIX-compliant symbolic link.  These are often fast symbolic links, but need not be.", n.name = "POSIX Symbolic Link";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#File"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file maintained in computer-readable form.", n.name = "File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Email"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An email, or email message, is a document that is sent between computer users across computer networks.", n.name = "Email";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfigurationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing Information used to configure the parameters and initial settings for an application.. A plist file is an example of this type of file for macOS.  Usually text-based.", n.name = "Application Configuration File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OfficeApplicationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A document file in a format associated with an d3f:OfficeApplication.", n.name = "Office Application File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HTMLFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A document file encoded in HTML.The HyperText Markup Language, or HTML is the standard markup language for documents designed to be displayed in a web browser. It can be assisted by technologies such as Cascading Style Sheets (CSS) and scripting languages such as JavaScript. Web browsers receive HTML documents from a web server or from local storage and render the documents into multimedia web pages. HTML describes the structure of a web page semantically and originally included cues for the appearance of the document.", n.name = "HTML File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing Information used to configure the parameters and initial settings for some computer programs. They are used for user applications, server processes and operating system settings.", n.name = "Configuration File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CACertificateFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file containing a digital certificate issued by a certificate authority (CA).  Certificate authorities store, issue, and sign digital certificates used as part of the public key infrastructure.", n.name = "CA Certificate File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NTFSJunctionPoint"})
ON CREATE SET n.id = randomUUID()
SET n.description = "NTFS junction points are are similar to NTFS symlinks but are defined only for directories. Only accepts local absolute paths.", n.name = "NTFS Junction Point";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VectorImageFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file that contains graphics data represented by vectors.", n.name = "Vector Image File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemSharedLibraryFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system shared library file is a shared library file that is part of the operating system and that incorporates common operating system code for use by any application or to provide operating system services.", n.name = "Operating System Shared Library File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserInitConfigurationFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user initialization configuration file is a file containing the information necessary to configure that part of a user's environment which is common to all applications and actions. User configurations may be overridden by more specific configuration information (such as that found in a application configuration file.)", n.name = "User Init Configuration File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemLogFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system log file records events that occur in an operating system.", n.name = "Operating System Log File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MultimediaDocumentFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital video files which often contain audio.", n.name = "Multimedia Document File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemStateImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a system image is a serialized copy of the entire state of a computer system stored in some non-volatile form, such as a binary executable file.", n.name = "System State Image";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PythonScriptFile"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Python Script File";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailAttachment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An email attachment is a computer file sent along with an email message. One or more files can be attached to any email message, and be sent along with it to the recipient. This is typically used as a simple method to share documents and images.", n.name = "Email Attachment";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FPGABitstream"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A binary configuration file generated by synthesizing and placing-and-routing an HDL design, which is loaded into a Field-Programmable Gate Array (FPGA) to physically define its internal logic, interconnects, and I/O behavior. Rather than being executed by a processor, it programs the device itself.", n.name = "FPGA Bitstream";

MERGE (n:MitreDefendFileEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ArchiveFile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An archive file is a file that is composed of one or more computer files along with metadata. Archive files are used to collect multiple data files together into a single file for easier portability and storage, or simply to compress files to use less storage space. Archive files often store directory structures, error detection and correction information, arbitrary comments, and sometimes use built-in encryption.", n.name = "Archive File";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemInitConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "System initialization configuration information is configuration information used to configure the services, parameters, and initial settings for an operating system at startup.", n.name = "System Init Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkMultimediaStreamingResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A server that provides digital multimedia content to users.", n.name = "Network Multimedia Streaming Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Resource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a system resource, or simply resource, is any physical or virtual component of limited availability within a computer system. Every device connected to a computer system is a resource. Every internal system component is a resource. Virtual system resources include files (concretely file handles), network connections (concretely network sockets), and memory areas. Managing resources is referred to as resource management, and includes both preventing resource leaks (releasing a resource when a process has finished using it) and dealing with resource contention (when multiple processes wish to access a limited resource).", n.name = "Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessControlList"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A list of permissions attached to an object.", n.name = "Access Control List";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessControlGroup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A collection of objects that can have access controls placed on them.", n.name = "Access Control Group";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserStartupDirectory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user startup directory holds information necessary to start the users session with the system.", n.name = "User Startup Directory";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Configuration Database";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EmailRule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A configuration of an email application which is used to apply logical or data processing functions to data processed by the email  application.", n.name = "Email Rule";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Windows Registry Keys are container objects similar to folders that contain subkeys and/or data entries called values. A key can be a 'Registry Hive' when it is root key of a logical group of keys, subkeys, and values that has a set of supporting files loaded into memory when the operating system is started or a user logs in.", n.name = "Windows Registry Key";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkFileResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer file resource made available from one host to other hosts on a computer network.", n.name = "Network File Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfigurationDatabaseRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database record holding information used to configure the parameters and initial settings for an application.", n.name = "Application Configuration Database Record";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationManagementDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database used to store configuration records throughout their lifecycle. The Configuration Management System (CMS) maintains one or more CMDBs, and each CMDB stores attributes of configuration items (CIs), and relationships with other CIs.", n.name = "Configuration Management Database";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GroupPolicy"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Group Policy is a feature of the Microsoft Windows NT family of operating systems that controls the working environment of user accounts and computer accounts. Group Policy provides the centralized management and configuration of operating systems, applications, and users' settings in an Active Directory environment. A version of Group Policy called Local Group Policy (\"LGPO\" or \"LocalGPO\") also allows Group Policy Object management on standalone and non-domain computers.", n.name = "Group Policy";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information used to configure the services, parameters, and initial settings for a virtual server instance running in a cloud service.", n.name = "Cloud Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationDatabaseRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Configuration Database Record defines settings, parameters, or preferences for applications, systems, or devices.", n.name = "Configuration Database Record";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfigurationDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database used to hold application configuration data.", n.name = "Application Configuration Database";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HostGroup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A collection of Hosts used to allow operations such as access control to be applied to the entire group.", n.name = "Host Group";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemConfigurationComponent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An component of the overall information necessary for the configuration of an operating system.", n.name = "Operating System Configuration Component";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationRule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A configuration of an application which is used to apply logical or data processing functions to data processed by the application.", n.name = "Application Rule";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a system resource, or simply resource, is any physical or virtual component of limited availability within a computer system. Every device connected to a computer system is a resource. Every internal system component is a resource. Virtual system resources include files (concretely file handles), network connections (concretely network sockets), and memory areas. Managing resources is referred to as resource management, and includes both preventing resource leaks (releasing a resource when a process has finished using it) and dealing with resource contention (when multiple processes wish to access a limited resource).", n.name = "Local Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a shared resource, or network share, is a computer resource made available from one host to other hosts on a computer network. It is a device or piece of information on a computer that can be remotely accessed from another computer, typically via a local area network or an enterprise intranet, transparently as if it were a resource in the local machine.Network sharing is made possible by inter-process communication over the network.", n.name = "Network Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserGroup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "User groups are a way to collect user accounts and/or computer accounts into manageable units. Administrators can assign permissions, roles, or access to resources, as well as modify group membership, depending on the operating system.", n.name = "User Group";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkAudioVisualStreamingResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A server that provides digital audio-visual media content to users.", n.name = "Network Audio Visual Streaming Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkDirectoryResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A directory resource made available from one host to other hosts on a computer network.", n.name = "Network Directory Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserLogonInitResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user logon initialization resource contains information used to configure a user's environment when a user logs into a system.", n.name = "User Logon Init Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StartupDirectory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A startup directory is a directory containing executable files or links to executable files which are run when a user logs in or when a system component or service is started.", n.name = "Startup Directory";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistryValue"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Windows Registry Value is a data structure consisting of a name, type, data (as a pointer), and the length. Windows Registry Values are always associated with a Windows Registry Key. They store the actual configuration data for the operating system and the programs that run on the system.", n.name = "Windows Registry Value";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDeviceConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information used to configure the parameters and settings for hardware devices.", n.name = "Hardware Device Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigurationDatabaseRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database record holding information used to configure the services, parameters, and initial settings for an operating system.", n.name = "System Configuration Database Record";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ConfigurationResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A resource used to configure a system including software and hardware.", n.name = "Configuration Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemStartupDirectory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system startup directory is a directory containing executable files or links to executable files which are run when the system starts.", n.name = "System Startup Directory";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ShimDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A application configuration database that contains or points to software shims (e.g., for backward compatibility, patches, etc.)", n.name = "Shim Database";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information used to configure the parameters and initial settings for an application.", n.name = "Application Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkVideoStreamingResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A server that provides digital video media content to users.", n.name = "Network Video Streaming Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkMediaStreamingResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A server that provides digital media content to users.", n.name = "Network Media Streaming Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessEnvironmentVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An environment variable is a dynamic-named value that can affect the way running processes will behave on a computer. They are part of the environment in which a process runs.", n.name = "Process Environment Variable";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationProcessConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The current configuration of an application process, stored in memory. It may have been sourced from other types of application configurations, e.g. Application Configuration Files or Application Configuration Database Records.", n.name = "Application Process Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CloudInstanceMetadata"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Cloud instance metadata is configuration information on the instance and users of the instance.  This includes such information as security groups, public ip addresses, and private addresses, public keys configured, and event rotating security keys. User data can contain initialization scripts, variables, passwords, and more.", n.name = "Cloud Instance Metadata";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModeSwitch"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Keyswitch or mode switch is the mechanism for changing the operating mode of an OT controller or device.", n.name = "OT Mode Switch";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigurationInitDatabaseRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database record holding information used to configure the services, parameters, and initial settings for an operating system at startup.", n.name = "System Configuration Init Database Record";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web resource is a resource identified by a Uniform Resource Identifier (URI) and made available from one host to another host via a web protocol and across a network or networks.", n.name = "Web Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RTSPServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A streaming server that utilizes the real-time streaming protocol.", n.name = "RTSP Server";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a remote  resource is a computer resource made available from one host to other hosts on a computer network. It is a device or piece of information on a computer that can be remotely accessed from another computer, typically via a local area network or an enterprise intranet.", n.name = "Remote Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessControlConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information about what access permissions are granted to particular users for particular objects.", n.name = "Access Control Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebFileResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web file resource is a file resource identified by a Uniform Resource Identifier (URI) and made available from one host to another host via a web protocol and across a network or networks.", n.name = "Web File Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information used to configure the services, parameters, and initial settings for an operating system.", n.name = "Operating System Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkAudioStreamingResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A server that provides digital audio media content to users.", n.name = "Network Audio Streaming Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Software-definedRadioConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The physical radio hardware parameters used by a software-defined radio (SDR), including center frequency, bandwidth, gain settings, antenna selection, ADC/DAC sample rates, filter characteristics, power output, and others.", n.name = "Software-defined Radio Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigurationInitResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system configuration initialization resource has information for initializing (booting) a system.", n.name = "System Configuration Init Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkFileShareResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A shared file resource, or network file share, is a computer file made available from one host to other hosts on a computer network. Network sharing is made possible by inter-process communication over the network. It includes both files and directories.", n.name = "Network File Share Resource";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemFirewallConfiguration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The configuration for a individual host operating system's firewall.", n.name = "System Firewall Configuration";

MERGE (n:MitreDefendResourceEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebAPIResource"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A web API resource is an API resource identified by a Uniform Resource Identifier (URI) and made available from one host to another host via a web protocol and across a network or networks.", n.name = "Web API Resource";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessTree"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process tree is a tree structure representation of parent-child relationships established via process spawn operations.", n.name = "Process Tree";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputerPlatform"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Platform includes the hardware and OS. The term computing platform can refer to different abstraction levels, including a certain hardware architecture, an operating system (OS), and runtime libraries. In total it can be said to be the stage on which computer programs can run.", n.name = "Computer Platform";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InternetPersona"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A social identity that an Internet user establishes in online communities and websites. It may also be an actively constructed presentation of oneself.", n.name = "Internet Persona";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BootSector"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A boot record [boot sector] is the sector of a persistent data storage device (e.g., hard disk, floppy disk, optical disc, etc.) which contains machine code to be loaded into random-access memory (RAM) and then executed by a computer system's built-in firmware (e.g., the BIOS, Das U-Boot, etc.).", n.name = "Boot Sector";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PythonPackage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Python package is an aggregation of many Python files - either in source code or in bytecode - and associated metadata and resources (text, images, etc.). Python packages can be distributed in different file formats.", n.name = "Python Package";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyDeviceOperatingModeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modifies the running state of an application or program on a device.", n.name = "OT Modify Device Operating Mode Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareDriver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a device driver (commonly referred to simply as a driver) is a computer program that operates or controls a particular type of device that is attached to a computer. A driver provides a software interface to hardware devices, enabling operating systems and other computer programs to access hardware functions without needing to know precise details of the hardware being used. A driver communicates with the device through the computer bus or communications subsystem to which the hardware connects. When a calling program invokes a routine in the driver, the driver issues commands to the device. Once the device sends data back to the driver, the driver may invoke routines in the original calling program. Drivers are hardware dependent and operating-system-specific. They usually provide the interrupt handling required for any necessary asynchronous time-dependent hardware interface.", n.name = "Hardware Driver";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContentPolicy"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A set of rules and guidelines that dictate the acceptable use, distribution, and management of digital content within a system or platform. It defines what content is allowed, restricted, or prohibited, ensuring compliance with legal, ethical, and organizational standards.", n.name = "Content Policy";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProcessDataCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage data associated with a controlled process.", n.name = "OT Process Data Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTCreateDataCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that creates data on a remote device.", n.name = "OT Create Data Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthorizationLog"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A log of authorization events.", n.name = "Authorization Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote login session is a login session where a client has logged in from their local host machine to a server via a network.", n.name = "Remote Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusNetworkFrame"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network frame whose layout and timing follow a bus protocol, allowing data to be exchanged across the shared bus medium.", n.name = "Bus Network Frame";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InterprocessCommunication"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, inter-process communication or inter-process communication (IPC) refers specifically to the mechanisms an operating system provides to allow processes it manages to share data. Typically, applications can use IPC categorized as clients and servers, where the client requests data and the server responds to client requests. Many applications are both clients and servers, as commonly seen in distributed computing. Methods for achieving IPC are divided into categories which vary based on software requirements, such as performance and modularity requirements, and system circumstances, such as network bandwidth and latency.", n.name = "Interprocess Communication";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CommandHistoryLog"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A log of commands run in an operating system shell.", n.name = "Command History Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VehicleOperatingMode"})
ON CREATE SET n.id = randomUUID()
SET n.name = "Vehicle Operating Mode";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Partition"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A partition is a region on secondary storage device created so that the region can be managed by itself; separate from any other regions (partitions) on that secondary storage device. Creating partitions is typically the first step of preparing a newly installed storage device, before any file system is created. The device stores the information about the partitions' locations and sizes in an area known as the partition table that the operating system reads before any other part of the disk. Each partition then appears to the operating system as a distinct \"logical\" storage device that uses part of the actual device. System administrators use a program called a partition editor to create, resize, delete, and manipulate the partitions. Partitioning allows the use of different filesystems to be installed for different kinds of files. Separating user data from system data can prevent the system partition from becoming full and rendering the system unusable. Partitioning can also make backing up easier. [Definition adapted as generalization from definition of disk partitioning and distinct from in-memory partitions.]", n.name = "Partition";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTPauseCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to pause a service/program.", n.name = "OT Pause Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SafeMode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An intentionally constrained operating mode of a system in which nonessential functions are disabled or limited and control is shifted to a minimal, well-tested configuration that prioritizes preventing harm (to the system, its environment, or data), maintaining basic stability and monitoring, and enabling diagnosis and recovery back to normal operation.", n.name = "Safe Mode";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeleteDataCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that removes data on a remote device.", n.name = "OT Delete Data Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareWatchdogTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software watchdog timer is a watchdog timer implemented in software.", n.name = "Software Watchdog Timer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkResourceAccess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ephemeral digital artifact comprising a request of a network resource and any response from that network resource.", n.name = "Network Resource Access";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WatchdogTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A watchdog timer (WDT, or simply a watchdog) is an electronic or software timer that is used to detect and recover from computer malfunctions.", n.name = "Watchdog Timer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Repository"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A centralized digital storage location where code, files, and related resources are systematically organized, managed, and maintained.", n.name = "Repository";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PageTable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A page table  is the data structure used by the MMU in a virtual memory computer system  to store the mapping between virtual addresses (virtual pages) and physical addresses (page frames).", n.name = "Page Table";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareTimerDeviceDriver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device driver for a hardware timer.", n.name = "Hardware Timer Device Driver";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SpacecraftSafeMode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Safe mode is an operating mode of a modern uncrewed spacecraft during which all non-essential systems are shut down and only essential functions such as thermal management, radio reception and attitude control are active.", n.name = "Spacecraft Safe Mode";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyDeviceConfigurationCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Modify device configuration.", n.name = "OT Modify Device Configuration Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PlatformUptime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A variable that notes the amount of time a platform has been running since its last power cycle or reset.", n.name = "Platform Uptime";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTestCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a  device to run a program in Test mode.", n.name = "OT Test Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ContainerImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A container is a standard unit of software that packages up code and all its dependencies so the application runs quickly and reliably from one computing environment to another. A Docker container image is a lightweight, standalone, executable package of software that includes everything needed to run an application: code, runtime, system tools, system libraries and settings.  Container images become containers at runtime and in the case of Docker containers - images become containers when they run on Docker Engine. Available for both Linux and Windows-based applications, containerized software will always run the same, regardless of the infrastructure. Containers isolate software from its environment and ensure that it works uniformly despite differences for instance between development and staging.", n.name = "Container Image";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Clock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A mechanism that generates periodic, accurately spaced signals for timekeeping applications. Clocks may be implemented in hardware or software and are essential for system operations, synchronization, and event ordering.", n.name = "Clock";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentBlock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A section within a file that contains the main content or data payload.", n.name = "File Content Block";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Process segments are distinct partitions of the memory space of a running process.  Heap, data, code, and stack segments are examples of process segments.", n.name = "Process Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTEstablishRemoteConnectionCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Used to establish an TCP/IP Connection to the target device.", n.name = "OT Establish Remote Connection Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryAddressSpace"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A memory address space is a space containing memory addresses.", n.name = "Memory Address Space";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SSHSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Secure Shell Protocol (SSH) session is a session over a secure channel established using SSH to connect a client to a server and establish the remote session.", n.name = "SSH Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ShadowStack"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A shadow stack is a mechanism for protecting a procedure's stored return address, such as from a stack buffer overflow. The shadow stack itself is a second, separate stack that \"shadows\" the program call stack. In the function prologue, a function stores its return address to both the call stack and the shadow stack. In the function epilogue, a function loads the return address from both the call stack and the shadow stack, and then compares them. If the two records of the return address differ, then an attack is detected.", n.name = "Shadow Stack";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputingSnapshot"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer systems, a snapshot is the state of a system at a particular point in time.", n.name = "Computing Snapshot";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AuthenticationLog"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A log of authentication events.", n.name = "Authentication Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Database"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database is an organized collection of data, generally stored and accessed electronically from a computer system. Where databases are more complex they are often developed using formal design and modeling techniques.", n.name = "Database";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ComputingImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computing image captures the full state or contents of a computing entity, such as a process or volume.", n.name = "Computing Image";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemPasswordDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password database used by a system service or process to authenticate users (e.g., Security Account Manager)", n.name = "System Password Database";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ResourceAccess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ephemeral digital artifact comprising a request of a resource and any response from that resource.", n.name = "Resource Access";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DataDependency"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Data Dependency exists when a process, operation, or system requires specific data in order to execute correctly.", n.name = "Data Dependency";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read or retrieve data.", n.name = "OT Read Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Volume"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In the context of computer operating systems, a volume or logical drive is a single accessible storage area with a single file system, typically (though not necessarily) resident on a single partition of a hard disk. Although a volume might be different from a physical disk drive, it can still be accessed with an operating system's logical interface. However, a volume differs from a partition.", n.name = "Volume";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemApplicationCycleCount"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system variable that tracks the number of times the controller has completed its main program loop (scan cycle) since startup or last reset.", n.name = "System Application Cycle Count";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalInformationBearer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital information bearer is a physical or virtual entity that stores, transmits, or processes digital information.", n.name = "Digital Information Bearer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserAction"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An action performed by a user. Executing commands, granting permissions, and accessing resources are examples of user actions.", n.name = "User Action";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AddressSpace"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An address space defines a range of discrete addresses, each of which may correspond to a network host, peripheral device, disk sector, a memory cell or other logical or physical entity. For software programs to save and retrieve stored data, each unit of data must have an address where it can be located. The number of address spaces available depends on the underlying address structure, which is usually limited by the computer architecture being used.", n.name = "Address Space";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTWatchdogTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT Watchdog Timer is a software-based monitoring mechanism used in operational technology (OT) environments to continuously supervise the execution and responsiveness of critical control applications, devices, or communication links. It operates by requiring periodic \"heartbeat\" signals or status updates from monitored processes within a defined time window; if these signals are not received on time (indicating a hang, fault, or abnormal delay) the OT Watchdog Timer automatically triggers predefined safety or recovery actions, such as placing equipment in a fail-safe state, restarting services, generating alarms, or initiating controlled shutdowns.", n.name = "OT Watchdog Timer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTimeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read, set, or calculate timing mechanisms.", n.name = "OT Time Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TrustStore"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Stores public information necessary to determine if another party can be trusted.", n.name = "Trust Store";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntrusionDetectionSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An intrusion detection system (IDS) is a device or software application that monitors a network or systems for malicious activity or policy violations. Any intrusion activity or violation is typically reported either to an administrator or collected centrally using a security information and event management (SIEM) system. A SIEM system combines outputs from multiple sources and uses alarm filtering techniques to distinguish malicious activity from false alarms.", n.name = "Intrusion Detection System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SavedInstructionPointer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A saved instruction pointer points to the instruction that generated an exception (trap or fault).", n.name = "Saved Instruction Pointer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Domain Name System (DNS) record is a record of information returned to clients seeking to find computers, services, and other resources connected to the Internet or a private network.  Record information is stored on a domain name server so it can respond to DNS queries from clients.There are a variety of record types, depending on the client's information needs. Common types include Start of Authority, IP addresses, SMTP mail exchangers, name servers, reverse DNS lookup pointers, etc.", n.name = "DNS Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTAlarmMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Report danger, hazards, or serious errors.", n.name = "OT Alarm Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTWriteCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Write or store data.", n.name = "OT Write Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system (OS) is system software that manages computer hardware and software resources and provides common services for computer programs. All computer programs, excluding firmware, require an operating system to function. Time-sharing operating systems schedule tasks for efficient use of the system and may also include accounting software for cost allocation of processor time, mass storage, printing, and other resources.", n.name = "Operating System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#In-memoryPasswordStore"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password store held in memory.", n.name = "In-memory Password Store";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeleteControlProgramCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to remove an existing control program.", n.name = "OT Delete Control Program Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a file system or filesystem is used to control how data is stored and retrieved. Without a file system, information placed in a storage medium would be one large body of data with no way to tell where one piece of information stops and the next begins. By separating the data into pieces and giving each piece a name, the information is easily isolated and identified. Taking its name from the way paper-based information systems are named, each group of data is called a \"file\". The structure and logic rules used to manage the groups of information and their names is called a \"file system\".", n.name = "File System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CallStack"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, a call stack is a stack data structure that stores information about the active subroutines of a computer program. This kind of stack is also known as an execution stack, program stack, control stack, run-time stack, or machine stack, and is often shortened to just \"the stack\". Although maintenance of the call stack is important for the proper functioning of most software, the details are normally hidden and automatic in high-level programming languages. Many computer instruction sets provide special instructions for manipulating stacks.", n.name = "Call Stack";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceFirmwareCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Interact with the software responsible for low-level control of the system.", n.name = "OT Device Firmware Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTChangeControlProgramCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to modify an existing control program.", n.name = "OT Change Control Program Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A computer network which connects OT devices.", n.name = "OT Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#JavaScriptBlob"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A JavaScript Blob is a Blob that was created by a JavaScript Blob() constructor call or equivalent function.", n.name = "JavaScript Blob";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Network"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network is a group of computers that use a set of common communication protocols over digital interconnections for the purpose of sharing resources located on or provided by the network nodes. The interconnections between nodes are formed from a broad spectrum of telecommunication network technologies, based on physically wired, optical, and wireless radio-frequency methods that may be arranged in a variety of network topologies.", n.name = "Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network session is a temporary and interactive information interchange between two or more devices communicating over a network. A session is established at a certain point in time, and then 'torn down' - brought to an end - at some later point. An established communication session may involve more than one message in each direction. A session is typically stateful, meaning that at least one of the communicating parties needs to hold current state information and save information about the session history in order to be able to communicate, as opposed to stateless communication, where the communication consists of independent requests with responses. Network sessions may be established and implemented as part of protocols and services at the application, session, or transport layers of the OSI model.", n.name = "Network Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StackFrameCanary"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Stack canaries, named for their analogy to a canary in a coal mine, are used to detect a stack buffer overflow before execution of malicious code can occur. This method works by placing a small integer, the value of which is randomly chosen at program start, in memory just before the stack return pointer. Most buffer overflows overwrite memory from lower to higher memory addresses, so in order to overwrite the return pointer (and thus take control of the process) the canary value must also be overwritten. This value is checked to make sure it has not changed before a routine uses the return pointer on the stack. This technique can greatly increase the difficulty of exploiting a stack buffer overflow because it forces the attacker to gain control of the instruction pointer by some non-traditional means such as corrupting other important variables on the stack.", n.name = "Stack Frame Canary";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceManagementMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage devices and their configurations.", n.name = "OT Device Management Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardwareClockDeviceDriver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device driver for a hardware clock.", n.name = "Hardware Clock Device Driver";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceConfigurationCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Configure or administer managed devices.", n.name = "OT Device Configuration Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AccessMediator"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An Access Mediator enforces access control policies to regulate interactions with a resource.", n.name = "Access Mediator";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Thread"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Thread is the smallest unit of execution within a process, representing a sequence of instructions that can be scheduled and executed independently by the operating system.", n.name = "Thread";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileFooterBlock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A section at the end of a file that contains metadata or control information.", n.name = "File Footer Block";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingSystemClock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating system clock is the primary software clock maintained by the operating system, representing the system's current time. It is used for timestamping files, scheduling tasks, and synchronizing processes.", n.name = "Operating System Clock";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StackSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The stack segment contains the program stack, a last-in-first-out structure, typically allocated in the higher parts of memory for the process.", n.name = "Stack Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteLoginSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote login session is a login session where a client has logged in from their local host machine to a server via a network.", n.name = "Remote Login Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Enclave"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Network enclaves consist of standalone assets that do not interact with other information systems or networks. A major difference between a DMZ or demilitarized zone and a network enclave is a DMZ allows inbound and outbound traffic access, where firewall boundaries are traversed. In an enclave, firewall boundaries are not traversed. Enclave protection tools can be used to provide protection within specific security domains. These mechanisms are installed as part of an Intranet to connect networks that have similar security requirements.", n.name = "Enclave";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProprietaryMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Vendor specific and may not be publicly documented, or values left for device specific configuration.", n.name = "OT Proprietary Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An electronic communication system that links multiple components through one shared transmission medium, together with the interface hardware and link-layer signalling that govern access to that medium.", n.name = "Bus Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSecurityCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ensure confidentiality, integrity, or availability of system information.", n.name = "OT Security Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UnixHardLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Unix hard link is a hard link on a Unix file system.", n.name = "Unix Hard Link";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RDPSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Remote Desktop Protocol (RDP) session is a session established using the RDP protocol to access Remove Desktop Services (RDS).", n.name = "RDP Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHeaderBlock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Headers are sections of a file that organize and provide information about specific sections or components of the file. Typically found at the beginning of a file, they often contain file type identification, version information, and metadata such as size, format, and encoding.", n.name = "File Header Block";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemPlatformVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Runtime variables  which may consist of memory usage, internal temperature, operating mode, clock time, scan time, hardware status, etc.", n.name = "System Platform Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntrusionPreventionSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Intrusion prevention systems (IPS), also known as intrusion detection and prevention systems (IDPS), are network security appliances that monitor network or system activities for malicious activity. The main functions of intrusion prevention systems are to identify malicious activity, log information about this activity, report it and attempt to block or stop it.  Intrusion prevention systems are considered extensions of intrusion detection systems because they both monitor network traffic and/or system activities for malicious activity. The main differences are, unlike intrusion detection systems, intrusion prevention systems are placed in-line and are able to actively prevent or block intrusions that are detected. IPS can take such actions as sending an alarm, dropping detected malicious packets, resetting a connection or blocking traffic from the offending IP address. An IPS also can correct cyclic redundancy check (CRC) errors, defragment packet streams, mitigate TCP sequencing issues, and clean up unwanted transport and network layer options.", n.name = "Intrusion Prevention System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDownloadControlProgramCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to download a control program.", n.name = "OT Download Control Program Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemDependency"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system dependency indicates a system has an activity, agent, or another system which relies on it in order to be functional.", n.name = "System Dependency";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BootRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A d3f:Record which is an essential component of the early boot (system initialization) process.", n.name = "Boot Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WideAreaNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "By contrast to a local area network (LAN), a wide area network (WAN), not only covers a larger geographic distance, but also generally involves leased telecommunication circuits or Internet links.", n.name = "Wide Area Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTTransportConfigurationCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Configure transport settings for a communication channel.", n.name = "OT Transport Configuration Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OperatingMode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An operating mode designates the specific way a system, product, or service functions for a particular task, configuration, or phase of operation", n.name = "Operating Mode";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Log"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A record of events in the order of their occurrence.", n.name = "Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A single, implicitly structured data item in a table in a database.", n.name = "Database Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDiagnosticsMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Relay error, exception, alarm, or log information.", n.name = "OT Diagnostics Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Directory"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a directory is a file system cataloging structure which contains references to other computer files, and possibly other directories. On many computers, directories are known as folders, or drawers to provide some relevancy to a workbench or the traditional office file cabinet.", n.name = "Directory";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LoginSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a login session is the period of activity between a user logging in and logging out of a (multi-user) system. This includes local login sessions, where a user has direct physical access to a computer, as well as domain login sessions, where a user logs into a computer that is part of a network domain.", n.name = "Login Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ActivityDependency"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An activity dependency is a dependency that indicates an activity has an activity or agent which relies on it in order to be functional.", n.name = "Activity Dependency";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationScanTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A variable that tracks the measured time it takes to begin, run, and complete a select portion of an application's logic.", n.name = "Application Scan Time";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WindowsRegistry"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The Windows Registry is a hierarchical database that stores low-level settings for the Microsoft Windows operating system and for applications that opt to use the registry. The kernel, device drivers, services, Security Accounts Manager, and user interface can all use the registry. The registry also allows access to counters for profiling system performance.", n.name = "Windows Registry";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTStopCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to stop a service/program.", n.name = "OT Stop Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTAbortCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to abort a service/program.", n.name = "OT Abort Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSynchronizeTimeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Used to align timing mechanisms.", n.name = "OT Synchronize Time Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTScanTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An OT controller system variable that tracks the measured time it takes to read input status, apply logic, and write output values.", n.name = "OT Scan Time";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetDNSLookup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An Intranet Domain Name System (DNS) lookup is a DNS lookup made from a host on a network that is resolved after querying a DNS name server hosted on a that same network.", n.name = "Intranet DNS Lookup";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CodeRepository"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A code repository is a form of database where code, typically source code, is stored and managed.  In revision control systems, a repository is a data structure that stores metadata for a set of files or directory structure. Depending on whether the version control system in use is distributed like (Git or Mercurial) or centralized like (Subversion, CVS, or Perforce), the whole set of information in the repository may be duplicated on every user's system or may be maintained on a single server.", n.name = "Code Repository";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DifferentialVolumeSnapshot"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A differential volume snapshot is a point-in-time capture of the files and directories that were changed since the last full snapshot.", n.name = "Differential Volume Snapshot";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemConfigurationDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A database used to hold system configuration data.", n.name = "System Configuration Database";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTNetworkManagementCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Manage message routing or network connection mechanisms.", n.name = "OT Network Management Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VolumeBootRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A volume boot record (VBR) (also known as a volume boot sector, a partition boot record or a partition boot sector) is a type of boot sector introduced by the IBM Personal Computer. It may be found on a partitioned data storage device, such as a hard disk, or an unpartitioned device, such as a floppy disk, and contains machine code for bootstrapping programs (usually, but not necessarily, operating systems) stored in other parts of the device. On non-partitioned storage devices, it is the first sector of the device. On partitioned devices, it is the first sector of an individual partition on the device, with the first sector of the entire device being a Master Boot Record (MBR) containing the partition table.", n.name = "Volume Boot Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationFailureCountVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Variables that keep count of various failures and errors.", n.name = "Application Failure Count Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadDeviceConfigurationCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read device configuration.", n.name = "OT Read Device Configuration Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HardLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a hard link is a directory entry that associates a name with a file on a file system. All directory-based file systems must have at least one hard link giving the original name for each file. The term \"hard link\" is usually only used in file systems that allow more than one hard link for the same file. Multiple hard links -- that is, multiple directory entries to the same file -- are supported by POSIX-compliant and partially POSIX-compliant operating systems, such as Linux, Android, macOS, and also Windows NT4 and later Windows NT operating systems.", n.name = "Hard Link";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserBehavior"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user behavior is a pattern of user actions, or set of such patterns. Modeling and analyzing these patterns and monitoring a users actions for meaningful anomalies is known as user behavior analytics (UBA).", n.name = "User Behavior";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#EventLog"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Event logs record events taking place in the execution of a system in order to provide an audit trail that can be used to understand the activity of the system and to diagnose problems. They are essential to understand the activities of complex systems, particularly in the case of applications with little user interaction (such as server applications).", n.name = "Event Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwarePackage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Software Package is a bundled collection of files, code, and metadata that provides functionality, libraries, or applications.", n.name = "Software Package";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GraphicalUserInterface"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A graphical user interface (GUI)  is a type of user interface that allows users to interact with electronic devices through graphical icons and visual indicators such as secondary notation, instead of text-based user interfaces, typed command labels or text navigation. GUIs were introduced in reaction to the perceived steep learning curve of command-line interfaces (CLIs), which require commands to be typed on a computer keyboard.", n.name = "Graphical User Interface";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Dependency"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A dependency is the relationship of relying on or being controlled by someone or something else.  This class reifies dependencies that correspond to the object property depends-on.", n.name = "Dependency";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareClock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A clock implemented in software which may synchronize with hardware clocks or external time sources.", n.name = "Software Clock";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDebugCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Investigate or analyze the current state of the system.", n.name = "OT Debug Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DisplayDeviceDriver"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A device driver for a display adapter.", n.name = "Display Device Driver";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DecoyArtifact"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A decoy is an imitation digital artifact in any sense of a digital artifact, object, or phenomenon that is intended to deceive a cyber attacker's surveillance devices or mislead their evaluation.  Examples include fake files, accounts, hosts (honeypots), and network segments (honeynets).", n.name = "Decoy Artifact";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MacOSKeychain"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Keychain is the password management system in macOS, developed by Apple. It was introduced with Mac OS 8.6, and has been included in all subsequent versions of the operating system, now known as macOS. A Keychain can contain various types of data: passwords (for websites, FTP servers, SSH accounts, network shares, wireless networks, groupware applications, encrypted disk images), private keys, certificates, and secure notes.", n.name = "MacOS Keychain";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DNSLookup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Domain Name System (DNS) lookup is a record returned from a DNS resolver after querying a DNS name server.  Typically considered an A or AAAA record, where a domain name is resolved to an IPv4 or IPv6 address, respectively.", n.name = "DNS Lookup";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemUtilizationRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system utilization record is a record for the tracking of resource utilization e.g. CPU, Disk, Network, Memory Bandwidth, GPU, or other resources for a given time period.", n.name = "System Utilization Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProgramModeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command that places the controller in a mode capable of reprogramming logic. This may or may not stop the program.", n.name = "OT Program Mode Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#WebResourceAccess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ephemeral digital artifact comprising a request of a network resource and any response from that network resource using a standard web protocol.", n.name = "Web Resource Access";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkPacket"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network packet is a formatted unit of data carried by a packet-switched network. Computer communications links that do not support packets, such as traditional point-to-point telecommunications links, simply transmit data as a bit stream. When data is formatted into packets, packet switching is possible and the bandwidth of the communication medium can be better shared among users than with circuit switching.", n.name = "Network Packet";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceIdentificationMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Identify devices on the network.", n.name = "OT Device Identification Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InternetNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A network of multiple, connected networks. Internetworking is the practice of connecting a computer network with other networks through the use of gateways that provide a common method of routing information packets between the networks. The resulting system of interconnected networks are called an internetwork, or simply an internet. Internetworking is a combination of the words inter (\"between\") and networking; not internet-working or international-network.", n.name = "Internet Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImageSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Image segments are distinct partitions of an object file.  Both data and code segments are examples of image segments.", n.name = "Image Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Real-timeOperatingSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A real-time operating system (RTOS) is an operating system (OS) for real-time computing applications that processes data and events that have critically defined time constraints.", n.name = "Real-time operating system";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTConnectionCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Establish a network connection with a device.", n.name = "OT Connection Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTSetTimeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Set timing mechanisms.", n.name = "OT Set Time Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDeviceDescriptionMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Describe features, abilities, or performance of system components.", n.name = "OT Device Description Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BinaryLargeObject"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A binary large object (BLOB) is a collection of binary data stored as a single entity. Blobs are typically images, audio or other multimedia objects, though sometimes binary executable code is stored as a blob.", n.name = "Binary Large Object";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTCreateNewControlProgramCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a remote device to create an control program.", n.name = "OT Create New Control Program Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CommandLineInterface"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A command-line interface or command language interpreter (CLI), also known as command-line user interface, console user interface, and character user interface (CUI), is a means of interacting with a computer program where the user (or client) issues commands to the program in the form of successive lines of text (command lines). Command-line interfaces to computer operating systems are less widely used by casual computer users, who favor graphical user interfaces. Programs with command-line interfaces are generally easier to automate via scripting.", n.name = "Command Line Interface";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadValueCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads the contents of the specified number of consecutive parameter areawords starting from the specified word.", n.name = "OT Read Value Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BlockDevice"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A block device (or block special file) provides buffered access to hardware devices, and provides some abstraction from their specifics.  IEEE Std 1003.1-2017: A file that refers to a device. A block special file is normally distinguished from a character special file by providing access to the device in a manner such that the hardware characteristics of the device are not visible.", n.name = "Block Device";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTLogicVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A variable which directly affects a program running on an OT controller, involving an OT Process.", n.name = "OT Logic Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusNetworkTraffic"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The ordered flow of frames, structured by a bus protocol, that traverses the shared bus medium during operation.", n.name = "Bus Network Traffic";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTRunCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Commands a device to start or resume a service/program.", n.name = "OT Run Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserProfile"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user profile is a collection of settings and information associated with a user. It contains critical information that is used to identify an individual, such as their name, age, portrait photograph and individual characteristics such as knowledge or expertise.", n.name = "User Profile";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A discrete unit of digital communication created by a sender for one or more intended recipients. Encoded in an application-layer format, a digital message conveys semantics such as commands, data, or status and is transported inside lower-layer containers like network frames or packets.", n.name = "Digital Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ResourceFork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The resource fork is a fork or section of a file on Apple's classic Mac OS operating system, which was also carried over to the modern macOS for compatibility, used to store structured data along with the unstructured data stored within the data fork.", n.name = "Resource Fork";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareTimer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A timer implemented in software, typically managed by the operating system or application code. Software timers rely on underlying hardware timers or clocks to measure intervals and trigger actions. They are used for scheduling tasks, implementing timeouts, and managing periodic operations within software environments.", n.name = "Software Timer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordStore"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A user repository of account passwords, often accessed via a password manager.", n.name = "Password Store";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VolumeSnapshot"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A volume snapshot is a point-in-time copy of a storage volume.", n.name = "Volume Snapshot";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FullVolumeSnapshot"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A full volume snapshot is a point-in-time copy of the complete contents of a volume.", n.name = "Full Volume Snapshot";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BinarySegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A binary segment is a partition of binary information within a larger binary object, which arranges a set of binary objects for its purpose.   For example, code, data, heap, and stack segments are segments of the binary information used by a process.  Code and data segments are also found in object files.", n.name = "Binary Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#KernelProcessTable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A data structure in the kernel which is a table containing all of the information that must be saved when the CPU switches from running one process to another in a multitasking system. It allows the operating system to track all the process's execution status, and contains the For every process managed by the kernel, there is a process control block (PCB) in the process table.", n.name = "Kernel Process Table";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DisplayServer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A display server or window server is a program whose primary task is to coordinate the input and output of its clients to and from the rest of the operating system, the hardware, and each other. The display server communicates with its clients over the display server protocol, a communications protocol, which can be network-transparent or simply network-capable. The display server is a key component in any graphical user interface, specifically the windowing system.", n.name = "Display Server";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadTimeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Read timing mechanisms.", n.name = "OT Read Time Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSystemLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file system link associates a name with a file on a file system.  Most generally, this may be a direct reference (a hard link) or an indirect one (a soft link).", n.name = "File System Link";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTModifyControlProgramCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that adds, removes, or changes, process data on a remote device.", n.name = "OT Modify Control Program Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTErrorMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An anticipated, reproducible defect occurred within the system.", n.name = "OT Error Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalEventRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital event record is a structured representation of a digital event, encapsulating all relevant details about the occurrence for storage, analysis, and response. These records serve as the primary artifacts for cybersecurity operations, enabling threat detection, forensic investigations, and compliance reporting. Digital event records include metadata such as timestamps, origin, context, and associated resources, ensuring traceability and actionable intelligence in digital ecosystems.", n.name = "Digital Event Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTChangeDataCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "OT command that modifies existing data on a remote device.", n.name = "OT Change Data Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Record"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, a record (also called struct or compound data) is a basic data structure. A record is a collection of fields, possibly of different data types, typically in fixed number and sequence . The fields of a record may also be called members, particularly in object-oriented programming. Fields may also be called elements, though these risk confusion with the elements of a collection. A tuple may or may not be considered a record, and vice versa, depending on conventions and the specific programming language.", n.name = "Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserInterface"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The user interface (UI), in the industrial design field of human-machine interaction, is the space where interactions between humans and machines occur. The goal of this interaction is to allow effective operation and control of the machine from the human end, whilst the machine simultaneously feeds back information that aids the operators' decision-making process. Examples of this broad concept of user interfaces include the interactive aspects of computer operating systems, hand tools, heavy machinery operator controls, and process controls. The design considerations applicable when creating user interfaces are related to or involve such disciplines as ergonomics and psychology.", n.name = "User Interface";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ApplicationRuntimeVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A system variable that tracks aspects of runtime of a system.", n.name = "Application Runtime Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UserToUserMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Personal message, private message (PM), direct message (DM), or personal chat (PC) is a private form of messaging between different members on a given platform. It is only seen and accessible by the users participating in the message.", n.name = "User to User Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NamedPipe"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a named pipe (also known as a FIFO for its behavior) is an extension to the traditional pipe concept on Unix and Unix-like systems, and is one of the methods of inter-process communication (IPC). The concept is also found in OS/2 and Microsoft Windows, although the semantics differ substantially. A traditional pipe is 'unnamed' and lasts only as long as the process. A named pipe, however, can last as long as the system is up, beyond the life of the process. It can be deleted if no longer used. Usually a named pipe appears as a file, and generally processes attach to it for IPC.", n.name = "Named Pipe";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IntranetNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An intranet is a private network accessible only to an organization's staff or delegates. Generally a wide range of information and services from the organization's internal IT systems are available that would not be available to the public from the Internet. A company-wide intranet can constitute an important focal point of internal communication and collaboration, and provide a single starting point to access internal and external resources. In its simplest form an intranet is established with the technologies for local area networks (LANs) and wide area networks (WANs).", n.name = "Intranet Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#UnixLink"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Unix link is a file link in a Unix file system.", n.name = "Unix Link";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StorageSnapshot"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A storage snapshot is a copy of a storage medium or system environment at a point in time.", n.name = "Storage Snapshot";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTReadFileCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Reads data in specified chuncks or the contents of a specified file stored in the file device connected to the PC.", n.name = "OT Read File Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LegacySystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a legacy system is an old method, technology, computer system, or application program, \"of, relating to, or being a previous or outdated computer system,\" yet still in use. Often referencing a system as \"legacy\" means that it paved the way for the standards that would follow it. This can also imply that the system is out of date or in need of replacement.", n.name = "Legacy System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProtocolMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Packets generated by an operational technology protocol contain an OT protocol message.", n.name = "OT Protocol Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SystemTime"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, system time represents a computer system's notion of a point in time.", n.name = "System Time";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command and control the managed process.", n.name = "OT Control Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImageCodeSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An image code segment, also known as a text segment or simply as text, is a portion of an object file that contains executable instructions. The term \"segment\" comes from the memory segment, which is a historical approach to memory management that has been succeeded by paging. When a program is stored in an object file, the code segment is a part of this file; when the loader places a program into memory so that it may be executed, various memory regions are allocated (in particular, as pages), corresponding to both the segments in the object files and to segments only needed at run time. For example, the code segment of an object file is loaded into a corresponding code segment in memory.", n.name = "Image Code Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalAreaNetwork"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A local area network (LAN) is a computer network that interconnects computers within a limited area such as a residence, school, laboratory, university campus or office building and has its network equipment and interconnects locally managed. Ethernet and Wi-Fi are the two most common transmission technologies in use for local area networks. Historical technologies include ARCNET, Token ring, and AppleTalk.", n.name = "Local Area Network";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#LocalResourceAccess"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Ephemeral digital artifact comprising a request of a local resource and any response from that resource.", n.name = "Local Resource Access";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSection"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A file section is one of the portions of a file in which the file is regarded as divided and where together the file sections constitute the whole file.", n.name = "File Section";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControlVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A control variable is the measurement of the physical condition of the device that influences the Process Variables.", n.name = "OT Control Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalSystem"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital system is a group of interacting or interrelated digital artifacts that act according to a set of rules to form a unified whole. A digital system, surrounded and influenced by its environment, is described by its boundaries, structure and purpose and expressed in its functioning. Systems are the subjects of study of systems theory.", n.name = "Digital System";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PasswordDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A password database is a database that holds passwords for user accounts and is usually encrypted (i.e.., the passwords are hashed). Password databases are found supporting system services (such as SAM) or part of user applications such as password managers.", n.name = "Password Database";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StackFrame"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A machine-dependent and application-binary-dependent (ABI-dependent) data structure containing subroutine state information including the arguments passed into the routine, the return address back to the routine's caller, and space for local variables of the routine.", n.name = "Stack Frame";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ImageDataSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An image data segment (often denoted .data) is a portion of an object file that contains initialized static variables, that is, global variables and static local variables. The size of this segment is determined by the size of the values in the program's source code, and does not change at run time. This segmenting of the memory space into discrete blocks with specific tasks carried over into the programming languages of the day and the concept is still widely in use within modern programming languages.", n.name = "Image Data Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkFrame"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A finite, self-delimited sequence of bits exchanged as one unit over a single data link. Formed by link-layer encapsulation, a frame typically begins with synchronization and control fields, carries a payload, ends with an integrity check, and is bounded from adjacent frames by explicit timing or delimiter symbols.", n.name = "Network Frame";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessCodeSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process code segment, also known as a text segment or simply as text, is a portion of the program's virtual address space that contains executable instructions and corresponds to the loaded image code segment. Includes additional sections such as an import table.", n.name = "Process Code Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessDataSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process data segment, is a portion of the program's virtual address space that contains executable instructions and corresponds to the loaded image data segment.", n.name = "Process Data Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CertificateTrustStore"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A certificate truststore is used to store public certificates used to authenticate clients by the server for an SSL connection.", n.name = "Certificate Trust Store";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AnonymousPipe"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, an anonymous pipe is a simplex FIFO communication channel that may be used for one-way interprocess communication (IPC). An implementation is often integrated into the operating system's file IO subsystem. Typically a parent program opens anonymous pipes, and creates a new process that inherits the other ends of the pipes, or creates several new processes and arranges them in a pipeline.", n.name = "Anonymous Pipe";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTControllerOperatingMode"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The OT controller operating mode designates the specific, selectable state of an OT controller that delineates its operational behavior and governs access to engineering functions, commonly including Program, Run, Remote, Test, or Stop.", n.name = "OT Controller Operating Mode";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceDependency"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A service dependency indicates a service has an activity, agent, or another service which relies on it in order to be functional.", n.name = "Service Dependency";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Pipe"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In Unix-like computer operating systems, a pipeline is a mechanism for inter-process communication using message passing.  In the strictest sense, a pipe is a single segment of a pipeline, allowing one process to pass information forward to another.  Network pipes allow processes on different hosts to interact.", n.name = "Pipe";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#GNSSTimeRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A GNSS Time Record is an information content entity encoded in a GNSS signal that represents the transmission time of that signal as determined by the transmitting satellite, expressed relative to a constellation-specific time standard and epoch.", n.name = "GNSS Time Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#InternetDNSLookup"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An internet Domain Name System (DNS) lookup is a DNS lookup made from a host on a network that is resolved after querying a DNS name server hosted on a different network.", n.name = "Internet DNS Lookup";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SoftwareRepository"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A software repository, or repo for short, is a storage location for software packages. Often a table of contents is also stored, along with metadata. A software repository is typically managed by source or version control, or repository managers. Package managers allow automatically installing and updating repositories, sometimes called 'packages'.", n.name = "Software Repository";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteTerminalSession"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote terminal session is a session that provides a user access from one host to another host via a terminal.", n.name = "Remote Terminal Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTExceptionMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An unknown or anomalous condition occurred in the system.", n.name = "OT Exception Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VirtualMemorySpace"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Virtual memory is a memory management technique where secondary memory can be used as if it were a part of the main memory. Virtual memory uses hardware and software to enable a computer to compensate for physical memory shortages", n.name = "Virtual Memory Space";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Certificate"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In cryptography, a public key certificate, also known as a digital certificate or identity certificate, is an electronic document used to prove the ownership of a public key. The certificate includes information about the key, information about the identity of its owner (called the subject), and the digital signature of an entity that has verified the certificate's contents (called the issuer). If the signature is valid, and the software examining the certificate trusts the issuer, then it can use that key to communicate securely with the certificate's subject. In email encryption, code signing, and e-signature systems, a certificate's subject is typically a person or organization. However, in Transport Layer Security (TLS) a certificate's subject is typically a computer or other device.", n.name = "Certificate";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimeRecord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A time record either records, describes, represents, or is generally about Time.", n.name = "Time Record";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ProcessImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A process image is a copy of a given process's state at a given point in time. It is often used to create persistence within an otherwise volatile system.", n.name = "Process Image";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTDisconnectRemoteConnectionCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The Disconnect Request message is sent to the message receiver to indicate that the transmitter is terminating its TCP socket.", n.name = "OT Disconnect Remote Connection Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#StackComponent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A stack component is any component of a call stack used for stack-based memory allocation in a running process.  Examples include saved instruction pointers, stack frames, and stack frame canaries.", n.name = "Stack Component";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTProcessVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Process variables are the current actual measurement of the physical characteristics of a system. Common process variables include but are not limited to Temperature, Pressure, Level, and Flow.", n.name = "OT Process Variable";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BusMessage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital message potentially containing commands, telemetry, or status signals, encoded in a bus protocol and conveyed over a bus within one or more frames.", n.name = "Bus Message";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PacketLog"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A log of all the network packet data captured from a network by a network sensor (i.e., packet analyzer),", n.name = "Packet Log";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Timer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A timer or countdown timer is a type of clock that starts from a specified time duration and stops upon reaching 00:00. It can also usually be stopped manually before the whole duration has elapsed. An example of a simple timer is an hourglass. Commonly, a timer triggers an alarm when it ends. A timer can be implemented through hardware or software.", n.name = "Timer";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#OTRemoteModeCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Command that places the controller in a mode capable of receiving read/write communication from a networked entity.", n.name = "OT Remote Mode Command";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#HeapSegment"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The heap segment (or free store) is a large pool of memory from which dynamic memory requests of a process are allocated and satisfied.", n.name = "Heap Segment";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#TimeSeriesDatabase"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A specialized database optimized for storing and retrieving time-stamped data.", n.name = "Time Series Database";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Session"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, in particular networking, a session is a semi-permanent interactive information interchange, also known as a dialogue, a conversation or a meeting, between two or more communicating devices, or between a computer and user (see Login session). A session is set up or established at a certain point in time, and then torn down at some later point. An established communication session may involve more than one message in each direction. A session is typically, but not always, stateful, meaning that at least one of the communicating parts needs to save information about the session history in order to be able to communicate, as opposed to stateless communication, where the communication consists of independent requests with responses.", n.name = "Session";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Clipboard"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The clipboard is a buffer that some operating systems provide for short-term storage and transfer within and between application programs. The clipboard is usually temporary and unnamed, and its contents reside in the computer's RAM. The clipboard is sometimes called the paste buffer. Windows, Linux and macOS support a single clipboard transaction. Each cut or copy overwrites the previous contents. Normally, paste operations copy the contents, leaving the contents available in the clipboard for further pasting.", n.name = "Clipboard";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PartitionTable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A partition is a fixed-size subset of a storage device which is treated as a unit by the operating system. A partition table is a table maintained on the storage device by the operating system describing the partitions on that device. The terms partition table and partition map are most commonly associated with the MBR partition table of a Master Boot Record (MBR) in IBM PC compatibles, but it may be used generically to refer to other \"formats\" that divide a disk drive into partitions, such as: GUID Partition Table (GPT), Apple partition map (APM), or BSD disklabel.", n.name = "Partition Table";

MERGE (n:MitreDefendDigitalInformationBearerEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RuntimeVariable"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A runtime variable is an abstract storage location paired with an associated symbolic name, which contains some known or unknown quantity of data or object referred to as a value, which can change during the execution of a computer program.", n.name = "Runtime Variable";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileFooterBlockSignature"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A sequence of bytes used to identify and validate the footer section within a file.", n.name = "File Footer Block Signature";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PrivateKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A private key can be used to decrypt messages encrypted using the corresponding public key, or used to sign a message that can be authenticated with the corresponding public key.", n.name = "Private Key";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryAddress"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing, a memory address is a reference to a specific memory location used at various levels by software and hardware.", n.name = "Memory Address";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalText"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital text is written content encoded in a digital format, allowing for storage, retrieval, and manipulation by electronic devices.", n.name = "Digital Text";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Hostname"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer networking, a hostname (archaically nodename) is a label that is assigned to a device connected to a computer network and that is used to identify the device in various forms of electronic communication, such as the World Wide Web. Hostnames may be simple names consisting of a single word or phrase, or they may be structured.", n.name = "Hostname";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MACAddress"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A media access control address (MAC address) is a unique identifier assigned to a network interface controller (NIC) for use as a network address in communications within a network segment.", n.name = "MAC Address";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalFingerprint"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital signature uniquely identifies data and has the property that changing a single bit in the data will cause a completely different message digest to be generated.", n.name = "Digital Fingerprint";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Command"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A directive (i.e., an instruction specifying a procedure) which, when issued to a computer system, software, or hardware component, causes that entity to execute a specific action, operation, or computation.", n.name = "Command";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMetadata"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Information that describes and provides context about a file's content, structure, and attributes.", n.name = "File Metadata";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A digital image is a pixel-based visual representation stored in formats like JPEG or PNG, used for various digital applications.", n.name = "Digital Image";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Metadata"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Metadata is information which describes aspects of other information.", n.name = "Metadata";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote command is an instruction or set of instructions issued from a geographically or logically distant location to control, configure, or elicit a response from a target system, device, or entity. The execution of a remote command does not require direct physical interaction with the target; instead, it relies on a communication link to transmit the instruction and receive any resulting feedback or data.", n.name = "Remote Command";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#NetworkFlow"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A summarization of network transactions between a client and server. It often summarizes bytes sent, bytes received, and protocol flags.", n.name = "Network Flow";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#BitmapImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A graphical image whose data is stored in a grid format.", n.name = "Bitmap Image";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainName"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A domain name is an identification string that defines a realm of administrative autonomy, authority or control within the Internet. Domain names are formed by the rules and procedures of the Domain Name System (DNS). Any name registered in the DNS is a domain name.Domain names are used in various networking contexts and application-specific naming and addressing purposes. In general, a domain name represents an Internet Protocol (IP) resource, such as a personal computer used to access the Internet, a server computer hosting a web site, or the web site itself or any other service communicated via the Internet. In 2015, 294 million domain names had been registered.", n.name = "Domain Name";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalInformation"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital information is a broad category of encoded representations in digital form that convey meaning, instructions, or functionality.", n.name = "Digital Information";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PageFrame"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A page frame is the smallest fixed-length contiguous block of physical memory into which memory pages are mapped by the operating system.", n.name = "Page Frame";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#CryptographicKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In cryptography, a key is a piece of information (a parameter) that determines the functional output of a cryptographic algorithm. For encryption algorithms, a key specifies the transformation of plaintext into ciphertext, and vice versa for decryption algorithms. Keys also specify transformations in other cryptographic algorithms, such as digital signature schemes and message authentication codes.", n.name = "Cryptographic Key";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PublicKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A public key can be disseminated widely as part of an asymmetric cryptography framework and be used to encrypt messages to send to the public key's owner or to authenticate signed messages from that sender.", n.name = "Public Key";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalDocument"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An digital document is any electronic media content (other than computer programs or system files) that is intended to be used in either an electronic form or as printed output.", n.name = "Digital Document";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Identifier"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An identifier is a name that identifies (that is, labels the identity of) either a unique object or a unique class of objects, where the \"object\" or class may be an idea, physical [countable] object (or class thereof), or physical [noncountable] substance (or class thereof). The abbreviation ID often refers to identity, identification (the process of identifying), or an identifier (that is, an instance of identification). An identifier may be a word, number, letter, symbol, or any combination of those.", n.name = "Identifier";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalAudioVisualMedia"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Audiovisual (AV) is electronic media possessing both a sound and a visual component.", n.name = "Digital Audio Visual Media";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHeaderBlockSignature"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A sequence of bytes used to identify and validate specific header sections within a file.", n.name = "File Header Block Signature";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Pointer"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computer science, a pointer is a programming language object, whose value refers to (or \"points to\") another value stored elsewhere in the computer memory using its memory address. A pointer references a location in memory, and obtaining the value stored at that location is known as dereferencing the pointer. As an analogy, a page number in a book's index could be considered a pointer to the corresponding page; dereferencing such a pointer would be done by flipping to the page with the given page number.", n.name = "Pointer";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteProcedureCall"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In distributed computing a remote procedure call (RPC) is when a computer program causes a procedure (subroutine) to execute in another address space (commonly on another computer on a shared network), which is coded as if it were a normal (local) procedure call, without the programmer explicitly coding the details for the remote interaction. That is, the programmer writes essentially the same code whether the subroutine is local to the executing program, or remote. This is a form of client-server interaction (caller is client, executor is server), typically implemented via a request-response message-passing system. The object-oriented programming analog is remote method invocation (RMI). The RPC model implies a level of location transparency.", n.name = "Remote Procedure Call";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ControlFlowPolicy"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A control flow policy is a subset of the possible control flow transfers computed from a program's control flow graph. It defines only the expected and allowed control flow transfers and is enforced by control flow integrity.", n.name = "Control Flow Policy";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileSystemMetadata"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Metadata about the files and directories in a file system.  For example file name, file length, time modified, group and user ids, and other file attributes.", n.name = "File System Metadata";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VirtualAddress"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A virtual address in memory is a pointer or marker for a memory space that an operating system allows a process to use. The virtual address points to a location in primary storage that a process can use independently of other processes.", n.name = "Virtual Address";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#IPAddress"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An Internet Protocol address (IP address) is a numerical label assigned to each device connected to a computer network that uses the Internet Protocol for communication.An IP address serves two main functions: host or network interface identification and location addressing. Internet Protocol version 4 (IPv4) defines an IP address as a 32-bit number. However, because of the growth of the Internet and the depletion of available IPv4 addresses, a new version of IP (IPv6), using 128 bits for the IP address, was standardized in 1998. IPv6 deployment has been ongoing since the mid-2000s.", n.name = "IP Address";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalMedia"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital media refers to any communication media that operate in conjunction with various encoded machine-readable data formats.", n.name = "Digital Media";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileFooterBlockContent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The content of a footer block not including the signature.", n.name = "File Footer Block Content";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalIdentity"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The unique representation of a subject engaged in an online transaction. A digital identity is always unique in the context of a digital service, but does not necessarily need to uniquely identify the subject in all contexts. In other words, accessing a digital service may not mean that the subject's real-life identity is known.  Note: There is no single, widely accepted definition for this term and context is important. This definition is specific to online transactions.", n.name = "Digital Identity";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalAudio"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital audio is a representation of sound recorded in, or converted into, digital form.", n.name = "Digital Audio";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PhysicalAddress"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In a computer supporting virtual memory, the term physical address is used mostly to differentiate from a virtual address. In particular, in computers utilizing a memory management unit(MMU) to translate memory addresses, the virtual and physical addresses refer to an address before and after translation performed by the MMU, respectively.", n.name = "Physical Address";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryExtent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A memory extent is a defined, contiguous region of memory within a computing system, characterized by its size, location, and purpose. It represents an abstraction of physical or virtual memory used for storing data, instructions, or other computational artifacts.", n.name = "Memory Extent";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHash"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A File Hash is a fixed-length, unique digital fingerprint generated by applying a cryptographic hash function to the contents of a file.", n.name = "File Hash";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ShellCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A shell command is a directive to some kind of command-line interface, such as a shell.", n.name = "Shell Command";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#PackageURL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A package URL, or purl, is a URL used to identify a software package in a mostly universal and uniform way across programming languages, package managers, packaging conventions, tools, APIs and databases.", n.name = "Package URL";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Page"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A page, memory page, logical page, or virtual page is a fixed-length contiguous block of virtual memory, described by a single entry in the page table. It is the smallest unit of data for memory management in a virtual memory operating system.", n.name = "Page";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteShellCommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote shell command is a command sent from one computer to another to be executed on the remote computer.  One example of this, is through a command-line interface (CLI) like using Invoke-Command from PowerShell or a command sent through an ssh session. This class generalizes to all means of sending a command through an established protocol to control capabilities on a remote computer.", n.name = "Remote Shell Command";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#URL"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A Uniform Resource Locator (URL), commonly informally termed a web address (a term which is not defined identically) is a reference to a web resource that specifies its location on a computer network and a mechanism for retrieving it.A URL is a specific type of Uniform Resource Identifier (URI), although many people use the two terms interchangeably. A URL implies the means to access an indicated resource, which is not true of every URI. URLs occur most commonly to reference web pages (http), but are also used for file transfer (ftp), email (mailto), database access (JDBC), and many other applications.", n.name = "URL";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DomainRegistration"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A domain registration, or domain name registration data, is the relevant registration data from Internet resources such as domain names, IP addresses, and autonomous system numbers. Registration data is typically retrieved by means of either the Registration Data Access Protocol (RDAP) or its predecessor, the WHOIS protocol.", n.name = "Domain Registration";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryPool"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Memory pools, also called fixed-size blocks allocation, is the use of pools for memory management... preallocating a number of memory blocks with the same size called the memory pool. The application can allocate, access, and free blocks represented by handles at run time.", n.name = "Memory Pool";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryWord"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A memory word is the natural unit of data used by a particular computer processor design; a fixed-size piece of data handled as a unit by the instruction set or the hardware of the processor.", n.name = "Memory Word";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileHeaderBlockContent"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The content of a header block not including the signature.", n.name = "File Header Block Content";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#AsymmetricKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Asymmetric keys are public and private keys, paired such that asymmetric (public-key) cryptography algorithms can be implemented using them. Public-key cryptography, or asymmetric cryptography, is any cryptographic system that uses pairs of keys: public keys that may be disseminated widely paired with private keys which are known only to the owner. There are two functions that can be achieved: using a public key to authenticate that a message originated with a holder of the paired private key; or encrypting a message with a public key to ensure that only the holder of the paired private key can decrypt it.", n.name = "Asymmetric Key";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#SymmetricKey"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A symmetric key is a single key used for both encryption and decryption and used with a symmetric-key algorithm. Symmetric-key algorithms are algorithms for cryptography that use the same cryptographic keys for both encryption of plaintext and decryption of ciphertext. The keys may be identical or there may be a simple transformation to go between the two keys. The keys, in practice, represent a shared secret between two or more parties that can be used to maintain a private information link. This requirement that both parties have access to the secret key is one of the main drawbacks of symmetric key encryption, in comparison to public-key encrytption (also known as asymmetric key encryption).", n.name = "Symmetric Key";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#MemoryBlock"})
ON CREATE SET n.id = randomUUID()
SET n.description = "In computing (specifically data transmission and data storage), a block, sometimes called a physical record, is a sequence of bytes or bits, usually containing some whole number of records, having a maximum length; a block size. Data thus structured are said to be blocked. The process of putting data into blocks is called blocking, while deblocking is the process of extracting data from blocks. Blocked data is normally stored in a data buffer and read or written a whole block at a time.", n.name = "Memory Block";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalMultimedia"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital Multimedia refers to content that combines text, audio, images, animations, and video in a digital format for interactive applications.", n.name = "Digital Multimedia";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#RemoteDatabaseQuery"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A remote query session enabling a user to make an SQL, SPARQL, or similar query over the network from one host to another.", n.name = "Remote Database Query";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentBlockData"})
ON CREATE SET n.id = randomUUID()
SET n.description = "The actual content or main data within a file or data block.", n.name = "File Content Block Data";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileMagicBytes"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A specific type of header signature located at the beginning of a file, used to identify the file format.", n.name = "File Magic Bytes";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#JobSchedule"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A job schedule contains specification of tasks to be executed at particular times or time intervals.  The schedule is a plan that enacted by a task scheduling process. In Windows, the schedule can be accessed at 'C:\\Windows\\System32\\Tasks' or in the registry. In Linux, the schedule is located at '/etc/crontab'", n.name = "Job Schedule";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#Telecommand"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A telecommand or telecontrol is a command sent to control a remote system or systems not directly connected (e.g. via wires) to the place from which the telecommand is sent.", n.name = "Telecommand";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#FileContentBlockMetadata"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Content Blocks may contain metadata specific to the block's content at the beginning.", n.name = "File Content Block Metadata";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#ControlFlowGraph"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A control flow graph is a representation of all possible control flow transfers within a program, typically computed at compile-time or link-time, including calls, jumps, and returns. The control flow graph can be used to compute a control flow policy that permits only the expected control flow transfers during process execution via control flow integrity mechanisms.", n.name = "Control Flow Graph";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalVideo"})
ON CREATE SET n.id = randomUUID()
SET n.description = "Digital video is an electronic representation of moving visual images (video) in the form of encoded digital data.", n.name = "Digital Video";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DatabaseQuery"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A specific query expressed in SQL, SPARQL, or similar language against a database.", n.name = "Database Query";

MERGE (n:MitreDefendDigitalInformationEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#VectorImage"})
ON CREATE SET n.id = randomUUID()
SET n.description = "A graphical image created using mathematical equations and geometric shapes defined by vectors.", n.name = "Vector Image";

MERGE (n:MitreDefendDigitalArtifactEntity {uri: "http://d3fend.mitre.org/ontologies/d3fend.owl#DigitalArtifact"})
ON CREATE SET n.id = randomUUID()
SET n.description = "An information-bearing artifact (object) that is, or is encoded to be used with, a digital computer system. This concept is broad to include the literal instances of an artifact, or an implicit summarization of changes to or properties of other artifacts.", n.name = "Digital Artifact";

