package daemoncmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeFeed serves body as the news feed and counts the requests, recording any Authorization header.
func fakeFeed(t *testing.T, body func(base string) string) (*httptest.Server, *atomic.Int32, *[]string) {
	t.Helper()
	var hits atomic.Int32
	var mu sync.Mutex
	var auth []string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		mu.Lock()
		auth = append(auth, r.Header.Get("Authorization"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body(srv.URL)))
	}))
	t.Cleanup(srv.Close)
	return srv, &hits, &auth
}

// feedDoc renders a feed whose item links point at base, plus whatever extra items a test adds.
func feedDoc(base string, extra ...string) string {
	items := []string{
		`{"id":"release:platform-0.16.0","type":"release","component":"platform","version":"0.16.0","title":"Platform 0.16.0","summary":"s","date":"2026-11-10","url":"` + base + `/releases#platform-0.16.0","tags":["feature"],"notify":true}`,
		`{"id":"release:platform-0.15.0","type":"release","component":"platform","version":"0.15.0","title":"Platform 0.15.0","summary":"s","date":"2026-11-04","url":"` + base + `/releases#platform-0.15.0","tags":["feature","upgrade-steps"],"notify":false}`,
		`{"id":"release:dethereal-0.4.19","type":"release","component":"dethereal","version":"0.4.19","title":"Dethereal 0.4.19","summary":"s","date":"2026-11-01","url":"` + base + `/releases#dethereal-0.4.19","tags":[],"notify":false}`,
		`{"id":"blog:/blog/byodt-available","type":"announcement","component":null,"version":null,"title":"BYODt is available","summary":"s","date":"2026-10-20","url":"` + base + `/blog/byodt-available","tags":["byodt"],"notify":true}`,
		`{"id":"blog:/blog/how-the-platform-is-built","type":"technical","component":null,"version":null,"title":"How it is built","summary":"s","date":"2026-10-01","url":"` + base + `/blog/how-the-platform-is-built","tags":[],"notify":false}`,
	}
	items = append(items, extra...)
	return `{"schemaVersion":1,"site":"` + base + `","items":[` + strings.Join(items, ",") + `]}`
}

func newsServer(t *testing.T, feedURL string) (*server, *httptest.Server, string) {
	t.Helper()
	s := newTestServer(t, "http://127.0.0.1:1", filepath.Join(t.TempDir(), "state.json"))
	s.cfg.NewsFeedURL = feedURL
	s.cfg.Version = "0.15.0"
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	return s, ts, signIn(t, s)
}

func setNews(t *testing.T, base, session string, enabled ...string) (int, []byte) {
	t.Helper()
	if enabled == nil {
		enabled = []string{}
	}
	body, _ := json.Marshal(map[string]any{"enabled": enabled})
	req, _ := http.NewRequest(http.MethodPost, base+"/api/news/preferences", bytes.NewReader(body))
	req.Header.Set(sessionHeader, session)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes()
}

func getNews(t *testing.T, base, session string) newsView {
	t.Helper()
	code, body := get(t, base, "/api/news", session)
	if code != http.StatusOK {
		t.Fatalf("GET /api/news: %d %s", code, body)
	}
	var v newsView
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestNewsIsOffAndFetchesNothingByDefault(t *testing.T) {
	feed, hits, _ := fakeFeed(t, func(b string) string { return feedDoc(b) })
	_, ts, session := newsServer(t, feed.URL+"/feed.json")

	v := getNews(t, ts.URL, session)
	if v.Status != "off" || len(v.Items) != 0 {
		t.Fatalf("a deployment with nothing switched on shows no news, got %+v", v)
	}
	if len(v.Categories) != len(newsCategories) {
		t.Fatalf("every category is offered, got %d", len(v.Categories))
	}
	for _, c := range v.Categories {
		if c.Enabled {
			t.Fatalf("every category starts off, %q is on", c.Key)
		}
	}
	// The point of opt-in: the website is never contacted until someone asks for news.
	if n := hits.Load(); n != 0 {
		t.Fatalf("the feed must not be fetched while every category is off, got %d requests", n)
	}
}

func TestNewsRequiresASession(t *testing.T) {
	_, ts, _ := newsServer(t, "http://127.0.0.1:1/feed.json")
	if code, _ := get(t, ts.URL, "/api/news", ""); code != http.StatusUnauthorized {
		t.Fatalf("GET /api/news without a session must be refused, got %d", code)
	}
	if code, _ := setNews(t, ts.URL, "", "announcement"); code != http.StatusUnauthorized {
		t.Fatalf("POST /api/news/preferences without a session must be refused, got %d", code)
	}
}

func TestNewsShowsOnlyTheEnabledCategories(t *testing.T) {
	feed, hits, auth := fakeFeed(t, func(b string) string { return feedDoc(b) })
	_, ts, session := newsServer(t, feed.URL+"/feed.json")

	if code, body := setNews(t, ts.URL, session, "announcement", "release:platform"); code != http.StatusOK {
		t.Fatalf("setting preferences: %d %s", code, body)
	}
	v := getNews(t, ts.URL, session)
	if v.Status != "ok" || v.Stale {
		t.Fatalf("expected a fresh feed, got %+v", v)
	}
	var ids []string
	for _, it := range v.Items {
		ids = append(ids, it.ID)
	}
	want := []string{"release:platform-0.16.0", "release:platform-0.15.0", "blog:/blog/byodt-available"}
	if strings.Join(ids, " ") != strings.Join(want, " ") {
		t.Fatalf("items = %v, want %v", ids, want)
	}
	if v.Items[2].Group != newsGroupPosts || v.Items[0].Group != newsGroupReleases {
		t.Fatalf("items carry their group: %+v", v.Items)
	}
	// Only the release newer than the deployment's version is marked.
	if !v.Items[0].NewerThanDeployment || v.Items[1].NewerThanDeployment {
		t.Fatalf("only 0.16.0 is newer than a 0.15.0 deployment: %+v", v.Items[:2])
	}
	if v.Totals[newsGroupPosts] != 1 || v.Totals[newsGroupReleases] != 2 {
		t.Fatalf("totals count the enabled categories, got %v", v.Totals)
	}
	if v.Archives[newsGroupReleases] != feed.URL+"/releases" || v.Archives[newsGroupPosts] != feed.URL+"/blog" {
		t.Fatalf("archives are on the feed's own site, got %v", v.Archives)
	}
	if v.DeploymentVersion != "0.15.0" {
		t.Fatalf("deploymentVersion = %q", v.DeploymentVersion)
	}
	for _, c := range v.Categories {
		if c.Enabled && c.Since != time.Now().UTC().Format(time.DateOnly) {
			t.Fatalf("a category switched on now starts from today, got %q", c.Since)
		}
	}

	// A second read inside the cache period does not dial again.
	getNews(t, ts.URL, session)
	if n := hits.Load(); n != 1 {
		t.Fatalf("the feed is cached, got %d requests", n)
	}
	for _, a := range *auth {
		if a != "" {
			t.Fatalf("the console must send no credential to the website, got %q", a)
		}
	}
}

func TestNewsDropsItemsThatDoNotFit(t *testing.T) {
	feed, _, _ := fakeFeed(t, func(b string) string {
		return feedDoc(b,
			// A link to another host.
			`{"id":"blog:elsewhere","type":"announcement","title":"t","summary":"s","date":"2026-11-02","url":"https://example.com/x","tags":[]}`,
			// A link with a different scheme on the same host.
			`{"id":"blog:js","type":"announcement","title":"t","summary":"s","date":"2026-11-02","url":"javascript:alert(1)","tags":[]}`,
			// A date that is not a date.
			`{"id":"blog:baddate","type":"announcement","title":"t","summary":"s","date":"2026-13-45","url":"`+b+`/x","tags":[]}`,
			// A type and a component the console does not know.
			`{"id":"blog:podcast","type":"podcast","title":"t","summary":"s","date":"2026-11-02","url":"`+b+`/x","tags":[]}`,
			`{"id":"release:studio-1.0.0","type":"release","component":"studio","version":"1.0.0","title":"t","summary":"s","date":"2026-11-02","url":"`+b+`/x","tags":[]}`,
			// No title.
			`{"id":"blog:untitled","type":"announcement","title":"","summary":"s","date":"2026-11-02","url":"`+b+`/x","tags":[]}`,
			// A duplicate id.
			`{"id":"blog:/blog/byodt-available","type":"announcement","title":"dup","summary":"s","date":"2026-11-03","url":"`+b+`/x","tags":[]}`,
		)
	})
	_, ts, session := newsServer(t, feed.URL+"/feed.json")
	setNews(t, ts.URL, session, "announcement")

	v := getNews(t, ts.URL, session)
	if len(v.Items) != 1 || v.Items[0].ID != "blog:/blog/byodt-available" || v.Items[0].Title != "BYODt is available" {
		t.Fatalf("only the well-formed announcement survives, got %+v", v.Items)
	}
}

func TestNewsReportsAFeedItCannotRead(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status string
		serve  http.HandlerFunc
	}{
		{"a newer schema", "unsupported", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"schemaVersion":2,"items":"changed"}`))
		}},
		{"a server error", "unavailable", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "down", http.StatusBadGateway)
		}},
		{"not JSON", "unavailable", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`<rss/>`))
		}},
		{"a redirect", "unavailable", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://example.com/feed.json", http.StatusFound)
		}},
		{"an oversized body", "unavailable", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"schemaVersion":1,"items":[],"pad":"` + strings.Repeat("x", newsMaxBytes) + `"}`))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			feed := httptest.NewServer(tc.serve)
			defer feed.Close()
			_, ts, session := newsServer(t, feed.URL+"/feed.json")
			setNews(t, ts.URL, session, "announcement")

			v := getNews(t, ts.URL, session)
			if v.Status != tc.status || v.Detail == "" || len(v.Items) != 0 {
				t.Fatalf("want status %q with a detail and no items, got %+v", tc.status, v)
			}
		})
	}
}

func TestNewsCacheServesTheEarlierCopyAndBacksOff(t *testing.T) {
	var fail atomic.Bool
	var hits atomic.Int32
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		if fail.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"schemaVersion":1,"items":[]}`))
	}))
	defer feed.Close()

	var c newsCache
	t0 := time.Now()
	if f, _, err := c.get(feed.URL, t0); err != nil || f == nil {
		t.Fatalf("first fetch: %v", err)
	}

	// Past the cache period, the website is down: the earlier copy is served with the error.
	fail.Store(true)
	t1 := t0.Add(newsCacheTTL + time.Minute)
	f, fetchedAt, err := c.get(feed.URL, t1)
	if err == nil || f == nil || !fetchedAt.Equal(t0) {
		t.Fatalf("a failed refresh serves the earlier copy with the error, got feed=%v at=%v err=%v", f, fetchedAt, err)
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("expected the refresh to dial, got %d requests", n)
	}

	// Inside the retry interval, nobody dials again.
	if _, _, err := c.get(feed.URL, t1.Add(time.Minute)); err == nil {
		t.Fatal("the failure is still reported inside the retry interval")
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("a failure is not retried inside the retry interval, got %d requests", n)
	}

	// After it, the next ask dials, and a recovered website is fresh again.
	fail.Store(false)
	if _, _, err := c.get(feed.URL, t1.Add(newsRetryAfter+time.Second)); err != nil {
		t.Fatalf("a recovered feed is read again: %v", err)
	}
	if n := hits.Load(); n != 3 {
		t.Fatalf("expected one more dial after the retry interval, got %d requests", n)
	}
}

func TestNewsPreferencesKeepTheDateACategoryWasSwitchedOn(t *testing.T) {
	s, ts, session := newsServer(t, "http://127.0.0.1:1/feed.json")
	path := s.newsPrefsPath()

	earlier := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	if err := writeNewsPrefs(path, newsPrefs{Schema: newsPrefsSchema, Enabled: map[string]time.Time{"announcement": earlier, "video": earlier}}); err != nil {
		t.Fatal(err)
	}
	if code, body := setNews(t, ts.URL, session, "announcement", "release:platform"); code != http.StatusOK {
		t.Fatalf("setting preferences: %d %s", code, body)
	}
	p, err := readNewsPrefs(path)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Enabled["announcement"].Equal(earlier) {
		t.Fatalf("a category left on keeps its date, got %v", p.Enabled["announcement"])
	}
	if _, on := p.Enabled["video"]; on {
		t.Fatal("a category left out is switched off")
	}
	if p.Enabled["release:platform"].Before(earlier) || p.Enabled["release:platform"].IsZero() {
		t.Fatalf("a newly switched category starts from now, got %v", p.Enabled["release:platform"])
	}
	fi, err := os.Stat(path)
	if err != nil || fi.Mode().Perm() != 0o644 {
		t.Fatalf("the preferences file is written 0644, got %v %v", fi, err)
	}

	// Switching everything off is a valid request, and leaves nothing on.
	if code, _ := setNews(t, ts.URL, session); code != http.StatusOK {
		t.Fatalf("switching everything off: %d", code)
	}
	if p, _ := readNewsPrefs(path); len(p.Enabled) != 0 {
		t.Fatalf("nothing is on, got %v", p.Enabled)
	}
}

func TestNewsPreferencesRefuseWhatIsNotACategory(t *testing.T) {
	s, ts, session := newsServer(t, "http://127.0.0.1:1/feed.json")
	if code, _ := setNews(t, ts.URL, session, "announcement", "release:studio"); code != http.StatusBadRequest {
		t.Fatalf("an unknown category is refused, got %d", code)
	}
	if _, err := os.Stat(s.newsPrefsPath()); !os.IsNotExist(err) {
		t.Fatal("a refused request writes nothing")
	}
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/news/preferences", strings.NewReader(`{"enabled":["announcement"],"feed":"https://example.com"}`))
	req.Header.Set(sessionHeader, session)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown field is refused rather than ignored, got %d", resp.StatusCode)
	}
}

func TestNewsPreferencesRefuseASymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "elsewhere.json")
	if err := writeNewsPrefs(target, newsPrefs{Schema: newsPrefsSchema, Enabled: map[string]time.Time{"announcement": time.Now()}}); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, newsPrefsFileName)
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	p, err := readNewsPrefs(link)
	if err == nil || len(p.Enabled) != 0 {
		t.Fatalf("a symlinked preferences file reads as nothing on, with an error; got %v %v", p.Enabled, err)
	}
	// And a write replaces the link rather than writing through it.
	if err := writeNewsPrefs(link, newsPrefs{Schema: newsPrefsSchema, Enabled: map[string]time.Time{}}); err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Lstat(link); fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("the write replaced the link with a file")
	}
	if p, _ := readNewsPrefs(target); len(p.Enabled) != 1 {
		t.Fatal("the link's target is untouched")
	}
}

func TestNewsPrefsPathDefaultsBesideTheModeLayer(t *testing.T) {
	s := &server{cfg: Config{ModeLayerPath: "/var/lib/dethernety/mode.env"}}
	if got := s.newsPrefsPath(); got != "/var/lib/dethernety/news.json" {
		t.Fatalf("newsPrefsPath = %q", got)
	}
	s.cfg.NewsPrefsPath = "/elsewhere/news.json"
	if got := s.newsPrefsPath(); got != "/elsewhere/news.json" {
		t.Fatalf("NEWS_PREFS_PATH wins, got %q", got)
	}
}

func TestSameSiteURL(t *testing.T) {
	site, _ := url.Parse("https://dether.net/feed.json")
	for raw, want := range map[string]bool{
		"https://dether.net/blog/x":         true,
		"https://dether.net/releases#a-1":   true,
		"http://dether.net/blog/x":          false,
		"https://dether.net.evil/x":         false,
		"https://evil@dether.net/x":         false,
		"//dether.net/x":                    false,
		"/blog/x":                           false,
		"javascript:alert(1)":               false,
		"https://dether.net/x\nSet-Cookie:": false,
	} {
		if got := sameSiteURL(raw, site); got != want {
			t.Errorf("sameSiteURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestNewsCapsEachSectionAndCountsWhatItLeftOut(t *testing.T) {
	feed, _, _ := fakeFeed(t, func(b string) string {
		var extra []string
		for i := range newsMaxItems + 30 {
			day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i).Format(time.DateOnly)
			id := fmt.Sprintf("release:platform-1.%d.0", i)
			extra = append(extra, `{"id":"`+id+`","type":"release","component":"platform","version":"1.`+fmt.Sprint(i)+`.0","title":"t","summary":"s","date":"`+day+`","url":"`+b+`/releases","tags":[]}`)
		}
		return feedDoc(b, extra...)
	})
	_, ts, session := newsServer(t, feed.URL+"/feed.json")
	setNews(t, ts.URL, session, "announcement", "release:platform")

	v := getNews(t, ts.URL, session)
	var releases, posts int
	for _, it := range v.Items {
		if it.Group == newsGroupReleases {
			releases++
		} else {
			posts++
		}
	}
	// The cap is per section, so a run of releases cannot push the posts out.
	if releases != newsMaxItems || posts != 1 {
		t.Fatalf("want %d releases and 1 post, got %d and %d", newsMaxItems, releases, posts)
	}
	if v.Totals[newsGroupReleases] != newsMaxItems+30+2 {
		t.Fatalf("the total counts what the cap left out, got %d", v.Totals[newsGroupReleases])
	}
}
