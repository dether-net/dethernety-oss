package initcmd

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
)

// recordingOpener records each statement and the session it ran in, and fails the statements
// its fail function names — at Run, or at Consume when consumeFail is set.
type recordingOpener struct {
	ran         []string
	sessions    int
	fail        func(stmt string) error
	consumeFail bool
}

func (o *recordingOpener) OpenWrite(ctx context.Context) writeSession {
	o.sessions++
	return &recordingSession{o: o}
}

type recordingSession struct{ o *recordingOpener }

func (s *recordingSession) Run(ctx context.Context, cypher string, params map[string]any) (boltResult, error) {
	s.o.ran = append(s.o.ran, cypher)
	var err error
	if s.o.fail != nil {
		err = s.o.fail(cypher)
	}
	if err != nil && !s.o.consumeFail {
		return nil, err
	}
	return errResult{err}, nil
}

func (s *recordingSession) Close(ctx context.Context) error { return nil }

type errResult struct{ err error }

func (r errResult) Consume(ctx context.Context) error { return r.err }

func TestCorpusNodeKeysCoverEveryKeyedLookupInTheEmbeddedCorpus(t *testing.T) {
	c, err := loadCorpus()
	if err != nil {
		t.Fatalf("loading corpus: %v", err)
	}
	keys := corpusNodeKeys(c)
	have := map[nodeKey]bool{}
	for _, k := range keys {
		have[k] = true
	}
	for _, want := range []nodeKey{
		{"MitreAttackTechnique", "attack_id"},
		{"MitreAttackSoftware", "attack_id"},
		{"MitreDefendDigitalEventEntity", "uri"},
		{"MitreAtlasCaseStudy", "atlas_id"},
	} {
		if !have[want] {
			t.Errorf("missing key %v in %d keys", want, len(keys))
		}
	}
	// Every labelled node pattern with a property map must be one the key pattern reads: a
	// lookup written another way would get no index and scan its label.
	anyLookup := regexp.MustCompile(`\(\w+:\w+\s*\{`)
	for _, f := range c.files {
		text := string(f.content)
		if a, k := len(anyLookup.FindAllString(text, -1)), len(corpusNodeKey.FindAllString(text, -1)); a != k {
			t.Errorf("%s: %d labelled lookups, %d read as keys", f.path, a, k)
		}
	}
	// Every key is a plain identifier, so every index statement builds.
	for _, k := range keys {
		for _, engine := range []string{"memgraph", "neo4j"} {
			if _, err := indexStatement(engine, k); err != nil {
				t.Errorf("%s %v: %v", engine, k, err)
			}
		}
	}
}

func TestCorpusNodeKeysAreUniqueAndSorted(t *testing.T) {
	c := corpus{files: []corpusFile{
		{path: "a.cypher", content: []byte("MERGE (n:B {id: 1}); MATCH (m:A {key: 'x'}), (o:B {id: 2})")},
		{path: "b.cypher", content: []byte("MERGE (n:A {key: 'y'})")},
	}}
	got := corpusNodeKeys(c)
	want := []nodeKey{{"A", "key"}, {"B", "id"}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestIndexStatementPerEngine(t *testing.T) {
	k := nodeKey{"MitreAttackTechnique", "attack_id"}
	if got, _ := indexStatement("memgraph", k); got != "CREATE INDEX ON :MitreAttackTechnique(attack_id)" {
		t.Errorf("memgraph: %q", got)
	}
	want := "CREATE INDEX dt_idx__MitreAttackTechnique__attack_id IF NOT EXISTS FOR (n:MitreAttackTechnique) ON (n.attack_id)"
	if got, _ := indexStatement("neo4j", k); got != want {
		t.Errorf("neo4j: %q", got)
	}
	for _, bad := range []nodeKey{{"A)-[r]-(", "id"}, {"A", "id)"}, {"_A", "id"}, {"A", "a__b"}} {
		if _, err := indexStatement("neo4j", bad); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
	if _, err := indexStatement("other", k); err == nil {
		t.Error("an unknown engine was accepted")
	}
}

func TestEngineFromComponent(t *testing.T) {
	for name, want := range map[string]string{"Memgraph": "memgraph", "Neo4j Kernel": "neo4j"} {
		if got, err := engineFromComponent(name); err != nil || got != want {
			t.Errorf("%q: %q, %v", name, got, err)
		}
	}
	if _, err := engineFromComponent("SomeGraph"); err == nil {
		t.Error("an unknown component was accepted")
	}
}

func TestEnsureCorpusIndexesOneSessionPerStatementAndNeverFatal(t *testing.T) {
	keys := []nodeKey{{"A", "id"}, {"B", "id"}, {"C", "id"}}
	o := &recordingOpener{fail: func(stmt string) error {
		switch {
		case strings.Contains(stmt, ":A("):
			return errors.New("Index already exists")
		case strings.Contains(stmt, ":B("):
			return errors.New("boom")
		}
		return nil
	}}
	failures := ensureCorpusIndexes(context.Background(), o, "memgraph", keys)
	if len(o.ran) != 3 || o.sessions != 3 {
		t.Fatalf("ran %d statements in %d sessions", len(o.ran), o.sessions)
	}
	if len(failures) != 1 || !strings.Contains(failures[0], "B(id): boom") {
		t.Fatalf("failures: %v", failures)
	}
}

func TestEnsureCorpusIndexesReportsExecutionPhaseFailures(t *testing.T) {
	o := &recordingOpener{consumeFail: true, fail: func(string) error { return errors.New("pull failed") }}
	failures := ensureCorpusIndexes(context.Background(), o, "neo4j", []nodeKey{{"A", "id"}})
	if len(failures) != 1 || !strings.Contains(failures[0], "pull failed") {
		t.Fatalf("failures: %v", failures)
	}
}

func TestOnNeo4jAlreadyExistsIsAFailure(t *testing.T) {
	// Neo4j statements carry IF NOT EXISTS, so an "already exists" error there is a real conflict.
	o := &recordingOpener{fail: func(string) error { return errors.New("an equivalent index already exists") }}
	if failures := ensureCorpusIndexes(context.Background(), o, "neo4j", []nodeKey{{"A", "id"}}); len(failures) != 1 {
		t.Fatalf("failures: %v", failures)
	}
}

func TestCorpusIndexNoteAndJoinDetail(t *testing.T) {
	if note := corpusIndexNote("memgraph", nil, nil, 3); note != "" {
		t.Errorf("clean run noted %q", note)
	}
	if note := corpusIndexNote("", errors.New("no rows"), nil, 3); !strings.Contains(note, "graph engine unknown") {
		t.Errorf("probe failure: %q", note)
	}
	if note := corpusIndexNote("neo4j", nil, []string{"A(id): x"}, 3); !strings.Contains(note, "1 of 3 neo4j key indexes") {
		t.Errorf("failures: %q", note)
	}
	if got := joinDetail("a", "", "b"); got != "a; b" {
		t.Errorf("joinDetail: %q", got)
	}
}
