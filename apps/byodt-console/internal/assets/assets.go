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

// ConsoleUI returns a filesystem rooted at the built operator SPA — index.html at the root
// and the hashed bundle under assets/. The daemon serves index.html at / and the file server
// under /assets/.
func ConsoleUI() (fs.FS, error) {
	return fs.Sub(consoleUI, "embed/console-ui")
}
