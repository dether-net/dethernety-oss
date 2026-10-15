package daemoncmd

import (
	"context"
	"net/http"
	"strings"
	"sync"
)

// Moving a connected deployment's knowledge-graph pin forward, without disconnecting.
//
// The pin is written at connect (pinKnowledgeGraph). Without this route the only way to a newer knowledge
// graph is to disconnect and reconnect, and disconnecting removes every cloud-provided module, so the next
// platform start deletes the classes they declared and every link to them. This route changes the one
// variable instead, the way the allowlist apply changes its own, and leaves every mount where it is.
//
// WHAT KEEPS THE PIN DELIBERATE. The console still writes only the service's latest version, and only the
// one the operator was shown: the request names the version from the page, and the route writes it only
// if the listing — read again, from the base URL in the mode file — still names it as latest. Neither the
// page nor a request alone can choose a version, and nothing advances on its own: a deployment moves only
// when an administrator asks it to.

// The states the inventory reports for the pinned version, relative to the listing (kgCurrencyOf).
const (
	kgCurrent  = "current"
	kgOutdated = "outdated"
	kgRecalled = "recalled"
	kgUnknown  = "unknown"
)

// kgUpdateNotice is the sentence the operator reads BEFORE updating, served with the inventory so the page
// holds no copy of its own that could drift from what the route does.
//
// It says what the restart is and is not, for the reason the allowlist's receipt does: an operator is
// taught to fear a platform start that finds modules missing, and this is not that one. And it says what
// the page cannot: the inventory reads the configuration, not the running platform, so after an update this
// page shows the new version while the platform still answers from the old one until it restarts.
const kgUpdateNotice = "Updating changes which version of the knowledge graph this deployment asks, and nothing else. " +
	"It takes effect when you restart the platform: " + platformRestartCommand + ". Until then the platform keeps answering " +
	"from the version it started with, even though this page shows the new one. That restart removes no module, so it " +
	"has none of the consequences for your classes and links that a restart finding a module missing does. Analyses run " +
	"after it may differ from earlier ones, because the rules they draw on have changed."

// kgCurrencyOf judges the pinned version against the listing, in a fixed order. The order is the point:
// a withdrawn pin that is also the latest version must read as withdrawn, never as up to date, so the
// recall is asked before equality.
//
// It returns the state, the version the operator may update to ("" when there is none), and a note for the
// states that need one.
func kgCurrencyOf(list kgVersionList, pinned string) (currency, offer, note string) {
	latest := list.usableLatest()
	if list.recalled(pinned) {
		// A withdrawn pin can never be a usable latest — usableLatest refuses a recalled one — so an empty
		// offer means there is nowhere to go yet. No note either way: the connection's own entry says what a
		// withdrawn version means, and a second copy at the foot of the inventory would say it twice.
		return kgRecalled, latest, ""
	}
	if pinned == list.Latest {
		return kgCurrent, "", ""
	}
	if latest == "" {
		return kgUnknown, "", kgNoUsableVersionNote
	}
	// A pin the listing does not name lands here too. The listing never prunes a version, so that is a
	// hand-edited pin; offering the listing's latest is the remedy, and the page claims nothing about which
	// of the two is newer.
	return kgOutdated, latest, ""
}

// kgUpdateResult is the route's answer. From and Version are full digests; Message is the receipt.
type kgUpdateResult struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	From    string `json:"from,omitempty"`
	Message string `json:"message"`
}

// The sentences for a connection that is not whole, in pairs: the route's refusal and the inventory's note
// say the same thing, so they live together and are edited together.
const (
	kgNotConfigured = "This deployment has no usable knowledge-graph service configured, so there is nothing to update. " +
		"Disconnecting and reconnecting is what configures one."
	kgNotConfiguredNote = "this deployment has no usable knowledge-graph service configured, so whether an update exists " +
		"cannot be checked; disconnecting and reconnecting is the remedy"

	kgHalfState = "This deployment is configured for a knowledge-graph service but its module is not mounted, so it is not " +
		"updated. Disconnect and reconnect to restore it."
	kgHalfStateNote = "this deployment is configured for a knowledge-graph service but its module is not mounted — " +
		"disconnect and reconnect to restore it"

	kgNoPin = "This deployment has a knowledge-graph module mounted but no version pinned, so it is not updated. " +
		"Disconnect and reconnect to restore it."
	kgNoPinNote = "this deployment has a knowledge-graph module mounted but no version pinned — disconnect and " +
		"reconnect to restore it"

	kgUnreachableNote     = "the knowledge-graph service could not be reached, so whether an update exists could not be checked"
	kgNoUsableVersionNote = "the knowledge-graph service's version listing offers no usable version, so whether an update " +
		"exists could not be checked"
)

// cloudKgUpdate moves MODULE_KG_VERSION to the version the operator was shown, if it is still the latest.
//
// THE LISTING IS READ OUTSIDE THE LOCK. modeLayerMu also serialises the disconnect's revert, and an outbound
// request can take as long as its timeout: holding the lock across it would let a slow remote host stall
// the recovery path, which the disconnect is built never to wait on. So the route reads the mode file and
// the listing first, then takes the lock and reads the file again — and refuses if the base URL it dialled
// is no longer the one the file names. That is what stops a version listed by one service being written
// into a file that now points at another, after a disconnect and reconnect landed in between.
func (s *server) cloudKgUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version string `json:"version"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	vars, cloud := s.cloudModeFile()
	if !cloud {
		http.Error(w, "the knowledge graph can be updated only on a deployment connected to the cloud", http.StatusConflict)
		return
	}
	if !pinPattern.MatchString(body.Version) {
		http.Error(w, "invalid knowledge-graph version", http.StatusBadRequest)
		return
	}
	base := s.kgBaseFrom(vars)
	if base == "" {
		http.Error(w, kgNotConfigured, http.StatusConflict)
		return
	}
	if _, ok := kgMounted(s.cfg.ModulesDir); !ok {
		http.Error(w, kgHalfState, http.StatusConflict)
		return
	}
	if vars["MODULE_KG_VERSION"] == "" {
		http.Error(w, kgNoPin, http.StatusConflict)
		return
	}

	list, err := readKgListing(r.Context(), base)
	if err != nil {
		s.logger.Warn("reading the knowledge-graph version listing for an update", "err", err)
		http.Error(w, "The knowledge-graph service could not be reached, so nothing was changed. Try again later.", http.StatusServiceUnavailable)
		return
	}
	latest := list.usableLatest()
	if latest == "" {
		http.Error(w, "The knowledge-graph service offers no usable version right now, so nothing was changed.", http.StatusConflict)
		return
	}
	if body.Version != latest {
		// "Changed", not "a newer one was published": a stale cached listing on either read can make the latest
		// the route sees differ from the page's in either direction.
		http.Error(w, "The knowledge-graph service's latest version changed after this page loaded, so nothing was changed. "+
			"It is now "+describeKgVersion(list, latest)+"; update again to take it.", http.StatusConflict)
		return
	}

	// From here to the write is one critical section, for the allowlist's reason: the read decides what the
	// write contains. Unlocked before a success is answered, so a slow reader never holds it; a refusal is
	// written under it, as the allowlist's are, which costs a buffered write and nothing more.
	var unlockOnce sync.Once
	unlock := func() { unlockOnce.Do(modeLayerMu.Unlock) }
	modeLayerMu.Lock()
	defer unlock()

	vars, cloud = s.cloudModeFile()
	if !cloud {
		http.Error(w, "This deployment was disconnected while the update was being checked, so nothing was changed.", http.StatusConflict)
		return
	}
	if vars["MODULE_KG_BASE_URL"] != base {
		http.Error(w, "This deployment's cloud configuration changed while the update was being checked, so nothing was "+
			"changed. Reload and try again.", http.StatusConflict)
		return
	}
	if _, ok := kgMounted(s.cfg.ModulesDir); !ok {
		http.Error(w, kgHalfState, http.StatusConflict)
		return
	}
	// Asked again under the lock with the rest: a pin that went is not an update from nothing.
	from := vars["MODULE_KG_VERSION"]
	if from == "" {
		http.Error(w, kgNoPin, http.StatusConflict)
		return
	}
	if from == body.Version {
		unlock()
		writeJSON(w, http.StatusOK, kgUpdateResult{
			Status: "current", Version: body.Version,
			Message: "This deployment is already pinned to that version; nothing was changed.",
		})
		return
	}
	vars["MODULE_KG_VERSION"] = body.Version
	// The file this writes must be one the connect path would have accepted: the allowlist apply's guard,
	// for its reason.
	if missing := missingRequiredVars(vars); len(missing) > 0 {
		s.logger.Error("refusing a knowledge-graph update that would leave the mode layer incomplete", "missing", strings.Join(missing, ", "))
		http.Error(w, "This deployment's configuration is missing "+strings.Join(missing, ", ")+", so the console will not rewrite it — a partial "+
			"configuration would leave the platform unable to start. Nothing was changed. Regenerate the deployment recipe in the portal.",
			http.StatusConflict)
		return
	}
	if err := writeModeLayerLocked(s.cfg.ModeLayerPath, vars); err != nil {
		s.logger.Error("writing the mode layer", "err", err)
		http.Error(w, "The console could not write this deployment's configuration, so nothing was changed. Check that the "+
			"deployment's files are writable and try again.", http.StatusInternalServerError)
		return
	}
	unlock()

	// Versions are public digests; the subject is the one the allowlist's own log line records.
	s.logger.Info("knowledge-graph version updated", "from", from, "to", body.Version,
		"session_sub", s.sess.identityOf(r.Header.Get(sessionHeader)).sub)

	writeJSON(w, http.StatusOK, kgUpdateResult{
		Status: "applied", Version: body.Version, From: from,
		Message: "The knowledge graph is updated from " + describeKgVersion(list, from) + " to " +
			describeKgVersion(list, body.Version) + ". " + kgUpdateNotice,
	})
}

// describeKgVersion names a version for a receipt: its release date when the listing gives one, and a
// shortened digest, so an operator can copy the line into a change note and still find the version.
func describeKgVersion(list kgVersionList, id string) string {
	short := id
	if len(id) > len("sha256:")+12 {
		short = id[:len("sha256:")+12]
	}
	if at := list.releasedAt(id); at != "" {
		return "the version released " + at[:10] + " (" + short + ")"
	}
	return short
}

// knowledgeGraphCurrency fills the inventory's knowledge-graph view from the listing. A listing that cannot
// be read leaves the view intact and unknown, with a note: the inventory must not depend on the service.
func (s *server) knowledgeGraphCurrency(ctx context.Context, base string, view *knowledgeGraphView) string {
	list, err := readKgListing(ctx, base)
	if err != nil {
		s.logger.Warn("reading the knowledge-graph version listing", "err", err)
		view.Currency = kgUnknown
		return kgUnreachableNote
	}
	currency, offer, note := kgCurrencyOf(list, view.Version)
	view.Currency = currency
	view.PinnedReleasedAt = list.releasedAt(view.Version)
	if offer != "" {
		view.LatestVersion = offer
		view.LatestReleasedAt = list.releasedAt(offer)
		view.UpdateNotice = kgUpdateNotice
	}
	return note
}
