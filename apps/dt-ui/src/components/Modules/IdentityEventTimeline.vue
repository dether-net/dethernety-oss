<script setup lang="ts">
  import { useClassIdentityStore, type EventKindFilter } from '@/stores/classIdentityStore'
  import { useModulesStore } from '@/stores/modulesStore'
  import { formatRelative } from '@/utils/relativeTime'
  import type { ClassIdentityEvent } from '@dethernety/dt-core'

  const props = defineProps<{ pollingEnabled: boolean }>()
  const emit = defineEmits<{
    'update:pollingEnabled': [value: boolean]
    'request-refresh': []
  }>()

  const classIdentityStore = useClassIdentityStore()
  const modulesStore = useModulesStore()

  // Local mirrors of the store's filter for v-model binding on the controls.
  const kindFilter = ref<EventKindFilter>(classIdentityStore.filter.kind)
  const moduleNameFilter = ref<string | undefined>(
    classIdentityStore.filter.moduleName
  )
  const sinceWindow = ref<'1h' | '24h' | 'all'>('24h')

  // Push local state into the store + refetch when the operator changes filters.
  watch(kindFilter, (k) => {
    classIdentityStore.setKindFilter(k)
    classIdentityStore.fetchEvents()
  })
  watch(moduleNameFilter, (m) => {
    classIdentityStore.setModuleFilter(m)
    classIdentityStore.fetchEvents()
  })
  watch(sinceWindow, (w) => {
    const since =
      w === '1h'
        ? new Date(Date.now() - 60 * 60 * 1000).toISOString()
        : w === '24h'
          ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          : undefined
    classIdentityStore.setSinceFilter(since)
    classIdentityStore.fetchEvents()
  })

  // Mirror back when the store filter is set externally (drilldown from health table).
  watch(
    () => classIdentityStore.filter.moduleName,
    (m) => {
      if (m !== moduleNameFilter.value) moduleNameFilter.value = m
    }
  )

  const moduleNameOptions = computed(() =>
    Array.from(new Set(modulesStore.modules.map((m) => m.name))).sort()
  )

  const KIND_OPTIONS: Array<{ value: EventKindFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'rebind', label: 'Rebinds' },
    { value: 'errors', label: 'Errors' },
    { value: 'orphan-revive', label: 'Orphan / revive' },
    { value: 'collision', label: 'Collisions' }
  ]

  const kindBadgeColor = (kind: string): string => {
    if (kind === 'rebind') return 'info'
    if (kind === 'rebind-conflict' || kind === 'collision') return 'error'
    if (kind === 'orphan') return 'warning'
    if (kind === 'revive') return 'success'
    return 'default'
  }

  // Per-kind one-line summary: "what changed about which class".
  const eventDetail = (e: ClassIdentityEvent): string => {
    if (e.kind === 'rebind') return `${e.oldId ?? '?'} → ${e.newId ?? '?'}`
    if (e.kind === 'rebind-conflict') {
      return `wanted ${e.moduleDeclaredId ?? '?'}, db has ${e.dbId ?? '?'} (${e.policy ?? 'strict'})`
    }
    if (e.kind === 'collision') {
      return `${e.firstModuleName ?? '?'} ↔ ${e.secondModuleName ?? '?'} on ${e.collidingId ?? '?'}`
    }
    if (e.kind === 'orphan') return `reason: ${e.reason ?? 'unknown'}`
    if (e.kind === 'revive') return 're-introduced from metadata'
    return ''
  }

  // Bursts: same (kind, moduleName) within 2s collapse into one expandable parent.
  type DisplayEvent = ClassIdentityEvent & { burstChildren?: ClassIdentityEvent[] }
  const BURST_WINDOW_MS = 2000

  const displayEvents = computed<DisplayEvent[]>(() => {
    const src = classIdentityStore.filteredEvents
    if (src.length === 0) return []
    const out: DisplayEvent[] = []
    let current: DisplayEvent | null = null
    for (const e of src) {
      if (
        current &&
        current.kind === e.kind &&
        current.moduleName === e.moduleName &&
        Math.abs(Date.parse(current.timestamp) - Date.parse(e.timestamp)) <= BURST_WINDOW_MS
      ) {
        current.burstChildren = current.burstChildren ?? []
        current.burstChildren.push(e)
      } else {
        current = { ...e, burstChildren: undefined }
        out.push(current)
      }
    }
    return out
  })

  const totalShown = computed(() => {
    return displayEvents.value.reduce(
      (n, e) => n + 1 + (e.burstChildren?.length ?? 0),
      0
    )
  })
  const totalAvailable = computed(() => classIdentityStore.events.length)

  const togglePolling = (value: boolean) => emit('update:pollingEnabled', value)
  const refreshNow = () => emit('request-refresh')

  // Initial fetch is owned by the parent page (modules.vue triggers on tab open).
  onMounted(() => {
    // Push the default 24h window into the store on first mount.
    if (!classIdentityStore.filter.since) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      classIdentityStore.setSinceFilter(since)
    }
  })
</script>

<template>
  <v-card class="event-timeline elevation-12 rounded-lg opacity-80">
    <v-card-title class="pa-0">
      <v-sheet
        class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between"
        color="primary"
        variant="plain"
      >
        <v-icon class="mr-2" size="small">mdi-timeline-text-outline</v-icon>
        <div class="d-flex flex-column">
          <span class="text-subtitle-1">Live identity events</span>
          <span class="text-caption text-medium-emphasis">
            last {{ totalAvailable }} since server start (cap 1000)
          </span>
        </div>
        <v-spacer />
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-refresh"
          :loading="classIdentityStore.isLoading"
          @click="refreshNow"
        >
          Refresh
        </v-btn>
        <v-switch
          :model-value="props.pollingEnabled"
          hide-details
          density="compact"
          color="secondary"
          class="ml-4"
          label="Auto-refresh (10s)"
          @update:model-value="(v) => togglePolling(Boolean(v))"
        />
      </v-sheet>
    </v-card-title>

    <v-card-text>
      <v-row dense class="pt-2 mb-2 align-center">
        <v-col cols="12" md="auto">
          <v-chip-group v-model="kindFilter" mandatory selected-class="text-primary">
            <v-chip
              v-for="opt in KIND_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              size="small"
              variant="outlined"
            >
              {{ opt.label }}
            </v-chip>
          </v-chip-group>
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="moduleNameFilter"
            :items="moduleNameOptions"
            label="Module"
            density="compact"
            clearable
            hide-details
            variant="outlined"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="sinceWindow"
            :items="[
              { title: 'Last 1h', value: '1h' },
              { title: 'Last 24h', value: '24h' },
              { title: 'All', value: 'all' }
            ]"
            label="Window"
            density="compact"
            hide-details
            variant="outlined"
          />
        </v-col>
        <v-col cols="12" md="auto" class="ml-auto">
          <span class="text-caption text-medium-emphasis">
            {{ totalShown }} of {{ totalAvailable }} shown
          </span>
        </v-col>
      </v-row>

      <div v-if="displayEvents.length === 0" class="text-center text-disabled py-6">
        No events in the current filter window.
      </div>

      <v-virtual-scroll
        v-else
        :items="displayEvents"
        :height="320"
        :item-height="56"
      >
        <template #default="{ item }">
          <v-list-item class="event-row">
            <template #prepend>
              <v-chip
                size="x-small"
                :color="kindBadgeColor(item.kind)"
                variant="tonal"
                class="mr-2"
                :title="item.kind"
              >
                {{ item.kind }}
              </v-chip>
            </template>
            <v-list-item-title class="text-body-2">
              <span class="text-medium-emphasis mr-2">{{ formatRelative(item.timestamp) }}</span>
              <span v-if="item.moduleName" class="font-weight-medium mr-2">{{ item.moduleName }}</span>
              <span v-if="item.className" class="mr-2"><code>{{ item.className }}</code></span>
              <span class="text-caption text-medium-emphasis">{{ eventDetail(item) }}</span>
              <v-chip
                v-if="item.burstChildren && item.burstChildren.length > 0"
                size="x-small"
                variant="tonal"
                color="default"
                class="ml-2"
                :title="`${item.burstChildren.length + 1} events within 2s`"
              >
                ×{{ item.burstChildren.length + 1 }}
              </v-chip>
            </v-list-item-title>
          </v-list-item>
        </template>
      </v-virtual-scroll>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.event-row :deep(.v-list-item__content) {
  overflow: hidden;
}
</style>
