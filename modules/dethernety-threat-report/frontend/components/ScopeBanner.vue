<!--
  ScopeBanner.vue — the report's scope + freshness header.

  Presentational only: the parent (ThreatReportShell) owns lifecycle state,
  the live-fingerprint fetch, and the single-flight Generate/Recreate action.
  This component renders the freshness line + the Generate/Recreate button and
  emits `generate`; it also renders the completeness-flag scaffold.

  Built once here and stamped on every later report surface, so it stays free of
  any surface-specific data.
-->
<template>
  <header class="trd-scope-banner">
    <div class="trd-freshness">
      <span class="trd-freshness-line">
        <template v-if="lifecycle === 'generating'">Generating snapshot…</template>
        <template v-else-if="lifecycle === 'never'">No snapshot has been generated yet.</template>
        <template v-else>
          Reflects the model as of <time>{{ generatedAtLabel }}</time>
          <span class="trd-state" :class="`trd-state--${lifecycle}`">
            · {{ lifecycle === 'stale' ? 'Stale — the model changed since' : 'Fresh' }}
          </span>
        </template>
      </span>

      <button
        type="button"
        class="trd-generate"
        :class="{ 'trd-generate--stale': lifecycle === 'stale' }"
        :disabled="generating"
        :aria-busy="generating ? 'true' : 'false'"
        @click="$emit('generate')"
      >
        {{ generating ? 'Generating…' : lifecycle === 'never' ? 'Generate' : 'Recreate' }}
      </button>
    </div>

    <ul v-if="flags.length" class="trd-flags" aria-label="Completeness flags">
      <li
        v-for="flag in flags"
        :key="flag.key"
        class="trd-flag"
        :class="`trd-flag--${flag.severity}`"
      >
        {{ flag.label }}
      </li>
    </ul>
  </header>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    // 'never' | 'fresh' | 'stale' | 'generating'
    lifecycle: { type: String, default: 'never' },
    generatedAt: { type: String, default: '' },
    generating: { type: Boolean, default: false },
    // [{ key, label, severity: 'info' | 'warning' }]
    flags: { type: Array, default: () => [] },
  })

  defineEmits(['generate'])

  // Format the ISO timestamp for display; fall back to the raw value if it is
  // not parseable (never fabricate a date).
  const generatedAtLabel = computed(() => {
    if (!props.generatedAt) return ''
    const d = new Date(props.generatedAt)
    return Number.isNaN(d.getTime()) ? props.generatedAt : d.toLocaleString()
  })
</script>

<style scoped>
  .trd-scope-banner {
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding: 0 0 1rem;
    margin-bottom: 1rem;
  }
  .trd-freshness {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .trd-freshness-line {
    opacity: 0.85;
  }
  .trd-state--fresh {
    color: #2e7d32;
  }
  .trd-state--stale {
    color: #c77700;
    font-weight: 600;
  }
  .trd-generate {
    flex-shrink: 0;
    padding: 0.4rem 1rem;
    border: 1px solid currentColor;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    font: inherit;
  }
  .trd-generate:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .trd-generate--stale {
    color: #c77700;
    font-weight: 600;
  }
  .trd-flags {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .trd-flag {
    font-size: 0.8rem;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    border: 1px solid rgba(127, 127, 127, 0.4);
  }
  .trd-flag--warning {
    color: #c77700;
    border-color: #c77700;
  }
  .trd-flag--info {
    opacity: 0.75;
  }
</style>
