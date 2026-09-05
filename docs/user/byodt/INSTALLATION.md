---
title: 'Installing the BYODt Deployment'
description: 'Prerequisites, obtaining the bundle, the first start, and verifying the deployment is healthy'
category: 'documentation'
position: 2
navigation: true
tags: ['byodt', 'deployment', 'installation', 'getting-started', 'docker', 'podman']
---

# Installing the BYODt Deployment

This guide takes you from nothing to a running deployment: what the machine needs, how to get the bundle, what the first start does, and how to confirm it worked.

Allow one uninterrupted sitting. The first start does real work — it pulls five container images, downloads an embedding model, installs the signed modules, and ingests the reference data — so it takes noticeably longer than every start after it.

---

## Before you start

### A container engine

You need **one** of these, with its Compose support working:

| Engine | Requirement |
|---|---|
| **Docker** | Docker with the Compose plugin. |
| **Podman** | Podman 4.1+ with a Compose provider. It brokers to Docker Compose v2 when that is present, otherwise to `podman-compose`. |

The control script runs `<engine> compose`, so that exact invocation must work. Check it before you go further:

```sh
docker compose version
```

```sh
podman compose version
```

Whichever prints a version is the one to use. If neither does, install the missing piece — a bare engine with no Compose provider is not enough.

The script auto-detects the engine on the first start (Docker first, then Podman) and records the choice in `.env` so every later command uses the same one. You can force it instead; see [Configuration](./CONFIGURATION.md#container-engine).

### Podman specifics

Podman works fully, with three things to know:

1. **On macOS, start the machine first.** Podman runs the containers inside a virtual machine that is not started for you:

   ```sh
   podman machine start
   ```

   Without it, every command fails with a message telling you the engine's compose is not usable.

2. **Prefer the named volume for database storage on any VM-backed runtime.** That means Podman machine on macOS or Windows, and also Docker Desktop. A host bind mount crossing a file-sharing layer can corrupt a running database. Set this in `.env` before your first start:

   ```
   DB_DATA=memgraph-data
   ```

   On native Linux, the default host bind mount (`./data/memgraph`) is fine and is easier to inspect and copy. See [Where the database keeps its data](./CONFIGURATION.md#where-the-database-keeps-its-data).

3. **Rootless is expected.** The containers write into the bundle's runtime directories under an unprivileged user id that does not match yours, so the control script creates those directories world-writable on every start. You do not need to do anything, and you should not tighten them by hand — the next start would widen them again anyway.

### Disk, memory, and CPU

- **Several gigabytes of free disk.** Five container images, the embedding model, the graph database's data directory, and the reference-data corpus.
- **Several gigabytes of free memory.** The database container is started with a **4096 MiB** memory limit — that is the measured floor for the reference-data ingest, and the ingest is deliberately not retried when it runs out. The embedding server and the platform run alongside it.

On a VM-backed runtime (Docker Desktop, Podman machine), the limit that matters is the memory *the virtual machine itself* is allowed, not the memory of the host. If the VM is capped at 4 GB or less, raise it before you start.

### Network access for the first run

The first start needs to reach:

- **The container registries** — `ghcr.io` for the platform and console images, and the publishers' registries for the database, embedding server, and proxy images.
- **`github.com` and its release-asset host** — for the signed module payloads belonging to the release you are installing.
- **The embedding model's publisher** — pulled inside the `ollama` container.

Signature verification of the modules is offline: the trusted root is embedded in the console image, so no signing service is contacted.

Later starts do not need any of this. If the machine is behind a proxy or an allowlist, arrange access before the first start rather than debugging a half-finished one.

---

## Get the bundle

The deployment bundle is published as a signed release asset.

1. **Open the releases page** and note the version you want:

   <https://github.com/dether-net/dethernety-oss/releases/latest>

2. **Download the bundle.** Substitute the release version for `X.Y.Z`:

   ```sh
   VERSION=X.Y.Z
   curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/byodt-${VERSION}.tar.gz"
   ```

3. **Verify the signature (recommended).** Every release asset is signed. If you have [cosign](https://github.com/sigstore/cosign) installed:

   ```sh
   curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/byodt-${VERSION}.tar.gz.bundle"

   cosign verify-blob "byodt-${VERSION}.tar.gz" \
     --bundle "byodt-${VERSION}.tar.gz.bundle" \
     --certificate-identity "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v${VERSION}" \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

   The identity is pinned to this exact release tag, so an asset from a different release does not satisfy it. A `Verified OK` result means the bundle is the published one, unmodified.

4. **Extract it and enter the directory:**

   ```sh
   tar xzf "byodt-${VERSION}.tar.gz"
   cd "byodt-${VERSION}"
   ```

   You should see `byodt`, `compose.yaml`, `.env.example`, a `proxy/` directory, and the `LICENSE` and `NOTICE` files.

> **Where you extract it matters.** This directory becomes the deployment: your configuration, the database password, and — with the default storage setting — the graph itself all live inside it. Put it somewhere durable and backed up, not in a temporary directory.

---

## Optional: review the configuration first

The first start creates `.env` from `.env.example` and starts immediately with those defaults. The defaults are sensible for a single operator on a trusted machine: the front door binds to loopback on port 3000, and the database stores its data under `data/memgraph`.

If you already know you want something different — a different port, a different bind address, or the named volume for database storage — do it now, before the first start:

```sh
cp .env.example .env
# edit .env
```

The control script will not overwrite an `.env` that already exists. Every setting is documented in [Configuration](./CONFIGURATION.md).

---

## Start it

```sh
./byodt up
```

That is the whole installation. The command performs first-run setup and then starts the stack.

Expect output like this:

```
==> Created .env from .env.example — review it before starting.
==> Container engine: docker (recorded CONTAINER_ENGINE in .env).
==> Seeded mode/mode.env with the pure open-source defaults.
==> Wrote a new database password to .env.secrets (mode 0600).
==> Starting the stack…
    …your container engine's pull and start output…
==> Up. Console: http://127.0.0.1:3000/console/
==> First start pulls the embedding model and ingests reference data — 'byodt logs console-init' to follow.
```

`./byodt up` returning does **not** mean the deployment is ready. It means the containers were started. The work described below is still in progress.

---

## What happens on the first run

### Setup, before anything starts

| Step | What it creates |
|---|---|
| Configuration | `.env`, copied from `.env.example`, with the detected container engine appended as `CONTAINER_ENGINE`. |
| Runtime directories | `modules/`, `schema/`, `data/`, `data/ollama/`, `data/content-cache/`, `data/memgraph-log/`, `mode/`, and `tls/`. |
| Database password | A freshly generated password written to `.env.secrets`, mode `0600`. This file is created once and never regenerated. |
| Mode layer | `mode/mode.env`, seeded with the standalone defaults. |

All of this is idempotent. Every later `./byodt up` repeats the checks silently, so a deployment that lost a runtime directory repairs itself instead of failing.

### Then the stack starts, in order

1. **`db` starts** and is not considered healthy until it answers a query — not merely until its process is up.
2. **`ollama` starts** and pulls the embedding model. This is the longest single step on a fresh machine. Its health check is sized for a slow connection: forty attempts, at fifteen-second intervals, each allowed two minutes.
3. **`console-init` runs** once the database is healthy. It places the schema, downloads the module payloads for this release, verifies every signature against the pinned release identity, checks each download's digest, installs them, and ingests the MITRE ATT&CK and D3FEND reference data. Then it exits.
4. **`platform` starts** — but only after the database and the embedding server are healthy *and* `console-init` has completed successfully. That dependency is declared, so the platform cannot start against an unseeded graph or a stale schema.
5. **`proxy` starts** and publishes the front door.
6. **`console` starts.** It has no dependency on any other service, so it can report on the deployment even while the rest is down.

### How long it takes

There is no fixed number — it depends on your connection and disk. On a fast link, expect several minutes; on a slow one, considerably more. The health checks are deliberately patient rather than quick to fail, so a slow download is waited out, not aborted.

Later starts skip nearly all of it: the images are cached, the model is on disk, module payloads whose digest already matches are skipped, and the ingest is skipped when the reference corpus has not changed. A normal start takes well under a minute.

### Follow the progress

```sh
./byodt logs console-init     # schema, module install, and data ingest
./byodt logs ollama           # the embedding model download
./byodt logs                  # everything, interleaved
```

Press `Ctrl-C` to stop following. That stops the log stream only — it never stops the deployment.

### If part of it fails

The two halves of the one-shot fail differently, on purpose:

- **A version or schema problem aborts the start.** A schema that disagrees with the code serving it must not serve, so the platform is not started at all.
- **A module or data problem is recorded, and the stack still comes up.** You get a running deployment and a specific diagnosis in the console, instead of a silent empty one.

Either way, go to [Troubleshooting](./TROUBLESHOOTING.md) — every state the one-shot can report is listed there with its fix.

---

## Verify the deployment is healthy

Do all four checks. They test different things.

### 1. Every service is running

```sh
./byodt status
```

Expect `db`, `ollama`, `platform`, `proxy`, and `console` running, with `db`, `ollama`, `platform`, and `proxy` reporting healthy. `console-init` shows as exited — that is correct, it is a one-shot, and its exit code should be `0`.

### 2. The front door answers

```sh
curl -fsS http://127.0.0.1:3000/healthz
```

Expect `ok`. This is the proxy answering for itself, so it succeeds even when the platform behind it is not up — which is exactly what makes it useful for telling a front-door problem apart from a platform problem.

### 3. The platform is healthy

```sh
curl -fsS http://127.0.0.1:3000/health
```

Expect a JSON document whose `status` is `ok`, with a `services` section covering the database, GraphQL, and the loaded modules. If the platform is unhealthy this returns an error status and `curl -f` fails — that is honest, not a bug.

The console daemon has its own probe on the same origin:

```sh
curl -fsS http://127.0.0.1:3000/console/healthz
```

Expect `ok`.

> Once you install a TLS certificate, these addresses become `https://`. A self-signed certificate also needs `curl -k`. See [TLS at the front door](./OPERATIONS.md#tls-at-the-front-door).

### 4. The console reports a healthy deployment

Open the console:

```sh
./byodt console
```

This prints the console URL and, where the platform supports it, opens it in your browser. You can also browse to <http://127.0.0.1:3000/console/> directly. In the standalone configuration there is no sign-in step — the page loads straight to the dashboard.

Check these, in order:

| What you should see | Meaning |
|---|---|
| A green **Healthy** verdict at the top | No failures are being reported. |
| **Modules** — every module `placed` | The signed module payloads installed. On later starts they read `skipped`, which is equally good: the copy on disk already matches. |
| **Data ingest** — status `ok`, with a statement count in the thousands beneath it | The reference data loaded and the corpus is in the graph. On later starts the status reads `skipped-unchanged`, which is equally good. |
| A **Pre-cloud** badge, top right | The deployment is running standalone. |
| No banners above the tabs | Nothing needs your attention. |

A **Degraded** or **Fault** verdict, or any banner, is described in [Troubleshooting](./TROUBLESHOOTING.md).

### 5. Open the platform

Browse to <http://127.0.0.1:3000>. The Dethernety application loads, and you can start modelling.

---

## Next steps

- **Secure the front door.** The default is plain HTTP bound to loopback, which suits a single operator on a trusted machine. Anything else — a shared host, another machine on your network — should terminate TLS first. See [TLS at the front door](./OPERATIONS.md#tls-at-the-front-door).
- **Set up backups.** `./byodt backup` takes a consistent snapshot of the graph with no downtime. Copy the result off the machine. See [Backing up and restoring](./OPERATIONS.md#backing-up-and-restoring-the-graph).
- **Learn the settings.** [Configuration](./CONFIGURATION.md) documents every value in `.env` and, importantly, which command applies which kind of change.
- **Build your first model.** See [Building Your First Model](../BUILDING_YOUR_FIRST_MODEL.md).
- **Connect the deployment** to cloud sign-in and content packages, if you want them. See [Cloud](./CLOUD.md).
