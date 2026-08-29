package daemoncmd

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const (
	kgVersionA = "sha256:" + "1111111111111111111111111111111111111111111111111111111111111111"
	kgVersionB = "sha256:" + "2222222222222222222222222222222222222222222222222222222222222222"
)

// fakeKg serves the public knowledge-graph version listing. body is written verbatim so a test can
// serve a malformed or recalled listing; if gotAuth is non-nil every request's Authorization header is
// appended to it, so a test can prove no credential is ever sent.
func fakeKg(t *testing.T, body string, gotAuth *[]string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/kg/versions", func(w http.ResponseWriter, r *http.Request) {
		if gotAuth != nil {
			*gotAuth = append(*gotAuth, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
	return httptest.NewServer(mux)
}

// kgListing renders a well-formed listing naming latest, with latest present in the versions array.
func kgListing(latest string) string {
	return `{"latest":"` + latest + `","versions":[{"id":"` + latest + `","releasedAt":"2026-07-18T00:00:00Z"}]}`
}

func TestResolveKgVersionTakesLatestAndSendsNoCredential(t *testing.T) {
	var gotAuth []string
	kg := fakeKg(t, kgListing(kgVersionA), &gotAuth)
	defer kg.Close()

	got, err := resolveKgVersion(context.Background(), kg.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != kgVersionA {
		t.Fatalf("must pin the listing's latest, got %q", got)
	}
	// The listing is public and the console holds an operator credential. Forwarding it to a surface
	// that does not need it is the class this asserts against, not a style preference.
	if len(gotAuth) == 0 {
		t.Fatal("expected the knowledge-graph service to have been called")
	}
	for _, a := range gotAuth {
		if a != "" {
			t.Fatalf("the console must send no token to the knowledge-graph service, got %q", a)
		}
	}
}

func TestResolveKgVersionRefusesWhatItCannotPin(t *testing.T) {
	sixtyThree := "sha256:" + strings.Repeat("a", 63)
	upper := "sha256:" + strings.Repeat("A", 64)
	for _, tc := range []struct {
		name string
		body string
	}{
		// A pin is a digest. "latest" as a literal is the fallback the client refuses on read; the
		// console refuses to write it in the first place.
		{"a moving name", `{"latest":"latest","versions":[]}`},
		{"no versions published", `{"latest":"","versions":[]}`},
		{"a truncated digest", kgListing(sixtyThree)},
		{"uppercase hex", kgListing(upper)},
		{"a bare hash with no algorithm", kgListing(strings.Repeat("a", 64))},
		// Recall exists because something went wrong with a version. Assuming the recall also
		// re-pointed latest is assuming the failure mode away — and a recalled version answers every
		// query with a refusal, so pinning it is a deployment that has a knowledge graph and cannot
		// use it.
		{"a recalled latest", `{"latest":"` + kgVersionA + `","versions":[{"id":"` + kgVersionA + `","recalled":{"reason":"bad slice"}}]}`},
		{"a listing that is not JSON", `not json at all`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			kg := fakeKg(t, tc.body, nil)
			defer kg.Close()
			if v, err := resolveKgVersion(context.Background(), kg.URL); err == nil {
				t.Fatalf("must refuse to pin, got %q", v)
			}
		})
	}
}

func TestResolveKgVersionRefusesAnUnreachableService(t *testing.T) {
	kg := fakeKg(t, kgListing(kgVersionA), nil)
	kg.Close() // closed before the call: nothing is listening
	if _, err := resolveKgVersion(context.Background(), kg.URL); err == nil {
		t.Fatal("an unreachable service must be an error, not an empty pin")
	}
}

func TestMountKgWritesStubAndMarker(t *testing.T) {
	dir := t.TempDir()
	if _, err := mountKg(dir, "2026-08-16T10:00:00Z"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	mountDir := filepath.Join(dir, kgModuleKey)

	// The stub is asserted BY CONTENT — Go cannot execute JavaScript, so this proves the text is the
	// shape the platform's loader and require() need, not that it loads. What it does catch is the
	// two ways the text can be wrong and look fine: the wrong export form, and the wrong class.
	stub, err := os.ReadFile(filepath.Join(mountDir, "KnowledgeGraphModule.js"))
	if err != nil {
		t.Fatalf("the stub must be written under a *Module.js name the loader scans for: %v", err)
	}
	for _, want := range []string{
		"'use strict'",
		"require('@dethernety/dt-module')",
		"DtRemoteKnowledgeGraphModule",
		"exports.default =",
	} {
		if !strings.Contains(string(stub), want) {
			t.Fatalf("the stub must contain %q, got:\n%s", want, stub)
		}
	}
	// Nothing is substituted into this stub, which is why it is a constant and not a template.
	if strings.Contains(string(stub), "%s") {
		t.Fatal("the knowledge-graph stub interpolates nothing")
	}

	m, err := readKgMarker(mountDir)
	if err != nil {
		t.Fatalf("the marker must be written: %v", err)
	}
	if m.Schema != kgMarkerSchema {
		t.Fatalf("marker schema wrong: %q", m.Schema)
	}
	if m.MountedAt != "2026-08-16T10:00:00Z" {
		t.Fatalf("marker mountedAt wrong: %q", m.MountedAt)
	}
	// The pin is deliberately absent here: the mode layer holds the value the platform reads, and a
	// second copy could disagree with it while looking authoritative in the operator's view.
	raw, _ := os.ReadFile(filepath.Join(mountDir, kgMarkerName))
	if strings.Contains(string(raw), "sha256:") {
		t.Fatalf("the marker must not carry a version; the mode layer is the one source: %s", raw)
	}
	// The content inventory is content-only: this directory carries a different marker, so it must
	// not appear there.
	mounts, err := listMounts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 0 {
		t.Fatalf("the knowledge-graph mount must not appear in the content inventory, got %#v", mounts)
	}
}

func TestMountKgOverItsOwnMountSucceeds(t *testing.T) {
	dir := t.TempDir()
	if _, err := mountKg(dir, "2026-08-16T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if _, err := mountKg(dir, "2026-08-16T11:00:00Z"); err != nil {
		t.Fatalf("re-mounting the console's own knowledge-graph mount must succeed, got %v", err)
	}
	m, err := readKgMarker(filepath.Join(dir, kgModuleKey))
	if err != nil || m.MountedAt != "2026-08-16T11:00:00Z" {
		t.Fatalf("the marker must be refreshed, got %#v (%v)", m, err)
	}
}

// The two kinds share a modules directory and, for one key, could share a name. Neither may touch the
// other's directory — which is exactly what the distinct marker names are for.
func TestKgMountAndContentMountNeverTouchEachOther(t *testing.T) {
	foreign := func(t *testing.T, write func(dir string)) string {
		t.Helper()
		modules := t.TempDir()
		dir := filepath.Join(modules, kgModuleKey)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		write(dir)
		return modules
	}
	cases := map[string]func(dir string){
		"a content mount": func(dir string) {
			if err := writeMarkerNamed(dir, mountMarkerName, mountMarker{Schema: mountMarkerSchema, ModuleKey: kgModuleKey, Pin: pinA}); err != nil {
				panic(err)
			}
		},
		"a module with no marker at all": func(string) {},
		// The filename alone is not the claim. A file carrying our name and someone else's schema is
		// not ours, and removing a directory is the irreversible half of this.
		"our marker name carrying another schema": func(dir string) {
			if err := writeMarkerNamed(dir, kgMarkerName, map[string]string{"schema": "someone.else/1"}); err != nil {
				panic(err)
			}
		},
	}
	for name, write := range cases {
		t.Run(name, func(t *testing.T) {
			modules := foreign(t, write)
			if _, err := mountKg(modules, "2026-08-16T10:00:00Z"); err == nil {
				t.Fatal("mount must refuse a directory it did not create as a knowledge-graph mount")
			}
			if err := unmountKg(modules); err == nil {
				t.Fatal("unmount must refuse a directory it did not create as a knowledge-graph mount")
			}
			if _, err := os.Stat(filepath.Join(modules, kgModuleKey)); err != nil {
				t.Fatalf("the refused directory must survive intact: %v", err)
			}
		})
	}
}

func TestUnmountKgRemovesItsOwnAndToleratesNothing(t *testing.T) {
	dir := t.TempDir()
	// Disconnect runs on every deployment, including one that never had a knowledge-graph service.
	if err := unmountKg(dir); err != nil {
		t.Fatalf("unmounting nothing must succeed, got %v", err)
	}
	if _, err := mountKg(dir, "2026-08-16T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := unmountKg(dir); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, kgModuleKey)); !os.IsNotExist(err) {
		t.Fatalf("the mount directory must be gone, got %v", err)
	}
}

// ── The recipe variable ──────────────────────────────────────────────────────────────────────────

func TestCloudModeVarsAcceptsAKnowledgeGraphBaseURL(t *testing.T) {
	recipe := validRecipeVars()
	recipe["MODULE_KG_BASE_URL"] = "https://kg.example.com"
	vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vars["MODULE_KG_BASE_URL"] != "https://kg.example.com" {
		t.Fatalf("the base URL must be copied verbatim, got %q", vars["MODULE_KG_BASE_URL"])
	}
	// The version is NOT this function's to add: resolving it needs a request, and this function is
	// pure so that the set of names it writes is decidable from its arguments alone.
	if v, present := vars["MODULE_KG_VERSION"]; present {
		t.Fatalf("cloudModeVars must not invent a version, got %q", v)
	}
}

func TestCloudModeVarsWithoutKnowledgeGraphVariablesApplies(t *testing.T) {
	// Every recipe issued before the knowledge-graph service existed, and every deployment without
	// one. A required MODULE_KG_BASE_URL would reject all of them wholesale.
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe carrying no knowledge-graph variables must apply, got %v", err)
	}
	for _, name := range []string{"MODULE_KG_BASE_URL", "MODULE_KG_VERSION"} {
		if _, present := vars[name]; present {
			t.Fatalf("%s must not be written when the recipe carries no service", name)
		}
	}
}

func TestCloudModeVarsHoldsTheKnowledgeGraphBaseToSecureURL(t *testing.T) {
	recipe := validRecipeVars()
	recipe["MODULE_KG_BASE_URL"] = "http://kg.example.com"
	if _, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache"); err == nil {
		t.Fatal("a plaintext off-box knowledge-graph service must be rejected")
	}
}

func TestCloudModeVarsDropsAnEmptyKnowledgeGraphBase(t *testing.T) {
	// Empty is not URL-checked (secureURL("") fails, which would reject the recipe), and it is not
	// written either: an empty service base means nothing at all, and writing it would make behaviour
	// depend on how its reader treats an empty string.
	recipe := validRecipeVars()
	recipe["MODULE_KG_BASE_URL"] = ""
	vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("an empty optional URL must not be URL-checked, got %v", err)
	}
	if _, present := vars["MODULE_KG_BASE_URL"]; present {
		t.Fatal("an empty base URL must be dropped, not written")
	}
}

func TestCloudModeVarsRejectsARecipeCarryingTheVersion(t *testing.T) {
	// The version is console-supplied, read from the public listing. A recipe that could carry it
	// could pin a deployment to a version of the sender's choosing.
	recipe := validRecipeVars()
	recipe["MODULE_KG_VERSION"] = kgVersionA
	_, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err == nil || !strings.Contains(err.Error(), "MODULE_KG_VERSION") {
		t.Fatalf("a recipe carrying MODULE_KG_VERSION must be rejected by name, got %v", err)
	}
}

// ── End to end ───────────────────────────────────────────────────────────────────────────────────

// applyBodyWithKg renders an apply request whose recipe names kgBase as the knowledge-graph service.
func applyBodyWithKg(kgBase, redirect string) string {
	var b strings.Builder
	recipe := validRecipeVars()
	recipe["MODULE_KG_BASE_URL"] = kgBase
	names := make([]string, 0, len(recipe))
	for n := range recipe {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		b.WriteString(n)
		b.WriteByte('=')
		b.WriteString(recipe[n])
		b.WriteByte('\n')
	}
	return `{"recipe":` + jsonString(b.String()) + `,"redirectUri":"` + redirect + `"}`
}

// newKgServer stands up a daemon that is NOT yet cloud-configured, so the apply path runs for real.
func newKgServer(t *testing.T) (base, session string, s *server) {
	t.Helper()
	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s = newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	return ts.URL, signIn(t, s), s
}

func TestApplyPinsAndMountsAndDisconnectRemovesBoth(t *testing.T) {
	kg := fakeKg(t, kgListing(kgVersionB), nil)
	defer kg.Close()
	base, sid, s := newKgServer(t)

	code, body := send(t, http.MethodPost, base+"/api/cloud", sid, applyBodyWithKg(kg.URL, "https://front.example/auth/callback"))
	if code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	if !strings.Contains(body, "knowledge-graph connection was mounted") {
		t.Fatalf("the operator must be told a connection was mounted, got %s", body)
	}
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if vars["MODULE_KG_BASE_URL"] != kg.URL {
		t.Fatalf("the base URL must reach the mode layer, got %q", vars["MODULE_KG_BASE_URL"])
	}
	if vars["MODULE_KG_VERSION"] != kgVersionB {
		t.Fatalf("the resolved version must reach the mode layer, got %q", vars["MODULE_KG_VERSION"])
	}
	mountDir := filepath.Join(s.cfg.ModulesDir, kgModuleKey)
	if !isKgMount(mountDir) {
		t.Fatal("apply must write the knowledge-graph mount")
	}

	// The inventory reports the connection, and reports the version the PLATFORM reads.
	code, invBody := get(t, base, "/api/modules", sid)
	if code != http.StatusOK {
		t.Fatalf("modules must be 200, got %d %s", code, invBody)
	}
	var inv modulesResponse
	if err := json.Unmarshal(invBody, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.KnowledgeGraph == nil || inv.KnowledgeGraph.Version != kgVersionB {
		t.Fatalf("the inventory must report the pinned connection, got %s", invBody)
	}
	if len(inv.Modules) != 0 {
		t.Fatalf("the connection must not be reported as a content module, got %s", invBody)
	}

	code, body = send(t, http.MethodDelete, base+"/api/cloud", sid, "")
	if code != http.StatusOK {
		t.Fatalf("disconnect must be 200, got %d %s", code, body)
	}
	if _, err := os.Stat(mountDir); !os.IsNotExist(err) {
		t.Fatalf("disconnect must remove the mount, got %v", err)
	}
	pure, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"MODULE_KG_BASE_URL", "MODULE_KG_VERSION"} {
		if _, present := pure[name]; present {
			t.Fatalf("%s must not survive a disconnect", name)
		}
	}
}

func TestApplySurvivesAnUnreachableKnowledgeGraphService(t *testing.T) {
	// The recipe's job is identity and content. A knowledge-graph service that is momentarily down
	// must cost this deployment its knowledge graph, not its cloud connection — and it must leave
	// ONE state behind, not a half-configured one: a base URL with no pin is inert anyway, and makes
	// the platform log a misconfiguration on every boot about a decision the console made on purpose.
	kg := fakeKg(t, kgListing(kgVersionA), nil)
	kg.Close()
	base, sid, s := newKgServer(t)

	code, body := send(t, http.MethodPost, base+"/api/cloud", sid, applyBodyWithKg(kg.URL, "https://front.example/auth/callback"))
	if code != http.StatusOK {
		t.Fatalf("apply must still succeed, got %d %s", code, body)
	}
	if !strings.Contains(body, "could not be reached") {
		t.Fatalf("the operator must be told the deployment is connected without it, got %s", body)
	}
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		t.Fatal("the deployment must still be cloud-configured")
	}
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"MODULE_KG_BASE_URL", "MODULE_KG_VERSION"} {
		if v, present := vars[name]; present {
			t.Fatalf("%s must not be written when no version could be pinned, got %q", name, v)
		}
	}
	if _, err := os.Stat(filepath.Join(s.cfg.ModulesDir, kgModuleKey)); !os.IsNotExist(err) {
		t.Fatalf("nothing must be mounted without a pin, got %v", err)
	}
}

func TestModulesListNotesAPinWithNoMount(t *testing.T) {
	// Reachable when a mount write failed during an apply, or the directory was removed by hand. The
	// pin alone is configuration nothing reads — surfaced as a note, never as a connection.
	kg := fakeKg(t, kgListing(kgVersionA), nil)
	defer kg.Close()
	base, sid, s := newKgServer(t)
	if code, body := send(t, http.MethodPost, base+"/api/cloud", sid, applyBodyWithKg(kg.URL, "https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	if err := os.RemoveAll(filepath.Join(s.cfg.ModulesDir, kgModuleKey)); err != nil {
		t.Fatal(err)
	}

	_, invBody := get(t, base, "/api/modules", sid)
	var inv modulesResponse
	if err := json.Unmarshal(invBody, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.KnowledgeGraph != nil {
		t.Fatalf("a pin with no mount is not a connection, got %s", invBody)
	}
	if !strings.Contains(inv.Note, "not mounted") {
		t.Fatalf("the half state must be surfaced, got %q", inv.Note)
	}
}

func TestContentMountHandlersReserveTheKnowledgeGraphKey(t *testing.T) {
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, _ := newContentServer(t, content.URL)

	code, body := send(t, http.MethodPost, base+"/api/modules", sid,
		`{"packageKey":"acme-cloud","moduleKey":"`+kgModuleKey+`","pin":"`+pinA+`"}`)
	if code != http.StatusConflict || !strings.Contains(body, "reserved") {
		t.Fatalf("mounting the reserved key must be refused as reserved, got %d %s", code, body)
	}
	code, body = send(t, http.MethodDelete, base+"/api/modules/"+kgModuleKey, sid, "")
	if code != http.StatusConflict || !strings.Contains(body, "reserved") {
		t.Fatalf("unmounting the reserved key must be refused as reserved, got %d %s", code, body)
	}
}

// ── The mount write's order, on this side ────────────────────────────────────────────────────────

// seedKgMountWithoutItsStub writes a complete knowledge-graph mount and then removes the stub, leaving a
// directory the console owns and the platform cannot load from. Both cases below start here: the mount
// must be RE-mountable for the write to be reached at all, so a foreign or absent directory would be
// refused at the ownership gate instead.
func seedKgMountWithoutItsStub(t *testing.T) (modules, dir string) {
	t.Helper()
	modules = t.TempDir()
	if _, err := mountKg(modules, "2026-08-20T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	dir = filepath.Join(modules, kgModuleKey)
	if err := os.Remove(filepath.Join(dir, moduleFileName(kgModuleKey))); err != nil {
		t.Fatal(err)
	}
	return modules, dir
}

func TestMountKgLeavesNoStubWhenTheMarkerFails(t *testing.T) {
	skipIfRoot(t)
	// The content side forces this by putting a DIRECTORY at the marker path. That does not work here:
	// isKgMount parses the marker, so a directory in its place makes the read fail and mountKg refuses
	// at the ownership gate before writing anything. A read-only marker file fails the write instead,
	// with the ownership check still passing.
	modules, dir := seedKgMountWithoutItsStub(t)
	marker := filepath.Join(dir, kgMarkerName)
	if err := os.Chmod(marker, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(marker, 0o644) })

	if _, err := mountKg(modules, "2026-08-20T11:00:00Z"); err == nil {
		t.Fatal("a failed marker write must fail the mount")
	}
	if _, err := os.Stat(filepath.Join(dir, moduleFileName(kgModuleKey))); !os.IsNotExist(err) {
		t.Fatalf("the platform must never see a loadable module the console did not mark, got %v", err)
	}
}

func TestMountKgStubFailureIsUnmountable(t *testing.T) {
	skipIfRoot(t)
	modules, dir := seedKgMountWithoutItsStub(t)
	// 0555 refuses the creation of the stub while leaving the marker — already there — writable.
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	if _, err := mountKg(modules, "2026-08-20T11:00:00Z"); err == nil {
		t.Fatal("a failed stub write must fail the mount")
	}
	if !isKgMount(dir) {
		t.Fatal("a stub failure must leave the directory marked — that is what makes it removable")
	}
	// The point of the ordering on this side: a stub failure no longer strands a directory that
	// disconnect can neither recognise nor remove.
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := unmountKg(modules); err != nil {
		t.Fatalf("disconnect must be able to remove a half-written mount, got %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the directory must be gone, got %v", err)
	}
}

func TestModulesListNotesAMarkedMountWithNoModule(t *testing.T) {
	// The marker is written BEFORE the stub, so marker presence alone is no longer proof of a mount:
	// a stub write that failed during an apply leaves one without the other. A connection is the pin
	// AND something the platform can load, or it is the half state and says so.
	kg := fakeKg(t, kgListing(kgVersionA), nil)
	defer kg.Close()
	base, sid, s := newKgServer(t)
	if code, body := send(t, http.MethodPost, base+"/api/cloud", sid, applyBodyWithKg(kg.URL, "https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	if err := os.Remove(filepath.Join(s.cfg.ModulesDir, kgModuleKey, moduleFileName(kgModuleKey))); err != nil {
		t.Fatal(err)
	}

	_, invBody := get(t, base, "/api/modules", sid)
	var inv modulesResponse
	if err := json.Unmarshal(invBody, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.KnowledgeGraph != nil {
		t.Fatalf("a marker with no loadable module is not a connection, got %s", invBody)
	}
	if !strings.Contains(inv.Note, "not mounted") {
		t.Fatalf("the half state must be surfaced, got %q", inv.Note)
	}
}
