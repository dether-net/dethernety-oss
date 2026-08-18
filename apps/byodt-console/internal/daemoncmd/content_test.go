package daemoncmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	pinA = "sha256:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	pinB = "sha256:" + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

// fakePkg describes one package the fake content service serves. noDoc makes the version-document
// endpoint 404 for this package while it still appears in the package list — the per-package
// resolution-failure case.
type fakePkg struct {
	key     string
	name    string
	latest  string
	modules []catalogModuleEntry
	noDoc   bool
}

// fakeContent serves the two public catalog endpoints. If gotAuth is non-nil, every request's
// Authorization header is appended to it, so a test can prove no token is ever sent.
func fakeContent(t *testing.T, pkgs []fakePkg, gotAuth *[]string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/catalog/packages", func(w http.ResponseWriter, r *http.Request) {
		if gotAuth != nil {
			*gotAuth = append(*gotAuth, r.Header.Get("Authorization"))
		}
		summaries := make([]map[string]any, 0, len(pkgs))
		for _, p := range pkgs {
			summaries = append(summaries, map[string]any{"key": p.key, "name": p.name, "latest": p.latest})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"packages": summaries})
	})
	mux.HandleFunc("GET /v1/catalog/packages/{key}/versions/{version}", func(w http.ResponseWriter, r *http.Request) {
		if gotAuth != nil {
			*gotAuth = append(*gotAuth, r.Header.Get("Authorization"))
		}
		for _, p := range pkgs {
			if p.key == r.PathValue("key") {
				if p.noDoc {
					http.Error(w, "not found", http.StatusNotFound)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"version": p.latest, "modules": p.modules})
				return
			}
		}
		http.Error(w, "not found", http.StatusNotFound)
	})
	return httptest.NewServer(mux)
}

// seedCloudContentFile writes an applied cloud mode file whose MODULE_CONTENT_BASE_URL points at the
// fake content service — the destination the content routes read (never the request).
func seedCloudContentFile(t *testing.T, path, contentBase string) {
	t.Helper()
	recipe := validRecipeVars()
	recipe["MODULE_CONTENT_BASE_URL"] = contentBase
	vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeModeLayer(path, vars); err != nil {
		t.Fatal(err)
	}
}

// newContentServer builds a running test server in cloud mode with a modules directory and the content
// base pointed at contentBase. It returns the running server URL, a session, and the modules directory.
func newContentServer(t *testing.T, contentBase string) (base, session, modulesDir string) {
	t.Helper()
	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	seedCloudContentFile(t, s.cfg.ModeLayerPath, contentBase)
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	return ts.URL, signIn(t, s), s.cfg.ModulesDir
}

func TestPackagesAssemblesCatalog(t *testing.T) {
	var gotAuth []string
	content := fakeContent(t, []fakePkg{{
		key: "acme-cloud", name: "Acme Cloud", latest: "20260101.1",
		modules: []catalogModuleEntry{
			{Key: "acme-compute", Name: "Acme Compute", Version: "1.4.0", ContentHash: pinA},
			{Key: "acme-storage", Name: "Acme Storage", Version: "0.9.2", ContentHash: pinB},
		},
	}}, &gotAuth)
	defer content.Close()

	base, sid, _ := newContentServer(t, content.URL)
	code, body := get(t, base, "/api/packages", sid)
	if code != http.StatusOK {
		t.Fatalf("packages must be 200, got %d %s", code, body)
	}
	for _, want := range []string{"acme-cloud", "acme-compute", "acme-storage", pinA, pinB} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("catalog must contain %q, got %s", want, body)
		}
	}
	// The catalog is public: no request to the content service may carry an Authorization header.
	for _, a := range gotAuth {
		if a != "" {
			t.Fatalf("the console must send no token to the content service, got %q", a)
		}
	}
	if len(gotAuth) == 0 {
		t.Fatal("expected the content service to have been called")
	}
}

func TestPackagesMarksEntitlement(t *testing.T) {
	content := fakeContent(t, []fakePkg{
		{key: "acme-cloud", name: "Acme Cloud", latest: "20260101.1", modules: []catalogModuleEntry{{Key: "acme-compute", ContentHash: pinA}}},
		{key: "other-pkg", name: "Other", latest: "1", modules: []catalogModuleEntry{{Key: "other-mod", ContentHash: pinB}}},
	}, nil)
	defer content.Close()

	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)

	// writeMode rewrites the cloud mode file with a given DEPLOYMENT_PACKAGES value; packages==nil omits
	// the key entirely (a recipe predating the variable). Mirrors how a pasted recipe reaches the console.
	writeMode := func(packages *string) {
		recipe := validRecipeVars()
		recipe["MODULE_CONTENT_BASE_URL"] = content.URL
		if packages != nil {
			recipe["DEPLOYMENT_PACKAGES"] = *packages
		}
		vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
		if err != nil {
			t.Fatal(err)
		}
		if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
			t.Fatal(err)
		}
	}
	sid := signIn(t, s) // the gate is read from the mode file, not the session

	entitledFor := func(body []byte) map[string]*bool {
		var resp struct {
			Packages []struct {
				Key      string `json:"key"`
				Entitled *bool  `json:"entitled"`
			} `json:"packages"`
		}
		if err := json.Unmarshal(body, &resp); err != nil {
			t.Fatalf("decoding packages: %v (%s)", err, body)
		}
		out := map[string]*bool{}
		for _, p := range resp.Packages {
			out[p.Key] = p.Entitled
		}
		return out
	}

	// Subscribed to acme-cloud only → it is entitled=true, the other entitled=false.
	sub := "acme-cloud"
	writeMode(&sub)
	code, body := get(t, ts.URL, "/api/packages", sid)
	if code != http.StatusOK {
		t.Fatalf("packages must be 200, got %d %s", code, body)
	}
	got := entitledFor(body)
	if got["acme-cloud"] == nil || !*got["acme-cloud"] {
		t.Fatalf("subscribed package must be entitled=true, got %s", body)
	}
	if got["other-pkg"] == nil || *got["other-pkg"] {
		t.Fatalf("unsubscribed package must be entitled=false, got %s", body)
	}

	// Present-empty (a lapsed subscription) is known → every package is entitled=false, not undetermined.
	empty := ""
	writeMode(&empty)
	_, body = get(t, ts.URL, "/api/packages", sid)
	got = entitledFor(body)
	for _, k := range []string{"acme-cloud", "other-pkg"} {
		if got[k] == nil || *got[k] {
			t.Fatalf("with an empty subscription %q must be entitled=false, got %s", k, body)
		}
	}

	// Absent (a recipe predating the variable) is undetermined → the flag is omitted, never gated.
	writeMode(nil)
	_, body = get(t, ts.URL, "/api/packages", sid)
	if strings.Contains(string(body), `"entitled"`) {
		t.Fatalf("undetermined entitlement must omit the flag, got %s", body)
	}
}

func TestPackagesNotCloud(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	if err := writeModeLayer(s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)
	if code, _ := get(t, ts.URL, "/api/packages", sid); code != http.StatusConflict {
		t.Fatalf("the catalog outside cloud mode must be 409, got %d", code)
	}
}

func TestPackagesContentUnreachable(t *testing.T) {
	dead := fakeContent(t, nil, nil)
	deadURL := dead.URL
	dead.Close() // now unreachable
	base, sid, _ := newContentServer(t, deadURL)
	if code, _ := get(t, base, "/api/packages", sid); code != http.StatusBadGateway {
		t.Fatalf("an unreachable content service must be 502, got %d", code)
	}
}

func TestRenderStubGolden(t *testing.T) {
	got := renderStub("acme-compute", pinA)
	want := "'use strict';\n" +
		"Object.defineProperty(exports, \"__esModule\", { value: true });\n" +
		"const { DtRemoteModule } = require('@dethernety/dt-module');\n" +
		"class RemoteModule extends DtRemoteModule {\n" +
		"  constructor(driver, logger) { super({ moduleKey: 'acme-compute', pin: '" + pinA + "' }, driver, logger); }\n" +
		"}\n" +
		"exports.default = RemoteModule;\n"
	if got != want {
		t.Fatalf("stub mismatch:\n got: %q\nwant: %q", got, want)
	}
	if strings.Contains(got, "import ") || strings.Contains(got, "module.exports =") {
		t.Fatalf("the stub must be CommonJS with exports.default, got %q", got)
	}
}

func TestMountWritesStubAndMarker(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	body := `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"` + pinA + `"}`
	code, resp := send(t, http.MethodPost, base+"/api/modules", sid, body)
	if code != http.StatusOK {
		t.Fatalf("mount must be 200, got %d %s", code, resp)
	}
	if !strings.Contains(resp, platformRestartCommand) {
		t.Fatalf("mount must name the recreate command, got %s", resp)
	}

	dir := filepath.Join(modulesDir, "acme-compute")
	stub := filepath.Join(dir, "AcmeComputeModule.js")
	info, err := os.Stat(stub)
	if err != nil {
		t.Fatalf("the stub must be written: %v", err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("the stub must be mode 0644, got %o", info.Mode().Perm())
	}
	data, _ := os.ReadFile(stub)
	if !strings.Contains(string(data), "acme-compute") || !strings.Contains(string(data), pinA) {
		t.Fatalf("the stub must carry the key and pin, got %s", data)
	}
	m, err := readMarker(dir)
	if err != nil {
		t.Fatalf("the marker must be written: %v", err)
	}
	if m.PackageKey != "acme-cloud" || m.ModuleKey != "acme-compute" || m.Pin != pinA || m.Schema != mountMarkerSchema {
		t.Fatalf("marker fields are wrong: %+v", m)
	}
}

func TestMountRejectsBadInput(t *testing.T) {
	base, sid, _ := newContentServer(t, "https://content.example")
	cases := map[string]string{
		"bad module key":  `{"packageKey":"acme-cloud","moduleKey":"Acme_Compute","pin":"` + pinA + `"}`,
		"bad pin":         `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"sha256:xyz"}`,
		"bad package key": `{"packageKey":"Acme Cloud","moduleKey":"acme-compute","pin":"` + pinA + `"}`,
	}
	for name, body := range cases {
		if code, _ := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusBadRequest {
			t.Fatalf("%s must be 400, got %d", name, code)
		}
	}
}

func TestMountRefusesClobber(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	// A directory the console did not create (a shipped module) sharing the same name.
	shipped := filepath.Join(modulesDir, "mitre-frameworks")
	if err := os.MkdirAll(shipped, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"packageKey":"acme-cloud","moduleKey":"mitre-frameworks","pin":"` + pinA + `"}`
	if code, _ := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusConflict {
		t.Fatalf("mounting over a directory the console did not create must be 409, got %d", code)
	}
	// The directory must be untouched — no stub written into it.
	if _, err := os.Stat(filepath.Join(shipped, "MitreFrameworksModule.js")); err == nil {
		t.Fatal("the shipped directory must not be clobbered")
	}
}

func TestMountAdvancesPin(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	mount := func(pin string) int {
		body := `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"` + pin + `"}`
		code, _ := send(t, http.MethodPost, base+"/api/modules", sid, body)
		return code
	}
	if code := mount(pinA); code != http.StatusOK {
		t.Fatalf("first mount must be 200, got %d", code)
	}
	if code := mount(pinB); code != http.StatusOK {
		t.Fatalf("re-mount (advance) over our own marker must be 200, got %d", code)
	}
	m, err := readMarker(filepath.Join(modulesDir, "acme-compute"))
	if err != nil {
		t.Fatal(err)
	}
	if m.Pin != pinB {
		t.Fatalf("the advanced pin must be recorded, got %s", m.Pin)
	}
	data, _ := os.ReadFile(filepath.Join(modulesDir, "acme-compute", "AcmeComputeModule.js"))
	if !strings.Contains(string(data), pinB) || strings.Contains(string(data), pinA) {
		t.Fatalf("the stub must carry the new pin only, got %s", data)
	}
}

func TestWorldWritableHelper(t *testing.T) {
	dir := t.TempDir()
	ok := filepath.Join(dir, "ok.js")
	bad := filepath.Join(dir, "bad.js")
	if err := os.WriteFile(ok, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Chmod sets the exact bits (WriteFile's mode is filtered by the process umask, which would mask
	// the world-writable bit on most hosts).
	if err := os.Chmod(bad, 0o666); err != nil {
		t.Fatal(err)
	}
	if worldWritable(ok) {
		t.Fatal("0644 must not be world-writable")
	}
	if !worldWritable(bad) {
		t.Fatal("0666 must be world-writable")
	}
}

func TestModulesInventoryAndCurrency(t *testing.T) {
	// The catalog's latest for acme-compute is pinB.
	content := fakeContent(t, []fakePkg{{
		key: "acme-cloud", latest: "20260101.1",
		modules: []catalogModuleEntry{{Key: "acme-compute", Name: "Acme Compute", Version: "2.0.0", ContentHash: pinB}},
	}}, nil)
	defer content.Close()
	base, sid, _ := newContentServer(t, content.URL)

	// Mount at the OLD pin: currency must report outdated with the newer pin.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	code, raw := get(t, base, "/api/modules", sid)
	body := string(raw)
	if code != http.StatusOK {
		t.Fatalf("modules must be 200, got %d %s", code, body)
	}
	if !strings.Contains(body, `"currency":"outdated"`) || !strings.Contains(body, pinB) {
		t.Fatalf("an old pin must read outdated with the newer pin, got %s", body)
	}

	// Advance to the latest: currency must read current.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinB+`"}`)
	if _, raw := get(t, base, "/api/modules", sid); !strings.Contains(string(raw), `"currency":"current"`) {
		t.Fatalf("a matching pin must read current, got %s", raw)
	}
}

func TestModulesInventoryCatalogUnreachable(t *testing.T) {
	dead := fakeContent(t, nil, nil)
	deadURL := dead.URL
	base, sid, _ := newContentServer(t, deadURL)
	// Mount one module while the catalog is up so a marker exists.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	dead.Close() // catalog now unreachable

	code, raw := get(t, base, "/api/modules", sid)
	body := string(raw)
	if code != http.StatusOK {
		t.Fatalf("the inventory must render even when the catalog is down, got %d %s", code, body)
	}
	if !strings.Contains(body, `"currency":"unknown"`) || !strings.Contains(body, "unavailable") {
		t.Fatalf("an unreachable catalog must yield unknown currency and a note, got %s", body)
	}
}

func TestModulesCurrencyUnknownWhenPackageNotInCatalog(t *testing.T) {
	// The catalog lists acme-compute only under acme-cloud. A mount whose marker records a different
	// package (or a module the catalog does not list) must read "unknown" — currency is judged against
	// the package the operator mounted from, not by module key alone.
	content := fakeContent(t, []fakePkg{{
		key: "acme-cloud", latest: "20260101.1",
		modules: []catalogModuleEntry{{Key: "acme-compute", Name: "Acme Compute", Version: "1.0.0", ContentHash: pinA}},
	}}, nil)
	defer content.Close()
	base, sid, _ := newContentServer(t, content.URL)
	// Mount recording a package the catalog does not contain.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"ghost-pack","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	_, raw := get(t, base, "/api/modules", sid)
	if body := string(raw); !strings.Contains(body, `"currency":"unknown"`) {
		t.Fatalf("a mount whose package is not in the catalog must read unknown, got %s", body)
	}
}

func TestPackagesDegradesPerPackage(t *testing.T) {
	// One package has a published version whose document the service cannot serve (404), and one has no
	// published version at all. Neither must fail the whole catalog: each returns with an error note.
	content := fakeContent(t, []fakePkg{
		{key: "ok-pack", latest: "1", modules: []catalogModuleEntry{{Key: "ok-mod", Name: "OK", Version: "1.0.0", ContentHash: pinA}}},
		{key: "broken-pack", latest: "1", noDoc: true}, // listed, but its version document 404s
		{key: "no-version-pack", latest: ""},           // no published version
	}, nil)
	defer content.Close()
	base, sid, _ := newContentServer(t, content.URL)

	code, raw := get(t, base, "/api/packages", sid)
	body := string(raw)
	if code != http.StatusOK {
		t.Fatalf("a degraded package must not fail the whole catalog, got %d %s", code, body)
	}
	// The healthy package resolves its module; both degraded packages carry an error note; all appear.
	for _, want := range []string{"ok-pack", "ok-mod", "broken-pack", "could not load this package", "no-version-pack", "no published version"} {
		if !strings.Contains(body, want) {
			t.Fatalf("catalog must contain %q, got %s", want, body)
		}
	}
}

func TestUnmountRemovesDir(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	dir := filepath.Join(modulesDir, "acme-compute")
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("precondition: mount must exist, got %v", err)
	}
	code, body := send(t, http.MethodDelete, base+"/api/modules/acme-compute", sid, "")
	if code != http.StatusOK {
		t.Fatalf("unmount must be 200, got %d %s", code, body)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the module directory must be removed, stat err=%v", err)
	}
}

func TestUnmountUnknownKey(t *testing.T) {
	base, sid, _ := newContentServer(t, "https://content.example")
	if code, _ := send(t, http.MethodDelete, base+"/api/modules/never-mounted", sid, ""); code != http.StatusNotFound {
		t.Fatalf("unmounting an absent key must be 404, got %d", code)
	}
}

func TestUnmountRefusesMarkerless(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	shipped := filepath.Join(modulesDir, "mitre-frameworks")
	if err := os.MkdirAll(shipped, 0o755); err != nil {
		t.Fatal(err)
	}
	if code, _ := send(t, http.MethodDelete, base+"/api/modules/mitre-frameworks", sid, ""); code != http.StatusConflict {
		t.Fatalf("unmounting a directory the console did not create must be 409, got %d", code)
	}
	if _, err := os.Stat(shipped); err != nil {
		t.Fatal("the shipped directory must not be removed")
	}
}

func TestUnmountBadKey(t *testing.T) {
	base, sid, _ := newContentServer(t, "https://content.example")
	if code, _ := send(t, http.MethodDelete, base+"/api/modules/Bad_Key", sid, ""); code != http.StatusBadRequest {
		t.Fatalf("an invalid key must be 400, got %d", code)
	}
}

func TestModuleDirParentEquality(t *testing.T) {
	root := t.TempDir()
	dir, err := moduleDir(root, "acme-compute")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(dir) != filepath.Clean(root) {
		t.Fatalf("a module dir must sit directly under the modules root, got %s under %s", dir, root)
	}
}

func TestContentRoutesRequireSession(t *testing.T) {
	base, _, _ := newContentServer(t, "https://content.example")
	if code, _ := get(t, base, "/api/packages", ""); code != http.StatusUnauthorized {
		t.Fatalf("packages without a session must be 401, got %d", code)
	}
	if code, _ := get(t, base, "/api/modules", ""); code != http.StatusUnauthorized {
		t.Fatalf("modules without a session must be 401, got %d", code)
	}
	if code, _ := send(t, http.MethodPost, base+"/api/modules", "", `{"packageKey":"a","moduleKey":"b","pin":"`+pinA+`"}`); code != http.StatusUnauthorized {
		t.Fatalf("mount without a session must be 401, got %d", code)
	}
	if code, _ := send(t, http.MethodDelete, base+"/api/modules/acme-compute", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("unmount without a session must be 401, got %d", code)
	}
}

// The redirect refusal in publicGet is documented as a security property — a 3xx must not be able to
// repoint a request at a host the operator never named — and it had no test. This asserts the property
// rather than the mechanism: the redirect target is a real server that records whether it was ever
// contacted, so a regression that starts following redirects fails here even if the error stays.
func TestPublicGetRefusesRedirects(t *testing.T) {
	var reached bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"packages":[]}`))
	}))
	defer target.Close()

	for _, code := range []int{
		http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect,
	} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			reached = false
			redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, target.URL+"/v1/catalog/packages", code)
			}))
			defer redirector.Close()

			var got catalogPackageList
			if err := publicGet(t.Context(), redirector.URL, "/v1/catalog/packages", &got); err == nil {
				t.Fatalf("a %d must be an error, not a decoded body", code)
			}
			if reached {
				t.Fatalf("the redirect target was contacted on a %d — the host moved", code)
			}
		})
	}
}
