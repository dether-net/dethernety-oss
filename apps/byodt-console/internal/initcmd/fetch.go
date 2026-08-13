package initcmd

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

// Download size caps. The module payloads are small (the largest shipped module is well
// under a megabyte); the caps refuse an implausibly large response rather than stream it
// to disk.
const (
	maxIndexBytes   = 4 << 20  // 4 MiB
	maxBundleBytes  = 1 << 20  // 1 MiB
	maxTarballBytes = 64 << 20 // 64 MiB
)

// fetcher issues the plain-HTTPS GETs for a release's assets. No GitHub API is used: the
// index and every asset are fetched from constructible release-download URLs.
type fetcher struct {
	client  *http.Client
	baseURL string
	tag     string
}

func newFetcher(cfg Config) *fetcher {
	return &fetcher{
		client:  &http.Client{Timeout: cfg.HTTPTimeout, CheckRedirect: checkRedirect},
		baseURL: strings.TrimRight(cfg.ReleaseBaseURL, "/"),
		tag:     "v" + cfg.PlatformVersion,
	}
}

// checkRedirect narrows where a release download may be redirected. GitHub legitimately
// redirects a release-asset URL to a CDN host, so a cross-host redirect is allowed — but
// only over https (no downgrade, and no plaintext metadata endpoint), never to a
// loopback/private/link-local address, and only for a few hops. Trust still rests on the
// signature and the asset digest; this just narrows the request surface of a deploy-time
// fetch so a hijacked redirect cannot point it at an internal service.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return fmt.Errorf("too many redirects (%d)", len(via))
	}
	if req.URL.Scheme != "https" {
		return fmt.Errorf("refusing redirect to non-https URL %q", req.URL.Redacted())
	}
	if host := req.URL.Hostname(); isPrivateHost(host) {
		return fmt.Errorf("refusing redirect to private address %q", host)
	}
	return nil
}

// isPrivateHost reports whether host is an IP literal in a loopback, private, link-local,
// or unspecified range. A DNS name returns false — the https requirement plus the signature
// and digest checks are the guard there; resolving names to filter IPs is beyond what this
// deploy-time fetch needs.
func isPrivateHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func (f *fetcher) assetURL(name string) string {
	return fmt.Sprintf("%s/releases/download/%s/%s", f.baseURL, f.tag, name)
}

// get fetches an asset by name. A transport error (host unreachable, timeout) is returned
// as a non-nil error with status 0. A non-200 response returns the status code with a nil
// error, so the caller can distinguish 404 (no such asset at this version) from a network
// failure. A 200 returns the body, capped at maxBytes.
func (f *fetcher) get(ctx context.Context, name string, maxBytes int64) (body []byte, status int, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.assetURL(name), nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, resp.StatusCode, nil
	}

	// Read one byte past the cap so a body exactly at the cap is allowed and one over is
	// refused.
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("reading %s: %w", name, err)
	}
	if int64(len(b)) > maxBytes {
		return nil, resp.StatusCode, fmt.Errorf("%s exceeds max size %d bytes", name, maxBytes)
	}
	return b, resp.StatusCode, nil
}
