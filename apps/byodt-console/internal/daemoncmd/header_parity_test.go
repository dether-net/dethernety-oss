package daemoncmd

import (
	"os"
	"regexp"
	"strings"
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

// The TEAM header's name is declared FOUR times across this program and, until this test, by nothing that
// could see more than one of them: `deploymentTeamHeader` here, `DEPLOYMENT_TEAM_HEADER` in the module
// client, `TEAM_HEADER` in the end-to-end stub, and a fourth in the content service, which lives in another
// repository and is bound separately. Three of the four are reachable from here, so three of the four are
// bound here.
//
// WHAT A DISAGREEMENT WOULD DO is the reason this is worth a test rather than a convention. Two senders
// that disagree on the name is one deployment whose console calls are scoped and whose module calls are
// not — half a deployment's content correct and half of it the cross-team union, with no error anywhere.
// That is strictly harder to notice than an outright failure, which is the argument the header above makes
// for the token header and applies with more force here.
//
// CASE-INSENSITIVELY, deliberately. HTTP header names are case-insensitive and the stub lower-cases on
// purpose, so an exact-match assertion would be pinning a house style rather than the wire contract — and
// it would fail on a change that breaks nothing. What must match is the name.
//
// No `-count=1` is needed for this one. Both files sit inside this Go module's directory tree, so the test
// cache tracks the reads and invalidates on them — the same situation as the SPA constant above, and not
// the commerce app's identity-contract guard, which reaches out of its module where the cache does not
// follow.
var (
	moduleTeamHeader = regexp.MustCompile(`(?m)^export const DEPLOYMENT_TEAM_HEADER = '([^']+)'`)
	stubTeamHeader   = regexp.MustCompile(`(?m)^const TEAM_HEADER = '([^']+)'`)
)

func TestTheTeamHeaderNameMatchesEverySender(t *testing.T) {
	for _, sender := range []struct {
		what string
		path string
		re   *regexp.Regexp
	}{
		{"the module client", "../../../../packages/dt-module/src/remote/team-id.ts", moduleTeamHeader},
		{"the end-to-end stub", "../../../../scripts/e2e/content-stub.mjs", stubTeamHeader},
	} {
		source, err := os.ReadFile(sender.path)
		if err != nil {
			t.Fatalf("read %s: %v — this guard asserts the daemon's outbound team header name against "+
				"%s and cannot run without it", sender.path, err, sender.what)
		}
		m := sender.re.FindSubmatch(source)
		if m == nil {
			t.Fatalf("no team header declaration found in %s — either %s stopped declaring the name that "+
				"way, or this parse has stopped seeing a declaration it used to see. Both are a decision "+
				"about the wire contract rather than something to settle by relaxing this test",
				sender.path, sender.what)
		}
		if got := string(m[1]); !strings.EqualFold(got, deploymentTeamHeader) {
			t.Fatalf("%s sends the team on %q and this daemon sends it on %q — a deployment would have "+
				"half its entitled calls scoped and half of them answered from the cross-team union, with "+
				"nothing failing to say so", sender.what, got, deploymentTeamHeader)
		}
	}
}
