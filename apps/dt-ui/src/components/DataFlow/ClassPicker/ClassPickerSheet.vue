<script setup lang="ts">
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import { useClassSuggestionsStore, type ClassCandidate } from '@/stores/classSuggestionsStore'
  import ClassPickerResults from './ClassPickerResults.vue'
  import ClassPreview from './ClassPreview.vue'
  import ClassPickerFacets from './ClassPickerFacets.vue'

  interface Props {
    modelValue: boolean
    classLabel: 'COMPONENT' | 'DATA_FLOW' | 'DATA' | 'SECURITY_BOUNDARY' | 'CONTROL'
    componentType?: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY' | null
    currentClassId?: string | null
    initialSearch?: string
    // Ids of classes already bound on the parent. Rows for these ids render an
    // "Added" chip — provenance signal during multi-pick sessions (Controls).
    // Default [] keeps single-bind consumers unaffected.
    boundClassIds?: readonly string[]
  }
  const props = withDefaults(defineProps<Props>(), {
    componentType: null,
    currentClassId: null,
    initialSearch: '',
    boundClassIds: () => [],
  })

  const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    'commit-request': [{ classId: string }]
  }>()

  const SEARCH_THRESHOLD = 2
  const PAGE_SIZE = 50
  const FACET_DEBOUNCE_MS = 200
  const NEAR_BOTTOM_THRESHOLD = 10

  const store = useClassSuggestionsStore()

  // Nullable: Vuetify's `clearable` button emits `null` (not '') when the
  // user clicks the X. A non-nullable ref would crash on `.trim()` below
  // and silently kill the search-transition watcher.
  const searchQuery = ref<string | null>(props.initialSearch)
  const selectedType = ref<string | null>(props.componentType ?? null)
  const selectedCategories = ref<string[]>([])
  const selectedModuleIds = ref<string[]>([])
  const itemsAccum = ref<ClassCandidate[]>([])
  const focusedIndex = ref<number | null>(null)
  let facetDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Responsive width — three tiers:
  //   • <600px (phone)    → full screen (100vw)
  //   • <960px (tablet)   → min(90vw, 600)
  //   • ≥960px (desktop)  → min(40vw, 480)  -- previous behaviour
  function computeSheetWidth(viewportWidth: number): number {
    if (viewportWidth < 600) return viewportWidth
    if (viewportWidth < 960) return Math.min(viewportWidth * 0.9, 600)
    return Math.min(viewportWidth * 0.4, 480)
  }
  const computedWidth = ref<number>(
    typeof window !== 'undefined' ? computeSheetWidth(window.innerWidth) : 480,
  )
  function onResize(): void {
    computedWidth.value = computeSheetWidth(window.innerWidth)
  }

  const trimmedSearch = computed(() => (searchQuery.value ?? '').trim())
  const inSearchMode = computed(() => trimmedSearch.value.length >= SEARCH_THRESHOLD)
  const stateKey = computed(() => `${props.classLabel}:${selectedType.value ?? '_'}`)

  const facetCounts = computed(() => {
    const listed = store.listResults.get(stateKey.value)
    return listed?.facetCounts ?? { categories: [], modules: [], types: [] }
  })
  const totalCount = computed(() => store.listResults.get(stateKey.value)?.totalCount ?? 0)

  // NOTE: search mode applies facet filters client-side over the top-N
  // matchClasses result, while browse mode passes facets server-side via
  // listClasses. This means a category/module facet in search mode may
  // narrow rows that the server didn't see — and may also "hide" results
  // that exist in the catalogue but didn't rank in the matchClasses
  // top-N. Acceptable for the v1 picker scale (10–500 classes); revisit
  // by extending matchClasses to accept categories/moduleIds if the
  // catalogue grows or users report missing-result confusion.
  const searchRows = computed<ClassCandidate[]>(() => {
    const raw = store.matchResults.get(stateKey.value) ?? []
    if (!selectedCategories.value.length && !selectedModuleIds.value.length) return [...raw]
    return raw.filter(c => {
      const catOk = selectedCategories.value.length === 0
        || (c.classCategory != null && selectedCategories.value.includes(c.classCategory))
      const modOk = selectedModuleIds.value.length === 0
        || (c.moduleId != null && selectedModuleIds.value.includes(c.moduleId))
      return catOk && modOk
    })
  })

  const currentRows = computed<ClassCandidate[]>(() =>
    inSearchMode.value ? searchRows.value : itemsAccum.value,
  )

  const focusedRow = computed<ClassCandidate | null>(() => {
    if (focusedIndex.value === null) return null
    return currentRows.value[focusedIndex.value] ?? null
  })

  const selectDisabled = computed(() =>
    focusedRow.value === null || focusedRow.value.classId === props.currentClassId,
  )
  const selectDisabledReason = computed(() => {
    if (focusedRow.value === null) return 'Choose a row first'
    if (focusedRow.value.classId === props.currentClassId) return 'This is already the current class'
    return ''
  })

  const isLoading = computed(() => {
    const browseLoading = Boolean(store.isLoading[`list:${stateKey.value}`])
    const searchLoading = Boolean(store.isLoading[`match:${stateKey.value}`])
    return inSearchMode.value ? searchLoading : browseLoading
  })

  // Mode-aware: search mode is driven by matchClasses, browse mode by
  // listClasses. Surface only the error from the op that drives the current
  // view — a background failure in the other op shouldn't render here.
  const hasError = computed(() =>
    Boolean(inSearchMode.value ? store.matchError : store.listError),
  )

  async function fetchBrowse(append: boolean): Promise<void> {
    const offset = append ? itemsAccum.value.length : 0
    if (!append) {
      itemsAccum.value = []
    }
    const componentTypeArg = props.classLabel === 'COMPONENT' && selectedType.value ? selectedType.value : undefined
    await store.listClasses({
      classLabel: props.classLabel,
      ...(componentTypeArg ? { componentType: componentTypeArg } : {}),
      ...(selectedCategories.value.length ? { categories: selectedCategories.value } : {}),
      ...(selectedModuleIds.value.length ? { moduleIds: selectedModuleIds.value } : {}),
      offset,
      limit: PAGE_SIZE,
    })
    const result = store.listResults.get(stateKey.value)
    const newItems = (result?.items ?? []) as ClassCandidate[]
    if (append) {
      itemsAccum.value = [...itemsAccum.value, ...newItems]
    } else {
      itemsAccum.value = [...newItems]
      focusedIndex.value = newItems.length > 0 ? 0 : null
    }
  }

  async function fetchSearch(): Promise<void> {
    const componentTypeArg = props.classLabel === 'COMPONENT' && selectedType.value ? selectedType.value : undefined
    await store.matchClasses({
      elements: [{ name: trimmedSearch.value, description: '' }],
      classLabel: props.classLabel,
      ...(componentTypeArg ? { componentType: componentTypeArg } : {}),
      topN: 25,
      fields: ['description', 'category', 'type'],
    })
    const raw = store.matchResults.get(stateKey.value) ?? []
    const allHigh = raw.length > 0
      && raw.every(c => c.matchType === 'exact_name' || c.matchType === 'fuzzy_name')
    focusedIndex.value = allHigh ? 0 : null
  }

  async function refreshFacetCounts(): Promise<void> {
    // Refresh the listClasses aggregation so chip counts stay coherent in search mode.
    // We deliberately omit `search` — counts reflect the catalogue-wide pool under
    // the active facet selection, not narrowed by the search text.
    const componentTypeArg = props.classLabel === 'COMPONENT' && selectedType.value ? selectedType.value : undefined
    await store.listClasses({
      classLabel: props.classLabel,
      ...(componentTypeArg ? { componentType: componentTypeArg } : {}),
      ...(selectedCategories.value.length ? { categories: selectedCategories.value } : {}),
      ...(selectedModuleIds.value.length ? { moduleIds: selectedModuleIds.value } : {}),
      offset: 0,
      limit: PAGE_SIZE,
    })
  }

  function scheduleRefetch(): void {
    if (facetDebounceTimer) clearTimeout(facetDebounceTimer)
    facetDebounceTimer = setTimeout(() => {
      if (inSearchMode.value) {
        refreshFacetCounts()
        fetchSearch()
      } else {
        fetchBrowse(false)
      }
    }, FACET_DEBOUNCE_MS)
  }

  function onScrollEnd(visibleEnd: number): void {
    if (inSearchMode.value) return
    if (isLoading.value) return
    const remaining = itemsAccum.value.length - visibleEnd
    if (remaining > NEAR_BOTTOM_THRESHOLD) return
    if (totalCount.value <= itemsAccum.value.length) return
    fetchBrowse(true)
  }

  function onRowClick(row: ClassCandidate): void {
    const idx = currentRows.value.findIndex(r => r.classId === row.classId)
    focusedIndex.value = idx >= 0 ? idx : null
  }

  function onRowDblclick(row: ClassCandidate): void {
    // Mirror the Select button's guard — don't recommit the current class.
    if (row.classId === props.currentClassId) return
    emit('commit-request', { classId: row.classId })
  }

  function onSelect(): void {
    if (selectDisabled.value || !focusedRow.value) return
    emit('commit-request', { classId: focusedRow.value.classId })
  }

  function onCancel(): void {
    emit('update:modelValue', false)
  }

  function onKeydown(e: KeyboardEvent): void {
    const len = currentRows.value.length
    if (e.key === 'Escape') {
      e.preventDefault()
      emit('update:modelValue', false)
      return
    }
    if (len === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? 0 : (focusedIndex.value + 1) % len
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? len - 1 : (focusedIndex.value - 1 + len) % len
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onSelect()
    }
  }

  function retry(): void {
    if (inSearchMode.value) fetchSearch()
    else fetchBrowse(false)
  }

  // Open: initial fetch
  watch(
    () => props.modelValue,
    open => {
      if (!open) return
      searchQuery.value = props.initialSearch
      selectedType.value = props.componentType ?? null
      selectedCategories.value = []
      selectedModuleIds.value = []
      itemsAccum.value = []
      focusedIndex.value = null
      if (inSearchMode.value) {
        refreshFacetCounts()
        fetchSearch()
      } else {
        fetchBrowse(false)
      }
    },
    { immediate: true },
  )

  // Search transitions
  watch(trimmedSearch, () => {
    if (!props.modelValue) return
    if (facetDebounceTimer) clearTimeout(facetDebounceTimer)
    facetDebounceTimer = setTimeout(() => {
      if (inSearchMode.value) {
        // Ensure facet counts reflect current selection without search text.
        refreshFacetCounts()
        fetchSearch()
      } else {
        fetchBrowse(false)
      }
    }, FACET_DEBOUNCE_MS)
  })

  // Facet changes
  watch(
    () => [selectedType.value, [...selectedCategories.value], [...selectedModuleIds.value]],
    () => {
      if (!props.modelValue) return
      scheduleRefetch()
    },
    { deep: true },
  )

  // Clamp focusedIndex into valid range whenever the visible row count changes
  // (e.g. user toggles a facet that shrinks the search-mode post-filter result).
  watch(
    () => currentRows.value.length,
    len => {
      if (focusedIndex.value === null) return
      if (len === 0) focusedIndex.value = null
      else if (focusedIndex.value >= len) focusedIndex.value = len - 1
    },
  )

  // Document-level Escape handler. The .sheet-root @keydown only fires when
  // a child has focus, but the sheet doesn't autofocus anything on open —
  // so in production the on-element handler never sees the keypress. Attach
  // a document listener while open; tear it down on close to keep the global
  // surface minimal.
  //
  // Capture phase + stopPropagation: when the sheet is rendered inside a
  // v-dialog (DataDialog, ControlDialog), the dialog also listens for Esc
  // to close itself. Without stopping the event here, both close in one
  // keypress. Capture ensures this handler runs first regardless of which
  // listener was registered later; stopPropagation prevents the dialog from
  // seeing the same keystroke.
  function onDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      emit('update:modelValue', false)
    }
  }

  watch(
    () => props.modelValue,
    isOpen => {
      if (isOpen) {
        document.addEventListener('keydown', onDocumentKeydown, { capture: true })
      } else {
        document.removeEventListener('keydown', onDocumentKeydown, { capture: true })
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    window.addEventListener('resize', onResize)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('keydown', onDocumentKeydown, { capture: true })
    if (facetDebounceTimer) clearTimeout(facetDebounceTimer)
  })

  function categorySubtitle(row: ClassCandidate): string {
    return [row.classCategory, row.moduleName].filter(Boolean).join(' · ')
  }
</script>

<template>
  <Teleport to="body">
  <v-navigation-drawer
    :model-value="modelValue"
    class="class-picker-sheet"
    location="end"
    temporary
    :width="computedWidth"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="sheet-root" role="dialog" aria-label="Browse classes" @keydown="onKeydown">
      <v-sheet class="sheet-header d-flex align-center justify-space-between px-4 py-2" color="primary">
        <div class="text-subtitle-1">Browse classes</div>
        <v-btn
          class="close-btn"
          color="foreground"
          aria-label="Close"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="onCancel"
        />
      </v-sheet>

      <div class="sheet-search px-4 pb-2 mt-1">
        <v-text-field
          v-model="searchQuery"
          aria-label="Search classes"
          clearable
          density="compact"
          hide-details
          label="Search"
          prepend-inner-icon="mdi-magnify"
        />
      </div>

      <v-divider />

      <div class="sheet-facets px-4 py-2">
        <ClassPickerFacets
          :class-label="classLabel"
          :facet-counts="facetCounts"
          :selected-categories="selectedCategories"
          :selected-module-ids="selectedModuleIds"
          @update:selected-categories="selectedCategories = $event"
          @update:selected-module-ids="selectedModuleIds = $event"
        />
      </div>

      <v-divider />

      <div class="sheet-results-header d-flex align-center justify-space-between px-4 py-1">
        <span class="text-caption text-disabled">
          Results ({{ currentRows.length }}<span v-if="!inSearchMode && totalCount > currentRows.length"> of {{ totalCount }}</span>)
        </span>
        <span class="text-caption text-disabled mode-pill">
          {{ inSearchMode ? 'Ranked by relevance' : 'Browsing catalogue' }}
        </span>
      </div>

      <div class="sheet-results">
        <template v-if="isLoading && currentRows.length === 0">
          <v-skeleton-loader v-for="i in 6" :key="`sk-${i}`" type="list-item" />
        </template>
        <template v-else-if="hasError">
          <v-list-item class="error-row">
            <v-list-item-title class="text-disabled">Couldn't load classes.</v-list-item-title>
            <template #append>
              <v-btn class="retry-btn" size="small" variant="text" @click="retry">Retry</v-btn>
            </template>
          </v-list-item>
        </template>
        <template v-else-if="inSearchMode">
          <ClassPickerResults
            :bound-class-ids="boundClassIds"
            :candidates="currentRows"
            @select="onRowClick"
            @confirm="onRowDblclick"
          />
        </template>
        <template v-else-if="currentRows.length === 0">
          <div class="text-caption text-disabled px-4 py-4 empty-state">No classes match the current filters.</div>
        </template>
        <template v-else>
          <v-virtual-scroll
            :items="currentRows"
            height="100%"
            :item-height="56"
            @update:end="onScrollEnd"
          >
            <template #default="{ item, index }">
              <v-list-item
                :key="item.classId"
                :class="['browse-row', { 'v-list-item--active': focusedIndex === index }]"
                @click="onRowClick(item)"
                @dblclick="onRowDblclick(item)"
              >
                <v-list-item-title>
                  {{ item.className }}
                  <v-chip
                    v-if="boundClassIds.includes(item.classId)"
                    class="ml-2 added-chip"
                    color="success"
                    size="x-small"
                    variant="tonal"
                  >Added</v-chip>
                </v-list-item-title>
                <v-list-item-subtitle v-if="item.classCategory || item.moduleName">
                  {{ categorySubtitle(item) }}
                </v-list-item-subtitle>
              </v-list-item>
            </template>
          </v-virtual-scroll>
        </template>
      </div>

      <v-divider />

      <div class="sheet-preview">
        <ClassPreview :class-item="focusedRow" />
      </div>

      <v-divider />

      <div class="sheet-actions d-flex justify-end px-4 py-2 ga-2">
        <span
          v-if="boundClassIds.length > 0"
          class="multi-bind-hint text-caption text-medium-emphasis mr-auto align-self-center"
        >
          Adding multiple — use Cancel when done.
        </span>
        <v-btn class="cancel-btn" variant="text" @click="onCancel">Cancel</v-btn>
        <v-tooltip
          :disabled="!selectDisabled"
          location="top"
          :text="selectDisabledReason"
        >
          <template #activator="{ props: tipProps }">
            <span v-bind="tipProps">
              <v-btn
                class="select-btn"
                color="primary"
                :disabled="selectDisabled"
                variant="flat"
                @click="onSelect"
              >Select</v-btn>
            </span>
          </template>
        </v-tooltip>
      </div>
    </div>
  </v-navigation-drawer>
  </Teleport>
</template>

<style scoped>
  /* !important needed: Vuetify v-navigation-drawer sets an inline z-index on
     its root that would otherwise win by specificity. The bumped value also
     clears v-dialog's stacked overlay range (typical Vuetify dialogs sit in
     the ~2000–2400 band when opened from app-level state). */
  .class-picker-sheet {
    z-index: 2500 !important;
  }
  .sheet-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .sheet-header,
  .sheet-search,
  .sheet-facets,
  .sheet-results-header,
  .sheet-preview,
  .sheet-actions {
    flex: 0 0 auto;
  }
  .sheet-facets {
    max-height: 30vh;
    overflow-y: auto;
  }
  .sheet-results {
    flex: 1 1 0;
    min-height: 120px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .sheet-results :deep(.v-virtual-scroll) {
    flex: 1 1 0;
    min-height: 0;
  }
  .sheet-preview {
    max-height: 28vh;
    overflow-y: auto;
  }
  .mode-pill {
    font-style: italic;
  }
</style>
