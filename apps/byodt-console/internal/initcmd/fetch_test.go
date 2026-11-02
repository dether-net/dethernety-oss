package initcmd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestFetchRefusesHTTPDowngradeRedirect proves a release endpoint cannot bounce the
// deploy-time fetch to a plaintext URL (a downgrade, or an http metadata endpoint).
func TestFetchRefusesHTTPDowngradeRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("must not be reached"))
	}))
	defer target.Close()
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound) // target.URL is http://
	}))
	defer redir.Close()

	f := newFetcher(Config{ReleaseBaseURL: redir.URL, PlatformVersion: "1.2.3", HTTPTimeout: 2 * time.Second})
	if _, _, err := f.get(context.Background(), "modules.json", maxIndexBytes); err == nil {
		t.Fatal("a redirect to an http URL must be refused")
	}
}

func TestIsPrivateHost(t *testing.T) {
	for _, h := range []string{"127.0.0.1", "169.254.169.254", "10.0.0.5", "192.168.1.1", "::1", "0.0.0.0"} {
		if !isPrivateHost(h) {
			t.Errorf("%q should be treated as private/loopback/link-local", h)
		}
	}
	for _, h := range []string{"objects.githubusercontent.com", "8.8.8.8", "github.com", ""} {
		if isPrivateHost(h) {
			t.Errorf("%q should not be treated as private", h)
		}
	}
}

// TestFetcherKeepsDefaultTransport pins proxy support. A nil Transport is http.DefaultTransport,
// which follows HTTPS_PROXY and NO_PROXY; a Transport of the fetcher's own would silently stop a
// deployment behind a proxy from reaching the release host.
func TestFetcherKeepsDefaultTransport(t *testing.T) {
	if tr := newFetcher(Config{}).client.Transport; tr != nil {
		t.Fatalf("the release fetcher must keep a nil Transport so it follows the environment's proxy, got %T", tr)
	}
}
