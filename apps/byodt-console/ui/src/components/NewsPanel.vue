<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { api, ApiError, SessionExpired, type NewsCategory, type NewsGroup, type NewsItem, type NewsView } from '@/api'
import { isNew } from '@/news'
import Banner from '@/components/Banner.vue'

// The News tab: the project's blog posts and releases, from the website's feed, in two sections so an
// announcement is never pushed down the list by a run of point releases.
//
// App owns the feed and the read state, because the tab label carries the count of new items and has to
// show it on whichever tab is open. This panel reports what the operator has had in front of them ('seen')
// and App records it. An item read during this visit keeps its marker until the next load (`fresh`), so
// nothing disappears while it is being read.
//
// BUILT FOR A LONG HISTORY. Releases outnumber posts and keep coming, so each section shows a short list:
// full cards for what is new and for the newest few, one-line rows below them, "Show more" for the next
// page, and a link to the website's own archive, which keeps everything. An unread item is never paged out.
const props = defineProps<{
  view: NewsView | null
  loadError: string
  active: boolean // the News tab is the open one; nothing counts as seen behind another tab
  seen: Set<string>
  fresh: Set<string>
}>()

const emit = defineEmits<{
  (e: 'seen', ids: string[]): void
  (e: 'dismiss', ids: string[]): void
  (e: 'changed'): void
  (e: 'sign-in-required'): void
}>()

// How many items a section lists before "Show more", and how many of those are full cards. Unread items
// are listed, and shown as cards, whatever their position.
const PAGE = 10
const FULL_CARDS = 3

const GROUPS: { id: NewsGroup; title: string; archiveLabel: string; empty: string }[] = [
  { id: 'posts', title: 'Posts', archiveLabel: 'All posts on dether.net', empty: 'Nothing published yet in the post categories you follow.' },
  { id: 'releases', title: 'Releases', archiveLabel: 'All releases on dether.net', empty: 'Nothing released yet in the components you follow.' },
]

const categories = computed<NewsCategory[]>(() => props.view?.categories ?? [])
const enabled = computed(() => categories.value.filter((c) => c.enabled))
const labelOf = (key: string) => categories.value.find((c) => c.key === key)?.label ?? key
const groupsOn = computed(() => GROUPS.filter((g) => enabled.value.some((c) => c.group === g.id)))

const items = computed<NewsItem[]>(() => (props.view?.status === 'ok' ? props.view.items : []))
const inGroup = (g: NewsGroup) => items.value.filter((i) => i.group === g)

const marked = (i: NewsItem) => props.fresh.has(i.id) || isNew(i, categories.value, props.seen)
const unreadIds = (list: NewsItem[]) => list.filter((i) => isNew(i, categories.value, props.seen)).map((i) => i.id)
// A section's count is of the whole section, not of the chip it is narrowed to.
const newCount = (g: NewsGroup) => inGroup(g).filter(marked).length

// Each section can be narrowed to one category. A filter resets when its category is switched off.
const filter = ref<Record<NewsGroup, string>>({ posts: 'all', releases: 'all' })
const chips = (g: NewsGroup) => enabled.value.filter((c) => c.group === g)
watch(enabled, (on) => {
  for (const g of GROUPS) {
    const f = filter.value[g.id]
    if (f !== 'all' && !on.some((c) => c.key === f)) filter.value = { ...filter.value, [g.id]: 'all' }
  }
})
function setFilter(g: NewsGroup, key: string) {
  filter.value = { ...filter.value, [g]: key }
  shown.value = { ...shown.value, [g]: PAGE }
}
const filtered = (g: NewsGroup) => inGroup(g).filter((i) => filter.value[g] === 'all' || i.category === filter.value[g])

// Paging. What a section lists: the first `shown` items, and any marked item past them.
const shown = ref<Record<NewsGroup, number>>({ posts: PAGE, releases: PAGE })
const listed = (g: NewsGroup) => filtered(g).filter((i, idx) => idx < shown.value[g] || marked(i))
const hidden = (g: NewsGroup) => filtered(g).length - listed(g).length
function showMore(g: NewsGroup) {
  shown.value = { ...shown.value, [g]: shown.value[g] + PAGE }
}
// A full card for what is new and for the newest few; a one-line row for the rest.
const asCard = (i: NewsItem, idx: number) => idx < FULL_CARDS || marked(i)

// The daemon passes on the newest items only. When a section has more, say so beside the archive link.
const beyondConsole = (g: NewsGroup) => Math.max(0, (props.view?.totals?.[g] ?? 0) - inGroup(g).length)
const archiveOf = (g: NewsGroup) => props.view?.archives?.[g]

// A section's items count as seen once the section is on screen with the tab open. Where the browser has
// no IntersectionObserver, an open tab is taken as enough.
const onScreen = ref<Record<NewsGroup, boolean>>({ posts: false, releases: false })
const sectionEls: Partial<Record<NewsGroup, Element>> = {}
let observer: IntersectionObserver | undefined

function sectionRef(g: NewsGroup, el: Element | ComponentPublicInstance | null) {
  const node = el instanceof Element ? el : null
  const prev = sectionEls[g]
  if (prev === node) return
  if (prev && observer) observer.unobserve(prev)
  if (node) sectionEls[g] = node
  else delete sectionEls[g]
  if (node && observer) observer.observe(node)
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    onScreen.value = { posts: true, releases: true }
    return
  }
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const group = (e.target as HTMLElement).dataset.newsSection as NewsGroup | undefined
      if (group) onScreen.value = { ...onScreen.value, [group]: e.isIntersecting }
    }
  })
  for (const el of Object.values(sectionEls)) if (el) observer.observe(el)
})
onUnmounted(() => observer?.disconnect())

watch(
  () => {
    if (!props.active) return [] as string[]
    // All of a section's unread items, not just the chip's: the count beside the heading is of the whole
    // section, and an operator who has the section open has been shown that count.
    return GROUPS.filter((g) => onScreen.value[g.id]).flatMap((g) => unreadIds(inGroup(g.id)))
  },
  (ids) => {
    if (ids.length) emit('seen', ids)
  },
  { immediate: true },
)

function markAllRead(g: NewsGroup) {
  const ids = inGroup(g).map((i) => i.id)
  emit('seen', ids)
  emit('dismiss', ids)
}

function formatDate(d: string): string {
  const t = new Date(`${d}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return d
  return t.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}
const itemLabel = (i: NewsItem) => (i.version ? `${labelOf(i.category)} ${i.version}` : labelOf(i.category))

// The settings: which categories this deployment shows. Open on its own when nothing is switched on,
// because then it is the whole tab.
const settingsOpen = ref(false)
const showSettings = computed(() => settingsOpen.value || props.view?.status === 'off')
const draft = ref<Set<string>>(new Set())
watch(
  () => props.view?.categories,
  (cats) => {
    draft.value = new Set((cats ?? []).filter((c) => c.enabled).map((c) => c.key))
  },
  { immediate: true },
)
const dirty = computed(() => {
  const now = enabled.value.map((c) => c.key)
  return now.length !== draft.value.size || now.some((k) => !draft.value.has(k))
})
function toggle(key: string, on: boolean) {
  const next = new Set(draft.value)
  if (on) next.add(key)
  else next.delete(key)
  draft.value = next
}

const saving = ref(false)
const saveError = ref('')
async function save() {
  saving.value = true
  saveError.value = ''
  try {
    // In the order the categories are offered, so the request reads the way the form does.
    await api.setNewsCategories(categories.value.filter((c) => draft.value.has(c.key)).map((c) => c.key))
    settingsOpen.value = false
    emit('changed')
  } catch (e) {
    if (e instanceof SessionExpired) return
    // 412: this tab holds no cloud credential for the admin check — signing in again is the remedy.
    if (e instanceof ApiError && e.status === 412) {
      emit('sign-in-required')
      return
    }
    saveError.value = e instanceof ApiError ? e.detail || e.message : 'The console could not save the news settings.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4" data-news>
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-sm text-dt-text-muted">
        News from <span class="text-dt-text">dether.net</span>, read by this console's daemon. Nothing is fetched
        until a category is switched on.
      </p>
      <button
        v-if="view && view.status !== 'off'"
        type="button"
        class="ml-auto rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5"
        data-news-settings-toggle
        @click="settingsOpen = !settingsOpen"
      >
        {{ settingsOpen ? 'Close' : 'Choose what to show' }}
      </button>
    </div>

    <Banner v-if="loadError" tone="fault" title="Could not load news">{{ loadError }}</Banner>

    <!-- Settings -->
    <section v-if="view && showSettings" class="dt-card p-6 text-sm" data-news-settings>
      <h2 class="font-heading text-sm font-semibold text-dt-text">What this deployment shows</h2>
      <p class="mt-1 text-dt-text-muted">
        This applies to everyone who uses this console.<template v-if="view.status === 'off'">
          Nothing is switched on, so the console has not contacted the website.</template
        >
      </p>
      <div class="mt-4 grid gap-6 sm:grid-cols-2">
        <fieldset v-for="g in GROUPS" :key="g.id">
          <legend class="font-heading text-xs font-semibold uppercase tracking-wide text-dt-text-muted">{{ g.title }}</legend>
          <ul class="mt-2 space-y-1.5">
            <li v-for="c in categories.filter((c) => c.group === g.id)" :key="c.key">
              <label class="flex cursor-pointer items-center gap-2 text-dt-text">
                <input
                  type="checkbox"
                  :checked="draft.has(c.key)"
                  :disabled="saving"
                  :data-news-category="c.key"
                  @change="toggle(c.key, ($event.target as HTMLInputElement).checked)"
                />
                {{ c.label }}
              </label>
            </li>
          </ul>
        </fieldset>
      </div>
      <div class="mt-4 flex items-center gap-3">
        <button
          type="button"
          :disabled="saving || !dirty"
          class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
          data-news-save
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <p v-if="saveError" role="alert" class="text-sm text-dt-quinary" data-news-save-error>{{ saveError }}</p>
      </div>
    </section>

    <Banner v-if="view && (view.status === 'unavailable' || view.status === 'unsupported')" tone="warn" title="News is not available" data-news-unavailable>
      {{ view.detail }}
    </Banner>
    <Banner v-else-if="view?.stale" tone="info" title="Showing an earlier copy" data-news-stale>
      {{ view.detail }}
    </Banner>

    <!-- The two sections: side by side when there is room, posts first when stacked. Each is three rows —
         heading, filter, list — on one subgrid, so the two lists start at the same height even when only one
         section has a filter, or one filter wraps and the other does not. -->
    <div
      v-if="view && view.status === 'ok'"
      class="grid gap-y-8 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr] lg:gap-x-6 lg:gap-y-3"
    >
      <section
        v-for="g in groupsOn"
        :key="g.id"
        :ref="(el) => sectionRef(g.id, el)"
        :data-news-section="g.id"
        class="grid content-start gap-y-3 lg:row-span-3 lg:grid-rows-subgrid"
        :class="{ 'lg:col-span-2': groupsOn.length === 1 }"
      >
        <div class="flex items-center gap-2">
          <h2 class="font-heading text-sm font-semibold text-dt-text">{{ g.title }}</h2>
          <span
            v-if="newCount(g.id)"
            class="rounded-full bg-dt-accent/20 px-2 py-0.5 text-xs font-semibold text-dt-accent"
            :data-news-section-count="g.id"
          >{{ newCount(g.id) }} new</span>
          <button
            v-if="newCount(g.id)"
            type="button"
            class="ml-auto text-xs text-dt-text-muted hover:text-dt-text hover:underline"
            :data-news-mark-read="g.id"
            @click="markAllRead(g.id)"
          >
            Mark all as read
          </button>
        </div>

        <!-- Always rendered, empty when there is nothing to narrow, so the row exists on both sides. -->
        <div class="flex flex-wrap gap-1.5" role="group" :aria-label="`Filter ${g.title.toLowerCase()}`">
          <template v-if="chips(g.id).length > 1">
            <button
              v-for="c in [{ key: 'all', label: 'All' }, ...chips(g.id)]"
              :key="c.key"
              type="button"
              :aria-pressed="filter[g.id] === c.key"
              :data-news-chip="c.key"
              class="rounded-full border px-2.5 py-0.5 text-xs"
              :class="filter[g.id] === c.key ? 'border-dt-secondary text-dt-text' : 'border-dt-border text-dt-text-muted hover:text-dt-text'"
              @click="setFilter(g.id, c.key)"
            >
              {{ c.label }}
            </button>
          </template>
        </div>

        <div class="space-y-3">
          <ul v-if="listed(g.id).length" class="space-y-2">
            <li v-for="(i, idx) in listed(g.id)" :key="i.id" :data-news-item="i.id" :data-news-compact="asCard(i, idx) ? undefined : ''">
              <div v-if="asCard(i, idx)" class="dt-card p-4">
                <div class="flex flex-wrap items-center gap-2 text-xs text-dt-text-muted">
                  <span v-if="marked(i)" class="rounded-full bg-dt-accent/20 px-2 py-0.5 font-semibold uppercase tracking-wide text-dt-accent" data-news-new>New</span>
                  <time :datetime="i.date">{{ formatDate(i.date) }}</time>
                  <span class="rounded bg-white/5 px-1.5 py-0.5">{{ itemLabel(i) }}</span>
                  <span
                    v-if="i.newerThanDeployment"
                    class="rounded border border-dt-tertiary/60 px-1.5 py-0.5 text-dt-tertiary"
                    :title="view.deploymentVersion ? `This deployment runs ${view.deploymentVersion}.` : undefined"
                    data-news-newer
                  >Newer than this deployment</span>
                </div>
                <a :href="i.url" target="_blank" rel="noopener noreferrer" class="mt-1 block font-heading text-sm font-semibold text-dt-text hover:text-dt-accent">{{ i.title }} ↗</a>
                <p v-if="i.summary" class="mt-1 text-sm text-dt-text-muted">{{ i.summary }}</p>
              </div>
              <!-- Older items: one line, opened in place for the summary. -->
              <details v-else class="group rounded-lg border border-dt-border/60 px-3 py-2 text-sm hover:bg-white/5">
                <summary class="flex cursor-pointer list-none items-baseline gap-2">
                  <time :datetime="i.date" class="shrink-0 text-xs text-dt-text-muted">{{ formatDate(i.date) }}</time>
                  <span class="shrink-0 text-xs text-dt-text-muted">{{ itemLabel(i) }}</span>
                  <span class="truncate text-dt-text">{{ i.title }}</span>
                  <span
                    v-if="i.newerThanDeployment"
                    class="shrink-0 text-xs text-dt-tertiary"
                    data-news-newer
                  >newer</span>
                  <span class="ml-auto shrink-0 text-xs text-dt-text-muted group-open:rotate-90" aria-hidden="true">›</span>
                </summary>
                <p v-if="i.summary" class="mt-2 text-dt-text-muted">{{ i.summary }}</p>
                <a :href="i.url" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block text-xs text-dt-accent hover:underline">Read on dether.net ↗</a>
              </details>
            </li>
          </ul>
          <p v-else class="text-sm text-dt-text-muted">{{ g.empty }}</p>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dt-text-muted">
            <button
              v-if="hidden(g.id) > 0"
              type="button"
              class="rounded-lg border border-dt-border px-2.5 py-1 text-dt-text hover:border-dt-text-muted hover:bg-white/5"
              :data-news-more="g.id"
              @click="showMore(g.id)"
            >
              Show {{ Math.min(PAGE, hidden(g.id)) }} more
            </button>
            <span v-if="beyondConsole(g.id) > 0" :data-news-beyond="g.id">
              {{ beyondConsole(g.id) }} older {{ beyondConsole(g.id) === 1 ? 'item is' : 'items are' }} only on the website.
            </span>
            <a
              v-if="archiveOf(g.id)"
              :href="archiveOf(g.id)"
              target="_blank"
              rel="noopener noreferrer"
              class="text-dt-accent hover:underline"
              :data-news-archive="g.id"
            >{{ g.archiveLabel }} ↗</a>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
