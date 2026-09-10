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

## Who can change a connected deployment

Signing in gets you the console. **Changing** the deployment needs one thing more: you must be an administrator of the team the deployment belongs to. Reading is not restricted — anyone who can sign in sees the deployment's state, the catalog, what is mounted, and what is installed.

These are the controls that need the role:

| Control | Where |
|---|---|
| **Mount**, **Mount all**, **Update**, **Unmount**, **Unmount all** | Content tab |
| **Install** and **Remove**, for entitled artifacts | Content tab |
| **Apply access list** | Cloud tab |
| **Disconnect from cloud** | Cloud tab |

The console does not hide them from you. It disables them and says why beside them:

> Only an administrator of this deployment's team can change what it provides. An owner or administrator of that team can grant you the administrator role in the portal.

The Content tab says the same as a banner across the top: **You can see this deployment, but not change it**.

Four things are worth knowing about how the check runs:

- **It is asked of the cloud every time, and never remembered.** A role granted or withdrawn in the portal takes effect on your next attempt. You do not have to sign in again for it — though the Content tab only learns which controls to offer when it reads the catalog, so click **Refresh** there to see the buttons change.
- **It uses the cloud credential this browser tab holds**, which lives only in memory. Reloading the page clears it while leaving you signed in to the console, so the console may send you to sign in again when you use one of these controls. That is the ordinary state of a reloaded tab, not a fault.
- **A refusal always means nothing was changed.** The four ways it can refuse, and what each one calls for, are in [Troubleshooting → Cloud connect and sign-in](./TROUBLESHOOTING.md#cloud-connect-and-sign-in).
- **A deployment connected with a recipe that names no team is not checked at all**, and every control behaves as it did before the check existed. The check turns itself on for a deployment when it is next connected with a recipe that names one.

---

## Mounting content packages

The **Content** tab appears only once the platform is actually running in cloud mode. It lists the packages available to you, with your subscribed ones ready to mount. Your subscription is read again each time the console loads, so what you see is what you are subscribed to now — not what you were subscribed to when you connected.

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
| **Not subscribed** + **Subscribe ↗** | Your account is not subscribed to this package. Mounting is disabled, because the platform would refuse to serve the content. This is your subscription as of this moment: subscribe, then click **Refresh** — you do not have to disconnect and reconnect to pick it up. |
| A muted line above the list: *Your subscription has not been checked. Signing in again gives this tab the cloud credential it needs…* | Reloading the page clears that credential, so this is the normal state of a fresh tab. Nothing is restricted. Click **Sign in** beside the line; the check runs again when you come back. |
| A muted line above the list, beginning *Nothing is restricted, but subscriptions cannot be checked on this deployment…* | This deployment's configuration does not carry the permission the check needs, so signing in again and pressing **Refresh** will not change it. Get a fresh recipe from the portal, then [disconnect](#disconnecting), apply it, and connect again — read what disconnecting costs first. |
| A muted line above the list: *Your subscription could not be checked just now.* | The check did not go through this time. Nothing is restricted; click **Refresh** to try again. |
| **Mounted — not in catalog** | A module you mounted that the catalog no longer lists. Kept visible so you can still unmount it. |
| A banner: **You can see this deployment, but not change it** | You are signed in, but you do not administer the team this deployment belongs to, so **Mount**, **Unmount**, **Install** and **Remove** are disabled. Nothing you can read is affected. See [Who can change a connected deployment](#who-can-change-a-connected-deployment). |

### Refresh

The console reads the catalog, your subscription, and what is mounted when it loads. It does not update on its own after that — switching to another tab and back does not re-read anything.

Click **Refresh**, at the top of the tab, to read all three again. This is how a new subscription reaches the console: subscribe in the portal, come back, click **Refresh**, and the package is mountable straight away — you do not have to disconnect and reconnect for it. See [Disconnecting](#disconnecting) for what that involves.

**Refresh** is unavailable while a mount or unmount is running. Let it finish, then click it.

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

## Changing who may sign in

Who may sign in to a connected deployment is a list of accounts held in the deployment's configuration. You can replace that list from the console, on a running deployment, without disconnecting.

If your browser tab has been reloaded since you signed in, the console sends you to sign in again at the moment you apply. That interrupts the change rather than making it: your pasted list is put back in the box when you return, with a line saying nothing was changed.

**Reach for this rather than disconnecting.** Disconnecting also ends everyone's access, but it takes every cloud-provided module with it — and at the next platform start, the classes those modules provide and every link to them. Changing the list costs none of that. See [What disconnecting costs](#disconnecting).

### Before you start

| Prerequisite | Why |
|---|---|
| A connected deployment | The control appears only once a cloud configuration is written. A deployment that is not connected admits whoever its own configuration admits, and has no access list to change. |
| The administrator role | This changes the deployment, so it needs an administrator of the deployment's team — see [Who can change a connected deployment](#who-can-change-a-connected-deployment). |
| The **whole** list, copied from the portal | The console cannot show you the current list, so this is not something to edit from memory. The portal's **Who may sign in** card is a copyable field with a **Copy** button beside it. |

Some of the console's messages call these accounts *subjects*. They are the identifiers your identity provider issues, and they are what the portal's card gives you.

### Replace the list

1. In the console, select the **Cloud** tab. Section **2 · Configuration** opens with a **Who may sign in** section, above the disconnect control.
2. In the portal, open this deployment's **Who may sign in** card. Its heading carries the number of accounts — `Who may sign in (12 accounts)` — so note that number, then click **Copy**.
3. Paste it into the box. One account per line, or separated by commas.
4. Click **Apply access list**. The box clears, and the console reports how many accounts it wrote and when the change takes effect — for example:

   > `12 accounts written. Who may sign in changes at the next platform start, not now: the platform reads this list once, when it starts, so until then it goes on admitting exactly who it admits today — including anyone you just removed. Apply it by restarting the platform: byodt restart platform. That restart removes no module, so it has none of the consequences for your classes and links that a restart finding a module missing does.`

5. Apply it:

   ```sh
   ./byodt restart platform
   ```

   Only the platform is recreated, and this restart removes no module — so it does not touch your classes or the links to them.

**Check the count against the portal's.** The two numbers are meant to be the same one: the portal's card says `(12 accounts)` in its heading, and a successful apply answers `12 accounts written`. That comparison is the only confirmation you get that the paste was read the way you meant it — the console reports the number and never the accounts themselves, it cannot show you the list you replaced, and it clears the box on success, so there is nothing left on screen to check against. If the console's number is lower than the portal's, the paste lost lines: copy the list again and apply it again **before** you restart. Nothing has taken effect until you do.

### What the console will and will not accept

- **It replaces the whole list.** Anyone not in the box loses access at the next platform start. There is no add-one or remove-one.
- **It cannot show you the current list.** Nothing in the console surfaces it, deliberately. Copy the whole list from the portal rather than editing from memory — what you cannot see is what you drop. If you need to check what is actually configured, it is readable on the host: [Troubleshooting → I need to see who is on the access list](./TROUBLESHOOTING.md#i-need-to-see-who-is-on-the-access-list).
- **It refuses a list that leaves you out**, because applying it would lock you out of your own deployment at the next platform start. Copy the whole list from the portal again rather than adding yourself back to what is in the box — if your own account went missing from it, others may have too. An administrator who is on the new list can also apply it for you.
- **It refuses an empty list.** An empty list does not mean "nobody": the platform reads it as *no restriction*, and on a deployment reachable over the network it refuses to start at all. A box that looks filled can still name none — separators on their own, such as `,,,`, are not accounts. To narrow access to one person, submit a list naming that one account. If that person is not you, the console refuses that list too, for the reason in the bullet above: keep your own account on it as well, or ask an administrator who *is* on the new list to apply it.
- **It changes nothing else.** Only who may sign in. Every other value in the deployment's configuration is left exactly as it was.
- **A refusal changes nothing.** The message names which refusal it is; each one, and what to do about it, is in [Troubleshooting → Cloud connect and sign-in](./TROUBLESHOOTING.md#cloud-connect-and-sign-in).

### Until you restart

The change is written, and it is inert. The platform reads its access list once, when it starts, so until you run `./byodt restart platform` the deployment goes on admitting exactly who it admitted before — including anyone you just removed. The console states this before you submit anything, and again in the answer. If access has to end now, restart the platform now.

---

## Disconnecting

Disconnecting rewrites the deployment's configuration back to the standalone values and removes every module the cloud provided. **Your models and diagrams are not deleted** — what a disconnect costs is the classes those modules contributed, and every link to them.

> **What disconnecting costs.** Every cloud-provided module goes with the connection that justified it — mounted content modules, installed artifacts and the knowledge-graph connection. At the next platform restart the classes those modules provided are deleted, together with every link to them, including the links in analyses you have already run; reconnecting and mounting them again brings the classes back, but not those links. Anything you authored outside those classes is kept. Unmounting first is not a way around this — a module the platform no longer finds loses its classes however it left — and the console states the same cost in the confirmation it asks you to accept. The knowledge-graph connection is the exception: it declares no classes, so nothing follows from removing it.

1. In the console, select the **Cloud** tab. Section **2 · Configuration** now reads:

   > This deployment is configured for the cloud. Disconnect rewrites the configuration back to the pure open-source values and removes the modules the cloud provided; the change is applied by recreating the stack.

2. Click **Disconnect from cloud**. The console asks you to confirm, listing what the disconnect removes; click **Disconnect** to accept. It then reports:

   ```
   reverted to pure-OSS; apply it by recreating the stack: byodt restart
   ```

3. Recreate the stack:

   ```sh
   ./byodt restart
   ```

Until you do, the console shows a banner reading **Revert to pure open-source not yet applied**.

The console signs you out here too, but this direction is smoother: the posture is now standalone, so the console re-establishes its own session and opens straight to the dashboard. After the recreate, the badge reads **Pre-cloud** again and the **Content** tab is gone.

> **Disconnecting contacts the cloud, and can be refused.** It changes the deployment, so it is administrator-only like the other controls in [Who can change a connected deployment](#who-can-change-a-connected-deployment), and the check is made live on the attempt — which means a disconnect is refused while the check cannot be made. That is deliberate on the one operation that costs you classes and links: it fails by declining, never by proceeding.
>
> Two narrower guarantees do hold, and they are the ones to rely on:
>
> - **A session you already hold keeps the ability to revert while the platform is down.** The platform and the content service are separate dependencies, and this check asks only the second — so a platform that will not come up does not take disconnect with it.
> - **A deployment whose configuration can never obtain the credential the check needs is not locked in.** Disconnect alone proceeds there, because disconnect is what you reach for to fix a bad configuration. Nothing else on the list gets that carve-out.

---

## What the console will and will not do with a recipe

Worth knowing, because it explains the messages you may see.

- **It accepts a fixed set of variable names, and refuses the whole recipe if anything else appears.** It lists what it refused. This is a deliberate guard: the configuration it writes is applied over the platform's own settings, so an unexpected variable in it could change far more than identity.
- **It requires every expected variable to be present and non-empty.** A half-applied recipe would boot the deployment into a broken state, so it is refused outright.
- **It keeps your deployment's own exposure declaration** rather than taking the recipe's, and says so when it does.
- **It supplies the values a recipe cannot know** — the callback address of your front door, and where cached content lives.
- **It refuses to reconfigure a deployment that is already connected.** Disconnect first, then apply the new recipe. There is exactly one exception, and it is not a recipe: [who may sign in](#changing-who-may-sign-in) can be replaced in place on a connected deployment. No other value can.
- **It will not write a plaintext identity endpoint or a non-local plaintext callback.** Those must be HTTPS, or `localhost`.

---

## Troubleshooting

Cloud-specific symptoms — a rejected callback, a sign-in that will not complete, a refused administrator check, a rejected access list, an unreachable catalog — are covered in [Troubleshooting → Cloud connect and sign-in](./TROUBLESHOOTING.md#cloud-connect-and-sign-in) and [Content mounts](./TROUBLESHOOTING.md#content-mounts).

## Related

- [Operations](./OPERATIONS.md) — the commands referenced here, including TLS.
- [Configuration](./CONFIGURATION.md#the-mode-layer-modemodeenv) — the mode layer the console writes.
