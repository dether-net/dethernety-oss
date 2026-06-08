<script setup lang="ts">
  // Per-row lifecycle badge for a finding (Exposure or Countermeasure). Renders
  // the derived pending/confirmed/disposed state via the shared `lifecycleBadgeFor`
  // descriptor so the exposure tab and the ControlDialog sub-table stay identical
  // and can't drift. Renders NOTHING for a pending row — that backlog is surfaced
  // by the per-tab PendingBadge, not a per-row chip.
  import { computed } from 'vue'
  import {
    lifecycleBadgeFor,
    type DispositionableFinding,
    type FindingType,
  } from '@/composables/useFindingDisposition'

  interface Props {
    item: DispositionableFinding
    findingType: FindingType
  }
  const props = defineProps<Props>()
  const badge = computed(() => lifecycleBadgeFor(props.item, props.findingType))
</script>

<template>
  <div
    v-if="badge"
    role="img"
    :aria-label="`Lifecycle: ${badge.text}`"
    class="mt-1"
  >
    <v-chip size="x-small" :color="badge.color || undefined" :variant="badge.variant">
      {{ badge.text }}
    </v-chip>
  </div>
</template>
