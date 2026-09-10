package daemoncmd

import (
	"net/http"
)

// The admin gate. Every route that CHANGES this deployment requires that the caller administers the team
// the deployment belongs to; every route that only reads it does not.
//
// WHY A ROLE AT ALL. The console is served on the same origin as the platform and gates on nothing but a
// valid session, so before this any member of a team could reach it and disconnect the deployment —
// removing every cloud-provided module, and with them the classes those modules declare and every link
// those classes are in. That is the irreversible act a role is being introduced to put behind someone.
//
// WHOSE ADMIN — the question has to name a team, and only one team is the right one. A person may
// administer one team and merely belong to another, so "is this person an administrator" is not a
// well-formed question; "do they administer THE TEAM THIS DEPLOYMENT BELONGS TO" is. The deployment names
// its own team in its configuration and the entitlements answer is scoped to that name, so the answer this
// gate reads is about one team and never a union across the caller's memberships. A union here would hand
// an administrator of one customer's team the power to disconnect another's.
//
// IT IS NOT TAMPER-RESISTANCE, and nothing here should be read as claiming to be. The console is open
// source, it runs on the customer's own machine, and an administrator of that machine can edit the mode
// layer directly. The gate exists so that a TEAM can control its own deployment, and it is honest at that
// job; the answer it reads is a fact the cloud confirms about the caller, never a capability the cloud
// grants. Specifying it to a higher standard is specifying a different product.
//
// NOTHING IS CACHED. The gate asks on every gated request and never honours an earlier answer. A cached
// authorization decision honoured while the authority cannot be reached is an unbounded grant to whoever
// can interrupt this deployment's network — the same defect that ruled out carrying the role in the
// deployment's own configuration, except that here the event is an attacker's to produce at will. And the
// cache would have bought nothing: these are occasional operator clicks rather than a request path, so
// there is no latency to trade, and what the INTERFACE needs in order to know which controls to offer
// already arrives with the catalog read. Display reads that answer; enforcement asks its own.

// adminRefusal is one gate outcome the caller is refused with: an HTTP status the SPA can branch on, and
// the sentence an operator reads.
//
// THREE STATUSES RATHER THAN THREE SENTENCES AT ONE STATUS. The SPA branches on ApiError.status and is
// built not to match on message text, so a remedy that only a sentence distinguishes is a remedy no
// interface can act on differently. The three are genuinely different situations:
//
//   - 403 — you are not an administrator. Ask someone who is; retrying changes nothing.
//   - 503 — the check could not be made. Wait and retry; the console is refusing rather than guessing.
//   - 412 — this tab holds no cloud credential to ask with. Sign in again; waiting will not help.
//   - 409 — this deployment can never make the check. A new recipe is needed; retrying is futile.
//
// AND NEVER 401. The SPA turns ANY 401 into clearSession() plus its session-expired path, so a gate
// refusal returned as 401 would sign the operator out of their own console for the crime of not being an
// administrator. That is the same reason the session mint route refuses to answer 401.
type adminRefusal struct {
	status int
	detail string
}

var (
	// notAnAdmin names the role required and who can grant it. An operation that vanishes from the
	// interface, or one that returns a raw error, is the version of this feature that generates support
	// tickets instead of preventing damage.
	notAnAdmin = adminRefusal{
		status: http.StatusForbidden,
		detail: "You are not an administrator of the team this deployment belongs to, and this operation changes the deployment. Nothing was changed. " +
			"An owner or administrator of that team can grant you the administrator role in the portal.",
	}
	// couldNotCheck is the fail-closed arm. It says the check failed rather than asserting anything about
	// the caller, because the two have opposite remedies and collapsing them produces the support ticket
	// this gate exists to avoid.
	couldNotCheck = adminRefusal{
		status: http.StatusServiceUnavailable,
		detail: "The console could not reach the content service to check whether you administer this deployment, so nothing was changed. Wait a moment and try again.",
	}
	// notSignedIn is the one cause the console can see locally: no operator access token arrived with the
	// request, so there is no credential to ask with.
	//
	// ITS OWN STATUS, and not a second sentence at 503, because the remedy is a different CONTROL. 503 means
	// wait; this means sign in, and an interface that cannot tell them apart can only offer the wrong one.
	// The token is memory-only, so this is the ordinary state of a reloaded tab rather than a fault.
	//
	// 412 rather than 401: a precondition of the request was not met, and 401 is banned here because the
	// SPA answers any 401 by clearing the session — signing the operator out of the console because a
	// credential for a DIFFERENT service was missing.
	//
	// A DEPLOYMENT THE GATE DOES NOT COVER NEVER SEES THIS, which is what makes REACTING to it correct where
	// PREDICTING it is not. A console cannot know locally whether the operator's token will be needed: that
	// depends on the deployment naming a team, which is this file's rule and not the interface's. A
	// client-side pre-flight would therefore demand a sign-in on every deployment whose recipe predates the
	// team identifier — where mounting has never needed a credential, and still does not.
	notSignedIn = adminRefusal{
		status: http.StatusPreconditionFailed,
		detail: "This tab no longer holds your cloud sign-in, so the console could not check whether you administer this deployment. Nothing was changed. Sign in to the cloud again to continue.",
	}
	// cannotEverCheck is the permanent case, and it must not read as the transient one. A deployment whose
	// recipe omits the content scope obtains a perfectly good token for the scopes it did ask for, so the
	// failure looks exactly like an outage from the wire and would otherwise be answered "retry", forever.
	cannotEverCheck = adminRefusal{
		status: http.StatusConflict,
		detail: "This deployment's configuration does not let the console check who administers it, so it cannot run this operation for anyone. " +
			"Fixing it means regenerating the deployment recipe in the portal and reconnecting — see what disconnecting costs before you do. " +
			"Disconnecting itself does not need the check and is still available.",
	}
)

// requireAdmin wraps a route that changes the deployment. It composes OVER the session check rather than
// replacing it — a caller must hold a session first, and then administer the team.
//
// It is a method on *server, not on *sessions like requireSession, because it needs three things the
// session does not carry: the mode-layer path, the content target, and the operator's access token. The
// session records an expiry and a display-only identity and holds no credential at all, which is exactly
// why this asks the cloud rather than reading a local record — only the first is worth building.
func (s *server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.gate(next, false)
}

// requireAdminOrRecovery is requireAdmin for DISCONNECT ALONE, and the difference is one carve-out: a
// deployment that can never ask is let through instead of refused.
//
// The gate fails closed, and failing closed is only acceptable because the permanent case has a way out.
// An outage that ends is something an operator waits out. An outage that CANNOT end — a deployment
// configured without permission to ask at all — would otherwise be a lockout, and the operation an
// operator reaches for to fix a bad recipe is precisely this one. So the no-cache decision above and this
// carve-out ship together, or neither is safe.
//
// AND IT IS DISCONNECT'S ALONE. The predicate is a property of the whole deployment, so written over every
// gated route it would ungate mount, unmount, install and remove on any deployment whose recipe lacks the
// content scope — turning a recovery carve-out into a blanket bypass. What justifies it here is
// specifically that disconnect is the recovery path; nothing else on the list is, and nothing else gets it.
func (s *server) requireAdminOrRecovery(next http.HandlerFunc) http.HandlerFunc {
	return s.gate(next, true)
}

// gate is the whole decision, in the order that keeps the free checks free.
//
// THE LOCAL CHECKS COME FIRST, and not merely to save a round trip. Each reads the mode file this console
// wrote itself, and each is a case where ASKING WOULD PRODUCE A WORSE ANSWER THAN NOT ASKING — a question
// the service cannot scope, or one it has no way to receive. The cloud is called only past all of them,
// and then it is called fresh, every time.
//
// The order is load-bearing where the cases overlap. A deployment that names no team passes through before
// the configuration checks can refuse it, because "behave exactly as before the gate existed" must hold for
// the whole fleet and must not be quietly withdrawn by an unrelated fault in the same file.
// decided records the outcome of a gate decision that actually made one.
//
// THE GATE PUTS AN IRREVERSIBLE ACT BEHIND SOMEBODY AND MUST SAY WHO ASKED. After a deployment is
// disconnected — legitimately or not — the question is who, when, and which arm decided; without a record
// the answer is nowhere, because the console keeps no state and the cloud only ever saw a read. It is also
// the only thing that would surface a gate silently standing aside: a pass-through logs nothing to
// distinguish it from a deployment that was never gated.
//
// THE FIELD IS session_sub AND NOT sub, because those are not the same claim and the name should not
// suggest they are. The decision is made against the credential in this REQUEST; the subject recorded here
// is the one the SESSION was minted for, decoded from an ID token the platform verified at mint. Nothing
// binds the two, so a caller holding both credentials could in principle produce a line attributing their
// action to the session's subject. That is no escalation — they already hold both — but a log that reads as
// forensic evidence of who disconnected a deployment should not overstate what it knows.
//
// THE TOKEN IS NEVER LOGGED, and neither is anything read from the cloud's answer beyond the decision.
func (s *server) decided(r *http.Request, arm string, allowed bool) {
	s.logger.Info("admin gate",
		"route", r.Method+" "+r.URL.Path,
		"arm", arm,
		"allowed", allowed,
		"session_sub", s.sess.identityOf(r.Header.Get(sessionHeader)).sub,
	)
}

func (s *server) gate(next http.HandlerFunc, recoveryPath bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// NOT CLOUD MODE — no gate. A local, pre-cloud session carries no identity at all: the console
		// mints it with no credential, on single-user host trust. There is no subject, no team, and no
		// cloud to ask. Applying a role check where no roles exist would lock an operator out of their own
		// console before they had anything to lose.
		//
		// THIS ARM IS A FAIL-OPEN AND IS ACCEPTED AS ONE, said plainly so the next reader does not have to
		// work it out. cloudModeFile reports false for a mode file it cannot READ as well as for one that
		// is genuinely local, and both land here. Reaching it needs a filesystem fault or host access, which
		// the threat model above already concedes; and four of the five gated handlers re-check posture for
		// themselves and refuse, while the fifth is disconnect, where proceeding is the recovery rather than
		// the hazard. If this file ever grows a caller for which neither is true, the read error needs its
		// own arm.
		vars, cloud := s.cloudModeFile()
		if !cloud {
			next(w, r)
			return
		}

		base, team, teamMalformed := s.contentTargetFrom(vars)

		// NO TEAM — no gate, and this deployment behaves exactly as it did before the gate existed.
		//
		// This is the rule the team identifier already carries: it is an OPTIONAL recipe variable, and
		// absent means behave as today. Every prior optional variable was added the same way and for the
		// same reason — a console reaches a deployment only when its operator upgrades, so a new console
		// meets old recipes for as long as it takes everyone to re-apply.
		//
		// GATING HERE WOULD REFUSE EVERY OPERATOR WITH THE WRONG SENTENCE. The service cannot scope
		// `admin` to a team the request did not name, so it omits the field rather than answering the
		// union — correctly, and fail-closed — and an omitted field reads as false. The caller would be
		// told "you are not an administrator" when what is actually missing is a line in their recipe.
		// The console knows this locally and must not ask a question whose answer it would misread.
		//
		// It closes on its own: the gate switches itself on per deployment as team identifiers arrive,
		// and universally when the variable is promoted to required.
		// A MALFORMED VALUE IS NOT AN ABSENT ONE, and reading it as one would be the gate's own off-switch.
		// contentTargetFrom blanks an identifier this console will not use, so folded together a single
		// mistyped character in the mode file turns the gate off — silently, and looking exactly like the
		// supported pre-team state. It is answered as the configuration fault it is, below.
		if team == "" && !teamMalformed {
			next(w, r)
			return
		}

		// CANNOT EVER ASK — the permanent case, told apart from an outage without a round trip.
		//
		// TWO CAUSES, ONE ANSWER, and they are grouped because the operator's remedy is identical: fix the
		// configuration. A deployment whose OIDC_SCOPE omits the content scope still obtains a valid token
		// for the scopes it did request, so every entitled call fails on scope. A deployment whose content
		// base is missing or unusable has nowhere to send the question at all — contentTargetFrom blanks a
		// base it cannot validate, and logs which value it rejected.
		//
		// THE SECOND CAUSE HAS TO BE HERE RATHER THAN LEFT TO THE CALL. resolveEntitlements refuses an
		// empty base before dialling and reports could-not-ask, which is the correct answer for its own
		// callers and the WRONG remedy for this one: it would tell an operator to retry in a moment, every
		// moment, forever. It is the same defect the scope check exists to prevent, one variable along, and
		// nothing but the deployment's own configuration can tell either of them from an outage.
		if !canAskForEntitlements(vars) || base == "" || teamMalformed {
			if recoveryPath {
				s.decided(r, "recovery: this deployment can never check", true)
				next(w, r)
				return
			}
			s.decided(r, "cannot ever check", false)
			http.Error(w, cannotEverCheck.detail, cannotEverCheck.status)
			return
		}

		// No credential to ask with. Refused BEFORE the call rather than inside it, so a tab whose tokens
		// are gone does not dial the content service carrying a bare "Bearer " and no credential.
		token := cloudAccessToken(r)
		if token == "" {
			s.decided(r, "no operator credential in this request", false)
			http.Error(w, notSignedIn.detail, notSignedIn.status)
			return
		}

		// The live ask. Every failure — transport, refusal, unrecognised body — arrives as ok=false, which
		// is could-not-check and never "not an administrator". The two are one sentence apart and the
		// wrong one of them sends an operator to a colleague for an outage.
		answer, ok := resolveEntitlements(r.Context(), base, token, team)
		if !ok {
			s.decided(r, "could not reach the cloud", false)
			http.Error(w, couldNotCheck.detail, couldNotCheck.status)
			return
		}
		if !answer.admin {
			s.decided(r, "not an administrator", false)
			http.Error(w, notAnAdmin.detail, notAnAdmin.status)
			return
		}
		s.decided(r, "administrator", true)
		next(w, r)
	}
}
