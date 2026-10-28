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
| `./byodt up` | Start the deployment, and apply configuration changes. Performs first-run setup if needed. |
| `./byodt down` | Stop the deployment. Data is kept. |
| `./byodt restart [service]` | Recreate the containers to apply a change — all of them, or one named service. |
| `./byodt status` | Show the state of every service. |
| `./byodt logs [service]` | Follow the logs — all services, or one. |
| `./byodt update` | Pull the pinned images and apply them. |
| `./byodt models pull` | Download and verify the embedding model's weights into `data/models` ahead of the first start. |
| `./byodt backup [dir]` | Back up the graph and copy it out. Defaults to `backups/`. On Neo4j the database stops while it is dumped. |
| `./byodt restore <file>` | Replace the graph from a backup. Asks you to confirm. |
| `./byodt bootstrap` | First-run setup only: directories, database password, mode layer. `up` does this for you. |
| `./byodt destroy` | Remove the containers and the network. Data on disk is kept. |
| `./byodt console` | Print the console URL, and open it where the platform supports that. |
| `./byodt tls generate [hostname]` | Generate a self-signed front-door certificate. |
| `./byodt tls status` | Show the installed certificate, or report that there is none. |
| `./byodt version` | Show the control script's version and the pinned release set. |
| `./byodt compose [args]` | Run your engine's `compose` with this bundle's configuration and compose files. |

Several commands accept a familiar alias: `start`, `stop`, `ps`, `pull`, `upgrade`, `init`, `nuke`, `open`. They do exactly what the primary name does.

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

## Applying a change

Which command applies a change depends on what you changed. The full table is in [Configuration → How to apply a change](./CONFIGURATION.md#how-to-apply-a-change). In short:

```sh
./byodt up                    # after editing .env
./byodt restart               # after connecting or disconnecting the cloud
./byodt restart platform      # after mounting or unmounting a content module, or updating the knowledge graph
./byodt restart proxy         # after adding, replacing, or removing a certificate
./byodt restart db            # after changing DB_DATA, SNAPSHOT_INTERVAL_SEC, or a NEO4J_DATA/_HEAP_SIZE/_PAGECACHE_SIZE
```

Naming a service recreates only that service, not its dependencies — `./byodt restart proxy` re-reads the front-door configuration without bouncing the database underneath it.

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
byodt 1.3.0
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

It runs the platform's own download code in a one-off platform container, with no database, so the stack can be up or down. It prints the model's size and its licence (the [Gemma Terms of Use](https://ai.google.dev/gemma/terms)), downloads only what is missing or fails verification, and ends with `Ready` once the weights are in place. `Ctrl-C` stops it without keeping a partial file; run it again to continue. If `.env` still sets `EMBEDDING_MODEL=embeddinggemma`, `byodt` stops it first with its own check, the one `./byodt up` and `./byodt update` run, and tells you to remove the line; any other value the platform would not run is refused by the download code, with the platform's message. It exits `0` once the weights are in place, `1` on a refusal or failure, and `130` when stopped.

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

The filename records the version the backup was taken on, which is what lets `restore` warn you about a mismatch later. A Neo4j dump is created readable by you only.

The database must be running and reachable when you start a backup — the command probes it first and stops with a clear message if it is not.

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
==> Restore complete. If the app still shows old or empty data, run 'byodt restart platform'.
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
==> Add one with byodt tls generate, or drop your own cert.pem + key.pem into tls/, then byodt restart proxy.
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

A release moves as one unit: the platform image, the console image, and the module payloads all follow `PLATFORM_VERSION`. The graph database image is the exception — an update leaves `DB_IMAGE`, or `NEO4J_IMAGE` on Neo4j, where it is (see step 4).

### 1. Back up first

```sh
./byodt backup
```

Copy the file off the machine. A backup may not load across versions, so treat it as protection against a failed upgrade, not a guaranteed rollback.

### 2. Get the new bundle

Download and verify it exactly as in [Installation → Get the bundle](./INSTALLATION.md#get-the-bundle).

### 3. Replace the bundle files, keep your own

The tarball contains only the shipped files — the control script, the compose files, the configuration template, the proxy configuration, and the notices. It contains none of your generated files, so unpacking it over your existing bundle directory replaces the former and leaves the latter alone:

```sh
VERSION=X.Y.Z    # the release you are moving to
tar xzf "byodt-${VERSION}.tar.gz" --strip-components=1 -C /path/to/your/bundle
```

Your `.env`, `.env.secrets`, `mode/`, `tls/`, `data/`, and `backups/` are untouched.

### 4. Bring `.env` into line with the new `.env.example`

`.env.example` is the release manifest. Compare it with your `.env`:

```sh
diff .env .env.example
```

**Set `PLATFORM_VERSION` to the new version.** That is the whole version change — the platform image, the console image, and the module payloads all follow it. Also take any changes to `PROXY_IMAGE`, and read the new file's comments for settings that were added or retired. `./byodt update` never edits `.env` for you. Keep your current `DB_IMAGE` (on Neo4j, `NEO4J_IMAGE`, which `byodt` recorded on the first run), even if the new bundle names a newer database, unless you decide to move the database (below).

> **Moving the database to a newer image is your choice, and it is one-way.** A newer database writes data that an older one cannot open, so there is no downgrade. `./byodt up` and `./byodt update` warn when `DB_IMAGE` (or `NEO4J_IMAGE`) differs from the image this bundle was tested with; the warning never blocks the start. To move: back up first — `./byodt backup`, or a copy of the data directory (`data/memgraph` or `data/neo4j`) taken with the deployment down — then set `DB_IMAGE` (or `NEO4J_IMAGE`) to the tested image and run `./byodt update`.

> **If you have uncommented `CONSOLE_IMAGE` to use a mirror**, move its tag to the new version too. The console refuses to serve a platform version it was not built for, so an override left on the old tag aborts the start. Leaving the key commented out — the default — makes this impossible.

### 5. Apply

```sh
./byodt update
```

This first checks `.env` (see [Upgrading from a release with the `ollama` service](#upgrading-from-a-release-with-the-ollama-service) for what it refuses and what it only notes), then pulls the newly pinned images and recreates the deployment. The one-shot runs again and installs the new release's signed modules; the reference-data ingest is skipped if the corpus has not changed.

If the one-shot refuses the start, `./byodt update` fails with an error that ends `'byodt logs console-init' says why.` Read that log, fix what it names, and run `./byodt update` again.

### 6. Verify

```sh
./byodt status
```

Then open the console and confirm: a **Healthy** verdict, every module `placed` or `skipped`, and the init tag under the page heading showing the new version. If anything is off, see [Troubleshooting](./TROUBLESHOOTING.md).

### Upgrading from a release with the `ollama` service

From control script **1.2.0** on, the bundle no longer runs the old `ollama` service: the platform embeds in process. Upgrading a deployment that ran the `ollama` service follows the steps above, with these additions.

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

Removes the containers and the network. **Nothing on disk is deleted** — not your data, not your configuration, not your certificate. `./byodt up` brings it all back as it was.

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

> **The safety rails do not apply here.** `./byodt compose down -v` will delete a named-volume graph, where `./byodt down -v` refuses. Use the escape hatch when you know what you are doing.

---

## Related

- [Configuration](./CONFIGURATION.md) — every setting, and which command applies it.
- [Cloud](./CLOUD.md) — connecting the deployment to sign-in and content packages.
- [Troubleshooting](./TROUBLESHOOTING.md) — symptom, cause, and fix.
