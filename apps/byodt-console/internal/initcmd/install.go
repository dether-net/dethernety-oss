package initcmd

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/dether-net/dethernety-oss/pkg/extract"
	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// indexSchema is the schema string the signed modules.json declares.
const indexSchema = "dethernety.modules/1"

// tmpDirName is the transient extraction area under the modules directory. It is a
// dot-directory so the loader (which looks for *Module.js inside each subdirectory) finds
// nothing to load in it, and it is removed after every run.
const tmpDirName = ".byodt-console-tmp"

// Verifier authenticates a signed blob against a pinned identity. moduleverify.Verifier
// satisfies it; tests supply a stub so the install flow can be exercised without producing
// real signed bundles.
type Verifier interface {
	VerifyBlob(artifact io.Reader, bundleJSON []byte, certIdentity, certIssuer string) error
}

type moduleIndex struct {
	Schema  string       `json:"schema"`
	Tag     string       `json:"tag"`
	Commit  string       `json:"commit"`
	Modules []indexEntry `json:"modules"`
}

type indexEntry struct {
	Name          string          `json:"name"`
	Version       string          `json:"version"`
	Asset         string          `json:"asset"`
	AssetDigest   string          `json:"assetDigest"`
	Compatibility json.RawMessage `json:"compatibility"`
}

// releaseIdentity is the exact certificate SAN a release asset is signed under — the
// full workflow ref for the tag, never a pattern. Pinning the exact tag refuses an older
// release's asset (frozen under the same filename) served at a newer release's URL.
func releaseIdentity(platformVersion string) string {
	return fmt.Sprintf(
		"https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v%s",
		platformVersion,
	)
}

// installModules fetches, verifies, and installs the modules named by the signed index.
// It returns the state the daemon reads; it never returns an error (a failure is a
// recorded state, not an abort — step 3 exits 0).
func installModules(ctx context.Context, cfg Config, f *fetcher, v Verifier) ModulesState {
	identity := releaseIdentity(cfg.PlatformVersion)
	issuer := moduleverify.OIDCIssuerGitHubActions

	idx, ms := fetchIndex(ctx, f, v, identity, issuer)
	if ms.Status != statusOK {
		return ms
	}

	defer os.RemoveAll(filepath.Join(cfg.ModulesDir, tmpDirName))

	outcomes := make([]ModuleOutcome, 0, len(idx.Modules))
	anyFail, anyVerifyFail := false, false
	for _, e := range idx.Modules {
		oc, verifyFail := installOne(ctx, cfg, f, v, identity, issuer, e)
		outcomes = append(outcomes, oc)
		if oc.Outcome == outcomeFailed {
			anyFail = true
			anyVerifyFail = anyVerifyFail || verifyFail
		}
	}

	anyOK := false
	for _, oc := range outcomes {
		if oc.Outcome == outcomePlaced || oc.Outcome == outcomeSkipped {
			anyOK = true
			break
		}
	}

	status := statusOK
	switch {
	case anyVerifyFail:
		status = statusDidNotVerify // a signature failure is a security event, whatever else placed
	case anyFail && !anyOK:
		status = statusFailed // every module failed — not a partial success
	case anyFail:
		status = statusPartial
	}
	return ModulesState{Status: status, Expected: outcomes}
}

// fetchIndex fetches and verifies modules.json + its bundle, and asserts the schema and
// the anti-rollback tag. On success ms.Status is statusOK.
func fetchIndex(ctx context.Context, f *fetcher, v Verifier, identity, issuer string) (moduleIndex, ModulesState) {
	indexBytes, status, err := f.get(ctx, "modules.json", maxIndexBytes)
	if err != nil {
		return moduleIndex{}, ModulesState{Status: statusUnreachable, Detail: fmt.Sprintf("fetching modules.json: %v", err)}
	}
	if status == http.StatusNotFound {
		return moduleIndex{}, ModulesState{Status: statusNoAssets, Detail: fmt.Sprintf("no modules.json at %s", f.tag)}
	}
	if status != http.StatusOK {
		return moduleIndex{}, ModulesState{Status: statusUnreachable, Detail: fmt.Sprintf("modules.json returned HTTP %d", status)}
	}

	bundleBytes, status, err := f.get(ctx, "modules.json.bundle", maxBundleBytes)
	if err != nil {
		return moduleIndex{}, ModulesState{Status: statusUnreachable, Detail: fmt.Sprintf("fetching modules.json.bundle: %v", err)}
	}
	if status == http.StatusNotFound {
		return moduleIndex{}, ModulesState{Status: statusNoAssets, Detail: fmt.Sprintf("no modules.json.bundle at %s", f.tag)}
	}
	if status != http.StatusOK {
		return moduleIndex{}, ModulesState{Status: statusUnreachable, Detail: fmt.Sprintf("modules.json.bundle returned HTTP %d", status)}
	}

	if err := v.VerifyBlob(bytes.NewReader(indexBytes), bundleBytes, identity, issuer); err != nil {
		return moduleIndex{}, ModulesState{Status: statusDidNotVerify, Detail: fmt.Sprintf("modules.json: %v", err)}
	}

	var idx moduleIndex
	if err := json.Unmarshal(indexBytes, &idx); err != nil {
		return moduleIndex{}, ModulesState{Status: statusDidNotVerify, Detail: fmt.Sprintf("malformed index: %v", err)}
	}
	if idx.Schema != indexSchema {
		return moduleIndex{}, ModulesState{Status: statusDidNotVerify, Detail: fmt.Sprintf("unexpected index schema %q", idx.Schema)}
	}
	// Anti-rollback: the signature binds the bytes, but only index.tag binds which release
	// they belong to.
	if idx.Tag != f.tag {
		return moduleIndex{}, ModulesState{Status: statusDidNotVerify, Detail: fmt.Sprintf("index tag %q does not match requested %q", idx.Tag, f.tag)}
	}
	return idx, ModulesState{Status: statusOK}
}

// installOne fetches, verifies, extracts, and (if the payload digest differs) installs a
// single module. The second return reports whether a failure was a signature failure, so
// the caller can raise the channel status to a security event.
func installOne(ctx context.Context, cfg Config, f *fetcher, v Verifier, identity, issuer string, e indexEntry) (ModuleOutcome, bool) {
	oc := ModuleOutcome{Name: e.Name, Version: e.Version, Outcome: outcomeFailed}

	if err := extract.ValidateModuleKey(e.Name); err != nil {
		oc.Detail = err.Error()
		return oc, false
	}

	tarball, status, err := f.get(ctx, e.Asset, maxTarballBytes)
	if err != nil {
		oc.Detail = fmt.Sprintf("fetching %s: %v", e.Asset, err)
		return oc, false
	}
	if status != http.StatusOK {
		oc.Detail = fmt.Sprintf("%s returned HTTP %d", e.Asset, status)
		return oc, false
	}
	bundle, status, err := f.get(ctx, e.Asset+".bundle", maxBundleBytes)
	if err != nil {
		oc.Detail = fmt.Sprintf("fetching %s.bundle: %v", e.Asset, err)
		return oc, false
	}
	if status != http.StatusOK {
		oc.Detail = fmt.Sprintf("%s.bundle returned HTTP %d", e.Asset, status)
		return oc, false
	}

	if err := v.VerifyBlob(bytes.NewReader(tarball), bundle, identity, issuer); err != nil {
		oc.Detail = fmt.Sprintf("did not verify: %v", err)
		return oc, true
	}

	sum := sha256.Sum256(tarball)
	if got := "sha256:" + hex.EncodeToString(sum[:]); got != e.AssetDigest {
		oc.Detail = fmt.Sprintf("asset digest mismatch: index %s, downloaded %s", e.AssetDigest, got)
		return oc, false
	}

	dest := filepath.Join(cfg.ModulesDir, tmpDirName, e.Name)
	if err := os.RemoveAll(dest); err != nil {
		oc.Detail = fmt.Sprintf("clearing temp: %v", err)
		return oc, false
	}
	if err := extract.TarGz(bytes.NewReader(tarball), dest, extract.Limits{}); err != nil {
		oc.Detail = fmt.Sprintf("extract: %v", err)
		return oc, false
	}

	payloadRoot := filepath.Join(dest, "dethernety", e.Name)
	if info, err := os.Stat(payloadRoot); err != nil || !info.IsDir() {
		oc.Detail = fmt.Sprintf("unexpected layout: no dethernety/%s in archive", e.Name)
		return oc, false
	}

	// Recompute over the extracted tree and require the incoming stamp to agree — the
	// stamp is signed with the asset, so this catches a stamp that does not describe its
	// own payload.
	computed, err := payloaddigest.Compute(payloadRoot)
	if err != nil {
		oc.Detail = fmt.Sprintf("computing payload digest: %v", err)
		return oc, false
	}
	stamp, err := payloaddigest.ReadStamp(filepath.Join(payloadRoot, payloaddigest.StampFilename))
	if err != nil {
		oc.Detail = fmt.Sprintf("reading stamp: %v", err)
		return oc, false
	}
	if stamp.PayloadDigest != computed {
		oc.Detail = fmt.Sprintf("stamp integrity: stamp %s, recomputed %s", stamp.PayloadDigest, computed)
		return oc, false
	}
	oc.PayloadDigest = computed

	// Replace only if the on-disk digest differs. A missing or unreadable on-disk stamp
	// means replace — err toward an extra reinstall, never a silent skip.
	target := filepath.Join(cfg.ModulesDir, e.Name)
	if onDisk, err := payloaddigest.ReadStamp(filepath.Join(target, payloaddigest.StampFilename)); err == nil && onDisk.PayloadDigest == computed {
		oc.Outcome = outcomeSkipped
		return oc, false
	}

	// Replace without a window where the module is missing: move any existing copy into the
	// temp area (removed with it at the end of the run), put the new copy in place, then —
	// only on success — the old copy is discarded with the temp tree. On a failed swap,
	// restore the old copy so a failed install never leaves the module absent.
	backup := filepath.Join(cfg.ModulesDir, tmpDirName, e.Name+".old")
	_ = os.RemoveAll(backup) // clear any stale backup from a previous crash
	movedAside := false
	if _, err := os.Lstat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			oc.Detail = fmt.Sprintf("moving existing module aside: %v", err)
			return oc, false
		}
		movedAside = true
	}
	if err := os.Rename(payloadRoot, target); err != nil {
		if movedAside {
			_ = os.Rename(backup, target) // restore the prior good copy
		}
		oc.Detail = fmt.Sprintf("installing module: %v", err)
		return oc, false
	}
	oc.Outcome = outcomePlaced
	return oc, false
}
