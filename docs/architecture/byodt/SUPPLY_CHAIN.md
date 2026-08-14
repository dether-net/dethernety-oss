# BYODt Deployment — Supply Chain

> How executable modules reach a deployment, what is checked before they are placed where the platform
> will load them, and how one release tag produces an artifact set that cannot drift apart.

At deploy time the console fetches code over the network and installs it where the platform loads it
with `require()`. That is the deployment's sharpest trust boundary, and everything in this document
exists because of it: the channel is constructible rather than API-driven, every artifact is signed,
the signer identity is pinned to one exact release, the archive is unpacked under confinement, and the
installed tree's identity is re-derived rather than believed.

The install step's place in the boot sequence is in [`CONSOLE.md`](./CONSOLE.md#job-2--install-the-code-modules).

---

## The channel

The console fetches release assets over plain HTTPS from constructible download URLs:

```
${CONSOLE_RELEASE_BASE_URL}/releases/download/v${PLATFORM_VERSION}/<asset>
```

`CONSOLE_RELEASE_BASE_URL` defaults to the public repository and exists so a deployment can be pointed
at a mirror it can reach. `PLATFORM_VERSION` alone selects the release; the console never chooses a
version of its own.

**No repository API is used.** The unauthenticated API is rate-limited per source address, while asset
downloads are not — an operator behind a shared address would otherwise see module installation fail
for reasons that have nothing to do with their deployment. Constructible URLs also mean the console
needs no token, no client library, and no knowledge of the hosting provider beyond a base URL.

Assets fetched for a release:

| Asset | Contents |
|---|---|
| `modules.json` | The signed index of the release's module set |
| `modules.json.bundle` | Its signature bundle |
| `<module>-<module-version>.tar.gz` | One packaged module payload |
| `<module>-<module-version>.tar.gz.bundle` | Its signature bundle |
| `byodt-<version>.tar.gz` (+ `.bundle`) | The deployment bundle itself — what an operator downloads to start |

A module's asset filename carries the **module's own** version from its manifest, which moves
independently of the release version. The index is what maps one to the other.

---

## The signed index

`modules.json` names the module set for exactly one release.

```json
{
  "schema": "dethernety.modules/1",
  "tag": "v<version>",
  "commit": "<commit sha>",
  "modules": [
    {
      "name": "dethernety-general",
      "version": "<module version>",
      "asset": "dethernety-general-<module version>.tar.gz",
      "assetDigest": "sha256:<64 hex>",
      "compatibility": { "dtModule": "^0.11.0" }
    }
  ]
}
```

| Field | Checked by the console |
|---|---|
| `schema` | Yes — must equal `dethernety.modules/1`, else the index is rejected |
| `tag` | Yes — must equal the requested `v<PLATFORM_VERSION>` |
| `commit` | No — provenance for a human reading the index |
| `modules[].name` | Yes — must satisfy the module-key charset before it becomes a directory name |
| `modules[].asset` | Yes — implicitly: the named asset must fetch with `200` |
| `modules[].assetDigest` | Yes — recomputed over the downloaded bytes |
| `modules[].compatibility` | No — carried verbatim from the module's manifest; the console does not gate on it |

The `tag` check is an **anti-rollback** control, and it is not redundant with the signature. A signature
binds *bytes*; only `tag` binds which release those bytes belong to. Without it, an index legitimately
signed for an older release could be served at a newer release's URL and would verify.

---

## Verification

Every signed asset is checked with the same policy, implemented in
[`pkg/moduleverify`](../../../pkg/moduleverify/) over a maintained Sigstore implementation.

**What is checked:**

1. The certificate in the bundle **chains to the trusted root's certificate authority**.
2. The signature covers the artifact bytes actually being installed.
3. The entry has a **transparency-log inclusion proof** and at least one observed timestamp.
4. The certificate's subject **exactly equals** the pinned signer identity, and its issuer equals the
   pinned OIDC issuer.

Step 1 is the one that makes the rest mean anything. A bundle carries its own certificate, so a verifier
that reads the identity out of that certificate and then checks the signature against that same
certificate's key proves nothing — a self-signed certificate claiming an allowlisted identity would
pass. Chaining first is what turns the identity match into a statement about who signed.

**The trusted root is embedded in the binary.** Verification therefore needs no network on the boot
path, which matters for a deploy-time check that runs before anything else is up. Rotations are picked
up by updating the embedded copy and shipping a new console image.

**A certificate-transparency SCT check is deliberately not required.** It defends a different property —
detectability of certificate-authority mis-issuance — and adds nothing against the threat this verifier
exists for, because a certificate that does not chain to the trusted authority is already refused
whatever it claims. Requiring the log inclusion proof and pinning the identity is what makes the
signature load-bearing.

### Identity pinning is per release, exactly

The pinned identity is the full workflow reference for **this tag**:

```
https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v<PLATFORM_VERSION>
```

with issuer `https://token.actions.githubusercontent.com`. It is matched exactly — it is not a pattern.

That is the whole point. Asset filenames are stable across releases, so a pattern over a family of tags
would happily accept one release's asset served at another release's URL: a downgrade delivered without
forging anything. Pinning the exact tag makes the identity itself carry the release, so an older
release's asset fails verification rather than being installed.

The pin is derived from `PLATFORM_VERSION`, which the operator sets and the console never overrides —
so what the operator pinned is what the signature must have been issued for.

### Transport hardening

Trust rests on the signature and the digests, not on the transport. The transport rules exist to narrow
what a deploy-time fetch can be pointed at.

| Rule | Value |
|---|---|
| Redirects followed | Bounded — release downloads legitimately redirect to a content-delivery host, so a few hops are allowed and the chain is then refused |
| Redirect scheme | `https` only — no downgrade, and no plaintext metadata endpoint |
| Redirect target | Refused if the host is an IP literal in a loopback, private, link-local, or unspecified range |
| Request timeout | 60 s |
| Size cap, index | 4 MiB |
| Size cap, signature bundle | 1 MiB |
| Size cap, module payload | 64 MiB |

Caps are enforced by reading one byte past the limit, so a body exactly at the cap is accepted and one
byte over is refused. A DNS name is not resolved to filter its addresses — the `https` requirement plus
signature and digest checks are the guard there, and resolving names to compare addresses is beyond what
this fetch needs.

A non-`200` response is distinguished from a transport error: a `404` means "no such asset at this
version" (a publication or configuration event) while a connection failure means "unreachable" (a
network event). The console reports them as different statuses because their remedies differ.

---

## Two digests, two questions

| Digest | Scope | Answers |
|---|---|---|
| `assetDigest` | The downloaded `.tar.gz` bytes | "Did I receive the archive the index names?" |
| `payloadDigest` | The unpacked payload tree | "Is what is on disk the same payload this archive would place?" |

They are deliberately never conflated. The archive is not reproducible — it is built without sorted
entries, normalised timestamps or ownership, so two builds of byte-identical content produce different
archive bytes. An archive digest would therefore differ on every rebuild and defeat the "unchanged,
skip it" case entirely. `payloadDigest` is content-derived: a length-framed SHA-256 over the payload's
regular files in UTF-8 byte order, with the stamp file itself excluded.

Every packaged module carries its own `payloadDigest` in a stamp file (`.dethernety-module.json`) at
its payload root. The console does not simply read it:

1. It **recomputes** the digest over the extracted tree.
2. It requires the incoming stamp to agree with that recomputation. The stamp is signed along with the
   asset, so a disagreement means a stamp that does not describe its own payload.
3. Only then does it compare against the stamp of the copy already installed.

The re-derivation is a Go port of the packaging script's reference implementation, and the two encoding
choices that would silently diverge — byte-order sorting rather than UTF-16, and decimal-ASCII length
framing rather than fixed-width binary — are pinned identically on both sides.

---

## Extraction limits

The archive is unpacked into a transient dot-directory under the modules mount, which is removed at the
end of every run. Confinement is enforced in [`pkg/extract`](../../../pkg/extract/):

| Limit | Behaviour |
|---|---|
| Path escape | Rejected: absolute paths, any `..` component, backslashes, `NUL`, empty names — and a final destination-prefix assertion behind all of them |
| Symlinks and hardlinks | Rejected outright. A link's meaning depends on where it is unpacked, which is exactly what confinement removes |
| Other entry types | Rejected — only regular files and directories are accepted |
| Entry count | 20 000 |
| Total decompressed size | 256 MiB, measured from bytes actually read rather than trusted from the header |
| Modes | Directories `0755`, files `0644` — archive modes are not applied |

The module key that names the destination is validated separately, against a strict charset. Together
those two keep every write inside `<modules>/<validated-key>/`.

The expected layout is asserted after extraction: the archive must contain `dethernety/<name>/` as its
payload root, or the module is failed rather than partially installed.

---

## The replacement rule

**Replace only when the payload differs.** If the installed copy's stamp already records the digest just
computed, the module is `skipped`. A missing or unreadable on-disk stamp means replace — the failure
direction is an extra reinstall, never a silent skip.

**Replacement leaves no window where the module is absent:**

```
existing copy ──rename──▶ <temp>/<name>.old        (only if one exists)
new payload   ──rename──▶ <modules>/<name>
   on failure: <temp>/<name>.old ──rename──▶ <modules>/<name>     (prior good copy restored)
   on success: the temp tree — including the old copy — is removed with the run
```

Both steps are renames within the same mount, so neither is a copy that can be interrupted half-written.
A stale backup left by an earlier crash is cleared before the swap, so a previous run's remnant cannot
be restored over a good copy.

Per-module failures are independent: one module failing does not stop the others, and the run's overall
status distinguishes "some failed" from "all failed" from "a signature did not verify". Those classes
and how the console presents them are in [`CONSOLE.md`](./CONSOLE.md#job-2--install-the-code-modules).

---

## One tag, one coherent artifact set

A release is a set of artifacts that must agree with each other: the platform image, the console image,
the module payloads and their index, and the deployment bundle. They are cut from one tag, in the same
runs, with agreement asserted rather than assumed.

The bundle carries that agreement forward. Its manifest names one version, `PLATFORM_VERSION`, and both
Dethernety images are selected from it — so a deployment's manifest cannot name a console version that
differs from the platform it ships with, and an operator moving to a new release moves the whole set
with one edit.

```
                    git tag v<X.Y.Z>
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
  release workflow                        image workflow
        │                                       │
  ┌─────┴─────┐                          ┌──────┴──────┐
  │  modules  │  builds payloads         │    image    │  platform image
  │           │  no id-token             │             │  ┌ console-assets  (no id-token)
  └─────┬─────┘                          │   console   │  └ console         (buildx + cosign)
        ▼                                └──────┬──────┘
  ┌───────────┐                                 ▼
  │  publish  │  signs + indexes         ghcr.io/…/dethernety:<X.Y.Z>
  │           │  no workspace code       ghcr.io/…/byodt-console:<X.Y.Z>
  └─────┬─────┘
        ▼
  release assets: payloads + bundles, modules.json + bundle, byodt-<X.Y.Z>.tar.gz + bundle
```

### The signing split

In both workflows the job that executes third-party code and the job that holds the signing identity
are different jobs.

| Job | Permissions | Runs |
|---|---|---|
| `modules` | `contents: read` | The workspace toolchain — package-manager lifecycle scripts, the build orchestrator, compilers |
| `publish` | `contents: write`, `id-token: write` | Signing, indexing, and release publication. No workspace code |
| `console-assets` | `contents: read` | The console SPA's install and build, and the asset copy |
| `console` | `packages: write`, `id-token: write` | Image build and signing. The only build-time code is a pure-Go compile inside the builder — dependencies are compiled, never executed |

A malicious lifecycle script in a dependency therefore cannot mint a signing certificate under this
project's identity, because the job that would run it holds no token to exchange. Artifacts cross the
boundary as uploaded archives, with digests re-checked on arrival.

### What the release asserts

| Assertion | Prevents |
|---|---|
| The tag matches a release-version shape | A caller-supplied ref reaching a filename, a JSON document, and a certificate subject unconstrained |
| The tag equals the workspace's declared version | An image labelled one version shipping beside a release named another |
| `.env.example`'s `PLATFORM_VERSION` equals the tag | Shipping a bundle pinned to the previous platform |
| `.env.example` does not *pin* `CONSOLE_IMAGE` to a different version | A bundle whose console and platform disagree. The compose file derives the console image from `PLATFORM_VERSION`, so the two agree by construction; this guards the one remaining way to break that — a shipped pin. A commented-out override is ignored |
| Each module manifest's name matches its directory, and the payload count is exactly the expected number | A module added or dropped without announcing itself |
| Each asset verifies against the **exact** identity | A signature that is not this release's |
| A deliberately wrong identity does **not** verify | A pin that is decorative rather than constraining |
| A modified payload does **not** verify against its bundle | Signing one tree and uploading another, or a stale artifact on a re-run |
| Every bundle is the current Sigstore bundle format | Publishing bundles the consumer's verifier cannot parse |

The index is built from each tarball's *own* manifest, so index and asset cannot disagree by
construction, and untrusted JSON is passed to the tool as an argument rather than concatenated into a
program.

The release is created as a **draft** and published only after every asset is uploaded. Asset upload
follows release creation, so there is a window in which the release exists with none of them — and a
consumer that reads "release exists" as "assets present" would fetch an incomplete set. A draft is
invisible to the anonymous API, so a failed run reads as "no release at this version" rather than a
half-populated one.

### The bundle tarball

`byodt-<version>.tar.gz` is produced with `git archive` from the tagged commit's `deploy/compose`
directory, under a `byodt-<version>/` prefix. Taking only tracked files at the tag is what keeps a
build machine's runtime directories — data, certificates, backups, the generated secrets file — out of
a published artifact. It is signed with the same identity as every other asset.

### Images

Both images are built for `linux/amd64` and `linux/arm64`, pushed, and **signed by digest rather than
by tag** — a tag can be repointed, a digest cannot — with build provenance attested to the registry.
The moving `latest` tag exists, but a deployment pins an exact version: a bundle that referenced
`latest` would silently change the platform under a running deployment, which is the opposite of the
upgrade contract.

### The loop closes at deploy time

The console image carries its own stamped version and compares it against `PLATFORM_VERSION` before it
does anything else. A console image asked to serve a version it was not built for aborts the `up` with
that reason, rather than installing one release's modules with another release's logic.

By default that gate never fires, because there is nothing to disagree: the compose file derives the
console image tag from `PLATFORM_VERSION`, so moving one moves the other. The gate exists for the case
that remains — a deliberate `CONSOLE_IMAGE` override whose tag does not match — where an operator has
repointed the console at a mirror or a version by hand.

---

## Verifying by hand

Every published asset can be checked independently of the console, with the same identity the console
pins. Substitute the release version and the module's own version:

```sh
cosign verify-blob dethernety-general-<module-version>.tar.gz \
  --bundle dethernety-general-<module-version>.tar.gz.bundle \
  --certificate-identity 'https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v<X.Y.Z>' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same command with `modules.json` / `modules.json.bundle` checks the index, and with
`byodt-<X.Y.Z>.tar.gz` checks the deployment bundle before extracting it. Images are verified with
`cosign verify` against the same issuer.

---

## Related documentation

| Document | Description |
|---|---|
| [`CONSOLE.md`](./CONSOLE.md) | Where install sits in the boot sequence, and how failures are classified and surfaced |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The modules mount, and why the platform mounts it read-only |
| [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) | Module trust in the wider deployment posture |
| [Module Package Design](../modules/MODULE_PACKAGE_DESIGN.md) | The packaged-module layout the release assets carry |
| [Module System](../modules/README.md) | How the platform loads and registers what was placed |
