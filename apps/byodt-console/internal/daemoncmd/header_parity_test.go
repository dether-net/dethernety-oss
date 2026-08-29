package daemoncmd

import (
	"os"
	"regexp"
	"testing"
)

// The cloud-token header name is declared TWICE across a language boundary — `cloudTokenHeader` here and
// `CLOUD_TOKEN_HEADER` in the SPA — and nothing bound them. Neither suite can see the other side: every Go
// test sets the header through the same constant the production code reads, and every SPA test asserts the
// literal in its own module, so renaming one leaves both green while every route that forwards the
// operator's access token silently stops carrying it.
//
// That is not hypothetical shape-matching. The artifact install shipped broken once on this exact seam, for
// the adjacent reason — the SPA's component tests mocked the call wholesale, so nothing anywhere reached
// the header — and the fix then was a wire assertion inside one module. This is the cross-module half of
// the same guard, and it matters more now that two routes depend on the name rather than one.
//
// A SOURCE SCAN rather than a shared constant, deliberately: there is no build step joining a Go binary to
// a Vue bundle, so the only thing that can hold them together is something that reads both.
//
// This one re-runs on a local edit, unlike the identity-contract guard in the commerce app, and the reason
// is worth knowing rather than looking arbitrary: the SPA source sits INSIDE this Go module, so the test
// cache tracks the read and invalidates on it. That one reaches four levels out of its module, where the
// cache does not follow. Measured, not assumed.
var spaCloudTokenHeader = regexp.MustCompile(`(?m)^const CLOUD_TOKEN_HEADER = '([^']+)'`)

func TestTheCloudTokenHeaderNameMatchesTheSPA(t *testing.T) {
	const apiTS = "../../ui/src/api.ts"
	source, err := os.ReadFile(apiTS)
	if err != nil {
		t.Fatalf("read %s: %v — this guard asserts the daemon's inbound header name against the SPA's "+
			"outbound one and cannot run without it", apiTS, err)
	}
	m := spaCloudTokenHeader.FindSubmatch(source)
	if m == nil {
		t.Fatalf("no `const CLOUD_TOKEN_HEADER = '...'` found in %s — either the SPA stopped declaring the "+
			"header name that way, or this parse has stopped seeing a declaration it used to see. Both are "+
			"a decision about the wire contract rather than something to settle by relaxing this test", apiTS)
	}
	if got := string(m[1]); got != cloudTokenHeader {
		t.Fatalf("the SPA sends %q and the daemon reads %q — every route that forwards the operator's "+
			"access token would be sending it to a header nothing reads", got, cloudTokenHeader)
	}
}
