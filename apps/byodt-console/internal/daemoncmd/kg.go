package daemoncmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// A knowledge-graph connection is the console's third kind of mount, and the one that carries the
// least. A content mount names a module and an immutable content pin; a code module is installed from
// the signed release channel and stamped. This one names nothing: the generic class it instantiates
// already ships inside the platform's module package, and the version it answers at is a property of
// the whole deployment rather than of the module — so the stub is fixed text and the pin lives in the
// mode layer, where the platform reads it.
//
// The console writes it on cloud activation when the recipe carries a knowledge-graph service, and
// removes it on disconnect, so the module's presence always means "a service is wired" and never
// outlives the connection that justified it.
//
// What the console decides here is only WHICH version to pin. It reads that from the service's public
// version listing with no credential — the same public-read path the content catalog uses — because a
// deployment must pin deliberately: taking whatever is newest at query time would advance the
// knowledge graph under a deployment that chose a version, which is not how a pin works.

// The stub the console writes. It is fixed text with NOTHING substituted into it — the class it
// extends takes only what every module is handed, because there is no per-module value to carry. That
// is why this is a constant and not a template: the string-literal escaping argument the content
// stub has to make does not arise when nothing is interpolated.
//
// It must be CommonJS (the platform loads modules with require()) and it must assign exports.default
// (require() returns module.exports directly, so module.exports = class would leave .default
// undefined and the load would fail).
const kgStub = `'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { DtRemoteKnowledgeGraphModule } = require('@dethernety/dt-module');
class KgModule extends DtRemoteKnowledgeGraphModule {
  constructor(driver, logger) { super(driver, logger); }
}
exports.default = KgModule;
`

const (
	// The directory the mount occupies, under the modules mount. It is also the module's identity to
	// the platform, and it is RESERVED: the content mount handlers refuse it as a module key, so the
	// two kinds can never contend for one directory.
	//
	// WHAT THIS DOES NOT EXCLUDE: a locally-installed knowledge-graph module. The reservation is over
	// this DIRECTORY, and a local module occupies a different one — so a deployment that installs both
	// is not refused here, or anywhere. It matters because both declare the same capability field, so
	// having both present is a schema collision rather than a harmless duplicate: two modules answer
	// the same question, and which one the platform binds is not decided by anything visible from here.
	//
	// Unenforced deliberately, for now. Detecting the local module means either reading another
	// module's manifest — reaching across a boundary this command does not otherwise cross — or asking
	// the running platform, which is unavailable at exactly the moment a connect is applied. Both are
	// real designs; neither is a one-line guard, and no deployment has hit this yet because the local
	// module is not part of any distribution that also connects to a service.
	kgModuleKey = "knowledge-graph"

	// The marker, distinct in name from the content mount's and from the code-module stamp. Three
	// kinds, three names — which is what makes "the console created this, as this kind" answerable,
	// and therefore what makes unmount safe.
	kgMarkerName   = ".dethernety-kg-mount.json"
	kgMarkerSchema = "dethernety.byodt-kg-mount/1"
)

// kgMarker is the proof of ownership and the mount's own record. It deliberately does NOT carry the
// pinned version: the version the deployment actually answers at is the one in the mode layer, which
// is what the platform reads, and a second copy here would be a value that can disagree with it while
// looking authoritative in the operator's view.
type kgMarker struct {
	Schema    string `json:"schema"`
	MountedAt string `json:"mountedAt"`
}

// kgVersionList is the wire protocol's public version listing. Only the fields the console needs are
// named; unknown fields are tolerated. A version entry carries a recall note when the version has been
// withdrawn — a withdrawn version answers queries with a refusal, so it must never be pinned.
type kgVersionList struct {
	Latest   string `json:"latest"`
	Versions []struct {
		ID       string          `json:"id"`
		Recalled json.RawMessage `json:"recalled"`
	} `json:"versions"`
}

// resolveKgVersion reads the service's public version listing and returns the version to pin.
//
// The call carries NO credential: the listing is public, and the console holds an operator credential
// that must not be forwarded to a surface which does not need it. The destination is the base URL the
// caller already validated, never a value taken from a request path.
//
// It refuses anything it cannot pin with confidence — an absent or malformed latest, or a latest the
// listing itself marks recalled. Recall exists because something went wrong with a version; assuming
// the recall also re-pointed `latest` would be assuming the failure mode away, and the check costs one
// pass over a response already in hand.
func resolveKgVersion(ctx context.Context, base string) (string, error) {
	var list kgVersionList
	if err := publicGet(ctx, base, "/v1/kg/versions", &list); err != nil {
		return "", fmt.Errorf("reading the knowledge-graph version listing: %w", err)
	}
	// The same sha256 digest shape the content pin takes, held to one pattern rather than two that
	// would have to be kept identical.
	if !pinPattern.MatchString(list.Latest) {
		return "", fmt.Errorf("the knowledge-graph service published no usable version")
	}
	for _, v := range list.Versions {
		if v.ID == list.Latest && len(v.Recalled) > 0 {
			return "", fmt.Errorf("the newest knowledge-graph version has been withdrawn")
		}
	}
	return list.Latest, nil
}

// kgMountDir resolves the knowledge-graph mount's directory, through the same containment check every
// mount path passes.
func kgMountDir(modulesDir string) (string, error) {
	return moduleDir(modulesDir, kgModuleKey)
}

// readKgMarker reads the knowledge-graph mount marker from a directory, and is the ONE definition of
// "the console created this, as this kind" — so it validates the schema rather than leaving each caller
// to remember. Unlike the content mount's test, which stats the file, this one parses it: a file
// carrying our name and someone else's schema is not ours, and since removing a directory is the
// irreversible half of this file, being sure is worth one Unmarshal.
func readKgMarker(dir string) (kgMarker, error) {
	var m kgMarker
	data, err := os.ReadFile(filepath.Join(dir, kgMarkerName))
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return kgMarker{}, err
	}
	if m.Schema != kgMarkerSchema {
		return kgMarker{}, fmt.Errorf("%s carries schema %q, not %q", kgMarkerName, m.Schema, kgMarkerSchema)
	}
	return m, nil
}

// isKgMount reports whether a directory is one the console created as a knowledge-graph mount.
func isKgMount(dir string) bool {
	_, err := readKgMarker(dir)
	return err == nil
}

// mountKg writes the knowledge-graph mount: the directory, the stub, and the marker. Re-mounting over
// the console's own knowledge-graph mount is allowed; anything else occupying that directory — a
// content mount, a shipped module, an operator's own — is refused rather than overwritten.
//
// It returns whether the written stub ended up world-writable, which the platform refuses to load in
// cloud mode, so the operator is told rather than left to discover it as a missing module later.
func mountKg(modulesDir, mountedAt string) (worldWritableWarning bool, err error) {
	dir, err := kgMountDir(modulesDir)
	if err != nil {
		return false, err
	}
	if info, statErr := os.Stat(dir); statErr == nil && info.IsDir() && !isKgMount(dir) {
		return false, fmt.Errorf("a module directory named %s already exists and was not created as a knowledge-graph connection", kgModuleKey)
	}
	warn, err := writeStubFile(dir, moduleFileName(kgModuleKey), kgStub)
	if err != nil {
		return false, err
	}
	return warn, writeMarkerNamed(dir, kgMarkerName, kgMarker{Schema: kgMarkerSchema, MountedAt: mountedAt})
}

// unmountKg removes the knowledge-graph mount. Nothing mounted is a success, not an error: it runs on
// every disconnect, including a deployment that never had one. A directory that is not ours is refused
// and left intact — the ownership check comes BEFORE the removal, which is the whole reason the marker
// exists.
func unmountKg(modulesDir string) error {
	dir, err := kgMountDir(modulesDir)
	if err != nil {
		return err
	}
	info, statErr := os.Stat(dir)
	if statErr != nil || !info.IsDir() {
		return nil
	}
	if !isKgMount(dir) {
		return fmt.Errorf("the module directory %s was not created as a knowledge-graph connection and will not be removed", kgModuleKey)
	}
	return os.RemoveAll(dir)
}
