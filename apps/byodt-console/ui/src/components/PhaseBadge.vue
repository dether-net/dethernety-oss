<script setup lang="ts">
import { computed } from 'vue'
import type { ModeView } from '@/api'

const props = defineProps<{ mode: ModeView }>()

const label = computed(() => {
  switch (props.mode.phase) {
    case 'pre-cloud':
      return 'Pre-cloud'
    case 'authenticated':
      return 'Authenticated'
    case 'post-cloud':
      return 'Cloud'
    case 'platform-unreachable':
      return 'Platform unreachable'
    default:
      return props.mode.phase
  }
})

// The unreachable phase is the only one that is itself a fault; the other two are normal
// running states, so only it is coloured as a problem.
const tone = computed(() => {
  switch (props.mode.phase) {
    case 'platform-unreachable':
      return 'bg-dt-quinary/15 text-dt-quinary'
    case 'post-cloud':
      return 'bg-dt-secondary/15 text-dt-accent'
    default:
      return 'border border-dt-border text-dt-text-muted'
  }
})

const detail = computed(() => {
  if (props.mode.phase === 'platform-unreachable') return 'the platform is not answering'
  if (props.mode.authDisabled) return 'authentication disabled'
  return props.mode.oidcIssuer ?? ''
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span :data-phase="mode.phase" class="rounded-full px-2.5 py-0.5 text-xs" :class="tone">{{ label }}</span>
    <span v-if="detail" class="hidden text-sm text-dt-text-muted sm:inline">{{ detail }}</span>
  </div>
</template>
