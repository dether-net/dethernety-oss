package daemoncmd

import (
	"testing"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/initcmd"
)

func TestDeriveModuleFailures_FetchClasses(t *testing.T) {
	cases := map[string]string{
		initcmd.StatusUnreachable:  "unreachable",
		initcmd.StatusNoAssets:     "no assets",
		initcmd.StatusDidNotVerify: "verify",
		initcmd.StatusPartial:      "some",
		initcmd.StatusFailed:       "all failed", // the worst outcome must still raise a banner
	}
	for status := range cases {
		fs := deriveModuleFailures(initcmd.ModulesState{Status: status}, nil)
		if len(fs) != 1 || fs[0].Kind != failModuleFetch {
			t.Fatalf("status %q: want one module-fetch failure, got %+v", status, fs)
		}
	}
	// A clean status yields no fetch banner.
	if fs := deriveModuleFailures(initcmd.ModulesState{Status: initcmd.StatusOK}, map[string]struct{}{}); len(fs) != 0 {
		t.Fatalf("ok status must yield no fetch failure, got %+v", fs)
	}
}

func TestDeriveModuleFailures_FewerRegistered(t *testing.T) {
	m := initcmd.ModulesState{
		Status: initcmd.StatusOK,
		Expected: []initcmd.ModuleOutcome{
			{Name: "placed-registered", Outcome: initcmd.OutcomePlaced},
			{Name: "placed-missing", Outcome: initcmd.OutcomePlaced},
			// On disk from a prior deploy (digest matched) — the platform reloads it, so it
			// must still register; it belongs in the diff.
			{Name: "skipped-missing", Outcome: initcmd.OutcomeSkipped},
			// Failed to install — legitimately absent, never counted missing.
			{Name: "failed-one", Outcome: initcmd.OutcomeFailed},
		},
	}
	// Only one of the on-disk modules registered.
	registered := map[string]struct{}{"placed-registered": {}}

	fs := deriveModuleFailures(m, registered)
	if len(fs) != 1 || fs[0].Kind != failFewerModules {
		t.Fatalf("want one fewer-modules failure, got %+v", fs)
	}
	named := map[string]bool{}
	for _, n := range fs[0].Modules {
		named[n] = true
	}
	// Both the placed and the skipped on-disk modules must be named; the failed and the
	// registered ones must not.
	if !named["placed-missing"] || !named["skipped-missing"] {
		t.Fatalf("must name both the placed and skipped unregistered modules, got %v", fs[0].Modules)
	}
	if named["failed-one"] || named["placed-registered"] {
		t.Fatalf("must not name failed or registered modules, got %v", fs[0].Modules)
	}

	// Every on-disk module registered → no banner (failed-one is expected-absent).
	all := map[string]struct{}{"placed-registered": {}, "placed-missing": {}, "skipped-missing": {}}
	if fs := deriveModuleFailures(m, all); len(fs) != 0 {
		t.Fatalf("all on-disk modules registered must yield no failure, got %+v", fs)
	}

	// Platform unreachable (registered == nil) → the diff is skipped, not a false positive.
	if fs := deriveModuleFailures(m, nil); len(fs) != 0 {
		t.Fatalf("nil registered must skip the diff, got %+v", fs)
	}
}

func TestDeriveIngestFailure(t *testing.T) {
	if f := deriveIngestFailure(initcmd.IngestState{Status: initcmd.StatusOK}); f != nil {
		t.Fatalf("ok ingest must yield no failure, got %+v", f)
	}
	f := deriveIngestFailure(initcmd.IngestState{Status: initcmd.StatusFailed, Detail: "memory limit"})
	if f == nil || f.Kind != failIngest {
		t.Fatalf("failed ingest must yield an ingest failure, got %+v", f)
	}
}
