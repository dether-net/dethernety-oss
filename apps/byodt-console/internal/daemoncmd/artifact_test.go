package daemoncmd

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall"
	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall/moduleinstalltest"
	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

func TestCloudAccessTokenReadsItsOwnHeader(t *testing.T) {
	read := func(set func(h http.Header)) string {
		r := httptest.NewRequest(http.MethodPost, "/api/artifacts", nil)
		set(r.Header)
		return cloudAccessToken(r)
	}
	if got := read(func(h http.Header) { h.Set(cloudTokenHeader, "acc-tok") }); got != "acc-tok" {
		t.Fatalf("the access token must be read from its own header, got %q", got)
	}
	if got := read(func(http.Header) {}); got != "" {
		t.Fatalf("an absent header must read as empty, got %q", got)
	}
	// The case that matters: two tokens for two audiences ride on two headers, and neither reader may
	// answer the other's question. A request carrying only the ID token has no access token.
	if got := read(func(h http.Header) { h.Set("Authorization", "Bearer id-tok") }); got != "" {
		t.Fatalf("the ID token must never be read as the access token, got %q", got)
	}
}

// ── The install path ─────────────────────────────────────────────────────────────────────────────

const (
	artifactKey     = "acme-risk-engine"
	artifactVersion = "1.3.0"
	signerPrefix    = "https://github.example/acme/acme-artifacts/.github/workflows/publish-artifact.yml"
	// The subject the console must derive and pin — never a pattern, never a wildcard on either half.
	wantIdentity = signerPrefix + "@refs/tags/artifact/" + artifactKey + "/" + artifactVersion
)

// sendArtifact posts an install request. The package's send() helper cannot carry the cloud token — it
// predates the header — so this is its sibling rather than a widening of a helper three files share.
func sendArtifact(t *testing.T, base, session, cloudToken, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/api/artifacts", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(sessionHeader, session)
	if cloudToken != "" {
		req.Header.Set(cloudTokenHeader, cloudToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, strings.TrimSpace(string(out))
}

func installBody(key, version string) string {
	return fmt.Sprintf(`{"artifactKey":%q,"version":%q}`, key, version)
}

// undialledUpstream fails the test if it is ever called. It is what turns "refused before any network
// call" from a comment into an assertion.
func undialledUpstream(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("the console must not dial the content service for this request, got %s", r.URL.Path)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// artifactUpstream serves a descriptor and an archive for one key/version, and records the paths asked
// for. descriptorOverride, when non-empty, replaces the generated descriptor body verbatim.
func artifactUpstream(t *testing.T, archive []byte, digest, descriptorOverride string) string {
	t.Helper()
	desc := descriptorOverride
	if desc == "" {
		desc = fmt.Sprintf(`{"artifactKey":%q,"version":%q,"kind":"code-module",`+
			`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
			`"signature":{"format":%q,"bundle":%q}}`,
			artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
			base64.StdEncoding.EncodeToString([]byte("not-a-real-bundle")))
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(desc))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(archive)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

// blockingArtifactUpstream is artifactUpstream with a gate on the ARCHIVE route: the returned entered
// channel closes once a request has reached it, and release lets that request finish. The descriptor route
// is not gated, so a caller can reason about where in the sequence the install is parked.
//
// CLEANUP ORDER IS LOAD-BEARING, and it spans two helpers. Cleanups run LIFO, and BOTH httptest servers
// — this upstream and the daemon's — wait for outstanding requests in Close. An install parked on the gate
// below holds a request open on the daemon's server, so release must run before EITHER Close. This helper
// registers it, but the daemon's server is built afterwards and its Close would therefore run first, so
// every caller re-registers release once it has that server: the last registration runs first, and the
// sync.Once makes the second call a no-op. Without it a failed assertion hangs the package for the whole
// test timeout instead of reporting the failure.
func blockingArtifactUpstream(t *testing.T, archive []byte, digest string) (base string, entered <-chan struct{}, release func()) {
	t.Helper()
	enteredCh := make(chan struct{})
	releaseCh := make(chan struct{})
	var releaseOnce, enterOnce sync.Once
	release = func() { releaseOnce.Do(func() { close(releaseCh) }) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"artifactKey":%q,"version":%q,"kind":"code-module",`+
			`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
			`"signature":{"format":%q,"bundle":%q}}`,
			artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
			base64.StdEncoding.EncodeToString([]byte("not-a-real-bundle")))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(w http.ResponseWriter, _ *http.Request) {
		// Reached only after the handler took the lock, which is what makes a handshake on it sound.
		enterOnce.Do(func() { close(enteredCh) })
		<-releaseCh
		_, _ = w.Write(archive)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Cleanup(release) // LIFO: this runs BEFORE Close, so Close never waits on a parked handler
	return srv.URL, enteredCh, release
}

// installAnswer is one install's HTTP result, carried back from the goroutine that sent it. A transport
// failure arrives as code 0 with the error in out, because a goroutine cannot fail the test itself.
type installAnswer struct {
	code int
	out  string
}

// installInBackground posts an install and reports its answer on the returned channel. Not sendArtifact:
// that calls t.Fatal, which from a non-test goroutine ends the wrong one and leaves the assertions unrun.
func installInBackground(base, sid, body string) <-chan installAnswer {
	done := make(chan installAnswer, 1)
	go func() {
		req, err := http.NewRequest(http.MethodPost, base+"/api/artifacts", strings.NewReader(body))
		if err != nil {
			done <- installAnswer{0, err.Error()}
			return
		}
		req.Header.Set(sessionHeader, sid)
		req.Header.Set(cloudTokenHeader, "acc-tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			done <- installAnswer{0, err.Error()}
			return
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		done <- installAnswer{resp.StatusCode, strings.TrimSpace(string(out))}
	}()
	return done
}

// newArtifactServer builds a cloud-mode server whose mode layer names contentBase and (unless signer is
// empty) the artifact signer, with v as the verification seam.
func newArtifactServer(t *testing.T, contentBase, signer string, v moduleinstall.Verifier) (base, session string, s *server) {
	t.Helper()
	return newArtifactServerWith(t, contentBase, signer, v, nil)
}

// newArtifactServerWith is newArtifactServer with a seam onto the httptest.Server before it starts, for
// the one test that has to set a server-level timeout. Unstarted-then-tuned-then-started, because
// http.Server's timeouts are read when a connection is served and cannot be changed afterwards.
func newArtifactServerWith(t *testing.T, contentBase, signer string, v moduleinstall.Verifier, tune func(*httptest.Server)) (base, session string, s *server) {
	t.Helper()
	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s = newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	s.verify = v
	seedCloudContentFile(t, s.cfg.ModeLayerPath, contentBase)
	if signer != "" {
		vars, err := readModeLayer(s.cfg.ModeLayerPath)
		if err != nil {
			t.Fatal(err)
		}
		vars["DEPLOYMENT_ARTIFACT_SIGNER"] = signer
		if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
			t.Fatal(err)
		}
	}
	ts := httptest.NewUnstartedServer(s.routes())
	if tune != nil {
		tune(ts)
	}
	ts.Start()
	t.Cleanup(ts.Close)
	return ts.URL, signIn(t, s), s
}

// genuineArchive builds an archive the staging sequence accepts end to end.
func genuineArchive(t *testing.T) (archive []byte, digest string) {
	t.Helper()
	a, d, _ := moduleinstalltest.BuildModuleTarball(t, artifactKey, artifactVersion,
		map[string]string{"AcmeRiskEngineModule.js": "module.exports = {}\n"})
	return a, d
}

func TestInstallArtifactPinsTheDerivedIdentity(t *testing.T) {
	// The assertion the whole slice rests on. Every other stubbed test here and in the placement slice
	// is only an assertion about this install path because THIS one proves the seam is called with a
	// subject derived from the request — naming this artifact at this version — rather than a pattern
	// that would let one version's genuine bytes satisfy a request for another.
	archive, digest := genuineArchive(t)
	rv := &moduleinstalltest.RecordingVerifier{}
	base, sid, _ := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, rv)

	sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))

	if len(rv.Calls) != 1 {
		t.Fatalf("verification must be attempted exactly once, got %d calls", len(rv.Calls))
	}
	if rv.Calls[0].ID != wantIdentity {
		t.Fatalf("the pinned identity must name this artifact at this version\n got  %s\n want %s", rv.Calls[0].ID, wantIdentity)
	}
	if rv.Calls[0].Issuer != moduleverify.OIDCIssuerGitHubActions {
		t.Fatalf("the issuer must be the pinned constant, got %q", rv.Calls[0].Issuer)
	}
}

// stampedArchive builds an archive whose payload sits under the REQUESTED key — so the layout assertion
// inside the staging sequence passes — but whose stamp names something else. It is constructible at all
// because the payload digest excludes the stamp from its own input, so a divergent name and version leave
// the recomputed digest agreeing with the recorded one; the ONLY check left that can refuse it is the
// artifact path's own binding of the stamp to what was asked for.
func stampedArchive(t *testing.T, stampName, stampVersion string) (archive []byte, digest string) {
	t.Helper()
	root := t.TempDir()
	payload := filepath.Join(root, "dethernety", artifactKey)
	if err := os.MkdirAll(payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(payload, "AcmeRiskEngineModule.js"), []byte("module.exports = {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pd, err := payloaddigest.Compute(payload)
	if err != nil {
		t.Fatal(err)
	}
	stamp := fmt.Sprintf(`{"name":%q,"version":%q,"builtFrom":null,"payloadDigest":%q}`+"\n", stampName, stampVersion, pd)
	if err := os.WriteFile(filepath.Join(payload, payloaddigest.StampFilename), []byte(stamp), 0o644); err != nil {
		t.Fatal(err)
	}
	tarball := moduleinstalltest.TarGzDir(t, root)
	sum := sha256.Sum256(tarball)
	return tarball, "sha256:" + hex.EncodeToString(sum[:])
}

// stagingRoot is the dot-directory an install stages under. Nothing may survive there once a request has
// answered — success or failure — so several tests below ask the same question about it.
func stagingRoot(s *server) string {
	return filepath.Join(s.cfg.ModulesDir, moduleinstall.TmpDirName)
}

func assertStagingGone(t *testing.T, s *server) {
	t.Helper()
	// discardStaging removes the root itself, so "gone" is ENOENT rather than an empty read.
	entries, err := os.ReadDir(stagingRoot(s))
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	t.Fatalf("no staging tree may survive a request, got %v", names)
}

func TestInstallArtifactPlacesAndMarks(t *testing.T) {
	archive, digest := genuineArchive(t)
	base, sid, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})

	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	if code != http.StatusOK {
		t.Fatalf("a fully verified artifact must install, got %d %s", code, body)
	}
	if !strings.Contains(body, platformRestartCommand) {
		t.Fatalf("the answer must carry the restart instruction, got %s", body)
	}
	if !strings.Contains(body, `"version":"`+artifactVersion+`"`) {
		t.Fatalf("the answer must name the version it placed, got %s", body)
	}

	dir := filepath.Join(s.cfg.ModulesDir, artifactKey)
	// The marker: parsed through the same reader ownership rests on, so a marker carrying the wrong
	// schema would fail here exactly as it would fail the next install.
	m, err := readArtifactMarker(dir)
	if err != nil {
		t.Fatalf("the installed tree must carry a readable artifact marker: %v", err)
	}
	if m.Schema != artifactMarkerSchema || m.ArtifactKey != artifactKey || m.Version != artifactVersion || m.InstalledAt == "" {
		t.Fatalf("the marker must describe this install, got %+v", m)
	}
	// The stamp is inside the signed payload and must survive untouched — it and the marker answer two
	// different questions, and the install may not disturb the first while writing the second.
	stamp, err := payloaddigest.ReadStamp(filepath.Join(dir, payloaddigest.StampFilename))
	if err != nil {
		t.Fatalf("the payload stamp must survive the install: %v", err)
	}
	if stamp.Name != artifactKey || stamp.Version != artifactVersion {
		t.Fatalf("the stamp must still describe the payload, got %+v", stamp)
	}
	if _, err := os.Stat(filepath.Join(dir, "AcmeRiskEngineModule.js")); err != nil {
		t.Fatalf("the module file must be placed: %v", err)
	}
	assertStagingGone(t, s)
}

func TestInstallArtifactBindsTheStampToTheRequest(t *testing.T) {
	// The check the staging sequence cannot make. An ACCEPTING verifier makes this test stronger rather
	// than weaker: with the signature stipulated, the only thing left that can refuse these bytes is the
	// artifact path's own comparison of the stamp with what was asked for.
	cases := map[string]struct{ name, version string }{
		"another version":  {artifactKey, "1.1.0"},
		"another artifact": {"acme-other-engine", artifactVersion},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			archive, digest := stampedArchive(t, c.name, c.version)
			rv := &moduleinstalltest.RecordingVerifier{}
			base, sid, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, rv)

			code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
			if code != http.StatusBadGateway || !strings.Contains(body, "nothing was installed") {
				t.Fatalf("a stamp that names something else must refuse, got %d %s", code, body)
			}
			if _, err := os.Stat(filepath.Join(s.cfg.ModulesDir, artifactKey)); !os.IsNotExist(err) {
				t.Fatalf("nothing may be placed, got %v", err)
			}
			// The refusal lands AFTER extraction, which is the whole reason the staging tree has to be
			// discarded on the failure paths and not only on success.
			assertStagingGone(t, s)
			if len(rv.Calls) != 1 || rv.Calls[0].ID != wantIdentity {
				t.Fatalf("the request's own identity must still have been pinned, got %+v", rv.Calls)
			}
		})
	}
}

func TestCompareVersion(t *testing.T) {
	cases := []struct {
		a, b string
		want int
		ok   bool
	}{
		// The case a string comparison gets wrong, which is why this is a numeric comparison.
		{"1.10.0", "1.9.0", 1, true},
		{"1.9.0", "1.10.0", -1, true},
		{"2.0.0", "1.99.99", 1, true},
		{"1.2.3", "1.2.3", 0, true},
		{"0.9.0", "1.0.0", -1, true},
		{"1.0.1", "1.0.0", 1, true},
		// Unreadable on either side. artifactCurrency puts a catalog-supplied version on the right, and
		// nothing validates that before it arrives, so both directions must degrade.
		{"1.2", "1.2.3", 0, false},
		{"1.2.3", "1.2", 0, false},
		{"v1.2.3", "1.2.3", 0, false},
		{"1.2.3", "01.2.0", 0, false},
		{"1.2.3-rc.1", "1.2.3", 0, false},
		{"", "1.2.3", 0, false},
		{"1.2.3", "1234567890.0.0", 0, false},
	}
	for _, c := range cases {
		got, ok := compareVersion(c.a, c.b)
		if got != c.want || ok != c.ok {
			t.Errorf("compareVersion(%q, %q) = (%d, %v), want (%d, %v)", c.a, c.b, got, ok, c.want, c.ok)
		}
	}
}

func TestInstallArtifactRefusesADowngrade(t *testing.T) {
	// Each case gets its own server: the accepted downgrade REPLACES the directory the third case would
	// otherwise be reading.
	seed := func(t *testing.T, s *server, version string) string {
		t.Helper()
		dir := filepath.Join(s.cfg.ModulesDir, artifactKey)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, artifactMarkerName),
			fmt.Appendf(nil, `{"schema":%q,"artifactKey":%q,"version":%q}`, artifactMarkerSchema, artifactKey, version), 0o644); err != nil {
			t.Fatal(err)
		}
		return dir
	}
	newServer := func(t *testing.T) (string, string, *server) {
		t.Helper()
		archive, digest := genuineArchive(t)
		return newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})
	}

	t.Run("refused when it was not asked for", func(t *testing.T) {
		base, sid, s := newServer(t)
		dir := seed(t, s, "1.9.0")
		code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
		if code != http.StatusConflict {
			t.Fatalf("an unrequested downgrade must be refused, got %d %s", code, body)
		}
		// Both versions, because the confirmation the operator is asked for names both.
		if !strings.Contains(body, artifactVersion) || !strings.Contains(body, "1.9.0") {
			t.Fatalf("the refusal must name both versions, got %s", body)
		}
		if m, err := readArtifactMarker(dir); err != nil || m.Version != "1.9.0" {
			t.Fatalf("the installed artifact must be untouched, got %+v (%v)", m, err)
		}
	})

	t.Run("accepted when it was", func(t *testing.T) {
		base, sid, s := newServer(t)
		dir := seed(t, s, "1.9.0")
		body := fmt.Sprintf(`{"artifactKey":%q,"version":%q,"allowDowngrade":true}`, artifactKey, artifactVersion)
		// This is also the proof that allowDowngrade decodes: a field the decoder did not know would be
		// a 400 here, and one declared but never consulted would leave this a 409.
		if code, out := sendArtifact(t, base, sid, "acc-tok", body); code != http.StatusOK {
			t.Fatalf("a downgrade the operator asked for must install, got %d %s", code, out)
		}
		if m, err := readArtifactMarker(dir); err != nil || m.Version != artifactVersion {
			t.Fatalf("the earlier version must now be installed, got %+v (%v)", m, err)
		}
	})

	t.Run("an unreadable installed version refuses on its own terms", func(t *testing.T) {
		base, sid, s := newServer(t)
		seed(t, s, "banana")
		code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
		// Never "compare it as lower and carry on": what is installed is unknown, so replacing it is not
		// a decision this console gets to make silently.
		if code != http.StatusConflict || !strings.Contains(body, "cannot read") {
			t.Fatalf("an unreadable installed version must refuse by name, got %d %s", code, body)
		}
	})
}

func TestInstallArtifactMarksBeforeItPlaces(t *testing.T) {
	// The ordering step 12 exists for, asserted on the production path. Staging succeeds normally; the
	// target is then pointed at a directory whose PARENT does not exist, so the swap's rename fails with
	// ENOENT and the tree is never placed. The marker being in the staged tree at that point is only
	// possible if it was written before the rename — which is what makes it impossible for a loadable
	// tree to exist unmarked, since the rename is what makes the tree loadable.
	archive, digest := genuineArchive(t)
	_, _, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})

	staged, ref := s.stageArtifact(context.Background(), artifactKey, artifactVersion, "acc-tok")
	if ref != nil {
		t.Fatalf("staging must succeed, got %d %s", ref.status, ref.detail)
	}
	t.Cleanup(func() { discardStaging(staged.staging) })
	staged.target = filepath.Join(s.cfg.ModulesDir, "no-such-parent", artifactKey)

	if ref := s.placeArtifact(staged, false); ref == nil || ref.status != http.StatusInternalServerError {
		t.Fatalf("a rename into a missing parent must fail the placement, got %+v", ref)
	}
	if _, err := os.Stat(filepath.Join(staged.payloadRoot, artifactMarkerName)); err != nil {
		t.Fatalf("the marker must already be in the staged tree when the rename is attempted: %v", err)
	}
}

func TestPlaceArtifactRefusesATargetThatBecameForeign(t *testing.T) {
	// The only test in which mayReplace can fire, and the reason it is not optional: the pre-flight
	// ownership check answered before the fetch, and something took the name in between. Only the check
	// adjacent to the rename can still refuse.
	archive, digest := genuineArchive(t)
	_, _, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})

	staged, ref := s.stageArtifact(context.Background(), artifactKey, artifactVersion, "acc-tok")
	if ref != nil {
		t.Fatalf("staging must succeed, got %d %s", ref.status, ref.detail)
	}
	t.Cleanup(func() { discardStaging(staged.staging) })

	if err := os.MkdirAll(staged.target, 0o755); err != nil {
		t.Fatal(err)
	}
	theirs := filepath.Join(staged.target, "TheirModule.js")
	if err := os.WriteFile(theirs, []byte("theirs"), 0o644); err != nil {
		t.Fatal(err)
	}

	ref = s.placeArtifact(staged, false)
	if ref == nil || ref.status != http.StatusConflict || !strings.Contains(ref.detail, "was not installed as an artifact") {
		t.Fatalf("a target that became foreign must be refused, got %+v", ref)
	}
	// Exactly as it was: the refusal is consulted before the stale backup is cleared and before anything
	// is moved aside, so nothing on disk has been touched.
	got, err := os.ReadFile(theirs)
	if err != nil || string(got) != "theirs" {
		t.Fatalf("the foreign tree must be untouched, got %q (%v)", got, err)
	}
	if _, err := os.Stat(backupPath(staged.staging)); !os.IsNotExist(err) {
		t.Fatalf("nothing may have been moved aside, got %v", err)
	}
}

func TestInstallArtifactSerialisesTwoInstalls(t *testing.T) {
	// Two installs of one key share one staging directory, so without serialisation one request can
	// re-extract over bytes the other has already verified and the swap places a tree nobody checked.
	archive, digest := genuineArchive(t)
	upstream, entered, releaseA := blockingArtifactUpstream(t, archive, digest)
	base, sid, s := newArtifactServer(t, upstream, signerPrefix, moduleinstalltest.FakeVerifier{})
	t.Cleanup(releaseA) // must run before either server's Close — see blockingArtifactUpstream

	done := installInBackground(base, sid, installBody(artifactKey, artifactVersion))

	<-entered
	codeB, bodyB := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, "1.9.0"))
	if codeB != http.StatusConflict || !strings.Contains(bodyB, "already running") {
		t.Fatalf("the second install must be refused while the first is in flight, got %d %s", codeB, bodyB)
	}
	releaseA()

	a := <-done
	if a.code != http.StatusOK {
		t.Fatalf("the first install must complete, got %d %s", a.code, a.out)
	}
	// One build described three ways, and the second request never got near any of them.
	if !strings.Contains(a.out, `"version":"`+artifactVersion+`"`) {
		t.Fatalf("the answer must name the version it placed, got %s", a.out)
	}
	dir := filepath.Join(s.cfg.ModulesDir, artifactKey)
	if m, err := readArtifactMarker(dir); err != nil || m.Version != artifactVersion {
		t.Fatalf("the marker must describe the placed build, got %+v (%v)", m, err)
	}
	stamp, err := payloaddigest.ReadStamp(filepath.Join(dir, payloaddigest.StampFilename))
	if err != nil || stamp.Version != artifactVersion {
		t.Fatalf("the stamp must describe the placed build, got %+v (%v)", stamp, err)
	}
	assertStagingGone(t, s)
}

func TestInstallArtifactSurvivesAShortServerWriteTimeout(t *testing.T) {
	// The server-wide WriteTimeout is armed when the request headers are read, so it is the handler's
	// whole wall-clock budget — and this is the one handler that can outrun it. Past it the install still
	// completes on disk while the 200 cannot be written, so a success reaches the browser as a dropped
	// connection and the operator never sees the instruction that makes the module load.
	//
	// Scaled down rather than reproduced: a 200 ms server budget against an upstream that takes 400 ms is
	// the same relationship as 30 s against two 60 s fetches, and runs in half a second.
	archive, digest := genuineArchive(t)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"artifactKey":%q,"version":%q,"kind":"code-module",`+
			`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
			`"signature":{"format":%q,"bundle":%q}}`,
			artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
			base64.StdEncoding.EncodeToString([]byte("not-a-real-bundle")))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(400 * time.Millisecond)
		_, _ = w.Write(archive)
	})
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)

	base, sid, s := newArtifactServerWith(t, upstream.URL, signerPrefix, moduleinstalltest.FakeVerifier{},
		func(ts *httptest.Server) { ts.Config.WriteTimeout = 200 * time.Millisecond })

	// Not sendArtifact: it calls t.Fatal on a transport error, which would report "EOF" instead of naming
	// the behaviour under test.
	req, err := http.NewRequest(http.MethodPost, base+"/api/artifacts", strings.NewReader(installBody(artifactKey, artifactVersion)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(sessionHeader, sid)
	req.Header.Set(cloudTokenHeader, "acc-tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("the install outlived the server's write deadline and the answer was lost: %v", err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the install must succeed, got %d %s", resp.StatusCode, out)
	}
	// The half that makes the failure so misleading without this: the artifact IS on disk either way, so a
	// test that only checked the disk would pass while the operator was told the install failed.
	if !strings.Contains(string(out), "recreating the stack") {
		t.Fatalf("the answer must carry the instruction the install exists to produce, got %s", out)
	}
	if _, err := readArtifactMarker(filepath.Join(s.cfg.ModulesDir, artifactKey)); err != nil {
		t.Fatalf("the artifact must be placed: %v", err)
	}
}

func TestUnmountIsSerialisedAgainstAnInstall(t *testing.T) {
	// The mirror of the mount case, and the one that costs more if it interleaves: unmountModule's
	// ownership read and its os.RemoveAll are not adjacent, so an install completing between them has its
	// freshly placed tree deleted after answering 200.
	archive, digest := genuineArchive(t)
	upstream, entered, release := blockingArtifactUpstream(t, archive, digest)
	base, sid, _ := newArtifactServer(t, upstream, signerPrefix, moduleinstalltest.FakeVerifier{})
	t.Cleanup(release) // must run before either server's Close — see blockingArtifactUpstream

	done := installInBackground(base, sid, installBody(artifactKey, artifactVersion))
	<-entered

	code, body := send(t, http.MethodDelete, base+"/api/modules/acme-other", sid, "")
	if code != http.StatusConflict || !strings.Contains(body, "already running") {
		t.Fatalf("an unmount must be refused while an install holds the modules directory, got %d %s", code, body)
	}
	release()
	if a := <-done; a.code != http.StatusOK {
		t.Fatalf("the install must still complete, got %d %s", a.code, a.out)
	}
}

func TestDiscardStagingLeavesTheBackup(t *testing.T) {
	// The backup is Swap's, and this is the function that used to take it. Swap moves the previously
	// installed tree aside before it renames the new one in and restores it if that rename fails; on the
	// one path where the restore ALSO failed, the backup holds the deployment's only copy — and this runs
	// on that path too, because it runs on every path out of the handler.
	root := t.TempDir()
	staging := filepath.Join(root, moduleinstall.TmpDirName, artifactKey)
	backup := backupPath(staging)
	for _, d := range []string{staging, backup} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(d, "marker"), []byte(filepath.Base(d)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	discardStaging(staging)

	if _, err := os.Stat(staging); !os.IsNotExist(err) {
		t.Fatalf("the staging tree is this request's and must go: %v", err)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("the moved-aside copy is not this function's to delete: %v", err)
	}
	// And the root survives while the backup is in it — os.Remove, never os.RemoveAll.
	if _, err := os.Stat(filepath.Dir(staging)); err != nil {
		t.Fatalf("the staging root must survive a non-empty state: %v", err)
	}
}

func TestModuleWritesAreSerialisedAcrossSurfaces(t *testing.T) {
	// The mutex is not the artifact surface's alone. mountModule stats a directory and then writes it, and
	// those two steps are not adjacent: a mount landing inside an install's move-aside window creates the
	// directory the install is about to rename into, and the loser of that race loses files. The mount here
	// names a DIFFERENT key from the artifact deliberately — with the same key it would be refused by the
	// sequential ownership guard instead, and the test would pass without the lock existing.
	archive, digest := genuineArchive(t)
	upstream, entered, release := blockingArtifactUpstream(t, archive, digest)
	base, sid, _ := newArtifactServer(t, upstream, signerPrefix, moduleinstalltest.FakeVerifier{})
	t.Cleanup(release) // must run before either server's Close — see blockingArtifactUpstream

	done := installInBackground(base, sid, installBody(artifactKey, artifactVersion))
	<-entered

	code, body := send(t, http.MethodPost, base+"/api/modules", sid,
		`{"packageKey":"acme-cloud","moduleKey":"acme-other","pin":"sha256:`+strings.Repeat("a", 64)+`"}`)
	if code != http.StatusConflict || !strings.Contains(body, "already running") {
		t.Fatalf("a mount must be refused while an install holds the modules directory, got %d %s", code, body)
	}
	release()
	if a := <-done; a.code != http.StatusOK {
		t.Fatalf("the install must still complete, got %d %s", a.code, a.out)
	}
}

func TestWorldWritableModule(t *testing.T) {
	// A unit test is the only route to this condition: extraction creates every file 0644, so no archive
	// can produce it through the handler. What it reports is a host mount that does not preserve modes.
	write := func(t *testing.T, name string, mode os.FileMode) string {
		t.Helper()
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), mode); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(filepath.Join(dir, name), mode); err != nil { // defeat the umask
			t.Fatal(err)
		}
		return dir
	}
	if !worldWritableModule(write(t, "AcmeRiskEngineModule.js", 0o666)) {
		t.Fatal("a world-writable module file must be reported")
	}
	if worldWritableModule(write(t, "AcmeRiskEngineModule.js", 0o644)) {
		t.Fatal("an ordinary module file must not be reported")
	}
	// The loader takes only *Module.js, so nothing else in the tree is the platform's business.
	if worldWritableModule(write(t, "notes.txt", 0o666)) {
		t.Fatal("only files the loader would take are scanned")
	}
	if worldWritableModule(filepath.Join(t.TempDir(), "absent")) {
		t.Fatal("an unreadable directory must not report a warning")
	}
}

func TestInstallArtifactOwnership(t *testing.T) {
	const contentSentence = "a content mount from the catalog is already using this name"
	const foreignSentence = "was not installed as an artifact"

	seedContentMount := func(t *testing.T, dir string) {
		if _, err := writeContentMount(dir, mountMarker{Schema: mountMarkerSchema, ModuleKey: artifactKey, Pin: pinA}); err != nil {
			t.Fatal(err)
		}
	}
	seedPayloadStamp := func(t *testing.T, dir string) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, payloaddigest.StampFilename), []byte(`{"name":"x"}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	seedForeignTree := func(t *testing.T, dir string) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "TheirModule.js"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A symlink is the case Stat would get wrong: it reports the TARGET as a directory, so a marker
	// planted behind the link reads as ours. Lstat sees the link itself.
	seedSymlink := func(t *testing.T, dir string) {
		behind := dir + "-behind"
		if err := os.MkdirAll(behind, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(behind, artifactMarkerName),
			fmt.Appendf(nil, `{"schema":%q,"artifactKey":%q,"version":"9.9.9"}`, artifactMarkerSchema, artifactKey), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(behind, dir); err != nil {
			t.Fatal(err)
		}
	}

	refusals := []struct {
		name string
		want string
		seed func(*testing.T, string)
	}{
		{"a content mount", contentSentence, seedContentMount},
		{"a bare payload stamp", foreignSentence, seedPayloadStamp},
		{"an operator's own tree", foreignSentence, seedForeignTree},
		{"a symlink with a marker behind it", foreignSentence, seedSymlink},
	}
	for _, c := range refusals {
		t.Run(c.name, func(t *testing.T) {
			// The upstream fails the test if it is dialled: a request that was going to be refused must
			// never cause this console to call the content service.
			base, sid, s := newArtifactServer(t, undialledUpstream(t), signerPrefix, moduleinstalltest.FakeVerifier{})
			c.seed(t, filepath.Join(s.cfg.ModulesDir, artifactKey))
			code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
			if code != http.StatusConflict || !strings.Contains(body, c.want) {
				t.Fatalf("expected 409 naming %q, got %d %s", c.want, code, body)
			}
		})
	}

	t.Run("the console's own artifact marker proceeds", func(t *testing.T) {
		// The positive: an installed artifact is replaceable, which is what makes an upgrade possible.
		// The seeded marker names an earlier version, so this is the ordinary upgrade and it completes.
		archive, digest := genuineArchive(t)
		base, sid, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})
		dir := filepath.Join(s.cfg.ModulesDir, artifactKey)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, artifactMarkerName),
			fmt.Appendf(nil, `{"schema":%q,"artifactKey":%q,"version":"1.0.0"}`, artifactMarkerSchema, artifactKey), 0o644); err != nil {
			t.Fatal(err)
		}
		code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
		if code != http.StatusOK {
			t.Fatalf("the console's own artifact directory must be replaceable, got %d %s", code, body)
		}
	})
}

func TestInstallArtifactRefusesWithNoSignerConfigured(t *testing.T) {
	// An installer with no configured identity must refuse rather than fall back to a weaker check —
	// and refuse BEFORE it dials, which is what the undialled upstream asserts.
	base, sid, _ := newArtifactServer(t, undialledUpstream(t), "", moduleinstalltest.FakeVerifier{})
	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	if code != http.StatusConflict || !strings.Contains(body, "no artifact signer configured") {
		t.Fatalf("an unconfigured signer must refuse by name, got %d %s", code, body)
	}
}

func TestInstallArtifactRequiresTheCloudToken(t *testing.T) {
	base, sid, _ := newArtifactServer(t, undialledUpstream(t), signerPrefix, moduleinstalltest.FakeVerifier{})
	code, body := sendArtifact(t, base, sid, "", installBody(artifactKey, artifactVersion))
	// 400 and NOT 401, and the second assertion is the point: the SPA turns any 401 into clearSession()
	// plus a session-expired path the content panel swallows, so 401 would return the operator to the
	// sign-in card mid-install with nothing said at all.
	if code == http.StatusUnauthorized {
		t.Fatal("a missing cloud token must never be 401 — the SPA would read it as an expired session")
	}
	if code != http.StatusBadRequest || !strings.Contains(body, "cloud sign-in is required") {
		t.Fatalf("a missing cloud token must be 400 naming the sign-in, got %d %s", code, body)
	}
}

func TestInstallArtifactRejectsBadInput(t *testing.T) {
	base, sid, _ := newArtifactServer(t, undialledUpstream(t), signerPrefix, moduleinstalltest.FakeVerifier{})
	cases := map[string]struct {
		body string
		want int
	}{
		"malformed body": {`{"artifactKey":`, http.StatusBadRequest},
		// A field the console does not know is refused at the decoder, which is what keeps a misspelled
		// allowDowngrade from being read as "no". The field has to be one nothing declares: every case
		// here shares an upstream that fails the test if it is dialled, and a body that decodes cleanly
		// with a valid key and version would run all the way to the descriptor fetch.
		"unknown field":         {`{"artifactKey":"a","version":"1.0.0","force":true}`, http.StatusBadRequest},
		"bad key":               {installBody("Acme_Engine", artifactVersion), http.StatusBadRequest},
		"reserved key":          {installBody(kgModuleKey, artifactVersion), http.StatusConflict},
		"bad version":           {installBody(artifactKey, "1.3"), http.StatusBadRequest},
		"a leading zero":        {installBody(artifactKey, "01.2.0"), http.StatusBadRequest},
		"a ten-digit component": {installBody(artifactKey, "1234567890.0.0"), http.StatusBadRequest},
		"a prerelease suffix":   {installBody(artifactKey, "1.3.0-rc.1"), http.StatusBadRequest},
	}
	for name, c := range cases {
		if code, body := sendArtifact(t, base, sid, "acc-tok", c.body); code != c.want {
			t.Errorf("%s must be %d, got %d %s", name, c.want, code, body)
		}
	}
}

func TestInstallArtifactRefusesOutsideCloudMode(t *testing.T) {
	s := newTestServer(t, "http://platform.invalid", filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()
	if err := writeModeLayer(s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	code, body := sendArtifact(t, ts.URL, signIn(t, s), "acc-tok", installBody(artifactKey, artifactVersion))
	if code != http.StatusConflict || !strings.Contains(body, "only in cloud mode") {
		t.Fatalf("pure-OSS must refuse, got %d %s", code, body)
	}
}

func TestInstallArtifactMapsTheEntitledTaxonomy(t *testing.T) {
	cases := []struct {
		name     string
		upstream int
		body     string
		want     int
		contains string
		// The negative half. Without it a shape defect is inexpressible here: every substring that passes
		// after a fix ("withdrawn") passes before it too, so a row asserting only `contains` would be a
		// green test proving nothing about which shape was read.
		absent string
	}{
		// 401 is the one that must NOT pass through: the SPA reads any 401 as an expired session.
		{"an expired credential", http.StatusUnauthorized, `{"code":"token_expired"}`, http.StatusBadRequest, "sign in again", ""},
		{"not entitled", http.StatusForbidden,
			`{"code":"not_entitled","denial":{"message":{"body":"Add the Acme Risk package to install this."}}}`,
			http.StatusForbidden, "Add the Acme Risk package", ""},
		{"not entitled with no denial text", http.StatusForbidden, `{"code":"not_entitled"}`,
			http.StatusForbidden, "subscription does not include", ""},
		{"no such version", http.StatusNotFound, `{"code":"artifact_not_found"}`, http.StatusNotFound, "no artifact is published", ""},
		// NESTED under `recalled`, which is the protocol's shape and the shape every producer in this
		// stack emits — the same one level of nesting the denial extension above uses.
		{"withdrawn", http.StatusGone,
			`{"code":"version_recalled","recalled":{"reason":"a defect in the scoring rules","recalledAt":"2026-08-01T00:00:00Z","supersededBy":"1.3.1"}}`,
			http.StatusGone, "a defect in the scoring rules", ""},
		{"withdrawn names its replacement", http.StatusGone,
			`{"code":"version_recalled","recalled":{"reason":"bad","supersededBy":"1.3.1"}}`,
			http.StatusGone, "superseded by 1.3.1", ""},
		// And the shape the console used to read, pinned as NOT read: members at the top level are not the
		// protocol's recall extension, so they must not compose the sentence.
		{"a recall with its members at the top level", http.StatusGone,
			`{"code":"version_recalled","reason":"a defect in the scoring rules","supersededBy":"1.3.1"}`,
			http.StatusGone, "withdrawn", "a defect in the scoring rules"},
		// Its own arm, because "the content service answered 429" strips the only actionable thing in it.
		{"rate limited", http.StatusTooManyRequests, `{"code":"rate_limited"}`, http.StatusServiceUnavailable, "rate-limiting", ""},
		{"an upstream fault", http.StatusInternalServerError, `{"code":"internal"}`, http.StatusBadGateway, "answered 500", ""},
		// A body the console cannot parse degrades the MESSAGE, never the outcome — the producer of this
		// document does not exist yet, and a console that broke on a missing field could not be trusted
		// against the surface it has to survive.
		{"a body that is not a problem document", http.StatusGone, `<html>gone</html>`, http.StatusGone, "withdrawn", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.upstream)
				_, _ = w.Write([]byte(c.body))
			}))
			defer srv.Close()
			base, sid, _ := newArtifactServer(t, srv.URL, signerPrefix, moduleinstalltest.FakeVerifier{})
			code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
			if code != c.want || !strings.Contains(body, c.contains) {
				t.Fatalf("upstream %d must become %d containing %q, got %d %s", c.upstream, c.want, c.contains, code, body)
			}
			if c.absent != "" && strings.Contains(body, c.absent) {
				t.Fatalf("upstream %d must NOT surface %q, got %d %s", c.upstream, c.absent, code, body)
			}
		})
	}
}

func TestInstallArtifactRefusesAnOversizeArchive(t *testing.T) {
	// The transport reports this as an error rather than a status, so it reaches the operator only if the
	// error arm exists — and it is the one transport failure they can be told something specific about.
	archive, digest := genuineArchive(t)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"artifactKey":%q,"version":%q,"kind":"code-module",`+
			`"archive":{"format":"tar+gzip","size":1,"digest":%q},`+
			`"signature":{"format":%q,"bundle":%q}}`,
			artifactKey, artifactVersion, digest, artifactBundleFormat,
			base64.StdEncoding.EncodeToString([]byte("b")))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, maxArtifactBytes+1))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	_ = archive

	base, sid, _ := newArtifactServer(t, srv.URL, signerPrefix, moduleinstalltest.FakeVerifier{})
	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	if code != http.StatusBadGateway || !strings.Contains(body, "larger than this console will install") {
		t.Fatalf("an oversize archive must be refused by size, got %d %s", code, body)
	}
}

func TestInstallArtifactRefusesARedirect(t *testing.T) {
	elsewhere := undialledUpstream(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, elsewhere+"/v1/elsewhere", http.StatusFound)
	}))
	defer srv.Close()
	base, sid, _ := newArtifactServer(t, srv.URL, signerPrefix, moduleinstalltest.FakeVerifier{})
	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	// The redirect target is never dialled (undialledUpstream fails the test if it is), and the body a
	// refused redirect leaves behind — an upstream-chosen URL — never reaches the operator.
	if code != http.StatusBadGateway || !strings.Contains(body, "could not be reached") {
		t.Fatalf("a redirect must be refused generically, got %d %s", code, body)
	}
	if strings.Contains(body, elsewhere) {
		t.Fatalf("an upstream-chosen URL must never be surfaced, got %s", body)
	}
}

func TestInstallArtifactRefusesTheRealBundle(t *testing.T) {
	// The one real Sigstore bundle in the tree, through the REAL verifier: the console decodes it,
	// reaches the seam, and refuses. It asserts only that — the fixture is a subject-digest bundle over
	// an npm package rather than one over an archive, so no archive exists that it signs and it fails
	// before the identity pin is ever compared. No better fixture can exist here: producing one needs the
	// real publishing workflow, whose leaf certificate must not be checked into a public repository.
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "pkg", "moduleverify", "testdata", "genuine-public-good-bundle.sigstore.json"))
	if err != nil {
		t.Fatal(err)
	}
	real, err := moduleverify.New()
	if err != nil {
		t.Fatal(err)
	}
	archive, digest := genuineArchive(t)
	desc := fmt.Sprintf(`{"artifactKey":%q,"version":%q,"kind":"code-module",`+
		`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
		`"signature":{"format":%q,"bundle":%q}}`,
		artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
		base64.StdEncoding.EncodeToString(raw))

	base, sid, s := newArtifactServer(t, artifactUpstream(t, archive, digest, desc), signerPrefix, real)
	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	if code == http.StatusOK {
		t.Fatal("a bundle that does not sign these bytes must never install")
	}
	if !strings.Contains(body, "did not verify") && !strings.Contains(body, "signature") {
		t.Fatalf("the refusal must name the signature, got %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(s.cfg.ModulesDir, artifactKey)); !os.IsNotExist(err) {
		t.Fatalf("nothing may be placed when verification fails, got %v", err)
	}
}

// ── The inventory, currency, and removal ─────────────────────────────────────────────────────────

// seedArtifactDir writes an installed artifact directory: the marker at version, and a payload stamp when
// stampVersion is non-empty. Seeded rather than installed through the handler, because these are tests of
// the read and remove sides — driving an install to reach them would make a catalog failure look like an
// install failure.
func seedArtifactDir(t *testing.T, modulesDir, key, version, stampVersion string) string {
	t.Helper()
	dir := filepath.Join(modulesDir, key)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if version != "" {
		if err := os.WriteFile(filepath.Join(dir, artifactMarkerName),
			fmt.Appendf(nil, `{"schema":%q,"artifactKey":%q,"version":%q,"installedAt":"2026-08-20T10:00:00Z"}`,
				artifactMarkerSchema, key, version), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if stampVersion != "" {
		if err := os.WriteFile(filepath.Join(dir, payloaddigest.StampFilename),
			fmt.Appendf(nil, `{"name":%q,"version":%q,"builtFrom":null,"payloadDigest":"sha256:x"}`, key, stampVersion), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestMountRefusesAnInstalledArtifactByName(t *testing.T) {
	// unmountModule has an arm for this, because "was not created by the console" is false about a
	// directory the console's own install path created. mountModule answered the false sentence and sent
	// the operator hunting in the volume instead of to the panel that can actually remove it.
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)
	seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0")

	code, body := send(t, http.MethodPost, base+"/api/modules", sid,
		`{"packageKey":"acme-cloud","moduleKey":"acme-risk","pin":"sha256:`+strings.Repeat("a", 64)+`"}`)
	if code != http.StatusConflict {
		t.Fatalf("a mount over an installed artifact must be refused, got %d %s", code, body)
	}
	if !strings.Contains(body, "artifacts panel") {
		t.Fatalf("the refusal must name the surface that can remove it, got %s", body)
	}
	if strings.Contains(body, "not created by the console") {
		t.Fatalf("the console created that directory, so this sentence is false about it: %s", body)
	}
}

func TestArtifactInventoryIsAScan(t *testing.T) {
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)

	// Six directories, one walk, and the console's answer about each is what it can prove from the disk.
	seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0") // ours, whole
	seedArtifactDir(t, modulesDir, "acme-marked", "1.1.0", "")    // ours, stamp missing
	seedArtifactDir(t, modulesDir, "acme-shipped", "", "3.0.0")   // a module the platform installed
	if _, err := writeContentMount(filepath.Join(modulesDir, "acme-mounted"),
		mountMarker{Schema: mountMarkerSchema, PackageKey: "acme-cloud", ModuleKey: "acme-mounted", Pin: pinA}); err != nil {
		t.Fatal(err)
	}
	otherSchema := filepath.Join(modulesDir, "acme-alien")
	if err := os.MkdirAll(otherSchema, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(otherSchema, artifactMarkerName),
		[]byte(`{"schema":"someone.else/9","artifactKey":"acme-alien","version":"1.0.0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(modulesDir, "acme-bare"), 0o755); err != nil { // no dotfiles at all
		t.Fatal(err)
	}

	code, raw := get(t, base, "/api/modules", sid)
	if code != http.StatusOK {
		t.Fatalf("the inventory must be 200, got %d %s", code, raw)
	}
	var inv modulesResponse
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, a := range inv.Artifacts {
		got[a.ArtifactKey] = a.Version
	}
	if len(got) != 2 {
		t.Fatalf("only the two artifact directories may be reported, got %v", got)
	}
	if got["acme-risk"] != "1.2.0" {
		t.Fatalf("a whole artifact must report its version, got %q", got["acme-risk"])
	}
	// The marker is the console's own record and the value its downgrade check compares against, so it is
	// what the operator is shown even when the payload stamp is absent.
	if got["acme-marked"] != "1.1.0" {
		t.Fatalf("an artifact whose stamp is missing must still report the marker's version, got %q", got["acme-marked"])
	}
	// The module the platform installed at boot is in NEITHER list: it carries a stamp and no marker of
	// any kind, and the surface that reports it is the state view.
	for _, m := range inv.Modules {
		if m.ModuleKey == "acme-shipped" {
			t.Fatal("a boot-installed module must not appear among the content mounts")
		}
	}
	if len(inv.Modules) != 1 || inv.Modules[0].ModuleKey != "acme-mounted" {
		t.Fatalf("only the content mount may be reported as one, got %+v", inv.Modules)
	}
	// The notice the operator is owed before they confirm a removal, on the READ.
	if !strings.Contains(inv.ArtifactRemovalNotice, "Re-installing brings the classes back") {
		t.Fatalf("the inventory must carry the removal consequence, got %q", inv.ArtifactRemovalNotice)
	}
}

func TestArtifactInventoryCarriesNoNoticeWithNoArtifacts(t *testing.T) {
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, _ := newContentServer(t, content.URL)
	_, raw := get(t, base, "/api/modules", sid)
	var inv modulesResponse
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.ArtifactRemovalNotice != "" {
		t.Fatalf("a deployment with no artifacts needs no removal notice, got %q", inv.ArtifactRemovalNotice)
	}
	if inv.Artifacts == nil {
		t.Fatal("the artifact list must render as an array rather than null")
	}
}

func TestArtifactCurrency(t *testing.T) {
	cases := []struct {
		name       string
		installed  string
		latest     string
		absent     bool // the artifact is not in the catalog at all
		want       string
		wantLatest string
		note       string
	}{
		{name: "up to date", installed: "1.2.0", latest: "1.2.0", want: "current"},
		{name: "behind", installed: "1.2.0", latest: "1.3.0", want: "outdated", wantLatest: "1.3.0"},
		// The case a string comparison inverts, through the whole path rather than only in the comparison's
		// own unit test.
		{name: "behind across a ten", installed: "1.9.0", latest: "1.10.0", want: "outdated", wantLatest: "1.10.0"},
		// Every version recalled: nothing to offer, and an install would answer 410.
		{name: "every version recalled", installed: "1.2.0", latest: "", want: "unavailable"},
		// Reachable when the newer version was recalled. Never outdated: that would prompt a downgrade.
		{name: "ahead of the catalog", installed: "1.3.0", latest: "1.2.0", want: "unknown",
			note: "nothing to update to"},
		{name: "an unreadable installed version", installed: "banana", latest: "1.2.0", want: "unknown",
			note: "could not be compared"},
		{name: "an unreadable catalog version", installed: "1.2.0", latest: "1.2", want: "unknown",
			note: "could not be compared"},
		{name: "not in the catalog", installed: "1.2.0", absent: true, want: "unknown"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pkg := fakePkg{key: "acme-cloud", latest: "20260101.1"}
			if !c.absent {
				pkg.artifacts = []catalogArtifactEntry{{Key: "acme-risk", Name: "Acme Risk", Kind: "code-module", Latest: c.latest}}
			}
			content := fakeContent(t, []fakePkg{pkg}, nil)
			defer content.Close()
			base, sid, modulesDir := newContentServer(t, content.URL)
			seedArtifactDir(t, modulesDir, "acme-risk", c.installed, c.installed)

			_, raw := get(t, base, "/api/modules", sid)
			var inv modulesResponse
			if err := json.Unmarshal(raw, &inv); err != nil {
				t.Fatal(err)
			}
			if len(inv.Artifacts) != 1 {
				t.Fatalf("the artifact must render, got %s", raw)
			}
			a := inv.Artifacts[0]
			if a.Currency != c.want {
				t.Fatalf("currency must be %q, got %q (%s)", c.want, a.Currency, raw)
			}
			if a.LatestVersion != c.wantLatest {
				t.Fatalf("latestVersion must be %q, got %q", c.wantLatest, a.LatestVersion)
			}
			if c.note != "" && !strings.Contains(inv.Note, c.note) {
				t.Fatalf("the degradation must carry a note containing %q, got %q", c.note, inv.Note)
			}
			if c.note == "" && strings.Contains(inv.Note, "acme-risk") {
				t.Fatalf("a comparison that succeeded must say nothing, got %q", inv.Note)
			}
		})
	}
}

func TestArtifactCurrencyCatalogUnreachable(t *testing.T) {
	dead := fakeContent(t, nil, nil)
	deadURL := dead.URL
	base, sid, modulesDir := newContentServer(t, deadURL)
	seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0")
	dead.Close()

	code, raw := get(t, base, "/api/modules", sid)
	if code != http.StatusOK {
		t.Fatalf("the inventory must survive an unreachable catalog, got %d %s", code, raw)
	}
	var inv modulesResponse
	if err := json.Unmarshal(raw, &inv); err != nil {
		t.Fatal(err)
	}
	if len(inv.Artifacts) != 1 || inv.Artifacts[0].Currency != "unknown" {
		t.Fatalf("the artifact must render with unknown currency, got %s", raw)
	}
	// Kind and name have no source on disk. The panel has to render this state, so it is asserted rather
	// than assumed — and an empty kind may not be read as a default.
	if inv.Artifacts[0].Kind != "" || inv.Artifacts[0].Name != "" {
		t.Fatalf("kind and name come only from the catalog, got %+v", inv.Artifacts[0])
	}
	if !strings.Contains(inv.Note, "catalog is unavailable") {
		t.Fatalf("the note must explain why currency is unknown, got %q", inv.Note)
	}
}

func TestLatestArtifactPrefersTheHighest(t *testing.T) {
	entry := func(latest string) catalogArtifactEntry {
		return catalogArtifactEntry{Key: "acme-risk", Name: "Acme Risk", Kind: "code-module", Latest: latest}
	}
	// One artifact granted by three packages, cut at different times, so they advertise different values.
	packages := []catalogPackage{
		{Key: "a", Artifacts: []catalogArtifactEntry{entry("1.2.0")}},
		{Key: "b", Artifacts: []catalogArtifactEntry{entry("1.3.0")}},
		{Key: "c", Artifacts: []catalogArtifactEntry{entry("")}},
	}
	got, found := latestArtifact(packages, "acme-risk")
	if !found || got.Latest != "1.3.0" {
		t.Fatalf("the highest readable latest must win, got %+v (found=%v)", got, found)
	}
	// Order must not decide it.
	reversed := []catalogPackage{packages[2], packages[1], packages[0]}
	if got, _ := latestArtifact(reversed, "acme-risk"); got.Latest != "1.3.0" {
		t.Fatalf("package order must not change the answer, got %q", got.Latest)
	}
	// A readable latest beats an unreadable one, which beats an absent one — three different answers to
	// the operator (a comparison, a note, and "unavailable"), so the order among them is total.
	mixed := []catalogPackage{
		{Key: "a", Artifacts: []catalogArtifactEntry{entry("")}},
		{Key: "b", Artifacts: []catalogArtifactEntry{entry("banana")}},
	}
	if got, _ := latestArtifact(mixed, "acme-risk"); got.Latest != "banana" {
		t.Fatalf("an unreadable latest must beat an absent one, got %q", got.Latest)
	}
	if _, found := latestArtifact(packages, "acme-other"); found {
		t.Fatal("an artifact no package grants must not be found")
	}
}

func TestRemoveArtifact(t *testing.T) {
	t.Run("removes what the console installed", func(t *testing.T) {
		content := fakeContent(t, nil, nil)
		defer content.Close()
		base, sid, modulesDir := newContentServer(t, content.URL)
		dir := seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0")

		code, body := send(t, http.MethodDelete, base+"/api/artifacts/acme-risk", sid, "")
		if code != http.StatusOK {
			t.Fatalf("removing an installed artifact must succeed, got %d %s", code, body)
		}
		if !strings.Contains(body, platformRestartCommand) {
			t.Fatalf("the answer must carry the restart instruction — the graph consequences fire at that boot, not at this call: %s", body)
		}
		if !strings.Contains(body, "Re-installing brings the classes back") {
			t.Fatalf("the answer must carry the graph consequence, got %s", body)
		}
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("the directory must be gone, got %v", err)
		}
		if _, err := os.Stat(filepath.Join(modulesDir, moduleinstall.TmpDirName)); !os.IsNotExist(err) {
			t.Fatalf("nothing may be left staged, got %v", err)
		}
	})

	t.Run("refuses each owner on its own terms", func(t *testing.T) {
		content := fakeContent(t, nil, nil)
		defer content.Close()
		base, sid, modulesDir := newContentServer(t, content.URL)

		if _, err := writeContentMount(filepath.Join(modulesDir, "acme-mounted"),
			mountMarker{Schema: mountMarkerSchema, ModuleKey: "acme-mounted", Pin: pinA}); err != nil {
			t.Fatal(err)
		}
		seedArtifactDir(t, modulesDir, "acme-shipped", "", "3.0.0")
		if err := os.MkdirAll(filepath.Join(modulesDir, "acme-theirs"), 0o755); err != nil {
			t.Fatal(err)
		}

		cases := map[string]struct {
			key  string
			want string
		}{
			"a content mount":  {"acme-mounted", "unmount it instead"},
			"a shipped module": {"acme-shipped", "installed with the platform"},
			"someone's tree":   {"acme-theirs", "was not installed by the console as an artifact"},
		}
		for name, c := range cases {
			code, body := send(t, http.MethodDelete, base+"/api/artifacts/"+c.key, sid, "")
			if code != http.StatusConflict || !strings.Contains(body, c.want) {
				t.Errorf("%s must be refused with its own sentence containing %q, got %d %s", name, c.want, code, body)
			}
			if _, err := os.Stat(filepath.Join(modulesDir, c.key)); err != nil {
				t.Errorf("%s must be untouched: %v", name, err)
			}
		}
	})

	t.Run("the gates come first", func(t *testing.T) {
		content := fakeContent(t, nil, nil)
		defer content.Close()
		base, sid, _ := newContentServer(t, content.URL)

		if code, _ := send(t, http.MethodDelete, base+"/api/artifacts/nothing-here", sid, ""); code != http.StatusNotFound {
			t.Errorf("an absent artifact must be 404, got %d", code)
		}
		if code, _ := send(t, http.MethodDelete, base+"/api/artifacts/Bad_Key", sid, ""); code != http.StatusBadRequest {
			t.Errorf("an invalid key must be 400, got %d", code)
		}
		code, body := send(t, http.MethodDelete, base+"/api/artifacts/"+kgModuleKey, sid, "")
		if code != http.StatusConflict || !strings.Contains(body, "reserved") {
			t.Errorf("the reserved key must be refused as reserved, got %d %s", code, body)
		}
	})

	t.Run("outside cloud mode", func(t *testing.T) {
		s := newTestServer(t, "http://platform.invalid", filepath.Join(t.TempDir(), "state.json"))
		s.cfg.ModulesDir = t.TempDir()
		if err := writeModeLayer(s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(s.routes())
		defer ts.Close()
		code, body := send(t, http.MethodDelete, ts.URL+"/api/artifacts/acme-risk", signIn(t, s), "")
		if code != http.StatusConflict || !strings.Contains(body, "only in cloud mode") {
			t.Fatalf("pure-OSS must refuse, got %d %s", code, body)
		}
	})
}

func TestRemoveArtifactSurvivesAFailedRemoveAll(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores the permission bits this test depends on")
	}
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)
	dir := seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0")

	// The failure has to come from INSIDE the tree, not from its parent: a read-only staging root would
	// fail the rename, and the rename is the step that must succeed for the property to be under test.
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "file"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The destination is new on every removal, so the test discovers it rather than naming it. Every 0555
	// directory left behind fails t.TempDir's own teardown, in a test that has nothing to do with this one,
	// so the cleanup globs — and it is registered before the request, because the rename may or may not
	// have happened by the time an assertion fails.
	tmpRoot := filepath.Join(modulesDir, moduleinstall.TmpDirName)
	t.Cleanup(func() {
		_ = os.Chmod(sub, 0o755)
		leftovers, _ := filepath.Glob(filepath.Join(tmpRoot, "acme-risk.removing.*", "sub"))
		for _, p := range leftovers {
			_ = os.Chmod(p, 0o755)
		}
	})
	if err := os.Chmod(sub, 0o555); err != nil {
		t.Fatal(err)
	}

	code, body := send(t, http.MethodDelete, base+"/api/artifacts/acme-risk", sid, "")
	if code != http.StatusOK {
		t.Fatalf("a failure to delete the staged copy must not fail the removal, got %d %s", code, body)
	}
	// The rename is one syscall, so there is no partial state: the module is gone from where the platform
	// looks, whatever happened to the copy.
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the module must be gone, got %v", err)
	}
	stranded, err := filepath.Glob(filepath.Join(tmpRoot, "acme-risk.removing.*"))
	if err != nil || len(stranded) != 1 {
		t.Fatalf("the staged copy is what the warning is about, so it must still be there: %v %v", stranded, err)
	}
	if !strings.Contains(body, "could not be deleted") || !strings.Contains(body, stranded[0]) {
		t.Fatalf("the warning must name the path that survived, got %s", body)
	}

	// And the point of the destination being new rather than cleared: the stranded copy is inert. With a
	// fixed name that one failure blocked every later removal of this key at the rename, with a 500 naming
	// nothing — a dead end two documents claimed the next install would clear, which nothing does.
	seedArtifactDir(t, modulesDir, "acme-risk", "1.3.0", "1.3.0")
	code, body = send(t, http.MethodDelete, base+"/api/artifacts/acme-risk", sid, "")
	if code != http.StatusOK {
		t.Fatalf("an earlier stranded copy must not block a later removal, got %d %s", code, body)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the second removal must also have taken the module, got %v", err)
	}
}

func TestRemoveArtifactRefusesASymlink(t *testing.T) {
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)

	// A marker planted behind a link: Stat reports the target and reads it as ours, and the rename would
	// move the LINK while the tree it names survived — reporting a removal that did not happen.
	behind := seedArtifactDir(t, t.TempDir(), "acme-risk", "1.2.0", "1.2.0")
	link := filepath.Join(modulesDir, "acme-risk")
	if err := os.Symlink(behind, link); err != nil {
		t.Fatal(err)
	}
	code, body := send(t, http.MethodDelete, base+"/api/artifacts/acme-risk", sid, "")
	if code != http.StatusConflict {
		t.Fatalf("a symlink must be refused, got %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(behind, artifactMarkerName)); err != nil {
		t.Fatalf("the tree behind the link must be untouched: %v", err)
	}
	if _, err := os.Lstat(link); err != nil {
		t.Fatalf("nothing may have been renamed: %v", err)
	}
}

func TestInstallArtifactRefusesAPayloadCarryingAForeignMarker(t *testing.T) {
	// Nothing filters the extracted tree, so an archive can carry another kind's ownership marker. Without
	// this refusal the placed directory would answer to two owners, and the CONTENT unmount route — which
	// gates on that marker alone — would delete an artifact install as though it were a mount it wrote.
	for _, marker := range []string{mountMarkerName, kgMarkerName} {
		t.Run(marker, func(t *testing.T) {
			archive, digest, _ := moduleinstalltest.BuildModuleTarball(t, artifactKey, artifactVersion,
				map[string]string{
					"AcmeRiskEngineModule.js": "module.exports = {}\n",
					marker:                    `{"schema":"whatever"}`,
				})
			base, sid, s := newArtifactServer(t, artifactUpstream(t, archive, digest, ""), signerPrefix, moduleinstalltest.FakeVerifier{})

			code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
			if code != http.StatusBadGateway || !strings.Contains(body, "another mount's ownership marker") {
				t.Fatalf("a payload claiming another kind's directory must be refused, got %d %s", code, body)
			}
			if _, err := os.Stat(filepath.Join(s.cfg.ModulesDir, artifactKey)); !os.IsNotExist(err) {
				t.Fatalf("nothing may be placed, got %v", err)
			}
			assertStagingGone(t, s)
		})
	}
}

func TestUnmountModuleRefusesAnArtifact(t *testing.T) {
	// The neighbouring handler's sentence was false about an artifact directory the moment installs
	// started writing them: the console DID create it.
	content := fakeContent(t, nil, nil)
	defer content.Close()
	base, sid, modulesDir := newContentServer(t, content.URL)
	dir := seedArtifactDir(t, modulesDir, "acme-risk", "1.2.0", "1.2.0")

	code, body := send(t, http.MethodDelete, base+"/api/modules/acme-risk", sid, "")
	if code != http.StatusConflict || !strings.Contains(body, "installed artifact") {
		t.Fatalf("the content unmount must name what this actually is, got %d %s", code, body)
	}
	if strings.Contains(body, "not created by the console") {
		t.Fatalf("the console DID create it, so that sentence must not be used: %s", body)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("the artifact must be untouched: %v", err)
	}
}

func TestInstallArtifactRefusesAnApplication(t *testing.T) {
	// The kind check is the only thing anywhere that refuses this: the staging sequence asserts a module
	// layout, which an application's archive could satisfy by accident. And it must refuse BEFORE the
	// archive is fetched, which the upstream below is what proves — its content route fails the test.
	archive, digest := genuineArchive(t)
	desc := fmt.Sprintf(`{"artifactKey":%q,"version":%q,"kind":"application","target":"acme-portal-app",`+
		`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
		`"signature":{"format":%q,"bundle":%q}}`,
		artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
		base64.StdEncoding.EncodeToString([]byte("not-a-real-bundle")))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(desc))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("an application's archive must never be fetched")
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	base, sid, s := newArtifactServer(t, srv.URL, signerPrefix, moduleinstalltest.FakeVerifier{})
	code, body := sendArtifact(t, base, sid, "acc-tok", installBody(artifactKey, artifactVersion))
	if code != http.StatusConflict || !strings.Contains(body, "used from the portal") {
		t.Fatalf("an application must be refused by kind, got %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(s.cfg.ModulesDir, artifactKey)); !os.IsNotExist(err) {
		t.Fatalf("nothing may be placed, got %v", err)
	}
}
