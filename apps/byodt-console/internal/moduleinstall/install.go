// Package moduleinstall holds the sequence that turns a signed module archive into an
// installed module directory: verify, digest, extract, assert layout, recompute the payload
// digest, then swap the result into place without a window where the module is missing.
//
// It exists because that sequence has more than one caller, and the swap half is the one
// place on an operator's disk where two divergent copies of the same logic could leave a
// module directory unrecoverable. Callers differ in how they *obtain* the archive — that is
// deliberately outside this package — but the steps between having the bytes and having the
// module installed are identical, and live here once.
//
// The order of those steps is load-bearing. It decides which failure an operator is told
// about first, and reordering two of them changes that without failing any test.
package moduleinstall

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/dether-net/dethernety-oss/pkg/extract"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// TmpDirName is the transient staging area under the modules directory. It is a
// dot-directory so the loader (which looks for *Module.js inside each subdirectory) finds
// nothing to load in it, and it is removed after every run.
const TmpDirName = ".byodt-console-tmp"

// Verifier authenticates a signed blob against a pinned identity. moduleverify.Verifier
// satisfies it; tests supply a stub so the install flow can be exercised without producing
// real signed bundles.
type Verifier interface {
	VerifyBlob(artifact io.Reader, bundleJSON []byte, certIdentity, certIssuer string) error
}

// ErrNotVerified marks a signature failure specifically, so a caller can escalate it to a
// security event while treating every other staging failure as an ordinary install failure.
// It is wrapped rather than returned bare, so the message a caller surfaces is unchanged and
// errors.Is is what distinguishes the case.
var ErrNotVerified = errors.New("did not verify")

// Stage verifies, digests, extracts and asserts layout, then recomputes the payload digest
// and requires the in-payload stamp to agree with it. On success it returns the payload root
// inside tmpDir and the stamp the archive carried.
//
// It writes nothing outside tmpDir. That property depends on key being a validated module
// key — it names a directory inside the extracted tree — so Stage validates it here rather
// than trusting a caller to have done it. pkg/extract states the same pairing: confinement is
// to the destination the caller passes, and the key that names that destination is validated
// separately; together they keep extraction inside the intended directory. Splitting those
// two lines across a package boundary is exactly how such a pairing gets lost, so it is not
// split.
//
// tmpDir is the staging directory itself, not a parent to join key onto. Callers stage into
// a per-key directory and pass the whole path.
func Stage(archive, bundleJSON []byte, v Verifier, identity, issuer, expectedDigest, key, tmpDir string) (payloadRoot string, stamp payloaddigest.Stamp, err error) {
	if err := extract.ValidateModuleKey(key); err != nil {
		return "", payloaddigest.Stamp{}, err
	}

	if err := v.VerifyBlob(bytes.NewReader(archive), bundleJSON, identity, issuer); err != nil {
		return "", payloaddigest.Stamp{}, fmt.Errorf("%w: %v", ErrNotVerified, err)
	}

	sum := sha256.Sum256(archive)
	if got := "sha256:" + hex.EncodeToString(sum[:]); got != expectedDigest {
		return "", payloaddigest.Stamp{}, fmt.Errorf("asset digest mismatch: expected %s, got %s", expectedDigest, got)
	}

	if err := os.RemoveAll(tmpDir); err != nil {
		return "", payloaddigest.Stamp{}, fmt.Errorf("clearing temp: %v", err)
	}
	if err := extract.TarGz(bytes.NewReader(archive), tmpDir, extract.Limits{}); err != nil {
		return "", payloaddigest.Stamp{}, fmt.Errorf("extract: %v", err)
	}

	payloadRoot = filepath.Join(tmpDir, "dethernety", key)
	if info, err := os.Stat(payloadRoot); err != nil || !info.IsDir() {
		return "", payloaddigest.Stamp{}, fmt.Errorf("unexpected layout: no dethernety/%s in archive", key)
	}

	// Recompute over the extracted tree and require the incoming stamp to agree — the
	// stamp is signed with the archive, so this catches a stamp that does not describe its
	// own payload.
	computed, err := payloaddigest.Compute(payloadRoot)
	if err != nil {
		return "", payloaddigest.Stamp{}, fmt.Errorf("computing payload digest: %v", err)
	}
	read, err := payloaddigest.ReadStamp(filepath.Join(payloadRoot, payloaddigest.StampFilename))
	if err != nil {
		return "", payloaddigest.Stamp{}, fmt.Errorf("reading stamp: %v", err)
	}
	if read.PayloadDigest != computed {
		return "", payloaddigest.Stamp{}, fmt.Errorf("stamp integrity: stamp %s, recomputed %s", read.PayloadDigest, computed)
	}
	return payloadRoot, *read, nil
}

// Swap moves payloadRoot into target without a window where the module is missing: any
// existing copy is renamed aside to backup, the new copy is renamed in, and if that second
// rename fails the old copy is restored — so a failed install never leaves the module absent.
//
// THE BACKUP PATH IS THIS FUNCTION'S, from the moment it is passed until it returns. Swap
// removes it on success and never on failure, because this is the only code that can tell
// which of two things that path holds: a leftover the install has finished with, or the last
// surviving copy of what the deployment had before. A caller that cleans up unconditionally
// deletes it on exactly the path where it is the second.
//
// priorCopyKept reports that case: a copy WAS moved aside and could NOT be restored, so the
// module is absent from target and the only copy is at backup. It is false everywhere else,
// including the ordinary restore, so a caller can name the surviving path without having to
// claim one exists. That branch needs a rename to fail while the restore of the same path also
// fails, which no test can force — both renames address the same two parent directories, so a
// target-side failure dooms both and a source-side one leaves the restore working. The false
// side is what the tests pin.
//
// mayReplace, when non-nil, is consulted with the target path before anything is touched, and
// its error refuses the swap with the filesystem exactly as it was. nil means the caller has
// already established that it owns whatever is at target.
//
// target, payloadRoot and backup must be on the same filesystem: this is os.Rename, which
// gives EXDEV across devices. That was self-evident while all three were one directory tree
// and is worth stating now that the caller chooses them.
func Swap(target, payloadRoot, backup string, mayReplace func(target string) error) (priorCopyKept bool, err error) {
	// Before the stale-backup clear, not merely before the move-aside: a refusal must leave
	// nothing changed, and removing a stale backup would be a change.
	if mayReplace != nil {
		if err := mayReplace(target); err != nil {
			return false, err
		}
	}

	_ = os.RemoveAll(backup) // clear any stale backup from a previous crash

	movedAside := false
	if _, err := os.Lstat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return false, fmt.Errorf("moving existing module aside: %v", err)
		}
		movedAside = true
	}
	if err := os.Rename(payloadRoot, target); err != nil {
		if movedAside {
			if rerr := os.Rename(backup, target); rerr != nil {
				// The module is absent and backup holds the only copy. Say so rather than
				// letting a caller's cleanup decide.
				return true, fmt.Errorf("installing module: %v", err)
			}
		}
		return false, fmt.Errorf("installing module: %v", err)
	}
	// The rename above is the atomic point, so by here the install HAS happened. This removal is
	// deliberately unchecked: returning a cleanup failure would report a placed module as unplaced,
	// and the worst a failure leaves is a directory the next install of this key clears at the top
	// of this function.
	_ = os.RemoveAll(backup)
	return false, nil
}
