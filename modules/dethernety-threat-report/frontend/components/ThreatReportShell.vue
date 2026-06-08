<!--
  ThreatReportShell.vue — the registered report root (registry/document key
  `threat_report_dashboard`, unchanged — the backend getDocument contract).

  Mounted by the platform analysis-results page (analysisresults.vue), which
  resolves this component via componentRegistry.getComponent('threat_report_dashboard')
  and passes:
    - analysis-id : the standing Analysis node's id
    - content     : the full getDocument({document:'index'}) payload, i.e.
                    { threat_report_dashboard: <snapshot doc> }
    - scope-id    : the model id
  and listens for @update:content (it re-fetches getDocument when we emit it).

  The shell owns the snapshot LIFECYCLE (never / fresh / stale / generating, the
  Generate/Recreate that rides the platform runAnalysis) and the IN-COMPONENT
  view-switching: Posture Summary / Boundary Crossings / Residual Risk are views
  of ONE component reached by a segmented control (NO routes); Component Profile
  is a drill TARGET overlaid on the active view, with a removable breadcrumb so a
  drill never silently hides scope. Coverage & Gaps and Reachability are the
  graph-facts views (Coverage via the coverage module; Reachability computed
  client-side over the snapshot — the flow-route / crown-jewel engine).
  Navigation/filter state is module-local (lib/reportNavigation pure reducers,
  held in a reactive here). The banner is pinned ABOVE the switcher: the modeler
  learns "stale" / "exclusions" before reading a reassuring count.
-->
<template>
  <div class="threat-report-shell">
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

    <!-- fresh / stale / generating: the view-switching report surface -->
    <div v-else class="trd-snapshot" :class="{ 'trd-snapshot--stale': lifecycle === 'stale' }">
      <div class="trd-actions">
        <span class="trd-meta">
          {{ snapshot.componentCount }} components · {{ snapshot.boundaryCount }} boundaries
        </span>
        <span class="trd-export">
          <button
            type="button"
            class="trd-export-btn"
            :disabled="liveEditCount > 0"
            :title="liveEditCount > 0 ? `Recreate to include your ${liveEditCount} pending change${liveEditCount === 1 ? '' : 's'} in the export` : ''"
            @click="handleExport('json')"
          >Export JSON</button>
          <button
            type="button"
            class="trd-export-btn"
            :disabled="liveEditCount > 0"
            :title="liveEditCount > 0 ? `Recreate to include your ${liveEditCount} pending change${liveEditCount === 1 ? '' : 's'} in the export` : ''"
            @click="handleExport('html')"
          >Export HTML</button>
        </span>
      </div>

      <!-- Honesty cue: rows reflect live edits made AFTER this snapshot was generated
           (optimistic in-place). The snapshot's own provenance is unchanged; Recreate
           folds them in and refreshes the derived views (coverage / reachability). -->
      <p v-if="liveEditCount > 0" class="trd-edited-note" role="status">
        Reflecting {{ liveEditCount }} change{{ liveEditCount === 1 ? '' : 's' }} made since this snapshot was generated.
        <button type="button" class="trd-edited-recreate" :disabled="generating" @click="handleGenerate">Recreate</button>
        to fold them in and refresh the derived views.
      </p>

      <!-- Segmented control across the report's views. -->
      <nav class="trd-tabs" role="tablist" aria-label="Report views">
        <button
          v-for="v in VIEWS"
          :key="v"
          type="button"
          role="tab"
          class="trd-tab"
          :class="{ 'trd-tab--active': nav.activeView === v }"
          :aria-selected="nav.activeView === v"
          @click="onSetView(v)"
        >{{ VIEW_LABELS[v] }}</button>
      </nav>

      <!-- Breadcrumb: the active filter chips (removable). The Component Profile
           drill is a dialog overlay (below), so it no longer needs a breadcrumb
           trail — the dialog carries its own title + close. -->
      <div v-if="nav.filters.length" class="trd-breadcrumb">
        <span class="trd-crumb-current">{{ VIEW_LABELS[nav.activeView] }}</span>
        <template v-for="f in nav.filters" :key="f.key">
          <span class="trd-crumb-sep" aria-hidden="true">›</span>
          <span class="trd-chip">
            {{ f.label }}
            <button type="button" class="trd-chip-x" @click="onRemoveFilter(f.key)" title="Remove filter">✕</button>
          </span>
        </template>
      </div>

      <!-- The active view. Component Profile is a drill TARGET shown as a
           dialog OVERLAY (below) rather than replacing this region, so the view
           underneath stays mounted — the modeler returns to exactly where they
           were (scroll position, expanded rows, reachability selections). -->
      <div class="trd-view">
        <PostureSummary
          v-if="nav.activeView === 'posture'"
          :ledger="snapshot.ledger"
          :model-graph="snapshot.modelGraph"
          :coverage="coverageData"
          :coverage-view="coverageView"
          :reachability="reachability"
          @navigate="onNavigate"
        />
        <CoverageMatrix
          v-else-if="nav.activeView === 'coverage'"
          :coverage="coverageData"
          :coverage-view="coverageView"
          :ledger="snapshot.ledger"
          @drill="onDrill"
        />
        <ReachabilityView
          v-else-if="nav.activeView === 'reachability'"
          :model-graph="snapshot.modelGraph"
          :ledger="snapshot.ledger"
          @drill="onDrill"
        />
        <BoundaryCrossings
          v-else-if="nav.activeView === 'boundary'"
          :model-graph="snapshot.modelGraph"
          :ledger="snapshot.ledger"
          @drill="onDrill"
        />
        <FindingsLedger
          v-else-if="nav.activeView === 'residual'"
          :ledger="snapshot.ledger"
          :filter="residualFilter"
          :coverage="coverageData"
          :coverage-view="coverageView"
          :reachability="reachability"
          :technique-index="techniqueIndex"
          :can-dispose="canDispose"
          @dispose="handleDispose"
          @affirm="handleAffirm"
          @supersede="handleSupersede"
          @add-note="handleAddNote"
          @delete="handleDelete"
          @issue="handleIssue"
          @drill="onDrill"
          @navigate="onNavigate"
        />
      </div>

      <!-- Component Profile drill overlay. A dialog (not a view swap) so the
           view underneath keeps its state. v-model bridges nav.drill ↔ open, so
           Esc / scrim-click closes through popDrill. A neighbour link inside the
           profile re-targets the SAME dialog (onDrill swaps elementId). -->
      <v-dialog v-model="drillOpen" width="80vw" max-width="1000" scrollable>
        <v-card v-if="nav.drill">
          <v-card-title class="d-flex align-center trd-dialog-head">
            <span class="trd-dialog-eyebrow">Component Profile</span>
            <span class="trd-dialog-title">{{ drillName }}</span>
            <v-spacer />
            <v-btn icon="mdi-close" size="small" variant="text" title="Close" @click="onPopDrill" />
          </v-card-title>
          <v-card-text>
            <ComponentProfile
              :element-id="nav.drill.elementId"
              :ledger="snapshot.ledger"
              :model-graph="snapshot.modelGraph"
              :can-dispose="canDispose"
              :technique-index="techniqueIndex"
              @drill="onDrill"
              @dispose="handleDispose"
              @affirm="handleAffirm"
              @supersede="handleSupersede"
              @add-note="handleAddNote"
              @delete="handleDelete"
              @issue="handleIssue"
            />
          </v-card-text>
        </v-card>
      </v-dialog>

      <!-- Action feedback (affirm Undo, supersede Retry, errors). Vuetify is
           available in the module runtime; mirrors the dt-ui exposures-tab snackbar. -->
      <v-snackbar
        v-model="snackBar.show"
        :color="snackBar.color"
        :timeout="snackBar.timeout ?? (snackBar.action ? -1 : 5000)"
        location="top"
      >
        <span>{{ snackBar.message }}</span>
        <template v-if="snackBar.action" #actions>
          <v-btn variant="text" @click="snackBar.action.handler()">{{ snackBar.action.label }}</v-btn>
        </template>
      </v-snackbar>
    </div>
  </div>
</template>

<script setup>
  import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import ScopeBanner from './ScopeBanner.vue'
  import PostureSummary from './PostureSummary.vue'
  import CoverageMatrix from './CoverageMatrix.vue'
  import ReachabilityView from './ReachabilityView.vue'
  import FindingsLedger from './FindingsLedger.vue'
  import BoundaryCrossings from './BoundaryCrossings.vue'
  import ComponentProfile from './ComponentProfile.vue'
  import { deriveLifecycle, useThreatReportState } from '../composables/useThreatReportState.js'
  import { fetchLiveFingerprint, fetchGradedCoverage } from '../composables/useThreatReportData.js'
  import { dedupeLedgerElements } from '../lib/aggregateLedger.js'
  import { modeAReachability } from '../lib/reachability.js'
  import { buildExposureTechniqueIndex, buildCoverageView } from '../lib/coverageMatrix.js'
  import { exportJson, exportHtml } from '../lib/exportReport.js'
  import { computeCompletenessFlags } from '../lib/completenessFlags.js'
  import {
    defaultNavState,
    setView,
    gotoFilteredView,
    drillTo,
    popDrill,
    removeFilter,
    toggleFilter,
    clearFilters,
    VIEWS,
    VIEW_LABELS,
  } from '../lib/reportNavigation.js'

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
  // Reusable platform finding-action services (added to useHostContext for module
  // use). These wrap the SAME flowStore→dt-core mutations the dt-ui exposures tab
  // calls, so the report's actions can't drift from the platform's.
  const hostServices = host.services ?? {}
  const openDispositionDialog = hostServices.openDispositionDialog
  const affirmFinding = hostServices.affirmFinding
  const clearFindingDisposition = hostServices.clearFindingDisposition
  const supersedeFinding = hostServices.supersedeFinding
  const deleteFinding = hostServices.deleteFinding
  // Full finding→issue workflow (board copy + per-class create), host-owned.
  const openFindingIssueSelector = hostServices.openFindingIssueSelector
  // Only offer the action affordances when the host actually exposes the services
  // (older host builds won't) — avoids silently-inert buttons.
  const canDispose = Boolean(openDispositionDialog)

  // Action feedback (affirm Undo, supersede Retry, errors). Optional finite timeout
  // overrides the actioned-snackbar default of -1 so the Undo snackbar auto-dismisses.
  const snackBar = ref({ show: false, color: 'success', message: '', timeout: undefined, action: null })

  const { generating, liveFingerprint } = useThreatReportState()
  const errorMessage = ref('')
  // The LIVE graded-coverage facts (the coverage matrix + posture block). Fetched through the
  // merged schema from the sibling coverage-tools module; null when that module
  // isn't deployed (the matrix renders its no-coverage affordance, the rest of the
  // report is unaffected). Coverage is live graph facts, independent of the
  // snapshot — drift vs the snapshot ledger is owned by the staleness banner.
  const coverageData = ref(null)

  // ---- Optimistic in-place reflect ----------------------------------------------
  // The report is a point-in-time snapshot, so a disposition/affirm made from it
  // would otherwise leave the snapshot stale (dimmed) until a manual Recreate —
  // brutal for triaging many exposures in a row. Instead we OVERLAY the just-made
  // change onto the in-memory ledger from the mutation's own result envelope (the
  // authoritative persisted disposition), so the row updates instantly (Confirmed
  // chip / partition move) with no stale dim and no Recreate. This reflects the
  // user's own decisions on the live model — accurate, not fabricated; the snapshot
  // metadata (generatedAt/fingerprint) is untouched and a non-blocking note (below)
  // keeps the "as of generation" provenance honest. Overlays clear when a fresh
  // snapshot lands (the generatedAt watcher), which already includes them.
  const editedFindings = reactive(new Map()) // exposureId → partial disposition patch
  const deletedFindingIds = reactive(new Set()) // optimistically-removed finding ids
  const liveEditCount = computed(() => editedFindings.size + deletedFindingIds.size)

  const clearOverlays = () => { editedFindings.clear(); deletedFindingIds.clear() }

  // Patch a finding from a DispositionMutationResult (affirm / dispose / add-note /
  // edit / undo) — the envelope carries the full persisted disposition.
  const applyDispositionResult = (result) => {
    if (!result || !result.exposureId) return
    deletedFindingIds.delete(result.exposureId)
    editedFindings.set(result.exposureId, {
      dispositionKind: result.dispositionKind ?? null,
      dispositionReason: result.dispositionReason ?? null,
      dispositionedBy: result.dispositionedBy ?? null,
      dispositionedAt: result.dispositionedAt ?? null,
      dispositionStale: result.dispositionStale ?? false,
    })
  }

  // Merge the overlays onto the snapshot's ledger (drop deleted, patch edited).
  const applyEdits = (ledger) => {
    if (editedFindings.size === 0 && deletedFindingIds.size === 0) return ledger
    return ledger.map((el) => ({
      ...el,
      findings: (el.findings ?? [])
        .filter((f) => !deletedFindingIds.has(f.id))
        .map((f) => (editedFindings.has(f.id) ? { ...f, ...editedFindings.get(f.id) } : f)),
    }))
  }

  const snapshot = computed(() => {
    const doc = props.content?.threat_report_dashboard ?? {}
    return {
      generated: Boolean(doc.generated),
      generatedAt: doc.generatedAt ?? '',
      fingerprint: doc.fingerprint ?? '',
      componentCount: doc.componentCount ?? 0,
      boundaryCount: doc.boundaryCount ?? 0,
      modelId: doc.modelId ?? props.scopeId ?? '',
      // dedupe defends every downstream view + total against duplicate element
      // nodes in the source model; applyEdits then overlays optimistic edits.
      ledger: applyEdits(dedupeLedgerElements(doc.ledger ?? [])),
      // Always present the four graph keys so the pure libs never see undefined;
      // dataNodes may be absent on an older snapshot — default it.
      modelGraph: { boundaries: [], components: [], flows: [], dataNodes: [], ...(doc.modelGraph ?? {}) },
    }
  })

  // Reachability — the DEFAULT (external entry-point) mode-A rollup, computed
  // synchronously over the snapshot (no fetch, no Cypher — the engine is pure-TS,
  // simple-path/bounded). This external rollup is what the Posture Summary
  // (crown-jewel tile) and Residual Risk (the crown-jewel-route cross-ref) read;
  // the Reachability view itself recomputes for a selectable assumed-breach
  // origin internally. A `computed` so it re-derives when the
  // snapshot changes and caches otherwise.
  const reachability = computed(() =>
    modeAReachability(snapshot.value.modelGraph, snapshot.value.ledger, { kind: 'external' }),
  )

  // exposureId → resolved ATT&CK techniques, derived from the live coverage facts
  // (the ONLY source of exposure→technique mappings). Feeds the clickable technique
  // chips on each finding in Component Profile and Residual Risk. Empty {} when
  // coverage-tools isn't deployed — the chips simply don't render.
  const techniqueIndex = computed(() => buildExposureTechniqueIndex(coverageData.value))

  // The pure coverage honesty view, built ONCE here and shared with every child
  // that needs it (the coverage matrix, the posture coverage block, and the
  // findings-ledger mismatch signal) so the same derivation isn't recomputed in
  // each. Children still accept :coverage/:ledger and fall back to building it
  // themselves when this prop is absent, so they keep working standalone.
  const coverageView = computed(() => buildCoverageView(coverageData.value, snapshot.value.ledger))

  const lifecycle = computed(() =>
    deriveLifecycle({
      generated: snapshot.value.generated,
      stored: snapshot.value.fingerprint,
      live: liveFingerprint.value,
      generating: generating.value,
    }),
  )

  // Completeness flags, surfaced banner-first: freshness + structural
  // flags here, plus the model-wide silent-green guards (under-analyzed
  // high-value elements, orphan components) from computeCompletenessFlags over
  // the snapshot graph + ledger. A reviewer must learn these BEFORE reading a
  // reassuring count, so they live on the banner above every view.
  const completenessFlags = computed(() => {
    const flags = []
    if (lifecycle.value === 'stale') {
      flags.push({ key: 'stale', label: 'Snapshot is stale — Recreate to refresh', severity: 'warning' })
    }
    if (snapshot.value.generated && snapshot.value.boundaryCount === 0) {
      flags.push({ key: 'no-boundaries', label: 'No security boundaries modeled', severity: 'warning' })
    }
    if (snapshot.value.generated) {
      flags.push(...computeCompletenessFlags(snapshot.value.modelGraph, snapshot.value.ledger))
    }
    return flags
  })

  // --- In-component navigation -------------------------------------------
  // Module-local nav state (pure reducers in lib/reportNavigation; this reactive
  // is the holder). The reducers return fresh snapshots; assign them back.
  const nav = reactive(defaultNavState())
  const apply = (next) => Object.assign(nav, next)

  const onSetView = (v) => apply(setView(nav, v))
  const onPopDrill = () => apply(popDrill(nav))
  // Component Profile is shown as a dialog OVERLAY (not a view swap), so the
  // underlying view stays mounted and keeps its state. This computed bridges the
  // nav.drill model to the v-dialog's v-model: opening is driven by drillTo;
  // closing (Esc / scrim-click / the dialog ✕) routes back through popDrill.
  const drillOpen = computed({
    get: () => Boolean(nav.drill),
    set: (open) => { if (!open) onPopDrill() },
  })
  const onRemoveFilter = (key) => apply(removeFilter(nav, key))
  const onDrill = (elementId) => apply(drillTo(nav, elementId, nav.activeView))
  const onNavigate = (intent) => {
    if (!intent) return
    if (intent.type === 'view') apply(setView(nav, intent.view))
    else if (intent.type === 'filter') apply(gotoFilteredView(nav, intent.view, intent.filter))
    else if (intent.type === 'toggle-filter') apply(toggleFilter(nav, intent.filter))
    else if (intent.type === 'clear-filters') apply(clearFilters(nav))
    else if (intent.type === 'drill') apply(drillTo(nav, intent.elementId, nav.activeView))
  }

  // The Residual Risk filter prop derived from the active filter chips (only on
  // the residual view; band + live).
  const residualFilter = computed(() => {
    if (nav.activeView !== 'residual') return null
    const out = {}
    for (const f of nav.filters) {
      if (f.type === 'band') out.band = f.value
      if (f.type === 'live') out.live = f.value
      if (f.type === 'provenance') out.provenance = f.value
      if (f.type === 'type') out.elementType = f.value
      if (f.type === 'lifecycle') out.lifecycle = f.value
    }
    return Object.keys(out).length ? out : null
  })

  // Breadcrumb label for the drilled element (looked up across the snapshot).
  const elementName = (id) => {
    const mg = snapshot.value.modelGraph
    return (
      mg.components.find((c) => c.id === id)?.name ??
      mg.boundaries.find((b) => b.id === id)?.name ??
      (mg.dataNodes ?? []).find((d) => d.id === id)?.name ??
      mg.flows.find((f) => f.id === id)?.name ??
      snapshot.value.ledger.find((e) => e.id === id)?.name ??
      '(element)'
    )
  }
  const drillName = computed(() => (nav.drill ? elementName(nav.drill.elementId) : ''))

  const modelId = computed(() => snapshot.value.modelId || props.scopeId || '')

  const refreshLiveFingerprint = async () => {
    liveFingerprint.value = await fetchLiveFingerprint(dtUtils, modelId.value)
  }

  // Refresh the live coverage facts for the current model (degrades to null if the
  // coverage-tools field is absent — never throws into the lifecycle path).
  const refreshCoverage = async () => {
    coverageData.value = await fetchGradedCoverage(dtUtils, modelId.value)
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
      // A fresh snapshot supersedes any optimistic overlays (it already includes the
      // dispositions they reflected) — drop them so we don't double-apply.
      clearOverlays()
      if (generating.value) {
        await refreshLiveFingerprint()
        // The model changed; refresh coverage too so the coverage matrix + posture block
        // reflect the just-generated snapshot (fire-and-forget — not gate-bearing).
        refreshCoverage()
        releaseGate()
      }
    },
  )

  // Export the current snapshot (JSON or self-contained HTML). Dedupe elements so a
  // duplicated source node never inflates the exported artefact's totals either.
  const handleExport = (format) => {
    // The export is the pristine point-in-time snapshot AS GENERATED. While optimistic
    // edits are pending (liveEditCount > 0) the on-screen ledger diverges from it, so
    // exporting would silently disagree with the screen under the same generatedAt /
    // fingerprint. Gate it behind Recreate (the buttons are disabled too) rather than
    // bake un-generated edits into a shareable artefact.
    if (liveEditCount.value > 0) return
    const raw = props.content?.threat_report_dashboard ?? {}
    const doc = { ...raw, ledger: dedupeLedgerElements(raw.ledger ?? []) }
    if (format === 'json') exportJson(doc, coverageData.value)
    else exportHtml(doc, coverageData.value)
  }

  // ---- Finding lifecycle actions -------------------------------------------------
  // The module owns no write path: each action routes through a centralized host
  // service (the SAME flowStore→dt-core mutation the dt-ui exposures tab calls, so
  // behaviour can't drift). A successful mutation changes the model, so we re-check
  // the live fingerprint — the ledger then reads Stale and the user Recreates to
  // fold the change into a fresh snapshot. findingType is always 'EXPOSURE' (every
  // ledger finding is an Exposure via HAS_EXPOSURE, regardless of host element).

  const notify = (color, message, opts = {}) => {
    snackBar.value = { show: true, color, message, timeout: opts.timeout, action: opts.action ?? null }
  }

  // Dispose (and Edit-disposition / stale Review-as-dispose) via the platform dialog.
  const handleDispose = async ({ finding } = {}) => {
    if (!openDispositionDialog || !finding) return
    try {
      const result = await openDispositionDialog({ finding, findingType: 'EXPOSURE' })
      if (result && result.success) applyDispositionResult(result)
    } catch (err) {
      console.error('[threat-report] dispose failed:', err)
    }
  }

  // Add-note / re-affirm via the affirm-locked dialog (kind pinned to AFFIRMED).
  const handleAddNote = async ({ finding } = {}) => {
    if (!openDispositionDialog || !finding) return
    try {
      const result = await openDispositionDialog({ finding, findingType: 'EXPOSURE', mode: 'affirm' })
      if (result && result.success) applyDispositionResult(result)
    } catch (err) {
      console.error('[threat-report] affirm-edit failed:', err)
    }
  }

  // One-click affirm: confirm a pending finding is a real, live risk. Awaits the
  // mutation and only refreshes on success — a success:false stays pending (no false
  // confirmation). Undo clears back to pending.
  const handleAffirm = async ({ finding } = {}) => {
    if (!affirmFinding || !finding) return
    try {
      const result = await affirmFinding({ finding })
      if (!result?.success) {
        notify('error', `Couldn't affirm "${finding.name}".`)
        return
      }
      applyDispositionResult(result)
      notify('success', `Affirmed "${finding.name}" as a live risk.`, {
        timeout: 6000,
        action: {
          label: 'Undo',
          handler: async () => {
            const undo = await clearFindingDisposition?.({ finding })
            if (undo?.success) applyDispositionResult(undo)
            else notify('error', `Couldn't undo — "${finding.name}" is still affirmed.`)
          },
        },
      })
    } catch (err) {
      console.error('[threat-report] affirm failed:', err)
      notify('error', `Couldn't affirm "${finding.name}".`)
    }
  }

  // Supersede: create a USER-editable copy + mark the SYSTEM original SUPERSEDED.
  // Unlike the re-disposition actions, this INTRODUCES a new finding (the copy), which
  // can't be synthesised into the ledger locally — so we optimistically move the
  // original to its SUPERSEDED state (out of the open list) but DO mark the snapshot
  // stale so the user Recreates to see + edit the new copy.
  const handleSupersede = async ({ finding, elementId } = {}) => {
    if (!supersedeFinding || !finding) return
    try {
      const { systemDispositionResult } = await supersedeFinding({ finding, elementId })
      if (!systemDispositionResult?.success) {
        notify('warning', `Created your editable copy of "${finding.name}", but marking the original superseded failed — dispose it manually from its actions.`, { timeout: 8000 })
      } else {
        applyDispositionResult(systemDispositionResult)
        notify('success', `Created your editable copy of "${finding.name}". Recreate to see and edit it.`)
      }
      await refreshLiveFingerprint()
    } catch (err) {
      console.error('[threat-report] supersede failed:', err)
      notify('error', `Supersede failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  // Delete a USER-authored finding (the leaf confirmed in place first). Optimistically
  // drop the row — no stale dim.
  const handleDelete = async ({ finding } = {}) => {
    if (!deleteFinding || !finding) return
    try {
      const ok = await deleteFinding({ finding })
      if (ok) {
        deletedFindingIds.add(finding.id)
        notify('success', `Deleted "${finding.name}".`)
      } else {
        notify('error', `Couldn't delete "${finding.name}".`)
      }
    } catch (err) {
      console.error('[threat-report] delete failed:', err)
      notify('error', `Couldn't delete "${finding.name}".`)
    }
  }

  // Open the full finding→issue workflow: the host shows the IssueSelector menu —
  // "Add to Issue board" (copy + navigate) AND one entry per issue class that creates
  // a real issue attached to the element. The host owns all issue logic (no drift);
  // we only resolve the element label for the "<Finding> Issue on <label>" name.
  const handleIssue = ({ finding, elementId } = {}) => {
    if (!finding) return
    if (!openFindingIssueSelector) return // host doesn't expose the workflow (older build)
    const el = (snapshot.value.ledger ?? []).find((e) => e?.id === elementId)
    const elementLabel = el?.name ?? ''
    openFindingIssueSelector({ finding, elementId, modelId: modelId.value, elementLabel })
  }

  onMounted(() => {
    // Fresh mount: reset nav to the Posture Summary default, clear any leftover singleton
    // state, then establish freshness.
    apply(defaultNavState())
    generating.value = false
    refreshLiveFingerprint()
    refreshCoverage()
  })

  onUnmounted(() => {
    // Make the module singletons self-healing regardless of mount strategy: a
    // stranded `generating` from this instance must not bleed into the next.
    releaseGate()
  })
</script>

<style scoped>
  .threat-report-shell {
    padding: 1.5rem;
    /* The host analysis-results content area is fixed-height + overflow:hidden, so
       the report owns its own scroll. App-shell layout: the chrome (title, banner,
       tabs) is pinned and the active VIEW is the single vertical scroller — no
       outer page-scroll stacking on top of an inner table-scroll (one scroll, not
       two). */
    height: 100%;
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  /* Snapshot region fills below the pinned title + banner; its own children
     (actions, tabs, breadcrumb) stay fixed and the view flexes to fill. flex-basis
     0 so the scroller takes exactly the leftover space and never inflates its
     content height into shrink pressure on its siblings. */
  .trd-snapshot {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* Pinned chrome rows — never grow or shrink (their natural height). Explicit
     because .trd-tabs has overflow:hidden, which would otherwise give it an
     automatic flex min-size of 0 and let it be crushed when the view is long. */
  .trd-actions,
  .trd-tabs,
  .trd-breadcrumb {
    flex: 0 0 auto;
  }
  /* The ONE vertical scroller. A long view (posture, ledger, profile) scrolls
     here; the coverage matrix instead fills this height and scrolls internally,
     so neither stacks a second scrollbar on the page. basis 0 = take the leftover. */
  .trd-view {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .trd-title {
    margin: 0 0 1rem;
  }
  .trd-error {
    color: #c0392b;
    margin: 0 0 1rem;
  }
  .trd-snapshot--stale {
    opacity: 0.55;
  }
  /* Non-blocking "live edits since generation" note — informative, not alarming. */
  .trd-edited-note {
    font-size: 0.78rem;
    opacity: 0.85;
    margin: 0 0 0.75rem;
    padding: 0.4rem 0.7rem;
    border-left: 3px solid #0892ad;
    background: rgba(0, 184, 212, 0.07);
    border-radius: 3px;
    line-height: 1.4;
  }
  .trd-edited-recreate {
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0 7px;
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
    color: #0892ad;
  }
  .trd-edited-recreate:hover:not(:disabled) { background: rgba(0, 184, 212, 0.12); }
  .trd-edited-recreate:disabled { opacity: 0.5; cursor: default; }
  .trd-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .trd-meta {
    font-size: 0.8rem;
    opacity: 0.65;
  }
  .trd-export {
    display: flex;
    gap: 0.5rem;
  }
  .trd-export-btn {
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 0.3rem 0.8rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    opacity: 0.8;
  }
  .trd-export-btn:hover:not(:disabled) {
    opacity: 1;
  }
  .trd-export-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Segmented control */
  .trd-tabs {
    display: inline-flex;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 0.8rem;
  }
  .trd-tab {
    background: transparent;
    border: none;
    border-right: 1px solid rgba(127, 127, 127, 0.25);
    padding: 0.4rem 0.9rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    opacity: 0.75;
  }
  .trd-tab:last-child { border-right: none; }
  .trd-tab:hover { background: rgba(127, 127, 127, 0.08); opacity: 1; }
  .trd-tab--active {
    background: rgba(0, 184, 212, 0.12);
    opacity: 1;
    font-weight: 600;
    box-shadow: inset 0 -2px 0 0 #00b8d4;
  }
  .trd-tab:focus-visible { outline: 2px solid #00b8d4; outline-offset: -2px; }

  /* Breadcrumb (drill trail / filter chips) */
  .trd-breadcrumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.8rem;
    font-size: 0.82rem;
  }
  .trd-crumb-sep { opacity: 0.5; }
  .trd-crumb-current { font-weight: 600; }
  .trd-chip-x {
    background: none; border: none; padding: 0 0 0 0.3rem; font: inherit;
    color: inherit; cursor: pointer; opacity: 0.7;
  }
  .trd-chip-x:hover { opacity: 1; }
  .trd-chip {
    display: inline-flex; align-items: center;
    border: 1px solid rgba(127, 127, 127, 0.4); border-radius: 12px;
    padding: 0.05rem 0.5rem; font-size: 0.78rem;
  }

  /* Component Profile drill dialog header — a muted eyebrow + the element name, so the dialog
     is self-labelling without duplicating the profile's own rich header. */
  .trd-dialog-head {
    gap: 0.55rem;
    flex-wrap: wrap;
  }
  .trd-dialog-eyebrow {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.55;
    font-weight: 600;
  }
  .trd-dialog-title {
    font-size: 1rem;
    font-weight: 600;
  }

  .trd-empty {
    opacity: 0.8;
  }
  .trd-hint {
    opacity: 0.6;
    font-size: 0.9rem;
  }
</style>
