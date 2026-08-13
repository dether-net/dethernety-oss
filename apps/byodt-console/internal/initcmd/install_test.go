package initcmd

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// fakeVerifier stubs signature verification so the fetch/install flow can be exercised
// without producing real signed bundles. The crypto is proven in pkg/moduleverify.
type fakeVerifier struct{ err error }

func (f fakeVerifier) VerifyBlob(artifact io.Reader, bundleJSON []byte, id, issuer string) error {
	_, _ = io.Copy(io.Discard, artifact)
	return f.err
}

// recordingVerifier captures the (identity, issuer) every call is made with — so a test can
// assert the exact anti-rollback SAN is passed — and can selectively reject the blob whose
// bundle bytes contain rejectBundle (the compressed tarball bytes are opaque, but the
// bundle is served verbatim, so it is the reliable per-asset discriminator).
type recordingVerifier struct {
	calls        []verifyCall
	rejectBundle string
}

type verifyCall struct{ id, issuer string }

func (rv *recordingVerifier) VerifyBlob(artifact io.Reader, bundleJSON []byte, id, issuer string) error {
	_, _ = io.Copy(io.Discard, artifact)
	rv.calls = append(rv.calls, verifyCall{id, issuer})
	if rv.rejectBundle != "" && bytes.Contains(bundleJSON, []byte(rv.rejectBundle)) {
		return errors.New("no matching signature")
	}
	return nil
}

func twoModuleFiles(t *testing.T, aBundle, bBundle []byte) map[string][]byte {
	t.Helper()
	tbA, dgA, _ := buildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "a"})
	tbB, dgB, _ := buildModuleTarball(t, "mod-b", "1.0.0", map[string]string{"BMod.js": "b"})
	return map[string][]byte{
		"modules.json": indexJSON(t, "v1.2.3",
			indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: dgA},
			indexEntry{Name: "mod-b", Version: "1.0.0", Asset: "mod-b-1.0.0.tar.gz", AssetDigest: dgB}),
		"modules.json.bundle":       []byte("idx-bundle"),
		"mod-a-1.0.0.tar.gz":        tbA,
		"mod-a-1.0.0.tar.gz.bundle": aBundle,
		"mod-b-1.0.0.tar.gz":        tbB,
		"mod-b-1.0.0.tar.gz.bundle": bBundle,
	}
}

// TestReleaseIdentityPinned is the anti-rollback coverage: every VerifyBlob call — the
// index and each asset — must receive the exact release-workflow SAN for the platform
// version and the GitHub Actions OIDC issuer. A regression to a glob SAN, dropped tag, or
// wrong issuer would let a sibling release's signature verify; this pins the value the
// fakeVerifier discards.
func TestReleaseIdentityPinned(t *testing.T) {
	cfg := testConfig(t, serveRelease(t, "v1.2.3", twoModuleFiles(t, []byte("a-bundle"), []byte("b-bundle"))).URL)
	rv := &recordingVerifier{}
	if ms := installModules(context.Background(), cfg, newFetcher(cfg), rv); ms.Status != statusOK {
		t.Fatalf("both modules should install, got %q (%s)", ms.Status, ms.Detail)
	}
	if len(rv.calls) != 3 { // index + 2 assets
		t.Fatalf("expected 3 verify calls (index + 2 assets), got %d", len(rv.calls))
	}
	wantID := "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v1.2.3"
	for i, c := range rv.calls {
		if c.id != wantID {
			t.Errorf("call %d: identity = %q, want %q", i, c.id, wantID)
		}
		if c.issuer != moduleverify.OIDCIssuerGitHubActions {
			t.Errorf("call %d: issuer = %q, want %q", i, c.issuer, moduleverify.OIDCIssuerGitHubActions)
		}
	}
}

// TestOneModuleVerifyFailureEscalates covers the security-event contract: if any one asset
// fails verification, the whole channel status is did-not-verify — even when another module
// verified and placed.
func TestOneModuleVerifyFailureEscalates(t *testing.T) {
	cfg := testConfig(t, serveRelease(t, "v1.2.3", twoModuleFiles(t, []byte("good-a"), []byte("REJECT-b"))).URL)
	ms := installModules(context.Background(), cfg, newFetcher(cfg), &recordingVerifier{rejectBundle: "REJECT"})
	if ms.Status != statusDidNotVerify {
		t.Fatalf("one asset failing verification must escalate to did-not-verify, got %q", ms.Status)
	}
	// The module that did verify still placed.
	if _, err := os.Stat(filepath.Join(cfg.ModulesDir, "mod-a", "AMod.js")); err != nil {
		t.Fatalf("the verified module should have placed: %v", err)
	}
}

// TestStampIntegrityMismatch drives the defensive branch where the recomputed payload
// digest disagrees with the stamp the archive carries — a stamp that does not describe its
// own payload. buildModuleTarball always agrees, so this builds one by hand with a wrong
// stamp digest.
func TestStampIntegrityMismatch(t *testing.T) {
	tmp := t.TempDir()
	payloadDir := filepath.Join(tmp, "dethernety", "mod-a")
	if err := os.MkdirAll(payloadDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(payloadDir, "AMod.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	badStamp := `{"name":"mod-a","version":"1.0.0","builtFrom":null,"payloadDigest":"sha256:` + strings.Repeat("0", 64) + "\"}\n"
	if err := os.WriteFile(filepath.Join(payloadDir, payloaddigest.StampFilename), []byte(badStamp), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), []byte(`{"name":"mod-a"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	tarball := tarGzDir(t, tmp)
	sum := sha256.Sum256(tarball)
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":              indexJSON(t, "v1.2.3", indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: "sha256:" + hex.EncodeToString(sum[:])}),
		"modules.json.bundle":       []byte("b"),
		"mod-a-1.0.0.tar.gz":        tarball,
		"mod-a-1.0.0.tar.gz.bundle": []byte("b"),
	}).URL)
	ms := run(t, cfg, fakeVerifier{})
	if ms.Expected[0].Outcome != outcomeFailed || !strings.Contains(ms.Expected[0].Detail, "stamp integrity") {
		t.Fatalf("a wrong stamp must fail with stamp-integrity, got %+v", ms.Expected[0])
	}
}

// TestUnexpectedLayout drives the branch where the archive has no dethernety/<name> payload
// root — the layout the packager guarantees is absent.
func TestUnexpectedLayout(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), []byte(`{"name":"mod-a"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Payload at the archive root, not under dethernety/mod-a/.
	if err := os.WriteFile(filepath.Join(tmp, "AMod.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	tarball := tarGzDir(t, tmp)
	sum := sha256.Sum256(tarball)
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":              indexJSON(t, "v1.2.3", indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: "sha256:" + hex.EncodeToString(sum[:])}),
		"modules.json.bundle":       []byte("b"),
		"mod-a-1.0.0.tar.gz":        tarball,
		"mod-a-1.0.0.tar.gz.bundle": []byte("b"),
	}).URL)
	ms := run(t, cfg, fakeVerifier{})
	if ms.Expected[0].Outcome != outcomeFailed || !strings.Contains(ms.Expected[0].Detail, "unexpected layout") {
		t.Fatalf("a missing payload root must fail with unexpected-layout, got %+v", ms.Expected[0])
	}
}

// buildModuleTarball builds a v2 module tarball (manifest.json at root + the payload
// under dethernety/<name>/, stamped with a digest that recomputes exactly) and returns
// its bytes, its sha256 assetDigest, and the payload digest.
func buildModuleTarball(t *testing.T, name, version string, files map[string]string) (tarball []byte, assetDigest, payloadDigest string) {
	t.Helper()
	tmp := t.TempDir()
	payloadDir := filepath.Join(tmp, "dethernety", name)
	for rel, content := range files {
		p := filepath.Join(payloadDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	digest, err := payloaddigest.Compute(payloadDir)
	if err != nil {
		t.Fatal(err)
	}
	stamp := fmt.Sprintf("{\n  \"name\": %q,\n  \"version\": %q,\n  \"builtFrom\": null,\n  \"payloadDigest\": %q\n}\n", name, version, digest)
	if err := os.WriteFile(filepath.Join(payloadDir, payloaddigest.StampFilename), []byte(stamp), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := fmt.Sprintf(`{"name":%q,"version":%q}`, name, version)
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	tarball = tarGzDir(t, tmp)
	sum := sha256.Sum256(tarball)
	return tarball, "sha256:" + hex.EncodeToString(sum[:]), digest
}

func tarGzDir(t *testing.T, root string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		content, _ := os.ReadFile(p)
		hdr := &tar.Header{Name: filepath.ToSlash(rel), Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err = tw.Write(content)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func indexJSON(t *testing.T, tag string, entries ...indexEntry) []byte {
	t.Helper()
	b, err := json.Marshal(moduleIndex{Schema: indexSchema, Tag: tag, Commit: "deadbeef", Modules: entries})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func serveRelease(t *testing.T, tag string, files map[string][]byte) *httptest.Server {
	t.Helper()
	prefix := "/releases/download/" + tag + "/"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, prefix)
		b, ok := files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testConfig(t *testing.T, baseURL string) Config {
	t.Helper()
	return Config{
		PlatformVersion: "1.2.3",
		ModulesDir:      t.TempDir(),
		ReleaseBaseURL:  baseURL,
		HTTPTimeout:     5 * time.Second,
	}
}

func run(t *testing.T, cfg Config, v Verifier) ModulesState {
	t.Helper()
	return installModules(context.Background(), cfg, newFetcher(cfg), v)
}

func TestInstallHappyPath(t *testing.T) {
	tarball, digest, _ := buildModuleTarball(t, "dethernety-general", "1.0.0",
		map[string]string{"GeneralModule.js": "export default {};\n", "data/foo.cypher": "MERGE (n);"})
	files := map[string][]byte{
		"modules.json": indexJSON(t, "v1.2.3", indexEntry{
			Name: "dethernety-general", Version: "1.0.0",
			Asset: "dethernety-general-1.0.0.tar.gz", AssetDigest: digest,
		}),
		"modules.json.bundle":                    []byte("bundle"),
		"dethernety-general-1.0.0.tar.gz":        tarball,
		"dethernety-general-1.0.0.tar.gz.bundle": []byte("bundle"),
	}
	cfg := testConfig(t, serveRelease(t, "v1.2.3", files).URL)
	ms := run(t, cfg, fakeVerifier{})

	if ms.Status != statusOK {
		t.Fatalf("status = %q (%s)", ms.Status, ms.Detail)
	}
	if len(ms.Expected) != 1 || ms.Expected[0].Outcome != outcomePlaced {
		t.Fatalf("expected one placed module, got %+v", ms.Expected)
	}
	if _, err := os.Stat(filepath.Join(cfg.ModulesDir, "dethernety-general", "GeneralModule.js")); err != nil {
		t.Fatalf("module not installed: %v", err)
	}
	// The temp extraction area is cleaned up.
	if _, err := os.Stat(filepath.Join(cfg.ModulesDir, tmpDirName)); !os.IsNotExist(err) {
		t.Fatal("temp dir not cleaned up")
	}
}

func TestReplacementRule(t *testing.T) {
	cfg := testConfig(t, "")
	serve := func(files map[string]string) *httptest.Server {
		tb, dg, _ := buildModuleTarball(t, "mod-a", "1.0.0", files)
		return serveRelease(t, "v1.2.3", map[string][]byte{
			"modules.json":              indexJSON(t, "v1.2.3", indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: dg}),
			"modules.json.bundle":       []byte("b"),
			"mod-a-1.0.0.tar.gz":        tb,
			"mod-a-1.0.0.tar.gz.bundle": []byte("b"),
		})
	}

	// First install: placed.
	cfg.ReleaseBaseURL = serve(map[string]string{"AMod.js": "v1"}).URL
	if ms := run(t, cfg, fakeVerifier{}); ms.Expected[0].Outcome != outcomePlaced {
		t.Fatalf("first install should place, got %q", ms.Expected[0].Outcome)
	}
	// Same payload again: skipped (on-disk digest already matches).
	cfg.ReleaseBaseURL = serve(map[string]string{"AMod.js": "v1"}).URL
	if ms := run(t, cfg, fakeVerifier{}); ms.Expected[0].Outcome != outcomeSkipped {
		t.Fatalf("re-install of identical payload should skip, got %q", ms.Expected[0].Outcome)
	}
	// Different payload: placed (replaced).
	cfg.ReleaseBaseURL = serve(map[string]string{"AMod.js": "v2-different"}).URL
	if ms := run(t, cfg, fakeVerifier{}); ms.Expected[0].Outcome != outcomePlaced {
		t.Fatalf("changed payload should replace, got %q", ms.Expected[0].Outcome)
	}
	got, _ := os.ReadFile(filepath.Join(cfg.ModulesDir, "mod-a", "AMod.js"))
	if string(got) != "v2-different" {
		t.Fatalf("module content not replaced: %q", got)
	}
}

func TestOperatorModuleUntouched(t *testing.T) {
	tarball, digest, _ := buildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":              indexJSON(t, "v1.2.3", indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: digest}),
		"modules.json.bundle":       []byte("b"),
		"mod-a-1.0.0.tar.gz":        tarball,
		"mod-a-1.0.0.tar.gz.bundle": []byte("b"),
	}).URL)

	// An operator-authored module not named by the index.
	opPath := filepath.Join(cfg.ModulesDir, "operator-mod", "OperatorModule.js")
	if err := os.MkdirAll(filepath.Dir(opPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(opPath, []byte("operator"), 0o644); err != nil {
		t.Fatal(err)
	}

	run(t, cfg, fakeVerifier{})

	if got, err := os.ReadFile(opPath); err != nil || string(got) != "operator" {
		t.Fatalf("operator module was touched: err=%v content=%q", err, got)
	}
}

func TestAssetDigestMismatch(t *testing.T) {
	tarball, _, _ := buildModuleTarball(t, "mod-a", "1.0.0", map[string]string{"AMod.js": "x"})
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":              indexJSON(t, "v1.2.3", indexEntry{Name: "mod-a", Version: "1.0.0", Asset: "mod-a-1.0.0.tar.gz", AssetDigest: "sha256:" + strings.Repeat("0", 64)}),
		"modules.json.bundle":       []byte("b"),
		"mod-a-1.0.0.tar.gz":        tarball,
		"mod-a-1.0.0.tar.gz.bundle": []byte("b"),
	}).URL)
	ms := run(t, cfg, fakeVerifier{})
	// The only module failed, so the channel status is failed (not partial — nothing placed).
	if ms.Status != statusFailed || ms.Expected[0].Outcome != outcomeFailed || !strings.Contains(ms.Expected[0].Detail, "asset digest mismatch") {
		t.Fatalf("expected asset-digest failure, got %+v", ms)
	}
}

func TestVerifyFailureIsSecurityEvent(t *testing.T) {
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":        indexJSON(t, "v1.2.3"),
		"modules.json.bundle": []byte("b"),
	}).URL)
	ms := run(t, cfg, fakeVerifier{err: errors.New("no matching identity")})
	if ms.Status != statusDidNotVerify {
		t.Fatalf("verify failure should be did-not-verify, got %q (%s)", ms.Status, ms.Detail)
	}
}

func TestIndexTagMismatchRejected(t *testing.T) {
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{
		"modules.json":        indexJSON(t, "v9.9.9"), // signed, but names the wrong release
		"modules.json.bundle": []byte("b"),
	}).URL)
	ms := run(t, cfg, fakeVerifier{})
	if ms.Status != statusDidNotVerify || !strings.Contains(ms.Detail, "tag") {
		t.Fatalf("tag mismatch should be rejected, got %q (%s)", ms.Status, ms.Detail)
	}
}

func TestNoAssets(t *testing.T) {
	cfg := testConfig(t, serveRelease(t, "v1.2.3", map[string][]byte{}).URL) // 404 for everything
	ms := run(t, cfg, fakeVerifier{})
	if ms.Status != statusNoAssets {
		t.Fatalf("missing index should be no-assets, got %q (%s)", ms.Status, ms.Detail)
	}
}

func TestUnreachable(t *testing.T) {
	cfg := Config{PlatformVersion: "1.2.3", ModulesDir: t.TempDir(), ReleaseBaseURL: "http://127.0.0.1:1", HTTPTimeout: 500 * time.Millisecond}
	ms := run(t, cfg, fakeVerifier{})
	if ms.Status != statusUnreachable {
		t.Fatalf("closed endpoint should be unreachable, got %q (%s)", ms.Status, ms.Detail)
	}
}
