package daemoncmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/redact"
)

// News: the project's blog posts and release notes, read from the website's public feed and shown on the
// console's News tab. It is opt-in by category and OFF until someone switches a category on — a fresh
// deployment never contacts the website for news, and switching every category off stops it again.
//
// THE DAEMON FETCHES, NOT THE BROWSER. The feed is served with an open CORS header, so the SPA could read
// it directly, but then every operator's browser would call the website on its own, and an operator whose
// browser cannot reach the internet would see nothing. Fetched here it follows the deployment's outbound
// proxy like every other call this console makes, it is fetched once per cache period for every operator,
// and the SPA only ever talks to its own daemon.
//
// THE DESTINATION IS FIXED. The feed URL is configuration, never read from a request, and redirects are
// refused (newPublicClient), so the set of hosts this dials is the one named here. Nothing identifying is
// sent: no credential, no team header, no version. The feed is the same for everyone and the reader
// filters it locally.
//
// WHAT IS PASSED ON IS VALIDATED, not relayed. Every item is checked against the shape the feed promises
// and an item that does not fit is dropped; a link is passed on only if it points at the feed's own site,
// so the SPA never renders a link to anywhere the console did not choose to dial.
//
// WHAT AN OPERATOR HAS READ IS NOT KEPT HERE. That is per person, and in local posture the console has no
// notion of who the person is, so the SPA keeps it in the browser. What is kept here is which categories
// the deployment shows, and since when, so that switching a category on does not mark its whole back
// catalogue as new in every operator's browser.

const (
	// defaultNewsFeedURL is the website's feed for this console: blog posts and releases in one document.
	defaultNewsFeedURL = "https://dether.net/feed.json"
	// newsSchemaVersion is the one feed shape this console reads. The website bumps it on a breaking
	// change; a console that meets another one says so rather than guessing at the new shape.
	newsSchemaVersion = 1
	// newsCacheTTL matches the feed's own Cache-Control max-age: fetching it more often only re-reads the
	// CDN's copy.
	newsCacheTTL = time.Hour
	// newsRetryAfter bounds how often a failing fetch is retried. Every open console tab asks the daemon,
	// and without it each ask during an outage would be another 15-second dial.
	newsRetryAfter = 5 * time.Minute
	// newsMaxBytes caps the feed body. The whole feed is a few tens of kilobytes today.
	newsMaxBytes = 1 << 20
	// newsMaxItems caps what the SPA is handed, per group, after filtering: a list, not an archive.
	newsMaxItems = 50

	newsPrefsFileName = "news.json"
	newsPrefsSchema   = "dethernety.console-news/1"
	newsPrefsMaxBytes = 64 << 10
)

// newsGroup is the section of the News tab a category belongs to. Posts and releases are kept apart so an
// announcement is never pushed down the list by a run of point releases.
type newsGroup string

const (
	newsGroupPosts    newsGroup = "posts"
	newsGroupReleases newsGroup = "releases"
)

// newsCategory is one switch an operator can turn on. Its key is what the preferences file stores and what
// the SPA sends back; the label is what the operator reads.
type newsCategory struct {
	key   string
	label string
	group newsGroup
}

// newsCategories is the fixed list, in the order the SPA shows it. A blog post's category is its type; a
// release's is its component. A feed item that maps to none of these is dropped, so a type or component the
// website adds later stays out of the console until the console learns its name.
var newsCategories = []newsCategory{
	{"announcement", "Announcements", newsGroupPosts},
	{"video", "Videos", newsGroupPosts},
	{"technical", "Technical notes", newsGroupPosts},
	{"release:platform", "Platform", newsGroupReleases},
	{"release:dethereal", "Dethereal", newsGroupReleases},
	{"release:threat-patterns", "Threat Patterns", newsGroupReleases},
	{"release:risk-assessment", "Risk Assessment", newsGroupReleases},
	{"release:packages", "Module packages", newsGroupReleases},
}

func newsCategoryByKey(key string) (newsCategory, bool) {
	for _, c := range newsCategories {
		if c.key == key {
			return c, true
		}
	}
	return newsCategory{}, false
}

// newsFeed is the website's feed document, as much of it as this console reads.
type newsFeed struct {
	SchemaVersion int            `json:"schemaVersion"`
	Items         []newsFeedItem `json:"items"`
}

type newsFeedItem struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Component *string  `json:"component"`
	Version   *string  `json:"version"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary"`
	Date      string   `json:"date"`
	URL       string   `json:"url"`
	Tags      []string `json:"tags"`
	Notify    bool     `json:"notify"`
}

// newsItem is one item as the SPA receives it: validated, categorised, and marked against this deployment.
type newsItem struct {
	ID       string    `json:"id"`
	Category string    `json:"category"`
	Group    newsGroup `json:"group"`
	Version  string    `json:"version,omitempty"`
	Title    string    `json:"title"`
	Summary  string    `json:"summary"`
	Date     string    `json:"date"`
	URL      string    `json:"url"`
	Tags     []string  `json:"tags"`
	Notify   bool      `json:"notify"`
	// NewerThanDeployment marks a platform release newer than the version this console was built for,
	// which is the version the deployment runs (init refuses to run a console against another one). It is
	// a fact about the deployment rather than about what anyone has read, so it does not clear when read.
	NewerThanDeployment bool `json:"newerThanDeployment,omitempty"`
}

type newsCategoryView struct {
	Key     string    `json:"key"`
	Label   string    `json:"label"`
	Group   newsGroup `json:"group"`
	Enabled bool      `json:"enabled"`
	// Since is the UTC date the category was switched on. An item dated before it is part of the back
	// catalogue the operator chose to start from, and the SPA does not count it as new.
	Since string `json:"since,omitempty"`
}

// newsView is GET /api/news.
//
// Status is one of:
//   - off: no category is switched on, so nothing was fetched.
//   - ok: items are the feed's, filtered to the enabled categories. Stale is set when the latest fetch
//     failed and these are from an earlier one.
//   - unavailable: the feed could not be fetched and there is no earlier copy.
//   - unsupported: the feed is in a shape this console does not read.
type newsView struct {
	Status            string             `json:"status"`
	Stale             bool               `json:"stale,omitempty"`
	FetchedAt         string             `json:"fetchedAt,omitempty"`
	Detail            string             `json:"detail,omitempty"`
	DeploymentVersion string             `json:"deploymentVersion,omitempty"`
	Categories        []newsCategoryView `json:"categories"`
	Items             []newsItem         `json:"items"`
	// Totals is how many items each section has in the enabled categories, before the newsMaxItems cap, so
	// the SPA can say there are more instead of ending the list as if there were not.
	Totals map[newsGroup]int `json:"totals,omitempty"`
	// Archives is where each section's full history is, on the feed's own site. The console shows recent
	// items; the website keeps everything.
	Archives map[newsGroup]string `json:"archives,omitempty"`
}

// newsArchivePaths are the website's pages listing every post and every release.
var newsArchivePaths = map[newsGroup]string{
	newsGroupPosts:    "/blog",
	newsGroupReleases: "/releases",
}

const (
	newsUnavailableDetail = "The console could not reach the website's news feed. It will try again in a few minutes."
	newsStaleDetail       = "The console could not reach the website's news feed, so this is the copy it read earlier."
	newsUnsupportedDetail = "The website's news feed is in a format this console does not read. Upgrading the deployment brings a console that reads it."
)

// errNewsUnsupported marks a feed this console cannot read, as distinct from one it could not reach.
var errNewsUnsupported = errors.New("news feed schema version not supported")

// newsCache holds the last good feed and the last failure. Its zero value is ready to use.
//
// The lock is held across the fetch, so concurrent requests during a refresh wait for the one dial rather
// than making their own. That is a wait of at most the client timeout, and only once per cache period.
type newsCache struct {
	mu        sync.Mutex
	feed      *newsFeed
	fetchedAt time.Time
	err       error
	failedAt  time.Time
}

// get returns the cached feed, refreshing it first if it is older than the cache period and the last
// failure is older than the retry interval. When a refresh fails it returns the earlier feed, if any, with
// the error.
func (c *newsCache) get(feedURL string, now time.Time) (*newsFeed, time.Time, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fresh := c.feed != nil && now.Sub(c.fetchedAt) < newsCacheTTL
	retryWait := c.err != nil && now.Sub(c.failedAt) < newsRetryAfter
	if fresh || retryWait {
		return c.feed, c.fetchedAt, c.err
	}
	// Not the request's context: a tab closed mid-fetch would otherwise record a failure and hold every
	// other operator off the feed for the retry interval.
	ctx, cancel := context.WithTimeout(context.Background(), contentTimeout)
	defer cancel()
	feed, err := fetchNewsFeed(ctx, feedURL)
	if err != nil {
		c.err, c.failedAt = err, now
		return c.feed, c.fetchedAt, err
	}
	c.feed, c.fetchedAt, c.err = feed, now, nil
	return feed, now, nil
}

// fetchNewsFeed reads the feed with the catalog's public client: no credential, no redirect followed, the
// deployment's outbound proxy honoured, and the body capped.
func fetchNewsFeed(ctx context.Context, feedURL string) (*newsFeed, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := newPublicClient().Do(req)
	if err != nil {
		return nil, redact.Error(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("news feed GET: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, newsMaxBytes+1))
	if err != nil {
		return nil, redact.Error(err)
	}
	if len(body) > newsMaxBytes {
		return nil, fmt.Errorf("news feed exceeds %d bytes", newsMaxBytes)
	}
	// The version is read on its own first, so a feed whose items changed shape is reported as a new
	// format rather than as a decode error.
	var head struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		return nil, fmt.Errorf("decoding news feed: %w", err)
	}
	if head.SchemaVersion != newsSchemaVersion {
		return nil, fmt.Errorf("%w: %d", errNewsUnsupported, head.SchemaVersion)
	}
	var feed newsFeed
	if err := json.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("decoding news feed: %w", err)
	}
	return &feed, nil
}

var (
	newsDatePattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)
	newsTagPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
)

// Length caps on what is passed to the SPA. Generous against what the website writes, and there so a feed
// that went wrong cannot fill the page.
const (
	newsMaxIDLen      = 200
	newsMaxTitleLen   = 300
	newsMaxSummaryLen = 2000
	newsMaxURLLen     = 500
	newsMaxTags       = 10
)

// newsItemFrom validates one feed item and maps it to its category. ok is false for an item to drop: one
// in no known category, or one that does not fit the feed's promised shape.
func newsItemFrom(it newsFeedItem, site *url.URL) (newsItem, bool) {
	var key string
	switch it.Type {
	case "announcement", "video", "technical":
		key = it.Type
	case "release":
		if it.Component == nil {
			return newsItem{}, false
		}
		key = "release:" + *it.Component
	default:
		return newsItem{}, false
	}
	cat, ok := newsCategoryByKey(key)
	if !ok {
		return newsItem{}, false
	}
	if it.ID == "" || len(it.ID) > newsMaxIDLen || hasControlChar(it.ID) {
		return newsItem{}, false
	}
	if it.Title == "" || len(it.Title) > newsMaxTitleLen || len(it.Summary) > newsMaxSummaryLen {
		return newsItem{}, false
	}
	if !newsDatePattern.MatchString(it.Date) {
		return newsItem{}, false
	}
	if _, err := time.Parse(time.DateOnly, it.Date); err != nil {
		return newsItem{}, false
	}
	if !sameSiteURL(it.URL, site) {
		return newsItem{}, false
	}
	out := newsItem{
		ID:       it.ID,
		Category: cat.key,
		Group:    cat.group,
		Title:    it.Title,
		Summary:  it.Summary,
		Date:     it.Date,
		URL:      it.URL,
		Tags:     []string{},
		Notify:   it.Notify,
	}
	// A version is passed on only in the shape a release carries. One that is not readable is dropped
	// rather than the item: the item is still news, it just cannot be compared.
	if it.Version != nil {
		if _, ok := versionComponents(*it.Version); ok {
			out.Version = *it.Version
		}
	}
	for _, tag := range it.Tags {
		if len(out.Tags) == newsMaxTags {
			break
		}
		if newsTagPattern.MatchString(tag) {
			out.Tags = append(out.Tags, tag)
		}
	}
	return out, true
}

// sameSiteURL reports whether raw is an absolute link on the feed's own scheme and host. That is the
// website's whole link set today, and it keeps the console from rendering a link to anywhere else.
func sameSiteURL(raw string, site *url.URL) bool {
	if raw == "" || len(raw) > newsMaxURLLen || hasControlChar(raw) {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Scheme == site.Scheme && u.Host == site.Host && u.User == nil
}

// newsPrefs is the preferences file: the categories switched on, each with the time it was switched on.
type newsPrefs struct {
	Schema  string               `json:"schema"`
	Enabled map[string]time.Time `json:"enabled"`
}

// newsPrefsMu serialises the read-modify-write of the preferences file within this process.
var newsPrefsMu sync.Mutex

func (s *server) newsPrefsPath() string {
	if s.cfg.NewsPrefsPath != "" {
		return s.cfg.NewsPrefsPath
	}
	return filepath.Join(filepath.Dir(s.cfg.ModeLayerPath), newsPrefsFileName)
}

// readNewsPrefs reads the preferences file. A missing file is "nothing switched on", which is the default.
// A file that is not what this console writes reads as nothing switched on too, and is reported, so a
// damaged file stops the fetches rather than starting them.
//
// A SYMLINK IS REFUSED. The directory is the mode layer's, which the host side keeps world-writable, so a
// link planted there could make this read some other file. Writes need no such check: they rename over the
// name, which replaces a link rather than following it.
func readNewsPrefs(path string) (newsPrefs, error) {
	empty := newsPrefs{Schema: newsPrefsSchema, Enabled: map[string]time.Time{}}
	fi, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	if !fi.Mode().IsRegular() {
		return empty, fmt.Errorf("%s is not a regular file", path)
	}
	f, err := os.Open(path)
	if err != nil {
		return empty, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, newsPrefsMaxBytes+1))
	if err != nil {
		return empty, err
	}
	if len(data) > newsPrefsMaxBytes {
		return empty, fmt.Errorf("%s is larger than this console writes", path)
	}
	var p newsPrefs
	if err := json.Unmarshal(data, &p); err != nil {
		return empty, fmt.Errorf("decoding %s: %w", path, err)
	}
	if p.Schema != newsPrefsSchema {
		return empty, fmt.Errorf("%s has schema %q, not %q", path, p.Schema, newsPrefsSchema)
	}
	// Keep only categories this console knows. A key from another version is dropped, not an error.
	out := empty
	for k, t := range p.Enabled {
		if _, ok := newsCategoryByKey(k); ok {
			out.Enabled[k] = t
		}
	}
	return out, nil
}

// writeNewsPrefs writes the preferences file through a uniquely named temp file and a rename, the shape the
// mode layer's own writer uses, so a reader never sees half a file.
func writeNewsPrefs(path string, p newsPrefs) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating the news preferences directory: %w", err)
	}
	f, err := os.CreateTemp(dir, ".news-*.json.tmp")
	if err != nil {
		return fmt.Errorf("writing news preferences: %w", err)
	}
	tmp := f.Name()
	defer func() { _ = os.Remove(tmp) }()
	if _, err := f.Write(append(data, '\n')); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing news preferences: %w", err)
	}
	// Non-secret, and read back by the host's backup as well as by this console.
	if err := f.Chmod(0o644); err != nil {
		_ = f.Close()
		return fmt.Errorf("writing news preferences: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("writing news preferences: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("writing news preferences: %w", err)
	}
	return nil
}

func newsCategoryViews(p newsPrefs) []newsCategoryView {
	out := make([]newsCategoryView, 0, len(newsCategories))
	for _, c := range newsCategories {
		v := newsCategoryView{Key: c.key, Label: c.label, Group: c.group}
		if t, ok := p.Enabled[c.key]; ok {
			v.Enabled = true
			v.Since = t.UTC().Format(time.DateOnly)
		}
		out = append(out, v)
	}
	return out
}

// news is GET /api/news: the enabled categories' items, newest first. Every operator may read it.
func (s *server) news(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	prefs, err := readNewsPrefs(s.newsPrefsPath())
	if err != nil {
		s.logger.Warn("news preferences unreadable; showing no news", "err", err)
	}
	view := newsView{Status: "off", Categories: newsCategoryViews(prefs), Items: []newsItem{}}
	if _, ok := versionComponents(s.cfg.Version); ok {
		view.DeploymentVersion = s.cfg.Version
	}
	if len(prefs.Enabled) == 0 {
		writeJSON(w, http.StatusOK, view)
		return
	}

	site, err := url.Parse(s.cfg.NewsFeedURL)
	if err != nil || site.Host == "" {
		s.logger.Error("news feed URL is not usable", "url", s.cfg.NewsFeedURL)
		view.Status, view.Detail = "unavailable", newsUnavailableDetail
		writeJSON(w, http.StatusOK, view)
		return
	}

	feed, fetchedAt, err := s.newsCache.get(s.cfg.NewsFeedURL, time.Now())
	switch {
	case err != nil && errors.Is(err, errNewsUnsupported):
		s.logger.Warn("news feed not read", "err", err)
		view.Status, view.Detail = "unsupported", newsUnsupportedDetail
		writeJSON(w, http.StatusOK, view)
		return
	case err != nil && feed == nil:
		s.logger.Warn("news feed not reachable", "err", err)
		view.Status, view.Detail = "unavailable", newsUnavailableDetail
		writeJSON(w, http.StatusOK, view)
		return
	case err != nil:
		view.Stale, view.Detail = true, newsStaleDetail
	}
	view.Status = "ok"
	view.FetchedAt = fetchedAt.UTC().Format(time.RFC3339)
	view.Items, view.Totals = filterNews(feed, prefs, site, view.DeploymentVersion)
	view.Archives = map[newsGroup]string{}
	for g, path := range newsArchivePaths {
		view.Archives[g] = site.Scheme + "://" + site.Host + path
	}
	writeJSON(w, http.StatusOK, view)
}

// filterNews keeps the items in enabled categories, newest first, at most newsMaxItems per group, and
// counts each group before the cap.
func filterNews(feed *newsFeed, prefs newsPrefs, site *url.URL, deploymentVersion string) ([]newsItem, map[newsGroup]int) {
	seen := map[string]bool{}
	var items []newsItem
	for _, raw := range feed.Items {
		it, ok := newsItemFrom(raw, site)
		if !ok || seen[it.ID] {
			continue
		}
		if _, on := prefs.Enabled[it.Category]; !on {
			continue
		}
		seen[it.ID] = true
		if deploymentVersion != "" && it.Category == "release:platform" && it.Version != "" {
			if cmp, ok := compareVersion(it.Version, deploymentVersion); ok && cmp > 0 {
				it.NewerThanDeployment = true
			}
		}
		items = append(items, it)
	}
	// The feed is sorted already; sorting again means the console does not depend on it.
	sort.SliceStable(items, func(i, j int) bool { return items[i].Date > items[j].Date })
	out := make([]newsItem, 0, len(items))
	totals := map[newsGroup]int{newsGroupPosts: 0, newsGroupReleases: 0}
	for _, it := range items {
		totals[it.Group]++
		if totals[it.Group] > newsMaxItems {
			continue
		}
		out = append(out, it)
	}
	return out, totals
}

// newsPreferences is POST /api/news/preferences: the full set of categories to show. It changes what the
// whole deployment shows, so it is admin-gated like the deployment's other settings.
//
// A category already on keeps the date it was switched on; a newly switched one starts from now; one left
// out is switched off, and switching it on again later starts from then.
func (s *server) newsPreferences(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled []string `json:"enabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		http.Error(w, "the request is not a list of news categories", http.StatusBadRequest)
		return
	}
	for _, k := range body.Enabled {
		if _, ok := newsCategoryByKey(k); !ok {
			http.Error(w, fmt.Sprintf("%q is not a news category", k), http.StatusBadRequest)
			return
		}
	}

	newsPrefsMu.Lock()
	defer newsPrefsMu.Unlock()
	path := s.newsPrefsPath()
	// An unreadable file is replaced: the operator is saying what they want now, and the old file named
	// nothing this console could use.
	prev, err := readNewsPrefs(path)
	if err != nil {
		s.logger.Warn("news preferences unreadable; replacing them", "err", err)
	}
	now := time.Now().UTC()
	next := newsPrefs{Schema: newsPrefsSchema, Enabled: map[string]time.Time{}}
	for _, k := range body.Enabled {
		if t, ok := prev.Enabled[k]; ok {
			next.Enabled[k] = t
		} else {
			next.Enabled[k] = now
		}
	}
	if err := writeNewsPrefs(path, next); err != nil {
		s.logger.Error("writing news preferences", "err", err)
		http.Error(w, "the console could not save the news settings", http.StatusInternalServerError)
		return
	}
	keys := make([]string, 0, len(next.Enabled))
	for k := range next.Enabled {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	s.logger.Info("news preferences changed", "enabled", strings.Join(keys, ","))
	writeJSON(w, http.StatusOK, map[string]any{"categories": newsCategoryViews(next)})
}
