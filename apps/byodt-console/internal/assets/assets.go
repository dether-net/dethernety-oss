// Package assets carries, in the binary, the deployment inputs the console places at
// deploy time — the noauth GraphQL schema (written when authentication is disabled) and
// the ingest corpus for each bundled data module — plus the built operator SPA the daemon
// serves.
//
// The embed/ tree is GITIGNORED and build-populated, not committed — the corpus is
// already committed once under oss/modules/, the schema is generated from schema.graphql,
// and the SPA is a build output — so committing a copy here would duplicate large assets
// and invite drift. It is produced by apps/byodt-console/build-assets.sh, which CI runs
// before any Go build. A build without that step fails to compile at the //go:embed lines
// below — the intended loud guard against a forgotten asset step. On a fresh clone, run:
//
//	go generate ./apps/byodt-console/...   # or: bash apps/byodt-console/build-assets.sh
package assets

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
)

//go:generate bash ../../build-assets.sh
//go:embed embed
var embedded embed.FS

// The SPA is embedded under its own pattern as well as the embed tree above, so that a build
// which populated the schema and corpus but skipped the SPA step still fails to compile here
// rather than serving a blank page at runtime.
//
//go:embed all:embed/console-ui
var consoleUI embed.FS

// NoauthSchema returns the generated schema-noauth.graphql.
func NoauthSchema() ([]byte, error) {
	return embedded.ReadFile("embed/schema-noauth.graphql")
}

// DataModules returns a filesystem rooted at the bundled data modules. Each top-level
// entry is a module directory containing data/*.cypher — the ingest corpus, walked in
// sorted order at deploy time.
func DataModules() (fs.FS, error) {
	return fs.Sub(embedded, "embed/data-modules")
}

// CorpusEmbeddingProfile returns the embedding profile the bundled MITRE vectors were embedded with: the
// mitre-frameworks manifest's embeddingProfile, which build-assets.sh embeds beside the data. A missing manifest or
// profile is an error, never "no check": the embed tree is build output, and a regression there must not switch the
// check off.
func CorpusEmbeddingProfile() (string, error) {
	return corpusProfileFrom(embedded.ReadFile("embed/data-modules/mitre-frameworks/manifest.json"))
}

// corpusProfileFrom reads the embeddingProfile from a manifest read: an error for a failed read, a manifest that is
// not JSON, or one without a profile.
func corpusProfileFrom(raw []byte, err error) (string, error) {
	if err != nil {
		return "", fmt.Errorf("the bundled MITRE data has no manifest: %w", err)
	}
	var manifest struct {
		EmbeddingProfile string `json:"embeddingProfile"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return "", fmt.Errorf("the bundled MITRE data's manifest is not JSON: %w", err)
	}
	if manifest.EmbeddingProfile == "" {
		return "", fmt.Errorf("the bundled MITRE data's manifest names no embeddingProfile")
	}
	return manifest.EmbeddingProfile, nil
}

// ConsoleUI returns a filesystem rooted at the built operator SPA — index.html at the root
// and the hashed bundle under assets/. The daemon serves index.html at / and the file server
// under /assets/.
func ConsoleUI() (fs.FS, error) {
	return fs.Sub(consoleUI, "embed/console-ui")
}
