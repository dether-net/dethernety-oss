// Package moduleinstalltest provides signature-verification stubs for tests that exercise
// the install flow without producing real signed bundles. The crypto itself is proven in
// pkg/moduleverify; what these let a test drive is everything around it.
//
// It is a package rather than a helper in one _test.go file because more than one package's
// tests need the same stubs, and a stub copied per package is a stub that drifts. Nothing
// outside a test imports it, so it is never linked into the console binary.
package moduleinstalltest

import (
	"bytes"
	"errors"
	"io"
)

// FakeVerifier stubs verification with a fixed outcome: zero value accepts everything, and a
// non-nil Err rejects everything.
type FakeVerifier struct{ Err error }

// VerifyBlob drains the artifact — as a real verifier would — and returns the fixed outcome.
func (f FakeVerifier) VerifyBlob(artifact io.Reader, bundleJSON []byte, id, issuer string) error {
	_, _ = io.Copy(io.Discard, artifact)
	return f.Err
}

// RecordingVerifier captures the (identity, issuer) every call is made with — so a test can
// assert the exact anti-rollback subject is passed — and can selectively reject the blob whose
// bundle bytes contain RejectBundle. The compressed archive bytes are opaque, but the bundle
// is served verbatim, which makes it the reliable per-asset discriminator.
type RecordingVerifier struct {
	Calls        []VerifyCall
	RejectBundle string
}

// VerifyCall is one recorded invocation's pinned identity and issuer.
type VerifyCall struct{ ID, Issuer string }

// VerifyBlob records the call and rejects it when RejectBundle is set and present in the bundle.
func (rv *RecordingVerifier) VerifyBlob(artifact io.Reader, bundleJSON []byte, id, issuer string) error {
	_, _ = io.Copy(io.Discard, artifact)
	rv.Calls = append(rv.Calls, VerifyCall{id, issuer})
	if rv.RejectBundle != "" && bytes.Contains(bundleJSON, []byte(rv.RejectBundle)) {
		return errors.New("no matching signature")
	}
	return nil
}
