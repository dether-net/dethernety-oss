package daemoncmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	key       string
	name      string
	latest    string
	modules   []catalogModuleEntry
	artifacts []catalogArtifactEntry
	noDoc     bool
}

// fakeContentOpt registers a further route on the fake. Options exist so the entitlements surface can be
// ABSENT by default: a mux with no such route answers 404, which is exactly what a content service
// predating the surface — or one rolled back past it — returns, and that is the case the console has to
// degrade through rather than the exception.
type fakeContentOpt func(*http.ServeMux)

// withEntitlements serves the entitlements surface, answering with the given package keys and recording
// each request's Authorization header into seen.
//
// It records into ITS OWN slice and never into fakeContent's gotAuth, which is load-bearing. gotAuth backs
// "no request to the content service may carry an Authorization header" — true of the catalog and false of
// this surface, whose whole point is the credential — so folding the two together would widen that
// assertion into one that cannot hold, and the obvious repair is to weaken it.
func withEntitlements(status int, keys []string, seen *[]string) fakeContentOpt {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /v1/entitlements", func(w http.ResponseWriter, r *http.Request) {
			if seen != nil {
				*seen = append(*seen, r.Header.Get("Authorization"))
			}
			// Refuses in JSON, as the real service does, and that is load-bearing rather than realism for
			// its own sake: a plain-text refusal happens to fail json.Unmarshal, so the "a refusal is not
			// an answer" cases would pass with the status check deleted — held up by the fixture instead
			// of by the code. A JSON refusal parses into a zero value, so only the check stops it being
			// read as "entitled to nothing".
			if status != http.StatusOK {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(status)
				_, _ = fmt.Fprintf(w, `{"type":"about:blank","title":"refused","status":%d}`, status)
				return
			}
			out := make([]map[string]any, 0, len(keys))
			for _, k := range keys {
				out = append(out, map[string]any{"key": k})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"protocol": "1", "packages": out})
		})
	}
}

// withRawEntitlementsBody serves the entitlements surface with a body given verbatim, for the cases where
// the shape is the thing under test rather than the contents.
func withRawEntitlementsBody(status int, body string) fakeContentOpt {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /v1/entitlements", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = io.WriteString(w, body)
		})
	}
}

// fakeContent serves the two public catalog endpoints, plus whatever the options add. If gotAuth is
// non-nil, every CATALOG request's Authorization header is appended to it, so a test can prove no token is
// ever sent there.
func fakeContent(t *testing.T, pkgs []fakePkg, gotAuth *[]string, opts ...fakeContentOpt) *httptest.Server {
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
				_ = json.NewEncoder(w).Encode(map[string]any{"version": p.latest, "modules": p.modules, "artifacts": p.artifacts})
				return
			}
		}
		http.Error(w, "not found", http.StatusNotFound)
	})
	for _, opt := range opts {
		opt(mux)
	}
	return httptest.NewServer(mux)
}

// getEntitledPackages issues a session GET carrying the operator's access token on its own header. The
// package's get() helper cannot: it predates that header, and widening a helper three files share is
// precisely how a token reaches a call that must never carry it. A sibling for the same reason
// artifact_test.go's sendArtifact is one.
func getEntitledPackages(t *testing.T, base, session, cloudToken string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, base+"/api/packages", nil)
	if err != nil {
		t.Fatal(err)
	}
	if session != "" {
		req.Header.Set(sessionHeader, session)
	}
	if cloudToken != "" {
		req.Header.Set(cloudTokenHeader, cloudToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
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
	// The operator's token IS on this request — the handler holds it to ask what the subscription
	// includes — so the assertion below is about a credential that exists to leak. Sent without one, that
	// assertion would be proving nothing about a route that now handles a token.
	code, body := getEntitledPackages(t, base, sid, "the-access-token")
	if code != http.StatusOK {
		t.Fatalf("packages must be 200, got %d %s", code, body)
	}
	for _, want := range []string{"acme-cloud", "acme-compute", "acme-storage", pinA, pinB} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("catalog must contain %q, got %s", want, body)
		}
	}
	// The CATALOG is public: no request to it may carry an Authorization header — not even now that the
	// same handler holds the operator's token for the surface beside it. gotAuth is appended by the two
	// catalog handlers alone, so this is a statement about those routes and not about the entitlements one.
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
	// Subscribed to acme-cloud and not to other-pkg — the live answer, not a key list frozen into this
	// deployment's configuration. The distinction is the whole point of the route: a package bought after
	// the deployment connected shows here on the next load, and the operator never has to reconnect to see
	// it. Reconnecting removes every cloud-provided module.
	var seen []string
	content := fakeContent(t, []fakePkg{
		{key: "acme-cloud", name: "Acme Cloud", latest: "20260101.1", modules: []catalogModuleEntry{{Key: "acme-compute", ContentHash: pinA}}},
		{key: "other-pkg", name: "Other", latest: "1", modules: []catalogModuleEntry{{Key: "other-mod", ContentHash: pinB}}},
	}, nil, withEntitlements(http.StatusOK, []string{"acme-cloud"}, &seen))
	defer content.Close()

	base, sid, _ := newContentServer(t, content.URL)

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

	code, body := getEntitledPackages(t, base, sid, "the-access-token")
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

	// The operator's own token reached the content service, on the standard header. Asserted here and not
	// only in the transport unit test because this is the seam that has shipped broken before: every SPA
	// component test mocks the catalog call wholesale, so nothing else on either side reaches the header.
	if len(seen) != 1 || seen[0] != "Bearer the-access-token" {
		t.Fatalf("the operator's token must reach the entitlements surface exactly once, got %#v", seen)
	}

	// A LAPSED subscription is an answer, not an absence: an empty list means entitled to nothing, and
	// every package is marked false rather than left undetermined.
	empty := fakeContent(t, []fakePkg{
		{key: "acme-cloud", name: "Acme Cloud", latest: "20260101.1", modules: []catalogModuleEntry{{Key: "acme-compute", ContentHash: pinA}}},
	}, nil, withEntitlements(http.StatusOK, nil, nil))
	defer empty.Close()
	emptyBase, emptySid, _ := newContentServer(t, empty.URL)
	_, body = getEntitledPackages(t, emptyBase, emptySid, "the-access-token")
	if e := entitledFor(body)["acme-cloud"]; e == nil || *e {
		t.Fatalf("an empty subscription must mark every package entitled=false, got %s", body)
	}

	// No operator token on the request — the ordinary state of a reloaded tab, since the SPA holds the
	// token in memory only. The console must not ask at all (a bare "Bearer " is a malformed credential,
	// not a question), and must leave the flag off rather than answer "entitled to nothing".
	before := len(seen)
	code, body = get(t, base, "/api/packages", sid)
	if code != http.StatusOK {
		t.Fatalf("packages must still be 200 without an operator token, got %d %s", code, body)
	}
	if len(seen) != before {
		t.Fatalf("no token means no call to the entitlements surface, got %#v", seen)
	}
	if strings.Contains(string(body), `"entitled"`) {
		t.Fatalf("an unaskable subscription must omit the flag, got %s", body)
	}

	// And the SERVER still mounts a package the subscription does not include. The gate is a console
	// affordance; the content service is the control, and it decides when the content is fetched. A
	// server-side refusal here would make a purchase require a new recipe, which requires a disconnect,
	// which removes every cloud-provided module — the loop this whole route exists to break. Asserted
	// against the deployment whose subscription is empty, the strongest "not entitled" there is.
	mcode, mbody := send(t, http.MethodPost, emptyBase+"/api/modules", emptySid,
		`{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	if mcode != http.StatusOK {
		t.Fatalf("a module from an unentitled package must still mount, got %d %s", mcode, mbody)
	}
}

// A deployment whose recipe predates the content scope — or was issued without it — can never mint a
// usable token, however often the operator retries. The console must say so rather than offer a retry,
// and it decides that from its own mode file rather than from the shape of a token it cannot read.
func TestPackagesReportsADeploymentThatCanNeverAsk(t *testing.T) {
	pkgs := []fakePkg{{key: "acme-cloud", name: "Acme Cloud", latest: "1", modules: []catalogModuleEntry{{Key: "acme-compute", ContentHash: pinA}}}}
	content := fakeContent(t, pkgs, nil, withEntitlements(http.StatusOK, []string{"acme-cloud"}, nil))
	defer content.Close()

	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)

	writeScope := func(scope string) {
		recipe := validRecipeVars()
		recipe["MODULE_CONTENT_BASE_URL"] = content.URL
		recipe["OIDC_SCOPE"] = scope
		vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
		if err != nil {
			t.Fatal(err)
		}
		if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
			t.Fatal(err)
		}
	}
	sid := signIn(t, s)

	// A deployment carrying a content scope can ask.
	writeScope("openid profile email " + content.URL + "/content.access")
	_, body := getEntitledPackages(t, ts.URL, sid, "the-access-token")
	if strings.Contains(string(body), `"subscriptionUnavailable"`) {
		t.Fatalf("a deployment carrying the content scope can ask, got %s", body)
	}

	// THE CASE THAT BROKE THE FIRST VERSION OF THIS. The scope's identifier is derived from the service's
	// vanity origin, while the recipe carries whichever address subscribers should dial — and with the edge
	// off those are different hosts. Rebuilding the scope from the recipe's address, which is what the
	// first version did, declared this deployment permanently broken and sent the operator to a reconnect
	// that removes every cloud-provided module. It holds a content scope; it can ask.
	writeScope("openid profile email https://api.vanity.example/content.access")
	_, body = getEntitledPackages(t, ts.URL, sid, "the-access-token")
	if strings.Contains(string(body), `"subscriptionUnavailable"`) {
		t.Fatalf("a deployment whose scope names a different host than its API address can still ask, got %s", body)
	}

	// Without any content scope, no sign-in this deployment can perform will produce a usable token.
	writeScope("openid profile email")
	_, body = getEntitledPackages(t, ts.URL, sid, "the-access-token")
	if !strings.Contains(string(body), `"subscriptionUnavailable":true`) {
		t.Fatalf("a deployment without the content scope must be reported as unable to ask, got %s", body)
	}
	// And it is still served its whole catalog: this is an explanation, never a gate.
	if !strings.Contains(string(body), `"acme-cloud"`) {
		t.Fatalf("the catalog must still be served, got %s", body)
	}

	// Matched as a whole field. A scope that merely CONTAINS the text is a different scope, and the join
	// this used to compare against would have accepted it.
	writeScope("openid profile email https://api.vanity.example/content.access.other")
	_, body = getEntitledPackages(t, ts.URL, sid, "the-access-token")
	if !strings.Contains(string(body), `"subscriptionUnavailable":true`) {
		t.Fatalf("a scope that merely contains the suffix must not count as holding it, got %s", body)
	}
}

// TestPackagesUndeterminedWhenItCannotAsk covers every way the answer fails to arrive. All of them mean
// the same thing to the operator — UNKNOWN, gating nothing — and none of them may reach the browser as a
// failure of the catalog itself.
func TestPackagesUndeterminedWhenItCannotAsk(t *testing.T) {
	pkgs := []fakePkg{{key: "acme-cloud", name: "Acme Cloud", latest: "20260101.1", modules: []catalogModuleEntry{{Key: "acme-compute", ContentHash: pinA}}}}
	for _, tc := range []struct {
		name string
		opts []fakeContentOpt
	}{
		// No option at all: the surface is unregistered, so the mux answers 404 — what a content service
		// deployed before this surface existed, or rolled back past it, actually returns. Absence must
		// never be read as "entitled to nothing".
		{"the surface is absent", nil},
		// The operator's CONTENT credential lapsed. It says nothing about their console session, and the
		// SPA answers any 401 by clearing that session — so relaying this one would sign an operator out
		// of their own console because a token for a different service expired.
		{"the content credential lapsed", []fakeContentOpt{withEntitlements(http.StatusUnauthorized, nil, nil)}},
		{"the service failed", []fakeContentOpt{withEntitlements(http.StatusInternalServerError, nil, nil)}},
		// A 200 that is not this document. It unmarshals into a zero value, and a zero value here would
		// read as "entitled to nothing" — the one answer the console must never invent. The protocol
		// marker is what stops it.
		{"a 200 that is not this document", []fakeContentOpt{withRawEntitlementsBody(http.StatusOK, `{"message":"Not Found"}`)}},
		// A revision this console does not speak. Trusting its shape would be a guess; not trusting it
		// gates nothing, which is the safe direction to be wrong in.
		{"a protocol revision this console does not speak", []fakeContentOpt{withRawEntitlementsBody(http.StatusOK, `{"protocol":"2","packages":[{"key":"acme-cloud"}]}`)}},
		// The marker is right and the mandatory field is missing. Decoding leaves a nil slice, which reads
		// as "entitled to nothing" unless it is told apart — and that greys a subscriber's own catalog off
		// a malformed body. `{"packages":[]}` is a different thing and stays an answer, asserted above.
		{"a document with the marker but no packages key", []fakeContentOpt{withRawEntitlementsBody(http.StatusOK, `{"protocol":"1"}`)}},
		// A refusal carrying a perfectly well-formed body — a misrouted or cached response, or a gateway
		// answering for a service it is refusing on behalf of. The shape check cannot catch this one, so
		// it is what the status check is for: a document under a refusal is still a refusal, and reading
		// its empty list as an answer would mark every package unsubscribed.
		{"a refusal carrying a well-formed body", []fakeContentOpt{withRawEntitlementsBody(http.StatusForbidden, `{"protocol":"1","packages":[]}`)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			content := fakeContent(t, pkgs, nil, tc.opts...)
			defer content.Close()
			base, sid, _ := newContentServer(t, content.URL)

			code, body := getEntitledPackages(t, base, sid, "the-access-token")
			// One check, and 401 is the failure it is really guarding: the SPA answers any 401 by clearing
			// the session, so a relayed one signs the operator out of their console mid-browse.
			if code != http.StatusOK {
				t.Fatalf("the catalog must still be served and a refusal never relayed, got %d %s", code, body)
			}
			if !strings.Contains(string(body), `"acme-cloud"`) {
				t.Fatalf("the catalog must still list its packages, got %s", body)
			}
			if strings.Contains(string(body), `"entitled"`) {
				t.Fatalf("an unanswered subscription must omit the flag, got %s", body)
			}
		})
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

	// The mode again after a RE-mount, which is a different code path: publishStub renames a fresh file
	// over the old one, so the published mode is the temp's rather than the original's. It is load-bearing
	// and it fails silently — the platform runs as a different uid than the console and has to read this
	// file, while worldWritable only tests o+w, so a too-narrow mode is a module that never loads with
	// nothing said about it.
	if code, resp := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusOK {
		t.Fatalf("re-mount must be 200, got %d %s", code, resp)
	}
	if info, err = os.Stat(stub); err != nil {
		t.Fatalf("the stub must survive a re-mount: %v", err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("a re-mounted stub must still be mode 0644, got %o", info.Mode().Perm())
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

// The input is renderStub's OWN output, never a literal. TestRenderStubGolden is the one place the stub's
// text may be pinned character for character; a hand-written fixture here would be a second copy of that
// shape, free to drift from stubTemplate without either test noticing.
func TestStubCarriesPinReadsWhatRenderStubWrote(t *testing.T) {
	dir := t.TempDir()
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, "AcmeComputeModule.js"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write(renderStub("acme-compute", pinA))
	if !stubCarriesPin(dir, "AcmeComputeModule.js", pinA) {
		t.Fatal("a stub rendered at pinA must be recognised as carrying pinA")
	}
	// The whole point: a valid, loadable module file at the WRONG pin. stubPresent says yes to this.
	if stubCarriesPin(dir, "AcmeComputeModule.js", pinB) {
		t.Fatal("a stub rendered at pinA must not be recognised as carrying pinB")
	}

	// Every other shape answers false, because false is the answer that cannot report a mount current in
	// error. "x" is not hypothetical — writeMount is called with it elsewhere in this file.
	for name, content := range map[string]string{
		"not a stub at all": "x",
		"no pin":            "'use strict';\nmodule.exports = {};\n",
		"a truncated stub":  renderStub("acme-compute", pinA)[:40],
		// The pin pushed PAST the cap by padding in front of it. The mirror orientation is a separate case
		// below, because it does not answer the same way and the difference is the cap's whole semantics.
		"pushed past the cap": strings.Repeat("/* pad */\n", maxStubBytes) + renderStub("acme-compute", pinA),
	} {
		t.Run(name, func(t *testing.T) {
			write(content)
			if stubCarriesPin(dir, "AcmeComputeModule.js", pinA) {
				t.Fatalf("%s must not be read as carrying the pin", name)
			}
		})
	}

	// The cap bounds the READ; it does not reject the file. A stub with the pin in its first maxStubBytes
	// and megabytes of anything after it still carries the pin, and answering false would report a mount
	// the platform loads correctly as diverged. Both orientations are asserted because only one of them
	// answers false, and a suite carrying just that one would read as though the cap rejected the file.
	t.Run("oversize but the pin is within the cap", func(t *testing.T) {
		write(renderStub("acme-compute", pinA) + strings.Repeat("/* pad */\n", maxStubBytes))
		if !stubCarriesPin(dir, "AcmeComputeModule.js", pinA) {
			t.Fatal("a stub carrying the pin before the cap must be recognised, however long the file is")
		}
	})

	// A file that is not there at all, which the caller has already excluded with stubPresent but which
	// must not panic or answer true if it ever reaches here.
	if stubCarriesPin(dir, "MissingModule.js", pinA) {
		t.Fatal("an absent stub carries no pin")
	}
}

// The defect this whole change exists for: the marker is written first, so a stub write that fails on a
// re-mount — or an abrupt death between the two — leaves a VALID, non-empty module file at the previous
// pin while the marker records the new one. Every check the inventory had then passed and the row read
// "current" while the platform served the old code.
//
// Root-proof: the divergence is forced by writing a file, never by permission bits, so this exercises the
// real path in a container running as uid 0 where skipIfRoot would otherwise skip it away.
func TestModulesInventoryReportsAPinDivergence(t *testing.T) {
	content := fakeContent(t, []fakePkg{{
		key: "acme-cloud", name: "Acme Cloud", latest: "1.0.0",
		modules: []catalogModuleEntry{{Key: "acme-compute", Name: "Acme Compute", Version: "1.0.0", ContentHash: pinA}},
	}}, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)
	stub := filepath.Join(modulesDir, "acme-compute", "AcmeComputeModule.js")

	// A complete mount at the catalog's latest reads current — the state the divergence has to displace.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	if _, raw := get(t, base, "/api/modules", sid); !strings.Contains(string(raw), `"currency":"current"`) {
		t.Fatalf("a complete mount at the latest pin must read current, got %s", raw)
	}

	// Now only the stub moves. The marker still records pinA; the platform would load pinB.
	if err := os.WriteFile(stub, []byte(renderStub("acme-compute", pinB)), 0o644); err != nil {
		t.Fatal(err)
	}
	code, raw := get(t, base, "/api/modules", sid)
	if code != http.StatusOK {
		t.Fatalf("modules must be 200, got %d %s", code, raw)
	}
	var inv modulesResponse
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	if len(inv.Modules) != 1 {
		t.Fatalf("the row must survive so it can still be repaired or unmounted, got %#v", inv.Modules)
	}
	if inv.Modules[0].Currency != "diverged" {
		t.Fatalf("a stub at a pin the marker does not record is not up to date, got %q", inv.Modules[0].Currency)
	}
	// The repair is a re-mount at the RECORDED pin, and the SPA's one re-POST control reads latestPin —
	// so this field is what makes the row actionable rather than a dead end.
	if inv.Modules[0].LatestPin != pinA {
		t.Fatalf("the repair must be offered at the recorded pin, got %q", inv.Modules[0].LatestPin)
	}
	if inv.Modules[0].LatestVersion != "" {
		t.Fatalf("a repair is not a version change, got %q", inv.Modules[0].LatestVersion)
	}
	// "does not confirm", deliberately weaker than "does not carry": stubCarriesPin answers false for a
	// file it could not read as well as for one naming another pin, and the console cannot separate them.
	if !strings.Contains(inv.Note, "acme-compute") || !strings.Contains(inv.Note, "does not confirm") {
		t.Fatalf("the divergence must name itself and its remedy, got %q", inv.Note)
	}
	if strings.Contains(inv.Note, "is serving different content") {
		t.Fatalf("the note must not assert what the console cannot establish, got %q", inv.Note)
	}

	// Mounting again at the recorded pin repairs it, through exactly the request the panel's button sends.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	if _, raw := get(t, base, "/api/modules", sid); !strings.Contains(string(raw), `"currency":"current"`) {
		t.Fatalf("a re-mount at the recorded pin must repair the divergence, got %s", raw)
	}

	// A marker whose pin is unusable still gets the verdict, and does NOT get the offer. readMarker parses
	// without checking, so this is the one place a marker field would otherwise be handed back to the SPA
	// as an instruction — and a Repair button the SPA then declines to act on is worse than no button.
	// NON-EMPTY and invalid, deliberately. An empty pin proves nothing here: `omitempty` drops it from the
	// wire whether or not the arm validated, so the assertion below would hold against an unguarded arm too.
	if err := writeMarkerNamed(filepath.Join(modulesDir, "acme-compute"), mountMarkerName, mountMarker{
		Schema: mountMarkerSchema, PackageKey: "acme-cloud", ModuleKey: "acme-compute", Pin: "not-a-pin",
	}); err != nil {
		t.Fatal(err)
	}
	_, raw = get(t, base, "/api/modules", sid)
	inv = modulesResponse{}
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	if len(inv.Modules) != 1 || inv.Modules[0].Currency != "diverged" {
		t.Fatalf("an unusable recorded pin is still a divergence, got %#v", inv.Modules)
	}
	if inv.Modules[0].LatestPin != "" {
		t.Fatalf("an unusable pin must not be offered as the repair, got %q", inv.Modules[0].LatestPin)
	}

	// Restore a usable marker so the precedence check below starts from a well-formed mount.
	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)

	// PRECEDENCE. A directory with no loadable file cannot also have one naming the wrong pin, and
	// `incomplete` is the more basic answer — so removing the stub must not now report a divergence.
	if err := os.Remove(stub); err != nil {
		t.Fatal(err)
	}
	if _, raw := get(t, base, "/api/modules", sid); !strings.Contains(string(raw), `"currency":"incomplete"`) {
		t.Fatalf("no stub at all stays incomplete, it does not become a divergence, got %s", raw)
	}
}

// publishStub renames the stub into place, and the fallback that makes that safe is the whole reason it
// is not a two-line function. A directory standing where the temp file would go fails the temp write with
// EISDIR and leaves the in-place write to succeed — the same shape as a 0555 volume that permits an
// overwrite and refuses a sibling, but forced with a file-type error rather than a permission bit, so it
// runs as root. skipIfRoot would make a chmod version of this test vacuous in a root container.
func TestWriteMountFallsBackWhenItCannotCreateItsTemp(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	mount := func(pin string) (int, string) {
		return send(t, http.MethodPost, base+"/api/modules", sid,
			`{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pin+`"}`)
	}
	if code, resp := mount(pinA); code != http.StatusOK {
		t.Fatalf("first mount must be 200, got %d %s", code, resp)
	}
	dir := filepath.Join(modulesDir, "acme-compute")
	if err := os.Mkdir(filepath.Join(dir, "AcmeComputeModule.js.tmp"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Without the fallback this is where a pin advance that succeeds today starts failing instead, and
	// lands in precisely the state TestModulesInventoryReportsAPinDivergence is about.
	if code, resp := mount(pinB); code != http.StatusOK {
		t.Fatalf("a pin advance must still succeed when the temp cannot be created, got %d %s", code, resp)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "AcmeComputeModule.js"))
	if !strings.Contains(string(data), pinB) || strings.Contains(string(data), pinA) {
		t.Fatalf("the fallback must publish the new pin, got %s", data)
	}

	// The loader takes ANY *Module.js in a module directory, so a publish that stranded a second one would
	// be a module nobody meant to ship. Nothing else in this suite looks past the one expected name.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var loadable []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), "Module.js") {
			loadable = append(loadable, e.Name())
		}
	}
	if len(loadable) != 1 || loadable[0] != "AcmeComputeModule.js" {
		t.Fatalf("exactly one loadable module file must survive a publish, got %v", loadable)
	}
}

// os.WriteFile's perm argument applies only at CREATION, so a temp file left behind by an earlier failed
// rename is written THROUGH and keeps its own mode, which the rename then publishes. That is why
// publishStub chmods rather than trusting the write. The failure mode is silent in every direction: the
// console reports a complete mount, worldWritable tests only o+w so nothing warns, and the platform —
// a different uid — simply never loads the module.
func TestWriteMountPublishesA0644StubOverAStaleTemp(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	mount := func(pin string) (int, string) {
		return send(t, http.MethodPost, base+"/api/modules", sid,
			`{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pin+`"}`)
	}
	if code, resp := mount(pinA); code != http.StatusOK {
		t.Fatalf("first mount must be 200, got %d %s", code, resp)
	}
	dir := filepath.Join(modulesDir, "acme-compute")
	tmp := filepath.Join(dir, "AcmeComputeModule.js.tmp")
	if err := os.WriteFile(tmp, []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}

	if code, resp := mount(pinB); code != http.StatusOK {
		t.Fatalf("a pin advance over a stale temp must be 200, got %d %s", code, resp)
	}
	info, err := os.Stat(filepath.Join(dir, "AcmeComputeModule.js"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("a stale temp must not publish its own mode, got %o", info.Mode().Perm())
	}
}

// When BOTH the rename and the in-place fallback fail, the error must still wrap errStubNotWritten —
// server.go branches on it with errors.Is to tell the operator the mount was recorded and how to finish
// it. Drop the wrap and that becomes a generic 500. A directory standing where the STUB goes lets the
// temp write succeed and fails the rename, so this too runs as root.
func TestWriteMountKeepsErrStubNotWrittenWhenBothWritesFail(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	mount := func(pin string) (int, string) {
		return send(t, http.MethodPost, base+"/api/modules", sid,
			`{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pin+`"}`)
	}
	if code, resp := mount(pinA); code != http.StatusOK {
		t.Fatalf("first mount must be 200, got %d %s", code, resp)
	}
	dir := filepath.Join(modulesDir, "acme-compute")
	stub := filepath.Join(dir, "AcmeComputeModule.js")
	if err := os.Remove(stub); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(stub, 0o755); err != nil {
		t.Fatal(err)
	}

	code, resp := mount(pinB)
	if code != http.StatusInternalServerError {
		t.Fatalf("a stub that cannot be published must be 500, got %d %s", code, resp)
	}
	if !strings.Contains(resp, "recorded") {
		t.Fatalf("the operator must be told the mount was recorded and how to finish it, got %s", resp)
	}
	// The temp must not outlive the failure it could not publish.
	if _, err := os.Stat(filepath.Join(dir, "AcmeComputeModule.js.tmp")); !os.IsNotExist(err) {
		t.Fatalf("a failed publish must not strand its temp file, stat gave %v", err)
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

func TestModulesInventoryReportsAStublessMountAsIncomplete(t *testing.T) {
	// The marker is written BEFORE the stub, so marker presence alone stopped being proof of a mount: a
	// stub write that failed leaves one without the other. The knowledge-graph view already asks the second
	// question; this one did not, so the half state rendered a green "up to date" chip beside an Unmount
	// button for a module that will not be there at the next restart, and mountAll skipped it.
	content := fakeContent(t, []fakePkg{{
		key: "acme-cloud", name: "Acme Cloud", latest: "1.0.0",
		modules: []catalogModuleEntry{{Key: "acme-compute", Name: "Acme Compute", Version: "1.0.0", ContentHash: pinA}},
	}}, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)

	send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
	if _, raw := get(t, base, "/api/modules", sid); !strings.Contains(string(raw), `"currency":"current"`) {
		t.Fatalf("a complete mount at the latest pin must read current, got %s", raw)
	}

	// Two shapes of the same failure, and the second is the one a full disk actually produces: os.WriteFile
	// opens with O_CREATE|O_TRUNC and writes afterwards, so a write that fails part-way leaves a regular
	// file of zero bytes — which a presence-only check reports as a complete mount.
	stub := filepath.Join(modulesDir, "acme-compute", moduleFileName("acme-compute"))
	for _, shape := range []struct {
		name string
		make func(t *testing.T)
	}{
		{"the stub is gone", func(t *testing.T) {
			if err := os.Remove(stub); err != nil {
				t.Fatal(err)
			}
		}},
		{"the stub write failed part-way", func(t *testing.T) {
			if err := os.WriteFile(stub, nil, 0o644); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(shape.name, func(t *testing.T) {
			shape.make(t)
			assertIncompleteMount(t, base, sid)
			// Restore a loadable stub so the next shape starts from a complete mount.
			send(t, http.MethodPost, base+"/api/modules", sid, `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"`+pinA+`"}`)
		})
	}
}

func assertIncompleteMount(t *testing.T, base, sid string) {
	t.Helper()
	code, raw := get(t, base, "/api/modules", sid)
	if code != http.StatusOK {
		t.Fatalf("modules must be 200, got %d %s", code, raw)
	}
	var inv modulesResponse
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	// The row STAYS: it carries the only Unmount control the panel has, and a module the catalog no longer
	// lists, an unreachable catalog and an unsubscribed package all render their controls from this list.
	if len(inv.Modules) != 1 || inv.Modules[0].ModuleKey != "acme-compute" {
		t.Fatalf("the row must survive so it can still be unmounted, got %#v", inv.Modules)
	}
	if inv.Modules[0].Currency != "incomplete" {
		t.Fatalf("a mount with no module file is not up to date, got %q", inv.Modules[0].Currency)
	}
	if inv.Modules[0].LatestPin != "" || inv.Modules[0].LatestVersion != "" {
		t.Fatalf("nothing is offered to update a mount that is not there, got %#v", inv.Modules[0])
	}
	if !strings.Contains(inv.Note, "acme-compute") || !strings.Contains(inv.Note, "not loadable") {
		t.Fatalf("the half state must name itself and its remedy, got %q", inv.Note)
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
	// The artifact removal route joins this table rather than growing a fourth copy of the assertion in
	// its own file: what is being held is that no /api route answers without a session.
	if code, _ := send(t, http.MethodDelete, base+"/api/artifacts/acme-compute", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("artifact removal without a session must be 401, got %d", code)
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

// ── The mount write: its order, and what a failure leaves behind ─────────────────────────────────

// skipIfRoot skips a test that forces a write failure with permission bits. Root ignores them, so the
// failure never happens and the test would assert nothing while still reporting a pass. Named rather
// than inlined so a CI image that runs as root produces a visible skip instead of a silent hole.
func skipIfRoot(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("runs as root, which ignores the permission bits this case forces a failure with")
	}
}

func TestEnsureMountDirReportsWhoCreatedIt(t *testing.T) {
	modules := filepath.Join(t.TempDir(), "not-created-yet")
	dir := filepath.Join(modules, "acme-compute")

	// The modules directory is a host mount a fresh deployment may not have yet, so the parent is
	// created too — the reason ensureMountDir uses MkdirAll on the parent rather than Mkdir alone.
	created, err := ensureMountDir(dir)
	if err != nil || !created {
		t.Fatalf("a fresh mount directory must be created and reported as ours, got created=%v err=%v", created, err)
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		t.Fatalf("the directory must exist: %v", err)
	}
	// Not an exact 0755: Mkdir applies the process umask, so an exact assertion would encode this
	// host's. What matters is that the console can write into what it just made.
	if perm := info.Mode().Perm(); perm&0o700 != 0o700 {
		t.Fatalf("the mount directory must be usable by its owner, got %04o", perm)
	}

	created, err = ensureMountDir(dir)
	if err != nil || created {
		t.Fatalf("an existing directory must not be reported as this call's, got created=%v err=%v", created, err)
	}
}

func TestUndoMountDirNeverTakesATree(t *testing.T) {
	root := t.TempDir()

	mine := filepath.Join(root, "mine")
	if _, err := ensureMountDir(mine); err != nil {
		t.Fatal(err)
	}
	undoMountDir(mine, true)
	if _, err := os.Stat(mine); !os.IsNotExist(err) {
		t.Fatalf("an empty directory this mount created must be removed, got %v", err)
	}

	// The whole reason it is os.Remove and not os.RemoveAll: an operator's tree is never at risk,
	// because a non-empty directory simply refuses.
	theirs := filepath.Join(root, "theirs")
	if err := os.MkdirAll(theirs, 0o755); err != nil {
		t.Fatal(err)
	}
	kept := filepath.Join(theirs, "TheirModule.js")
	if err := os.WriteFile(kept, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	undoMountDir(theirs, true)
	if _, err := os.Stat(kept); err != nil {
		t.Fatalf("a non-empty directory must survive the undo: %v", err)
	}

	notOurs := filepath.Join(root, "not-ours")
	if err := os.MkdirAll(notOurs, 0o755); err != nil {
		t.Fatal(err)
	}
	undoMountDir(notOurs, false)
	if _, err := os.Stat(notOurs); err != nil {
		t.Fatalf("a directory this mount did not create must survive even when empty: %v", err)
	}
}

func TestWriteMountUndoesOnlyTheDirectoryItCreated(t *testing.T) {
	// A value encoding/json refuses: MarshalIndent fails inside writeMarkerNamed BEFORE it touches the
	// filesystem, which is exactly "the directory was created and the marker was not written". The
	// marker parameter is already `any` in shipped code, so this needs no seam.
	unmarshalable := make(chan int)

	root := t.TempDir()
	fresh := filepath.Join(root, "fresh")
	if _, err := writeMount(fresh, mountMarkerName, unmarshalable, "FreshModule.js", "x"); err == nil {
		t.Fatal("an unmarshalable marker must fail the mount")
	}
	if _, err := os.Stat(fresh); !os.IsNotExist(err) {
		t.Fatalf("a marker failure must leave no directory behind where the mount created it, got %v", err)
	}

	existing := filepath.Join(root, "existing")
	if err := os.MkdirAll(existing, 0o755); err != nil {
		t.Fatal(err)
	}
	theirs := filepath.Join(existing, "TheirModule.js")
	if err := os.WriteFile(theirs, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := writeMount(existing, mountMarkerName, unmarshalable, "ExistingModule.js", "x"); err == nil {
		t.Fatal("an unmarshalable marker must fail the mount")
	}
	if _, err := os.Stat(theirs); err != nil {
		t.Fatalf("a marker failure must leave a directory it did not create intact: %v", err)
	}
}

func TestWriteMountWritesTheMarkerBeforeTheStub(t *testing.T) {
	// The defect this slice fixes, stated directly: if the marker cannot be written, no loadable
	// *Module.js may exist. os.WriteFile onto a path that is a directory returns EISDIR, which fails
	// the marker write while leaving the stub's own path untouched.
	dir := filepath.Join(t.TempDir(), "acme-compute")
	if err := os.MkdirAll(filepath.Join(dir, mountMarkerName), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := writeMount(dir, mountMarkerName, mountMarker{Schema: mountMarkerSchema}, "AcmeComputeModule.js", "x"); err == nil {
		t.Fatal("a marker write onto a directory must fail the mount")
	}
	if _, err := os.Stat(filepath.Join(dir, "AcmeComputeModule.js")); !os.IsNotExist(err) {
		t.Fatalf("no loadable module file may exist when the marker was not written, got %v", err)
	}
}

func TestMountLeavesNoStubWhenTheMarkerFails(t *testing.T) {
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	// hasOurMarker stats the marker NAME, and a directory stats fine — so the clobber check passes and
	// the handler reaches the marker write, which then returns EISDIR.
	dir := filepath.Join(modulesDir, "acme-compute")
	if err := os.MkdirAll(filepath.Join(dir, mountMarkerName), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"` + pinA + `"}`
	if code, got := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusInternalServerError {
		t.Fatalf("a failed marker write must be 500, got %d %s", code, got)
	}
	if _, err := os.Stat(filepath.Join(dir, "AcmeComputeModule.js")); !os.IsNotExist(err) {
		t.Fatalf("the platform must never see a loadable module the console did not mark, got %v", err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("a directory the mount did not create must survive: %v", err)
	}
}

func TestMountStubFailureLeavesAMarkedDirectory(t *testing.T) {
	skipIfRoot(t)
	base, sid, modulesDir := newContentServer(t, "https://content.example")
	body := `{"packageKey":"acme-cloud","moduleKey":"acme-compute","pin":"` + pinA + `"}`
	if code, got := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusOK {
		t.Fatalf("first mount must be 200, got %d %s", code, got)
	}

	dir := filepath.Join(modulesDir, "acme-compute")
	if err := os.Remove(filepath.Join(dir, "AcmeComputeModule.js")); err != nil {
		t.Fatal(err)
	}
	// 0555 refuses the CREATION of a new file but not a write to the marker already in there, so the
	// marker write succeeds and the stub write returns EACCES — the ordering under test.
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	// Restore before t.TempDir's own RemoveAll runs (cleanups are LIFO), or the teardown fails and is
	// reported against an unrelated test.
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	code, got := send(t, http.MethodPost, base+"/api/modules", sid, body)
	if code != http.StatusInternalServerError {
		t.Fatalf("a failed stub write must be 500, got %d %s", code, got)
	}
	if !strings.Contains(got, "recorded") {
		t.Fatalf("the operator must be told the mount is recorded but incomplete, got %s", got)
	}
	if !hasOurMarker(dir) {
		t.Fatal("a stub failure must leave the directory marked — that is what makes it recoverable")
	}

	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if code, got := send(t, http.MethodPost, base+"/api/modules", sid, body); code != http.StatusOK {
		t.Fatalf("mount must accept the marked directory on a retry, got %d %s", code, got)
	}
	if code, got := send(t, http.MethodDelete, base+"/api/modules/acme-compute", sid, ""); code != http.StatusOK {
		t.Fatalf("unmount must accept the marked directory, got %d %s", code, got)
	}
}

// ── The entitled transport ───────────────────────────────────────────────────────────────────────

// entitledUpstream serves one canned response and records every request's headers, so a test can assert
// both what was attached and what was not.
func entitledUpstream(t *testing.T, status int, body []byte, hdr http.Header) (url string, seen *[]http.Header) {
	t.Helper()
	got := make([]http.Header, 0, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Clone())
		for k, vs := range hdr {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &got
}

func TestEntitledGetAttachesExactlyOneBearer(t *testing.T) {
	base, seen := entitledUpstream(t, http.StatusOK, []byte(`{"ok":true}`), nil)
	body, status, err := entitledGet(context.Background(), base, "/v1/artifacts/x", "the-access-token", 1<<20)
	if err != nil || status != http.StatusOK || string(body) != `{"ok":true}` {
		t.Fatalf("unexpected result: %q %d %v", body, status, err)
	}
	if len(*seen) != 1 {
		t.Fatalf("expected exactly one request, got %d", len(*seen))
	}
	h := (*seen)[0]
	if got := h.Values("Authorization"); len(got) != 1 || got[0] != "Bearer the-access-token" {
		t.Fatalf("exactly one bearer must be attached, got %#v", got)
	}
	// The console's INBOUND header name must never travel outbound: the token is relayed on the
	// standard header, and leaking the console's own name would tell the upstream how it arrived.
	if v := h.Get(cloudTokenHeader); v != "" {
		t.Fatalf("%s must not be forwarded upstream, got %q", cloudTokenHeader, v)
	}
}

func TestPublicGetStillSendsNoAuthorization(t *testing.T) {
	// Asserted beside the entitled case on purpose: "two functions, never a flag" is only a guarantee
	// while both halves are read together.
	base, seen := entitledUpstream(t, http.StatusOK, []byte(`{"packages":[]}`), nil)
	var dst struct{}
	if err := publicGet(context.Background(), base, "/v1/catalog/packages", &dst); err != nil {
		t.Fatal(err)
	}
	// Length-checked before indexing: publicGet not dialling at all is a real regression, and an index
	// panic reports it as a crash in the test harness rather than as the failure it is.
	if len(*seen) != 1 {
		t.Fatalf("the catalog path must make exactly one request, got %d", len(*seen))
	}
	if v := (*seen)[0].Get("Authorization"); v != "" {
		t.Fatalf("the catalog path must carry no credential, got %q", v)
	}
}

func TestEntitledGetRefusesARedirect(t *testing.T) {
	second, secondSeen := entitledUpstream(t, http.StatusOK, []byte("secret"), nil)
	base, _ := entitledUpstream(t, http.StatusFound, nil, http.Header{"Location": []string{second + "/v1/elsewhere"}})

	body, status, err := entitledGet(context.Background(), base, "/v1/artifacts/x", "tok", 1<<20)
	if err == nil {
		t.Fatal("a redirect must be an error, not a status a caller can render")
	}
	if status != http.StatusFound {
		t.Fatalf("the status must still be reported, got %d", status)
	}
	// net/http's own 302 body is an <a href> carrying an UPSTREAM-CHOSEN URL. Returning it would put
	// that string in front of the operator via any caller that renders "the body".
	if body != nil {
		t.Fatalf("a redirect body must never reach a caller, got %q", body)
	}
	if len(*secondSeen) != 0 {
		t.Fatalf("the redirect target must never be dialled, got %d requests", len(*secondSeen))
	}
}

func TestEntitledGetReturnsEveryStatusWithItsBody(t *testing.T) {
	// A refusal's body IS the answer — the service's denial explanation, or an operator-authored
	// withdrawal reason — so it must survive the transport intact. This is the one place entitledGet
	// diverges from both publicGet (which discards it behind an error) and the boot path's fetcher
	// (which drains it), and it is what lets the handler above map these to operator sentences.
	for _, status := range []int{http.StatusOK, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusGone} {
		want := fmt.Sprintf(`{"status":%d}`, status)
		base, _ := entitledUpstream(t, status, []byte(want), nil)
		body, got, err := entitledGet(context.Background(), base, "/v1/artifacts/x", "tok", 1<<20)
		if err != nil {
			t.Fatalf("%d must not be a transport error, got %v", status, err)
		}
		if got != status || string(body) != want {
			t.Fatalf("%d must come back verbatim, got %d %q", status, got, body)
		}
	}
}

func TestEntitledGetRefusesAnOversizeBody(t *testing.T) {
	// Two cases, because one cannot tell them apart: io.LimitReader(body, max) returns byte-identical
	// results for "exactly max" and "truncated at max", so the cap is only assertable by reading one
	// byte past it.
	const max = 64
	atCap, _ := entitledUpstream(t, http.StatusOK, bytes.Repeat([]byte("a"), max), nil)
	if body, _, err := entitledGet(context.Background(), atCap, "/x", "tok", max); err != nil || len(body) != max {
		t.Fatalf("a body exactly at the cap must be allowed, got %d %v", len(body), err)
	}
	over, _ := entitledUpstream(t, http.StatusOK, bytes.Repeat([]byte("a"), max+1), nil)
	if _, _, err := entitledGet(context.Background(), over, "/x", "tok", max); err == nil {
		t.Fatal("a body one byte over the cap must be refused, not silently truncated")
	}
}

func TestEntitledGetCapsARefusalBody(t *testing.T) {
	base, _ := entitledUpstream(t, http.StatusForbidden, bytes.Repeat([]byte("a"), maxDenialBytes*2), nil)
	body, status, err := entitledGet(context.Background(), base, "/x", "tok", 1<<20)
	if err != nil || status != http.StatusForbidden {
		t.Fatalf("a refusal is not a transport error, got %d %v", status, err)
	}
	if len(body) > maxDenialBytes {
		t.Fatalf("a refusal body is shown to the operator and must be bounded, got %d bytes", len(body))
	}
}

func TestEntitledGetSurfacesATransportFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead := srv.URL
	srv.Close()
	body, status, err := entitledGet(context.Background(), dead, "/x", "tok", 1<<20)
	if err == nil {
		t.Fatal("an unreachable host must be an error")
	}
	if status != 0 || body != nil {
		t.Fatalf("a transport failure has no status and no body, got %d %q", status, body)
	}
}
