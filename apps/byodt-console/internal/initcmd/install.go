package initcmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall"
	"github.com/dether-net/dethernety-oss/pkg/extract"
	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// indexSchema is the schema string the signed modules.json declares.
const indexSchema = "dethernety.modules/1"

// tmpDirName is the transient extraction area under the modules directory, owned by
// moduleinstall because both of its callers stage into the same place.
const tmpDirName = moduleinstall.TmpDirName

// Verifier authenticates a signed blob against a pinned identity. It is an alias rather than
// a second declaration so the seam is one type: tests stub it, production wires
// moduleverify.New(), and Run's signature is unchanged.
type Verifier = moduleinstall.Verifier

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

	// Verify, digest, extract, assert layout and reconcile the stamp — the shared sequence,
	// so this path and the artifact path cannot drift. Detail is the error verbatim: every
	// message the operator sees on these failures is moduleinstall's, and adding context here
	// would silently reword all of them.
	payloadRoot, stamp, err := moduleinstall.Stage(
		tarball, bundle, v, identity, issuer, e.AssetDigest, e.Name,
		filepath.Join(cfg.ModulesDir, tmpDirName, e.Name),
	)
	if err != nil {
		oc.Detail = err.Error()
		// A signature failure is a security event; every other staging failure is not.
		return oc, errors.Is(err, moduleinstall.ErrNotVerified)
	}
	oc.PayloadDigest = stamp.PayloadDigest

	// Replace only if the on-disk digest differs. A missing or unreadable on-disk stamp
	// means replace — err toward an extra reinstall, never a silent skip.
	target := filepath.Join(cfg.ModulesDir, e.Name)
	if onDisk, err := payloaddigest.ReadStamp(filepath.Join(target, payloaddigest.StampFilename)); err == nil && onDisk.PayloadDigest == stamp.PayloadDigest {
		oc.Outcome = outcomeSkipped
		return oc, false
	}

	// mayReplace is nil: these targets are named by this run's own signed index, so ownership
	// is already established. The backup lands inside the temp tree; Swap clears it on success
	// and keeps it on the one failure where it is the last copy, and either way the sweep at the
	// end of the run takes whatever is left. The kept-copy report is for a caller that can tell
	// an operator about it — this one reports per-module outcomes and has nowhere to put it.
	backup := filepath.Join(cfg.ModulesDir, tmpDirName, e.Name+".old")
	if _, err := moduleinstall.Swap(target, payloadRoot, backup, nil); err != nil {
		oc.Detail = err.Error()
		return oc, false
	}
	oc.Outcome = outcomePlaced
	return oc, false
}
