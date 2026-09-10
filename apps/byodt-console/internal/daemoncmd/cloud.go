package daemoncmd

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// The mode layer is a single env-file the console owns. Cloud mode fills it with the recipe's fixed
// variable set plus the values only the console can supply; pure-OSS mode fills the same file with
// the two development values. A third, much narrower writer rewrites exactly one of those variables on a
// connected deployment and preserves every other VALUE — see allowlist.go.
//
// Every writer rewrites the whole file from a parsed map, so none of them preserves the file's TEXT: a
// comment or a blank line an operator added does not survive the next write, and the names come back
// sorted. That is true of connect and disconnect too and always has been; it is stated here because the
// narrow writer is the first one an operator might expect to leave the rest of the file alone literally. It is rewritten, never deleted: both podman's --env-file and systemd's
// EnvironmentFile (without a leading `-`) fail on a missing file, which would break the very recovery
// path DELETE /api/cloud is.

// acceptedRecipeVars is the exact set of names the console copies out of a pasted recipe into the
// mode layer. The writer rejects the ENTIRE apply if any name outside this set (and the stripped
// set below) appears — it validates the name SET, not the name shape. The mode layer is an
// EnvironmentFile applied after the base layer, so it overrides it: a recipe smuggling
// NODE_ENV=development plus ENABLE_NOAUTH=true would turn authentication off for the whole graph,
// and NODE_OPTIONS=--require <path> is arbitrary code in the platform process at boot. None of those
// names is in this set, so the set check is the guard — a shape check is not enough.
var acceptedRecipeVars = map[string]bool{
	"OIDC_ISSUER":             true,
	"OIDC_JWKS_URI":           true,
	"OIDC_CLIENT_ID":          true,
	"OIDC_AUDIENCE":           true,
	"OIDC_SCOPE":              true,
	"OIDC_DOMAIN":             true,
	"OIDC_SHARED_POOL":        true,
	"PORTAL_ORIGIN":           true,
	"MODULE_CONTENT_BASE_URL": true,
	"DEPLOYMENT_ALLOWLIST":    true,
}

// optionalRecipeVars are accepted recipe names that MAY be empty or absent — unlike acceptedRecipeVars,
// they are not required present-and-non-empty. Putting any of these in acceptedRecipeVars instead would
// reject the whole apply on a case that legitimately occurs.
//
// MODULE_KG_BASE_URL is the knowledge-graph service, present only for a deployment entitled to one —
// so it is absent from every recipe issued before it existed and from every recipe without that
// entitlement. Required, it would break both. Present and non-empty it is held to secureURL like the
// content base, and it is what makes the console mount a knowledge-graph connection; absent, the
// deployment simply has no knowledge-graph service and nothing is written or mounted.
//
// DEPLOYMENT_ARTIFACT_SIGNER is the certificate-subject PREFIX the entitled publishing workflow signs
// under — configuration, never a destination: the console composes a per-version ref onto it and
// compares the result to a signature's subject, and nothing ever dials it. It is absent from every
// recipe issued before it existed, so requiring it would reject all of them; absent it simply means
// this deployment cannot install artifacts until it reconnects, which is the fail-closed side and the
// opposite of an unknown subscription, where nothing is gated because that is a display concern.
// DEPLOYMENT_TEAM_ID names the team this deployment belongs to. The content service uses it to scope
// what it serves: a person who belongs to two teams must not be served one team's content on the other
// team's deployment, and the deployment is the only party that knows which team it is. It is optional in
// exactly the way the two above are — absent from every recipe issued before it existed, so requiring it
// would reject all of them. Absent, the header is not sent, and the content service answers such a call
// only while it is establishing that every deployment has been told its team. That is the safe direction
// for the console — a recipe that applies beats one that is rejected — and it is deliberately not the
// permanent one. Once the service enforces, absence is not a degraded deployment but a broken one: every
// entitled call fails. The name is promoted to required once every recipe carries it, and the window
// between here and there is the only reason this entry is in this map rather than the one above.
var optionalRecipeVars = map[string]bool{
	"MODULE_KG_BASE_URL":         true,
	"DEPLOYMENT_ARTIFACT_SIGNER": true,
	"DEPLOYMENT_TEAM_ID":         true,
}

// strippedRecipeVars are recognised recipe names the console deliberately DROPS rather than writes.
//
// DEPLOYMENT_EXPOSURE is base-layer only — the operator's own declaration — and the recipe always
// ships `network`. Applied verbatim it would silently flip a loopback deployment's posture to
// network, inverting every exposure consequence. Recognising it as stripped, rather than
// rejecting the whole apply, lets a verbatim paste of the portal's recipe succeed while the console
// keeps the operator's exposure declaration untouched.
//
// COMMERCE_API_BASE_URL is RETIRED. It fed the live re-fetch (PUT /api/cloud), which is gone: the
// console's deployment-scoped token has the wrong audience for the commerce API, so that call could
// never succeed, and the portal no longer emits the variable. The allowlist apply is NOT that route
// returning: it fetches nothing and asks nobody, applying a value the operator supplies from the portal,
// which is the half the retired route could not do. It is tolerated-and-dropped rather than
// rejected only so a saved OLDER recipe that still carries the line keeps applying instead of failing
// as a foreign variable; new recipes do not carry it at all.
//
// DEPLOYMENT_PACKAGES is RETIRED for a sharper reason: it was a MUTABLE fact written into an immutable
// place. It carried the deployment's package keys as of the moment its recipe was generated, and the
// console gated the catalog on that copy — so a package bought afterwards stayed invisible until the
// operator regenerated the recipe and reconnected, and a disconnect removes every cloud-provided module.
// The catalog now asks the content service on each read, which is the only copy that can be right. It is
// dropped rather than rejected so that every recipe already saved, and every one still being issued while
// the producer catches up, keeps applying.
var strippedRecipeVars = map[string]bool{
	"DEPLOYMENT_EXPOSURE":   true,
	"COMMERCE_API_BASE_URL": true,
	"DEPLOYMENT_PACKAGES":   true,
}

// retiredRecipeVars is the subset of the above that is dropped because the name no longer means anything,
// as opposed to DEPLOYMENT_EXPOSURE, which is dropped because the value is the OPERATOR'S and must not come
// from a recipe. The apply path treats both identically; only the sentence it tells the operator differs,
// and it has to: "kept this deployment's own DEPLOYMENT_PACKAGES" would claim the console preserved a
// setting it in fact discarded — and since recipes still carry that name, every connect would say it.
var retiredRecipeVars = map[string]bool{
	"COMMERCE_API_BASE_URL": true,
	"DEPLOYMENT_PACKAGES":   true,
}

// partitionStripped splits the stripped names into the ones whose value the console kept as the
// deployment's own, and the ones it dropped as retired. Order is preserved, so both stay sorted.
func partitionStripped(stripped []string) (kept, retired []string) {
	for _, name := range stripped {
		if retiredRecipeVars[name] {
			retired = append(retired, name)
		} else {
			kept = append(kept, name)
		}
	}
	return kept, retired
}

// parseRecipe splits a pasted dotenv block into name→value pairs. The recipe is rendered as bare
// NAME=value lines, so there is nothing to unquote or unescape; blank lines and `#` comments are
// ignored. A non-empty line without `=` is a malformed recipe, surfaced rather than silently
// skipped, and a repeated name is an error rather than a last-write-wins ambiguity.
func parseRecipe(body string) (map[string]string, error) {
	out := map[string]string{}
	for i, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			return nil, fmt.Errorf("line %d is not NAME=value: %q", i+1, raw)
		}
		name := strings.TrimSpace(line[:eq])
		if _, dup := out[name]; dup {
			return nil, fmt.Errorf("%s appears more than once", name)
		}
		out[name] = strings.TrimSpace(line[eq+1:])
	}
	return out, nil
}

// cloudModeVars turns a parsed recipe plus the console-supplied values into the exact set of
// name→value pairs the cloud mode layer holds. It enforces the accepted-name set, strips the
// base-layer-only names (returning what it dropped so the operator can be told), requires every
// accepted name to be present — a half recipe is a deployment that boots into a broken cloud state
// — and adds NODE_ENV plus the two values the recipe cannot produce: OIDC_REDIRECT_URI, which depends
// on where the deployment answers, and MODULE_CONTENT_CACHE_DIR, which depends on its volume layout.
//
// One console-supplied value is deliberately NOT added here. MODULE_KG_VERSION has to be read from the
// knowledge-graph service, and this function is pure on purpose — every name it writes is decided from
// its arguments alone, which is what makes the allowlist argument checkable. The caller resolves that
// one and adds it AFTER this returns, so no request is ever made on behalf of a recipe this function
// would have rejected.
func cloudModeVars(recipe map[string]string, redirectURI, contentCacheDir string) (vars map[string]string, stripped []string, err error) {
	vars = map[string]string{}
	var foreign []string
	for name, value := range recipe {
		switch {
		case acceptedRecipeVars[name]:
			vars[name] = value
		case optionalRecipeVars[name]:
			// Copied verbatim, empty included — it is not subject to the required-present check below.
			vars[name] = value
		case strippedRecipeVars[name]:
			stripped = append(stripped, name)
		default:
			foreign = append(foreign, name)
		}
	}
	// Report every foreign name at once, sorted — the rejection is order-independent rather than
	// naming whichever key a map happened to yield first.
	if len(foreign) > 0 {
		sort.Strings(foreign)
		return nil, nil, fmt.Errorf("recipe carries variables the console will not write: %s", strings.Join(foreign, ", "))
	}
	// Every accepted name must be present AND non-empty: a blank OIDC value is the same broken-cloud
	// boot a missing one is, so the presence check would be hollow without it.
	var missing []string
	for name := range acceptedRecipeVars {
		if v, ok := vars[name]; !ok || v == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return nil, nil, fmt.Errorf("recipe is missing required variables: %s", strings.Join(missing, ", "))
	}
	// The redirect is request-supplied on the paste path, and this function both writes it verbatim and
	// derives ALLOWED_ORIGINS from it — so it is checked here, alongside every other value this function
	// writes, rather than only where it happens to be called from. cloudApply checks it first as well,
	// to answer 400 before the recipe is parsed, and that stays: this is the same reasoning
	// cloudContentBase records for re-checking on read, that a check living only at one call site is a
	// property of that call site rather than of the value.
	if err := validateRedirectURI(redirectURI); err != nil {
		return nil, nil, err
	}
	// Console-supplied and derived. NODE_ENV is mode-dependent and only the console sets it.
	vars["NODE_ENV"] = "production"
	vars["OIDC_REDIRECT_URI"] = redirectURI
	vars["MODULE_CONTENT_CACHE_DIR"] = contentCacheDir
	// ALLOWED_ORIGINS is the browser origin the platform must accept for CORS in production. The
	// platform's production validation requires it, and it is not a recipe value — it is the origin of
	// the fixed front-door redirect (the deployment's own front door), which only the console knows.
	// Derived here so it stays in step with OIDC_REDIRECT_URI, and derived only after the check above,
	// so no origin is ever computed from a redirect this function would reject.
	origin, err := redirectOrigin(redirectURI)
	if err != nil {
		return nil, nil, err
	}
	vars["ALLOWED_ORIGINS"] = origin
	// No value — recipe-derived, confirmed, or console-supplied — may carry a control character. A
	// newline would split into a second NAME=value line in the written file, which is the whole
	// class the fixed-name-set guard exists to prevent; reject it at the point the values are
	// assembled rather than trusting the writer's downstream parser.
	for name, value := range vars {
		if hasControlChar(value) {
			return nil, nil, fmt.Errorf("value for %s contains a control character", name)
		}
	}
	// The URL-shaped values must be https (or http on localhost): the identity endpoints the platform
	// validates against and the content service base. A plaintext or off-box value pasted in a hostile
	// recipe would point the platform's identity checks, or a module's content fetches, at an
	// attacker's host, so the shape is enforced where the values are assembled.
	for _, name := range secureURLVars {
		// An OPTIONAL URL variable that is absent or empty has nothing to check, and secureURL("")
		// fails with "must be an absolute URL with a host" — so checking it unconditionally would
		// reject every recipe that legitimately omits one. A required name cannot reach this branch:
		// the present-and-non-empty check above has already rejected it.
		if vars[name] == "" && optionalRecipeVars[name] {
			continue
		}
		if err := secureURL(vars[name]); err != nil {
			return nil, nil, fmt.Errorf("%s %w", name, err)
		}
	}
	// OIDC_DOMAIN is a BARE HOST, and the console is the last place that can hold it to that. It is
	// excluded from secureURLVars because it is not a URL — but "not a URL" is not "unchecked": the
	// SPA turns it into the authorization endpoint the operator's browser is sent to, so a value
	// carrying its own scheme would name that endpoint outright. The producer already contracts a
	// bare host (the commerce root validates the same shape before a recipe is ever issued), which
	// makes a scheme here a sign the recipe did not come from there.
	if err := bareHost(vars["OIDC_DOMAIN"]); err != nil {
		return nil, nil, fmt.Errorf("OIDC_DOMAIN %w", err)
	}
	// Optional, so an absent or empty value has nothing to check — and absent is refused later, by the
	// reader, rather than here, because a recipe that predates the variable must still apply.
	if v := vars["DEPLOYMENT_ARTIFACT_SIGNER"]; v != "" {
		if err := artifactSignerPrefix(v); err != nil {
			return nil, nil, fmt.Errorf("DEPLOYMENT_ARTIFACT_SIGNER %w", err)
		}
	}
	// Optional, so an absent or empty value has nothing to check. Unlike the signer, this value LEAVES the
	// console again — it is sent as a request header on every entitled call — so holding it to a shape is
	// what keeps a hostile recipe from writing a second header rather than a value. The reader re-checks it
	// too, for the case this path cannot see: a mode layer edited by hand after the console wrote it.
	if v := vars["DEPLOYMENT_TEAM_ID"]; v != "" {
		if err := teamID(v); err != nil {
			return nil, nil, fmt.Errorf("DEPLOYMENT_TEAM_ID %w", err)
		}
	}
	// An optional value that arrived empty is dropped rather than written. Empty means nothing at all for
	// either of these — no service configured, no team named — and writing it would make the deployment's
	// behaviour depend on how each reader treats an empty string, a question that absence does not raise.
	// Absent already means "not configured", so let it be the only state that does.
	for _, name := range []string{"MODULE_KG_BASE_URL", "DEPLOYMENT_TEAM_ID"} {
		if v, present := vars[name]; present && v == "" {
			delete(vars, name)
		}
	}
	sort.Strings(stripped)
	return vars, stripped, nil
}

// bareHost requires a hostname with no scheme, no path, no port and no whitespace — the shape the
// identity hosted-UI domain is contracted to have. It mirrors the check the recipe producer already
// applies, deliberately: the two ends of one contract should fail on the same values, and the console
// cannot assume it is talking to that producer.
func bareHost(raw string) error {
	if raw == "" {
		return fmt.Errorf("must not be empty")
	}
	// "@" earns its place here: a browser reads everything before it as userinfo, so
	// "legit.example@attacker.example" prepended with https:// resolves to attacker.example while
	// still reading plausibly to whoever glances at the address bar. That is the exact substitution
	// this check exists to refuse, and a scheme-only check would wave it through.
	if strings.ContainsAny(raw, ":/?#*@\\") || strings.ContainsAny(raw, " \t") {
		return fmt.Errorf("must be a bare hostname — no scheme, userinfo, port, path or space")
	}
	return nil
}

// artifactSignerPattern is the exact shape of a GitHub Actions workflow's certificate subject with no
// ref: scheme, host, owner, repo, the workflows path, one file. One expression, because it is one shape.
//
// No "@". A subject's ref is "…yml@refs/tags/…", so refusing "@" refuses a configured ref and a userinfo
// substitution with the same clause — and a recipe able to pin one ref could pin one version's ref for
// every version, which is exactly the property the per-version subject exists to provide.
//
// The "\s" class earns its place for ONE character: a plain space. hasControlChar (below) is
// r < 0x20 || r == 0x7f and does not catch 0x20, and url.Parse rejects tab, newline and carriage return
// outright — so a space is the only whitespace that reaches here.
var artifactSignerPattern = regexp.MustCompile(
	`^https://[A-Za-z0-9.-]+/[^/@\s]+/[^/@\s]+/\.github/workflows/[^/@\s]+\.ya?ml$`)

// A team identifier is an opaque token minted by the issuer — rendered in base64url, and nothing this
// console can or should interpret. What it CAN do is hold it to a shape, and
// the shape is what makes header injection impossible rather than merely unlikely: every character this
// admits is already a valid HTTP header-value character, because a header is where the value goes.
//
// A CHARACTER CLASS AND A BOUND, NOT AN EXACT LENGTH, and the difference is the point. Pinning the length
// would tie every console in the field to the issuer's current identifier format across a release
// boundary: change the format and every deployment refuses a legitimate recipe, having no way to learn
// the new one. The issuer asserts its own exact length on its own side, where a change strands nobody.
var teamIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// teamID holds the deployment's team identifier to the shape above.
func teamID(raw string) error {
	if !teamIDPattern.MatchString(raw) {
		return fmt.Errorf("must be 1-64 characters of A-Z, a-z, 0-9, '-' or '_'")
	}
	return nil
}

// artifactSignerPrefix holds the signer subject prefix to the shape above. It is a TYPO GUARD, not a
// security control, and the difference matters: a hostile recipe already names the identity provider,
// the JWKS URI, the allowlist and the content host — it owns this deployment's whole trust
// configuration, so a hostile signer adds nothing to what it can already do. What protects this value
// is where it comes from: the portal, over the operator's authenticated session, pasted into a file the
// apply path refuses to rewrite on an already-configured deployment.
//
// It checks the RAW string rather than a parsed URL, and that is the whole design. url.Parse hides
// every substitution this guard exists to catch: it lifts "user@" into u.User leaving u.Host and u.Path
// clean, it strips "?query" and "#fragment" out of u.Path, and it lowercases "HTTPS://" into u.Scheme —
// so a parsed-field check accepts all four, including the one value that can never string-equal a real
// certificate subject.
func artifactSignerPrefix(raw string) error {
	// url.Parse does not clean "..", and the pattern cannot refuse it: ".." is a legal path segment.
	if strings.Contains(raw, "/../") {
		return fmt.Errorf("must not contain a relative path segment")
	}
	if !artifactSignerPattern.MatchString(raw) {
		// BOTH spellings, because the pattern accepts both (`\.ya?ml$`). A refusal naming only .yml tells
		// an operator whose publishing workflow is a .yaml that their value was rejected when it in fact
		// passes — and the value they would then "correct" it to is one that can never string-equal their
		// certificate's subject. The message is the only place this rule is stated to them.
		return fmt.Errorf("must be an https workflow path with no ref — https://<host>/<owner>/<repo>/.github/workflows/<file>.yml, or .yaml")
	}
	return nil
}

// hasControlChar reports whether s contains any ASCII control character (below 0x20, or DEL). No
// legitimate recipe value does, and a newline or carriage return is an env-file line-injection
// vector.
func hasControlChar(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

// secureURL requires an absolute https URL, or http only on a loopback host. Cognito enforces the
// same shape on callbacks, and the console holds every URL-shaped value it will act on to it — a
// destination it forwards a token to, or the platform validates identity against, must not be
// plaintext or off-box.
func secureURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("is not a valid URL: %w", err)
	}
	if u.Host == "" {
		return fmt.Errorf("must be an absolute URL with a host")
	}
	// Userinfo is refused for the reason artifactSignerPrefix's comment gives above: url.Parse lifts
	// "user@" into u.User and leaves u.Host clean, so every check here passes a value that READS as one
	// host and RESOLVES to another. On its own that buys a hostile recipe nothing — this function
	// constrains the host not at all, and u.Hostname() already strips userinfo before the loopback
	// comparison, so the http exception is not widened either. It is refused because the producer's
	// bare-host contract refuses "@" and these are two ends of one contract, and because a value that
	// misrepresents where it points is worth refusing wherever it is later shown or logged. Go's
	// net/http would also turn it into an Authorization: Basic header on any request made to this base.
	// Note this is a LITERAL "@": the percent-encoded form passes every check here and at the producer,
	// and is refused by the browser instead, which throws on the URL rather than resolving it anywhere.
	if u.User != nil {
		return fmt.Errorf(`must not carry userinfo (a "user@" prefix)`)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if h := u.Hostname(); h == "localhost" || h == "127.0.0.1" || h == "::1" {
			return nil
		}
		return fmt.Errorf("over http is allowed only on localhost")
	default:
		return fmt.Errorf("must be https (or http on localhost)")
	}
}

// secureURLVars are the recipe variables whose values are URLs the deployment acts on: the identity
// endpoints, the content service base, and the knowledge-graph service base. cloudModeVars holds each
// to secureURL so a pasted recipe cannot point the platform's identity checks, or a module's fetches,
// at a plaintext or off-box host. OIDC_DOMAIN is excluded — it is a bare hosted-UI hostname, not a URL
// — and OIDC_REDIRECT_URI is held to secureURL through validateRedirectURI rather than through this
// list, both at the paste, where the operator confirms it, and in cloudModeVars itself.
//
// MODULE_KG_BASE_URL is checked here for a second reason as well: the console itself fetches the
// version listing from that host during an apply, so this is the check that stands between a pasted
// recipe and the console's own outbound request.
var secureURLVars = []string{
	"OIDC_ISSUER",
	"OIDC_JWKS_URI",
	"MODULE_CONTENT_BASE_URL",
	"MODULE_KG_BASE_URL",
	"PORTAL_ORIGIN",
}

// validateRedirectURI checks the operator-confirmed OIDC redirect: the deployment's front door plus
// /auth/callback. This is a well-formedness check, not proof the value is registered as a callback —
// that failure surfaces as redirect_mismatch at sign-in.
func validateRedirectURI(raw string) error {
	if err := secureURL(raw); err != nil {
		return fmt.Errorf("the redirect URI %w", err)
	}
	return nil
}

// redirectOrigin returns the scheme://host origin of the fixed front-door redirect (Host carries the
// port), which is what ALLOWED_ORIGINS holds. The redirect is already well-formedness-checked by
// validateRedirectURI on the paste path; this re-parses defensively and fails closed on anything
// without a usable origin.
func redirectOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("the redirect URI has no usable origin for ALLOWED_ORIGINS")
	}
	return u.Scheme + "://" + u.Host, nil
}

// pureOSSModeVars is the mode layer for pure-OSS: no cloud variables, noauth on, development. It is
// what DELETE /api/cloud writes — the same file, rewritten, so the recovery path never depends on
// the cloud it is recovering from.
func pureOSSModeVars() map[string]string {
	return map[string]string{
		"NODE_ENV":      "development",
		"ENABLE_NOAUTH": "true",
	}
}

// modeLayerMu serialises every write to the mode-layer file, and the one read-modify-write over it.
//
// WHY A LOCK OVER A FILE ONE PROCESS OWNS. The daemon serves requests concurrently, and three routes now
// write this file: connect, disconnect, and the allowlist apply. Two of them racing produced two distinct
// faults, and the second is the reason this is a package-level lock rather than a per-write one.
//
// A TORN MODE FILE TURNS THE ADMIN GATE OFF. An unparseable file makes modeFileIntent report intentNone,
// so the deployment reads as not-cloud, so the gate takes its fail-open arm and calls through with no
// check at all (see admin.go). That arm is documented as needing a filesystem fault to reach; two writers
// interleaving is a way to cause one from inside the process.
//
// AND A READ-MODIFY-WRITE MUST NOT STRADDLE A POSTURE CHANGE. The allowlist apply reads the cloud vars,
// swaps one value and writes the map back. A disconnect landing in between writes the pure-OSS values and
// is then overwritten with the whole cloud map — re-cloudifying a deployment whose modules the teardown
// has already deleted. Holding this across the read AND the write is what makes that impossible, which is
// why writeModeLayerLocked exists as a separate entry point.
var modeLayerMu sync.Mutex

// writeModeLayer serialises vars into path atomically. It takes modeLayerMu; a caller already holding it
// for a read-modify-write must call writeModeLayerLocked instead, or it will deadlock.
func writeModeLayer(path string, vars map[string]string) error {
	modeLayerMu.Lock()
	defer modeLayerMu.Unlock()
	return writeModeLayerLocked(path, vars)
}

// writeModeLayerLocked is writeModeLayer's body, for a caller that already holds modeLayerMu.
//
// One NAME=value line each, sorted for a stable diff — mirroring initcmd's writeState. Mode 0644:
// the mode layer is non-secret configuration that both the container runtime and the platform read;
// the secrets live in .env.secrets, never here.
//
// THE TEMP FILE IS UNIQUELY NAMED. It used to be path+".tmp" — one name shared by every writer, so two
// concurrent writes wrote into the same file and both renamed it, which is precisely how the torn file
// above gets made. The lock alone would fix that inside this process; the unique name also survives a
// second console, and costs nothing.
func writeModeLayerLocked(path string, vars map[string]string) error {
	names := make([]string, 0, len(vars))
	for n := range vars {
		names = append(names, n)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, n := range names {
		// The serializer defends its own line structure: a value with a control character would
		// break the one-NAME=value-per-line invariant the env-file readers depend on. Callers
		// validate too, but this is the chokepoint every write passes through.
		if hasControlChar(vars[n]) {
			return fmt.Errorf("refusing to write %s: value contains a control character", n)
		}
		fmt.Fprintf(&b, "%s=%s\n", n, vars[n])
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating mode-layer directory: %w", err)
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".mode-*.env.tmp")
	if err != nil {
		return fmt.Errorf("writing mode layer: %w", err)
	}
	tmp := f.Name()
	// Any failure past this point leaves a temp file the rename would otherwise have consumed; remove it
	// rather than leaving the mode-layer directory to accumulate them across failed applies.
	defer func() { _ = os.Remove(tmp) }()
	if _, err := f.WriteString(b.String()); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing mode layer: %w", err)
	}
	// 0644 BY FCHMOD, ON THE HANDLE RATHER THAN THE PATH. CreateTemp makes the file 0600 and the mode layer
	// is read by the container runtime and the platform, so it has to widen. Doing it through the open file
	// leaves no window in which a name in this directory could be swapped between the check and the change.
	//
	// It is also NOT the same 0644 the fixed-name write produced, and this comment used to claim it was:
	// os.WriteFile's mode is masked by umask, fchmod is not. Under a restrictive umask the old code wrote
	// 0600 and this writes 0644 — the intended mode, arrived at deliberately rather than by inheritance.
	if err := f.Chmod(0o644); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing mode layer: %w", err)
	}
	// FSYNC BEFORE THE RENAME, because the failure this guards is the one the lock above cannot reach. A
	// rename is atomic against other writers; it is not durable against a power loss, and an unflushed
	// rename can survive as a truncated or empty file. That file still PARSES — it is an env file, so a
	// missing tail is just a smaller map — and the tail is where OIDC_SHARED_POOL sorts, which is the sole
	// marker that makes this deployment read as cloud. Lose it and modeFileIntent says intentNone, the
	// admin gate takes its fail-open arm, and every deployment-changing route runs unchecked. That is the
	// exact outcome modeLayerMu exists to prevent, arriving by crash instead of by race.
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing mode layer: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("writing mode layer: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	// And the directory entry itself: the rename is what makes the new file reachable, so a crash between
	// the rename and the directory's own flush can leave the old name pointing at nothing. Best-effort —
	// not every platform supports it, and failing the whole apply over an unsyncable directory would be a
	// worse answer than a write that already landed.
	if dir, err := os.Open(filepath.Dir(path)); err == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

// readModeLayer parses the mode-layer file the console wrote. A missing file returns the underlying
// os error (check with os.IsNotExist).
func readModeLayer(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseRecipe(string(data))
}

// modeIntent is what the mode-layer file the console manages was last written to mean. It is the
// console's own intent, read back from disk — distinct from what the platform is actually running,
// which comes from /config. Comparing the two is how a pending restart is detected.
type modeIntent int

const (
	intentNone    modeIntent = iota // no console-written mode file (missing, unparseable, or the operator's own IdP file)
	intentCloud                     // the console wrote a cloud file
	intentPureOSS                   // the console wrote the pure-OSS file
)

// modeFileIntent classifies the mode-layer file. The cloud file is told apart from an operator's
// own-IdP file (both are NODE_ENV=production) by OIDC_SHARED_POOL, which only the cloud recipe
// carries — an own-IdP deployment has no shared-pool variable. The pure-OSS file is NODE_ENV=
// development with noauth on. Anything else — including an own-IdP file — is intentNone: not
// something the console wrote or manages. A missing or unparseable file is intentNone, which fails
// safe (the write-guard then permits an apply over a broken state rather than locking the operator
// out).
func modeFileIntent(path string) modeIntent {
	vars, err := readModeLayer(path)
	if err != nil {
		return intentNone
	}
	if _, ok := vars["OIDC_SHARED_POOL"]; ok {
		return intentCloud
	}
	if vars["NODE_ENV"] == "development" || vars["ENABLE_NOAUTH"] != "" {
		return intentPureOSS
	}
	return intentNone
}

// isCloudModeFile reports whether the console has written a cloud mode-layer file — the source for
// the POST /api/cloud write-guard.
func isCloudModeFile(path string) bool {
	return modeFileIntent(path) == intentCloud
}
