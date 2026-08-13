// Package initcmd implements the console's init subcommand: the deploy-time
// one-shot that places the noauth schema, fetches and installs the published modules,
// and ingests the data corpus — all before the platform starts.
package initcmd

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// The platform reads the noauth schema from this fixed path, beside schema.graphql,
	// with process working directory /app/apps/dt-ws (Dockerfile). A single-file bind mount
	// here lands beside schema.graphql without shadowing it, so the path stays a constant
	// rather than a configurable value.
	defaultSchemaNoauthPath = "/app/apps/dt-ws/schema/schema-noauth.graphql"

	// The writable modules directory the platform loads from — bind-mounted at this
	// absolute path so the loader resolves module base classes under /app.
	defaultModulesDir = "/app/apps/dt-ws/custom_modules"

	// The public repository whose release assets the console fetches. Overridable only to
	// point integration tests at a local server.
	defaultReleaseBaseURL = "https://github.com/dether-net/dethernety-oss"

	defaultNeo4jURI = "bolt://localhost:7687"

	// The state file, written into the modules mount as a top-level dotfile. The loader
	// iterates subdirectories only, so a top-level file is invisible to it. Named for the
	// binary so another deployment type's console writes its own.
	stateFileName = ".byodt-console-state.json"

	defaultHTTPTimeout = 60 * time.Second
)

// Config is the resolved init configuration. Fields are exported so tests can
// construct one directly against temporary directories and a local server, rather than
// through the environment.
type Config struct {
	Version         string // the console's own baked version (from main)
	PlatformVersion string // PLATFORM_VERSION — selects the release and pins the identity
	EnableNoauth    bool   // ENABLE_NOAUTH parsed as a boolean; fail-secure (false) if unparseable

	SchemaNoauthPath string // where the noauth schema is written / removed
	ModulesDir       string // the writable modules directory
	StatePath        string // the init state file
	ReleaseBaseURL   string // base URL for release-asset downloads
	HTTPTimeout      time.Duration

	Neo4jURI      string
	Neo4jUsername string
	Neo4jPassword string
	Neo4jDatabase string
}

// LoadConfig resolves configuration from the environment, applying defaults. version is
// the console's own build version, injected by main.
func LoadConfig(version string) Config {
	modulesDir := getenvDefault("MODULES_DIR", defaultModulesDir)
	c := Config{
		Version:          version,
		PlatformVersion:  os.Getenv("PLATFORM_VERSION"),
		EnableNoauth:     parseBoolLenient(os.Getenv("ENABLE_NOAUTH")),
		SchemaNoauthPath: defaultSchemaNoauthPath,
		ModulesDir:       modulesDir,
		StatePath:        getenvDefault("STATE_PATH", filepath.Join(modulesDir, stateFileName)),
		ReleaseBaseURL:   getenvDefault("CONSOLE_RELEASE_BASE_URL", defaultReleaseBaseURL),
		HTTPTimeout:      defaultHTTPTimeout,
		Neo4jURI:         getenvDefault("NEO4J_URI", defaultNeo4jURI),
		Neo4jUsername:    os.Getenv("NEO4J_USERNAME"),
		Neo4jPassword:    os.Getenv("NEO4J_PASSWORD"),
		Neo4jDatabase:    os.Getenv("NEO4J_DATABASE"),
	}
	return c
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// parseBoolLenient accepts the standard boolean spellings (1/t/T/TRUE/true/True and their
// false counterparts, trimmed of surrounding space). Anything else — including an empty or
// unrecognised value — is false: the failure direction is fail-secure, since a false here
// leaves the platform authenticated.
func parseBoolLenient(v string) bool {
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	return err == nil && b
}
