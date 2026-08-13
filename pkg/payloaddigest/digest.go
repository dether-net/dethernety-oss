// Package payloaddigest re-derives the identity a packaged module carries in its
// installed tree, so a deploy-time tool can answer "is what is on disk the same
// payload this archive would place" from the installed directory alone.
//
// It is a byte-for-byte reimplementation of the reference in
// oss/scripts/module-payload.mjs (computePayloadDigest). Two encoding choices are
// invisible to a single-language test suite and are the only ways a reimplementation
// silently diverges — they are pinned here exactly as the reference pins them:
//
//   - the sort is over UTF-8 BYTES, not UTF-16 code units. Go string comparison is
//     already byte-wise, so sort.Strings reproduces it; the reference reaches the same
//     order via Buffer.compare.
//   - each record is length-prefixed with the DECIMAL byte count rendered as ASCII
//     text (not a fixed-width binary integer), so the framing is prefix-free.
//
// The digest deliberately does not cover empty directories, file modes, or Unicode
// normalisation — see the reference header for why each is acceptable.
package payloaddigest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
)

// StampFilename is written into the payload root so an installed module carries its
// own identity. It is invisible to the module loader (which keeps only directories at
// the modules root and only *Module.js inside one) and is excluded from the digest by
// default — the reference recomputes over a tree that contains it, so it must not be
// hashed or the packager's value and a recompute would disagree.
const StampFilename = ".dethernety-module.json"

// Compute returns sha256:<64 lowercase hex> over the regular files under payloadDir.
//
// StampFilename is excluded. A non-regular entry (symlink, socket, device) is refused
// rather than hashed, because its meaning depends on where it is unpacked.
func Compute(payloadDir string) (string, error) {
	files, err := walkFiles(payloadDir, payloadDir, nil)
	if err != nil {
		return "", err
	}

	kept := files[:0]
	for _, rel := range files {
		if rel != StampFilename {
			kept = append(kept, rel)
		}
	}

	// UTF-8 byte order. Go compares strings byte-wise, so this is the reference's
	// Buffer.compare order; sort.Strings is correct precisely because Go strings are
	// byte sequences, not UTF-16.
	sort.Strings(kept)

	h := sha256.New()
	for _, rel := range kept {
		data, err := os.ReadFile(filepath.Join(payloadDir, filepath.FromSlash(rel)))
		if err != nil {
			return "", err
		}
		// rel · NUL · decimal-ASCII length · NUL · bytes. strconv.Itoa is the exact
		// analog of the reference's String(bytes.length): decimal digits as ASCII, not
		// a fixed-width binary integer.
		h.Write([]byte(rel))
		h.Write([]byte{0})
		h.Write([]byte(strconv.Itoa(len(data))))
		h.Write([]byte{0})
		h.Write(data)
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

// walkFiles returns every regular file under dir as a POSIX-relative path against base.
// Directories recurse; anything that is neither a directory nor a regular file is an
// error, matching the reference's refusal to digest a non-regular entry.
func walkFiles(dir, base string, out []string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		abs := filepath.Join(dir, entry.Name())
		switch {
		case entry.IsDir():
			out, err = walkFiles(abs, base, out)
			if err != nil {
				return nil, err
			}
		case entry.Type().IsRegular():
			rel, err := filepath.Rel(base, abs)
			if err != nil {
				return nil, err
			}
			out = append(out, filepath.ToSlash(rel))
		default:
			return nil, fmt.Errorf("payload digest: refusing to hash non-regular entry %s", abs)
		}
	}
	return out, nil
}

// Stamp is the identity written into a packaged module's payload root
// (StampFilename). builtFrom is null when provenance cannot be established, so it is a
// pointer here — an absent value and the string "null" must not collide.
type Stamp struct {
	Name          string  `json:"name"`
	Version       string  `json:"version"`
	BuiltFrom     *string `json:"builtFrom"`
	PayloadDigest string  `json:"payloadDigest"`
}

// ReadStamp parses the stamp file at path. A missing file is reported as os.ErrNotExist
// (via os.ReadFile), which callers distinguish from a malformed one.
func ReadStamp(path string) (*Stamp, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s Stamp
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("payload stamp %s: %w", path, err)
	}
	return &s, nil
}
