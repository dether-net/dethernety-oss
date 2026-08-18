package daemoncmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/assets"
	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/initcmd"
)

// server holds the daemon's collaborators. It is constructed by Run and never mutated after,
// so its handlers are safe to serve concurrently (the only shared mutable state, the live
// sessions, is guarded inside sessions).
type server struct {
	cfg         Config
	sess        *sessions
	plat        *platformClient
	ui          fs.FS
	logger      *slog.Logger
	mintLimiter semaphore // caps concurrent cloud-mint probes against the platform's auth path
}

// mintConcurrency caps the number of in-flight cloud-mint delegation probes. The mint route is
// ungated and (in cloud) fires a platform round-trip, so an unauthenticated loop could amplify
// load at the platform's auth path; the cap bounds that amplification regardless of request rate.
const mintConcurrency = 4

// semaphore is a plain counting semaphore over a buffered channel. tryAcquire never blocks: it
// takes a slot if one is free, or reports false immediately so the caller can shed load.
type semaphore chan struct{}

func newSemaphore(n int) semaphore { return make(semaphore, n) }

func (s semaphore) tryAcquire() bool {
	select {
	case s <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s semaphore) release() { <-s }

// Run starts the daemon and blocks until ctx is cancelled, then shuts the server down
// gracefully.
func Run(ctx context.Context, cfg Config, logger *slog.Logger) error {
	ui, err := assets.ConsoleUI()
	if err != nil {
		return fmt.Errorf("loading console UI: %w", err)
	}
	s := &server{
		cfg:         cfg,
		sess:        newSessions(),
		plat:        newPlatformClient(cfg.PlatformURL, cfg.ProbeTimeout),
		ui:          ui,
		logger:      logger,
		mintLimiter: newSemaphore(mintConcurrency),
	}

	srv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Bind, cfg.Port),
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		// Plain HTTP: the daemon runs behind the front door on the isolated stack network, which
		// terminates TLS at the edge for the whole stack. Encrypting this hop is the proxy's job.
		logger.Info("console daemon listening (http)", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	// Ungated: liveness, the static SPA (shell + hashed bundle), and the session mint (which
	// authenticates by posture — no secret locally, delegated OIDC in cloud). The SPA holds no
	// deployment data — every datum is behind a session-gated /api route — so serving it
	// unauthenticated is safe and lets the sign-in page load.
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /{$}", s.index)
	mux.Handle("GET /assets/", http.FileServerFS(s.ui))
	mux.HandleFunc("POST /api/session", s.session)
	// Ungated too: the posture read the sign-in page needs before it can hold a session — which
	// sign-in to render, plus the public OIDC discovery values the cloud PKCE runs against. Sourced
	// from the console-written mode file on disk, so it answers pre-session and while the platform is
	// down. It exposes only non-secret discovery values (see the handler's leak guard).
	mux.HandleFunc("GET /api/posture", s.posture)

	// Everything else requires a live session.
	mux.HandleFunc("GET /api/mode", s.sess.requireSession(s.mode))
	mux.HandleFunc("GET /api/state", s.sess.requireSession(s.state))
	// The cloud phase. Every route is session-gated like the rest of /api. POST (paste)
	// and DELETE (disconnect) carry no cloud identity — the paste path has no authenticated subject,
	// and disconnect is the recovery path that must never require the cloud.
	mux.HandleFunc("POST /api/cloud", s.sess.requireSession(s.cloudApply))
	mux.HandleFunc("DELETE /api/cloud", s.sess.requireSession(s.cloudDisable))
	// GET /auth/callback is the PKCE landing page: it serves the same SPA shell, which reads the code
	// from the query and completes the cloud sign-in exchange — its query string must never be logged,
	// so no request-URL logging goes on this (or any) route.
	mux.HandleFunc("GET /auth/callback", s.index)

	// Content mounts. Cloud-mode only: the public catalog host arrives with the cloud configuration,
	// and a mount stub only means anything against a configured content service. None of these carry a
	// cloud token — the catalog is public, and mounting writes a local file. GET reads the catalog and
	// the inventory; POST mounts one module at one pin (re-POST advances the pin); DELETE unmounts.
	mux.HandleFunc("GET /api/packages", s.sess.requireSession(s.packages))
	mux.HandleFunc("GET /api/modules", s.sess.requireSession(s.modulesList))
	mux.HandleFunc("POST /api/modules", s.sess.requireSession(s.mountModule))
	mux.HandleFunc("DELETE /api/modules/{key}", s.sess.requireSession(s.unmountModule))

	return mux
}

func (s *server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte("ok\n"))
}

func (s *server) index(w http.ResponseWriter, _ *http.Request) {
	data, err := fs.ReadFile(s.ui, "index.html")
	if err != nil {
		http.Error(w, "console UI unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

// session mints a console session, driven by the deployment posture read from the console-written
// mode file:
//   - local (pure-OSS / pre-cloud / own-IdP): mint with NO credential. The custom header (never a
//     cookie) already defeats CSRF, and under single-user host trust a secret here would only fence
//     out other local processes — which is not the boundary the product wants (unauthenticated-local
//     is a deliberate funnel toward the subscription). The session is long-lived.
//   - cloud: the SPA presents the operator's OIDC ID token as a bearer. The daemon forwards it to
//     the platform's authenticated { modules } query and mints IFF the platform returns clean data
//     — delegation. The platform performs ALL validation (signature, exp, iss, aud/client_id, and
//     the allowlist), so the console holds no jose/JWKS/allowlist logic. Any non-clean response is
//     "could not verify — retry," never a definitive token reject, because production formatError
//     masks an auth rejection and a platform blip to an identical generic error.
//
// The mint route never returns 401: a missing sign-in is 400 and a failed verification is 503, so
// the SPA's 401-means-session-expired handling can never be tripped by the mint itself.
func (s *server) session(w http.ResponseWriter, r *http.Request) {
	if modeFileIntent(s.cfg.ModeLayerPath) != intentCloud {
		id, err := s.sess.mint(0)
		if err != nil {
			http.Error(w, "minting session", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"session": id})
		return
	}

	// Cloud posture: delegate verification to the platform.
	idToken := bearerToken(r)
	if idToken == "" {
		// 400, not 401: this is a missing cloud sign-in, not an expired session — the SPA must not
		// mistake it for one and drop into its session-expired path.
		http.Error(w, "a cloud sign-in is required", http.StatusBadRequest)
		return
	}
	if !s.mintLimiter.tryAcquire() {
		http.Error(w, "the sign-in check is busy — retry", http.StatusServiceUnavailable)
		return
	}
	defer s.mintLimiter.release()

	if _, err := s.plat.registeredModules(r.Context(), idToken); err != nil {
		// Binary probe: any non-clean response. Do NOT assert a token problem — the platform may be
		// starting or busy, and production error-masking makes that indistinguishable from a reject.
		http.Error(w, "could not verify sign-in — the platform may be starting or busy; retry", http.StatusServiceUnavailable)
		return
	}
	// The platform verified the token above; read its display claims (unverified is fine — the platform
	// is the authority) so the console can show who is signed in.
	id, err := s.sess.mintWithIdentity(cloudSessionTTL, identityFromJWT(idToken))
	if err != nil {
		http.Error(w, "minting session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"session": id})
}

// modeView is the phase the UI renders. Phase is read from the platform, never from the
// console's own files — reading its own written file, the console would claim a mode the platform
// has not restarted into. Two flags do come from disk: CloudFileWritten (a console-written cloud
// file exists) lets the UI offer disconnect; RestartPending (the file's intent disagrees with what
// the platform is actually running) drives the "recreate the stack" banner and covers both the
// connect and the disconnect restart windows.
type modeView struct {
	Phase            string    `json:"phase"` // pre-cloud | authenticated | post-cloud | platform-unreachable
	AuthDisabled     bool      `json:"authDisabled"`
	OIDCIssuer       string    `json:"oidcIssuer,omitempty"` // shown in the phase badge; the only OIDC value the mode view still carries
	CloudFileWritten bool      `json:"cloudFileWritten"`
	RestartPending   bool      `json:"restartPending"`
	User             *userView `json:"user,omitempty"` // the signed-in subject (cloud only; display-only)
}

// userView is the display identity of the requesting session, shown in the console header.
type userView struct {
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
}

// sessionUser projects the requesting session's recorded identity into a userView, or nil when there
// is nothing to show (local sessions carry no identity).
func (s *server) sessionUser(r *http.Request) *userView {
	ident := s.sess.identityOf(r.Header.Get(sessionHeader))
	if ident.email == "" && ident.name == "" {
		return nil
	}
	return &userView{Email: ident.email, Name: ident.name}
}

const (
	phasePreCloud      = "pre-cloud"
	phaseAuthenticated = "authenticated"
	phasePostCloud     = "post-cloud"
	phaseUnreachable   = "platform-unreachable"
)

func (s *server) mode(w http.ResponseWriter, r *http.Request) {
	// The display/intent split: the phase comes from the platform, but the file's intent comes from
	// disk. The two together distinguish cloud from the operator's own IdP (both have
	// authDisabled=false) and detect a pending restart in either direction.
	intent := modeFileIntent(s.cfg.ModeLayerPath)
	cloudWritten := intent == intentCloud
	user := s.sessionUser(r)

	cfg, err := s.plat.config(r.Context())
	if err != nil {
		// Unreachable: the intent cannot be compared to the platform's actual mode, so no restart
		// is asserted — the unreachable phase already tells the operator the platform is not
		// answering. CloudFileWritten is still reported so the panel can offer disconnect.
		writeJSON(w, http.StatusOK, modeView{Phase: phaseUnreachable, CloudFileWritten: cloudWritten, User: user})
		return
	}
	v := modeView{AuthDisabled: cfg.AuthDisabled, OIDCIssuer: cfg.OIDCIssuer, CloudFileWritten: cloudWritten, User: user}
	switch {
	case cfg.AuthDisabled:
		v.Phase = phasePreCloud
	case cloudWritten:
		// Auth is on and the console wrote the cloud file: the platform restarted into our cloud.
		v.Phase = phasePostCloud
	default:
		// Auth is on but the console wrote no cloud file: the operator's own identity provider.
		v.Phase = phaseAuthenticated
	}
	// A restart is owed whenever the file's intent disagrees with what the platform is running: a
	// cloud file while the platform is still noauth (connect not yet applied), or the pure-OSS file
	// while the platform is still authenticated (disconnect not yet applied).
	v.RestartPending = (intent == intentCloud && cfg.AuthDisabled) || (intent == intentPureOSS && !cfg.AuthDisabled)
	writeJSON(w, http.StatusOK, v)
}

// postureView is the ungated read the sign-in page needs before it can hold a session: which sign-in
// to render, and — in cloud — the public OIDC discovery values the PKCE flow runs against. It is a
// HARD, five-field projection of the console-written mode file. That projection is the leak guard: the
// same file also holds DEPLOYMENT_ALLOWLIST (member subject ids), the commerce/content service URLs,
// and the JWKS URI / audience — none of which are returned. Never marshal the parsed map; only the
// named fields below.
type postureView struct {
	Posture      string `json:"posture"` // "cloud" | "local"
	AuthDisabled bool   `json:"authDisabled"`
	OIDCDomain   string `json:"oidcDomain,omitempty"`
	OIDCClientID string `json:"oidcClientId,omitempty"`
	OIDCScope    string `json:"oidcScope,omitempty"`
}

// posture is read from disk (the mode layer the console wrote), never from the platform — so it answers
// before any session exists and while the platform is down. It changes no auth behaviour on its own;
// the gate still runs on the console session. Posture is the console's own intent, not the platform's
// live state.
func (s *server) posture(w http.ResponseWriter, _ *http.Request) {
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		// Missing or unparseable mode file: the pre-cloud default is local, no-auth. readModeLayer
		// returns a nil map here, so answer explicitly rather than deriving from nil.
		writeJSON(w, http.StatusOK, postureView{Posture: "local", AuthDisabled: true})
		return
	}
	pv := postureView{
		Posture: "local",
		// The only file the console writes with noauth on is the pure-OSS one; a cloud file has no
		// ENABLE_NOAUTH. Keying off the marker alone avoids assuming whether the cloud file carries
		// NODE_ENV.
		AuthDisabled: vars["ENABLE_NOAUTH"] == "true",
		OIDCDomain:   vars["OIDC_DOMAIN"],
		OIDCClientID: vars["OIDC_CLIENT_ID"],
		OIDCScope:    vars["OIDC_SCOPE"],
	}
	// Cloud is derived from the SAME map already read above (not a second modeFileIntent read of the
	// file), so the posture and the fields can't straddle a concurrent write and report an impossible
	// combo. OIDC_SHARED_POOL present ⟺ intentCloud (mirrors isCloudModeFile / cloud.go).
	if _, ok := vars["OIDC_SHARED_POOL"]; ok {
		pv.Posture = "cloud"
	}
	writeJSON(w, http.StatusOK, pv)
}

// stateView is the console-init record plus the derived local failure banners.
type stateView struct {
	InitRan  bool                 `json:"initRan"`
	Tag      string               `json:"tag,omitempty"`
	RanAt    string               `json:"ranAt,omitempty"`
	Modules  initcmd.ModulesState `json:"modules"`
	Ingest   initcmd.IngestState  `json:"ingest"`
	Failures []failure            `json:"failures"`
}

func (s *server) state(w http.ResponseWriter, r *http.Request) {
	view := stateView{Failures: []failure{}}

	st, err := initcmd.ReadState(s.cfg.StatePath)
	if err != nil {
		if os.IsNotExist(err) {
			view.Failures = append(view.Failures, failure{Kind: failInitNotRun, Message: "the init one-shot has not written its state — it may not have run yet"})
			writeJSON(w, http.StatusOK, view)
			return
		}
		http.Error(w, "reading init state", http.StatusInternalServerError)
		return
	}
	view.InitRan = true
	view.Tag = st.Tag
	view.RanAt = st.RanAt
	view.Modules = st.Modules
	view.Ingest = st.Ingest

	// The placed-vs-registered diff needs the platform's live module set — but reachability is the
	// /config liveness signal, NEVER the module query. In cloud that query requires the operator's
	// bearer (forwarded here from the gated request); a rejected or bearer-less query must not be
	// mistaken for "the platform is down." So only an unreachable /config is reported as such;
	// otherwise the diff runs best-effort and is skipped silently on any non-clean module response (a
	// transient blip, or no bearer after a page reload). deriveModuleFailures skips the diff when
	// registered is nil, so a skipped query never yields a false placed-but-not-registered banner either.
	var registered map[string]struct{}
	if _, err := s.plat.config(r.Context()); err != nil {
		view.Failures = append(view.Failures, failure{Kind: failPlatformDown, Message: "the platform is not reachable — module registration could not be checked"})
	} else if mods, err := s.plat.registeredModules(r.Context(), bearerToken(r)); err == nil {
		registered = make(map[string]struct{}, len(mods))
		for _, m := range mods {
			registered[m.Name] = struct{}{}
		}
	}

	view.Failures = append(view.Failures, deriveModuleFailures(st.Modules, registered)...)
	if f := deriveIngestFailure(st.Ingest); f != nil {
		view.Failures = append(view.Failures, *f)
	}
	writeJSON(w, http.StatusOK, view)
}

// cloudApply writes a pasted recipe into the mode layer. It is the pre-cloud paste path: gated by
// session-gated but carrying no cloud identity. The write-guard reads the file (unlike the phase,
// which reads the platform) to refuse reconfiguring a cloud deployment during the restart window the
// console itself opens, when /config is briefly unreachable and the phase would otherwise read
// pre-cloud. The paste path has no authenticated subject, so it cannot carry the
// allowlist-self-exclusion guard a fetched apply does; the compensating control is that disconnect
// never needs the cloud.
func (s *server) cloudApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Recipe      string `json:"recipe"`
		RedirectURI string `json:"redirectUri"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	if isCloudModeFile(s.cfg.ModeLayerPath) {
		http.Error(w, "this deployment is already cloud-configured — disconnect from the cloud before reconfiguring", http.StatusConflict)
		return
	}
	// Trim once and use the same value for both validation and the write — validating one string
	// and writing another is how a redirect that "passed" ends up mismatching at Cognito.
	redirect := strings.TrimSpace(body.RedirectURI)
	if err := validateRedirectURI(redirect); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	recipe, err := parseRecipe(body.Recipe)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	vars, stripped, err := cloudModeVars(recipe, redirect, s.cfg.ContentCacheDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// The knowledge-graph pin is resolved HERE and not inside cloudModeVars, and the order is the
	// point: the recipe has now passed every name and value check, so a recipe that was going to be
	// rejected wholesale never causes the console to make a request to a host it named.
	kgNote := s.pinKnowledgeGraph(r.Context(), vars)
	if err := writeModeLayer(s.cfg.ModeLayerPath, vars); err != nil {
		s.logger.Error("writing mode layer", "err", err)
		http.Error(w, "writing cloud configuration", http.StatusInternalServerError)
		return
	}
	kgNote += s.applyKgMount(vars)
	// Posture just changed (local → cloud): drop every session minted under the old posture so none
	// survives across the flip — except this caller's, on a short grace deadline, so the instruction
	// this response carries is still readable and actionable instead of being replaced by a sign-in
	// card the new posture cannot yet satisfy. Every other client re-signs in against the new posture.
	s.sess.keepOnly(r.Header.Get(sessionHeader), postureGraceTTL)
	msg := "cloud configuration written; apply it by recreating the stack: " + stackRestartCommand
	if len(stripped) > 0 {
		// The console keeps the deployment's own exposure declaration; it never takes it from the
		// recipe. Say so, so the operator knows the recipe's value was not applied.
		msg += ". Kept this deployment's own " + strings.Join(stripped, ", ") + " (not taken from the recipe)"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "applied", "message": msg + kgNote})
}

// pinKnowledgeGraph resolves the version to pin from the service the recipe named, and writes it into
// vars beside the base URL. It returns a note for the operator, empty when there is nothing to say.
//
// Both variables are written or neither is. A base URL with no pin is inert anyway — the client
// refuses to fall back to whatever is newest, because that would advance the knowledge graph under a
// deployment that pinned deliberately — but it is inert while *looking* configured, and it makes the
// platform log a misconfiguration on every boot about a decision the console made on purpose. So when
// the version cannot be resolved the base URL is dropped too, and the deployment simply has no
// knowledge-graph service.
//
// A failure here never fails the apply. The recipe's job is identity and content; letting an
// unreachable knowledge-graph service cost the operator cloud mode entirely would be far out of
// proportion to what is lost.
func (s *server) pinKnowledgeGraph(ctx context.Context, vars map[string]string) string {
	base := vars["MODULE_KG_BASE_URL"]
	if base == "" {
		return ""
	}
	version, err := resolveKgVersion(ctx, base)
	if err != nil {
		s.logger.Warn("resolving the knowledge-graph version", "err", err)
		delete(vars, "MODULE_KG_BASE_URL")
		return ". The knowledge-graph service could not be reached, so this deployment is connected without it — disconnect and reconnect to try again"
	}
	vars["MODULE_KG_VERSION"] = version
	return ""
}

// applyKgMount brings the knowledge-graph mount into agreement with what was just written: mounted
// when the deployment is pinned to a service, absent when it is not. The unmount branch is reachable
// only after a disconnect that failed to remove one, but it costs nothing and it makes "mounted
// exactly when both variables are written" true after every apply rather than almost always.
//
// A mount failure does not fail the apply. By this point the cloud configuration is written and the
// sessions have already been flipped; answering 500 would tell the operator that writing the
// configuration failed when it succeeded. It is reported in the success message instead, and what it
// leaves behind is inert — two variables no mounted module reads.
func (s *server) applyKgMount(vars map[string]string) string {
	if vars["MODULE_KG_VERSION"] == "" {
		if err := unmountKg(s.cfg.ModulesDir); err != nil {
			s.logger.Warn("removing a stale knowledge-graph mount", "err", err)
		}
		return ""
	}
	warn, err := mountKg(s.cfg.ModulesDir, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		s.logger.Error("writing the knowledge-graph mount", "err", err)
		return ". The knowledge-graph connection could not be written, so this deployment is connected without it"
	}
	note := ". A knowledge-graph connection was mounted"
	if warn {
		note += " (warning: its file is world-writable, which the platform refuses to load in cloud mode — check how the host mount preserves file permissions)"
	}
	return note
}

// cloudDisable reverts the deployment to pure-OSS. It rewrites the same mode-layer file with the
// development values — never deletes it — and never contacts the cloud, because this is the recovery
// path from a mis-scoped allowlist, the one state in which no cloud call can succeed.
func (s *server) cloudDisable(w http.ResponseWriter, r *http.Request) {
	// The knowledge-graph mount goes first, while the deployment is still cloud-configured: a failure
	// here leaves a state the operator can simply retry from. And if it fails anyway the revert still
	// proceeds, naming the directory — mount and unmount are cloud-mode operations, so a stale
	// directory that could block the disconnect would be unremovable afterwards, and a recovery path
	// that something can block is not a recovery path.
	kgNote := ""
	if err := unmountKg(s.cfg.ModulesDir); err != nil {
		s.logger.Error("removing the knowledge-graph mount", "err", err)
		kgNote = ". The knowledge-graph connection could not be removed — delete the " + kgModuleKey + " directory from the modules mount by hand"
	}
	if err := writeModeLayer(s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
		s.logger.Error("writing mode layer", "err", err)
		http.Error(w, "reverting to pure-OSS", http.StatusInternalServerError)
		return
	}
	// Posture just changed (cloud → local): same drop-all-but-this-caller as the connect path, and for
	// the same reason — a cloud↔local flip invalidates every other session either way, while the
	// operator being told to recreate the stack keeps a grace window to do it in.
	s.sess.keepOnly(r.Header.Get(sessionHeader), postureGraceTTL)
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "reverted",
		"message": "reverted to pure-OSS; apply it by recreating the stack: " + stackRestartCommand + kgNote,
	})
}

// cloudModeFile returns the console-written cloud mode layer, with ok=false when this deployment is not
// in cloud mode. Outside an apply, every destination the console acts on is read from here — the file
// the console itself wrote, never from the request — which is what keeps the console from being an
// exfiltration primitive. During an apply the recipe being applied is itself the source (see
// pinKnowledgeGraph), which is why its values are checked there, before anything is dialled.
func (s *server) cloudModeFile() (vars map[string]string, ok bool) {
	vars, err := readModeLayer(s.cfg.ModeLayerPath)
	if err != nil {
		return nil, false
	}
	if _, cloud := vars["OIDC_SHARED_POOL"]; !cloud {
		return nil, false
	}
	return vars, true
}

// cloudContentBase returns the content service base URL from the cloud mode file. One read serves both
// the cloud-mode gate and the base.
//
// The value is re-checked with secureURL on the way out. The write path already checks it, so this looks
// redundant — but a check only on write makes https-or-loopback a property of "this console wrote this
// file", and the mode layer is a file on the operator's host, not console-private state. Re-checking on
// read makes it a property of the value actually being dialled, which is the one that matters. An
// unusable value reads as no base at all: refusing to call it is the right answer, and the callers
// already render an absent base as a deployment that cannot reach the catalog.
func (s *server) cloudContentBase() (base string, ok bool) {
	vars, ok := s.cloudModeFile()
	if !ok {
		return "", false
	}
	base = vars["MODULE_CONTENT_BASE_URL"]
	if base != "" {
		if err := secureURL(base); err != nil {
			s.logger.Error("the cloud mode layer holds an unusable content base URL; refusing to call it", "err", err)
			return "", true
		}
	}
	return base, true
}

// packagesResponse is the browse view: the public catalog, each package resolved to its latest
// version's mountable modules.
type packagesResponse struct {
	Packages []catalogPackage `json:"packages"`
}

// packages returns the public content catalog. Cloud-mode only: the catalog host arrives with the cloud
// configuration, so in pure-OSS there is no host to call. The host is read from the mode file the
// console wrote, never the request, and no token is sent — the catalog is public.
func (s *server) packages(w http.ResponseWriter, r *http.Request) {
	base, ok := s.cloudContentBase()
	if !ok || base == "" {
		http.Error(w, "the content catalog is available only in cloud mode — connect this deployment to the cloud first", http.StatusConflict)
		return
	}
	pkgs, truncated, err := resolveCatalog(r.Context(), base)
	if err != nil {
		http.Error(w, "the content catalog is unavailable", http.StatusBadGateway)
		return
	}
	if truncated {
		s.logger.Warn("content catalog exceeded the package cap; the list was truncated")
	}
	// Mark each package with the deployment's subscription, delivered in the recipe as DEPLOYMENT_PACKAGES
	// (a comma-separated key list, like DEPLOYMENT_ALLOWLIST) and read from the console-written mode file.
	// Present — even empty — is authoritative and gates; absent (a recipe predating the variable) leaves
	// Entitled nil so the UI treats it as undetermined and does not gate.
	if vars, err := readModeLayer(s.cfg.ModeLayerPath); err == nil {
		if raw, present := vars["DEPLOYMENT_PACKAGES"]; present {
			subscribed := map[string]struct{}{}
			for _, k := range strings.Split(raw, ",") {
				if k = strings.TrimSpace(k); k != "" {
					subscribed[k] = struct{}{}
				}
			}
			for i := range pkgs {
				_, ok := subscribed[pkgs[i].Key]
				pkgs[i].Entitled = &ok
			}
		}
	}
	writeJSON(w, http.StatusOK, packagesResponse{Packages: pkgs})
}

// mountedModuleView is one mounted stub plus its update state relative to the catalog.
type mountedModuleView struct {
	PackageKey    string `json:"packageKey"`
	ModuleKey     string `json:"moduleKey"`
	Name          string `json:"name,omitempty"`
	Pin           string `json:"pin"`
	MountedAt     string `json:"mountedAt,omitempty"`
	Currency      string `json:"currency"` // current | outdated | unknown
	LatestPin     string `json:"latestPin,omitempty"`
	LatestVersion string `json:"latestVersion,omitempty"`
}

// knowledgeGraphView is the mounted knowledge-graph connection. It is reported SEPARATELY from the
// content mounts, not as a row among them, because it is a different thing: a content mount installs a
// module whose content is served per request, while this installs a client for a service and no graph
// data of any kind. A row in a list of content modules invites exactly the reading that the knowledge
// graph itself was installed here.
//
// Version comes from the mode layer — the value the platform actually reads — rather than from the
// mount's own marker, so what the operator sees is what is in force.
type knowledgeGraphView struct {
	Version   string `json:"version"`
	MountedAt string `json:"mountedAt,omitempty"`
}

// modulesResponse is the mounted-modules inventory. Note carries a non-fatal reason (e.g. the catalog
// was unreachable so currency could not be judged); the inventory itself is local and always renders.
// KnowledgeGraph is present only when this deployment has a knowledge-graph connection mounted.
type modulesResponse struct {
	Modules        []mountedModuleView `json:"modules"`
	KnowledgeGraph *knowledgeGraphView `json:"knowledgeGraph,omitempty"`
	Note           string              `json:"note,omitempty"`
}

// modulesList reports the mounted stubs, their pins, and whether a newer content version is available.
// The inventory is read from the local marker files, so it renders even if the catalog is unreachable;
// currency is then reported as "unknown" with a note rather than failing the request.
func (s *server) modulesList(w http.ResponseWriter, r *http.Request) {
	base, ok := s.cloudContentBase()
	if !ok {
		http.Error(w, "content mounts are available only in cloud mode", http.StatusConflict)
		return
	}
	mounts, err := listMounts(s.cfg.ModulesDir)
	if err != nil {
		s.logger.Error("listing module mounts", "err", err)
		http.Error(w, "reading mounted modules", http.StatusInternalServerError)
		return
	}

	// Resolve the catalog to judge currency. If it is unreachable the inventory still returns, with
	// every mount marked unknown and a note — the mount list must not depend on the cloud being up.
	var catalog []catalogPackage
	note := ""
	if base != "" {
		if pkgs, _, e2 := resolveCatalog(r.Context(), base); e2 == nil {
			catalog = pkgs
		} else {
			note = "the content catalog is unavailable, so update availability could not be checked"
		}
	}

	views := make([]mountedModuleView, 0, len(mounts))
	for _, m := range mounts {
		v := mountedModuleView{PackageKey: m.PackageKey, ModuleKey: m.ModuleKey, Pin: m.Pin, MountedAt: m.MountedAt, Currency: "unknown"}
		if latest, ok := latestModule(catalog, m.PackageKey, m.ModuleKey); ok {
			v.Name = latest.Name
			if latest.ContentHash == m.Pin {
				v.Currency = "current"
			} else {
				v.Currency = "outdated"
				v.LatestPin = latest.ContentHash
				v.LatestVersion = latest.Version
			}
		}
		views = append(views, v)
	}

	kg, kgNote := s.knowledgeGraph()
	if kgNote != "" && note != "" {
		note += "; " + kgNote
	} else if kgNote != "" {
		note = kgNote
	}
	writeJSON(w, http.StatusOK, modulesResponse{Modules: views, KnowledgeGraph: kg, Note: note})
}

// knowledgeGraph reports the mounted knowledge-graph connection, if there is one.
//
// It reports a connection only when the pin AND the mount are both there, because either one alone is
// not a connection: the pin without a module is configuration nothing reads, and a module without a
// pin answers nothing. The half state is reachable — a mount write that failed during an apply, or a
// directory removed by hand — and it is surfaced as a note rather than left to look like a deployment
// that simply has no knowledge graph. Nothing at all is the ordinary case and says nothing.
func (s *server) knowledgeGraph() (*knowledgeGraphView, string) {
	vars, ok := s.cloudModeFile()
	if !ok {
		return nil, ""
	}
	version := vars["MODULE_KG_VERSION"]
	dir, err := kgMountDir(s.cfg.ModulesDir)
	if err != nil {
		return nil, ""
	}
	// readKgMarker is the ownership test as well as the read — a directory carrying someone else's
	// marker is not a connection this console made, and is not reported as one.
	marker, markerErr := readKgMarker(dir)
	switch {
	case version != "" && markerErr == nil:
		return &knowledgeGraphView{Version: version, MountedAt: marker.MountedAt}, ""
	case version != "":
		return nil, "this deployment is configured for a knowledge-graph service but its module is not mounted — disconnect and reconnect to restore it"
	default:
		return nil, ""
	}
}

// mountModule writes the stub and marker for one module at one pin. Re-posting the same key over the
// console's own marker overwrites — the supported way to advance a pin. It refuses to write over a
// directory the console did not create, so a shipped module, an operator's own module, or a code module
// is never clobbered. It takes effect at the next stack recreate.
func (s *server) mountModule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PackageKey string `json:"packageKey"`
		ModuleKey  string `json:"moduleKey"`
		Pin        string `json:"pin"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		http.Error(w, "content mounts are available only in cloud mode — connect this deployment to the cloud first", http.StatusConflict)
		return
	}
	if !packageKeyPattern.MatchString(body.PackageKey) {
		http.Error(w, "invalid package key", http.StatusBadRequest)
		return
	}
	if !moduleKeyPattern.MatchString(body.ModuleKey) {
		http.Error(w, "invalid module key", http.StatusBadRequest)
		return
	}
	if body.ModuleKey == kgModuleKey {
		// The key charset permits it, and the marker check below would refuse it anyway — but with a
		// message saying the console did not create that directory, about a directory the console
		// created. Reserving the name says the true thing instead.
		http.Error(w, "this name is reserved for the knowledge-graph connection, which is mounted with the cloud connection rather than from the catalog", http.StatusConflict)
		return
	}
	if !pinPattern.MatchString(body.Pin) {
		http.Error(w, "invalid content pin", http.StatusBadRequest)
		return
	}
	dir, err := moduleDir(s.cfg.ModulesDir, body.ModuleKey)
	if err != nil {
		http.Error(w, "invalid module key", http.StatusBadRequest)
		return
	}
	// Never write over a directory the console did not create. Re-mounting the console's own stub (a
	// pin advance) is allowed; anything else with this name is refused.
	if info, statErr := os.Stat(dir); statErr == nil && info.IsDir() && !hasOurMarker(dir) {
		http.Error(w, "a module directory with this name already exists and was not created by the console", http.StatusConflict)
		return
	}
	warn, err := writeStub(dir, body.ModuleKey, body.Pin)
	if err != nil {
		s.logger.Error("writing module stub", "err", err)
		http.Error(w, "writing the module mount", http.StatusInternalServerError)
		return
	}
	marker := mountMarker{Schema: mountMarkerSchema, PackageKey: body.PackageKey, ModuleKey: body.ModuleKey, Pin: body.Pin, MountedAt: time.Now().UTC().Format(time.RFC3339)}
	if err := writeMarker(dir, marker); err != nil {
		s.logger.Error("writing mount marker", "err", err)
		http.Error(w, "writing the module mount", http.StatusInternalServerError)
		return
	}
	msg := "module mounted; apply it by recreating the stack: " + platformRestartCommand
	if warn {
		msg += ". Warning: the stub file is world-writable, which the platform refuses to load in cloud mode — check how the host mount preserves file permissions"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "mounted", "message": msg})
}

// unmountModule removes a mounted module directory. It removes only a directory the console created (one
// carrying the mount marker), so a valid key that names a shipped or operator-authored module is refused
// rather than deleted. It takes effect at the next stack recreate.
func (s *server) unmountModule(w http.ResponseWriter, r *http.Request) {
	if !isCloudModeFile(s.cfg.ModeLayerPath) {
		http.Error(w, "content mounts are available only in cloud mode", http.StatusConflict)
		return
	}
	key := r.PathValue("key")
	if !moduleKeyPattern.MatchString(key) {
		http.Error(w, "invalid module key", http.StatusBadRequest)
		return
	}
	if key == kgModuleKey {
		// Reserved, and removed by disconnecting rather than from here — so the refusal names the way
		// to remove it instead of claiming the console did not create it.
		http.Error(w, "this name is reserved for the knowledge-graph connection, which is removed by disconnecting from the cloud", http.StatusConflict)
		return
	}
	dir, err := moduleDir(s.cfg.ModulesDir, key)
	if err != nil {
		http.Error(w, "invalid module key", http.StatusBadRequest)
		return
	}
	info, statErr := os.Stat(dir)
	if statErr != nil || !info.IsDir() {
		http.Error(w, "no module is mounted under this key", http.StatusNotFound)
		return
	}
	if !hasOurMarker(dir) {
		http.Error(w, "this module directory was not created by the console and will not be removed", http.StatusConflict)
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		s.logger.Error("removing module mount", "err", err)
		http.Error(w, "removing the module mount", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "unmounted",
		"message": "module unmounted; apply it by recreating the stack: " + platformRestartCommand,
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
