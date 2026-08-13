package daemoncmd

import (
	"encoding/base64"
	"net/http"
	"testing"
)

// fakeIDToken builds a JWT-shaped string whose payload carries the given sub. It is unsigned — the
// daemon only decodes the payload (the real verification happens at the platform), so a crafted header
// and signature are irrelevant to what the identity decode reads.
func fakeIDToken(sub string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"` + sub + `"}`))
	return header + "." + payload + ".sig"
}

func TestIdentityFromJWT(t *testing.T) {
	full := "h." + base64.RawURLEncoding.EncodeToString(
		[]byte(`{"sub":"s1","email":"a@b.co","name":"Ada"}`)) + ".sig"
	got := identityFromJWT(full)
	if got.sub != "s1" || got.email != "a@b.co" || got.name != "Ada" {
		t.Fatalf("identityFromJWT full = %+v", got)
	}

	// sub-only token (the fakeIDToken shape) yields empty email/name, not an error.
	if got := identityFromJWT(fakeIDToken("s2")); got.sub != "s2" || got.email != "" || got.name != "" {
		t.Fatalf("identityFromJWT sub-only = %+v", got)
	}

	// Malformed tokens are display-only, so they degrade to a zero identity rather than failing.
	for _, bad := range []string{"", "onlyonepart", "two.parts", "a.!!notbase64!!.c"} {
		if got := identityFromJWT(bad); got != (identity{}) {
			t.Fatalf("identityFromJWT(%q) = %+v, want zero", bad, got)
		}
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc": "abc",
		"bearer abc": "abc", // case-insensitive scheme
		"Bearer  x ": "x",   // trimmed
		"Basic abc":  "",
		"":           "",
		"Bearer":     "",
	}
	for header, want := range cases {
		r, _ := http.NewRequest(http.MethodGet, "/", nil)
		if header != "" {
			r.Header.Set("Authorization", header)
		}
		if got := bearerToken(r); got != want {
			t.Fatalf("bearerToken(%q) = %q, want %q", header, got, want)
		}
	}
}
