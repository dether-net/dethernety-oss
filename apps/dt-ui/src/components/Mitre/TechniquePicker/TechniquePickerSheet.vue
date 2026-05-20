<script setup lang="ts">
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import { useTechniqueSuggestionsStore, type CatalogEntry } from '@/stores/techniqueSuggestionsStore'
  import TechniquePickerResults from './TechniquePickerResults.vue'
  import TechniquePickerFacets from './TechniquePickerFacets.vue'
  import TechniquePreview from './TechniquePreview.vue'
  import type { MitreKind, MitreCandidate } from '@dethernety/dt-core'

  /**
   * "Browse all" drawer for the MITRE picker. Visually mirrors
   * ClassPickerSheet: colored header bar, separated search / facets /
   * results-header / results / preview / actions sections, responsive
   * width, skeleton loading state, and the multi-bind "use Cancel when
   * done" hint when items have already been added.
   *
   * MITRE catalogues are bounded, so filtering is client-side:
   *   - ATT&CK techniques: ~700 nodes
   *   - D3FEND techniques: ~270 nodes
   *   - ATT&CK mitigations: ~45 nodes
   *
   * Interaction model (mirrors ClassPickerSheet):
   *   - single click on row → focus (updates preview pane)
   *   - double click on row → commit the focused row
   *   - Select button → commit the currently-focused row
   *   - Cancel / X / Escape / scrim click → close
   *
   * Commits do NOT close the drawer — parent dedup makes repeat commits on
   * the same row a no-op, so the user picks one or more items and dismisses
   * explicitly.
   */

  interface Props {
    modelValue: boolean
    kind: MitreKind
    initialSearch?: string
    selectedMitreIds: readonly string[]
  }
  const props = withDefaults(defineProps<Props>(), {
    initialSearch: '',
  })

  const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    'commit-request': [{ mitreId: string; name?: string; tactic?: string | null }]
  }>()

  const store = useTechniqueSuggestionsStore()

  const searchQuery = ref<string | null>(props.initialSearch)
  const selectedTactics = ref<string[]>([])
  const focusedRow = ref<CatalogEntry | null>(null)

  // Responsive width — mirrors ClassPickerSheet:
  //   • <600px (phone)    → full screen (100vw)
  //   • <960px (tablet)   → min(90vw, 600)
  //   • ≥960px (desktop)  → min(40vw, 480)
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

  const sheetTitle = computed(() => {
    if (props.kind === 'ATTACK_MITIGATION') return 'Browse mitigations'
    if (props.kind === 'DEFEND_TECHNIQUE') return 'Browse defenses'
    return 'Browse techniques'
  })

  const searchAriaLabel = computed(() => {
    if (props.kind === 'ATTACK_MITIGATION') return 'Search mitigations'
    if (props.kind === 'DEFEND_TECHNIQUE') return 'Search defenses'
    return 'Search techniques'
  })

  const emptyHint = computed(() => {
    if (props.kind === 'ATTACK_MITIGATION') return 'No mitigations match the current filters.'
    if (props.kind === 'DEFEND_TECHNIQUE') return 'No defenses match the current filters.'
    return 'No techniques match the current filters.'
  })

  // Static killchain ordering — used to sort the derived tactic facets so
  // the chip rendering stays in canonical MITRE order even though the
  // facet list itself is data-driven.
  const ATTACK_TACTICS_ORDER = [
    'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
    'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
    'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
    'Exfiltration', 'Impact',
  ]
  const DEFEND_TACTICS_ORDER = ['Model', 'Harden', 'Detect', 'Isolate', 'Deceive', 'Evict', 'Restore']

  const tacticsOrder = computed<readonly string[]>(() => {
    if (props.kind === 'ATTACK_TECHNIQUE') return ATTACK_TACTICS_ORDER
    if (props.kind === 'DEFEND_TECHNIQUE') return DEFEND_TACTICS_ORDER
    return []
  })

  watch(() => props.initialSearch, val => {
    searchQuery.value = val
  })

  watch(() => props.modelValue, open => {
    if (open) {
      void store.hydrateCatalog(props.kind)
      selectedTactics.value = []
      focusedRow.value = null
    }
  })

  const allEntries = computed<readonly CatalogEntry[]>(() => store.catalog.get(props.kind) ?? [])
  const isCatalogReady = computed<boolean>(() => Boolean(store.isCatalogReady[props.kind]))
  const isCatalogLoading = computed<boolean>(() => Boolean(store.isLoading[`catalog:${props.kind}`]))

  const trimmedSearch = computed(() => (searchQuery.value ?? '').trim())

  const filteredEntries = computed<CatalogEntry[]>(() => {
    let items: CatalogEntry[] = [...allEntries.value]
    const q = trimmedSearch.value.toLowerCase()
    if (q) {
      items = items.filter(
        e =>
          e.mitreId.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q),
      )
    }
    if (selectedTactics.value.length) {
      items = items.filter(e => e.tactic && selectedTactics.value.includes(e.tactic))
    }
    return items.slice(0, 500)
  })

  // Mirrors ClassPickerFacets behaviour: tactics are derived from the
  // currently-filtered entry set, so once a tactic is selected the
  // unselected chips disappear (same drill-down UX as category chips).
  // Sorted into killchain order.
  const tacticFacets = computed(() => {
    if (tacticsOrder.value.length === 0) return []
    const counts = new Map<string, number>()
    for (const e of filteredEntries.value) {
      if (e.tactic) counts.set(e.tactic, (counts.get(e.tactic) ?? 0) + 1)
    }
    return tacticsOrder.value
      .filter(t => counts.has(t))
      .map(t => ({ value: t, count: counts.get(t)! }))
  })

  // CatalogEntry → MitreCandidate cast for the Results component. The component
  // only reads {mitreId, name, description, tactic, kind, matchType?, similarityScore?}
  // — the cast is safe since CatalogEntry is a subset.
  const filteredAsCandidates = computed<MitreCandidate[]>(() =>
    filteredEntries.value.map(e => ({
      mitreId: e.mitreId,
      name: e.name,
      description: e.description,
      tactic: e.tactic,
      kind: e.kind,
      matchType: 'NAME_MATCH',
      similarityScore: null,
    })),
  )

  const hasActiveFilter = computed<boolean>(() =>
    trimmedSearch.value.length > 0 || selectedTactics.value.length > 0,
  )

  function findEntry(mitreId: string): CatalogEntry | null {
    return filteredEntries.value.find(e => e.mitreId === mitreId) ?? null
  }

  function onRowFocus(candidate: MitreCandidate): void {
    focusedRow.value = findEntry(candidate.mitreId)
  }

  function onRowConfirm(candidate: MitreCandidate): void {
    commit(candidate.mitreId, candidate.name, candidate.tactic)
  }

  function onSelect(): void {
    if (!focusedRow.value) return
    commit(focusedRow.value.mitreId, focusedRow.value.name, focusedRow.value.tactic)
  }

  function commit(mitreId: string, name?: string, tactic?: string | null): void {
    emit('commit-request', { mitreId, name, tactic })
  }

  function onCloseDrawer(): void {
    emit('update:modelValue', false)
  }

  const selectDisabled = computed(() => !focusedRow.value)

  // Document-level Escape — closes the drawer regardless of focus. Capture
  // phase + stopPropagation so a host v-dialog (ExposureDialog /
  // CounterMeasureDialog) doesn't also consume the same keystroke.
  function onDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && props.modelValue) {
      e.preventDefault()
      e.stopPropagation()
      onCloseDrawer()
    }
  }

  watch(
    () => props.modelValue,
    open => {
      if (open) {
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
  })
</script>

<template>
  <!--
    Teleport to body so the drawer escapes the host dialog's stacking context
    (ExposureDialog / CounterMeasureDialog), matching the ClassPickerSheet pattern.
    Without this, Vuetify nests the drawer inside the v-dialog overlay and
    clips it to the dialog bounds.
  -->
  <Teleport to="body">
    <v-navigation-drawer
      :model-value="modelValue"
      class="technique-picker-sheet"
      location="end"
      temporary
      :width="computedWidth"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <div class="sheet-root" role="dialog" :aria-label="sheetTitle">
        <v-sheet
          class="sheet-header d-flex align-center justify-space-between px-4 py-2"
          color="primary"
        >
          <div class="text-subtitle-1">{{ sheetTitle }}</div>
          <v-btn
            class="close-btn"
            color="foreground"
            aria-label="Close"
            icon="mdi-close"
            size="small"
            variant="text"
            @click="onCloseDrawer"
          />
        </v-sheet>

        <div class="sheet-search px-4 pb-2 mt-1">
          <v-text-field
            v-model="searchQuery"
            :aria-label="searchAriaLabel"
            clearable
            density="compact"
            hide-details
            label="Search"
            placeholder="ID, name, or description"
            prepend-inner-icon="mdi-magnify"
          />
        </div>

        <template v-if="tacticFacets.length > 0">
          <v-divider />
          <div class="sheet-facets px-4 py-2">
            <TechniquePickerFacets
              :facets="tacticFacets"
              :selected="selectedTactics"
              @update:selected="selectedTactics = $event"
            />
          </div>
        </template>

        <v-divider />

        <div class="sheet-results-header d-flex align-center justify-space-between px-4 py-1">
          <span class="text-caption text-disabled">
            Results ({{ filteredEntries.length }}<span v-if="filteredEntries.length < allEntries.length"> of {{ allEntries.length }}</span>)
          </span>
          <span class="text-caption text-disabled mode-pill">
            {{ hasActiveFilter ? 'Filtered' : 'Browsing catalogue' }}
          </span>
        </div>

        <div class="sheet-results">
          <template v-if="isCatalogLoading && !isCatalogReady">
            <v-skeleton-loader v-for="i in 6" :key="`sk-${i}`" type="list-item" />
          </template>
          <template v-else>
            <TechniquePickerResults
              :candidates="filteredAsCandidates"
              :kind="kind"
              :bound-mitre-ids="selectedMitreIds"
              :empty-hint="emptyHint"
              @select="onRowFocus"
              @confirm="onRowConfirm"
            />
          </template>
        </div>

        <v-divider />

        <div class="sheet-preview">
          <TechniquePreview :item="focusedRow" :kind="kind" />
        </div>

        <v-divider />

        <div class="sheet-actions d-flex justify-end px-4 py-2 ga-2">
          <span
            v-if="selectedMitreIds.length > 0"
            class="multi-bind-hint text-caption text-medium-emphasis mr-auto align-self-center"
          >
            Adding multiple — use Cancel when done.
          </span>
          <v-btn class="cancel-btn" variant="text" @click="onCloseDrawer">Cancel</v-btn>
          <v-tooltip
            :disabled="!selectDisabled"
            location="top"
            text="Select a row from the list above"
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
     the ~2000–2400 band when opened from app-level state). Mirrors
     ClassPickerSheet.vue. */
  .technique-picker-sheet {
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
  /* TechniquePickerResults renders a plain v-list (no virtual-scroll), so the
     sheet-level container needs overflow-y: auto to scroll long lists.
     ClassPickerSheet uses v-virtual-scroll in browse mode which scrolls
     internally; we don't need the equivalent here at the ≤700-row catalogue
     scale. */
  .sheet-results {
    flex: 1 1 0;
    min-height: 120px;
    overflow-y: auto;
  }
  .sheet-preview {
    max-height: 28vh;
    overflow-y: auto;
  }
  .mode-pill {
    font-style: italic;
  }
</style>
