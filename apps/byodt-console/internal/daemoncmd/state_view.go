package daemoncmd

import (
	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/initcmd"
)

// Failure kinds — the local-phase states the daemon can observe without the cloud.
const (
	failModuleFetch  = "module-fetch-failed"
	failFewerModules = "fewer-modules-registered"
	failIngest       = "ingest-failed"
	failPlatformDown = "platform-unreachable"
	failInitNotRun   = "init-not-run"
)

// failure is one operator-facing banner: a kind the UI keys copy off, and a specific message.
type failure struct {
	Kind    string   `json:"kind"`
	Message string   `json:"message"`
	Modules []string `json:"modules,omitempty"` // named modules, for fewer-modules-registered
}

// deriveModuleFailures turns the init module record — and, when the platform is reachable, the
// set it actually registered — into banners. It returns two distinct concerns:
//
//   - a fetch/verify failure, straight from the recorded status class; and
//   - the console's characteristic failure: modules the console *placed* that the platform did
//     not *register*, which init cannot see because it exits before the platform starts.
//
// registered is nil when the platform could not be queried; in that case the placed-vs-
// registered diff is skipped (the platform-unreachable banner covers it instead).
func deriveModuleFailures(m initcmd.ModulesState, registered map[string]struct{}) []failure {
	var out []failure

	switch m.Status {
	case initcmd.StatusUnreachable:
		out = append(out, failure{Kind: failModuleFetch, Message: "the module release channel was unreachable — no code modules were installed"})
	case initcmd.StatusNoAssets:
		out = append(out, failure{Kind: failModuleFetch, Message: "the named release carries no module assets — no code modules were installed"})
	case initcmd.StatusDidNotVerify:
		out = append(out, failure{Kind: failModuleFetch, Message: "a module signature did not verify — the module was rejected"})
	case initcmd.StatusPartial:
		out = append(out, failure{Kind: failModuleFetch, Message: "some modules installed and some failed"})
	case initcmd.StatusFailed:
		out = append(out, failure{Kind: failModuleFetch, Message: "every module failed to install — the deployment has no code modules"})
	}

	// Placed-but-not-registered — only computable once the platform has reported.
	if registered != nil {
		var missing []string
		for _, e := range m.Expected {
			// Placed and skipped modules are both on disk (skipped means a prior deploy's
			// matching copy is already there) and must register; only a failed module is
			// legitimately absent, so only it is excluded from the diff.
			if e.Outcome == initcmd.OutcomeFailed {
				continue
			}
			if _, ok := registered[e.Name]; !ok {
				missing = append(missing, e.Name)
			}
		}
		if len(missing) > 0 {
			out = append(out, failure{
				Kind:    failFewerModules,
				Message: "the console placed modules the platform did not register",
				Modules: missing,
			})
		}
	}

	return out
}

// deriveIngestFailure reports a failed data ingest, read from the state file's ingest block —
// which mirrors the graph marker, so the daemon needs no database connection to surface it.
func deriveIngestFailure(i initcmd.IngestState) *failure {
	if i.Status == initcmd.StatusFailed {
		msg := "the data ingest failed — the deployment runs without the MITRE corpus"
		if i.Detail != "" {
			msg += ": " + i.Detail
		}
		return &failure{Kind: failIngest, Message: msg}
	}
	return nil
}
