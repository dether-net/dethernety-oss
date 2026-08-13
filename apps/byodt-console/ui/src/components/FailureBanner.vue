<script setup lang="ts">
import { computed } from 'vue'
import type { Failure } from '@/api'

const props = defineProps<{ failure: Failure }>()

// Severe = the deployment is not delivering its product: no modules fetched, placed modules
// the platform never registered (the console's characteristic failure), or no MITRE corpus. The
// milder states (platform-unreachable while restarting, init-not-run before first boot) are
// warnings, not faults.
const SEVERE = new Set(['module-fetch-failed', 'fewer-modules-registered', 'ingest-failed'])
const severe = computed(() => SEVERE.has(props.failure.kind))

const title = computed(() =>
  props.failure.kind
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
)

const tone = computed(() =>
  severe.value
    ? 'border-dt-quinary bg-dt-quinary/10'
    : 'border-dt-tertiary bg-dt-tertiary/10',
)
</script>

<template>
  <div :data-kind="failure.kind" :data-severe="severe ? 'true' : 'false'" class="rounded-r-md border-l-4 px-3 py-2" :class="tone">
    <p class="text-sm font-semibold text-dt-text">{{ title }}</p>
    <p class="text-sm text-dt-text-muted">{{ failure.message }}</p>
    <p v-if="failure.modules && failure.modules.length" class="mt-1 text-sm">
      <span class="text-dt-text-muted">Modules:</span>
      <code v-for="m in failure.modules" :key="m" class="ml-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">{{ m }}</code>
    </p>
  </div>
</template>
