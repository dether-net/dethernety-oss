package daemoncmd

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// The cloud session's identity is read from the operator's OIDC ID token. These helpers decode the
// token's display claims and pull the bearer off a request — decode only, never verification: the
// platform verifies the token at mint (signature, exp, iss, aud, and the allowlist). A forwarded token
// (e.g. to the platform's authenticated module query) is held only for the duration of that request,
// never logged or written to disk.
//
// THIS SAID "SO NOTHING HERE GATES ACCESS", AND ONE THING NOW DOES. The allowlist-only apply compares
// the subject below against the list an operator is submitting, and refuses one that would lock them
// out (allowlist.go). That is not a hole in the rule above; it is the one decision this value is
// entitled to make, and only because of what the mint proves about it — see identity.

// identity is the subject of a cloud session, read from the ID token's claims. It is a DISPLAY value
// almost everywhere: it lets the console show who is signed in, and it is not an authorization answer —
// whether the operator may do a thing is asked of the cloud, live, per request (admin.go).
//
// THE ONE DECISION IT MAKES, and why this decode is sound for it. A cloud session exists only because
// the platform accepted the ID token these claims came from, and the platform validates the DEPLOYMENT
// ALLOWLIST along with the signature, the expiry, the issuer and the audience. So a live cloud session
// is proof that its subject was admitted by this deployment's current access list — and that is exactly
// what the allowlist-only apply needs to know about the NEXT one. The console reads the claim from the
// same string the platform verified; it is not trusting an unverified token, it is reading the one that
// was verified.
//
// WHAT IT MUST NOT BE USED FOR is a question about the credential on the current REQUEST. That is a
// different token, checked by a different service, and nothing binds the two — admin.go's audit record
// names its field session_sub rather than sub for precisely this reason.
type identity struct {
	sub   string
	email string
	name  string
}

// identityFromJWT best-effort reads claims (sub, email, name) from a JWT payload WITHOUT verifying the
// signature. It does not need to: the same token is verified by the platform at mint, and this reads the
// string that was verified.
//
// ANY PARSE FAILURE YIELDS A ZERO IDENTITY, and every caller must treat an empty sub as "unknown" rather
// than as a subject. The display path renders nothing; the allowlist apply refuses rather than guessing,
// because a guard that silently passes when it cannot identify the caller is worse than no guard.
func identityFromJWT(token string) identity {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return identity{}
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return identity{}
	}
	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	_ = json.Unmarshal(payload, &claims)
	return identity{sub: claims.Sub, email: claims.Email, name: claims.Name}
}

// bearerToken extracts a bearer token from the Authorization header, or "" if absent.
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}
