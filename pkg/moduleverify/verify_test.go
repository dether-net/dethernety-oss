package moduleverify

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/testing/ca"
	"github.com/sigstore/sigstore-go/pkg/verify"
)

// A representative release-workflow identity. The virtual CA below issues a genuine,
// chain-valid bundle bearing exactly this SAN, so the tests exercise the real
// verification path — chain, transparency log, observed timestamp, and the exact identity
// match — with no network and nothing forged. (SCT is deliberately not required; see the
// newWithMaterial rationale in verify.go.)
const (
	testIdentity = "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v1.2.3"
	testIssuer   = OIDCIssuerGitHubActions
)

func TestVerifyAcceptsGenuineBundleAndPinsIdentity(t *testing.T) {
	vs, err := ca.NewVirtualSigstore()
	if err != nil {
		t.Fatal(err)
	}
	artifact := []byte("pretend dethernety-general-1.2.3.tar.gz bytes")
	entity, err := vs.Sign(testIdentity, testIssuer, artifact)
	if err != nil {
		t.Fatal(err)
	}
	v, err := newWithMaterial(vs)
	if err != nil {
		t.Fatal(err)
	}

	// The one that must pass: correct identity, correct artifact. That it verifies here
	// establishes that every other check (chain, tlog, timestamp, artifact digest) is
	// satisfied — so each failure below fails for exactly one reason.
	if err := v.verifyEntity(entity, bytes.NewReader(artifact), testIdentity, testIssuer); err != nil {
		t.Fatalf("genuine bundle with the correct identity should verify: %v", err)
	}

	t.Run("wrong identity is rejected", func(t *testing.T) {
		wrong := "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v9.9.9"
		if err := v.verifyEntity(entity, bytes.NewReader(artifact), wrong, testIssuer); err == nil {
			t.Fatal("a genuine bundle verified against the wrong identity must fail")
		}
	})

	t.Run("wrong issuer is rejected", func(t *testing.T) {
		if err := v.verifyEntity(entity, bytes.NewReader(artifact), testIdentity, "https://accounts.google.com"); err == nil {
			t.Fatal("a genuine bundle verified against the wrong issuer must fail")
		}
	})

	t.Run("tampered artifact is rejected", func(t *testing.T) {
		if err := v.verifyEntity(entity, bytes.NewReader([]byte("tampered bytes")), testIdentity, testIssuer); err == nil {
			t.Fatal("a mismatched artifact must fail")
		}
	})
}

// TestChainEnforced is the defense against the hand-rolled-verifier defect: a bundle
// that is internally valid and carries a matching SAN, but whose certificate does not
// chain to the trusted root's Fulcio authority, must be rejected. Here the embedded
// public-good root does not trust the in-process CA, so verification fails despite the
// identity matching exactly.
func TestChainEnforced(t *testing.T) {
	vs, err := ca.NewVirtualSigstore()
	if err != nil {
		t.Fatal(err)
	}
	artifact := []byte("x")
	entity, err := vs.Sign(testIdentity, testIssuer, artifact)
	if err != nil {
		t.Fatal(err)
	}
	v, err := New() // embedded Sigstore public-good root
	if err != nil {
		t.Fatal(err)
	}
	if err := v.verifyEntity(entity, bytes.NewReader(artifact), testIdentity, testIssuer); err == nil {
		t.Fatal("a bundle from an untrusted CA must be rejected even with a matching identity")
	}
}

func TestNewLoadsEmbeddedRoot(t *testing.T) {
	if _, err := New(); err != nil {
		t.Fatalf("embedded trusted root must load: %v", err)
	}
}

// TestEmbeddedRootHasExpectedAuthorities strengthens the pin on the embedded root: it must
// not merely parse, but carry the material the verification policy relies on — at least one
// Fulcio certificate authority (the chain anchor) and at least one Rekor transparency log
// (the inclusion-proof source). A blanked or structurally-wrong root that still parses is
// caught here. The functional counterpart — the embedded root actually validating a genuine
// public-good bundle — is TestEmbeddedRootVerifiesGenuineBundle below.
func TestEmbeddedRootHasExpectedAuthorities(t *testing.T) {
	tr, err := root.NewTrustedRootFromJSON(publicGoodTrustedRoot)
	if err != nil {
		t.Fatalf("embedded trusted root must parse: %v", err)
	}
	if len(tr.FulcioCertificateAuthorities()) == 0 {
		t.Fatal("embedded trusted root has no Fulcio certificate authorities")
	}
	if len(tr.RekorLogs()) == 0 {
		t.Fatal("embedded trusted root has no Rekor transparency logs")
	}
}

// TestEmbeddedRootVerifiesGenuineBundle is the positive proof the suite otherwise lacks: the
// embedded public-good trusted root — via New(), not a virtual CA — validates a real,
// public-good Sigstore bundle end to end (chain, transparency-log inclusion, observed
// timestamp, and the exact signer identity) with no network. The fixture is a genuine
// sigstore-js release provenance bundle; it carries a Rekor v1 signed-entry timestamp, so no
// Rekor call is needed, and it is verified by its own subject digest, so no artifact bytes are
// needed. A wrong or blanked embedded root would fail this test.
//
// Coupling: this ties the fixture (a 2023-era signature) to the embedded root. If
// trusted_root.json is ever refreshed and drops the historical Fulcio CA / Rekor log this
// bundle used, refresh the fixture to a bundle the new root can verify — a refresh should have
// to prove it still validates a real signature.
func TestEmbeddedRootVerifiesGenuineBundle(t *testing.T) {
	// Pinned from the committed bundle itself (subject digest and cert SAN), so a fixture swap
	// that changed either would surface here rather than silently pass.
	const wantSAN = "https://github.com/sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main"
	const subjectSHA512 = "76176ffa33808b54602c7c35de5c6e9a4deb96066dba6533f50ac234f4f1f4c6b3527515dc17c06fbe2860030f410eee69ea20079bd3a2c6f3dcf3b329b10751"

	data, err := os.ReadFile(filepath.Join("testdata", "genuine-public-good-bundle.sigstore.json"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := loadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	v, err := New() // embedded Sigstore public-good root
	if err != nil {
		t.Fatal(err)
	}
	digest, err := hex.DecodeString(subjectSHA512)
	if err != nil {
		t.Fatal(err)
	}

	verifyWith := func(san string) error {
		id, err := verify.NewShortCertificateIdentity(OIDCIssuerGitHubActions, "", san, "")
		if err != nil {
			return err
		}
		_, err = v.inner.Verify(b, verify.NewPolicy(
			verify.WithArtifactDigest("sha512", digest),
			verify.WithCertificateIdentity(id),
		))
		return err
	}

	if err := verifyWith(wantSAN); err != nil {
		t.Fatalf("embedded public-good root must verify a genuine bundle offline: %v", err)
	}
	// The embedded root must still pin identity, not blindly accept any chain-valid bundle.
	if err := verifyWith(wantSAN + "-tampered"); err == nil {
		t.Fatal("a wrong signer identity must be rejected even against the embedded root")
	}
}

// TestEmptyIdentityOrIssuerRejected pins the property that an empty certIdentity or
// certIssuer is refused — otherwise a caller that passed "" would weaken the SAN/issuer
// pin to match-anything. The guarantee lives in the sigstore library; this asserts we
// depend on it.
func TestEmptyIdentityOrIssuerRejected(t *testing.T) {
	vs, err := ca.NewVirtualSigstore()
	if err != nil {
		t.Fatal(err)
	}
	artifact := []byte("x")
	entity, err := vs.Sign(testIdentity, testIssuer, artifact)
	if err != nil {
		t.Fatal(err)
	}
	v, err := newWithMaterial(vs)
	if err != nil {
		t.Fatal(err)
	}
	if err := v.verifyEntity(entity, bytes.NewReader(artifact), "", testIssuer); err == nil {
		t.Fatal("an empty certIdentity must be rejected")
	}
	if err := v.verifyEntity(entity, bytes.NewReader(artifact), testIdentity, ""); err == nil {
		t.Fatal("an empty certIssuer must be rejected")
	}
}

func TestLoadBundle(t *testing.T) {
	if _, err := loadBundle([]byte("not a bundle")); err == nil {
		t.Fatal("malformed bundle JSON must be rejected")
	}
	data, err := os.ReadFile(filepath.Join("testdata", "genuine-public-good-bundle.sigstore.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := loadBundle(data); err != nil {
		t.Fatalf("a genuine public-good bundle must parse: %v", err)
	}
}

func TestVerifyBlobRejectsMalformedBundle(t *testing.T) {
	v, err := New()
	if err != nil {
		t.Fatal(err)
	}
	if err := v.VerifyBlob(bytes.NewReader([]byte("x")), []byte("{ not valid"), testIdentity, testIssuer); err == nil {
		t.Fatal("VerifyBlob must reject a malformed bundle")
	}
}
