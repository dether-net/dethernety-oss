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

The ingest re-runs because the corpus is not yet recorded as loaded. Confirm the console's **Data ingest** panel reads `ok` and the statement count is no longer zero.

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

**Fix.** Confirm the deployment is actually holding data — the console's **Data ingest** panel shows the statement count from the reference ingest beneath its status. If the graph really is empty, there is nothing to back up yet.

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

**Fix.** Click **Disconnect from cloud**, in the **Disconnect** section at the foot of the Cloud tab, run `./byodt restart`, then apply the new recipe. Disconnecting is administrator-only: if that control is disabled for you, ask an administrator of the deployment's team to do it — see [Who can change a connected deployment](./CLOUD.md#who-can-change-a-connected-deployment).

If all you need to change is **who may sign in**, do not disconnect at all. That one value can be replaced on a connected deployment, from section **3 · Who may sign in** on the same tab, and it costs none of what a disconnect costs: [Cloud → Changing who may sign in](./CLOUD.md#changing-who-may-sign-in).

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

**Fix.** The console shows the exact value to register. Copy it verbatim into your account's **Callback URLs** field, save, then sign in again. Both callbacks — the platform's and the console's — must be registered, and they must match exactly, including scheme, host, and port. See [Cloud → Register the two callbacks](./CLOUD.md#register-the-two-callbacks).

### `could not verify sign-in — the platform may be starting or busy; retry`

**Cause.** The console checks your sign-in by asking the platform, and the platform did not answer cleanly. It may be starting, restarting, or busy. The console deliberately does not claim your sign-in was rejected, because it cannot tell the two apart.

**Fix.** Wait for the platform to be healthy (`./byodt status`), then sign in again. If it persists, `./byodt logs platform`.

### `the sign-in check is busy — retry`

**Cause.** Too many sign-in checks are in flight at once. The console caps them.

**Fix.** Retry in a moment.

### The console signed me out after I applied the configuration

**Cause.** Expected. Connecting or disconnecting changes the deployment's posture, so every console session minted under the old posture is dropped. The tab you applied from is the exception: it keeps working for a short grace period so you can read what to do next, then it is signed out too. Any other tab is signed out immediately.

**Fix.** Nothing. After connecting you sign in with SSO; after disconnecting the console re-establishes its own session automatically. You do not need to be signed in to run `./byodt restart` — and running it is what completes the change.

### `You are not an administrator of the team this deployment belongs to`

> `You are not an administrator of the team this deployment belongs to. Only an administrator may change this deployment or see who may sign in to it. Nothing was changed. An owner or administrator of that team can grant you the administrator role in the portal.`

**Cause.** Every console control that *changes* a connected deployment — mounting and unmounting content, installing and removing artifacts, changing who may sign in, and disconnecting — is available only to an administrator of the team the deployment belongs to, and so is the one thing the console *shows* only to an administrator: the **Who may sign in** card, which lists your team's members and who among them may sign in. The console asked the cloud who you are on this attempt, and the answer was no. Every other read is unaffected: the status, the catalog and the inventory are all still yours to see. On the Cloud tab the card shows this sentence in the console's own words and nothing of the team — no list, no ticks, nothing about who has left.

**Fix.** Ask an owner or administrator of that team to grant you the administrator role in the portal, or to run the operation for you. Retrying changes nothing until the role does. Once it does, your next attempt picks it up — you do not have to sign in again — though the Content tab learns which controls to offer only when it reads the catalog, so click **Refresh** there for the buttons to become available. The **Who may sign in** card has no retry in this state — reload the page; the reload clears the tab's cloud sign-in, so the card offers **Sign in to the cloud** and fetches the team when you return. See [Cloud → Who can change a connected deployment](./CLOUD.md#who-can-change-a-connected-deployment).

### `The console could not reach the content service to check whether you administer this deployment`

> `The console could not reach the content service to check whether you administer this deployment, so nothing was changed. Wait a moment and try again.`

**Cause.** The check is made against the cloud on every attempt, and this attempt got no usable answer — unreachable, refused, or a reply the console does not recognise. It refuses rather than guessing, and it deliberately does not say you are not an administrator, because what failed was the check and not you.

**Fix.** Check the machine's network access and try again in a moment. While it lasts this also refuses **Disconnect from cloud**, which is intended: proceeding when the check cannot be made would be the wrong direction to fail in on the one operation that costs you classes and links.

### `This tab no longer holds your cloud sign-in`

> `This tab no longer holds your cloud sign-in, so the console could not check whether you administer this deployment. Nothing was changed. Sign in to the cloud again to continue.`

**Cause.** The check is made with the cloud credential this browser tab holds, and that credential is kept in memory only. Reloading the page clears it while leaving your console session intact — so the tab is signed in, shows your name, and holds nothing to ask the cloud with. This is the ordinary state of a reloaded tab, not a fault.

**Fix.** Usually nothing to read: the console answers this by taking you to sign in again rather than by printing the sentence. Sign in, then repeat the action. The same cause shows in the Content tab as the muted line *Your subscription has not been checked…*, and on the **Who may sign in** card as *Who may sign in has not been fetched…* with a **Sign in to the cloud** button — the card offers the sign-in rather than performing it, so a reloaded tab is not sent to the identity provider unasked.

If it happened while you were applying who may sign in, what you had chosen is put back when you return — your ticks, laid over the team fetched afresh, or on a deployment that names no team the list you had pasted — above a line saying *You were signed in again before this could be applied, so nothing was changed. What you had chosen is below — check it and apply again.* A tick for someone who has left the team in the meantime is dropped. The sign-in interrupted the change, it did not make it.

### `This deployment's configuration does not let the console check who administers it`

> `This deployment's configuration does not let the console check who administers it, so it cannot run this operation for anyone. Fixing it means regenerating the deployment recipe in the portal and reconnecting — see what disconnecting costs before you do. Disconnecting itself does not need the check and is still available.`

**Cause.** Permanent, and not an outage. This deployment's configuration either carries no permission to ask the question or names no usable address to ask it at, so the check cannot succeed here for anybody. Waiting will not help, and it is not about you. The same cause shows in the Content tab as the muted line *Nothing is restricted, but subscriptions cannot be checked on this deployment…*.

**Fix.** Get a fresh recipe from the portal, then disconnect, apply it, and connect again — read [what disconnecting costs](./CLOUD.md#disconnecting) first. Disconnect is the one control this refusal does not block, precisely because it is the step the repair needs.

### `That list does not name the account you are signed in as`

> `That list does not name the account you are signed in as (your account identifier), so applying it would lock you out of this deployment at the next platform start. Nothing was changed. Paste the DEPLOYMENT_ALLOWLIST value from a freshly generated deployment recipe again rather than adding yourself back — if your own account was missing from what you pasted, others may be too. An administrator who is on the list can also apply it for you.`

**Cause.** The list you pasted does not name the account this console session belongs to. Applying it would end your own access at the next platform start, and with it your ability to change the list again. The list itself is well formed — what is wrong is that it leaves you out. You only meet this from the paste box, on a deployment that names no team: on the card your own row is always ticked and cannot be unticked, so the card never submits a list without you.

**Fix.** Clear the box and copy the whole list again — the value of the `DEPLOYMENT_ALLOWLIST=` line in the recipe's **Environment** block on the portal's deployment page, from a freshly generated recipe — and apply that. Do not just add yourself back to what is in the box: the usual cause is a paste that dropped lines, and adding yourself fixes the symptom while applying a list that is still missing colleagues. If the new list genuinely should not include you, ask an administrator who *is* on it to apply it for you.

This message names your own account identifier in the brackets, and it is the only place either the console or the portal shows it to you. See [Cloud → Changing who may sign in](./CLOUD.md#changing-who-may-sign-in).

### `The list you submitted names no accounts`

> `The list you submitted names no accounts, so nothing was changed. A box that looks filled can still name none — separators alone are not accounts. An empty list does not mean "nobody": the platform reads it as NO RESTRICTION, which would admit anyone your identity provider knows, and on a deployment reachable over the network it refuses to start at all. To narrow access to one person, submit a list naming that one account.`

**Cause.** An empty list is not a way to close a deployment; it is the value that opens it. On the card, you applied with nobody ticked — the card lets you, so that this sentence is what you read rather than a greyed-out button. In the paste box, a box that looks filled can still be empty this way — separators on their own, such as `,,,`, name no accounts.

**Fix.** Tick, or paste, the accounts that should keep access. To narrow the deployment down to one person, apply a list naming that one account — and if that person is not you, the console will not let you remove yourself: on the card your own row stays ticked beside theirs, and in the paste box expect the refusal above. Keep your own account on the list as well, or ask an administrator who is on the new list to apply it.

### `The access list contains a character that cannot appear in an account identifier`

> `The access list contains a character that cannot appear in an account identifier — usually an invisible one picked up by copying. Nothing was changed. Paste the DEPLOYMENT_ALLOWLIST value from a freshly generated deployment recipe again.`

**Cause.** An invisible character rode in with the paste — a byte-order mark from a text editor, a zero-width space from a web page, a soft hyphen from a wrapped document. None of them shows on screen, and none of them counts as a separator, so it becomes part of an account identifier that will then never match anyone. The console refuses the whole class rather than writing a list that looks right and silently locks somebody out.

**Fix.** Clear the box, then copy the list again — the value of the `DEPLOYMENT_ALLOWLIST=` line in the recipe's **Environment** block on the portal's deployment page — and paste it straight into the console. Going via an editor, a document, or a chat message is what usually picks these up.

### `That list names N accounts, and a deployment's access list holds at most …`

> `That list names 4812 accounts, and a deployment's access list holds at most 512 — so nothing was changed. Check that what you copied is the access list rather than another part of the page.`

**Cause.** A deployment's access list runs to tens of accounts, so a list far past that is almost always a paste of the wrong thing — the deployment recipe, or a whole page — rather than the list. The message names both numbers: the first is what the console read out of what you pasted, and comparing it to the number of identifiers in the line you meant to copy usually identifies the mistake on its own.

**Fix.** Clear the box and copy the list again — the value of the `DEPLOYMENT_ALLOWLIST=` line in the recipe's **Environment** block on the portal's deployment page, and only that value. The block's **Copy** button copies the whole recipe, not the value.

### `This deployment's configuration is missing …`

> `This deployment's configuration is missing OIDC_AUDIENCE, so the console will not rewrite it — a partial configuration would leave the platform unable to start. Nothing was changed. Regenerate the deployment recipe in the portal.`

**Cause.** Not about the list you submitted — that part was fine. Before it rewrites anything, the console re-checks that every setting a connected deployment needs is present and non-empty, and the message names the ones that are not. It refuses rather than writing a configuration the platform could not start from.

**Fix.** Get a fresh recipe from the portal and reconnect the deployment with it — that means disconnecting first, so read [what disconnecting costs](./CLOUD.md#disconnecting) before you do. Do not repair the configuration by hand; the console validates what it writes and a hand edit gets none of those checks.

### `This deployment's recipe predates team identifiers`

> `This deployment's recipe predates team identifiers, so the console cannot tell which team it belongs to — and without that it will show neither the team nor who may sign in. Nothing was changed. Regenerate the deployment recipe in the portal and reconnect — see what disconnecting costs before you do.`

**Cause.** Permanent, and not an outage. The **Who may sign in** card lists your team by asking the cloud for the members of the team this deployment belongs to, and a deployment connected with an older recipe does not carry its team. The console refuses to guess — a team it cannot name is not shown as an empty one — and it refuses to show the deployment's own list either, for the same reason. Waiting will not help, and it is not about you.

**Fix.** Get a fresh recipe from the portal, then disconnect, apply it, and connect again — read [what disconnecting costs](./CLOUD.md#disconnecting) first. Until then the card offers a paste box beneath this sentence, and on this deployment you replace the list by pasting it — the value of the recipe's `DEPLOYMENT_ALLOWLIST=` line, from the portal's deployment page: [Cloud → When the deployment names no team](./CLOUD.md#when-the-deployment-names-no-team).

### `The console could not fetch this team's roster from the content service`

> `The console could not fetch this team's roster from the content service. Nothing was changed. Wait a moment and try again.`

**Cause.** The card asked the cloud for your team's members and got no usable answer — the service unreachable, busy, or a reply the console does not recognise. It refuses rather than guessing, because "could not fetch" and "nobody is on the team" are one empty list apart, and the wrong one would show every colleague as having left.

**Fix.** Check the machine's network access and click **Try again** on the card in a moment. Nothing was changed, and nothing about the deployment's list has moved.

### `The content service declined to serve this team's roster to this sign-in`

> `The content service declined to serve this team's roster to this sign-in. The console has already confirmed that you administer the team, so the refusal is about the deployment's sign-in configuration rather than about you: a roster is served only to a sign-in made through the team's own deployment. Nothing was changed. If this deployment's configuration was assembled by hand, regenerate the recipe in the portal.`

**Cause.** The cloud serves a team's members only to a sign-in that came through that team's own deployment. The console had already confirmed, on this attempt, that you administer the team — so this is not the *not an administrator* refusal above, and it is not about your role. It is about the sign-in this deployment performed: its configuration names a sign-in client that is not the one the cloud issued for this team, which happens when a configuration was assembled by hand rather than from the recipe the portal issued.

**Fix.** Regenerate the deployment recipe in the portal and reconnect with it — read [what disconnecting costs](./CLOUD.md#disconnecting) first. **Try again** on the card will not change the answer until the configuration does.

### `The content service no longer accepts this tab's cloud sign-in`

> `The content service no longer accepts this tab's cloud sign-in, so the roster could not be fetched. Nothing was changed. Sign in to the cloud again to continue.`

**Cause.** This tab held a cloud credential and the console asked with it, but the cloud no longer accepts it — it has expired since the tab was signed in. It is not the reloaded-tab case above, where the tab holds no credential at all; here it held one that has lapsed.

**Fix.** Click **Sign in to the cloud** on the card. The card fetches the team again when you return.

### I need to see who is on the access list

**Cause.** As an administrator of the deployment's team, on a deployment whose recipe names that team, you see it on the **Who may sign in** card: every team member who may sign in is ticked, and every account on the list who is no longer on the team is listed in red beneath them. That is the whole list, split by whether the account is still on the team. Two cases are left where the console cannot show it: you are not an administrator, and the deployment names no team — there an apply answers with a count and never with the accounts, so after replacing the list there is no way, in the browser, to answer *did I drop someone?*

**Fix.** In those two cases, read it on the host. You are already there to run `./byodt restart platform`; from the bundle directory:

```sh
grep DEPLOYMENT_ALLOWLIST mode/mode.env
```

It is one line, comma-separated:

```
DEPLOYMENT_ALLOWLIST=<account>,<account>,<account>
```

That is what the platform will admit at its **next** start. Until you restart it, the platform is still running the list it read when it last started — so during that window this line and the deployment's live behaviour differ, which is the point of the restart.

**Read it, do not edit it.** The console is the author of that file and validates everything it writes; a hand edit gets none of those checks, and a connect or a disconnect replaces the file whole, so it would not survive one anyway. If the list is wrong, fix it from the console: [Cloud → Changing who may sign in](./CLOUD.md#changing-who-may-sign-in). See also [Configuration → The mode layer](./CONFIGURATION.md#the-mode-layer-modemodeenv).

### A colleague signs in and sees `This deployment does not admit your account`

> **This deployment does not admit your account** — Your sign-in worked as *(the account)*, but this deployment is not set up to let that account in. Who may sign in is chosen by an administrator of the team this deployment belongs to, on the deployment's console. Ask them to add you — the change takes effect when the platform is restarted — then check again.

**Cause.** Not a fault. The person's sign-in with your identity provider succeeded, and the platform then refused the account because it is not on this deployment's access list — the list the platform read when it last started. The platform shows this page, with **Check again** and **Sign out** buttons, instead of the app; it does not send them back to sign in, because signing in again would succeed again and change nothing. Either the account was never ticked on the **Who may sign in** card, or it was ticked and the platform has not been restarted since. An expired sign-in is not a cause: the app renews it silently, or sends the person to the ordinary sign-in if it cannot, and shows this page only when a freshly renewed sign-in is refused as well. (An earlier release could show this page to someone whose sign-in had just expired, and **Check again** then let them in; if that is what a colleague describes, updating the platform ends it.) An older platform showed the same refusal differently: the app shell loaded and every page said *Failed to load models. Please try again.* — a retry that could never succeed. If a colleague reports that instead, the cause is the same one.

**Fix.** If they should have access, tick their row on the **Who may sign in** card and click **Apply** — or, on a deployment that names no team, paste a list that includes them — then run `./byodt restart platform`. Until the restart, the platform goes on refusing them; the card's **Restart required to apply your changes** banner is there to say so. After it, they click **Check again** and reach the app on the same sign-in. If they are not on your team, add them in the portal first; the card lists only current members. See [Cloud → Someone the list does not admit](./CLOUD.md#someone-the-list-does-not-admit).

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
