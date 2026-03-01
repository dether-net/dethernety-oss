# Contributing to Dethernety

By participating in this project, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

This guide covers the development setup, coding conventions, and pull request process.

## Contributor License Agreement

Before your first pull request can be merged, you must sign our [Contributor License Agreement](CLA.md). The CLA bot will prompt you automatically when you open a PR.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 9.13+
- A Bolt/Cypher-compatible database (Neo4j or Memgraph)

### Getting Started

```bash
git clone https://github.com/dether-net/dethernety-oss.git
cd dethernety-oss
pnpm install
```

### Running Locally

```bash
# Start all development servers
pnpm dev

# Or start individually
cd apps/dt-ws && pnpm dev    # Backend
cd apps/dt-ui && pnpm dev    # Frontend
```

### Running Tests

```bash
pnpm test          # All tests
pnpm lint          # Linting
pnpm format        # Format code with Prettier
```

## Code Style

- **TypeScript** for all frontend and backend code
- **Prettier** for formatting (run `pnpm format` before committing)
- **ESLint** for linting (run `pnpm lint`)
- Use the shared configurations in `packages/eslint-config/` and `packages/typescript-config/`

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Write your changes** following the code style guidelines
3. **Add tests** for new functionality where applicable
4. **Run checks** locally: `pnpm lint && pnpm build && pnpm test`
5. **Commit** with a clear, descriptive message
6. **Open a pull request** against `main`
7. **Sign the CLA** when prompted by the bot
8. **Respond to review feedback** — maintainers will review within a few business days

### Commit Messages

Write clear commit messages that explain *why* the change was made:

```
Add exposure scoring to DataFlow nodes

DataFlow nodes previously had no exposure tracking. This adds HAS_EXPOSURE
relationships and score propagation so that data flow risks are visible
in the model overview.
```

### What Makes a Good PR

- Focused on a single concern
- Includes tests for new behavior
- Passes all CI checks (lint, build, test)
- Has a clear description of what changed and why

## Module Development

To create a custom module, see the [Module Development Guide](docs/architecture/modules/). Key points:

- Extend the base classes in `packages/dt-module/`
- Follow the structure of `modules/dethernety-module/` as a reference
- Include a `module.json` manifest with metadata
- Test module loading locally before submitting

## Reporting Issues

- **Bugs**: Use the [bug report template](https://github.com/dether-net/dethernety-oss/issues/new?template=bug_report.yml)
- **Feature requests**: Use the [feature request template](https://github.com/dether-net/dethernety-oss/issues/new?template=feature_request.yml)
- **Security issues**: See [SECURITY.md](SECURITY.md) — do not open public issues

## Questions

For general questions and discussions, use [GitHub Discussions](https://github.com/dether-net/dethernety-oss/discussions).
