<script setup lang="ts">
  import { ref, computed, toRef, watch, nextTick, onBeforeUnmount } from 'vue'
  import { useTechniqueSuggestionsStore, type CatalogEntry } from '@/stores/techniqueSuggestionsStore'
  import { useRecentTechniques, type TechniqueRecord } from '@/composables/useRecentTechniques'
  import TechniquePickerResults from './TechniquePickerResults.vue'
  import type { MitreKind, MitreCandidate, VectorDisabledReason } from '@dethernety/dt-core'

  /**
   * Typeahead input + dropdown for the MITRE picker.
   *
   * Tier-1 (synchronous, hydrated catalog): EXACT_ID / PREFIX_ID / NAME match.
   * Tier-2 (server-side, debounced): VECTOR_SIMILARITY when no local EXACT_ID
   * AND query.length >= 4 AND 300ms debounce.
   *
   * AbortController-per-keystroke is implicit via dt-core's
   * `withCancellableLatest` — rapid vector-tier-eligible keystrokes supersede
   * each other.
   */

  interface Props {
    kind: MitreKind
    selectedMitreIds: readonly string[]
    modelId: string | undefined
    disabled?: boolean
    label?: string
  }
  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
  })

  const emit = defineEmits<{
    'commit-request': [{ mitreId: string; name?: string; tactic?: string | null }]
    'picker:focus': []
    'picker:blur': []
    'picker:sheet-open': [{ search: string }]
  }>()

  const store = useTechniqueSuggestionsStore()
  const { recent } = useRecentTechniques(toRef(props, 'modelId'), toRef(props, 'kind'))

  const FOOTER_SENTINEL = Symbol('browse-all-footer')
  type FocusableItem = MitreCandidate | TechniqueRecord | CatalogEntry | typeof FOOTER_SENTINEL

  const rootEl = ref<HTMLElement | null>(null)
  const searchQuery = ref<string | null>('')
  const menuOpen = ref(false)
  // Local-tier results (synchronous catalog scan).
  const localResults = ref<CatalogEntry[]>([])
  // Vector-tier results (server response).
  const vectorResults = ref<MitreCandidate[]>([])
  const focusedIndex = ref<number | null>(null)
  const clickInsideMenu = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  // Vector-tier eligibility: query length >= 4 AND no local EXACT_ID match.
  const vectorEligible = computed(() => {
    const q = (searchQuery.value || '').trim()
    if (q.length < 4) return false
    const hasExactId = localResults.value.some(r => r.mitreId.toLowerCase() === q.toLowerCase())
    return !hasExactId
  })

  const queryKey = computed(() => `${props.kind}:${searchQuery.value ?? ''}`)
  const vectorLoadingKey = computed(() => `match:${queryKey.value}`)
  const isVectorLoading = computed(() => Boolean(store.isLoading[vectorLoadingKey.value]))
  const hasError = computed(() => Boolean(store.matchError))

  // Vector-disabled caption variants — kind-specific copy adapted below.
  const vectorDisabledCaption = computed<string | null>(() => {
    if (store.vectorAvailable !== false) return null
    const reason = store.vectorDisabledReason as VectorDisabledReason | null
    switch (reason) {
      case 'EMBEDDING_DISABLED':
        return 'Semantic search is disabled on this deployment — showing name-based matches.'
      case 'NO_INDEX_MODULE':
        return 'Semantic search is unavailable on this deployment — showing name-based matches.'
      case 'NO_VECTORS':
        return 'Semantic search unavailable — MITRE vectors not yet installed. Update the mitre-frameworks module to enable.'
      case 'MODEL_MISMATCH':
        return 'Semantic search unavailable — module ships vectors for a different embedding model. Rebuild the module against your runtime model to enable.'
      default:
        return null
    }
  })

  // Kind-aware empty-state copy.
  const emptyHint = computed<string>(() => {
    switch (props.kind) {
      case 'ATTACK_TECHNIQUE':
        return "Type a technique ID like T1003, browse all, or describe what you're looking for."
      case 'DEFEND_TECHNIQUE':
        return "Type a technique ID like D3-PMAD, browse all, or describe what you're looking for."
      case 'ATTACK_MITIGATION':
        return 'Type a mitigation ID like M1041, browse all, or describe what you need.'
      default:
        return ''
    }
  })

  // Kind-aware no-match copy.
  const noMatchHint = computed<string>(() => {
    return props.kind === 'ATTACK_MITIGATION'
      ? 'No matches. Try a partial ID, fewer characters, or browse all mitigations.'
      : 'No matches. Try a partial ID, fewer characters, or browse all techniques.'
  })

  // Local-tier scan over the hydrated catalog.
  function scanLocalCatalog(query: string): CatalogEntry[] {
    const entries = store.catalog.get(props.kind) ?? []
    if (!entries.length) return []
    const q = query.toLowerCase()
    const exact: CatalogEntry[] = []
    const prefix: CatalogEntry[] = []
    const nameMatch: CatalogEntry[] = []
    const descMatch: CatalogEntry[] = []
    for (const e of entries) {
      const id = e.mitreId.toLowerCase()
      if (id === q) exact.push(e)
      else if (id.startsWith(q)) prefix.push(e)
      else if (e.name.toLowerCase().includes(q)) nameMatch.push(e)
      else if ((e.description ?? '').toLowerCase().includes(q)) descMatch.push(e)
    }
    return [...exact, ...prefix, ...nameMatch, ...descMatch].slice(0, 12)
  }

  // Dedup vector results against local results: same mitreId → only
  // the local-tier row renders.
  const mergedVectorResults = computed<MitreCandidate[]>(() => {
    const localIds = new Set(localResults.value.map(e => e.mitreId))
    return vectorResults.value.filter(c => !localIds.has(c.mitreId))
  })

  const flattened = computed<FocusableItem[]>(() => {
    const items: FocusableItem[] = []
    if (!searchQuery.value) {
      // No input → recents (when modelId scoped).
      items.push(...recent.value)
    } else {
      items.push(...localResults.value)
      items.push(...mergedVectorResults.value)
    }
    items.push(FOOTER_SENTINEL)
    return items
  })

  const isFooterFocused = computed(() => {
    if (focusedIndex.value === null) return false
    return flattened.value[focusedIndex.value] === FOOTER_SENTINEL
  })

  // aria-activedescendant target for the focused row (listbox semantics).
  const activeDescendantId = computed<string | undefined>(() =>
    focusedIndex.value === null ? undefined : `tp-opt-${focusedIndex.value}`,
  )

  // Per-query candidate budget. Typed-input flow uses the backend default
  // (3) — short user-typed queries are usually sharp and top-3 suffices.
  // The seedSearch path widens to 10 because description-seeded queries
  // are diffuse: embedding-model ranking can bury the genuinely relevant
  // technique well below rank 3 when the description leads with surface
  // vocabulary (e.g. an MTA-STS exposure surfaces certificate-handling
  // techniques in slots 1-3 while AiTM/T1557.001 only appears at rank 8).
  const SEED_TOP_N = 10

  async function fetchVectorTier(query: string, topN?: number): Promise<void> {
    if (!vectorEligible.value) {
      vectorResults.value = []
      return
    }
    await store.matchTechniques({ kind: props.kind, query, topN })
    // Ignore a stale response: the query changed while this fetch was in flight, so its
    // (older) cached row must not clobber the newer query's results.
    if (query !== (searchQuery.value || '').trim()) return
    vectorResults.value = [...(store.matchResults.get(`${props.kind}:${query}`) ?? [])]
  }

  watch(searchQuery, () => {
    const q = (searchQuery.value || '').trim()
    // Local tier runs synchronously — instant feedback for ID/prefix/name.
    localResults.value = q ? scanLocalCatalog(q) : []
    // Clear stale vector rows on ANY query change so the previous query's results don't
    // render against the new local tier during the debounce; the fetch below repopulates
    // (isVectorLoading, keyed on the live query, covers the gap).
    vectorResults.value = []
    // Vector tier debounced.
    if (debounceTimer) clearTimeout(debounceTimer)
    if (q) {
      debounceTimer = setTimeout(() => {
        fetchVectorTier(q)
      }, 300)
    }
  })

  function onFocus(): void {
    emit('picker:focus')
    menuOpen.value = true
    // Hydrate catalog lazily on first focus (idempotent — store no-ops if ready).
    void store.hydrateCatalog(props.kind)
  }

  function onBlur(): void {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      if (!clickInsideMenu.value) {
        menuOpen.value = false
        emit('picker:blur')
      }
      clickInsideMenu.value = false
    }, 150)
  }

  function onMenuMousedown(): void {
    clickInsideMenu.value = true
  }

  function onSelectCandidate(item: CatalogEntry | MitreCandidate | TechniqueRecord): void {
    emit('commit-request', { mitreId: item.mitreId, name: item.name, tactic: item.tactic ?? null })
    searchQuery.value = ''
    localResults.value = []
    vectorResults.value = []
    focusedIndex.value = null
    menuOpen.value = false
  }

  function onFooterActivate(): void {
    emit('picker:sheet-open', { search: searchQuery.value ?? '' })
    menuOpen.value = false
  }

  function onKeydown(e: KeyboardEvent): void {
    const len = flattened.value.length
    if (!menuOpen.value || len === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? 0 : (focusedIndex.value + 1) % len
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? len - 1 : (focusedIndex.value - 1 + len) % len
    } else if (e.key === 'Enter' && focusedIndex.value !== null) {
      e.preventDefault()
      const item = flattened.value[focusedIndex.value]
      if (item === FOOTER_SENTINEL) {
        onFooterActivate()
      } else {
        onSelectCandidate(item as CatalogEntry | MitreCandidate | TechniqueRecord)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      menuOpen.value = false
    }
  }

  function retry(): void {
    const q = (searchQuery.value || '').trim()
    if (q) fetchVectorTier(q)
  }

  // Imperative seed entry point used by the host dialogs' "Suggest matches"
  // link. Reuses the existing local + vector tiers; the only divergence from
  // typed input is bypassing the watcher's 300ms debounce so the user's
  // explicit click is instant, and forcing idempotent re-clicks to re-fetch
  // (Vue's watcher would otherwise no-op on identical re-assignment).
  async function seedSearch(text: string): Promise<void> {
    if (props.disabled) return
    const q = (text || '').trim()
    if (!q) return
    searchQuery.value = q
    menuOpen.value = true
    await store.hydrateCatalog(props.kind)
    vectorResults.value = []
    // nextTick lets the searchQuery watcher schedule its own debounceTimer
    // first; we then cancel it and call fetchVectorTier directly so there's
    // a single fetch on a single click.
    await nextTick()
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    await fetchVectorTier(q, SEED_TOP_N)
  }

  // fetchVectorTier/vectorResults/searchQuery are exposed as a test seam for the
  // stale-write-back guard regression test (TechniquePickerInline.test.ts).
  defineExpose({ seedSearch, fetchVectorTier, vectorResults, searchQuery })

  onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (blurTimer) clearTimeout(blurTimer)
  })
</script>

<template>
  <div ref="rootEl" class="technique-picker-inline">
    <v-text-field
      v-model="searchQuery"
      density="compact"
      :disabled="disabled"
      hide-details
      :label="label"
      placeholder="Type an ID, name, or describe what you're looking for"
      prepend-inner-icon="mdi-magnify"
      clearable
      role="combobox"
      aria-haspopup="listbox"
      aria-controls="technique-picker-listbox"
      :aria-expanded="menuOpen"
      :aria-activedescendant="activeDescendantId"
      @blur="onBlur"
      @focus="onFocus"
      @keydown="onKeydown"
    />
    <v-menu
      v-model="menuOpen"
      :close-on-content-click="false"
      location="bottom start"
      :target="rootEl ?? undefined"
    >
      <v-list
        id="technique-picker-listbox"
        role="listbox"
        class="technique-picker-menu"
        density="compact"
        @mousedown="onMenuMousedown"
      >
        <template v-if="hasError">
          <v-list-item class="error-row">
            <v-list-item-title class="text-disabled">Couldn't load suggestions.</v-list-item-title>
            <template #append>
              <v-btn size="small" variant="text" @click="retry">Retry</v-btn>
            </template>
          </v-list-item>
        </template>
        <template v-else>
          <template v-if="!searchQuery">
            <template v-if="recent.length">
              <div class="text-caption text-disabled px-4 py-2">Recently used in this model</div>
              <v-list-item
                v-for="(rec, idx) in recent"
                :id="`tp-opt-${idx}`"
                :key="rec.mitreId"
                role="option"
                :aria-selected="focusedIndex === idx"
                :class="{ 'v-list-item--active': focusedIndex === idx }"
                @click="onSelectCandidate(rec)"
              >
                <template #prepend>
                  <span class="font-monospace text-caption mr-3">{{ rec.mitreId }}</span>
                </template>
                <v-list-item-title>{{ rec.name }}</v-list-item-title>
              </v-list-item>
            </template>
            <div v-else class="text-caption text-disabled px-4 py-2">{{ emptyHint }}</div>
          </template>
          <template v-else>
            <!-- Local-tier results (synchronous catalog scan). -->
            <TechniquePickerResults
              v-if="localResults.length"
              :candidates="localResults as unknown as MitreCandidate[]"
              :kind="kind"
              :bound-mitre-ids="selectedMitreIds"
              :empty-hint="noMatchHint"
              option-id-prefix="tp-opt"
              :option-start-index="0"
              :active-option-index="focusedIndex"
              description-tooltip
              @select="onSelectCandidate"
            />

            <!-- Vector-tier results (server-side semantic match). -->
            <template v-if="mergedVectorResults.length || isVectorLoading">
              <div class="text-caption text-disabled px-4 py-2">Related techniques</div>
              <v-list-item v-if="isVectorLoading" class="loading-row">
                <v-skeleton-loader type="text" />
              </v-list-item>
              <TechniquePickerResults
                v-else
                :candidates="mergedVectorResults"
                :kind="kind"
                :bound-mitre-ids="selectedMitreIds"
                :empty-hint="''"
                option-id-prefix="tp-opt"
                :option-start-index="localResults.length"
                :active-option-index="focusedIndex"
                description-tooltip
                @select="onSelectCandidate"
              />
            </template>

            <!-- No local + no vector + not loading → no-match copy. -->
            <div
              v-if="!localResults.length && !mergedVectorResults.length && !isVectorLoading"
              class="text-caption text-disabled px-4 py-2"
            >
              {{ noMatchHint }}
            </div>
          </template>
        </template>

        <!-- Vector-disabled caption (4 reasons → 4 copy strings). -->
        <div
          v-if="vectorDisabledCaption"
          class="text-caption text-disabled px-4 py-2 vector-disabled-caption"
        >
          {{ vectorDisabledCaption }}
        </div>

        <v-divider />
        <v-list-item
          :id="`tp-opt-${flattened.length - 1}`"
          class="browse-all-footer"
          role="option"
          :aria-selected="isFooterFocused"
          :class="{ 'v-list-item--active': isFooterFocused }"
          @click="onFooterActivate"
        >
          <template #prepend>
            <v-icon icon="mdi-format-list-bulleted" size="small" />
          </template>
          <v-list-item-title>Browse all →</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
  .technique-picker-inline {
    width: 100%;
  }
  .technique-picker-menu {
    min-width: 480px;
    max-width: 640px;
    max-height: 420px;
    overflow-y: auto;
  }
</style>
