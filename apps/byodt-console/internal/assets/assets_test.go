package assets

import (
	"errors"
	"io/fs"
	"strings"
	"testing"
)

func TestCorpusProfileFromFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		err  error
		want string // a profile, or "error: <substring>"
	}{
		{"a manifest naming a profile", `{"name":"mitre-frameworks","embeddingProfile":"p1"}`, nil, "p1"},
		{"no manifest", "", fs.ErrNotExist, "error: has no manifest"},
		{"a manifest that is not JSON", "{", nil, "error: is not JSON"},
		{"a manifest without a profile", `{"name":"mitre-frameworks"}`, nil, "error: names no embeddingProfile"},
		{"an empty profile", `{"embeddingProfile":""}`, nil, "error: names no embeddingProfile"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := corpusProfileFrom([]byte(tc.raw), tc.err)
			if want, isErr := strings.CutPrefix(tc.want, "error: "); isErr {
				if err == nil || !strings.Contains(err.Error(), want) || got != "" {
					t.Fatalf("want an error containing %q and no profile, got %q, %v", want, got, err)
				}
				if tc.err != nil && !errors.Is(err, tc.err) {
					t.Fatalf("the read error is not kept: %v", err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("want %q, got %q, %v", tc.want, got, err)
			}
		})
	}
}

func TestTheBundledCorpusNamesAProfile(t *testing.T) {
	if p, err := CorpusEmbeddingProfile(); err != nil || p == "" {
		t.Fatalf("the embedded MITRE manifest must name a profile: %q, %v", p, err)
	}
}
