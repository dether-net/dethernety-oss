// Package extract unpacks a gzip-compressed tar archive under a fixed destination
// directory, enforcing the archive-extraction limits the trust boundary requires: the
// console fetches executable code over the network and places it where the platform
// will load it, so a malicious archive must not be able to write outside the target,
// smuggle a link, or exhaust the host.
//
// The limits, all enforced here:
//   - reject any entry whose path is absolute or escapes the destination with "..";
//   - reject symlink and hardlink entries outright (a link's meaning depends on where
//     it is unpacked, which is exactly what confinement is meant to remove);
//   - reject any entry type that is not a regular file or a directory;
//   - bound the entry count and the total decompressed size.
//
// Confinement is to the destination the caller passes. The module key that names that
// destination is validated separately by ValidateModuleKey; together they keep
// extraction inside <modules>/<validated-key>/.
package extract

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Limits bound what an archive may expand to. A zero field takes its default.
type Limits struct {
	MaxEntries   int   // maximum number of archive entries
	MaxTotalSize int64 // maximum total decompressed bytes across all files
}

// DefaultLimits are generous for the small code-module payloads this unpacks (the
// largest shipped module is well under a megabyte) while still refusing an archive that
// tries to expand to something absurd.
var DefaultLimits = Limits{
	MaxEntries:   20000,
	MaxTotalSize: 256 << 20, // 256 MiB
}

// moduleKeyPattern is the module-key charset: lowercase alphanumeric and hyphen, not
// starting with a hyphen, at most 39 characters.
var moduleKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,38}$`)

// ValidateModuleKey reports whether key is a safe directory name for a module — the
// name that becomes the confined extraction destination.
func ValidateModuleKey(key string) error {
	if !moduleKeyPattern.MatchString(key) {
		return fmt.Errorf("invalid module key %q: must match %s", key, moduleKeyPattern.String())
	}
	return nil
}

// TarGz extracts the gzip-compressed tar stream r into dest, enforcing lim. dest is
// created if absent. Every file and directory lands under dest; nothing else is
// touched.
func TarGz(r io.Reader, dest string, lim Limits) error {
	if lim.MaxEntries <= 0 {
		lim.MaxEntries = DefaultLimits.MaxEntries
	}
	if lim.MaxTotalSize <= 0 {
		lim.MaxTotalSize = DefaultLimits.MaxTotalSize
	}

	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destAbs, 0o755); err != nil {
		return err
	}

	tr := tar.NewReader(gz)
	var total int64
	var count int
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("tar: %w", err)
		}

		count++
		if count > lim.MaxEntries {
			return fmt.Errorf("archive exceeds max entries (%d)", lim.MaxEntries)
		}

		switch hdr.Typeflag {
		case tar.TypeDir, tar.TypeReg:
			// handled below
		case tar.TypeSymlink:
			return fmt.Errorf("archive contains a symlink entry (%q): refused", hdr.Name)
		case tar.TypeLink:
			return fmt.Errorf("archive contains a hardlink entry (%q): refused", hdr.Name)
		default:
			return fmt.Errorf("archive contains an unsupported entry type %d (%q): refused", hdr.Typeflag, hdr.Name)
		}

		target, err := safeTarget(destAbs, hdr.Name)
		if err != nil {
			return err
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			written, err := writeRegular(tr, target, lim.MaxTotalSize-total)
			if err != nil {
				return err
			}
			total += written
		}
	}
	return nil
}

// safeTarget resolves a tar entry name to an absolute path under destAbs, rejecting
// absolute paths and any "../" escape. The prefix check is the actual guarantee; the
// explicit absolute-path and "../"-component checks fail with a precise message before
// it, so a refusal names the reason.
func safeTarget(destAbs, name string) (string, error) {
	if name == "" {
		return "", errors.New("archive entry with empty name: refused")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("archive entry name contains NUL (%q): refused", name)
	}
	if strings.Contains(name, `\`) {
		return "", fmt.Errorf("archive entry name contains a backslash (%q): refused", name)
	}
	if path.IsAbs(name) {
		return "", fmt.Errorf("archive contains an absolute path (%q): refused", name)
	}
	if slices.Contains(strings.Split(name, "/"), "..") {
		return "", fmt.Errorf("archive entry escapes with '..' (%q): refused", name)
	}

	target := filepath.Join(destAbs, filepath.FromSlash(name))
	if target != destAbs && !strings.HasPrefix(target, destAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("archive entry escapes destination (%q): refused", name)
	}
	return target, nil
}

// writeRegular copies one file, refusing to write more than remaining bytes so the
// running total cap cannot be exceeded. The size is measured from the bytes actually
// read, never trusted from the header.
func writeRegular(r io.Reader, target string, remaining int64) (int64, error) {
	if remaining <= 0 {
		return 0, errors.New("archive exceeds max total size: refused")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	// Read one byte past the budget so a file exactly at the cap is allowed but one
	// over is caught.
	written, copyErr := io.Copy(f, io.LimitReader(r, remaining+1))
	closeErr := f.Close()
	if copyErr != nil {
		return 0, copyErr
	}
	if closeErr != nil {
		return 0, closeErr
	}
	if written > remaining {
		return 0, errors.New("archive exceeds max total size: refused")
	}
	return written, nil
}
