# Dethernety — Docker Compose deployment

A complete, self-contained Dethernety stack: graph database, embedding server,
platform (API + SPA), and a front-door proxy. Everything runs locally; nothing
calls out beyond pulling the images.

## Prerequisites

- Docker with the Compose plugin, or Podman 4.1+ with a Compose provider (and, on
  macOS, a running Podman machine) — the bundle auto-detects which on the first run
  (it probes `docker compose` then `podman compose`); set `CONTAINER_ENGINE` in
  `.env` to force one
- Several gigabytes of free disk and memory — the stack runs a graph database
  and an embedding server alongside the platform
- A network connection for the first run (image pulls + the embedding model)

## Quickstart

```sh
./byodt up
```

That's it. On the first run `byodt` seeds `.env` from the template, generates the
database password, creates the runtime directories, and starts the stack; later
runs just start it. Open <http://127.0.0.1:3000>.

`byodt` is the deployment's control script — a thin wrapper over Docker or Podman
Compose that carries the two env files every command needs: the readable configuration
(`.env`) and the generated secret (`.env.secrets`, mode 0600), so the password
stays out of the readable layer. Run `./byodt help` for all commands.

## What runs

| Service        | Role                                              | Published |
|----------------|---------------------------------------------------|-----------|
| `db`           | graph database (Bolt)                             | no        |
| `ollama`       | embedding server for class matching               | no        |
| `console-init` | one-shot: places the schema, installs modules, ingests the reference data, then exits | no |
| `platform`     | API + SPA + runtime `/config`                     | no        |
| `console`      | operator console: deployment status, TLS, and (optional) cloud connect — no sign-in in this bundle (OIDC once cloud-connected) | via proxy |
| `proxy`        | the single entry point                            | **3000**  |

Only the proxy publishes a port (loopback by default); the console is served
through it at `/console/`, so there is a single endpoint. The database and
embedding server never leave the stack network.

`console-init` runs before the platform and must finish first — the platform is
held back until it has completed. A version or schema problem stops the whole
start; a module or data-ingest problem is recorded and the stack still comes up,
so you can read the diagnosis rather than facing a silent empty deployment.

## First run takes a while

The embedding model is pulled inside the `ollama` container on first start, and
the reference-data ingest runs once in `console-init`. The health checks are
sized to wait for a slow connection; `./byodt logs console-init` shows ingest
progress. Subsequent starts reuse the `data/` volume and are fast.

## Configuration

Edit `.env`. The five image/version keys at the top name the tested release set
and move together — prefer changing `PLATFORM_VERSION` to a published release
rather than editing images individually.

The container engine is auto-detected on the first run (Docker first, then Podman)
and recorded as `CONTAINER_ENGINE` in `.env`; set it there yourself to force one.

The database stores its data in a host bind mount (`data/memgraph`) by default — visible and easy to
back up. On VM-backed runtimes (Podman machine, Docker Desktop on macOS/Windows), a host bind mount
can corrupt a database under the file-sharing layer; if you hit that, set `DB_DATA` to the
`memgraph-data` named volume, which lives in the engine's own storage. See `.env` for the trade-offs.

The platform's authentication posture is not in `.env`: it is the console-managed
mode layer (`mode/mode.env`, seeded on the first `./byodt up`). Pure open-source,
no-auth is the local default; connect the deployment to the cloud in the console to
enable authentication (see below). Either change is applied on the next `./byodt up`.

## Managing the stack

```sh
./byodt status              # service state
./byodt logs platform       # follow a service's logs
./byodt restart console     # recreate a service (re-reads config + the mode layer)
./byodt update              # pull the pinned images and apply
./byodt down                # stop (data kept)
./byodt destroy             # remove the stack; data on disk is kept (rm it yourself to wipe)
./byodt backup              # snapshot the graph into backups/ (copy it off-box)
./byodt restore <file>      # replace the graph from a backup snapshot (asks to confirm)
```

`./byodt help` lists every command. Each wraps your container engine's `compose` with
the bundle's env files; `./byodt compose …` is the escape hatch for anything not covered.

## Backups

`./byodt backup` takes a consistent snapshot of the graph (no downtime) and copies it into
`backups/`. A snapshot is the **graph only** — no password inside — so it is safe to move and is
not a secret-bearing file. **Copy backups off this machine**: one sitting next to the data it
protects is lost with the machine.

```sh
./byodt backup                           # → backups/byodt-snapshot-<version>-<timestamp>.snapshot
./byodt backup /path/to/dir              # write into another directory instead
./byodt restore backups/<file>.snapshot  # replace the current graph (asks to confirm)
```

`restore` **clears the current graph** and applies the snapshot; your config and the database
password (`.env.secrets`) are untouched, so the restored graph opens with this deployment's own
credentials — a backup restores cleanly onto any deployment of the same version.

The database also keeps automatic in-place snapshots for crash recovery, every
`SNAPSHOT_INTERVAL_SEC` seconds (`.env`, default 300; applied on `byodt restart db`; `0` disables).
Those live in the data dir and are pruned over time — use `byodt backup` for anything you want to keep.

## TLS

The front door terminates TLS for the **whole stack** — the platform, the console,
and the API all behind one endpoint. By default it serves plain HTTP (a loopback,
single-tenant deployment behind your own boundary). To serve HTTPS:

```sh
./byodt tls generate        # a self-signed certificate for localhost, or:
                            # drop your own cert.pem + key.pem into tls/
./byodt up                  # the front door picks it up and serves HTTPS
```

Once a certificate is installed, browse to `https://…:3000`. The certificate lives
in `tls/`; `./byodt tls status` shows it, and removing it (`rm tls/*.pem && ./byodt up`)
reverts to plain HTTP. Everything behind the front door stays plain HTTP on the
stack's internal network — only the edge is encrypted.

## The console

The `console` service is a small operator page served through the front door at
`/console/` (the same origin as the platform — no separate port). It reports the
deployment's status — what the one-shot placed, module registration, data ingest.
It runs locally and, on its own, calls nothing.

This pure open-source bundle runs the console unauthenticated (single-user, loopback
host trust — the session is a request header, never a cookie, which closes CSRF), so
there is no sign-in step. Open <http://127.0.0.1:3000/console/> and it loads directly.
(Connecting the deployment to the cloud switches the console to OIDC sign-in.)

### Connecting to the cloud (optional)

Pure open-source is the default and calls out to nothing. Connecting a deployment
to the cloud is opt-in: in the console, paste the deployment login recipe from your
account, and the console writes it into the mode layer (`mode/mode.env`) that the
platform reads on the next recreate. Apply it by recreating the stack:

```sh
./byodt up
```

`./byodt up` (and `./byodt restart`) recreate the containers, which is what re-reads
the environment — a plain container restart would not pick the change up.

Cloud sign-in involves two callbacks, both now on the one front-door origin, and
both must be registered with your identity provider as redirect URIs (exact match):

- `http://<host>:3000/auth/callback` — the platform's sign-in (what you confirm in
  the console when pasting the recipe; it defaults to the front door correctly now
  that the console shares its origin).
- `http://<host>:3000/console/auth/callback` — the console's own sign-in, used only
  for refreshing the recipe from your account.

If sign-in is rejected at the provider, the console shows the exact value to register.

## License

The Dethernety platform and console are licensed under the GNU AGPL v3 — see
[LICENSE](./LICENSE).

The stack also *references* third-party images (graph database, embedding server,
proxy) that your runtime pulls directly from their publishers; this bundle does not
redistribute them. See [NOTICE](./NOTICE) for their licenses and provenance — note
that Memgraph (the graph database) is **BSL 1.1**, whose production-use terms are
yours to satisfy.
