---
title: 'Connecting the BYODt Deployment to the Cloud'
description: 'Add cloud sign-in and content packages from the operator console, and disconnect again'
category: 'documentation'
position: 5
navigation: true
tags: ['byodt', 'deployment', 'cloud', 'sso', 'content', 'modules']
---

# Connecting the Deployment to the Cloud

A BYODt deployment runs standalone by default and calls out to nothing. Connecting it to the cloud is opt-in, done entirely from the operator console, and reversible.

Connecting adds two things:

- **Sign-in for your team.** The platform and the console both authenticate against your account's identity provider instead of running unauthenticated.
- **Content packages.** A **Content** tab appears in the console, listing curated content packages you can mount into the deployment.

What does not change: your data. The graph stays in your database, on your machine, in both modes.

---

## Before you start

| Prerequisite | Why |
|---|---|
| A healthy deployment | Check the console shows a **Healthy** verdict first. Connecting a deployment that is already failing only makes the diagnosis harder. |
| An account that issues a deployment recipe | The recipe is the block of settings you paste into the console. Get it from the **BYODt Portal**, which the console links to. |
| Access to your account's callback settings | You must register two callback URLs before sign-in will work. |
| The console reached at a secure address | Either a `localhost` address, or HTTPS. See below. |

### The secure-address requirement

Browsers only expose the cryptography that sign-in needs on a **secure context**: an HTTPS page, or a `localhost` address. This has two consequences:

- If you reach the console at `http://127.0.0.1:3000/console/`, everything works as-is.
- If you reach it at any other address over plain HTTP, sign-in cannot run, and the console will tell you so and point you at `byodt tls generate`. The console will also refuse the configuration itself, because it will not write a plaintext, non-local callback into the platform's settings.

So: for anything other than a loopback deployment, [install a certificate](./OPERATIONS.md#tls-at-the-front-door) **before** you start here.

### Use the address you will keep using

The two callbacks the console shows you are derived from the address in your browser's bar. Register them, and then keep reaching the deployment at that same address. If you register callbacks while browsing `http://127.0.0.1:3000` and later switch to `https://deployment.example:3000`, sign-in will be rejected until you register the new pair.

---

## Step 1 — Register the two callbacks

1. Open the console and select the **Cloud** tab.
2. Find section **1 · Access and callbacks**. It shows a read-only box with two URLs, one per line:

   ```
   http://127.0.0.1:3000/auth/callback
   http://127.0.0.1:3000/console/auth/callback
   ```

   The first is the platform's sign-in. The second is the console's own. Both are on the same address, because the console is served through the same front door as the platform.

3. Click **Copy**. The console confirms with `Copied.` If your browser blocks clipboard access, it selects the text instead and tells you to copy it by hand.
4. Paste both lines into the **Callback URLs** field of your account in the portal, one per line, and save.

> **They must match exactly.** A callback that is not registered is rejected by the identity provider before it ever reaches your deployment — which means nothing in your own logs explains it. The console names the exact value to register if this happens.

> The loopback addresses for the default ports are registered for you, both `localhost` and `127.0.0.1`.
> Paste the two lines anyway — saving a URL that is already registered changes nothing, and the cost of
> skipping it is a rejection you cannot diagnose from your own logs.

## Step 2 — Paste the recipe and apply

1. Click **Get your deployment recipe ↗** at the top of the Cloud tab. It opens the portal page that issues the recipe for this deployment.
2. Copy the whole recipe. It is a block of plain `NAME=value` lines.
3. Back in the console, in section **2 · Configuration**, paste it into the text area.
4. Click **Apply cloud configuration**.

On success the console reports:

```
cloud configuration written; apply it by recreating the stack: byodt restart
```

It may add a sentence saying it kept this deployment's own exposure declaration rather than taking it from the recipe. That is intentional: the console never lets a pasted recipe change how exposed your deployment declares itself to be.

**If the recipe is rejected**, the message says exactly why — a line that is not `NAME=value`, a variable named twice, required variables missing, or variables the console will not write. In every case the fix is the same: copy the recipe again, whole and unedited, and paste it without modification.

> **Other console tabs are signed out at this point.** The deployment's posture just changed, so every console session minted under the old one is dropped. The tab you applied from stays signed in for a short grace period — long enough to read the message above and run the next step — and then it, too, asks you to sign in. Nothing is wrong either way: you do not need to be signed in to the console to recreate the stack.

## Step 3 — Recreate the stack

From your terminal, in the bundle directory:

```sh
./byodt restart
```

This is what makes the change live. Until you run it, the console shows a standing banner:

> **Cloud configuration not yet applied** — A cloud configuration is written but the platform is not running it — recreate the stack to apply it: `byodt restart`.

Recreating takes the usual few moments. `./byodt status` shows the services healthy again when it is done.

## Step 4 — Sign in

Reload the console. It now presents a sign-in card:

> **Sign in** — This deployment is connected to the cloud. Sign in with your account to manage it.

1. Click **Sign in with SSO**. The button changes to `Redirecting…` and the browser leaves for your identity provider.
2. Sign in there.
3. You return to the console, signed in.

You will know it worked:

| Where | What you see |
|---|---|
| Top-right badge | **Cloud** |
| Header | Your name or email address |
| Tabs | A third tab, **Content**, has appeared |

The platform itself now requires sign-in too. Open it from **Open platform →** in the console header.

> Console sessions last about an hour, after which the console asks you to sign in again. That is the revocation window, not a fault.

---

## Mounting content packages

The **Content** tab appears only once the platform is actually running in cloud mode. It lists the packages available to you, with your subscribed ones ready to mount.

Mounting is not a download. It writes a small marker into the deployment's modules directory naming the module and the exact content version to serve; the content itself is delivered per request. This is why mounting is instant and why it needs a platform recreate to take effect.

### Mount a module

1. Select the **Content** tab.
2. Click a package name to expand it. Packages are collapsed by default, and each row shows how many of its modules are mounted (`2/5 mounted`).
3. Click **Mount** on a module — or **Mount all** on the package header to take every module in it.
4. The console confirms, and a banner appears at the top of the tab:

   > **Restart required to apply your changes** — Mounted and unmounted modules take effect when you recreate the platform: `byodt restart platform`

5. Run it:

   ```sh
   ./byodt restart platform
   ```

Only the platform is recreated. The database, the embedding server, and the console keep running.

### Package and module states

| What you see | Meaning |
|---|---|
| **Mount** / **Mount all** | Not mounted yet. |
| `up to date` | Mounted at the newest published content version. |
| `newer available (X.Y.Z)` | A newer content version exists. An **Update** button appears next to it. |
| `update unknown` | The catalog could not be consulted, so currency could not be judged. The mount itself is fine. |
| **Not subscribed** + **Subscribe ↗** | Your account is not subscribed to this package. Mounting is disabled, because the platform would refuse to serve the content. |
| **Mounted — not in catalog** | A module you mounted that the catalog no longer lists. Kept visible so you can still unmount it. |

### Keep mounts current

A module marked `newer available` keeps serving the version you pinned until you act. Click **Update** on that module, then:

```sh
./byodt restart platform
```

### Unmount

Click **Unmount** on a module, or **Unmount all** on a package, then `./byodt restart platform`.

The console only ever removes directories it created. A module that shipped with the release, or one you wrote yourself, is refused rather than deleted — even if the names collide.

### The knowledge-graph connection

If your subscription includes the knowledge graph, the **Content** tab shows one further entry above the packages: **Knowledge graph — cloud connection**, with the version it is pinned at. It has no buttons, and that is deliberate — it is not something you mount.

It arrives when you connect and is removed when you disconnect. Like a content mount it is a client rather than a copy: no graph data is installed on your deployment, and every answer is served per request against your own sign-in. The pinned version is fixed for as long as the connection lasts, so what your deployment answers does not change under it; reconnecting is what takes a newer one.

If the service cannot be reached at the moment you connect, the console says so and connects you anyway, without it. Nothing else about the connection is affected — disconnect and reconnect when you want to try again.

---

## Disconnecting

Disconnecting rewrites the deployment's configuration back to the standalone values. **Your data is untouched.**

> **Unmount first.** Content mounts can only be managed while the deployment is connected. If you disconnect with modules still mounted, their markers stay on disk and the console can no longer remove them — you would have to reconnect to unmount them. Take the Content tab down to nothing you want to keep before you disconnect. The knowledge-graph connection is the exception: you never mounted it, and disconnecting removes it for you.

1. In the console, select the **Cloud** tab. Section **2 · Configuration** now reads:

   > This deployment is configured for the cloud. Disconnect rewrites the configuration back to the pure open-source values; your data is untouched, and the change is applied by recreating the stack.

2. Click **Disconnect from cloud**. The console reports:

   ```
   reverted to pure-OSS; apply it by recreating the stack: byodt restart
   ```

3. Recreate the stack:

   ```sh
   ./byodt restart
   ```

Until you do, the console shows a banner reading **Revert to pure open-source not yet applied**.

The console signs you out here too, but this direction is smoother: the posture is now standalone, so the console re-establishes its own session and opens straight to the dashboard. After the recreate, the badge reads **Pre-cloud** again and the **Content** tab is gone.

> **Disconnecting never contacts the cloud.** It is deliberately a local, self-sufficient operation, so it still works when nothing about the cloud is reachable or when your access has changed. It is always available to you.

---

## What the console will and will not do with a recipe

Worth knowing, because it explains the messages you may see.

- **It accepts a fixed set of variable names, and refuses the whole recipe if anything else appears.** It lists what it refused. This is a deliberate guard: the configuration it writes is applied over the platform's own settings, so an unexpected variable in it could change far more than identity.
- **It requires every expected variable to be present and non-empty.** A half-applied recipe would boot the deployment into a broken state, so it is refused outright.
- **It keeps your deployment's own exposure declaration** rather than taking the recipe's, and says so when it does.
- **It supplies the values a recipe cannot know** — the callback address of your front door, and where cached content lives.
- **It refuses to reconfigure a deployment that is already connected.** Disconnect first, then apply the new recipe.
- **It will not write a plaintext identity endpoint or a non-local plaintext callback.** Those must be HTTPS, or `localhost`.

---

## Troubleshooting

Cloud-specific symptoms — a rejected callback, a sign-in that will not complete, an unreachable catalog — are covered in [Troubleshooting → Cloud connect and sign-in](./TROUBLESHOOTING.md#cloud-connect-and-sign-in) and [Content mounts](./TROUBLESHOOTING.md#content-mounts).

## Related

- [Operations](./OPERATIONS.md) — the commands referenced here, including TLS.
- [Configuration](./CONFIGURATION.md#the-mode-layer-modemodeenv) — the mode layer the console writes.
