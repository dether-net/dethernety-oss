package initcmd

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall/moduleinstalltest"
)

func TestCheckEmbeddingProfile(t *testing.T) {
	const eg1 = "embeddinggemma-300m-retrieval-v1"
	for _, tc := range []struct {
		name, corpus, model, want string // want "" = accepted
	}{
		{"the default against matching data", eg1, "", ""},
		{"a blank value reads as unset", eg1, "  ", ""},
		{"the default set explicitly", eg1, eg1, ""},
		{"surrounding space is trimmed", eg1, " " + eg1 + " ", ""},
		{"the legacy model against EG1 data", eg1, "embeddinggemma", `EMBEDDING_MODEL "embeddinggemma" does not match this release's MITRE data, which was embedded with "embeddinggemma-300m-retrieval-v1". Remove EMBEDDING_MODEL from .env`},
		{"another built-in model", eg1, "embeddinggemma-2-text-retrieval-v1", `EMBEDDING_MODEL "embeddinggemma-2-text-retrieval-v1" does not match`},
		{"the default against legacy data: a broken image", "embeddinggemma", "", `the platform's default embedding profile "embeddinggemma-300m-retrieval-v1" does not match this release's MITRE data, which was embedded with "embeddinggemma": this console image is broken`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := checkEmbeddingProfile(tc.corpus, tc.model)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("want accepted, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want an error containing %q, got %v", tc.want, err)
			}
		})
	}
}

// The console's default and the platform's must be the same profile: each side decides the effective model for an
// unset EMBEDDING_MODEL on its own.
var platformDefault = regexp.MustCompile(`(?m)^export const DEFAULT_EMBEDDING_PROFILE_ID = '([^']+)';$`)

func TestTheDefaultEmbeddingProfileMatchesThePlatform(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "dt-ws", "src", "config", "embedding-profile-selection.ts"))
	if err != nil {
		t.Fatalf("the platform's profile selection must be present: %v", err)
	}
	m := platformDefault.FindSubmatch(src)
	if m == nil {
		t.Fatal("no DEFAULT_EMBEDDING_PROFILE_ID declaration in the platform's profile selection")
	}
	if string(m[1]) != DefaultEmbeddingProfile {
		t.Fatalf("the platform's default is %q, the console's %q", m[1], DefaultEmbeddingProfile)
	}
}

// A release's MITRE data must be embedded with the profile the platform runs by default: anything else is a release
// that searches its MITRE vectors with another model's queries. This fails the build, before any operator starts it.
func TestTheMitreDataIsEmbeddedWithTheDefaultProfile(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "modules", "mitre-frameworks", "manifest.json"))
	if err != nil {
		t.Fatalf("the mitre-frameworks manifest must be present: %v", err)
	}
	var manifest struct {
		EmbeddingProfile string `json:"embeddingProfile"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.EmbeddingProfile != DefaultEmbeddingProfile {
		t.Fatalf("the MITRE data is embedded with %q, the platform's default is %q", manifest.EmbeddingProfile, DefaultEmbeddingProfile)
	}
	embedded, err := assets.CorpusEmbeddingProfile()
	if err != nil {
		t.Fatalf("the bundled MITRE data names no profile: %v", err)
	}
	if embedded != manifest.EmbeddingProfile {
		t.Fatalf("the bundled manifest names %q, the module's %q: run build-assets.sh", embedded, manifest.EmbeddingProfile)
	}
}

func TestRunRefusesAMismatchedModelBeforeTheSchemaAndTheIngest(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		PlatformVersion:  "1.0.0",
		EnableNoauth:     true, // the schema step would write a file
		SchemaNoauthPath: filepath.Join(dir, "schema-noauth.graphql"),
		ModulesDir:       dir,
		StatePath:        filepath.Join(dir, stateFileName),
		EmbeddingModel:   "nomic-embed-text",
	}
	res := Run(context.Background(), cfg, moduleinstalltest.FakeVerifier{}, discardLogger())
	if !res.AbortDeployment || res.Err == nil || !strings.Contains(res.Err.Error(), `EMBEDDING_MODEL "nomic-embed-text" does not match`) {
		t.Fatalf("want the profile refusal, got abort=%v err=%v", res.AbortDeployment, res.Err)
	}
	for _, p := range []string{cfg.SchemaNoauthPath, cfg.StatePath} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s exists: the refusal must come before the schema and the state", p)
		}
	}
}
