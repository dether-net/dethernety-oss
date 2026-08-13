package payloaddigest

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// goldenDigest is a genuine cross-language vector: it was produced by the reference
// implementation (oss/scripts/module-payload.mjs computePayloadDigest) over exactly the
// tree goldenFixture writes. If a change here or in Compute makes the two disagree, one
// of them has drifted from the shared contract. To re-derive after editing the fixture,
// run computePayloadDigest from that reference over the same tree and paste the result.
//
// The fixture pins the two encoding choices a single-language suite cannot see:
//
//   - Sort order: the two exotic FILENAMES lock it. U+E000 (private-use, UTF-8 first byte
//     0xEE) must sort BEFORE U+10437 (astral, UTF-8 first byte 0xF0). A port that sorted
//     by UTF-16 code unit would reverse them (the astral char's leading surrogate 0xD801
//     is below 0xE000) and produce a different digest. Neither codepoint has a Unicode
//     decomposition, so no filesystem normalises them and the on-disk bytes match across
//     macOS and Linux.
//   - Length prefix: accented.txt's CONTENT is 6 UTF-8 bytes but 5 runes, so the decimal
//     length prefix is "6" only if Compute frames by BYTE length. A port that used a rune
//     count would frame "5" and diverge from this vector.
var goldenFixture = []struct {
	rel     string
	content string
}{
	{"AModule.js", "export const a = 1;\n"},
	{".hidden", "dot\n"},
	{"frontend/bundle.js", "console.log('x');\n"},
	{"data/nested/deep.txt", ""}, // empty file -> decimal length "0"
	{".js", "pua\n"},
	{"\U00010437.js", "astral\n"},
	{"z.txt", "zzz"},                                  // no trailing newline
	{"accented.txt", "café\n"},                        // 6 bytes, 5 runes -> byte length "6"
	{StampFilename, "{\n  \"name\": \"golden\"\n}\n"}, // excluded from the digest
}

const goldenDigest = "sha256:b425f0991a1cddbf093bae04cd0a177642c118e035ef8b06e26d162cf22ba8ce"

func writeGolden(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, f := range goldenFixture {
		abs := filepath.Join(root, filepath.FromSlash(f.rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(f.content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestComputeGoldenVector(t *testing.T) {
	root := writeGolden(t)
	got, err := Compute(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != goldenDigest {
		t.Fatalf("digest mismatch with JS reference:\n got  %s\n want %s", got, goldenDigest)
	}
}

func TestStampContentExcluded(t *testing.T) {
	root := writeGolden(t)
	// Rewrite the stamp with entirely different content; the digest must not move,
	// because the console recomputes over a tree that contains the stamp.
	stamp := filepath.Join(root, StampFilename)
	if err := os.WriteFile(stamp, []byte("{\"name\":\"different\",\"payloadDigest\":\"sha256:0\"}"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Compute(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != goldenDigest {
		t.Fatalf("stamp content changed the digest: got %s want %s", got, goldenDigest)
	}
}

func TestContentChangeFlipsDigest(t *testing.T) {
	root := writeGolden(t)
	if err := os.WriteFile(filepath.Join(root, "z.txt"), []byte("ZZZ"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Compute(root)
	if err != nil {
		t.Fatal(err)
	}
	if got == goldenDigest {
		t.Fatal("a one-byte content change left the digest unchanged")
	}
}

func TestRenameFlipsDigest(t *testing.T) {
	// Same bytes, different path -> different digest, because the path is framed into
	// the hash. This is the property that makes a moved-but-identical file a change.
	root := writeGolden(t)
	if err := os.Rename(filepath.Join(root, "z.txt"), filepath.Join(root, "zz.txt")); err != nil {
		t.Fatal(err)
	}
	got, err := Compute(root)
	if err != nil {
		t.Fatal(err)
	}
	if got == goldenDigest {
		t.Fatal("renaming a file with identical bytes left the digest unchanged")
	}
}

func TestNonRegularEntryRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation is privileged on Windows")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "real.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("real.js", filepath.Join(root, "link.js")); err != nil {
		t.Fatal(err)
	}
	if _, err := Compute(root); err == nil {
		t.Fatal("expected refusal to hash a symlink entry, got nil error")
	}
}

func TestReadStamp(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, StampFilename)
	if err := os.WriteFile(path, []byte(`{"name":"m","version":"1.2.3","builtFrom":"`+
		"abc123"+`","payloadDigest":"sha256:deadbeef"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := ReadStamp(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "m" || s.Version != "1.2.3" || s.PayloadDigest != "sha256:deadbeef" {
		t.Fatalf("unexpected stamp: %+v", s)
	}
	if s.BuiltFrom == nil || *s.BuiltFrom != "abc123" {
		t.Fatalf("builtFrom not parsed: %+v", s.BuiltFrom)
	}

	// builtFrom: null must parse to a nil pointer, not the string "null".
	nullPath := filepath.Join(root, "null-"+StampFilename)
	if err := os.WriteFile(nullPath, []byte(`{"name":"m","version":"1.0.0","builtFrom":null,"payloadDigest":"sha256:0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	s2, err := ReadStamp(nullPath)
	if err != nil {
		t.Fatal(err)
	}
	if s2.BuiltFrom != nil {
		t.Fatalf("builtFrom null should be nil, got %q", *s2.BuiltFrom)
	}

	if _, err := ReadStamp(filepath.Join(root, "does-not-exist.json")); !os.IsNotExist(err) {
		t.Fatalf("expected os.ErrNotExist for a missing stamp, got %v", err)
	}

	// Malformed JSON must be a non-nil error and a nil stamp, distinct from a missing file
	// — ReadStamp parses a module's self-declared identity at a trust boundary.
	badPath := filepath.Join(root, "bad-"+StampFilename)
	if err := os.WriteFile(badPath, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if s, err := ReadStamp(badPath); err == nil || s != nil {
		t.Fatalf("malformed stamp must fail: stamp=%+v err=%v", s, err)
	} else if os.IsNotExist(err) {
		t.Fatalf("a parse error must not look like a missing file: %v", err)
	}
}
