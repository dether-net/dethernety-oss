# BYODt Deployment — Architecture

> The self-hosted Dethernety deployment: what it is, what runs, and where the design is documented.

A **BYODt deployment** is Dethernety running as a self-contained container stack on a machine you
control — a graph database, an embedding server, the platform (API + SPA), an operator console, and a
front-door proxy, started by one control script. It needs no source checkout and no build toolchain:
every image is published and pinned, and the graph lives on your own disk. With its default
configuration the deployment reaches the network only to pull its images, the embedding model, and the
signed module payloads for the release it is pinned to.

This is the supported way to run Dethernety on your own infrastructure. The alternative paths — a
development checkout, or a hand-assembled production install against your own database and identity
provider — are covered by the [Configuration Guide](../../CONFIGURATION_GUIDE.md).

**What this set covers:** the deployment topology and its startup contract, the operator console's
design, how modules reach a deployment and how their provenance is checked, and the trust boundaries
and hardening posture. It is written for the reader who has to operate, audit, or extend the
deployment. Task-oriented instructions live in the [BYODt deployment
guide](../../user/byodt/README.md).

---

## Documentation map

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Deployment topology — every service, startup ordering and its conditions, ports and what is published, storage and volumes, and the request path through the front door. Start here. |
| [`CONSOLE.md`](./CONSOLE.md) | The operator console — one binary with an `init` one-shot and a `daemon`, the state file, the mode layer, content mounts, entitled-artifact installs, its authentication posture, and why it has no process control. |
| [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md) | How modules reach a deployment — the signed release channel, the signed index, signature verification and identity pinning on both the release and entitled-artifact paths, extraction limits, the replacement rule, and how one tag produces a coherent artifact set. |
| [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) | Trust boundaries and posture — the authentication postures, what the front door exposes, secret handling, the mode-layer variable allowlist, and the hardening rules that follow from them. |

---

## The shape of a deployment

Six services on one private bridge network, of which exactly one publishes a host port.

```
                     host
  ┌───────────────────────────────────────────────┐
  │  ${FRONT_DOOR_BIND}:${FRONT_DOOR_PORT}        │   default 127.0.0.1:3000
  └───────────────────┬───────────────────────────┘
                      │
  ── stack network ───┼───────────────────────────────────────────────
                      ▼
                   ┌───────┐        /console/     ┌─────────┐
                   │ proxy │ ───────────────────▶ │ console │
                   └───┬───┘                      └─────────┘
                       │  everything else
                       ▼
                  ┌──────────┐        ┌────┐
                  │ platform │ ─────▶ │ db │
                  └────┬─────┘        └────┘
                       │              ┌────────┐
                       └────────────▶ │ ollama │
                                      └────────┘

            console-init ── one-shot, runs and exits before the platform starts
```

| Service | Role | Published |
|---|---|---|
| `db` | Graph database, reached over Bolt | no |
| `ollama` | Embedding server used for class matching | no |
| `console-init` | One-shot: places the schema, installs the code modules, ingests the reference corpus, then exits | no |
| `platform` | API, SPA, and the runtime `/config` document | no |
| `console` | Operator console daemon | no — served through the proxy at `/console/` |
| `proxy` | The single entry point; terminates TLS for the whole stack | **yes** |

The database and the embedding server never leave the stack network. The console shares the front
door's origin rather than taking a port of its own, which keeps the deployment to one endpoint and
puts both sign-in callbacks on the same host. Details in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## When this deployment is the right choice

**It fits when:**

- You want the whole platform on one machine you control, with your models on your own disk.
- You want the published, signed artifact set rather than a build you assemble yourself.
- You are running a single instance for one team, behind your own network boundary.
- You want the reference data (MITRE ATT&CK and D3FEND) and the shipped modules installed for you,
  with their provenance checked at install time.

**It does not fit when:**

- You need horizontal scale, high availability, or an orchestrated multi-node deployment. The stack is
  single-node by construction: one database container, one platform container, host-local storage.
- You already operate a managed graph database, or need to point the platform at one. The bundle
  starts its own and wires the platform to it.
- You need multi-tenant separation inside one deployment. A deployment serves one team; access
  control is at its edge, not between users inside it.

The stack runs a graph database and an embedding server alongside the platform, so it wants several
gigabytes of memory and disk. The first run additionally pulls the embedding model and ingests the
reference corpus, and is therefore markedly slower than subsequent starts.

---

## Where the source lives

| Path | What it is |
|---|---|
| [`deploy/compose/`](../../../deploy/compose/) | The deployment bundle: `compose.yaml`, the `byodt` control script, `.env.example` (the release manifest), the proxy config and its TLS entrypoint, `NOTICE` |
| [`apps/byodt-console/`](../../../apps/byodt-console/) | The console: one Go binary (`internal/initcmd`, `internal/daemoncmd`) plus the Vue SPA under `ui/`, embedded into the image |
| [`pkg/moduleverify/`](../../../pkg/moduleverify/) | Sigstore bundle verification against a pinned signer identity |
| [`pkg/extract/`](../../../pkg/extract/) | Confined archive extraction with the limits the trust boundary requires |
| [`pkg/payloaddigest/`](../../../pkg/payloaddigest/) | Re-derivation of a packaged module's payload identity from its installed tree |
| [`pkg/cypher/`](../../../pkg/cypher/) | The statement splitter used to execute the reference corpus |

Third-party image references (database, embedding server, proxy) and their licenses are listed in the
bundle's [`NOTICE`](../../../deploy/compose/NOTICE). The bundle references those images; your
container runtime pulls each from its publisher.

---

## Related documentation

| Document | Description |
|---|---|
| [BYODt deployment guide](../../user/byodt/README.md) | Task-oriented operator guide: install, run, back up, upgrade |
| [Configuration Guide](../../CONFIGURATION_GUIDE.md) | Every platform environment variable, including the OIDC and no-auth rules the mode layer drives |
| [Platform Security Model](../../SECURITY_MODEL.md) | Platform-wide security architecture — the layer this deployment's own model builds on |
| [Platform Architecture](../README.md) | The graph-native platform overview |
| [Module System](../modules/README.md) | How modules load, register, and route through the platform |
| [Module Package Design](../modules/MODULE_PACKAGE_DESIGN.md) | The packaged-module layout the release assets carry |
| [Glossary](../../GLOSSARY.md) | Platform-wide terminology |
