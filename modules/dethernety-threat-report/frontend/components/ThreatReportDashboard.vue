<!--
  ThreatReportDashboard.vue — the registered report root (key
  `threat_report_dashboard`).

  Mounted by the platform analysis-results page (analysisresults.vue), which
  resolves this component via componentRegistry.getComponent('threat_report_dashboard')
  and passes:
    - analysis-id : the standing Analysis node's id
    - content     : the full getDocument({document:'index'}) payload, i.e.
                    { threat_report_dashboard: <snapshot doc> }
    - scope-id    : the model id
  and listens for @update:content (it re-fetches getDocument when we emit it).

  Sprint 1 responsibility: the snapshot LIFECYCLE — never-generated / fresh /
  stale / generating — plus the in-component Generate/Recreate that rides the
  platform's native runAnalysis (via the host analysisStore) on this existing
  instance. The real report surfaces (coverage, boundary-crossing, residual-risk)
  build on this in later sprints; for now the fresh state shows the trivial
  posture facts.
-->
<template>
  <div class="threat-report-dashboard">
    <h2 class="trd-title">Threat Report</h2>

    <ScopeBanner
      :lifecycle="lifecycle"
      :generated-at="snapshot.generatedAt"
      :generating="generating"
      :flags="completenessFlags"
      @generate="handleGenerate"
    />

    <p v-if="errorMessage" class="trd-error" role="alert">{{ errorMessage }}</p>

    <!-- never-generated: the banner already carries the Generate CTA -->
    <div v-if="lifecycle === 'never'" class="trd-empty">
      <p>No snapshot has been generated for this report yet.</p>
      <p class="trd-hint">Generate a posture snapshot to get started.</p>
    </div>

    <!-- fresh / stale / generating: show the snapshot body (muted while stale) -->
    <div v-else class="trd-snapshot" :class="{ 'trd-snapshot--stale': lifecycle === 'stale' }">
      <dl class="trd-facts">
        <div class="trd-fact">
          <dt>Components</dt>
          <dd>{{ snapshot.componentCount }}</dd>
        </div>
        <div class="trd-fact">
          <dt>Boundaries</dt>
          <dd>{{ snapshot.boundaryCount }}</dd>
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
  </div>
</template>

<script setup>
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import ScopeBanner from './ScopeBanner.vue'
  import { deriveLifecycle, useThreatReportState } from '../composables/useThreatReportState.js'
  import { fetchLiveFingerprint } from '../composables/useThreatReportData.js'

  const props = defineProps({
    analysisId: { type: String, default: null },
    // The full getDocument payload: { threat_report_dashboard: <doc> }.
    content: { type: Object, default: null },
    scopeId: { type: String, default: null },
  })

  // Emitting update:content tells analysisresults.vue to re-fetch getDocument,
  // which flows a fresh `content` prop back to us.
  const emit = defineEmits(['update:content'])

  // Host bridge — resolved inside setup so the host's router/pinia are active.
  const host = window.__HOST_DEPENDENCIES__?.useHostContext?.() ?? {}
  const analysisStore = host.stores?.analysisStore
  const dtUtils = host.utils?.dtUtils

  const { generating, liveFingerprint } = useThreatReportState()
  const errorMessage = ref('')

  const snapshot = computed(() => {
    const doc = props.content?.threat_report_dashboard ?? {}
    return {
      generated: Boolean(doc.generated),
      generatedAt: doc.generatedAt ?? '',
      fingerprint: doc.fingerprint ?? '',
      componentCount: doc.componentCount ?? 0,
      boundaryCount: doc.boundaryCount ?? 0,
      modelId: doc.modelId ?? props.scopeId ?? '',
    }
  })

  const lifecycle = computed(() =>
    deriveLifecycle({
      generated: snapshot.value.generated,
      stored: snapshot.value.fingerprint,
      live: liveFingerprint.value,
      generating: generating.value,
    }),
  )

  // Completeness flags S1 can derive from snapshot-level data. Disposition-
  // dependent flags (zero-dispositioned, silent-green) light up in a later
  // sprint once the exposures fan-out exists.
  const completenessFlags = computed(() => {
    const flags = []
    if (lifecycle.value === 'stale') {
      flags.push({ key: 'stale', label: 'Snapshot is stale — Recreate to refresh', severity: 'warning' })
    }
    if (snapshot.value.generated && snapshot.value.boundaryCount === 0) {
      flags.push({ key: 'no-boundaries', label: 'No security boundaries modeled', severity: 'warning' })
    }
    return flags
  })

  const modelId = computed(() => snapshot.value.modelId || props.scopeId || '')

  const refreshLiveFingerprint = async () => {
    liveFingerprint.value = await fetchLiveFingerprint(dtUtils, modelId.value)
  }

  // Monotonic run token + a fallback timer id, so a stale fallback from an
  // earlier run can never release a newer run's gate, and a pending timer is
  // cancelled on teardown.
  let runToken = 0
  let fallbackTimer = null
  // How long to wait for the host's content re-fetch before self-releasing.
  const GATE_FALLBACK_MS = 5000

  const releaseGate = () => {
    generating.value = false
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
  }

  // Single-flight Generate/Recreate. The host store does NOT dedup runs, so the
  // synchronous `generating` guard (set before any await) is the single-flight
  // gate. We keep `generating` true until the new snapshot actually lands as a
  // fresh `content` prop (the generatedAt watcher below) — never clearing early,
  // which would flash a false 'stale' in the gap between the run resolving and
  // the re-fetched content arriving.
  const handleGenerate = async () => {
    if (generating.value) return
    if (!analysisStore || !props.analysisId) {
      errorMessage.value = 'Cannot generate: analysis context unavailable.'
      return
    }
    errorMessage.value = ''
    generating.value = true
    const token = ++runToken
    try {
      await analysisStore.runAnalysis({ analysisId: props.analysisId })
      // Ask the host to re-fetch the document; the watcher clears `generating`
      // when the fresh snapshot arrives.
      emit('update:content')
      // Fallback gate-release: the happy path is the generatedAt watcher, but the
      // host re-fetch (analysisresults.vue) is fire-and-forget with no error
      // surface — if it rejects or drops a falsy doc, the watcher never fires and
      // the gate would stick forever. Also covers the (near-impossible) identical
      // generatedAt where the watcher sees no value change. So if the watcher
      // hasn't released the gate within the grace period, self-release: the run
      // DID succeed (runAnalysis resolved), the snapshot is written; we just
      // couldn't confirm the content refresh.
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = setTimeout(() => {
        if (generating.value && token === runToken) {
          refreshLiveFingerprint().finally(releaseGate)
        }
      }, GATE_FALLBACK_MS)
    } catch (err) {
      // Keep-prior: the backend computes before writing, so a failed run leaves
      // the previous snapshot intact. Surface the error; restore interactivity.
      console.error('[threat-report] generate failed:', err)
      errorMessage.value = 'Snapshot generation failed. The previous snapshot is unchanged.'
      releaseGate()
    }
  }

  // When a Generate/Recreate completes, the parent re-fetches and the snapshot's
  // generatedAt changes. That is our signal the new snapshot has landed: refresh
  // the live fingerprint, THEN release the gate. The order is load-bearing —
  // refreshing live AFTER the new stored fingerprint is visible keeps stored and
  // live in lockstep, so the brief post-generate window never derives a false
  // state. Do not reorder these two statements.
  watch(
    () => snapshot.value.generatedAt,
    async () => {
      if (generating.value) {
        await refreshLiveFingerprint()
        releaseGate()
      }
    },
  )

  onMounted(() => {
    // Fresh mount: clear any leftover singleton state, then establish freshness.
    generating.value = false
    refreshLiveFingerprint()
  })

  onUnmounted(() => {
    // Make the module singletons self-healing regardless of mount strategy: a
    // stranded `generating` from this instance must not bleed into the next.
    releaseGate()
  })
</script>

<style scoped>
  .threat-report-dashboard {
    padding: 1.5rem;
  }
  .trd-title {
    margin: 0 0 1rem;
  }
  .trd-error {
    color: #c0392b;
    margin: 0 0 1rem;
  }
  .trd-facts {
    display: grid;
    gap: 0.5rem;
    margin: 0;
  }
  .trd-snapshot--stale {
    opacity: 0.6;
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
