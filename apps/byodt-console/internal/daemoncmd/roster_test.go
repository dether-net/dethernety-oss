package daemoncmd

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// The two admin-gated reads' own tests. What the gate table proves about them — refused for a non-admin,
// admitted for an administrator, 412 without a token, 409 on a deployment that can never check, never
// 401, asked afresh every time — it proves by running every gate case against both. What it cannot prove
// is what these hold: that the relay carries the members through unchanged and unlogged, that a document
// the console does not recognise is could-not-fetch and never an empty team, that each refusal from the
// service lands on the status whose remedy fits it, and that the team-less refusal is the reads' OWN rather
// than the gate's silence.

// readRoute drives one of the two reads with the fixture's session and, unless token is empty, the
// operator's access token.
func readRoute(t *testing.T, f gateFixture, path, token string) (int, string, http.Header) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.base+path, nil)
	if err != nil {
		t.Fatal(err)
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
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading the response body: %v", err)
	}
	return resp.StatusCode, string(b), resp.Header
}

// lockedLog is a log sink a test can read back. It exists so the no-log guarantee is a MECHANISM: every
// record the daemon emits during a relay lands here as text, and the assertion is a substring search over
// the whole of it — message, attributes and groups alike — for anything the relayed body carried.
type lockedLog struct {
	mu sync.Mutex
	b  strings.Builder
}

func (l *lockedLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// captureLog replaces the fixture's discarding logger with one the test can read, at every level, so a
// Debug line would be caught as readily as an Error.
func captureLog(f gateFixture) *lockedLog {
	sink := &lockedLog{}
	f.s.logger = slog.New(slog.NewTextHandler(sink, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return sink
}

// TestTheRelayCarriesEveryMemberThrough is the happy path, and the second member is the point: sub-b has
// no address, is a legal member the service serves as one, and is exactly the member a relay that "only
// forwards people it can render" would drop — showing a current colleague as having left the team.
func TestTheRelayCarriesEveryMemberThrough(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID})
	status, body, headers := readRoute(t, f, "/api/cloud/roster", goodToken)
	if status != http.StatusOK {
		t.Fatalf("an administrator must be served the roster, got %d %s", status, body)
	}
	var view rosterView
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("the relay must answer with a roster document: %v — %s", err, body)
	}
	want := []rosterMember{{Sub: "sub-a", Email: "anna@example.test"}, {Sub: "sub-b", Email: ""}}
	if len(view.Members) != len(want) {
		t.Fatalf("expected %d members, got %d: %s", len(want), len(view.Members), body)
	}
	for i := range want {
		if view.Members[i] != want[i] {
			t.Fatalf("member %d: expected %+v, got %+v", i, want[i], view.Members[i])
		}
	}
	// The service instructs the same on its own answer, for the same reason: a body naming people must not
	// be storable by anything between this process and the page.
	if got := headers.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("a roster must be answered no-store, got Cache-Control %q", got)
	}
	// It was fetched from the roster surface, scoped to THIS deployment's team — not answered from anything
	// local, and not from the entitlements surface the gate reads.
	if f.rosterAsked.Load() != 1 {
		t.Fatalf("the relay must have fetched the roster exactly once, fetched %d times", f.rosterAsked.Load())
	}
	if got := f.teamHeader.Load().(string); got != sampleTeamID {
		t.Fatalf("the roster must be fetched for this deployment's team %q, was fetched for %q", sampleTeamID, got)
	}
}

// TestTheRelayForwardsTwoFieldsAndNothingElse. The relay re-encodes what it parsed, so a field the service
// adds later about a person — a role, a join date — stops at this boundary rather than reaching the page by
// default. Widening what the page learns about a colleague is a decision, and this is the test that makes
// it one.
func TestTheRelayForwardsTwoFieldsAndNothingElse(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:   sampleTeamID,
		roster: `{"protocol":"1","members":[{"sub":"sub-a","email":"anna@example.test","role":"owner","joinedAt":"2026-09-01"}]}`,
	})
	status, body, _ := readRoute(t, f, "/api/cloud/roster", goodToken)
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", status, body)
	}
	for _, leaked := range []string{"role", "owner", "joinedAt", "2026-09-01"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("the relay forwarded %q, a field it does not define: %s", leaked, body)
		}
	}
	if !strings.Contains(body, "anna@example.test") {
		t.Fatalf("anti-vacuity: the member itself must still have been relayed, got %s", body)
	}
}

// TestBothReadsRefuseADeploymentThatNamesNoTeamForThemselves. The gate stands aside there, and a read
// that inherited that would be open to any session holder. The table's team-less case already pins the
// status; this pins the SENTENCE — the reads' own, about a recipe that predates team identifiers — and
// that neither read touched the content service on the way to it.
func TestBothReadsRefuseADeploymentThatNamesNoTeamForThemselves(t *testing.T) {
	for _, path := range []string{"/api/cloud/roster", "/api/cloud/allowlist"} {
		t.Run(path, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{refuseToBeAsked: true})
			status, body, _ := readRoute(t, f, path, goodToken)
			if status != http.StatusConflict {
				t.Fatalf("%s must refuse a team-less deployment 409, got %d %s", path, status, body)
			}
			if !strings.Contains(body, noTeamNamed.detail) {
				t.Fatalf("%s must refuse with its own sentence about the recipe, got %s", path, body)
			}
			if isGateRefusal(body) {
				t.Fatalf("%s must refuse for itself, not through the gate — the gate is silent here by design: %s", path, body)
			}
		})
	}
}

// TestTheTeamLessRefusalDoesNotDependOnTheGate. The route table wraps both reads in requireAdmin, and
// the test above passes through that wrapper. A handler that is correct only while wrapped is not correct,
// so this calls each handler bare — no gate at all — and expects the same refusal.
func TestTheTeamLessRefusalDoesNotDependOnTheGate(t *testing.T) {
	f := newGateFixture(t, gateOptions{refuseToBeAsked: true})
	for name, handler := range map[string]http.HandlerFunc{
		"roster":    f.s.cloudRoster,
		"allowlist": f.s.cloudAllowlistRead,
	} {
		t.Run(name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set(cloudTokenHeader, goodToken)
			rec := httptest.NewRecorder()
			handler(rec, req)
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), noTeamNamed.detail) {
				t.Fatalf("the bare %s handler must refuse a team-less deployment itself, got %d %s", name, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAnUnrecognisedRosterIsCouldNotFetchAndNeverAnEmptyTeam. Every row is a 200 whose body is not the
// document this console understands. A zero value unmarshals from all of them, and the zero value here is
// an empty roster — which the page would render as a team everybody has left. The only safe answer is the
// retry arm, and the body must carry none of the rows' content.
func TestAnUnrecognisedRosterIsCouldNotFetchAndNeverAnEmptyTeam(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"a future protocol revision", `{"protocol":"2","members":[{"sub":"sub-a","email":"anna@example.test"}]}`},
		{"no protocol marker", `{"members":[{"sub":"sub-a","email":"anna@example.test"}]}`},
		{"the marker without members", `{"protocol":"1"}`},
		{"a member naming no subject", `{"protocol":"1","members":[{"sub":"","email":"anna@example.test"}]}`},
		{"a gateway's own error shape", `{"message":"Internal server error"}`},
		{"not JSON at all", `<html>upstream</html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: sampleTeamID, roster: tc.body})
			status, body, _ := readRoute(t, f, "/api/cloud/roster", goodToken)
			if status != http.StatusServiceUnavailable || !strings.Contains(body, rosterUnavailable.detail) {
				t.Fatalf("an unrecognised document must be could-not-fetch, got %d %s", status, body)
			}
			if strings.Contains(body, `"members"`) {
				t.Fatalf("an unrecognised document must never be relayed as a team: %s", body)
			}
		})
	}
}

// TestEachRefusalFromTheServiceLandsOnTheStatusWhoseRemedyFits. The gate collapses every refusal into
// could-not-check because two sentences are all it owes; a relay that answered "try again" to a refusal
// that will repeat forever, or "reconnect" to a lapsed credential, would send the operator to the wrong
// control. And none of them may be 401, which the SPA answers by clearing the session.
func TestEachRefusalFromTheServiceLandsOnTheStatusWhoseRemedyFits(t *testing.T) {
	for _, tc := range []struct {
		name       string
		opt        gateOptions
		wantStatus int
		wantDetail string
	}{
		{"the service is down", gateOptions{team: sampleTeamID, noContentService: true}, http.StatusServiceUnavailable, rosterUnavailable.detail},
		{"the service is rate-limiting", gateOptions{team: sampleTeamID, rosterStatus: http.StatusTooManyRequests, roster: `{}`}, http.StatusServiceUnavailable, rosterUnavailable.detail},
		{"the service failed", gateOptions{team: sampleTeamID, rosterStatus: http.StatusBadGateway, roster: `{}`}, http.StatusServiceUnavailable, rosterUnavailable.detail},
		{"the service declined this sign-in", gateOptions{team: sampleTeamID, rosterStatus: http.StatusForbidden, roster: `{"code":"not_entitled"}`}, http.StatusBadGateway, rosterRefusedForThisSignIn.detail},
		{"the service does not know the route", gateOptions{team: sampleTeamID, rosterStatus: http.StatusNotFound, roster: `{}`}, http.StatusBadGateway, rosterRefusedForThisSignIn.detail},
		{"the credential lapsed", gateOptions{team: sampleTeamID, rosterStatus: http.StatusUnauthorized, roster: `{}`}, http.StatusPreconditionFailed, rosterSignInLapsed.detail},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, tc.opt)
			status, body, _ := readRoute(t, f, "/api/cloud/roster", goodToken)
			if tc.opt.noContentService {
				// The gate asks the same service first and refuses with its own sentence when it is down —
				// which is correct, and means the relay's own outage arm is reached only when the roster
				// call alone fails. That case is the two rows below; this one pins that an outage is still
				// answered "retry" from whichever of the two saw it.
				if status != http.StatusServiceUnavailable {
					t.Fatalf("an outage must be answered retry, got %d %s", status, body)
				}
				return
			}
			if status == http.StatusUnauthorized {
				t.Fatalf("never 401 — it would sign the operator out: %s", body)
			}
			if status != tc.wantStatus || !strings.Contains(body, tc.wantDetail) {
				t.Fatalf("expected %d with the fitting sentence, got %d %s", tc.wantStatus, status, body)
			}
			if isGateRefusal(body) {
				t.Fatalf("the refusal must be the relay's own, not the gate's: %s", body)
			}
		})
	}
}

// TestARefusalFromTheServiceIsNotRelayedAsNotAnAdministrator pins the one status the relay must not
// borrow. 403 from the daemon is the SPA's "you are not an administrator", and the gate has just confirmed
// the opposite; relaying the service's 403 would tell an administrator they are not one.
func TestARefusalFromTheServiceIsNotRelayedAsNotAnAdministrator(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID, rosterStatus: http.StatusForbidden, roster: `{"code":"not_entitled"}`})
	status, body, _ := readRoute(t, f, "/api/cloud/roster", goodToken)
	if status == http.StatusForbidden {
		t.Fatalf("a refusal from the service must not become 403 — the caller IS an administrator: %s", body)
	}
	if strings.Contains(body, notAnAdmin.detail) {
		t.Fatalf("the sentence must not claim the caller lacks a role they hold: %s", body)
	}
}

// TestNothingFromTheRosterReachesALogRecord is the no-log guarantee as a mechanism rather than a comment.
// A comment asking for it survives the edit that adds the log line; this does not. Every record emitted
// during a relay is captured, at every level, and searched for every address and every identifier the
// body carried — the caller's included, because the fixture's session carries no subject, so nothing in
// the gate's own audit line can legitimately match.
func TestNothingFromTheRosterReachesALogRecord(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID})
	sink := captureLog(f)
	status, body, _ := readRoute(t, f, "/api/cloud/roster", goodToken)
	if status != http.StatusOK {
		t.Fatalf("expected the relay to succeed, got %d %s", status, body)
	}
	logged := sink.String()
	// Anti-vacuity: the sink must have caught SOMETHING, or a logger swap that silently failed would pass
	// every assertion below. The gate's audit line is the record that is always there.
	if !strings.Contains(logged, "admin gate") {
		t.Fatalf("the capturing logger saw no records at all — the guard is not observing the daemon: %q", logged)
	}
	for _, secret := range []string{"anna@example.test", "sub-a", "sub-b", "example.test"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("the roster reached a log record — %q appears in:\n%s", secret, logged)
		}
	}
}

// TestNothingFromTheAccessListReachesALogRecord holds the list read to the same standard. The identifiers
// are not addresses, but they are the selection — who, of the team, may use this deployment — and that is
// the thing the whole feature keeps off the cloud. The console's own log is not the cloud, and it is still
// not a place the selection belongs.
func TestNothingFromTheAccessListReachesALogRecord(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID})
	sink := captureLog(f)
	status, body, _ := readRoute(t, f, "/api/cloud/allowlist", goodToken)
	if status != http.StatusOK {
		t.Fatalf("expected the read to succeed, got %d %s", status, body)
	}
	logged := sink.String()
	if !strings.Contains(logged, "admin gate") {
		t.Fatalf("the capturing logger saw no records at all: %q", logged)
	}
	// validRecipeVars carries sub-a and sub-b; both must be in the answer and neither in the log.
	for _, id := range []string{"sub-a", "sub-b"} {
		if !strings.Contains(body, id) {
			t.Fatalf("anti-vacuity: %q must be in the answer, got %s", id, body)
		}
		if strings.Contains(logged, id) {
			t.Fatalf("the access list reached a log record — %q appears in:\n%s", id, logged)
		}
	}
}

// TestTheListReadAnswersTheCanonicalListNoStore. The recipe carries "sub-a,sub-b"; the read answers the
// identifiers as a JSON list, de-duplicated and sorted whatever the file carries, and never null. The
// no-store instruction is the roster's, for the same reason one step removed.
func TestTheListReadAnswersTheCanonicalListNoStore(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID})
	// A file the apply did not write: unsorted, duplicated, space-separated (a newline would be a second
	// line, and the serializer refuses it). The read normalises the way the apply would, so the page
	// compares like with like.
	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	vars["DEPLOYMENT_ALLOWLIST"] = "sub-b, sub-a sub-b"
	if err := writeModeLayer(f.s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}
	status, body, headers := readRoute(t, f, "/api/cloud/allowlist", goodToken)
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", status, body)
	}
	var view allowlistView
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("the read must answer with a list document: %v — %s", err, body)
	}
	if strings.Join(view.Subjects, ",") != "sub-a,sub-b" {
		t.Fatalf("expected the canonical list [sub-a sub-b], got %v", view.Subjects)
	}
	if got := headers.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("the access list must be answered no-store, got Cache-Control %q", got)
	}
}

// TestBothReadsRequireASession. The session gate is the outer wrapper on both, and 401 is ITS answer —
// the one status the admin gate may never use is exactly right here, because a caller with no session has
// nothing to clear.
func TestBothReadsRequireASession(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: sampleTeamID, refuseToBeAsked: true})
	for _, path := range []string{"/api/cloud/roster", "/api/cloud/allowlist"} {
		status, _ := get(t, f.base, path, "")
		if status != http.StatusUnauthorized {
			t.Fatalf("%s without a session must be 401, got %d", path, status)
		}
	}
}

// TestBothReadsRefuseAPreCloudDeployment pins the sentence the table's localStatus column only pins the
// status of: the apply's own, because the fact is the same one — a deployment that is not connected has no
// team and no access list for the console to show.
func TestBothReadsRefuseAPreCloudDeployment(t *testing.T) {
	f := newGateFixture(t, gateOptions{localPosture: true, refuseToBeAsked: true})
	for _, path := range []string{"/api/cloud/roster", "/api/cloud/allowlist"} {
		status, body, _ := readRoute(t, f, path, goodToken)
		if status != http.StatusConflict || !strings.Contains(body, notCloudConfigured.detail) {
			t.Fatalf("%s on a pre-cloud deployment must refuse 409 with the not-connected sentence, got %d %s", path, status, body)
		}
	}
}
