<!--
  ThreatReportDashboard.vue — Sprint 0 walking skeleton.

  Mounted by the platform analysis-results page (analysisresults.vue), which
  resolves this component via componentRegistry.getComponent('threat_report_dashboard')
  and passes:
    - analysis-id : the standing Analysis node's id
    - content     : the full getDocument({document:'index'}) payload, i.e.
                    { threat_report_dashboard: <snapshot doc> }
    - scope-id    : the model id

  S0 renders only the trivial snapshot (or a "not generated" empty state). The
  real report surfaces, in-component Generate/Recreate, and freshness UX arrive
  in later sprints.
-->
<template>
  <div class="threat-report-dashboard">
    <h2 class="trd-title">Threat Report</h2>

    <div v-if="snapshot.generated" class="trd-snapshot">
      <p class="trd-meta">
        Posture snapshot · generated {{ snapshot.generatedAt }}
      </p>
      <dl class="trd-facts">
        <div class="trd-fact">
          <dt>Components</dt>
          <dd>{{ snapshot.componentCount }}</dd>
        </div>
        <div class="trd-fact">
          <dt>Fingerprint</dt>
          <dd><code>{{ snapshot.fingerprint }}</code></dd>
        </div>
        <div class="trd-fact">
          <dt>Model</dt>
          <dd><code>{{ snapshot.modelId }}</code></dd>
        </div>
      </dl>
    </div>

    <div v-else class="trd-empty">
      <p>No snapshot has been generated for this report yet.</p>
      <p class="trd-hint">Run the analysis to generate a posture snapshot.</p>
    </div>
  </div>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    analysisId: { type: String, default: null },
    // The full getDocument payload: { threat_report_dashboard: <doc> }.
    content: { type: Object, default: null },
    scopeId: { type: String, default: null },
  })

  const snapshot = computed(() => {
    const doc = props.content?.threat_report_dashboard ?? {}
    return {
      generated: Boolean(doc.generated),
      generatedAt: doc.generatedAt ?? '',
      fingerprint: doc.fingerprint ?? '',
      componentCount: doc.componentCount ?? 0,
      modelId: doc.modelId ?? props.scopeId ?? '',
    }
  })
</script>

<style scoped>
  .threat-report-dashboard {
    padding: 1.5rem;
  }
  .trd-title {
    margin: 0 0 1rem;
  }
  .trd-meta {
    opacity: 0.7;
    margin-bottom: 1rem;
  }
  .trd-facts {
    display: grid;
    gap: 0.5rem;
    margin: 0;
  }
  .trd-fact {
    display: flex;
    gap: 0.75rem;
  }
  .trd-fact dt {
    min-width: 8rem;
    font-weight: 600;
  }
  .trd-fact dd {
    margin: 0;
  }
  .trd-empty {
    opacity: 0.8;
  }
  .trd-hint {
    opacity: 0.6;
    font-size: 0.9rem;
  }
</style>
