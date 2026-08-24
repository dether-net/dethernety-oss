package daemoncmd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall"
	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// The entitled artifact path's credential. A content mount needs none — the catalog is public and a
// mount is a local file write — but installing an entitled artifact means asking the content service
// for bytes it will only hand to a subscriber, and the subscriber is the operator, not the console.
//
// So the console relays the operator's own OIDC ACCESS token, minted in the same exchange as the ID
// token the session was established with. It inherits idtoken.go's rule exactly: held for the duration
// of one request, never logged, never written to disk. The console gains no credential of its own here
// and holds nothing between requests.
//
// It rides on its own header rather than Authorization, and that is not cosmetic. Authorization already
// carries the ID token on every gated request so the daemon can forward it to the platform's
// authenticated module query — two tokens for two different audiences cannot share one header, and
// collapsing them would send whichever arrived last to whichever service was called next.

// cloudTokenHeader carries the operator's access token on the routes that forward it, named to match
// sessionHeader in session.go so the console's own headers read as one family.
const cloudTokenHeader = "X-Console-Cloud-Token"

// cloudAccessToken extracts the operator's access token from its header, or "" if absent. A sibling of
// bearerToken rather than a variant of it: bearerToken reads Authorization and unwraps the "Bearer "
// scheme, and this reads a different header carrying a different token, so the two must not be able to
// answer each other's question.
func cloudAccessToken(r *http.Request) string {
	return r.Header.Get(cloudTokenHeader)
}

// ── The artifact mount marker ────────────────────────────────────────────────────────────────────

// The fourth marker kind the console runs, and like the other three it is told apart by filename. The
// stamp inside the payload says WHAT this payload is; this marker, outside the signature, says THE
// CONSOLE PUT IT HERE. Removal rests entirely on the second: the modules the boot path installs carry a
// stamp and no artifact marker, which is what makes a request to remove one refusable.
//
// It carries no packageKey. An artifact is entitled by any package listing it, so no single package is
// "the" grantor, and recording one of several would reproduce a known limitation of the content mount's
// marker in a new place on its first day.
const (
	artifactMarkerName   = ".dethernety-artifact-mount.json"
	artifactMarkerSchema = "dethernety.byodt-artifact/1"
)

type artifactMarker struct {
	Schema      string `json:"schema"`
	ArtifactKey string `json:"artifactKey"`
	Version     string `json:"version"`
	InstalledAt string `json:"installedAt"`
}

// readArtifactMarker reads and VALIDATES the artifact mount marker — the one definition of "the console
// installed this, as an artifact". Like the knowledge-graph marker and unlike the content mount's, it is
// parsed rather than stat'd: a file carrying our name and someone else's schema is not ours, and since
// what this answer gates is a directory being replaced, being sure is worth one Unmarshal.
func readArtifactMarker(dir string) (artifactMarker, error) {
	var m artifactMarker
	data, err := os.ReadFile(filepath.Join(dir, artifactMarkerName))
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return artifactMarker{}, err
	}
	if m.Schema != artifactMarkerSchema {
		return artifactMarker{}, fmt.Errorf("%s carries schema %q, not %q", artifactMarkerName, m.Schema, artifactMarkerSchema)
	}
	return m, nil
}

// isArtifactMount reports whether a directory is one the console installed as an artifact.
func isArtifactMount(dir string) bool {
	_, err := readArtifactMarker(dir)
	return err == nil
}

// ── The inventory ────────────────────────────────────────────────────────────────────────────────

// installedArtifact is one artifact directory as it is ON DISK. There is no ledger to consult and there
// deliberately is not one: a scan cannot disagree with the disk, and a ledger can.
//
// key is the DIRECTORY NAME rather than the marker's field. It is what the platform loads and what a
// removal addresses, and the install resolves one from the other, so a marker claiming a different key
// would describe a directory that is not the one it sits in.
type installedArtifact struct {
	key         string
	version     string
	installedAt string
}

// listArtifacts is listMounts' sibling: the same walk of the same directory, asking the other ownership
// question. Two scans rather than one classifier, because they cannot disagree — a directory carrying two
// kinds' markers is refused at install and skipped here — and because the one-round-trip rule this route
// keeps is about the REQUEST: one request, one directory, three lists.
//
// A directory with no artifact marker, with someone else's schema, or with a second kind's marker is
// skipped: not one of ours, the existing loop's own words. A missing modules directory is not an error, as
// in listMounts: it means nothing is installed yet.
//
// The version comes from the MARKER, and falls back to the payload stamp only when the marker carries
// none. That choice is not arbitrary: the marker is the console's own record and it is the value the
// downgrade check compares against, so reading the other file here would let the console show a version
// its own refusal then contradicts. The stamp says what the payload IS, and the two agree on anything this
// console placed — the fallback is for a tree that was interfered with, which is reported rather than
// hidden, because removal is the operator's remedy for it.
func listArtifacts(modulesDir string) ([]installedArtifact, error) {
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []installedArtifact
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(modulesDir, e.Name())
		m, err := readArtifactMarker(dir)
		if err != nil {
			continue // no marker, unreadable, or someone else's schema
		}
		if hasMarkerNamed(dir, mountMarkerName) || hasMarkerNamed(dir, kgMarkerName) {
			continue // claimed by two kinds at once, so claimed by neither
		}
		a := installedArtifact{key: e.Name(), version: m.Version, installedAt: m.InstalledAt}
		if a.version == "" {
			if stamp, err := payloaddigest.ReadStamp(filepath.Join(dir, payloaddigest.StampFilename)); err == nil {
				a.version = stamp.Version
			}
		}
		out = append(out, a)
	}
	return out, nil
}

// artifactCurrency judges one installed artifact against the catalog, in the vocabulary the console
// already renders plus one value: current | outdated | unknown | unavailable. Where it cannot answer it
// degrades and says so, in the note the response already carries for the same purpose.
//
// It NEVER answers outdated on a comparison it could not make. Outdated is an invitation to install, and
// the two cases below that cannot be compared would be inviting either a downgrade the install refuses or
// a version that no longer exists.
func artifactCurrency(key, installed string, entry catalogArtifactEntry, found bool) (currency, latestVersion, note string) {
	if !found {
		// Not offered by any package this deployment can see — including because the catalog could not be
		// reached, which the response-level note already explains. latestModule's own silent precedent.
		return "unknown", "", ""
	}
	if entry.Latest == "" {
		// Every published version has been recalled. Unavailable rather than outdated: there is nothing to
		// offer, and an update prompt here would lead only to a 410.
		return "unavailable", "", ""
	}
	cmp, ok := compareVersion(installed, entry.Latest)
	switch {
	case !ok:
		return "unknown", "", "the installed version of " + key + " could not be compared with the catalog's, so update availability is unknown"
	case cmp == 0:
		return "current", "", ""
	case cmp < 0:
		return "outdated", entry.Latest, ""
	default:
		// Reachable only when the newer version was recalled and the package has been cut since. Not
		// outdated, because there is nothing to update to and the badge would prompt a downgrade.
		return "unknown", "", key + " is installed at a version newer than the catalog offers, so there is nothing to update to"
	}
}

// ── The install path ─────────────────────────────────────────────────────────────────────────────

// The descriptor is about 15 KB: an inlined Sigstore bundle (roughly 11 KB, 15 KB base64) and a few
// hundred bytes of everything else. Four times that leaves room for a file listing the publisher does
// not currently emit.
const maxDescriptorBytes = 64 << 10

// The archive bound, and it is the SAME number the publisher enforces on the same bytes — deliberately
// not that number plus slack. entitledGet admits a body exactly at the cap and refuses one over, so
// there is no off-by-one for slack to absorb; slack here could only admit what publishing already
// refuses, which would make this the more permissive of the two checks for no reason.
const maxArtifactBytes = 3 << 20

// The wire shapes the console reads. Only the fields it needs are named and unknown ones are tolerated,
// as the catalog shapes are.
type artifactDescriptor struct {
	ArtifactKey string `json:"artifactKey"`
	Version     string `json:"version"`
	Kind        string `json:"kind"`
	Archive     struct {
		Format string `json:"format"`
		Size   int64  `json:"size"`
		Digest string `json:"digest"`
	} `json:"archive"`
	Signature struct {
		Format string `json:"format"`
		Bundle string `json:"bundle"`
	} `json:"signature"`
}

// The only signature format defined in this protocol version. A second one would be a downgrade surface,
// so an unexpected value is refused rather than attempted.
const artifactBundleFormat = "sigstore-bundle/v0.3"

// The only artifact kind a deployment installs. The other kind in the protocol is an application, which is
// delivered through the portal and runs wherever its operator runs it — there is nothing here to put it in.
//
// It is public protocol vocabulary rather than a name, so branching on it is not the artifact-key literal
// the boundary rules forbid.
const artifactKindModule = "code-module"

// problemDocument is the service's error body — an RFC 9457 problem document with a machine code, plus
// the two extensions this path reads. It is parsed BEST-EFFORT: every refusal below has a sentence that
// stands on its own, so a body that is absent, truncated or shaped differently degrades the message
// rather than the outcome.
// Both extensions are NESTED, because that is the shape the protocol defines and the shape every producer
// in this stack emits: one top-level extension member per condition, whose value is an object. Reading the
// recall members at the top level instead cost the operator the whole point of a 410 — the publisher's
// reason and the version that replaces it — while still answering 410, so nothing failed loudly.
type problemDocument struct {
	Title    string `json:"title"`
	Code     string `json:"code"`
	Recalled struct {
		Reason string `json:"reason"`
		// Carried by the protocol and deliberately not surfaced: the sentence is about WHY a version was
		// withdrawn, which is what an operator can act on, and not about when.
		RecalledAt   string `json:"recalledAt"`
		SupersededBy string `json:"supersededBy"`
	} `json:"recalled"`
	Denial struct {
		Message struct {
			Body string `json:"body"`
		} `json:"message"`
	} `json:"denial"`
}

func parseProblem(body []byte) problemDocument {
	var p problemDocument
	_ = json.Unmarshal(body, &p)
	return p
}

// artifactRefusal is a refusal to install: the status the operator's browser sees and the sentence it
// carries. The sentence is surfaced verbatim, so these are operator sentences rather than codes.
type artifactRefusal struct {
	status int
	detail string
}

func refuse(status int, detail string) *artifactRefusal { return &artifactRefusal{status, detail} }

// stagedArtifact is a verified, extracted artifact waiting under staging, whose stamp names the artifact
// and version that were asked for. NOTHING is installed: the payload root is still inside the staging tree
// and the modules directory is untouched.
//
// target is resolved once, at the ownership check, and carried here rather than recomputed beside the
// os.Rename that consumes it — one resolution through moduleDir, so the path the install refuses to clobber
// and the path it renames into cannot become two different answers.
type stagedArtifact struct {
	key, version         string
	payloadRoot, staging string
	target               string
	stamp                payloaddigest.Stamp
}

// backupPath names Swap's move-aside destination: a sibling of the staging tree inside the same staging
// root, so it shares a filesystem with both the target and the new tree (os.Rename gives EXDEV otherwise)
// and one cleanup covers both. It is initcmd's own convention (install.go's e.Name+".old"), and the module
// key charset forbids dots, so "<key>.old" can never collide with another key's staging directory.
func backupPath(staging string) string { return staging + ".old" }

// discardStaging removes what one install put under the staging root: its own key's tree, and then the
// root itself.
//
// It does NOT touch the backup, and that omission is the point. Swap moves the previously installed tree
// to backupPath before it renames the new one in, restores it if that rename fails, and removes it only
// once the swap has succeeded — so on the one path where the restore ALSO failed, that path holds the
// deployment's only copy of the artifact. This function runs on every path out, including that one, and
// deleting the backup here is how the last copy used to go. The backup is Swap's from the moment it is
// passed; the bound on a leftover is the next swap of the same key that gets PAST mayReplace — Swap clears
// a stale backup before it moves anything, so a retry that then fails takes it too — and nothing else,
// since the boot sweep is a defer registered after an early return that an offline start takes.
//
// The root goes with os.Remove and NEVER os.RemoveAll — undoMountDir's rule — so it goes only while it is
// empty, and an interrupted run's tree for some other key simply makes the last line a no-op. THE REQUEST
// is the staging tree's lifetime: this is called on the refusal paths as much as on success, and Stage
// extracts before four of its five failures, so the refusal paths are where it earns its place.
func discardStaging(staging string) {
	_ = os.RemoveAll(staging)
	_ = os.Remove(filepath.Dir(staging))
}

// modulesOps serialises every write into the modules directory — installing and removing an artifact,
// and mounting and unmounting a content module. All four address the same namespace, custom_modules/<key>,
// and none of the races below is visible from inside one handler.
//
// Two installs of ONE key share one staging directory (it is keyed on the module name alone), so without
// this, one request can re-extract over a destination another has already verified and the swap then
// renames in a tree nobody checked: the tree placed would not be the tree verified. Two different keys
// stage in two different directories and were never that hazard.
//
// An install racing a REMOVAL is the second, and it runs the way round the install's own re-check cannot
// see. The removal reads its ownership marker and renames the tree away, and those two steps are not
// adjacent — so an install that completes in between has its freshly placed tree renamed off the disk,
// having already answered 200. Neither request reports anything wrong, and the artifact is gone.
//
// An install racing a MOUNT of the same key is the third, and it is why this lock is not the artifact
// surface's alone. mountModule stats the directory and then writes it, and those two steps are not
// adjacent either: a mount whose stat lands inside Swap's move-aside window sees nothing there, creates
// the directory, and makes the install's rename-in fail — taking the mount's own files with it when Swap
// restores. The other order writes a stub and a mount marker INTO a freshly installed artifact, producing
// the dual-marker tree placeArtifact's payload check exists to prevent, which listArtifacts then hides and
// the content unmount route then deletes. The sequential guards on both sides close only the sequential
// case; this is what closes the concurrent one.
//
// Package-level rather than per-key, because per-key granularity buys nothing when these operations are
// rare. And TryLock rather than Lock, so the second caller is told what is happening rather than left
// holding a connection open through another request's multi-megabyte download.
var modulesOps sync.Mutex

// modulesBusy is the refusal a second concurrent operation gets. It says "module operation" and not
// "artifact operation" because all four handlers that take this lock can be the one refused, and the
// operator who reads it may have been on either surface.
const modulesBusy = "another module operation is already running — wait for it to finish and try again"

// compareVersion compares two MAJOR.MINOR.PATCH versions NUMERICALLY, reporting -1, 0 or +1, and whether
// both sides were readable. It is deliberately not golang.org/x/mod/semver: that parser returns early
// unless the string begins with "v" and answers 0 for two unparseable operands, so against the bare
// versions this protocol uses, every call site here would silently compare equal and no comparison would
// ever fire.
//
// "Readable" is artifactVersionPattern itself — the same shape an install request must satisfy. That is
// what keeps every component to at most nine digits and therefore under MaxInt32, so strconv.Atoi cannot
// overflow on a 32-bit build; and it is what makes a hand-edited marker, or a catalog offering "1.2",
// answer false rather than compare wrong. EITHER side can be the unreadable one, and a caller that knows
// one of them is already validated should say so where it calls rather than assume it here.
func compareVersion(a, b string) (int, bool) {
	x, okA := versionComponents(a)
	y, okB := versionComponents(b)
	if !okA || !okB {
		return 0, false
	}
	for i := range x {
		switch {
		case x[i] < y[i]:
			return -1, true
		case x[i] > y[i]:
			return 1, true
		}
	}
	return 0, true
}

func versionComponents(v string) ([3]int, bool) {
	var out [3]int
	if !artifactVersionPattern.MatchString(v) {
		return out, false
	}
	for i, part := range strings.SplitN(v, ".", 3) {
		n, err := strconv.Atoi(part)
		if err != nil {
			// Unreachable while the pattern above is the gate. Kept so that widening the pattern cannot
			// silently turn this into an overflow instead of a refusal.
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}

// artifactIdentity is the exact certificate subject one artifact version is signed under: the configured
// publishing workflow plus the ref naming this key and this version.
//
// It is DERIVED from the request rather than configured, which is the property that makes the signature
// mean "these are the bytes I asked for" instead of only "someone we trust signed something". An
// identity spanning a family distinguishes 1.3.0 from 1.2.0 no better than it distinguishes one artifact
// from another, and a service could then answer a request for one version with another version's genuine
// archive-and-bundle pair while both the signature and the digest checks passed.
//
// This is releaseIdentity's shape (initcmd/install.go), with the fixed half in configuration instead of
// a constant — because the workflow that signs entitled artifacts lives somewhere this binary's source
// does not name.
func artifactIdentity(prefix, key, version string) string {
	return fmt.Sprintf("%s@refs/tags/artifact/%s/%s", prefix, key, version)
}

// stageArtifact runs the install sequence up to and including verification: gate, validate, refuse on a
// name that is not ours, read configuration and derive the identity, take the operator's credential,
// fetch the descriptor, decode the bundle, fetch the archive, stage it, and require its stamp to name what
// was asked for. On success the bytes are verified and extracted under a staging directory and NOTHING has
// been placed.
//
// THE ORDER OF THE FIRST FIVE CHECKS IS LOAD-BEARING even though none of them dials anything. It decides
// which refusal an operator is told about first, and — for the ownership check — that a request which was
// always going to be rejected never causes this console to make a request to the content service at all.
func (s *server) stageArtifact(ctx context.Context, key, version, token string) (*stagedArtifact, *artifactRefusal) {
	// 1. Cloud mode. Outside it there is no content service to ask and no entitlement to hold.
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		return nil, refuse(http.StatusConflict, "artifact installs are available only in cloud mode — connect this deployment to the cloud first")
	}

	// 2. Validate. The key becomes a directory name, so it takes the module key charset; the version
	// composes into a certificate subject and a URL path, so it takes the semver-core shape. Both are
	// what makes everything downstream — the path, the identity, the marker — decidable from the request.
	if !moduleKeyPattern.MatchString(key) {
		return nil, refuse(http.StatusBadRequest, "invalid artifact key")
	}
	if key == kgModuleKey {
		return nil, refuse(http.StatusConflict, "this name is reserved for the knowledge-graph connection, which is mounted with the cloud connection rather than installed")
	}
	if !artifactVersionPattern.MatchString(version) {
		return nil, refuse(http.StatusBadRequest, "invalid artifact version — expected MAJOR.MINOR.PATCH")
	}

	// 3. Ownership, BEFORE any network call. This is the one step on this path that can destroy data, and
	// refusing here means a request that was going to be rejected never reaches the content service.
	target, err := moduleDir(s.cfg.ModulesDir, key)
	if err != nil {
		return nil, refuse(http.StatusBadRequest, "invalid artifact key")
	}
	if ref := s.refuseForeignDirectory(target); ref != nil {
		return nil, ref
	}

	// 4. Configuration, and the identity derived from it plus what was asked for. An unusable or absent
	// signer refuses BEFORE any request is made: an installer with no configured identity must refuse
	// rather than fall back to a weaker check, and dialling first would invert that.
	base, ok := s.cloudContentBase()
	if !ok || base == "" {
		return nil, refuse(http.StatusConflict, "this deployment has no content service configured — reconnect to the cloud")
	}
	prefix := s.cloudArtifactSigner()
	if prefix == "" {
		return nil, refuse(http.StatusConflict, "this deployment has no artifact signer configured, so an artifact's signature cannot be checked — reconnect to the cloud to obtain one")
	}
	identity := artifactIdentity(prefix, key, version)

	// 5. The operator's credential. 400 and NOT 401: this is a missing cloud sign-in rather than a
	// rejected session, and the SPA turns any 401 into a session-expired path that would bounce the
	// operator to the sign-in card mid-install with no message at all. 401 stays reserved for a session
	// this daemon rejects.
	if token == "" {
		return nil, refuse(http.StatusBadRequest, "a cloud sign-in is required")
	}

	// 6. The descriptor. Both path segments are the regex-validated key and version above, and the base
	// comes only from the mode-layer file this console wrote — never from the request — so the set of
	// hosts this can dial is the set the operator named.
	descPath := "/v1/artifacts/" + key + "/versions/" + version
	body, status, err := entitledGet(ctx, base, descPath, token, maxDescriptorBytes)
	if ref := s.entitledOutcome(status, body, err, "descriptor"); ref != nil {
		return nil, ref
	}
	var desc artifactDescriptor
	if err := json.Unmarshal(body, &desc); err != nil {
		return nil, refuse(http.StatusBadGateway, "the content service returned a descriptor this console could not read")
	}

	// Only a module is installed onto a deployment, and this is the ONLY check anywhere that says so. The
	// staging sequence asserts a module LAYOUT, which an application's archive could satisfy by accident,
	// and nothing else reads the kind — so without this an artifact whose whole point is that it runs
	// somewhere else would be placed in the modules directory and loaded by the platform.
	//
	// Before the archive is fetched, so a request that was never going to install does not pull megabytes
	// first. 409 rather than 400: the request is well formed and it is the deployment that is the wrong
	// place for it, which is what the sentence has to convey.
	if desc.Kind != artifactKindModule {
		return nil, refuse(http.StatusConflict, "this artifact is an application rather than a module — it is used from the portal and is not installed on a deployment")
	}

	// 7. The bundle, from the descriptor. Exactly one signature format is defined; a second would be a
	// downgrade surface, so an unexpected one is refused rather than attempted.
	if desc.Signature.Format != artifactBundleFormat {
		return nil, refuse(http.StatusBadGateway, "the artifact is signed in a format this console does not accept")
	}
	bundle, err := base64.StdEncoding.DecodeString(desc.Signature.Bundle)
	if err != nil {
		return nil, refuse(http.StatusBadGateway, "the artifact's signature could not be decoded")
	}

	// 8. The archive.
	archive, status, err := entitledGet(ctx, base, descPath+"/content", token, maxArtifactBytes)
	if ref := s.entitledOutcome(status, archive, err, "archive"); ref != nil {
		return nil, ref
	}

	// 9. Verify, digest, extract, assert layout, reconcile the stamp — one call, the same sequence the
	// boot path runs, fail-closed with no override anywhere on this path.
	staging := filepath.Join(s.cfg.ModulesDir, moduleinstall.TmpDirName, key)
	payloadRoot, stamp, err := moduleinstall.Stage(archive, bundle, s.verify, identity, moduleverify.OIDCIssuerGitHubActions, desc.Archive.Digest, key, staging)
	if err != nil {
		// Stage clears and then EXTRACTS before four of its five failures — the layout assertion, the
		// recompute, the stamp read and the reconciliation all run over a tree that is already on disk —
		// so the refusal has to take the tree with it. The boot path gets this from installModules; a
		// request has to do it itself.
		discardStaging(staging)
		if errors.Is(err, moduleinstall.ErrNotVerified) {
			// A signature failure is a security event and not an ordinary install failure — the same
			// distinction the boot path escalates its whole channel status for.
			s.logger.Error("an artifact's signature did not verify", "artifact", key, "version", version, "err", err)
			return nil, refuse(http.StatusBadGateway, "the artifact's signature did not verify against the expected signer — nothing was installed")
		}
		// Every other staging failure carries Stage's own message verbatim. Those are already operator
		// sentences, and adding context here would silently reword all of them at once.
		return nil, refuse(http.StatusBadGateway, err.Error())
	}

	// 10. The stamp must describe what was ASKED FOR, and this is the one question Stage cannot answer:
	// it proves the bytes are signed, whole and self-describing, not that they are the artifact and the
	// version this request named. Step 4's derived identity already binds both halves in the certificate,
	// so this is belt and braces — and it costs nothing, because the packager writes the stamp anyway.
	//
	// The two stamp values are quoted: they are publisher-authored, so authenticated rather than trusted,
	// and %q keeps a newline visible instead of letting it shape the reply.
	if stamp.Name != key || stamp.Version != version {
		discardStaging(staging)
		return nil, refuse(http.StatusBadGateway, fmt.Sprintf(
			"the content service returned an artifact stamped %q %q rather than %q %q — nothing was installed",
			stamp.Name, stamp.Version, key, version))
	}
	return &stagedArtifact{
		key: key, version: version,
		payloadRoot: payloadRoot, staging: staging, target: target,
		stamp: stamp,
	}, nil
}

// refuseForeignDirectory answers step 3: may this install write to dir? Four cases and TWO sentences,
// because a refusal should say the true thing rather than the convenient one — mountModule's "was not
// created by the console" would be false about a content mount, which the console did create.
//
// Lstat rather than Stat, and fs.ErrNotExist rather than "stat failed". With the key itself a symlink,
// Stat reports a directory and a marker planted behind it reads as ours; Lstat sees the link and refuses.
// And a stat that failed for any other reason — a permission problem, a symlink loop — is not evidence
// that nothing is there, so it refuses too.
func (s *server) refuseForeignDirectory(dir string) *artifactRefusal {
	const notOurs = "a module directory with this name already exists and was not installed as an artifact"
	info, err := os.Lstat(dir)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil // nothing there — proceed
	case err != nil || !info.Mode().IsDir():
		return refuse(http.StatusConflict, notOurs)
	case isArtifactMount(dir):
		return nil // ours, at some version — proceed
	case hasOurMarker(dir):
		return refuse(http.StatusConflict, "a content mount from the catalog is already using this name; unmount it before installing")
	default:
		return refuse(http.StatusConflict, notOurs)
	}
}

// entitledOutcome turns one entitled fetch into a refusal, or nil to continue. It covers all three
// families the transport can produce — an error, a non-2xx status, and success — because the first has
// no status a table could map and the oversize case would otherwise fall into an unwritten branch.
//
// No arm answers 401. The SPA turns any 401 into clearSession() and a session-expired path the content
// panel swallows, so an operator would be returned to the sign-in card mid-install with nothing said.
// 401 is reserved for a session this daemon itself rejects.
func (s *server) entitledOutcome(status int, body []byte, err error, what string) *artifactRefusal {
	if err != nil {
		if errors.Is(err, errEntitledTooLarge) {
			return refuse(http.StatusBadGateway, "the published artifact is larger than this console will install")
		}
		// A dial failure or a refused redirect are the same thing from where the operator stands, and
		// the raw error carries a URL that must not be shown verbatim. It goes to the log instead.
		s.logger.Error("fetching an artifact "+what, "err", err)
		return refuse(http.StatusBadGateway, "the content service could not be reached")
	}
	p := parseProblem(body)
	switch status {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized:
		return refuse(http.StatusBadRequest, "the cloud sign-in is no longer valid — sign in again and retry the install")
	case http.StatusForbidden:
		detail := p.Denial.Message.Body
		if detail == "" {
			detail = "this deployment's subscription does not include this artifact"
		}
		return refuse(http.StatusForbidden, detail)
	case http.StatusNotFound:
		return refuse(http.StatusNotFound, "no artifact is published under this key at this version")
	case http.StatusGone:
		detail := "this version has been withdrawn"
		if p.Recalled.Reason != "" {
			detail = "this version has been withdrawn: " + p.Recalled.Reason
		}
		if p.Recalled.SupersededBy != "" {
			detail += " — superseded by " + p.Recalled.SupersededBy
		}
		return refuse(http.StatusGone, detail)
	case http.StatusTooManyRequests:
		// Its own arm rather than the catch-all: this one is transient and the operator's move is to
		// wait, which "the content service answered 429" does not say.
		return refuse(http.StatusServiceUnavailable, "the content service is rate-limiting this deployment — wait a moment and retry")
	default:
		return refuse(http.StatusBadGateway, fmt.Sprintf("the content service answered %d", status))
	}
}

// markStaged writes the artifact mount marker INTO the staged payload root. Its POSITION is what is being
// specified here, not its content: os.Rename(payloadRoot, target) MAKES the payload root the module
// directory — there is no "alongside" — so a marker written here is already present at the instant the tree
// becomes loadable, and the rename is atomic. There is never a moment when a loadable tree carries no
// marker, which is exactly the defect the two stub mounts had and which this path cannot have.
//
// After Stage's recompute, and that is positional too: payloaddigest.Compute excludes the payload stamp and
// nothing else, so a marker written before it would change the digest and break that package's
// byte-for-byte parity with the JavaScript reference. One consequence for whoever comes next: once this
// file is in the tree, a recompute over an INSTALLED directory can never equal its stamp again, so an
// integrity check on an installed artifact compares stamps rather than recomputing.
func markStaged(staged *stagedArtifact) error {
	// The schema is not optional. readArtifactMarker rejects a marker carrying any other value, and
	// refuseForeignDirectory then reads the directory as somebody else's — leaving a tree that no install
	// can replace and no removal will take.
	return writeMarkerNamed(staged.payloadRoot, artifactMarkerName, artifactMarker{
		Schema:      artifactMarkerSchema,
		ArtifactKey: staged.key,
		Version:     staged.version,
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// placeArtifact turns a staged artifact into an installed one: refuse a downgrade that was not asked for,
// mark the staged tree, and swap it in. It returns a refusal or nil, and nothing else — the response the
// operator reads is the handler's to compose.
func (s *server) placeArtifact(staged *stagedArtifact, allowDowngrade bool) *artifactRefusal {
	// 11. No silent downgrade: a service that withdrew a fixed version could otherwise walk a deployment
	// backwards onto a known-bad one.
	//
	// The comparison is decidable at the ownership check and is deliberately HERE, after the fetch. An
	// operator asking for an older version whose bytes have been recalled should be told THAT, with the
	// reason its publisher wrote — not told about the downgrade rule for a version they could not have
	// installed either way.
	if installed, err := readArtifactMarker(staged.target); err == nil {
		// The requested side was validated against artifactVersionPattern at step 2, so here — and only
		// here — an unreadable pair means the INSTALLED side is the unreadable one.
		cmp, ok := compareVersion(staged.version, installed.Version)
		switch {
		case !ok:
			return refuse(http.StatusConflict, "an artifact is installed under this name at a version this console cannot read — remove it and install again")
		case cmp < 0 && !allowDowngrade:
			return refuse(http.StatusConflict, fmt.Sprintf(
				"version %s is older than the installed %s — installing it is a downgrade and has to be asked for explicitly",
				staged.version, installed.Version))
		}
		// Equal versions proceed. Re-installing the same version over the console's own copy is how a
		// damaged tree is repaired, and it is the content mount's own rule for re-posting one key.
	}

	// The payload may not carry another kind's ownership marker, and this is the check that keeps the
	// three kinds from being able to claim each other's directories.
	//
	// Nothing filters the extracted tree: extraction refuses symlinks and path escapes but not file names,
	// the payload digest excludes only the stamp, and the swap renames the whole tree in. So an archive
	// containing dethernety/<key>/.dethernety-mount.json would produce a directory carrying BOTH markers —
	// and the content unmount route gates on that marker alone, which would let it delete an artifact
	// install as though it were a mount it had written. Refuse the bytes rather than teach every reader on
	// the other side to second-guess its own marker.
	//
	// It sits here rather than in the shared staging sequence because these names are this package's and
	// the shared package cannot import it. The boot path is unaffected: it installs the modules named by
	// the console's own signed index, into directories no marker of these kinds ever describes.
	for _, name := range []string{mountMarkerName, kgMarkerName} {
		if hasMarkerNamed(staged.payloadRoot, name) {
			s.logger.Error("an artifact payload carries another mount kind's marker", "artifact", staged.key, "version", staged.version, "marker", name)
			return refuse(http.StatusBadGateway, "the artifact's payload carries another mount's ownership marker — nothing was installed")
		}
	}

	// 12. Mark the tree before it can be placed. See markStaged: the position is the property.
	if err := markStaged(staged); err != nil {
		s.logger.Error("writing the artifact marker", "artifact", staged.key, "err", err)
		return refuse(http.StatusInternalServerError, "the artifact was verified but could not be marked as installed — nothing was placed")
	}

	// 13. Swap. Swap returns mayReplace's error verbatim and an error cannot carry a status, so the
	// closure keeps the refusal and this caller prefers it over the generic one.
	var stale *artifactRefusal
	backup := backupPath(staged.staging)
	priorCopyKept, err := moduleinstall.Swap(staged.target, staged.payloadRoot, backup, func(target string) error {
		// The ownership question, re-established immediately before the move-aside. It is not a duplicate
		// of the pre-flight one: that one tells the operator early and without dialling anything, and this
		// one is the guarantee — the only check adjacent to the rename it protects.
		if stale = s.refuseForeignDirectory(target); stale != nil {
			return errors.New(stale.detail)
		}
		return nil
	})
	if err != nil {
		if stale != nil {
			return stale
		}
		s.logger.Error("placing an artifact", "artifact", staged.key, "version", staged.version, "err", err)
		// Swap tells this caller the one thing it could not work out for itself: whether a copy was moved
		// aside and left there. When it was, the deployment has nothing at the name the platform loads and
		// the surviving copy is not deleted — so name it, the way removeArtifact names its own leftover.
		// Otherwise the console still makes no claim about what survived, and puts the rest in the log.
		if priorCopyKept {
			return refuse(http.StatusInternalServerError,
				"the artifact was verified but could not be placed, and the copy that was installed before it could not be put back — it is at "+backup+" and has not been deleted. Take a copy of it before installing this artifact again: the next install clears that path before it does anything else")
		}
		return refuse(http.StatusInternalServerError, "the artifact was verified but could not be placed")
	}
	return nil
}

// worldWritableModule reports whether any file the PLATFORM would load out of a module directory carries
// the world-writable bit — the same condition writeMount reports for a stub, over the set the loader
// actually takes. It scans every top-level *Module.js rather than one derived name, because a packaged
// artifact's entry file is named by the archive and not by moduleFileName.
//
// Extraction creates each file 0644, so this reports how the host mount treats modes rather than anything
// the archive chose, and it warns rather than refuses: the bytes are installed either way, and the operator
// is the only one who can fix the volume.
func worldWritableModule(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), "Module.js") {
			continue
		}
		if worldWritable(filepath.Join(dir, e.Name())) {
			return true
		}
	}
	return false
}

// installArtifactResponse is what a completed install answers with. It names the version it placed, so the
// operator's view and the marker on disk cannot disagree about which build this was.
type installArtifactResponse struct {
	Status      string `json:"status"`
	ArtifactKey string `json:"artifactKey"`
	Version     string `json:"version"`
	Message     string `json:"message"`
}

// installArtifact installs one entitled artifact at one version. It takes effect at the next stack
// recreate, like every other module the console writes.
func (s *server) installArtifact(w http.ResponseWriter, r *http.Request) {
	// The one handler that can outrun the server-wide WriteTimeout, so it is the one handler that sets its
	// own. net/http arms that deadline when the request headers are read, which makes it the handler's
	// whole wall-clock budget — and this handler makes TWO entitled fetches at entitledTimeout each, plus
	// a signature verification, an extraction and a digest recompute, inside 30 s.
	//
	// The two numbers contradicted each other by construction, which is why this is expressed in terms of
	// entitledTimeout rather than as a figure: content.go chose 60 s so a 3 MiB payload would survive a
	// 420 kbit/s link, and the server could never let a handler spend it. Past 30 s the install still
	// completed on disk and the 200 could no longer be written, so a success reached the browser as a
	// dropped connection with no restart reminder — and worse, an unreachable content service took its
	// full 60 s to fail, so "the content service could not be reached" could never be delivered at all.
	//
	// Per route rather than raising WriteTimeout, which would weaken every other handler. A failure here
	// is not fatal — the install proceeds under the server's deadline, exactly as it did before — so it is
	// logged and not refused.
	const installWriteBudget = 2*entitledTimeout + 60*time.Second
	if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(installWriteBudget)); err != nil {
		s.logger.Error("extending the install response deadline", "err", err)
	}

	var body struct {
		ArtifactKey string `json:"artifactKey"`
		Version     string `json:"version"`
		// Consulted at step 11 and never defaulted true. decodeJSON refuses unknown fields, so this must
		// be declared to be sendable at all — and a field declared but never read would be worse than
		// either, since the operator's explicit "yes" would silently do nothing.
		AllowDowngrade bool `json:"allowDowngrade"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	// After the decode, so a malformed body is answered as one rather than as a busy console.
	if !modulesOps.TryLock() {
		http.Error(w, modulesBusy, http.StatusConflict)
		return
	}
	defer modulesOps.Unlock()

	staged, ref := s.stageArtifact(r.Context(), body.ArtifactKey, body.Version, cloudAccessToken(r))
	if ref != nil {
		http.Error(w, ref.detail, ref.status)
		return
	}
	// From here the staging tree is this request's to remove, on every path out. Refusals before this
	// point clear up after themselves, because until stageArtifact returns there is nothing here to name.
	defer discardStaging(staged.staging)

	if ref := s.placeArtifact(staged, body.AllowDowngrade); ref != nil {
		http.Error(w, ref.detail, ref.status)
		return
	}

	// 14. The same instruction and the same restart banner a content mount raises: an install and a mount
	// both apply at the next recreate, and two reminders would imply two restarts.
	msg := "artifact installed; apply it by recreating the stack: " + platformRestartCommand
	if worldWritableModule(staged.target) {
		msg += ". Warning: a module file in the installed artifact is world-writable, which the platform refuses to load in cloud mode — check how the host mount preserves file permissions"
	}
	writeJSON(w, http.StatusOK, installArtifactResponse{
		Status: "installed", ArtifactKey: staged.key, Version: staged.version, Message: msg,
	})
}

// ── Removal ──────────────────────────────────────────────────────────────────────────────────────

// artifactRemovalConsequence is what removing an installed artifact does to the graph, which the operator
// is owed BEFORE they confirm rather than after. One constant, carried in two places so the two cannot
// disagree: on the modules read, where the panel can show it in the confirmation it asks for, and on the
// removal's own answer, as a receipt of what happens at the next restart.
//
// It is written against what the platform actually runs. A module that is gone at the next start is not
// the orphan-a-class path — that is what happens to a class a still-installed module stopped declaring —
// it is a DETACH DELETE across the module and every class it holds, by both the declared and the orphaned
// edge, which takes every relationship those classes are in rather than any particular kind.
//
// Three properties of the wording are the contract rather than the phrasing: it names the consequence
// before the confirm; it is specific about which half re-installing repairs and which it does not, because
// "not reversible" alone would be false about the data and "reversible" would be false about the links;
// and it does not present removal as undoable.
const artifactRemovalConsequence = "Removing this deletes the classes this module provides — and any it " +
	"once provided — at the next platform restart, together with every link to them, including existing " +
	"analyses' links. Re-installing brings the classes back but not those links. Anything you authored " +
	"that is stored outside those classes is kept, and nothing will be able to read, edit or export it " +
	"until this is installed again."

// removeArtifactResponse is what a completed removal answers with. The consequence is repeated here rather
// than assumed to have been read on the way in: the operator may have arrived from a reload.
type removeArtifactResponse struct {
	Status      string `json:"status"`
	ArtifactKey string `json:"artifactKey"`
	Message     string `json:"message"`
	Consequence string `json:"consequence"`
}

// removeArtifact removes one installed artifact. It mirrors unmountModule and departs from it in exactly
// one row — the ownership question — where it needs three sentences rather than one, so that a module
// installed with the platform is not told the console "did not create" it. The console did not; saying so
// answers a question the operator did not ask, when what they need to know is which surface owns the thing
// they are looking at.
//
// It takes effect at the next stack recreate, and that is not decoration here: a removed module stays
// loaded until then, and the graph consequences fire at that boot rather than at this call.
func (s *server) removeArtifact(w http.ResponseWriter, r *http.Request) {
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		http.Error(w, "artifacts are available only in cloud mode", http.StatusConflict)
		return
	}
	key := r.PathValue("key")
	if !moduleKeyPattern.MatchString(key) {
		http.Error(w, "invalid artifact key", http.StatusBadRequest)
		return
	}
	if key == kgModuleKey {
		// Reserved, and removed by disconnecting rather than from here — so the refusal names the way to
		// remove it instead of claiming this console did not install it. It is also what keeps the
		// knowledge-graph directory out of the ownership switch below, since that mount uses this key as
		// its directory name.
		http.Error(w, "this name is reserved for the knowledge-graph connection, which is removed by disconnecting from the cloud", http.StatusConflict)
		return
	}
	dir, err := moduleDir(s.cfg.ModulesDir, key)
	if err != nil {
		http.Error(w, "invalid artifact key", http.StatusBadRequest)
		return
	}

	// Serialised with installs: this handler's ownership read and its rename are not adjacent, and an
	// install completing in between would have its freshly placed tree renamed away.
	if !modulesOps.TryLock() {
		http.Error(w, modulesBusy, http.StatusConflict)
		return
	}
	defer modulesOps.Unlock()

	// Four cases, three sentences. Lstat rather than Stat for the same reason the install path uses it:
	// with the key a symlink, Stat reports the target and a marker planted behind it reads as ours, and
	// the rename below would move the link while the tree it names survived — reporting a removal that did
	// not happen.
	const notOurs = "this module directory was not installed by the console as an artifact and will not be removed"
	info, statErr := os.Lstat(dir)
	switch {
	case errors.Is(statErr, fs.ErrNotExist):
		http.Error(w, "no artifact is installed under this key", http.StatusNotFound)
		return
	case statErr != nil || !info.Mode().IsDir():
		http.Error(w, notOurs, http.StatusConflict)
		return
	case isArtifactMount(dir):
		// Ours. Proceed.
	case hasOurMarker(dir):
		http.Error(w, "a content mount from the catalog is using this name — unmount it instead", http.StatusConflict)
		return
	case hasMarkerNamed(dir, payloaddigest.StampFilename):
		// A stamp and no artifact marker is a module console-init installed before the platform started —
		// installModules, from initcmd/run.go, in the one-shot that exits before the stack comes up. The
		// platform installs nothing; the operator-facing wording below says "installed WITH the platform",
		// meaning shipped alongside it, which is the true relationship. A stat is enough to choose that
		// wording: the parse-don't-stat rule exists because REMOVING is irreversible, and this removal has
		// already been refused by the time the question is asked.
		http.Error(w, "this module was installed with the platform and is not an artifact this console can remove", http.StatusConflict)
		return
	default:
		http.Error(w, notOurs, http.StatusConflict)
		return
	}

	// Rename-then-delete, in removeModuleTree (cloudteardown.go): partial failure is handled by renaming
	// rather than by ordering the deletes, because os.RemoveAll gives no ordering guarantee and "remove the
	// marker last" is not implementable. THE RENAME IS THE ATOMIC POINT. It lives there rather than here
	// because the disconnect sweep removes the same kind of directory the same way, and two copies of this
	// sequence would be two chances to stop matching.
	leftover, err := removeModuleTree(s.cfg.ModulesDir, key)
	if err != nil {
		s.logger.Error("removing an artifact", "artifact", key, "err", err)
		http.Error(w, "removing the artifact", http.StatusInternalServerError)
		return
	}

	msg := "artifact removed; apply it by recreating the stack: " + platformRestartCommand
	if leftover != "" {
		// The module IS gone — the rename already saw to that — so this is a warning and not a failure.
		// It names the path, because nothing in the daemon clears this one: the install path clears only
		// its own staging directory, Swap's backup is a different name it owns, and the boot sweep is
		// registered after an early return that an offline start takes. What it can no longer do is block
		// anything: the destination is new on every removal, so this leftover is inert until an operator
		// deletes it.
		s.logger.Error("removing the staged copy of an artifact", "artifact", key, "path", leftover)
		msg += ". Warning: the module is gone, but its files could not be deleted and remain at " + leftover
	}
	writeJSON(w, http.StatusOK, removeArtifactResponse{
		Status: "removed", ArtifactKey: key, Message: msg, Consequence: artifactRemovalConsequence,
	})
}
