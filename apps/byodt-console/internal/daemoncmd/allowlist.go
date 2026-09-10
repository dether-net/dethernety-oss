package daemoncmd

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"unicode"
)

// The allowlist-only apply. It rewrites exactly one variable — DEPLOYMENT_ALLOWLIST, the set of subjects
// this deployment admits at sign-in — on a deployment that is already connected, and touches nothing else.
//
// WHY IT EXISTS. Changing who may use a deployment previously meant reconfiguring it, and the console
// refuses to reconfigure a connected deployment: you disconnect first. A disconnect removes every
// cloud-provided module, and at the next platform start the classes those modules declare and every link
// those classes are in go with them. So the only discoverable way to remove one person from a deployment
// destroyed graph data, while the way that destroys nothing — editing the env file on the host — is
// nowhere in the console's vocabulary. This route is that operation, named.
//
// IT APPLIES; IT DOES NOT ASK. The roster lives in the commerce service, and this console's
// deployment-scoped token has the wrong audience for it — which is why the route that once tried to fetch
// a fresh configuration was retired. The operator copies the value from the portal, where they are
// already signed in with a credential that works, and this route writes it.
//
// IT IS ADMIN-GATED like every other route that changes the deployment, and its gate is the same one:
// composed in routes(), asked live, never cached.

// allowlistRestartConsequence is what a completed apply answers with.
//
// IT MUST NOT LET THE OPERATOR BELIEVE THE CHANGE TOOK. The platform reads its access list once, at
// process start, so this write is inert until a restart — and a person removed here can still sign in
// until then. Saying that plainly is part of the control rather than a caveat on it: a revocation the
// operator thinks has happened is worse than one they know is pending.
//
// AND IT MUST SAY WHICH RESTART. A deployment's operator is taught to fear a platform start, because the
// dangerous one is a start that finds modules missing and deletes the classes they declared. This is not
// that: nothing here removes a module, so the platform comes back with everything it had. Left unsaid,
// the warning attached to the other restart attaches itself to this one and the operator never runs it.
const allowlistRestartConsequence = "Who may sign in changes at the next platform start, not now: the platform reads this list once, " +
	"when it starts, so until then it goes on admitting exactly who it admits today — including anyone you " +
	"just removed. Apply it by restarting the platform: " + platformRestartCommand + ". That restart removes no " +
	"module, so it has none of the consequences for your classes and links that a restart finding a module " +
	"missing does."

// allowlistRefusal mirrors adminRefusal: a status the SPA can branch on, and the sentence an operator
// reads. The gate's four statuses are answered before this handler runs; these are the handler's own, and
// they follow the same rule — a remedy that only prose distinguishes is a remedy no interface can act on.
// maxAllowlistEntries bounds what one apply may write. It is not a security boundary — the route is
// admin-gated and the body is already capped — it is an OPERATOR sanity check, and it is sized for that:
// a team edition's seat count is in the tens, so anything approaching this is a paste of the wrong thing.
// Without it a 1 MiB body becomes a 1 MiB DEPLOYMENT_ALLOWLIST line that the admin gate then re-reads and
// re-parses on every gated request, because the gate reads this file.
const maxAllowlistEntries = 512

type allowlistRefusal struct {
	status int
	detail string
}

var (
	// notCloudConfigured is the mirror of the connect path's write guard. That route refuses to apply to a
	// deployment that IS cloud-configured; this one refuses one that is not.
	notCloudConfigured = allowlistRefusal{
		status: http.StatusConflict,
		detail: "This deployment is not connected to the cloud, so it has no access list to change. Nothing was changed. " +
			"A deployment that is not connected admits whoever its own configuration admits.",
	}
	// unknownSubject is the one case this handler cannot decide, and it is deliberately NOT the gate's
	// notSignedIn sentence. That one says the tab holds no credential to ask the cloud with; this says the
	// console cannot tell which subject the SESSION belongs to, which is a different fact with the same
	// remedy. 412 because the SPA answers it by performing the sign-in rather than reporting it.
	unknownSubject = allowlistRefusal{
		status: http.StatusPreconditionFailed,
		detail: "The console could not tell which account this session belongs to, so it could not check that your new list still admits you. " +
			"Nothing was changed. Sign in to the cloud again and retry.",
	}
	// emptyAllowlist refuses the single most dangerous value this route can write. See the guard below for
	// why this is not merely a required-field check.
	emptyAllowlist = allowlistRefusal{
		status: http.StatusBadRequest,
		detail: "The list you submitted names no accounts, so nothing was changed. " +
			"A box that looks filled can still name none — separators alone are not accounts. " +
			"An empty list does not mean \"nobody\": the platform reads it as NO RESTRICTION, which would admit anyone your identity " +
			"provider knows, and on a deployment reachable over the network it refuses to start at all. " +
			"To narrow access to one person, submit a list naming that one account.",
	}
	// tooManyEntries is the paste-of-the-wrong-thing case, and it SAYS THE NUMBERS — this comment claimed
	// it did while the sentence carried neither. The counts are what tell the operator which document they
	// actually copied: a team's access list is tens of accounts, so "4,812" identifies the mistake in a way
	// "too many" never can. Completed with both before it is sent; see refuseTooMany.
	tooManyEntries = allowlistRefusal{
		status: http.StatusBadRequest,
		detail: "That list names %d accounts, and a deployment's access list holds at most %d — so nothing was changed. " +
			"Check that what you copied is the access list rather than another part of the page.",
	}
	// selfExcluded is the guard. A CONFLICT rather than a bad request: the
	// value is perfectly well formed, and what is wrong is its relationship to the person submitting it. A
	// 400 would read as "you typed it wrong" and send the operator back to re-copy a correct list.
	// selfExcluded is completed with the caller's own subject before it is sent — see refuseSelfExclusion.
	// THE SUBJECT IS NAMED because otherwise the remedy is unactionable: neither this console nor the portal
	// shows an operator their own identifier, so "add your own account" asks them to find a value they have
	// no way to look up. It is their own identity, returned only to them, on an admin-gated route.
	//
	// AND IT LEADS WITH RE-COPYING RATHER THAN EDITING. The likeliest cause on a paste path is a partial
	// copy that dropped lines — in which case adding yourself back fixes the symptom and applies a list
	// that is still missing colleagues, which is the failure this guard is supposed to catch.
	selfExcluded = allowlistRefusal{
		status: http.StatusConflict,
		detail: "That list does not name the account you are signed in as (%s), so applying it would lock you out of this deployment at the " +
			"next platform start. Nothing was changed. Copy the whole list again from the portal — if your own account is missing from it, " +
			"others may be too. An administrator who is on the list can also apply it for you.",
	}
)

// allowlistResult is what a completed apply answers with.
//
// IT REPORTS A COUNT AND NEVER THE SUBJECTS. Nothing in this console surfaces the access list — the
// posture read projects a fixed field set precisely so the list and the service URLs stay off the wire —
// so the operator cannot see what they replaced and this answer is the only confirmation they get that
// the value parsed the way they meant. A count catches the failure that actually happens, a paste that
// lost half its lines; printing the ids back would defeat the reason none of them are printed anywhere.
type allowlistResult struct {
	Status   string `json:"status"`
	Subjects int    `json:"subjects"`
	Message  string `json:"message"`
}

// parseAllowlist reads a submitted value into the set of subjects it names: de-duplicated, sorted, and
// canonical. What it returns is what the guard decides on and what gets written.
//
// IT MUST AGREE WITH THE PLATFORM ABOUT WHAT IS EMPTY, which is the half that matters. The platform splits
// on ",", trims each entry and drops the blanks, so " a , , b " is two subjects and ",,," is NONE — an
// empty list wearing a non-empty string. A check that asked whether the submitted STRING was empty would
// pass that one straight through, and an empty list is the single most dangerous value this route can
// write.
//
// THE TWO PARSERS DO NOT SHARE A WHITESPACE TABLE, and an earlier version of this comment claimed they
// did. They do not: Go's unicode.IsSpace excludes U+FEFF, while ECMAScript's String.prototype.trim
// includes it. So a submitted value of a lone U+FEFF is ONE entry here and NONE at the platform — and none
// at the platform means no restriction at all, on a shared multi-tenant pool. The agreement cannot come
// from enumerating separators; it comes from the printability check in the handler, which refuses every
// character that could make the two disagree. See there.
//
// IT IS DELIBERATELY MORE FORGIVING THAN THE PLATFORM ABOUT SEPARATORS, and that costs nothing because
// this value never reaches the platform in the form it was typed — the canonical comma-joined form below
// is what gets written. The reason is the portal: it renders the members as a LIST, one per line, so the
// natural copy is newline-separated. Refusing that would have made the documented path — "copy the list
// from the portal" — fail on the first attempt, with a message about a separator the operator never chose.
// Accepting whitespace as a separator is not inventing a syntax the platform must understand; it is
// accepting what the source of the value actually produces, and normalising it before anyone else sees it.
// A subject containing INTERIOR whitespace would be split in two here and is refused by the shape check
// rather than silently divided — this comment used to say the platform would reject one anyway, which is
// wrong: trim only strips the edges, so "a b" is a perfectly matchable subject there.
func parseAllowlist(raw string) []string {
	seen := make(map[string]struct{})
	var out []string
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	})
	for _, entry := range fields {
		if _, dup := seen[entry]; dup {
			continue
		}
		seen[entry] = struct{}{}
		out = append(out, entry)
	}
	sort.Strings(out)
	return out
}

// cloudAllowlist replaces the deployment's access list. It is admin-gated in routes().
func (s *server) cloudAllowlist(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Allowlist string `json:"allowlist"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}

	// THE SUBJECT COMES FROM THE SESSION, and the reason is a property nothing else the console holds can
	// claim. A cloud session is minted by handing the operator's ID token to the platform, and the platform
	// validates the ALLOWLIST along with the signature, the expiry, the issuer and the audience. So a live
	// cloud session is proof that its subject passed this deployment's current access list — which is
	// exactly the question this guard asks about the NEXT one.
	//
	// NOT THE ACCESS TOKEN ON THIS REQUEST. That credential is for the content service, which has never
	// heard of DEPLOYMENT_ALLOWLIST; its subject has been checked against nothing relevant here. The two
	// are not bound to each other either way — admin.go's audit record says so where it names its field
	// session_sub rather than sub — so reading the second one buys no binding and adds a second thing that
	// can be wrong.
	sub := s.sess.identityOf(r.Header.Get(sessionHeader)).sub

	// Everything from here to the write is one critical section. The read decides what the write contains,
	// so a disconnect landing between them would be overwritten by a cloud map it had just replaced.
	//
	// UNLOCKED BEFORE THE RESPONSE IS WRITTEN, and that is why this is not a plain defer. Writing the body
	// while holding it couples a package-global lock to how fast the CLIENT reads: a slow reader would
	// block every connect and disconnect on the box for as long as it dawdled. The lock protects the file,
	// so it ends when the file is done with. unlockOnce keeps every early return correct.
	var unlockOnce sync.Once
	unlock := func() { unlockOnce.Do(modeLayerMu.Unlock) }
	modeLayerMu.Lock()
	defer unlock()

	// Re-asserted INSIDE the lock, not before it: checked outside, this is the very race the lock exists
	// to close.
	vars, cloud := s.cloudModeFile()
	if !cloud {
		refuseAllowlist(w, notCloudConfigured)
		return
	}
	entries := parseAllowlist(body.Allowlist)

	// THE GUARD, AND THE INVERSION A LATER READER WOULD "FIX" IT INTO.
	//
	// The platform reads an empty allowlist as NO RESTRICTION. Transcribe that faithfully and you get
	//
	//	if len(entries) > 0 && !contains(entries, sub) { refuse }
	//
	// which reasons — correctly — that an empty list excludes nobody, and therefore waves through the one
	// value that opens the deployment to every subject in a shared, multi-tenant identity pool. The empty
	// case is checked FIRST and refused on its own terms for that reason; it is not a required-field check
	// wearing a guard's clothes.
	if len(entries) == 0 {
		refuseAllowlist(w, emptyAllowlist)
		return
	}
	if len(entries) > maxAllowlistEntries {
		http.Error(w, fmt.Sprintf(tooManyEntries.detail, len(entries), maxAllowlistEntries), tooManyEntries.status)
		return
	}
	// EVERY ENTRY MUST BE PRINTABLE, and this is the check that makes the two parsers agree rather than the
	// separator list above.
	//
	// hasControlChar — the serializer's own guard — catches C0 and DEL, which is enough to defend the
	// one-NAME=value-per-line structure and not nearly enough here. The characters that matter are the ones
	// a CLIPBOARD carries: U+FEFF at the head of anything copied out of a Windows editor, U+200B and U+200F
	// from a web page, U+00AD from a wrapped document. Go treats none of them as space and none as a
	// control character, so before this check they rode into an entry intact, and:
	//
	//   - a lone U+FEFF was one entry here and NONE at the platform, which is the unrestricted deployment
	//     this route's headline refusal exists to prevent — the empty check above cannot see it;
	//   - a BOM-prefixed paste of a correct list wrote "\ufeffsub-a" instead of "sub-a", locking out one
	//     colleague at the next platform start while the count in the answer still read correctly. Nothing
	//     downstream would ever surface that, because nothing can show the list back.
	//
	// unicode.IsPrint is false for all of them and true for every character an identifier can contain, so
	// this refuses the class without asserting a FORMAT the issuer is free to change. U+00A0 never reaches
	// here — IsSpace covers it, so it was already a separator.
	for _, entry := range entries {
		for _, r := range entry {
			if !unicode.IsPrint(r) {
				http.Error(w, "The access list contains a character that cannot appear in an account identifier — usually an invisible one picked up by copying. "+
					"Nothing was changed. Copy the list again from the portal.", http.StatusBadRequest)
				return
			}
		}
	}

	// THE VALUE IS CHECKED BEFORE THE CALLER IS IDENTIFIED, and the order is deliberate. Both checks are
	// local and free, so admin.go's cheap-checks-first argument does not apply here; what decides it is the
	// cost of the REMEDY. Answering "sign in again" is a full-page redirect that discards whatever the
	// operator had typed, so refusing an unusable value first costs one round trip, while refusing the
	// identity first costs a redirect, a re-paste, and then the same refusal.
	if sub == "" {
		refuseAllowlist(w, unknownSubject)
		return
	}
	// The narrower thing this actually knows, said precisely: the list must admit the subject this SESSION
	// was minted for, so the session in the operator's hand can still be re-minted after the restart.
	//
	// ON A DEPLOYMENT THAT NAMES NO TEAM THIS IS THE ONLY CHECK ON THE ROUTE, because the gate stands aside
	// there entirely (admin.go). That is the gate's own rollout property rather than anything new here, and
	// the caller still had to hold a cloud session — which means the CURRENT list already admitted them.
	if !containsSubject(entries, sub) {
		http.Error(w, fmt.Sprintf(selfExcluded.detail, sub), selfExcluded.status)
		return
	}

	vars["DEPLOYMENT_ALLOWLIST"] = strings.Join(entries, ",")

	// THE FILE THIS WRITES MUST BE ONE THE CONNECT PATH WOULD HAVE ACCEPTED. This route does not go through
	// cloudModeVars, so the present-and-non-empty rule that stops a half-written recipe booting a broken
	// deployment does not apply to it for free. Re-running it over the map about to be written makes that a
	// checked property rather than an intention — and it is the difference between refusing and leaving a
	// deployment that cannot start.
	if missing := missingRequiredVars(vars); len(missing) > 0 {
		s.logger.Error("refusing an allowlist apply that would leave the mode layer incomplete", "missing", strings.Join(missing, ","))
		// THE NAMES GO TO THE OPERATOR AND NOT ONLY TO THE LOG. The operator is looking at a browser, and a
		// refusal with no remedy pushes them toward the one control that visibly does something —
		// disconnect — which is the destructive act this route exists to remove from their path. These are
		// documented configuration names, not secrets.
		http.Error(w, fmt.Sprintf("This deployment's configuration is missing %s, so the console will not rewrite it — a partial configuration "+
			"would leave the platform unable to start. Nothing was changed. Regenerate the deployment recipe in the portal.",
			strings.Join(missing, ", ")), http.StatusConflict)
		return
	}

	if err := writeModeLayerLocked(s.cfg.ModeLayerPath, vars); err != nil {
		s.logger.Error("writing the mode layer", "err", err)
		http.Error(w, "The console could not write this deployment's configuration, so nothing was changed. Check that the deployment's "+
			"files are writable and try again.", http.StatusInternalServerError)
		return
	}

	// The file is written; nothing below touches it, so the lock ends here rather than at the return.
	unlock()

	// The shape of the change and never its content — the same rule the response follows, for the same
	// reason. What an audit needs is that the list changed, by whom, and by how much.
	s.logger.Info("allowlist applied", "subjects", len(entries), "session_sub", sub)

	writeJSON(w, http.StatusOK, allowlistResult{
		Status:   "applied",
		Subjects: len(entries),
		Message:  allowlistRestartConsequence,
	})
}

// containsSubject reports whether the list admits this subject. Exact match: the platform compares the
// `sub` claim with ===, so a case-insensitive or trimmed comparison here would claim an admission the
// platform will not make.
func containsSubject(entries []string, sub string) bool {
	for _, e := range entries {
		if e == sub {
			return true
		}
	}
	return false
}

// missingRequiredVars names every recipe variable that must be present and non-empty and is not. It is the
// same rule cloudModeVars applies to a pasted recipe, over a map that is about to be written instead.
func missingRequiredVars(vars map[string]string) []string {
	var missing []string
	for name := range acceptedRecipeVars {
		if v, ok := vars[name]; !ok || v == "" {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	return missing
}

func refuseAllowlist(w http.ResponseWriter, refusal allowlistRefusal) {
	http.Error(w, refusal.detail, refusal.status)
}
