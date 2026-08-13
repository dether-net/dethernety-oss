package initcmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const stateSchema = "dethernety.byodt-console-state/1"

// Module status classes. The daemon turns these into operator-facing banners; the classes
// are distinct because their causes and remedies differ.
const (
	statusOK           = "ok"
	statusUnreachable  = "unreachable"    // network event
	statusNoAssets     = "no-assets"      // config-or-publication event; must not blame the operator
	statusDidNotVerify = "did-not-verify" // security event
	statusPartial      = "partial"        // some modules placed, some failed
	statusFailed       = "failed"
	statusSkipped      = "skipped-unchanged"
)

// Module outcomes.
const (
	outcomePlaced  = "placed"
	outcomeSkipped = "skipped" // on-disk digest already matches — no replacement needed
	outcomeFailed  = "failed"
)

// Exported status/outcome values, for the daemon that reads this record and turns the
// classes into operator-facing banners. Aliases of the internal constants above so the
// values have a single source of truth.
const (
	StatusOK           = statusOK
	StatusUnreachable  = statusUnreachable
	StatusNoAssets     = statusNoAssets
	StatusDidNotVerify = statusDidNotVerify
	StatusPartial      = statusPartial
	StatusFailed       = statusFailed
	StatusSkipped      = statusSkipped

	OutcomePlaced  = outcomePlaced
	OutcomeSkipped = outcomeSkipped
	OutcomeFailed  = outcomeFailed
)

// State is the init record the daemon reads after the platform is up. It records
// what init placed (the expected set) — not what registered, which init
// exits too early to observe.
type State struct {
	Schema  string       `json:"schema"`
	Tag     string       `json:"tag"`
	RanAt   string       `json:"ranAt"`
	Modules ModulesState `json:"modules"`
	Ingest  IngestState  `json:"ingest"`
}

type ModulesState struct {
	Status   string          `json:"status"`
	Detail   string          `json:"detail,omitempty"`
	Expected []ModuleOutcome `json:"expected"`
}

type ModuleOutcome struct {
	Name          string `json:"name"`
	Version       string `json:"version"`
	PayloadDigest string `json:"payloadDigest,omitempty"`
	Outcome       string `json:"outcome"`
	Detail        string `json:"detail,omitempty"`
}

type IngestState struct {
	Status      string `json:"status"`
	ContentHash string `json:"contentHash,omitempty"`
	ElapsedMs   int64  `json:"elapsedMs,omitempty"`
	Statements  int    `json:"statements,omitempty"`
	Detail      string `json:"detail,omitempty"`
}

// writeState serializes s to path atomically (temp file + rename in the same directory).
func writeState(path string, s State) error {
	s.Schema = stateSchema
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshalling state: %w", err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating state directory: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("writing state: %w", err)
	}
	return os.Rename(tmp, path)
}

// ReadState reads and parses the init record the daemon consumes. A missing file is returned
// as the underlying os error (check with os.IsNotExist) so the daemon can distinguish "init
// has not run yet" from a corrupt record.
func ReadState(path string) (State, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return State{}, err
	}
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return State{}, fmt.Errorf("parsing state %s: %w", path, err)
	}
	return s, nil
}
