package initcmd

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// The corpus MERGEs and MATCHes every node by a key property. Without an index on that key,
// each statement scans its label, and the ingest grows with the square of the corpus. The
// platform creates a few of these indexes at its own start, but the console loads the corpus
// before the platform runs, so it creates an index for every key the corpus uses, first.
//
// Statements follow dt-module's DDL builders: the legacy form on Memgraph, a named
// IF NOT EXISTS form on Neo4j under the same name the platform gives the same index.

// alreadyExists is how Memgraph answers a CREATE INDEX for an index it has.
var alreadyExists = regexp.MustCompile(`(?i)already\s+exists`)

// corpusNodeKey matches `(n:Label {key: ` — the label and key a MERGE or MATCH looks a node up by.
var corpusNodeKey = regexp.MustCompile(`\(\w+:(\w+) \{(\w+): `)

// schemaIdentifier is dt-module's rule for a label or property interpolated into DDL.
var schemaIdentifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$`)

type nodeKey struct{ label, key string }

// corpusNodeKeys returns every (label, key) the corpus looks nodes up by, sorted.
func corpusNodeKeys(c corpus) []nodeKey {
	seen := map[nodeKey]bool{}
	for _, f := range c.files {
		for _, m := range corpusNodeKey.FindAllStringSubmatch(string(f.content), -1) {
			seen[nodeKey{m[1], m[2]}] = true
		}
	}
	keys := make([]nodeKey, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].label != keys[j].label {
			return keys[i].label < keys[j].label
		}
		return keys[i].key < keys[j].key
	})
	return keys
}

// indexStatement is the node-key index in the engine's dialect.
func indexStatement(engine string, k nodeKey) (string, error) {
	if !schemaIdentifier.MatchString(k.label) || !schemaIdentifier.MatchString(k.key) {
		return "", fmt.Errorf("not a plain identifier: %s.%s", k.label, k.key)
	}
	switch engine {
	case "memgraph":
		return fmt.Sprintf("CREATE INDEX ON :%s(%s)", k.label, k.key), nil
	case "neo4j":
		return fmt.Sprintf("CREATE INDEX dt_idx__%s__%s IF NOT EXISTS FOR (n:%s) ON (n.%s)", k.label, k.key, k.label, k.key), nil
	}
	return "", fmt.Errorf("unknown graph engine %q", engine)
}

// engineFromComponent reads the engine from a dbms.components() name; anything else is an error.
func engineFromComponent(name string) (string, error) {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "memgraph"):
		return "memgraph", nil
	case strings.Contains(lower, "neo4j"):
		return "neo4j", nil
	}
	return "", fmt.Errorf("unrecognised graph engine component %q", name)
}

// probeEngine asks the database which engine it is, in a read session of its own.
func probeEngine(ctx context.Context, driver neo4j.DriverWithContext, cfg Config) (string, error) {
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead, DatabaseName: cfg.Neo4jDatabase})
	defer session.Close(ctx)
	res, err := session.Run(ctx, "CALL dbms.components() YIELD name RETURN name", nil)
	if err != nil {
		return "", err
	}
	if !res.Next(ctx) {
		if err := res.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("dbms.components() returned no rows")
	}
	name, _ := res.Record().Get("name")
	s, _ := name.(string)
	return engineFromComponent(s)
}

// ensureCorpusIndexes creates the index for every key, each as one autocommit statement in its own
// session (Memgraph rejects schema changes inside a managed transaction, and one failure must not
// touch the next). An index Memgraph reports as existing is fine. A failed index only costs
// speed, so it never fails the ingest: the failures are returned for the state's detail.
func ensureCorpusIndexes(ctx context.Context, opener writeSessionOpener, engine string, keys []nodeKey) []string {
	var failures []string
	for _, k := range keys {
		err := runIndexStatement(ctx, opener, engine, k)
		if err != nil && !(engine == "memgraph" && alreadyExists.MatchString(err.Error())) {
			failures = append(failures, fmt.Sprintf("%s(%s): %v", k.label, k.key, err))
		}
	}
	return failures
}

func runIndexStatement(ctx context.Context, opener writeSessionOpener, engine string, k nodeKey) error {
	stmt, err := indexStatement(engine, k)
	if err != nil {
		return err
	}
	session := opener.OpenWrite(ctx)
	defer session.Close(ctx)
	res, err := session.Run(ctx, stmt, nil)
	if err != nil {
		return err
	}
	// Consume so an execution-phase failure is reported, not swallowed.
	return res.Consume(ctx)
}

// corpusIndexNote describes key indexes the ingest went without, for the state's detail; empty
// when every index is in place.
func corpusIndexNote(engine string, probeErr error, failures []string, total int) string {
	if probeErr != nil {
		return fmt.Sprintf("key indexes not created, graph engine unknown (the ingest runs without them): %v", probeErr)
	}
	if len(failures) > 0 {
		return fmt.Sprintf("%d of %d %s key indexes not created (the ingest runs without them): %s",
			len(failures), total, engine, strings.Join(failures, "; "))
	}
	return ""
}
