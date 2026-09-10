package daemoncmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// The allowlist-only apply's tests.
//
// EVERY ONE OF THEM NEEDS A SESSION WITH AN IDENTITY, and the suite that predates this route has none:
// signIn mints with s.sess.mint(0), which is the LOCAL posture mint and carries no subject at all. A test
// written on that helper would exercise only the unknown-subject arm and would stay green with the guard
// deleted, so these mint their own.

// signInAs mints a cloud session carrying one subject — what the delegation mint produces after the
// platform has verified the operator's ID token.
func signInAs(t *testing.T, s *server, sub string) string {
	t.Helper()
	id, err := s.sess.mintWithIdentity(cloudSessionTTL, identity{sub: sub, email: sub + "@example.test", name: sub})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// applyAllowlist drives the route with an explicit session and token, and returns the status and body.
func applyAllowlist(t *testing.T, base, session, token, list string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+"/api/cloud/allowlist", strings.NewReader(`{"allowlist":`+jsonQuote(list)+`}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set(sessionHeader, session)
	}
	if token != "" {
		req.Header.Set(cloudTokenHeader, token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	// io.ReadAll for the reason the gate's own helper records: a short Read makes a substring assertion
	// answer false, and a refusal test that cannot see the refusal passes.
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading the response body: %v", err)
	}
	return resp.StatusCode, string(b)
}

// jsonQuote encodes a Go string as a JSON string.
//
// IT USED TO ESCAPE FOUR CHARACTERS BY HAND, and that made a test vacuous rather than merely imprecise. A
// C0 byte went onto the wire raw, encoding/json refused the body, and the handler answered 400 "malformed
// request" — so the control-character test asserted a status the DECODER produced and never reached the
// guard it was named for. Deleting that guard entirely left the suite green. encoding/json escapes what
// has to be escaped and nothing else.
func jsonQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// requireStartingList pins what the fixture's recipe carries. Every refusal test below submits a value
// DIFFERENT from it and then asserts the file did not change — and that assertion proves nothing when the
// submitted value would write what is already there: it holds whether the route refused, wrote, or did
// nothing at all. The fixture's own list is the easy value to reach for and the one that makes every such
// assertion vacuous, so submitting it fails the test outright rather than passing quietly.
func requireStartingList(t *testing.T, s *server, submitted string) string {
	t.Helper()
	was := readAllowlist(t, s)
	// COMPARE WHAT WOULD BE WRITTEN, not what was typed. The route writes the canonical form, so
	// " sub-a , sub-b " and "sub-a,sub-b" are the same write — and a raw-string comparison would wave the
	// first one through while the assertion it protects went vacuous.
	if would := strings.Join(parseAllowlist(submitted), ","); was == would {
		t.Fatalf("this test submits %q, which would write %q — exactly what the deployment already carries, "+
			"so the assertion that nothing changed would pass whatever the route did", submitted, would)
	}
	return was
}

// readAllowlist returns the list the mode file currently carries.
func readAllowlist(t *testing.T, s *server) string {
	t.Helper()
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatalf("reading the mode layer: %v", err)
	}
	return vars["DEPLOYMENT_ALLOWLIST"]
}

// TestAllowlistAppliesAndTouchesNothingElse is the happy path, and the second half is the point: a route
// whose whole claim is that it rewrites ONE variable has to be held to that, or "narrow apply" is a
// description of an intention rather than of the code.
func TestAllowlistAppliesAndTouchesNothingElse(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	before, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-new")
	if status != http.StatusOK {
		t.Fatalf("an administrator on their own list must be admitted, got %d: %s", status, body)
	}
	if !strings.Contains(body, platformRestartCommand) {
		t.Fatalf("the answer must name the command that applies it, got: %s", body)
	}
	if !strings.Contains(body, "removes no module") {
		t.Fatalf("the answer must say this is not the dangerous restart, got: %s", body)
	}

	if got := readAllowlist(t, f.s); got != "sub-a,sub-new" {
		t.Fatalf("the written list must be the canonical form, got %q", got)
	}

	after, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("the apply added or removed a variable: %d before, %d after", len(before), len(after))
	}
	for name, was := range before {
		if name == "DEPLOYMENT_ALLOWLIST" {
			continue
		}
		if after[name] != was {
			t.Fatalf("%s changed: %q -> %q. This route rewrites one variable and no others", name, was, after[name])
		}
	}
}

// TestAllowlistRefusesAListThatOmitsTheCaller is the guard, and the break-it
// the plan names.
func TestAllowlistRefusesAListThatOmitsTheCaller(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")
	was := requireStartingList(t, f.s, "sub-b,sub-c")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-b,sub-c")
	if status != http.StatusConflict {
		t.Fatalf("a list omitting the caller must be refused 409, got %d: %s", status, body)
	}
	if !strings.Contains(body, "lock you out") {
		t.Fatalf("the refusal must say what applying it would do, got: %s", body)
	}
	if got := readAllowlist(t, f.s); got != was {
		t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
	}
}

// TestAllowlistRefusesAnEmptyList pins the value the guard is most likely to be "corrected" into
// admitting.
//
// THE MUTANT THIS MUST KILL is the faithful transcription of the platform's own rule:
//
//	if len(entries) > 0 && !containsSubject(entries, sub) { refuse }
//
// which is correct about exclusion — an empty list excludes nobody — and therefore admits the one value
// that opens the deployment to every subject in a shared identity pool, or stops it booting. Both
// sub-tests below go red under that mutant, and the second is the one a comma-counting check misses.
func TestAllowlistRefusesAnEmptyList(t *testing.T) {
	for _, tc := range []struct {
		name string
		list string
	}{
		{"empty string", ""},
		// Non-empty as a STRING, empty as a LIST. The platform splits on "," and drops the blanks, so this
		// is the same value as above by the time it is enforced.
		{"separators only", " , , "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: "team-a"})
			session := signInAs(t, f.s, "sub-a")
			was := requireStartingList(t, f.s, tc.list)

			status, body := applyAllowlist(t, f.base, session, "acc-tok", tc.list)
			if status != http.StatusBadRequest {
				t.Fatalf("an empty access list must be refused 400, got %d: %s", status, body)
			}
			if !strings.Contains(body, "NO RESTRICTION") {
				t.Fatalf("the refusal must say what empty MEANS, not merely that it is required, got: %s", body)
			}
			// It must lead with what the operator can see — a box that looks filled — rather than with the
			// word "empty", which reads as "the console did not receive my input".
			if !strings.Contains(body, "names no accounts") {
				t.Fatalf("the refusal must name what was actually wrong with the value, got: %s", body)
			}
			if got := readAllowlist(t, f.s); got != was {
				t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
			}
		})
	}
}

// TestAllowlistNormalisesTheWayThePlatformDoes. The guard compares against the parsed list, so the parse
// has to match the reader's or the check and the enforcement are about different lists.
func TestAllowlistNormalisesTheWayThePlatformDoes(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	// Whitespace around entries, a duplicate, a blank field, and an order that is not sorted.
	status, body := applyAllowlist(t, f.base, session, "acc-tok", " sub-c , sub-a ,, sub-a , sub-b ")
	if status != http.StatusOK {
		t.Fatalf("a padded list naming the caller must be admitted, got %d: %s", status, body)
	}
	if got := readAllowlist(t, f.s); got != "sub-a,sub-b,sub-c" {
		t.Fatalf("the written value must be trimmed, de-duplicated and canonical, got %q", got)
	}
	if !strings.Contains(body, `"subjects":3`) {
		t.Fatalf("the answer must report the count actually written, got: %s", body)
	}
}

// TestAllowlistRefusesWhenTheSessionCarriesNoSubject. The guard cannot run, so it refuses rather than
// passing — and it refuses with the status the SPA answers by signing in, because that is the remedy.
func TestAllowlistRefusesWhenTheSessionCarriesNoSubject(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	// The LOCAL mint, which is what every pre-existing test helper produces: a live session with no
	// identity at all.
	session := signIn(t, f.s)
	was := requireStartingList(t, f.s, "sub-a,sub-changed")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-changed")
	if status != http.StatusPreconditionFailed {
		t.Fatalf("a session with no subject must be refused 412, got %d: %s", status, body)
	}
	if status == http.StatusUnauthorized {
		t.Fatal("401 would clear the session and sign the operator out")
	}
	if got := readAllowlist(t, f.s); got != was {
		t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
	}
}

// TestAllowlistIsRefusedOnAPreCloudDeployment. There is no access list to replace, and the sentence says
// so rather than reporting a generic conflict.
func TestAllowlistIsRefusedOnAPreCloudDeployment(t *testing.T) {
	f := newGateFixture(t, gateOptions{localPosture: true, refuseToBeAsked: true})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a")
	if status != http.StatusConflict {
		t.Fatalf("a pre-cloud deployment has no access list to change, expected 409, got %d: %s", status, body)
	}
	if !strings.Contains(body, "not connected to the cloud") {
		t.Fatalf("the refusal must name the actual reason, got: %s", body)
	}
}

// TestAllowlistIsAdminGated. It is the sixth gated route, and the one a requirement phrased as a count
// drops. Asserting the GATE's own sentence is what separates "the gate refused" from "the handler did".
func TestAllowlistIsAdminGated(t *testing.T) {
	f := newGateFixture(t, gateOptions{
		team:         "team-a",
		entitlements: `{"protocol":"1","packages":[{"key":"acme-cloud"}],"admin":false}`,
	})
	session := signInAs(t, f.s, "sub-a")
	was := requireStartingList(t, f.s, "sub-a,sub-changed")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-changed")
	if status != http.StatusForbidden {
		t.Fatalf("a member who is not an administrator must be refused 403, got %d: %s", status, body)
	}
	if !isGateRefusal(body) {
		t.Fatalf("the refusal must be the GATE's, not the handler's, got: %s", body)
	}
	if got := readAllowlist(t, f.s); got != was {
		t.Fatalf("a gated-out apply must change nothing, list is now %q (was %q)", got, was)
	}
}

// TestAllowlistRefusesWithoutTheOperatorsToken. The gate decides this one, and it must not be a 401.
func TestAllowlistRefusesWithoutTheOperatorsToken(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "", "sub-a,sub-changed")
	if status != http.StatusPreconditionFailed {
		t.Fatalf("no operator token must be refused 412, got %d: %s", status, body)
	}
	if status == http.StatusUnauthorized {
		t.Fatal("401 would clear the session and sign the operator out")
	}
}

// TestAllowlistRefusesAControlCharacter. A newline would become a second NAME=value line in the written
// file, which is the whole class the fixed name set exists to prevent.
func TestAllowlistRefusesAControlCharacter(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")
	was := requireStartingList(t, f.s, "sub-a,sub-b\u0000ENABLE_NOAUTH=true")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-b\u0000ENABLE_NOAUTH=true")
	if status != http.StatusBadRequest {
		t.Fatalf("a control character must be refused 400, got %d: %s", status, body)
	}
	// THE HANDLER'S SENTENCE, not merely the status. 400 is also what the JSON decoder answers for a body
	// it cannot parse, and that is precisely how this test used to pass without reaching the guard at all.
	if !strings.Contains(body, "cannot appear in an account identifier") {
		t.Fatalf("the refusal must be the handler's, not the decoder's, got: %s", body)
	}
	if got := readAllowlist(t, f.s); got != was {
		t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
	}
}

// TestAllowlistRefusesInvisibleCharacters is the guard that makes the two parsers agree about emptiness,
// and each row is a real clipboard artefact rather than an invented one.
//
// U+FEFF IS THE ONE THAT MATTERS. Go's unicode.IsSpace excludes it and ECMAScript's trim includes it, so
// before this check a lone U+FEFF was ONE entry to the console and NONE to the platform — and none at the
// platform is no restriction at all. The empty check cannot see it; only printability can.
func TestAllowlistRefusesInvisibleCharacters(t *testing.T) {
	for _, tc := range []struct {
		name string
		list string
	}{
		// Alone: one entry here, an empty list at the platform. The unrestricted deployment.
		{"a lone byte-order mark", "\ufeff"},
		// Prefixed to a correct list: the count still reads 2, and sub-a is silently not sub-a.
		{"a byte-order mark on a pasted list", "\ufeffsub-a\nsub-b"},
		{"a zero-width space inside an account", "sub-a,su\u200bb-b"},
		{"a soft hyphen", "sub-a\u00adsub-b"},
		{"a right-to-left mark", "sub-a,sub-b\u200f"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGateFixture(t, gateOptions{team: "team-a"})
			session := signInAs(t, f.s, "sub-a")
			was := readAllowlist(t, f.s)

			status, body := applyAllowlist(t, f.base, session, "acc-tok", tc.list)
			if status != http.StatusBadRequest {
				t.Fatalf("an invisible character must be refused 400, got %d: %s", status, body)
			}
			if !strings.Contains(body, "invisible") {
				t.Fatalf("the refusal must name the cause an operator can act on, got: %s", body)
			}
			if got := readAllowlist(t, f.s); got != was {
				t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
			}
		})
	}
}

// TestAllowlistRefusesAnAbsurdlyLongList — the paste-of-the-wrong-thing case, and the bound that keeps the
// admin gate from re-parsing a megabyte on every gated request.
func TestAllowlistRefusesAnAbsurdlyLongList(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")
	was := readAllowlist(t, f.s)

	entries := make([]string, 0, maxAllowlistEntries+1)
	entries = append(entries, "sub-a")
	for i := 0; i < maxAllowlistEntries; i++ {
		entries = append(entries, fmt.Sprintf("sub-%d", i))
	}
	status, body := applyAllowlist(t, f.base, session, "acc-tok", strings.Join(entries, ","))
	if status != http.StatusBadRequest {
		t.Fatalf("a list past the bound must be refused 400, got %d: %s", status, body)
	}
	// THE NUMBERS, because "too many" cannot tell an operator which document they pasted and a count can.
	if !strings.Contains(body, fmt.Sprintf("%d accounts", maxAllowlistEntries+1)) ||
		!strings.Contains(body, fmt.Sprintf("at most %d", maxAllowlistEntries)) {
		t.Fatalf("the refusal must name what was submitted and what is allowed, got: %s", body)
	}
	if got := readAllowlist(t, f.s); got != was {
		t.Fatalf("a refused apply must change nothing, list is now %q (was %q)", got, was)
	}
}

// TestTheSelfExclusionRefusalNamesTheAccount. Neither the console nor the portal shows an operator their
// own identifier, so a refusal telling them to add it is unactionable unless it says what it is.
func TestTheSelfExclusionRefusalNamesTheAccount(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-b,sub-c")
	if status != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", status, body)
	}
	if !strings.Contains(body, "sub-a") {
		t.Fatalf("the refusal must name the account the caller is signed in as, got: %s", body)
	}
	// And it must send them back to the portal rather than to a one-line edit, because a partial paste is
	// the likeliest cause and editing it in place keeps whatever else it dropped.
	if !strings.Contains(body, "Copy the whole list again") {
		t.Fatalf("the refusal must lead with re-copying, got: %s", body)
	}
}

// TestTheIncompleteConfigurationRefusalNamesWhatIsMissing. Without the names the operator's only visible
// remedy is disconnect, which is the destructive act this route exists to remove from their path.
func TestTheIncompleteConfigurationRefusalNamesWhatIsMissing(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")
	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	delete(vars, "OIDC_JWKS_URI")
	if err := writeModeLayer(f.s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}

	_, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-changed")
	if !strings.Contains(body, "OIDC_JWKS_URI") {
		t.Fatalf("the refusal must name the missing variable, got: %s", body)
	}
	if !strings.Contains(body, "Regenerate") {
		t.Fatalf("the refusal must give a remedy that is not disconnect, got: %s", body)
	}
}

// TestAllowlistAcceptsThePortalsOwnRendering. The portal shows the members one per line, so the documented
// path — copy the list from the portal — produces a newline-separated paste. If that were refused, the
// first thing every operator tried would fail, and the message would name a separator they never chose.
func TestAllowlistAcceptsThePortalsOwnRendering(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a\nsub-b\r\nsub-new\n")
	if status != http.StatusOK {
		t.Fatalf("a newline-separated paste is what the portal produces and must be accepted, got %d: %s", status, body)
	}
	// Whatever the separators were on the way in, the written value is the one form the platform parses.
	if got := readAllowlist(t, f.s); got != "sub-a,sub-b,sub-new" {
		t.Fatalf("the written value must be canonical commas, got %q", got)
	}
}

// TestAllowlistRefusesToWriteAnIncompleteModeLayer. This route does not go through cloudModeVars, so the
// present-and-non-empty rule that stops a half-written recipe booting a broken deployment does not cover
// it for free. The state is reached by editing the file on the host, which is the same way every other
// read-side re-check in this package becomes reachable.
func TestAllowlistRefusesToWriteAnIncompleteModeLayer(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	delete(vars, "OIDC_JWKS_URI")
	if err := writeModeLayer(f.s.cfg.ModeLayerPath, vars); err != nil {
		t.Fatal(err)
	}

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-changed")
	if status != http.StatusConflict {
		t.Fatalf("an incomplete mode layer must be refused 409 rather than rewritten, got %d: %s", status, body)
	}
	after, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if after["DEPLOYMENT_ALLOWLIST"] == "sub-a,sub-changed" {
		t.Fatal("the apply wrote a mode layer the connect path would have rejected")
	}
}

// TestAllowlistSurvivesAConcurrentDisconnect drives the apply and a disconnect at each other and asserts
// the file is always one of the two valid shapes, never a mixture — and that BOTH operations actually
// answered, which is the half that keeps it from being vacuous.
//
// WHAT IT DOES NOT PROVE, said plainly rather than implied by its name. It cannot reliably produce the one
// interleaving that the read-inside-the-lock ordering exists to defeat: moving the read outside the lock
// leaves a window of a few microseconds of pure computation, while the disconnect it would have to lose to
// has an admin-gate round trip and a teardown scan in front of it. A timing test does not win that race,
// and a test whose name promises it would be worse than one that says so. What makes the straddle
// impossible is structural — the read and the write are inside one critical section — and what this covers
// is that the two routes under real contention never produce a file that is neither shape.
func TestAllowlistSurvivesAConcurrentDisconnect(t *testing.T) {
	for i := 0; i < 25; i++ {
		f := newGateFixture(t, gateOptions{team: "team-a"})
		session := signInAs(t, f.s, "sub-a")

		var wg sync.WaitGroup
		var applyStatus, disconnectStatus int
		wg.Add(2)
		go func() {
			defer wg.Done()
			// NOT applyAllowlist: it calls t.Fatal, and FailNow from a non-test goroutine is illegal. The
			// status comes back to the main goroutine and is asserted there.
			req, _ := http.NewRequest(http.MethodPost, f.base+"/api/cloud/allowlist",
				strings.NewReader(`{"allowlist":"sub-a,sub-b"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set(sessionHeader, session)
			req.Header.Set(cloudTokenHeader, "acc-tok")
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				applyStatus = resp.StatusCode
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest(http.MethodDelete, f.base+"/api/cloud", nil)
			req.Header.Set(sessionHeader, session)
			req.Header.Set(cloudTokenHeader, "acc-tok")
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				disconnectStatus = resp.StatusCode
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
		wg.Wait()

		// BOTH ANSWERED, and neither answered with a fault. Without this the shape assertion below holds
		// trivially on a handler that returns 500 without doing anything at all.
		if disconnectStatus != http.StatusOK {
			t.Fatalf("iteration %d: the disconnect answered %d", i, disconnectStatus)
		}
		switch applyStatus {
		case http.StatusOK, http.StatusConflict:
			// 200 if it won the lock, 409 if the disconnect got there first and the posture re-check inside
			// the critical section caught it. Both are correct; a fault is not.
		default:
			t.Fatalf("iteration %d: the apply answered %d, expected 200 or 409", i, applyStatus)
		}

		vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
		if err != nil {
			t.Fatalf("iteration %d: the mode layer no longer parses, which turns the admin gate off: %v", i, err)
		}
		if _, cloud := vars["OIDC_SHARED_POOL"]; cloud {
			if missing := missingRequiredVars(vars); len(missing) > 0 {
				t.Fatalf("iteration %d: a cloud mode layer missing %v", i, missing)
			}
			continue
		}
		if vars["NODE_ENV"] != "development" || vars["ENABLE_NOAUTH"] != "true" {
			t.Fatalf("iteration %d: neither a cloud nor a pure-OSS mode layer: %v", i, vars)
		}
		if _, leaked := vars["DEPLOYMENT_ALLOWLIST"]; leaked {
			t.Fatalf("iteration %d: the apply wrote the cloud map back over a completed disconnect", i)
		}
	}
}

// TestModeLayerWriteIsAtomicUnderConcurrency pins the WRITER, and it has to reach past the lock to do it.
//
// IT USED TO CALL writeModeLayer AND THEREFORE TESTED NOTHING IT CLAIMED. That entry point takes
// modeLayerMu first, so no two writers were ever inside the temp-file code at once and the shared
// temp-filename bug it names was unreachable — restoring `tmp := path + ".tmp"` left the suite green.
// Calling the already-locked variant is what puts two writers in the same file at the same time, which is
// the state a second console process on the same host would produce whatever this process's mutex does.
func TestModeLayerWriteIsAtomicUnderConcurrency(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mode.env")
	cloud, _, err := cloudModeVars(validRecipeVars(), "https://front.example/auth/callback", "/cache")
	if err != nil {
		t.Fatal(err)
	}
	local := pureOSSModeVars()

	// The two byte strings the file is allowed to hold. Comparing BYTES rather than parsed keys is what
	// makes a tear visible: a file whose head is one writer's and whose tail is another's still parses
	// perfectly well as an env file, because a truncated env file is just a smaller map.
	serialise := func(vars map[string]string) string {
		p2 := filepath.Join(t.TempDir(), "x.env")
		if err := writeModeLayer(p2, vars); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(p2)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	wantCloud, wantLocal := serialise(cloud), serialise(local)

	for round := 0; round < 200; round++ {
		var wg sync.WaitGroup
		wg.Add(2)
		// writeModeLayerLocked, NOT writeModeLayer: the locked entry point serialises writers, so going
		// through it would put no two of them inside the temp-file code at once and this test could not
		// reach the property it exists for. Two console processes on one host are not serialised by a
		// mutex in either of them.
		go func() { defer wg.Done(); _ = writeModeLayerLocked(path, cloud) }()
		go func() { defer wg.Done(); _ = writeModeLayerLocked(path, local) }()
		wg.Wait()

		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("round %d: reading the mode layer: %v", round, err)
		}
		if string(got) != wantCloud && string(got) != wantLocal {
			t.Fatalf("round %d: the mode layer is neither writer's output — a torn file, which makes the "+
				"deployment read as not-cloud and the admin gate stand aside:\n%q", round, got)
		}
	}
}

// TestTheModeLayerIsReadableByTheRuntime. It is written through a temp file that starts at 0600, and the
// container runtime and the platform both read it — so the widening is load-bearing rather than cosmetic.
func TestTheModeLayerIsReadableByTheRuntime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mode.env")
	if err := writeModeLayer(path, pureOSSModeVars()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("the mode layer must be readable by the runtime that mounts it, got %v", info.Mode().Perm())
	}
}

// TestSubjectComparisonIsExact. The platform compares the `sub` claim with ===, so admitting a
// case-insensitive match here would claim an admission the platform will not make — the guard would pass a
// list the deployment then refuses the operator on.
func TestSubjectComparisonIsExact(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "SUB-A,sub-b")
	if status != http.StatusConflict {
		t.Fatalf("a list naming a differently-cased subject does not name the caller, expected 409, got %d: %s", status, body)
	}
}

// TestTheModeReadCarriesTheNoticeOnlyWhereTheControlExists. Prose on a read, so the panel can state the
// consequence before anything is submitted rather than only as a receipt afterwards.
func TestTheModeReadCarriesTheNoticeOnlyWhereTheControlExists(t *testing.T) {
	cloud := newGateFixture(t, gateOptions{team: "team-a"})
	status, body := get(t, cloud.base, "/api/mode", signInAs(t, cloud.s, "sub-a"))
	if status != http.StatusOK {
		t.Fatalf("reading the mode: %d %s", status, body)
	}
	if !strings.Contains(string(body), "allowlistNotice") {
		t.Fatalf("a cloud deployment must carry the notice, got: %s", body)
	}

	local := newGateFixture(t, gateOptions{localPosture: true, refuseToBeAsked: true})
	status, body = get(t, local.base, "/api/mode", signIn(t, local.s))
	if status != http.StatusOK {
		t.Fatalf("reading the mode: %d %s", status, body)
	}
	// The KEY, not the value: omitempty makes an empty string and an absent field identical on the wire,
	// so asserting the key is absent is what tells "not set" from "set to nothing".
	if strings.Contains(string(body), "allowlistNotice") {
		t.Fatalf("a pre-cloud deployment has no access list to change, so it must carry no notice: %s", body)
	}
}

// TestTheNoticeAndTheReceiptAreOneSentence is the drift guard: one definition carried in two places so the
// two cannot disagree. Two literals whose whole purpose is being one literal is the failure this prevents.
func TestTheNoticeAndTheReceiptAreOneSentence(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	_, modeBody := get(t, f.base, "/api/mode", session)
	var mode modeView
	if err := json.Unmarshal(modeBody, &mode); err != nil {
		t.Fatalf("decoding the mode read: %v", err)
	}
	_, applied := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-new")
	var result allowlistResult
	if err := json.Unmarshal([]byte(applied), &result); err != nil {
		t.Fatalf("decoding the apply: %v", err)
	}
	if mode.AllowlistNotice != result.Message {
		t.Fatalf("the notice and the receipt have drifted into two sentences:\n  read:    %q\n  receipt: %q",
			mode.AllowlistNotice, result.Message)
	}
	if mode.AllowlistNotice != allowlistRestartConsequence {
		t.Fatal("neither is the constant, so a third copy exists somewhere")
	}
}

// TestTheReceiptNamesThePlatformRestartAndPromisesNoModuleLoss.
//
// A TRAP WORTH RECORDING: asserting !strings.Contains(msg, stackRestartCommand) is a test that can never
// pass, because "byodt restart" is a PREFIX of "byodt restart platform". The claim must be made positively.
func TestTheReceiptNamesThePlatformRestartAndPromisesNoModuleLoss(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-new")
	if status != http.StatusOK {
		t.Fatalf("expected the apply to succeed, got %d: %s", status, body)
	}
	if !strings.Contains(body, platformRestartCommand) {
		t.Fatalf("the receipt must name %q, got: %s", platformRestartCommand, body)
	}
	if !strings.Contains(body, "removes no module") {
		t.Fatalf("the receipt must say this restart is not the one that costs classes, got: %s", body)
	}
	// The not-yet claim is the most valuable sentence on this response: an operator who removed somebody,
	// watched them keep working and concluded the console had failed would reach for the one control that
	// visibly does something, which is disconnect, and that is the data-losing act this route removes.
	if !strings.Contains(body, "not now") {
		t.Fatalf("the receipt must say the change has NOT taken effect yet, got: %s", body)
	}
}

// TestTheApplyDoesNotDropOtherSessions. The two handlers either side of this one call keepOnly, so copying
// it here is the likeliest mistake to make here, and it would be wrong: this is not a posture change, and
// the platform goes on admitting the previous list until it restarts. Signing people out of a console while
// the deployment still admits them is theatre, and it would be this route's first untrue claim.
func TestTheApplyDoesNotDropOtherSessions(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")
	other := signInAs(t, f.s, "sub-b")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-new")
	if status != http.StatusOK {
		t.Fatalf("expected the apply to succeed, got %d: %s", status, body)
	}
	if !f.s.sess.valid(other) {
		t.Fatal("the apply dropped another operator's session; it is not a posture change and must not")
	}
}

// TestTheApplyNeverEchoesTheSubjects. Not about withholding a value from the person who just sent it. It is
// about not creating a NEW place the subject ids are rendered and logged, in a console whose posture read
// is projected field-by-field to keep them off the wire.
func TestTheApplyNeverEchoesTheSubjects(t *testing.T) {
	f := newGateFixture(t, gateOptions{team: "team-a"})
	session := signInAs(t, f.s, "sub-a")

	status, body := applyAllowlist(t, f.base, session, "acc-tok", "sub-a,sub-secret-identifier")
	if status != http.StatusOK {
		t.Fatalf("expected the apply to succeed, got %d: %s", status, body)
	}
	// EVERY id, including the CALLER'S OWN. Checking only the other one lets a partial echo through: an
	// answer naming just the caller would pass while still creating the rendered-and-logged surface the
	// posture read's fixed projection exists to avoid.
	for _, id := range []string{"sub-secret-identifier", "sub-a"} {
		if strings.Contains(body, id) {
			t.Fatalf("the answer echoed the member id %q back: %s", id, body)
		}
	}
}

// TestParseAllowlistMirrorsThePlatform. The rows are the PLATFORM's behaviour, not this function's
// preferences: it splits on ",", trims each entry and drops the blanks (gql.config.ts). If that parse ever
// changes, this guard is deciding on a list nobody enforces.
func TestParseAllowlistMirrorsThePlatform(t *testing.T) {
	// Written as escapes rather than as themselves, because a literal one in this file is invisible to a
	// reader and to a diff. NBSP is what copying out of rendered HTML routinely produces; NEL is the one
	// Go calls space and ECMAScript does not trim.
	const (
		nbsp = "\u00a0"
		nel  = "\u0085"
	)
	for _, tc := range []struct {
		raw  string
		want []string
	}{
		{"", nil},
		{"   ", nil},
		{",", nil},
		{" , , ", nil},
		{"sub-a", []string{"sub-a"}},
		{" sub-a , sub-b ", []string{"sub-a", "sub-b"}},
		{"sub-b,sub-a", []string{"sub-a", "sub-b"}},
		{"sub-a,sub-a", []string{"sub-a"}},
		{"sub-a,,sub-b", []string{"sub-a", "sub-b"}},
		{"sub-a\nsub-b", []string{"sub-a", "sub-b"}},
		{"sub-a\r\nsub-b\n", []string{"sub-a", "sub-b"}},
		{"\n \t\n", nil},
		// THE ROWS WHERE THE TWO PARSERS COULD DIVERGE, which is what this table is for. Every row above
		// uses only space, tab, CR and LF, the four runes where Go and JS agree trivially, so a parse
		// narrowed to ASCII whitespace passed all of them and nothing noticed.
		{"sub-a" + nbsp + "sub-b", []string{"sub-a", "sub-b"}},
		{"sub-a" + nel + "sub-b", []string{"sub-a", "sub-b"}},
		{nbsp + nel + " \t", nil},
		// U+FEFF is deliberately NOT here. It is a separator on neither side, and the two trim tables
		// disagree about it, so no separator list can reconcile them. The handler refuses it as unprintable
		// instead; see TestAllowlistRefusesInvisibleCharacters.
	} {
		got := parseAllowlist(tc.raw)
		if len(got) != len(tc.want) {
			t.Fatalf("parseAllowlist(%q) = %v, want %v", tc.raw, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("parseAllowlist(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		}
	}
}
