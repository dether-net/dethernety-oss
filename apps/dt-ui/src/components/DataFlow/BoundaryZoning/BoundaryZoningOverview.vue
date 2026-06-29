<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import {
    ZONE_LABEL,
    ZONE_PILL_WORD,
    ZONE_SELECT_ITEMS,
    ROLE_LABEL,
    planesToRole,
  } from '@/utils/zoneColor'
  import { buildBoundaryTree, type BoundaryTreeNode } from '@/utils/boundaryTree'
  import type { Zone } from '@dethernety/dt-core'
  import type { EffectiveZone } from '@/utils/effectiveZone'

  // Model-level bulk companion to the per-boundary Zoning tab: list every boundary with its
  // RESOLVED zone (declared vs inherited vs default), inline-edit one zone, or set a zone on many at once.
  // Frontend-only — store getters/actions only, no gql. Immediate-persist (the tab stays the buffered surface).
  const props = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()

  const open = computed({
    get: () => props.modelValue,
    set: (v: boolean) => emit('update:modelValue', v),
  })

  const flowStore = useFlowStore()

  interface Row {
    id: string
    name: string
    declared: Zone | null
    ez: EffectiveZone
    role: string
    channels: number
  }

  const rows = computed<Row[]>(() =>
    flowStore.allBoundaries().map((b: any) => ({
      id: b.id,
      name: (b.data?.label as string) || b.id,
      declared: (b.data?.zone as Zone | null) ?? null,
      ez: flowStore.effectiveZone(b.id),
      role: ROLE_LABEL[planesToRole(b.data?.planes)],
      channels: Array.isArray(b.data?.conduits) ? b.data.conduits.length : 0,
    })),
  )

  const unclassifiedCount = computed(() => rows.value.filter(r => r.ez.source === 'default').length)
  const rowById = computed(() => new Map(rows.value.map(r => [r.id, r])))

  const onlyUnclassified = ref(false)
  const visibleRows = computed<Row[]>(() =>
    onlyUnclassified.value ? rows.value.filter(r => r.ez.source === 'default') : rows.value,
  )

  // ── Nesting tree — the overview grouped by parent/child containment, so the inheritance blast radius is
  // spatial. Presentation only: the same `rows`/`effectiveZone`/write path drives it. ──
  type TreeRow = Row & { depth: number; hasChildren: boolean; unclassifiedDescendants: number }

  const forest = computed<BoundaryTreeNode[]>(() =>
    buildBoundaryTree(flowStore.allBoundaries(), flowStore.defaultBoundaryId ?? ''),
  )

  // Per node: count of DESCENDANTS (excluding self) that resolve to `default` (unclassified). Drives the
  // collapsed-parent roll-up badge and the smart initial expansion.
  const unclassifiedDescendants = computed<Map<string, number>>(() => {
    const map = new Map<string, number>()
    const isUnclassified = (id: string) => rowById.value.get(id)?.ez.source === 'default'
    // Returns the count of unclassified nodes in this subtree INCLUDING self.
    const walk = (node: BoundaryTreeNode): number => {
      let desc = 0
      for (const c of node.children) desc += walk(c)
      map.set(node.id, desc)
      return (isUnclassified(node.id) ? 1 : 0) + desc
    }
    forest.value.forEach(walk)
    return map
  })

  // ── Expand/collapse state ──
  const expanded = ref<Set<string>>(new Set())
  const toggle = (id: string) => {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
  }
  const expandAll = () => {
    const next = new Set<string>()
    const walk = (n: BoundaryTreeNode) => {
      if (n.children.length) {
        next.add(n.id)
        n.children.forEach(walk)
      }
    }
    forest.value.forEach(walk)
    expanded.value = next
  }
  const collapseAll = () => {
    expanded.value = new Set()
  }

  // Constraint C — default-EXPANDED via smart initial expansion: on open, expand every branch that contains an
  // unclassified descendant (keeps every unclassified row's ancestor chain visible) and fold fully-classified
  // branches. Re-applied each open — a fresh triage session.
  watch(
    () => props.modelValue,
    isOpen => {
      if (!isOpen) return
      const next = new Set<string>()
      for (const [id, n] of unclassifiedDescendants.value) if (n > 0) next.add(id)
      expanded.value = next
    },
    { immediate: true },
  )

  // Pre-order walk → the visible tree rows (recurse into a node's children only while it's expanded).
  const treeRows = computed<TreeRow[]>(() => {
    const out: TreeRow[] = []
    const counts = unclassifiedDescendants.value
    const walk = (node: BoundaryTreeNode, depth: number) => {
      const base = rowById.value.get(node.id)
      if (!base) return
      out.push({ ...base, depth, hasChildren: node.children.length > 0, unclassifiedDescendants: counts.get(node.id) ?? 0 })
      if (node.children.length && expanded.value.has(node.id)) {
        for (const c of node.children) walk(c, depth + 1)
      }
    }
    forest.value.forEach(n => walk(n, 0))
    return out
  })

  // Constraint A — "show only unclassified" flattens to the proven flat list (today's `visibleRows` path,
  // verbatim); otherwise render the nesting tree.
  const displayRows = computed<TreeRow[]>(() =>
    onlyUnclassified.value
      ? visibleRows.value.map(r => ({ ...r, depth: 0, hasChildren: false, unclassifiedDescendants: 0 }))
      : treeRows.value,
  )

  // Tree order is THE order — no column sorting would scramble the nesting (supersedes the sortable-zone nit).
  const headers = [
    { title: 'Boundary', key: 'name', sortable: false },
    { title: 'Trust zone', key: 'zone', sortable: false, width: 280 },
    { title: 'Role', key: 'role', sortable: false },
    { title: 'Channels', key: 'channels', sortable: false, width: 90 },
  ]

  const selectedIds = ref<string[]>([])

  // Selection is independent of expansion — a selected row can be collapsed out of view. Surface that in the
  // bulk button so an immediate-persist write to off-screen boundaries is never opaque (don't silently prune
  // the selection — that's its own surprise).
  const visibleIds = computed(() => new Set(displayRows.value.map(r => r.id)))
  const hiddenSelectedCount = computed(() => selectedIds.value.filter(id => !visibleIds.value.has(id)).length)
  const bulkBtnLabel = computed(() => {
    const hidden = hiddenSelectedCount.value
    return `Set zone for ${selectedIds.value.length} selected${hidden ? ` (${hidden} hidden by collapse)` : ''}`
  })

  // Twisty label folds in the roll-up so a collapsed parent announces that detail is hidden (a11y).
  const twistyLabel = (item: TreeRow): string => {
    const action = expanded.value.has(item.id) ? 'Collapse' : 'Expand'
    const rollup = !expanded.value.has(item.id) && item.unclassifiedDescendants
      ? `, ${item.unclassifiedDescendants} unclassified inside`
      : ''
    return `${action} ${item.name}${rollup}`
  }

  // Resolution caption under each row's inline select (the declared/inherited/default distinction).
  const sourceCaption = (ez: EffectiveZone): string =>
    ez.source === 'declared'
      ? 'Declared'
      : ez.source === 'inherited'
        ? `Inherited from ${(flowStore.boundaryById(ez.from || '') as any)?.data?.label || 'a parent'}`
        : `Unset → default ${ZONE_PILL_WORD.INTERNAL}`

  const isRowSaving = (id: string) => flowStore.isOperationLoading('updateBoundary-' + id)

  const snackbar = ref<{ show: boolean; text: string; color: string; undo: boolean }>(
    { show: false, text: '', color: 'success', undo: false },
  )
  const notify = (text: string, color = 'success', undo = false) => {
    snackbar.value = { show: true, text, color, undo }
  }

  // ── Writes — immediate persist via the existing per-boundary save path. The tab stays the buffered
  // surface; here a select change / bulk action commits at once. `updateNode` never rejects: on a failed
  // save it re-pins the row to prior server truth and returns false, so call sites just check the boolean. ──
  const writeZone = (id: string, zone: Zone | null): Promise<boolean> =>
    flowStore.updateNode({ nodeId: id, updates: { data: { zone } } })

  const onSetZone = async (id: string, zone: Zone | null) => {
    if (!(await writeZone(id, zone))) notify('Failed to set zone', 'error')
  }

  // Bulk set + one-click Undo. Immediate-persist has no buffer, so Undo is the safety net for a misclick or
  // a mid-bulk failure; `prevZones` remembers each boundary's declared zone before the batch.
  const bulkBusy = ref(false)
  const bulkProgress = ref('')
  let prevZones: { id: string; zone: Zone | null }[] = []

  // Sequential: clean progress + no optimistic-merge interleaving (different ids are collision-free via the
  // per-id dedup key, so correctness holds either way — this is the UX choice). `writeZone` returns false on
  // failure (it never rejects), so one failure never aborts the rest; `finally` always releases the busy flag.
  const runBatch = async (writes: { id: string; zone: Zone | null }[]): Promise<{ done: number; failed: number }> => {
    let done = 0
    let failed = 0
    try {
      for (const w of writes) {
        if (await writeZone(w.id, w.zone)) done++
        else failed++
        bulkProgress.value = `Setting zone… ${done + failed}/${writes.length}`
      }
    } finally {
      bulkBusy.value = false
      bulkProgress.value = ''
    }
    return { done, failed }
  }

  const bulkSetZone = async (zone: Zone | null) => {
    const ids = [...selectedIds.value]
    if (!ids.length || bulkBusy.value) return
    const byId = new Map(rows.value.map(r => [r.id, r.declared]))
    prevZones = ids.map(id => ({ id, zone: byId.get(id) ?? null }))
    bulkBusy.value = true
    const { done, failed } = await runBatch(ids.map(id => ({ id, zone })))
    const label = zone === null ? 'cleared (inherit)' : ZONE_LABEL[zone]
    if (failed) {
      // Keep the selection so the user can retry the failed subset rather than losing it.
      notify(`Set ${done}/${ids.length} — ${failed} failed; selection kept`, 'warning')
    } else {
      notify(`Zone ${label} set on ${done} boundar${done === 1 ? 'y' : 'ies'}`, 'success', true)
      selectedIds.value = []
    }
  }

  const undoBulk = async () => {
    if (!prevZones.length || bulkBusy.value) return
    const batch = prevZones
    prevZones = []
    snackbar.value = { ...snackbar.value, show: false }
    bulkBusy.value = true
    const { failed } = await runBatch(batch)
    notify(failed ? `Revert incomplete — ${failed} failed` : 'Reverted', failed ? 'warning' : 'info')
  }

  const onClose = () => emit('update:modelValue', false)
</script>

<template>
  <v-dialog
    v-model="open"
    class="rounded-lg"
    height="85vh"
    width="90vw"
    aria-labelledby="zoning-overview-title"
    @click:outside="onClose"
    @keydown.esc="onClose"
  >
    <v-card class="overflow-hidden pa-0 ma-0 rounded-lg boundary-zoning-overview">
      <v-card-title class="pa-0">
        <v-sheet
          class="pa-2 ma-0 d-flex flex-row justify-space-between align-center"
          color="primary"
          variant="plain"
        >
          <div class="d-flex align-center">
            <v-icon class="mr-2" color="tertiary" icon="mdi-shield-lock-outline" size="small" />
            <span id="zoning-overview-title" class="text-body-1">Zoning overview</span>
          </div>
          <v-btn color="foreground" icon="mdi-close" size="medium" variant="text" @click="onClose" />
        </v-sheet>
      </v-card-title>

      <v-card-text class="pa-4">
        <v-data-table
          class="zoning-table"
          density="comfortable"
          :headers="headers"
          item-value="id"
          :items="displayRows"
          :items-per-page="-1"
          :model-value="selectedIds"
          show-select
          @update:model-value="selectedIds = $event"
        >
          <!-- Toolbar: closure nudge + filter (left), bulk set-zone (right). -->
          <template #top>
            <div class="d-flex align-center mb-3 ga-3 flex-wrap">
              <v-chip
                :color="unclassifiedCount ? 'warning' : 'success'"
                size="small"
                variant="tonal"
                class="unclassified-chip"
              >
                {{ unclassifiedCount }} unclassified
              </v-chip>
              <v-switch
                v-model="onlyUnclassified"
                class="only-unclassified-switch"
                color="warning"
                density="compact"
                hide-details
                label="Show only unclassified"
              />
              <!-- Tree mode only: fold/unfold every branch at once (constraint C, for large models). -->
              <div v-if="!onlyUnclassified" class="d-flex align-center ga-1 expand-controls">
                <v-btn
                  class="expand-all-btn"
                  prepend-icon="mdi-unfold-more-horizontal"
                  size="small"
                  variant="text"
                  @click="expandAll"
                >
                  Expand all
                </v-btn>
                <v-btn
                  class="collapse-all-btn"
                  prepend-icon="mdi-unfold-less-horizontal"
                  size="small"
                  variant="text"
                  @click="collapseAll"
                >
                  Collapse all
                </v-btn>
              </div>
              <v-spacer />
              <v-menu v-if="selectedIds.length">
                <template #activator="{ props: menuProps }">
                  <v-btn
                    v-bind="menuProps"
                    class="bulk-set-btn"
                    color="primary"
                    :loading="bulkBusy"
                    prepend-icon="mdi-shield-edit-outline"
                    variant="flat"
                  >
                    {{ bulkBtnLabel }}
                  </v-btn>
                </template>
                <v-list density="compact" class="bulk-zone-menu">
                  <template v-for="item in ZONE_SELECT_ITEMS" :key="item.title">
                    <v-list-subheader v-if="item.type === 'subheader'">{{ item.title }}</v-list-subheader>
                    <v-list-item
                      v-else
                      :subtitle="item.subtitle"
                      :title="item.title"
                      @click="bulkSetZone(item.value as Zone)"
                    />
                  </template>
                  <v-divider />
                  <v-list-item
                    class="bulk-clear-item"
                    subtitle="Fall back to the inherited / default zone"
                    title="Clear (inherit)"
                    @click="bulkSetZone(null)"
                  />
                </v-list>
              </v-menu>
            </div>
          </template>

          <!-- Trust-zone cell: inline editor (declared) + resolution caption. -->
          <template #item.zone="{ item }">
            <div class="zone-cell py-1">
              <v-select
                class="zone-cell-select"
                :class="{ 'zone-ghosted': item.declared == null }"
                :aria-label="`Trust zone for ${item.name}`"
                clearable
                density="compact"
                :disabled="bulkBusy"
                hide-details
                :items="ZONE_SELECT_ITEMS"
                item-title="title"
                item-value="value"
                :loading="isRowSaving(item.id)"
                :model-value="item.declared"
                :placeholder="item.declared == null ? ZONE_LABEL[item.ez.zone] : undefined"
                :persistent-placeholder="item.declared == null"
                @update:model-value="onSetZone(item.id, $event)"
              >
                <template #item="{ props: itemProps, item: zi }">
                  <v-list-subheader v-if="zi.raw.type === 'subheader'">{{ zi.raw.title }}</v-list-subheader>
                  <v-list-item v-else v-bind="itemProps" :subtitle="zi.raw.subtitle" />
                </template>
              </v-select>
              <span
                class="zone-source-caption text-caption"
                :class="item.ez.source === 'declared' ? 'text-medium-emphasis' : 'text-disabled'"
              >
                {{ sourceCaption(item.ez) }}
              </span>
            </div>
          </template>

          <!-- Role chip. -->
          <template #item.role="{ item }">
            <v-chip size="x-small" variant="tonal">{{ item.role }}</v-chip>
          </template>

          <!-- Name cell — the ONLY indented column (checkbox + zone/role/channels stay on a straight edge).
               Twisty for a parent; a collapsed parent surfaces a roll-up "⚠ N unclassified" text badge so a
               fold never loses the worklist (constraint A). Unclassified rows are highlighted. The WHOLE cell
               toggles a parent (bigger click target); the twisty `.stop`s so it doesn't double-fire. -->
          <template #item.name="{ item }">
            <div
              class="name-cell d-flex align-center"
              :class="{ 'name-cell--expandable': item.hasChildren }"
              :style="{ paddingLeft: item.depth * 20 + 'px' }"
              @click="item.hasChildren && toggle(item.id)"
            >
              <!-- No own @click: the click (mouse or keyboard Enter/Space → native click) bubbles to the
                   cell's @click, so the twisty toggles exactly once and stays the explicit AT affordance. -->
              <v-btn
                v-if="item.hasChildren"
                class="twisty-btn"
                :icon="expanded.has(item.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                size="x-small"
                variant="text"
                density="comfortable"
                :aria-label="twistyLabel(item)"
                :aria-expanded="expanded.has(item.id)"
              />
              <span v-else class="twisty-spacer" />
              <span
                class="boundary-name"
                :class="{ 'unclassified-name': item.ez.source === 'default' }"
                :title="item.name"
              >
                {{ item.name }}
              </span>
              <v-chip
                v-if="!expanded.has(item.id) && item.unclassifiedDescendants"
                class="rollup-unclassified ml-2"
                color="warning"
                prepend-icon="mdi-alert"
                size="x-small"
                variant="tonal"
              >
                {{ item.unclassifiedDescendants }} unclassified
              </v-chip>
            </div>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <!-- Live progress while a bulk run is in flight (single persistent snackbar, not one per item). -->
    <v-snackbar :model-value="bulkBusy" color="info" location="bottom" :timeout="-1">
      {{ bulkProgress }}
    </v-snackbar>

    <!-- Result toast — carries an Undo on a successful bulk (the safety net for immediate-persist). -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="bottom" :timeout="snackbar.undo ? 6000 : 2500">
      {{ snackbar.text }}
      <template v-if="snackbar.undo" #actions>
        <v-btn class="undo-btn" variant="text" @click="undoBulk">Undo</v-btn>
      </template>
    </v-snackbar>
  </v-dialog>
</template>

<style scoped>
  .zone-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .zone-cell-select {
    max-width: 260px;
  }
  .zone-ghosted :deep(input::placeholder) {
    font-style: italic;
    opacity: 0.7;
  }
  .zone-source-caption {
    line-height: 1.1;
  }
  .unclassified-name {
    font-weight: 600;
    color: rgb(var(--v-theme-warning));
  }
  /* Keep leaf names aligned with their twisty-bearing siblings (chevron x-small ≈ 24px wide). */
  .twisty-spacer {
    display: inline-block;
    width: 24px;
    flex: 0 0 24px;
  }
  .boundary-name {
    min-width: 0;
  }
  /* The whole name cell toggles a parent — signal it (the twisty stays the explicit affordance for AT). */
  .name-cell--expandable {
    cursor: pointer;
  }
</style>
