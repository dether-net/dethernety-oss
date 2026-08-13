<script setup lang="ts">
import { computed } from 'vue'
import type { StateView } from '@/api'

const props = defineProps<{ state: StateView }>()

// The same severity set FailureBanner keys off: these mean the deployment is not delivering its
// product, so any one of them makes the whole verdict a fault. Other failures (platform restarting,
// init-not-run) are warnings.
const SEVERE = new Set(['module-fetch-failed', 'fewer-modules-registered', 'ingest-failed'])

const verdict = computed<'healthy' | 'degraded' | 'fault'>(() => {
  const fs = props.state.failures
  if (fs.some((f) => SEVERE.has(f.kind))) return 'fault'
  if (fs.length) return 'degraded'
  return 'healthy'
})

const VERDICT = {
  healthy: { label: 'Healthy', dot: 'bg-dt-accent', text: 'text-dt-accent' },
  degraded: { label: 'Degraded', dot: 'bg-dt-tertiary', text: 'text-dt-tertiary' },
  fault: { label: 'Fault', dot: 'bg-dt-quinary', text: 'text-dt-quinary' },
} as const
const v = computed(() => VERDICT[verdict.value])

const expected = computed(() => props.state.modules.expected ?? [])
const placed = computed(() => expected.value.filter((m) => m.outcome === 'placed' || m.outcome === 'skipped').length)
const statements = computed(() =>
  typeof props.state.ingest.statements === 'number' ? props.state.ingest.statements.toLocaleString() : '—',
)
</script>

<template>
  <div :data-verdict="verdict" class="dt-card flex flex-wrap items-center gap-x-6 gap-y-3 p-6">
    <div class="flex items-center gap-2.5">
      <span class="h-2.5 w-2.5 rounded-full" :class="v.dot"></span>
      <span class="font-heading text-lg font-bold tracking-[-0.01em]" :class="v.text">{{ v.label }}</span>
    </div>
    <dl class="ml-auto flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div>
        <dt class="text-xs text-dt-text-muted">Modules</dt>
        <dd class="text-dt-text">{{ placed }}/{{ expected.length }} placed</dd>
      </div>
      <div>
        <dt class="text-xs text-dt-text-muted">Ingest</dt>
        <dd class="text-dt-text">{{ state.ingest.status }}</dd>
      </div>
      <div>
        <dt class="text-xs text-dt-text-muted">Data</dt>
        <dd class="text-dt-text">{{ statements }} statements</dd>
      </div>
    </dl>
  </div>
</template>
