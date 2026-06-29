<script setup lang="ts">
  import { computed } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import { ZONE_PILL_WORD, ZONE_COLOR, ROLE_LABEL, planesToRole } from '@/utils/zoneColor'
  import type { Plane } from '@dethernety/dt-core'

  // The boundary analogue of ClassPreview.vue (which is class-shaped and not reusable here): shows the
  // highlighted peer's classification before the user commits a conduit. Store getters only — no gql.
  const props = defineProps<{ boundaryId: string | null }>()

  const flowStore = useFlowStore()

  const node = computed(() => (props.boundaryId ? flowStore.boundaryById(props.boundaryId) : null))
  const data = computed(() => (node.value as any)?.data ?? null)
  const name = computed(() => data.value?.label ?? '')
  const description = computed(() => data.value?.description ?? '')
  const domains = computed<string[]>(() => data.value?.domains ?? [])
  const roleLabel = computed(() => ROLE_LABEL[planesToRole(data.value?.planes as Plane[] | undefined)])

  // Resolved (post-inheritance) zone — the classification the user is connecting to.
  const ez = computed(() => (props.boundaryId ? flowStore.effectiveZone(props.boundaryId) : null))
  const zoneWord = computed(() => (ez.value ? ZONE_PILL_WORD[ez.value.zone] : ''))
  const zoneColor = computed(() => (ez.value ? ZONE_COLOR[ez.value.zone] : 'grey'))
  const zoneInherited = computed(() => ez.value?.source === 'inherited')
  // Default (nothing declared in the chain) → no solid pill, matching the diagram + row-list convention
  // (zoneColor.ts zonePill returns null for `default`). Show the resolved word as muted "(default)" text.
  const zoneIsDefault = computed(() => ez.value?.source === 'default')
</script>

<template>
  <v-card v-if="node" class="pa-4 boundary-peer-preview" flat>
    <div class="text-h6 d-flex align-center ga-2">
      <span class="peer-name">{{ name }}</span>
      <v-chip
        v-if="!zoneIsDefault"
        class="peer-zone-pill"
        size="small"
        :color="zoneColor"
        variant="flat"
        :style="{ opacity: zoneInherited ? 0.6 : 1 }"
      >
        {{ zoneWord }}<span v-if="zoneInherited" class="font-italic ml-1">(inherited)</span>
      </v-chip>
      <span v-else class="peer-zone-default text-medium-emphasis font-italic text-body-2">
        {{ zoneWord }} (default)
      </span>
    </div>
    <v-row class="mt-2">
      <v-col cols="6">
        <div class="text-caption text-disabled">Role</div>
        <div class="peer-role">{{ roleLabel }}</div>
      </v-col>
      <v-col cols="6">
        <div class="text-caption text-disabled">Business function</div>
        <div v-if="domains.length" class="d-flex flex-wrap ga-1">
          <v-chip v-for="d in domains" :key="d" size="x-small" variant="tonal">{{ d }}</v-chip>
        </div>
        <div v-else>—</div>
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-disabled">Description</div>
        <div class="peer-description">{{ description || '—' }}</div>
      </v-col>
    </v-row>
    <!-- Reserved: the prospective conduit verdict ("Looks fine / Needs review") slots here once the
         analysis lattice lands. No legality is computed this round. -->
  </v-card>
  <v-card v-else class="pa-4 boundary-peer-preview-empty" flat>
    <div class="text-caption text-disabled">Select a boundary to preview what you're connecting to.</div>
  </v-card>
</template>
