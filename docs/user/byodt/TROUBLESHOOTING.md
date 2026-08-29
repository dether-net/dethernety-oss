---
title: 'Troubleshooting the BYODt Deployment'
description: 'Symptom, cause, and fix for the failures this deployment reports'
category: 'documentation'
position: 6
navigation: true
tags: ['byodt', 'deployment', 'troubleshooting', 'errors', 'recovery']
---

# Troubleshooting the BYODt Deployment

Every entry below is a real state this deployment can report, with the message you will actually see. Find your symptom, read the cause, apply the fix.

---

## First, gather the facts

Three commands and one page answer most questions:

```sh
./byodt status                # which services are running, and their health
./byodt logs console-init     # what the first-run one-shot did
./byodt logs platform         # what the platform is doing
```

```sh
./byodt console               # open the operator console
```

The console is the fastest diagnosis. It reports a verdict — **Healthy**, **Degraded**, or **Fault** — plus a banner for each specific problem, and it keeps working while the rest of the deployment is down. Read its banners before anything else.

A note on reading `./byodt status`: `console-init` showing as **exited** is correct. It is a one-shot. What matters is its exit code — `0` is success.

---

## Starting the deployment

### `No usable container engine`

> `error: No usable container engine — install Docker (with the Compose plugin) or Podman 4.1+ (a Compose provider, plus a running machine on macOS), or set CONTAINER_ENGINE in .env.`

**Cause.** Neither `docker compose` nor `podman compose` ran successfully. Usually an engine is installed but its Compose support is not, or the engine's service is not running.

**Fix.** Check directly:

```sh
docker compose version
podman compose version
```

Install whichever piece is missing. A bare engine with no Compose provider is not enough. If both are installed and one works, name it in `.env`:

```
CONTAINER_ENGINE=docker
```

### `CONTAINER_ENGINE=podman, but 'podman compose' failed`

> `error: CONTAINER_ENGINE=podman, but 'podman compose' failed — check that podman and its Compose provider are installed, and (macOS/Podman) that its machine is running ('podman machine start'); or set a different CONTAINER_ENGINE in .env.`

**Cause.** On macOS, almost always the Podman machine is not running. Otherwise, no Compose provider is available to Podman.

**Fix.**

```sh
podman machine start
./byodt up
```

### `Not set up yet`

> `error: Not set up yet — run 'byodt bootstrap' (or just 'byodt up', which does it for you).`

**Cause.** A command that needs a configured deployment ran against a bundle that has not been set up — a fresh extract, or one where `.env`, `.env.secrets`, or `mode/mode.env` was removed.

**Fix.**

```sh
./byodt up
```

That repairs the layout and starts the deployment. If `.env.secrets` was deleted while a graph already exists, read [The database will not become healthy](#the-database-will-not-become-healthy) before running anything.

### `Refusing '-v'`

> `error: Refusing '-v' — it deletes data/images this command keeps by design. Remove the graph explicitly instead ('byodt destroy' prints how).`

**Cause.** You passed `-v`, `--volumes`, or `--rmi` to `down` or `destroy`. These commands keep your data by design, so they refuse flags that would contradict that rather than silently obeying.

**Fix.** If you did want to erase the graph, do it explicitly:

```sh
./byodt destroy
```

and run the wipe command it prints for your storage setting.

### The port is already in use

**Symptom.** The engine reports that the host port cannot be allocated.

**Cause.** Something else on the machine is bound to port 3000.

**Fix.** Pick another port in `.env` and apply it:

```
FRONT_DOOR_PORT=3100
```

```sh
./byodt up
```

Note that port 3000 is a pre-registered loopback callback address, so moving off it means registering your callbacks explicitly if you later connect the deployment. See [Configuration → Front door](./CONFIGURATION.md#front-door).

### The platform never starts, and `console-init` exited non-zero

**Cause.** The one-shot aborted the start. It does that for exactly two classes of problem: the pinned versions disagree, or the schema could not be placed. In both cases the platform is deliberately held back — a schema that disagrees with the code serving it must not serve.

**Fix.** Read the reason:

```sh
./byodt logs console-init
```

Then see the next two entries.

### `console image version … does not match PLATFORM_VERSION`

> `console image version "A.B.C" does not match PLATFORM_VERSION "X.Y.Z" — the operator has pinned a version this image cannot serve`

**Cause.** Your `.env` sets `CONSOLE_IMAGE` to an image whose tag is not `PLATFORM_VERSION`. The console image normally follows `PLATFORM_VERSION` on its own, so this only happens if the key was deliberately uncommented — to point at a mirror — and its tag was left behind, or if an `.env` carried over from an older bundle still pins it.

**Fix.** Open `.env` and comment the key out so it follows `PLATFORM_VERSION` again:

```
# CONSOLE_IMAGE=ghcr.io/dether-net/byodt-console:${PLATFORM_VERSION}
```

If you need the override because the console image comes from your own mirror, keep it but set its tag to the same value as `PLATFORM_VERSION`. Then apply:

```sh
./byodt update
```

See [Upgrading to a new release](./OPERATIONS.md#upgrading-to-a-new-release).

### `PLATFORM_VERSION is not set`

**Cause.** The key is missing or empty in `.env` — usually a hand-edited or partially copied file.

**Fix.** Restore it from `.env.example`, which carries the version this bundle shipped with, then `./byodt up`.

### The database will not become healthy

**Symptom.** `./byodt status` shows `db` unhealthy or perpetually starting, and the platform never starts because it waits for the database. `./byodt logs db` shows authentication failures.

**Cause.** The database's credentials and `.env.secrets` no longer match. The database created its user from the password that existed when it first started; if `.env.secrets` was deleted, a **new** password was generated on the next start, and the existing database still expects the old one.

**Fix, in order of preference:**

1. **Restore the original `.env.secrets`** from your backup of it, then `./byodt up`. Your graph is intact.
2. **If the password is gone for good**, the existing graph cannot be opened. Restore from a backup snapshot onto a fresh database:

   ```sh
   ./byodt down
   # remove the graph — ./byodt destroy prints the exact command for your storage setting
   ./byodt up
   ./byodt restore backups/<your latest snapshot>
   ```

   A fresh database adopts the password currently on disk, and a snapshot carries no credentials, so this works.

This is why `./byodt destroy` prints a warning about `.env.secrets` every time. Back that file up separately — see [Configuration → The generated secret file](./CONFIGURATION.md#the-generated-secret-file).

---

## The first run

### It is taking a very long time

**Cause.** Normal, on a fresh machine and especially on a slow connection. The first start pulls five container images, downloads the embedding model inside the `ollama` container, downloads and verifies the module payloads, and ingests the reference corpus. The health checks are deliberately patient — the embedding-server check alone allows forty attempts at fifteen-second intervals — so a slow download is waited out rather than failed.

**Fix.** Watch it rather than restarting it:

```sh
./byodt logs ollama           # the model download
./byodt logs console-init     # modules and the data ingest
```

Restarting mid-pull only starts the downloads again.

### `the data ingest failed` with a memory limit

> **Ingest Failed** — the data ingest failed — the deployment runs without the MITRE corpus: memory limit exceeded (…) — the database needs a larger memory limit; this is terminal and was not retried: …

**Cause.** The database ran out of memory partway through the reference-data ingest. The database container is started with a 4096 MiB limit, which is the measured floor for this ingest — but it can only use memory the engine is actually able to give it.

**Fix.** Raise the memory available to your container engine, then re-run the one-shot. On a VM-backed runtime — Docker Desktop, or a Podman machine — the constraint is the **virtual machine's** memory allocation, not the host's. Raise it to comfortably more than 4 GB, then:

```sh
./byodt restart
```

The ingest re-runs because the corpus is not yet recorded as loaded. Confirm the console's **Ingest** panel reads `ok` and the statement count is no longer zero.

### `the module release channel was unreachable`

> **Module Fetch Failed** — the module release channel was unreachable — no code modules were installed

**Cause.** The one-shot could not reach the release host to download the module payloads. A firewall, a proxy, an offline machine, or a transient outage.

**Fix.** Give the machine access to `github.com` and its release-asset host, then re-run the one-shot:

```sh
./byodt restart
```

Verify in the console that **Modules** now shows each module `placed`.

### `the named release carries no module assets`

> **Module Fetch Failed** — the named release carries no module assets — no code modules were installed

**Cause.** The release named by `PLATFORM_VERSION` exists but has no module payloads at that version. Usually `PLATFORM_VERSION` has been set to a version that was never published, or to one whose assets are not available.

**Fix.** Set `PLATFORM_VERSION` to a published release — check the [releases page](https://github.com/dether-net/dethernety-oss/releases) — then `./byodt update`.

### `a module signature did not verify`

> **Module Fetch Failed** — a module signature did not verify — the module was rejected

**Cause.** A downloaded payload did not verify against the signing identity pinned to that exact release. The module was rejected rather than installed. Possible causes: a corrupted or truncated download, an intercepting proxy rewriting the response, or an artifact that genuinely is not the published one.

**Fix.** This is a security event — do not work around it.

1. Re-run the one-shot (`./byodt restart`) in case the download was simply corrupt.
2. If it persists, check whether something between the machine and the release host is modifying traffic (a TLS-inspecting proxy will do this).
3. Verify the bundle you are running is the published one, using the signature check in [Installation](./INSTALLATION.md#get-the-bundle).

### `some modules installed and some failed` / `every module failed to install`

**Cause.** Partial or total install failure, for a reason recorded per module.

**Fix.** Open the console's **Modules** table on the Overview tab. Each row shows its outcome, and a failed row carries the specific reason. `./byodt logs console-init` has the full record. Then `./byodt restart` to retry.

### `the init one-shot has not written its state`

> **Init Not Run** — the init one-shot has not written its state — it may not have run yet

**Cause.** The console is running but the one-shot has not finished — normal during the first minutes of a first start. If it persists, the one-shot never ran or could not write its state file.

**Fix.** Wait, then check:

```sh
./byodt status                # did console-init run? what was its exit code?
./byodt logs console-init
```

If it never ran, `./byodt up`.

---

## The console

### Verdict shows **Degraded** or **Fault**

**Cause.** **Fault** means the deployment is not delivering its product: modules could not be fetched, modules were placed but never registered, or the reference data is missing. **Degraded** means something milder — the platform is restarting, or the one-shot has not reported yet.

**Fix.** Read the banners above the tabs. Each one is a specific problem with its own entry on this page.

### `the console placed modules the platform did not register`

> **Fewer Modules Registered** — the console placed modules the platform did not register
> Modules: `…`

**Cause.** The one-shot installed the named modules onto disk, but the platform did not load them at startup. This is the deployment's characteristic failure, and it is only detectable after the platform is running — the one-shot exits before that.

**Fix.**

```sh
./byodt logs platform
```

Look for module-loading errors naming the modules in the banner. Then recreate the platform so it re-scans the modules directory:

```sh
./byodt restart platform
```

If they still do not register, capture the platform log — it names the reason each module was rejected.

### `the platform is not reachable`

> **Platform Unreachable** — the platform is not reachable — module registration could not be checked

The top-right badge also reads **Platform unreachable**.

**Cause.** The console cannot reach the platform. Expected for a short window during any recreate. Otherwise the platform is down or unhealthy.

**Fix.**

```sh
./byodt status
./byodt logs platform
```

If the platform is not running, `./byodt up`. If it is running but unhealthy, its log says why — a database it cannot reach is the usual reason.

### `Could not load deployment state`

**Cause.** The console reached its own daemon but a request failed — for example the one-shot's state file exists but cannot be read.

**Fix.** The console retries automatically and clears the banner on the next successful poll. If it persists:

```sh
./byodt logs console
./byodt restart console
```

### `Could not reach the console. Reload to retry.`

**Cause.** The console daemon is not answering, or the front door cannot reach it.

**Fix.**

```sh
./byodt status
./byodt restart console
```

Then confirm the daemon answers directly:

```sh
curl -fsS http://127.0.0.1:3000/console/healthz
```

### `The console session keeps ending. Reload to retry.`

**Cause.** The console's sessions live in memory, so restarting the console daemon invalidates them. The page recovers on its own once or twice; if it keeps happening, the daemon is restarting repeatedly.

**Fix.**

```sh
./byodt status               # is `console` restarting?
./byodt logs console
```

### A banner says a change is not yet applied

> **Cloud configuration not yet applied** — recreate the stack to apply it: `byodt restart`

or

> **Revert to pure open-source not yet applied** — recreate the stack to complete it: `byodt restart`

**Cause.** The console has written a configuration change that the platform is not yet running. This is informational, not a fault.

**Fix.**

```sh
./byodt restart
```

The banner clears once the platform comes back in the new mode.

---

## The front door

### `502 Bad Gateway`

**Cause.** The front door is up but the platform behind it is not. This is by design: the proxy resolves the platform at request time, so a platform outage produces a 502 rather than a proxy that refuses to start at all.

**Fix.**

```sh
./byodt status
./byodt logs platform
```

During a recreate, wait — the platform has a start-up grace period before it is considered healthy.

### Connection refused

**Cause.** The front door itself is not running, or it is bound to an address you are not connecting from. By default it binds to loopback only, so it is unreachable from another machine.

**Fix.**

```sh
./byodt status
curl -fsS http://127.0.0.1:3000/healthz     # expect: ok
```

To reach it from elsewhere, change `FRONT_DOOR_BIND` — and read the exposure warning in [Configuration → Front door](./CONFIGURATION.md#front-door) first.

### HTTPS is not served after generating a certificate

**Cause.** The certificate was written, but the front door has not been recreated. It reads the certificate directory when its container starts, and adding files to a mounted directory does not by itself recreate anything.

**Fix.**

```sh
./byodt tls status            # confirm the certificate is there
./byodt restart proxy
```

Then browse to the same address over `https://`.

### `400 Bad Request — The plain HTTP request was sent to an HTTPS port`

**Cause.** A certificate is installed, so the port now serves HTTPS, but you connected over `http://`. The port number does not change when TLS is enabled — the protocol does.

**Fix.** Use `https://` at the same address. Note that `./byodt console` and the messages printed by `./byodt up` always show an `http://` address, so adjust the scheme yourself.

### The browser warns that the certificate is not trusted

**Cause.** `./byodt tls generate` produces a self-signed certificate. It encrypts the connection and makes the page a secure context; it does not attest identity, so browsers warn.

**Fix.** Accept it for a deployment you run yourself, or install a certificate from a certificate authority your browser trusts by placing `cert.pem` and `key.pem` in `tls/` and running `./byodt restart proxy`.

### `openssl is required to generate a certificate`

**Cause.** `openssl` is not on the host's `PATH`. Certificate generation runs on the host, not in a container.

**Fix.** Install `openssl`, or generate the certificate elsewhere and copy `cert.pem` and `key.pem` into `tls/`.

---

## The database and backups

### `Database is not reachable (running? credentials right?)`

**Cause.** `./byodt backup` probes the database before doing anything, and the probe failed.

**Fix.**

```sh
./byodt status
```

If the database is not running, `./byodt up`. If it is running but the probe fails on credentials, see [The database will not become healthy](#the-database-will-not-become-healthy).

### `No snapshot available to back up`

**Cause.** The database neither produced a new snapshot nor has an existing one to copy — this is effectively an empty or very newly created database.

**Fix.** Confirm the deployment is actually holding data (the console's **Data** figure shows the statement count from the reference ingest). If the graph really is empty, there is nothing to back up yet.

### `That backup was taken on version X; this deployment is Y`

**Cause.** A warning, not an error. The filename records the version the snapshot was taken on, and it differs from what this deployment runs. Snapshots are version-sensitive and may not load across versions.

**Fix.** Prefer restoring onto the version the backup was taken on. If you continue and the restore fails, the current graph is left unchanged — nothing is lost by trying.

### `RECOVER SNAPSHOT failed — the current graph was left unchanged`

**Cause.** The database refused the snapshot. A version mismatch is the usual reason; a truncated or corrupt file is the other.

**Fix.** Try a different snapshot, or pin the deployment back to the version the snapshot was taken on and restore there. Your current graph is intact either way.

### After a restore the app shows old or empty data

**Cause.** The platform is holding state from before the restore.

**Fix.** The restore command tells you this too:

```sh
./byodt restart platform
```

### `Aborted — nothing was changed`

**Cause.** The restore confirmation was not typed exactly as `restore`.

**Fix.** Run it again and type `restore` at the prompt.

---

## Cloud connect and sign-in

### The recipe is rejected

The message names the problem exactly:

| Message | Cause | Fix |
|---|---|---|
| `line N is not NAME=value: …` | A line in the paste is not a setting — usually stray text or a wrapped line. | Re-copy the whole recipe and paste it unmodified. |
| `X appears more than once` | The same setting is present twice, usually from pasting twice. | Clear the box and paste once. |
| `recipe is missing required variables: …` | The paste is incomplete. A partial recipe would boot the deployment into a broken state, so it is refused outright. | Re-copy the whole recipe. |
| `recipe carries variables the console will not write: …` | The paste contains settings outside the accepted set. The whole apply is refused rather than partially honoured. | Paste the recipe exactly as issued, with nothing added. |

### `this deployment is already cloud-configured`

> `this deployment is already cloud-configured — disconnect from the cloud before reconfiguring`

**Cause.** A cloud configuration is already written. Reconfiguring over it is refused, so a mistake cannot leave the deployment half-configured.

**Fix.** Click **Disconnect from cloud**, run `./byodt restart`, then apply the new recipe.

### `the redirect URI over http is allowed only on localhost`

**Cause.** You are reaching the console over plain HTTP at a non-`localhost` address, so the callback the console would write is a plaintext, off-box URL. It refuses to write one.

**Fix.** Enable TLS at the front door, then reach the console over `https://` and apply the recipe again:

```sh
./byodt tls generate <your hostname>
./byodt restart proxy
```

The same applies to a recipe value: `OIDC_ISSUER must be https (or http on localhost)` and its siblings mean a recipe carried a plaintext endpoint. Re-copy the recipe; if it genuinely contains one, do not work around it.

### `Cloud sign-in needs a secure context`

> `Cloud sign-in needs a secure context (https, or a localhost address). Enable TLS at the front door first (byodt tls generate).`

**Cause.** The browser will not expose the cryptography the sign-in flow requires on a plain-HTTP page at a non-`localhost` address.

**Fix.** Same as above: install a certificate, recreate the proxy, and reach the console over `https://`.

### `This console's sign-in callback is not registered`

**Cause.** The identity provider rejected the sign-in because the console's callback URL is not registered. The provider rejects this before the request reaches your deployment, so nothing in your own logs explains it.

**Fix.** The console shows the exact value to register. Copy it verbatim into your account's **Callback URLs** field, save, then sign in again. Both callbacks — the platform's and the console's — must be registered, and they must match exactly, including scheme, host, and port. See [Cloud → Step 1](./CLOUD.md#step-1--register-the-two-callbacks).

### `could not verify sign-in — the platform may be starting or busy; retry`

**Cause.** The console checks your sign-in by asking the platform, and the platform did not answer cleanly. It may be starting, restarting, or busy. The console deliberately does not claim your sign-in was rejected, because it cannot tell the two apart.

**Fix.** Wait for the platform to be healthy (`./byodt status`), then sign in again. If it persists, `./byodt logs platform`.

### `the sign-in check is busy — retry`

**Cause.** Too many sign-in checks are in flight at once. The console caps them.

**Fix.** Retry in a moment.

### The console signed me out after I applied the configuration

**Cause.** Expected. Connecting or disconnecting changes the deployment's posture, so every console session minted under the old posture is dropped. The tab you applied from is the exception: it keeps working for a short grace period so you can read what to do next, then it is signed out too. Any other tab is signed out immediately.

**Fix.** Nothing. After connecting you sign in with SSO; after disconnecting the console re-establishes its own session automatically. You do not need to be signed in to run `./byodt restart` — and running it is what completes the change.

---

## Content mounts

### `the content catalog is available only in cloud mode`

> `the content catalog is available only in cloud mode — connect this deployment to the cloud first`

**Cause.** Content packages require a connected deployment: the catalog address arrives with the cloud configuration, so a standalone deployment has nowhere to look.

**Fix.** Connect the deployment — see [Cloud](./CLOUD.md). Note the **Content** tab only appears once the platform is *actually running* in cloud mode, which means after `./byodt restart`.

### `the content catalog is unavailable`

**Cause.** The catalog service could not be reached.

**Fix.** Check the machine's network access and retry. Mounted modules keep working: the local inventory still renders so you can manage what is already mounted, and pins are marked `update unknown` with the note *the content catalog is unavailable, so update availability could not be checked*.

### `a module directory with this name already exists and was not created by the console`

**Cause.** A module directory of that name already exists and does not carry the console's own marker — a module that shipped with the release, or one you added yourself. The console refuses to overwrite it.

**Fix.** Nothing to do unless you genuinely intended to replace it, in which case remove that directory from `modules/` yourself first. The same protection applies to unmounting: `this module directory was not created by the console and will not be removed`.

### A mount or unmount had no effect

**Cause.** Mounts are written into the modules directory, which the platform reads only at startup. Until the platform is recreated, nothing changes.

**Fix.**

```sh
./byodt restart platform
```

The console shows a standing reminder in the Content tab after any mount change, with this exact command.

### `Warning: the stub file is world-writable`

> `…the stub file is world-writable, which the platform refuses to load in cloud mode — check how the host mount preserves file permissions`

**Cause.** The console wrote the mount with restrictive permissions, but the file ended up world-writable on disk. Some bind-mount backends do not preserve file modes. The platform refuses to load a world-writable module file when authentication is on, so the mount would silently not take effect.

**Fix.** This is a property of how your container engine shares that directory. On a VM-backed runtime, switching the deployment's storage away from host bind mounts where possible, or running on native Linux, avoids it. Confirm after a `./byodt restart platform` whether the module registered — if it did not, the console reports **Fewer Modules Registered**.

### A cloud module is still in `modules/` after disconnecting

**Cause.** A disconnect removes every cloud-provided module itself and names what it removed. Two outcomes leave one behind, and the disconnect message says which:

- `The cloud modules were left in place because another modules operation was running — disconnect again to remove them`. Another module operation held the modules directory at that moment, and the sweep is skipped rather than waited on, because a revert something else can block is not a recovery path.
- `These could not be removed and are still in the modules mount: … — disconnect again, or delete them by hand`. The sweep ran, and those directories could not be deleted.

A third message is not this problem: `Warning: a module is gone but its files could not be deleted and remain at …`. That module was moved out of the platform's way before its files were deleted, so it no longer loads. What remains is a staging copy under `modules/.byodt-console-tmp/`, and deleting it recovers disk space and nothing else.

**Fix.** Delete the named directories from `modules/` yourself, then recreate — `./byodt restart` if you have not yet applied the disconnect, `./byodt restart platform` if you have.

The message suggests disconnecting again, and that does re-run the sweep, but there is no button for it once the disconnect is written: the **Cloud** tab offers the recipe form instead, and mount and unmount refuse with `content mounts are available only in cloud mode`. Taking that route means pasting a recipe, recreating the stack, disconnecting again and recreating once more — which the deletion above spares you.

What a disconnect removes, and what it costs the graph, is in [Cloud → Disconnecting](./CLOUD.md#disconnecting).

---

## Permissions and rootless engines

### Permission denied writing to `modules/`, `schema/`, or `data/`

**Cause.** The containers write into these directories as an unprivileged user id that does not match yours — the console runs as a non-root numeric id. If those directories were created or tightened by hand, that user cannot write to them.

**Fix.** Let the control script repair the layout. It creates the runtime directories with permissions the container user can use, and does so on every start:

```sh
./byodt up
```

Do not tighten these directories by hand — the next start widens them again, and the deployment needs them writable. The certificate directory `tls/` is the deliberate exception: it stays restrictive, is mounted read-only, and only you write to it.

### The database becomes corrupt on macOS or Windows

**Cause.** The default storage setting is a host bind mount inside the bundle. On a VM-backed runtime — Podman machine, or Docker Desktop — the file-sharing layer between host and VM can corrupt a database that is actively writing.

**Fix.** Move the database to the named volume, which lives in the engine's own storage. Back up first: this is a switch to a **fresh** database, not a migration.

```sh
./byodt backup
```

Then in `.env`:

```
DB_DATA=memgraph-data
```

```sh
./byodt restart db
./byodt restore backups/<the file you just made>
```

See [Configuration → Where the database keeps its data](./CONFIGURATION.md#where-the-database-keeps-its-data).

---

## Still stuck

Collect this before asking for help — it is what any diagnosis starts from:

```sh
./byodt version
./byodt status
./byodt logs console-init > console-init.log
./byodt logs platform > platform.log
```

Plus a screenshot of the console's dashboard, including any banners.

> **Check what you share.** Logs and screenshots can carry the names of your models and components. Review them before sending. They do not contain your database password, which lives only in `.env.secrets` — and that file should never be shared.

## Related

- [Installation](./INSTALLATION.md) — prerequisites and the first start.
- [Configuration](./CONFIGURATION.md) — settings, and which command applies a change.
- [Operations](./OPERATIONS.md) — the command reference, backups, TLS, and upgrades.
- [Cloud](./CLOUD.md) — connecting and disconnecting.
