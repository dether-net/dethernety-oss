package initcmd

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// Result classifies an init run so the caller can choose an exit code. The two
// exit disciplines are here: AbortDeployment is the non-zero half (a version or schema
// failure must stop the `up`, because a mismatched schema must not serve); otherwise the
// process exits 0 having recorded the module and ingest outcomes for the daemon to read.
type Result struct {
	AbortDeployment bool
	Err             error
	State           State
}

// Run executes the init subcommand: version check and schema placement (fatal on failure), then
// module install and data ingest (recorded, never fatal).
func Run(ctx context.Context, cfg Config, v Verifier, logger *slog.Logger) Result {
	// Step 1 — version check.
	if cfg.PlatformVersion == "" {
		return Result{AbortDeployment: true, Err: fmt.Errorf("PLATFORM_VERSION is not set")}
	}
	if cfg.Version != "" && cfg.Version != cfg.PlatformVersion {
		return Result{AbortDeployment: true, Err: fmt.Errorf(
			"console image version %q does not match PLATFORM_VERSION %q — the operator has pinned a version this image cannot serve",
			cfg.Version, cfg.PlatformVersion)}
	}

	// Step 2 — schema placement. A file write; it goes first because it cannot fail for
	// database reasons, and its failure must abort the deployment.
	if err := writeNoauthSchema(cfg); err != nil {
		return Result{AbortDeployment: true, Err: fmt.Errorf("schema placement: %w", err)}
	}
	logger.Info("schema placement complete", "enableNoauth", cfg.EnableNoauth)

	st := State{Tag: "v" + cfg.PlatformVersion, RanAt: time.Now().UTC().Format(time.RFC3339)}

	// Step 3 — modules. A failure is recorded, not fatal.
	st.Modules = installModules(ctx, cfg, newFetcher(cfg), v)
	logger.Info("module install complete", "status", st.Modules.Status, "detail", st.Modules.Detail)

	// Step 4 — ingest. A failure leaves a running deployment for the operator to read the
	// diagnosis on.
	st.Ingest = ingestCorpus(ctx, cfg)
	logger.Info("ingest complete",
		"status", st.Ingest.Status, "statements", st.Ingest.Statements,
		"elapsedMs", st.Ingest.ElapsedMs, "detail", st.Ingest.Detail)

	// The state file is how the daemon learns the expected set and the failure classes; a
	// failure to write it is logged but does not abort a running deployment.
	if err := writeState(cfg.StatePath, st); err != nil {
		logger.Error("writing init state file", "err", err, "path", cfg.StatePath)
	}

	return Result{State: st}
}
