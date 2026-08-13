package daemoncmd

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// The cloud session's identity is read from the operator's OIDC ID token. These helpers decode the
// token's display claims and pull the bearer off a request — decode only, never verification: the
// platform verifies the token at mint (signature, exp, iss, aud, and the allowlist), so nothing here
// gates access. A forwarded token (e.g. to the platform's authenticated module query) is held only for
// the duration of that request, never logged or written to disk.

// identity is the display-only subject of a cloud session, read from the ID token's claims. It is
// never used for access decisions (the platform verifies the token at mint); it only lets the
// console show who is signed in.
type identity struct {
	sub   string
	email string
	name  string
}

// identityFromJWT best-effort reads display claims (sub, email, name) from a JWT payload WITHOUT
// verifying the signature — display only. Any parse failure yields a zero identity: the same token is
// verified by the platform at mint, so this never gates access.
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
