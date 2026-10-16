package cypher

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The console embeds the committed MITRE data files at build time and ingests them as they
// are, so the files on the branch are what an operator's database gets. These checks hold
// the two vector files to the module manifest's embeddingProfile: the profile every vector
// was embedded with and every node records as embeddingModel. A file from another model, a
// half regeneration or a truncated file fails here, before a release can carry it. The
// module's own scripts/check_embeddings_files.py applies the same rules when it packages.
//
// The row counts are pinned to the releases the module ships, as the module's corpus check
// pins its node counts: a release bump changes them on purpose.

const embeddingDimensions = 768

// legacyEmbeddingProfile is Ollama's embeddinggemma: its files carry no // Profile: line. Any
// other profile's files must carry exactly one, the line the embedder's profile path writes.
const legacyEmbeddingProfile = "embeddinggemma"

var embeddingRows = map[string]map[string]int{
	"05-mitre-embeddings.cypher": {"MitreAttackTechnique": 697, "MitreDefendTechnique": 271, "MitreAttackMitigation": 44},
	"09-atlas-embeddings.cypher": {"MitreAtlasTechnique": 208, "MitreAtlasMitigation": 40},
}

var (
	modelHeader   = regexp.MustCompile(`(?m)^// Model: (\S+)  Dimensions: (\d+)$`)
	profileHeader = regexp.MustCompile(`(?m)^// Profile: (\S+)  `)
	embeddingRow  = regexp.MustCompile(`(?m)^\s*\{ \w+: "[^"]+", embedding: \[([^\]]*)\] \},?$`)
	matchLabel    = regexp.MustCompile(`(?m)^MATCH \(n:(\w+) \{`)
	setModel      = regexp.MustCompile(`(?m)^\s*n\.embeddingModel = "([^"]*)"$`)
)

func mitreModuleDir() string {
	return filepath.Join("..", "..", "modules", "mitre-frameworks")
}

func TestEmbeddingsFilesMatchTheManifestProfile(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(mitreModuleDir(), "manifest.json"))
	if err != nil {
		t.Fatalf("the mitre-frameworks manifest must be present: %v", err)
	}
	var manifest struct {
		EmbeddingProfile string `json:"embeddingProfile"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil || manifest.EmbeddingProfile == "" {
		t.Fatalf("manifest.json must name an embeddingProfile (err %v)", err)
	}
	for file, want := range embeddingRows {
		t.Run(file, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(mitreModuleDir(), "data", file))
			if err != nil {
				t.Fatalf("the vector file must be present: %v", err)
			}
			for _, problem := range embeddingsFileProblems(string(data), manifest.EmbeddingProfile, want) {
				t.Error(problem)
			}
		})
	}
}

// embeddingsFileProblems lists every way content disagrees with profile and the pinned rows.
func embeddingsFileProblems(content, profile string, want map[string]int) []string {
	var problems []string
	header := modelHeader.FindStringSubmatch(content)
	if header == nil || header[1] != profile || header[2] != strconv.Itoa(embeddingDimensions) {
		problems = append(problems, fmt.Sprintf("the Model header is %q, want profile %q with %d dimensions", header, profile, embeddingDimensions))
	}
	profileLines := profileHeader.FindAllStringSubmatch(content, -1)
	for _, m := range profileLines {
		if m[1] != profile {
			problems = append(problems, fmt.Sprintf("the Profile header names %q, want %q", m[1], profile))
		}
	}
	wantProfileLines := 1
	if profile == legacyEmbeddingProfile {
		wantProfileLines = 0
	}
	if len(profileLines) != wantProfileLines {
		problems = append(problems, fmt.Sprintf("%d Profile header lines, want %d", len(profileLines), wantProfileLines))
	}

	stmts, err := ParseStatements(content)
	if err != nil {
		return append(problems, fmt.Sprintf("the file does not parse: %v", err))
	}
	got := map[string]int{}
	for i, stmt := range stmts {
		label := matchLabel.FindStringSubmatch(stmt)
		models := setModel.FindAllStringSubmatch(stmt, -1)
		rows := embeddingRow.FindAllStringSubmatch(stmt, -1)
		if label == nil || len(models) != 1 || len(rows) == 0 {
			problems = append(problems, fmt.Sprintf("statement %d is not one UNWIND batch for one label that sets embeddingModel: %.120q", i, stmt))
			continue
		}
		if models[0][1] != profile {
			problems = append(problems, fmt.Sprintf("statement %d sets embeddingModel %q, want %q", i, models[0][1], profile))
		}
		got[label[1]] += len(rows)
		for r, row := range rows {
			if msg := vectorProblem(row[1]); msg != "" {
				problems = append(problems, fmt.Sprintf("statement %d, row %d: %s", i, r, msg))
				break
			}
		}
	}
	if !maps.Equal(got, want) {
		problems = append(problems, fmt.Sprintf("rows per label are %v, want %v", got, want))
	}
	return problems
}

// vectorProblem says what is wrong with one vector literal's numbers, or "" when it has
// embeddingDimensions finite numbers of unit length.
func vectorProblem(numbers string) string {
	parts := strings.Split(numbers, ",")
	if len(parts) != embeddingDimensions {
		return "a vector with " + strconv.Itoa(len(parts)) + " numbers, want " + strconv.Itoa(embeddingDimensions)
	}
	var sum float64
	for _, p := range parts {
		x, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil || math.IsNaN(x) || math.IsInf(x, 0) {
			return "a vector with a number that is not finite: " + strings.TrimSpace(p)
		}
		sum += x * x
	}
	if math.Abs(math.Sqrt(sum)-1) > 1e-3 {
		return "a vector that is not unit length (norm " + strconv.FormatFloat(math.Sqrt(sum), 'f', 4, 64) + ")"
	}
	return ""
}

// embeddingsFixture builds a small file in the exporter's shape: rows per label, every row
// a unit vector, every batch setting model.
func embeddingsFixture(headerModel, profileLine, model string, rows map[string]int, vector func(int) []float64) string {
	var b strings.Builder
	b.WriteString("// Generated by mitre-frameworks export_embeddings_to_cypher.py at 2026-10-15T00:00:00+00:00\n")
	fmt.Fprintf(&b, "// Model: %s  Dimensions: %d\n", headerModel, embeddingDimensions)
	if profileLine != "" {
		fmt.Fprintf(&b, "// Profile: %s  Weights: org/m@%s  dtype: fp32  Document prompt: title = name\n", profileLine, strings.Repeat("a", 40))
	}
	b.WriteString("// Source: mitre-frameworks build\n\n")
	seed := 0
	for _, label := range []string{"MitreAtlasTechnique", "MitreAtlasMitigation"} {
		b.WriteString("UNWIND [\n")
		for i := 0; i < rows[label]; i++ {
			seed++
			nums := make([]string, 0, embeddingDimensions)
			for _, x := range vector(seed) {
				nums = append(nums, strconv.FormatFloat(x, 'g', -1, 64))
			}
			sep := ","
			if i == rows[label]-1 {
				sep = ""
			}
			fmt.Fprintf(&b, "  { atlas_id: \"%s-%d\", embedding: [%s] }%s\n", label, i, strings.Join(nums, ", "), sep)
		}
		fmt.Fprintf(&b, "] AS row\nMATCH (n:%s {atlas_id: row.atlas_id})\nSET n.embedding = row.embedding,\n    n.embeddingModel = \"%s\";\n\n", label, model)
	}
	return b.String()
}

func unitVector(dims int) func(int) []float64 {
	return func(seed int) []float64 {
		v := make([]float64, dims)
		var sum float64
		for i := range v {
			v[i] = math.Sin(float64(seed)*7 + float64(i))
			sum += v[i] * v[i]
		}
		for i := range v {
			v[i] /= math.Sqrt(sum)
		}
		return v
	}
}

func TestEmbeddingsFileProblems(t *testing.T) {
	const eg1 = "embeddinggemma-300m-retrieval-v1"
	small := map[string]int{"MitreAtlasTechnique": 3, "MitreAtlasMitigation": 2}
	unit := unitVector(embeddingDimensions)
	double := func(seed int) []float64 {
		v := unit(seed)
		for i := range v {
			v[i] *= 2
		}
		return v
	}
	for _, tc := range []struct {
		name    string
		content string
		want    string // "" = no problems
	}{
		{"a matching file", embeddingsFixture(eg1, eg1, eg1, small, unit), ""},
		{"an onnx profile's file without its Profile line", embeddingsFixture(eg1, "", eg1, small, unit), "0 Profile header lines, want 1"},
		{"another model throughout", embeddingsFixture("embeddinggemma", "", "embeddinggemma", small, unit), "the Model header is"},
		{"a header naming another model", embeddingsFixture("embeddinggemma", eg1, eg1, small, unit), "the Model header is"},
		{"a Profile line naming another id", embeddingsFixture(eg1, "embeddinggemma-2-text-retrieval-v1", eg1, small, unit), "the Profile header names"},
		{"batches setting another model", embeddingsFixture(eg1, eg1, "embeddinggemma", small, unit), "sets embeddingModel \"embeddinggemma\""},
		{"a wrong row count", embeddingsFixture(eg1, eg1, eg1, map[string]int{"MitreAtlasTechnique": 3, "MitreAtlasMitigation": 1}, unit), "rows per label are"},
		{"a missing label", embeddingsFixture(eg1, eg1, eg1, map[string]int{"MitreAtlasTechnique": 3}, unit), "is not one UNWIND batch"},
		{"a short vector", embeddingsFixture(eg1, eg1, eg1, small, unitVector(embeddingDimensions-1)), "a vector with 767 numbers"},
		{"a vector that is not unit length", embeddingsFixture(eg1, eg1, eg1, small, double), "not unit length"},
		{"a truncated file", embeddingsFixture(eg1, eg1, eg1, small, unit) + "UNWIND [\n  { atlas_id: \"x", "does not parse"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			problems := embeddingsFileProblems(tc.content, eg1, small)
			if tc.want == "" {
				if len(problems) != 0 {
					t.Fatalf("want no problems, got %v", problems)
				}
				return
			}
			for _, p := range problems {
				if strings.Contains(p, tc.want) {
					return
				}
			}
			t.Fatalf("want a problem containing %q, got %v", tc.want, problems)
		})
	}
}

func TestEmbeddingsFileProblemsLegacyProfile(t *testing.T) {
	small := map[string]int{"MitreAtlasTechnique": 3, "MitreAtlasMitigation": 2}
	unit := unitVector(embeddingDimensions)
	if p := embeddingsFileProblems(embeddingsFixture(legacyEmbeddingProfile, "", legacyEmbeddingProfile, small, unit), legacyEmbeddingProfile, small); len(p) != 0 {
		t.Fatalf("a legacy file without a Profile line: want no problems, got %v", p)
	}
	p := embeddingsFileProblems(embeddingsFixture(legacyEmbeddingProfile, legacyEmbeddingProfile, legacyEmbeddingProfile, small, unit), legacyEmbeddingProfile, small)
	if len(p) != 1 || !strings.Contains(p[0], "1 Profile header lines, want 0") {
		t.Fatalf("a legacy file with a Profile line: want one Profile problem, got %v", p)
	}
}
