package daemoncmd

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// validRecipeVars is the ten-variable recipe the portal emits, as name→value pairs. It is what a
// verbatim paste parses to.
func validRecipeVars() map[string]string {
	return map[string]string{
		"OIDC_ISSUER":             "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_ABC",
		"OIDC_JWKS_URI":           "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_ABC/.well-known/jwks.json",
		"OIDC_CLIENT_ID":          "clientid123",
		"OIDC_AUDIENCE":           "clientid123",
		"OIDC_SCOPE":              "openid profile email https://api.byodt.dethernety.io/content.access",
		"OIDC_DOMAIN":             "team.auth.eu-central-1.amazoncognito.com",
		"OIDC_SHARED_POOL":        "true",
		"PORTAL_ORIGIN":           "https://byodt.dethernety.io",
		"MODULE_CONTENT_BASE_URL": "https://api.byodt.dethernety.io",
		"DEPLOYMENT_ALLOWLIST":    "sub-a,sub-b",
	}
}

// validRecipeBlock renders validRecipeVars as the dotenv block a paste carries.
func validRecipeBlock() string {
	var b strings.Builder
	for name, value := range validRecipeVars() {
		b.WriteString(name)
		b.WriteByte('=')
		b.WriteString(value)
		b.WriteByte('\n')
	}
	return b.String()
}

func TestParseRecipeSkipsBlanksAndComments(t *testing.T) {
	body := "# a comment\n\nOIDC_ISSUER=https://issuer\n   \nOIDC_CLIENT_ID=abc\n"
	got, err := parseRecipe(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got["OIDC_ISSUER"] != "https://issuer" || got["OIDC_CLIENT_ID"] != "abc" || len(got) != 2 {
		t.Fatalf("parsed wrong: %#v", got)
	}
}

func TestParseRecipeRejectsMalformed(t *testing.T) {
	if _, err := parseRecipe("OIDC_ISSUER=ok\nthis line has no equals\n"); err == nil {
		t.Fatal("a line without = must be an error, not a silent skip")
	}
	if _, err := parseRecipe("=novalue\n"); err == nil {
		t.Fatal("an empty name must be an error")
	}
	if _, err := parseRecipe("OIDC_ISSUER=a\nOIDC_ISSUER=b\n"); err == nil {
		t.Fatal("a repeated name must be an error")
	}
}

// The security core: any name outside the accepted set (and the stripped set) rejects the entire
// apply. Three of the names below are the smuggling vectors that matter — RCE via NODE_OPTIONS,
// auth-off via ENABLE_NOAUTH, mode downgrade via NODE_ENV — and PATH stands in for any other
// foreign key.
func TestCloudModeVarsRejectsForeignKeyWholesale(t *testing.T) {
	for _, foreign := range []string{"NODE_OPTIONS", "ENABLE_NOAUTH", "NODE_ENV", "PATH"} {
		recipe := validRecipeVars()
		recipe[foreign] = "anything"
		_, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
		if err == nil {
			t.Fatalf("a recipe carrying %s must be rejected whole", foreign)
		}
		if !strings.Contains(err.Error(), foreign) {
			t.Fatalf("the rejection for %s should name it, got %v", foreign, err)
		}
	}
}

func TestCloudModeVarsStripsExposure(t *testing.T) {
	recipe := validRecipeVars()
	recipe["DEPLOYMENT_EXPOSURE"] = "network"
	vars, stripped, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe with DEPLOYMENT_EXPOSURE should succeed by stripping it, got %v", err)
	}
	if _, present := vars["DEPLOYMENT_EXPOSURE"]; present {
		t.Fatal("DEPLOYMENT_EXPOSURE must not be written into the mode layer")
	}
	if len(stripped) != 1 || stripped[0] != "DEPLOYMENT_EXPOSURE" {
		t.Fatalf("the stripped set should be reported, got %v", stripped)
	}
}

func TestCloudModeVarsRequiresEveryRecipeVariable(t *testing.T) {
	recipe := validRecipeVars()
	delete(recipe, "OIDC_ISSUER")
	if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
		t.Fatal("a recipe missing a required variable must be an error, not a partial apply")
	}
}

func TestCloudModeVarsRejectsEmptyValue(t *testing.T) {
	// A present-but-blank OIDC value is the same broken-cloud boot a missing one is.
	recipe := validRecipeVars()
	recipe["OIDC_ISSUER"] = ""
	if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
		t.Fatal("a blank required value must be rejected")
	}
}

func TestCloudModeVarsRejectsControlCharValue(t *testing.T) {
	// A newline in a value would split into a second NAME=value line in the written file.
	recipe := validRecipeVars()
	recipe["OIDC_SCOPE"] = "openid\nENABLE_NOAUTH=true"
	if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
		t.Fatal("a value carrying a newline must be rejected")
	}
	// And the writer itself refuses it, independent of the caller.
	if err := writeModeLayer(filepath.Join(t.TempDir(), "mode.env"), map[string]string{"NODE_ENV": "production", "OIDC_ISSUER": "a\rb"}); err == nil {
		t.Fatal("writeModeLayer must refuse a value with a control character")
	}
}

func TestCloudModeVarsRejectsInsecureURL(t *testing.T) {
	// A plaintext, off-box content URL is an SSRF destination the URL guard exists to stop — a module
	// fetches its content from it, so the paste is rejected rather than written.
	recipe := validRecipeVars()
	recipe["MODULE_CONTENT_BASE_URL"] = "http://evil.example"
	if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
		t.Fatal("a plaintext non-localhost content URL must be rejected")
	}
	// https anywhere, and http on localhost, are both fine.
	for _, ok := range []string{"https://content.example", "http://127.0.0.1:9000", "http://localhost:9000"} {
		r := validRecipeVars()
		r["MODULE_CONTENT_BASE_URL"] = ok
		if _, _, err := cloudModeVars(r, "https://d.example/auth/callback", "/cache"); err != nil {
			t.Fatalf("%s should be accepted, got %v", ok, err)
		}
	}
}

func TestCloudModeVarsStripsRetiredCommerceURL(t *testing.T) {
	// A saved OLDER recipe may still carry COMMERCE_API_BASE_URL. It is retired: tolerated so the paste
	// still applies, but dropped rather than written — never rejected as a foreign variable, and never
	// carried into the mode layer.
	recipe := validRecipeVars()
	recipe["COMMERCE_API_BASE_URL"] = "https://commerce.example"
	vars, stripped, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe carrying the retired variable must still apply, got %v", err)
	}
	if _, ok := vars["COMMERCE_API_BASE_URL"]; ok {
		t.Fatal("COMMERCE_API_BASE_URL must not be written to the mode layer")
	}
	found := false
	for _, s := range stripped {
		if s == "COMMERCE_API_BASE_URL" {
			found = true
		}
	}
	if !found {
		t.Fatalf("COMMERCE_API_BASE_URL must be reported as stripped, got %v", stripped)
	}
}

func TestModeFileIntent(t *testing.T) {
	dir := t.TempDir()

	// A console-written cloud file carries OIDC_SHARED_POOL — that is what tells it apart from an
	// operator's own-IdP file, which is also NODE_ENV=production.
	cloud, _, err := cloudModeVars(validRecipeVars(), "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	cloudPath := filepath.Join(dir, "cloud.env")
	if err := writeModeLayer(cloudPath, cloud); err != nil {
		t.Fatal(err)
	}
	if got := modeFileIntent(cloudPath); got != intentCloud {
		t.Fatalf("a cloud file must be intentCloud, got %d", got)
	}

	purePath := filepath.Join(dir, "pure.env")
	if err := writeModeLayer(purePath, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	if got := modeFileIntent(purePath); got != intentPureOSS {
		t.Fatalf("the pure-OSS file must be intentPureOSS, got %d", got)
	}

	// An operator's own-IdP file: production, OIDC_* present, but NO shared-pool variable. The
	// console did not write it, so it is intentNone — not misread as its own cloud file.
	ownIdP := filepath.Join(dir, "own.env")
	if err := writeModeLayer(ownIdP, map[string]string{"NODE_ENV": "production", "OIDC_ISSUER": "https://idp.example"}); err != nil {
		t.Fatal(err)
	}
	if got := modeFileIntent(ownIdP); got != intentNone {
		t.Fatalf("an own-IdP file must be intentNone, got %d", got)
	}

	if got := modeFileIntent(filepath.Join(dir, "missing.env")); got != intentNone {
		t.Fatalf("a missing file must be intentNone, got %d", got)
	}
}

func TestCloudModeVarsAddsDerivedAndNothingElse(t *testing.T) {
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/graph/cache")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vars["NODE_ENV"] != "production" {
		t.Fatalf("NODE_ENV must be production, got %q", vars["NODE_ENV"])
	}
	if vars["OIDC_REDIRECT_URI"] != "https://front.example/auth/callback" {
		t.Fatalf("OIDC_REDIRECT_URI must be the confirmed value, got %q", vars["OIDC_REDIRECT_URI"])
	}
	if vars["MODULE_CONTENT_CACHE_DIR"] != "/graph/cache" {
		t.Fatalf("MODULE_CONTENT_CACHE_DIR must be the realization constant, got %q", vars["MODULE_CONTENT_CACHE_DIR"])
	}
	// ALLOWED_ORIGINS is the origin of the confirmed redirect (front door) — the path is dropped.
	if vars["ALLOWED_ORIGINS"] != "https://front.example" {
		t.Fatalf("ALLOWED_ORIGINS must be the redirect's origin, got %q", vars["ALLOWED_ORIGINS"])
	}
	// Exactly the ten recipe variables plus the four the console supplies — no more.
	want := []string{
		"ALLOWED_ORIGINS", "DEPLOYMENT_ALLOWLIST", "MODULE_CONTENT_BASE_URL",
		"MODULE_CONTENT_CACHE_DIR", "NODE_ENV", "OIDC_AUDIENCE", "OIDC_CLIENT_ID", "OIDC_DOMAIN",
		"OIDC_ISSUER", "OIDC_JWKS_URI", "OIDC_REDIRECT_URI", "OIDC_SCOPE", "OIDC_SHARED_POOL", "PORTAL_ORIGIN",
	}
	got := make([]string, 0, len(vars))
	for n := range vars {
		got = append(got, n)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("mode layer keys wrong:\n got  %v\n want %v", got, want)
	}
}

func TestCloudModeVarsAllowedOriginsKeepsPort(t *testing.T) {
	// A loopback front door on a non-default port: ALLOWED_ORIGINS must carry the port and drop the path.
	vars, _, err := cloudModeVars(validRecipeVars(), "http://127.0.0.1:3000/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vars["ALLOWED_ORIGINS"] != "http://127.0.0.1:3000" {
		t.Fatalf("ALLOWED_ORIGINS must keep the port and drop the path, got %q", vars["ALLOWED_ORIGINS"])
	}
}

func TestValidateRedirectURI(t *testing.T) {
	ok := []string{
		"https://byodt.example/auth/callback",
		"http://localhost:3000/auth/callback",
		"http://127.0.0.1:3000/auth/callback",
		"http://[::1]:3000/auth/callback",
	}
	for _, u := range ok {
		if err := validateRedirectURI(u); err != nil {
			t.Fatalf("%q should be accepted, got %v", u, err)
		}
	}
	bad := []string{
		"http://byodt.example/auth/callback", // plain http on a non-loopback host
		"ftp://byodt.example/x",
		"not-a-url",
		"",
		"/auth/callback", // relative, no host
	}
	for _, u := range bad {
		if err := validateRedirectURI(u); err == nil {
			t.Fatalf("%q should be rejected", u)
		}
	}
}

func TestWriteDetectAndRevertModeLayer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mode.env")

	// Write a cloud layer and detect it.
	vars, _, err := cloudModeVars(validRecipeVars(), "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeModeLayer(path, vars); err != nil {
		t.Fatal(err)
	}
	if !isCloudModeFile(path) {
		t.Fatal("a written cloud layer must be detected as cloud")
	}
	// Round-trips through the reader.
	back, err := readModeLayer(path)
	if err != nil {
		t.Fatal(err)
	}
	if back["OIDC_ISSUER"] != vars["OIDC_ISSUER"] || back["NODE_ENV"] != "production" {
		t.Fatalf("read-back mismatch: %#v", back)
	}
	// No temp file is left beside it (atomic write).
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("the temp file must be renamed away, not left on disk")
	}

	// Revert rewrites the SAME file with pure-OSS values — it must not delete it.
	if err := writeModeLayer(path, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("the mode file must survive a revert (rewritten, never deleted)")
	}
	if isCloudModeFile(path) {
		t.Fatal("after a revert the file must not read as cloud")
	}
	pure, _ := readModeLayer(path)
	if pure["NODE_ENV"] != "development" || pure["ENABLE_NOAUTH"] != "true" {
		t.Fatalf("pure-OSS layer wrong: %#v", pure)
	}
}

func TestIsCloudModeFileOnMissingIsFalse(t *testing.T) {
	if isCloudModeFile(filepath.Join(t.TempDir(), "does-not-exist.env")) {
		t.Fatal("a missing mode file must read as not-cloud, so the write guard permits an apply")
	}
}

// OIDC_DOMAIN is the hosted-UI host the SPA turns into the authorization endpoint the operator's
// browser is sent to. It is not a URL, so secureURL does not cover it — but a value carrying its own
// scheme would name that endpoint outright, so it is held to the bare-host shape the recipe producer
// already contracts. The last case is the one a scheme check alone would miss: a host that merely
// begins with those four letters is legitimate and must still be accepted.
func TestCloudModeVarsHoldsOIDCDomainToABareHost(t *testing.T) {
	for _, bad := range []string{
		"http://attacker.example",
		"https://attacker.example",
		"auth.example.com/path",
		"auth.example.com:8443",
		"auth.example.com?x=1",
		"auth.example.com#f",
		"auth example.com",
		// Userinfo: a browser resolves this to attacker.example while reading plausibly.
		"auth.example.com@attacker.example",
		"auth.example.com\\attacker.example",
	} {
		recipe := validRecipeVars()
		recipe["OIDC_DOMAIN"] = bad
		if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
			t.Fatalf("OIDC_DOMAIN %q must be rejected — the SPA builds an endpoint from it", bad)
		}
	}

	for _, good := range []string{
		"auth.example.com",
		"pfx.auth.eu-west-1.amazoncognito.com",
		"httpbin.example.com", // begins with "http" and is a perfectly ordinary host
	} {
		recipe := validRecipeVars()
		recipe["OIDC_DOMAIN"] = good
		if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err != nil {
			t.Fatalf("OIDC_DOMAIN %q is a bare host and must be accepted: %v", good, err)
		}
	}
}
