package daemoncmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Content mounts are the reason a deployment connects to the cloud. On a cloud deployment the generic
// remote-module class already ships inside the platform's module package, so mounting a module is not a
// download: it is writing a tiny stub into the modules directory that names a module key and a content
// pin. The module's classes, schemas, guides and evaluation are then served per request from the
// content service against the caller's own token — the console never fetches or holds that content, and
// never sends a token of its own to the content service.
//
// The console reads the public catalog (no credential) to show the operator what exists and at which
// pin, writes and removes stubs, and reports whether a newer content version is available. The catalog
// host is read from the mode-layer file the console itself wrote — never from the request — the same
// pinned-destination rule the commerce path follows.

// contentTimeout bounds each catalog call. Catalog reads are operator-initiated and interactive, so a
// short timeout keeps a stalled upstream from hanging the console.
const contentTimeout = 15 * time.Second

// maxCatalogPackages caps the per-request fan-out when resolving each package's modules. The catalog is
// small in practice; this is a safety valve against a pathological or hostile response, not a real
// limit. Hitting it is logged server-side (the returned list is capped, not the whole response failed).
const maxCatalogPackages = 200

// The mount stub is a fixed CommonJS template with exactly two substituted values: the module key and
// the content pin. It must be CommonJS (the platform loads modules with require()) and it must assign
// exports.default (require() returns module.exports directly, so module.exports = class would leave
// .default undefined and the load would fail). The two values are always validated before they reach
// this template, so neither can carry a quote, backslash, newline, or control character that would
// break out of the JavaScript string literal.
const stubTemplate = `'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { DtRemoteModule } = require('@dethernety/dt-module');
class RemoteModule extends DtRemoteModule {
  constructor(driver, logger) { super({ moduleKey: '%s', pin: '%s' }, driver, logger); }
}
exports.default = RemoteModule;
`

// The identifier constraints the console enforces. The module key becomes both a directory name and a
// JavaScript string literal, so it needs a charset; the pin is a content hash; the package key lands
// only in the marker JSON (never a path or a literal) but is still validated so the marker stays clean.
var (
	moduleKeyPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,38}$`)
	pinPattern        = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	packageKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
)

// The marker file the console writes beside every stub it creates. It is the proof that the console
// created a directory — so mount never clobbers, and unmount never deletes, a directory it did not
// create (a shipped module, an operator's own module, or a code module) — and it is the inventory
// source for the mounted-modules view. Its name is a dotfile and does not end in Module.js, so the
// platform's loader (which scans subdirectories for *Module.js) ignores it. The name is deliberately
// distinct from the code-module stamp and from the knowledge-graph mount marker (kg.go), so the three
// kinds never mistake each other's directories.
const (
	mountMarkerName   = ".dethernety-mount.json"
	mountMarkerSchema = "dethernety.byodt-mount/1"
)

type mountMarker struct {
	Schema     string `json:"schema"`
	PackageKey string `json:"packageKey"`
	ModuleKey  string `json:"moduleKey"`
	Pin        string `json:"pin"`
	MountedAt  string `json:"mountedAt"`
}

// The catalog wire shapes (public, unauthenticated). Only the fields the console needs are named;
// unknown fields are tolerated.
type catalogPackageList struct {
	Packages []catalogPackageSummary `json:"packages"`
}

type catalogPackageSummary struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Latest      string `json:"latest"`
}

type packageDocument struct {
	Version string               `json:"version"`
	Modules []catalogModuleEntry `json:"modules"`
}

type catalogModuleEntry struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	ContentHash string `json:"contentHash"`
	// Short module blurb. Passed through from the content service as-is (omitted when absent), for the
	// console to show inline; the daemon never interprets it.
	Description string `json:"description,omitempty"`
}

// catalogPackage is the assembled browse view the console returns: a package plus, resolved from its
// latest version, the modules an operator can mount (the catalogModuleEntry wire shape, returned as-is).
// Error carries a per-package resolution failure so one bad package never blanks the whole catalog.
type catalogPackage struct {
	Key         string               `json:"key"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Version     string               `json:"version"`
	Modules     []catalogModuleEntry `json:"modules"`
	Error       string               `json:"error,omitempty"`
	// Entitled reports whether this deployment is subscribed to the package, from the recipe's
	// DEPLOYMENT_PACKAGES set. nil means undetermined — the recipe predates the variable (the key is
	// absent from the mode file), so the UI must not gate on it.
	Entitled *bool `json:"entitled,omitempty"`
}

// publicGet performs an UNAUTHENTICATED GET against one of the cloud service's public surfaces — the
// content catalog, and the knowledge-graph version listing. It sends no Authorization header by design:
// neither surface needs a credential, and attaching a token would forward the operator's credential to a
// surface that must not receive it. Non-2xx is an error carrying only the path and status; the body is
// size-capped like the other probes.
func publicGet(ctx context.Context, base, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	client := &http.Client{
		Timeout: contentTimeout,
		// Refuse to follow a redirect rather than let a 3xx repoint the request at another host.
		// The base has passed secureURL, but that constrains the SCHEME — https, or http only on
		// loopback — and never the destination: the host is whatever the operator's recipe named.
		// On the catalog path it is read back from the mode file; on the knowledge-graph path
		// (kg.go) it comes from the recipe being applied, before that file exists. So the host is
		// caller-nameable by design, and refusing redirects is what keeps the set of hosts this
		// dials equal to the set the operator named. The wire protocol serves these surfaces
		// without redirects anyway, so a 3xx is unexpected and its target unvalidated.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("content GET %s: status %d", path, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(dst)
}

// resolveCatalog lists the packages and, for each, resolves its latest version's modules — the shape the
// browse view and the pin-currency check both need. A failure to resolve a single package's modules
// yields that package with an error note rather than failing the whole catalog; only a failure of the
// top-level list is a hard error. truncated is true if the package list exceeded the fan-out cap.
func resolveCatalog(ctx context.Context, base string) (packages []catalogPackage, truncated bool, err error) {
	// One deadline for the whole resolution, not per call: the walk is a list plus one document per
	// package, and a slow-but-not-dead upstream must not let the sum run far past the interactive window.
	ctx, cancel := context.WithTimeout(ctx, contentTimeout)
	defer cancel()

	var list catalogPackageList
	if err := publicGet(ctx, base, "/v1/catalog/packages", &list); err != nil {
		return nil, false, err
	}
	out := make([]catalogPackage, 0, len(list.Packages))
	for i, p := range list.Packages {
		if i >= maxCatalogPackages {
			truncated = true
			break
		}
		if ctx.Err() != nil {
			// The shared deadline is spent; stop rather than turn every remaining package into a
			// per-call error.
			break
		}
		cp := catalogPackage{Key: p.Key, Name: p.Name, Description: p.Description, Version: p.Latest, Modules: []catalogModuleEntry{}}
		if p.Latest == "" {
			cp.Error = "this package has no published version"
			out = append(out, cp)
			continue
		}
		var doc packageDocument
		docPath := "/v1/catalog/packages/" + url.PathEscape(p.Key) + "/versions/" + url.PathEscape(p.Latest)
		if err := publicGet(ctx, base, docPath, &doc); err != nil {
			cp.Error = "could not load this package's modules"
			out = append(out, cp)
			continue
		}
		cp.Modules = append(cp.Modules, doc.Modules...)
		out = append(out, cp)
	}
	return out, truncated, nil
}

// latestModule finds a module by key within the package it was mounted from, so pin currency is judged
// against that package's latest — a module may belong to several packages, and the console compares
// against the one the operator chose.
func latestModule(packages []catalogPackage, packageKey, moduleKey string) (catalogModuleEntry, bool) {
	for _, p := range packages {
		if p.Key != packageKey {
			continue
		}
		for _, m := range p.Modules {
			if m.Key == moduleKey {
				return m, true
			}
		}
	}
	return catalogModuleEntry{}, false
}

// renderStub fills the fixed template with the validated key and pin. Callers MUST validate both before
// calling this — the template safety argument depends on it.
func renderStub(moduleKey, pin string) string {
	return fmt.Sprintf(stubTemplate, moduleKey, pin)
}

// moduleFileName derives the <PascalCase>Module.js file name from a validated module key. The name comes
// from the key, never a catalog-supplied display string. The loader takes any *Module.js in a module
// subdirectory, so only the suffix is load-bearing; the prefix keeps mounts individually recognisable.
func moduleFileName(moduleKey string) string {
	var b strings.Builder
	for _, seg := range strings.Split(moduleKey, "-") {
		if seg == "" {
			continue
		}
		b.WriteString(strings.ToUpper(seg[:1]))
		b.WriteString(seg[1:])
	}
	b.WriteString("Module.js")
	return b.String()
}

// moduleDir resolves the directory a module key maps to and asserts it sits directly under the modules
// directory. The key pattern already forbids separators and dots, so this is defence in depth: mount and
// unmount both pass through it, so neither can be tricked into touching a path outside the mount root.
func moduleDir(modulesDir, moduleKey string) (string, error) {
	dir := filepath.Join(modulesDir, moduleKey)
	if filepath.Dir(dir) != filepath.Clean(modulesDir) {
		return "", fmt.Errorf("resolved module path escapes the modules directory")
	}
	return dir, nil
}

// hasMarkerNamed reports whether a directory carries the named marker file. The console writes more
// than one kind of mount, each with its own marker name, and the name is what tells them apart — so
// this takes the name rather than assuming the content mount's.
func hasMarkerNamed(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

// hasOurMarker reports whether a directory carries the CONTENT mount marker — the test for "the
// console created this as a content mount", gating both clobber-on-mount and delete-on-unmount. A
// directory carrying a different kind's marker is not one of these, and answers false.
func hasOurMarker(dir string) bool {
	return hasMarkerNamed(dir, mountMarkerName)
}

// writeMarkerNamed writes a marker file into a module directory (mode 0644, non-secret).
func writeMarkerNamed(dir, name string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, name), append(data, '\n'), 0o644)
}

// writeMarker writes the content mount marker into a module directory.
func writeMarker(dir string, m mountMarker) error {
	return writeMarkerNamed(dir, mountMarkerName, m)
}

// readMarker reads the mount marker from a module directory.
func readMarker(dir string) (mountMarker, error) {
	var m mountMarker
	data, err := os.ReadFile(filepath.Join(dir, mountMarkerName))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(data, &m)
	return m, err
}

// writeStubFile writes the module directory (0755), the named stub file (0644), and returns whether
// the written stub ended up world-writable — some bind-mount backends do not preserve modes, and the
// platform refuses to load a world-writable module file in cloud mode, so the console reports the
// condition rather than letting the mount fail silently later. Every kind of mount the console writes
// goes through here, so the directory mode and that check have one definition.
func writeStubFile(dir, fileName, content string) (worldWritableWarning bool, err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	stubPath := filepath.Join(dir, fileName)
	if err := os.WriteFile(stubPath, []byte(content), 0o644); err != nil {
		return false, err
	}
	return worldWritable(stubPath), nil
}

// writeStub writes a content mount: the directory, and the stub naming the module key and its pin.
func writeStub(dir, moduleKey, pin string) (worldWritableWarning bool, err error) {
	return writeStubFile(dir, moduleFileName(moduleKey), renderStub(moduleKey, pin))
}

// worldWritable reports whether the file at path has its world-writable bit set.
func worldWritable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode().Perm()&0o002 != 0
}

// listMounts scans the modules directory for subdirectories the console created (those carrying the
// mount marker) and returns their markers — the inventory. A missing modules directory is not an error:
// it simply means nothing is mounted yet.
func listMounts(modulesDir string) ([]mountMarker, error) {
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []mountMarker
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, err := readMarker(filepath.Join(modulesDir, e.Name()))
		if err != nil {
			continue // not one of ours (no marker, or unreadable) — skip
		}
		out = append(out, m)
	}
	return out, nil
}
