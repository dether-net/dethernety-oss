package daemoncmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// platformClient probes the running platform. It is deliberately tolerant of the platform
// being down — a connection error is how the daemon knows it is in the platform-unreachable
// phase, not an exceptional condition.
type platformClient struct {
	baseURL string
	http    *http.Client
}

func newPlatformClient(baseURL string, timeout time.Duration) *platformClient {
	return &platformClient{baseURL: baseURL, http: &http.Client{Timeout: timeout}}
}

// configResponse is the subset of GET /config the daemon reads to derive its phase. The phase
// is read from the platform, never from the console's own files: reading its own written file,
// the console would claim a mode the platform has not restarted into.
type configResponse struct {
	AuthDisabled bool   `json:"authDisabled"`
	OIDCIssuer   string `json:"oidcIssuer"`
	OIDCClientID string `json:"oidcClientId"`
	OIDCDomain   string `json:"oidcDomain"`
	OIDCScope    string `json:"oidcScope"`
}

func (p *platformClient) config(ctx context.Context) (configResponse, error) {
	var cr configResponse
	err := p.getJSON(ctx, "/config", &cr)
	return cr, err
}

// registeredModule is one entry of the platform's live module registry.
type registeredModule struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// registeredModules queries the platform's GraphQL module registry for the set it actually
// loaded — the counterpart to the state file's *placed* set. It works without a bearer token
// while the platform runs no-auth, which is the pure-OSS bundle default; in cloud mode the
// caller passes the operator's ID token as bearer so the authenticated query is accepted.
//
// Its (mods, err) result is also the binary delegation probe the cloud mint keys on: err == nil
// iff the platform returned HTTP 200 with clean data and no errors[] — the only "accept". Every
// other outcome (non-200, errors[], a transport or decode failure) is an err, which the mint must
// treat as "could not verify — retry," never a definitive token reject: production formatError
// masks an auth rejection and a resolver/DB blip to a byte-identical generic error, so the two
// are indistinguishable on the wire and only clean-data-vs-error can be trusted.
func (p *platformClient) registeredModules(ctx context.Context, bearer string) ([]registeredModule, error) {
	reqBody := []byte(`{"query":"{ modules { name version } }"}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/graphql", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("graphql modules query: status %d", resp.StatusCode)
	}
	// Data/Modules are pointers so the accept predicate keys on the PRESENCE of a module array, not
	// merely the absence of errors[]: a structurally-empty 200 body ({} or {"data":null}) must NOT be
	// treated as clean data and mint a session. The real platform never emits that for a rejected caller
	// (@authentication throws → errors[]), but keeping the trust boundary on a valid data shape guards
	// against an intermediary (proxy/WAF) answering a bland 200. An authenticated empty registry is a
	// present-but-empty array (non-nil), so it is still an accept.
	var out struct {
		Data *struct {
			Modules *[]registeredModule `json:"modules"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Errors) > 0 {
		return nil, fmt.Errorf("graphql modules query: %s", out.Errors[0].Message)
	}
	if out.Data == nil || out.Data.Modules == nil {
		return nil, fmt.Errorf("graphql modules query: response carried no module data")
	}
	return *out.Data.Modules, nil
}

func (p *platformClient) getJSON(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", path, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(dst)
}
