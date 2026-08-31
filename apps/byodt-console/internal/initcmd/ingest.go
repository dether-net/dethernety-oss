package initcmd

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
	"github.com/dether-net/dethernety-oss/pkg/cypher"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// The idempotency marker: one node carrying the corpus content hash, so a re-run whose
// corpus is unchanged is a no-op. The marker is an optimisation, not the correctness
// control — every ingest statement is a MERGE, so re-running is a safe no-op — which is
// why any doubt about the marker resolves toward re-ingesting.
//
// That "safe no-op" holds only because no MERGE pattern carries a generated property. A
// relationship MERGE matches on the whole pattern, so an embedded property becomes part
// of the edge identity: the pack once emitted export wall-clock stamps inline, and a
// regenerated corpus therefore matched nothing and created a parallel edge for every
// relationship already ingested. The marker does not save you there — it keys on the
// corpus content hash, which changes precisely BECAUSE the stamps changed. The pack side
// is now guarded by mitre-frameworks' test:pack-idempotency.
const (
	markerLabel = "DethernetyIngestMarker"
	// Keyed by the producing binary, so another deployment type's console can ingest into
	// a related graph without colliding on the marker.
	markerID = "byodt-console"
)

type corpus struct {
	files []corpusFile
	hash  string
}

type corpusFile struct {
	path    string // e.g. mitre-frameworks/data/01-attack-nodes.cypher
	content []byte
}

// ingestCorpus loads the embedded data modules and ingests them if their combined content
// differs from the marker recorded in the graph. It returns the state the daemon reads and
// never aborts the deployment (step 4 exits 0).
func ingestCorpus(ctx context.Context, cfg Config) IngestState {
	c, err := loadCorpus()
	if err != nil {
		return IngestState{Status: statusFailed, Detail: fmt.Sprintf("loading corpus: %v", err)}
	}
	return ingestWithCorpus(ctx, cfg, c)
}

// ingestWithCorpus is the driver-bound core, separated so a test can pass a small corpus.
func ingestWithCorpus(ctx context.Context, cfg Config, c corpus) IngestState {
	if len(c.files) == 0 {
		// Distinct from statusSkipped (corpus unchanged): an empty embed is a build or
		// configuration event, not a benign no-op, and the daemon must tell them apart.
		return IngestState{Status: statusNoAssets, Detail: "no data modules bundled"}
	}

	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, boltAuth(cfg))
	if err != nil {
		return IngestState{Status: statusFailed, Detail: fmt.Sprintf("opening driver: %v", err)}
	}
	defer driver.Close(ctx)
	if err := driver.VerifyConnectivity(ctx); err != nil {
		return IngestState{Status: statusFailed, Detail: fmt.Sprintf("connecting to %s: %v", cfg.Neo4jURI, err)}
	}

	if existing, err := readMarker(ctx, driver, cfg); err == nil && existing == c.hash {
		return IngestState{Status: statusSkipped, ContentHash: c.hash, Detail: "corpus unchanged since last ingest"}
	}

	// runCorpus and writeMarker reach the driver through this seam so their failure paths are
	// unit-testable offline; readMarker stays on the concrete driver (integration-tested).
	opener := neoDriverOpener{driver: driver, database: cfg.Neo4jDatabase}

	start := time.Now()
	count, err := runCorpus(ctx, opener, c)
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		return IngestState{Status: statusFailed, ContentHash: c.hash, Statements: count, ElapsedMs: elapsed, Detail: classifyIngestErr(err)}
	}

	if err := writeMarker(ctx, opener, c.hash, count, elapsed); err != nil {
		// The data is in; only the marker write failed. Not fatal — a re-run re-ingests,
		// which is a MERGE no-op. Record it so the daemon can surface it.
		return IngestState{Status: statusOK, ContentHash: c.hash, Statements: count, ElapsedMs: elapsed, Detail: fmt.Sprintf("marker write failed (harmless): %v", err)}
	}
	return IngestState{Status: statusOK, ContentHash: c.hash, Statements: count, ElapsedMs: elapsed}
}

// writeSessionOpener opens Bolt write sessions — the seam runCorpus and writeMarker depend on
// instead of the concrete driver, so an offline test can inject a fake and exercise the
// execution-phase-failure path. The neo4j driver's own SessionWithContext/ResultWithContext
// interfaces carry unexported methods and cannot be faked from here; neoDriverOpener is the
// production adapter over them.
type writeSessionOpener interface {
	OpenWrite(ctx context.Context) writeSession
}

// writeSession runs statements on an autocommit write session. Consuming a result is what
// forces an execution-phase (PULL) error to surface — dropping it is the swallow bug.
type writeSession interface {
	Run(ctx context.Context, cypher string, params map[string]any) (boltResult, error)
	Close(ctx context.Context) error
}

type boltResult interface {
	Consume(ctx context.Context) error
}

type neoDriverOpener struct {
	driver   neo4j.DriverWithContext
	database string
}

func (o neoDriverOpener) OpenWrite(ctx context.Context) writeSession {
	return neoWriteSession{o.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite, DatabaseName: o.database})}
}

type neoWriteSession struct{ s neo4j.SessionWithContext }

func (w neoWriteSession) Run(ctx context.Context, cypher string, params map[string]any) (boltResult, error) {
	res, err := w.s.Run(ctx, cypher, params)
	if err != nil {
		return nil, err
	}
	return neoResult{res}, nil
}

func (w neoWriteSession) Close(ctx context.Context) error { return w.s.Close(ctx) }

type neoResult struct{ r neo4j.ResultWithContext }

func (n neoResult) Consume(ctx context.Context) error {
	_, err := n.r.Consume(ctx)
	return err
}

// runCorpus executes every statement of every file, mirroring the installer's house
// pattern: one session per file, one autocommit transaction per statement (session.Run,
// never a managed transaction — which would retry a memory-limit error rather than fail),
// fail-fast with the file and 1-based statement index.
func runCorpus(ctx context.Context, opener writeSessionOpener, c corpus) (int, error) {
	total := 0
	for _, f := range c.files {
		statements, err := cypher.ParseStatements(string(f.content))
		if err != nil {
			return total, fmt.Errorf("%s: %w", f.path, err)
		}
		session := opener.OpenWrite(ctx)
		for i, stmt := range statements {
			res, err := session.Run(ctx, stmt, nil)
			if err == nil {
				// session.Run only reports RUN-phase failures. Execution-phase errors —
				// including the memory-limit a MERGE can hit part-way — are delivered on the
				// result stream and never surface until it is consumed. Consume here so a
				// failed write fails the ingest with its statement index, rather than being
				// silently recorded as complete and locked in by the marker.
				err = res.Consume(ctx)
			}
			if err != nil {
				_ = session.Close(ctx)
				return total, fmt.Errorf("%s statement %d: %w", f.path, i+1, err)
			}
			total++
		}
		if err := session.Close(ctx); err != nil {
			return total, fmt.Errorf("%s: closing session: %w", f.path, err)
		}
	}
	return total, nil
}

func readMarker(ctx context.Context, driver neo4j.DriverWithContext, cfg Config) (string, error) {
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead, DatabaseName: cfg.Neo4jDatabase})
	defer session.Close(ctx)
	res, err := session.Run(ctx, fmt.Sprintf("MATCH (m:%s {id:$id}) RETURN m.contentHash AS h", markerLabel), map[string]any{"id": markerID})
	if err != nil {
		return "", err
	}
	if res.Next(ctx) {
		if h, ok := res.Record().Get("h"); ok {
			if s, ok := h.(string); ok {
				return s, nil
			}
		}
	}
	return "", res.Err()
}

func writeMarker(ctx context.Context, opener writeSessionOpener, hash string, statements int, elapsedMs int64) error {
	session := opener.OpenWrite(ctx)
	defer session.Close(ctx)
	res, err := session.Run(ctx,
		fmt.Sprintf("MERGE (m:%s {id:$id}) SET m.contentHash=$h, m.statements=$n, m.elapsedMs=$e, m.at=$at", markerLabel),
		map[string]any{"id": markerID, "h": hash, "n": statements, "e": elapsedMs, "at": time.Now().UTC().Format(time.RFC3339)},
	)
	if err != nil {
		return err
	}
	// Consume so an execution-phase failure of the marker write is reported, not swallowed.
	return res.Consume(ctx)
}

func boltAuth(cfg Config) neo4j.AuthToken {
	if cfg.Neo4jUsername != "" {
		return neo4j.BasicAuth(cfg.Neo4jUsername, cfg.Neo4jPassword, "")
	}
	return neo4j.NoAuth()
}

// classifyIngestErr turns a driver error into a diagnostic. A memory-limit error is
// called out specifically: Memgraph returns it classified as a retriable transient error,
// but under the autocommit pattern it is never retried, and it means the database needs a
// larger memory limit — not that the console should try again.
func classifyIngestErr(err error) string {
	if nErr, ok := errors.AsType[*neo4j.Neo4jError](err); ok {
		if strings.Contains(strings.ToLower(nErr.Msg), "memory limit") {
			return fmt.Sprintf("memory limit exceeded (%s) — the database needs a larger memory limit; this is terminal and was not retried: %v", nErr.Code, err)
		}
		return fmt.Sprintf("%s: %v", nErr.Code, err)
	}
	return err.Error()
}

// loadCorpus walks the embedded data modules and returns their .cypher files in sorted
// path order, with a content hash over the set.
func loadCorpus() (corpus, error) {
	root, err := assets.DataModules()
	if err != nil {
		return corpus{}, err
	}
	var files []corpusFile
	err = fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, ".cypher") {
			return nil
		}
		b, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		files = append(files, corpusFile{path: p, content: b})
		return nil
	})
	if err != nil {
		return corpus{}, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	return corpus{files: files, hash: hashCorpus(files)}, nil
}

// hashCorpus is a length-framed sha256 over the sorted files — same prefix-free framing
// idea as the payload digest, so no (path, contents) pair can collide with another.
func hashCorpus(files []corpusFile) string {
	h := sha256.New()
	for _, f := range files {
		h.Write([]byte(f.path))
		h.Write([]byte{0})
		h.Write([]byte(strconv.Itoa(len(f.content))))
		h.Write([]byte{0})
		h.Write(f.content)
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}
