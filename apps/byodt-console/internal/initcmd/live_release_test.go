package initcmd

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// TestLiveReleaseInstall exercises the real fetch → verify → install path against the
// actually-published GitHub release for a version — the same code console-init runs at
// deploy time, with the real sigstore verifier (moduleverify.New) and the real signed
// assets. It is gated behind BYODT_LIVE_RELEASE_TEST because it reaches the network and
// depends on a published, signed release existing:
//
//	BYODT_LIVE_RELEASE_TEST=1 [BYODT_LIVE_VERSION=0.5.0] \
//	  go test ./internal/initcmd -run TestLiveReleaseInstall -v
func TestLiveReleaseInstall(t *testing.T) {
	if os.Getenv("BYODT_LIVE_RELEASE_TEST") == "" {
		t.Skip("set BYODT_LIVE_RELEASE_TEST=1 to run the live release integration test (network)")
	}
	version := os.Getenv("BYODT_LIVE_VERSION")
	if version == "" {
		version = "0.5.0"
	}

	modulesDir := t.TempDir()
	cfg := Config{
		PlatformVersion: version,
		ModulesDir:      modulesDir,
		ReleaseBaseURL:  defaultReleaseBaseURL, // https://github.com/dether-net/dethernety-oss
		HTTPTimeout:     90 * time.Second,
	}

	// The production verifier: embedded sigstore trusted root, no dev/relaxed path. This is
	// what makes the test meaningful — a hand-uploaded or wrongly-signed asset would fail here.
	v, err := moduleverify.New()
	if err != nil {
		t.Fatalf("constructing the real verifier: %v", err)
	}

	ms := installModules(context.Background(), cfg, newFetcher(cfg), v)

	t.Logf("release v%s → status=%s detail=%q", version, ms.Status, ms.Detail)
	for _, oc := range ms.Expected {
		t.Logf("  %-28s %-6s %-8s %s", oc.Name, oc.Version, oc.Outcome, oc.PayloadDigest)
		if oc.Detail != "" {
			t.Logf("      detail: %s", oc.Detail)
		}
	}

	if ms.Status != statusOK {
		t.Fatalf("module install status = %q, want %q (detail: %s)", ms.Status, statusOK, ms.Detail)
	}
	if len(ms.Expected) != 3 {
		t.Fatalf("installed %d modules, want 3", len(ms.Expected))
	}
	for _, oc := range ms.Expected {
		if oc.Outcome != outcomePlaced && oc.Outcome != outcomeSkipped {
			t.Errorf("module %s: outcome = %q, want placed|skipped (detail: %s)", oc.Name, oc.Outcome, oc.Detail)
			continue
		}
		// The installed payload must be a loadable module directory carrying its identity stamp.
		dir := filepath.Join(modulesDir, oc.Name)
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Errorf("module %s: expected an installed directory at %s (err=%v)", oc.Name, dir, err)
			continue
		}
		stamp := filepath.Join(dir, payloaddigest.StampFilename)
		if _, err := os.Stat(stamp); err != nil {
			t.Errorf("module %s: expected the payload stamp at %s (err=%v)", oc.Name, stamp, err)
		}
	}
}
