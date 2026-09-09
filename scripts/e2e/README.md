# End-to-end harnesses

Tests that start real processes and talk to them over real sockets. They live here rather than beside a
package's unit tests because each one spans more than one package — and in one case more than one
language and a container.

They are **not** run by CI. Nothing in either workflow starts a built image or a compose service, and
adding that is a larger question than any single harness. Run them locally, and read the transcript.

## `team-header.sh` — the deployment's team identifier

```sh
bash scripts/e2e/team-header.sh                        # all three links
bash scripts/e2e/team-header.sh --skip-container-link  # opts out of link 2, and FAILS saying so
```

A deployment can be told which team it belongs to, so the content service can scope what it serves.
Without it, a person who belongs to two teams is served the union of both teams' content on either team's
deployment — and once the content service requires the header, a deployment that names no team has every
entitled call refused instead. The value travels a long way, and the unit tests prove each hop
separately:

| Link | What it starts | What it proves |
|---|---|---|
| 1 | the console binary, built from this tree | a pasted recipe carrying `DEPLOYMENT_TEAM_ID` is accepted, reaches `mode.env` on disk, and the console's own entitled call carries `X-Deployment-Team` while its catalog calls carry nothing |
| 2 | the **stock** platform image, via `compose run --no-deps` | `mode.env`, read as compose's `env_file`, becomes a variable in the platform container's environment |
| 3 | a real node process running the **built** module client | that variable becomes a header on entitled calls, and on no others |

**Link 2 is the load-bearing one.** The module client reads a `DEPLOYMENT_*` name, which only works
because the console writes it into a file the platform reads as `env_file`. Every other part of the
design rests on that, and reading `compose.yaml` is not the same as watching it happen. It runs against
the **stock** image on purpose: it is testing compose's plumbing, not our code, and rebuilding would
confound the two.

### The assertion is a biconditional

The rule is *the team header is sent if and only if a bearer token is sent*, and that is asserted over
**every** request the stub recorded, not over a chosen pair. A rule stated as a list of paths stops
holding the moment someone adds a path; stated this way, a surface nobody enumerated is still covered.

The stub's log is both the assertion surface and the transcript, deliberately the same thing:

```
GET /v1/catalog/packages auth=no team=-
GET /v1/entitlements auth=yes team=9Xk2QpLm4RtZaB7cWvNfEg
```

### What it does not prove

It runs against a recording stub, so it proves the **transport** — the variable becomes a header, on
entitled calls and only those. It does not prove the **feature**: the stub answers `200` whatever it is
sent, so nothing here shows a real service scoping on the value, and nothing here shows what happens to a
deployment that names no team. Report it as what it is.

It also covers the entitled/public pair reached through `GET /api/packages`. The console's other two
entitled calls are artifact staging, which needs signer configuration and signature verification; that
those thread the value is covered by unit tests instead.

### Prerequisites

`node`, `pnpm` and `go`, plus a container engine for link 2. The console embeds a built SPA, so
`build-assets.sh` runs first and needs a network for its `--frozen-lockfile` install.

**It never touches `deploy/compose/`.** That bundle is the operator's, holds real state, and is
gitignored; the harness generates a throwaway one in a temp directory and removes it on exit.

### Files

| | |
|---|---|
| `content-stub.mjs` | the recording stand-in for the content service — stdlib only, so it needs no install step |
| `dt-module-probe.cjs` | drives the built module client the way the platform does: every value from the environment, no assertions of its own |
| `team-header.sh` | the orchestrator, and the only thing that asserts |
