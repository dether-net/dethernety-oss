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
| `.env.secrets` | Generated, then **yours to keep** | The database password, and the outbound proxy's login if you add one. Created once on the first start, mode `0600`. |
| `mode/mode.env` | **The console** | The platform's authentication posture. Written by the console when you connect the deployment to the cloud or disconnect it. Do not hand-edit. |

All three are read on every command. `.env` and `.env.secrets` are deliberately separate so the password stays out of the file you open, share, and diff.

None of the three exists in the release tarball. [`./byodt setup`](./INSTALLATION.md#set-up-with-byodt-setup) writes `.env` from your answers (and `.env.secrets` only for a proxy login), and the first `./byodt up` creates whatever is still missing: `.env` with the defaults, the database password, and the mode layer. A later start never overwrites them.

---

## How to apply a change

A configuration change is not live until the affected containers are **recreated**. A plain container restart re-runs the same process with the same environment and would not pick the change up. Use the command that matches your change:

| What you changed | Apply it with |
|---|---|
| A value in `.env` | `./byodt up` |
| The outbound proxy's login, `HTTPS_PROXY_USERINFO` in `.env.secrets` | `./byodt up` |
| `proxy-ca/proxy-ca.pem` added or removed | `./byodt up` |
| `proxy-ca/proxy-ca.pem` replaced | `./byodt restart platform console` |
| `DB_DATA`, `SNAPSHOT_INTERVAL_SEC`, `NEO4J_DATA`, `NEO4J_HEAP_SIZE` or `NEO4J_PAGECACHE_SIZE` | `./byodt restart db` |
| `DB_ENGINE` | `./byodt down`, then `./byodt up` — see [The database engine](#the-database-engine) first |
| A certificate in `tls/` (added, replaced, or removed) | `./byodt restart proxy` |
| Connected or disconnected the cloud, in the console | `./byodt restart` |
| Mounted or unmounted a content module, in the console | `./byodt restart platform` |
| Updated the knowledge graph, in the console | `./byodt restart platform` |
| The pinned image versions, to move to a new release | `./byodt update`, or let `./byodt upgrade` do it — see [Operations → Upgrading to a new release](./OPERATIONS.md#upgrading-to-a-new-release) |
| `UPGRADE_REQUIRE_SIGNATURE` | Nothing: the next upgrade reads it |

Two rules of thumb behind that table:

- **`./byodt up` re-reads `.env` and the mode layer** and recreates whatever their values changed. It is the general apply step, and it is safe to run at any time — on an already-running deployment with no changes, it does nothing.
- **A change made only inside a mounted directory** — a certificate file, a module directory — does not change any container's configuration, so it needs that service recreated explicitly. That is why the certificate and content rows above name a specific service. Adding or removing the proxy's CA file is different: it switches the variables that point the services at it, which `./byodt up` sees. Replacing it changes nothing `up` sees, and the platform and the console read it only when they start.

`./byodt restart` with no service recreates everything. Naming a service (`./byodt restart proxy`) recreates only that one, leaving its dependencies untouched.

---

## The `.env` reference

`.env` is created from `.env.example`, which stays in the bundle as the annotated original. Every setting below appears in it — some only commented out (`CONSOLE_IMAGE`, `CONTAINER_ENGINE`, `DB_ENGINE`, `NEO4J_IMAGE`, `NEO4J_DATA`, `NEO4J_HEAP_SIZE`, `NEO4J_PAGECACHE_SIZE`, `EMBEDDING_THREADS`, `SETTINGS_URL`, `HTTPS_PROXY`, `NO_PROXY`, `UPGRADE_REQUIRE_SIGNATURE`), and `EMBEDDING_MODEL` only by mention. A `.env` made by an earlier release can lack a line the template now has. An upgrade adds a setting that is new in the release, as the template ships it, but not the settings it leaves alone, which [What an upgrade does](./OPERATIONS.md#what-an-upgrade-does) lists. To change a setting that has no line, add the line to `.env`. Without a line, `byodt` uses the default given here. It records `CONTAINER_ENGINE` and `DB_ENGINE` in `.env` when `./byodt up`, `restart`, `update` or `bootstrap` finds them missing — on the first run, or in the update an upgrade ends with — and on Neo4j, `NEO4J_IMAGE` too.

Spell boolean values exactly `true` or `false`. Do not rename any of these keys — the deployment reads them by name.

### The release set

`PLATFORM_VERSION` is the release. Everything cut from that release moves with it. The two third-party images are pinned on their own lines so you can repoint them at a mirror.

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `PLATFORM_VERSION` | **The one version knob.** It selects the platform image *and* the console image, and it selects which release's module payloads the one-shot downloads and which signing identity it requires. | The version of the bundle you downloaded | Upgrading. |
| `DB_IMAGE` | The Memgraph image, used when `DB_ENGINE=memgraph`. | The Memgraph version tested with this release | Repointing at a mirror you operate. |
| `NEO4J_IMAGE` | The Neo4j image, used when `DB_ENGINE=neo4j`. | Recorded in `.env` on the first Neo4j run: the image the bundle was tested with, `docker.io/library/neo4j:5.26.32-community` | Repointing at a mirror, or moving the database to a newer image (see below). |
| `PROXY_IMAGE` | The front-door proxy image. | The nginx version tested with this release | Repointing at a mirror you operate. |

Upgrading is therefore a one-line change. The platform and the console are cut from the same release and cannot drift apart, because the console image follows `PLATFORM_VERSION` unless you deliberately override it.

**`CONSOLE_IMAGE` — an optional mirror override.** `.env` ships this key commented out, and you should normally leave it that way:

```
# CONSOLE_IMAGE=ghcr.io/dether-net/byodt-console:${PLATFORM_VERSION}
```

Uncomment it only to repoint the console image at a registry you operate. If you do, **keep its tag equal to `PLATFORM_VERSION`** — the console refuses to serve a platform version it was not built for, and a mismatched override aborts the start with a message naming both values.

**`NEO4J_IMAGE` stays what the deployment started on.** On the first Neo4j run `byodt` records the image this bundle was tested with in `.env`, as `.env.example` does `DB_IMAGE` for Memgraph. A later bundle tested with a newer Neo4j image does not move the store on `./byodt update` — a newer database cannot be downgraded — and `./byodt up` and `./byodt update` warn when `NEO4J_IMAGE` differs from the tested image, as they do for `DB_IMAGE`. A deployment whose first Neo4j run recorded the floating tag `docker.io/library/neo4j:5.26-community` keeps that tag and gets the same warning. Whether to move it is your call: back up first (`./byodt backup`; there is no downgrade), set `NEO4J_IMAGE`, then run `./byodt update`.

`DB_IMAGE`, `NEO4J_IMAGE` and `PROXY_IMAGE` name third-party images that your container engine pulls directly from their publishers. The bundle references them; it does not redistribute them. If you repoint one at a registry you operate, that copy is yours to make under that component's own licence — read `NOTICE` in the bundle first, in particular for the database.

**Always name the registry.** Every image reference in `.env` starts with its registry host (`docker.io/…`, `ghcr.io/…`). Docker will accept a short name and quietly assume Docker Hub, but Podman refuses one unless the host has configured a search registry — which a default installation has not. A short name is therefore a deployment that starts under one engine and fails under the other, so keep the registry on any value you change.

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

This is the **only** published port. Everything else — the database, the platform, the console — stays on the deployment's internal network.

> **Port 3000 is not arbitrary.** It is a pre-registered loopback callback address, which is why a laptop deployment needs no identity-provider registration to sign in. Renumbering it — to 80, or anything else — silently reintroduces that step. Change it if you must, but know what it costs.

> **Binding beyond loopback exposes an unauthenticated deployment.** With the standalone defaults, anyone who can reach the port has full access. Set `FRONT_DOOR_BIND=0.0.0.0` only behind your own authenticated front door, and terminate TLS first. See [TLS at the front door](./OPERATIONS.md#tls-at-the-front-door).

### Authentication

There is no authentication setting in `.env`, by design. The platform's authentication posture lives in the console-owned mode layer — see [The mode layer](#the-mode-layer-modemodeenv) below.

### Database

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `DB_ENGINE` | The graph database: `memgraph` or `neo4j`. | `memgraph`, recorded in `.env` on the first run | Before the first start. See [The database engine](#the-database-engine). |
| `NEO4J_USERNAME` | The database user the platform and the one-shot connect as on Memgraph. Not a secret. Not used on Neo4j. | `dethernety` | Rarely. Changing it on an existing deployment does not rename the existing database user. |
| `NEO4J_DATABASE` | The database name on Memgraph. Not used on Neo4j. | `memgraph` | Rarely. |
| `DB_DATA` | Where Memgraph keeps its data — a host path, or the name of the declared volume. | `./data/memgraph` | See below. |
| `NEO4J_DATA` | Where Neo4j keeps its data — a host path, or the name of the declared volume. | `./data/neo4j` | See below. |
| `NEO4J_HEAP_SIZE` | Neo4j's Java heap, initial and maximum. The reference-data ingest parses large statements on the heap. | `2G` | The ingest fails with a memory error on Neo4j. |
| `NEO4J_PAGECACHE_SIZE` | Neo4j's page cache, which holds the graph's files in memory. | `1G` | A large graph reads slowly. |

On either engine a single statement may run for at most 600 seconds.

The **password is not here.** It is generated into `.env.secrets` on the first start — see [The generated secret file](#the-generated-secret-file).

### Embedding

The platform embeds in process with its built-in model, **`embeddinggemma-300m-retrieval-v1`** (EmbeddingGemma 300m, by Google). There is no separate service to run or configure. The `.env.example` section reads:

```
# --- Embedding -----------------------------------------------------------------------------------------
# The platform embeds in process with its built-in model, embeddinggemma-300m-retrieval-v1 (EmbeddingGemma,
# Google). Its weights (about 1.26 GB) are downloaded from Hugging Face on the first start into data/models and
# verified; './byodt models pull' does it ahead of time. The model is licensed under the Gemma Terms of Use:
# https://ai.google.dev/gemma/terms
# Leave EMBEDDING_MODEL unset: the platform refuses any model other than the one its MITRE data was made with.
# Inference threads (default 4): set to the host's cores (on Docker Desktop or a Podman machine, the VM's).
# EMBEDDING_THREADS=4
```

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `EMBEDDING_MODEL` | The embedding model the platform runs. Not in `.env` by default, and it should stay that way. | Unset — the built-in model | Never, in this release. Any value other than the built-in model stops the start (see below). |

**Leave `EMBEDDING_MODEL` unset.** The reference data's MITRE vectors were embedded with the built-in model, and a different model's queries would not match them. So any other value is refused before anything starts:

- `EMBEDDING_MODEL=embeddinggemma` — the model the old `ollama` service ran — is refused by `./byodt up`, `./byodt update` and `./byodt models pull` with an instruction to remove the line, however it is quoted, exported, or followed by a comment.
- Any other value is checked by `console-init` against the model this release's MITRE data was embedded with; on a mismatch it stops the start and the platform does not start. `./byodt up` then fails with `'./byodt logs console-init' says why`.

Settings of the old `ollama` service — `OLLAMA_IMAGE` and any other `OLLAMA_*` line, `EMBEDDING_URL`, `EMBEDDING_SIMILARITY_THRESHOLD` — are no longer used. `./byodt up`, `./byodt update` and `./byodt models pull` print a notice for each one they find; you can remove the lines. `./byodt update` does not remove them: it never changes your settings in `.env`, and only records a missing `CONTAINER_ENGINE` or `DB_ENGINE` there (on Neo4j, `NEO4J_IMAGE` too).

**The model's weights** (about 1.26 GB) live in `data/models` on the host, mounted into the platform. The platform downloads them once from Hugging Face on the first start and verifies each file's sha256; `./byodt models pull` does it ahead of time. A recreate or an upgrade that keeps the same model does not download them again. They are not secret and need no backup: a lost `data/models` is downloaded again on the next start.

**The licence.** The model is licensed under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms). The platform logs the licence once before it downloads, and `./byodt models pull` prints it.

**Memory.** The model is held in the platform's own memory for as long as it runs, which adds roughly 0.8–0.9 GiB to the platform container. This replaces the memory the old `ollama` service used, so the deployment's total is about the same as before.

> **`EMBEDDING_THREADS`** sets the embedder's inference threads (default 4): a positive integer, at most 64. Set it in `.env` to the host's core count if that differs — on Docker Desktop or a Podman machine, the VM's core count. The bundle passes it to the platform; apply a change with `./byodt up`.

### Snapshots

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `SNAPSHOT_INTERVAL_SEC` | How often, in seconds, Memgraph writes an automatic in-place snapshot for crash recovery. `0` disables them. Not used on Neo4j. | `300` | You want more or less frequent crash-recovery points. |

Applied on `./byodt restart db`.

Automatic in-place snapshots are **not backups**. They live inside the data directory, are pruned over time by the database's own retention, and are lost with the machine. Use `./byodt backup` for anything you want to keep — it copies the graph out to `backups/`. See [Backing up and restoring](./OPERATIONS.md#backing-up-and-restoring-the-graph).

### Module source

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `CONSOLE_RELEASE_BASE_URL` | Where the one-shot fetches the signed module payloads from. The release itself is selected by `PLATFORM_VERSION` — the console never picks a version of its own. | The public project repository | Rarely. |

### Platform "Settings" link

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `SETTINGS_URL` | The target of the **Settings** item in the platform's sidebar. | `/console/` — the operator console on the same address | You front the console somewhere else, or you want the link hidden (set it empty). |

### Outbound proxy

For a host whose only way to the internet is an HTTP proxy. The setup, in order, is in [Installation → Behind an outbound proxy](./INSTALLATION.md#behind-an-outbound-proxy); this section is the reference.

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `HTTPS_PROXY` | The proxy `console-init`, the platform and the console reach the internet through, as `http://host:port`. No login in it: that goes in `.env.secrets` (see [The outbound proxy's login](#the-outbound-proxys-login)). | Unset — they connect directly | The host reaches the internet only through a proxy. |
| `NO_PROXY` | Extra hosts reached directly, not through the proxy: exact host names or addresses, each with an optional `:port`, separated by commas. `byodt` adds `localhost`, `127.0.0.1`, `::1` and the deployment's own service names. | Unset | A host the deployment calls over `https://`, such as a LangGraph server, must bypass the proxy. |

Applied on `./byodt up` (or `./byodt restart`). The proxy's login, `HTTPS_PROXY_USERINFO`, lives in `.env.secrets`, and the CA of a proxy that inspects TLS in `proxy-ca/proxy-ca.pem`; both are described below.

**`byodt` reads it from `.env` only, never from your shell.** Operators behind a proxy often export one, and an upgrade must not start sending a deployment through a proxy it worked without. When your shell sets a different `HTTPS_PROXY`, `byodt` prints a notice and goes on with `.env`'s. It reads the setting for the commands that can create or recreate a service that calls out: `up`, `restart`, `update`, `models pull` and `compose`, and for `upgrade`, which downloads the new release through it (with the login from `.env.secrets`; a TLS-inspecting proxy's CA must be in the host's trust store for that download, since `proxy-ca/` reaches only the containers). `down`, `status`, `logs`, `backup`, `restore` and `destroy` do not read it, so a bad value does not stand in their way.

**What goes through the proxy.** Only HTTPS. Everything the deployment fetches from outside is HTTPS, and every plain-HTTP call stays inside the stack or on your own network. So there is no `HTTP_PROXY`: plain HTTP is never sent to the proxy, and `byodt` warns that an `HTTP_PROXY` line in `.env` is not used. `console-init`, the platform and the console get the setting. The database and the front door call nothing outside the stack, and get every proxy variable set empty. Image pulls do not use it either: the container engine pulls with its own setting (see [Installation → Give the container engine the proxy](./INSTALLATION.md#1-give-the-container-engine-the-proxy)).

**The URL.** `byodt` checks `HTTPS_PROXY` before anything starts, and refuses, with a message that says what to fix, any value that breaks these rules:

- It is `http://host:port` or `https://host:port`, with a numeric port from 1 to 65535 and nothing after it.
- `https://` means the services talk to the proxy itself over TLS. Most proxies take `http://`: the scheme is only how the services reach the proxy, and the HTTPS connections they make through it stay HTTPS. Without a login, `byodt` warns about an `https://` value.
- The host is not `localhost` or a loopback address: inside a container, that is the container itself. It is not one of the deployment's own service names either: `db`, `console-init`, `platform`, `proxy` (the front door), `console`, or a service `compose.override.yaml` adds. Use a name the containers can resolve, or the host's address on the network the proxy listens on.
- It carries no login. `byodt` refuses `user:password@` in `.env`.

**`NO_PROXY` takes exact names only.** `byodt` refuses CIDR blocks (`10.0.0.0/8`), address ranges, wildcards (`*.example.com`), a leading dot and spaces, because the services' HTTP clients read those forms differently. Do not rely on an entry to cover its subdomains either: the platform's core HTTPS agent matches the exact name only. List every host — `login.example.com`, not `example.com`. An `http://` destination, such as a LangGraph server on plain HTTP, needs no entry, because plain HTTP never goes to the proxy.

#### A proxy that inspects TLS

Many corporate proxies re-sign every HTTPS connection with a CA of their own. The services then refuse every certificate the proxy presents, until they trust that CA.

**Prefer pass-through.** Ask the proxy's operators to pass the identity provider your cloud connection names, and the content service, through uninspected. Use the CA file only when they cannot. The warning below says why.

**The CA file** is `proxy-ca/proxy-ca.pem`, in PEM form. It may hold more than one certificate. A private CA your identity provider uses goes in the same file. `byodt` creates `proxy-ca/` (mode `0755`) on the first start, and checks it before every command that reads the proxy setting. It refuses to go on when:

- `proxy-ca/` holds anything but `proxy-ca.pem`. `console-init` and the console trust every certificate file in the directory, and the platform only the one named, so another file would make them trust different CAs.
- `proxy-ca.pem` is a symbolic link, which does not resolve inside the containers.
- `proxy-ca.pem` is not readable by every account (mode `0644`). The services read it under their own accounts.
- The directory or the file is owned by another account (not you or root), or other accounts can write to it.

The platform adds the file to Node's trusted roots (`NODE_EXTRA_CA_CERTS`); `console-init` and the console add it to Go's (`SSL_CERT_DIR`). It adds to the default roots and replaces none of them, and it applies whether or not `HTTPS_PROXY` is set. Adding or removing the file is applied with `./byodt up`. After replacing it, run `./byodt restart platform console`: they read it only when they start. `console-init` reads it on its next run.

The CA reaches only the deployment's containers. For image pulls through an inspecting proxy, the container engine needs it in the host's trust store; see [Installation → Give the container engine the proxy](./INSTALLATION.md#1-give-the-container-engine-the-proxy).

> **Warning: what trusting the CA hands over.** It covers every TLS connection `console-init`, the platform and the console make, the `NO_PROXY` hosts included (for hosts reached directly, from a position on the path). Whoever holds the CA's key can read and change all of it:
>
> - **Sign-in.** It can serve its own signing keys in place of the identity provider's, and so sign anyone in to the platform and the console, administrators included. It can also forge the answer the console's administrator check reads.
> - **Content.** It can change any response that carries no signature of its own: the catalog, the knowledge graph, templates, guides and evaluation results.
> - **What is sent.** It can read the operator's cloud token, users' sign-in tokens, the threat-model attributes sent for evaluation, and knowledge-graph queries.
>
> Signed content stays checked against what does not come from the network. Code modules are verified against a trusted root embedded in the console image and the identity pinned to the release. Cloud artifacts are verified against the signer your cloud recipe names. The model's weights are checked against the sha256 the platform image pins. A change to any of them fails its check.

### Upgrades

| Setting | What it does | Default | Change it when |
|---|---|---|---|
| `UPGRADE_REQUIRE_SIGNATURE` | `true` makes every upgrade of this deployment refuse a release that cosign did not verify, as `--require-signature` does. An upgrade given `--allow-unsigned` is refused before anything is downloaded. `false`, or an empty value, leaves it to the flags. Any other value stops every upgrade. | Unset — an upgrade whose signature cannot be checked (cosign is not installed, or an installer `--tarball` has no `.bundle` beside it) asks at a terminal, and needs `--allow-unsigned` unattended. A signature cosign rejects always stops the upgrade | cosign is installed on this host and no upgrade should run without it. |

Both `./byodt upgrade` and the installer's `--upgrade` read it from this deployment's `.env`, as compose would read the line (quotes and an `export ` prefix are fine). `true` and `false` count in any case, so `True` counts as `true`. Any other value, such as `yes`, `1` or `on`, may have been meant as `true`, so the upgrade stops before anything is downloaded, with `.env sets UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false. Nothing was changed.` An upgrade never changes the setting. An account that cannot read `.env` cannot tell whether it is set, so its upgrade stops instead of going on without it. See [Operations → Signatures](./OPERATIONS.md#signatures).

---

## The generated secret file

`.env.secrets` holds one generated value, the database password:

```
NEO4J_PASSWORD=…
```

It is generated on the first start, written with mode `0600`, and **never regenerated**. Every later command reads it; nothing rewrites it.

It can hold one value you add yourself: the outbound proxy's login (see [The outbound proxy's login](#the-outbound-proxys-login) below).

### Why it must be kept

The database's own credentials were created from this password when the database first started. The file and the data are a matched pair:

- **Lose it while the graph exists, and you are locked out of your own data.** A new password would be generated on the next start, the database would keep expecting the old one, and the database would never come up healthy — which stops the whole deployment, because the platform waits for it.
- **It is not in your backups.** A backup — a Memgraph snapshot or a Neo4j dump — is the graph only; database credentials are separate state and are not captured. That is what makes a backup portable and not a secret-bearing file — and it is also why the password file needs its own protection.

### How to treat it

- **Back it up separately**, somewhere private. It is the key to your graph.
- **Never commit it.** The bundle ignores it, along with every other generated file.
- **Do not delete it to "reset" anything.** If you want a clean graph, delete the *data* and keep the password — a fresh database adopts the password already on disk. `./byodt destroy` prints the exact commands for your storage setting.

### How Memgraph stores it

On Memgraph, the bundle stores the password with a salted, iterated SHA-256 hash (`--password-encryption-algorithm=sha256-multiple` in `compose.memgraph.yaml`), not Memgraph's default, bcrypt. A bcrypt login holds a lock that queries wait for, so a burst of new database connections — after a restart, for example — stalls queries for seconds; with this hash a login costs almost nothing. Neo4j is unaffected.

Memgraph keeps each stored hash in the algorithm it was made with, so `./byodt up` and `./byodt update` set the database user's password again to the value it already has. They do it after a full start, or a start of a service that depends on the database; a start of only the console or only the database skips it. **No password changes:** `.env.secrets` is not touched, and the platform logs in as before. The re-apply takes the password from the database container's own environment, puts it on no command line, and never prints it. If it fails, `byodt` warns and carries on — logins still work, only slower — and the next `./byodt up` or `./byodt update` tries again. Going back to an older bundle is safe: it still verifies the stored hash.

The re-apply covers only a password of the generated shape — lowercase hex, 32 characters or more — and a user name of letters, digits and underscores that does not start with a digit. On an existing deployment, any other password keeps the hash it has; a new deployment stores any password with the faster hash from the start.

**If you set your own password, make it long and random.** The generated one is 48 random hex characters (192 bits), too long to guess or crack whatever the hash; generate yours the same way, with `openssl rand -hex 24`. On Memgraph, `./byodt up` and `./byodt update` warn when `NEO4J_PASSWORD` is shorter than 32 characters. On an existing deployment, set the new password in the database first and only then in `.env.secrets`: changing the file alone locks the platform out (see [Why it must be kept](#why-it-must-be-kept)).

### The outbound proxy's login

If your outbound proxy needs a login, add it to `.env.secrets` on a line of its own:

```
HTTPS_PROXY_USERINFO=user:password
```

**How to write it.** The user name and the password, separated by exactly one colon, with no quotes. Every other character must be a letter, a digit, or one of `. _ ~ - ! & ' ( ) * + , ; =`. Percent-encode the rest, in the user name as well as the password:

| Character | Write it as |
|---|---|
| `#` | `%23` |
| `/` | `%2F` |
| `@` | `%40` |
| `:` | `%3A` |
| `$` | `%24` |
| `%` | `%25` |
| A space | `%20` |
| A character outside ASCII | Its UTF-8 bytes, for example `é` as `%C3%A9` |

`byodt` refuses anything else before it starts a service. Node and Go print a proxy URL they cannot parse in full, login included, so an invalid one must never reach them. Only basic authentication is supported: a proxy that needs NTLM or Kerberos login is not.

**How it is used.** `byodt` adds the login to `HTTPS_PROXY` only in the environment it passes to `console-init`, the platform and the console. It never writes the combined URL to a file. Apply a change with `./byodt up`. A login with no `HTTPS_PROXY` in `.env` is not used, and `byodt` warns about it.

**Where it is masked.** As `***`, in these places only:

- `byodt`'s own messages.
- `console-init`'s error for a failed module download, in its log and in the status it leaves for the console.
- The console's errors for a failed call to the cloud content service or to the platform.
- The platform's errors for a failed fetch of the sign-in keys, of cloud content, or of the embedding model's weights.

Other error text is not masked. In tests, Node's own proxy errors left the login out: a failed tunnel reads `Failed to establish tunnel to <host>:443 via http://<proxy-host>:<port>/`, and `fetch`'s errors named no login. The one error seen with the login in it was Node's for a proxy URL it cannot parse, at the platform's start, and `byodt`'s checks above refuse such a URL first. No service log carried the login in those tests. It does show wherever the services' environment is shown, as listed next.

**Who can see it.** The same accounts that can see the database password:

- Anyone who can run your container engine: `docker inspect` or `podman inspect` shows the environment of those three services in full, and so does `./byodt compose config`.
- Under `podman-compose`, any local account that lists processes (`ps`), while containers are created: the encoded login is on the `podman` command lines `podman-compose` runs, as the database password is. Docker Compose passes the environment through the engine's API, not on a command line.

**On the network.** With an `http://` proxy URL, the login crosses the network to the proxy in clear, on every connection. Use `https://` if the proxy offers it.

---

## The database engine

`DB_ENGINE` selects the graph database: `memgraph` (the default) or `neo4j` (Neo4j 5.26 Community). The rest of the deployment is the same on either.

| | Memgraph | Neo4j |
|---|---|---|
| Image | `DB_IMAGE` | `NEO4J_IMAGE`, recorded on the first run as the tested image `docker.io/library/neo4j:5.26.32-community` |
| Data | `DB_DATA` (default `./data/memgraph`) | `NEO4J_DATA` (default `./data/neo4j`) |
| Logs | `data/memgraph-log` | `data/neo4j-logs` |
| Memory | A fixed 4096 MiB limit | `NEO4J_HEAP_SIZE` (`2G`) plus `NEO4J_PAGECACHE_SIZE` (`1G`) |
| Login | `NEO4J_USERNAME`, to database `NEO4J_DATABASE` | Always user `neo4j`, to database `neo4j` |
| Backup | A snapshot, with no downtime | A dump; the database is stopped meanwhile |
| Licence | BSL 1.1 | GPLv3 |

**How `byodt` picks it.** An exported `DB_ENGINE` wins, for that one command. Otherwise the value in `.env`; otherwise `memgraph`. On the first run `byodt` writes the result into `.env`, so a deployment first started with `DB_ENGINE=neo4j ./byodt up` stays on Neo4j. It reads the `.env` line as compose does, so an `export ` prefix or a trailing ` # comment` is fine. Any other value stops `byodt` with an error that says whether it came from `.env` or from your shell's environment.

**The Neo4j login.** Neo4j Community serves one database, `neo4j`, and the platform logs in as its administrator, `neo4j`, with the password from `.env.secrets`. `NEO4J_USERNAME` and `NEO4J_DATABASE` in `.env` are not used. When they say something else, `byodt` prints a notice for each, once, on the first Neo4j run; it changes nothing, and you can remove the lines or leave them.

**APOC Core on Neo4j.** The platform needs two APOC Core functions on Neo4j: `apoc.date.convertFormat`, which every date-and-time field is read through, and `apoc.util.validatePredicate`, which the checks in some updates run through. The bundle loads APOC Core from the jar the Neo4j image ships in its `labs/` directory: `compose.neo4j.yaml` points the plugins directory there (`NEO4J_server_directories_plugins`) and names the two functions in the procedure allowlist (`NEO4J_dbms_security_procedures_allowlist`). Only those two load: no other APOC procedure or function can be called, and none is given unrestricted access. Nothing is copied or downloaded. An image you set in `NEO4J_IMAGE` must ship APOC Core in `labs/`, as the official Neo4j images do. At startup the platform checks that both functions are there and run. When they are not, it still starts, but logs an error that names the missing functions, or says that they are listed but cannot run (`./byodt logs platform`); without them, every query that reads a date-and-time field fails.

**Switching is a new, empty graph.** Each engine keeps its own data, and nothing converts one into the other; each engine also refuses the other's backup file. After a switch the one-shot ingests the reference data again, and your models stay behind in the old engine's store. To switch from Memgraph to Neo4j:

```sh
./byodt backup                       # on the current engine, to keep its graph
./byodt down
mv data/memgraph data/memgraph.old   # move the current engine's data aside
# set DB_ENGINE=neo4j in .env
./byodt up
```

Switching back works the same way, with the names swapped. With the data in named volumes there is nothing to move: each engine has its own volume. If you leave the old data in place, `./byodt up`, `./byodt restart`, `./byodt update` and `./byodt bootstrap` refuse to start an engine whose data directory is empty while the other engine's holds a graph, and say what to do. The check runs before `byodt` records anything, so a refused start leaves `.env` and `data/` as they were: an exported `DB_ENGINE` that is refused is not recorded. That check needs both stores to be host bind mounts: a store in a named volume is not checked.

---

## Where the database keeps its data

`DB_DATA` (Memgraph) or `NEO4J_DATA` (Neo4j) chooses between two stores.

| Value | Store | Good for | Trade-off |
|---|---|---|---|
| `./data/memgraph` or `./data/neo4j` (default) | A host bind mount inside the bundle directory | Native Linux, under either container engine. Visible on disk, easy to inspect and copy. | On a VM-backed runtime, the file-sharing layer can corrupt a running database. |
| `memgraph-data` or `neo4j-data` | The named volume declared in the engine's compose file, in the container engine's own storage | Podman machine, and Docker Desktop on macOS or Windows | You cannot browse it from the host. |

Any value starting with `.` or `/` is treated as a host path; anything else is treated as a volume name.

On a bind mount, `byodt` runs the database as the user that owns the directory — Memgraph requires that, and which user it is depends on your container engine, so the control script works it out rather than asking you to. The practical consequence is that your data stays owned by you and readable from the host, which is the reason to pick a bind mount in the first place. Under rootless Podman, Neo4j's files belong to the container's user instead: remove them with `podman unshare rm -rf data/neo4j`.

The bundle expects to be driven through `byodt`. The database service is not in `compose.yaml` but in `compose.memgraph.yaml` or `compose.neo4j.yaml`, and `byodt` passes the right one along with the user it derived. A raw `compose up` has neither, and the database will not start.

> **Switching is a fresh database, not a migration.** The two are separate stores. Change the setting and the deployment starts against an empty database — your existing data is still in the old store, untouched, but the deployment no longer looks there. To carry data across, take a backup first, switch, then restore:
>
> ```sh
> ./byodt backup                                   # while still on the old store
> # edit DB_DATA in .env
> ./byodt restart db
> ./byodt restore backups/<the file you just made>
> ```

Apply a change to `DB_DATA` or `NEO4J_DATA` with `./byodt restart db`.

---

## Local changes to the compose files

Put your own compose changes in `compose.override.yaml` in the bundle directory. `byodt` passes it to compose last, after `compose.yaml` and the engine's file, and a bundle upgrade does not overwrite it. `byodt` loads no other override file name: when it finds `compose.override.yml`, `docker-compose.override.yaml` or `docker-compose.override.yml`, `./byodt up` and `./byodt update` warn that the file is not loaded. Rename it to use it.

---

## The mode layer (`mode/mode.env`)

This file is written by the console and read by the platform and the one-shot. It carries the deployment's authentication posture — nothing else — and it exists so that connecting or disconnecting the cloud is a console action rather than a configuration exercise.

On a standalone deployment it holds exactly two values, seeded on the first start:

```
ENABLE_NOAUTH=true
NODE_ENV=development
```

That is the unauthenticated single-operator posture. Security headers and the platform's query-depth guard apply in every mode regardless.

Four console controls write this file, and nothing else does. Two of them replace it whole; the other two each rewrite a single line.

| Control | What it writes | What applies it |
|---|---|---|
| **Apply cloud configuration**, in section **2 · Configuration** of the Cloud tab | The whole file, replaced with the identity settings from your deployment recipe | `./byodt restart` |
| **Disconnect from cloud**, in the **Disconnect** section at the foot of the Cloud tab | The whole file, replaced with the two standalone values above | `./byodt restart` |
| The **Who may sign in** card, section **3 · Who may sign in** of the Cloud tab — **Apply**, **Remove people who have left**, or the paste box's **Apply access list**, all through one write | One line, `DEPLOYMENT_ALLOWLIST`. Every other value is left exactly as it was | `./byodt restart platform` |
| **Update to the … version**, on the knowledge-graph entry of the Content tab | One line, `MODULE_KG_VERSION` — the knowledge-graph version this deployment is pinned to. Every other value is left exactly as it was | `./byodt restart platform` |

It is always rewritten, **never deleted** — a missing file would break the very recovery path disconnecting is.

**Which restart follows from which value moved, not from which file was written.** Connecting and disconnecting change values that several services read, so the whole stack has to come back up in the new mode. The access list and the knowledge-graph version are read only by the platform, so only the platform is recreated — and that restart removes no module, so it has none of the consequences for your classes and links that a restart finding a module missing does. See [Cloud → Changing who may sign in](./CLOUD.md#changing-who-may-sign-in) and [Cloud → Update the knowledge graph](./CLOUD.md#update-the-knowledge-graph).

**Do not hand-edit this file — reading it is fine.** The console is its author, it validates everything it writes, and it refuses values that do not belong there; a hand edit gets none of those checks, and a connect or a disconnect replaces the file whole, so it would not survive one anyway. Make changes from the console instead; see [Cloud](./CLOUD.md).

There is one good reason to open it. Nothing in the console shows you who may currently sign in, so the `DEPLOYMENT_ALLOWLIST` line here is the only place to check whether an apply dropped somebody — see [Troubleshooting → I need to see who is on the access list](./TROUBLESHOOTING.md#i-need-to-see-who-is-on-the-access-list).

---

## Files `byodt` keeps for itself

Besides your configuration, `byodt` keeps a few records in the bundle directory. Leave them in place: they belong to the deployment, not to a release. No release ships them; `byodt` writes them itself.

| Path | What it is |
|---|---|
| `.byodt-release` | The release this deployment runs, and the SHA-256 of every file that release shipped. Written by `./byodt setup` or the first start, and by each upgrade. The next upgrade checks your local edits against it. |
| `third-party-acknowledgement.log` | One line for each confirmation of the third-party notice. See [Installation → The third-party notice](./INSTALLATION.md#the-third-party-notice). |
| `backups/upgrade-<from>-to-<to>-<time>/` | Each upgrade's backup: the graph, `.env`, the release record and the old release's files. Readable by you only. The upgrade's rollback steps restore from it. |
| `.byodt-upgrade.state`, `.byodt-upgrade.lock`, `.byodt-upgrade.lock.takeover`, `.byodt-upgrade.XXXXXX/` | An upgrade in progress: its journal, its lock (and, while it takes over a stale lock, the takeover lock), and its staging folder. They go when the upgrade finishes or is dropped. Do not remove them by hand while an upgrade is half done; run `./byodt upgrade`, or `./byodt upgrade --abandon`. |

---

## What to back up

Two separate things, with different lifetimes:

| What | Why | How |
|---|---|---|
| The graph | Your models, findings, and controls | `./byodt backup`, then copy the file off the machine. See [Backing up and restoring](./OPERATIONS.md#backing-up-and-restoring-the-graph). |
| `.env`, `.env.secrets`, `mode/`, `tls/`, `proxy-ca/` | Your configuration, the database password and any proxy login, the posture, your certificate, and any proxy CA | Copy them somewhere private. They are small and change rarely. |

With those two, a lost machine costs you a re-download and a restore — not your work.

---

## Related

- [Operations](./OPERATIONS.md) — the command reference, backups, TLS, and upgrades.
- [Cloud](./CLOUD.md) — connecting the deployment, which is what writes the mode layer.
- [Troubleshooting](./TROUBLESHOOTING.md) — what a misapplied change looks like, and how to fix it.
