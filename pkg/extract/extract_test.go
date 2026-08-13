package extract

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type entry struct {
	name string
	typ  byte
	body string
	link string
}

func tgz(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		hdr := &tar.Header{Name: e.name, Typeflag: e.typ, Mode: 0o644}
		switch e.typ {
		case tar.TypeDir:
			hdr.Mode = 0o755
		case tar.TypeReg:
			hdr.Size = int64(len(e.body))
		}
		if e.link != "" {
			hdr.Linkname = e.link
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if e.typ == tar.TypeReg {
			if _, err := tw.Write([]byte(e.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestTarGzHappyPath(t *testing.T) {
	arc := tgz(t,
		entry{name: "manifest.json", typ: tar.TypeReg, body: "{}"},
		entry{name: "dethernety/", typ: tar.TypeDir},
		entry{name: "dethernety/mymod/", typ: tar.TypeDir},
		entry{name: "dethernety/mymod/MyModule.js", typ: tar.TypeReg, body: "export default {};\n"},
		entry{name: "dethernety/mymod/.dethernety-module.json", typ: tar.TypeReg, body: `{"name":"mymod"}`},
	)
	dest := t.TempDir()
	if err := TarGz(bytes.NewReader(arc), dest, Limits{}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "dethernety", "mymod", "MyModule.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "export default {};\n" {
		t.Fatalf("unexpected content: %q", got)
	}
	if _, err := os.Stat(filepath.Join(dest, "manifest.json")); err != nil {
		t.Fatalf("manifest.json not extracted: %v", err)
	}
}

func TestRejectTraversal(t *testing.T) {
	for _, name := range []string{"../evil.js", "dethernety/../../evil.js", "a/../../b"} {
		dest := t.TempDir()
		arc := tgz(t, entry{name: name, typ: tar.TypeReg, body: "pwn"})
		err := TarGz(bytes.NewReader(arc), dest, Limits{})
		if err == nil {
			t.Fatalf("%q: expected refusal, got nil", name)
		}
		if !strings.Contains(err.Error(), "..") && !strings.Contains(err.Error(), "escapes") {
			t.Fatalf("%q: unexpected error %v", name, err)
		}
		// Nothing may have been written to the parent of dest.
		if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "evil.js")); err == nil {
			t.Fatalf("%q: escape wrote a file outside dest", name)
		}
	}
}

func TestRejectAbsolutePath(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t, entry{name: "/etc/passwd", typ: tar.TypeReg, body: "x"})
	err := TarGz(bytes.NewReader(arc), dest, Limits{})
	if err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("expected absolute-path refusal, got %v", err)
	}
}

func TestRejectSymlink(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t, entry{name: "link", typ: tar.TypeSymlink, link: "/etc/passwd"})
	err := TarGz(bytes.NewReader(arc), dest, Limits{})
	if err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("expected symlink refusal, got %v", err)
	}
}

func TestRejectHardlink(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t, entry{name: "hard", typ: tar.TypeLink, link: "manifest.json"})
	err := TarGz(bytes.NewReader(arc), dest, Limits{})
	if err == nil || !strings.Contains(err.Error(), "hardlink") {
		t.Fatalf("expected hardlink refusal, got %v", err)
	}
}

func TestRejectUnsupportedType(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t, entry{name: "fifo", typ: tar.TypeFifo})
	err := TarGz(bytes.NewReader(arc), dest, Limits{})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported-type refusal, got %v", err)
	}
}

func TestMaxEntries(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t,
		entry{name: "a.txt", typ: tar.TypeReg, body: "1"},
		entry{name: "b.txt", typ: tar.TypeReg, body: "2"},
		entry{name: "c.txt", typ: tar.TypeReg, body: "3"},
	)
	err := TarGz(bytes.NewReader(arc), dest, Limits{MaxEntries: 2})
	if err == nil || !strings.Contains(err.Error(), "max entries") {
		t.Fatalf("expected max-entries refusal, got %v", err)
	}
}

func TestMaxTotalSize(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t, entry{name: "big.bin", typ: tar.TypeReg, body: strings.Repeat("x", 4096)})
	err := TarGz(bytes.NewReader(arc), dest, Limits{MaxTotalSize: 1024})
	if err == nil || !strings.Contains(err.Error(), "max total size") {
		t.Fatalf("expected max-total-size refusal, got %v", err)
	}
}

// TestMaxTotalSizeCumulative crosses the cap with several individually-sub-cap files, so
// it exercises the running-total budget (not just one oversized file). A regression that
// stopped decrementing the budget per file would pass TestMaxTotalSize but fail here.
func TestMaxTotalSizeCumulative(t *testing.T) {
	dest := t.TempDir()
	arc := tgz(t,
		entry{name: "a.bin", typ: tar.TypeReg, body: strings.Repeat("x", 400)},
		entry{name: "b.bin", typ: tar.TypeReg, body: strings.Repeat("x", 400)},
		entry{name: "c.bin", typ: tar.TypeReg, body: strings.Repeat("x", 400)},
	)
	err := TarGz(bytes.NewReader(arc), dest, Limits{MaxTotalSize: 1000})
	if err == nil || !strings.Contains(err.Error(), "max total size") {
		t.Fatalf("cumulative size should trip the cap, got %v", err)
	}
}

// TestSafeTargetBranches drives safeTarget directly (same package) so the empty-name,
// NUL, and backslash refusals — hard to route a real tar entry through, and untested via
// TarGz — are pinned, along with the positive case that a name merely containing ".." as
// a substring (but not as a path component) is allowed.
func TestSafeTargetBranches(t *testing.T) {
	dest := t.TempDir()
	for _, tc := range []struct {
		name string
		want string // substring the refusal must contain
	}{
		{"", "empty name"},
		{"a\x00b", "NUL"},
		{`a\b`, "backslash"},
		{"/etc/passwd", "absolute"},
		{"a/../../b", ".."},
	} {
		if _, err := safeTarget(dest, tc.name); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("safeTarget(%q): want error containing %q, got %v", tc.name, tc.want, err)
		}
	}

	// "..bar" contains ".." as a substring but not as a path component: it must be allowed
	// and resolve under dest — the boundary a naive strings.Contains check would get wrong.
	got, err := safeTarget(dest, "sub/..bar/file.txt")
	if err != nil {
		t.Fatalf("a name with '..' only as a substring must be allowed: %v", err)
	}
	if !strings.HasPrefix(got, dest+string(os.PathSeparator)) {
		t.Fatalf("resolved target %q is not under dest %q", got, dest)
	}
}

func TestValidateModuleKey(t *testing.T) {
	valid := []string{"a", "dethernety-general", "m0", "a" + strings.Repeat("b", 38)}
	for _, k := range valid {
		if err := ValidateModuleKey(k); err != nil {
			t.Errorf("expected %q valid: %v", k, err)
		}
	}
	invalid := []string{"", "-lead", "UpperCase", "has_underscore", "dot.name", "a" + strings.Repeat("b", 39), "../x", "a/b"}
	for _, k := range invalid {
		if err := ValidateModuleKey(k); err == nil {
			t.Errorf("expected %q invalid", k)
		}
	}
}
