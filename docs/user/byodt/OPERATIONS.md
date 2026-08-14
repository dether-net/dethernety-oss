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
| `./byodt backup [dir]` | Snapshot the graph and copy it out. Defaults to `backups/`. |
| `./byodt restore <file>` | Replace the graph from a backup snapshot. Asks you to confirm. |
| `./byodt bootstrap` | First-run setup only: directories, database password, mode layer. `up` does this for you. |
| `./byodt destroy` | Remove the containers and the network. Data on disk is kept. |
| `./byodt console` | Print the console URL, and open it where the platform supports that. |
| `./byodt tls generate [hostname]` | Generate a self-signed front-door certificate. |
| `./byodt tls status` | Show the installed certificate, or report that there is none. |
| `./byodt version` | Show the control script's version and the pinned release set. |
| `./byodt compose [args]` | Run your engine's `compose` with this bundle's configuration files. |

Several commands accept a familiar alias: `start`, `stop`, `ps`, `pull`, `upgrade`, `init`, `nuke`, `open`. They do exactly what the primary name does.

**Service names**, for the commands that take one:

```
db   ollama   console-init   platform   proxy   console
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
./byodt restart platform      # after mounting or unmounting a content module
./byodt restart proxy         # after adding, replacing, or removing a certificate
./byodt restart db            # after changing DB_DATA or SNAPSHOT_INTERVAL_SEC
```

Naming a service recreates only that service, not its dependencies — `./byodt restart proxy` re-reads the front-door configuration without bouncing the database underneath it.

## Inspecting the deployment

### Service state

```sh
./byodt status
```

Shows every service with its state and health. A healthy deployment shows `db`, `ollama`, `platform`, `proxy`, and `console` running, and `console-init` exited with code `0` — it is a one-shot, and exiting is what success looks like.

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
byodt 1.0.0
Pinned release (from .env):
  PLATFORM_VERSION=X.Y.Z
  DB_IMAGE=…
  OLLAMA_IMAGE=…
  PROXY_IMAGE=…
```

The first line is the control script's own version, which is independent of the platform release. The rest is exactly what this deployment is pinned to.

The console image is not listed, because it follows `PLATFORM_VERSION` rather than being pinned separately. It appears here only if you have uncommented `CONSOLE_IMAGE` to point at a mirror.

### The console

```sh
./byodt console
```

Prints the console address and opens it where the platform supports that. The console reports the deployment's health, what the one-shot placed, whether the platform registered it, and whether any change is waiting to be applied. It runs outside the request path and has no dependency on the rest of the deployment, so it can still report while the platform is down.

---

## Backing up and restoring the graph

### What a backup is

`./byodt backup` asks the database for a fresh, consistent snapshot — taken hot, with no downtime — and copies that file out of the container to a durable location.

A snapshot is the **graph only**: every model, finding, control, and the reference corpus. It does **not** contain the database password, which is separate state. Two consequences:

- It is safe to move between machines, and it restores cleanly onto any deployment **of the same version**.
- It is not a secret-bearing file in the credential sense — but it is your entire threat-modelling estate, so keep it private.

### Taking one

```sh
./byodt backup                    # → backups/byodt-snapshot-<version>-<timestamp>.snapshot
./byodt backup /path/to/archive   # write somewhere else
```

```
==> Requesting a snapshot…
==> Backup written: backups/byodt-snapshot-X.Y.Z-20260814-101112.snapshot (12M)
==> The whole graph is in here (no password) — keep it private and copy it off-box so it survives losing this machine.
```

The filename records the version the snapshot was taken on, which is what lets `restore` warn you about a mismatch later.

The database must be running and reachable — the command probes it first and stops with a clear message if it is not.

> **Copy backups off this machine.** A backup sitting next to the data it protects is lost with the machine. This is the single most valuable thing on this page.

### Automatic snapshots are not backups

The database also writes in-place snapshots every `SNAPSHOT_INTERVAL_SEC` seconds (default 300) for crash recovery. They live inside the data directory and are pruned over time by the database's own retention. They protect you from a crash; they do not protect you from losing the disk, the directory, or the machine. Use `./byodt backup` for anything you want to keep.

### Restoring

```sh
./byodt restore backups/byodt-snapshot-X.Y.Z-20260814-101112.snapshot
```

**This replaces the current graph.** All current graph data is cleared first, then the snapshot is applied. The command:

1. Warns you that the current graph will be cleared, and asks you to type `restore` to confirm. Anything else aborts and changes nothing.
2. Warns first if the filename says the snapshot was taken on a different version than this deployment runs — a snapshot may not load across versions.
3. Requires the database to be running.
4. Stages the file into the database container and applies it.

Your configuration and the database password are untouched, so the restored graph opens with this deployment's own credentials.

```
==> Restore complete. If the app still shows old or empty data, run 'byodt restart platform'.
```

If a failure occurs partway, the current graph is left unchanged and the command says so.

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

A release moves as one unit: the platform image, the console image, the module payloads, and the tested third-party images. Upgrade them together.

### 1. Back up first

```sh
./byodt backup
```

Copy the file off the machine. A snapshot may not load across versions, so treat it as protection against a failed upgrade, not a guaranteed rollback.

### 2. Get the new bundle

Download and verify it exactly as in [Installation → Get the bundle](./INSTALLATION.md#get-the-bundle).

### 3. Replace the bundle files, keep your own

The tarball contains only the shipped files — the control script, the compose file, the configuration template, the proxy configuration, and the notices. It contains none of your generated files, so unpacking it over your existing bundle directory replaces the former and leaves the latter alone:

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

**Set `PLATFORM_VERSION` to the new version.** That is the whole version change — the platform image, the console image, and the module payloads all follow it. Also take any changes to `DB_IMAGE`, `OLLAMA_IMAGE`, or `PROXY_IMAGE`, and read the new file's comments for settings that were added.

> **If you have uncommented `CONSOLE_IMAGE` to use a mirror**, move its tag to the new version too. The console refuses to serve a platform version it was not built for, so an override left on the old tag aborts the start. Leaving the key commented out — the default — makes this impossible.

### 5. Apply

```sh
./byodt update
```

This pulls the newly pinned images and recreates the deployment. The one-shot runs again and installs the new release's signed modules; the reference-data ingest is skipped if the corpus has not changed.

### 6. Verify

```sh
./byodt status
```

Then open the console and confirm: a **Healthy** verdict, every module `placed` or `skipped`, and the init tag under the page heading showing the new version. If anything is off, see [Troubleshooting](./TROUBLESHOOTING.md).

---

## Removing the deployment

### Remove the running deployment, keep the data

```sh
./byodt destroy
```

Removes the containers and the network. **Nothing on disk is deleted** — not your data, not your configuration, not your certificate. `./byodt up` brings it all back as it was.

The command then prints the exact commands to wipe the graph *if you want to*, correct for your storage setting — either removing the data directory, or removing the named volume with your engine. Read what it prints; it is generated for your deployment, not a generic example.

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

This runs your engine's `compose` with the bundle's configuration and secret files already supplied — which is the part that is tedious to get right by hand.

> **The safety rails do not apply here.** `./byodt compose down -v` will delete a named-volume graph, where `./byodt down -v` refuses. Use the escape hatch when you know what you are doing.

---

## Related

- [Configuration](./CONFIGURATION.md) — every setting, and which command applies it.
- [Cloud](./CLOUD.md) — connecting the deployment to sign-in and content packages.
- [Troubleshooting](./TROUBLESHOOTING.md) — symptom, cause, and fix.
