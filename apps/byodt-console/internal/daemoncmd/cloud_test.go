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

func TestCloudModeVarsRejectsUserinfoInEveryURLValue(t *testing.T) {
	// Every name held to secureURL, not just the content base: the producer's own bare-host contract
	// refuses a literal "@", and these are the two ends of one contract. A parsed-field check is what
	// misses it —
	// url.Parse leaves u.Host clean and puts the deception in u.User.
	for _, name := range secureURLVars {
		recipe := validRecipeVars()
		recipe[name] = "https://legit.example@attacker.example"
		if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err == nil {
			t.Fatalf("%s must reject a userinfo value — it names a host it does not resolve to", name)
		}
	}
}

func TestCloudModeVarsRejectsAUserinfoRedirect(t *testing.T) {
	// cloudApply validates the redirect before calling this, so the paste path is covered either way.
	// This pins the property that makes the check worth having HERE: the function writes the redirect
	// verbatim as OIDC_REDIRECT_URI and derives ALLOWED_ORIGINS from it, and redirectOrigin drops the
	// userinfo — so without the check the derived origin is the attacker's host, spelled plainly.
	redirect := "https://front.example@attacker.example/auth/callback"
	if _, _, err := cloudModeVars(validRecipeVars(), redirect, "/cache"); err == nil {
		t.Fatal("a userinfo redirect must be rejected before ALLOWED_ORIGINS is derived from it")
	}
}

func TestEveryRetiredNameIsAlsoStripped(t *testing.T) {
	// retiredRecipeVars is documented as a subset of strippedRecipeVars, and nothing enforced it.
	// partitionStripped only ever iterates names that already reached the stripped list, so a name in the
	// retired map alone is invisible — and one dropped from the retired map while staying stripped silently
	// starts telling the operator the console "kept this deployment's own" value it in fact discarded.
	for name := range retiredRecipeVars {
		if !strippedRecipeVars[name] {
			t.Errorf("%s is retired but not stripped — it would be rejected as a foreign variable, and a "+
				"saved recipe carrying it would stop applying", name)
		}
	}
	// And the split must stay non-trivial in the other direction: the kept side is what the operator's own
	// exposure declaration rides on, and folding everything into retired would drop that sentence.
	kept, retired := partitionStripped([]string{"DEPLOYMENT_EXPOSURE", "DEPLOYMENT_PACKAGES"})
	if len(kept) != 1 || kept[0] != "DEPLOYMENT_EXPOSURE" {
		t.Fatalf("the operator's own declaration must be reported as kept, got %v", kept)
	}
	if len(retired) != 1 || retired[0] != "DEPLOYMENT_PACKAGES" {
		t.Fatalf("a retired name must be reported as ignored rather than kept, got %v", retired)
	}
}

func TestCloudModeVarsStripsRetiredVariables(t *testing.T) {
	// A saved OLDER recipe may still carry a retired name — and for the second of these, so does every
	// recipe the producer is still issuing. Retired means tolerated so the paste still applies, dropped
	// rather than written: never rejected as a foreign variable, and never carried into the mode layer
	// where something could read it back.
	for name, value := range map[string]string{
		"COMMERCE_API_BASE_URL": "https://commerce.example",
		"DEPLOYMENT_PACKAGES":   "acme-cloud,other-pkg",
	} {
		t.Run(name, func(t *testing.T) {
			recipe := validRecipeVars()
			recipe[name] = value
			vars, stripped, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
			if err != nil {
				t.Fatalf("a recipe carrying the retired variable must still apply, got %v", err)
			}
			if _, ok := vars[name]; ok {
				t.Fatalf("%s must not be written to the mode layer", name)
			}
			found := false
			for _, s := range stripped {
				if s == name {
					found = true
				}
			}
			if !found {
				t.Fatalf("%s must be reported as stripped, got %v", name, stripped)
			}
		})
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
		// url.Parse lifts "front.example@" into u.User and leaves u.Host as attacker.example, so every
		// other check here passes a value that reads as one host and resolves to another.
		"https://front.example@attacker.example/auth/callback",
		// The reverse direction resolves to loopback and reads as a hostile host — refused for the
		// same reason, not because the loopback exception was widened (u.Hostname() strips userinfo).
		"http://attacker.example@localhost:3000/auth/callback",
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

// ── The artifact signer, as configuration ────────────────────────────────────────────────────────

// signerOK is a well-formed signer prefix: an https workflow path carrying no ref.
const signerOK = "https://github.example/acme/acme-artifacts/.github/workflows/publish-artifact.yml"

func TestArtifactSignerShape(t *testing.T) {
	if err := artifactSignerPrefix(signerOK); err != nil {
		t.Fatalf("a canonical prefix must be accepted, got %v", err)
	}
	if err := artifactSignerPrefix("https://github.example/acme/a/.github/workflows/p.yaml"); err != nil {
		t.Fatalf(".yaml must be accepted, got %v", err)
	}
	// Every row is either a value a PARSED-url check would have accepted — url.Parse lifts userinfo
	// into u.User, strips query and fragment out of u.Path, and lowercases the scheme — or a typo that
	// can never string-equal a real certificate subject. The table is the argument for checking raw.
	bad := map[string]string{
		"a configured ref":      signerOK + "@refs/tags/artifact/x/1.0.0",
		"userinfo":              "https://github.example@evil.example/a/b/.github/workflows/p.yml",
		"plaintext":             "http://github.example/a/b/.github/workflows/p.yml",
		"an uppercase scheme":   "HTTPS://github.example/a/b/.github/workflows/p.yml",
		"a query":               signerOK + "?x=1",
		"a fragment":            signerOK + "#x",
		"a trailing slash":      signerOK + "/",
		"a relative segment":    "https://github.example/a/b/../../.github/workflows/p.yml",
		"an embedded space":     "https://github.example/a/b/.github/workflows/p q.yml",
		"no workflows path":     "https://github.example/a/b/publish.yml",
		"no owner and repo":     "https://github.example/.github/workflows/p.yml",
		"a non-yaml suffix":     "https://github.example/a/b/.github/workflows/p.txt",
		"a second file segment": "https://github.example/a/b/.github/workflows/nested/p.yml",
		"empty":                 "",
	}
	for name, raw := range bad {
		if err := artifactSignerPrefix(raw); err == nil {
			t.Errorf("%s must be refused: %q", name, raw)
		}
	}
}

func TestRecipeWithoutTheArtifactSignerApplies(t *testing.T) {
	// Every recipe issued before the variable existed. This is the case that fails if it lands in
	// acceptedRecipeVars, which requires present-and-non-empty.
	vars, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe carrying no artifact signer must apply, got %v", err)
	}
	if v, present := vars["DEPLOYMENT_ARTIFACT_SIGNER"]; present && v != "" {
		t.Fatalf("no signer must be invented, got %q", v)
	}
}

func TestRecipeCopiesAGoodArtifactSignerVerbatim(t *testing.T) {
	recipe := validRecipeVars()
	recipe["DEPLOYMENT_ARTIFACT_SIGNER"] = signerOK
	vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vars["DEPLOYMENT_ARTIFACT_SIGNER"] != signerOK {
		t.Fatalf("the signer must survive verbatim, got %q", vars["DEPLOYMENT_ARTIFACT_SIGNER"])
	}
}

func TestRecipeRejectsABadArtifactSignerByName(t *testing.T) {
	recipe := validRecipeVars()
	recipe["DEPLOYMENT_ARTIFACT_SIGNER"] = signerOK + "@refs/tags/artifact/x/1.0.0"
	_, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
	if err == nil || !strings.Contains(err.Error(), "DEPLOYMENT_ARTIFACT_SIGNER") {
		t.Fatalf("the refusal must name the variable at fault, got %v", err)
	}
}
