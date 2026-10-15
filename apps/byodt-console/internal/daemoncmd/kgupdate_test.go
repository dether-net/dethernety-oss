package daemoncmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

const kgVersionC = "sha256:" + "3333333333333333333333333333333333333333333333333333333333333333"

// kgService serves the public version listing from a body the test can change between requests, and counts
// what reaches it. onRequest, when set, runs inside the request — which is how a test lands a change to the
// mode file BETWEEN the route's listing read and its lock, deterministically rather than by timing.
type kgService struct {
	srv       *httptest.Server
	body      atomic.Value
	hits      atomic.Int32
	authSeen  atomic.Value
	teamSeen  atomic.Value
	onRequest atomic.Value
}

func newKgService(t *testing.T, body string) *kgService {
	t.Helper()
	k := &kgService{}
	k.body.Store(body)
	k.authSeen.Store("")
	k.teamSeen.Store("")
	k.onRequest.Store(func() {})
	k.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/kg/versions" {
			http.NotFound(w, r)
			return
		}
		k.hits.Add(1)
		if a := r.Header.Get("Authorization"); a != "" {
			k.authSeen.Store(a)
		}
		if tm := r.Header.Get(deploymentTeamHeader); tm != "" {
			k.teamSeen.Store(tm)
		}
		k.onRequest.Load().(func())()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(k.body.Load().(string)))
	}))
	t.Cleanup(k.srv.Close)
	return k
}

// listingOf renders a listing naming latest, with ids as its entries newest first, each with a release date,
// and recall notes on the ids named in recalled.
func listingOf(latest string, ids []string, recalled ...string) string {
	type entry struct {
		ID         string          `json:"id"`
		ReleasedAt string          `json:"releasedAt"`
		Recalled   json.RawMessage `json:"recalled,omitempty"`
	}
	dates := []string{"2026-10-12T09:00:00Z", "2026-10-03T09:00:00Z", "2026-09-14T09:00:00Z"}
	out := struct {
		Latest   string  `json:"latest"`
		Versions []entry `json:"versions"`
	}{Latest: latest}
	for i, id := range ids {
		e := entry{ID: id, ReleasedAt: dates[i%len(dates)]}
		for _, r := range recalled {
			if r == id {
				e.Recalled = json.RawMessage(`{"reason":"test","recalledAt":"2026-10-13T00:00:00Z"}`)
			}
		}
		out.Versions = append(out.Versions, e)
	}
	b, err := json.Marshal(out)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// kgFixture is a cloud deployment the gate admits, connected to a knowledge-graph service, pinned at pinned
// and mounted the way connect leaves it.
type kgFixture struct {
	gateFixture
	kg *kgService
}

func newKgFixture(t *testing.T, opt gateOptions, pinned, listing string) kgFixture {
	t.Helper()
	f := newGateFixture(t, opt)
	k := newKgService(t, listing)
	if !opt.localPosture {
		vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
		if err != nil {
			t.Fatal(err)
		}
		vars["MODULE_KG_BASE_URL"] = k.srv.URL
		vars["MODULE_KG_VERSION"] = pinned
		if err := writeModeLayer(f.s.cfg.ModeLayerPath, vars); err != nil {
			t.Fatal(err)
		}
		if _, err := mountKg(f.s.cfg.ModulesDir, "2026-09-14T10:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	return kgFixture{gateFixture: f, kg: k}
}

func (f kgFixture) update(t *testing.T, version string) (int, string) {
	t.Helper()
	return f.call(t, gatedRoute{name: "update the knowledge graph", method: http.MethodPost,
		path: "/api/cloud/knowledge-graph", body: `{"version":` + jsonQuote(version) + `}`}, goodToken)
}

func (f kgFixture) modeFile(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func (f kgFixture) setMode(t *testing.T, edit func(map[string]string)) {
	t.Helper()
	if err := f.editMode(edit); err != nil {
		t.Fatal(err)
	}
}

// editMode is setMode for the fake service's handler goroutine, where t.Fatal must not be called: the
// caller reports the error with t.Error.
func (f kgFixture) editMode(edit func(map[string]string)) error {
	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		return err
	}
	edit(vars)
	return writeModeLayer(f.s.cfg.ModeLayerPath, vars)
}

func readFileT(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func (f kgFixture) inventory(t *testing.T) modulesResponse {
	t.Helper()
	code, body := get(t, f.base, "/api/modules", f.session)
	if code != http.StatusOK {
		t.Fatalf("the inventory must be 200, got %d %s", code, body)
	}
	var inv modulesResponse
	if err := json.Unmarshal(body, &inv); err != nil {
		t.Fatal(err)
	}
	return inv
}

// ── Currency ────────────────────────────────────────────────────────────────────────────────────

func TestKgCurrencyOfAsksTheRecallBeforeEquality(t *testing.T) {
	list := func(s string) kgVersionList {
		var l kgVersionList
		if err := json.Unmarshal([]byte(s), &l); err != nil {
			t.Fatal(err)
		}
		return l
	}
	for _, tc := range []struct {
		name, listing, pinned string
		currency, offer       string
		wantNote              bool
	}{
		{"pinned at latest", listingOf(kgVersionA, []string{kgVersionA}), kgVersionA, kgCurrent, "", false},
		{"a newer latest", listingOf(kgVersionB, []string{kgVersionB, kgVersionA}), kgVersionA, kgOutdated, kgVersionB, false},
		// The emergency case, and the reason for the order: a withdrawn pin that is also latest must never
		// read as up to date.
		{"a withdrawn pin that is latest", listingOf(kgVersionA, []string{kgVersionA}, kgVersionA), kgVersionA, kgRecalled, "", false},
		{"a withdrawn pin with a usable latest", listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionA), kgVersionA, kgRecalled, kgVersionB, false},
		{"a withdrawn pin whose latest is withdrawn too", listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionA, kgVersionB), kgVersionA, kgRecalled, "", false},
		{"a withdrawn latest, pin not withdrawn", listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionB), kgVersionA, kgUnknown, "", true},
		{"a malformed latest", `{"latest":"latest","versions":[]}`, kgVersionA, kgUnknown, "", true},
		{"no latest", `{"latest":"","versions":[]}`, kgVersionA, kgUnknown, "", true},
		// Unreachable from the producer, which never prunes; a hand-edited pin. The remedy is the latest.
		{"a pin the listing does not name", listingOf(kgVersionB, []string{kgVersionB}), kgVersionC, kgOutdated, kgVersionB, false},
		// A JSON null is no recall note.
		{"a null recall note", `{"latest":"` + kgVersionB + `","versions":[{"id":"` + kgVersionB + `"},{"id":"` + kgVersionA + `","recalled":null}]}`, kgVersionA, kgOutdated, kgVersionB, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			currency, offer, note := kgCurrencyOf(list(tc.listing), tc.pinned)
			if currency != tc.currency || offer != tc.offer {
				t.Fatalf("got (%s, %q), want (%s, %q)", currency, offer, tc.currency, tc.offer)
			}
			if (note != "") != tc.wantNote {
				t.Fatalf("note presence: got %q, want a note: %v", note, tc.wantNote)
			}
		})
	}
}

func TestReleasedAtIsPassedOnOnlyWhenItIsADate(t *testing.T) {
	var l kgVersionList
	body := `{"latest":"` + kgVersionA + `","versions":[{"id":"` + kgVersionA + `","releasedAt":"yesterday"},{"id":"` + kgVersionB + `","releasedAt":"2026-10-12T09:00:00Z"}]}`
	if err := json.Unmarshal([]byte(body), &l); err != nil {
		t.Fatal(err)
	}
	if got := l.releasedAt(kgVersionA); got != "" {
		t.Fatalf("a release time that is not RFC 3339 must not be passed on, got %q", got)
	}
	if got := l.releasedAt(kgVersionB); got != "2026-10-12T09:00:00Z" {
		t.Fatalf("got %q", got)
	}
}

// ── The route ───────────────────────────────────────────────────────────────────────────────────

// The happy path, and its second half is the point: a route whose claim is that it changes ONE variable is
// held to that, and to leaving the mount alone.
func TestKgUpdateRewritesOnlyThePin(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	before, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	beforeBytes := f.modeFile(t)
	mount := filepath.Join(f.s.cfg.ModulesDir, kgModuleKey)
	marker := readFileT(t, filepath.Join(mount, kgMarkerName))
	stub := readFileT(t, filepath.Join(mount, moduleFileName(kgModuleKey)))

	code, body := f.update(t, kgVersionB)
	if code != http.StatusOK {
		t.Fatalf("an administrator taking the listed latest must be admitted, got %d %s", code, body)
	}
	var res kgUpdateResult
	if err := json.Unmarshal([]byte(body), &res); err != nil {
		t.Fatal(err)
	}
	if res.Status != "applied" || res.Version != kgVersionB || res.From != kgVersionA {
		t.Fatalf("unexpected answer %+v", res)
	}
	for _, want := range []string{platformRestartCommand, "removes no module", "2026-10-12", "2026-10-03", "sha256:222222222222", "sha256:111111111111"} {
		if !strings.Contains(res.Message, want) {
			t.Fatalf("the receipt must name %q, got %s", want, res.Message)
		}
	}

	after, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if after["MODULE_KG_VERSION"] != kgVersionB {
		t.Fatalf("the pin must move, got %q", after["MODULE_KG_VERSION"])
	}
	if len(after) != len(before) {
		t.Fatalf("the update added or removed a variable: %d before, %d after", len(before), len(after))
	}
	for name, was := range before {
		if name != "MODULE_KG_VERSION" && after[name] != was {
			t.Fatalf("%s changed: %q -> %q", name, was, after[name])
		}
	}
	// The fixture's file is console-written, so the bytes must differ by exactly the one value.
	if want := strings.Replace(beforeBytes, kgVersionA, kgVersionB, 1); f.modeFile(t) != want {
		t.Fatalf("the file must differ by the pin alone:\n%s\nwant\n%s", f.modeFile(t), want)
	}
	if readFileT(t, filepath.Join(mount, kgMarkerName)) != marker {
		t.Fatal("the update must not touch the mount's marker")
	}
	if readFileT(t, filepath.Join(mount, moduleFileName(kgModuleKey))) != stub {
		t.Fatal("the update must not touch the mount's module file")
	}
	if a := f.kg.authSeen.Load().(string); a != "" {
		t.Fatalf("the listing is public; the console must send it no credential, got %q", a)
	}
	if tm := f.kg.teamSeen.Load().(string); tm != "" {
		t.Fatalf("the listing is public; the console must send it no team, got %q", tm)
	}
}

// Every refusal leaves the file byte-identical. Each case submits a version DIFFERENT from the pin, so the
// assertion that nothing changed is never satisfied by a write of what was already there.
func TestKgUpdateRefusalsChangeNothing(t *testing.T) {
	newer := listingOf(kgVersionB, []string{kgVersionB, kgVersionA})
	for _, tc := range []struct {
		name    string
		listing string
		setup   func(t *testing.T, f kgFixture)
		version string
		status  int
		says    string
	}{
		{"not a digest", newer, nil, "latest", http.StatusBadRequest, "invalid knowledge-graph version"},
		{"not the listed latest", newer, nil, kgVersionC, http.StatusConflict, "changed after this page loaded"},
		{"a withdrawn latest", listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionB), nil, kgVersionB, http.StatusConflict, "no usable version"},
		{"a malformed latest", `{"latest":"latest","versions":[]}`, nil, kgVersionB, http.StatusConflict, "no usable version"},
		{"no knowledge-graph base", newer, func(t *testing.T, f kgFixture) {
			f.setMode(t, func(v map[string]string) { delete(v, "MODULE_KG_BASE_URL") })
		}, kgVersionB, http.StatusConflict, "reconnecting is what configures one"},
		// Reachable only by editing the file on the host. Re-checked on read, never dialled.
		{"an unusable knowledge-graph base", newer, func(t *testing.T, f kgFixture) {
			f.setMode(t, func(v map[string]string) { v["MODULE_KG_BASE_URL"] = "http://not-loopback.example" })
		}, kgVersionB, http.StatusConflict, "no usable knowledge-graph service"},
		{"the mount's module is missing", newer, func(t *testing.T, f kgFixture) {
			if err := os.Remove(filepath.Join(f.s.cfg.ModulesDir, kgModuleKey, moduleFileName(kgModuleKey))); err != nil {
				t.Fatal(err)
			}
		}, kgVersionB, http.StatusConflict, "not mounted"},
		{"the service is down", newer, func(t *testing.T, f kgFixture) { f.kg.srv.Close() }, kgVersionB, http.StatusServiceUnavailable, "could not be reached"},
		// Reachable only by editing the file: a mount and a base with no pin. Not an update from nothing.
		{"no pin", newer, func(t *testing.T, f kgFixture) {
			f.setMode(t, func(v map[string]string) { delete(v, "MODULE_KG_VERSION") })
		}, kgVersionB, http.StatusConflict, "no version pinned"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, tc.listing)
			if tc.setup != nil {
				tc.setup(t, f)
			}
			was := f.modeFile(t)
			code, body := f.update(t, tc.version)
			if code != tc.status || !strings.Contains(body, tc.says) {
				t.Fatalf("want %d %q, got %d %s", tc.status, tc.says, code, body)
			}
			if f.modeFile(t) != was {
				t.Fatal("a refused update must leave the mode file byte-identical")
			}
		})
	}
}

func TestKgUpdateUnusableBaseIsNeverDialled(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.setMode(t, func(v map[string]string) { v["MODULE_KG_BASE_URL"] = "http://not-loopback.example" })
	_, _ = f.update(t, kgVersionB)
	_ = f.inventory(t)
	if n := f.kg.hits.Load(); n != 0 {
		t.Fatalf("nothing may be dialled for an unusable base, got %d requests", n)
	}
}

// The pre-lock refusals decide from the file alone; none of them may dial the service.
func TestKgUpdateRefusesWithoutDiallingWhenTheConnectionIsNotWhole(t *testing.T) {
	newer := listingOf(kgVersionB, []string{kgVersionB, kgVersionA})
	for name, edit := range map[string]func(t *testing.T, f kgFixture){
		"no pin": func(t *testing.T, f kgFixture) {
			f.setMode(t, func(v map[string]string) { delete(v, "MODULE_KG_VERSION") })
		},
		"no module": func(t *testing.T, f kgFixture) {
			if err := os.Remove(filepath.Join(f.s.cfg.ModulesDir, kgModuleKey, moduleFileName(kgModuleKey))); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, newer)
			edit(t, f)
			if code, body := f.update(t, kgVersionB); code != http.StatusConflict {
				t.Fatalf("want 409, got %d %s", code, body)
			}
			if n := f.kg.hits.Load(); n != 0 {
				t.Fatalf("nothing may be dialled for a connection that is not whole, got %d", n)
			}
		})
	}
}

func TestKgUpdateNamesTheNewestWhenThePageWasBehind(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionC, []string{kgVersionC, kgVersionB, kgVersionA}))
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "sha256:333333333333") {
		t.Fatalf("the refusal must name the version that is newest now, got %d %s", code, body)
	}
}

func TestInventoryNotesAModuleWithNoPin(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.setMode(t, func(v map[string]string) { delete(v, "MODULE_KG_VERSION") })
	inv := f.inventory(t)
	if inv.KnowledgeGraph != nil || !strings.Contains(inv.Note, "no version pinned") {
		t.Fatalf("a module with no pin is not a connection and must be noted, got %+v %q", inv.KnowledgeGraph, inv.Note)
	}
	if n := f.kg.hits.Load(); n != 0 {
		t.Fatalf("there is nothing to offer an update to; the listing must not be read, got %d", n)
	}
}

func TestKgUpdateRefusesOnAPreCloudDeployment(t *testing.T) {
	f := newKgFixture(t, gateOptions{localPosture: true, refuseToBeAsked: true}, "", listingOf(kgVersionB, []string{kgVersionB}))
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "connected to the cloud") {
		t.Fatalf("want 409, got %d %s", code, body)
	}
	if n := f.kg.hits.Load(); n != 0 {
		t.Fatalf("a pre-cloud deployment must dial nothing, got %d", n)
	}
}

func TestKgUpdateAlreadyCurrentWritesNothing(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionB, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	info, err := os.Stat(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	code, body := f.update(t, kgVersionB)
	if code != http.StatusOK || !strings.Contains(body, `"status":"current"`) || !strings.Contains(body, "nothing was changed") {
		t.Fatalf("want 200 current, got %d %s", code, body)
	}
	after, err := os.Stat(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	// Every write renames a new file into place, so a rewrite is a new inode whatever the filesystem's
	// timestamp resolution; comparing modification times could pass on a rewrite in the same tick.
	if !os.SameFile(info, after) {
		t.Fatal("an update to the version already pinned must not rewrite the file")
	}
}

// A withdrawn pin is the case the update is most needed for.
func TestKgUpdateMovesAWithdrawnPin(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionA))
	if code, body := f.update(t, kgVersionB); code != http.StatusOK || !strings.Contains(body, `"status":"applied"`) {
		t.Fatalf("want applied, got %d %s", code, body)
	}
}

// The listing is read outside the lock. A disconnect and reconnect to another service landing in that window
// must not get a version listed by the first service written into a file that now points at the second.
func TestKgUpdateRefusesWhenTheBaseChangedDuringTheRead(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	other := newKgService(t, listingOf(kgVersionC, []string{kgVersionC}))
	f.kg.onRequest.Store(func() {
		if err := f.editMode(func(v map[string]string) { v["MODULE_KG_BASE_URL"] = other.srv.URL }); err != nil {
			t.Error(err)
		}
	})
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "configuration changed") {
		t.Fatalf("want 409, got %d %s", code, body)
	}
	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if vars["MODULE_KG_VERSION"] != kgVersionA || vars["MODULE_KG_BASE_URL"] != other.srv.URL {
		t.Fatalf("the file must be exactly what the reconnect left, got %v", vars)
	}
}

// A disconnect landing between the read and the lock must win: the update never writes a cloud file over the
// pure-OSS one.
func TestKgUpdateNeverUndoesADisconnect(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.kg.onRequest.Store(func() {
		if err := writeModeLayer(f.s.cfg.ModeLayerPath, pureOSSModeVars()); err != nil {
			t.Error(err)
		}
	})
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "disconnected") {
		t.Fatalf("want 409, got %d %s", code, body)
	}
	if isCloudModeFile(f.s.cfg.ModeLayerPath) {
		t.Fatal("the update re-cloudified a disconnected deployment")
	}
}

// The mount is re-checked inside the lock: a disconnect's teardown removing it during the read must stop the
// update, rather than leave a pin with no module to read it.
func TestKgUpdateRefusesWhenTheMountWentDuringTheRead(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.kg.onRequest.Store(func() {
		if err := os.Remove(filepath.Join(f.s.cfg.ModulesDir, kgModuleKey, moduleFileName(kgModuleKey))); err != nil {
			t.Error(err)
		}
	})
	was := f.modeFile(t)
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "not mounted") {
		t.Fatalf("want 409, got %d %s", code, body)
	}
	if f.modeFile(t) != was {
		t.Fatal("a refused update must change nothing")
	}
}

// The pin is asked again under the lock: one removed while the listing was read is not an update from nothing.
func TestKgUpdateRefusesWhenThePinWentDuringTheRead(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.kg.onRequest.Store(func() {
		if err := f.editMode(func(v map[string]string) { delete(v, "MODULE_KG_VERSION") }); err != nil {
			t.Error(err)
		}
	})
	code, body := f.update(t, kgVersionB)
	if code != http.StatusConflict || !strings.Contains(body, "no version pinned") {
		t.Fatalf("want 409, got %d %s", code, body)
	}
	vars, err := readModeLayer(f.s.cfg.ModeLayerPath)
	if err != nil {
		t.Fatal(err)
	}
	if v, present := vars["MODULE_KG_VERSION"]; present {
		t.Fatalf("nothing may be written, got %q", v)
	}
}

// On a deployment that names no team the gate stands aside, as it does for mount and unmount. Accepted: the
// value written is fixed to the service's latest and nothing is removed.
func TestKgUpdateInheritsThePassThroughOnATeamlessDeployment(t *testing.T) {
	f := newKgFixture(t, gateOptions{refuseToBeAsked: true}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	if code, body := f.update(t, kgVersionB); code != http.StatusOK || !strings.Contains(body, `"status":"applied"`) {
		t.Fatalf("want applied, got %d %s", code, body)
	}
}

func TestKgUpdateIsRefusedToANonAdministrator(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a", entitlements: `{"protocol":"1","packages":[],"admin":false}`},
		kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	was := f.modeFile(t)
	code, body := f.update(t, kgVersionB)
	if !isGateRefusal(body) {
		t.Fatalf("a member must be refused by the gate, got %d %s", code, body)
	}
	if f.modeFile(t) != was {
		t.Fatal("a refused update must change nothing")
	}
	if n := f.kg.hits.Load(); n != 0 {
		t.Fatalf("the gate refuses before the listing is read, got %d requests", n)
	}
}

// ── The inventory ───────────────────────────────────────────────────────────────────────────────

func TestInventoryReportsTheKnowledgeGraphsCurrency(t *testing.T) {
	for _, tc := range []struct {
		name, pinned, listing string
		currency, latest      string
		notice                bool
	}{
		{"up to date", kgVersionB, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}), kgCurrent, "", false},
		{"behind", kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}), kgOutdated, kgVersionB, true},
		{"withdrawn, with somewhere to go", kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}, kgVersionA), kgRecalled, kgVersionB, true},
		{"withdrawn, nowhere to go", kgVersionA, listingOf(kgVersionA, []string{kgVersionA}, kgVersionA), kgRecalled, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newKgFixture(t, gateOptions{team: "team-a"}, tc.pinned, tc.listing)
			kg := f.inventory(t).KnowledgeGraph
			if kg == nil {
				t.Fatal("the connection must be reported")
			}
			if kg.Currency != tc.currency || kg.LatestVersion != tc.latest {
				t.Fatalf("got (%s, %q), want (%s, %q)", kg.Currency, kg.LatestVersion, tc.currency, tc.latest)
			}
			// The notice is present exactly when an update is offered.
			if (kg.UpdateNotice != "") != tc.notice {
				t.Fatalf("notice presence: got %q", kg.UpdateNotice)
			}
			if kg.PinnedReleasedAt == "" {
				t.Fatal("the pinned version's release date must be reported when the listing gives it")
			}
		})
	}
}

func TestInventoryKeepsTheConnectionWhenTheServiceIsDown(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.kg.srv.Close()
	inv := f.inventory(t)
	if inv.KnowledgeGraph == nil || inv.KnowledgeGraph.Version != kgVersionA || inv.KnowledgeGraph.Currency != kgUnknown {
		t.Fatalf("the connection must still be reported, as unknown, got %+v", inv.KnowledgeGraph)
	}
	if inv.KnowledgeGraph.LatestVersion != "" || inv.KnowledgeGraph.UpdateNotice != "" {
		t.Fatal("nothing may be offered when the listing could not be read")
	}
	if !strings.Contains(inv.Note, "could not be reached") {
		t.Fatalf("the note must say why, got %q", inv.Note)
	}
}

func TestInventoryNamesTheRemedyForAnUnusableBase(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	f.setMode(t, func(v map[string]string) { v["MODULE_KG_BASE_URL"] = "http://not-loopback.example" })
	inv := f.inventory(t)
	if inv.KnowledgeGraph == nil || inv.KnowledgeGraph.Currency != kgUnknown {
		t.Fatalf("got %+v", inv.KnowledgeGraph)
	}
	// Not "could not be reached", which an operator would retry forever.
	if !strings.Contains(inv.Note, "reconnecting is the remedy") {
		t.Fatalf("the note must name the remedy, got %q", inv.Note)
	}
}

func TestInventoryDoesNotDialForAHalfStateMount(t *testing.T) {
	f := newKgFixture(t, gateOptions{team: "team-a"}, kgVersionA, listingOf(kgVersionB, []string{kgVersionB, kgVersionA}))
	if err := os.RemoveAll(filepath.Join(f.s.cfg.ModulesDir, kgModuleKey)); err != nil {
		t.Fatal(err)
	}
	inv := f.inventory(t)
	if inv.KnowledgeGraph != nil || !strings.Contains(inv.Note, "not mounted") {
		t.Fatalf("the half state must be a note, got %+v %q", inv.KnowledgeGraph, inv.Note)
	}
	if n := f.kg.hits.Load(); n != 0 {
		t.Fatalf("there is nothing to offer an update to; the listing must not be read, got %d", n)
	}
}

// After an update the inventory reads the new pin, which is the configuration and not the running platform;
// the notice the page shows before the click says so.
func TestTheNoticeSaysThePageShowsConfigurationNotTheRunningPlatform(t *testing.T) {
	for _, want := range []string{platformRestartCommand, "removes no module", "keeps answering from the version it started with", "may differ"} {
		if !strings.Contains(kgUpdateNotice, want) {
			t.Fatalf("the notice must say %q", want)
		}
	}
}
