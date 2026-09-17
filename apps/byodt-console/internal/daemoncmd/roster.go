package daemoncmd

import (
	"net/http"
)

// The two admin-gated READS: the roster relay and the access-list read.
//
// Every read the console served before these was open to any session holder, and the route table's rule
// said why — a member who cannot see what their deployment has is worse served than one who cannot change
// it. These two are the named exception, because what they reveal is not what the deployment HAS but WHO
// MAY SIGN IN TO IT. The roster names the team's people by address; the local list is the selection among
// them. Neither is something a member is owed a view of, and both are gated in routes() exactly as the
// routes that change the deployment are: composed over the session check, asked live, never cached.
//
// THE ROSTER IS RELAYED, AND THE PAGE CANNOT FETCH IT FOR ITSELF. The content service's entitled tier
// serves no CORS, and the deployment-scoped token in the tab is the right credential for it — so the
// daemon asks on the page's behalf, with the operator's bearer and this deployment's team, over the same
// transport every other entitled call uses. What that costs is that addresses pass through this process's
// memory for the length of one request, and this file is arranged so that they go nowhere else: not to a
// log line, not to the mode layer, not to any file. The apply's audit line is deliberately "the shape of
// the change and never its content"; here there is no change, so nothing from either body is logged at
// all, and the test that holds that in place fails if a byte of the relayed body reaches a log record.
//
// THE ONE OUTCOME OF THE GATE THESE TWO MUST NOT INHERIT. The gate stands aside on a deployment that names
// no team (admin.go), and for the six routes that change the deployment that is correct — they behave
// exactly as they did before the gate existed. A read that inherited the pass-through would be UNGATED on
// exactly those deployments: any session holder could read who may sign in. So both refuse there, on their
// own and before anything is read, with the sentence the card shows — a recipe that predates team
// identifiers is the deployment's fault to fix, not the caller's. The relay would have to refuse anyway,
// having no team to name; the list read refuses for the reason above alone.

var (
	// noTeamNamed is the reads' own refusal on a deployment whose recipe predates team identifiers. 409 and
	// not 403: nobody is being told they lack a role, and retrying changes nothing — the same status the
	// gate uses for a deployment that can never make its check, because the remedy is the same one.
	//
	// It is deliberately NOT the gate's cannotEverCheck sentence, although the status matches. That one
	// says the deployment cannot check WHO ADMINISTERS it; this says the deployment cannot say WHICH TEAM it
	// belongs to, which is the earlier fault and the one the operator has to read. A malformed identifier
	// is answered with the gate's sentence instead — see teamOrRefuse — because there the configuration is
	// present and wrong rather than absent.
	noTeamNamed = allowlistRefusal{
		status: http.StatusConflict,
		detail: "This deployment's recipe predates team identifiers, so the console cannot tell which team it belongs to — " +
			"and without that it will show neither the team nor who may sign in. Nothing was changed. " +
			"Regenerate the deployment recipe in the portal and reconnect — see what disconnecting costs before you do.",
	}
	// rosterUnavailable is the retry arm, at the gate's own status for the same situation. It says the
	// fetch failed rather than asserting anything about the team, because "could not fetch" and "nobody is
	// on it" are one empty list apart and the wrong one of them shows a colleague as having left.
	rosterUnavailable = allowlistRefusal{
		status: http.StatusServiceUnavailable,
		detail: "The console could not fetch this team's roster from the content service. Nothing was changed. Wait a moment and try again.",
	}
	// rosterRefusedForThisSignIn is the arm the gate never needs and this relay does. The gate has already
	// confirmed the caller administers the team, so a refusal here is not about the person: the service
	// serves a roster only to a sign-in that came through the team's own deployment client, and answers
	// every cause with one refusal by design, so the console cannot say more than that. 502 rather than
	// 403, because 403 is the SPA's "you are not an administrator" and that is exactly what this is not.
	rosterRefusedForThisSignIn = allowlistRefusal{
		status: http.StatusBadGateway,
		detail: "The content service declined to serve this team's roster to this sign-in. The console has already confirmed that you " +
			"administer the team, so the refusal is about the deployment's sign-in configuration rather than about you: a roster is served " +
			"only to a sign-in made through the team's own deployment. Nothing was changed. If this deployment's configuration was assembled " +
			"by hand, regenerate the recipe in the portal.",
	}
	// rosterSignInLapsed is the gate's notSignedIn one step later: the tab held a credential, the gate
	// asked with it and was answered, and the roster call was then refused as unauthenticated. The same
	// status, because the remedy is the same control — sign in — and its own sentence, because the gate's
	// says the console could not check who administers the deployment, and it did.
	rosterSignInLapsed = allowlistRefusal{
		status: http.StatusPreconditionFailed,
		detail: "The content service no longer accepts this tab's cloud sign-in, so the roster could not be fetched. Nothing was changed. " +
			"Sign in to the cloud again to continue.",
	}
)

// rosterView is what the relay answers with: the members of the team this deployment belongs to, by
// subject and address, in the order the service published them. Never null — a team the service reports
// nobody on is `[]`, and the page decides what to say about that.
type rosterView struct {
	Members []rosterMember `json:"members"`
}

// allowlistView is what the list read answers with: the identifiers DEPLOYMENT_ALLOWLIST names, in the
// canonical form the apply writes — de-duplicated and sorted — whatever form the file happens to carry.
// Never null, for the same reason.
type allowlistView struct {
	Subjects []string `json:"subjects"`
}

// teamOrRefuse answers which team this deployment names and where its content service is, or refuses on
// the handler's behalf and reports that it did. It is the whole of the rule that both reads must decide for
// themselves rather than inherit: no usable team, no answer.
//
// ABSENT AND MALFORMED ARE TOLD APART, exactly as the gate tells them apart, and answered with different
// sentences: absent is the supported pre-team state and gets the reads' own sentence about a recipe that
// predates team identifiers; malformed is a configuration fault and gets the gate's, because somebody wrote
// a value this console will not use and "regenerate the recipe" is the wrong remedy for a typo. The gate
// refuses the malformed case before either handler runs, so the second arm is reached only if it is
// bypassed — and a handler that is correct only while wrapped is not correct.
func (s *server) teamOrRefuse(w http.ResponseWriter, vars map[string]string) (base, team string, ok bool) {
	base, team, malformed := s.contentTargetFrom(vars)
	if team != "" {
		return base, team, true
	}
	if malformed {
		http.Error(w, cannotEverCheck.detail, cannotEverCheck.status)
		return "", "", false
	}
	refuseAllowlist(w, noTeamNamed)
	return "", "", false
}

// cloudRoster relays the team roster to an administrator. It is admin-gated in routes().
func (s *server) cloudRoster(w http.ResponseWriter, r *http.Request) {
	// Re-asserted here rather than trusted to the gate, for the reason every handler behind it re-asserts
	// posture: the gate's local-mode arm is a fail-open, accepted because the handlers refuse for
	// themselves. A pre-cloud deployment has no team, no content service and no roster to relay.
	vars, cloud := s.cloudModeFile()
	if !cloud {
		refuseAllowlist(w, notCloudConfigured)
		return
	}
	base, team, ok := s.teamOrRefuse(w, vars)
	if !ok {
		return
	}
	// An unusable base is the permanent case — nowhere to send the question — and the gate has already
	// said so with this sentence. Repeated here so the handler answers the same thing standing alone.
	if base == "" {
		http.Error(w, cannotEverCheck.detail, cannotEverCheck.status)
		return
	}
	// No credential to ask with, refused before dialling — and 412 rather than 401, because the SPA
	// answers any 401 by clearing the session. The gate refuses this first; the check is repeated so
	// nothing here depends on being wrapped.
	token := cloudAccessToken(r)
	if token == "" {
		http.Error(w, notSignedIn.detail, notSignedIn.status)
		return
	}

	members, outcome, err := fetchRoster(r.Context(), base, token, team)
	switch outcome {
	case rosterUnreachable:
		if err != nil {
			// The transport's error names the path and the host, never the body. It goes to the log
			// because it is the only thing that tells an operator WHY the fetch failed; the sentence they
			// see must not carry an upstream-chosen URL.
			s.logger.Error("fetching the team roster", "err", err)
		}
		refuseAllowlist(w, rosterUnavailable)
		return
	case rosterUnauthenticated:
		refuseAllowlist(w, rosterSignInLapsed)
		return
	case rosterRefused:
		refuseAllowlist(w, rosterRefusedForThisSignIn)
		return
	}
	if members == nil {
		members = []rosterMember{}
	}
	// no-store, the same instruction the service puts on its own answer and for the same reason: a body
	// naming people must not be storable by anything between this process and the page.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, rosterView{Members: members})
}

// cloudAllowlistRead answers the identifiers this deployment admits at sign-in. It is admin-gated in
// routes(), and it is the one route that surfaces the access list — the apply reports a count and the
// posture read projects a fixed field set precisely so the list stays off every other answer.
//
// NO LOCK. The apply holds modeLayerMu across its read and its write because the read decides what the
// write contains; this reads and decides nothing. The file is written atomically, so a read racing an
// apply sees the list before or the list after, never a torn one.
func (s *server) cloudAllowlistRead(w http.ResponseWriter, r *http.Request) {
	vars, cloud := s.cloudModeFile()
	if !cloud {
		refuseAllowlist(w, notCloudConfigured)
		return
	}
	if _, _, ok := s.teamOrRefuse(w, vars); !ok {
		return
	}
	subjects := parseAllowlist(vars["DEPLOYMENT_ALLOWLIST"])
	if subjects == nil {
		subjects = []string{}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, allowlistView{Subjects: subjects})
}
