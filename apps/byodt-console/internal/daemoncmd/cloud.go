package daemoncmd

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The mode layer is a single env-file the console owns. Cloud mode fills it with the recipe's fixed
// variable set plus the values only the console can supply; pure-OSS mode fills the same file with
// the two development values. It is rewritten, never deleted: both podman's --env-file and systemd's
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
// they are not required present-and-non-empty. Putting either of these in acceptedRecipeVars instead
// would reject the whole apply on a case that legitimately occurs.
//
// DEPLOYMENT_PACKAGES is the deployment's entitled package keys (comma-separated), which is
// legitimately EMPTY when the subscription entitles nothing (e.g. it lapsed), and ABSENT from recipes
// generated before the variable existed. It is copied verbatim so the console can gate the catalog by
// subscription; a present value (even empty) is authoritative, while its absence means "undetermined"
// and the console does not gate.
//
// MODULE_KG_BASE_URL is the knowledge-graph service, present only for a deployment entitled to one —
// so it is absent from every recipe issued before it existed and from every recipe without that
// entitlement. Required, it would break both. Present and non-empty it is held to secureURL like the
// content base, and it is what makes the console mount a knowledge-graph connection; absent, the
// deployment simply has no knowledge-graph service and nothing is written or mounted.
var optionalRecipeVars = map[string]bool{
	"DEPLOYMENT_PACKAGES": true,
	"MODULE_KG_BASE_URL":  true,
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
// never succeed, and the portal no longer emits the variable. It is tolerated-and-dropped rather than
// rejected only so a saved OLDER recipe that still carries the line keeps applying instead of failing
// as a foreign variable; new recipes do not carry it at all.
var strippedRecipeVars = map[string]bool{
	"DEPLOYMENT_EXPOSURE":   true,
	"COMMERCE_API_BASE_URL": true,
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
	// Console-supplied and derived. NODE_ENV is mode-dependent and only the console sets it.
	vars["NODE_ENV"] = "production"
	vars["OIDC_REDIRECT_URI"] = redirectURI
	vars["MODULE_CONTENT_CACHE_DIR"] = contentCacheDir
	// ALLOWED_ORIGINS is the browser origin the platform must accept for CORS in production. The
	// platform's production validation requires it, and it is not a recipe value — it is the origin of
	// the fixed front-door redirect (the deployment's own front door), which only the console knows.
	// Derived here so it stays in step with OIDC_REDIRECT_URI on the paste path.
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
	// An empty optional URL is dropped rather than written. DEPLOYMENT_PACKAGES is written empty
	// because empty MEANS something there (entitled to nothing); an empty service base means nothing
	// at all, and writing it would make the deployment's behaviour depend on how its reader treats an
	// empty string. Absent is the state that already means "no service configured".
	if v, present := vars["MODULE_KG_BASE_URL"]; present && v == "" {
		delete(vars, "MODULE_KG_BASE_URL")
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
// — and OIDC_REDIRECT_URI is validated separately at the paste, where the operator confirms it.
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

// writeModeLayer serialises vars into path atomically (temp file + rename in the same directory),
// one NAME=value line each, sorted for a stable diff — mirroring initcmd's writeState. Mode 0644:
// the mode layer is non-secret configuration that both the container runtime and the platform read;
// the secrets live in .env.secrets, never here.
func writeModeLayer(path string, vars map[string]string) error {
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
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o644); err != nil {
		return fmt.Errorf("writing mode layer: %w", err)
	}
	return os.Rename(tmp, path)
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
