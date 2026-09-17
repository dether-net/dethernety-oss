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
        B6  console          ──▶  content service   cloud only, the operator's token, per request
```

| Boundary | Enforced by | Notes |
|---|---|---|
| **B1** — network to deployment | The publish address and your own network controls | The only published port. Bound to loopback by default. TLS terminates here when a certificate is installed |
| **B2** — caller to console | A console session, carried in a request header | How a session is *minted* depends on posture; see below |
| **B3** — caller to platform | The platform's own authentication | Disabled, own identity provider, or cloud — decided by the mode layer |
| **B4** — release channel to deployment | Sigstore signature against a pinned identity, plus digests | Detailed in [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md) |
| **B5** — content service to platform | The caller's own token, per request | Only exists on a cloud-connected deployment; the console never holds that content |
| **B6** — console to content service | The operator's own OIDC access token, held for the duration of one request | Only exists on a cloud-connected deployment. The calls that carry it are of three kinds, and this row names the kinds rather than counting the calls — a count here was wrong by the next route twice over. Where the **operation** needs it: reading what the subscription includes, which the catalog is marked with; fetching an entitled artifact's bytes; and relaying the team's roster to the card that chooses who may sign in. Where the **admin gate** needs it: every route that changes the deployment asks the content service who is acting before it runs. And where **both** do: the two reads that reveal who may sign in — the roster relay and the deployment's own access list — are admin-gated for what they show rather than for what they change, so the gate spends the token there too. The catalog document itself is read over the same hop with no credential at all. The host comes from the mode layer this console wrote, never from the request |

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
`X-Console-Cloud-Token` on the routes that need it. Two tokens for two audiences cannot
share one header — collapsing them would send whichever arrived last to whichever service was called
next. They are set and cleared together, because they come from one exchange and expire on one clock.

**More than two, and this once counted them.** It said *two* until the admin gate landed, then *seven*,
and the second count was wrong by the time the next route was wired — so it now says what kinds there are
and not how many. Some routes forward the access token because the *operation* needs it — the catalog
read, which asks what the subscription includes; the artifact install, which asks for bytes the content
service hands only to a subscriber; and the roster relay, which asks for the team's members on the
administrator's behalf. The rest forward it because the *authorization* needs it: every route that changes
the deployment is admin-gated, and the gate asks the content service who is acting. So an unmount carries a
credential even though what it does is delete a file on this host, and so does the route that rewrites this
deployment's access list — and so do the two reads that reveal who may sign in, which change nothing and
are gated for what they show. The distinction matters when reading the sentence below about relaying: on
the gated routes the token is not passed along as part of the work, it is spent asking whether the work may
happen at all. On the roster relay it is both — spent on the gate's question first, and then forwarded as
the bearer the content service answers the roster to.

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
| Operator access token (cloud) | Browser memory; the daemon holds it for the duration of one request | Minted in the same exchange as the ID token. Never persisted, never written to disk, never logged. Reaches the daemon on `X-Console-Cloud-Token` from every route that asks the content service something on the operator's behalf: the catalog read, which asks what the subscription includes; the artifact install, which asks for entitled bytes; the roster relay, which asks for the team's members; the routes that change the deployment, where the admin gate spends it asking who is acting; and the read of the deployment's own access list, gated the same way. It is sent upstream as an ordinary bearer — the console's own header name never travels outbound |
| Team roster (cloud) | The daemon's memory for one request; the page's memory while the card is open | The team's members by identifier and address, relayed from the content service to an administrator's browser tab. **Never persisted** — not to the mode layer, not to any file, not to a log record, and not to browser storage. A test fails if a byte of the relayed body reaches a log call; the draft the page keeps across a sign-in redirect carries identifiers only, and the roster is fetched again on return |
| Console session id | Daemon memory; browser `sessionStorage` | Random 256-bit value, sent as a header |
| Mode layer | `mode/mode.env`, mode `0644` | Non-secret configuration by design — identity endpoints and the deployment's access list, no credentials |

Four consequences are worth stating plainly:

- **The console holds no credential of its own.** The authenticated calls it makes on the operator's
  behalf — the platform's module query, and the three on the content service's entitled surface: what
  the subscription includes, an entitled artifact's bytes, and the team's roster — carry the operator's
  own tokens, taken from the request that asked for the work and gone when that request ends. There is
  no service identity behind the console to steal, and nothing it could replay once the operator's
  session is over.
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
| `DEPLOYMENT_TEAM_ID` | Accepted; may legitimately be empty or absent. It names the team this deployment belongs to, so the content service can scope what it serves — a person who belongs to two teams must not be served one team's content on the other team's deployment, and the deployment is the only party that knows which team it is. Neither a destination nor a credential, but a value that *leaves* the console again — it rides out as a request header on the entitled calls, beside the operator's own bearer and never without it — so it is held to its own shape rule below. Absent, entitled calls name no team — which the service currently still answers, but only while it is counting how many deployments have not yet been told their team. Once it enforces, an absent value means every entitled call fails |
| `DEPLOYMENT_EXPOSURE` | Recognised and **dropped**. It is the operator's own exposure declaration and must not be taken from a recipe. Two retired names — `COMMERCE_API_BASE_URL` and `DEPLOYMENT_PACKAGES` — are likewise tolerated-and-dropped, so a saved recipe carrying either still applies rather than failing as a foreign variable |
| `NODE_ENV`, `OIDC_REDIRECT_URI`, `MODULE_CONTENT_CACHE_DIR`, `ALLOWED_ORIGINS` | Supplied by the console, never taken from the paste |
| `MODULE_KG_VERSION` | Supplied by the console, never taken from the paste — a recipe that could carry it could pin a deployment to a version of the sender's choosing. Read from a public listing with no credential, and validated as `sha256:` plus 64 hex before it is written |
| Anything else | The apply is refused, naming every offending variable at once |

**The check is on the name set, not the name shape.** That distinction is the control. The mode layer
is applied *after* the base layer and therefore overrides it, so a recipe smuggling
`NODE_ENV=development` plus `ENABLE_NOAUTH=true` would turn authentication off for the whole graph, and
a Node option that preloads a module is arbitrary code in the platform process at boot. None of those
names is in the accepted set — and no plausible shape check would have caught them.

Six further constraints apply to the values:

- **Every required name must be non-empty.** A blank identity value produces the same broken boot a
  missing one does, so a presence check alone would be hollow. The three names marked above as
  legitimately empty or absent are exactly the exceptions, and each is one for its own reason. For the
  knowledge-graph base the empty case is reachable in normal use rather than a sign of a half recipe;
  the signer is an exception because requiring it would reject every recipe issued before the name
  existed — and where it is absent the deployment loses its artifact installs rather than running them
  ungated; the team identifier is an exception for that same historical reason, and where it is absent
  the deployment names no team and its entitled calls are answered as they were before the name existed
  — which is the safe direction rather than the intended one, and a **temporary** one. The content
  service treats an absent team header as a fact to be counted rather than refused only while it
  establishes that every live deployment sends one; when that changes, an absent value means every
  entitled call fails, and a deployment in that state is not degraded but broken. The name is optional so
  that recipes issued earlier still apply, and is meant to become required once every recipe carries it.
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
- **The team identifier is checked for shape because it leaves again.** It is neither a destination nor
  a credential, and that is exactly why the check matters: the value is written into the mode layer and
  then sent as a request header on every entitled call, so the shape rule is what stands between a
  pasted recipe and a second header of the sender's choosing. It must be 1–64 characters of `A-Z`,
  `a-z`, `0-9`, `-` or `_`, every one of which is already a valid header-value character, because a
  header is where the value goes. A character class and a bound, deliberately **not** an exact length:
  pinning the length would tie every console in the field to the issuer's current identifier format, so
  a change to that format would make deployments refuse a legitimate recipe with no way to learn the new
  one. An empty value is dropped rather than written, on the same reasoning as the empty service URL
  above. The shape is re-checked when the value is read, and there the two failures part company — an
  unusable content base reads as no base and the call is not made, while an unusable team reads as no
  team and the call still goes out, because turning a hand-edited mode file into an immediate outage is a
  worse answer than a call that still reaches the service.

  **That argument has a shelf life, and it is worth knowing which part expires.** It rests on an unnamed
  team being *survivable*, which holds only while the content service still answers such a call. Once the
  service requires the header, an unusable team identifier produces the outage this reasoning was meant to
  avoid — later, and with the local file still looking fine. What the degrade still buys at that point is
  a console that starts, logs which value it rejected, and can be corrected in place; what it no longer
  buys is a working entitled call. Read this as an argument about *where the failure surfaces*, not about
  whether there is one.
- **`ALLOWED_ORIGINS` is derived, not pasted.** It is the origin of the deployment's own front-door
  callback, so it stays in step with the redirect URI by construction.

**`DEPLOYMENT_ALLOWLIST` has a second, narrower write path, and it is the only name that does.** One
route rewrites that variable alone on a connected deployment and leaves every other line as it found it
([`CONSOLE.md`](./CONSOLE.md#changing-who-may-sign-in)), so changing who may sign in no longer requires a
disconnect — an act that removes every cloud-provided module and, at the next platform start, the classes
those modules declare and every link those classes are in. It is admin-gated like every other route that
changes the deployment, and it adds two rules the paste path has no way to apply. It refuses a list that
does not admit the subject the caller's own session was minted for: a live cloud session is proof that its
subject passed the deployment's *current* list, because the platform validates that list when it verifies
the ID token the session was minted from, so the session is the one thing the console holds that can answer
"would this new list still admit you". And it refuses an empty list outright, decided on the parsed list
rather than the submitted string — the platform reads empty as *unrestricted* rather than "nobody", and a
shared-pool deployment reachable over the network refuses to start with one at all. The console cannot tell
which of those it would produce, because `DEPLOYMENT_EXPOSURE` is base-layer only and never written here,
so it refuses either way.

**Beyond those two, it refuses exactly what the recipe path refuses — and that ceiling is a design
constraint rather than an omission.** It rejects a control character on the same reasoning, and before
writing it re-runs the present-and-non-empty rule over the whole variable set, so the file it leaves is one
the connect path would have accepted — a checked property rather than an intention, and the difference
between refusing and leaving a deployment that cannot start. It invents no shape rule the connect path lacks, and must not: a value
that connects successfully but this route rejects would leave the operator with only the
disconnect-and-reconnect this route exists to remove, which is the data-losing act. Its one divergence runs
the other way — whitespace-separated entries are accepted and normalised into the comma-joined form the
platform parses, so a list copied from an account that renders its members one per line applies rather than
failing on a separator nobody chose.

**And one limit of the whole arrangement, stated because the paragraphs above could otherwise be read as
claiming more.** This route is strictly safer than the reconfiguration it replaces *for graph data* — it
removes no module, so nothing declares a class that then disappears. It is not safer for access
governance, and in one respect it is looser: the console is not the authority on who belongs to a team. It
writes the list it is given, and the daemon never compares that list against the team's actual
membership. A deployment's admitted set can therefore drift from the roster — an account removed from the
team keeps its sign-in until an administrator removes it here, and an account that was never on the team
can be added to the deployment by anyone who administers it. Both were already true of the recipe path,
which also writes the value unchecked; what changed is that doing it now costs a click instead of a
disconnect, and is correspondingly quieter. What the two reads below add is *visibility* of the drift, in
the administrator's browser and nowhere else: the card lays the admitted list over the roster it fetched
and shows the difference, in both directions, and offers to close one of them. The daemon still holds no
opinion, and the deployment still keeps no record of the comparison.

**Two reads are admin-gated, and they are the one exception to "reads stay open".** Every other read the
console serves is open to any session holder, on the rule that a member who cannot see what their
deployment *has* is worse served than one who cannot change it. `GET /api/cloud/roster` and
`GET /api/cloud/allowlist` are gated for what they *reveal* rather than for what they change: the first is
the team's people by address, the second is the selection among them, and neither is something a member is
owed a view of. They are composed over the session check exactly as the routes that change the deployment
are — asked live of the content service, never cached — and refused with the same statuses, so the
interface branches on them the same way. The gate's shared refusal sentence names both things the role
covers, changing the deployment and seeing who may sign in, because a refusal that described only the
first would misdescribe what a refused read had asked for.

- **The roster is relayed, and it is re-encoded rather than passed through.** The page cannot call the
  content service itself — its entitled tier serves no CORS, deliberately — so the daemon asks with the
  operator's bearer and this deployment's team, over the same transport every other entitled call uses.
  What it answers is `{ members: [{ sub, email }] }`: **exactly two fields**, parsed and re-marshalled, so
  a field the service adds about a person later stops at this boundary rather than reaching the page. A
  member with an empty address is carried as the bare identifier; a member with a blank identifier makes
  the whole document malformed rather than a shorter team. An unrecognised document is *could not fetch*,
  never an empty team, because an empty team reads as everyone having left.
- **The service's refusals are mapped to the operator's remedies, and never to the two statuses that
  would mislead.** A transport error, an unrecognised document, a `5xx` or a `429` from the service is
  `503` — wait and try again. A `401` from the service is `412` — the tab's cloud sign-in has lapsed, so
  sign in again; its own sentence rather than the gate's, because the gate *did* ask with this credential
  and was answered. Any other `4xx` — the service's `403` above all — is `502`: the console has already
  confirmed that this operator administers the team, so a refusal from the service is about the
  deployment's sign-in configuration and not about the person. It is **deliberately not `403`**, which is
  the daemon's *you are not an administrator*, and the gate has just confirmed the opposite. And **never
  `401`**, which the page answers by signing the operator out of their own console.
- **On a deployment that names no team, the reads refuse for themselves.** The admin gate stands aside
  there for the routes that change the deployment, so that they behave exactly as they did before the gate
  existed — the gate's own rollout property ([`CONSOLE.md`](./CONSOLE.md#authentication-posture)). A read
  that inherited that arm would be **ungated on exactly those deployments**: any session holder could read
  who may sign in. So both reads decide the team-less case on their own, in the handler, before anything is read
  and before anything is dialled, with their own `409` sentence about a recipe that predates team
  identifiers. A test calls both handlers bare — no gate, no route table — and expects that refusal
  from each, because a handler that is correct only while wrapped is not correct.
- **Nothing from either body is logged, and that is a test rather than a comment.** The relay logs only a
  transport error on an outage, which names the host and never the body; nothing else in either handler
  logs at all. A test swaps the daemon's logger for a capturing sink at debug level, runs a relay, checks
  that the gate's own audit record *is* in the capture — so a logger swap that silently failed cannot pass
  vacuously — and then that no address, no identifier and not even the fixture's domain appears anywhere
  in it. The access-list read is held to the same standard, because the selection is what this design
  protects even though the identifiers are not addresses. Neither read touches the mode layer or any file.

**And the page side, which is where the addresses go.** The card fetches both lists when it is shown, holds
them in component memory for exactly as long as it is, and derives everything on the page: the ticks are
the admitted identifiers laid over the roster, the departed are the admitted identifiers absent from it,
and the count the overview banner shows is the length of that second list. **Nothing derived is persisted
and nothing derived is sent anywhere.** The one thing the page writes to browser storage is the draft that
survives the sign-in redirect a `412` on the write performs — and that draft is identifiers only, the ticks
or a pasted list, under one `sessionStorage` key, consumed on return and never the roster; the roster is
fetched again and the restored ticks are laid over it, a tick for someone who has since left being dropped.
A component test reads the stored value back after a redirect and looks for an address in it; the browser's
own storage was inspected the same way, through a `412` round trip, and held none. The departed count
lives in the page, is undefined for a member, a reloaded tab without a credential, or a failed fetch, and is
forgotten on sign-out and on disconnect. A `412` on the *read* is offered a sign-in and never acts on it —
a card that redirected on mount would send every reloaded tab to the identity provider unasked — where a
`412` on the *write* still acts, as every gated control does.

Two write-path rules complete it: a **recipe** cannot be applied over an existing cloud configuration
(disconnect first, so reconfiguration is never a silent overwrite — the single-variable write above is the
one exception, and it is a gated route with a subject to check rather than a paste), and the file is
**rewritten, never deleted** — a missing env-file breaks the container runtime's own file reading, which
would break the recovery path itself. Reverting contacts the cloud for one thing only — the admin check
its gate makes — and proceeds without it on a deployment that could never make that check, because a
recovery path may not depend on the configuration it recovers from.

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
