package initcmd

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigEnableNoauthParsing(t *testing.T) {
	for _, v := range []string{"true", "True", "TRUE", "1", "t", " true "} {
		t.Setenv("ENABLE_NOAUTH", v)
		if !LoadConfig("1.0.0").EnableNoauth {
			t.Errorf("ENABLE_NOAUTH=%q should enable noauth", v)
		}
	}
	// Unrecognised or empty values are fail-secure: authentication stays on.
	for _, v := range []string{"false", "0", "", "no", "yes", "on", "enabled"} {
		t.Setenv("ENABLE_NOAUTH", v)
		if LoadConfig("1.0.0").EnableNoauth {
			t.Errorf("ENABLE_NOAUTH=%q should not enable noauth (fail-secure)", v)
		}
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	for _, k := range []string{"MODULES_DIR", "STATE_PATH", "CONSOLE_RELEASE_BASE_URL", "NEO4J_URI", "ENABLE_NOAUTH"} {
		t.Setenv(k, "")
	}
	t.Setenv("PLATFORM_VERSION", "2.0.0")
	c := LoadConfig("2.0.0")

	if c.ModulesDir != defaultModulesDir {
		t.Errorf("ModulesDir default = %q, want %q", c.ModulesDir, defaultModulesDir)
	}
	if c.ReleaseBaseURL != defaultReleaseBaseURL {
		t.Errorf("ReleaseBaseURL default = %q, want %q", c.ReleaseBaseURL, defaultReleaseBaseURL)
	}
	if c.Neo4jURI != defaultNeo4jURI {
		t.Errorf("Neo4jURI default = %q, want %q", c.Neo4jURI, defaultNeo4jURI)
	}
	if want := filepath.Join(defaultModulesDir, stateFileName); c.StatePath != want {
		t.Errorf("StatePath default = %q, want %q", c.StatePath, want)
	}
	if c.SchemaNoauthPath != defaultSchemaNoauthPath {
		t.Errorf("SchemaNoauthPath = %q, want %q", c.SchemaNoauthPath, defaultSchemaNoauthPath)
	}
	if c.HTTPTimeout != defaultHTTPTimeout {
		t.Errorf("HTTPTimeout = %v, want %v", c.HTTPTimeout, defaultHTTPTimeout)
	}
}

func TestLoadConfigStatePathFollowsModulesDir(t *testing.T) {
	t.Setenv("MODULES_DIR", "/custom/mods")
	t.Setenv("STATE_PATH", "")
	if got, want := LoadConfig("1.0.0").StatePath, filepath.Join("/custom/mods", stateFileName); got != want {
		t.Errorf("StatePath = %q, want %q (should default under MODULES_DIR)", got, want)
	}
}
