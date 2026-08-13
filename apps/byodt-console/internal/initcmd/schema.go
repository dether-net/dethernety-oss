package initcmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
)

// writeNoauthSchema writes the embedded noauth schema when authentication is disabled, and an EMPTY
// file otherwise. It is the first step and the only one whose failure aborts the deployment: a schema
// that disagrees with the code serving it must not serve.
//
// The auth-on case writes an empty file rather than removing it for a realization reason: the platform
// bind-mounts this exact path as a single file, and a missing source makes the container runtime
// auto-create a directory there — which turns a later flip back to no-auth into a fatal
// write-over-a-directory. An empty file keeps the mount a stable regular file while leaving no usable
// no-auth schema on disk when authentication is on (the platform only ever reads it when no-auth is
// actually in effect, in which case this wrote the real schema).
func writeNoauthSchema(cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(cfg.SchemaNoauthPath), 0o755); err != nil {
		return fmt.Errorf("creating schema directory: %w", err)
	}
	schema := []byte{}
	if cfg.EnableNoauth {
		embedded, err := assets.NoauthSchema()
		if err != nil {
			return fmt.Errorf("reading embedded noauth schema: %w", err)
		}
		schema = embedded
	}
	if err := os.WriteFile(cfg.SchemaNoauthPath, schema, 0o644); err != nil {
		return fmt.Errorf("writing noauth schema: %w", err)
	}
	return nil
}
