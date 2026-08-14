// Package daemoncmd implements the console's daemon subcommand: a small HTTP server that
// runs outside the deployment stack, on its own port, and reports the deployment's state to
// the operator — the four locally-observable failure states, the platform phase, and restart
// guidance — behind a session the operator establishes by the deployment's
// posture (host trust locally, delegated OIDC in cloud). It has no dependency on any container,
// so it can report while the stack is down.
//
// The cloud phase lives here too: pasting the deployment login recipe, writing it into the mode
// layer, and reverting to pure-OSS. It also serves the cloud content phase: browsing the public
// catalog, mounting and unmounting modules (a stub the console writes into the modules directory),
// and reporting whether
// a newer content version is available.
package daemoncmd

import (
	"os"
	"path/filepath"
	"time"
)

const (
	defaultPort = "8080"
	// Bind all interfaces: inside a container a loopback bind is unreachable through the port
	// publish, and on bare metal the operator browses to the box's address. Exposure is enforced
	// by the host publish / firewall; the session (a custom header, never a cookie) is what closes
	// the CSRF class, because a loopback bind is not a boundary against a browser.
	defaultBind        = "0.0.0.0"
	defaultPlatformURL = "http://platform:3003"
	defaultModulesDir  = "/app/apps/dt-ws/custom_modules"

	// The state file init writes into the modules mount as a top-level dotfile (the loader
	// iterates subdirectories only, so a top-level file is invisible to it).
	stateFileName = ".byodt-console-state.json"

	// The mode layer the console owns: one env-file it writes cloud or pure-OSS values into and the
	// realization applies at the next `up -d`. This is the canonical appliance location — under
	// /var, never /etc, so it survives a rollback; the compose realization surfaces this same path on
	// the host by mounting its bundle-dir mode/ here. The console is path-agnostic via MODE_LAYER_PATH.
	defaultModeLayerPath = "/var/lib/dethernety/mode.env"
	// The content cache the console emits into the mode layer. It is a fixed constant per
	// realization — a path inside the platform container, co-durable with the graph — that the
	// console writes but never resolves, because it lives in a namespace the console does not share.
	// The realization pins the real value via MODULE_CONTENT_CACHE_DIR.
	defaultContentCacheDir = "/app/apps/dt-ws/.module-content-cache"

	defaultProbeTimeout = 5 * time.Second
)

// Config is the resolved daemon configuration. Fields are exported so tests can construct one
// directly against temporary directories and a local server rather than the environment.
type Config struct {
	Version string // the console's own baked version (from main)

	Bind string // listen address; all interfaces by default (see defaultBind) — exposure is the host publish/firewall
	Port string // listen port

	PlatformURL string // base URL the daemon probes for /config, /health and /graphql
	StatePath   string // the init state file the daemon reads
	ModulesDir  string // the modules mount (the state file's parent by default)

	ModeLayerPath   string // the mode-layer env-file the console writes (cloud or pure-OSS)
	ContentCacheDir string // the fixed per-realization content cache the console emits into it

	ProbeTimeout time.Duration // per-probe timeout against the platform
}

// LoadConfig resolves configuration from the environment, applying defaults. version is the
// console's own build version, injected by main.
func LoadConfig(version string) Config {
	modulesDir := getenvDefault("MODULES_DIR", defaultModulesDir)
	return Config{
		Version:         version,
		Bind:            getenvDefault("CONSOLE_BIND", defaultBind),
		Port:            getenvDefault("CONSOLE_PORT", defaultPort),
		PlatformURL:     getenvDefault("PLATFORM_URL", defaultPlatformURL),
		StatePath:       getenvDefault("STATE_PATH", filepath.Join(modulesDir, stateFileName)),
		ModulesDir:      modulesDir,
		ModeLayerPath:   getenvDefault("MODE_LAYER_PATH", defaultModeLayerPath),
		ContentCacheDir: getenvDefault("MODULE_CONTENT_CACHE_DIR", defaultContentCacheDir),
		ProbeTimeout:    defaultProbeTimeout,
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
