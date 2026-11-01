package redact

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestString(t *testing.T) {
	for _, tc := range []struct {
		name, in, want string
	}{
		{
			name: "user and password",
			in:   `invalid proxy address "http://alice:s3cr%2Ft@proxy.example:3128": bad port`,
			want: `invalid proxy address "http://***@proxy.example:3128": bad port`,
		},
		{
			name: "user only",
			in:   "proxyconnect via https://alice@proxy.example:3128 failed",
			want: "proxyconnect via https://***@proxy.example:3128 failed",
		},
		{
			name: "empty userinfo",
			in:   "http://@proxy.example:3128",
			want: "http://***@proxy.example:3128",
		},
		{
			name: "several URLs in one message",
			in:   `Get "https://content.example/v1/x": proxy http://a:b@p1.example:3128, then http://c:d@p2.example:8080`,
			want: `Get "https://content.example/v1/x": proxy http://***@p1.example:3128, then http://***@p2.example:8080`,
		},
		{
			name: "a raw @ in the password",
			in:   "proxyconnect via http://alice:pa@ss@proxy.example:3128 failed",
			want: "proxyconnect via http://***@proxy.example:3128 failed",
		},
		{
			name: "no userinfo",
			in:   `Get "https://content.example/v1/catalog/packages": dial tcp: lookup content.example: no such host`,
			want: `Get "https://content.example/v1/catalog/packages": dial tcp: lookup content.example: no such host`,
		},
		{
			name: "an @ in the path is not userinfo",
			in:   "https://content.example/v1/owner@example.org?x=1",
			want: "https://content.example/v1/owner@example.org?x=1",
		},
		{
			name: "an @ in a query with no path is not userinfo",
			in:   "https://content.example?by=a@b",
			want: "https://content.example?by=a@b",
		},
		{
			name: "an @ in a fragment with no path is not userinfo",
			in:   "https://content.example#a@b",
			want: "https://content.example#a@b",
		},
		{
			name: "an @ after whitespace is not userinfo",
			in:   "https://content.example refused mail to ops@example.org",
			want: "https://content.example refused mail to ops@example.org",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := String(tc.in); got != tc.want {
				t.Errorf("String(%q)\n got %q\nwant %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestError(t *testing.T) {
	if Error(nil) != nil {
		t.Fatal("a nil error must stay nil")
	}

	plain := errors.New("dial tcp: connection refused")
	if Error(plain) != plain {
		t.Error("an error with nothing to mask must be returned as is")
	}

	inner := fmt.Errorf("invalid proxy address %q: %w", "http://alice:secret@proxy.example:3128", context.DeadlineExceeded)
	got := Error(inner)
	if want := `invalid proxy address "http://***@proxy.example:3128": context deadline exceeded`; got.Error() != want {
		t.Errorf("Error() = %q, want %q", got.Error(), want)
	}
	if !errors.Is(got, context.DeadlineExceeded) {
		t.Error("the redacted error must still unwrap to its cause")
	}
}
