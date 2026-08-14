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

// A posture change drops every session except the caller's, which is kept on a bounded grace
// deadline — the window in which that caller acts on the "recreate the stack" instruction.
func TestSessionKeepOnly(t *testing.T) {
	s := newSessions()
	now := clockBase
	s.now = func() time.Time { return now }

	keep, _ := s.mint(0) // the caller performing the flip: local, no expiry of its own
	other, _ := s.mint(0)
	cloud, _ := s.mint(cloudSessionTTL)
	if !s.valid(keep) || !s.valid(other) || !s.valid(cloud) {
		t.Fatal("all three sessions must be valid before the flip")
	}

	s.keepOnly(keep, postureGraceTTL)
	if s.valid(other) || s.valid(cloud) {
		t.Fatal("a posture change must drop every session but the caller's, regardless of expiry")
	}
	if !s.valid(keep) {
		t.Fatal("the caller performing the flip must keep its session")
	}
	// The survivor is on the grace deadline, not indefinite: a local session carries no expiry, so
	// without the stamp it would outlive the flip forever.
	now = clockBase.Add(postureGraceTTL - time.Second)
	if !s.valid(keep) {
		t.Fatal("the grace session must be valid up to its deadline")
	}
	now = clockBase.Add(postureGraceTTL + time.Second)
	if s.valid(keep) {
		t.Fatal("the grace session must expire at its deadline")
	}
}

// The grace only ever tightens a deadline. A cloud session closer to its own expiry than the grace
// keeps that expiry, so a disconnect cannot be used to lengthen the cloud revocation window.
func TestKeepOnlyNeverExtendsAnEarlierDeadline(t *testing.T) {
	s := newSessions()
	now := clockBase
	s.now = func() time.Time { return now }

	shortTTL := postureGraceTTL / 3
	id, _ := s.mint(shortTTL)
	s.keepOnly(id, postureGraceTTL)

	now = clockBase.Add(shortTTL + time.Second)
	if s.valid(id) {
		t.Fatal("keepOnly must not push an earlier deadline out to the grace deadline")
	}
}

// No live session to keep (an unknown or empty id) drops everything — the plain flush.
func TestKeepOnlyWithNoSurvivorDropsEverything(t *testing.T) {
	s := newSessions()
	a, _ := s.mint(0)
	b, _ := s.mint(cloudSessionTTL)

	s.keepOnly("not-a-real-session", postureGraceTTL)
	if s.valid(a) || s.valid(b) {
		t.Fatal("an unknown survivor must leave no session live")
	}
}
