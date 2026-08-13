// Package moduleverify verifies a Sigstore bundle over a module artifact against a
// pinned signer identity, using a maintained Sigstore implementation.
//
// It exists because a bundle carries its own certificate, and a verifier that reads the
// identity out of that certificate and then checks the signature against that same
// certificate's key proves nothing: a self-signed certificate carrying an allowlisted
// identity would pass. The guarantee this package provides is the one that check omits —
// the certificate is chained to the trusted root's Fulcio authority, its Rekor inclusion
// is checked, and only then is the signer identity matched — so a bundle that does not
// chain to a trusted certificate authority is rejected no matter what identity its
// certificate claims.
//
// The trusted root is embedded (the Sigstore public-good root), so verification needs
// no network on the boot path. Rotations of the public-good root are picked up by
// updating the embedded copy and shipping a new binary.
package moduleverify

import (
	_ "embed"
	"fmt"
	"io"

	"github.com/sigstore/sigstore-go/pkg/bundle"
	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/verify"
)

//go:embed trusted_root.json
var publicGoodTrustedRoot []byte

// OIDCIssuerGitHubActions is the OIDC issuer for a GitHub Actions workflow identity —
// the issuer to pin when verifying an asset signed by a repository's release workflow.
const OIDCIssuerGitHubActions = "https://token.actions.githubusercontent.com"

// Verifier checks bundles against a fixed trusted root and verification policy.
type Verifier struct {
	inner *verify.Verifier
}

// New returns a Verifier backed by the embedded Sigstore public-good trusted root.
func New() (*Verifier, error) {
	tr, err := root.NewTrustedRootFromJSON(publicGoodTrustedRoot)
	if err != nil {
		return nil, fmt.Errorf("moduleverify: parsing embedded trusted root: %w", err)
	}
	return newWithMaterial(tr)
}

// newWithMaterial builds a Verifier over arbitrary trusted material. The verification
// config is the standard keyless one — the same `gh attestation verify` uses: a Rekor
// transparency-log inclusion proof and at least one observed timestamp (from the log's
// integrated time or a timestamp authority) must both be present and valid, and the
// certificate must chain to the trusted root's Fulcio authority.
//
// A certificate-transparency SCT check is deliberately not required here. It defends a
// different property — detectability of Fulcio mis-issuance — and adds nothing against
// the threat this verifier exists for: a self-signed or untrusted-CA certificate is
// already refused by the chain check, whatever identity it claims. Requiring the Rekor
// inclusion proof and pinning the identity is what makes the signature meaningful.
//
// Tests supply an in-process CA as the material and exercise this exact config.
func newWithMaterial(tm root.TrustedMaterial) (*Verifier, error) {
	inner, err := verify.NewVerifier(tm,
		verify.WithTransparencyLog(1),
		verify.WithObserverTimestamps(1),
	)
	if err != nil {
		return nil, fmt.Errorf("moduleverify: building verifier: %w", err)
	}
	return &Verifier{inner: inner}, nil
}

// VerifyBlob checks that bundleJSON authenticates the bytes read from artifact, was
// issued to certIdentity by certIssuer, chains to the trusted root, and is recorded in
// the transparency log. It returns nil only when every check passes.
//
// certIdentity is matched EXACTLY against the certificate SAN — it is not a pattern.
// Pinning one release's exact identity is deliberate: a pattern over a family of tags
// would accept one release's asset served at another release's URL.
func (v *Verifier) VerifyBlob(artifact io.Reader, bundleJSON []byte, certIdentity, certIssuer string) error {
	b, err := loadBundle(bundleJSON)
	if err != nil {
		return err
	}
	return v.verifyEntity(b, artifact, certIdentity, certIssuer)
}

// verifyEntity is the shared core: build an exact-match identity policy over the
// artifact and run the configured verification. Kept separate from bundle parsing so a
// test can drive it with a signed entity produced in process.
func (v *Verifier) verifyEntity(entity verify.SignedEntity, artifact io.Reader, certIdentity, certIssuer string) error {
	id, err := verify.NewShortCertificateIdentity(certIssuer, "", certIdentity, "")
	if err != nil {
		return fmt.Errorf("moduleverify: building identity policy: %w", err)
	}
	policy := verify.NewPolicy(verify.WithArtifact(artifact), verify.WithCertificateIdentity(id))
	if _, err := v.inner.Verify(entity, policy); err != nil {
		return fmt.Errorf("moduleverify: verification failed: %w", err)
	}
	return nil
}

// loadBundle parses a Sigstore bundle from its JSON encoding — the form the console
// fetches over the network.
func loadBundle(bundleJSON []byte) (*bundle.Bundle, error) {
	var b bundle.Bundle
	if err := b.UnmarshalJSON(bundleJSON); err != nil {
		return nil, fmt.Errorf("moduleverify: parsing bundle: %w", err)
	}
	return &b, nil
}
