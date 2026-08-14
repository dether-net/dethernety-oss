package daemoncmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// send issues a request with an optional session header and JSON body, returning the status and body.
func send(t *testing.T, method, url, session, body string) (int, string) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if session != "" {
		req.Header.Set(sessionHeader, session)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func applyBody(redirect string) string {
	// The recipe block carries newlines; JSON-escape them.
	return `{"recipe":` + jsonString(validRecipeBlock()) + `,"redirectUri":"` + redirect + `"}`
}

// jsonString quotes s as a JSON string literal (small helper so the tests read as request bodies).
func jsonString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func TestCloudApplyWritesModeLayerAndFlipsPhase(t *testing.T) {
	// authDisabled=false so, once the console writes the cloud file, the phase reads post-cloud.
	plat := fakePlatform(t, false, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	// Before: auth on, no cloud file → own-IdP (authenticated).
	if _, body := get(t, ts.URL, "/api/mode", sid); !strings.Contains(string(body), phaseAuthenticated) {
		t.Fatalf("before apply the phase should be authenticated, got %s", body)
	}

	code, body := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback"))
	if code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		t.Fatal("apply must write a cloud mode-layer file")
	}
	// The applying session survives the flip (on the grace deadline), so the SPA reads on without a
	// sign-in bounce — which is what keeps the response's "recreate the stack" instruction on screen.
	// After: the phase reads post-cloud and cloudFileWritten is true.
	_, modeBody := get(t, ts.URL, "/api/mode", sid)
	if !strings.Contains(string(modeBody), phasePostCloud) || !strings.Contains(string(modeBody), `"cloudFileWritten":true`) {
		t.Fatalf("after apply the phase should be post-cloud with cloudFileWritten, got %s", modeBody)
	}
}

func TestCloudApplyRefusesWhenAlreadyCloud(t *testing.T) {
	plat := fakePlatform(t, false, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	if code, body := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("first apply must be 200, got %d %s", code, body)
	}
	// The write guard: a second apply while a cloud file exists is refused — this closes the
	// restart-window reconfiguration the console's own restart opens.
	if code, _ := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusConflict {
		t.Fatalf("a second apply over a cloud file must be 409, got %d", code)
	}
}

func TestCloudApplyRejectsForeignKeyAndWritesNothing(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	body := `{"recipe":` + jsonString(validRecipeBlock()+"NODE_OPTIONS=--require /x\n") + `,"redirectUri":"https://front.example/auth/callback"}`
	if code, resp := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, body); code != http.StatusBadRequest {
		t.Fatalf("a foreign key must be 400, got %d %s", code, resp)
	}
	if _, err := os.Stat(s.cfg.ModeLayerPath); !os.IsNotExist(err) {
		t.Fatal("a rejected apply must write nothing")
	}
}

func TestCloudDisableRevertsWithoutTheCloud(t *testing.T) {
	// A platform that is DOWN: disable must still succeed, proving the recovery path needs no cloud.
	plat := fakePlatform(t, false, nil)
	plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	// Seed a cloud file directly, as if a prior apply had run.
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	if code, body := send(t, http.MethodDelete, ts.URL+"/api/cloud", sid, ""); code != http.StatusOK {
		t.Fatalf("disable must be 200 even with the platform down, got %d %s", code, body)
	}
	if isCloudModeFile(s.cfg.ModeLayerPath) {
		t.Fatal("disable must leave a pure-OSS mode file, not a cloud one")
	}
	if _, err := os.Stat(s.cfg.ModeLayerPath); err != nil {
		t.Fatal("disable must rewrite the file, never delete it")
	}
}

func TestCloudApplyRejectsBadRedirect(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	body := `{"recipe":` + jsonString(validRecipeBlock()) + `,"redirectUri":"not-a-url"}`
	if code, _ := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, body); code != http.StatusBadRequest {
		t.Fatalf("a malformed redirect URI must be 400, got %d", code)
	}
	if _, err := os.Stat(s.cfg.ModeLayerPath); !os.IsNotExist(err) {
		t.Fatal("a rejected apply must write nothing")
	}
}

// The connect restart window: the console wrote a cloud file, but the platform has not recreated
// into it yet (still noauth). A restart is owed.
func TestCloudModeConnectRestartWindow(t *testing.T) {
	plat := fakePlatform(t, true, nil) // authDisabled=true: platform still pre-cloud
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	if code, body := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatalf("apply must be 200, got %d %s", code, body)
	}
	_, body := get(t, ts.URL, "/api/mode", sid)
	if !strings.Contains(string(body), phasePreCloud) ||
		!strings.Contains(string(body), `"cloudFileWritten":true`) ||
		!strings.Contains(string(body), `"restartPending":true`) {
		t.Fatalf("connect window must be pre-cloud + cloudFileWritten + restartPending, got %s", body)
	}
}

// The disconnect restart window: the console wrote the pure-OSS file, but the platform is still
// running the cloud (auth on). A restart is owed, and the panel must NOT offer to reconnect.
func TestCloudModeDisconnectRestartWindow(t *testing.T) {
	plat := fakePlatform(t, false, nil) // authDisabled=false: platform still running cloud
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	// Seed a cloud file, then disconnect through the route.
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)

	if code, _ := send(t, http.MethodDelete, ts.URL+"/api/cloud", sid, ""); code != http.StatusOK {
		t.Fatal("disconnect must be 200")
	}
	_, body := get(t, ts.URL, "/api/mode", sid)
	if !strings.Contains(string(body), phaseAuthenticated) ||
		!strings.Contains(string(body), `"cloudFileWritten":false`) ||
		!strings.Contains(string(body), `"restartPending":true`) {
		t.Fatalf("disconnect window must be authenticated + no cloud file + restartPending, got %s", body)
	}
}

// A cloud file is written and the platform is unreachable (mid-restart): report the file but assert
// no restart-pending — the unreachable phase already speaks for itself, and asserting pending here
// would also fire for a plain crash.
func TestCloudModeUnreachableReportsCloudFile(t *testing.T) {
	plat := fakePlatform(t, false, nil)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	sid := signIn(t, s)
	if code, _ := send(t, http.MethodPost, ts.URL+"/api/cloud", sid, applyBody("https://front.example/auth/callback")); code != http.StatusOK {
		t.Fatal("apply must be 200")
	}
	plat.Close() // platform goes away

	_, body := get(t, ts.URL, "/api/mode", sid)
	if !strings.Contains(string(body), phaseUnreachable) ||
		!strings.Contains(string(body), `"cloudFileWritten":true`) ||
		!strings.Contains(string(body), `"restartPending":false`) {
		t.Fatalf("unreachable must report cloudFileWritten but not restartPending, got %s", body)
	}
}

func TestCloudRoutesRequireSession(t *testing.T) {
	plat := fakePlatform(t, true, nil)
	defer plat.Close()
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	ts := httptest.NewServer(s.routes())
	defer ts.Close()

	if code, _ := send(t, http.MethodPost, ts.URL+"/api/cloud", "", applyBody("https://front.example/auth/callback")); code != http.StatusUnauthorized {
		t.Fatalf("POST /api/cloud without a session must be 401, got %d", code)
	}
	if code, _ := send(t, http.MethodDelete, ts.URL+"/api/cloud", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("DELETE /api/cloud without a session must be 401, got %d", code)
	}
}
