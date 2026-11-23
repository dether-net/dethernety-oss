# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Dethernety, please report it responsibly.

**Open-source components** (everything in this repository): report through **GitHub Security Advisories**:

1. Go to the [Security Advisories page](https://github.com/dether-net/dethernety-oss/security/advisories/new)
2. Click "New draft security advisory"
3. Fill in the details of the vulnerability

**The BYODt cloud service and the paid modules**, or if you cannot use GitHub: email **security@dether.net**.

**Do not open public issues for security vulnerabilities.**

## Response Timeline

- **Acknowledgment**: Within 48 hours of your report
- **Initial assessment**: Within 5 business days
- **Critical fixes**: Target resolution within 7 days
- **High fixes**: In the next release, and no later than 30 days
- **Medium and low fixes**: Included in the next scheduled release

## Scope

The following open-source components are in scope (report through GitHub Security Advisories):

- **dt-ws** (backend) — GraphQL API, authentication, authorization, database queries
- **dt-ui** (frontend) — XSS, CSRF, authentication bypass, sensitive data exposure
- **dt-core** — Data access layer, input validation
- **dt-module** — Module loading, the module allow-list, code execution
- **Open-source modules** — The modules published as signed release assets (`dethernety-general`, `dethernety-coverage-tools`, `dethernety-threat-report`, `dethernety-hidden-edges`), their signatures and the signed module index
- **BYODt deployment** — The deployment bundle and its control script: secret generation and handling, exposure defaults, the mode layer written by the console
- **Installer** — `get-byodt.sh`: download, SHA-256 and signature verification, unpack
- **byodt-console** — The operator console: session handling, the module fetch/verify/extract path, and the shared Go packages under `pkg/`
- **Dethereal** — The Claude Code plugin and its MCP server (`apps/dethereal`)
- **Docker images** — Container security, exposed ports, privilege escalation
- **Dependencies** — Vulnerabilities in direct dependencies

The following hosted services are in scope (report to **security@dether.net**):

- **BYODt cloud service** — Sign-in, the subscription and the BYODt Portal (customer portal), the content service that deployments fetch content and paid modules from, and the dether.net website
- **Paid modules** — Risk Assessment, Data Protection and Threat Patterns, as delivered through the BYODt cloud service

The following are out of scope:

- Vulnerabilities in third-party services (Neo4j, Memgraph, OIDC providers)
- Social engineering attacks
- Denial of service attacks against local development environments
- Issues in forks or unofficial distributions
- Findings that require an already-compromised host or operator machine

## Security Best Practices

When deploying Dethernety in production:

- Use encrypted database connections (`NEO4J_ENCRYPTED=true`)
- Configure OIDC authentication with a trusted provider
- Set `ALLOWED_ORIGINS` to your specific domains
- Disable module hot reload (`ENABLE_MODULE_HOT_RELOAD=false`)
- Explicitly list allowed modules in `ALLOWED_MODULES`
- Keep dependencies updated
- Review the [Configuration Guide](docs/CONFIGURATION_GUIDE.md) security sections

## Supported Versions

Security fixes go into the latest minor release only. Older release lines do not receive fixes: upgrade to the latest release. The current release is listed on the [Releases page](https://github.com/dether-net/dethernety-oss/releases).

| Version | Supported |
|---------|-----------|
| Latest minor release | Yes |
| Older minor releases | No |

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities. Contributors who report valid security issues will be acknowledged in the release notes (unless they prefer to remain anonymous).
