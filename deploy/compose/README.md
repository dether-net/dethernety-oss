# Dethernety — Docker Compose deployment

A complete, self-contained Dethernety stack: graph database, platform (API + SPA,
with an in-process embedder), and a front-door proxy. Everything runs locally;
nothing calls out beyond pulling the images, the signed module payloads, and the
embedding model's weights.

## Prerequisites

- Docker with the Compose plugin, or Podman 4.1+ with a Compose provider (and, on
  macOS, a running Podman machine) — the bundle auto-detects which on the first run
  (it probes `docker compose` then `podman compose`); set `CONTAINER_ENGINE` in
  `.env` to force one
- Several gigabytes of free disk and memory — the stack runs a graph database
  alongside the platform, which holds the embedding model in memory; the model's
  weights take about 1.26 GB in `data/models`
- A network connection for the first run (image pulls, module payloads, and the
  embedding model's weights from Hugging Face)

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

Always go through `byodt`. The `db` service is not in `compose.yaml`: it is in
`compose.memgraph.yaml` or `compose.neo4j.yaml`, and `byodt` passes compose the
right one. A bare `docker compose up` on `compose.yaml` alone does not start the
stack; use `./byodt compose …` for anything `byodt` has no command for.

## Choosing the database

The bundle runs one of two graph databases:

| `DB_ENGINE` | Database | Image |
|-------------|----------|-------|
| `memgraph` (default) | Memgraph | `DB_IMAGE` in `.env` |
| `neo4j` | Neo4j 5.26 Community | `NEO4J_IMAGE` in `.env`; on the first Neo4j run `byodt` records the image it was tested with, `docker.io/library/neo4j:5.26.32-community` |

Set `DB_ENGINE` in `.env` before the first start, or run `DB_ENGINE=neo4j ./byodt up`
once: `byodt` records the engine in `.env` on the first run. An exported `DB_ENGINE`
overrides `.env` for that one command. `byodt` reads `DB_ENGINE` in `.env` as compose
does, so an `export ` prefix or a trailing ` # comment` on the line is fine.

Each engine keeps its own data, and nothing converts one into the other. A change of
engine starts an empty graph (the reference data is ingested again; your models are
not carried across). `byodt` refuses to start an engine whose bind-mounted store is
empty while the other engine's store holds data, and a refused start (`bootstrap`
included) leaves `.env` and `data/` as they were: an export that would be refused is
never recorded. To switch anyway: back up, run
`./byodt down`, move the current engine's data directory aside, set `DB_ENGINE` to the
new engine, then `./byodt up`. A store in a named volume is not checked.

On Neo4j the platform needs two APOC Core functions, `apoc.date.convertFormat` and
`apoc.util.validatePredicate`. `compose.neo4j.yaml` loads APOC Core from the jar the
Neo4j image ships in `labs/`, by pointing the plugins directory there, and its procedure
allowlist names only those two functions: no other APOC procedure or function can be
called, and none is granted unrestricted access. Nothing is copied or downloaded. An
image set in `NEO4J_IMAGE` must ship APOC Core in `labs/`, as the official Neo4j images do.

## What runs

| Service        | Role                                              | Published |
|----------------|---------------------------------------------------|-----------|
| `db`           | graph database (Bolt)                             | no        |
| `console-init` | one-shot: places the schema, installs modules, ingests the reference data, then exits | no |
| `platform`     | API + SPA + runtime `/config`; embeds in process  | no        |
| `console`      | operator console: deployment status, TLS, and (optional) cloud connect — no sign-in in this bundle (OIDC once cloud-connected) | via proxy |
| `proxy`        | the single entry point                            | **3000**  |

Only the proxy publishes a port (loopback by default); the console is served
through it at `/console/`, so there is a single endpoint. The database never
leaves the stack network.

`console-init` runs before the platform and must finish first — the platform is
held back until it has completed. A version, schema, or embedding-model problem
stops the whole start; a module or data-ingest problem is recorded and the stack still comes up,
so you can read the diagnosis rather than facing a silent empty deployment.

## First run takes a while

The reference-data ingest runs once in `console-init`. The platform then
downloads its embedding model, EmbeddingGemma 300m (about 1.26 GB), once from
Hugging Face into `data/models` and verifies it, and embeds every class once, at
about 0.2 s per class on a 4-vCPU host: seconds for the bundled modules (about 80
classes, 15–20 s), a few minutes with cloud content packages (about 1,200
classes). Matching uses names meanwhile. `./byodt models pull` downloads the model
ahead of the first start; the download does not hold the platform's health check.
`./byodt logs console-init` shows ingest progress and
`./byodt logs platform` the model. Subsequent starts reuse `data/` and are fast.

The embedding model is licensed under the
[Gemma Terms of Use](https://ai.google.dev/gemma/terms); the platform logs the
licence before it downloads, and `./byodt models pull` prints it.

## Configuration

Edit `.env`. The image/version keys at the top name the tested release set.
`PLATFORM_VERSION` is the release version: it selects both the platform image and
the console image, so upgrading is a one-line change and the two cannot drift apart
(the console refuses to start against a `PLATFORM_VERSION` it was not built for).
The two third-party images are pinned separately so they can be repointed at a
mirror.

Leave `EMBEDDING_MODEL` unset: the platform embeds with the model the release's
MITRE data was made with, and refuses any other. `./byodt up` and `./byodt update`
refuse an `.env` that still sets `EMBEDDING_MODEL=embeddinggemma` (the old
`ollama` service's model) and note `OLLAMA_*`, `EMBEDDING_URL` and
`EMBEDDING_SIMILARITY_THRESHOLD` lines as no longer used; they never edit `.env`.

`DB_IMAGE` is copied into `.env` on the first run and kept across upgrades;
`./byodt up` and `./byodt update` warn when it differs from the tested image. Moving
is optional (release 0.10.1 fixes existing Memgraph 3.8.1 deployments as they are)
and one-way: back up first (`./byodt backup`; there is no downgrade), set `DB_IMAGE`,
then run `./byodt update`. On Neo4j the same applies to `NEO4J_IMAGE`, which `byodt`
records in `.env` on the first Neo4j run: a later bundle tested with a newer Neo4j
image warns, and does not move the store on `./byodt update`.

The container engine is auto-detected on the first run (Docker first, then Podman)
and recorded as `CONTAINER_ENGINE` in `.env`; set it there yourself to force one.

The database stores its data in a host bind mount (`data/memgraph`, or `data/neo4j`
on Neo4j) by default — visible and easy to back up. On VM-backed runtimes (Podman
machine, Docker Desktop on macOS/Windows), a host bind mount can corrupt a database
under the file-sharing layer; if you hit that, set `DB_DATA` to the `memgraph-data`
named volume (on Neo4j: `NEO4J_DATA` to `neo4j-data`), which lives in the engine's own
storage. See `.env` for the trade-offs.

Neo4j settings, all optional in `.env`: `NEO4J_HEAP_SIZE` (default `2G`) and
`NEO4J_PAGECACHE_SIZE` (default `1G`). A statement may run for 600 s on either
engine. On Neo4j the platform always connects as user `neo4j` to database `neo4j`,
and does not use `NEO4J_USERNAME` or `NEO4J_DATABASE` from `.env`; on the first Neo4j
run `byodt` prints a notice for each one that says otherwise, and you can remove the line.

Local changes to the compose configuration go in `compose.override.yaml`, which
`byodt` loads last. It loads no other override file name (`compose.override.yml`,
`docker-compose.override.*`) and warns when it finds one.

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
./byodt models pull         # download + verify the embedding model ahead of the first start
./byodt down                # stop (data kept)
./byodt destroy             # remove the stack; data on disk is kept (rm it yourself to wipe)
./byodt backup              # back up the graph into backups/ (copy it off-box)
./byodt restore <file>      # replace the graph from a backup (asks to confirm)
```

`./byodt help` lists every command. Each wraps your container engine's `compose` with
the bundle's env files; `./byodt compose …` is the escape hatch for anything not covered.

## Upgrading from a bundle with the `ollama` service

From `byodt` 1.2.0 the bundle no longer runs the old `ollama` service. Back up
(`./byodt backup`), save `.env` and keep the previous bundle tarball (a rollback
needs both), take the new bundle and set `PLATFORM_VERSION`, remove or comment out
the `EMBEDDING_MODEL=embeddinggemma`, `EMBEDDING_SIMILARITY_THRESHOLD` and
`OLLAMA_IMAGE` lines in `.env`, optionally `./byodt models pull`, then
`./byodt update`. It removes the old `ollama` container; `data/ollama` is kept and
reported with its size — once the new start has worked, `sudo rm -rf data/ollama`.
The first start re-ingests the MITRE data once (about a minute) and embeds every
class once. The full procedure, and rolling back, are in the
[Operations guide](https://github.com/dether-net/dethernety-oss/blob/main/docs/user/byodt/OPERATIONS.md#upgrading-from-a-release-with-the-ollama-service).

## Backups

`./byodt backup` copies the graph into `backups/`. A backup is the **graph only** — no password
inside — so you can move it between machines, and it is not a secret-bearing file. **Copy backups off this machine**:
one sitting next to the data it protects is lost with the machine.

On **Memgraph** it takes a consistent snapshot with no downtime:

```sh
./byodt backup                           # → backups/byodt-snapshot-<version>-<timestamp>.snapshot
./byodt backup /path/to/dir              # write into another directory instead
./byodt restore backups/<file>.snapshot  # replace the current graph (asks to confirm)
```

On **Neo4j** the database is stopped while it is dumped: Neo4j Community dumps and loads an
offline database only. `byodt` makes a private working directory in the bundle root
(`.byodt-dump.XXXXXX`, mode `0700`, yours), stops `db`, writes the dump into that directory
with `neo4j-admin` in a one-off container, copies it out as a file only you can read, removes
the directory, and starts `db` again, also when the dump fails. A restore stages your backup
file into such a directory and mounts it read-only. The platform loses its database connection
meanwhile.

```sh
./byodt backup                           # → backups/byodt-dump-<version>-<timestamp>.dump
./byodt restore backups/<file>.dump      # stops db, loads the dump, starts db (asks to confirm)
```

`restore` **clears the current graph** and applies the backup; your config and the database
password (`.env.secrets`) are untouched, so the restored graph opens with this deployment's own
credentials — a backup restores cleanly onto any deployment of the same version and engine. Each
engine refuses the other's backup file. On Neo4j the load replaces the graph, so if it fails the
current graph may be gone: restore again from a backup you know is good.

Under rootless Podman, the Neo4j database files belong to the container's user: remove them with
`podman unshare rm -rf data/neo4j` (`./byodt destroy` prints it).

Memgraph also keeps automatic in-place snapshots for crash recovery, every
`SNAPSHOT_INTERVAL_SEC` seconds (`.env`, default 300; applied on `byodt restart db`; `0` disables).
Those live in the data dir and are pruned over time — use `byodt backup` for anything you want to keep.

## TLS

The front door terminates TLS for the **whole stack** — the platform, the console,
and the API all behind one endpoint. By default it serves plain HTTP (a loopback,
single-tenant deployment behind your own boundary). To serve HTTPS:

```sh
./byodt tls generate        # a self-signed certificate for localhost, or:
                            # drop your own cert.pem + key.pem into tls/
./byodt restart proxy       # the front door picks it up and serves HTTPS
```

Once a certificate is installed, browse to `https://…:3000`. The certificate lives
in `tls/`; `./byodt tls status` shows it, and removing it (`rm tls/*.pem && ./byodt restart proxy`)
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

The stack also *references* third-party images (graph database, proxy) that your
runtime pulls directly from their publishers; this bundle does not
redistribute them. See [NOTICE](./NOTICE) for their licenses and provenance — note
that Memgraph (the default graph database) is **BSL 1.1**, whose production-use terms are
yours to satisfy, and that Neo4j Community Edition (the other choice) is **GPLv3**.
