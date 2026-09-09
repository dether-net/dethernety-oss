package daemoncmd

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall/moduleinstalltest"
)

// A team identifier of the shape the issuer mints: an opaque base64url token.
const sampleTeamID = "9Xk2QpLm4RtZaB7cWvNfEg"

// The recipe variable is OPTIONAL, and both halves of that matter: a recipe carrying it must apply, and a
// recipe without it must apply too. Before this the first case was rejected wholesale — the console
// validates the name SET, so an unknown name refuses the entire apply.
func TestCloudModeVarsAcceptsATeamIDAndWritesIt(t *testing.T) {
	recipe := validRecipeVars()
	recipe["DEPLOYMENT_TEAM_ID"] = sampleTeamID

	vars, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe carrying a team id must apply, got %v", err)
	}
	if vars["DEPLOYMENT_TEAM_ID"] != sampleTeamID {
		t.Fatalf("team id = %q, want %q", vars["DEPLOYMENT_TEAM_ID"], sampleTeamID)
	}

	// It has to survive the WRITE, not merely the validation — the mode layer on disk is what every
	// reader sees, and nothing else in this suite asserts that an optional variable reaches it.
	path := t.TempDir() + "/mode.env"
	if err := writeModeLayer(path, vars); err != nil {
		t.Fatal(err)
	}
	back, err := readModeLayer(path)
	if err != nil {
		t.Fatal(err)
	}
	if back["DEPLOYMENT_TEAM_ID"] != sampleTeamID {
		t.Fatalf("written mode layer holds %q, want %q", back["DEPLOYMENT_TEAM_ID"], sampleTeamID)
	}
}

func TestCloudModeVarsStillAppliesWithoutATeamID(t *testing.T) {
	vars, _, err := cloudModeVars(validRecipeVars(), "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("a recipe without a team id must still apply, got %v", err)
	}
	if _, present := vars["DEPLOYMENT_TEAM_ID"]; present {
		t.Fatal("no team id was offered, so none may be written")
	}
}

// Empty is dropped rather than written, so absence is the only state meaning "no team named". Writing an
// empty value would make behaviour depend on how each reader treats an empty string.
func TestCloudModeVarsDropsAnEmptyTeamID(t *testing.T) {
	recipe := validRecipeVars()
	recipe["DEPLOYMENT_TEAM_ID"] = ""

	vars, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
	if err != nil {
		t.Fatalf("an empty optional value must not refuse the apply, got %v", err)
	}
	if _, present := vars["DEPLOYMENT_TEAM_ID"]; present {
		t.Fatal("an empty team id must be dropped, not written")
	}
}

// The value leaves the console again as a request header, so the shape is what keeps a hostile recipe
// from writing a second header rather than a value.
func TestCloudModeVarsRefusesAMalformedTeamID(t *testing.T) {
	for _, bad := range []string{
		"has a space",
		"has@at",
		"has/slash",
		"trailing\r\nX-Injected: yes",
		strings.Repeat("a", 65),
	} {
		recipe := validRecipeVars()
		recipe["DEPLOYMENT_TEAM_ID"] = bad
		_, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache")
		if err == nil {
			t.Fatalf("%q must be refused", bad)
		}
		// The message is the only place the operator learns which variable was wrong.
		if !strings.Contains(err.Error(), "DEPLOYMENT_TEAM_ID") {
			t.Fatalf("refusal for %q does not name the variable: %v", bad, err)
		}
	}
	// The exact length the issuer mints is well inside the bound, and so is the bound itself.
	for _, good := range []string{sampleTeamID, "a", strings.Repeat("a", 64), "A-Za-z0-9_-"} {
		recipe := validRecipeVars()
		recipe["DEPLOYMENT_TEAM_ID"] = good
		if _, _, err := cloudModeVars(recipe, "https://d.example/auth/callback", "/cache"); err != nil {
			t.Fatalf("%q must be accepted, got %v", good, err)
		}
	}
}

// cloudModeVars guards what the console WRITES. This guards what it reads back — the case that path
// cannot see, because the mode layer is a file on the operator's host and can be edited after the fact.
// A bad value must not strand the deployment at boot: the call still goes out, naming no team. What that
// then costs is the content service's business — it answers such a call transitionally and refuses it
// once it enforces — so this is a choice about where the failure surfaces, not a way of avoiding one.
// The packages handler reports the same fact to the operator through subscriptionTeamMissing.
func TestCloudContentTargetIgnoresAHandEditedTeamID(t *testing.T) {
	s := newTestServer(t, "http://platform.invalid", t.TempDir()+"/state.json")
	handEdited := map[string]string{
		"OIDC_SHARED_POOL":        "true",
		"MODULE_CONTENT_BASE_URL": "https://content.example",
		"DEPLOYMENT_TEAM_ID":      "not a team id",
	}
	if err := writeModeLayer(s.cfg.ModeLayerPath, handEdited); err != nil {
		t.Fatal(err)
	}
	base, team, ok := s.cloudContentTarget()
	if !ok {
		t.Fatal("a cloud mode layer must still read as cloud mode")
	}
	if base != "https://content.example" {
		t.Fatalf("base = %q; an unusable team id must not cost the base", base)
	}
	if team != "" {
		t.Fatalf("team = %q, want empty — an unusable identifier must read as no team", team)
	}
}

func TestCloudContentTargetReturnsBothFromOneRead(t *testing.T) {
	s := newTestServer(t, "http://platform.invalid", t.TempDir()+"/state.json")
	if err := writeModeLayer(s.cfg.ModeLayerPath, map[string]string{
		"OIDC_SHARED_POOL":        "true",
		"MODULE_CONTENT_BASE_URL": "https://content.example",
		"DEPLOYMENT_TEAM_ID":      sampleTeamID,
	}); err != nil {
		t.Fatal(err)
	}
	base, team, ok := s.cloudContentTarget()
	if !ok || base != "https://content.example" || team != sampleTeamID {
		t.Fatalf("cloudContentTarget() = %q, %q, %v", base, team, ok)
	}
}

// recordHeaders answers 200 with an empty JSON document and records every request's Authorization and
// team header, so a test can assert the relationship between them rather than either alone.
func recordHeaders(t *testing.T) (base string, auth, team *[]string) {
	t.Helper()
	gotAuth, gotTeam := &[]string{}, &[]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*gotAuth = append(*gotAuth, r.Header.Get("Authorization"))
		*gotTeam = append(*gotTeam, r.Header.Get(deploymentTeamHeader))
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, gotAuth, gotTeam
}

// THE RULE, asserted as the biconditional it is: the team header is sent if and only if a bearer token
// is. Stated this way rather than as two separate cases because the two must never drift apart.
func TestEntitledGetSendsTheTeamHeaderIffACredentialIsSent(t *testing.T) {
	for _, tc := range []struct {
		name       string
		token      string
		team       string
		wantHeader string
	}{
		{"credential and team", "tok", sampleTeamID, sampleTeamID},
		{"credential, no team", "tok", "", ""},
		{"team, no credential", "", sampleTeamID, ""},
		{"neither", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base, gotAuth, gotTeam := recordHeaders(t)
			if _, _, err := entitledGet(context.Background(), base, "/v1/entitlements", tc.token, tc.team, 1<<20); err != nil {
				t.Fatal(err)
			}
			if len(*gotTeam) != 1 {
				t.Fatalf("expected one request, saw %d", len(*gotTeam))
			}
			if (*gotTeam)[0] != tc.wantHeader {
				t.Fatalf("team header = %q, want %q", (*gotTeam)[0], tc.wantHeader)
			}
			// The biconditional, checked directly against what went out rather than against the inputs.
			sentCredential := (*gotAuth)[0] != "Bearer "
			sentTeam := (*gotTeam)[0] != ""
			if sentTeam && !sentCredential {
				t.Fatal("the team header went out on a request carrying no credential")
			}
		})
	}
}

// The credential-free surfaces identify nothing, and the absence is structural rather than conditional —
// publicGet has no team parameter to get wrong.
func TestPublicGetNeverSendsTheTeamHeader(t *testing.T) {
	base, gotAuth, gotTeam := recordHeaders(t)
	var out map[string]any
	if err := publicGet(context.Background(), base, "/v1/catalog/packages", &out); err != nil {
		t.Fatal(err)
	}
	if (*gotTeam)[0] != "" {
		t.Fatalf("catalog request carried a team header: %q", (*gotTeam)[0])
	}
	if (*gotAuth)[0] != "" {
		t.Fatalf("catalog request carried a credential: %q", (*gotAuth)[0])
	}
}

// The entitlements read is not the only entitled call. Artifact staging makes two — the descriptor and
// the archive — and both must name the team, or an artifact fetch would be the one entitled request that
// went out naming none: served from the cross-team union today, and refused outright once the service
// enforces. Either way it is the request that would be wrong while every other one was right.
func TestStageArtifactCarriesTheTeamOnBothFetches(t *testing.T) {
	archive, digest := genuineArchive(t)
	desc := fmt.Sprintf(`{"artifactKey":%q,"version":%q,"kind":"code-module",`+
		`"archive":{"format":"tar+gzip","size":%d,"digest":%q},`+
		`"signature":{"format":%q,"bundle":%q}}`,
		artifactKey, artifactVersion, len(archive), digest, artifactBundleFormat,
		base64.StdEncoding.EncodeToString([]byte("not-a-real-bundle")))

	var seen []string // the team header on each upstream request, in order
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}", func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get(deploymentTeamHeader))
		_, _ = w.Write([]byte(desc))
	})
	mux.HandleFunc("GET /v1/artifacts/{key}/versions/{version}/content", func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get(deploymentTeamHeader))
		_, _ = w.Write(archive)
	})
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)

	_, _, s := newArtifactServer(t, upstream.URL, signerPrefix, moduleinstalltest.FakeVerifier{})
	// newArtifactServer seeds the mode layer; the team joins it the way the signer does.
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	vars["DEPLOYMENT_TEAM_ID"] = sampleTeamID
	if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}

	staged, ref := s.stageArtifact(context.Background(), artifactKey, artifactVersion, "acc-tok")
	if ref != nil {
		t.Fatalf("staging must succeed, got %d %s", ref.status, ref.detail)
	}
	t.Cleanup(func() { discardStaging(staged.staging) })

	if len(seen) != 2 {
		t.Fatalf("staging makes two entitled fetches, saw %d", len(seen))
	}
	for i, got := range seen {
		if got != sampleTeamID {
			t.Fatalf("fetch %d carried team header %q, want %q", i+1, got, sampleTeamID)
		}
	}
}
