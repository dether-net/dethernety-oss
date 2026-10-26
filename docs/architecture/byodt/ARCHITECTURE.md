# BYODt Deployment — Architecture

> The deployment topology: every service, how they depend on each other, what is published, where
> state lives, and how a request reaches the platform.

A BYODt deployment is a Compose project named `dethernety`: five services on one private bridge
network, one published host port, and host-local storage. This document describes that topology and
the reasoning behind the parts that are not obvious — the startup ordering, the single published port,
the split configuration layers, and the front door's request-time upstream resolution.

The console's own design is in [`CONSOLE.md`](./CONSOLE.md); how modules arrive is in
[`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md); trust boundaries are in
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md).

---

## At a glance

| | |
|---|---|
| **Orchestration** | Docker Compose or Podman Compose, auto-detected on first run and recorded as `CONTAINER_ENGINE` |
| **Project name** | `dethernety` — containers and the optional named volume carry it as a prefix |
| **Network** | One bridge network, `dethernety`; services address each other by service name |
| **Published ports** | Exactly one: the front door, bound to loopback by default |
| **Persistent state** | Host directories under the bundle (or one named volume for the graph) |
| **Images** | Pinned by `.env`: `PLATFORM_VERSION` selects both of Dethernety's own images — platform and console — while the third-party images carry their own references |
| **Graph database** | Memgraph (default) or Neo4j 5.26 Community, selected by `DB_ENGINE`; each defined in its own compose file |
| **Control surface** | The `byodt` script — a wrapper over the engine's `compose` that carries both env files and names the compose files |

---

## Topology

```
                                host
   ┌──────────────────────────────────────────────────────────────┐
   │   ${FRONT_DOOR_BIND}:${FRONT_DOOR_PORT}  →  proxy :80        │
   │   default 127.0.0.1:3000                                     │
   └───────────────────────────┬──────────────────────────────────┘
                               │
 ═══ network: dethernety (bridge) ═════════════════════════════════════════════
                               │
                        ┌──────▼──────┐
                        │    proxy    │  nginx · :80 (edge) · :8081 (health)
                        └──┬───────┬──┘
             /console/     │       │   everything else
                ┌──────────┘       └──────────┐
                ▼                             ▼
         ┌─────────────┐               ┌─────────────┐
         │   console   │ ────────────▶ │  platform   │  :3003
         │   :8080     │  /config      │  API + SPA  │
         └──────┬──────┘  /graphql     └──┬───────┬──┘
                │                         │       │ HTTPS, first start only
                │  writes                 │ Bolt  └──────▶ Hugging Face Hub
                │  mode/ + modules/       ▼                (embedding weights)
                │                     ┌──────┐
                │                     │  db  │
                │                     │:7687 │
                │                     └──────┘
                │                         ▲
                │   reads state file      │ Bolt
                └──── modules/ ◀───── console-init  (one-shot, exits)
```

The stack no longer has the old `ollama` service: the platform embeds in process (see
[The embedder](#the-embedder)).

`console-init` and `console` run the same image; the one-shot runs its default `init` entrypoint and
the daemon is started with `command: ["daemon"]`.

---

## The services

### `db` — graph database

Holds every model, the reference corpus, and the module-derived class registry. Reached over Bolt at
`db:7687`; never published.

The service is not in `compose.yaml`. `compose.memgraph.yaml` and `compose.neo4j.yaml` each define it
under the same name, and `byodt` runs compose with `compose.yaml`, the file of the engine `DB_ENGINE`
names, and `compose.override.yaml` when present, last. The rest of the stack does not change with the
engine. `DB_ENGINE` resolves as `CONTAINER_ENGINE` does: an exported value wins for one command, then
`.env` (read as compose reads it: an `export ` prefix and a trailing ` # comment` are allowed), then
`memgraph`; the first run records it in `.env`, and on Neo4j records `NEO4J_IMAGE` too. Both are
recorded only after the switch guard (below) has passed.

#### Memgraph (`DB_ENGINE=memgraph`, the default)

| | |
|---|---|
| Image | `${DB_IMAGE}` — a third-party reference resolved by your runtime |
| Credentials | `MEMGRAPH_USER` / `MEMGRAPH_PASSWORD` from `NEO4J_USERNAME` (`.env`) and `NEO4J_PASSWORD` (`.env.secrets`) |
| Storage | `${DB_DATA}` mounted at `/var/lib/memgraph` |
| Health | Answers a query (`RETURN 1;` through `mgconsole`) — not merely "the process is up": 5 s interval, 30 retries, 15 s start period |
| Restart | `unless-stopped` |

Notable startup flags, all set in `compose.memgraph.yaml`:

| Flag | Why |
|---|---|
| `--memory-limit=4096` | The measured floor for this workload; the embedding-bearing ingest statements fail below it |
| `--storage-snapshot-interval-sec=${SNAPSHOT_INTERVAL_SEC:-300}` | In-place crash-recovery snapshots; `0` disables. Not a substitute for `byodt backup` |
| `--query-execution-timeout-sec=600` | Long analysis and ingest statements |
| `--bolt-num-workers=4`, `--query-plan-cache-max-size=100`, `--query-max-plans=100`, `--cartesian-product-enabled=true`, `--storage-gc-cycle-sec=300`, `--query-vertex-count-to-expand-existing=10` | Query planner and worker sizing for a single-node deployment |

The plain image is used rather than the extended variant: class matching uses the built-in vector
search, and the one procedure that would otherwise require the extended build has a built-in fallback.
Pinning avoids a silent multi-gigabyte difference in the first-run pull.

#### Neo4j (`DB_ENGINE=neo4j`)

| | |
|---|---|
| Image | `${NEO4J_IMAGE}` — exported by `byodt` from `.env`, where the first Neo4j run records the image the bundle was tested with (`docker.io/library/neo4j:5.26.32-community`) |
| Credentials | User `neo4j`, the Community administrator; `NEO4J_AUTH` sets its initial password from `NEO4J_PASSWORD` on the first start only |
| Storage | `${NEO4J_DATA}` (default `./data/neo4j`) mounted at `/data` |
| Memory | `NEO4J_HEAP_SIZE` (default `2G`) as initial and maximum heap; `NEO4J_PAGECACHE_SIZE` (default `1G`) |
| Timeout | `db.transaction.timeout` 600 s — the same cap as Memgraph's |
| Plugins | `server.directories.plugins` is `/var/lib/neo4j/labs`, which loads APOC Core from the jar the image ships there (see below) |
| Procedure allowlist | `dbms.security.procedures.allowlist` is `apoc.date.convertFormat,apoc.util.validatePredicate`: only the two APOC Core functions the platform calls are loaded |
| Health | Answers a query (`RETURN 1;` through `cypher-shell`, which reads the password from its environment inside the container, so it is on no command line): 10 s interval, 20 s timeout, 30 retries, 30 s start period |
| Shutdown | 120 s grace, so a stop is clean: `neo4j-admin` refuses to dump a store that needs recovery |
| Restart | `unless-stopped` |

Neo4j Community serves one database, `neo4j`, and has no roles, so the platform logs in as `neo4j`.
`compose.neo4j.yaml` sets `NEO4J_USERNAME=neo4j` and `NEO4J_DATABASE=neo4j` on `console-init` and
`platform` itself, so the Memgraph values `.env` may still carry do not reach them; on the first Neo4j
run `byodt` prints a notice for each that `.env` sets to something else. When the reference-data ingest runs out of memory,
the one-shot names `NEO4J_HEAP_SIZE` in its diagnosis.

The platform's GraphQL layer needs two APOC Core functions on Neo4j: it reads every DateTime field
through `apoc.date.convertFormat`, and writes `apoc.util.validatePredicate` into the checks of some
mutations (list push and pop, arithmetic operators, single-cardinality relationships). The official
Neo4j image ships the APOC Core jar in `/var/lib/neo4j/labs`, and `compose.neo4j.yaml` sets
`NEO4J_server_directories_plugins` to that directory, so Neo4j loads the jar where it lies: nothing is
copied, written or downloaded. `NEO4J_dbms_security_procedures_allowlist` names the two functions, so
only they load: no other APOC procedure or function, the URL-fetching ones among them, can be called,
and none is granted unrestricted access. The image's own `NEO4J_PLUGINS=["apoc"]` mechanism would
instead copy the jar into `plugins/` and set `dbms.security.procedures.unrestricted=apoc.*`, which
these two functions do not need. On Neo4j the bootstrap service `CheckApocFunctionsService` checks
them at startup: it lists them (`SHOW FUNCTIONS`) and, when both are listed, calls each once. It logs
one error naming the missing functions, or saying they are listed but cannot run. The check never
stops startup, and a check that cannot run is logged as a warning.

#### Switching engines

Each engine keeps its own store, and nothing converts one into the other; each refuses the other's
backup file. `up`, `restart`, `update` and `bootstrap` refuse to start an engine whose bind-mounted
store is empty while the other engine's bind-mounted store holds data — that is a changed `DB_ENGINE`,
and starting would bring up an empty graph and ingest into it while the real one sits unused. The guard
runs before `byodt` records or creates anything for the engine, so a refused start leaves `.env` and
`data/` as they were, and an exported `DB_ENGINE` that is refused is never recorded. A named volume
cannot be looked into from the host, so it is not checked.

### `console-init` — the pre-start one-shot

Runs to completion before the platform starts, and exits. It checks the platform's embedding model
against the reference corpus, places the no-auth schema, fetches and verifies the signed code modules,
and ingests the reference corpus.

| | |
|---|---|
| Image | The console image, derived from `PLATFORM_VERSION` (overridable with `CONSOLE_IMAGE`), run with its default entrypoint (`init`) |
| Depends on | `db` healthy |
| Reads | `mode/mode.env` (as `env_file`), `PLATFORM_VERSION`, the Bolt credentials, `CONSOLE_RELEASE_BASE_URL`, `EMBEDDING_MODEL` |
| Writes | `./modules` (module payloads + the state file), `./schema` (the no-auth schema) |
| Restart | `no` |

It reads the same mode layer the platform will read, so its decision about which schema to place always
tracks the mode the platform comes up in. Its exit discipline is the deployment's start/abort contract
and is documented in [`CONSOLE.md`](./CONSOLE.md#the-two-exit-disciplines).

Before the schema and the ingest, it stops the deployment when the model the platform will run differs
from the one the MITRE corpus's vectors were embedded with — see
[the embedding-model check](./CONSOLE.md#the-embedding-model-check).

### `platform` — API, SPA, and runtime config

The product. Serves the GraphQL API, the SPA, the runtime `/config` document the SPA reads, and the
subscription stream.

| | |
|---|---|
| Image | `ghcr.io/dether-net/dethernety:${PLATFORM_VERSION}` |
| Port | `3003`, stack-internal |
| Depends on | `db` healthy, `console-init` completed successfully |
| Health | `GET /health/simple` over the loopback inside the container: 15 s interval, 20 retries, 60 s start period. It checks the database only; the embedder's state is on `/health` |
| Restart | `unless-stopped` |

Its environment is split deliberately: everything fixed by the deployment shape is in the service's
`environment:` block, while the two variables that decide the authentication posture — `NODE_ENV` and
`ENABLE_NOAUTH` — live only in the `env_file` mode layer. A service's `environment:` overrides its
`env_file:`, so putting them in both places would pin the platform to one posture forever.

| Variable | Value | Note |
|---|---|---|
| `NEO4J_URI` | `bolt://db:7687` | Stack-internal, unencrypted |
| `NEO4J_ENCRYPTED` / `NEO4J_TRUST_CERT` | `false` / `false` | Bolt does not leave the stack network, so certificate trust is moot — and the platform's production validation rejects a truthy `NEO4J_TRUST_CERT` outright |
| `GQL_QUERY_DEPTH_LIMIT` / `GQL_QUERY_COMPLEXITY_LIMIT` | `10` / `1000` | Query guards; they apply in every posture |
| `CUSTOM_MODULES_PATH` | `custom_modules` | Resolved against the image's working directory, `/app/apps/dt-ws` |
| `ALLOWED_MODULES` | `*` | The deployment loads what the console placed in the modules mount; provenance is enforced at install time, not by name matching |
| `ENABLE_MODULE_HOT_RELOAD` | `false` | Module changes take effect on a recreate, never mid-flight |
| `EMBEDDING_ENABLED` / `EMBEDDING_MODEL` / `EMBEDDING_MODEL_DIR` | `true`, the `.env` value (empty selects the platform's default), `/models` | See [The embedder](#the-embedder) |
| `EMBEDDING_THREADS` | `${EMBEDDING_THREADS:-4}` | The embedder's inference threads; the operator matches it to the host's (or the VM's) core count |
| `SETTINGS_URL` | `${SETTINGS_URL:-/console/}` | Surfaces a **Settings** link in the platform sidebar pointing at the console on this same origin; set empty to hide it |

#### The embedder

The platform embeds in process: it runs the embedding profile `EMBEDDING_MODEL` selects (empty selects
the default, `embeddinggemma-300m-retrieval-v1`) with onnxruntime on a worker thread, so a request
that does not embed never waits behind one that does. Its weights are not in the image or the bundle. On the first start the platform
downloads them from the Hugging Face Hub (about 1.26 GB) into `/models`, the host's `./data/models`,
verifies every file against the profile's sha256, and keeps them there, so a recreate does not download
them again. `byodt models pull` does the same ahead of the first start, with the platform's own code in
a one-off platform container that needs no database.

| | |
|---|---|
| Weights | `./data/models` mounted at `/models` (`EMBEDDING_MODEL_DIR`), read-write |
| Licence | The default profile's weights are under the Gemma Terms of Use; the operator's platform downloads them, and the platform logs the licence before the download |
| Memory | About 0.8–0.9 GiB more in the platform container |
| Until ready | The vector tier is off and class and technique matching answer by name; `/health` reports `degraded`. Its `services.embedder` block (`downloading`, `loading`, `failed`) appears only when `NODE_ENV` is not `production` — the standalone posture; a cloud-connected platform answers `status` and `timestamp` only |
| Refused models | With embedding on, the platform refuses to start on the legacy `embeddinggemma`, on a profile this release does not offer, and on an unknown id — before it connects to the database |

On the first start the platform also embeds every class once, after the weights are in place: about
0.2 s per class on a 4-vCPU host, so seconds for the bundled modules (about 80 classes, 15–20 s) and a
few minutes with cloud content packages (about 1,200 classes); class matching uses names meanwhile.
`/health` turns `healthy` once the embedder is ready (`Embedder ready` in the log), while the classes may
still be embedding (`Embeddings resolved` per module when done). Modules installed while the embedder was
still loading are installed again when it becomes ready. Each install records the embedding profile its
vectors were made with, so later starts skip modules whose content and profile are unchanged. The
mechanism is in
[`CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md`](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md);
the decision is [ADR-013](../decisions/013-in-process-embedding.md).

### `console` — the operator console daemon

A small HTTP server that reports the deployment's state and owns the mode layer. It has **no**
`depends_on`, so it starts immediately and can report while the rest of the stack is down — which is
exactly when an operator needs it.

| | |
|---|---|
| Image | The same console image as `console-init`, started with `command: ["daemon"]` |
| Port | `8080` inside the container, bound to all interfaces there; reached as `console:8080` on the stack network |
| Reads | `PLATFORM_URL=http://platform:3003`, `STATE_PATH` (the init record), `MODE_LAYER_PATH` |
| Writes | `./mode` (the mode layer) and `./modules` (content-mount stubs) |
| Health | None — the image is `FROM scratch` and has no shell for a container health check |
| Restart | `unless-stopped` |

It is deliberately not given the database password: the compose service block passes it neither
directly nor through interpolation.

### `proxy` — the front door

The only published service, and the TLS terminator for the whole stack.

| | |
|---|---|
| Image | `${PROXY_IMAGE}` — third-party reference |
| Publishes | `${FRONT_DOOR_BIND:-127.0.0.1}:${FRONT_DOOR_PORT:-3000}` → container `:80` |
| Depends on | `platform` **started** — not healthy |
| Mounts | `proxy/nginx.conf` (template, read-only), `proxy/40-tls.sh` (entrypoint hook, read-only), `tls/` (read-only) |
| Health | `GET /healthz` on the internal always-plain listener `:8081` |
| Restart | `unless-stopped` |

Port 3000 is not arbitrary: it is a pre-registered loopback callback, so a laptop deployment needs no
identity-provider callback registration. Renumbering it to 80 silently reintroduces that step.

---

## Startup ordering

```mermaid
graph LR
  db[db] -- service_healthy --> init[console-init]
  db -- service_healthy --> platform[platform]
  init -- service_completed_successfully --> platform
  platform -- service_started --> proxy[proxy]
  console["console (no depends_on — starts immediately)"]
```

Three different conditions are used, and each is chosen for a reason:

| Edge | Condition | Why this one |
|---|---|---|
| `db` → `console-init`, `db` → `platform` | `service_healthy` | "The container is running" is not enough: the one-shot writes to the graph on its first statement. Health here means *answers a query* |
| `console-init` → `platform` | `service_completed_successfully` | A declared dependency, not a service that merely tends to finish first. Without it the platform could read a previous boot's schema, or start against an unseeded graph |
| `platform` → `proxy` | `service_started` | The front door answers its own `/healthz` and resolves the platform at request time, so a platform outage is a `502` from a live front door rather than a proxy that refuses to start. Waiting for platform *health* would make a backend failure present as no front door at all |
| — | `console` has none | It reports on the deployment, so it must not be gated on the deployment being up |

The one-shot's own failure semantics decide whether `up` proceeds at all — see
[the two exit disciplines](./CONSOLE.md#the-two-exit-disciplines).

---

## Ports

| Service | Container port | Published on the host | Purpose |
|---|---|---|---|
| `proxy` | `80` | `${FRONT_DOOR_BIND}:${FRONT_DOOR_PORT}` (default `127.0.0.1:3000`) | The single entry point; serves HTTPS on this same port when a certificate is installed |
| `proxy` | `8081` | no | Always-plain health listener for the container health check |
| `platform` | `3003` | no | API, SPA, `/config`, subscription stream |
| `console` | `8080` | no | Console API and SPA, reached through the proxy at `/console/` |
| `db` | `7687` | no | Bolt |

`FRONT_DOOR_BIND` defaults to `127.0.0.1`. Binding it to `0.0.0.0` publishes the platform *and the
console* to your network; the consequences of that are the subject of
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md#console-reachability-is-authority-over-the-deployments-identity-configuration).

---

## Storage and volumes

| Host path | Mounted at | By | Mode | Contents |
|---|---|---|---|---|
| `${DB_DATA}` (default `./data/memgraph`) | `/var/lib/memgraph` | `db` (Memgraph) | rw | The graph, plus the database's own in-place snapshots |
| `./data/memgraph-log` | `/var/log/memgraph` | `db` (Memgraph) | rw | The database's own log. Mounted from the host because the image's log directory is writable only by the image's user, and on a bind mount the container runs as whoever owns the data directory instead |
| `${NEO4J_DATA}` (default `./data/neo4j`) | `/data` | `db` (Neo4j) | rw | The graph |
| `./data/neo4j-logs` | `/logs` | `db` (Neo4j) | rw | The database's own logs |
| `./.byodt-dump.XXXXXX` (one per run) | `/dumps` | the one-off `neo4j-admin` container of `db` (Neo4j) | rw for a dump, **ro** for a load | The private working directory of a `byodt backup` or `restore`: mode `0700`, the operator's, removed when the command ends. See [Backup and restore](#backup-and-restore) |
| `./data/models` | `/models` | `platform` | rw | The embedding model's weights, downloaded and verified on the first start (or by `byodt models pull`) |
| `./modules` | `/app/apps/dt-ws/custom_modules` | `console-init`, `console` | rw | Installed module payloads, the console's state file, content-mount stubs |
| `./modules` | `/app/apps/dt-ws/custom_modules` | `platform` | **ro** | The platform loads what was placed; it never writes here |
| `./schema` | `/app/apps/dt-ws/schema` | `console-init` | rw | Where the one-shot writes the no-auth schema |
| `./schema/schema-noauth.graphql` | same path | `platform` | **ro** | A *single-file* mount, so the generated schema lands beside the image's baked `schema.graphql` without shadowing the directory |
| `./data/content-cache` | `/app/apps/dt-ws/.module-content-cache` | `platform` | rw | Durable cache for mounted content modules; the path matches what the console writes as `MODULE_CONTENT_CACHE_DIR` |
| `./mode` | `/var/lib/dethernety` | `console` | rw | The mode layer the console owns — scoped to its own directory, so it can reach nothing else in the bundle |
| `./proxy/nginx.conf`, `./proxy/40-tls.sh` | `/etc/nginx/nginx.conf.in`, `/docker-entrypoint.d/40-tls.sh` | `proxy` | ro | Config template and its renderer |
| `./tls` | `/etc/nginx/tls` | `proxy` | ro | `cert.pem` + `key.pem` when TLS is enabled |

Two details are load-bearing:

**The no-auth schema is a single-file mount.** The one-shot always writes that exact path — the real
schema when no-auth is on, an **empty file** when it is off — so the mount target is always a stable
regular file. If the source were missing, the container runtime would create a *directory* there, and a
later flip back to no-auth would fail trying to write over it.

**`DB_DATA` selects the store** (`NEO4J_DATA` on Neo4j). The default host bind mount is visible on disk
and easy to inspect and copy. On VM-backed runtimes (a Podman machine, or Docker Desktop on
macOS/Windows) the file-sharing layer can corrupt a database under a bind mount; setting
`DB_DATA=memgraph-data` (or `NEO4J_DATA=neo4j-data`) moves the graph into the declared named volume,
inside the engine's own storage. The two are separate stores — switching is a fresh database, not a
migration.

The runtime directories are created world-writable by the control script, `data/` and `data/models`
with the sticky bit, so another local account cannot replace an entry there that it does not own (see
[Security Model → Host-level considerations](./SECURITY_MODEL.md#host-level-considerations)). That is
not incidental: under a rootless engine the container's unprivileged uid need not match the
operator's, and the one-shot and the daemon both write into these mounts. `tls/` is deliberately excluded from that and kept at `0700` —
a world-writable directory there would let any local user replace the private key and force the
plaintext fallback.

---

## The request path

Everything reaches the deployment through the front door, on one origin.

```
browser
  │  http(s)://<bind>:<port>/…
  ▼
┌────────────────────────────────────────────────────────────────────┐
│ proxy                                                              │
│                                                                    │
│  = /healthz          → 200 "ok"          answered by the proxy     │
│  = /console          → 308 /console/     relative Location         │
│    /console/…        → console:8080      prefix stripped by rewrite │
│    /            (*)  → platform:3003     SPA, /graphql, /config,    │
│                                          /auth/callback, SSE       │
│                                                                    │
│  :8081 /healthz      → 200 "ok"          container health check    │
└────────────────────────────────────────────────────────────────────┘
```

**Upstreams are resolved at request time.** A literal `proxy_pass http://platform:3003;` makes nginx
resolve the upstream once at startup and exit with *host not found in upstream* whenever the platform
is not up yet — so a backend outage would present as no front door at all. The config instead sets a
`resolver` and puts the upstream in a variable, which defers resolution and turns that case into a
`502` from a live proxy. The resolver address itself is rendered at container start from
`/etc/resolv.conf`, because it differs by engine (Docker publishes `127.0.0.11`; Podman's DNS is a
per-network address).

**The console is fronted under a subpath.** `location /console/` rewrites the prefix away before
proxying, because a variable `proxy_pass` does not strip the location prefix automatically; the console
SPA is built with base `/console/` so the browser's URLs carry it. The rewrite preserves the query
string, so an authorization code and state survive the round trip. `absolute_redirect off` keeps the
`/console` → `/console/` redirect relative — the proxy listens on `:80` in-container but is published
on a different host port, and an absolute `Location` would drop that port.

**Subscriptions and uploads.** The platform location passes `Upgrade`/`Connection` through for
WebSocket and SSE, disables proxy buffering and caching, and sets 24-hour read/send timeouts so a
long-lived subscription is not cut. `client_max_body_size` is 50 MB for large model payloads.

### TLS at the edge

TLS terminates at the front door for the whole stack — the platform, the console, and the API behind one
endpoint. The mechanism is the entrypoint hook `40-tls.sh`, which the stock nginx image runs before
starting nginx: it renders the active config from the mounted template, turning the `__TLS_LISTEN__` and
`__TLS_CERT__` markers into an `ssl` listener (TLS 1.2 and 1.3) when both `cert.pem` and `key.pem` are
present in the mounted `tls/` directory, and into a plain `listen 80` otherwise. The published port is
unchanged either way — the protocol flips on the same port.

`byodt tls generate` writes a self-signed certificate (RSA 2048, 730 days, SANs `localhost`, the given
or detected hostname, and `127.0.0.1`); dropping your own `cert.pem`/`key.pem` into `tls/` works
identically. Removing both files reverts to plain HTTP.

**Applying a certificate change means recreating the proxy — `byodt restart proxy`.** This is the one
change in the bundle that `byodt up` does not apply. The certificate lands *inside* the already-mounted
`tls/` directory, so no service's compose configuration changes and the proxy is not recreated; its
entrypoint therefore never re-renders the TLS server block. Recreating the proxy is what re-runs the
hook. Because the proxy is named explicitly, nothing else in the stack moves.

Everything behind the front door stays plain HTTP on the isolated stack network; encrypting those hops
is not the deployment's model.

---

## Configuration layers

Three layers, with different owners and different lifetimes.

| Layer | File | Owner | Read by |
|---|---|---|---|
| Configuration | `.env` | The operator | Compose interpolation (image pins, ports, database name, embedding settings, `DB_DATA`, the Neo4j settings) and `byodt` itself (`CONTAINER_ENGINE`, `DB_ENGINE`) |
| Secret | `.env.secrets`, mode `0600` | Generated once by the control script | Compose interpolation (the database password only) |
| Mode | `mode/mode.env` | The **console** | `env_file` on `platform` and `console-init` |

Both env files are passed on every command — that is the control script's main job — so the password
stays out of the readable configuration layer while still reaching interpolation.

`.env.example` is also the **release manifest**. Its image and version keys name the tested set that
ships together, and their names are a contract — the compose files interpolate exactly these names, so
renaming one breaks the bundle.

| Key | What it selects |
|---|---|
| `PLATFORM_VERSION` | The platform image tag, the console image tag, and the release the console fetches modules from |
| `DB_IMAGE`, `PROXY_IMAGE` | Third-party image references, pinned separately so each can be repointed at a mirror you operate |
| `NEO4J_IMAGE` | The Neo4j image. `byodt` records the image the bundle was tested with on the first Neo4j run, so, like `DB_IMAGE`, it stays put across upgrades |
| `CONSOLE_IMAGE` | An optional override for the console image, shipped commented out. Set it only to repoint at a mirror, and keep its tag equal to `PLATFORM_VERSION` |

**Upgrading is a one-line change: move `PLATFORM_VERSION` to a published release.** Both of
Dethernety's own images follow it — the compose file derives the console image from it — so the two
cannot drift apart, and the bundle's own manifest cannot name a console version that differs from the
platform it ships with. That matters because the console refuses to run against a `PLATFORM_VERSION` it
was not built for (see [`CONSOLE.md`](./CONSOLE.md#the-version-gate)); with the console image derived,
that gate is reachable only through a deliberate mismatched `CONSOLE_IMAGE` override. What remains
assertable, the release process asserts (see
[`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md#one-tag-one-coherent-artifact-set)).

**Applying a change means recreating containers, not restarting them.** A container's environment is
fixed when it is created, so a plain restart would not pick up an edited `.env` or a rewritten mode
layer. `byodt up` and `byodt restart` both recreate. `byodt restart <service>` recreates only the named
services (`--no-deps`), so restarting the proxy does not bounce the database underneath it.

One change is not covered by that rule: installing or removing a TLS certificate changes no service's
compose configuration, so `up` recreates nothing and the front door keeps serving its previous
protocol. That case needs the proxy recreated by name — see [TLS at the edge](#tls-at-the-edge).

---

## Operations surface

Every command in the control script wraps the engine's `compose` with both env files. The table is a
map of the mechanism; the guide has the procedures.

| Command | Mechanism |
|---|---|
| `up` | Repairs the on-disk layout (idempotent), generates the database password if absent, refuses a switched engine on an empty store (see [Switching engines](#switching-engines)), warns about an override file it does not load, refuses an `.env` with `EMBEDDING_MODEL=embeddinggemma`, removes an older bundle's `ollama` container, then `compose up -d`; fails when `console-init` stopped the start (see below) |
| `bootstrap` | The layout + password steps alone |
| `down` | `compose down`; refuses `-v`/`--volumes`/`--rmi` rather than forwarding them |
| `restart [service]` | Repairs the layout and refuses a switched engine on an empty store, then `compose up -d --force-recreate` (with `--no-deps` when services are named) |
| `status`, `logs [service]` | `compose ps`, `compose logs -f` |
| `update` | Repairs the layout, refuses a switched engine on an empty store, warns about an override file it does not load, refuses `EMBEDDING_MODEL=embeddinggemma`, `compose pull`, removes an older bundle's `ollama` container, then `compose up -d` — the pinned images, not floating tags |
| `models pull` | Downloads and verifies the embedding model's weights into `data/models` ahead of the first start: `compose run --rm --no-deps platform node dist/scripts/models-pull.js` |
| `backup [dir]`, `restore <file>` | See below |
| `destroy` | `compose down` only. Deliberately deletes no data; prints the exact wipe commands instead |
| `tls {generate\|status}` | Manages `tls/cert.pem` + `tls/key.pem` |
| `console` | Prints (and opens) the console URL |
| `version` | The script's own version plus the pinned release keys read from `.env` |
| `compose …` | The escape hatch — the engine's compose with this bundle's env files and compose files. A bare `compose` call on `compose.yaml` alone has no `db` service |

**Upgrading from a bundle that ran Ollama.** Compose leaves a container running once its service has
left the file, so `up`, `update`, `restart`, `down` and `destroy` remove the old `ollama` container
themselves — selected by its compose project and service labels in both providers' namespaces, never
by name or image, and never with `--remove-orphans`, which under Podman Compose removes every container
of the project or none. Its image and `data/ollama` are left to the operator. The legacy model in
`.env` is refused before anything is pulled or started; the other old embedding lines (`OLLAMA_*`,
`EMBEDDING_URL`, `EMBEDDING_SIMILARITY_THRESHOLD`) only draw a notice.

**A refused start is reported.** Podman Compose's `up -d` exits 0 even when a dependency failed, so `up` and
`update` then read the newest `console-init` container's exit state from the engine, by its
labels, and fail with a pointer to `byodt logs console-init` when the one-shot stopped the start.

The engine is resolved once and recorded: an exported `CONTAINER_ENGINE` wins, then the value in
`.env`, then auto-detection (Docker first, then Podman). Whatever it lands on, the script validates
that engine's `compose` actually runs, so a wrong choice fails with a clear message instead of deep
inside a compose call.

### Backup and restore

On Memgraph, `backup` asks the database for a fresh snapshot (`CREATE SNAPSHOT`, hot and consistent — no downtime),
then copies **that exact file** out through the container to `backups/`. It copies through the
container rather than reading the host path, so it works identically for a bind mount and a named
volume. If no writes have occurred since the last snapshot the request fails benignly, and the newest
existing snapshot — already current — is used instead.

Snapshots are **graph-only**: database authentication is separate system state and is not inside them.
That has two consequences worth knowing. A snapshot carries no password, so it is not a secret-bearing
file (it does carry your entire graph, which is). And a restore leaves this deployment's own
credentials untouched, so a backup restores cleanly onto any deployment of the same version.

`restore` is destructive by design: it stages the file into the database container, then runs `RECOVER
SNAPSHOT … FORCE`, which clears the current graph before applying. It requires typed confirmation, and
warns when the version encoded in the backup's filename differs from the deployment's
`PLATFORM_VERSION`.

The database's own in-place snapshots (`SNAPSHOT_INTERVAL_SEC`) are for crash recovery. They live in
the data directory and are pruned by retention — they are not backups.

On Neo4j, Community dumps and loads only an offline database, so both commands stop the `db` service,
run `neo4j-admin` in a one-off container of that service (same image, user and mounts; `--no-deps`, so
nothing else starts), and start it again — on failure too. The platform stays up and loses its
connection meanwhile.

The dump never passes through `data/`. Each backup or restore makes a private working directory in the
bundle root (`.byodt-dump.XXXXXX`, mode `0700`, the operator's) and mounts it at `/dumps` into the
one-off container only. `neo4j-admin` runs as the service's own user — the uid `byodt` derives to map
to the operator — with the image's entrypoint bypassed, since started as root the entrypoint would drop
to the image's own user, which cannot enter the directory. The directory and the `EXIT` trap that
removes it and starts `db` again are set up before the stop, so a failed stop dumps nothing and still
asks the database to start.

`backup` dumps into the directory, refuses the result unless it is a regular file, and copies it to
`backups/byodt-dump-<version>-<time>.dump`, created mode `0600`. `restore` asks for the same typed
confirmation, stages the backup file into the directory (mode `0600`), mounts the directory read-only,
and loads it over the `neo4j` database. The load replaces the graph, so a failed load may leave no
current graph — unlike Memgraph's `RECOVER SNAPSHOT`, which leaves it in place — and `byodt` says to
restore again from a known-good backup. A dump holds the `neo4j` database only; users live in the
`system` database, so a restore leaves the deployment's password in place. Each engine refuses the
other's backup file.

---

## Related documentation

| Document | Description |
|---|---|
| [`CONSOLE.md`](./CONSOLE.md) | The one-shot's jobs and exit contract, the daemon, the state file, the mode layer |
| [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md) | Where the module payloads the one-shot installs come from |
| [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) | Trust boundaries, the authentication postures, and hardening |
| [BYODt deployment guide](../../user/byodt/README.md) | Operator procedures |
| [Configuration Guide](../../CONFIGURATION_GUIDE.md) | Every platform environment variable in detail |
| [Platform Architecture](../README.md) | What runs inside the platform container |
