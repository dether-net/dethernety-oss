package daemoncmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// The admin gate's tests. Every one of them drives a real console over HTTP against a real (fake) content
// service, because what the gate decides depends on a file on disk, a header on the request and an answer
// from the cloud, and a unit test of the predicate alone would prove none of the three are wired.
//
// THE EXISTING SUITE CANNOT COVER THIS, and that is worth stating rather than discovering. Every test that
// predates the gate builds its deployment from validRecipeVars(), which carries no DEPLOYMENT_TEAM_ID — so
// every one of them takes the gate's team-less pass-through and stays green no matter what the rest of the
// gate does. These tests are the only thing standing between the gate and a silent no-op.

// gatedRoute is one deployment-changing route plus a request shape that reaches the gate and, if the gate
// lets it through, stops in the handler at a recognisably different answer.
type gatedRoute struct {
	name   string
	method string
	path   string
	body   string
	// openStatus is what the HANDLER answers once the gate has admitted the request. None of them is a
	// gate status, which is what makes "was it gated" decidable from one response.
	//
	// ASSERTING IT IS NOT OPTIONAL, and every pass-through test below asserts it. `!isGateRefusal(body)` on
	// its own is satisfied by a 500, an empty body, or any other failure — so a test that checks only the
	// absence of a refusal SENTENCE passes on a branch that has stopped calling the handler at all. Every
	// branch of this gate that must call through is one whose failure is a lockout, which is the last place
	// to accept an assertion that cannot tell "admitted" from "broke".
	openStatus int
	// localStatus is what the route answers on a PRE-CLOUD deployment, where the gate must be silent and the
	// handler's own posture check speaks instead. It differs per route — mount, unmount and remove refuse a
	// non-cloud deployment, install refuses its body, disconnect reverts — which is why the local test needs
	// its own expectation rather than openStatus.
	localStatus int
}

// gatedRoutes is every route the gate wraps. Named rather than counted, deliberately: a requirement
// phrased as "the gated routes" is exactly how one gets dropped when a new mutating route is added.
func gatedRoutes() []gatedRoute {
	return []gatedRoute{
		// An unmount of a key nothing mounted: valid enough to pass the handler's own validation, absent
		// enough to stop at 404. The cleanest probe here — it separates the gate from the handler with no
		// side effect at all.
		{"unmount", http.MethodDelete, "/api/modules/absent-module", "", http.StatusNotFound, http.StatusConflict},
		// A mount with an empty object: the gate runs first, then the handler refuses the missing key.
		{"mount", http.MethodPost, "/api/modules", `{}`, http.StatusBadRequest, http.StatusConflict},
		{"install", http.MethodPost, "/api/artifacts", `{}`, http.StatusBadRequest, http.StatusConflict},
		{"remove", http.MethodDelete, "/api/artifacts/absent-artifact", "", http.StatusNotFound, http.StatusConflict},
		// Disconnect actually disconnects when admitted. Every fixture owns its own mode file, so that is
		// contained — and it is the honest probe, since a disconnect that is admitted is the whole hazard.
		{"disconnect", http.MethodDelete, "/api/cloud", "", http.StatusOK, http.StatusOK},
		// The allowlist-only apply, with an empty body. It decodes cleanly, so the gate runs first and the
		// handler then refuses the empty list — a HANDLER status, reached only if the gate admitted, and
		// independent of whether the session carries a subject (which the fixtures' sessions do not).
		// Adding it here rather than giving it a gate test of its own is what makes "the sixth gated route"
		// a fact: every case below now runs against it too.
		{"change the access list", http.MethodPost, "/api/cloud/allowlist", `{}`, http.StatusBadRequest, http.StatusConflict},
	}
}

// gateFixture is a running console in cloud posture, plus the content service its gate asks.
type gateFixture struct {
	base    string
	session string
	s       *server
	// asked counts /v1/entitlements requests, so a test can prove the gate asked — or prove it did not.
	asked *atomic.Int32
	// teamHeader is the team the last entitled request named, so a test can prove the question was scoped.
	teamHeader *atomic.Value
}

// gateOptions describes the deployment and the cloud a fixture stands up.
type gateOptions struct {
	// team is the DEPLOYMENT_TEAM_ID the recipe carries. Empty means the recipe carries none, which is the
	// state of every deployment that has not re-applied a recipe since the variable was introduced.
	team string
	// noContentScope drops the content scope from OIDC_SCOPE, which is the permanent could-not-ask case.
	noContentScope bool
	// entitlements is the body /v1/entitlements answers with. Empty means an administrator.
	entitlements string
	// contentStatus is the status /v1/entitlements answers with. Zero means 200.
	contentStatus int
	// noContentService closes the content service before the test runs, which is an outage.
	noContentService bool
	// localPosture writes no cloud mode file at all, so the deployment is pre-cloud.
	localPosture bool
	// malformedTeam writes a DEPLOYMENT_TEAM_ID the read-side validator rejects. Reachable by editing the
	// mode file, and by any future drift in what a team identifier is allowed to look like.
	malformedTeam bool
	// unusableContentBase hand-edits the mode file to a content base the read-side validator rejects,
	// which is the state a deployment reaches only by somebody editing the file on the host.
	unusableContentBase bool
	// refuseToBeAsked fails the test if the content service is dialled. It is the anti-vacuity guard for
	// every case that must decide locally: without it, "the gate let this through" and "the gate asked and
	// happened to be told yes" are the same green.
	refuseToBeAsked bool
}

const adminAnswer = `{"protocol":"1","packages":[{"key":"acme-cloud"}],"admin":true}`

func newGateFixture(t *testing.T, opt gateOptions) gateFixture {
	t.Helper()
	asked := &atomic.Int32{}
	team := &atomic.Value{}
	team.Store("")

	content := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if opt.refuseToBeAsked {
			t.Errorf("the content service was dialled, and this deployment must decide locally: %s", r.URL.Path)
		}
		asked.Add(1)
		team.Store(r.Header.Get("x-deployment-team"))
		body := opt.entitlements
		if body == "" {
			body = adminAnswer
		}
		status := opt.contentStatus
		if status == 0 {
			status = http.StatusOK
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	if opt.noContentService {
		content.Close()
	} else {
		t.Cleanup(content.Close)
	}

	plat := fakePlatform(t, false, nil)
	t.Cleanup(plat.Close)
	s := newTestServer(t, plat.URL, filepath.Join(t.TempDir(), "state.json"))
	s.cfg.ModulesDir = t.TempDir()

	if !opt.localPosture {
		recipe := validRecipeVars()
		recipe["MODULE_CONTENT_BASE_URL"] = content.URL
		if opt.team != "" {
			recipe["DEPLOYMENT_TEAM_ID"] = opt.team
		}
		if opt.noContentScope {
			recipe["OIDC_SCOPE"] = "openid profile email"
		}
		vars, _, err := cloudModeVars(recipe, "https://front.example/auth/callback", "/cache")
		if err != nil {
			t.Fatal(err)
		}
		if opt.malformedTeam {
			// After cloudModeVars, for the same reason the base is: the write path refuses this value.
			vars["DEPLOYMENT_TEAM_ID"] = "team.acme"
		}
		if opt.unusableContentBase {
			// Written AFTER cloudModeVars has validated the recipe, because the write path would refuse
			// this value — which is the point: the only way to reach this state is to edit the file, and
			// the console re-validates on read precisely because the mode layer is a file on the
			// operator's host rather than console-private state.
			vars["MODULE_CONTENT_BASE_URL"] = "http://not-loopback.example"
		}
		if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
			t.Fatal(err)
		}
	}

	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	return gateFixture{base: ts.URL, session: signIn(t, s), s: s, asked: asked, teamHeader: team}
}

// call drives one gated route with the session and, unless token is empty, the operator's access token.
func (f gateFixture) call(t *testing.T, rt gatedRoute, token string) (int, string) {
	t.Helper()
	var r *strings.Reader
	if rt.body != "" {
		r = strings.NewReader(rt.body)
	}
	var body io.Reader
	if r != nil {
		body = r
	}
	req, err := http.NewRequest(rt.method, f.base+rt.path, body)
	if err != nil {
		t.Fatal(err)
	}
	if r != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(sessionHeader, f.session)
	if token != "" {
		req.Header.Set(cloudTokenHeader, token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	// io.ReadAll, and never a single Read into a fixed buffer. Read may return a short count on a perfectly
	// healthy response, and every assertion here matches a ~180-byte refusal sentence as a substring — so a
	// partial read makes isGateRefusal answer false, and the test asserting an administrator was ADMITTED
	// passes on a response that refused them. A vacuity bug that fires at random is worse than one that
	// fires always.
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading the response body: %v", err)
	}
	return resp.StatusCode, string(b)
}

// isGateRefusal reports whether a response is one the GATE produced rather than the handler. Matching the
// sentence rather than the status is deliberate: 409 and 404 are answers the handlers give for reasons of
// their own, so status alone cannot tell "the gate refused" from "the gate admitted and the handler
// refused" — which is the exact confusion these tests exist to prevent.
func isGateRefusal(body string) bool {
	for _, ref := range []adminRefusal{notAnAdmin, couldNotCheck, notSignedIn, cannotEverCheck} {
		if strings.Contains(body, ref.detail) {
			return true
		}
	}
	return false
}

const goodToken = "acc-tok"

func TestAdminGateRefusesEveryDeploymentChangingRouteForANonAdmin(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{
				team:         sampleTeamID,
				entitlements: `{"protocol":"1","packages":[{"key":"acme-cloud"}],"admin":false}`,
			})
			status, body := f.call(t, rt, goodToken)
			if status != http.StatusForbidden {
				t.Fatalf("a non-admin must be refused 403 on %s, got %d %s", rt.name, status, body)
			}
			if !strings.Contains(body, notAnAdmin.detail) {
				t.Fatalf("the refusal must name the role and who can grant it, got %q", body)
			}
			if f.asked.Load() == 0 {
				t.Fatal("the gate must ask the cloud rather than deciding from anything local")
			}
		})
	}
}

func TestAdminGateAdmitsAnAdministratorOnEveryGatedRoute(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: sampleTeamID})
			status, body := f.call(t, rt, goodToken)
			if isGateRefusal(body) {
				t.Fatalf("an administrator must not be refused by the gate on %s, got %d %s", rt.name, status, body)
			}
			if status != rt.openStatus {
				t.Fatalf("%s should have reached its handler and answered %d, got %d %s", rt.name, rt.openStatus, status, body)
			}
			if got := f.teamHeader.Load().(string); got != sampleTeamID {
				t.Fatalf("the gate must ask about THIS deployment's team, named %q, not %q", sampleTeamID, got)
			}
		})
	}
}

// THE REASON THE PROJECTION KEEPS A ROW FOR A TEAM THAT ENTITLES NOTHING, arriving at the surface it was
// kept for. An administrator whose team's subscription has lapsed is served no content and must still be
// able to act on the deployment — they are the one person who can go and fix the lapse. A gate that read
// "entitled to nothing" as "not an administrator" would lock them out at exactly the moment acting matters.
func TestAdminGateAdmitsAnAdministratorOfATeamThatEntitlesNothing(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:         sampleTeamID,
		entitlements: `{"protocol":"1","packages":[],"admin":true}`,
	})
	rt := gatedRoutes()[0]
	status, body := f.call(t, rt, goodToken)
	if isGateRefusal(body) {
		t.Fatalf("empty packages with admin true is a legal answer and must admit, got %d %s", status, body)
	}
	if status != rt.openStatus {
		t.Fatalf("a lapsed team's administrator must reach the handler and get %d, got %d %s", rt.openStatus, status, body)
	}
}

// An OMITTED admin field is false, never "unknown, so allow". The service omits it rather than unioning it
// whenever it cannot scope the field to one team, so the omitted case is precisely the one where guessing
// generously would offer destructive controls to somebody the service declined to vouch for.
func TestAdminGateReadsAnOmittedAdminFieldAsFalse(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:         sampleTeamID,
		entitlements: `{"protocol":"1","packages":[{"key":"acme-cloud"}]}`,
	})
	status, body := f.call(t, gatedRoutes()[0], goodToken)
	if status != http.StatusForbidden || !strings.Contains(body, notAnAdmin.detail) {
		t.Fatalf("an omitted admin field must read as false, got %d %s", status, body)
	}
}

// NO GATE REFUSAL MAY BE 401. The SPA answers any 401 by clearing the session and dropping into its
// session-expired path, so a gate that refused with one would sign an operator out of their own console
// for not being an administrator — or for a passing cloud outage.
func TestNoGateRefusalIsEver401(t *testing.T) {
	cases := []struct {
		name string
		opt  gateOptions
		want int
	}{
		{"not an admin", gateOptions{team: sampleTeamID, entitlements: `{"protocol":"1","packages":[],"admin":false}`}, http.StatusForbidden},
		{"cloud unreachable", gateOptions{team: sampleTeamID, noContentService: true}, http.StatusServiceUnavailable},
		{"cloud refuses", gateOptions{team: sampleTeamID, contentStatus: http.StatusUnauthorized, entitlements: `{}`}, http.StatusServiceUnavailable},
		{"can never ask", gateOptions{team: sampleTeamID, noContentScope: true}, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, tc.opt)
			// Mount rather than disconnect: disconnect is the one route with a carve-out, and this
			// property must hold on a route that has none.
			status, body := f.call(t, gatedRoutes()[1], goodToken)
			if status == http.StatusUnauthorized {
				t.Fatalf("a gate refusal must never be 401 — it would sign the operator out. Got %s", body)
			}
			// AND THE GATE MUST ACTUALLY HAVE SPOKEN. `status != 401` alone is true of a completely
			// ungated console — mount answers 400 on its empty body either way — so without this the four
			// subtest names claim to exercise arms the assertion cannot observe.
			if status != tc.want {
				t.Fatalf("expected the gate to answer %d here, got %d %s", tc.want, status, body)
			}
			if !isGateRefusal(body) {
				t.Fatalf("expected a gate refusal, got %d %s", status, body)
			}
		})
	}
}

// "I cannot check" and "you are not an administrator" have opposite remedies — wait and retry, versus ask
// a colleague — and collapsing them produces the support ticket this gate exists to avoid.
func TestAdminGateRefusesWithADistinctSentenceWhenTheCloudCannotBeReached(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID, noContentService: true})
	status, body := f.call(t, gatedRoutes()[1], goodToken)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("an unreachable cloud must refuse 503, not %d: %s", status, body)
	}
	if strings.Contains(body, notAnAdmin.detail) {
		t.Fatal("an outage must not be reported as a missing role — the remedies are opposite")
	}
	if !strings.Contains(body, couldNotCheck.detail) {
		t.Fatalf("the refusal must say the check failed, got %q", body)
	}
}

// Refused BEFORE the call, so a tab whose tokens are gone never dials the content service carrying a bare
// "Bearer " and no credential.
func TestAdminGateRefusesWithoutTheOperatorTokenAndDoesNotDialTheCloud(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID, refuseToBeAsked: true})
	status, body := f.call(t, gatedRoutes()[1], "")
	// 412, not 503: the remedy is a different control, and an interface that cannot tell "wait" from
	// "sign in" can only offer the wrong one.
	if status != http.StatusPreconditionFailed || !strings.Contains(body, notSignedIn.detail) {
		t.Fatalf("a request with no operator token must be refused 412 with the sign-in sentence, got %d %s", status, body)
	}
	if f.asked.Load() != 0 {
		t.Fatal("the console must not dial the content service with no credential to send")
	}
}

// THE ESCAPE, AND ITS BOUNDARY. A deployment whose recipe omits the content scope can never obtain a usable
// content token, so the gate would refuse it forever — and the operation an operator reaches for to fix a
// bad recipe is disconnect. It alone proceeds; extending the carve-out to the rest would ungate every
// deployment-changing route on any mis-scoped deployment, which is a blanket bypass rather than a recovery.
func TestOnlyDisconnectProceedsWhenTheDeploymentCanNeverCheck(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: sampleTeamID, noContentScope: true, refuseToBeAsked: true})
			status, body := f.call(t, rt, goodToken)
			if rt.name == "disconnect" {
				if isGateRefusal(body) {
					t.Fatalf("disconnect must never be permanently refusable, got %d %s", status, body)
				}
				// AND IT MUST HAVE REACHED THE HANDLER. Asserting only the absence of a refusal sentence
				// is satisfied by a 500 — so this branch, whose failure is the lockout the whole carve-out
				// exists to prevent, was previously pinned by nothing at all.
				if status != rt.openStatus {
					t.Fatalf("disconnect must have reached its handler and answered %d, got %d %s", rt.openStatus, status, body)
				}
				return
			}
			if status != http.StatusConflict || !strings.Contains(body, cannotEverCheck.detail) {
				t.Fatalf("%s must be refused 409 with the permanent-configuration sentence, got %d %s", rt.name, status, body)
			}
			if strings.Contains(body, couldNotCheck.detail) {
				t.Fatal("a permanent fault must not be reported as one worth retrying")
			}
		})
	}
}

// A DEPLOYMENT THAT NAMES NO TEAM IS NOT GATED, and behaves exactly as it did before the gate existed.
//
// The team identifier is an optional recipe variable and absent means behave as today. Gating here would
// refuse every operator with the WRONG sentence: the service cannot scope `admin` to a team the request did
// not name, so it omits the field, and the caller would be told "you are not an administrator" when what is
// missing is a line in their recipe. The console knows this locally and declines to ask a question whose
// answer it would misread.
func TestAdminGateDoesNotApplyWhenTheDeploymentNamesNoTeam(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{refuseToBeAsked: true})
			status, body := f.call(t, rt, goodToken)
			if isGateRefusal(body) {
				t.Fatalf("a deployment that names no team must not be gated on %s, got %d %s", rt.name, status, body)
			}
			if status != rt.openStatus {
				t.Fatalf("%s should have behaved exactly as before the gate and answered %d, got %d %s", rt.name, rt.openStatus, status, body)
			}
		})
	}
}

// A local, pre-cloud session carries no identity at all — the console mints it with no credential, on
// single-user host trust. There is no subject, no team and no cloud to ask, and a role check where no roles
// exist would lock an operator out of their own console before they had anything to lose.
func TestAdminGateDoesNotApplyInLocalPosture(t *testing.T) {
	f := newGateFixture(t, gateOptions{localPosture: true, refuseToBeAsked: true})
	// Mount and unmount refuse a non-cloud deployment on their own, which is the pre-existing behaviour and
	// is not a gate refusal. What must not happen is the gate speaking at all.
	for _, rt := range gatedRoutes() {
		status, body := f.call(t, rt, goodToken)
		if isGateRefusal(body) {
			t.Fatalf("the gate must be silent on a local deployment, but %s answered %d %s", rt.name, status, body)
		}
		// Positively, and per route: mount, unmount and remove refuse a non-cloud deployment on their own
		// (409), install refuses its empty body (400), disconnect reverts (200). Asserting only that no
		// refusal SENTENCE appeared would pass on a gate that answered 500 here — and this is the arm whose
		// failure locks an operator out of a pure-OSS console entirely, before they have anything to lose.
		if status != rt.localStatus {
			t.Fatalf("on a local deployment %s must answer its own %d, got %d %s", rt.name, rt.localStatus, status, body)
		}
	}
}

// CONNECT IS NOT GATED, and must not be. It is the pre-cloud paste path and has no authenticated subject —
// there is nobody to check. Its safety comes from elsewhere: applying to a deployment that has already
// written its cloud file is refused, so reconfiguring a connected deployment means disconnecting first, and
// disconnect is gated.
func TestConnectIsNotAdminGated(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:            sampleTeamID,
		entitlements:    `{"protocol":"1","packages":[],"admin":false}`,
		refuseToBeAsked: true,
	})
	status, body := send(t, http.MethodPost, f.base+"/api/cloud", f.session, applyBody("https://front.example/auth/callback"))
	if isGateRefusal(body) {
		t.Fatalf("connect must not be admin-gated, got %d %s", status, body)
	}
	// It is refused, but by its own write guard rather than by the gate — which is the compensating control
	// that lets connect stay ungated.
	if status != http.StatusConflict {
		t.Fatalf("connect on an already-cloud deployment must be refused 409 by its write guard, got %d %s", status, body)
	}
}

// NOTHING IS CACHED. An authorization answer honoured past the moment it was given is an unbounded grant to
// whoever can interrupt this deployment's network, and there is no latency here worth trading for it.
func TestAdminGateAsksTheCloudOnEveryRequest(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID})
	for i := 0; i < 3; i++ {
		if status, body := f.call(t, gatedRoutes()[0], goodToken); isGateRefusal(body) {
			t.Fatalf("request %d was refused: %d %s", i+1, status, body)
		}
	}
	if got := f.asked.Load(); got != 3 {
		t.Fatalf("the gate asked %d times for 3 requests — an answer was reused", got)
	}
}

// AN UNUSABLE CONTENT BASE IS A CONFIGURATION FAULT, NOT AN OUTAGE, and the difference is the whole of what
// this gate owes an operator. resolveEntitlements refuses an empty base before dialling and reports
// could-not-ask — correct for its own callers, and the wrong remedy here: it would answer "retry in a
// moment" to a deployment that has nowhere to send the question, every moment, forever. That is the same
// defect the content-scope check exists to prevent, one variable along.
func TestAnUnusableContentBaseIsThePermanentCaseAndNotAnOutage(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: sampleTeamID, unusableContentBase: true, refuseToBeAsked: true})
			status, body := f.call(t, rt, goodToken)
			if rt.name == "disconnect" {
				// Disconnect is what an operator reaches for to fix a broken recipe, and a recipe with an
				// unusable content host is a broken recipe.
				if isGateRefusal(body) {
					t.Fatalf("disconnect must stay available on a misconfigured deployment, got %d %s", status, body)
				}
				if status != rt.openStatus {
					t.Fatalf("disconnect must have reached its handler and answered %d, got %d %s", rt.openStatus, status, body)
				}
				return
			}
			if strings.Contains(body, couldNotCheck.detail) {
				t.Fatalf("%s was told to retry a check that can never succeed: %s", rt.name, body)
			}
			if status != http.StatusConflict || !strings.Contains(body, cannotEverCheck.detail) {
				t.Fatalf("%s must be refused 409 with the configuration sentence, got %d %s", rt.name, status, body)
			}
		})
	}
}

// THE DISPLAY PATH OBEYS THE SAME RULE AS THE GATE.
//
// A team-less caller gets a SUCCESSFUL read whose body carries no `admin` key — the service will not scope
// a field to a team the request did not name. That unmarshals to false, and false on this response is not a
// refusal, it is an instruction to the interface to disable every deployment-changing control. On a fleet
// where no recipe carries a team identifier yet, that is every control on every deployment, for owners
// included, while the gate itself admits all of them.
//
// The rule is "the console does not answer a question it declined to ask", and it has to hold on both
// halves. Getting it right on the enforcing half alone produces an interface that says "you may not" about
// an operation nobody is stopping.
func TestPackagesLeavesAdminUndeterminedWhenTheDeploymentNamesNoTeam(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		// No team, and a service answering exactly as one does to a team-less caller: packages, no `admin`.
		entitlements: `{"protocol":"1","packages":[{"key":"acme-cloud"}]}`,
	})
	req, _ := http.NewRequest(http.MethodGet, f.base+"/api/packages", nil)
	req.Header.Set(sessionHeader, f.session)
	req.Header.Set(cloudTokenHeader, goodToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	// Absent, not false. `omitempty` on a nil pointer drops the key, which is what the interface reads as
	// "could not ask" and refuses to gate on.
	if strings.Contains(body, `"admin"`) {
		t.Fatalf("a team-less deployment must carry NO admin answer, got %s", body)
	}
	// Anti-vacuity: the read must actually have succeeded, or this passes for the wrong reason.
	if !strings.Contains(body, `"entitled":true`) {
		t.Fatalf("the subscription read must still have succeeded, got %s", body)
	}
	if !strings.Contains(body, `"subscriptionTeamMissing":true`) {
		t.Fatalf("the deployment fault must still be reported to the operator, got %s", body)
	}
}

// And the answer IS carried when the deployment names a team, or the test above would pass on a console
// that had simply stopped reporting it.
func TestPackagesCarriesTheAdminAnswerWhenTheDeploymentNamesATeam(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{"administrator", adminAnswer, `"admin":true`},
		{"member", `{"protocol":"1","packages":[{"key":"acme-cloud"}],"admin":false}`, `"admin":false`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: sampleTeamID, entitlements: tc.body})
			req, _ := http.NewRequest(http.MethodGet, f.base+"/api/packages", nil)
			req.Header.Set(sessionHeader, f.session)
			req.Header.Set(cloudTokenHeader, goodToken)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			raw, _ := io.ReadAll(resp.Body)
			if !strings.Contains(string(raw), tc.want) {
				t.Fatalf("expected %s in the catalog answer, got %s", tc.want, raw)
			}
		})
	}
}

// A MALFORMED TEAM IDENTIFIER MUST NOT READ AS AN ABSENT ONE — this is the gate's own off-switch if it does.
//
// contentTargetFrom blanks an identifier this console will not use. Folded into "names no team", one
// mistyped character in the mode file — or one future drift in what a team identifier may look like, which
// would arrive fleet-wide from a generator — turns the gate off on every route at once. And it looks
// exactly like the supported pre-team state, so the only signal is a log line nobody reads.
//
// Absent is a compatibility state and must behave as before the gate existed. Malformed is a fault and gets
// the configuration answer, with disconnect keeping its carve-out because a broken recipe is precisely what
// disconnect is for.
func TestAMalformedTeamIdentifierIsAFaultAndNotAnAbsentOne(t *testing.T) {
	for _, rt := range gatedRoutes() {
		t.Run(rt.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{malformedTeam: true, refuseToBeAsked: true})
			status, body := f.call(t, rt, goodToken)
			if rt.name == "disconnect" {
				if isGateRefusal(body) {
					t.Fatalf("disconnect must stay available on a deployment with a bad recipe, got %d %s", status, body)
				}
				if status != rt.openStatus {
					t.Fatalf("disconnect must have reached its handler and answered %d, got %d %s", rt.openStatus, status, body)
				}
				return
			}
			if status == rt.openStatus {
				t.Fatalf("%s reached its handler, so a malformed identifier read as an absent one and the gate is off", rt.name)
			}
			if status != http.StatusConflict || !strings.Contains(body, cannotEverCheck.detail) {
				t.Fatalf("%s must be refused 409 with the configuration sentence, got %d %s", rt.name, status, body)
			}
		})
	}
}

// READS STAY OPEN, and nothing asserted it. The route table states the rule — "a member who cannot see what
// their deployment has is worse served than one who cannot change it" — and a refactor that wrapped one
// HandleFunc line too many would satisfy every other test in this file while quietly gating the catalog.
func TestReadsAreNotAdminGated(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:         sampleTeamID,
		entitlements: `{"protocol":"1","packages":[{"key":"acme-cloud"}],"admin":false}`,
	})
	for _, path := range []string{"/api/packages", "/api/modules", "/api/state", "/api/mode"} {
		req, _ := http.NewRequest(http.MethodGet, f.base+path, nil)
		req.Header.Set(sessionHeader, f.session)
		req.Header.Set(cloudTokenHeader, goodToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if isGateRefusal(string(raw)) {
			t.Fatalf("%s is a read and must never be admin-gated, got %d %s", path, resp.StatusCode, raw)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s must answer 200 for a member, got %d %s", path, resp.StatusCode, raw)
		}
	}
}
