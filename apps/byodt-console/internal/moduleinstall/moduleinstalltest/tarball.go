package moduleinstalltest

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/dether-net/dethernety-oss/pkg/payloaddigest"
)

// BuildModuleTarball builds a module tarball the install sequence accepts: manifest.json at the archive
// root, the payload under dethernety/<name>/, and a stamp whose recorded digest recomputes exactly over
// that payload. It returns the archive bytes, its sha256 asset digest and the payload digest — the three
// values a caller needs to drive an install without reaching into the sequence.
//
// It lives here rather than in one package's test file because three packages' tests now need the same
// archive, and the two copies that existed before this one had already drifted: one returned the payload
// digest and one did not, and their manifests differed. A fixture builder copied per package is a fixture
// builder that stops describing the same thing.
func BuildModuleTarball(t *testing.T, name, version string, files map[string]string) (tarball []byte, assetDigest, payloadDigest string) {
	t.Helper()
	tmp := t.TempDir()
	payloadDir := filepath.Join(tmp, "dethernety", name)
	for rel, content := range files {
		p := filepath.Join(payloadDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	digest, err := payloaddigest.Compute(payloadDir)
	if err != nil {
		t.Fatal(err)
	}
	stamp := fmt.Sprintf("{\n  \"name\": %q,\n  \"version\": %q,\n  \"builtFrom\": null,\n  \"payloadDigest\": %q\n}\n", name, version, digest)
	if err := os.WriteFile(filepath.Join(payloadDir, payloaddigest.StampFilename), []byte(stamp), 0o644); err != nil {
		t.Fatal(err)
	}
	// The manifest sits OUTSIDE the payload root, so it is not in the digest's input. Nothing under test
	// reads it; it is here because a real archive carries one and the layout assertion should see the
	// shape a real archive has.
	manifest := fmt.Sprintf(`{"name":%q,"version":%q}`, name, version)
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	tarball = TarGzDir(t, tmp)
	sum := sha256.Sum256(tarball)
	return tarball, "sha256:" + hex.EncodeToString(sum[:]), digest
}

// TarGzDir tars and gzips every regular file under root, with paths relative to it. Exported because
// several tests build a deliberately malformed archive — a missing payload root, an unexpected layout —
// and need the packing without the well-formed contents BuildModuleTarball supplies.
func TarGzDir(t *testing.T, root string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		content, _ := os.ReadFile(p)
		hdr := &tar.Header{Name: filepath.ToSlash(rel), Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err = tw.Write(content)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
