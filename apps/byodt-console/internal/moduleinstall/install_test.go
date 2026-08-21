package moduleinstall

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall/moduleinstalltest"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// stagingDir returns a pre-created staging directory and its parent. Pre-creating matters:
// extract.TarGz does MkdirAll on its destination, so a test that snapshots the parent to
// prove containment would otherwise see the staging directory itself appear and call that
// an escape.
func stagingDir(t *testing.T) (tmpDir, parent string) {
	t.Helper()
	parent = t.TempDir()
	tmpDir = filepath.Join(parent, TmpDirName, "mod-a")
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return tmpDir, parent
}

// snapshot lists every path under root, relative and sorted, so two snapshots compare as
// strings.
func snapshot(t *testing.T, root string) string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		out = append(out, rel)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(out)
	return strings.Join(out, "\n")
}

func TestStageHappyPath(t *testing.T) {
	tarball, digest, _ := moduleinstalltest.BuildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})
	tmpDir, _ := stagingDir(t)

	payloadRoot, stamp, err := Stage(tarball, []byte("b"), moduleinstalltest.FakeVerifier{}, "id", "issuer", digest, "mod-a", tmpDir)
	if err != nil {
		t.Fatalf("happy path must stage: %v", err)
	}
	if want := filepath.Join(tmpDir, "dethernety", "mod-a"); payloadRoot != want {
		t.Fatalf("payload root: got %q want %q", payloadRoot, want)
	}
	if stamp.Name != "mod-a" || stamp.Version != "1.0.0" {
		t.Fatalf("stamp not returned: %+v", stamp)
	}
	if _, err := os.Stat(filepath.Join(payloadRoot, "AMod.js")); err != nil {
		t.Fatalf("payload not extracted: %v", err)
	}
}

// TestStageRefusals drives every failure the sequence can produce, and asserts each says its
// own thing. The ORDER these appear in is the order Stage checks them; a refactor that
// reorders two steps changes which message an operator sees first and is caught here only if
// the reader is paying attention — hence the explicit note.
func TestStageRefusals(t *testing.T) {
	goodTarball, goodDigest, _ := moduleinstalltest.BuildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})

	// A tarball whose payload sits at the archive root rather than under dethernety/mod-a/.
	layoutTmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(layoutTmp, "AMod.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	layoutTarball := moduleinstalltest.TarGzDir(t, layoutTmp)
	layoutSum := sha256.Sum256(layoutTarball)

	// A tarball whose stamp claims a digest its payload does not have.
	stampTmp := t.TempDir()
	stampPayload := filepath.Join(stampTmp, "dethernety", "mod-a")
	if err := os.MkdirAll(stampPayload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stampPayload, "AMod.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	badStamp := `{"name":"mod-a","version":"1.0.0","builtFrom":null,"payloadDigest":"sha256:` + strings.Repeat("0", 64) + "\"}\n"
	if err := os.WriteFile(filepath.Join(stampPayload, payloaddigest.StampFilename), []byte(badStamp), 0o644); err != nil {
		t.Fatal(err)
	}
	stampTarball := moduleinstalltest.TarGzDir(t, stampTmp)
	stampSum := sha256.Sum256(stampTarball)

	for _, tc := range []struct {
		name     string
		archive  []byte
		v        Verifier
		digest   string
		key      string
		wantMsg  string
		wantVeri bool
	}{
		{
			name:    "invalid key",
			archive: goodTarball, v: moduleinstalltest.FakeVerifier{}, digest: goodDigest,
			key: "../escape", wantMsg: "module key",
		},
		{
			name:    "verify failure",
			archive: goodTarball, v: moduleinstalltest.FakeVerifier{Err: errors.New("no matching identity")},
			digest: goodDigest, key: "mod-a",
			wantMsg: "did not verify", wantVeri: true,
		},
		{
			name:    "digest mismatch",
			archive: goodTarball, v: moduleinstalltest.FakeVerifier{},
			digest: "sha256:" + strings.Repeat("0", 64), key: "mod-a",
			wantMsg: "asset digest mismatch",
		},
		{
			name:    "not a tarball",
			archive: []byte("not gzip at all"), v: moduleinstalltest.FakeVerifier{},
			digest: func() string {
				s := sha256.Sum256([]byte("not gzip at all"))
				return "sha256:" + hex.EncodeToString(s[:])
			}(),
			key: "mod-a", wantMsg: "extract",
		},
		{
			name:    "unexpected layout",
			archive: layoutTarball, v: moduleinstalltest.FakeVerifier{},
			digest: "sha256:" + hex.EncodeToString(layoutSum[:]), key: "mod-a",
			wantMsg: "unexpected layout",
		},
		{
			name:    "stamp integrity",
			archive: stampTarball, v: moduleinstalltest.FakeVerifier{},
			digest: "sha256:" + hex.EncodeToString(stampSum[:]), key: "mod-a",
			wantMsg: "stamp integrity",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir, _ := stagingDir(t)
			_, _, err := Stage(tc.archive, []byte("b"), tc.v, "id", "issuer", tc.digest, tc.key, tmpDir)
			if err == nil {
				t.Fatalf("%s must refuse", tc.name)
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Fatalf("message should name the failure: got %q want substring %q", err, tc.wantMsg)
			}
			// The sentinel is behaviour, not decoration: it is the only thing that tells a
			// caller to raise a signature failure to a security event.
			if got := errors.Is(err, ErrNotVerified); got != tc.wantVeri {
				t.Fatalf("errors.Is(ErrNotVerified) = %v, want %v (err: %v)", got, tc.wantVeri, err)
			}
		})
	}
}

// TestStageMessagePreserved pins the one message whose exact bytes a caller depends on: the
// sentinel is wrapped rather than returned bare precisely so this reads the same as it did
// before the wrap existed.
func TestStageMessagePreserved(t *testing.T) {
	tarball, digest, _ := moduleinstalltest.BuildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})
	tmpDir, _ := stagingDir(t)
	inner := errors.New("no matching identity")

	_, _, err := Stage(tarball, []byte("b"), moduleinstalltest.FakeVerifier{Err: inner}, "id", "issuer", digest, "mod-a", tmpDir)
	if want := fmt.Sprintf("did not verify: %v", inner); err.Error() != want {
		t.Fatalf("message changed: got %q want %q", err, want)
	}
}

// TestStageWritesNothingOutsideTmpDir is the property the package's doc comment claims, and
// it is asserted rather than reasoned about — on the failure paths too, because a refusal
// that leaves debris outside its staging area is the case nobody would notice.
func TestStageWritesNothingOutsideTmpDir(t *testing.T) {
	goodTarball, goodDigest, _ := moduleinstalltest.BuildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})

	for _, tc := range []struct {
		name    string
		v       Verifier
		digest  string
		key     string
		wantErr bool
	}{
		{name: "happy path", v: moduleinstalltest.FakeVerifier{}, digest: goodDigest, key: "mod-a"},
		{name: "traversal key", v: moduleinstalltest.FakeVerifier{}, digest: goodDigest, key: "../../escape", wantErr: true},
		{name: "verify failure", v: moduleinstalltest.FakeVerifier{Err: errors.New("nope")}, digest: goodDigest, key: "mod-a", wantErr: true},
		{name: "digest mismatch", v: moduleinstalltest.FakeVerifier{}, digest: "sha256:" + strings.Repeat("0", 64), key: "mod-a", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir, parent := stagingDir(t)
			// Something outside the staging area that must survive untouched.
			sibling := filepath.Join(parent, "operator-owned")
			if err := os.MkdirAll(sibling, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(sibling, "keep.txt"), []byte("mine"), 0o644); err != nil {
				t.Fatal(err)
			}

			before := snapshot(t, sibling)
			parentEntries := func() []string {
				entries, err := os.ReadDir(parent)
				if err != nil {
					t.Fatal(err)
				}
				var names []string
				for _, e := range entries {
					names = append(names, e.Name())
				}
				sort.Strings(names)
				return names
			}
			beforeParent := parentEntries()

			_, _, err := Stage(goodTarball, []byte("b"), tc.v, "id", "issuer", tc.digest, tc.key, tmpDir)
			if tc.wantErr != (err != nil) {
				t.Fatalf("wantErr=%v got err=%v", tc.wantErr, err)
			}

			if got := snapshot(t, sibling); got != before {
				t.Fatalf("Stage touched a sibling tree:\nbefore:\n%s\nafter:\n%s", before, got)
			}
			if got := parentEntries(); strings.Join(got, ",") != strings.Join(beforeParent, ",") {
				t.Fatalf("Stage changed tmpDir's parent: before %v after %v", beforeParent, got)
			}
		})
	}
}

// placeTree writes a one-file directory so a test can tell two trees apart by content.
func placeTree(t *testing.T, dir, marker string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Mod.js"), []byte(marker), 0o644); err != nil {
		t.Fatal(err)
	}
}

func markerOf(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "Mod.js"))
	if err != nil {
		t.Fatalf("reading %s: %v", dir, err)
	}
	return string(b)
}

func TestSwapReplacesExistingTree(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	backup := filepath.Join(root, "staging", "mod-a.old")
	placeTree(t, target, "old")
	placeTree(t, payloadRoot, "new")

	if _, err := Swap(target, payloadRoot, backup, nil); err != nil {
		t.Fatalf("swap should succeed: %v", err)
	}
	if got := markerOf(t, target); got != "new" {
		t.Fatalf("target not replaced: %q", got)
	}
}

func TestSwapPlacesWhenNoExistingTree(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	placeTree(t, payloadRoot, "new")

	if _, err := Swap(target, payloadRoot, filepath.Join(root, "staging", "mod-a.old"), nil); err != nil {
		t.Fatalf("swap onto an absent target should succeed: %v", err)
	}
	if got := markerOf(t, target); got != "new" {
		t.Fatalf("target not placed: %q", got)
	}
}

// TestSwapRestoresOnFailure is the property the whole dance exists for: a failed install must
// never leave the module absent.
//
// The second rename is made to fail by pointing payloadRoot at a path that does not exist, so
// the first rename succeeds and the second returns ENOENT. Do NOT try to force this by making
// the target's parent unwritable — os.Rename(target, backup) removes an entry from that same
// parent, so it is the FIRST rename that fails and the restore path is never reached. A
// permission trick would also pass vacuously if the suite ever ran as root.
func TestSwapRestoresOnFailure(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	backup := filepath.Join(root, "staging", "mod-a.old")
	placeTree(t, target, "old")
	if err := os.MkdirAll(filepath.Dir(backup), 0o755); err != nil {
		t.Fatal(err)
	}

	priorCopyKept, err := Swap(target, filepath.Join(root, "staging", "does-not-exist"), backup, nil)
	if err == nil {
		t.Fatal("swap must fail when the payload is not there")
	}
	if !strings.Contains(err.Error(), "installing module") {
		t.Fatalf("message should name the failing step: %v", err)
	}
	if got := markerOf(t, target); got != "old" {
		t.Fatalf("the prior copy must be restored, got %q", got)
	}
	// The false side of priorCopyKept, which is the side a test can reach. It is what stops a caller
	// telling an operator a copy was stranded when the restore in fact put it back — and the true side,
	// by construction, needs the restore of the same path to fail for a reason the rename-in did not
	// already suffer, which no fixture can arrange.
	if priorCopyKept {
		t.Fatal("a swap whose restore succeeded must not report a kept prior copy")
	}
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Fatalf("the restore renames the backup away, so nothing must remain at it: %v", err)
	}
}

func TestSwapRemovesTheBackupOnSuccess(t *testing.T) {
	// The backup is Swap's, not its caller's: a caller that cleaned up unconditionally would delete it on
	// the one path where it is the last copy of what was installed. Swap therefore removes it here, and
	// only here — on the success path, where it is certainly a leftover.
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	backup := filepath.Join(root, "staging", "mod-a.old")
	placeTree(t, target, "old")
	placeTree(t, payloadRoot, "new")

	priorCopyKept, err := Swap(target, payloadRoot, backup, nil)
	if err != nil {
		t.Fatalf("swap should succeed: %v", err)
	}
	if priorCopyKept {
		t.Fatal("a successful swap strands nothing")
	}
	if got := markerOf(t, target); got != "new" {
		t.Fatalf("target not replaced: %q", got)
	}
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Fatalf("the moved-aside copy must be gone once the swap has succeeded: %v", err)
	}
}

func TestSwapSucceedsEvenWhenTheBackupCannotBeDeleted(t *testing.T) {
	// The success-path removal of the backup is unchecked ON PURPOSE. The rename above it is the atomic
	// point, so by the time it runs the module IS installed — returning a cleanup failure here would make
	// a placed artifact answer "could not be placed", which is the opposite of the truth and would send an
	// operator looking for a module that is already there.
	if os.Geteuid() == 0 {
		t.Skip("root ignores the permission bits this test depends on")
	}
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	backup := filepath.Join(root, "staging", "mod-a.old")
	placeTree(t, target, "old")
	placeTree(t, payloadRoot, "new")
	// Undeletable from INSIDE, so the move-aside rename still works and only the cleanup cannot finish.
	sub := filepath.Join(target, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "file"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Both paths, because the rename may or may not have happened when an assertion fails — and a 0555
	// directory left behind fails t.TempDir's own teardown, in a test that has nothing to do with this one.
	t.Cleanup(func() {
		_ = os.Chmod(sub, 0o755)
		_ = os.Chmod(filepath.Join(backup, "sub"), 0o755)
	})
	if err := os.Chmod(sub, 0o555); err != nil {
		t.Fatal(err)
	}

	priorCopyKept, err := Swap(target, payloadRoot, backup, nil)
	if err != nil {
		t.Fatalf("a cleanup failure must not fail an install that has already happened: %v", err)
	}
	if priorCopyKept {
		t.Fatal("the swap succeeded, so nothing was stranded")
	}
	if got := markerOf(t, target); got != "new" {
		t.Fatalf("target not replaced: %q", got)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("the undeletable copy is what the test is about, so it must still be there: %v", err)
	}
}

func TestSwapMayReplaceRefusesBeforeTouchingAnything(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	backup := filepath.Join(root, "staging", "mod-a.old")
	placeTree(t, target, "old")
	placeTree(t, payloadRoot, "new")
	// A stale backup from a previous crash: a refusal must not clear it either, because a
	// refusal that changes the filesystem is not a refusal.
	placeTree(t, backup, "stale")

	refuse := errors.New("not yours to replace")
	_, err := Swap(target, payloadRoot, backup, func(string) error { return refuse })
	if !errors.Is(err, refuse) {
		t.Fatalf("mayReplace's error should surface unchanged, got %v", err)
	}
	if got := markerOf(t, target); got != "old" {
		t.Fatalf("target must be untouched, got %q", got)
	}
	if got := markerOf(t, backup); got != "stale" {
		t.Fatalf("a refusal must not clear the stale backup, got %q", got)
	}
	if got := markerOf(t, payloadRoot); got != "new" {
		t.Fatalf("payload must be untouched, got %q", got)
	}
}

func TestSwapMayReplaceReceivesTargetAndCanAllow(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "mod-a")
	payloadRoot := filepath.Join(root, "staging", "mod-a")
	placeTree(t, target, "old")
	placeTree(t, payloadRoot, "new")

	var saw string
	if _, err := Swap(target, payloadRoot, filepath.Join(root, "staging", "mod-a.old"), func(p string) error {
		saw = p
		return nil
	}); err != nil {
		t.Fatalf("an allowing mayReplace should proceed: %v", err)
	}
	if saw != target {
		t.Fatalf("mayReplace should be consulted with the target: got %q want %q", saw, target)
	}
	if got := markerOf(t, target); got != "new" {
		t.Fatalf("target not replaced: %q", got)
	}
}
