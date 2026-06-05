<!--
  PostureSummary.vue — the ⑤ Posture Summary view (the default landing surface).

  ⑤ is the ONLY aggregating view (tech §2.2). It rolls up the P1 engines
  (computePostureSummary over the ④ aggregator + the ③ crossing totals) into an
  at-a-glance posture, and EVERY stat is an in-component deep-link (a
  non-clickable number on a summary screen is a workflow dead-end — ux
  anti-pattern A). It emits `navigate` intents; the shell turns them into view
  switches / filters / drills.

  Honesty contracts (func §4, ux §8): the scope caveat rides ON the artifact
  (survives screenshotting); live-exposure bands are LIVE-only (null ⇒ unknown,
  never low); defense-in-depth is a SEPARATE positive line, never folded into
  coverage; NO single risk score, NO coverage %, NO "Covered: N", no charts. In
  P1 the COVERAGE block and the crown-jewel REACHABILITY tile are ABSENT (they
  need the P2 coverage/path engines) — not rendered as dead "coming soon" tiles.
-->
<template>
  <div class="trd-posture">
    <p class="trd-caveat">
      Modeled / design-asserted posture as of generation — <strong>not</strong> deployed telemetry or a live
      scan. Findings are <strong>not</strong> rolled into a single risk score and no coverage percentage is
      implied. The score band (0–10) orders exposures for triage; it is not a risk rating.
    </p>

    <!-- No elements in scope at all — honest, never a clean-green summary. -->
    <p v-if="!summary.hasElements" class="trd-empty">
      No in-scope elements in this model snapshot — nothing to summarise.
    </p>

    <template v-else>
      <!-- LIVE EXPOSURES — band tiles, each a deep-link into ④ filtered to that band. -->
      <section class="trd-block">
        <h4 class="trd-block-head">Live exposures</h4>
        <div v-if="summary.liveTotal > 0" class="trd-tiles">
          <button
            v-for="b in presentLiveBands"
            :key="b"
            type="button"
            class="trd-tile trd-tile--band"
            :class="`trd-band--${b}`"
            @click="emitBand(b)"
            :title="`Show ${b} open exposures in the Residual Risk ledger`"
          >
            <span class="trd-tile-num">{{ summary.liveBands[b] }}</span>
            <span class="trd-tile-label">{{ b }}</span>
          </button>
        </div>
        <p v-else class="trd-none">
          No open exposures.
          <span v-if="summary.hasAnyFindings">All {{ summary.disposition.reviewed }} finding(s) are dispositioned — see the review trail in Residual Risk.</span>
          <span v-else>No exposures are modeled on any in-scope element (this is a modeling state, not an all-clear).</span>
        </p>
      </section>

      <!-- DISPOSITION + BOUNDARY CROSSINGS — clickable stats. -->
      <section class="trd-block trd-statline">
        <button type="button" class="trd-stat" @click="emitOpenOnly" title="Show open (live) findings in the Residual Risk ledger">
          <strong>{{ summary.disposition.open }}</strong> open
        </button>
        <span class="trd-stat-sep">·</span>
        <button type="button" class="trd-stat" @click="emitView('residual')" title="Open the Residual Risk ledger">
          <strong>{{ summary.disposition.reviewed }}</strong> reviewed
        </button>
        <span v-if="summary.disposition.stale > 0" class="trd-stale">· ⚠ {{ summary.disposition.stale }} stale</span>
        <span v-if="summary.disposition.open > 0 && summary.disposition.reviewed === 0" class="trd-untriaged">· none reviewed yet</span>
        <span v-if="summary.disposition.compensatingNoControl > 0" class="trd-hollow" :title="'A disposition claims a compensating control, but no control is present on the element'">
          · ⚠ {{ summary.disposition.compensatingNoControl }} compensating-control claim{{ summary.disposition.compensatingNoControl === 1 ? '' : 's' }} with no control present
        </span>

        <template v-if="summary.boundaryCrossings">
          <span class="trd-stat-gap"></span>
          <button type="button" class="trd-stat" @click="emitView('boundary')" title="Open the Boundary Crossings ledger">
            <strong>{{ summary.boundaryCrossings.signalFlows }}</strong> boundary crossing{{ summary.boundaryCrossings.signalFlows === 1 ? '' : 's' }} carrying data or posture
          </button>
          <span v-if="summary.boundaryCrossings.underModeledFlows > 0" class="trd-muted">
            (+{{ summary.boundaryCrossings.underModeledFlows }} under-modeled)
          </span>
        </template>
      </section>

      <!-- DEFENSE-IN-DEPTH — a SEPARATE positive-signal line, never coverage. -->
      <p v-if="summary.defenseInDepth.controlCount > 0" class="trd-did">
        Defense-in-depth: <strong>{{ summary.defenseInDepth.controlCount }}</strong> control(s) present on
        {{ summary.defenseInDepth.elementCount }} element(s) with no modeled live exposure — a positive signal,
        <strong>not</strong> folded into any coverage measure.
      </p>

      <!-- TOP RESIDUAL RISKS — ranked, each row drills to ⑥. -->
      <section class="trd-block">
        <h4 class="trd-block-head">
          Top residual risks
          <span v-if="summary.residualTotal > summary.topResiduals.length" class="trd-muted">
            (top {{ summary.topResiduals.length }} of {{ summary.residualTotal }} — open the ledger for all)
          </span>
        </h4>
        <ol v-if="summary.topResiduals.length" class="trd-residuals">
          <li v-for="r in summary.topResiduals" :key="r.findingId">
            <button type="button" class="trd-residual" @click="emitDrill(r.elementId)" :title="`Open ${r.elementName} profile`">
              <span class="trd-band" :class="`trd-band--${r.band}`">{{ r.band }}</span>
              <span class="trd-residual-name">{{ r.findingName }}</span>
              <span v-if="r.attackVector" class="trd-residual-vec">{{ r.attackVector }}</span>
              <span class="trd-residual-el">on {{ r.elementName }}</span>
              <span v-if="r.uncovered" class="trd-residual-flag" title="no supporting control present on this element">⛉ uncovered</span>
              <span v-if="r.stale" class="trd-stale">⚠ stale</span>
              <span class="trd-residual-go" aria-hidden="true">↗</span>
            </button>
          </li>
        </ol>
        <p v-else class="trd-none">No open residual risks to rank.</p>
      </section>
    </template>
  </div>
</template>

<script setup>
  import { computed } from 'vue'
  import { computeCrossings } from '../lib/boundaryCrossings.js'
  import { computePostureSummary } from '../lib/postureSummary.js'

  const props = defineProps({
    ledger: { type: Array, default: () => [] },
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [], dataNodes: [] }) },
  })

  // Emits a navigation intent for the shell to apply (no routes, no direct state).
  //  { type:'view', view } | { type:'filter', view, filter } | { type:'drill', elementId }
  const emit = defineEmits(['navigate'])

  const bandOrder = ['critical', 'high', 'medium', 'low', 'unknown']
  const bandLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' }

  // ⑤ reuses the SAME ③ engine result (cheap, pure) for its boundary-crossing
  // count — no second analysis.
  const crossings = computed(() => computeCrossings(props.modelGraph, props.ledger))
  const summary = computed(() => computePostureSummary(props.ledger, { crossings: crossings.value }))
  const presentLiveBands = computed(() => bandOrder.filter((b) => summary.value.liveBands[b] > 0))

  const emitView = (view) => emit('navigate', { type: 'view', view })
  const emitDrill = (elementId) => emit('navigate', { type: 'drill', elementId })
  const emitBand = (band) =>
    emit('navigate', {
      type: 'filter',
      view: 'residual',
      filter: { key: 'band', type: 'band', value: band, label: `band: ${bandLabels[band] ?? band}` },
    })
  const emitOpenOnly = () =>
    emit('navigate', {
      type: 'filter',
      view: 'residual',
      filter: { key: 'live', type: 'live', value: true, label: 'open only' },
    })
</script>

<style scoped>
  .trd-posture { font-size: 0.9rem; }
  .trd-caveat { font-size: 0.75rem; opacity: 0.6; margin: 0 0 1rem; line-height: 1.5; }
  .trd-empty { opacity: 0.75; }
  .trd-block { margin-bottom: 1.1rem; }
  .trd-block-head {
    margin: 0 0 0.45rem; font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.04em; opacity: 0.55; font-weight: 600;
  }
  .trd-muted { opacity: 0.6; font-weight: 400; font-size: 0.8rem; }
  .trd-none { opacity: 0.7; font-size: 0.85rem; margin: 0; }

  .trd-tiles { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .trd-tile {
    display: flex; flex-direction: column; align-items: center; min-width: 4.2rem;
    padding: 0.4rem 0.7rem; border: 1px solid currentColor; border-radius: 6px;
    background: transparent; cursor: pointer; font: inherit;
  }
  .trd-tile:hover { background: rgba(127, 127, 127, 0.08); }
  .trd-tile:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-tile-num { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .trd-tile-label { font-size: 0.7rem; text-transform: capitalize; opacity: 0.85; }
  /* Outlined band chips/tiles — a triage sort-aid, NOT a solid stoplight. */
  .trd-band--critical { color: #c0392b; }
  .trd-band--high { color: #b9651b; }
  .trd-band--medium { color: #8a7400; }
  .trd-band--low { color: #5f6a6a; }
  .trd-band--unknown { color: #7f8c8d; }

  .trd-statline {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.5rem;
    padding: 0.5rem 0.7rem; background: rgba(127, 127, 127, 0.08); border-radius: 4px;
  }
  .trd-stat-sep { opacity: 0.4; }
  .trd-stat-gap { flex-basis: 100%; height: 0; }
  .trd-stat {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    cursor: pointer; text-decoration: underline; text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .trd-stat:hover { text-decoration-style: solid; }
  .trd-stat:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-stale { color: #c77700; font-weight: 600; font-size: 0.85rem; }
  .trd-untriaged { opacity: 0.7; font-size: 0.85rem; }
  .trd-hollow { color: #c77700; font-size: 0.85rem; }

  .trd-did { font-size: 0.82rem; color: #4a6a55; margin: 0 0 1.1rem; line-height: 1.45; }

  .trd-residuals { list-style: decimal; margin: 0; padding-left: 1.4rem; }
  .trd-residuals li { margin-bottom: 0.3rem; }
  .trd-residual {
    display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    background: none; border: none; padding: 0.1rem 0; font: inherit; color: inherit;
    cursor: pointer; text-align: left; width: 100%;
  }
  .trd-residual:hover { color: #00b8d4; }
  .trd-residual:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-band {
    display: inline-block; border: 1px solid currentColor; border-radius: 10px;
    padding: 0 7px; font-size: 0.7rem; text-transform: capitalize; background: transparent;
  }
  .trd-residual-name { font-weight: 600; }
  .trd-residual-vec { font-size: 0.7rem; opacity: 0.6; text-transform: lowercase; border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; }
  .trd-residual-el { opacity: 0.7; font-size: 0.82rem; }
  .trd-residual-flag { font-size: 0.74rem; color: #8a5a00; }
  .trd-residual-go { margin-left: auto; opacity: 0.4; }
</style>
