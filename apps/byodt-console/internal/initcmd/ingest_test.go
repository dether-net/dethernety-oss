package initcmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

func TestClassifyIngestErrMemoryLimitIsTerminal(t *testing.T) {
	// Memgraph returns a memory-limit failure classified as a retriable transient error.
	// The classifier must name it as terminal, not as something to retry.
	err := fmt.Errorf("03-relationships.cypher statement 12: %w",
		&neo4j.Neo4jError{Code: "Memgraph.TransientError", Msg: "Memory limit exceeded! Failed to allocate..."})
	got := classifyIngestErr(err)
	if !strings.Contains(got, "memory limit exceeded") || !strings.Contains(got, "terminal") {
		t.Fatalf("memory-limit error not classified as terminal: %q", got)
	}

	other := &neo4j.Neo4jError{Code: "Neo.ClientError.Statement.SyntaxError", Msg: "bad cypher"}
	if got := classifyIngestErr(other); strings.Contains(got, "memory limit") {
		t.Fatalf("non-memory error misclassified: %q", got)
	}
}

func TestHashCorpusFramesPathAndContent(t *testing.T) {
	// A rename with identical bytes, and a content change, must both move the hash — the
	// framing is what makes that true.
	base := []corpusFile{{path: "m/data/01.cypher", content: []byte("MERGE (n);")}}
	renamed := []corpusFile{{path: "m/data/02.cypher", content: []byte("MERGE (n);")}}
	changed := []corpusFile{{path: "m/data/01.cypher", content: []byte("MERGE (m);")}}
	h0, h1, h2 := hashCorpus(base), hashCorpus(renamed), hashCorpus(changed)
	if h0 == h1 || h0 == h2 || h1 == h2 {
		t.Fatalf("hash collision: %s %s %s", h0, h1, h2)
	}
}

// fakeOpener drives runCorpus/writeMarker offline through the writeSessionOpener seam, so the
// failing-ingest path is exercised in -short CI without a live Bolt server. Its Run always
// succeeds (mirroring the real driver, where RUN-phase success says nothing about execution);
// the result's Consume fails on the configured 1-based statement, reproducing an
// execution-phase (PULL) failure — the case a dropped Consume would swallow. runErrAt instead
// fails at Run itself (the RUN-phase path).
type fakeOpener struct {
	consumeErrAt int // 1-based statement whose Consume fails; 0 = none
	runErrAt     int // 1-based statement whose Run fails; 0 = none
	msg          string
	closes       int // sessions closed, for sanity
}

func (o *fakeOpener) OpenWrite(ctx context.Context) writeSession { return &fakeSession{o: o} }

type fakeSession struct {
	o *fakeOpener
	n int // statements Run so far, this session
}

func (s *fakeSession) Run(ctx context.Context, cypher string, params map[string]any) (boltResult, error) {
	s.n++
	if s.o.runErrAt == s.n {
		return nil, errors.New(s.o.msg)
	}
	return fakeResult{fail: s.o.consumeErrAt == s.n, msg: s.o.msg}, nil
}

func (s *fakeSession) Close(ctx context.Context) error { s.o.closes++; return nil }

type fakeResult struct {
	fail bool
	msg  string
}

func (r fakeResult) Consume(ctx context.Context) error {
	if r.fail {
		return errors.New(r.msg)
	}
	return nil
}

// TestRunCorpusSurfacesFailures is the CI-visible guard for the swallow bug. The
// execution-phase case asserts a statement whose error arrives only on Consume is surfaced
// with its 1-based index: if runCorpus ever stops consuming the result, that error vanishes
// and this test fails.
func TestRunCorpusSurfacesFailures(t *testing.T) {
	ctx := context.Background()
	c := corpus{files: []corpusFile{{path: "m/data/01.cypher", content: []byte("CREATE (a);\nCREATE (b);")}}}

	// Execution-phase (PULL) failure on statement 2 — surfaces only via Consume.
	if n, err := runCorpus(ctx, &fakeOpener{consumeErrAt: 2, msg: "Memory limit exceeded"}, c); err == nil || !strings.Contains(err.Error(), "statement 2") {
		t.Fatalf("execution-phase failure must surface with its index, got count=%d err=%v", n, err)
	}
	// RUN-phase failure on statement 1.
	if _, err := runCorpus(ctx, &fakeOpener{runErrAt: 1, msg: "boom"}, c); err == nil || !strings.Contains(err.Error(), "statement 1") {
		t.Fatalf("RUN-phase failure must surface with its index, got %v", err)
	}
	// Clean path: every statement consumed, no error, count is the total.
	if n, err := runCorpus(ctx, &fakeOpener{}, c); err != nil || n != 2 {
		t.Fatalf("clean run: got count=%d err=%v, want 2, nil", n, err)
	}
}

// TestWriteMarkerSurfacesExecutionError mirrors the guard for the marker write, which also
// consumes its result so a failed marker write is reported rather than swallowed.
func TestWriteMarkerSurfacesExecutionError(t *testing.T) {
	err := writeMarker(context.Background(), &fakeOpener{consumeErrAt: 1, msg: "boom"}, "sha256:x", 1, 5)
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("writeMarker must surface an execution-phase error, got %v", err)
	}
}

// TestIngestAgainstMemgraph runs the real ingest + marker + idempotency against a live
// Bolt endpoint. It is skipped unless CONSOLE_TEST_BOLT_URI names one (e.g. a local
//
//	docker run --rm -p 7687:7687 memgraph/memgraph:3.8.1
//
// then CONSOLE_TEST_BOLT_URI=bolt://localhost:7687 go test -run Memgraph ./apps/byodt-console/...
func TestIngestAgainstMemgraph(t *testing.T) {
	uri := os.Getenv("CONSOLE_TEST_BOLT_URI")
	if uri == "" {
		t.Skip("set CONSOLE_TEST_BOLT_URI to run the Bolt ingest integration test")
	}
	ctx := context.Background()
	cfg := Config{
		Neo4jURI:      uri,
		Neo4jUsername: os.Getenv("CONSOLE_TEST_BOLT_USER"),
		Neo4jPassword: os.Getenv("CONSOLE_TEST_BOLT_PASS"),
	}

	// A small corpus with a unique label, so the test is self-contained and re-runnable.
	files := []corpusFile{{
		path:    "test/data/01-nodes.cypher",
		content: []byte("MERGE (n:ConsoleIngestTestNode {id: 1});\nMERGE (n:ConsoleIngestTestNode {id: 2});"),
	}}
	c := corpus{files: files, hash: hashCorpus(files)}

	// Clean any prior run.
	cleanup(ctx, t, cfg)
	t.Cleanup(func() { cleanup(ctx, t, cfg) })

	st := ingestWithCorpus(ctx, cfg, c)
	if st.Status != statusOK || st.Statements != 2 {
		t.Fatalf("first ingest: %+v", st)
	}
	if got := countTestNodes(ctx, t, cfg); got != 2 {
		t.Fatalf("expected 2 nodes, got %d", got)
	}

	// Re-run with the same corpus: the marker matches, so it is skipped.
	st2 := ingestWithCorpus(ctx, cfg, c)
	if st2.Status != statusSkipped {
		t.Fatalf("re-ingest should skip on unchanged corpus, got %+v", st2)
	}
	if got := countTestNodes(ctx, t, cfg); got != 2 {
		t.Fatalf("skip re-ran statements: %d nodes", got)
	}
}

// TestIngestExecutionErrorFailsAndSkipsMarker is the regression guard for the swallow bug:
// session.Run reports only RUN-phase failures, so an error raised while a statement executes
// (the phase a Memgraph memory-limit is raised in) reaches the caller only if the result is
// consumed. Before runCorpus consumed the stream, such a statement was silently counted as
// successful, the ingest was recorded ok, and the marker locked in a partial corpus.
//
// It uses a statement that PLANS cleanly (passes RUN) but divides by zero on one UNWIND row
// (fails during execution/PULL), so it exercises exactly the phase that was swallowed. The
// first statement succeeds; the second must fail with its 1-based index, the ingest status
// must be failed, and no marker may be written.
func TestIngestExecutionErrorFailsAndSkipsMarker(t *testing.T) {
	uri := os.Getenv("CONSOLE_TEST_BOLT_URI")
	if uri == "" {
		t.Skip("set CONSOLE_TEST_BOLT_URI to run the Bolt ingest integration test")
	}
	ctx := context.Background()
	cfg := Config{
		Neo4jURI:      uri,
		Neo4jUsername: os.Getenv("CONSOLE_TEST_BOLT_USER"),
		Neo4jPassword: os.Getenv("CONSOLE_TEST_BOLT_PASS"),
	}

	files := []corpusFile{{
		path: "test/data/01-nodes.cypher",
		content: []byte("MERGE (n:ConsoleIngestTestNode {id: 1});\n" +
			"UNWIND [1, 0] AS x CREATE (n:ConsoleIngestTestNode {id: 100 / x});"),
	}}
	c := corpus{files: files, hash: hashCorpus(files)}

	cleanup(ctx, t, cfg)
	t.Cleanup(func() { cleanup(ctx, t, cfg) })

	st := ingestWithCorpus(ctx, cfg, c)
	if st.Status != statusFailed {
		t.Fatalf("execution-phase failure must yield statusFailed, got %+v", st)
	}
	if !strings.Contains(st.Detail, "statement 2") {
		t.Fatalf("failure detail must name the 1-based failing statement, got %q", st.Detail)
	}
	if st.Statements != 1 {
		t.Fatalf("only the first statement should count as applied, got %d", st.Statements)
	}

	// The marker must not persist a corpus that did not fully ingest — otherwise a redeploy
	// would skip the fix.
	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, boltAuth(cfg))
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close(ctx)
	if h, _ := readMarker(ctx, driver, cfg); h == c.hash {
		t.Fatalf("marker was written despite a failed ingest (hash %s)", h)
	}
}

func cleanup(ctx context.Context, t *testing.T, cfg Config) {
	t.Helper()
	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, boltAuth(cfg))
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close(ctx)
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)
	for _, q := range []string{
		"MATCH (n:ConsoleIngestTestNode) DETACH DELETE n",
		fmt.Sprintf("MATCH (m:%s {id:$id}) DELETE m", markerLabel),
	} {
		if _, err := session.Run(ctx, q, map[string]any{"id": markerID}); err != nil {
			t.Fatalf("cleanup %q: %v", q, err)
		}
	}
}

func countTestNodes(ctx context.Context, t *testing.T, cfg Config) int64 {
	t.Helper()
	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, boltAuth(cfg))
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close(ctx)
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)
	res, err := session.Run(ctx, "MATCH (n:ConsoleIngestTestNode) RETURN count(n) AS c", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Next(ctx) {
		if c, ok := res.Record().Get("c"); ok {
			if n, ok := c.(int64); ok {
				return n
			}
		}
	}
	return -1
}
