package daemoncmd

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

// sessionHeader carries the minted session on every gated request. A header — never a cookie:
// a header cannot be attached by a third-party page, which removes the CSRF class outright,
// without SameSite reasoning, double-submit tokens, or Origin checks. How a session is minted
// tracks the deployment posture: locally the header plus single-user host trust is the whole
// boundary (no secret); in cloud the operator's OIDC sign-in is delegated to the platform. In
// neither posture is a loopback bind treated as a boundary against a browser — the header is.
const sessionHeader = "X-Console-Session"

// cloudSessionTTL is the absolute lifetime of a cloud session — the operator's ID token's own
// ~1h lifetime. Past it, gated calls 401 and the SPA re-runs the delegation sign-in, which
// re-checks the platform's allowlist. This is the revocation window (≤ ~1h) with no timer, no
// silent re-mint. Local sessions carry no expiry: single-user host trust, nothing to revoke.
const cloudSessionTTL = time.Hour

// session is one live session's record. A zero expiresAt means the session never expires (local,
// long-lived); a non-zero expiresAt is the fixed absolute deadline of a cloud session. ident is the
// display-only signed-in subject (cloud only; zero for local, which mints with no credential).
type session struct {
	expiresAt time.Time
	ident     identity
}

// sessions holds the set of live session ids. The daemon is a single process, so an in-memory
// set suffices; a restart invalidates every live session, which is the intended behaviour. now
// is the clock, injectable so expiry is testable without sleeping.
type sessions struct {
	mu   sync.RWMutex
	live map[string]session
	now  func() time.Time
}

func newSessions() *sessions {
	return &sessions{live: make(map[string]session), now: time.Now}
}

// mint records a new session id with no identity (local posture). A ttl > 0 stamps a fixed absolute
// expiry (now+ttl); ttl == 0 is a long-lived local session with no expiry.
func (s *sessions) mint(ttl time.Duration) (string, error) {
	return s.mintWithIdentity(ttl, identity{})
}

// mintWithIdentity records a new session carrying the signed-in subject (cloud posture). The identity
// is display-only; it never affects validity or expiry.
func (s *sessions) mintWithIdentity(ttl time.Duration, ident identity) (string, error) {
	id, err := randomID(32) // 256 bits
	if err != nil {
		return "", err
	}
	var exp time.Time
	if ttl > 0 {
		exp = s.now().Add(ttl)
	}
	s.mu.Lock()
	s.live[id] = session{expiresAt: exp, ident: ident}
	s.mu.Unlock()
	return id, nil
}

// identityOf returns the display subject recorded for a session id, or a zero identity if the id
// names no live session (or a local one, which carries none).
func (s *sessions) identityOf(id string) identity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.live[id].ident
}

// valid reports whether id names a live, unexpired session. An expired cloud session is reaped on
// the way out so it cannot be checked again.
func (s *sessions) valid(id string) bool {
	if id == "" {
		return false
	}
	s.mu.RLock()
	sess, ok := s.live[id]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	if !sess.expiresAt.IsZero() && s.now().After(sess.expiresAt) {
		s.mu.Lock()
		delete(s.live, id)
		s.mu.Unlock()
		return false
	}
	return true
}

// flush drops every live session. It is called on a posture change (cloud connect / disconnect),
// so no session minted under one posture survives into the other.
func (s *sessions) flush() {
	s.mu.Lock()
	s.live = make(map[string]session)
	s.mu.Unlock()
}

func randomID(nbytes int) (string, error) {
	b := make([]byte, nbytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// requireSession wraps a handler, rejecting any request without a live session header. Every
// data route is wrapped; only /healthz, the static shell, the posture read, and the mint route
// itself are not.
func (s *sessions) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.valid(r.Header.Get(sessionHeader)) {
			http.Error(w, "session required", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}
