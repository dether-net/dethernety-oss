package daemoncmd

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// plantDir creates a module directory holding one marker file plus a loadable-looking module file, so a
// removal has something to remove and a survivor has something to still be there.
func plantDir(t *testing.T, modulesDir, key, markerName string) string {
	t.Helper()
	dir := filepath.Join(modulesDir, key)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if markerName != "" {
		if err := os.WriteFile(filepath.Join(dir, markerName), []byte(`{"schema":"x"}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "AModule.js"), []byte("//"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// disconnectOn runs a real DELETE /api/cloud against a server whose modules directory is dir, and returns
// the response body. The deployment is put into cloud posture first, because that is the only state a
// disconnect happens from.
func disconnectOn(t *testing.T, modulesDir string) string {
	t.Helper()
	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = modulesDir
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	sid := signIn(t, s)

	if code, body := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	code, body := send(t, http.MethodDelete, ts.URL+"/api/cloud", sid, "")
	if code != http.StatusOK {
		t.Fatalf("disconnect must be 200, got %d %s", code, body)
	}
	if isCloudModeFile(s.cfg.ModeLayerPath) {
		t.Fatal("disconnect must leave the pure-OSS mode file")
	}
	return body
}

// The whole point of the change: a disconnect takes every module the cloud connection put there, and
// nothing else. All three kinds go; the platform's own modules and anything the console did not write stay.
func TestDisconnectRemovesEveryCloudModuleAndNothingElse(t *testing.T) {
	modules := t.TempDir()
	mount := plantDir(t, modules, "aws-iot", mountMarkerName)
	artifact := plantDir(t, modules, "acme-risk", artifactMarkerName)
	kg := plantDir(t, modules, kgModuleKey, kgMarkerName)
	shipped := plantDir(t, modules, "dethernety-general", payloaddigest.StampFilename)
	foreign := plantDir(t, modules, "hand-placed", "")

	body := disconnectOn(t, modules)

	for _, d := range []string{mount, artifact, kg} {
		if exists(d) {
			t.Errorf("%s is cloud-provided and must be removed by a disconnect", filepath.Base(d))
		}
	}
	// The two a disconnect must never touch. The stamped one is the platform's own; the unmarked one the
	// console never wrote, and deleting either would be deleting something it does not own.
	for _, d := range []string{shipped, foreign} {
		if !exists(d) {
			t.Errorf("%s was not written by the console and must survive a disconnect", filepath.Base(d))
		}
	}
	// The operator is told what went, by key and by kind — the kinds cost very different amounts to restore.
	for _, want := range []string{"aws-iot (content mount)", "acme-risk (artifact)", kgModuleKey + " (knowledge-graph connection)"} {
		if !strings.Contains(body, want) {
			t.Errorf("the disconnect message must name %q, got %s", want, body)
		}
	}
}

// Claimed by two kinds at once, so claimed by neither — the rule listArtifacts already applies at its own
// read. A disconnect is the wrong place to resolve an ambiguity nothing else resolves.
func TestDisconnectSkipsADirectoryClaimedByTwoKinds(t *testing.T) {
	modules := t.TempDir()
	both := plantDir(t, modules, "confused", mountMarkerName)
	if err := os.WriteFile(filepath.Join(both, artifactMarkerName), []byte(`{"schema":"x"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	disconnectOn(t, modules)

	if !exists(both) {
		t.Fatal("a directory carrying two ownership markers must be left alone")
	}
}

// The revert is the recovery path. A modules directory it cannot act on must cost the operator files left
// behind, never the disconnect itself.
func TestDisconnectStillRevertsWhenAModuleCannotBeRemoved(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores the directory mode this test relies on")
	}
	modules := t.TempDir()
	stuck := plantDir(t, modules, "stuck", mountMarkerName)
	// 0555 refuses the rename out of the parent, which is the failure removeModuleTree reports.
	if err := os.Chmod(modules, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(modules, 0o755) })

	body := disconnectOn(t, modules) // asserts 200 and the pure-OSS file itself

	if !exists(stuck) {
		t.Fatal("the test needs the removal to have failed")
	}
	if !strings.Contains(body, "could not be removed") {
		t.Errorf("a failed removal must be reported to the operator, got %s", body)
	}
}

// Same rule, different blocker: an install or a removal in flight holds modulesOps, and a disconnect takes
// it with TryLock rather than waiting. The revert proceeds and says what it skipped.
func TestDisconnectRevertsWithoutTheModulesLock(t *testing.T) {
	modules := t.TempDir()
	mount := plantDir(t, modules, "aws-iot", mountMarkerName)

	modulesOps.Lock()
	body := disconnectOn(t, modules)
	modulesOps.Unlock()

	if !exists(mount) {
		t.Fatal("the sweep must be skipped while another modules operation holds the lock")
	}
	if !strings.Contains(body, "another modules operation was running") {
		t.Errorf("the operator must be told why the modules were left, got %s", body)
	}
}

// cloudMounts is what both the sweep and any future confirmation read. It answers on ownership alone.
func TestCloudMountsNamesOnlyWhatTheConsoleWrote(t *testing.T) {
	modules := t.TempDir()
	plantDir(t, modules, "b-mount", mountMarkerName)
	plantDir(t, modules, "a-artifact", artifactMarkerName)
	plantDir(t, modules, "shipped", payloaddigest.StampFilename)
	plantDir(t, modules, "bare", "")
	if err := os.WriteFile(filepath.Join(modules, ".byodt-console-state.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := cloudMounts(modules)

	// Sorted by key, so the operator reads a stable order rather than the filesystem's.
	if len(got) != 2 || got[0].Key != "a-artifact" || got[1].Key != "b-mount" {
		t.Fatalf("expected the artifact then the mount, got %#v", got)
	}
	if got[0].Kind != kindArtifact || got[1].Kind != kindContentMount {
		t.Fatalf("kinds are wrong: %#v", got)
	}
}

// The helper recursively deletes a directory it is handed the name of, so it refuses a key that would
// resolve anywhere but directly inside the modules mount — regardless of what its callers checked.
func TestRemoveModuleTreeRefusesAKeyThatEscapesTheModulesMount(t *testing.T) {
	modules := t.TempDir()
	outside := filepath.Join(filepath.Dir(modules), "outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"../outside", "a/b", ".."} {
		if _, err := removeModuleTree(modules, key); err == nil {
			t.Errorf("removeModuleTree(%q) must refuse a path outside the modules mount", key)
		}
	}
	if !exists(outside) {
		t.Fatal("nothing outside the modules mount may be removed")
	}
}
