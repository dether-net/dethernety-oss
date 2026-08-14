---
title: 'Configuring the BYODt Deployment'
description: 'The .env settings reference, the generated secret file, database storage, and how to apply a change'
category: 'documentation'
position: 3
navigation: true
tags: ['byodt', 'deployment', 'configuration', 'reference', 'env']
---

# Configuring the BYODt Deployment

Everything you can change about the deployment lives in three files in the bundle directory. This guide covers what each one is, every setting in the one you edit, and — the part that trips people up — which command actually applies a given change.

---

## The three configuration layers

| File | Who owns it | What is in it |
|---|---|---|
| `.env` | **You** | Every readable setting: the pinned image versions, the front-door address, database and embedding settings. This is the file you edit. |
| `.env.secrets` | Generated, then **yours to keep** | The database password, and nothing else. Created once on the first start, mode `0600`. |
| `mode/mode.env` | **The console** | The platform's authentication posture. Written by the console when you connect the deployment to the cloud or disconnect it. Do not hand-edit. |

All three are read on every command. `.env` and `.env.secrets` are deliberately separate so the password stays out of the file you open, share, and diff.

None of the three exists in the release tarball — the first `./byodt up` creates all of them. A later start never overwrites them.

---

## How to apply a change

A configuration change is not live until the affected containers are **recreated**. A plain container restart re-runs the same process with the same environment and would not pick the change up. Use the command that matches your change:

| What you changed | Apply it with |
|---|---|
| A value in `.env` | `./byodt up` |
| `DB_DATA` or `SNAPSHOT_INTERVAL_SEC` | `./byodt restart db` |
| A certificate in `tls/` (added, replaced, or removed) | `./byodt restart proxy` |
| Connected or disconnected the cloud, in the console | `./byodt restart` |
| Mounted or unmounted a content module, in the console | `./byodt restart platform` |
| The pinned image versions, to move to a new release | `./byodt update` |

Two rules of thumb behind that table:

- **`./byodt up` re-reads `.env` and the mode layer** and recreates whatever their values changed. It is the general apply step, and it is safe to run at any time — on an already-running deployment with no changes, it does nothing.
- **A change made only inside a mounted directory** — a certificate file, a module directory — does not change any container's configuration, so it needs that service recreated explicitly. That is why the certificate and content rows above name a specific service.

`./byodt restart` with no service recreates everything. Naming a service (`./byodt restart proxy`) recreates only that one, leaving its dependencies untouched.

---

## The `.env` reference

`.env` is created from `.env.example`, which stays in the bundle as the annotated original. Every setting below appears in it, in this order.

Spell boolean values exactly `true` or `false`. Do not rename any of these keys — the deployment reads them by name.

### The release set

`PLATFORM_VERSION` is the release. Everything cut from that release moves with it. The three third-party images are pinned on their own lines so you can repoint them at a mirror.

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `PLATFORM_VERSION` | **The one version knob.** It selects the platform image *and* the console image, and it selects which release's module payloads the one-shot downloads and which signing identity it requires. | The version of the bundle you downloaded | Upgrading. |
| `DB_IMAGE` | The graph database image. | The Memgraph version tested with this release | Repointing at a mirror you operate. |
| `OLLAMA_IMAGE` | The embedding server image. | The Ollama version tested with this release | Repointing at a mirror you operate. |
| `PROXY_IMAGE` | The front-door proxy image. | The nginx version tested with this release | Repointing at a mirror you operate. |

Upgrading is therefore a one-line change. The platform and the console are cut from the same release and cannot drift apart, because the console image follows `PLATFORM_VERSION` unless you deliberately override it.

**`CONSOLE_IMAGE` — an optional mirror override.** `.env` ships this key commented out, and you should normally leave it that way:

```
# CONSOLE_IMAGE=ghcr.io/dether-net/byodt-console:${PLATFORM_VERSION}
```

Uncomment it only to repoint the console image at a registry you operate. If you do, **keep its tag equal to `PLATFORM_VERSION`** — the console refuses to serve a platform version it was not built for, and a mismatched override aborts the start with a message naming both values.

`DB_IMAGE`, `OLLAMA_IMAGE` and `PROXY_IMAGE` name third-party images that your container engine pulls directly from their publishers. The bundle references them; it does not redistribute them. If you repoint one at a registry you operate, that copy is yours to make under that component's own licence — read `NOTICE` in the bundle first, in particular for the database.

### Container engine

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `CONTAINER_ENGINE` | Which engine runs the deployment: `docker` or `podman`. | Detected on the first start (Docker first, then Podman) and written into `.env` | You have both installed and want to force one. |

Recording the choice is what stops a later-installed second engine from silently taking over an existing deployment. To override for a single command without editing the file, export it:

```sh
CONTAINER_ENGINE=podman ./byodt status
```

Whatever it resolves to, the script validates that engine's `compose` before doing anything, so a wrong value fails immediately with a clear message rather than deep inside a compose call.

### Front door

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `FRONT_DOOR_PORT` | The host port the deployment publishes. Both the platform and the console are served through it. | `3000` | The port is taken by something else. |
| `FRONT_DOOR_BIND` | The host address the port is bound to. | `127.0.0.1` | You need to reach the deployment from another machine. |

This is the **only** published port. Everything else — the database, the embedding server, the platform, the console — stays on the deployment's internal network.

> **Port 3000 is not arbitrary.** It is a pre-registered loopback callback address, which is why a laptop deployment needs no identity-provider registration to sign in. Renumbering it — to 80, or anything else — silently reintroduces that step. Change it if you must, but know what it costs.

> **Binding beyond loopback exposes an unauthenticated deployment.** With the standalone defaults, anyone who can reach the port has full access. Set `FRONT_DOOR_BIND=0.0.0.0` only behind your own authenticated front door, and terminate TLS first. See [TLS at the front door](./OPERATIONS.md#tls-at-the-front-door).

### Authentication

There is no authentication setting in `.env`, by design. The platform's authentication posture lives in the console-owned mode layer — see [The mode layer](#the-mode-layer-modemodeenv) below.

### Database

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `NEO4J_USERNAME` | The database user the platform and the one-shot connect as. Not a secret. | `dethernety` | Rarely. Changing it on an existing deployment does not rename the existing database user. |
| `NEO4J_DATABASE` | The database name. | `memgraph` | Rarely. |
| `DB_DATA` | Where the database keeps its data — a host path, or the name of the declared volume. | `./data/memgraph` | See below. |
| `SNAPSHOT_INTERVAL_SEC` | How often, in seconds, the database writes an automatic in-place snapshot for crash recovery. `0` disables them. | `300` | You want more or less frequent crash-recovery points. |

The **password is not here.** It is generated into `.env.secrets` on the first start — see [The generated secret file](#the-generated-secret-file).

Automatic in-place snapshots are **not backups**. They live inside the data directory, are pruned over time by the database's own retention, and are lost with the machine. Use `./byodt backup` for anything you want to keep. See [Backing up and restoring](./OPERATIONS.md#backing-up-and-restoring-the-graph).

### Embedding

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `EMBEDDING_MODEL` | The model the embedding server serves **and** the model the platform queries. One value drives both, so they cannot drift apart. | `embeddinggemma` | You have a reason to use a different model. |
| `EMBEDDING_SIMILARITY_THRESHOLD` | The similarity cut-off for class matching. | `0.40` | Only alongside a model change — the threshold is model-dependent, and the default is tuned for the default model. |

Changing the model triggers a fresh download inside the `ollama` container on the next start, exactly like the first run.

### Module source

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `CONSOLE_RELEASE_BASE_URL` | Where the one-shot fetches the signed module payloads from. The release itself is selected by `PLATFORM_VERSION` — the console never picks a version of its own. | The public project repository | Rarely. |

### Platform "Settings" link

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `SETTINGS_URL` | The target of the **Settings** item in the platform's sidebar. | `/console/` — the operator console on the same address | You front the console somewhere else, or you want the link hidden (set it empty). |

---

## The generated secret file

`.env.secrets` holds one value:

```
NEO4J_PASSWORD=…
```

It is generated on the first start, written with mode `0600`, and **never regenerated**. Every later command reads it; nothing rewrites it.

### Why it must be kept

The database's own credentials were created from this password when the database first started. The file and the data are a matched pair:

- **Lose it while the graph exists, and you are locked out of your own data.** A new password would be generated on the next start, the database would keep expecting the old one, and the database would never come up healthy — which stops the whole deployment, because the platform waits for it.
- **It is not in your backups.** A backup snapshot is the graph only; database credentials are separate state and are not captured. That is what makes a snapshot portable and not a secret-bearing file — and it is also why the password file needs its own protection.

### How to treat it

- **Back it up separately**, somewhere private. It is the key to your graph.
- **Never commit it.** The bundle ignores it, along with every other generated file.
- **Do not delete it to "reset" anything.** If you want a clean graph, delete the *data* and keep the password — a fresh database adopts the password already on disk. `./byodt destroy` prints the exact commands for your storage setting.

---

## Where the database keeps its data

`DB_DATA` chooses between two stores.

| Value | Store | Good for | Trade-off |
|---|---|---|---|
| `./data/memgraph` (default) | A host bind mount inside the bundle directory | Native-Linux Docker. Visible on disk, easy to inspect and copy. | On a VM-backed runtime, the file-sharing layer can corrupt a running database. |
| `memgraph-data` | The named volume declared in `compose.yaml`, in the engine's own storage | Podman machine, and Docker Desktop on macOS or Windows | You cannot browse it from the host, and `./byodt backup` copies out through the container (which it does anyway). |

Any value starting with `.` or `/` is treated as a host path; anything else is treated as a volume name.

> **Switching is a fresh database, not a migration.** The two are separate stores. Change the setting and the deployment starts against an empty database — your existing data is still in the old store, untouched, but the deployment no longer looks there. To carry data across, take a backup first, switch, then restore:
>
> ```sh
> ./byodt backup                                   # while still on the old store
> # edit DB_DATA in .env
> ./byodt restart db
> ./byodt restore backups/<the file you just made>
> ```

Apply a change to `DB_DATA` with `./byodt restart db`.

---

## The mode layer (`mode/mode.env`)

This file is written by the console and read by the platform and the one-shot. It carries the deployment's authentication posture — nothing else — and it exists so that connecting or disconnecting the cloud is a console action rather than a configuration exercise.

On a standalone deployment it holds exactly two values, seeded on the first start:

```
ENABLE_NOAUTH=true
NODE_ENV=development
```

That is the unauthenticated single-operator posture. Security headers and the platform's query-depth guard apply in every mode regardless.

When you connect the deployment to the cloud, the console rewrites this same file with the identity settings from your deployment recipe. When you disconnect, it rewrites it back to the two values above. It is always rewritten, **never deleted** — a missing file would break the very recovery path disconnecting is.

**Do not hand-edit this file.** The console is its author, it validates everything it writes, and it refuses values that do not belong there. Connect and disconnect from the console instead; see [Cloud](./CLOUD.md).

Either change takes effect when the stack is recreated:

```sh
./byodt restart
```

---

## What to back up

Two separate things, with different lifetimes:

| What | Why | How |
|---|---|---|
| The graph | Your models, findings, and controls | `./byodt backup`, then copy the file off the machine. See [Backing up and restoring](./OPERATIONS.md#backing-up-and-restoring-the-graph). |
| `.env`, `.env.secrets`, `mode/`, `tls/` | Your configuration, the database password, the posture, and your certificate | Copy them somewhere private. They are small and change rarely. |

With those two, a lost machine costs you a re-download and a restore — not your work.

---

## Related

- [Operations](./OPERATIONS.md) — the command reference, backups, TLS, and upgrades.
- [Cloud](./CLOUD.md) — connecting the deployment, which is what writes the mode layer.
- [Troubleshooting](./TROUBLESHOOTING.md) — what a misapplied change looks like, and how to fix it.
