# BYODt Deployment — Security Model

> The trust boundaries of a self-hosted deployment, the authentication postures it can run in, how
> secrets are handled, and the hardening rules that follow.

This document covers the deployment: its edge, its console, its configuration layers, and the way code
gets into it. The platform's own security architecture — JWT validation, the schema-level
authentication directive, query guards, module allowlisting, data protection — is documented once, in
the [Platform Security Model](../../SECURITY_MODEL.md), and is not repeated here.

One rule in this document is not a trade-off to weigh but a constraint to design around:
[the console's network reachability is authority over the deployment's identity
configuration](#console-reachability-is-authority-over-the-deployments-identity-configuration).

---

## Trust boundaries

```
  ┌─ the host ────────────────────────────────────────────────────────────────┐
  │  .env · .env.secrets (0600) · mode/ · tls/ · data/ · modules/             │
  │  An operator with a shell here has the deployment and its data. That is   │
  │  the outermost boundary; nothing inside defends against it.               │
  │                                                                           │
  │   ══ B1 published port ═══ 127.0.0.1:3000 by default ═══════════════      │
  │                                                                           │
  │  ┌─ stack network (bridge, no published ports) ───────────────────────┐   │
  │  │                                                                     │  │
  │  │   proxy ──┬── B2 console session gate ──▶ console                   │  │
  │  │           │                                                         │  │
  │  │           └── B3 platform authentication ──▶ platform ──▶ db        │  │
  │  │                                                        └─▶ ollama   │  │
  │  │                                                                     │  │
  │  └─────────────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────────────┘

        B4  release channel  ──▶  console-init      signature + digest verified
        B5  content service  ──▶  platform          cloud only, per request, caller's token
        B6  console          ──▶  content service   cloud only, two routes, the operator's token
```

| Boundary | Enforced by | Notes |
|---|---|---|
| **B1** — network to deployment | The publish address and your own network controls | The only published port. Bound to loopback by default. TLS terminates here when a certificate is installed |
| **B2** — caller to console | A console session, carried in a request header | How a session is *minted* depends on posture; see below |
| **B3** — caller to platform | The platform's own authentication | Disabled, own identity provider, or cloud — decided by the mode layer |
| **B4** — release channel to deployment | Sigstore signature against a pinned identity, plus digests | Detailed in [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md) |
| **B5** — content service to platform | The caller's own token, per request | Only exists on a cloud-connected deployment; the console never holds that content |
| **B6** — console to content service | The operator's own OIDC access token, relayed for the duration of one request | Only exists on a cloud-connected deployment. Two calls carry it: reading what the subscription includes, which the catalog is marked with, and fetching an entitled artifact's bytes. The catalog document itself is read over the same hop with no credential at all. The host comes from the mode layer this console wrote, never from the request |

Inside the stack network, hops are plain HTTP and Bolt is unencrypted. The isolation is the network,
not encryption of each hop: no service but the proxy publishes a port, and the database and embedding
server are unreachable from outside it. Encrypting the edge is the proxy's job.

---

## Authentication postures

The platform's posture is not in `.env`. It is decided by the mode layer — one env-file the console
owns — and it applies when containers are recreated.

| Posture | Platform | Console session | Written by |
|---|---|---|---|
| **Local** (the default) | Authentication disabled: `NODE_ENV=development`, `ENABLE_NOAUTH=true`, no OIDC | Minted with **no credential** | Seeded by the control script; rewritten by the console on disconnect |
| **Own identity provider** | Authenticated against the operator's own OIDC provider | Minted with **no credential** | The operator, by hand. The console recognises this state but does not write it |
| **Cloud** | Authenticated, `NODE_ENV=production`, with the deployment's own access list | Delegated OIDC sign-in | The console, from a **recipe** the operator pastes |

Disabling authentication requires **all three** of: `NODE_ENV` not `production`, no OIDC configured,
and `ENABLE_NOAUTH=true` explicitly. The platform's production validation additionally refuses to start
with `ENABLE_NOAUTH` set, and requires the full OIDC set, `ALLOWED_ORIGINS`, `ALLOWED_MODULES`, and
`NEO4J_TRUST_CERT=false`. A hand-written authenticated mode layer must satisfy that set — see the
[Configuration Guide](../../CONFIGURATION_GUIDE.md).

The security controls that are *not* posture-dependent apply everywhere: the security headers, the
GraphQL depth and complexity guards, and the module-loading rules all run in every mode.

### Sessions

The console session is carried in the `X-Console-Session` request header, never a cookie. A header
cannot be attached by a third-party page, so the cross-site request forgery class is removed outright —
without `SameSite` reasoning, double-submit tokens, or `Origin` checks. Session identifiers are 256
random bits, held in memory by the daemon; a daemon restart invalidates all of them, and a posture
change drops them so none survives the flip — with one carve-out: the session that *performed* the
change is kept on a short, absolute grace deadline. Without it the console would answer "recreate the
stack" and sign the operator out in the same response, in the one window where the new posture's
sign-in cannot yet succeed, because the platform is still running the old configuration. The carve-out
grants nothing: that caller held full console access a moment earlier, its grace only ever shortens an
existing deadline, and the recreate it is being told to run restarts the daemon and ends the session
anyway.

A cloud session has a fixed one-hour lifetime — the revocation window — after which the sign-in re-runs
and the platform re-checks its access list. A local session has no expiry, because there is no
credential behind it to revoke.

In the browser, the session identifier is kept in `sessionStorage` (same-origin, tab-scoped) so it
survives the full-page redirect a sign-in performs. A cloud sign-in returns two OIDC tokens from one
exchange, and both are held in memory only and never persisted: the ID token, which rides on
`Authorization` on every gated request so the daemon can forward it to the platform's authenticated
module query, and an access token, which nothing attaches automatically and which travels on
`X-Console-Cloud-Token` on the two routes that relay it onward. Two tokens for two audiences cannot
share one header — collapsing them would send whichever arrived last to whichever service was called
next. They are set and cleared together, because they come from one exchange and expire on one clock.

---

## What the front door exposes

Everything reachable at the published port, and nothing else:

| Path | Reaches | Gate |
|---|---|---|
| `/` and below | The platform: SPA, `/graphql`, `/config`, the sign-in callback, the subscription stream | The platform's own authentication (B3) |
| `/console/` and below | The console daemon | A console session (B2) |
| `/healthz` | The proxy itself | none — a fixed `200 ok`, no upstream information |

**Publishing the front door publishes the console.** They share one origin by design — one endpoint,
one certificate, both sign-in callbacks on the same host — which means `FRONT_DOOR_BIND` governs the
reachability of both. There is no configuration in which the platform is exposed and the console is not.

TLS terminates at the front door for the whole stack when `cert.pem` and `key.pem` are present in the
mounted `tls/` directory (TLS 1.2 and 1.3). Without them the front door serves plain HTTP, which is
appropriate for a loopback deployment behind the operator's own boundary and is not appropriate for
anything else. A self-signed certificate encrypts the hop and makes the browser treat the origin as a
secure context; it attests no identity.

---

## Console reachability is authority over the deployment's identity configuration

**Do not expose the console to an untrusted network.** Whoever can reach it can decide, at the next
recreate, whether the platform authenticates anyone at all.

The chain is short and has no gate in the middle:

1. **In every posture except cloud, the console mints a session to any caller that can reach it.** No
   credential is asked for. That is deliberate for a single-operator deployment on a loopback address —
   a secret there would only fence out other local processes — but it is not a network access control,
   and it was never intended as one. It applies to the local default **and** to a deployment running
   against the operator's own identity provider.
2. **A session holder can rewrite the mode layer.** `POST /api/cloud` writes an authenticated
   configuration; `DELETE /api/cloud` rewrites the same file with the local values — `NODE_ENV=development`,
   `ENABLE_NOAUTH=true`, and no OIDC variables at all.
3. **The mode layer is what decides the platform's authentication**: whether it is on, which issuer and
   audience it trusts, and which subjects it serves.

So on a network-reachable deployment in any non-cloud posture, an unauthenticated caller can write a
configuration that turns the platform's authentication off — and then wait. The change is not
instantaneous: it applies when the containers are recreated, and until then the console shows a
pending-restart banner. That is a detection surface, not a control; an operator who sees the banner and
runs the command they were expecting to run completes the change themselves.

Treat "who can open the console" as exactly equal to "who administers this deployment".

### Rules

| Rule | Why |
|---|---|
| **Keep `FRONT_DOOR_BIND=127.0.0.1`.** This is the shipped default. | It is what makes the unauthenticated local session posture coherent |
| **To reach a deployment from elsewhere, put it behind your own authenticated boundary** — an SSH tunnel, a VPN, or an authenticating reverse proxy in front of the published port | Setting `FRONT_DOOR_BIND=0.0.0.0` alone publishes an unauthenticated administrative surface |
| **Enable TLS at the front door for anything that is not loopback** | Both the platform's and the console's sign-ins, and the console session header, cross that hop |
| **Do not assume that authenticating the platform authenticates the console** | Only the cloud posture gates the console with a sign-in. An own-identity-provider deployment has an authenticated platform and an unauthenticated console |
| **Treat the host as part of the boundary** | The runtime directories are world-writable by design (below), so a local user on a shared host is inside the deployment |

The design does not paper over this with a loopback check inside the daemon, and the reason is worth
stating: a loopback bind is not a boundary against the operator's own browser, and pretending it is a
security control would encourage exactly the exposure this section warns against. The header-based
session closes the browser-driven class; network reachability remains an operator decision, and this is
the documentation of what that decision costs.

---

## Secrets and key material

| Secret | Where it lives | Handling |
|---|---|---|
| Database password | `.env.secrets`, mode `0600`, created with `umask 077` | Generated once on first run (24 random bytes, hex). Never written into `.env`. Reaches `db`, `console-init`, and `platform` through Compose interpolation only |
| TLS private key | `tls/key.pem`, mode `0600`, in a `0700` directory | Mounted read-only into the proxy. The control script never widens that directory |
| Operator ID token (cloud) | Browser memory only | Never persisted, never written to disk by the console, never logged |
| Operator access token (cloud) | Browser memory; the daemon holds it for the duration of one request | Minted in the same exchange as the ID token. Never persisted, never written to disk, never logged. Reaches the daemon on `X-Console-Cloud-Token`, from two routes alone: the catalog read, which asks what the subscription includes, and the artifact install. It is relayed upstream as an ordinary bearer — the console's own header name never travels outbound |
| Console session id | Daemon memory; browser `sessionStorage` | Random 256-bit value, sent as a header |
| Mode layer | `mode/mode.env`, mode `0644` | Non-secret configuration by design — identity endpoints and the deployment's access list, no credentials |

Four consequences are worth stating plainly:

- **The console holds no credential of its own.** The authenticated calls it makes on the operator's
  behalf — the platform's module query, and the two on the content service's entitled surface: what
  the subscription includes, and an entitled artifact's bytes — carry the operator's own tokens, taken
  from the request that asked for the work and gone when that request ends. There is no service
  identity behind the console to steal, and nothing it could replay once the operator's session is
  over.
- **The console is never given the database password.** Its service definition passes neither the
  variable nor the secrets file, so a flaw in the console cannot yield database credentials.
- **A backup is not a secret-bearing file, but it is your whole graph.** Database authentication is
  separate system state and is not inside a snapshot, so a backup carries no password — and restores
  cleanly onto another deployment of the same version. Protect it as you would the models it contains.
- **`.env.secrets` is not disposable.** The database's stored authentication was created with that
  password. Deleting the file while the graph exists locks the operator out of their own data, which is
  why `destroy` deletes nothing and says so.

The `/api/posture` endpoint is ungated, because the sign-in page must know which sign-in to render
before a session can exist. It returns a hard five-field projection of the mode file — posture, whether
authentication is disabled, and the three public discovery values — and never marshals the parsed file.
That projection *is* the guard: the same file also holds the deployment's access list and its service
URLs.

---

## The mode layer is a closed variable allowlist

A pasted cloud **recipe** — the block of `NAME=value` lines an operator copies from their account — is
not written into the mode layer as given. The console accepts an exact set of names and **rejects the
entire apply** if any name outside it appears.

| Name | Treatment |
|---|---|
| `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `OIDC_DOMAIN`, `OIDC_SHARED_POOL`, `PORTAL_ORIGIN`, `MODULE_CONTENT_BASE_URL`, `DEPLOYMENT_ALLOWLIST` | Accepted. Each must be **present and non-empty** |
| `MODULE_KG_BASE_URL` | Accepted; may legitimately be empty or absent. Present and non-empty it is held to the URL rule below, which is also what stands between a pasted recipe and the console's own outbound request to that host |
| `DEPLOYMENT_ARTIFACT_SIGNER` | Accepted; may legitimately be empty or absent. It is the certificate-subject prefix an entitled artifact must be signed under — configuration the console composes a per-version ref onto, never a destination it dials — so it is held to its own shape rule below rather than the URL rule. Absent, the deployment cannot install artifacts until it reconnects |
| `DEPLOYMENT_EXPOSURE` | Recognised and **dropped**. It is the operator's own exposure declaration and must not be taken from a recipe. Two retired names — `COMMERCE_API_BASE_URL` and `DEPLOYMENT_PACKAGES` — are likewise tolerated-and-dropped, so a saved recipe carrying either still applies rather than failing as a foreign variable |
| `NODE_ENV`, `OIDC_REDIRECT_URI`, `MODULE_CONTENT_CACHE_DIR`, `ALLOWED_ORIGINS` | Supplied by the console, never taken from the paste |
| `MODULE_KG_VERSION` | Supplied by the console, never taken from the paste — a recipe that could carry it could pin a deployment to a version of the sender's choosing. Read from a public listing with no credential, and validated as `sha256:` plus 64 hex before it is written |
| Anything else | The apply is refused, naming every offending variable at once |

**The check is on the name set, not the name shape.** That distinction is the control. The mode layer
is applied *after* the base layer and therefore overrides it, so a recipe smuggling
`NODE_ENV=development` plus `ENABLE_NOAUTH=true` would turn authentication off for the whole graph, and
a Node option that preloads a module is arbitrary code in the platform process at boot. None of those
names is in the accepted set — and no plausible shape check would have caught them.

Five further constraints apply to the values:

- **Every required name must be non-empty.** A blank identity value produces the same broken boot a
  missing one does, so a presence check alone would be hollow. The two names marked above as
  legitimately empty or absent are exactly the exceptions, and each is one for its own reason. For the
  knowledge-graph base the empty case is reachable in normal use rather than a sign of a half recipe;
  the signer is an exception because requiring it would reject every recipe issued before the name
  existed — and where it is absent the deployment loses its artifact installs rather than running them
  ungated.
- **No value may contain a control character.** A newline would split into a second `NAME=value` line
  in the written file — the exact class the fixed name set exists to prevent. It is rejected where the
  values are assembled *and* again in the serializer, which every write passes through.
- **URL-shaped values must be `https`** (or `http` only on a loopback host). A plaintext or off-box
  value would point the platform's identity checks, or a module's own fetches, at another party's
  host. A value that is legitimately absent is not checked — there is nothing to check — but an empty
  service URL is dropped rather than written, so no reader has to decide what an empty one means.
- **The artifact signer prefix is checked for shape, not reachability.** It is URL-shaped and
  deliberately not held to the rule above, because nothing ever dials it: it is composed into a
  certificate subject and compared, never fetched. It must be `https` with no loopback carve-out, must
  match `https://<host>/<owner>/<repo>/.github/workflows/<file>.yml` (or `.yaml`), and must contain
  neither `@` nor
  `/../`. The check runs on the raw string rather than a parsed URL, because a parser hides exactly what
  it is looking for — it lifts a `user@` prefix out of the host and strips a query or fragment out of the
  path. The host is not pinned, because this is a typo guard rather than a control: a recipe hostile
  enough to name a false signer already names the identity provider, the JWKS URI, the deployment's
  access list and the content host, and owns its whole trust configuration anyway. What protects the
  value is where it came from — the operator's own account, over their own authenticated session — and
  that its shape is re-checked when it is read, so validity is a property of the value rather than of
  which console wrote the file. What the composed subject pins is in
  [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md#verification).
- **`ALLOWED_ORIGINS` is derived, not pasted.** It is the origin of the deployment's own front-door
  callback, so it stays in step with the redirect URI by construction.

Two write-path rules complete it: a recipe cannot be applied over an existing cloud configuration
(disconnect first, so reconfiguration is never a silent overwrite), and the file is **rewritten, never
deleted** — a missing env-file breaks the container runtime's own file reading, which would break the
recovery path itself. Reverting contacts nothing, because it is the recovery path from a configuration
that no longer lets anyone in.

---

## Module trust

Modules are executable code loaded by the platform, so this deployment treats their provenance as a
first-order concern.

| Control | Effect |
|---|---|
| Signature verification against a pinned identity | Two anchors, one shape: a fixed workflow path plus a ref naming exactly what was asked for, matched against the certificate's subject exactly and never as a pattern. For a release asset the workflow path is compiled into the console and the ref is the tag, from `PLATFORM_VERSION` — which the operator sets and the console never overrides. For an entitled artifact the workflow path is configuration instead — the signer prefix this deployment was given when it connected, because the workflow that signs artifacts is not one this binary's source names — and the ref names the key and version asked for, both shape-checked before they are composed in. A deployment with no usable signer refuses the install rather than falling back to a weaker check. See [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md#verification) |
| Digest checks | The downloaded archive must match the signed index's digest; the unpacked tree's identity is recomputed and must match its own signed stamp |
| Confined extraction | Path escapes, symlinks, hardlinks, other entry types, and oversized archives are refused outright |
| Read-only mount | The platform mounts the modules directory read-only; only the console writes it |
| No hot reload | `ENABLE_MODULE_HOT_RELOAD=false` — module changes take effect on a recreate, never mid-flight |
| World-writable refusal | When running in production mode the platform refuses to load a world-writable module file. The console warns when a mount lands world-writable rather than letting it fail silently later |
| Mount ownership marker | The console will not overwrite or delete a module directory it did not create |
| Artifact kind | An artifact that declares itself an application is refused before its archive is fetched. A module layout is something an application's tree could satisfy by accident, and this is the only check anywhere that says only a module may be installed onto a deployment |
| No silent downgrade | Installing a version older than the installed one has to be asked for explicitly, so a service that withdrew a fixed version cannot walk a deployment backwards onto a known-bad one |
| No cross-kind ownership marker | A payload carrying another mount kind's marker is refused and nothing is placed. Otherwise the installed tree would carry two markers, and the unmount route — which gates on its own marker alone — could delete an artifact install as though it had written it |

`ALLOWED_MODULES` is `*` in this deployment, and that is not a weakening: name matching is not the
control here. What may be installed is decided at install time by signature and digest, and by the fact
that only the console can write the mount.

---

## Host-level considerations

The runtime directories in the bundle — `modules/`, `schema/`, `data/`, `mode/` — are created
world-writable. Under a rootless engine the container's unprivileged uid need not match the operator's,
and both console halves must write into these mounts. The trade-off is explicit: **on a shared host,
any local user can write into the modules mount**, and what is there is loaded at the next recreate.

This deployment assumes a single-operator host. If that does not hold, the host itself must be treated
as a boundary you enforce — not one the deployment enforces for you.

`tls/` is deliberately excluded from that widening and kept at `0700`: a world-writable directory there
would let any local user replace the private key, or remove it and force the plaintext fallback.

---

## What this deployment does not defend against

Stated so they are decisions rather than surprises:

- **A user with shell access on the host.** They have the configuration, the secrets file, and the data
  directory. Nothing inside the stack changes that.
- **Multi-user separation inside one deployment.** A deployment serves one team; access control is at
  its edge. There is no per-user isolation of models inside it.
- **The third-party images.** The database, embedding server, and proxy images are pulled by your
  runtime from their publishers. They carry their own provenance and their own licenses — see the
  bundle's [`NOTICE`](../../../deploy/compose/NOTICE) — and verifying them is the operator's decision,
  not something this bundle does on their behalf.
- **Traffic inside the stack network.** Plain HTTP and unencrypted Bolt, by design. The control is that
  nothing but the proxy is reachable from outside.
- **A compromised operator browser session.** The console session is a bearer token in that browser's
  storage for its lifetime.

---

## Related documentation

| Document | Description |
|---|---|
| [Platform Security Model](../../SECURITY_MODEL.md) | The platform's own layers: JWT validation, schema authentication, query guards, data protection |
| [`CONSOLE.md`](./CONSOLE.md) | Sessions, the mode layer, and why the console has no process control |
| [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md) | Signature policy, identity pinning, extraction limits |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Ports, mounts, TLS termination, and the configuration layers |
| [Configuration Guide](../../CONFIGURATION_GUIDE.md) | Every variable referenced here, in detail |
| [ADR-003 — OIDC authentication](../decisions/003-oidc-authentication.md) · [ADR-006 — defense in depth](../decisions/006-defense-in-depth-security.md) | The platform decisions this deployment inherits |
