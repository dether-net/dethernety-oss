<script setup lang="ts">
import type { ModulesState } from '@/api'

defineProps<{ modules: ModulesState }>()

function outcomeTone(outcome: string): string {
  if (outcome === 'failed') return 'text-dt-quinary'
  if (outcome === 'skipped') return 'text-dt-text-muted'
  return 'text-dt-accent'
}
</script>

<template>
  <div class="dt-card p-6">
    <p class="mb-2 text-sm">
      <span class="text-dt-text-muted">Status:</span>
      <code class="ml-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">{{ modules.status }}</code>
      <span v-if="modules.detail" class="ml-1 text-dt-text-muted">— {{ modules.detail }}</span>
    </p>

    <p v-if="!modules.expected || modules.expected.length === 0" class="text-sm text-dt-text-muted" data-empty="true">
      No modules were placed.
    </p>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="border-b border-dt-border text-left text-dt-text-muted">
          <th class="py-1.5 pr-3 font-medium">Module</th>
          <th class="py-1.5 pr-3 font-medium">Version</th>
          <th class="py-1.5 font-medium">Placed</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in modules.expected" :key="m.name" data-module-row class="border-b border-white/10">
          <td class="py-1.5 pr-3">{{ m.name }}</td>
          <td class="py-1.5 pr-3 text-dt-text-muted">{{ m.version }}</td>
          <td class="py-1.5" :class="outcomeTone(m.outcome)">{{ m.outcome }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
