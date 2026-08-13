package initcmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
)

func TestPlaceNoauthSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-noauth.graphql")
	cfg := Config{EnableNoauth: true, SchemaNoauthPath: path}
	if err := writeNoauthSchema(cfg); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want, err := assets.NoauthSchema()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatal("written schema does not match the embedded schema")
	}
}

func TestEmptyNoauthSchemaWhenAuthOn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-noauth.graphql")
	if err := os.WriteFile(path, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{EnableNoauth: false, SchemaNoauthPath: path}
	if err := writeNoauthSchema(cfg); err != nil {
		t.Fatal(err)
	}
	// Auth is on: the file must remain a regular file (the platform mounts it as one) but hold no
	// usable schema — the stale contents are truncated to empty.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("the schema file must still exist as a stable mount target: %v", err)
	}
	if info.IsDir() {
		t.Fatal("the schema path must be a regular file, never a directory")
	}
	if info.Size() != 0 {
		t.Fatalf("the schema must be truncated to empty when auth is on, got %d bytes", info.Size())
	}
	// Writing again over the empty file must be a no-op success, not an error.
	if err := writeNoauthSchema(cfg); err != nil {
		t.Fatalf("re-writing the empty schema should not error: %v", err)
	}
}
