// Command byodt-console is the BYODt deployment's console. Its init subcommand runs once at
// deploy time, before the platform starts: it places the noauth schema, fetches and installs
// the signed OSS modules, and ingests the data corpus. Its daemon subcommand is a long-lived
// HTTP server that reports the deployment's state to the operator. The binary is named for its
// deployment type so another deployment type can ship its own console alongside it.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/daemoncmd"
	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/initcmd"
	"github.com/dether-net/dethernety-oss/pkg/moduleverify"
)

// version is the console's own build version, injected with
// -ldflags "-X main.version=<X.Y.Z>". Empty in an unstamped local build, in which case
// the version check against PLATFORM_VERSION is skipped.
var version string

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "init":
		runInit(logger)
	case "daemon":
		runDaemon(logger)
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func runInit(logger *slog.Logger) {
	cfg := initcmd.LoadConfig(version)

	v, err := moduleverify.New()
	if err != nil {
		logger.Error("initialising signature verifier", "err", err)
		os.Exit(1)
	}

	res := initcmd.Run(context.Background(), cfg, v, logger)
	if res.AbortDeployment {
		logger.Error("byodt-console init: aborting deployment", "err", res.Err)
		os.Exit(1)
	}
	logger.Info("byodt-console init: complete",
		"modules", res.State.Modules.Status,
		"ingest", res.State.Ingest.Status)
	os.Exit(0)
}

func runDaemon(logger *slog.Logger) {
	cfg := daemoncmd.LoadConfig(version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	v, err := moduleverify.New()
	if err != nil {
		logger.Error("initialising signature verifier", "err", err)
		os.Exit(1)
	}

	if err := daemoncmd.Run(ctx, cfg, v, logger); err != nil {
		logger.Error("byodt-console daemon", "err", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: byodt-console <init|daemon>")
}
