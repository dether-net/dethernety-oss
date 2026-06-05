<!--
  BoundaryCrossings.vue — the ③ Boundary-Crossing ledger view.

  Presentational over computeCrossings(modelGraph, ledger) (pure TS). ③ is
  STRUCTURAL: a crossing is the symmetric difference of the two endpoints'
  boundary-nesting stacks — NEVER a trust gradient (trustLevel is dormant).
  Direction is EXIT/ENTER (containment), not a trust comparison.

  Honesty contracts: flows are GROUPED so each one's containment story stays
  intact (operational EXIT-then-ENTER order); flows with any signal (classified
  data carried, a live on-flow / crossed-boundary exposure, or a control present)
  are the ranked worklist; flows with zero signal everywhere collapse into a
  muted "under-modeled crossings" tail (present, never green, never dropped).
  Null data sensitivity reads "unknown", never "low"; unclassified data in motion
  is a flagged modeling gap. Crossed-boundary posture renders as muted
  weakening/hardening context — no trust chips, no risk score.

  The minimap (real layout) is the spatial home: clicking a crossing highlights
  its flow's endpoints on the map.
-->
<template>
  <div class="trd-crossings">
    <!-- Completeness / honesty flags -->
    <p
      v-for="f in result.flags"
      :key="f.key"
      class="trd-flag"
      :class="`trd-flag--${f.severity}`"
      role="note"
    >⚠ {{ f.label }}</p>

    <div class="trd-cross-body">
      <!-- Spatial home: the faithful minimap -->
      <div class="trd-minimap-pane">
        <ModelMinimap
          :model-graph="modelGraph"
          :crown-jewel-ids="crownJewelIds"
          :highlight-ids="highlightIds"
          variant="sidebar"
        />
        <p class="trd-minimap-hint">
          <span v-if="selectedFlowId">Highlighting <strong>{{ selectedFlowName }}</strong> — <button type="button" class="trd-linkbtn" @click="clearSelection">clear</button></span>
          <span v-else>Click a crossing to highlight its flow on the map.</span>
        </p>
      </div>

      <!-- The crossing ledger -->
      <div class="trd-cross-main">
        <div class="trd-summary">
          <strong>{{ totals.crossingFlows }}</strong> flows pierce membranes ·
          <strong>{{ totals.signalFlows }}</strong> carry data or posture ·
          <strong>{{ totals.underModeledFlows }}</strong> under-modeled <span class="trd-muted">(no data, no posture)</span>
          <span v-if="totals.hiddenByCap" class="trd-muted">· {{ totals.hiddenByCap }} outer membranes collapsed</span>
        </div>

        <p class="trd-caveat">
          Structural membrane crossings — the symmetric difference of each flow's boundary nesting, <strong>not</strong>
          a trust gradient. Direction is <strong>EXIT</strong> (data leaves a boundary) / <strong>ENTER</strong> (data
          enters one) — containment, never a trust comparison. The data-sensitivity band orders the worklist; it is not a
          risk score. Per membrane: <span class="trd-key-weaken">⚠ live on boundary</span> = a weakening signal (easier
          crossing); <span class="trd-key-harden">✓ boundary control</span> = a hardening signal (costlier crossing) —
          context, never coverage.
        </p>

        <!-- Empty states (honest — never "perfectly segmented") -->
        <p v-if="boundariesCount === 0" class="trd-empty">
          No security boundaries are modeled — boundary-crossing analysis is not applicable to this model.
        </p>
        <p v-else-if="flowsCount === 0" class="trd-empty">
          No data flows are modeled — there is nothing to evaluate for boundary crossings.
        </p>
        <p v-else-if="totals.crossingFlows === 0" class="trd-empty">
          No modeled flow crosses a boundary membrane as drawn. This reflects the model's current topology, not a
          segmentation assessment.
        </p>

        <!-- The ranking is meaningless when nothing differentiates the worklist. -->
        <p v-if="worklistUnranked" class="trd-flag trd-flag--warning" role="note">
          Listed in flow-name order — no data classification or posture signal is present to rank these crossings.
        </p>

        <!-- Worklist: signal-bearing crossings, ranked -->
        <section
          v-for="g in crossings"
          :key="g.flowId"
          class="trd-flow"
          :class="{ 'trd-flow--sel': g.flowId === selectedFlowId }"
          role="button"
          tabindex="0"
          :aria-pressed="g.flowId === selectedFlowId"
          @click="toggleSelect(g)"
          @keydown="onCardKey($event, g)"
        >
          <header class="trd-flow-head">
            <span class="trd-flow-name">{{ g.flowName || '(unnamed flow)' }}</span>
            <span class="trd-sens" :class="sensClass(g)">{{ sensChipLabel(g) }}</span>
            <span v-if="g.flowLiveCount > 0" class="trd-flow-expo" :title="`${g.flowLiveCount} live exposure(s) on the flow`">
              flow: {{ g.flowLiveCount }} live<span v-if="g.flowWorstBand"> ({{ g.flowWorstBand }})</span>
            </span>
            <span v-if="g.flowHasControl" class="trd-flow-ctrl">flow control present</span>
            <span class="trd-flow-hint" aria-hidden="true">▸ highlight on map</span>
          </header>
          <ul class="trd-membranes">
            <li v-for="(m, i) in g.membranes" :key="i" class="trd-membrane" :class="{ 'trd-membrane--context': !m.signal }">
              <span class="trd-dir" :class="`trd-dir--${m.direction.toLowerCase()}`">{{ m.direction }}</span>
              <span class="trd-bname">{{ m.boundaryName }}</span>
              <span v-if="m.boundaryLiveCount > 0" class="trd-weaken" title="crossed boundary has live exposures (makes the crossing easier)">
                ⚠ {{ m.boundaryLiveCount }} live on boundary
              </span>
              <span v-if="m.boundaryHasControl" class="trd-harden" title="crossed boundary has a covering control (makes the crossing more expensive)">
                ✓ boundary control
              </span>
              <span v-if="!m.signal" class="trd-context-tag">· shared context</span>
            </li>
          </ul>
          <p v-if="g.hiddenMembranes > 0" class="trd-collapsed-note">
            +{{ g.hiddenMembranes }} outer shared-context membrane{{ g.hiddenMembranes === 1 ? '' : 's' }} collapsed
          </p>
        </section>

        <!-- Under-modeled tail: zero-signal crossings (present, never green) -->
        <details v-if="underModeled.length" class="trd-undermodeled">
          <summary>{{ underModeledCount }} under-modeled crossing{{ underModeledCount === 1 ? '' : 's' }} — no classified data, no exposures, no controls</summary>
          <section
            v-for="g in underModeled"
            :key="g.flowId"
            class="trd-flow trd-flow--muted"
            :class="{ 'trd-flow--sel': g.flowId === selectedFlowId }"
            role="button"
            tabindex="0"
            :aria-pressed="g.flowId === selectedFlowId"
            @click="toggleSelect(g)"
            @keydown="onCardKey($event, g)"
          >
            <header class="trd-flow-head">
              <span class="trd-flow-name">{{ g.flowName || '(unnamed flow)' }}</span>
              <span class="trd-sens" :class="sensClass(g)">{{ sensChipLabel(g) }}</span>
            </header>
            <ul class="trd-membranes">
              <li v-for="(m, i) in g.membranes" :key="i" class="trd-membrane trd-membrane--context">
                <span class="trd-dir" :class="`trd-dir--${m.direction.toLowerCase()}`">{{ m.direction }}</span>
                <span class="trd-bname">{{ m.boundaryName }}</span>
              </li>
            </ul>
          </section>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { computed, ref } from 'vue'
  import ModelMinimap from './ModelMinimap.vue'
  import { computeCrossings, sensitivityLabel } from '../lib/boundaryCrossings.js'

  const props = defineProps({
    // The snapshot doc's modelGraph (boundaries/components/flows + geometry).
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [] }) },
    // The RAW snapshot ledger (LedgerElement[]) — reused for on-flow / crossed-
    // boundary posture (findings + supporting controls), so ③ needs no own query.
    ledger: { type: Array, default: () => [] },
  })

  const result = computed(() => computeCrossings(props.modelGraph, props.ledger))
  const crossings = computed(() => result.value.crossings)
  const underModeled = computed(() => result.value.underModeled)
  const underModeledCount = computed(() => result.value.underModeledCount)
  const totals = computed(() => result.value.totals)
  // When the worklist has nothing rankable (no classified data, no exposures,
  // no controls anywhere), drop the misleading "ranked" framing.
  const worklistUnranked = computed(() => result.value.worklistUnranked)
  const flowsCount = computed(() => (props.modelGraph?.flows ?? []).length)
  const boundariesCount = computed(() => (props.modelGraph?.boundaries ?? []).length)

  const crownJewelIds = computed(() =>
    (props.modelGraph?.components ?? []).filter((c) => c.crownJewel).map((c) => c.id),
  )

  // Selection drives the minimap highlight: a selected crossing lights its
  // flow's endpoint components (the edge between two highlighted nodes reads as
  // the crossing). Full pick-two interaction is a later sprint.
  const selectedFlowId = ref('')
  const selectedFlow = computed(() =>
    [...crossings.value, ...underModeled.value].find((g) => g.flowId === selectedFlowId.value),
  )
  const selectedFlowName = computed(() => selectedFlow.value?.flowName || '')
  const highlightIds = computed(() => {
    const g = selectedFlow.value
    return g ? [g.sourceId, g.targetId].filter(Boolean) : []
  })
  const toggleSelect = (g) => {
    selectedFlowId.value = selectedFlowId.value === g.flowId ? '' : g.flowId
  }
  const clearSelection = () => {
    selectedFlowId.value = ''
  }
  // Keyboard activation for the clickable crossing cards (a11y parity with ④'s
  // real buttons).
  const onCardKey = (e, g) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      toggleSelect(g)
    }
  }

  // Sensitivity chip: known level, or the honest "unclassified in motion" gap,
  // or "no data". Null sensitivity NEVER reads as low.
  const sensChipLabel = (g) => {
    if (g.sensitivityKnown) return sensitivityLabel(g.maxSensitivity)
    if (g.unclassifiedInMotion) return 'unclassified data'
    return 'no data'
  }
  const sensClass = (g) => {
    if (g.sensitivityKnown) return `trd-sens--${String(g.maxSensitivity).toLowerCase()}`
    if (g.unclassifiedInMotion) return 'trd-sens--unclassified'
    return 'trd-sens--nodata'
  }
</script>

<style scoped>
  .trd-crossings { font-size: 0.9rem; }

  .trd-flag {
    font-size: 0.8rem;
    margin: 0 0 0.4rem;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
  }
  .trd-flag--warning { color: #8a5a00; background: rgba(199, 119, 0, 0.1); }
  .trd-flag--error { color: #a02020; background: rgba(192, 57, 43, 0.1); }

  .trd-cross-body { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .trd-minimap-pane { flex: 0 0 280px; max-width: 320px; min-width: 220px; }
  .trd-minimap-hint { font-size: 0.72rem; opacity: 0.65; margin: 0.3rem 0 0; }
  .trd-cross-main { flex: 1 1 360px; min-width: 320px; }

  .trd-linkbtn {
    background: none; border: none; padding: 0; font: inherit;
    color: inherit; text-decoration: underline; cursor: pointer; opacity: 0.8;
  }
  .trd-linkbtn:hover { opacity: 1; }

  .trd-summary {
    display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center;
    padding: 0.5rem 0.7rem; background: rgba(127, 127, 127, 0.08);
    border-radius: 4px; margin-bottom: 0.5rem;
  }
  .trd-muted { opacity: 0.65; }
  .trd-caveat { font-size: 0.74rem; opacity: 0.62; margin: 0 0 0.9rem; line-height: 1.5; }
  .trd-key-weaken { color: #8a5a00; white-space: nowrap; }
  .trd-key-harden { color: #4a6a55; white-space: nowrap; }
  .trd-empty { opacity: 0.7; }

  .trd-flow {
    border: 1px solid rgba(127, 127, 127, 0.22);
    border-radius: 5px;
    padding: 0.5rem 0.7rem;
    margin-bottom: 0.55rem;
    cursor: pointer;
  }
  .trd-flow:hover { border-color: rgba(127, 127, 127, 0.45); }
  .trd-flow:hover .trd-flow-hint { opacity: 0.55; }
  .trd-flow:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-flow--sel { border-color: #00b8d4; box-shadow: 0 0 0 1px #00b8d4 inset; }
  .trd-flow--muted { opacity: 0.62; }

  .trd-flow-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .trd-flow-name { font-weight: 600; }
  /* Posture markers are muted CONTEXT, not a red/green per-row verdict. */
  .trd-flow-expo { font-size: 0.74rem; color: #8a5a00; }
  .trd-flow-ctrl { font-size: 0.74rem; color: #4a6a55; }
  .trd-flow-hint { font-size: 0.7rem; opacity: 0; margin-left: auto; transition: opacity 0.1s; }

  /* Sensitivity chip — outlined, low-saturation; a sort-aid, not a stoplight. */
  .trd-sens {
    display: inline-block; border: 1px solid currentColor; border-radius: 10px;
    padding: 0 7px; font-size: 0.7rem; background: transparent; text-transform: capitalize;
  }
  .trd-sens--restricted { color: #c0392b; }
  .trd-sens--confidential { color: #b9651b; }
  .trd-sens--internal { color: #8a7400; }
  .trd-sens--public { color: #5f6a6a; }
  .trd-sens--unclassified { color: #c77700; }
  .trd-sens--nodata { color: #95a5a6; }

  .trd-membranes { list-style: none; margin: 0.4rem 0 0; padding: 0; }
  .trd-membrane {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    padding: 0.2rem 0; font-size: 0.82rem;
  }
  .trd-membrane--context { opacity: 0.6; }
  .trd-dir {
    display: inline-block; min-width: 3.4rem; text-align: center;
    border: 1px solid currentColor; border-radius: 3px; padding: 0 5px;
    font-size: 0.68rem; font-weight: 600; letter-spacing: 0.03em;
  }
  .trd-dir--exit { color: #b9651b; }
  .trd-dir--enter { color: #2c6fbb; }
  .trd-bname { font-variant-numeric: tabular-nums; }
  /* Weakening/hardening are muted context tones — NOT a saturated red/green
     stoplight pair on the same row. The ⚠/✓ glyphs + labels carry the meaning. */
  .trd-weaken { font-size: 0.74rem; color: #8a5a00; }
  .trd-harden { font-size: 0.74rem; color: #4a6a55; }
  .trd-context-tag { font-size: 0.7rem; opacity: 0.55; font-style: italic; }

  .trd-collapsed-note { font-size: 0.72rem; opacity: 0.55; margin: 0.3rem 0 0; }

  .trd-undermodeled summary { cursor: pointer; font-size: 0.82rem; opacity: 0.75; margin: 0.4rem 0; }
</style>
