package daemoncmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Content mounts are the reason a deployment connects to the cloud. On a cloud deployment the generic
// remote-module class already ships inside the platform's module package, so mounting a module is not a
// download: it is writing a tiny stub into the modules directory that names a module key and a content
// pin. The module's classes, schemas, guides and evaluation are then served per request from the
// content service against the caller's own token — the console never fetches or holds that content, and
// sends no token of its own on the catalog path. On the artifact path it forwards THE OPERATOR'S OWN
// access token, for one request, to the one host the mode layer names.
//
// The distinction that made the original sentence true is the one preserved: the console has no
// credential of its own, then or now. It relays the operator's, for one call, to one configured host,
// and holds it nowhere. Every other property this file claims is unchanged — no deployment identifier,
// no request-supplied destination, no redirect followed.
//
// The console reads the public catalog (no credential) to show the operator what exists and at which
// pin, writes and removes stubs, and reports whether a newer content version is available. The catalog
// host is read from the mode-layer file the console itself wrote — never from the request — the same
// pinned-destination rule the commerce path follows.

// contentTimeout bounds each catalog call. Catalog reads are operator-initiated and interactive, so a
// short timeout keeps a stalled upstream from hanging the console.
const contentTimeout = 15 * time.Second

// entitledTimeout bounds an entitled fetch, and is deliberately not contentTimeout. http.Client.Timeout
// covers the body read as well as the exchange, and it is a hard floor no caller's context can raise —
// so the catalog's 15 s would fail an artifact download on any link slower than about 1.7 Mbit/s. At 60 s
// the floor is roughly 420 kbit/s for a 3 MiB payload, and a caller that wants less can still shorten it
// with its own context deadline.
const entitledTimeout = 60 * time.Second

// maxDenialBytes caps the body read back from a NON-2xx entitled response. Those bodies exist to be
// shown to the operator verbatim, which is exactly why they need their own bound: a refusal carrying
// megabytes of text would otherwise arrive whole in front of whoever asked for the install. The wire
// protocol's refusal bodies are short JSON, so this is generous rather than tight.
const maxDenialBytes = 8 << 10

// entitlementsTimeout bounds the subscription read, and is deliberately shorter than contentTimeout. That
// budget pays for the catalog walk — a list plus one document per package — while this is one item behind
// one function. They run concurrently, so the catalog no longer sets the response's floor on its own: a
// hung subscription read would hold a catalog that answered in milliseconds for the whole of the longer
// budget, turning an optional decoration into the thing the operator waits on.
//
// Short is safe here in a way it would not be on the catalog. The outcome of running out is could-not-ask,
// which gates nothing and which Refresh retries; and a single read that has not answered in five seconds is
// not going to answer usefully inside an interactive window anyway.
const entitlementsTimeout = 5 * time.Second

// maxEntitlementsBytes caps the body read back from the entitlements surface. That body is a protocol
// marker and a list of package keys — tens of bytes each against a catalog already capped at
// maxCatalogPackages — so this is generous rather than tight. It exists for the reason every other cap
// here does: how large a response is remains the upstream's choice, not this console's.
const maxEntitlementsBytes = 64 << 10

// maxStubBytes caps the module file read back when checking which pin it names. The stub the console
// writes is one rendering of stubTemplate — a few hundred bytes, with the pin on the fifth line — but it
// sits in an operator-writable volume, so the read is bounded like any other. The cap only ever bites on
// a file the console did not write; see stubCarriesPin for what a file over it is answered with.
const maxStubBytes = 8 << 10

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
	// An artifact version: a bare semver core, and stricter than MAJOR.MINOR.PATCH looks. Both extra
	// bounds earn their place. No leading zeros, because the version composes into a certificate subject
	// and a URL path — "01.2.0" is a different string from "1.2.0" that no publisher emits, and accepting
	// it would produce a request that can only ever fail verification. And at most nine digits a
	// component, which keeps every one below MaxInt32 on any target, so a later comparison over
	// strconv.Atoi cannot overflow: "unparseable" then describes only a version read off disk, never one
	// a request can supply.
	artifactVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`)
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
	Schema string `json:"schema"`
	// The package the operator mounted from, and deliberately ONE key rather than a list. A module can
	// belong to several packages, so a component mounted from one is attributed to that one, and
	// re-mounting from another re-attributes it. That is a known limitation rather than an oversight,
	// and neither candidate fix is right: a list would record a fiction, because the operator chose one
	// package; and dropping the field breaks latestModule, which judges pin currency against the
	// package the operator chose — a module's content is identical across packages, but the pin each
	// package document names need not be. It stays as it is until the display it affects is redesigned.
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
	Version   string                 `json:"version"`
	Modules   []catalogModuleEntry   `json:"modules"`
	Artifacts []catalogArtifactEntry `json:"artifacts"`
}

// catalogArtifactEntry is one artifact a package grants, as the package document lists it. There is no
// version list and therefore no version type: latest is the only version this document names, so there is
// nothing here for a version picker to consume.
type catalogArtifactEntry struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	// Public protocol vocabulary — code-module installs here, application does not — and the field the
	// console branches on to decide whether installing is even a thing this artifact does.
	Kind        string `json:"kind"`
	Target      string `json:"target,omitempty"`
	Description string `json:"description,omitempty"`
	// The highest version that has not been recalled, computed by the publisher with a numeric sort when
	// the package was cut. ABSENT when every published version has been recalled, which the console shows
	// as unavailable rather than as an update it could offer.
	Latest string `json:"latest,omitempty"`
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
	Key         string                 `json:"key"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Version     string                 `json:"version"`
	Modules     []catalogModuleEntry   `json:"modules"`
	Artifacts   []catalogArtifactEntry `json:"artifacts"`
	Error       string                 `json:"error,omitempty"`
	// Entitled reports whether the operator's subscription includes this package, read live from the
	// content service on this request rather than copied out of the deployment's configuration. nil means
	// the console COULD NOT ASK — no operator token on the request, or the service did not answer — and
	// the UI must not gate on nil. An unreachable service must never make a subscribed deployment look
	// unsubscribed, so the undetermined case gates nothing at all.
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

// errEntitledTooLarge marks an over-cap response specifically. A caller needs it because that failure is
// the only one on this transport an operator can be told something useful about — the object is larger
// than this console will install — while a dial failure or a refused redirect are the same "could not be
// reached" from where they stand. Wrapped rather than returned bare, so the message is unchanged.
var errEntitledTooLarge = errors.New("response exceeds the size this console will read")

// entitledGet performs an AUTHENTICATED GET against the content service's entitled surface, carrying the
// operator's access token. It is a second function beside publicGet and never a flag on it: a flag would
// be one edit away from attaching this token to a catalog call, which is the exact thing publicGet's
// comment above exists to prevent.
//
// It differs from publicGet in what it does with a refusal, and that difference is the point. publicGet
// collapses every non-2xx into an error and discards the body; here a refusal's body IS the answer — the
// service's denial explanation, or an operator-authored withdrawal reason — so status and body come back
// intact and the caller decides what they mean. Only a transport failure is an error.
//
// It does NOT classify those statuses. Every outcome they map to is a sentence shown to an operator, and
// the code that chooses those sentences is the handler's, not the transport's.
//
// Three bounds, because "the body survives" cannot mean "unbounded": max+1 on a success so a body exactly
// at the cap is allowed and one over is refused rather than silently truncated; maxDenialBytes on a
// refusal; and any 3xx is an error rather than a status, because CheckRedirect hands back a body that is
// net/http's own <a href="…"> text — an UPSTREAM-CHOSEN URL — and a caller rendering "the body" for an
// unmapped status would put it in front of the operator.
//
// base is the caller's, and callers take it from the console-written mode layer, re-checked on read.
// Never a request-supplied host.
func entitledGet(ctx context.Context, base, path, token string, max int64) (body []byte, status int, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+path, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{
		Timeout: entitledTimeout,
		// The same refusal publicGet makes, for the same reason: refusing redirects is what keeps the
		// set of hosts this dials equal to the set the operator named.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return nil, resp.StatusCode, fmt.Errorf("entitled GET %s: the content service redirected, which the console does not follow", path)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, err := io.ReadAll(io.LimitReader(resp.Body, maxDenialBytes))
		if err != nil {
			return nil, resp.StatusCode, fmt.Errorf("entitled GET %s: reading the refusal: %w", path, err)
		}
		return b, resp.StatusCode, nil
	}
	// One byte past the cap, so a body exactly at the cap is allowed and one over is refused.
	b, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("entitled GET %s: %w", path, err)
	}
	if int64(len(b)) > max {
		return nil, resp.StatusCode, fmt.Errorf("%w: entitled GET %s: body exceeds max size %d bytes", errEntitledTooLarge, path, max)
	}
	return b, resp.StatusCode, nil
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
		// Both lists are initialised here and not at the append below, because the two degraded branches
		// that follow return this value without reaching it — and a package that renders "modules":[] while
		// rendering "artifacts":null would be describing the same absence two different ways.
		cp := catalogPackage{
			Key: p.Key, Name: p.Name, Description: p.Description, Version: p.Latest,
			Modules: []catalogModuleEntry{}, Artifacts: []catalogArtifactEntry{},
		}
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
		cp.Artifacts = append(cp.Artifacts, doc.Artifacts...)
		out = append(out, cp)
	}
	return out, truncated, nil
}

// wireProtocolVersion is the protocol revision this console speaks, and the value the content service
// stamps on the documents it serves. It is the path prefix on those routes too — /v1.
const wireProtocolVersion = "1"

// entitlementsDoc is the content service's answer to what the caller's subscription includes. Membership
// only: a key is present when the caller holds that package, and the document says nothing about when it
// was bought or what it contains — the console has no use for either, and the read model behind the
// surface cannot produce them.
type entitlementsDoc struct {
	Protocol string `json:"protocol"`
	Packages []struct {
		Key string `json:"key"`
	} `json:"packages"`
}

// contentScopeSuffix is the tail the content service's required scope always carries: its Terraform builds
// that scope as `<api origin>/content.access`, so the identifier varies by deployment while the suffix
// does not.
const contentScopeSuffix = "/content.access"

// canAskForEntitlements reports whether this deployment's configured OIDC scope includes a content scope
// at all. False means NO sign-in will ever produce a usable token here — the recipe predates the scope, or
// was issued without it — and that is a different thing from a read that failed.
//
// It exists because the console could not previously tell those apart. The SPA inferred the permanent case
// from an EMPTY access token, and that state is unreachable: the console requests this same OIDC_SCOPE, so
// a deployment without the content scope still gets a perfectly good token for the scopes it did ask for.
// The permanent case therefore arrived looking exactly like a transient one, and the operator was told to
// retry something that could never succeed.
//
// A SUFFIX, and NOT the exact scope rebuilt from MODULE_CONTENT_BASE_URL, which is what the first version
// of this did and was wrong. The scope's identifier is derived from the service's vanity origin, while the
// recipe carries whichever address subscribers should actually dial — and those diverge on a supported
// configuration: with the edge off, the recipe carries the gateway's own endpoint while the scope still
// names the vanity host. Rebuilding the scope from the recipe's address therefore told a perfectly capable
// deployment that its configuration was broken, and pointed the operator at a reconnect — which removes
// every cloud-provided module. Strictly worse than the defect it was added to fix.
//
// The suffix cannot fail that way. A deployment that holds a content scope holds one ending in this,
// whatever host it names; and the only way to be wrong here is to see one that belongs to something else,
// which yields "able to ask" — the state the console was already in before any of this, and which gates
// nothing. So the one direction it can be wrong in is the harmless one.
func canAskForEntitlements(vars map[string]string) bool {
	// Whole fields, never a substring of the joined string: a scope is one token, and a scope whose value
	// merely contains this text is a different scope.
	return slices.ContainsFunc(strings.Fields(vars["OIDC_SCOPE"]), func(scope string) bool {
		return strings.HasSuffix(scope, contentScopeSuffix)
	})
}

// resolveEntitlements asks the content service which packages this operator's subscription includes, and
// reports whether it got an answer at all. That second return is the whole contract: ok=false means COULD
// NOT ASK, and it must reach the operator as "unknown" rather than as "entitled to nothing" — the two are
// one disabled control apart, and the wrong one of them greys out a subscriber's own catalog.
//
// EVERY failure collapses to could-not-ask, refusals included, and that is deliberate rather than lazy:
//
//   - A 401 is not relayed and not told apart. The operator's CONTENT credential lapsing says nothing
//     about their console session, and the SPA answers any 401 by clearing the session — so relaying one
//     would sign an operator out of their own console because a token for a different service expired.
//   - A 404 is ordinary. There is no catch-all route in front of this surface, so a content service that
//     predates it — or one rolled back past it — answers exactly that, and the console must degrade to
//     unknown rather than treat the absence as an answer.
//
// The empty token is refused BEFORE the call, not inside it. entitledGet sets its Authorization header
// unconditionally, so an empty token would dial the content service carrying a bare "Bearer " and no
// credential. Nothing here needs that request made, and a reloaded tab — where the operator's tokens are
// gone but the session is not — makes it the common case rather than an edge one.
func resolveEntitlements(ctx context.Context, base, token string) (keys map[string]struct{}, ok bool) {
	if base == "" || token == "" {
		return nil, false
	}
	// Its own budget, not the entitled transport's 60 s and not the catalog's 15 s — see entitlementsTimeout
	// for why it is the shortest of the three.
	ctx, cancel := context.WithTimeout(ctx, entitlementsTimeout)
	defer cancel()
	body, status, err := entitledGet(ctx, base, "/v1/entitlements", token, maxEntitlementsBytes)
	if err != nil || status != http.StatusOK {
		return nil, false
	}
	// The marker is checked, not merely parsed. A 200 whose body is not this document — a refusal rendered
	// as JSON, a gateway's own error shape, a future revision — unmarshals happily into a zero value, and a
	// zero value here reads as "entitled to nothing", which is the one answer this function must never
	// invent. An unrecognised version is could-not-ask, which gates nothing; that is the safe direction.
	var doc entitlementsDoc
	if err := json.Unmarshal(body, &doc); err != nil || doc.Protocol != wireProtocolVersion {
		return nil, false
	}
	// An ABSENT packages key is could-not-ask, not "entitled to nothing". The field is mandatory on this
	// surface, so a body carrying the marker without it is malformed rather than empty — and the difference
	// is the whole hazard this function guards: an empty set greys a subscriber's catalog, while
	// could-not-ask gates nothing.
	// Absent and present-but-empty are distinguishable here because encoding/json leaves a nil slice for the
	// first and an empty non-nil one for the second, so `[]` still means what it should.
	if doc.Packages == nil {
		return nil, false
	}
	keys = make(map[string]struct{}, len(doc.Packages))
	for _, p := range doc.Packages {
		if p.Key != "" {
			keys[p.Key] = struct{}{}
		}
	}
	return keys, true
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

// latestArtifact finds one artifact across ALL package documents, unlike latestModule which scopes to the
// package the operator mounted from. An artifact's bytes are one thing at one version and no package can
// offer a different one, so package scoping would be a distinction without a difference.
//
// Where the packages disagree it takes the HIGHEST readable latest, and the trade cuts both ways because
// one artifact version is several package cuts. Between them a freshly cut package advertises a newly
// published version the others do not, so taking the highest surfaces an update at the first cut rather
// than the last. A RECALL runs the other way: the lagging package still advertises the withdrawn version,
// so this keeps prompting it until the last cut lands — and the install then answers 410 carrying the
// reason its publisher wrote. That outcome is a known limitation of the protocol rather than a surprise
// here, and it explains itself, where a missed update would be silent.
//
// The direction is a deliberate call, not an accident of implementation: taking the lowest would stop
// prompting a recalled version at the first cut instead of the last, at the price of hiding a newly
// published one until the last cut instead of the first. Do not change one half without the other.
//
// The ordering is total, so the absent and the unreadable cases cannot come out differently depending on
// which package the catalog listed first: a readable latest beats a non-empty unreadable one, which beats
// an absent one.
func latestArtifact(packages []catalogPackage, key string) (catalogArtifactEntry, bool) {
	var out catalogArtifactEntry
	found := false
	for _, p := range packages {
		for _, a := range p.Artifacts {
			if a.Key != key {
				continue
			}
			if !found {
				out, found = a, true
				continue
			}
			_, aReadable := versionComponents(a.Latest)
			_, outReadable := versionComponents(out.Latest)
			switch {
			case aReadable && !outReadable:
				out = a
			case aReadable && outReadable:
				if cmp, _ := compareVersion(a.Latest, out.Latest); cmp > 0 {
					out = a
				}
			case !aReadable && !outReadable && out.Latest == "" && a.Latest != "":
				// Neither can be compared, but one of them at least says a version exists. "Unreadable"
				// and "every version recalled" are different answers to the operator.
				out = a
			}
		}
	}
	return out, found
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

// errStubNotWritten marks the one failure that leaves a mount RECORDED but incomplete: the marker is on
// disk and the module file is not. It is worth distinguishing because it is the only failure the operator
// can act on differently — the directory is owned, so a retry completes it and an unmount removes it.
var errStubNotWritten = errors.New("the mount is recorded but its module file was not written")

// ensureMountDir creates a module directory if it is not already there, and reports whether THIS call
// created it — which is what tells a mount that fails later whether it may remove the directory again.
//
// It is the ONE definition of the mount directory's mode, which is why nothing else in this package
// creates one. The parent is created too, because the modules directory is a host mount that a fresh
// deployment may not have yet: today's stub writer used MkdirAll and therefore tolerated its absence,
// and listMounts tolerates it deliberately, so a mount that started failing on an empty volume would be
// a regression.
//
// Mkdir rather than stat-then-create: "did I create it" then comes from the syscall that did the work
// rather than from an observation taken before it.
func ensureMountDir(dir string) (created bool, err error) {
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return false, err
	}
	if err := os.Mkdir(dir, 0o755); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// undoMountDir removes a directory a mount created and then failed to finish, so a failed mount leaves
// nothing behind where it had nothing to begin with.
//
// os.Remove, NEVER os.RemoveAll: the removal succeeds only while the directory is still empty, so it can
// never take an operator's tree with it. Best effort by design — a mount that has already failed does
// not fail differently because the cleanup did too. Do not be tempted to inspect the error either: Go
// maps ENOTEMPTY to fs.ErrExist, so errors.Is(err, fs.ErrExist) is TRUE for the ordinary
// directory-is-not-empty case and reads as the opposite of what it means.
func undoMountDir(dir string, created bool) {
	if created {
		_ = os.Remove(dir)
	}
}

// writeMount writes one mount into dir: the directory, then the MARKER, then the stub. Every kind of
// mount the console writes goes through here, so the directory mode, the world-writable check and — the
// reason this function exists — the ORDER all have one definition.
//
// The order is the whole point. A stub is a loadable *Module.js; a marker is what tells mount and
// unmount that the console owns the directory. Writing the stub first leaves a window in which a
// loadable module sits in a directory both operations then refuse forever, and the operator's only
// remedy is a shell in the volume. Marker first, so the failure that remains possible is an owned
// directory: a retry completes it, and an unmount removes it.
//
// A marker failure undoes the directory when this call created it. A stub failure deliberately does
// NOT undo anything — the marker is exactly what makes that state recoverable, and removing it would
// take the recovery away. The half state that leaves is bounded at both ends: publishStub closes the
// window for every failure it can catch, and stubCarriesPin reports the state to the operator when it
// arises anyway. The failure stays distinguishable (errStubNotWritten) so its caller can tell
// the operator what to do rather than reporting a generic write failure.
func writeMount(dir, markerName string, marker any, stubFileName, stubContent string) (worldWritableWarning bool, err error) {
	created, err := ensureMountDir(dir)
	if err != nil {
		return false, fmt.Errorf("creating the mount directory: %w", err)
	}
	if err := writeMarkerNamed(dir, markerName, marker); err != nil {
		undoMountDir(dir, created)
		return false, fmt.Errorf("writing the mount marker: %w", err)
	}
	stubPath := filepath.Join(dir, stubFileName)
	if err := publishStub(stubPath, stubContent); err != nil {
		return false, fmt.Errorf("%w: %v", errStubNotWritten, err)
	}
	// Some bind-mount backends do not preserve modes, and the platform refuses to load a world-writable
	// module file in cloud mode — so the console reports the condition rather than letting the mount
	// fail silently later.
	return worldWritable(stubPath), nil
}

// publishStub writes the stub at path, atomically where the filesystem allows it.
//
// The rename IS the publish: a reader sees the previous stub or the new one, never a partial write and
// never the window in which the marker is ahead of a stub that was never written. That window is the
// reason this function exists, and it matters most for the failure no error return can report — an
// abrupt death between the marker write and this one leaves the same half state with nobody told.
//
// THE IN-PLACE FALLBACK IS NOT OPTIONAL. A directory at mode 0555 with the stub already in it permits an
// overwrite and refuses the creation of a sibling — measured, not reasoned — so a rename-only publish
// would turn a pin advance that succeeds today into a failure landing in exactly the state the marker
// ordering exists to make recoverable. Atomicity where it is obtainable, today's behaviour where it is
// not, never worse than now.
//
// The temp is chmod'd rather than trusted to WriteFile's perm argument, which applies only at CREATION:
// a temp left behind by an earlier failed rename would otherwise publish the stub carrying THAT file's
// mode. The mode is load-bearing and gets no second chance to be noticed — the platform runs as a
// different uid than the console and has to read the file, while worldWritable tests only o+w, so a
// too-narrow mode is a module that silently never loads.
//
// The temp name must not end in Module.js. The loader takes any *Module.js in a module directory, so a
// suffix is the only safe shape here; ".tmp" appended is what cloud.go and initcmd/state.go already use.
func publishStub(path, content string) error {
	inPlace := func() error { return os.WriteFile(path, []byte(content), 0o644) }
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		// Every path out of here removes the temp, this one included. os.WriteFile is O_CREATE|O_TRUNC and
		// then writes, so a failure part-way — ENOSPC being the case that produces it — leaves a truncated
		// temp behind. Nothing loads a .tmp, but leaving one would contradict the fallback's whole claim of
		// being never worse than a direct write.
		_ = os.Remove(tmp)
		return inPlace()
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		_ = os.Remove(tmp)
		return inPlace()
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return inPlace()
	}
	return nil
}

// writeContentMount writes a content mount from its marker, so the stub's key and pin and the marker's
// cannot disagree. Callers MUST validate ModuleKey and Pin before calling this — renderStub's template
// safety argument depends on it, and a struct now sits between the request fields and the template.
func writeContentMount(dir string, m mountMarker) (worldWritableWarning bool, err error) {
	return writeMount(dir, mountMarkerName, m, moduleFileName(m.ModuleKey), renderStub(m.ModuleKey, m.Pin))
}

// stubPresent reports whether the loadable module file is in place. The marker says the console owns
// the directory; only the stub says the platform has something to load. Since the marker is written
// first, those are no longer the same question, and a view that claims a module is mounted must ask
// this one.
//
// NON-EMPTY, not merely present. os.WriteFile opens with O_CREATE|O_TRUNC and writes afterwards, so a
// write that fails part-way — ENOSPC being the case that produces it, where the directory entry is
// obtainable and the data blocks are not — leaves a regular file of zero bytes. The platform's loader
// takes any *Module.js it finds, so that file is picked up and exports nothing; presence alone would
// report the mount as complete on exactly the failure this question exists to catch. renderStub never
// produces an empty stub, so size is a safe discriminator.
func stubPresent(dir, fileName string) bool {
	info, err := os.Stat(filepath.Join(dir, fileName))
	return err == nil && info.Mode().IsRegular() && info.Size() > 0
}

// stubCarriesPin reports whether the module file at dir/fileName is the one this mount RECORDS: whether
// it names pin in the constructor call renderStub wrote into it.
//
// stubPresent asks whether the platform has something to load. This asks whether that something is the
// right thing, and the two stopped being the same question on a re-mount. A pin advance writes the marker
// first, so a stub write that fails afterwards — or an abrupt death between the two — leaves a valid,
// non-empty module file at the PREVIOUS pin while the marker records the new one. Every other check the
// inventory has then passes and the row reads current while the platform serves the old code.
//
// A substring test over renderStub's own output, deliberately, rather than a parser. stubTemplate is the
// only producer of this text and TestRenderStubGolden already pins its bytes character for character, so
// a pattern here would be a SECOND thing to keep in step with it — and the inventory only ever needs the
// boolean. It follows that this cannot distinguish a stub carrying a different pin from one carrying no
// pin at all, and it does not need to: the answer to both is that the file is not what the mount records,
// and the remedy for both is to mount it again.
//
// FALSE is the safe answer, and it is what an unreadable file and a file not carrying the pin both give.
// A caller must never read a false as licence to report the mount current.
//
// The cap is a bound on the READ, not a rejection: io.ReadAll over a LimitReader returns no error at the
// limit, so a file larger than the cap is answered on its first maxStubBytes and reports TRUE when the
// pin lies in that prefix. That is the right answer — the file does carry the pin — and the cap only ever
// bites on a file the console did not write, since renderStub's output is a few hundred bytes.
func stubCarriesPin(dir, fileName, pin string) bool {
	f, err := os.Open(filepath.Join(dir, fileName))
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(io.LimitReader(f, maxStubBytes))
	if err != nil {
		return false
	}
	return strings.Contains(string(data), "pin: '"+pin+"'")
}

// worldWritable reports whether the file at path has its world-writable bit set.
func worldWritable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode().Perm()&0o002 != 0
}

// mountedDir is one mount as the scan found it: the marker, and the DIRECTORY it was read from. The two
// are carried together because a caller asking anything else about the mount — whether its stub is there,
// what its files are — must ask it of the directory that exists rather than of the key the marker claims.
// A hand-edited marker can name a different key, and a check aimed at that key would report on a directory
// that is not the one it read.
type mountedDir struct {
	dir    string
	marker mountMarker
}

// listMounts scans the modules directory for subdirectories the console created (those carrying the
// mount marker) and returns them with their markers — the inventory. A missing modules directory is not
// an error: it simply means nothing is mounted yet.
//
// It answers ONE question: which directories does the console own as content mounts. Whether the platform
// has anything to load in them is a second question, asked by the views that claim a module is mounted —
// see stubPresent. Keeping them apart is what lets unmountModule keep gating on ownership alone.
func listMounts(modulesDir string) ([]mountedDir, error) {
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []mountedDir
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(modulesDir, e.Name())
		m, err := readMarker(dir)
		if err != nil {
			continue // not one of ours (no marker, or unreadable) — skip
		}
		out = append(out, mountedDir{dir: dir, marker: m})
	}
	return out, nil
}
