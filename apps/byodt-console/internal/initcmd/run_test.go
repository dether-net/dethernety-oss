package initcmd

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall/moduleinstalltest"
)

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestRunVersionMismatchAborts(t *testing.T) {
	cfg := Config{Version: "1.0.0", PlatformVersion: "2.0.0"}
	if res := Run(context.Background(), cfg, moduleinstalltest.FakeVerifier{}, discardLogger()); !res.AbortDeployment {
		t.Fatal("a version mismatch must abort the deployment")
	}
}

func TestRunEmptyPlatformVersionAborts(t *testing.T) {
	if res := Run(context.Background(), Config{}, moduleinstalltest.FakeVerifier{}, discardLogger()); !res.AbortDeployment {
		t.Fatal("a missing PLATFORM_VERSION must abort")
	}
}

func TestRunSchemaFailureAborts(t *testing.T) {
	// Make the schema's parent path a regular file so MkdirAll on it fails — a reliable,
	// cross-platform way to force the write to fail.
	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{
		PlatformVersion:  "1.0.0",
		EnableNoauth:     true,
		SchemaNoauthPath: filepath.Join(file, "schema-noauth.graphql"),
	}
	if res := Run(context.Background(), cfg, moduleinstalltest.FakeVerifier{}, discardLogger()); !res.AbortDeployment {
		t.Fatal("a schema placement failure must abort")
	}
}

func TestRunModuleAndIngestFailuresDoNotAbort(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		PlatformVersion:  "1.0.0", // Version empty → version check skipped
		EnableNoauth:     false,   // schema removal is a no-op
		SchemaNoauthPath: filepath.Join(dir, "schema-noauth.graphql"),
		ModulesDir:       dir,
		StatePath:        filepath.Join(dir, stateFileName),
		ReleaseBaseURL:   "http://127.0.0.1:1", // unreachable
		HTTPTimeout:      500 * time.Millisecond,
		Neo4jURI:         "bolt://127.0.0.1:1", // connect refused
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	res := Run(ctx, cfg, moduleinstalltest.FakeVerifier{}, discardLogger())
	if res.AbortDeployment {
		t.Fatalf("module/ingest failures must not abort the deployment: %v", res.Err)
	}
	if res.State.Modules.Status != statusUnreachable {
		t.Fatalf("modules status = %q, want unreachable", res.State.Modules.Status)
	}
	if res.State.Ingest.Status != statusFailed {
		t.Fatalf("ingest status = %q, want failed", res.State.Ingest.Status)
	}
	if _, err := os.Stat(cfg.StatePath); err != nil {
		t.Fatalf("state file not written: %v", err)
	}
}
