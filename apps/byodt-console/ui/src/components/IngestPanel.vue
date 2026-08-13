<script setup lang="ts">
import { computed } from 'vue'
import type { IngestState } from '@/api'

const props = defineProps<{ ingest: IngestState }>()

const elapsed = computed(() => {
  const ms = props.ingest.elapsedMs
  if (!ms) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`
})
</script>

<template>
  <div class="dt-card p-6 text-sm">
    <p>
      <span class="text-dt-text-muted">Status:</span>
      <code class="ml-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">{{ ingest.status || 'unknown' }}</code>
    </p>
    <p v-if="ingest.statements" class="mt-1 text-dt-text-muted">
      {{ ingest.statements.toLocaleString() }} statements<span v-if="elapsed"> in {{ elapsed }}</span>
    </p>
    <p v-if="ingest.detail" class="mt-1 text-dt-text-muted">{{ ingest.detail }}</p>
  </div>
</template>
