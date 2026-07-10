# @dethernety/regorus-wasm

Vendored WebAssembly build of [Regorus](https://github.com/microsoft/regorus) — Microsoft's
Rego (OPA policy language) interpreter written in Rust — used for **in-process** policy
evaluation by `@dethernety/dt-module`.

Regorus publishes no npm package, so the binding is built once and committed here.
**This package's contents *are* the vendored artifact.**

## Why this exists

Module policy evaluation previously required an external OPA server. Installing policies at
boot was `O(N²)` — OPA recompiles its entire loaded module set on every policy write — which
saturated a CPU core at a few hundred policies. Evaluating in-process removes the service,
the boot-time upload, and the per-evaluation network round-trip.

## Provenance

| | |
|---|---|
| Upstream | https://github.com/microsoft/regorus |
| Pinned commit | `f0acc64195ac3cc92f33c1dd107380400c3d2a8c` |
| Regorus version | `0.10.1` |
| Cargo features | `--no-default-features --features regorus/std,regorus/regex` |
| Build command | `wasm-pack build --release --target nodejs` |
| rustc | `1.96.1 (31fca3adb 2026-06-26)` |
| wasm-pack | `0.15.0` |
| wasm-opt | `version 117` (bundled by wasm-pack) |
| `regorusjs_bg.wasm` | `1,970,920` bytes |
| sha256 | `1cb927dce0483f9bccf76af46d4c8250f7b02dbdeaf20dc46a9334d0966e7a6a` |

Regenerate with `pnpm build:wasm` (see `scripts/build-wasm.sh`).

> **Rebuilds are not bit-reproducible.** `wasm-pack`/`wasm-opt` output varies across
> toolchain versions. `SHA256SUMS` pins the integrity of the **shipped** artifact; it does
> not assert that a rebuild is byte-identical. CI verifies and tests the *committed* blob —
> the tested artifact is the shipped artifact.
>
> `SHA256SUMS` covers only the `.wasm` blob. The generated JS glue (`regorusjs.js`) is the
> JS↔WASM marshalling boundary and is **review-gated, not hash-gated**: it is readable
> text, so any change to it must be scrutinised in code review like ordinary source.

## Trimmed feature set

Upstream's wasm binding enables `http`, `net`, `jsonschema`, `yaml`, `uuid`, `time`,
`opa-runtime`, `ast`, `coverage` and `cache` by default. We build with **only `std` + `regex`**:

- **67% smaller** — 5.62 MB → 1.88 MB.
- **`http.send` and the `net` builtins are physically absent from the evaluator.** A policy
  cannot make a network call at evaluation time. For a system that loads third-party policy
  modules, that is a meaningful hardening property, not just a size win.
- `regex` is retained because some policies use `regex.match`.

The package-time policy lint rejects any policy referencing an unsupported builtin, so a
trimmed build cannot be silently outgrown. Adding a builtin means rebuilding this package
and re-running the parity conformance suite.

## Usage

```ts
import { Engine } from '@dethernety/regorus-wasm';

const engine = new Engine();

// All three fields are required (they are NonZeroU32/NonZeroUsize upstream) and the
// keys are camelCase. Raising maxCol above the 1024 default lets first-party policies
// carry long single-line string literals.
engine.setPolicyLengthConfig({ maxCol: 8192, maxFileBytes: 4 * 1024 * 1024, maxLines: 100_000 });

engine.addPolicy('policy.rego', regoSource); // returns the package path, e.g. "data.foo.bar"
engine.setInputJson(JSON.stringify(attributes));

const { result } = JSON.parse(engine.evalQuery('data.foo.bar.exposures'));
const value = result?.[0]?.expressions?.[0]?.value ?? [];
```

### Two behaviours that callers must respect

1. **Use `evalQuery`, never `evalRule`.** `evalRule` on a *non-existent* rule **throws**
   (`not a valid rule path`). Control policies define only `countermeasures`, so querying
   them for `exposures` would throw on every one. `evalQuery` tolerates undefined rule
   references and yields an empty `result`.

2. **Errors throw; do not map them to `[]`.** Every `Engine` method returns
   `Result<_, JsValue>` upstream, which surfaces as a thrown JS exception. An engine error
   (parse failure, builtin type error, unsupported builtin) is **not** "no findings" — when
   one clause of a multi-clause rule raises a type error, Regorus **halts the whole rule**,
   where OPA would emit the surviving clauses. Swallowing that into `[]` would silently zero
   a component's entire exposure set. Fail loud.

Loading is synchronous: the CommonJS glue does `fs.readFileSync` + `new WebAssembly.Module`
at `require` time. This is what allows `evaluate()` to be synchronous and atomic.

## Portability

`regorusjs_bg.wasm` is architecture- and libc-neutral — portable WebAssembly bytecode run by
V8. There is no native addon, no `dlopen`, no C ABI. The same committed blob runs on
`linux/amd64` and `linux/arm64`, on glibc and on musl (`node:26-alpine`).

## Licensing

Regorus is `MIT AND Apache-2.0 AND BSD-3-Clause` — see [`LICENSE`](./LICENSE), carried
verbatim from upstream (which ships no `NOTICE` file).

`regorusjs_bg.wasm` statically links 57 Rust crates. Their licences are reproduced in full in
[`THIRD_PARTY_LICENSES.txt`](./THIRD_PARTY_LICENSES.txt), as required for binary
redistribution (MIT, BSD-3-Clause) and notice propagation (Apache-2.0). That list is derived
from `cargo tree` for the exact feature set above and is deliberately over-inclusive: it also
covers build-time proc-macro crates that are not linked into the blob.

## Do not

- **Do not enable `allowJs` in a consumer's tsconfig** to make `tsc` copy this package's glue.
  Import it by its package name; `tsc` reads only `regorusjs.d.ts`.
- **Do not remove `main` / `types` from `package.json`.** Consumers resolve under TypeScript's
  node10 resolution, which ignores `exports`.
- **Do not commit a rebuilt blob without refreshing `SHA256SUMS`** — the `build` script fails.
- **Do not remove `*.wasm binary` from `.gitattributes`.** Text-mode normalisation silently
  corrupts the blob, and it only fails at runtime, inside the container.
