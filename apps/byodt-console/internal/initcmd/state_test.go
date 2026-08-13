package initcmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), stateFileName)
	s := State{
		Tag:   "v1.2.3",
		RanAt: "2026-01-01T00:00:00Z",
		Modules: ModulesState{
			Status:   statusOK,
			Expected: []ModuleOutcome{{Name: "dethernety-general", Version: "1.0.0", PayloadDigest: "sha256:abc", Outcome: outcomePlaced}},
		},
		Ingest: IngestState{Status: statusOK, ContentHash: "sha256:def", Statements: 26262, ElapsedMs: 47000},
	}
	if err := writeState(path, s); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var back State
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.Schema != stateSchema {
		t.Fatalf("schema field not set on write: %q", back.Schema)
	}
	if back.Tag != "v1.2.3" || back.Modules.Status != statusOK || len(back.Modules.Expected) != 1 {
		t.Fatalf("round-trip mismatch: %+v", back)
	}
	if back.Modules.Expected[0].Name != "dethernety-general" || back.Ingest.Statements != 26262 {
		t.Fatalf("round-trip field mismatch: %+v", back)
	}
}
