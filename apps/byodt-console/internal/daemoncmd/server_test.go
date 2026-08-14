package daemoncmd

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
)

// fakePlatform serves the three endpoints the daemon probes. registered drives the GraphQL
// module set; down makes every endpoint fail so the daemon sees platform-unreachable.
func fakePlatform(t *testing.T, authDisabled bool, registered []string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"authDisabled": authDisabled,
			"oidcIssuer":   "",
			"oidcClientId": "clientid123", // matches validRecipeVars()'s OIDC_CLIENT_ID
			"oidcScope":    "openid profile email https://api.byodt.dethernety.io/content.access",
		})
	})
	mux.HandleFunc("POST /graphql", func(w http.ResponseWriter, _ *http.Request) {
		mods := make([]map[string]string, 0, len(registered))
		for _, n := range registered {
			mods = append(mods, map[string]string{"name": n, "version": "1.0.0"})
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"modules": mods}})
	})
	return httptest.NewServer(mux)
}

// fakePlatformCloud is fakePlatform's cloud counterpart: /config reports auth on, and the GraphQL
// { modules } query returns clean data ONLY when the request carries the good bearer, else an
// errors[] response with HTTP 200 — mimicking the platform's production behaviour (the guard rejects
// an unlisted/garbage token, and formatError masks the reason to a generic message). It is what the
// binary delegation probe is tested against.
func fakePlatformCloud(t *testing.T, goodBearer string, registered []string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"authDisabled": false, "oidcClientId": "clientid123"})
	})
	mux.HandleFunc("POST /graphql", func(w http.ResponseWriter, r *http.Request) {
		if bearerToken(r) != goodBearer {
			// Production shape: 200 with an errors[] and a masked message, no data.
			json.NewEncoder(w).Encode(map[string]any{"errors": []map[string]string{{"message": "Internal server error"}}})
			return
		}
		mods := make([]map[string]string, 0, len(registered))
		for _, n := range registered {
			mods = append(mods, map[string]string{"name": n, "version": "1.0.0"})
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"modules": mods}})
	})
	return httptest.NewServer(mux)
}

func newTestServer(t *testing.T, platformURL, statePath string) *server {
	t.Helper()
	// The SPA is served from the build-populated embed tree, the same tree every daemon test
	// already requires to compile (daemoncmd → initcmd → assets). Run build-assets.sh first.
	ui, err := assets.ConsoleUI()
	if err != nil {
		t.Fatal(err)
	}
	return &server{
		cfg:         Config{StatePath: statePath, PlatformURL: platformURL, ModeLayerPath: filepath.Join(t.TempDir(), "mode.env"), ContentCacheDir: "/graph/module-content-cache", ProbeTimeout: 5 * time.Second},
		sess:        newSessions(),
		plat:        newPlatformClient(platformURL, 5*time.Second),
		ui:          ui,
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		mintLimiter: newSemaphore(mintConcurrency),
	}
}

// signIn seeds a long-lived session directly on the store. The gated-route tests care only that a
// valid session unlocks a route, not how it was minted — and minting through the endpoint is now
// posture-dependent (several tests seed a cloud mode file before signing in), so a direct seed
// keeps them posture-independent. The endpoint mint is covered on its own by the mint tests.
func signIn(t *testing.T, s *server) string {
	t.Helper()
	id, err := s.sess.mint(0)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func get(t *testing.T, base, path, session string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+path, nil)
	if session != "" {
		req.Header.Set(sessionHeader, session)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func TestSessionGate(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	// No mode file → local posture: the mint takes no credential.
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	// /healthz is ungated.
	if code, body := get(t, ts.URL, "/healthz", ""); code != 200 || !strings.Contains(string(body), "ok") {
		t.Fatalf("/healthz should be 200 ok, got %d %q", code, body)
	}
	// The shell is ungated (holds no data).
	if code, _ := get(t, ts.URL, "/", ""); code != 200 {
		t.Fatalf("/ should serve the shell, got %d", code)
	}
	// A data route without a session is refused.
	if code, _ := get(t, ts.URL, "/api/mode", ""); code != http.StatusUnauthorized {
		t.Fatalf("/api/mode without a session must be 401, got %d", code)
	}

	// Local posture: the mint needs no credential and yields a session.
	resp, err := http.Post(ts.URL+"/api/session", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("local mint must be 200, got %d", resp.StatusCode)
	}
	// A session is never set as a cookie.
	if len(resp.Cookies()) != 0 {
		t.Fatal("the session must never be delivered as a cookie")
	}
	var out struct {
		Session string `json:"session"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if out.Session == "" {
		t.Fatal("expected a session id")
	}
	// That session unlocks the data routes.
	if code, _ := get(t, ts.URL, "/api/mode", out.Session); code != 200 {
		t.Fatalf("/api/mode with a session must be 200, got %d", code)
	}
}

func TestServesSPA(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	// The shell is the built Vue app: 200, HTML, carrying the mount point the bundle hydrates.
	code, body := get(t, ts.URL, "/", "")
	if code != 200 || !strings.Contains(string(body), `id="app"`) {
		t.Fatalf(`/ must serve the SPA shell with the #app mount point, got %d %q`, code, body)
	}

	// The hashed bundle the shell references must serve from /assets/ — this proves the
	// embed → fs.Sub → FileServerFS wiring end to end, not just that index.html exists.
	ref := regexp.MustCompile(`/assets/[^"']+\.js`).FindString(string(body))
	if ref == "" {
		t.Fatalf("the shell references no /assets/ bundle: %s", body)
	}
	if code, _ := get(t, ts.URL, ref, ""); code != 200 {
		t.Fatalf("bundle %s must serve 200, got %d", ref, code)
	}
}

func TestModePhase(t *testing.T) {
	// authDisabled → pre-cloud.
	plat := fakePlatform(t, true, nil)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	sid := signIn(t, s)
	_, body := get(t, ts.URL, "/api/mode", sid)
	if !strings.Contains(string(body), phasePreCloud) {
		t.Fatalf("authDisabled must be pre-cloud, got %s", body)
	}
	ts.Close()
	plat.Close()

	// Platform down → platform-unreachable (the daemon points at a closed server).
	s2 := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json")) // plat already closed
	ts2 := httptest.NewServer(s2.routes())
	defer ts2.Close()
	sid2 := signIn(t, s2)
	if _, body := get(t, ts2.URL, "/api/mode", sid2); !strings.Contains(string(body), phaseUnreachable) {
		t.Fatalf("a down platform must be platform-unreachable, got %s", body)
	}
}

func TestStateViewFewerModules(t *testing.T) {
	// A state file recording two placed modules; the platform registered only one.
	statePath := filepath.Join(t.TempDir(), "state.json")
	stateJSON := `{
	  "schema": "dethernety.byodt-console-state/1", "tag": "v0.5.0", "ranAt": "2026-08-10T00:00:00Z",
	  "modules": { "status": "ok", "expected": [
	    {"name":"dethernety-general","version":"0.5.0","outcome":"placed"},
	    {"name":"dethernety-threat-report","version":"0.5.0","outcome":"placed"}
	  ]},
	  "ingest": { "status": "ok", "statements": 26262 }
	}`
	if err := os.WriteFile(statePath, []byte(stateJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	plat := fakePlatform(t, true, []string{"dethernety-general"}) // threat-report missing
	defer plat.Close()
	s := newTestServer(t, plat.URL, statePath)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	_, body := get(t, ts.URL, "/api/state", sid)
	if !strings.Contains(string(body), failFewerModules) || !strings.Contains(string(body), "dethernety-threat-report") {
		t.Fatalf("state view must name the unregistered module, got %s", body)
	}
}

func TestStateViewInitNotRun(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "missing.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)
	if _, body := get(t, ts.URL, "/api/state", sid); !strings.Contains(string(body), failInitNotRun) {
		t.Fatalf("a missing state file must surface init-not-run, got %s", body)
	}
}

// twoPlacedStateJSON records two placed modules — the fixture the module-diff tests run against.
const twoPlacedStateJSON = `{
  "schema": "dethernety.byodt-console-state/1", "tag": "v0.5.0", "ranAt": "2026-08-10T00:00:00Z",
  "modules": { "status": "ok", "expected": [
    {"name":"dethernety-general","version":"0.5.0","outcome":"placed"},
    {"name":"dethernety-threat-report","version":"0.5.0","outcome":"placed"}
  ]},
  "ingest": { "status": "ok", "statements": 26262 }
}`

// TestStateDiffForwardsBearerNotFalseUnreachable is the P4 fix: in cloud posture the module registry is
// authenticated, so state() must forward the operator's bearer to it and must NOT mistake a rejected (or
// bearer-less) module query for the platform being down. Reachability comes from /config.
func TestStateDiffForwardsBearerNotFalseUnreachable(t *testing.T) {
	const good = "good.id.token"
	// /config is reachable; the module query is clean only with the good bearer, and registers only
	// dethernety-general (so the placed dethernety-threat-report is the unregistered one).
	plat := fakePlatformCloud(t, good, []string{"dethernety-general"})
	defer plat.Close()
	statePath := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(statePath, []byte(twoPlacedStateJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, plat.URL, statePath)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	// No bearer: /config is reachable, but the tokenless module query is rejected. The diff is skipped —
	// NOT reported as unreachable, and no false placed-but-not-registered banner.
	_, body := get(t, ts.URL, "/api/state", sid)
	if strings.Contains(string(body), failPlatformDown) {
		t.Fatalf("a reachable platform must not report platform-unreachable, got %s", body)
	}
	if strings.Contains(string(body), failFewerModules) {
		t.Fatalf("a skipped diff must not claim fewer modules, got %s", body)
	}

	// With the operator's bearer: the module query is accepted, the diff runs, and it names the
	// unregistered module.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
	req.Header.Set(sessionHeader, sid)
	req.Header.Set("Authorization", "Bearer "+good)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(b), failFewerModules) || !strings.Contains(string(b), "dethernety-threat-report") {
		t.Fatalf("with the bearer the diff must name the unregistered module, got %s", b)
	}
}

// TestStatePlatformDownReportsUnreachable: a genuinely-down platform (/config unreachable) still surfaces
// the platform-unreachable banner — the fix removes the false positive, not the real signal.
func TestStatePlatformDownReportsUnreachable(t *testing.T) {
	plat := fakePlatformCloud(t, "good", nil)
	plat.Close() // platform is down — /config will fail
	statePath := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(statePath, []byte(twoPlacedStateJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, plat.URL, statePath)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	if _, body := get(t, ts.URL, "/api/state", sid); !strings.Contains(string(body), failPlatformDown) {
		t.Fatalf("a down platform must report platform-unreachable, got %s", body)
	}
}

// TestSemaphore covers the shed-load primitive the cloud mint's 503 path relies on: it caps concurrency,
// refuses when full, and frees a slot on release. Deterministic — no HTTP or goroutines.
func TestSemaphore(t *testing.T) {
	s := newSemaphore(1)
	if !s.tryAcquire() {
		t.Fatal("the first acquire on an empty semaphore must succeed")
	}
	if s.tryAcquire() {
		t.Fatal("a second acquire on a full semaphore must be refused")
	}
	s.release()
	if !s.tryAcquire() {
		t.Fatal("an acquire after release must succeed")
	}
}

// TestPostureUngated: /api/posture must answer without a session (the sign-in page reads it before it
// can hold one) — unlike the gated data routes TestSessionGate covers.
func TestPostureUngated(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	if code, body := get(t, ts.URL, "/api/posture", ""); code != 200 {
		t.Fatalf("/api/posture must be ungated (200 without a session), got %d %s", code, body)
	}
}

// TestPostureReflectsModeFile: posture and the OIDC discovery fields track the console-written mode file.
func TestPostureReflectsModeFile(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	read := func() postureView {
		t.Helper()
		code, body := get(t, ts.URL, "/api/posture", "")
		if code != 200 {
			t.Fatalf("posture: got %d %s", code, body)
		}
		var pv postureView
		if err := json.Unmarshal(body, &pv); err != nil {
			t.Fatalf("decoding posture: %v (%s)", err, body)
		}
		return pv
	}

	// No mode file yet → the pre-cloud default: local, auth-disabled, no OIDC.
	if pv := read(); pv.Posture != "local" || !pv.AuthDisabled || pv.OIDCClientID != "" {
		t.Fatalf("missing mode file must be local/authDisabled/no-oidc, got %+v", pv)
	}

	// Pure-OSS → local, auth-disabled, no OIDC.
	if err := writeModeLayer(s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	if pv := read(); pv.Posture != "local" || !pv.AuthDisabled || pv.OIDCClientID != "" {
		t.Fatalf("pure-OSS must be local/authDisabled/no-oidc, got %+v", pv)
	}

	// Cloud → cloud, auth-on, OIDC discovery surfaced.
	if err := writeModeLayer(s.cfg.ModeLayerPath, map[string]string{
		"NODE_ENV":             "production",
		"OIDC_SHARED_POOL":     "true",
		"OIDC_DOMAIN":          "auth.example.com",
		"OIDC_CLIENT_ID":       "clientid123",
		"OIDC_SCOPE":           "openid profile email",
		"DEPLOYMENT_ALLOWLIST": "subA,subB",
	}); err != nil {
		t.Fatal(err)
	}
	pv := read()
	if pv.Posture != "cloud" || pv.AuthDisabled {
		t.Fatalf("cloud must be cloud/auth-on, got %+v", pv)
	}
	if pv.OIDCDomain != "auth.example.com" || pv.OIDCClientID != "clientid123" || pv.OIDCScope != "openid profile email" {
		t.Fatalf("cloud OIDC discovery not surfaced: %+v", pv)
	}
}

// TestPostureNeverLeaksAllowlist: the hard projection must not surface the allowlist or the other
// non-discovery values the mode file also carries — the whole point of a fixed field set over the map.
func TestPostureNeverLeaksAllowlist(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	if err := writeModeLayer(s.cfg.ModeLayerPath, map[string]string{
		"NODE_ENV":              "production",
		"OIDC_SHARED_POOL":      "true",
		"OIDC_DOMAIN":           "auth.example.com",
		"OIDC_CLIENT_ID":        "clientid123",
		"OIDC_SCOPE":            "openid",
		"OIDC_JWKS_URI":         "https://auth.example.com/.well-known/jwks.json",
		"OIDC_AUDIENCE":         "clientid123",
		"DEPLOYMENT_ALLOWLIST":  "subA,subB",
		"COMMERCE_API_BASE_URL": "https://commerce.example.com",
	}); err != nil {
		t.Fatal(err)
	}
	_, body := get(t, ts.URL, "/api/posture", "")
	// Match on the member ids, the non-discovery URLs, and the key names — none may appear. (The
	// audience VALUE equals the returned client id, so it can't be a leak marker; its KEY name can.)
	for _, leak := range []string{"subA", "subB", "DEPLOYMENT_ALLOWLIST", "COMMERCE_API_BASE_URL", "OIDC_JWKS_URI", "OIDC_AUDIENCE", "commerce.example.com", "jwks"} {
		if strings.Contains(string(body), leak) {
			t.Fatalf("/api/posture leaked %q: %s", leak, body)
		}
	}
}

// writeCloudModeFile stamps the minimal cloud mode file: OIDC_SHARED_POOL is the marker that makes
// modeFileIntent classify it as cloud, which is what flips the mint into its delegation branch.
func writeCloudModeFile(t *testing.T, s *server) {
	t.Helper()
	if err := writeModeLayer(s.cfg.ModeLayerPath, map[string]string{
		"NODE_ENV":         "production",
		"OIDC_SHARED_POOL": "true",
	}); err != nil {
		t.Fatal(err)
	}
}

// mintWithBearer POSTs /api/session carrying an optional bearer (the operator's ID token in cloud
// posture), returning the status and the session id (empty unless a session was minted).
func mintWithBearer(t *testing.T, base, bearer string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, base+"/api/session", nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Session string `json:"session"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out.Session
}

// TestLocalMintNoCredential: with no cloud mode file, the mint takes no credential and the session
// it returns unlocks a gated route.
func TestLocalMintNoCredential(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	code, sid := mintWithBearer(t, ts.URL, "") // no bearer
	if code != http.StatusOK || sid == "" {
		t.Fatalf("local mint must be 200 with a session, got %d %q", code, sid)
	}
	if code, _ := get(t, ts.URL, "/api/mode", sid); code != 200 {
		t.Fatalf("the local session must unlock /api/mode, got %d", code)
	}
}

// TestCloudMintDelegates: in cloud posture the mint delegates to the platform. A good bearer (the
// platform returns clean data) mints; a bad bearer (the platform returns errors[]) does NOT mint and
// is reported as retry, not a token reject; a missing bearer is a 400, never a 401.
func TestCloudMintDelegates(t *testing.T) {
	const good = "good.id.token"
	plat := fakePlatformCloud(t, good, []string{"dethernety-general"})
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	writeCloudModeFile(t, s)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	// Good bearer → the platform accepts → mint, and the session unlocks a gated route.
	code, sid := mintWithBearer(t, ts.URL, good)
	if code != http.StatusOK || sid == "" {
		t.Fatalf("a good cloud sign-in must mint (200 + session), got %d %q", code, sid)
	}
	if code, _ := get(t, ts.URL, "/api/mode", sid); code != 200 {
		t.Fatalf("the cloud session must unlock /api/mode, got %d", code)
	}

	// Garbage bearer → the platform rejects → 503 retry, no session.
	code, sid = mintWithBearer(t, ts.URL, "garbage.token")
	if code != http.StatusServiceUnavailable || sid != "" {
		t.Fatalf("a rejected cloud sign-in must be 503 with no session, got %d %q", code, sid)
	}

	// Missing bearer → 400 (never 401, so the SPA's session-expired path can't fire on the mint).
	code, sid = mintWithBearer(t, ts.URL, "")
	if code != http.StatusBadRequest || sid != "" {
		t.Fatalf("a cloud mint with no bearer must be 400 with no session, got %d %q", code, sid)
	}
}

// TestCloudMintPlatformDownIsRetryNotReject: a platform that cannot be reached is a transport error,
// which the binary probe must treat as "retry", not as a bad token — the two are indistinguishable.
func TestCloudMintPlatformDownIsRetryNotReject(t *testing.T) {
	plat := fakePlatformCloud(t, "good", nil)
	plat.Close() // platform is down
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	writeCloudModeFile(t, s)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/session", nil)
	req.Header.Set("Authorization", "Bearer good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("a down platform must be 503 (retry), got %d", resp.StatusCode)
	}
	if !strings.Contains(string(b), "retry") {
		t.Fatalf("the message must say retry, got %q", b)
	}
	// It must NOT assert a token problem: a blip is not a reject.
	if strings.Contains(strings.ToLower(string(b)), "invalid") || strings.Contains(string(b), "token") {
		t.Fatalf("a platform blip must not be reported as a token problem, got %q", b)
	}
}

// TestCloudSessionExpiresAtGate: a cloud session past its fixed expiry is refused by the gate (401),
// which is what drives the SPA back to sign-in. Driven through requireSession with an injected clock,
// so no sleeping and no server goroutine reads the clock.
func TestCloudSessionExpiresAtGate(t *testing.T) {
	s := newTestServer(t, "http://unused", filepath.Join(t.TempDir(), "state.json"))
	now := clockBase
	s.sess.now = func() time.Time { return now }
	id, err := s.sess.mint(cloudSessionTTL)
	if err != nil {
		t.Fatal(err)
	}
	gate := s.sess.requireSession(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/mode", nil)
		req.Header.Set(sessionHeader, id)
		rec := httptest.NewRecorder()
		gate(rec, req)
		return rec.Code
	}
	if code := call(); code != http.StatusOK {
		t.Fatalf("before expiry the gate must pass, got %d", code)
	}
	now = clockBase.Add(cloudSessionTTL + time.Second)
	if code := call(); code != http.StatusUnauthorized {
		t.Fatalf("past expiry the gate must 401, got %d", code)
	}
}

// TestPostureFlipDropsOtherSessionsAndKeepsTheCaller: the two mode-mutation handlers drop the session
// set on the flip, so no session minted under one posture survives into the other — except the caller
// that performed the flip, which keeps its session for the grace window so it can act on the
// "recreate the stack" instruction the same response carries. Asserted on both flip directions.
func TestPostureFlipDropsOtherSessionsAndKeepsTheCaller(t *testing.T) {
	// Connect (local → cloud).
	plat := fakePlatform(t, false, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)
	other := signIn(t, s) // a second client, e.g. another tab
	if code, _ := get(t, ts.URL, "/api/mode", sid); code != 200 {
		t.Fatalf("the session must be valid before connect, got %d", code)
	}
	if code, body := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("connect must be 200, got %d %s", code, body)
	}
	if code, _ := get(t, ts.URL, "/api/mode", sid); code != http.StatusOK {
		t.Fatalf("connect must keep the applying session live so its instruction stays actionable, got %d", code)
	}
	if code, _ := get(t, ts.URL, "/api/mode", other); code != http.StatusUnauthorized {
		t.Fatalf("connect must drop every other session (401), got %d", code)
	}

	// Disconnect (cloud → local).
	s2 := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeModeLayer(s2.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}
	ts2 := httptest.NewServer(s2.routes())
	defer ts2.Close()
	sid2 := signIn(t, s2)
	other2 := signIn(t, s2)
	if code, _ := send(t, http.MethodDelete, ts2.URL+"/api/cloud", sid2, ""); code != http.StatusOK {
		t.Fatalf("disconnect must be 200, got %d", code)
	}
	if code, _ := get(t, ts2.URL, "/api/mode", sid2); code != http.StatusOK {
		t.Fatalf("disconnect must keep the disconnecting session live, got %d", code)
	}
	if code, _ := get(t, ts2.URL, "/api/mode", other2); code != http.StatusUnauthorized {
		t.Fatalf("disconnect must drop every other session (401), got %d", code)
	}
}
