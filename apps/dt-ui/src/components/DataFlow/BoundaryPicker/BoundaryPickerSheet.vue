<script setup lang="ts">
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import { buildBoundaryTree, flattenBoundaryTree, isAncestorBoundary, type FlatBoundaryRow } from '@/utils/boundaryTree'
  import { zonePill } from '@/utils/zoneColor'
  import BoundaryPeerPreview from './BoundaryPeerPreview.vue'
  import type { Conduit, ConduitDirection } from '@dethernety/dt-core'

  // Right-side peer picker for authoring approved channels (conduits), cloned from ClassPickerSheet.vue
  // (Teleport + end drawer + z-index 2500). Reads store getters only — no gql/apollo/dt-core value import.
  // It returns a selection; it does NOT persist (the tab buffers it; the parent Save commits it) and it
  // computes NO legality verdict (reserved until the analysis lattice lands).
  interface Props {
    modelValue: boolean
    currentBoundaryId: string
    // Already-buffered conduits — used to mark/lock the (peer, direction) pairs that already exist.
    existingConduits?: Conduit[]
  }
  const props = withDefaults(defineProps<Props>(), { existingConduits: () => [] })

  // One spec per CONDUIT to author. A bidirectional add emits a single `commit-request` carrying BOTH specs
  // so the parent appends them in one `patch` — emitting two events would race on the prop round-trip and
  // drop the first (the second handler reads a stale `props.zoning.conduits`).
  interface ConduitSpec {
    peerId: string
    peerName: string
    direction: ConduitDirection
    justification?: string
  }
  const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    'commit-request': [specs: ConduitSpec[]]
  }>()

  const flowStore = useFlowStore()

  // ── Responsive width (same tiers as ClassPickerSheet) ──
  function computeSheetWidth(viewportWidth: number): number {
    if (viewportWidth < 600) return viewportWidth
    if (viewportWidth < 960) return Math.min(viewportWidth * 0.9, 600)
    return Math.min(viewportWidth * 0.4, 480)
  }
  const computedWidth = ref<number>(typeof window !== 'undefined' ? computeSheetWidth(window.innerWidth) : 480)
  function onResize(): void {
    computedWidth.value = computeSheetWidth(window.innerWidth)
  }

  // ── Selection state ──
  const search = ref<string | null>('')
  // Add-only direction intent (checkbox pair, not a single radio): a peer can be approved outbound and/or
  // inbound in one pass. These hold the *additive* intent only — an already-existing direction is rendered
  // checked + disabled from `existsDir`, never from these refs (no delete-by-untick; deletion is the tab's ✕).
  const wantOut = ref<boolean>(true)
  const wantIn = ref<boolean>(false)
  const justification = ref<string>('')
  const highlightedId = ref<string | null>(null)

  // ── Rows ──
  const browseRows = computed<FlatBoundaryRow[]>(() =>
    flattenBoundaryTree(buildBoundaryTree(flowStore.allBoundaries(), flowStore.defaultBoundaryId ?? '')),
  )
  const trimmedSearch = computed(() => (search.value ?? '').trim().toLowerCase())
  const inSearchMode = computed(() => trimmedSearch.value.length > 0)
  // In search mode, drop the hierarchy and show a flat name-filtered list (depth 0).
  const searchRows = computed<FlatBoundaryRow[]>(() =>
    browseRows.value.filter(r => r.title.toLowerCase().includes(trimmedSearch.value)).map(r => ({ ...r, depth: 0 })),
  )
  const visibleRows = computed<FlatBoundaryRow[]>(() => (inSearchMode.value ? searchRows.value : browseRows.value))

  // ── Marking / gating ──
  // A peer is "already approved" for a given direction (no duplicate per (peer, direction)).
  const existsDir = (id: string, dir: ConduitDirection): boolean =>
    (props.existingConduits ?? []).some(c => c.peerId === id && c.direction === dir)
  // A peer is "marked" in the row list if it already has *either* direction approved.
  const isMarked = (id: string): boolean => existsDir(id, 'OUTBOUND') || existsDir(id, 'INBOUND')
  const pillOf = (id: string) => zonePill(flowStore.effectiveZone(id))
  const rowZoneWord = (id: string) => pillOf(id)?.word ?? ''
  const rowZoneColor = (id: string) => pillOf(id)?.color ?? 'grey'
  const rowZoneInherited = (id: string) => !!pillOf(id)?.inherited

  const highlightedName = computed(() => {
    if (!highlightedId.value) return ''
    return ((flowStore.boundaryById(highlightedId.value) as any)?.data?.label as string) || highlightedId.value
  })

  const isSelf = computed(() => highlightedId.value === props.currentBoundaryId)
  // Already-approved directions for the highlighted peer (checked + disabled in the UI).
  const existsOut = computed(() => !!highlightedId.value && existsDir(highlightedId.value, 'OUTBOUND'))
  const existsIn = computed(() => !!highlightedId.value && existsDir(highlightedId.value, 'INBOUND'))
  // The directions this Add would actually author: ticked AND not already approved.
  const newDirections = computed<ConduitDirection[]>(() => {
    const out: ConduitDirection[] = []
    if (wantOut.value && !existsOut.value) out.push('OUTBOUND')
    if (wantIn.value && !existsIn.value) out.push('INBOUND')
    return out
  })
  // Honest label: a single "Why" stamped onto two edges should say so (it is stored per-edge, identical text).
  const whyLabel = computed(() =>
    newDirections.value.length > 1 ? 'Why · applies to both directions (optional)' : 'Why (optional)',
  )
  const addDisabled = computed(() => !highlightedId.value || isSelf.value || newDirections.value.length === 0)
  const addDisabledReason = computed(() => {
    if (!highlightedId.value) return 'Pick a peer boundary first'
    if (isSelf.value) return "A boundary can't connect to itself"
    if (existsOut.value && existsIn.value) return 'Both directions already approved'
    return 'Tick a direction to add'
  })

  // ── (a) Nested-conduit warning (warn, never block) ──
  // A conduit whose peer sits on the current boundary's BELONGS_TO chain is structurally suspect.
  // We warn but keep self + duplicate as the only hard guards (UI warn-only — never blocks Add).
  const currentContainsPeer = computed(
    () => !!highlightedId.value && isAncestorBoundary(props.currentBoundaryId, highlightedId.value, flowStore.boundaryById),
  )
  const peerContainsCurrent = computed(
    () => !!highlightedId.value && isAncestorBoundary(highlightedId.value, props.currentBoundaryId, flowStore.boundaryById),
  )
  const isNestingPair = computed(() => currentContainsPeer.value || peerContainsCurrent.value)
  const sameEffectiveZone = computed(() => {
    if (!highlightedId.value) return false
    return flowStore.effectiveZone(props.currentBoundaryId).zone === flowStore.effectiveZone(highlightedId.value).zone
  })
  // Stronger when the pair resolves to the same zone (child inherits → the conduit is redundant with
  // containment) or the peer is an ancestor (child→parent back-edge); softer for a parent→child channel into
  // a genuinely different tier (a legitimate "controlled ingress", but the cleaner model gives it a peer source).
  const nestingWarning = computed<{ severity: 'warning' | 'info'; text: string } | null>(() => {
    if (!isNestingPair.value) return null
    // Name the specific condition that fired rather than the slash-joined pair, so the reason is unambiguous.
    if (peerContainsCurrent.value) {
      return {
        severity: 'warning',
        text: 'This peer is a containment ancestor (child → parent) — likely redundant with inheritance. Approve only if this boundary overrides to a different tier.',
      }
    }
    if (sameEffectiveZone.value) {
      return {
        severity: 'warning',
        text: 'This peer resolves to the same trust zone — likely redundant with inheritance. Approve only if the child overrides to a different tier.',
      }
    }
    return {
      severity: 'info',
      text: 'This peer is nested inside the current boundary. A parent→child channel models controlled ingress; consider modeling the ingress source as its own sibling boundary.',
    }
  })

  // ── Actions ──
  function onRowClick(id: string): void {
    if (id === props.currentBoundaryId) return // "this boundary" — disabled, no self-conduit
    highlightedId.value = id
    // Fresh peer → reset additive intent to the common default (outbound), so a single-direction add stays
    // one click. An already-approved direction shows checked+disabled regardless (from existsDir).
    wantOut.value = true
    wantIn.value = false
    justification.value = ''
  }

  function onAdd(): void {
    if (addDisabled.value || !highlightedId.value) return
    const why = justification.value.trim()
    // One spec per newly-ticked direction; the same shared "Why" is written onto each (stored per-edge).
    const specs: ConduitSpec[] = newDirections.value.map(dir => ({
      peerId: highlightedId.value as string,
      peerName: highlightedName.value,
      direction: dir,
      ...(why ? { justification: why } : {}),
    }))
    if (specs.length === 0) return
    emit('commit-request', specs)
    emit('update:modelValue', false)
  }

  function onCancel(): void {
    emit('update:modelValue', false)
  }

  // Focus-scoped Enter (replaces the old global magic-Enter that fired onAdd from anywhere): a deliberate
  // "search → Enter to add the highlighted peer", gated on the same `addDisabled` the button is. Enter on a
  // peer row selects it (native v-list-item activation); Enter on the Add button commits via its native click.
  function onSearchEnter(): void {
    if (!addDisabled.value) onAdd()
  }

  // Disabled-reason exposure for keyboard/SR users: a disabled v-btn is unreachable by hover/focus, so the
  // tooltip alone never reaches them. A visible, aria-live caption + aria-describedby surfaces the same reason.
  const addReasonId = 'boundary-picker-add-reason'

  // Reset on open (mirrors ClassPickerSheet) so a re-open never carries stale selection. Deliberately does
  // NOT autofocus the search field — the sibling ClassPickerSheet avoids autofocus on open for the same
  // reason: forcing focus during the drawer's open transition can bounce focus into the settings window's
  // class picker and pop its "Browse classes" sheet open alongside this one. Proper focus management (a focus
  // trap) is part of the deferred picker-a11y follow-up; Escape still closes via the document handler below.
  watch(
    () => props.modelValue,
    open => {
      if (!open) return
      search.value = ''
      wantOut.value = true
      wantIn.value = false
      justification.value = ''
      highlightedId.value = null
    },
    { immediate: true },
  )

  // Document-level Escape (same rationale + capture-phase guard as ClassPickerSheet): close the sheet
  // without also closing an enclosing dialog.
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
      if (isOpen) document.addEventListener('keydown', onDocumentKeydown, { capture: true })
      else document.removeEventListener('keydown', onDocumentKeydown, { capture: true })
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
  <Teleport to="body">
    <v-navigation-drawer
      :model-value="modelValue"
      class="boundary-picker-sheet"
      location="end"
      temporary
      :width="computedWidth"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <div class="sheet-root" role="dialog" aria-label="Add approved channel">
        <v-sheet class="sheet-header d-flex align-center justify-space-between px-4 py-2" color="primary">
          <div class="text-subtitle-1">Add approved channel</div>
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
            v-model="search"
            aria-label="Search boundaries"
            clearable
            density="compact"
            hide-details
            label="Search boundaries"
            prepend-inner-icon="mdi-magnify"
            @keydown.enter="onSearchEnter"
          />
        </div>

        <v-divider />

        <div class="sheet-results">
          <div v-if="visibleRows.length === 0" class="text-caption text-disabled px-4 py-4 empty-state">
            No boundaries match.
          </div>
          <v-list v-else class="py-0" density="compact">
            <v-list-item
              v-for="row in visibleRows"
              :key="row.id"
              :data-id="row.id"
              :active="highlightedId === row.id"
              :disabled="row.id === currentBoundaryId"
              class="peer-row"
              :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }"
              @click="onRowClick(row.id)"
            >
              <div class="d-flex align-center justify-space-between ga-2">
                <span class="peer-row-name text-truncate">{{ row.title }}</span>
                <span class="d-flex align-center ga-1 flex-shrink-0">
                  <v-chip v-if="row.id === currentBoundaryId" class="this-chip" size="x-small" variant="outlined">
                    this boundary
                  </v-chip>
                  <v-chip v-else-if="isMarked(row.id)" class="added-chip" color="success" size="x-small" variant="tonal">
                    Added
                  </v-chip>
                  <v-chip
                    v-if="rowZoneWord(row.id)"
                    class="zone-chip"
                    :color="rowZoneColor(row.id)"
                    size="x-small"
                    :variant="rowZoneInherited(row.id) ? 'outlined' : 'flat'"
                    :style="{ opacity: rowZoneInherited(row.id) ? 0.6 : 1 }"
                  >
                    {{ rowZoneWord(row.id) }}
                  </v-chip>
                </span>
              </div>
            </v-list-item>
          </v-list>
        </div>

        <v-divider />

        <div class="sheet-preview">
          <BoundaryPeerPreview :boundary-id="highlightedId" />
          <div class="px-4 pb-2">
            <!-- Add-only direction checkboxes: tick one or both to author a uni- or bi-directional channel in
                 one pass. An already-approved direction renders read-only (checked, muted, "Added") so it stays
                 in the tab order and is announced to assistive tech — it can't be un-ticked here (deletion is the
                 tab's ✕). -->
            <div class="direction-label text-caption text-medium-emphasis mt-1">Direction</div>
            <div class="d-flex align-center flex-wrap ga-2">
              <v-checkbox
                class="dir-checkbox dir-out"
                :class="{ 'dir-locked': existsOut }"
                :model-value="existsOut || wantOut"
                :readonly="existsOut"
                :aria-label="existsOut ? 'Outbound (this → peer) — already approved' : undefined"
                color="primary"
                density="compact"
                hide-details
                @update:model-value="wantOut = $event === true"
              >
                <template #label>
                  <span class="d-flex align-center ga-1">
                    Outbound (this → peer)
                    <v-chip v-if="existsOut" class="dir-added-chip" color="success" size="x-small" variant="tonal">
                      Added
                    </v-chip>
                  </span>
                </template>
              </v-checkbox>
              <v-checkbox
                class="dir-checkbox dir-in"
                :class="{ 'dir-locked': existsIn }"
                :model-value="existsIn || wantIn"
                :readonly="existsIn"
                :aria-label="existsIn ? 'Inbound (peer → this) — already approved' : undefined"
                color="primary"
                density="compact"
                hide-details
                @update:model-value="wantIn = $event === true"
              >
                <template #label>
                  <span class="d-flex align-center ga-1">
                    Inbound (peer → this)
                    <v-chip v-if="existsIn" class="dir-added-chip" color="success" size="x-small" variant="tonal">
                      Added
                    </v-chip>
                  </span>
                </template>
              </v-checkbox>
            </div>
            <!-- (a) Nested-conduit warning — informational only, never blocks Add. aria-live="polite" downgrades
                 v-alert's implicit assertive announcement: this is advisory, so a peer switch shouldn't interrupt
                 a screen reader. -->
            <v-alert
              v-if="nestingWarning"
              class="nesting-warning mt-1"
              :type="nestingWarning.severity"
              density="compact"
              variant="tonal"
              role="status"
              aria-live="polite"
            >
              {{ nestingWarning.text }}
            </v-alert>
            <v-text-field
              v-model="justification"
              class="mt-2"
              density="compact"
              hide-details
              :label="whyLabel"
              maxlength="500"
              placeholder="e.g. card-data flow to the payments store"
            />
          </div>
        </div>

        <v-divider />

        <div class="sheet-actions d-flex align-center justify-end px-4 py-2 ga-2">
          <!-- Disabled-reason surfaced to keyboard/SR users (the tooltip is mouse-hover-only and the disabled
               button is unfocusable). me-auto pushes it left; aria-live announces the reason as it changes. -->
          <div
            v-if="addDisabled"
            :id="addReasonId"
            class="add-reason me-auto text-caption text-medium-emphasis"
            role="status"
            aria-live="polite"
          >
            {{ addDisabledReason }}
          </div>
          <v-btn class="cancel-btn" variant="text" @click="onCancel">Cancel</v-btn>
          <v-tooltip :disabled="!addDisabled" location="top" :text="addDisabledReason">
            <template #activator="{ props: tipProps }">
              <span v-bind="tipProps">
                <v-btn
                  class="add-confirm-btn"
                  color="primary"
                  :disabled="addDisabled"
                  :aria-describedby="addDisabled ? addReasonId : undefined"
                  variant="flat"
                  @click="onAdd"
                >
                  Add channel
                </v-btn>
              </span>
            </template>
          </v-tooltip>
        </div>
      </div>
    </v-navigation-drawer>
  </Teleport>
</template>

<style scoped>
  /* !important needed: Vuetify v-navigation-drawer sets an inline z-index; 2500 clears v-dialog's stacked
     overlay range and floats this drawer above the open settings window (mirrors ClassPickerSheet). */
  .boundary-picker-sheet {
    z-index: 2500 !important;
  }
  /* An already-approved direction is read-only (kept in the tab order for AT) — mute it so it still reads as
     locked rather than an active choice. The "Added" chip carries the reason. */
  .dir-locked {
    opacity: 0.7;
  }
  .sheet-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .sheet-header,
  .sheet-search,
  .sheet-preview,
  .sheet-actions {
    flex: 0 0 auto;
  }
  .sheet-results {
    flex: 1 1 0;
    min-height: 120px;
    overflow-y: auto;
  }
  .sheet-preview {
    max-height: 42vh;
    overflow-y: auto;
  }
  .peer-row-name {
    min-width: 0;
  }
</style>
