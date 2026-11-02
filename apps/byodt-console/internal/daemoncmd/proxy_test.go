package daemoncmd

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestOutboundClientsKeepDefaultTransport pins proxy support. A nil Transport is
// http.DefaultTransport, which follows HTTPS_PROXY and NO_PROXY; a Transport of a client's own
// would silently stop a deployment behind a proxy from reaching the content service.
func TestOutboundClientsKeepDefaultTransport(t *testing.T) {
	for name, c := range map[string]*http.Client{
		"public":   newPublicClient(),
		"entitled": newEntitledClient(),
		"platform": newPlatformClient("http://platform:3003", time.Second).http,
	} {
		if c.Transport != nil {
			t.Errorf("%s client: Transport must stay nil so it follows the environment's proxy, got %T", name, c.Transport)
		}
	}
}

// proxyLoginTransport fails every request the way Go's proxy lookup does on a malformed
// HTTPS_PROXY: quoting the proxy URL, login included.
type proxyLoginTransport struct{}

func (proxyLoginTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, fmt.Errorf("invalid proxy address %q: invalid port", "http://alice:s3cret@proxy.example:3128")
}

func TestPlatformTransportErrorIsRedacted(t *testing.T) {
	p := newPlatformClient("http://platform:3003", time.Second)
	p.http.Transport = proxyLoginTransport{}

	_, cfgErr := p.config(context.Background())
	_, modErr := p.registeredModules(context.Background(), "")
	for name, err := range map[string]error{"config": cfgErr, "registeredModules": modErr} {
		if err == nil {
			t.Fatalf("%s: want the transport error, got nil", name)
		}
		if msg := err.Error(); strings.Contains(msg, "s3cret") || !strings.Contains(msg, "://***@proxy.example") {
			t.Errorf("%s: the proxy login must be masked, got %q", name, msg)
		}
	}
}
