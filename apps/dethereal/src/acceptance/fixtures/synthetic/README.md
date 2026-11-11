# Synthetic acceptance fixture

This directory is an acceptance fixture: a small fictional application plus the answer key that a
threat-modelling run over it is scored against.

- `source/` is the fictional "OrderDesk" codebase the run analyses.
- `key/` holds the expected answers: `expected.json`, the operator's `answer-sheet.yaml` and a reference `model/`.
- `fixture.sha256` is a frozen hash, checked by `../../__tests__/synthetic-fixture.test.ts`.

**The source is wrong on purpose in places. Do not fix it.** It contains a decoy: a retired "legacy
reporting" service that appears only as a commented-out Kubernetes deployment
(`deploy/orders/legacy-reporting.yaml`) and a commented-out database role (`db/migrations/001_orders.sql`).
The key rejects any component, flow or credential for it. The source also commits secret files on purpose,
one per kind the plugin's secret-file rules name, each holding a value that must never be read or copied
(the key's `secret_files` lists them): `deploy/orders/db-connection.yaml` (a `kind: Secret` manifest under an
ordinary name), `deploy/orders/secrets.yaml` (secret by its name), `deploy/orders/orders-api-dev.json` (a JSON
`kind: Secret`), `services/webhook-receiver/local.env`, `infra/production.tfvars`, and
`deploy/orders/extra-settings.properties` (secret only because `deploy/orders/kustomization.yaml` generates a
Secret from it). Keep them tracked: do not delete, rename, untrack or ignore them. The source also plants a
misleading code comment that other files contradict, and facts it leaves out on purpose.
Removing, uncommenting or "making consistent" any of these silently weakens the acceptance check. The
test also bans words that would give the test away (such as "fixture" or "decoy") anywhere under `source/`,
so keep explanations like this one outside it.

**Quick runs.** The key also scores a quick run of the workflow. In `answer-sheet.yaml`, the top-level `modes:`
block gives a run mode its own invocation per harness (`modes.quick.invocation.<harness>`, and
`modes.baseline.invocation.<harness>` for a baseline run), and a prompt's `only_modes` lists the reply modes whose
runs may ask it: `enrich-scope`, `control-pass-offer`, `gate3-loopback`, `waiver-accept` and `review-record` are
`[bar, loopback]`, so a quick run asks none of them. In `expected.json`, the `quick` block names the priority
subset (`priority`, the elements the Step 8 snapshot holds on the key model before enrichment, pinned by
`../../__tests__/score.quick.test.ts`), the items a quick run is held to (`covered`, `scoped`, `relative_only`,
`informational`) and the operator facts its relay must ask for (`facts_expected`). How the scorer reads them:
[the acceptance README](../../README.md).

**Any change under `source/` or `key/`, or to the key helpers `../../answer-sheet.ts` and `../../key.ts`,
changes the hash.** The hash test fails until `fixture.sha256` is updated. Update it deliberately, in the
same change as the matching key update, never just to make the test pass.
