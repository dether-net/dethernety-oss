# Rego parity gate

Differentially evaluates every policy in the module corpus through **both** the
committed Regorus WASM blob (`@dethernety/regorus-wasm`) and the reference `opa`
binary, and fails if they disagree.

This is the evidence that lets the platform evaluate Rego in-process instead of
against an OPA server. If it is false-green, wrong security findings ship — so the
gate is built so that every way it could pass while testing nothing is a hard failure.

## Running it

Run from the **repo root**; roots resolve against the working directory.

```bash
REGO_PARITY_ROOTS=modules node packages/dt-module/test/rego-parity/run.mjs
```

Requires `opa` on `PATH` at the exact pinned version (default `1.18.2`). Its absence
is a **hard failure, never a skip**: without the oracle the gate proves nothing.

There is deliberately **no `package.json` script**. `pnpm --filter … <script>` changes
the working directory to the package, which would silently break root resolution.

| Variable | |
|---|---|
| `REGO_PARITY_ROOTS` | **required**, comma-separated module roots. No default — a mis-wired job must error, not discover zero policies and report "0 diffs". |
| `REGO_PARITY_ENGINE` | `raw` (default) or `wrapper` — see below |
| `REGO_PARITY_NONGATING_ROOTS` | path prefixes whose divergences are reported but never fail the build |
| `REGO_PARITY_OPA_VERSION` | exact version to require (default `1.18.2`) |
| `REGO_PARITY_MIN_MODERN_POLICIES` / `_CASES` | positive floors — zero cases and zero diffs are otherwise indistinguishable. A non-integer value is a hard failure, never "no constraint". |
| `REGO_PARITY_MIN_NONGATING_POLICIES` | floor for the non-gating cohort |
| `REGO_PARITY_BUILTIN_SITES_FILE` | frozen census manifest; **absent ⇒ the census must be empty** |
| `REGO_PARITY_COLLISIONS_FILE` | frozen census manifest; **absent ⇒ the census must be empty** |
| `REGO_PARITY_REPORT` | write a machine-readable JSON report here |
| `REGO_PARITY_CONCURRENCY` | `opa` spawn pool size (default `min(8, cpus)`) |

## Engine modes

Both modes reach the same WASM blob; they differ in what they can observe.

| `REGO_PARITY_ENGINE` | Drives | Proves |
|---|---|---|
| `raw` (default) | the binding directly, one `Engine` per policy | shape fidelity — the only mode that can report `UNDEFINED`, so the only one that exercises the `UNDEFINED`-vs-`VALUE([])` distinction |
| `wrapper` | the compiled `dist/rego-engine.js` that production calls | the production contract, end to end over the corpus |

`wrapper` mode tests strictly *less* than `raw` mode, and it tests the thing that actually
ships — so run both. `RegoEngine.evaluate` maps an undefined rule to `[]` by contract, so
it can never emit `UNDEFINED`; a non-zero `raw-shape` count is expected there and is never
gated. Run `raw` on any corpus; `wrapper` needs a build, so it runs in the monorepo's own pipeline rather than here.

Two guards keep `wrapper` mode honest: it refuses to run if `dist/rego-engine.js` is
missing or older than `src/rego-engine.ts` (a gate that silently evaluates a stale build
reports green for code that no longer exists), and it refuses to run if `RegoEngine`'s
`POLICY_LENGTH_CONFIG` has drifted from the harness's — two sources of truth for the lexer
limits would let the gate parse policies production rejects, or vice versa.

## Cohorts

| Cohort | Inputs | Gate |
|---|---|---|
| **corpus** | every case in every `tests.json` | gating roots: 0 divergences |
| **empty-input** | `{}` against every policy | gating roots: 0 divergences |
| **census** (static, no `opa`) | `count(input.…)` / `regex.match(…, input.…)` sites; cross-module package collisions | set equality with the manifest |

The **empty-input cohort** is what covers policies that ship without a `tests.json` —
they would otherwise never be differentially evaluated at all.

The **census** exists because two defect classes are invisible to input-driven testing:

- On a **wrong-typed** argument, `count()`/`regex.match()` propagate undefined under
  OPA but *throw* under Regorus, halting the whole set rule. Authored test vectors
  supply well-typed values, so no corpus cohort can see it. The site set is frozen
  instead: a new site fails the gate and must be guarded (`is_array` / `object.get`).
- Two modules declaring the same Rego **package** are merged by OPA into one `data`
  document, so an element receives the *union* of both classes' findings. Per-module
  engines do not merge: the in-process engine holds one Regorus `Engine` per class
  policy, so a package never has a second contributor. That isolation is a
  correctness requirement, not a memory optimisation — and a new collision fails
  the gate.

## Comparison

Each `(policy, rule, input)` is classified three ways per engine and compared:

| opa \ regorus | VALUE | UNDEFINED | THROW |
|---|---|---|---|
| **VALUE** | deep-compare | diff | **diff** ← aggregate under-fire |
| **UNDEFINED** | diff | agree | **diff** |
| **ERROR** | diff | diff | agree |

A Regorus throw is **always** an error and never becomes `[]`.

Canonicalisation is deliberately minimal: object keys are sorted recursively, and only
the top-level findings array — a genuinely unordered Rego set — is sorted, which makes
the comparison a multiset keyed by the whole finding rather than by `name`. Nested
array order (`exploited_by`) is *not* sorted and strings are *not* unicode-normalised,
because divergence there would be real. Known limitation: JavaScript has a single
number type, so `5` and `5.0` are indistinguishable after `JSON.parse`.

Rule paths are evaluated **separately, never batched into one object query** — if one
rule is absent, the whole object expression is undefined and OPA returns an empty
result, which reads as a false mismatch on every policy that defines only one rule.

## Files

| | |
|---|---|
| `harness.mjs` | discovery, canonicalisation, outcome classification, census, the two engine adapters. No `.test.` infix, so vitest ignores it. |
| `run.mjs` | the gate. Needs `opa`. Not run by `pnpm test`. |
| `contract.test.mjs` | vitest suite over the harness's pure logic and the fail-loud fixtures. Needs no `opa`, no corpus. |
