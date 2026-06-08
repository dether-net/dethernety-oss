<!--
  PostureSummary.vue — the Posture Summary view (the default landing surface).

  This is the ONLY aggregating view. It rolls up the analysis engines
  (computePostureSummary over the Residual Risk aggregator + the Boundary
  Crossings totals) into an at-a-glance posture, and EVERY stat is an
  in-component deep-link (a non-clickable number on a summary screen is a
  workflow dead-end). It emits `navigate` intents; the shell turns them into view
  switches / filters / drills.

  Honesty contracts: the scope caveat rides ON the artifact (survives
  screenshotting); live-exposure bands are LIVE-only (null ⇒ unknown, never low);
  defense-in-depth is a SEPARATE positive line, never folded into coverage; NO
  single risk score, NO coverage %, NO "Covered: N", no charts. The COVERAGE
  block (from the coverage module) and the crown-jewel REACHABILITY tile (from
  the client-side Reachability engine) light when their inputs are present, and
  degrade to a modeling-gap line — never a flattering green — when they are not.
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
      <!-- LIVE EXPOSURES — band tiles, each a deep-link into Residual Risk filtered to that band. -->
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
          <span v-if="summary.hasAnyFindings">All {{ summary.disposition.dispositioned }} finding(s) are dispositioned — see the review trail in Residual Risk.</span>
          <span v-else>No exposures are modeled on any in-scope element (this is a modeling state, not an all-clear).</span>
        </p>
      </section>

      <!-- COVERAGE — tier-segregated, function-classified; NEVER a % or "Covered: N".
           The broad D3FEND tier carries (broad/inferred) + ░ inline so a screenshot
           can't show a flattering aggregate. Absent when coverage-tools isn't
           deployed (the matrix tab shows its own affordance). -->
      <section v-if="coverageView.available" class="trd-block">
        <h4 class="trd-block-head">
          Coverage
          <span class="trd-muted">(tier-segregated — never “Covered: N”, never %)</span>
        </h4>
        <div class="trd-cov-lines">
          <button type="button" class="trd-stat" @click="emitView('coverage')" title="Open the Coverage &amp; Gaps matrix">
            <strong>{{ coverageView.summary.directPrevent }}</strong> DIRECT-prevent <span class="cov-fill cov-DIRECT" aria-hidden="true"></span> ⛉
            · <strong>{{ coverageView.summary.directDetect }}</strong> DIRECT-detect ◎
            · <strong>{{ coverageView.summary.mitigation }}</strong> Mitigation <span class="cov-fill cov-MIT" aria-hidden="true"></span>
          </button>
          <button type="button" class="trd-stat" @click="emitView('coverage')" title="Open the Coverage &amp; Gaps matrix">
            <strong>{{ coverageView.summary.d3fend }}</strong> D3FEND (broad/inferred) <span class="cov-fill cov-D3F" aria-hidden="true"></span>
            · <strong>{{ coverageView.summary.detectOnly }}</strong> detect-only ◎
          </button>
          <button type="button" class="trd-stat" @click="emitView('coverage')" title="Open the Coverage &amp; Gaps matrix">
            <strong>{{ coverageView.summary.uncovered }}</strong> uncovered
            · <strong>{{ coverageView.summary.soft }}</strong> soft/unmapped <span class="cov-offgrid" aria-hidden="true">▦</span>
          </button>
        </div>
      </section>

      <!-- DISPOSITION + BOUNDARY CROSSINGS — clickable stats. -->
      <section class="trd-block trd-statline">
        <button type="button" class="trd-stat" @click="emitOpenOnly" title="Show open (live) findings in the Residual Risk ledger">
          <strong>{{ summary.disposition.open }}</strong> open
        </button>
        <span class="trd-stat-sep">·</span>
        <button type="button" class="trd-stat" @click="emitView('residual')" title="Open the Residual Risk ledger">
          <strong>{{ summary.disposition.dispositioned }}</strong> dispositioned
        </button>
        <span v-if="summary.disposition.stale > 0" class="trd-stale">· ⚠ {{ summary.disposition.stale }} stale</span>
        <span v-if="summary.disposition.open > 0 && summary.disposition.dispositioned === 0" class="trd-untriaged">· none dispositioned yet</span>
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

      <!-- CROWN-JEWEL REACHABILITY — rolled up from external-entry reachability.
           STRUCTURAL "from external entry" (never "from untrusted"); each count
           deep-links to the Reachability view. Honest when no jewels / no entry
           are modeled (a modeling state, never a flattering "0 reachable" green). -->
      <section v-if="reachability" class="trd-block trd-statline">
        <template v-if="reachability.hasCrownJewels && reachability.hasOrigin">
          <button type="button" class="trd-stat" @click="emitView('reachability')" title="Open the Reachability view — flow routes to crown jewels">
            <strong>{{ reachability.reachableCount }}</strong> of <strong>{{ reachability.jewelCount }}</strong> crown jewels reachable from external entry ↗
          </button>
          <span v-if="reachability.unreachableCount > 0" class="trd-muted">· {{ reachability.unreachableCount }} with no modeled flow route</span>
        </template>
        <template v-else-if="reachability.hasCrownJewels && !reachability.hasOrigin">
          <button type="button" class="trd-stat" @click="emitView('reachability')" title="Open the Reachability view">
            <strong>{{ reachability.jewelCount }}</strong> crown jewel{{ reachability.jewelCount === 1 ? '' : 's' }} · no external entry-points modeled — assess in Reachability ↗
          </button>
        </template>
        <span v-else class="trd-muted">
          Crown-jewel reachability: no components marked as crown jewels — not assessed (a modeling state, not an all-clear).
        </span>
      </section>

      <!-- DEFENSE-IN-DEPTH — a SEPARATE positive-signal line, never coverage. -->
      <p v-if="summary.defenseInDepth.controlCount > 0" class="trd-did">
        Defense-in-depth: <strong>{{ summary.defenseInDepth.controlCount }}</strong> control(s) present on
        {{ summary.defenseInDepth.elementCount }} element(s) with no modeled live exposure — a positive signal,
        <strong>not</strong> folded into any coverage measure.
      </p>

      <!-- TOP RESIDUAL RISKS — ranked, each row drills to the Component Profile. -->
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
  import { buildCoverageView } from '../lib/coverageMatrix.js'

  const props = defineProps({
    ledger: { type: Array, default: () => [] },
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [], dataNodes: [] }) },
    // Live graded-coverage facts (or null). When present, the coverage block
    // lights up; when absent, the block is simply not rendered (not a dead tile).
    coverage: { type: Object, default: null },
    // The pre-built coverage view from the shell (built once, shared). When
    // absent (standalone use) this component builds it from coverage + ledger.
    coverageView: { type: Object, default: null },
    // The external-entry reachability rollup, computed client-side in the shell.
    // Lights the crown-jewel reachability tile; null ⇒ tile absent.
    reachability: { type: Object, default: null },
  })

  // Emits a navigation intent for the shell to apply (no routes, no direct state).
  //  { type:'view', view } | { type:'filter', view, filter } | { type:'drill', elementId }
  const emit = defineEmits(['navigate'])

  const bandOrder = ['critical', 'high', 'medium', 'low', 'unknown']
  const bandLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' }

  // Reuses the SAME boundary-crossing engine result (cheap, pure) for its
  // crossing count — no second analysis.
  const crossings = computed(() => computeCrossings(props.modelGraph, props.ledger))
  const summary = computed(() => computePostureSummary(props.ledger, { crossings: crossings.value }))
  const presentLiveBands = computed(() => bandOrder.filter((b) => summary.value.liveBands[b] > 0))

  // The coverage block, from the same pure honesty layer the Coverage & Gaps matrix uses.
  const coverageView = computed(() => props.coverageView ?? buildCoverageView(props.coverage, props.ledger))

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

  /* Coverage block: tier-segregated lines, each a deep-link to the Coverage &
     Gaps matrix. The tiny fill swatches mirror the matrix encoding (monochrome
     ramp + D3FEND hatch) so a screenshot can't read the broad tier as "a little
     covered". */
  .trd-cov-lines { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
  /* Mirrors the Coverage & Gaps matrix encoding (CoverageMatrix.vue .cov-* fills)
     — same ramp + same coarse D3FEND hatch, so the Posture Summary and the matrix
     read as one legend. */
  .cov-fill { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; vertical-align: middle; border: 1px solid rgba(var(--v-theme-on-surface, 255 255 255), 0.2); }
  .cov-DIRECT { background: rgba(var(--v-theme-on-surface, 255 255 255), 0.88); }
  .cov-MIT { background: rgba(var(--v-theme-on-surface, 255 255 255), 0.45); }
  .cov-D3F { background-color: rgba(var(--v-theme-on-surface, 255 255 255), 0.10); background-image: repeating-linear-gradient(45deg, rgba(var(--v-theme-on-surface, 255 255 255), 0.65) 0, rgba(var(--v-theme-on-surface, 255 255 255), 0.65) 2px, transparent 2px, transparent 5px); }
  .cov-offgrid { font-family: monospace; opacity: 0.6; }

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
