# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Dethernety, please report it responsibly through **GitHub Security Advisories**:

1. Go to the [Security Advisories page](https://github.com/dether-net/dethernety-oss/security/advisories/new)
2. Click "New draft security advisory"
3. Fill in the details of the vulnerability

**Do not open public issues for security vulnerabilities.**

## Response Timeline

- **Acknowledgment**: Within 48 hours of your report
- **Initial assessment**: Within 5 business days
- **Critical fixes**: Target resolution within 7 days
- **Non-critical fixes**: Included in the next scheduled release

## Scope

The following are in scope for security reports:

- **dt-ws** (backend) — GraphQL API, authentication, authorization, database queries
- **dt-ui** (frontend) — XSS, CSRF, authentication bypass, sensitive data exposure
- **dt-core** — Data access layer, input validation
- **dt-module** — Module loading, sandboxing, code execution
- **Demo environment** — Default credentials, insecure defaults
- **Docker image** — Container security, exposed ports, privilege escalation
- **Dependencies** — Vulnerabilities in direct dependencies

The following are out of scope:

- Vulnerabilities in third-party services (Neo4j, Memgraph, OIDC providers)
- Social engineering attacks
- Denial of service attacks against demo/development environments
- Issues in forks or unofficial distributions

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

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities. Contributors who report valid security issues will be acknowledged in the release notes (unless they prefer to remain anonymous).
