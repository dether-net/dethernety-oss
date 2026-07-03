<!--
  FindingsLedger.vue — the Residual-Risk / Disposition ledger view.

  Presentational: it aggregates the snapshot doc's `ledger` (pure TS,
  aggregateLedger) and renders findings grouped by element, partitioned open vs
  dispositioned. It owns no data access and no write path — a per-row "Review"
  EMITS `dispose(finding)`; the parent routes that to the platform's real
  disposition dialog (via the host opener).

  Honesty contracts: dispositioned findings are never dropped (muted partition,
  with who/when/why); the score band is a TRIAGE SORT-AID, not a risk rating
  (caption + outlined chips, never a solid stoplight); stale dispositions get a
  warning border; USER/SYSTEM provenance is shown; no single risk score, no
  coverage %, no "Covered: N". Controls render as muted "present" context, never
  a coverage claim; a compensating-control claim with no control present on the
  element is flagged as an auditable inconsistency.
-->
<template>
  <div class="trd-ledger">
    <!-- Summary (defensible facts first; band breakdown explicitly labeled as a
         score grouping, not a risk count) -->
    <div class="trd-summary">
      <span class="trd-sum-main">
        <strong>{{ totals.findings }}</strong> findings ·
        <strong>{{ totals.live }}</strong> open ·
        <strong>{{ totals.dispositioned }}</strong> dispositioned
        <span v-if="totals.live > 0 && totals.dispositioned === 0" class="trd-untriaged">
          — none dispositioned yet
        </span>
        <span v-if="totals.stale > 0" class="trd-stale-count">· {{ totals.stale }} stale</span>
      </span>
    </div>

    <!-- In-view facet filter bar (band · source · element type). Each facet is a
         single-select toggle that AND-combines with the others and shows as a
         removable breadcrumb chip above. Counts are whole-model totals. -->
    <div v-if="totals.findings > 0" class="trd-filterbar" role="group" aria-label="Filter findings">
      <span class="trd-fb-label">Filter</span>
      <span class="trd-fb-group">
        <button
          v-for="b in presentBands"
          :key="b"
          type="button"
          class="trd-fb-chip trd-fb-band"
          :class="[`trd-band--${b}`, { 'trd-fb-chip--on': isBandActive(b) }]"
          :aria-pressed="isBandActive(b)"
          @click="toggleBand(b)"
        >{{ bandLabel(b) }} <span class="trd-fb-count">{{ totals.byBand[b] || 0 }}</span></button>
      </span>
      <span class="trd-fb-sep" aria-hidden="true">·</span>
      <span class="trd-fb-group">
        <button type="button" class="trd-fb-chip" :class="{ 'trd-fb-chip--on': isProvActive('USER') }" :aria-pressed="isProvActive('USER')" @click="toggleProv('USER')">
          User <span class="trd-fb-count">{{ totals.byProvenance.USER }}</span>
        </button>
        <button type="button" class="trd-fb-chip" :class="{ 'trd-fb-chip--on': isProvActive('SYSTEM') }" :aria-pressed="isProvActive('SYSTEM')" @click="toggleProv('SYSTEM')">
          System <span class="trd-fb-count">{{ totals.byProvenance.SYSTEM }}</span>
        </button>
      </span>
      <span class="trd-fb-sep" aria-hidden="true">·</span>
      <span class="trd-fb-group">
        <button type="button" class="trd-fb-chip" :class="{ 'trd-fb-chip--on': isLifecycleActive('pending') }" :aria-pressed="isLifecycleActive('pending')" @click="toggleLifecycle('pending')">
          Not reviewed <span class="trd-fb-count">{{ totals.byLifecycle.pending }}</span>
        </button>
        <button type="button" class="trd-fb-chip" :class="{ 'trd-fb-chip--on': isLifecycleActive('confirmed') }" :aria-pressed="isLifecycleActive('confirmed')" @click="toggleLifecycle('confirmed')">
          Confirmed <span class="trd-fb-count">{{ totals.byLifecycle.confirmed }}</span>
        </button>
      </span>
      <span v-if="typeFacets.length" class="trd-fb-sep" aria-hidden="true">·</span>
      <span class="trd-fb-group">
        <button
          v-for="t in typeFacets"
          :key="t.value"
          type="button"
          class="trd-fb-chip"
          :class="{ 'trd-fb-chip--on': isTypeActive(t.value) }"
          :aria-pressed="isTypeActive(t.value)"
          @click="toggleType(t.value)"
        >{{ t.label }} <span class="trd-fb-count">{{ t.count }}</span></button>
      </span>
      <button v-if="anyFilterActive" type="button" class="trd-fb-clear" @click="clearAll">✕ clear</button>
    </div>

    <!-- On-artifact caveat (survives screenshotting; mirrors the export footer). -->
    <p class="trd-caveat">
      Modeled posture as of generation — not a live or deployed-state scan. Findings are
      <strong>not</strong> rolled into a single risk score and no coverage percentage is implied; the score
      band (0–10) orders findings for triage, it is not a risk rating. “Stale” marks a disposition whose
      instantiation attributes changed since it was authored (topology/edge changes are not tracked here).
    </p>

    <!-- Zoning advisories: per-boundary, un-scored (advisory/informational). Kept
         separate from the scored ledger — they order nothing and imply no coverage. -->
    <details v-if="advisories.length" class="trd-zadv">
      <summary>{{ advisoryCount }} zoning advisor{{ advisoryCount === 1 ? 'y' : 'ies' }} — per-boundary, advisory (not scored, not a coverage claim)</summary>
      <div v-for="grp in advisories" :key="grp.kind" class="trd-zadv-group">
        <p class="trd-zadv-kind">{{ grp.label }}</p>
        <p v-for="it in grp.items" :key="it.boundaryId" class="trd-zadv-item">
          <button type="button" class="trd-drill" @click="$emit('drill', it.boundaryId)" :title="`Open ${it.name} profile`">{{ it.name }}</button>
          <span v-if="it.detail" class="trd-zadv-detail">— {{ it.detail }}</span>
        </p>
      </div>
    </details>

    <!-- Empty state: no scored findings ("scored" because the un-scored zoning
         advisory block above may still be present). -->
    <p v-if="totals.findings === 0" class="trd-empty">
      No scored findings in this model.
    </p>
    <!-- Empty state: the active deep-link filter matched nothing -->
    <p v-else-if="visibleGroups.length === 0" class="trd-empty">
      No findings match the current filter.
    </p>

    <!-- Element groups -->
    <section v-for="g in visibleGroups" :key="g.id" class="trd-group">
      <h3 class="trd-group-head">
        <button type="button" class="trd-drill" @click="$emit('drill', g.id)" :title="`Open ${g.name} profile`">
          {{ g.name }}
        </button>
        <span class="trd-etype">{{ g.type }}</span>
        <span class="trd-group-counts">{{ g.liveCount }} open · {{ g.dispositionedCount }} dispositioned</span>
      </h3>

      <p v-if="g.supportingControls.length" class="trd-controls">
        Controls present ({{ g.supportingControls.length }}):
        <template v-for="(c, i) in orderedControls(g)" :key="c.id || c.name">
          <span :class="{ 'trd-ctl-mismatch': c.mismatched }" :title="c.mismatched ? 'Configured on this element but covers none of its modeled-threat techniques (configured-but-mismatched)' : 'Covers ≥1 of this element\'s modeled threats'">
            {{ c.name }}<span v-if="c.mismatched" class="trd-ctl-flag"> ⚠ mismatched</span></span><span v-if="i < orderedControls(g).length - 1">, </span>
        </template>
      </p>
      <p v-if="coverage && mismatchCount(g) > 0" class="trd-mismatch-note">
        ⚠ {{ mismatchCount(g) }} control(s) here are <strong>configured-but-mismatched</strong> — present on this
        element but pointed at threats it doesn’t model, while real gaps stay open. The full “other technique set”
        view is not modeled here.
      </p>
      <p v-if="g.compensatingClaimNoControl" class="trd-inconsistent">
        ⚠ Compensating-control disposition on an element with no control present.
      </p>
      <!-- Crown-jewel-route cross-ref (group-level, visible before the reviewed
           partition is expanded). Louder when a disposition here is stale. -->
      <p
        v-if="reachability && g.dispositionedCount > 0 && onRoute(g.id)"
        class="trd-route-xref"
        :class="{ 'trd-route-xref--stale': groupHasStaleDisposition(g) }"
      >
        ‼ {{ g.dispositionedCount }} dispositioned finding{{ g.dispositionedCount === 1 ? '' : 's' }} here sit on a
        crown-jewel route to <strong>{{ routeJewels(g.id).join(', ') }}</strong> —
        <button type="button" class="trd-linkbtn" @click="openReachability">view in Reachability ↗</button>
        <span v-if="groupHasStaleDisposition(g)" class="trd-muted"> · a stale disposition still guards a path to a high-value asset</span>
      </p>

      <!-- Open (live) findings -->
      <table v-if="g.live.length" class="trd-table">
        <thead>
          <tr>
            <th class="trd-c-band">Band</th>
            <th class="trd-c-score">Score</th>
            <th>Finding</th>
            <th class="trd-c-vector">Vector</th>
            <th class="trd-c-prov">Source</th>
            <th class="trd-c-act"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in g.live" :key="f.id">
            <td class="trd-c-band"><span class="trd-band" :class="`trd-band--${f.band}`">{{ f.band }}</span></td>
            <td class="trd-c-score">{{ f.score == null ? '—' : f.score }}</td>
            <td class="trd-c-name">
              <button type="button" class="trd-finding-name" @click="openDetail(f, g)" :title="`Open ${f.name} detail`">{{ f.name }}</button>
              <span v-if="chipFor(f)" class="trd-confirmed" :title="chipFor(f).title">{{ chipFor(f).text }}</span>
              <TechniqueChips
                v-if="techsFor(f.id).length"
                class="trd-tech-inline"
                dense
                :techniques="techsFor(f.id)"
                @show="infoTech = $event"
              />
            </td>
            <td class="trd-c-vector">{{ f.attackVector || '—' }}</td>
            <td class="trd-c-prov" :title="f.provenance">{{ f.provenance }}</td>
            <td class="trd-c-act">
              <FindingActions
                v-if="canDispose"
                :finding="f"
                :element-id="g.id"
                :can-dispose="canDispose"
                @affirm="$emit('affirm', $event)"
                @dispose="$emit('dispose', $event)"
                @supersede="$emit('supersede', $event)"
                @add-note="$emit('add-note', $event)"
                @delete="$emit('delete', $event)"
                @issue="$emit('issue', $event)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Dispositioned (muted, never dropped; with who / when / why) -->
      <details v-if="g.dispositioned.length" class="trd-disposed">
        <summary>{{ g.dispositionedCount }} dispositioned</summary>
        <table class="trd-table trd-table--muted">
          <tbody>
            <tr v-for="f in g.dispositioned" :key="f.id" :class="{ 'trd-row-stale': f.stale }">
              <td class="trd-c-band"><span class="trd-band" :class="`trd-band--${f.band}`">{{ f.band }}</span></td>
              <td class="trd-c-score">{{ f.score == null ? '—' : f.score }}</td>
              <td class="trd-c-name">
                <button type="button" class="trd-finding-name" @click="openDetail(f, g)" :title="`Open ${f.name} detail`">{{ f.name }}</button>
                <TechniqueChips
                  v-if="techsFor(f.id).length"
                  class="trd-tech-inline"
                  dense
                  :techniques="techsFor(f.id)"
                  @show="infoTech = $event"
                />
                <div class="trd-disp">
                  {{ kindLabel(f.dispositionKind) }}<span v-if="f.stale" class="trd-stale"> · ⚠ stale</span>
                  <span v-if="f.dispositionedBy || f.dispositionedAt" class="trd-disp-by">
                    · {{ f.dispositionedBy || 'unknown' }}{{ f.dispositionedAt ? ' · ' + formatTs(f.dispositionedAt) : '' }}
                  </span>
                  <div v-if="f.dispositionReason" class="trd-reason">{{ f.dispositionReason }}</div>
                  <div
                    v-if="reachability && onRoute(g.id)"
                    class="trd-route-xref-row"
                    :class="{ 'trd-route-xref--stale': f.stale }"
                  >
                    ‼ ALSO on crown-jewel route to {{ routeJewels(g.id).join(', ') }} (see Reachability)<span v-if="f.stale"> — louder: this disposition is stale</span>
                  </div>
                </div>
              </td>
              <td class="trd-c-vector">{{ f.attackVector || '—' }}</td>
              <td class="trd-c-prov" :title="f.provenance">{{ f.provenance }}</td>
              <td class="trd-c-act">
                <FindingActions
                  v-if="canDispose"
                  :finding="f"
                  :element-id="g.id"
                  :can-dispose="canDispose"
                  @affirm="$emit('affirm', $event)"
                  @dispose="$emit('dispose', $event)"
                  @supersede="$emit('supersede', $event)"
                  @add-note="$emit('add-note', $event)"
                  @delete="$emit('delete', $event)"
                  @issue="$emit('issue', $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>

    <!-- Shared ATT&CK technique dialog (same as Coverage & Gaps and Component Profile) — opened by a chip. -->
    <TechniqueInfoDialog :technique="infoTech" @close="infoTech = null" />
    <!-- Shared Exposure Detail dialog — opened by clicking a finding name. -->
    <ExposureDetailDialog
      :exposure="detailExposure"
      @close="detailExposure = null"
      @drill="(id) => { detailExposure = null; $emit('drill', id) }"
    />
  </div>
</template>

<script setup>
  import { computed, ref } from 'vue'
  import { aggregateLedger, dispositionKindLabel } from '../lib/aggregateLedger.js'
  import { lifecycleChipFor } from '../lib/findingActions.js'
  import { buildCoverageView } from '../lib/coverageMatrix.js'
  import { buildExposureDetail } from '../lib/exposureDetail.js'
  import { zoningAdvisories } from '../lib/zoningPolicy.js'
  import TechniqueChips from './TechniqueChips.vue'
  import TechniqueInfoDialog from './TechniqueInfoDialog.vue'
  import ExposureDetailDialog from './ExposureDetailDialog.vue'
  import FindingActions from './FindingActions.vue'

  const props = defineProps({
    // The snapshot doc's `ledger` (LedgerElement[]).
    ledger: { type: Array, default: () => [] },
    // Whether the host exposes the disposition opener; when false, the Review/Edit
    // affordance is hidden rather than rendered as a silent no-op.
    canDispose: { type: Boolean, default: false },
    // Optional deep-link filter from the Posture Summary ({ band?, live? }). When set, findings
    // not matching are hidden and emptied groups dropped; the totals row stays
    // whole-model (the breadcrumb chip in the shell conveys the active filter).
    filter: { type: Object, default: null },
    // Live graded-coverage facts (or null) — drives the configured-mismatch
    // signal (a supporting control covering none of an element's modeled threats).
    coverage: { type: Object, default: null },
    // The pre-built coverage view from the shell (built once, shared). When
    // absent (standalone use) this component builds it from coverage + ledger.
    coverageView: { type: Object, default: null },
    // The mode-A (external entry) reachability rollup — drives the killer
    // cross-ref: a dispositioned finding on an element that ALSO sits on a
    // crown-jewel route. A visibility JOIN, not a score (no double-penalisation).
    reachability: { type: Object, default: null },
    // exposureId → resolved ATT&CK techniques (buildExposureTechniqueIndex over the
    // live coverage facts). Empty when coverage-tools isn't deployed → no chips.
    techniqueIndex: { type: Object, default: () => ({}) },
    // The snapshot zoning block — its per-boundary advisory findings (unclassified /
    // under-protected / mgmt-plane / cross-tier-domain) render as a compact un-scored
    // advisory block here (they are per-boundary, not per per-flow like the crossings).
    zoning: { type: Object, default: () => ({ findings: [], effectiveZones: {} }) },
    // The snapshot modelGraph — used only to resolve boundary names for the zoning
    // advisory block.
    modelGraph: { type: Object, default: () => ({ boundaries: [] }) },
  })

  const emit = defineEmits(['dispose', 'affirm', 'supersede', 'add-note', 'delete', 'issue', 'drill', 'navigate'])

  // Per-boundary zoning advisories (un-scored) — grouped for the compact block.
  const advisories = computed(() => zoningAdvisories(props.zoning, props.modelGraph))
  const advisoryCount = computed(() => advisories.value.reduce((n, g) => n + g.items.length, 0))

  // Inline lifecycle chip for a live row (only an AFFIRMED-confirmed finding earns
  // one) — so an affirmed finding in the open table is no longer indistinguishable
  // from an un-triaged one.
  const chipFor = lifecycleChipFor

  const bandOrder = ['critical', 'high', 'medium', 'low', 'unknown']
  const bandLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' }
  const bandLabel = (b) => bandLabels[b] ?? b
  const typeOrder = ['Component', 'Data', 'SecurityBoundary', 'DataFlow']
  const typeLabels = { Component: 'Component', Data: 'Data', SecurityBoundary: 'Boundary', DataFlow: 'Data Flow' }
  const typeLabel = (t) => typeLabels[t] ?? t
  const kindLabel = dispositionKindLabel

  const formatTs = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
  }

  const aggregation = computed(() => aggregateLedger(props.ledger))
  const totals = computed(() => aggregation.value.totals)
  const groups = computed(() => aggregation.value.groups)
  const presentBands = computed(() => bandOrder.filter((b) => totals.value.byBand[b]))

  // --- in-view facet filtering (band · source · element type) ----------------
  // Each facet is a removable breadcrumb chip in the shell; clicking a chip here
  // toggles it (single-select per facet, AND-combined). Counts are whole-model
  // totals — the bar is a SELECTOR, not a live faceted recount.
  const typeFacets = computed(() => {
    const counts = {}
    for (const g of groups.value) counts[g.type] = (counts[g.type] ?? 0) + g.liveCount + g.dispositionedCount
    return typeOrder.filter((t) => counts[t]).map((t) => ({ value: t, label: typeLabel(t), count: counts[t] }))
  })
  const isBandActive = (b) => props.filter?.band === b
  const isProvActive = (p) => props.filter?.provenance === p
  const isTypeActive = (t) => props.filter?.elementType === t
  const isLifecycleActive = (l) => props.filter?.lifecycle === l
  const anyFilterActive = computed(
    () => !!(props.filter && (props.filter.band || props.filter.live || props.filter.provenance || props.filter.elementType || props.filter.lifecycle)),
  )
  // The lifecycle facet labels: 'pending' reads as "Not reviewed" (the triage
  // backlog), 'confirmed' as "Confirmed" (reviewed & kept live). Both are LIVE
  // states, so selecting one narrows the open set and empties the dispositioned
  // partition (disposed findings are neither).
  const lifecycleLabels = { pending: 'Not reviewed', confirmed: 'Confirmed' }
  const toggleBand = (b) =>
    emit('navigate', { type: 'toggle-filter', filter: { key: 'band', type: 'band', value: b, label: `band: ${bandLabel(b)}` } })
  const toggleProv = (p) =>
    emit('navigate', { type: 'toggle-filter', filter: { key: 'provenance', type: 'provenance', value: p, label: `source: ${p === 'USER' ? 'User' : 'System'}` } })
  const toggleType = (t) =>
    emit('navigate', { type: 'toggle-filter', filter: { key: 'type', type: 'type', value: t, label: `type: ${typeLabel(t)}` } })
  const toggleLifecycle = (l) =>
    emit('navigate', { type: 'toggle-filter', filter: { key: 'lifecycle', type: 'lifecycle', value: l, label: `status: ${lifecycleLabels[l] ?? l}` } })
  const clearAll = () => emit('navigate', { type: 'clear-filters' })

  // The coverage honesty view — the shell's shared build when provided, otherwise
  // built once here. Read by the mismatch derivation below (built at most once).
  const view = computed(() => props.coverageView ?? buildCoverageView(props.coverage, props.ledger))

  // Configured-mismatch: controls supporting an element but covering none of its
  // modeled-threat gaps (from the live coverage facts). Absent coverage ⇒ no flags.
  const mismatchByElement = computed(() => {
    if (!props.coverage) return {}
    return view.value.mismatchByElement ?? {}
  })
  const mismatchSet = (g) => new Set(mismatchByElement.value[g.id] ?? [])
  const mismatchCount = (g) => mismatchSet(g).size
  // Supporting controls with the mismatch flag, MISMATCHED sorted to the top.
  const orderedControls = (g) => {
    const m = mismatchSet(g)
    return [...g.supportingControls]
      .map((c) => ({ ...c, mismatched: m.has(c.id) }))
      .sort((a, b) => (b.mismatched ? 1 : 0) - (a.mismatched ? 1 : 0))
  }

  // Crown-jewel-route cross-ref: the jewel name(s) this element leads to on a
  // reachable crown-jewel route (element-keyed join from mode-A). A visibility
  // join — surfacing "you accepted this, and it still sits on a path to a high-
  // value asset" — never a score. routeElementToJewels is an in-memory Map (Set).
  const routeJewels = (id) => {
    const m = props.reachability?.routeElementToJewels
    if (!m || typeof m.get !== 'function') return []
    return [...(m.get(id) ?? [])]
  }
  const onRoute = (id) => routeJewels(id).length > 0
  const groupHasStaleDisposition = (g) => g.dispositioned.some((f) => f.stale)
  const openReachability = () => emit('navigate', { type: 'view', view: 'reachability' })

  // Resolved ATT&CK techniques for a finding (by exposure id) + the shared dialog.
  const techsFor = (id) => props.techniqueIndex[id] ?? []
  const infoTech = ref(null)

  // The shared Exposure Detail dialog — click a finding name to open its full
  // detail (description, mitigations, detection, refs, techniques, disposition).
  const detailExposure = ref(null)
  const openDetail = (f, g) => {
    detailExposure.value = buildExposureDetail(f, {
      techniques: techsFor(f.id),
      element: { id: g.id, name: g.name, type: g.type },
      routeJewels: routeJewels(g.id),
    })
  }

  // Apply the active filter (Posture Summary deep-link AND/OR the in-view facet bar): band +
  // provenance + lifecycle match individual findings; `live: true` hides the
  // dispositioned partition; elementType matches the whole group. Drop groups left
  // empty. A lifecycle facet ('pending'/'confirmed') is a LIVE-only state, so it
  // also drops the dispositioned partition (those findings are 'disposed').
  const matchFinding = (f) => {
    if (props.filter?.band && f.band !== props.filter.band) return false
    if (props.filter?.provenance && f.provenance !== props.filter.provenance) return false
    if (props.filter?.lifecycle && f.lifecycle !== props.filter.lifecycle) return false
    return true
  }
  const visibleGroups = computed(() => {
    const flt = props.filter
    if (!flt || (!flt.band && !flt.live && !flt.provenance && !flt.elementType && !flt.lifecycle)) return groups.value
    const out = []
    for (const g of groups.value) {
      if (flt.elementType && g.type !== flt.elementType) continue
      const live = g.live.filter(matchFinding)
      const dispositioned = flt.live ? [] : g.dispositioned.filter(matchFinding)
      if (live.length === 0 && dispositioned.length === 0) continue
      out.push({ ...g, live, dispositioned, liveCount: live.length, dispositionedCount: dispositioned.length })
    }
    return out
  })
</script>

<style scoped>
  .trd-ledger { font-size: 0.9rem; }
  .trd-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
    padding: 0.6rem 0.8rem;
    background: rgba(127, 127, 127, 0.08);
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }
  .trd-untriaged { opacity: 0.7; }
  .trd-stale-count { color: #c77700; font-weight: 600; }
  /* In-view facet filter bar (band · source · element type) */
  .trd-filterbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.4rem;
    margin: 0 0 0.8rem; font-size: 0.78rem;
  }
  .trd-fb-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.5; font-weight: 600; margin-right: 0.15rem; }
  .trd-fb-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }
  .trd-fb-sep { opacity: 0.35; }
  .trd-fb-chip {
    background: transparent; border: 1px solid rgba(127, 127, 127, 0.4); border-radius: 12px;
    padding: 0.1rem 0.6rem; font: inherit; font-size: 0.74rem; line-height: 1.5;
    color: inherit; cursor: pointer; opacity: 0.85;
  }
  .trd-fb-chip:hover { opacity: 1; border-color: rgba(127, 127, 127, 0.7); }
  .trd-fb-chip--on { background: rgba(0, 184, 212, 0.14); border-color: #00b8d4; opacity: 1; font-weight: 600; }
  .trd-fb-chip:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  /* band facets carry their band hue on the text (via .trd-band--*), neutral frame */
  .trd-fb-count { opacity: 0.6; font-variant-numeric: tabular-nums; }
  .trd-fb-clear {
    background: none; border: none; padding: 0.1rem 0.4rem; font: inherit; font-size: 0.74rem;
    color: inherit; cursor: pointer; opacity: 0.7;
    text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
  }
  .trd-fb-clear:hover { opacity: 1; }
  /* Outlined, low-saturation chips: a label/sort-aid, NOT a solid stoplight. */
  .trd-band {
    display: inline-block;
    border: 1px solid currentColor;
    border-radius: 10px;
    padding: 0 7px;
    font-size: 0.72rem;
    text-transform: capitalize;
    background: transparent;
  }
  .trd-band--critical { color: #c0392b; }
  .trd-band--high { color: #b9651b; }
  .trd-band--medium { color: #8a7400; }
  .trd-band--low { color: #5f6a6a; }
  .trd-band--unknown { color: #7f8c8d; }
  .trd-caveat {
    font-size: 0.75rem;
    opacity: 0.6;
    margin: 0 0 1rem;
    line-height: 1.4;
  }
  .trd-empty { opacity: 0.7; }
  .trd-group { margin-bottom: 1.5rem; }
  .trd-group-head { margin: 0 0 0.3rem; font-size: 1rem; }
  /* Element name is the drill affordance into the Component Profile — a link, not a button chrome. */
  .trd-drill {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 1rem;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .trd-drill:hover { text-decoration-style: solid; }
  .trd-etype {
    font-size: 0.7rem;
    font-weight: 400;
    opacity: 0.6;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .trd-group-counts { font-size: 0.75rem; opacity: 0.6; margin-left: 0.5rem; font-weight: 400; }
  .trd-controls { font-size: 0.8rem; color: #2e8b57; margin: 0.2rem 0; }
  .trd-ctl-mismatch { color: #c77700; }
  .trd-ctl-flag { font-size: 0.7rem; font-weight: 600; }
  .trd-mismatch-note { font-size: 0.78rem; color: #c77700; margin: 0.2rem 0 0.4rem; line-height: 1.4; }
  .trd-inconsistent { font-size: 0.8rem; color: #c77700; margin: 0.2rem 0; }
  /* Crown-jewel-route cross-ref — a visibility join, louder (saturated) only when
     the disposition guarding the route is stale. */
  .trd-route-xref { font-size: 0.8rem; color: #b9651b; margin: 0.2rem 0 0.4rem; line-height: 1.4; }
  .trd-route-xref--stale { color: #c0392b; font-weight: 600; }
  .trd-route-xref-row { font-size: 0.72rem; color: #b9651b; margin-top: 0.15rem; }
  .trd-linkbtn {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    text-decoration: underline; cursor: pointer; opacity: 0.85;
  }
  .trd-linkbtn:hover { opacity: 1; }
  /* table-layout:fixed + per-column widths so EVERY group table shares the same
     column geometry → the last three columns (Vector · Source · action) line up
     vertically across all the group tables. The Finding column takes the rest. */
  .trd-table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  /* border-box on BOTH cell types so a column's specified width is its actual
     rendered width (padding inside). Without this, the header table (th, treated
     border-box here) and the body-only reviewed tables (td, content-box) compute
     column widths 16px apart and the columns don't line up across tables. */
  .trd-table th,
  .trd-table td { box-sizing: border-box; }
  .trd-table th {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.5;
    font-weight: 600;
    padding: 0 8px 2px;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
  }
  .trd-table td { border-bottom: 1px solid rgba(127, 127, 127, 0.18); padding: 4px 8px; vertical-align: top; }
  .trd-table--muted { opacity: 0.62; }
  .trd-row-stale td { border-left: 3px solid #c77700; }
  .trd-c-band { width: 5rem; }
  .trd-c-score { width: 3rem; text-align: right; font-variant-numeric: tabular-nums; }
  .trd-c-vector { width: 7rem; font-size: 0.75rem; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* ATT&CK chips sit just under the finding name, inset slightly to read as a
     sub-line of the same cell. */
  .trd-tech-inline { margin-top: 0.2rem; }
  .trd-c-prov { width: 5rem; font-size: 0.72rem; opacity: 0.7; }
  .trd-c-act { width: 5rem; text-align: right; }
  /* The Finding column takes the remaining width (table-layout:fixed); long names
     + chips wrap inside it rather than widening the column. */
  .trd-c-name { overflow-wrap: anywhere; }
  /* The finding name is a button that opens the Exposure Detail dialog — styled as
     a text link so it reads as a name, not a control. */
  .trd-finding-name {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(127, 127, 127, 0.45);
    text-underline-offset: 2px;
  }
  .trd-finding-name:hover { text-decoration-color: #00b8d4; color: #00b8d4; }
  .trd-finding-name:focus-visible { outline: 2px solid #00b8d4; outline-offset: 2px; }
  /* Inline "Confirmed" lifecycle chip on a live row — risk-toned (an affirmed
     finding is still an open risk), outlined, never a solid stoplight, never green. */
  .trd-confirmed {
    display: inline-block;
    border: 1px solid #0892ad;
    color: #0892ad;
    border-radius: 10px;
    padding: 0 7px;
    margin-left: 0.4rem;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    vertical-align: middle;
  }
  .trd-disp { font-size: 0.75rem; opacity: 0.85; margin-top: 0.15rem; }
  .trd-disp-by { opacity: 0.7; }
  .trd-stale { color: #c77700; font-weight: 600; }
  .trd-reason { font-style: italic; opacity: 0.8; }
  .trd-disposed summary { cursor: pointer; font-size: 0.8rem; opacity: 0.7; margin: 0.3rem 0; }
  .trd-review {
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 1px 8px;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    opacity: 0.8;
  }
  .trd-review:hover { opacity: 1; }

  /* Zoning advisories — a muted, un-scored per-boundary block (no band, no score). */
  .trd-zadv {
    margin: 0 0 0.8rem; border: 1px dashed rgba(127, 127, 127, 0.3);
    border-radius: 4px; padding: 0.2rem 0.6rem;
  }
  .trd-zadv summary { cursor: pointer; font-size: 0.8rem; opacity: 0.8; margin: 0.3rem 0; }
  .trd-zadv-group { margin: 0.3rem 0 0.5rem; }
  .trd-zadv-kind { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; margin: 0.2rem 0; }
  .trd-zadv-item { font-size: 0.8rem; margin: 0.15rem 0 0.15rem 0.6rem; }
  .trd-zadv-detail { opacity: 0.7; }
</style>
