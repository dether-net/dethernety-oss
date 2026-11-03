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

A note on reading `./byodt status`: `console-init` is a one-shot, so plain `status` does not list it once it has exited. Run `./byodt status -a` to see it. **Exited** is correct; what matters is its exit code — `Exited (0)` is success.

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

> `error: Not set up yet — run './byodt bootstrap' (or just './byodt up', which does it for you).`

**Cause.** A command that needs a configured deployment ran against a bundle that has not been set up — a fresh extract, or one where `.env`, `.env.secrets`, or `mode/mode.env` was removed.

**Fix.**

```sh
./byodt up
```

That repairs the layout and starts the deployment. If `.env.secrets` was deleted while a graph already exists, read [The database will not become healthy](#the-database-will-not-become-healthy) before running anything.

### `Refusing '-v'`

> `error: Refusing '-v' — it deletes data/images this command keeps by design. Remove the graph explicitly instead ('./byodt destroy' prints how).`

**Cause.** You passed `-v`, `--volumes`, or `--rmi` to `down` or `destroy`. These commands keep your data by design, so they refuse flags that would contradict that rather than silently obeying.

**Fix.** If you did want to erase the graph, do it explicitly:

```sh
./byodt destroy
```

and run the wipe command it prints for your storage setting.

### `EMBEDDING_MODEL=embeddinggemma in .env names the old embedding server's model`

> `error: EMBEDDING_MODEL=embeddinggemma in .env names the old embedding server's model, which this release no longer runs. Remove the EMBEDDING_MODEL line from .env: the platform embeds in process with its default model.`

**Cause.** Your `.env` was carried over from a release that ran the old `ollama` service, and still selects that service's model. This release has no `ollama` service: the platform embeds in process. `./byodt up`, `./byodt update` and `./byodt models pull` refuse the setting before anything starts, however the value is quoted, exported, or followed by a comment.

**Fix.** Delete the `EMBEDDING_MODEL` line from `.env` (or comment it out), then run the command again. Leaving the key unset selects the platform's default model. See [Operations → Upgrading from a release with the `ollama` service](./OPERATIONS.md#upgrading-from-a-release-with-the-ollama-service).

### `… is no longer used` notices, and `data/ollama`

> `==> OLLAMA_IMAGE in .env is no longer used (this bundle has no Ollama service); you can remove the line.`
>
> `==> data/ollama (…) holds the old embedding server's model and is no longer used. Once the new start has worked: sudo rm -rf data/ollama`

**Cause.** Notices, not errors. `./byodt up`, `./byodt update` and `./byodt models pull` report every `OLLAMA_*` line, and an `EMBEDDING_URL` or `EMBEDDING_SIMILARITY_THRESHOLD` line, left in `.env` by an older release, and a leftover `data/ollama` directory with its size. None of them stops the start. These commands never remove the lines or delete `data/ollama` for you: they never change your settings in `.env`, and only record a missing `CONTAINER_ENGINE` or `DB_ENGINE` (on Neo4j, `NEO4J_IMAGE` too).

**Fix.** Optional. Remove the named lines from `.env` whenever convenient. Once the new release has started and works, reclaim the disk:

```sh
sudo rm -rf data/ollama
```

`sudo` is usually needed (rootful Docker on Linux): the old `ollama` service wrote the directory as root. If `data/ollama` is a symbolic link, `byodt` reports only that it is one: it does not name or measure the link's target. Check where it points yourself (`ls -l data/ollama`) before you remove anything. Keep `data/ollama` while you might still roll back to the previous release, which uses it.

### `DB_ENGINE is …, but its data directory (…) is empty`

> `error: DB_ENGINE is neo4j, but its data directory (./data/neo4j) is empty while memgraph's (./data/memgraph) holds a graph. Starting would bring up an empty graph. To keep using memgraph, set DB_ENGINE=memgraph in .env (and unset an exported DB_ENGINE). To move to neo4j, move ./data/memgraph aside: the neo4j graph starts empty, and a backup taken on memgraph cannot be loaded into it.`

The same message appears with the engines the other way round.

**Cause.** `DB_ENGINE` now names the other engine — changed in `.env`, or exported for this command — while your graph is in the first engine's data directory. Nothing converts one engine's data into the other's, so starting would bring up an empty graph. `./byodt up`, `./byodt restart`, `./byodt update` and `./byodt bootstrap` refuse, before they record or create anything: `.env` and `data/` are left as they were, so an exported `DB_ENGINE` that is refused is not recorded either.

**Fix.** To stay on the engine that holds your graph, set `DB_ENGINE` back in `.env` and unset any exported `DB_ENGINE`. To switch on purpose, follow [Configuration → The database engine](./CONFIGURATION.md#the-database-engine): back up, `./byodt down`, move the old data directory aside, `./byodt up`.

### `DB_ENGINE=… is not a database this bundle runs`

> `error: DB_ENGINE=… in .env is not a database this bundle runs — set memgraph or neo4j.`

When the value is exported, the message says `in your shell's environment` instead of `in .env`.

**Cause.** `DB_ENGINE` in `.env`, or exported, is neither `memgraph` nor `neo4j`. `byodt` reads the `.env` line as compose does: an `export ` prefix, quotes, and a trailing ` # comment` are fine; the value itself must be one of the two.

**Fix.** Set `DB_ENGINE=memgraph` or `DB_ENGINE=neo4j` in `.env`, unset any exported value, and run the command again.

### `NEO4J_USERNAME=… in .env is not used on Neo4j`

> `==> NEO4J_USERNAME=dethernety in .env is not used on Neo4j: the platform connects with NEO4J_USERNAME=neo4j. You can remove the line.`

**Cause.** A notice, not an error. On Neo4j the platform always connects as `neo4j` to the database `neo4j`, so `NEO4J_USERNAME` and `NEO4J_DATABASE` in `.env` are not used. On the first Neo4j run — the one that records `NEO4J_IMAGE` in `.env` — `byodt` says so for each one set to another value. It does not repeat the notice on later runs.

**Fix.** None needed. You can remove the lines, or leave them.

### `… is not loaded: byodt reads local changes from compose.override.yaml only`

> `warning: compose.override.yml is not loaded: byodt reads local changes from compose.override.yaml only. Rename it to use it.`

**Cause.** `byodt` names the compose files it passes, and `compose.override.yaml` is the only override file among them. Compose no longer picks up `compose.override.yml`, `docker-compose.override.yaml` or `docker-compose.override.yml` on its own.

**Fix.** Rename the file to `compose.override.yaml`, then `./byodt up`. See [Configuration → Local changes to the compose files](./CONFIGURATION.md#local-changes-to-the-compose-files).

### The platform does not start, or keeps restarting, after `./byodt restart`

**Symptom.** One of two, depending on the command:

- After **`./byodt restart`**, `./byodt status` shows the platform not running, and `./byodt logs console-init` ends with a refusal that names `EMBEDDING_MODEL`.
- After **`./byodt restart platform`**, `./byodt status` shows the platform restarting over and over, and `./byodt logs platform` ends with a refusal that names `EMBEDDING_MODEL`.

**Cause.** `./byodt restart` and `./byodt restart platform` skip the pre-flight checks that `./byodt up` and `./byodt update` run. A stale `.env` — typically one that still sets `EMBEDDING_MODEL=embeddinggemma` after an upgrade — is therefore not caught before the start. What happens next depends on what the command recreates:

- **`./byodt restart`** recreates the whole stack, the one-shot `console-init` included. `console-init` refuses the model, and the platform starts only once `console-init` has completed successfully — so the platform stays down. It does not loop.
- **`./byodt restart platform`** recreates only the platform, without the services it depends on. The platform refuses the model at every start, and the engine starts it again: a restart loop.

**Fix.** Run `./byodt up`. Its checks stop before anything starts and say what to change in `.env`; change it, then run `./byodt up` again.

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

### `this bundle's compose project is already used by another directory`

> ```
> error: this bundle's compose project is already used by another directory:
>     /home/you/dethernety-old
> Running this here would act on its containers. Upgrade that deployment instead ('./byodt upgrade' in it), or
> stop it there ('./byodt down'). If this deployment was moved here from that directory, run './byodt down --take-over'
> here once to remove the old containers, then start it here.
> ```

**Cause.** Every bundle's deployment has the compose project name `dethernety`, and containers of that project, running or stopped, were started from the folder it names. Acting here would act on them: start this folder's services in their place, or stop, back up, restore or remove the other folder's. `up`, `update`, `restart`, `down`, `stop`, `destroy`, `backup`, `restore`, `upgrade` and `setup --start` all refuse, and change nothing.

**Fix.** It depends on what the other folder is:

- **Another deployment you keep:** only one runs at a time. Run `./byodt down` in that folder, then the command here. To move it to a newer release, upgrade it in its own folder instead of installing a new one.
- **This deployment, before you moved it here:** remove the old containers once from here, then start here:

  ```sh
  ./byodt down --take-over
  ./byodt up
  ```

- **An old folder you no longer need:** `./byodt down` in it, or `./byodt down --take-over` here.

See [Operations → A deployment in another folder](./OPERATIONS.md#a-deployment-in-another-folder).

### `The volume dethernety_… remains from an earlier deployment of this bundle, and this one would mount it`

> `error: The volume dethernety_memgraph-data remains from an earlier deployment of this bundle, and this one would mount it: that graph's database users were made with another password, so the platform would be locked out. Set DB_DATA=./data/memgraph in .env to keep the database in a folder instead (less robust on a VM-backed engine), or upgrade the deployment it belongs to; if you no longer need that graph, remove it with 'docker volume rm dethernety_memgraph-data' (this deletes it for good), and run the command again.`

From `./byodt setup --start` the advice reads `Run setup with --db-data bind` instead of the `.env` setting. Setup also warns about such a volume before it writes anything, whether or not it starts.

**Cause.** This folder has not started yet, and it keeps its database in the named volume, which an earlier deployment of the bundle left. Its database users were created with that deployment's password, not this folder's, so the platform would be locked out of it.

**Fix.** Choose one:

- **You want that graph:** start the deployment it belongs to instead, or upgrade it.
- **You want both:** keep this one's database in a folder: set `DB_DATA=./data/memgraph` (on Neo4j, `NEO4J_DATA=./data/neo4j`) in `.env`, and start again.
- **You no longer need that graph:** remove the volume with the command the message gives. This deletes it for good.

See [Installation → Database volumes an earlier deployment left](./INSTALLATION.md#database-volumes-an-earlier-deployment-left).

### `There is no terminal to confirm the notice above on`

> `error: There is no terminal to confirm the notice above on. Run the command at a terminal, or add --yes. Nothing has been downloaded yet.`

The installer's form reads `Run this at a terminal, or add --yes.`

**Cause.** The deployment has not run yet, and its first download is waiting for the [third-party notice](./INSTALLATION.md#the-third-party-notice) to be confirmed: by `y` at a terminal, or by `--yes`. A script or a provisioning tool has no terminal.

**Fix.** Run the command at a terminal, or add `--yes`, which counts as the confirmation. The notice is printed either way. On a deployment that has already run, a notice that is due is asked for at a terminal, where `n` stops the command with `Not confirmed. Nothing has changed yet.`; with no terminal and no `--yes`, it never stops a command: it is printed with a warning, and `./byodt acknowledge` records it later.

### `Other accounts can change this directory (…), so byodt does not record the third-party notice here`

> `error: Other accounts can change this directory (/srv/shared/byodt), so byodt does not record the third-party notice here. Make it yours and not writable by others (chmod go-w .), and run the command again.`

`./byodt setup` and `./byodt acknowledge` say `does not record the notice here`.

**Cause.** `byodt` keeps the record of the notice, `third-party-acknowledgement.log`, only in a folder that is yours and that no other account can write to. A group that may write counts as another account, unless it is your own private group (the group named after you).

**Fix.** Make the folder yours and not writable by others, from inside it:

```sh
chmod go-w .
```

If another account owns it, give it to yours (`sudo chown "$(id -u):$(id -g)" .`), or install into a folder of your own. On a deployment that has already run, the command only warns and goes on.

### `failed to connect to the docker API at unix:///run/user/…/podman/podman.sock`

> `failed to connect to the docker API at unix:///run/user/<uid>/podman/podman.sock; check if the path is correct and if the daemon is running: …`
>
> `error: The start was refused or failed: './byodt status' shows which service; if console-init stopped it, './byodt logs console-init' says why.`

**Cause.** Podman, on a host that also has Docker. `podman compose` found Docker's `docker-compose` and ran it, and `docker-compose` reaches Podman through the Podman API socket, which is not running.

**Fix.** Make Podman use `podman-compose`, in this shell and in your shell profile, then run the command again:

```sh
export PODMAN_COMPOSE_PROVIDER=podman-compose
```

Or start the socket: `systemctl --user start podman.socket`. See [Installation → Podman specifics](./INSTALLATION.md#podman-specifics).

### The platform never starts, and `console-init` exited non-zero

**Symptom.** `./byodt up` or `./byodt update` fails with an error that ends `'./byodt logs console-init' says why.`

**Cause.** The one-shot aborted the start. It does that for exactly three classes of problem: the pinned versions disagree, the platform's embedding model is not the one the reference data was embedded with, or the schema could not be placed. In each case the platform is deliberately held back — a schema that disagrees with the code serving it must not serve, and a model that did not make the reference vectors would not match them.

**Fix.** Read the reason:

```sh
./byodt logs console-init
```

Then see the next three entries.

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

### `EMBEDDING_MODEL … does not match this release's MITRE data`

> `EMBEDDING_MODEL "…" does not match this release's MITRE data, which was embedded with "embeddinggemma-300m-retrieval-v1". Remove EMBEDDING_MODEL from .env; the default is embeddinggemma-300m-retrieval-v1`

**Cause.** `.env` sets `EMBEDDING_MODEL` to a model other than the one this release's MITRE reference data was embedded with. The platform would search those vectors with another model's queries, which matches nothing reliably, so the one-shot stops the start before it ingests anything, and the platform does not start.

**Fix.** Remove the `EMBEDDING_MODEL` line from `.env`, then `./byodt up`. The platform's default is the right model. See [Configuration → Embedding](./CONFIGURATION.md#embedding).

If the message instead says the platform's **default** embedding profile does not match and that the console image is broken, nothing in your configuration caused it: the release's console image and its data do not belong together. Report it, and stay on your current release.

### `PLATFORM_VERSION is not set`

**Cause.** The key is missing or empty in `.env` — usually a hand-edited or partially copied file.

**Fix.** Restore it from `.env.example`, which carries the version this bundle shipped with, then `./byodt up`.

### The database will not become healthy

**Symptom.** `./byodt status` shows `db` unhealthy or perpetually starting, and the platform never starts because it waits for the database. `./byodt logs db` shows authentication failures.

**Cause.** The database's credentials and `.env.secrets` no longer match. The database created its user from the password that existed when it first started; if `.env.secrets` was deleted, a **new** password was generated on the next start, and the existing database still expects the old one.

**Fix, in order of preference:**

1. **Restore the original `.env.secrets`** from your backup of it, then `./byodt up`. Your graph is intact.
2. **If the password is gone for good**, the existing graph cannot be opened. Restore from a backup onto a fresh database:

   ```sh
   ./byodt down
   # remove the graph — ./byodt destroy prints the exact command for your storage setting
   ./byodt up
   ./byodt restore backups/<your latest backup>
   ```

   A fresh database adopts the password currently on disk, and a backup carries no credentials, so this works.

This is why `./byodt destroy` prints a warning about `.env.secrets` every time. Back that file up separately — see [Configuration → The generated secret file](./CONFIGURATION.md#the-generated-secret-file).

---

## Installing and upgrading

Every refusal below changes nothing unless it says otherwise: the installer and `./byodt upgrade` check before they act. The installer prints its messages as `error: …`, as `byodt` does.

### `There is a deployment in …`

> `error: There is a deployment in /home/you/byodt. Upgrade it (--upgrade), or name another folder for a new one with --dir. Nothing was changed.`

**Cause.** The installer found a deployment: in `--dir`, or, without `--dir`, in a folder the container engine started this bundle's deployment from, or in a `byodt*` folder of the directory you ran it in. It never installs over one. Without a terminal, or with `--yes`, it does not ask whether to upgrade it.

**Fix.** To upgrade that deployment, add `--upgrade` (and `--dir` to name it). To install a second one, name a new folder with `--dir`; only one of the two can run at a time.

### `… already exists. Choose another folder with --dir`

> `error: ./byodt already exists. Choose another folder with --dir, or upgrade the deployment in it (--upgrade); a folder a refused setup left behind holds nothing yet, and can be removed.`

**Cause.** The folder the installer would create exists, and is not a deployment. Often it is one an earlier run unpacked, whose setup then refused.

**Fix.** Name another folder with `--dir`. If the folder is one a refused setup left (it holds the bundle's files and no `.env`), remove it, or run `./byodt setup` inside it.

### `The deployment in … already runs release …` / `… already holds release …, and has not been started yet`

> `error: The deployment in /home/you/byodt already runs release X.Y.Z; '/home/you/byodt/byodt update' applies it again. To install another one, name its folder with --dir. Nothing was changed.`
>
> `error: The deployment in /home/you/byodt already holds release X.Y.Z, and has not been started yet; '/home/you/byodt/byodt up' starts it. To install another one, name its folder with --dir. Nothing was changed.`

**Cause.** You ran the installer of the release the deployment is already on. The second message is for a folder that was set up but never started, such as one whose setup ran without `--start`. `./byodt upgrade X.Y.Z` says `Already on X.Y.Z.`

**Fix.** Nothing to upgrade. `./byodt update` pulls the pinned images and applies them again; on a folder that has not been started yet, `./byodt up` starts it.

### `An upgrade is half done in …`

> `error: An upgrade is half done in /home/you/byodt. '/home/you/byodt/byodt upgrade' goes on with it, or '/home/you/byodt/byodt upgrade --abandon' undoes it. Nothing was changed.`

**Cause.** An upgrade to this release stopped partway, and the deployment's own `byodt` is already this release's.

**Fix.** Run the command it names. See [Operations → If an upgrade stops](./OPERATIONS.md#if-an-upgrade-stops).

### `More than one deployment was found`

> `error: More than one deployment was found (above). Name the one to upgrade with --dir.`

**Fix.** Run the installer again with `--dir` naming the deployment to upgrade, or a new folder to install into.

### `… holds a deployment, but another account owns it or can change it`

> `error: /srv/byodt holds a deployment, but another account owns it or can change it; this script does not act on it. To install a new one elsewhere, name its folder with --dir.`

`./byodt upgrade` says `… can be changed by other accounts, or is not yours: byodt does not upgrade it. Nothing was changed.`, or names a file: `…/.env is missing, a link, or not yours: byodt does not upgrade it. Nothing was changed.`

**Cause.** An upgrade runs the new release's code in place of the deployment's, so it acts only on a folder, `byodt`, `.env` and `.env.example` that are yours (or root's), not links, in a folder no other account can write to. A group that may write counts as another account, unless it is your own private group. See [Installation → Folders other accounts can change](./INSTALLATION.md#folders-other-accounts-can-change).

**Fix.** Run the upgrade as the account that owns the deployment, or make the folder yours and not writable by others (`chmod go-w <folder>`).

### `Other accounts can change …; install where only you can (--dir)`

> `error: Other accounts can change /tmp; install where only you can (--dir). The deployment holds its own data and secrets, so a shared folder such as /tmp is the wrong place for it anyway.`

**Cause.** The folder the installer would create the deployment in is writable by other accounts, so one of them could change where it lands.

**Fix.** Install into a folder of your own, with `--dir`, for example under your home directory. A folder writable only by your own private group is accepted.

### `Give --https-proxy without a login`

> `error: Give --https-proxy without a login (http://host:port): an argument shows in the process list. A login comes only from HTTPS_PROXY in the environment.`

**Cause.** `--https-proxy` carried `user:password@`. Any account that lists processes can read a command's arguments.

**Fix.** Give the login through `HTTPS_PROXY` in your shell, as in [Installation → Behind an outbound proxy → 2](./INSTALLATION.md#2-get-the-bundle-through-the-proxy), and leave `--https-proxy` out. The installer also refuses a proxy it cannot use as given: `The proxy is …: write it as http://host:port.`, or, for a space, a double quote, `#`, `?` or `$` in it, `percent-encode its login`.

### `… is larger than a release's file is`

> `error: https://github.com/dether-net/dethernety-oss/releases/download/vX.Y.Z/byodt-X.Y.Z.tar.gz is larger than a release's file is.`

With `curl`, the same case reads `error: Could not download the bundle.`, after `curl`'s own message.

**Cause.** The download was larger than 50 MiB, which no release's bundle is. Something between you and the release host, such as a proxy's error page or a captive portal, answered instead. Nothing was kept.

**Fix.** Check the URL, and what your proxy returns for it. `Could not download the bundle.` on its own also means the release host could not be reached, or there is no such release.

### `The bundle's SHA-256 is …, not the … this release published`

> `error: The bundle's SHA-256 is …, not the … this release published. It was not used.`

`./byodt upgrade` says `The downloaded bundle is not the one release X.Y.Z published (SHA-256 mismatch). Nothing was changed.`

**Cause.** The file is not the release's bundle: a download cut short or altered on the way, or a `--tarball` file from another release.

**Fix.** Run it again. With `--tarball`, use the bundle file of the installer's own release. If it keeps failing, do not work around it: something is changing the download.

### `Neither sha256sum nor shasum is installed`

> `error: Neither sha256sum nor shasum is installed; files cannot be checked.`

The installer says `Neither sha256sum nor shasum is installed; the download cannot be checked.`

**Cause.** The installer checks the bundle by its SHA-256. `byodt` needs one of these tools for two things only: to record your confirmation of the third-party notice, and to upgrade. Other commands, such as `down`, `status`, `logs`, `backup` and `restore`, do not.

- **`./byodt upgrade`** stops when it checks the downloaded bundle, before it changes anything.
- **`./byodt setup` and `./byodt acknowledge`** stop when they would record the confirmation. Setup removes what it wrote.
- **`./byodt up`, `update`, `restart` and `models pull`** cannot tell, without a tool, that the notice you confirmed is unchanged, so it counts as not yet confirmed. On a first start, at a terminal, or with `--yes`, they ask for it, and stop when they would record your confirmation. Without a terminal and without `--yes`, on a deployment that has run, they print the notice with a warning and go on.

On a first run, `./byodt setup` and `./byodt bootstrap` also warn: `Neither sha256sum nor shasum is installed, so .byodt-release was not written; the first upgrade will not be able to check local edits.` Setup then stops as above; `bootstrap`, which shows no notice, goes on.

**Fix.** Install one: `sha256sum` comes with GNU coreutils on Linux, and `shasum` with Perl on macOS. Then run the command again.

### `cosign could not verify the bundle's signature`

> `error: cosign could not verify the bundle's signature against this release's identity (above). It was not used.`

**Cause.** cosign is installed and checked the bundle's signature against the release workflow of `dether-net/dethernety-oss` at this release's tag, and it did not match. Its own output is above the message. A signature from another release, or a bundle file that was changed, fails here.

**Fix.** Read cosign's output. It may need to reach Sigstore's public services; behind a proxy, cosign uses the same proxy as the download. Do not use the bundle until it verifies.

### `an unattended upgrade does not run code it cannot verify`

> `error: cosign did not verify the bundle, and an unattended upgrade does not run code it cannot verify. Install cosign (https://github.com/sigstore/cosign), or pass --allow-unsigned knowingly. Nothing was changed.`

`./byodt upgrade` says `cosign is not installed, so the bundle's signature was not checked, and an unattended upgrade …`, with `and it came through wget, which cannot hold the download to HTTPS` added when `curl` is not installed.

**Cause.** The upgrade runs without a terminal, or with `--yes`, and cosign did not verify the bundle: it is not installed, or, with `--tarball`, there is no `.bundle` file beside the tarball. An unattended upgrade does not run code whose signature nobody checked. `--yes` never implies `--allow-unsigned`.

**Fix.** Either:

- **Install [cosign](https://github.com/sigstore/cosign)**, and run the upgrade again. It then verifies the signature.
- **Or pass `--allow-unsigned`**, once you have decided that the SHA-256 check alone is enough. The bundle's integrity is still checked; its authenticity is not. The SHA-256 comes from the same release, so it shows the download is intact, not who made it.

At a terminal, without `--yes`, the upgrade asks instead, unless you pass `--allow-unsigned`. A signature cosign rejects is a different error, [`cosign could not verify the bundle's signature`](#cosign-could-not-verify-the-bundles-signature), and no flag lets the upgrade go on.

### `A signature is required, but …`

> `error: A signature is required, but cosign is not installed (https://github.com/sigstore/cosign).`
>
> `error: A signature is required, but there is no …/byodt-X.Y.Z.tar.gz.bundle beside the tarball to verify.`
>
> `error: A signature is required, but cosign is not installed, so the bundle's signature was not checked. Nothing was changed.`

The first two are the installer's; the third is `./byodt upgrade`'s.

**Cause.** A signature is required, by `--require-signature` or by `UPGRADE_REQUIRE_SIGNATURE=true` in the deployment's `.env`, and none could be checked.

**Fix.** Install cosign. With `--tarball`, put the release's `byodt-X.Y.Z.tar.gz.bundle` beside the tarball.

### `… sets UPGRADE_REQUIRE_SIGNATURE=true, so --allow-unsigned does not apply`

> `error: /home/you/byodt/.env sets UPGRADE_REQUIRE_SIGNATURE=true, so --allow-unsigned does not apply. Nothing was changed.`
>
> `error: .env sets UPGRADE_REQUIRE_SIGNATURE=true, so --allow-unsigned does not apply. Nothing was changed.`

**Cause.** The deployment requires a signature for every upgrade (see [Configuration → Upgrades](./CONFIGURATION.md#upgrades)), and the installer or `./byodt upgrade` was given `--allow-unsigned`. It is refused before anything is downloaded, whether or not cosign is installed.

**Fix.** Install cosign and drop `--allow-unsigned`. To allow an unverified upgrade, remove the setting from `.env` first: a decision for whoever owns the deployment.

### `… sets UPGRADE_REQUIRE_SIGNATURE=…, which is neither true nor false`

> `error: /home/you/byodt/.env sets UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false. Nothing was changed.`
>
> `error: .env sets UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false. Nothing was changed.`

**Cause.** The deployment's `.env` sets `UPGRADE_REQUIRE_SIGNATURE` to a value other than `true`, `false` (in any case) or empty. A value such as `yes`, `1` or `on` may have been meant as `true`, so the installer's `--upgrade` and `./byodt upgrade` stop before anything is downloaded rather than count it as off. `./byodt upgrade` stops on it before it resumes or abandons an upgrade too.

**Fix.** Set it to `true` or `false` in `.env` (see [Configuration → Upgrades](./CONFIGURATION.md#upgrades)), or remove the line, and run the command again.

### `Cannot read …/.env, which may require a signature`

> `error: Cannot read /home/you/byodt/.env, which may require a signature (UPGRADE_REQUIRE_SIGNATURE). Run this as the account that owns it. Nothing was changed.`

`./byodt upgrade` says `byodt cannot read .env, which may require a signature (UPGRADE_REQUIRE_SIGNATURE). Run the upgrade as the account that owns it. Nothing was changed.`

**Cause.** The account running the upgrade cannot read the deployment's `.env`, so it cannot tell whether `.env` requires a signature, and does not guess.

**Fix.** Run the upgrade as the account that owns the deployment.

### `setup asks its questions at a terminal`

> `error: setup asks its questions at a terminal. Without one, add --yes, with flags for anything other than the defaults ('./byodt setup --help'). Nothing was changed.`

**Fix.** Run it at a terminal, or add `--yes` and give the settings as flags. See [Installation → Set up with `./byodt setup`](./INSTALLATION.md#set-up-with-byodt-setup).

### `.env exists: this folder is already set up`

> `error: .env exists: this folder is already set up. Edit .env, or move it aside to run setup again.`
>
> `error: .env.secrets exists: this folder has run before. Restore its .env instead of running setup, or move .env.secrets aside.`

**Cause.** Setup is the first run of a folder only. A folder with `.env.secrets` has started before, and that file holds the database password its graph was created with.

**Fix.** Edit `.env` to change a setting (see [Configuration](./CONFIGURATION.md)). Do not move `.env.secrets` aside while the folder holds a graph: the platform would be locked out of it.

### `The proxy login the installer was given is not saved`

> `warning: The proxy login the installer was given is not saved: add --proxy-login-from-env to save it, or put HTTPS_PROXY_USERINFO in .env.secrets yourself.`

**Cause.** Your shell's `HTTPS_PROXY` carried a login, which the installer used for its own download. Setup saves it into the deployment only when you say so: a shell's proxy login is often a personal or domain credential.

**Fix.** If the deployment should use it, add `HTTPS_PROXY_USERINFO` to `.env.secrets` yourself (see [Configuration → The outbound proxy's login](./CONFIGURATION.md#the-outbound-proxys-login)). If the deployment has never been started, you can instead remove its folder and run the installer again with `--proxy-login-from-env`. Running the installer again over the folder does not work: it refuses a folder that already holds a deployment.

### `These files here are not release …'s as shipped`

> `error: These files here are not release X.Y.Z's as shipped: compose.yaml. An upgrade replaces them. Local changes belong in compose.override.yaml, which no bundle ships; move them there, or add --replace-edited (they are kept in the backup). Nothing was changed.`

**Cause.** You edited a file that the old release shipped and the new release ships too, or a file of your own sits where the new release adds one. An upgrade replaces those files, so it stops before it changes anything. A file the new release no longer ships does not count, edited or not: it is left in place as it is, and listed as one the new release no longer ships. Neither does a `.DS_Store` that macOS Finder leaves: the record of shipped files, `.byodt-release`, leaves it out.

**Fix.** Move your change into `compose.override.yaml` (see [Configuration → Local changes to the compose files](./CONFIGURATION.md#local-changes-to-the-compose-files)) and put the file back as shipped, or add `--replace-edited`: the edited file is replaced, and kept in the upgrade's backup.

### `The database is not running, so the graph cannot be backed up first`

> `error: The database is not running, so the graph cannot be backed up first. Start it ('./byodt up'), or add --skip-graph-backup. Nothing was changed.`

**Fix.** Start the deployment and run the upgrade again. Use `--skip-graph-backup` only when you have a backup of your own, or the graph does not matter: the rollback steps then have no graph to restore, and the database is not moved.

**On an upgrade from 0.12.x with 0.14.0's installer**, this message appears although the database is running: 0.14.0's `byodt` cannot read a 0.12.x folder's compose files until its own files have moved in, so its database check fails. With a `compose.override.yaml`, a warning that it could not read that file comes with it. Nothing was changed. Do not add `--skip-graph-backup`: upgrade with the installer of a release later than 0.14.0, as in [Operations → Upgrading from 0.12.x](./OPERATIONS.md#upgrading-from-012x).

### `Failed to copy the snapshot out of the db container`

> `error: Failed to copy the snapshot out of the db container.`

**Cause.** On an upgrade from 0.12.x or 0.13.0 of a Memgraph deployment, on Podman with `podman-compose`: the graph backup is taken by the old release's own `byodt`, which copies with `compose cp`, and `podman-compose` has none. The upgrade stops with nothing changed. This release's `./byodt backup` copies with the engine's own `cp`, so elsewhere this message means the copy itself failed.

**Fix.** Take the snapshot by hand and upgrade with `--skip-graph-backup`, as in [Operations → Upgrading on Podman](./OPERATIONS.md#upgrading-on-podman).

### `Only … MiB is free here`

> `error: Only 1500 MiB is free here; an upgrade needs at least 2048 MiB for the new images and the backups. Nothing was changed.`

**Fix.** Free disk space on the file system that holds the deployment, then run the upgrade again.

### `CONSOLE_IMAGE in .env is pinned to …, which serves neither …`

> `error: CONSOLE_IMAGE in .env is pinned to …, which serves neither A nor B. Set its tag to B, or comment it out. Nothing was changed.`

**Cause.** `CONSOLE_IMAGE` points at a mirror with a tag of neither release. The upgrade retags a pin only when its tag is the old release.

**Fix.** Set the tag to the new release, or comment the line out so that the console image follows `PLATFORM_VERSION`.

### `This bundle is release …, but .env runs …`

> `error: This bundle is release A, but .env runs B: an earlier upgrade by hand is half done. Finish or undo it first.`

**Cause.** `PLATFORM_VERSION` in `.env` and the bundle's files name different releases: an upgrade by hand that set one but not the other.

**Fix.** Finish the hand upgrade ([Operations → Upgrading by hand](./OPERATIONS.md#upgrading-by-hand)), or set `PLATFORM_VERSION` back to the bundle's release, then run `./byodt upgrade`.

### `An upgrade asks before it changes anything. Without a terminal, add --yes.`

> `error: An upgrade asks before it changes anything. Without a terminal, add --yes. Nothing was changed.`
>
> `error: './byodt upgrade' with no version moves to the latest release. Without a terminal to confirm that, give the version or add --yes.`

**Fix.** Run it at a terminal, or add `--yes` and name the version. See [Operations → Without a terminal](./OPERATIONS.md#without-a-terminal).

### `Already on …` / `… is older than …: a downgrade is a rollback, not an upgrade`

> `error: Already on X.Y.Z. './byodt update' applies it again.`
>
> `error: A is older than B: a downgrade is a rollback, not an upgrade. Roll back with the steps the upgrade to B printed, from its backup.`

**Fix.** An upgrade only moves forward. To go back, run the rollback steps the earlier upgrade printed; see [Operations → Rolling back an upgrade](./OPERATIONS.md#rolling-back-an-upgrade).

### `An upgrade to … is half done`

> `error: An upgrade to B is half done (phase moved). Finish it with './byodt upgrade', or undo it with './byodt upgrade --abandon'.`

**Cause.** `./byodt up`, `update` or `restart` ran while an upgrade had moved the new files in but not yet applied them. Starting now would run the new files with the old `.env`.

**Fix.** Run `./byodt upgrade` to finish it, or `./byodt upgrade --abandon`. See [Operations → If an upgrade stops](./OPERATIONS.md#if-an-upgrade-stops).

### `.byodt-upgrade.state is not this deployment's own`

> `error: .byodt-upgrade.state is not this deployment's own (a link, another account's, or readable by others); byodt does not act on it. Check it, and remove it to drop the upgrade.`

**Cause.** The upgrade's journal is not a regular file owned by you (or root) with mode 600. It names the folders an upgrade moves and removes, so `byodt` does not read it. `./byodt up`, `update` and `restart` stop on it, whatever phase it names, and so does `./byodt upgrade`.

**Fix.** Look at it (`ls -l .byodt-upgrade.state`). If you do not know where it came from, remove it: that drops the upgrade, and the commands run again. If an upgrade had started moving its files in, roll back with the steps it printed, from its backup (see [Operations → Rolling back an upgrade](./OPERATIONS.md#rolling-back-an-upgrade)). If it is your upgrade's own journal and only its mode changed, `chmod 600 .byodt-upgrade.state` lets the upgrade go on.

### `The new files were being moved in when the upgrade stopped`

> `error: The new files were being moved in when the upgrade stopped. Without a terminal, add --yes to finish the move, or run './byodt upgrade --abandon' to put the old files back.`

**Fix.** At a terminal, `./byodt upgrade` asks which way to go. Without one, `./byodt upgrade --yes` finishes the move and the upgrade; `./byodt upgrade --abandon` puts the old files back.

### `Another upgrade is running here`

> `error: Another upgrade is running here (.byodt-upgrade.lock, process 12345). Wait for it. If none is running, remove .byodt-upgrade.lock (and .byodt-upgrade.lock.takeover, if it is there) and run the command again.`

**Cause.** Another upgrade holds the lock, or is taking it over. A lock that names no process yet (`process unknown`) counts as held: another upgrade may be taking it at that moment.

**Fix.** Wait for the other upgrade. If no such process runs (`ps -p 12345`), or the message still says `process unknown` when you run the command again, remove the lock and the takeover lock beside it, if there is one, then run the command again:

```sh
rm -rf .byodt-upgrade.lock .byodt-upgrade.lock.takeover
```

A lock whose process has ended is normally taken over without this message.

### `Could not download https://…/get-byodt.sh`

> `error: Could not download https://github.com/dether-net/dethernety-oss/releases/download/vX.Y.Z/get-byodt.sh.`

**Cause.** `./byodt upgrade` reads the release's version and SHA-256 from that release's installer, and could not fetch it: there is no such release, the release publishes no installer, or the release host is not reachable (through the proxy `.env` names, if any).

**Fix.** Check the version on the releases page, and the network. Behind a TLS-inspecting proxy, the host's trust store must hold its CA.

### `Applying … failed`

> `error: Applying B failed (above). If the pull failed, the old containers are still running. Fix what it names and run './byodt upgrade' to go on, or roll back:` followed by the rollback steps.

**Cause.** The upgrade moved the new files in and set `.env`, then `./byodt update` failed: most often an image pull (no route to the registry, or no proxy for the container engine). A failed pull leaves the old containers running.

**Fix.** Fix what the output above names, then run `./byodt upgrade`. It applies again from where it stopped. Or roll back with the printed steps.

### `Release … did not report healthy within … seconds`

> `error: Release B did not report healthy within 1200 seconds. Still starting? './byodt upgrade' checks again. To go back instead (everything since the backup is lost):` followed by the rollback steps.

**Cause.** After the apply, the platform or the front door was not healthy, or the console not running, within `--health-timeout` seconds. A first start after an upgrade can re-ingest the reference data and download the model, and take longer.

**Fix.** Look at `./byodt status` and `./byodt logs platform`. Then run `./byodt upgrade` to wait again, or roll back with the printed steps.

### `./byodt upgrade X.Y.Z` on 0.12.x or 0.13.0 prints `Updated.` and stays on the old release

```
==> Pulling the pinned images…
==> Applying…
==> Updated.
```

**Cause.** The `byodt` of releases 0.12.x and 0.13.0 has no upgrade: its `upgrade` is another name for `update`, and it ignores the version.

**Fix.** Upgrade with the new release's installer and `--upgrade`; see [Operations → Upgrading from 0.13.0](./OPERATIONS.md#upgrading-from-0130) or [Operations → Upgrading from 0.12.x](./OPERATIONS.md#upgrading-from-012x). From 0.12.x, use the installer of a release later than 0.14.0, not 0.14.0's. If that upgrade stopped before the first file moved in, the deployment still has the old release's `byodt`: run the installer again, which takes the upgrade over.

---

## The first run

### It is taking a very long time

**Cause.** Normal, on a fresh machine and especially on a slow connection. The first start pulls four container images, downloads and verifies the module payloads, and ingests the reference corpus. The platform then downloads the embedding model's weights (about 1.26 GB) and **embeds every class once, at about 0.2 s per class on a 4-vCPU host: seconds for the bundled modules (about 80 classes, 15–20 s), a few minutes with cloud content packages (about 1,200 classes). Matching uses names meanwhile.** The health checks are deliberately patient, so a slow start is waited out rather than failed, and the model download does not hold the start at all.

The first start after an upgrade from a release with the `ollama` service does the same model work once, and the one-shot also re-ingests the MITRE reference data, which takes about a minute with the platform down meanwhile.

**Fix.** Watch it rather than restarting it:

```sh
./byodt logs platform         # the model download, load, and class embedding
./byodt logs console-init     # modules and the data ingest
```

Restarting mid-pull only starts the downloads again. Next time, `./byodt models pull` downloads the model ahead of the start.

### Matching uses names after a start

**Symptom.** Class matching and MITRE technique search find entries only by name, not by meaning. In the standalone configuration, `curl -fsS http://127.0.0.1:3000/health` reports `"status": "degraded"`, and its `services.embedder.state` is `downloading`, `loading`, or `failed`. Or `/health` already reports `healthy`, but class matching still finds classes only by name.

**Cause.** The platform serves while it downloads the model's weights and loads the model, and while it embeds the classes; name matching answers meanwhile.

- **The embedder is not ready.** `downloading` and `loading` are normal after a first start or an upgrade. `failed` means the download or the load gave up. The `error` beside the state, and `./byodt logs platform`, give the reason.
- **The classes are still embedding.** `/health` reports `healthy` once the log says `Embedder ready`, but the classes may still be embedding then, at about 0.2 s per class on a 4-vCPU host. Class matching uses names until they are done; the log shows `Embeddings resolved` for each module as its classes are.
- **A download that keeps failing looks normal at first.** The state stays `downloading` while the platform retries: after 10 seconds, 30 seconds, 2 minutes, 10 minutes and 30 minutes, about 42 minutes in all. Only then does it turn `failed`, and the embedder stays off until the platform restarts. Meanwhile the platform log shows `weight acquisition failed, retrying`, with the reason.

**Fix.**

- For `downloading` or `loading`, wait, and follow `./byodt logs platform` until it logs `Embedder ready`, then `Embeddings resolved`.
- If the platform log shows `weight acquisition failed, retrying`, or the state is `failed` after a download, the cause is almost always the network: the platform needs to reach `huggingface.co` and the host it redirects downloads to, directly or through the proxy `HTTPS_PROXY` names in `.env`. The error names the host that failed. Fix the host's network access (behind a proxy, see [Behind an outbound proxy](#behind-an-outbound-proxy)), then `./byodt restart platform`. Running `./byodt models pull` first shows whether the download now works.
- On a host without internet access, run `./byodt models pull` on a connected machine and copy its `data/models` over as the account that runs `./byodt`, keeping its `<repo>/<revision>/<file>` layout; see [Installation → Download the embedding model ahead](./INSTALLATION.md#optional-download-the-embedding-model-ahead). The platform verifies every file's sha256 and downloads only what is missing or wrong.

### `in the models directory is owned by uid` or `is writable by accounts other than its owner`

> `The weights could not be placed: config.json: onnx-community in the models directory is owned by uid 65534, which is not the platform's, root's or the models directory's owner; remove it and place the weights again (the platform downloads them on its start; in the BYODt bundle, ./byodt models pull)`
>
> `… onnx-community/embeddinggemma-300m-ONNX in the models directory is writable by accounts other than its owner; remove it and place the weights again (…)`

**Cause.** A file or directory in `data/models`, on the path to one of the model's files, is one another local account could change: it is owned by an account other than the platform's, root or the owner of `data/models`, or accounts other than its owner (its group, or every account) can write to it. The platform checks each weight file and then loads it, so it refuses such a file rather than load a model someone else could have swapped in. The usual source is a `data/models` copied from another machine under a different account or as root, or unpacked with group- or world-writable permissions. `./byodt models pull` prints the message; the platform logs it as `weight acquisition failed, retrying` and, once it gives up, reports it as the embedder's `error`. The named entry is relative to `data/models`. The uid is the one the platform sees inside its container: under rootless Podman, an account other than yours, root included, usually shows as `65534`.

**Fix.** Remove the named entry and place the weights again (`sudo` may be needed when another account owns it):

```sh
sudo rm -rf data/models/onnx-community
./byodt models pull
```

On a host without internet access, copy the weights again as the account that runs `./byodt` instead of running `models pull`; see [Installation → Download the embedding model ahead](./INSTALLATION.md#optional-download-the-embedding-model-ahead). If the entry is your own and only too widely writable, `chmod -R go-w data/models/<entry>` is enough: the platform still checks every file's sha256 before it loads it. Then `./byodt restart platform`.

If the message names the models directory itself (`the models directory is writable by accounts other than its owner without the sticky bit`), run `./byodt up`: it makes `data/models` sticky again.

### `the data ingest failed` with a memory limit

> **Ingest Failed** — the data ingest failed — the deployment runs without the MITRE corpus: memory limit exceeded (…) — the database needs a larger memory limit (Memgraph's --memory-limit, set in the bundle's compose.memgraph.yaml; override it in compose.override.yaml); this is terminal and was not retried: …

On Neo4j the middle reads `the database needs more memory (Neo4j's heap, NEO4J_HEAP_SIZE in the bundle's .env)`.

**Cause.** The database ran out of memory partway through the reference-data ingest. Memgraph is started with a 4096 MiB limit, which is the measured floor for this ingest; Neo4j parses the large ingest statements on its heap, `NEO4J_HEAP_SIZE` (default `2G`). Either can only use memory the container engine is actually able to give it.

**Fix.** On Neo4j, raise `NEO4J_HEAP_SIZE` in `.env` (for example to `3G`). On either engine, make sure the container engine can give the database that memory. On a VM-backed runtime, one that runs containers in a virtual machine (such as Docker Desktop, or a Podman machine on macOS or Windows), the constraint is the **virtual machine's** memory allocation, not the host's. Raise it to comfortably more than 4 GB, then re-run the one-shot:

```sh
./byodt restart
```

The ingest re-runs because the corpus is not yet recorded as loaded. Confirm the console's **Data ingest** panel reads `ok` and the statement count is no longer zero.

To raise Memgraph's limit itself, set `--memory-limit` in `compose.override.yaml`. A `command:` there replaces the db service's whole `command:` list rather than merging into it, so repeat every flag from `compose.memgraph.yaml`'s `command:`, `--telemetry-enabled=false` included, and change only `--memory-limit` (the value is in MiB):

```yaml
services:
  db:
    command:
      - "--bolt-num-workers=4"
      - "--query-plan-cache-max-size=100"
      - "--query-execution-timeout-sec=600"
      - "--query-max-plans=100"
      - "--cartesian-product-enabled=true"
      - "--storage-gc-cycle-sec=300"
      - "--storage-snapshot-interval-sec=${SNAPSHOT_INTERVAL_SEC:-300}"
      - "--memory-limit=6144"
      - "--query-vertex-count-to-expand-existing=10"
      - "--telemetry-enabled=false"
```

`byodt` loads the override after `compose.memgraph.yaml` (see [Configuration → Local changes to the compose files](./CONFIGURATION.md#local-changes-to-the-compose-files)). `./byodt restart` recreates the stack with it, and the ingest runs again. The override is loaded on either engine, so remove this `db` block before you switch to Neo4j. A bundle upgrade leaves the override alone, so compare its `command:` list with `compose.memgraph.yaml`'s after each upgrade.

### `the module release channel was unreachable`

> **Module Fetch Failed** — the module release channel was unreachable — no code modules were installed

**Cause.** The one-shot could not reach the release host to download the module payloads. A firewall, a proxy, an offline machine, or a transient outage. `./byodt logs console-init` gives the exact error.

**Fix.** Give the machine access to `github.com` and its release-asset host (behind a proxy, see [Behind an outbound proxy](#behind-an-outbound-proxy), which lists the errors a proxy produces here), then re-run the one-shot:

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

**Cause.** A downloaded payload did not verify against the signing identity pinned to that exact release. The module was rejected rather than installed. Possible causes: a corrupted or truncated download, a proxy or other device on the path that modifies the content it passes on, or an artifact that genuinely is not the published one.

TLS inspection alone does not cause this. A proxy that inspects TLS, with its CA trusted, re-encrypts the same bytes, and the signature is checked offline, against a trusted root embedded in the console image. Without its CA trusted, the download does not happen at all, and the console reports an unreachable release channel instead (see [Behind an outbound proxy](#behind-an-outbound-proxy)).

**Fix.** This is a security event — do not work around it.

1. Re-run the one-shot (`./byodt restart`) in case the download was simply corrupt.
2. If it persists, check whether something between the machine and the release host modifies the content it passes on.
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

## Behind an outbound proxy

The setup is in [Installation → Behind an outbound proxy](./INSTALLATION.md#behind-an-outbound-proxy), and the reference in [Configuration → Outbound proxy](./CONFIGURATION.md#outbound-proxy).

**Where the errors show.**

| From | Where to read it |
|---|---|
| `byodt` itself | The terminal, before anything starts. Its messages mask any login as `***`. |
| `console-init` (the module downloads) | `./byodt logs console-init`. The console then shows **Module Fetch Failed** — *the module release channel was unreachable*. |
| The platform (the model download, cloud content, sign-in keys) | `./byodt logs platform`, and the output of `./byodt models pull`. |

In the messages below, `<proxy-host>` and `<port>` stand for your proxy's name and port, `<dns-server>` for the resolver the containers use, and `X.Y.Z` for the release.

**Test the proxy from the host** before you look at the deployment. This asks the proxy for one of the hosts the first start needs:

```sh
curl -sSI -x http://<proxy-host>:<port> https://huggingface.co
```

If the proxy needs a login, add `-U 'user'`: curl then asks for the password, which keeps it off the command line. curl takes the user name and the password as they are, not percent-encoded as in `HTTPS_PROXY_USERINFO`. An `HTTP/1.1 200` line for the tunnel, then the site's own answer, means the proxy lets the host through. The host can resolve `<proxy-host>` differently from the containers, so a pass here does not settle a name-resolution error in the deployment.

### `byodt` refuses the proxy setting

`byodt` checks `HTTPS_PROXY` and `NO_PROXY` in `.env`, `HTTPS_PROXY_USERINFO` in `.env.secrets`, and `proxy-ca/`, before anything starts. Each refusal says what to change; the common ones:

| Message (beginning) | Fix |
|---|---|
| `error: HTTPS_PROXY in .env is http://<proxy-host>: it needs the proxy's port, as http://host:port.` | Add the port. |
| `error: HTTPS_PROXY in .env is …: write it as http://host:port` | Use `http://` or `https://`, a numeric port, and nothing after the port. |
| `error: HTTPS_PROXY in .env carries a login (…)` | Remove `user:password@` from `.env`, and put the login in `.env.secrets` as `HTTPS_PROXY_USERINFO`. |
| `error: HTTPS_PROXY in .env is …: inside a container, … is the container itself.` | Do not use `localhost` or a loopback address. Use the host's address on the network the proxy listens on. |
| `error: HTTPS_PROXY in .env is …: inside the stack, … is one of its own services.` | The name is one of the deployment's services, such as `proxy` (the front door). Use the proxy's full name or its address. |
| `error: NO_PROXY in .env has …: address ranges and wildcards are not read the same way by every service. List the hosts.` | Replace the block, range or wildcard with the exact hosts. |
| `error: NO_PROXY in .env has a space: separate its entries with commas only.` | Remove the spaces. |
| `error: HTTPS_PROXY_USERINFO in .env.secrets must be user:password with one colon, …` | Percent-encode the user name and the password; see [Configuration → The outbound proxy's login](./CONFIGURATION.md#the-outbound-proxys-login). |
| `error: HTTPS_PROXY_USERINFO in .env.secrets is quoted: …` | Remove the quotes. |
| `error: proxy-ca/ holds …: it holds only proxy-ca.pem, …` | Move every other file out of `proxy-ca/`. |
| `error: proxy-ca/proxy-ca.pem is not readable by every account, …` | `chmod 0644 proxy-ca/proxy-ca.pem` |
| `error: … can be changed by other accounts, and what is in it is trusted as a root.` | `chmod go-w` on the named path. |

These warnings do not stop the start:

- `warning: HTTP_PROXY in .env is not used: …` — the deployment sends only HTTPS through the proxy. Set `HTTPS_PROXY` instead.
- `warning: HTTPS_PROXY_USERINFO in .env.secrets is not used: .env sets no HTTPS_PROXY.` — set `HTTPS_PROXY`, or remove the login. `NO_PROXY` without `HTTPS_PROXY` gets the same warning.
- `warning: HTTPS_PROXY in .env is https://…: the stack talks to the proxy itself over TLS. …` — see [A TLS handshake error with an `https://` proxy URL](#a-tls-handshake-error-with-an-https-proxy-url).

### `Your shell sets HTTPS_PROXY (…); the stack uses only the one in .env (…)`

> `==> Your shell sets HTTPS_PROXY (…); the stack uses only the one in .env (…). Set HTTPS_PROXY in .env to change it.`

**Cause.** A notice, not an error. Your shell exports a proxy that `.env` does not name. `byodt` never adopts the shell's: the deployment uses only `.env`'s, so an upgrade does not start sending it through a proxy it worked without.

**Fix.** If the deployment should use that proxy, set `HTTPS_PROXY` in `.env` and run `./byodt up`. Otherwise, ignore the notice. `byodt` compares the two values as text, so a shell URL that carries a login always differs from `.env`'s, which never does. If both name the same proxy, unset it in your shell after getting the bundle.

### `warning: HTTPS_PROXY is set in .env, but the Docker daemon has no proxy of its own`

> `warning: HTTPS_PROXY is set in .env, but the Docker daemon has no proxy of its own, so image pulls go direct. If this host has no direct route out, set the daemon's proxy (a systemd drop-in, or "proxies" in daemon.json), restart it, and run the command again.`

**Cause.** On Docker, `./byodt up` and `./byodt update` check the daemon's own proxy before they pull. The daemon pulls the images, and it never reads `.env` or your shell. `byodt` does not check Podman's setting.

**Fix.** If the host has no direct route out, give the daemon a proxy, restart it, and run the command again; see [Installation → Give the container engine the proxy](./INSTALLATION.md#1-give-the-container-engine-the-proxy). If the images come from a registry mirror on your own network, ignore the warning.

### `Proxy Authentication Required`

> `fetching modules.json: Get "https://github.com/dether-net/dethernety-oss/releases/download/vX.Y.Z/modules.json": Proxy Authentication Required`

from `console-init`, and from the platform:

> `Failed to establish tunnel to <host>:443 via http://<proxy-host>:<port>/: HTTP/1.1 407 Proxy Authentication Required`
>
> `Request was cancelled.` (code `UND_ERR_ABORTED`)

**Cause.** The proxy refused the login (HTTP 407): `HTTPS_PROXY_USERINFO` is missing, wrong, or encoded wrongly. Of the platform's two texts, the first comes from its core HTTPS client, which in cloud mode fetches the keys sign-ins are checked against. The second comes from its `fetch` client, which the model download uses, and carries no 407 at all: behind a proxy that needs a login, a `Request was cancelled.` can be this. `./byodt models pull` may not show even that: it prints `request to <host> failed:` with the error's message only, and the cause appears in `./byodt logs platform` when the platform downloads the model itself (see [The model download names a host that fails](#the-model-download-names-a-host-that-fails)).

**Fix.** Check the user name and the password in `.env.secrets`, and the percent-encoding of every character outside the allowed set (see [Configuration → The outbound proxy's login](./CONFIGURATION.md#the-outbound-proxys-login)). Then `./byodt up`, and `./byodt models pull` to test.

### `proxyconnect tcp: … no such host`

> `proxyconnect tcp: dial tcp: lookup <proxy-host> on <dns-server>:53: no such host`

**Cause.** The containers cannot resolve the proxy's name. The stack still comes up, but `console-init` cannot download the modules, and the console reports **Module Fetch Failed**.

**Fix.** Use a name the containers can resolve, or an address, in `.env`, then `./byodt up`. If the name was right and the proxy was only away, run `./byodt restart` once it is back: `console-init` runs again and installs the modules, and the platform, which reads `modules/` only when it starts, starts after it. A proxy that is down but whose name still resolves gives a refused connection or a timeout instead; see [The proxy is down when the deployment starts](#the-proxy-is-down-when-the-deployment-starts).

### `context deadline exceeded (Client.Timeout exceeded while awaiting headers)`

> `context deadline exceeded (Client.Timeout exceeded while awaiting headers)`

**Cause.** The proxy accepts connections but does not answer. `console-init` waits its full 60 seconds on every run, then records the failure, so each start takes about a minute longer. The stack still comes up, without the modules this run should have installed.

**Fix.** The fix is on the proxy: ask its operators why it holds connections to `github.com` and `release-assets.githubusercontent.com`. The [host test above](#behind-an-outbound-proxy), with `https://github.com`, shows the same hang. Once it is fixed, `./byodt restart` runs `console-init` again.

### `Service Unavailable`

> `…modules.json": Service Unavailable`

**Cause.** The proxy answered HTTP 503: it could not reach the destination itself, often because it could not resolve its name. The deployment's side of the connection worked.

**Fix.** The fix is on the proxy. A proxy on an isolated network may need its own name servers set (in squid, `dns_nameservers`). Once it is fixed, `./byodt restart` runs `console-init` again.

### `self-signed certificate in certificate chain` or `x509: certificate signed by unknown authority`

> `self-signed certificate in certificate chain` (code `SELF_SIGNED_CERT_IN_CHAIN`)

from the platform, and from `console-init`:

> `tls: failed to verify certificate: x509: certificate signed by unknown authority`

With other certificate chains, the platform may report `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` instead. The console, written in Go like `console-init`, fails the same way on its cloud calls.

**Cause.** The proxy inspects TLS: it re-signs every HTTPS connection with a CA of its own, and the deployment does not trust that CA.

**Fix.** First ask the proxy's operators to pass the identity provider and the content service through uninspected. If they cannot, put the proxy's CA certificate in `proxy-ca/proxy-ca.pem`, and run `./byodt up`. If the file was already there and you replaced it, how to apply it depends on which service reported the error. When `console-init` did, or the console shows **Module Fetch Failed**, run `./byodt restart`: a restart that names services recreates only those, so `console-init` would not run again. When only the platform's or the console's own calls failed, `./byodt restart platform console` is enough. Read what trusting it hands over first: [Configuration → A proxy that inspects TLS](./CONFIGURATION.md#a-proxy-that-inspects-tls). The file must hold the CA that signs the proxy's certificates, not a certificate the proxy presents for one site.

Image pulls through the same proxy fail the same way. The container engine needs the CA in the host's trust store and a restart; see [Installation → Give the container engine the proxy](./INSTALLATION.md#1-give-the-container-engine-the-proxy).

### A TLS handshake error with an `https://` proxy URL

**Symptom.** Every call through the proxy fails with a TLS handshake error, before any request is made. `HTTPS_PROXY` in `.env` starts with `https://`. Without a login, `byodt` warned about it:

> `warning: HTTPS_PROXY in .env is https://<proxy-host>:<port>: the stack talks to the proxy itself over TLS. Most proxies take http:// here, and still carry HTTPS end to end.`

**Cause.** `https://` in the proxy URL is how the services talk to the proxy itself. A proxy that speaks plain HTTP on that port cannot complete the handshake. With a login set, `byodt` does not warn, because `https://` is what keeps the login off the network in clear.

**Fix.** Use `http://` unless the proxy's operators say it takes TLS on that port, then `./byodt up`.

### The model download names a host that fails

> `The weights could not be placed: <file>: request to <host> failed: …`

`./byodt models pull` prints this, and only this: for a network failure the end is `fetch failed`, without the underlying cause. When the platform downloads the model itself, on a start, `./byodt logs platform` shows the same error on each `weight acquisition failed, retrying` entry, with the cause beside it as `cause`. The download's other network errors name the host the same way: `download failed with HTTP <status> from <host>`, `no response from <host> within 30 s`, and `no data from <host> for 60 s`.

**Cause.** The download could not get through to the named host. The model hub redirects each download to another host, and a proxy that allows `huggingface.co` but not that host fails here.

**Fix.** Ask for the named host to be allowed, then run `./byodt models pull` again. If the platform has already given up (`failed` in `/health`), run `./byodt restart platform` after that.

### The proxy is down when the deployment starts

**On a first start**, the stack comes up, but `console-init` cannot download the modules: the console reports **Module Fetch Failed**, and no code modules are installed. If the model's weights are not on disk yet, the platform retries the download for about 42 minutes. Once the proxy is back, run `./byodt restart`: `console-init` installs the modules, and the platform starts after it, loads them, and downloads the weights if they are still missing.

**On a later start**, the modules and the weights are already on disk. `console-init` cannot reach the release host and the console reports **Module Fetch Failed**, but the modules already installed stay in use. In cloud mode, sign-in and the content service need the proxy: the platform fetches the keys sign-ins are checked against through it, so sign-ins fail until the proxy is back.

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

**Cause.** `./byodt backup` probes the database before doing anything, on either engine, and the probe failed.

**Fix.**

```sh
./byodt status
```

If the database is not running, `./byodt up`. If it is running but the probe fails on credentials, see [The database will not become healthy](#the-database-will-not-become-healthy).

### `No snapshot available to back up`

**Cause.** Memgraph only. The database neither produced a new snapshot nor has an existing one to copy — this is effectively an empty or very newly created database.

**Fix.** Confirm the deployment is actually holding data — the console's **Data ingest** panel shows the statement count from the reference ingest beneath its status. If the graph really is empty, there is nothing to back up yet.

### `The database container is not running` / `More than one database container of this project is running`

> `error: The database container is not running; start it with './byodt up'.`
>
> `error: More than one database container of this project is running ('./byodt status'); stop the extra one first.`

**Cause.** Memgraph only. `backup` and `restore` copy the snapshot with the container engine's own `cp` (`docker cp` or `podman cp`), into or out of the deployment's one running database container, found by its compose labels.

**Fix.** Start the deployment (`./byodt up`), or, for the second message, find the extra container with `./byodt status` and your engine's `ps`, and stop it.

### `Could not make … private to you`

> `warning: Could not make backups/byodt-snapshot-….snapshot private to you (its file system may not keep modes); keep it where only you can read it.`

**Cause.** Memgraph only. A backup's snapshot is made readable by you only once it is copied out, and the file system it was written to does not keep file modes, as some network and removable file systems do not.

**Fix.** The backup itself is complete. Keep it in a folder only you can read, or write backups to a file system that keeps modes: `./byodt backup /path/to/dir`.

### `That backup was taken on version X; this deployment is Y`

**Cause.** A warning, not an error. The filename records the version the backup was taken on, and it differs from what this deployment runs. Snapshots and dumps are version-sensitive and may not load across versions.

**Fix.** Prefer restoring onto the version the backup was taken on. On Memgraph, if you continue and the restore fails, the current graph is left unchanged — nothing is lost by trying. On Neo4j a failed load can leave the current graph gone, so take a backup of it first.

### `… is a Neo4j dump; this deployment runs Memgraph` / `… is a Memgraph snapshot; this deployment runs Neo4j`

> `error: backups/….dump is a Neo4j dump; this deployment runs Memgraph, which restores its own snapshots only.`

**Cause.** The backup was made by the other database engine. Each engine restores only its own format, and nothing converts between them.

**Fix.** Restore a backup taken on this engine. To use that backup, restore it onto a deployment that runs the engine it came from.

### `RECOVER SNAPSHOT failed — the current graph was left unchanged`

**Cause.** Memgraph refused the snapshot. A version mismatch is the usual reason; a truncated or corrupt file is the other.

**Fix.** Try a different snapshot, or pin the deployment back to the version the snapshot was taken on and restore there. Your current graph is intact either way.

### `neo4j-admin could not dump the database`

> `error: neo4j-admin could not dump the database. If it says the store needs recovery, the database did not shut down cleanly: start it ('./byodt up'), let it finish starting, and run the backup again.`

**Cause.** Neo4j only. `neo4j-admin` refuses to dump a store that was not shut down cleanly; its own output above the message says why. `byodt` starts the database again either way.

**Fix.** Do what the message says: `./byodt up`, wait until `./byodt status` shows `db` healthy, then `./byodt backup` again.

### `neo4j-admin could not load the dump`

> `error: neo4j-admin could not load the dump — see its output above. The load replaces the graph, so the current one may be gone: restore again from a backup you know is good.`

**Cause.** Neo4j only. `neo4j-admin` failed while loading the dump; its own output above the message says why. A version mismatch and a truncated or corrupt file are the usual reasons. The load replaces the graph, so unlike on Memgraph the current graph may already be gone. `byodt` starts the database again either way.

**Fix.** Restore again from a backup you know is good — preferably one taken on the version this deployment runs. If the failed file was taken on another version, pin the deployment to that version and restore it there.

### `Could not copy the dump to …`

> `error: Could not copy the dump to backups/….dump.`

**Cause.** Neo4j only. The dump was written, but `byodt` could not copy it into the destination directory — usually a directory you cannot write, or a full disk. The private working directory, with the dump in it, is removed on the way out, so nothing is left behind.

**Fix.** Make sure the destination directory is writable by you and has room for the graph, then run `./byodt backup` again. The database is started again either way.

### `Could not start the database — start it with './byodt up'`

> `warning: Could not start the database — start it with './byodt up'.`

**Cause.** Neo4j only. A backup or restore stopped the database, and starting it again failed.

**Fix.**

```sh
./byodt up
./byodt logs db
```

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

**Cause.** Every console control that *changes* a connected deployment — mounting and unmounting content, installing and removing artifacts, updating the knowledge graph, changing who may sign in, and disconnecting — is available only to an administrator of the team the deployment belongs to, and so is the one thing the console *shows* only to an administrator: the **Who may sign in** card, which lists your team's members and who among them may sign in. The console asked the cloud who you are on this attempt, and the answer was no. Every other read is unaffected: the status, the catalog and the inventory are all still yours to see. On the Cloud tab the card shows this sentence in the console's own words and nothing of the team — no list, no ticks, nothing about who has left.

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

### The dashboard says **The knowledge graph's version has been withdrawn**

> **The knowledge graph's version has been withdrawn** — The knowledge-graph service lists the version this deployment is pinned to as withdrawn, so analyses may get no knowledge-graph answers until it is replaced. The Content tab says what to do.

The knowledge-graph entry on the **Content** tab is labelled `withdrawn` at the same time.

**Cause.** The knowledge-graph service has withdrawn the version your deployment is pinned to. Your deployment does not move off a version on its own, so it stays pinned to it until you update it. Until you do, analyses may get no knowledge-graph answers.

**Fix.**

1. Click **Open the Content tab** on the banner.
2. On the knowledge-graph entry, click **Update to the … version**. You need the administrator role.
3. Restart the platform:

   ```sh
   ./byodt restart platform
   ```

4. Re-run the analyses that matter. Any you ran while the withdrawn version was pinned may have had no knowledge-graph answers.

If the entry says the service has no other version to offer yet, there is no button and nothing to do on your deployment yet. Click **Refresh** on the Content tab later; the button appears once the service publishes a new version. See [Cloud → If the pinned version is withdrawn](./CLOUD.md#if-the-pinned-version-is-withdrawn).

### The knowledge-graph entry says `update unknown`

**Cause.** The console could not compare your pinned version with what the knowledge-graph service publishes. Your deployment keeps answering from its pinned version; only the check failed. A line at the foot of the Content tab says which of three causes it is:

| The line says | Cause | Fix |
|---|---|---|
| *the knowledge-graph service could not be reached, so whether an update exists could not be checked* | The service's version list could not be read just now. | Check the machine's network access, then click **Refresh**. |
| *the knowledge-graph service's version listing offers no usable version, so whether an update exists could not be checked* | The service is reachable but currently publishes no version the console can offer. | Nothing to do on your deployment. Click **Refresh** later. |
| *this deployment has no usable knowledge-graph service configured, so whether an update exists cannot be checked; disconnecting and reconnecting is the remedy* | The knowledge-graph address in the deployment's configuration is missing or not one the console will call — typically after the file was edited by hand. | Disconnect and reconnect, which writes the configuration afresh — read [what disconnecting costs](./CLOUD.md#disconnecting) first. |

### `The knowledge-graph service's latest version changed after this page loaded`

> `The knowledge-graph service's latest version changed after this page loaded, so nothing was changed. It is now the version released 2026-10-14 (sha256:…); update again to take it.`

**Cause.** The console updates only to the version the page showed you, and only while the service still publishes it as its newest. The service's latest version changed between loading the page and clicking — usually because a newer one was published.

**Fix.** The console has already reloaded the knowledge-graph entry. Read it, then click the update button again if one is offered — it names the version that is latest now.

Two similar refusals have the same fix — click **Refresh**, then try again:

- `This deployment's cloud configuration changed while the update was being checked, so nothing was changed. Reload and try again.`
- `This deployment was disconnected while the update was being checked, so nothing was changed.` — after a disconnect there is no knowledge-graph connection to update.

### `The knowledge-graph service could not be reached, so nothing was changed`

> `The knowledge-graph service could not be reached, so nothing was changed. Try again later.`

or

> `The knowledge-graph service offers no usable version right now, so nothing was changed.`

**Cause.** The console reads the service's version list again when you click update, and that read failed, or the list offered nothing to update to.

**Fix.** Check the machine's network access and try again later. Your deployment keeps its current version in the meantime.

### `This deployment is configured for a knowledge-graph service but its module is not mounted`

> `This deployment is configured for a knowledge-graph service but its module is not mounted, so it is not updated. Disconnect and reconnect to restore it.`

The same cause shows at the foot of the Content tab as *this deployment is configured for a knowledge-graph service but its module is not mounted — disconnect and reconnect to restore it*, and the knowledge-graph entry is missing.

**Cause.** The deployment's configuration names a knowledge-graph service, but the knowledge-graph module in `modules/` is missing or incomplete — for example, the directory was removed by hand.

**Fix.** Disconnect and reconnect, which writes both afresh — read [what disconnecting costs](./CLOUD.md#disconnecting) first.

### `This deployment has a knowledge-graph module mounted but no version pinned`

> `This deployment has a knowledge-graph module mounted but no version pinned, so it is not updated. Disconnect and reconnect to restore it.`

The same cause shows at the foot of the Content tab as *this deployment has a knowledge-graph module mounted but no version pinned — disconnect and reconnect to restore it*, and the knowledge-graph entry is missing.

**Cause.** The knowledge-graph module is in `modules/`, but the deployment's configuration names no version for it — typically after the configuration file was edited by hand.

**Fix.** Disconnect and reconnect, which writes the configuration and the module afresh — read [what disconnecting costs](./CLOUD.md#disconnecting) first.

### The Content tab shows the new knowledge-graph version, but analyses have not changed

**Cause.** The Content tab reads the deployment's configuration, not the running platform. After an update it shows the new version straight away, but the platform keeps answering from the version it started with until it is recreated.

**Fix.**

```sh
./byodt restart platform
```

This restart removes no module, so it does not touch your classes or the links to them.

---

## Cloud content in use

A mounted cloud module can be in one of four states other than working, and your deployment says which one it is in. The [three checks in Cloud](./CLOUD.md#check-the-connection) tell you which part of the connection works.

One rule holds in all four: **an evaluation refuses rather than returning "no findings" when it could not evaluate.** An empty result is never a failure in disguise.

### A cloud module registers nothing and reports itself unavailable

**Cause.** Not configured: the deployment's content base URL is unset, so the module has nowhere to fetch from. Unless an earlier connected run cached its content, it registers nothing and reports itself unavailable. Nothing else breaks.

**Fix.** The base URL arrives with the cloud configuration, so a deployment the console connected carries it. Check that the deployment is connected and the stack was recreated after the recipe was applied — see [`the content catalog is available only in cloud mode`](#the-content-catalog-is-available-only-in-cloud-mode) and [Cloud → Recreate the stack](./CLOUD.md#recreate-the-stack).

### A class shows a generic form instead of its own

**Cause.** Not entitled: there is no subscription to the package that provides the class, or it has ended. Forms and guides fall back to generic content with a link back to your account, and evaluation refuses outright rather than returning nothing. This is not an error.

**Fix.** Subscribe to the package in the portal — again, if the subscription has ended. Your deployment reads the subscription as it needs it, so a package subscribed since reaches it without a reconnect: the portal's **Billing** page says your deployment picks it up within about a minute. For what the **Content** tab shows meanwhile, see [Cloud → Package and module states](./CLOUD.md#package-and-module-states).

If the package is subscribed, the content service may be unreachable instead — see [Cloud content is slow or does not load](#cloud-content-is-slow-or-does-not-load).

### A module reports its version was recalled, or does not exist

**Cause.** Recalled or mis-pinned: a version you pinned was withdrawn, or does not exist. Your deployment surfaces the reason and what supersedes it.

**Fix.** This one needs you to act. The deployment does not fall back to content cached for that version, so it stays this way until the module's pin moves. Moving a module to another published version is covered in [Cloud → Keep mounts current](./CLOUD.md#keep-mounts-current).

The knowledge-graph connection has its own version and its own entry: see [The dashboard says **The knowledge graph's version has been withdrawn**](#the-dashboard-says-the-knowledge-graphs-version-has-been-withdrawn).

### Cloud content is slow or does not load

**Cause.** Unreachable: a network failure, a timeout, or a rate limit between your deployment and the content service.

**Fix.** Check the machine's network access. Cached content keeps serving meanwhile, and retries are bounded. If the content service is down, your deployment still runs — only cloud content degrades. If the console's **Content** tab also reports `the content catalog is unavailable`, see [that entry](#the-content-catalog-is-unavailable).

---

## Permissions and rootless engines

### Permission denied writing to `modules/`, `schema/`, or `data/`

**Cause.** The containers write into these directories as an unprivileged user id that does not match yours — the console runs as a non-root numeric id. If those directories were created or tightened by hand, that user cannot write to them.

**Fix.** Let the control script repair the layout. It creates the runtime directories with permissions the container user can use, and does so on every start:

```sh
./byodt up
```

Do not tighten these directories by hand — the next start widens them again, and the deployment needs them writable. The certificate directory `tls/` is the deliberate exception: it stays restrictive, is mounted read-only, and only you write to it. So is `proxy-ca/`, which holds an outbound proxy's CA: it is mounted read-only, and `byodt` refuses it when anyone but you can write to it (see [Configuration → A proxy that inspects TLS](./CONFIGURATION.md#a-proxy-that-inspects-tls)).

### The database becomes corrupt on macOS or Windows

**Cause.** The default storage setting is a host bind mount inside the bundle. On a VM-backed runtime, one that runs containers in a virtual machine (such as Docker Desktop, or a Podman machine on macOS or Windows), the file-sharing layer between host and VM can corrupt a database that is actively writing. Docker Engine or Podman running directly on Linux is not VM-backed and is not affected.

**Fix.** Move the database to the named volume, which lives in the engine's own storage. Back up first: this is a switch to a **fresh** database, not a migration.

```sh
./byodt backup
```

Then in `.env`:

```
DB_DATA=memgraph-data
```

On Neo4j, set `NEO4J_DATA=neo4j-data` instead.

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

> **Check what you share.** Logs and screenshots can carry the names of your models and components. Review them before sending. They do not contain your database password, which lives only in `.env.secrets` — and that file should never be shared. The services mask your outbound proxy's login where they report a failed fetch, and in tests no log carried it; still, search the logs for its user name before sending. The output of `./byodt compose config` and `docker inspect` (or `podman inspect`) does contain the password and the login: do not send it.

## Related

- [Installation](./INSTALLATION.md) — prerequisites and the first start.
- [Configuration](./CONFIGURATION.md) — settings, and which command applies a change.
- [Operations](./OPERATIONS.md) — the command reference, backups, TLS, and upgrades.
- [Cloud](./CLOUD.md) — connecting and disconnecting.
