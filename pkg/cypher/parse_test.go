package cypher

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// wantSynthetic is the split the reference implementation
// (oss/scripts/module-manager/database.ts parseStatements) produces over
// testdata/synthetic.cypher. If testdata/synthetic.cypher is edited, re-derive this
// with that reference and update it here — the two must agree.
var wantSynthetic = []string{
	"CREATE (a:N {name: 'has ; semicolon'})",
	`MATCH (n) WHERE n.s = "double ; quote" SET n.x = 1`,
	`CREATE (b {q: 'escaped \' quote ; here'})`,
	`MERGE (c {p: "esc \" dq ; x"})`,
}

func TestParseStatementsGolden(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "synthetic.cypher"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseStatements(string(data))
	if err != nil {
		t.Fatalf("golden corpus must parse cleanly: %v", err)
	}
	if len(got) != len(wantSynthetic) {
		t.Fatalf("count: got %d want %d\ngot: %#v", len(got), len(wantSynthetic), got)
	}
	for i := range got {
		if got[i] != wantSynthetic[i] {
			t.Errorf("statement %d:\n got  %q\n want %q", i, got[i], wantSynthetic[i])
		}
	}
}

func TestParseStatementsEdgeCases(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    []string
		wantErr bool
	}{
		{name: "empty", in: "", want: nil},
		{name: "only whitespace and semicolons", in: "  ;\n;\t;", want: nil},
		{name: "no trailing semicolon", in: "RETURN 1", want: []string{"RETURN 1"}},
		{name: "semicolon in single quotes", in: "CREATE ({s:'a;b'})", want: []string{"CREATE ({s:'a;b'})"}},
		{name: "semicolon in double quotes", in: `CREATE ({s:"a;b"})`, want: []string{`CREATE ({s:"a;b"})`}},
		{name: "line comment eats to newline", in: "A // c ; c\nB;", want: []string{"A \nB"}},
		{name: "block comment dropped", in: "A /* ; ; */ B;", want: []string{"A  B"}},
		{name: "escaped closing quote keeps string open", in: `X ({s:'a\'b;c'}) ;`, want: []string{`X ({s:'a\'b;c'})`}},
		// An escaped backslash is two carried bytes, so the quote that follows really
		// closes the string and the next ';' splits — the branch most fragile to a
		// reordering of the escape vs close-quote checks.
		{name: "escaped backslash then real closing quote", in: `SET p = "C:\\"; CREATE (x);`, want: []string{`SET p = "C:\\"`, "CREATE (x)"}},
		// Documents the shared backtick limitation: identifiers in backticks are not lexed,
		// so a ';' inside one splits. If backtick handling is ever added (here AND in the
		// reference), this expectation must change with it.
		{name: "backtick identifier is not lexed", in: "MATCH (n:`a;b`) RETURN n", want: []string{"MATCH (n:`a", "b`) RETURN n"}},
		// An unterminated string or block comment is a hard error rather than a silent drop.
		{name: "unterminated string", in: "MATCH (n) WHERE n.x = 'oops", wantErr: true},
		{name: "unterminated block comment", in: "CREATE (a); /* unfinished", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseStatements(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got statements %#v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("count: got %d want %d (%#v)", len(got), len(tc.want), got)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("stmt %d: got %q want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestParseRealCorpus is a resilience smoke test against a real committed corpus file:
// no golden hash (the corpus is regenerated from upstream MITRE data), only structural
// invariants that must hold for any well-formed export.
func TestParseRealCorpus(t *testing.T) {
	path := filepath.Join("..", "..", "modules", "mitre-frameworks", "data", "02-defend-nodes.cypher")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("corpus file not present (%v)", err)
	}
	stmts, err := ParseStatements(string(data))
	if err != nil {
		t.Fatalf("real corpus must parse cleanly: %v", err)
	}
	if len(stmts) < 1000 {
		t.Fatalf("expected a substantial statement count, got %d", len(stmts))
	}
	for i, s := range stmts {
		if s == "" || s != strings.TrimSpace(s) {
			t.Fatalf("statement %d is empty or not trimmed: %q", i, s)
		}
	}
}
