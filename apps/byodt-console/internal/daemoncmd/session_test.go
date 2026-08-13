package daemoncmd

import (
	"testing"
	"time"
)

// A base instant for the injectable clock, so expiry is exercised without sleeping. Any fixed
// value works; the store only ever compares now() against a stamped deadline.
var clockBase = time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)

func TestSessionMintAndValidate(t *testing.T) {
	s := newSessions()

	id, err := s.mint(0) // local: long-lived, no expiry
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Fatal("mint must return a session id")
	}
	if !s.valid(id) {
		t.Fatal("a freshly minted session must be valid")
	}
	if s.valid("") {
		t.Fatal("the empty id must never be valid")
	}
	if s.valid("not-a-real-session") {
		t.Fatal("an unknown id must not be valid")
	}
}

func TestCloudSessionExpires(t *testing.T) {
	s := newSessions()
	now := clockBase
	s.now = func() time.Time { return now }

	id, err := s.mint(cloudSessionTTL) // cloud: fixed absolute expiry
	if err != nil {
		t.Fatal(err)
	}
	if !s.valid(id) {
		t.Fatal("a cloud session must be valid before its expiry")
	}
	// Just before the deadline: still valid.
	now = clockBase.Add(cloudSessionTTL - time.Second)
	if !s.valid(id) {
		t.Fatal("a cloud session must be valid up to its expiry")
	}
	// Past the deadline: invalid, and reaped.
	now = clockBase.Add(cloudSessionTTL + time.Second)
	if s.valid(id) {
		t.Fatal("a cloud session past its fixed expiry must be invalid")
	}
	s.mu.RLock()
	_, present := s.live[id]
	s.mu.RUnlock()
	if present {
		t.Fatal("an expired session must be reaped, not left in the live set")
	}
}

func TestSessionFlush(t *testing.T) {
	s := newSessions()
	a, _ := s.mint(0)
	b, _ := s.mint(cloudSessionTTL)
	if !s.valid(a) || !s.valid(b) {
		t.Fatal("both sessions must be valid before flush")
	}
	s.flush()
	if s.valid(a) || s.valid(b) {
		t.Fatal("flush must drop every session regardless of expiry")
	}
}
