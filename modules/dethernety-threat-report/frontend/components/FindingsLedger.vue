<!--
  FindingsLedger.vue — the ④ Residual-Risk / Disposition ledger view.

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
        <strong>{{ totals.dispositioned }}</strong> reviewed
        <span v-if="totals.live > 0 && totals.dispositioned === 0" class="trd-untriaged">
          — none reviewed yet
        </span>
        <span v-if="totals.stale > 0" class="trd-stale-count">· {{ totals.stale }} stale</span>
      </span>
      <span class="trd-bands">
        <span class="trd-bands-label">by score band:</span>
        <span
          v-for="b in presentBands"
          :key="b"
          class="trd-band"
          :class="`trd-band--${b}`"
        >{{ b }} {{ totals.byBand[b] }}</span>
      </span>
      <span class="trd-prov">USER {{ totals.byProvenance.USER }} · SYSTEM {{ totals.byProvenance.SYSTEM }}</span>
    </div>

    <!-- On-artifact caveat (survives screenshotting; mirrors the export footer). -->
    <p class="trd-caveat">
      Modeled posture as of generation — not a live or deployed-state scan. Findings are
      <strong>not</strong> rolled into a single risk score and no coverage percentage is implied; the score
      band (0–10) orders findings for triage, it is not a risk rating. “Stale” marks a disposition whose
      instantiation attributes changed since it was authored (topology/edge changes are not tracked here).
    </p>

    <!-- Empty state: no findings at all -->
    <p v-if="totals.findings === 0" class="trd-empty">
      No findings in this model.
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
        <span class="trd-group-counts">{{ g.liveCount }} open · {{ g.dispositionedCount }} reviewed</span>
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
        view is a later sprint.
      </p>
      <p v-if="g.compensatingClaimNoControl" class="trd-inconsistent">
        ⚠ Compensating-control disposition on an element with no control present.
      </p>
      <!-- ④ killer ②-route cross-ref (group-level, visible before the reviewed
           partition is expanded). Louder when a disposition here is stale. -->
      <p
        v-if="reachability && g.dispositionedCount > 0 && onRoute(g.id)"
        class="trd-route-xref"
        :class="{ 'trd-route-xref--stale': groupHasStaleDisposition(g) }"
      >
        ‼ {{ g.dispositionedCount }} reviewed finding{{ g.dispositionedCount === 1 ? '' : 's' }} here sit on a
        crown-jewel route to <strong>{{ routeJewels(g.id).join(', ') }}</strong> —
        <button type="button" class="trd-linkbtn" @click="openReachability">view in ② ↗</button>
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
            <td class="trd-c-name">{{ f.name }}</td>
            <td class="trd-c-vector">{{ f.attackVector || '—' }}</td>
            <td class="trd-c-prov" :title="f.provenance">{{ f.provenance }}</td>
            <td class="trd-c-act">
              <button v-if="canDispose" type="button" class="trd-review" @click="$emit('dispose', f)">Review →</button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Dispositioned (muted, never dropped; with who / when / why) -->
      <details v-if="g.dispositioned.length" class="trd-disposed">
        <summary>{{ g.dispositionedCount }} reviewed</summary>
        <table class="trd-table trd-table--muted">
          <tbody>
            <tr v-for="f in g.dispositioned" :key="f.id" :class="{ 'trd-row-stale': f.stale }">
              <td class="trd-c-band"><span class="trd-band" :class="`trd-band--${f.band}`">{{ f.band }}</span></td>
              <td class="trd-c-score">{{ f.score == null ? '—' : f.score }}</td>
              <td class="trd-c-name">
                {{ f.name }}
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
                    ‼ ALSO on crown-jewel route to {{ routeJewels(g.id).join(', ') }} (②)<span v-if="f.stale"> — louder: this disposition is stale</span>
                  </div>
                </div>
              </td>
              <td class="trd-c-vector">{{ f.attackVector || '—' }}</td>
              <td class="trd-c-prov" :title="f.provenance">{{ f.provenance }}</td>
              <td class="trd-c-act">
                <button v-if="canDispose" type="button" class="trd-review" @click="$emit('dispose', f)">Edit →</button>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  </div>
</template>

<script setup>
  import { computed } from 'vue'
  import { aggregateLedger, dispositionKindLabel } from '../lib/aggregateLedger.js'
  import { buildCoverageView } from '../lib/coverageMatrix.js'

  const props = defineProps({
    // The snapshot doc's `ledger` (LedgerElement[]).
    ledger: { type: Array, default: () => [] },
    // Whether the host exposes the disposition opener; when false, the Review/Edit
    // affordance is hidden rather than rendered as a silent no-op.
    canDispose: { type: Boolean, default: false },
    // Optional deep-link filter from ⑤ (P1: { band?, live? }). When set, findings
    // not matching are hidden and emptied groups dropped; the totals row stays
    // whole-model (the breadcrumb chip in the shell conveys the active filter).
    filter: { type: Object, default: null },
    // Live graded-coverage facts (or null) — drives the ④ configured-mismatch
    // signal (a supporting control covering none of an element's modeled threats).
    coverage: { type: Object, default: null },
    // The ② mode-A (external entry) reachability rollup — drives the killer
    // cross-ref: a dispositioned finding on an element that ALSO sits on a
    // crown-jewel route. A visibility JOIN, not a score (no double-penalisation).
    reachability: { type: Object, default: null },
  })

  const emit = defineEmits(['dispose', 'drill', 'navigate'])

  const bandOrder = ['critical', 'high', 'medium', 'low', 'unknown']
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

  // ④ configured-mismatch: controls supporting an element but covering none of its
  // modeled-threat gaps (from the live coverage facts). Absent coverage ⇒ no flags.
  const mismatchByElement = computed(() => {
    if (!props.coverage) return {}
    return buildCoverageView(props.coverage, props.ledger).mismatchByElement ?? {}
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

  // ④ killer ②-route cross-ref: the jewel name(s) this element leads to on a
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

  // Apply the optional ⑤ deep-link filter: band-match across both partitions, and
  // `live: true` hides the dispositioned partition. Drop groups left empty.
  const matchBand = (f) => !props.filter?.band || f.band === props.filter.band
  const visibleGroups = computed(() => {
    const flt = props.filter
    if (!flt || (!flt.band && !flt.live)) return groups.value
    const out = []
    for (const g of groups.value) {
      const live = g.live.filter(matchBand)
      const dispositioned = flt.live ? [] : g.dispositioned.filter(matchBand)
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
  .trd-prov { font-size: 0.8rem; opacity: 0.7; margin-left: auto; }
  .trd-bands { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .trd-bands-label { font-size: 0.75rem; opacity: 0.6; }
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
  /* Element name is the drill affordance into ⑥ — a link, not a button chrome. */
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
  /* ④ killer ②-route cross-ref — a visibility join, louder (saturated) only when
     the disposition guarding the route is stale. */
  .trd-route-xref { font-size: 0.8rem; color: #b9651b; margin: 0.2rem 0 0.4rem; line-height: 1.4; }
  .trd-route-xref--stale { color: #c0392b; font-weight: 600; }
  .trd-route-xref-row { font-size: 0.72rem; color: #b9651b; margin-top: 0.15rem; }
  .trd-linkbtn {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    text-decoration: underline; cursor: pointer; opacity: 0.85;
  }
  .trd-linkbtn:hover { opacity: 1; }
  .trd-table { border-collapse: collapse; width: 100%; }
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
  .trd-c-vector { font-size: 0.75rem; opacity: 0.7; white-space: nowrap; }
  .trd-c-prov { font-size: 0.72rem; opacity: 0.7; }
  .trd-c-act { width: 5rem; text-align: right; }
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
</style>
