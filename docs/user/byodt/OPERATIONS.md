---
title: 'Operating the BYODt Deployment'
description: 'The byodt command reference and the day-to-day tasks: start, stop, inspect, back up, restore, TLS, upgrade, remove'
category: 'documentation'
position: 4
navigation: true
tags: ['byodt', 'deployment', 'operations', 'backup', 'tls', 'upgrade', 'cli']
---

# Operating the BYODt Deployment

`byodt` is the deployment's control script and the whole operator interface. It wraps your container engine's `compose` command, carries the configuration and secret files every operation needs, and gives the common tasks plain names.

Run it from the bundle directory. It always operates on the bundle it lives in, so `/path/to/byodt-X.Y.Z/byodt status` works from anywhere.

---

## Command reference

```sh
./byodt help
```

| Command | What it does |
|---|---|
| `./byodt setup` | The first run: ask for the settings, show the third-party notice, and write `.env`. See [Installation → Set up with `./byodt setup`](./INSTALLATION.md#set-up-with-byodt-setup). |
| `./byodt up` | Start the deployment, and apply configuration changes. Performs first-run setup if needed. |
| `./byodt down [--take-over]` | Stop the deployment. Data is kept. `--take-over`: see [A deployment in another folder](#a-deployment-in-another-folder). |
| `./byodt restart [service]` | Recreate the containers to apply a change — all of them, or one named service. |
| `./byodt status` | Show the state of every service. |
| `./byodt logs [service]` | Follow the logs — all services, or one. |
| `./byodt update` | Pull the pinned images and apply them. |
| `./byodt upgrade [VERSION]` | Move to a newer release, the latest by default. See [Upgrading to a new release](#upgrading-to-a-new-release). |
| `./byodt models pull` | Download and verify the embedding model's weights into `data/models` ahead of the first start. |
| `./byodt backup [dir]` | Back up the graph and copy it out. Defaults to `backups/`. On Neo4j the database stops while it is dumped. |
| `./byodt restore <file>` | Replace the graph from a backup. Asks you to confirm. |
| `./byodt bootstrap` | First-run setup only: directories, database password, mode layer. `up` does this for you. |
| `./byodt destroy [--take-over]` | Remove the containers and the network. Data on disk is kept. |
| `./byodt console` | Print the console URL, and open it where the platform supports that. |
| `./byodt tls generate [hostname]` | Generate a self-signed front-door certificate. |
| `./byodt tls status` | Show the installed certificate, or report that there is none. |
| `./byodt notice [--all]` | Print the third-party notice, without asking. `--all`: for both databases. |
| `./byodt acknowledge` | Show the third-party notice and record your confirmation. See [Installation → The third-party notice](./INSTALLATION.md#the-third-party-notice). |
| `./byodt version` | Show the control script's version and the pinned release set. |
| `./byodt compose [args]` | Run your engine's `compose` with this bundle's configuration and compose files. |

Several commands accept a familiar alias: `start`, `stop`, `ps`, `pull`, `init`, `nuke`, `open`. They do exactly what the primary name does. `upgrade` is no longer an alias of `update`: it is a command of its own.

`setup`, `up`, `update`, `upgrade`, `restart`, `models pull` and `acknowledge` take `--yes`: ask nothing, and count the third-party notice as confirmed. It is printed either way.

`byodt` names itself in its messages the way you ran it: `./byodt …` from the bundle directory, or the path you used.

**Service names**, for the commands that take one:

```
db   console-init   platform   proxy   console
```

---

## Starting and stopping

```sh
./byodt up        # start (and apply any configuration change)
./byodt down      # stop; everything on disk is kept
```

`up` is safe to run at any time. On a fresh bundle it performs first-run setup; on a running deployment with nothing changed it does nothing; after an edit it recreates whatever the change affected.

`down` stops and removes the containers and leaves your data, configuration, and images alone. `./byodt up` brings the deployment back exactly as it was.

> **Flags that delete data are refused.** `down` and `destroy` reject `-v`, `--volumes`, and `--rmi` rather than passing them through, so a reflexive `down -v` cannot wipe a graph stored in a named volume. Safe flags still work.

### A deployment in another folder

Every bundle's deployment has the same compose project name, `dethernety`, so two bundle folders on one host would act on the same containers, and, with a named volume, on the same graph. `byodt` therefore checks, before `up`, `update`, `restart`, `down`, `stop`, `destroy`, `backup`, `restore`, `upgrade` and `setup --start` act, that no other folder runs or ran this project. When one does, it names that folder and changes nothing:

```
error: this bundle's compose project is already used by another directory:
    /home/you/dethernety-old
Running this here would act on its containers. Upgrade that deployment instead ('./byodt upgrade' in it), or
stop it there ('./byodt down'). If this deployment was moved here from that directory, run './byodt down --take-over'
here once to remove the old containers, then start it here.
```

- **Two deployments, on purpose:** only one can run at a time. Stop the other one in its own folder (`./byodt down` there), then start this one.
- **You moved the deployment here** (copied or renamed its folder): the old containers still carry the old folder's path. Remove them once from here, then start here:

  ```sh
  ./byodt down --take-over
  ./byodt up
  ```

  `destroy --take-over` does the same and prints the wipe commands, as `destroy` does. `--take-over` removes the project's containers whichever folder started them, so do not use it while another deployment you want to keep is running.

## Applying a change

Which command applies a change depends on what you changed. The full table is in [Configuration → How to apply a change](./CONFIGURATION.md#how-to-apply-a-change). In short:

```sh
./byodt up                    # after editing .env, or the proxy login in .env.secrets
./byodt restart               # after connecting or disconnecting the cloud
./byodt restart platform      # after mounting or unmounting a content module, or updating the knowledge graph
./byodt restart proxy         # after adding, replacing, or removing a certificate
./byodt restart db            # after changing DB_DATA, SNAPSHOT_INTERVAL_SEC, or a NEO4J_DATA/_HEAP_SIZE/_PAGECACHE_SIZE
./byodt restart platform console   # after replacing proxy-ca/proxy-ca.pem, the outbound proxy's CA
```

Naming a service recreates only that service, not its dependencies — `./byodt restart proxy` re-reads the front-door configuration without bouncing the database underneath it. The service called `proxy` is the front door; the outbound proxy, if you use one, is set in `.env` (see [Configuration → Outbound proxy](./CONFIGURATION.md#outbound-proxy)).

## Inspecting the deployment

### Service state

```sh
./byodt status
```

Shows every running service with its state and health. A healthy deployment shows `db`, `platform`, `proxy`, and `console` running, with `db`, `platform`, and `proxy` healthy. `console-init` is a one-shot, so plain `status` does not list it once it has exited; add `-a` to see it:

```sh
./byodt status -a
```

Its line should read `Exited (0)` — exiting is what success looks like.

### Logs

```sh
./byodt logs                  # everything, interleaved
./byodt logs platform         # one service
./byodt logs console-init     # the first-run one-shot: schema, modules, ingest
./byodt logs db
```

Logs are followed. `Ctrl-C` stops the stream and nothing else.

### The pinned release

```sh
./byodt version
```

```
byodt 1.4.0
Pinned release (from .env):
  PLATFORM_VERSION=X.Y.Z
  DB_IMAGE=…
  PROXY_IMAGE=…
  DB_ENGINE=memgraph
```

The first line is the control script's own version, which is independent of the platform release. The rest is exactly what this deployment is pinned to, in the order the lines appear in `.env`. On Neo4j `byodt` records `NEO4J_IMAGE` in `.env` on the first run; before that, it adds the image `byodt` would use, marked as the tested image, not set in `.env`.

The console image is not listed, because it follows `PLATFORM_VERSION` rather than being pinned separately. It appears here only if you have uncommented `CONSOLE_IMAGE` to point at a mirror. A leftover `OLLAMA_IMAGE` line from an older release is not listed: this bundle no longer uses it.

### The console

```sh
./byodt console
```

Prints the console address and opens it where the platform supports that. The console reports the deployment's health, what the one-shot placed, whether the platform registered it, and whether any change is waiting to be applied. It runs outside the request path and has no dependency on the rest of the deployment, so it can still report while the platform is down.

---

## The embedding model

The platform embeds in process with its built-in model, EmbeddingGemma 300m (`embeddinggemma-300m-retrieval-v1`). Its weights (about 1.26 GB) live in `data/models`. The platform downloads them once from Hugging Face, on its first start, and verifies each file's sha256; every later start loads them from disk.

To download them ahead of a start — on a fresh install, or before an upgrade — run:

```sh
./byodt models pull
```

It runs the platform's own download code in a one-off platform container, with no database, so the stack can be up or down. It prints the model's size and its licence (the [Gemma Terms of Use](https://ai.google.dev/gemma/terms)), downloads only what is missing or fails verification, and ends with `Ready` once the weights are in place. `Ctrl-C` stops it without keeping a partial file; run it again to continue. If `.env` still sets `EMBEDDING_MODEL=embeddinggemma`, `byodt` stops it first with its own check, the one `./byodt up` and `./byodt update` run, and tells you to remove the line; any other value the platform would not run is refused by the download code, with the platform's message. It exits `0` once the weights are in place, `1` on a refusal or failure, and `130` when stopped. Behind an outbound proxy it downloads through the proxy `.env` names, with the platform's login and CA, so it is also the quickest test of that setting; a failure names the host that failed.

While the platform is downloading or loading the model, `/health` reports `degraded` and class and technique matching uses names; see [Troubleshooting → Matching uses names after a start](./TROUBLESHOOTING.md#matching-uses-names-after-a-start).

---

## Backing up and restoring the graph

### What a backup is

What `./byodt backup` does depends on the database engine:

- **Memgraph:** it asks the database for a fresh, consistent snapshot — taken hot, with no downtime — and copies that file out of the container to a durable location.
- **Neo4j:** Neo4j Community dumps an offline database only. `byodt` makes a private working directory for the dump, stops `db`, dumps the graph with `neo4j-admin` in a one-off container, copies the dump out, removes the directory, and starts `db` again — also when the stop or the dump fails. The platform loses its database connection meanwhile; plan the backup for a quiet moment.

A backup is the **graph only**: every model, finding, control, and the reference corpus. It does **not** contain the database password, which is separate state. Two consequences:

- You can move it between machines, and it restores cleanly onto any deployment **of the same version and engine**. Each engine refuses the other's backup file.
- It is not a secret-bearing file in the credential sense — but it is your entire threat-modelling estate, so keep it private.

### Taking one

```sh
./byodt backup                    # Memgraph → backups/byodt-snapshot-<version>-<timestamp>.snapshot
                                  # Neo4j    → backups/byodt-dump-<version>-<timestamp>.dump
./byodt backup /path/to/archive   # write somewhere else
```

On Memgraph:

```
==> Requesting a snapshot…
==> Backup written: backups/byodt-snapshot-X.Y.Z-20260814-101112.snapshot (12M)
==> The whole graph is in here (no password) — keep it private and copy it off-box so it survives losing this machine.
```

On Neo4j:

```
==> Stopping the database — Neo4j Community dumps an offline database…
==> Dumping the graph…
    …neo4j-admin output…
==> Starting the database again…
==> Backup written: backups/byodt-dump-X.Y.Z-20260814-101112.dump (12M)
==> The whole graph is in here (no password) — keep it private and copy it off-box so it survives losing this machine.
```

The filename records the version the backup was taken on, which is what lets `restore` warn you about a mismatch later. The file is readable by you only: a Memgraph snapshot is narrowed to you once it is copied out, and a Neo4j dump is created that way. On a file system that does not keep modes, `byodt` warns: `Could not make … private to you (its file system may not keep modes); keep it where only you can read it.`

The database must be running and reachable when you start a backup — the command probes it first and stops with a clear message if it is not. `backup` and `restore` also refuse to act on a deployment another folder runs; see [A deployment in another folder](#a-deployment-in-another-folder).

On Memgraph under Podman, `backup` and `restore` copy the snapshot with `podman cp`, so they work with `podman-compose` as with Docker Compose.

On Neo4j the dump goes through a private working directory that `byodt` makes in the bundle root for each backup or restore — `.byodt-dump.XXXXXX`, mode `0700`, owned by you — and mounts into the one-off `neo4j-admin` container only. It is removed when the command ends, also on failure. The dump never passes through `data/`.

> **Copy backups off this machine.** A backup sitting next to the data it protects is lost with the machine. This is the single most valuable thing on this page.

### Automatic snapshots are not backups

Memgraph also writes in-place snapshots every `SNAPSHOT_INTERVAL_SEC` seconds (default 300) for crash recovery. They live inside the data directory and are pruned over time by the database's own retention. They protect you from a crash; they do not protect you from losing the disk, the directory, or the machine. Use `./byodt backup` for anything you want to keep.

### Restoring

```sh
./byodt restore backups/byodt-snapshot-X.Y.Z-20260814-101112.snapshot   # Memgraph
./byodt restore backups/byodt-dump-X.Y.Z-20260814-101112.dump           # Neo4j
```

**This replaces the current graph.** All current graph data is cleared, and the backup takes its place. The command:

1. Refuses a backup made by the other engine: a `.dump` on Memgraph, a `.snapshot` on Neo4j.
2. Warns first if the filename says the backup was taken on a different version than this deployment runs — a backup may not load across versions.
3. Warns you that the current graph will be cleared, and asks you to type `restore` to confirm. Anything else aborts and changes nothing.
4. On **Memgraph**, requires the database to be running, stages the file into the database container, and applies it.
5. On **Neo4j**, copies the file into a private working directory (as for a backup), stops `db`, loads the dump with `neo4j-admin` in a one-off container that mounts the directory read-only, removes the directory, and starts `db` again — also when the load fails. The platform loses its database connection meanwhile.

Your configuration and the database password are untouched, so the restored graph opens with this deployment's own credentials.

```
==> Restore complete. If the app still shows old or empty data, run './byodt restart platform'.
```

On Memgraph, if a failure occurs partway, the current graph is left unchanged and the command says so. On Neo4j the load replaces the graph, so a failed load may already have removed the current one: the command stops with `neo4j-admin could not load the dump — see its output above. The load replaces the graph, so the current one may be gone: restore again from a backup you know is good.`, and the database is started again. A failure before the load — staging the file, or stopping `db` — changes nothing.

---

## TLS at the front door

The front door terminates TLS for the **whole deployment** — the platform, the console, and the API all sit behind that one endpoint. By default it serves plain HTTP, which suits a loopback deployment on a machine you trust. Anything else should be encrypted.

Behind the front door, traffic stays plain HTTP on the deployment's isolated internal network. Only the edge is encrypted.

### Check what is installed

```sh
./byodt tls status
```

With no certificate:

```
==> No certificate — the front door serves plain HTTP.
==> Add one with ./byodt tls generate, or drop your own cert.pem + key.pem into tls/, then ./byodt restart proxy (./byodt up if the stack is not running).
```

With one, it prints the certificate's subject, issuer, and validity dates.

### Generate a self-signed certificate

```sh
./byodt tls generate                    # for this machine's hostname
./byodt tls generate deployment.example # for a name you choose
```

This writes `tls/cert.pem` and `tls/key.pem` — an RSA certificate valid for two years, carrying `localhost`, the hostname you gave, and `127.0.0.1` as subject alternative names. `openssl` must be available on the host.

A self-signed certificate encrypts the connection and makes the browser treat the page as a secure context. It does **not** attest identity: browsers will warn, and you will have to accept it. That is expected and, for a deployment you run yourself, usually fine.

### Use your own certificate

Put your `cert.pem` and `key.pem` into `tls/`. No naming choice — the front door looks for exactly those two filenames.

### Apply it

```sh
./byodt restart proxy
```

The front door re-reads the `tls/` directory when its container is recreated, and switches to HTTPS if both files are present. The published port does not change: `https://127.0.0.1:3000` where it was `http://` before.

> `./byodt console` and the messages from `./byodt up` always print an `http://` address. With a certificate installed, browse to the same address over `https://` instead.

### Go back to plain HTTP

```sh
rm tls/*.pem
./byodt restart proxy
```

### A secure context is required for cloud sign-in

Browsers only expose the cryptography the cloud sign-in flow needs on a secure context — HTTPS, or a `localhost` address. If you reach the deployment by any other address and try to sign in, the console tells you so and names this step. See [Cloud](./CLOUD.md).

---

## Upgrading to a new release

A release moves as one unit: the platform image, the console image, and the module payloads all follow `PLATFORM_VERSION`. The graph database image is the exception: an upgrade leaves `DB_IMAGE`, or `NEO4J_IMAGE` on Neo4j, where it is, unless you choose to move the database.

`./byodt upgrade` does the whole upgrade: it downloads and checks the new release, backs up, moves the new files in, brings `.env` into line, applies the release, and waits until it is healthy. The new release's [installer](./INSTALLATION.md#install-with-the-installer) does the same with `--upgrade`. A deployment on 0.12.x or 0.13.0 has no `./byodt upgrade` yet; see [Upgrading from 0.13.0](#upgrading-from-0130) and [Upgrading from 0.12.x](#upgrading-from-012x). To do it all yourself instead, see [Upgrading by hand](#upgrading-by-hand).

### Upgrade with `./byodt upgrade`

From the deployment's folder:

```sh
./byodt upgrade            # to the latest release
./byodt upgrade X.Y.Z      # to a given release
```

Or run the new release's installer, which finds the deployment, or takes it from `--dir`:

```sh
VERSION=X.Y.Z
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/get-byodt.sh" \
  | sh -s -- --upgrade --dir /path/to/your/deployment
```

Both end in the same place: the new release's own `byodt` does the work from the third step below on. The installer downloads through your shell's `HTTPS_PROXY`; `./byodt upgrade` downloads through the proxy `.env` names, with the login from `.env.secrets`. A TLS-inspecting proxy's CA must then be in the host's trust store: `proxy-ca/` reaches only the containers.

**Before you start:**

- **The database must be running**, because the upgrade backs up the graph first. If it is not, the upgrade stops with `The database is not running, so the graph cannot be backed up first. Start it ('./byodt up'), or add --skip-graph-backup. Nothing was changed.`
- **At least 2048 MiB free** in the deployment's folder, for the new images and the backups.
- **The network**, as for the first start: the release assets on `github.com`, the new images, and new model weights if the release changed the model (see [Installation → Network access for the first start](./INSTALLATION.md#network-access-for-the-first-start)). The container engine pulls with its own proxy setting.
- **Copy the previous backups off the machine.** The upgrade takes its own backup, on the same machine.

### What an upgrade does

In this order. Nothing in the deployment changes before step 5.

1. **Finds the release.** It reads the version and the bundle's SHA-256 from that release's `get-byodt.sh`, as data, never run. With no version, it takes the latest release, which is never a pre-release.
2. **Downloads and checks the bundle** into a private staging folder inside the deployment, `.byodt-upgrade.XXXXXX`: over HTTPS only, at most 50 MiB, with the SHA-256 the release published, and with cosign, its signature (see [Signatures](#signatures)). Then it hands over to the new release's own `byodt`.
3. **Checks everything first**, with the new release's code: the files the old release shipped, against the record of them (a file you edited stops the upgrade unless you add `--replace-edited`, if the new release ships it too; 0.12.x keeps no record, see [Upgrading from 0.12.x](#upgrading-from-012x), but every upgrade writes one, so the upgrades after it find your edits); the `.env` changes; a `CONSOLE_IMAGE` pin; that no other folder runs this deployment; the free disk; and that the database answers.
4. **Asks every question at once.** It shows what it will do, then asks `Upgrade from A to B? [y/N]`, then about each change below, and shows the [third-party notice](./INSTALLATION.md#the-third-party-notice) if the new release changes what you confirmed, or if there is no record of a confirmation yet, as on every deployment coming from 0.12.x or 0.13.0. Nothing is asked after this.
5. **Backs up** into `backups/upgrade-A-to-B-<time>/`, a folder only you can read:
   - the graph, taken by the current release's own `./byodt backup`;
   - `.env`, as `env.before-B`, and the release record `.byodt-release`, as `byodt-release.before-B`;
   - every file the old or the new release ships, as it is here, your edits included, as `bundle-files-A.tar.gz`.

   `.env.secrets` is not copied: the upgrade leaves it alone.
6. **Moves the new files in**, by rename, keeping a journal so an interruption can be resumed or undone. `byodt` itself goes first. Files the new release no longer ships stay where they are, as they are, and are listed for you to remove.
7. **Brings `.env` into line** with the new `.env.example`, as you answered:
   - `PLATFORM_VERSION` is set to the new release;
   - a setting the new release adds is appended, with its comment, as `.env.example` ships it;
   - a default the new release changed is taken only where your value is still the old default;
   - a setting the new release no longer uses is commented out, with `# no longer used since B` after it;
   - a `CONSOLE_IMAGE` pinned to the old release is retagged to the new one;
   - the database image (`DB_IMAGE`, or `NEO4J_IMAGE` on Neo4j) changes only if you chose to move the database: `--move-db`, or `y` to `Also move the database to …?`.

   Except as above, it never changes `CONSOLE_IMAGE`, `DB_ENGINE`, `DB_DATA`, `DB_IMAGE`, any `NEO4J_*` setting, `CONTAINER_ENGINE`, `FRONT_DOOR_*`, `HTTPS_PROXY`, `NO_PROXY` or `UPGRADE_REQUIRE_SIGNATURE`. It also writes the new release record and, if you confirmed it, the notice's record.
8. **Applies the release** with `./byodt update`: it pulls the new images and recreates the deployment.
9. **Waits until it is healthy**: the platform and the front door healthy, and the console running, for up to `--health-timeout` seconds (1200 by default), with a progress line every 30 seconds.
10. **Prints the result** and the exact [rollback steps](#rolling-back-an-upgrade).

A run, trimmed:

```
==> Upgrading from A to B.
==> SHA-256 matches release B.
==> Signature verified: the release workflow of dether-net/dethernety-oss at vB signed it.
==> Upgrade from A to B:
==>   new files: …
Upgrade from A to B? [y/N] y
==> Backing up the graph with release A's own byodt…
==> Backup written: backups/upgrade-A-to-B-20261101T182842Z/byodt-snapshot-A-20261101-182844.snapshot (15M)
==> Backed up into backups/upgrade-A-to-B-20261101T182842Z.
==> Release B's files are in place.
==> Applying release B…
==> Pulling the pinned images…
    …your container engine's pull and start output…
==> Updated.
==> Waiting for release B to be healthy (up to 1200 seconds)…
==>   platform: starting, front door: healthy, console: running
==> Healthy.
==> Upgraded from A to B. The backup is in backups/upgrade-A-to-B-20261101T182842Z.
==> To roll back later (everything since the backup is lost):
  …the rollback steps…
```

### Options

`./byodt upgrade --help` lists them. On the installer's command line they are passed on to the upgrade, except `--allow-unsigned` and `--require-signature`, which the installer applies itself, to its own check of the bundle (see [Installation → Options](./INSTALLATION.md#options)).

| Option | What it does |
|---|---|
| `--yes` | Ask nothing: confirm the upgrade, accept every `.env` change, and count the third-party notice as confirmed. It never moves the database, and never implies `--allow-unsigned`. |
| `--move-db` | Also move the database to the image the new release was tested with. One-way, and only after the graph backup: the upgrade refuses it with `--skip-graph-backup`. |
| `--replace-edited` | Go ahead although files the release shipped were edited here. They are replaced, and kept in the backup. |
| `--skip-graph-backup` | For when the database is not running: go on without backing up the graph. The rest of the backup is still taken, and the database is not moved. |
| `--require-signature` | Refuse unless cosign verifies the new release. `UPGRADE_REQUIRE_SIGNATURE=true` in `.env` does the same for every upgrade. |
| `--allow-unsigned` | Go ahead without a signature check when cosign is not installed, without asking about the signature. The SHA-256 is still checked, but it comes from the same release, so it shows the download is intact, not who made it. A signature cosign rejects always stops the upgrade. Refused when `.env` sets `UPGRADE_REQUIRE_SIGNATURE=true`, and contradicts `--require-signature`. |
| `--health-timeout SECS` | How long to wait for the new release to be healthy. Default 1200. |
| `--abandon` | Drop an interrupted upgrade: undo a half-done move, or print the rollback steps. See [If an upgrade stops](#if-an-upgrade-stops). |

**Local changes belong in `compose.override.yaml`**, which no release ships, so an upgrade never touches it. A shipped file you edited stops the upgrade before it changes anything, when the new release ships it too:

```
error: These files here are not release A's as shipped: compose.yaml. An upgrade replaces them. Local changes belong in compose.override.yaml, which no bundle ships; move them there, or add --replace-edited (they are kept in the backup). Nothing was changed.
```

**Moving the database.** When the new release was tested with another database image than yours, the summary says so, and at a terminal the upgrade asks `Also move the database to …? This cannot be undone; the backup comes first. [y/N]`. `--move-db` answers yes; `--yes` alone answers no. A newer database writes data an older one cannot open, which is why the rollback steps then move the data aside.

### Signatures

The SHA-256 is always checked. What happens next depends on cosign:

| Situation | What the upgrade does |
|---|---|
| cosign installed, and it verifies the bundle against the release's exact identity | Goes on: `Signature verified: the release workflow of dether-net/dethernety-oss at vB signed it.` |
| cosign installed, and it does not verify | Stops, with cosign's output: `cosign could not verify the new bundle's signature against release B's identity (above). Nothing was changed.` |
| No cosign, at a terminal | Warns that the bundle's authenticity was not checked, and asks `Use it anyway? [y/N]`, unless you pass `--allow-unsigned`. The installer asks `The bundle's signature was not verified. Upgrade with it anyway? [y/N]`. |
| No cosign, unattended (`--yes`, or no terminal) | Refuses, unless you pass `--allow-unsigned`. The installer says `cosign did not verify the bundle, and an unattended upgrade does not run code it cannot verify.`, then the same two ways forward. |
| No cosign, and a signature is required | Refuses, whatever else you pass. |

The unattended refusal names both ways forward:

```
error: cosign is not installed, so the bundle's signature was not checked, and an unattended upgrade does not run code it cannot verify. Install cosign (https://github.com/sigstore/cosign), or pass --allow-unsigned knowingly. Nothing was changed.
```

Install cosign, or pass `--allow-unsigned` once you have decided that the SHA-256 alone is enough. It comes from the same release as the bundle, so it shows the download is intact, not who made it. At a terminal, `--allow-unsigned` also skips the question. `--yes` never implies `--allow-unsigned`: an unattended upgrade runs code it cannot verify only when you said so. No flag makes an upgrade use a bundle whose signature cosign rejects.

**Requiring a signature.** `--require-signature`, or `UPGRADE_REQUIRE_SIGNATURE=true` in the deployment's `.env` (see [Configuration → Upgrades](./CONFIGURATION.md#upgrades)), refuses any bundle cosign did not verify, including when cosign is not installed. With the `.env` setting, `--allow-unsigned` is refused before anything is downloaded. `./byodt upgrade` refuses `--require-signature` and `--allow-unsigned` together. A value other than `true` or `false` stops the upgrade before anything is downloaded too: `.env sets UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false. Nothing was changed.` Because `.env` may hold it, an upgrade run by an account that cannot read `.env` stops: `byodt cannot read .env, which may require a signature (UPGRADE_REQUIRE_SIGNATURE). Run the upgrade as the account that owns it. Nothing was changed.`

**`curl`, else `wget`.** The upgrade downloads with `curl` when it is installed. `wget` cannot hold a download to HTTPS, so a download through it counts as transport that is not guaranteed HTTPS; without cosign, the refusal says so. The SHA-256 and the signature rule apply the same way.

### Without a terminal

An upgrade asks before it changes anything. From a script, add `--yes`, and name the version: `./byodt upgrade` with no version moves to the latest release, which it does unattended only with `--yes` too.

```sh
./byodt upgrade X.Y.Z --yes
```

Without `--yes` and without a terminal, it stops: `An upgrade asks before it changes anything. Without a terminal, add --yes. Nothing was changed.`

### If an upgrade stops

An interrupted upgrade (a lost connection, a closed terminal, a failed pull, a reboot) is resumed by running the same command again:

```sh
./byodt upgrade
```

It reads where it stopped from its journal, `.byodt-upgrade.state`, and goes on from there:

| Where it stopped | What `./byodt upgrade` does |
|---|---|
| Before the files moved (nothing changed but a backup) | Starts over, to the same release, with the options the interrupted run was given (such as `--move-db` or `--health-timeout`), then any you give now. A `--health-timeout` given now wins. |
| While the new files were moving in | Asks `The new files were being moved in. Finish moving them in (y), or put the old ones back (n)? [Y/n]`. Without a terminal, `--yes` finishes the move, and `./byodt upgrade --abandon` puts the old files back. |
| After the files moved | Finishes: `.env`, the apply, and the health check. |

While the new files are in place but not yet applied, `./byodt up`, `update` and `restart` refuse, so that nothing starts the new files with the old `.env`:

```
error: An upgrade to B is half done (phase moved). Finish it with './byodt upgrade', or undo it with './byodt upgrade --abandon'.
```

In the other phases they only warn that an upgrade is pending.

They also stop, in any phase, when `.byodt-upgrade.state` is not a regular file owned by you (or root) with mode 600, since it names folders an upgrade moves and removes:

```
error: .byodt-upgrade.state is not this deployment's own (a link, another account's, or readable by others); byodt does not act on it. Check it, and remove it to drop the upgrade.
```

**When the apply or the health check fails**, the upgrade stops and prints the rollback steps:

- `Applying B failed (above). If the pull failed, the old containers are still running. Fix what it names and run './byodt upgrade' to go on, or roll back:` and the steps. A failed pull leaves the running deployment as it was.
- `Release B did not report healthy within 1200 seconds. Still starting? './byodt upgrade' checks again. To go back instead (everything since the backup is lost):` and the steps. A first start that re-ingests data or downloads the model can take longer than the timeout; run `./byodt upgrade` again to wait some more.

**Dropping an upgrade** with `./byodt upgrade --abandon`:

| Where it stopped | What `--abandon` does |
|---|---|
| Before the files moved | Removes the staging folder and the journal. The backup stays. |
| While the files were moving in | Puts the old files back, then drops the upgrade. |
| After the files moved | Prints the rollback steps, and asks `Drop the upgrade's state now (you run the steps above)? [y/N]`. Dropping it undoes nothing: the steps do. With `--yes`, it drops it without asking. |

Only one upgrade runs at a time: a second one stops with `Another upgrade is running here (.byodt-upgrade.lock, process …). Wait for it. If none is running, remove .byodt-upgrade.lock (and .byodt-upgrade.lock.takeover, if it is there) and run the command again.` A lock whose process has ended is taken over, under a second lock, `.byodt-upgrade.lock.takeover`, so that only one upgrade takes it over. A lock that names no process yet counts as held.

### Rolling back an upgrade

An upgrade prints the exact steps that take the deployment back to the release before it, from its backup, at the end and whenever it stops after the files moved. Keep them, and keep the backup folder. **Everything created since the backup is lost.**

```
==> To roll back later (everything since the backup is lost):
  cd '/path/to/your/deployment'
  ./byodt down
  rm -f <a file B added>
  tar -xzf backups/upgrade-A-to-B-20261101T182842Z/bundle-files-A.tar.gz --strip-components=1
  cp -p backups/upgrade-A-to-B-20261101T182842Z/env.before-B .env
  cp -p backups/upgrade-A-to-B-20261101T182842Z/byodt-release.before-B .byodt-release
  ./byodt update
  ./byodt restore backups/upgrade-A-to-B-20261101T182842Z/byodt-snapshot-A-20261101-182844.snapshot
  ./byodt restart platform
```

- **They start with a `cd`** into the deployment's folder; run them in order, from there. When the upgrade stopped partway, `./byodt upgrade --abandon --yes` comes next: it drops the upgrade's journal before the files go back.
- **The `rm -f` lines** remove the files the new release added, one line each, so that the unpack brings back exactly what was there before, your own files included.
- **The release record** is put back from the backup, or removed (`rm -f .byodt-release`) when the old release had none.
- **After `--move-db`** a line moves the newer database's data aside (with the default `DB_DATA`, `mv ./data/memgraph ./data/memgraph.moved-B`), or removes its named volume, because the older database cannot open it.
- **`./byodt restore` asks you to type `restore`** before it replaces the graph.
- **After `--skip-graph-backup`** the restore line reads `(no graph backup was taken)`: restore a backup of your own, if you took one.

### Same version and downgrades

An upgrade only moves forward:

- **The same release:** `Already on A. './byodt update' applies it again.` The installer says `The deployment in … already runs release A; '…/byodt update' applies it again.`, or, for a folder that was set up but never started, `The deployment in … already holds release A, and has not been started yet; '…/byodt up' starts it.`
- **An older release:** `B is older than A: a downgrade is a rollback, not an upgrade. Roll back with the steps the upgrade to A printed, from its backup.`

Nothing is changed either way.

### Upgrading from 0.13.0

Release 0.13.0's `byodt` has no upgrade: its `./byodt upgrade` is another name for `update`. It ignores the version, pulls 0.13.0's images again, and stays on 0.13.0:

```
$ ./byodt upgrade X.Y.Z
==> Pulling the pinned images…
    …
==> Applying…
    …
==> Updated.
```

To upgrade a 0.13.0 deployment, run the new release's installer with `--upgrade`, naming the deployment's folder:

```sh
VERSION=X.Y.Z
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/get-byodt.sh" \
  | sh -s -- --upgrade --dir /path/to/byodt-0.13.0
```

The new release's `byodt` then does everything [described above](#what-an-upgrade-does). It knows the files 0.13.0 shipped, so your edits are found as on any other release. The graph backup is taken by 0.13.0's own `byodt`, and the rollback steps bring back 0.13.0's, whose `restore` also asks you to type `restore`. From then on, `./byodt upgrade` does the next upgrade.

**If it stops** before the first file moved in, the deployment still has 0.13.0's `byodt`, whose `upgrade` cannot resume it. Run the installer again: it takes the upgrade over, and says `An earlier upgrade stopped before it changed anything; starting this one in its place.` If it stopped later, the new `byodt` is already in place: run `./byodt upgrade` to go on.

### Upgrading from 0.12.x

A 0.12.x deployment upgrades the same way as one on 0.13.0: once, with a release's installer and `--upgrade`, naming the deployment's folder. Release 0.12.x's `./byodt upgrade` is another name for `update` too. You do not need to step through 0.13.0 or 0.14.0 first.

```sh
VERSION=X.Y.Z
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/get-byodt.sh" \
  | sh -s -- --upgrade --dir /path/to/your/deployment
```

**Use the installer of a release later than 0.14.0, not 0.14.0's.** A 0.12.x folder keeps the `db` service in `compose.yaml` and has no `compose.memgraph.yaml`. 0.14.0's installer cannot read that layout before its files move in, so it stops at the database check, although the database is running:

```
error: The database is not running, so the graph cannot be backed up first. Start it ('/path/to/your/deployment/byodt up'), or add --skip-graph-backup. Nothing was changed.
```

With a `compose.override.yaml` it also warns, wrongly, that it could not read that file. Nothing is changed. Do not add `--skip-graph-backup` to get past it: run the installer of a release later than 0.14.0 instead.

**One thing differs: edit detection.** 0.12.x keeps no record of the files it shipped, so the new `byodt` cannot tell whether you edited them. It says so, naming your release, and goes on. On 0.12.1:

```
warning: byodt cannot tell whether release 0.12.1's files were edited here (no record of them); any edits are kept in the backup.
```

It then replaces an edited shipped file, such as `compose.yaml`, without asking and without `--replace-edited`. The old file is kept in the upgrade's backup folder, in `bundle-files-<release>.tar.gz` (`bundle-files-0.12.1.tar.gz` on 0.12.1). Before you upgrade, move local changes into `compose.override.yaml`, which no release ships. The upgrade writes the record of the new release's files, so the next upgrade finds your edits again.

Everything else is as [from 0.13.0](#upgrading-from-0130):

- **The graph backup** is taken by 0.12.x's own `byodt`, and the rollback steps bring back 0.12.x's, whose `restore` also asks you to type `restore`.
- **If it stops**, run the installer again, or `./byodt upgrade` once the new `byodt` is in place, as from 0.13.0.
- **The changes 0.13.0 made are done for you.** The new `byodt` records `DB_ENGINE=memgraph` in `.env` on its first run, and the `db` service moves into `compose.memgraph.yaml`, so run the stack through `byodt` only. It warns about an override file with another name, such as `compose.override.yml`; rename it to `compose.override.yaml`.
- **Read the *Upgrading* notes of 0.13.0 and of every later release in the [CHANGELOG](../../../CHANGELOG.md).** An upgrade from 0.12.x skips past them all, and nothing checks the steps they ask of you. 0.13.0's, for example: update each installed module that has a frontend to a version that ships `frontend/frontend-manifest.json`; reload any browser tab left open across the upgrade; a CDN or reverse proxy in front of dt-ws must honour `Cache-Control: private` on `/module-bundles/`, and must not cache it by path.
- **On Memgraph with `podman-compose`**, 0.12.x's graph backup fails as 0.13.0's does. Take the snapshot by hand and add `--skip-graph-backup`; see [Upgrading on Podman](#upgrading-on-podman).

### Upgrading on Podman

On Memgraph with `podman-compose`, this release backs up and restores the graph through `podman cp`, so `./byodt upgrade` works as it does on Docker. On a host that also has Docker, set the Compose provider first; see [Installation → Podman specifics](./INSTALLATION.md#podman-specifics).

**From 0.12.x or 0.13.0, on Memgraph and `podman-compose`**, the upgrade's graph backup is taken by the old release's `byodt`, which copies with `compose cp`, a command `podman-compose` does not have. The upgrade stops there with `Failed to copy the snapshot out of the db container.`, and nothing is changed. Take the snapshot by hand, then upgrade without the graph backup.

1. From the deployment's folder, with the deployment running, take a Memgraph snapshot and copy it out. In `bash`:

   ```sh
   id="$(podman ps -q --filter label=com.docker.compose.project=dethernety --filter label=com.docker.compose.service=db)"
   podman exec -i "$id" sh -c 'FLAGS_password="$MEMGRAPH_PASSWORD" mgconsole --username "$MEMGRAPH_USER" --fromenv=password' <<< 'CREATE SNAPSHOT;'
   snap="$(podman exec "$id" sh -c 'ls -t /var/lib/memgraph/snapshots | head -1')"
   mkdir -p backups && podman cp "$id:/var/lib/memgraph/snapshots/$snap" backups/before-upgrade.snapshot
   ls -l backups/before-upgrade.snapshot
   ```

   The password stays inside the database container: `mgconsole` reads it from the container's own environment. The copy keeps the container file's mode; `chmod 600 backups/before-upgrade.snapshot` makes it readable by you only.

2. Upgrade with the installer, without the graph backup:

   ```sh
   VERSION=X.Y.Z
   curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/get-byodt.sh" \
     | sh -s -- --upgrade --dir /path/to/your/deployment --skip-graph-backup
   ```

   The summary says `the graph is NOT backed up (--skip-graph-backup)`, and the rest of the backup is taken as usual.

The rollback steps of such an upgrade read `(no graph backup was taken)`: the graph to go back to is `backups/before-upgrade.snapshot`. On the new release, `./byodt restore backups/before-upgrade.snapshot` restores it. The old release's own Memgraph `restore` copies with `compose cp` too, so after a rollback to 0.12.x or 0.13.0 it cannot load the snapshot on `podman-compose`.

### Upgrading by hand

Without `./byodt upgrade`, these are the steps. `./byodt upgrade` does all of them, and checks each one first. Two things it does that a hand upgrade does not:

- **The release record.** `.byodt-release` keeps naming the old release, so the next `./byodt upgrade` cannot tell which shipped files you edited. It warns, and keeps any edits in its backup.
- **The third-party notice.** When the new release changes what you confirmed, the next `./byodt update` shows the notice and asks before it pulls.

#### 1. Back up first

```sh
./byodt backup
```

Copy the file off the machine. A backup may not load across versions, so treat it as protection against a failed upgrade, not a guaranteed rollback.

#### 2. Get the new bundle

Download and verify it exactly as in [Installation → Get the bundle](./INSTALLATION.md#get-the-bundle). Behind an outbound proxy, export `HTTPS_PROXY` in your shell first, as on the first install.

> **Note:** An upgrade needs the network again: the new images' layers, the new release's module index and payloads, and new model weights if the release changed the model. The hosts are the ones in [Installation → Network access for the first start](./INSTALLATION.md#network-access-for-the-first-start). Behind a proxy, the container engine pulls with its own proxy setting, as on the first install; on a host with no direct route out, `./byodt update` cannot pull without it. On Docker, `./byodt update` warns before it pulls when the daemon has no proxy. A failed pull leaves the running deployment as it was.

#### 3. Replace the bundle files, keep your own

The tarball contains only the shipped files — the control script, the compose files, the configuration template, the proxy configuration, and the notices. It contains none of your generated files, so unpacking it over your existing bundle directory replaces the former and leaves the latter alone:

```sh
VERSION=X.Y.Z    # the release you are moving to
tar xzf "byodt-${VERSION}.tar.gz" --strip-components=1 -C /path/to/your/bundle
```

Your `.env`, `.env.secrets`, `mode/`, `tls/`, `proxy-ca/`, `data/`, `backups/`, `.byodt-release` and `third-party-acknowledgement.log` are untouched.

#### 4. Bring `.env` into line with the new `.env.example`

`.env.example` is the release manifest. Compare it with your `.env`:

```sh
diff .env .env.example
```

**Set `PLATFORM_VERSION` to the new version.** That is the whole version change — the platform image, the console image, and the module payloads all follow it. Also take any changes to `PROXY_IMAGE`, and read the new file's comments for settings that were added or retired. `./byodt update` never changes your settings in `.env`: it only records a missing `CONTAINER_ENGINE` or `DB_ENGINE` (on Neo4j, `NEO4J_IMAGE` too). Keep your current `DB_IMAGE` (on Neo4j, `NEO4J_IMAGE`, which `byodt` recorded on the first run), even if the new bundle names a newer database, unless you decide to move the database (below).

**The outbound proxy keys.** `.env.example` has an "Outbound proxy" section with `HTTPS_PROXY` and `NO_PROXY`, both commented out; an `.env` carried over from an older bundle has neither. They are optional, as are `HTTPS_PROXY_USERINFO` in `.env.secrets` and the CA file `proxy-ca/proxy-ca.pem`: add them only if the host reaches the internet through a proxy (see [Configuration → Outbound proxy](./CONFIGURATION.md#outbound-proxy)). An older bundle passed no proxy variables to its containers, so an engine that copies your shell's or your Docker client's proxy settings into containers could pass them on. A bundle with these keys sets every proxy variable of its containers explicitly, and uses only what `.env` says.

> **Moving the database to a newer image is your choice, and it is one-way.** A newer database writes data that an older one cannot open, so there is no downgrade. `./byodt up` and `./byodt update` warn when `DB_IMAGE` (or `NEO4J_IMAGE`) differs from the image this bundle was tested with; the warning never blocks the start. To move: back up first — `./byodt backup`, or a copy of the data directory (`data/memgraph` or `data/neo4j`) taken with the deployment down — then set `DB_IMAGE` (or `NEO4J_IMAGE`) to the tested image and run `./byodt update`.

> **If you have uncommented `CONSOLE_IMAGE` to use a mirror**, move its tag to the new version too. The console refuses to serve a platform version it was not built for, so an override left on the old tag aborts the start. Leaving the key commented out — the default — makes this impossible.

#### 5. Apply

```sh
./byodt update
```

This first checks `.env` (see [Upgrading from a release with the `ollama` service](#upgrading-from-a-release-with-the-ollama-service) for what it refuses and what it only notes), then pulls the newly pinned images and recreates the deployment. The one-shot runs again and installs the new release's signed modules; the reference-data ingest is skipped if the corpus has not changed.

If the one-shot refuses the start, `./byodt update` fails with an error that ends `'./byodt logs console-init' says why.` Read that log, fix what it names, and run `./byodt update` again.

#### 6. Verify

```sh
./byodt status
```

Then open the console and confirm: a **Healthy** verdict, every module `placed` or `skipped`, and the init tag under the page heading showing the new version. If anything is off, see [Troubleshooting](./TROUBLESHOOTING.md).

### Upgrading from a release with the `ollama` service

From control script **1.2.0** on, the bundle no longer runs the old `ollama` service: the platform embeds in process. Upgrading a deployment that ran the `ollama` service follows the steps of [Upgrading by hand](#upgrading-by-hand), with these additions.

1. **Back up, and keep what a rollback needs**, as in step 1: `./byodt backup`, and copy the file off the machine. Also save your current `.env`, and keep the previous release's bundle tarball:

   ```sh
   cp .env .env.before-<version>    # <version>: the release you are moving to
   ```

2. **Make room on disk, take the new bundle and set `PLATFORM_VERSION`**, as in steps 2 to 4. The new release needs free disk for the model's weights (about 1.26 GB in `data/models`) plus the new images. Do not count on the space `data/ollama` takes: it can only go after the upgrade has worked (step 7).
3. **In `.env`, remove (or comment out) three lines:**

   ```
   EMBEDDING_MODEL=embeddinggemma
   EMBEDDING_SIMILARITY_THRESHOLD=…
   OLLAMA_IMAGE=…
   ```

   `./byodt up`, `./byodt update` and `./byodt models pull` **refuse** to run while `EMBEDDING_MODEL=embeddinggemma` is set — however it is quoted, exported, or followed by a comment — and tell you to remove the line. Any `OLLAMA_*` line, `EMBEDDING_URL`, and `EMBEDDING_SIMILARITY_THRESHOLD` only get a notice that they are no longer used. Leave `EMBEDDING_MODEL` unset: the platform's default is the model this release's reference data was embedded with.
4. **Optionally, download the model ahead:** `./byodt models pull` (see [The embedding model](#the-embedding-model)). Otherwise the platform downloads it on its first start.
5. **Apply:** `./byodt update`. It removes the old `ollama` container for you (found by its compose labels; its image and `data/ollama` are kept) and starts the new release.
6. **Verify**, as in step 6.
7. **Once the new start has worked, optionally reclaim the disk.** `./byodt up`, `./byodt update` and `./byodt models pull` report a leftover `data/ollama` with its size (typically 0.6–1 GB); `byodt` never deletes it. The old `ollama` service wrote it as root, so `sudo` is usually needed (rootful Docker on Linux):

   ```sh
   sudo rm -rf data/ollama
   ```

   If `data/ollama` is a symbolic link (you had moved the directory elsewhere), `byodt` reports only that it is one, without naming or measuring its target. Check where it points yourself (`ls -l data/ollama`) before you remove anything. The old Ollama image can be removed with your engine's own image commands.

**What the first start after the upgrade does.** It takes longer than a normal start, once:

- The one-shot **re-ingests the MITRE reference data**, because its vectors changed. This takes about a minute, and the platform is not up meanwhile.
- The platform **downloads the model once** (about 1.26 GB), unless `./byodt models pull` placed it.
- It then **embeds every class once, at about 0.2 s per class on a 4-vCPU host: seconds for the bundled modules (about 80 classes, 15–20 s), a few minutes with cloud content packages (about 1,200 classes). Matching uses names meanwhile.** This covers the classes of mounted cloud modules too. `/health` reports `degraded` until the embedder is ready, and turns `healthy` while the classes may still be embedding; see [Troubleshooting → Matching uses names after a start](./TROUBLESHOOTING.md#matching-uses-names-after-a-start).

**Resources.** The platform uses roughly 0.8–0.9 GiB more memory, because it holds the model itself; the `ollama` container it replaces used about as much, so the host's total stays about the same. On disk, `data/models` adds about 1.26 GB, and removing `data/ollama` gives back 0.6–1 GB.

**Rolling back.** This needs what you kept in step 1: the backup, the saved `.env`, and the previous release's bundle tarball. **Anything created since the upgrade is lost**: the restore puts the graph back as it was when you took the backup.

1. Unpack the previous tarball over the bundle directory, as in step 3 of the upgrade.
2. Restore the saved `.env`, with its `EMBEDDING_MODEL` and `OLLAMA_IMAGE` lines: `cp .env.before-<version> .env`.
3. Apply, restore the graph, and recreate the platform:

   ```sh
   ./byodt update
   ./byodt restore backups/<your backup>.snapshot
   ./byodt restart platform
   ```

Keep `data/ollama` until you are sure you will not roll back: the previous release's `ollama` service reads its model from there, and downloads it again without it. After a rollback, `data/models` (1.26 GB) is no longer used and can be removed. Its files are owned by the platform's user (uid 1001) on rootful Docker, so `sudo` is usually needed:

```sh
sudo rm -rf data/models
```

---

## Removing the deployment

### Remove the running deployment, keep the data

```sh
./byodt destroy
```

Removes the containers and the network. **Nothing on disk is deleted** — not your data, not your configuration, not your certificate. `./byodt up` brings it all back as it was. Like `down`, it refuses while another folder runs the deployment, and takes `--take-over`; see [A deployment in another folder](#a-deployment-in-another-folder).

The command then prints the exact commands to wipe the graph *if you want to*, correct for your storage setting — either removing the data directory, or removing the named volume with your engine. On Neo4j under rootless Podman it adds the `podman unshare rm -rf` form, because the database files belong to the container's user. Read what it prints; it is generated for your deployment, not a generic example.

> **Keep `.env.secrets`.** It holds the database password. Deleting it while the graph still exists locks you out of your own data. If you want a clean graph, delete the data and keep the password — a fresh database adopts the password already on disk.

### Remove everything

1. `./byodt destroy`
2. Run the wipe command it printed, if you want the graph gone.
3. Delete the bundle directory — but move `backups/` and `.env.secrets` out first if you might want them.
4. Remove the container images with your engine's own image commands if you want the disk space back. `./byodt version` lists exactly which images this deployment pinned.

---

## The escape hatch

Anything the named commands do not cover:

```sh
./byodt compose ps
./byodt compose config
./byodt compose exec platform sh
```

This runs your engine's `compose` with the bundle's configuration and secret files already supplied, and with the compose files for your database engine: `compose.yaml`, then `compose.memgraph.yaml` or `compose.neo4j.yaml`, then `compose.override.yaml` if you have one. That is the part that is tedious to get right by hand, and a bare `compose` call without the engine's file has no database service.

> **The safety rails do not apply here.** `./byodt compose down -v` will delete a named-volume graph, where `./byodt down -v` refuses. The escape hatch also does not check for [a deployment in another folder](#a-deployment-in-another-folder), and never shows the [third-party notice](./INSTALLATION.md#the-third-party-notice), so a `./byodt compose pull` downloads without it. Use the escape hatch when you know what you are doing.

> **Note:** `./byodt compose config` prints every service's environment in full, including the database password and, if you set one, the outbound proxy's login. Do not paste its output anywhere public.

---

## Related

- [Configuration](./CONFIGURATION.md) — every setting, and which command applies it.
- [Cloud](./CLOUD.md) — connecting the deployment to sign-in and content packages.
- [Troubleshooting](./TROUBLESHOOTING.md) — symptom, cause, and fix.
