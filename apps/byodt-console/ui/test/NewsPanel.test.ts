import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewsPanel from '@/components/NewsPanel.vue'
import { clearSession, setSession, type NewsCategory, type NewsItem, type NewsView } from '@/api'
import { OnScreenObserver } from './fake-observer'

const categories = (on: string[], since = '2026-11-01'): NewsCategory[] =>
  [
    { key: 'announcement', label: 'Announcements', group: 'posts' },
    { key: 'video', label: 'Videos', group: 'posts' },
    { key: 'technical', label: 'Technical notes', group: 'posts' },
    { key: 'release:platform', label: 'Platform', group: 'releases' },
    { key: 'release:dethereal', label: 'Dethereal', group: 'releases' },
  ].map((c) => ({ ...c, group: c.group as NewsCategory['group'], enabled: on.includes(c.key), since: on.includes(c.key) ? since : undefined }))

const item = (id: string, category: string, date: string, extra: Partial<NewsItem> = {}): NewsItem => ({
  id,
  category,
  group: category.startsWith('release:') ? 'releases' : 'posts',
  title: id,
  summary: `summary of ${id}`,
  date,
  url: `https://dether.net/${id}`,
  tags: [],
  notify: false,
  ...extra,
})

const okView = (): NewsView => ({
  status: 'ok',
  deploymentVersion: '0.15.0',
  categories: categories(['announcement', 'release:platform', 'release:dethereal']),
  items: [
    item('platform-0.16.0', 'release:platform', '2026-11-10', { version: '0.16.0', newerThanDeployment: true }),
    item('dethereal-0.5.0', 'release:dethereal', '2026-11-08', { version: '0.5.0' }),
    item('post-new', 'announcement', '2026-11-05'),
    item('platform-0.15.0', 'release:platform', '2026-11-04', { version: '0.15.0' }),
    // Before the categories were switched on: back catalogue, never new.
    item('post-old', 'announcement', '2026-10-20'),
  ],
})

function mountPanel(props: Partial<{ view: NewsView | null; active: boolean; seen: Set<string>; fresh: Set<string>; loadError: string }> = {}) {
  return mount(NewsPanel, {
    props: { view: okView(), loadError: '', active: true, seen: new Set<string>(), fresh: new Set<string>(), ...props },
  })
}

let postStatus = 200
let postBody = ''
let lastPost: { url: string; body: unknown; token: string | null } | null = null
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  if (url.endsWith('/api/news/preferences') && init?.method === 'POST') {
    lastPost = { url, body: JSON.parse(String(init.body)), token: new Headers(init.headers).get('X-Console-Cloud-Token') }
    return postStatus === 200
      ? new Response(JSON.stringify({ categories: [] }), { status: 200 })
      : new Response(postBody, { status: postStatus })
  }
  return new Response('not found', { status: 404 })
})

beforeEach(() => {
  postStatus = 200
  postBody = ''
  lastPost = null
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IntersectionObserver', OnScreenObserver)
  setSession('sess-1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearSession()
})

describe('NewsPanel', () => {
  it('keeps posts and releases in separate sections, posts first', () => {
    const w = mountPanel()
    const sections = w.findAll('[data-news-section]').map((s) => s.attributes('data-news-section'))
    expect(sections).toEqual(['posts', 'releases'])
    const posts = w.find('[data-news-section="posts"]').findAll('[data-news-item]').map((i) => i.attributes('data-news-item'))
    expect(posts).toEqual(['post-new', 'post-old'])
    const releases = w.find('[data-news-section="releases"]').findAll('[data-news-item]').map((i) => i.attributes('data-news-item'))
    expect(releases).toEqual(['platform-0.16.0', 'dethereal-0.5.0', 'platform-0.15.0'])
    w.unmount()
  })

  it('marks new items and counts them per section, leaving the back catalogue unmarked', () => {
    const w = mountPanel({ active: false })
    expect(w.find('[data-news-section-count="posts"]').text()).toBe('1 new')
    expect(w.find('[data-news-section-count="releases"]').text()).toBe('3 new')
    expect(w.find('[data-news-item="post-new"] [data-news-new]').exists()).toBe(true)
    expect(w.find('[data-news-item="post-old"] [data-news-new]').exists()).toBe(false)
    w.unmount()
  })

  it('does not mark what has been seen, unless it was read during this visit', () => {
    const w = mountPanel({ active: false, seen: new Set(['post-new', 'platform-0.16.0']), fresh: new Set(['platform-0.16.0']) })
    expect(w.find('[data-news-item="post-new"] [data-news-new]').exists()).toBe(false)
    expect(w.find('[data-news-item="platform-0.16.0"] [data-news-new]').exists()).toBe(true)
    w.unmount()
  })

  it('reports the new items as seen once the tab is open, and not before', async () => {
    const w = mountPanel({ active: false })
    await flushPromises()
    expect(w.emitted('seen')).toBeUndefined()

    await w.setProps({ active: true })
    await flushPromises()
    const ids = (w.emitted('seen') ?? []).flatMap((e) => e[0] as string[])
    expect(ids.sort()).toEqual(['dethereal-0.5.0', 'platform-0.15.0', 'platform-0.16.0', 'post-new'])
    w.unmount()
  })

  it('marks only the release newer than the deployment', () => {
    const w = mountPanel()
    const newer = w.findAll('[data-news-newer]')
    expect(newer).toHaveLength(1)
    expect(newer[0].element.closest('[data-news-item]')?.getAttribute('data-news-item')).toBe('platform-0.16.0')
    w.unmount()
  })

  it('opens every link in a new tab without an opener', () => {
    const w = mountPanel()
    for (const a of w.findAll('[data-news-item] a')) {
      expect(a.attributes('target')).toBe('_blank')
      expect(a.attributes('rel')).toBe('noopener noreferrer')
    }
    w.unmount()
  })

  it('narrows the releases to one component', async () => {
    const w = mountPanel()
    await w.find('[data-news-chip="release:dethereal"]').trigger('click')
    const releases = w.find('[data-news-section="releases"]').findAll('[data-news-item]').map((i) => i.attributes('data-news-item'))
    expect(releases).toEqual(['dethereal-0.5.0'])
    // The section's count is still the whole section's.
    expect(w.find('[data-news-section-count="releases"]').text()).toBe('3 new')
    w.unmount()
  })

  it('marks a whole section as read', async () => {
    const w = mountPanel({ active: false })
    await w.find('[data-news-mark-read="posts"]').trigger('click')
    const seen = w.emitted('seen') ?? []
    const dismissed = w.emitted('dismiss') ?? []
    expect(seen[seen.length - 1]?.[0]).toEqual(['post-new', 'post-old'])
    expect(dismissed[dismissed.length - 1]?.[0]).toEqual(['post-new', 'post-old'])
    w.unmount()
  })

  it('shows only the settings while nothing is switched on, and saves the choice', async () => {
    const w = mountPanel({ view: { status: 'off', categories: categories([]), items: [] } })
    expect(w.find('[data-news-settings]').exists()).toBe(true)
    expect(w.findAll('[data-news-section]')).toHaveLength(0)
    expect((w.find('[data-news-save]').element as HTMLButtonElement).disabled).toBe(true)

    await w.find('[data-news-category="release:platform"]').setValue(true)
    await w.find('[data-news-category="announcement"]').setValue(true)
    await w.find('[data-news-save]').trigger('click')
    await flushPromises()
    // In the order the categories are offered.
    expect(lastPost?.body).toEqual({ enabled: ['announcement', 'release:platform'] })
    expect(w.emitted('changed')).toHaveLength(1)
    w.unmount()
  })

  it('shows the reason when the settings are refused', async () => {
    postStatus = 403
    postBody = 'You are not an administrator of the team this deployment belongs to.'
    const w = mountPanel({ view: { status: 'off', categories: categories([]), items: [] } })
    await w.find('[data-news-category="video"]').setValue(true)
    await w.find('[data-news-save]').trigger('click')
    await flushPromises()
    expect(w.find('[data-news-save-error]').text()).toContain('not an administrator')
    expect(w.emitted('changed')).toBeUndefined()
    w.unmount()
  })

  it('asks for a sign-in when the tab holds no cloud credential', async () => {
    postStatus = 412
    const w = mountPanel({ view: { status: 'off', categories: categories([]), items: [] } })
    await w.find('[data-news-category="video"]').setValue(true)
    await w.find('[data-news-save]').trigger('click')
    await flushPromises()
    expect(w.emitted('sign-in-required')).toHaveLength(1)
    w.unmount()
  })

  it('says when the feed cannot be read, and when it is showing an earlier copy', () => {
    const down = mountPanel({ view: { status: 'unavailable', detail: 'could not reach it', categories: categories(['video']), items: [] } })
    expect(down.find('[data-news-unavailable]').text()).toContain('could not reach it')
    expect(down.findAll('[data-news-section]')).toHaveLength(0)
    down.unmount()

    const stale = mountPanel({ view: { ...okView(), stale: true, detail: 'an earlier copy' } })
    expect(stale.find('[data-news-stale]').text()).toContain('an earlier copy')
    expect(stale.findAll('[data-news-item]').length).toBeGreaterThan(0)
    stale.unmount()
  })
  describe('a long history', () => {
    // 25 platform releases, newest first, all read already, behind a section of 50 the daemon left out.
    const longView = (): NewsView => {
      const releases = Array.from({ length: 25 }, (_, n) => {
        const day = String(28 - n).padStart(2, '0')
        return item(`platform-1.${25 - n}.0`, 'release:platform', `2026-10-${day}`, { version: `1.${25 - n}.0` })
      })
      return {
        status: 'ok',
        categories: categories(['announcement', 'video', 'release:platform'], '2026-01-01'),
        items: [item('post-a', 'announcement', '2026-10-01'), ...releases],
        totals: { posts: 1, releases: 75 },
        archives: { posts: 'https://dether.net/blog', releases: 'https://dether.net/releases' },
      }
    }
    const allRead = (v: NewsView) => new Set(v.items.map((i) => i.id))
    const releaseRows = (w: ReturnType<typeof mountPanel>) => w.find('[data-news-section="releases"]').findAll('[data-news-item]')

    it('lists a page of items: the newest few as cards, the rest as one-line rows', () => {
      const v = longView()
      const w = mountPanel({ view: v, seen: allRead(v), active: false })
      const rows = releaseRows(w)
      expect(rows).toHaveLength(10)
      expect(rows.filter((r) => r.attributes('data-news-compact') === undefined)).toHaveLength(3)
      expect(rows[3].attributes('data-news-compact')).toBe('')
      w.unmount()
    })

    it('shows the next page on request', async () => {
      const v = longView()
      const w = mountPanel({ view: v, seen: allRead(v), active: false })
      expect(w.find('[data-news-more="releases"]').text()).toBe('Show 10 more')
      await w.find('[data-news-more="releases"]').trigger('click')
      expect(releaseRows(w)).toHaveLength(20)
      expect(w.find('[data-news-more="releases"]').text()).toBe('Show 5 more')
      await w.find('[data-news-more="releases"]').trigger('click')
      expect(releaseRows(w)).toHaveLength(25)
      expect(w.find('[data-news-more="releases"]').exists()).toBe(false)
      w.unmount()
    })

    it('never pages out an unread item, and shows it as a card', () => {
      const v = longView()
      const seen = allRead(v)
      seen.delete('platform-1.1.0') // the oldest release
      const w = mountPanel({ view: v, seen, active: false })
      const oldest = w.find('[data-news-item="platform-1.1.0"]')
      expect(oldest.exists()).toBe(true)
      expect(oldest.attributes('data-news-compact')).toBeUndefined()
      expect(oldest.find('[data-news-new]').exists()).toBe(true)
      w.unmount()
    })

    it('says how many items are only on the website, and links each archive', () => {
      const v = longView()
      const w = mountPanel({ view: v, seen: allRead(v), active: false })
      expect(w.find('[data-news-beyond="releases"]').text()).toContain('50 older items are only on the website')
      expect(w.find('[data-news-beyond="posts"]').exists()).toBe(false)
      const archive = w.find('[data-news-archive="releases"]')
      expect(archive.attributes('href')).toBe('https://dether.net/releases')
      expect(archive.attributes('rel')).toBe('noopener noreferrer')
      expect(w.find('[data-news-archive="posts"]').attributes('href')).toBe('https://dether.net/blog')
      w.unmount()
    })

    it('gives both sections a filter row, so their lists start level', () => {
      const v = longView()
      const w = mountPanel({ view: v, seen: allRead(v), active: false })
      // Posts has two categories on and gets chips; Releases has one and gets an empty row.
      expect(w.find('[data-news-section="posts"] [data-news-chip="video"]').exists()).toBe(true)
      expect(w.find('[data-news-section="releases"] [data-news-chip]').exists()).toBe(false)
      for (const s of w.findAll('[data-news-section]')) {
        expect(s.find('[role="group"]').exists()).toBe(true)
        expect(s.classes()).toContain('lg:grid-rows-subgrid')
      }
      w.unmount()
    })
  })
})
