#!/usr/bin/env bash
#
# Regenerate the vendored Regorus WASM artifact.
#
# This is NOT run as part of the normal build — the artifact is committed.
# Run it only to bump Regorus or change the cargo feature set, then commit
# the refreshed artifact together with SHA256SUMS and README.md.
#
# Requires: rustup (rustc >= 1.86), the wasm32-unknown-unknown target, wasm-pack.
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack --locked
#
# NOTE: wasm-pack/wasm-opt output is NOT bit-reproducible across toolchain
# versions. The committed SHA256SUMS pins the *shipped* artifact's integrity;
# it does not assert that a rebuild reproduces byte-identical output. CI
# verifies (and tests) the committed blob, not a rebuild.
set -euo pipefail

# --- pinned upstream -------------------------------------------------------
REGORUS_REPO="https://github.com/microsoft/regorus"
REGORUS_SHA="f0acc64195ac3cc92f33c1dd107380400c3d2a8c"   # regorus v0.10.1

# Trimmed feature set. We deliberately drop upstream's defaults (http, net,
# jsonschema, yaml, uuid, time, opa-runtime, ast, coverage, cache) and keep
# only `std` + `regex`:
#   * 67% smaller blob (5.62 MB -> 1.88 MB)
#   * `http.send` and the `net` builtins are physically ABSENT from the
#     evaluator, so a policy cannot make a network call at evaluation time.
# The package-time policy lint rejects any policy referencing an unsupported
# builtin, so a trimmed build cannot be silently outgrown.
CARGO_FEATURES="regorus/std,regorus/regex"

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> cloning $REGORUS_REPO @ $REGORUS_SHA"
git clone --quiet "$REGORUS_REPO" "$WORK/regorus"
git -C "$WORK/regorus" checkout --quiet "$REGORUS_SHA"

echo "==> wasm-pack build (--target nodejs, --no-default-features --features $CARGO_FEATURES)"
# --target nodejs emits CommonJS glue that loads the .wasm SYNCHRONOUSLY
# (fs.readFileSync + new WebAssembly.Module). RegoEngine.evaluate() depends on
# that: it must be synchronous and atomic. Do not switch to web/bundler.
( cd "$WORK/regorus/bindings/wasm" \
  && wasm-pack build --release --target nodejs --out-dir "$WORK/out" \
       -- --no-default-features --features "$CARGO_FEATURES" )

echo "==> vendoring artifacts into $PKG_DIR"
# wasm-pack emits a .gitignore containing '*' and its own package.json/README.
# Copy ONLY the artifacts; we author the manifest, README and licence files.
for f in regorusjs.js regorusjs_bg.wasm regorusjs.d.ts regorusjs_bg.wasm.d.ts; do
  cp "$WORK/out/$f" "$PKG_DIR/$f"
done
cp "$WORK/regorus/LICENSE" "$PKG_DIR/LICENSE"

echo "==> refreshing SHA256SUMS"
( cd "$PKG_DIR" && shasum -a 256 regorusjs_bg.wasm > SHA256SUMS )

echo
echo "Done. Vendored artifact:"
( cd "$PKG_DIR" && cat SHA256SUMS && echo "size: $(wc -c < regorusjs_bg.wasm) bytes" )
echo
echo "Next: regenerate THIRD_PARTY_LICENSES.txt if the feature set changed, and"
echo "update the provenance table in README.md (SHA, rustc, wasm-pack, wasm-opt, size)."
