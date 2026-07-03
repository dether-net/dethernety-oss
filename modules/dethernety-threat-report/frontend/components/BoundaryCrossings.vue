<!--
  BoundaryCrossings.vue — the Boundary Crossings ledger view.

  Presentational over computeCrossings(modelGraph, ledger, zoning) (pure JS). Two
  distinct layers per flow:
    - STRUCTURAL membranes: the symmetric difference of the two endpoints'
      boundary-nesting stacks. Direction is EXIT/ENTER (containment), never a
      trust comparison; membranes carry the crossed boundary's own posture.
    - A DECLARED-zone POLICY line: the flow's declared source-zone ↦ target-zone
      verdict (violation / warning / advisory / allowed) from the data-flow policy.
      A verdict means "the model as drawn encodes an illegal crossing," NOT "we
      verified the flow cannot occur"; zones are the operator's DECLARATION, never
      recomputed by the report.

  Honesty contracts: allowed crossings stay silent (a muted zone-pair only —
  absence is the encoding, never a green/pass claim); only non-clean rows get an
  accent bar + UPPERCASE word. Worklist = a policy escalation OR any structural
  signal (classified data, a live exposure, a control); everything else collapses
  into one muted "under-modeled" tail (present, never dropped). Null data
  sensitivity reads "unknown", never "low". Declared conduits that authorize an
  illegal crossing are surfaced as errors (conduits never legalize a violation).

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
          :highlight-edge-ids="highlightEdgeIds"
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
          <span v-if="policy.violations" class="trd-count-violation"><strong>{{ policy.violations }}</strong> violation{{ policy.violations === 1 ? '' : 's' }}</span>
          <span v-if="policy.warnings" class="trd-count-warning"><strong>{{ policy.warnings }}</strong> warning{{ policy.warnings === 1 ? '' : 's' }}</span>
          <span v-if="policy.advisories" class="trd-muted"><strong>{{ policy.advisories }}</strong> advisor{{ policy.advisories === 1 ? 'y' : 'ies' }}</span>
          <span class="trd-muted">· {{ totals.underModeledFlows }} under-modeled</span>
          <span v-if="totals.hiddenByCap" class="trd-muted">· {{ totals.hiddenByCap }} outer membranes collapsed</span>
        </div>

        <p class="trd-caveat">
          Each flow carries two things. A <strong>declared policy line</strong> — the operator's declared source-zone
          <span class="trd-zone-arrow">↦</span> target-zone and its verdict. Zones are <strong>declared</strong> (an
          administrative decision the report never recomputes); a verdict means the model <em>as drawn</em> encodes an
          illegal crossing — <strong>declared intent, not verified enforcement</strong>, and never a claim the flow cannot
          occur. Allowed crossings stay silent (a muted zone-pair, never a “pass”). Below it, <strong>structural
          membranes</strong> — the symmetric difference of the flow's boundary nesting; <strong>EXIT</strong> (leaves a
          boundary) / <strong>ENTER</strong> (enters one) is containment, not a trust comparison. Per membrane:
          <span class="trd-key-weaken">⚠ live on boundary</span> = a weakening signal;
          <span class="trd-key-harden">✓ boundary control</span> = a hardening signal — context, never coverage.
        </p>

        <!-- Collapsed zone legend — declared exposure position, never a safety verdict. -->
        <details class="trd-zone-legend">
          <summary>Zone tiers (declared)</summary>
          <p class="trd-zone-legend-body">
            <span class="trd-zone trd-zone--untrusted">UNTRUSTED</span> external (the internet) ·
            <span class="trd-zone trd-zone--public">PUBLIC</span> the front door ·
            <span class="trd-zone trd-zone--exposed">EXPOSED</span> externally reachable by design ·
            <span class="trd-zone trd-zone--internal">INTERNAL</span> not directly reachable ·
            <span class="trd-zone trd-zone--restricted">RESTRICTED</span> declared to hold the most sensitive assets ·
            <span class="trd-zone trd-zone--vendor">VENDOR</span> partner (off-gradient).
            A zone is the operator's <strong>declared exposure position</strong> — RESTRICTED means "declared most
            sensitive," not "protected"; the chips are never a safety verdict.
          </p>
        </details>

        <!-- Conduit errors: declared channels that authorize an illegal crossing (fail-closed). -->
        <details v-if="conduitErrors.length" class="trd-conduiterrors" open>
          <summary>{{ conduitErrors.length }} declared conduit{{ conduitErrors.length === 1 ? '' : 's' }} authorize an illegal crossing — a conduit does not legalize a policy violation</summary>
          <p v-for="c in conduitErrors" :key="`${c.sourceId}>${c.peerId}`" class="trd-conduiterr">
            <span class="trd-verdict-word trd-verdict-word--error">CONDUIT ERROR</span>
            <button type="button" class="trd-drill-mini" @click="$emit('drill', c.sourceId)">{{ c.sourceName }}</button>
            <span class="trd-zone-climb">
              <span class="trd-zone" :class="tierClass(c.srcZone)">{{ c.srcZone }}</span>
              <span class="trd-zone-arrow" aria-hidden="true">↦</span>
              <span class="trd-zone" :class="tierClass(c.tgtZone)">{{ c.tgtZone }}</span>
            </span>
            <button type="button" class="trd-drill-mini" @click="$emit('drill', c.peerId)">{{ c.peerName }}</button>
            <span v-if="c.dead" class="trd-qual trd-qual--dead">dead (no live flow)</span>
            <span class="trd-conduiterr-detail">{{ c.detail }}</span>
          </p>
        </details>

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
          :class="[verdictAccentClass(g), { 'trd-flow--sel': g.flowId === selectedFlowId }]"
          role="button"
          tabindex="0"
          :aria-pressed="g.flowId === selectedFlowId"
          @click="toggleSelect(g)"
          @keydown="onCardKey($event, g)"
        >
          <header class="trd-flow-head">
            <button
              type="button"
              class="trd-flow-name"
              @click.stop="$emit('drill', g.flowId)"
              :title="`Open ${g.flowName || 'flow'} profile`"
            >{{ g.flowName || '(unnamed flow)' }}</button>
            <span class="trd-flow-endpoints">
              <button type="button" class="trd-drill-mini" @click.stop="$emit('drill', g.sourceId)" :title="`Open ${compName(g.sourceId)} profile`">{{ compName(g.sourceId) }}</button>
              <span class="trd-ep-arrow" aria-hidden="true">→</span>
              <button type="button" class="trd-drill-mini" @click.stop="$emit('drill', g.targetId)" :title="`Open ${compName(g.targetId)} profile`">{{ compName(g.targetId) }}</button>
            </span>
            <span class="trd-sens" :class="sensClass(g)">{{ sensChipLabel(g) }}</span>
            <span v-if="g.flowLiveCount > 0" class="trd-flow-expo" :title="`${g.flowLiveCount} live exposure(s) on the flow`">
              flow: {{ g.flowLiveCount }} live<span v-if="g.flowWorstBand"> ({{ g.flowWorstBand }})</span>
            </span>
            <span v-if="g.flowHasControl" class="trd-flow-ctrl">flow control present</span>
            <span class="trd-flow-hint" aria-hidden="true">▸ highlight on map</span>
          </header>

          <!-- Declared-zone policy line (one zone-pair per flow). Verdict word +
               accent only on non-clean rows; allowed stays a muted zone-pair. -->
          <p v-if="g.verdict" class="trd-policy">
            <span class="trd-policy-label">declared</span>
            <span class="trd-zone-climb">
              <span class="trd-zone" :class="tierClass(g.verdict.srcZone)">{{ g.verdict.srcZone }}</span>
              <span class="trd-zone-arrow" aria-hidden="true">↦</span>
              <span class="trd-zone" :class="tierClass(g.verdict.tgtZone)">{{ g.verdict.tgtZone }}</span>
            </span>
            <span v-if="g.verdict.domainRel !== 'n/a'" class="trd-policy-dim">· {{ g.verdict.domainRel === 'same' ? 'same-domain' : 'cross-domain' }}</span>
            <span v-if="g.verdict.planeClass === 'management'" class="trd-policy-dim">· management plane</span>
            <span v-if="verdictWord(g)" class="trd-verdict-word" :class="verdictWordClass(g)">{{ verdictWord(g) }}</span>
            <span v-if="conduitToken(g)" class="trd-conduit-token">conduit: {{ conduitToken(g) }}</span>
          </p>
          <p v-if="policyDetail(g)" class="trd-policy-detail">{{ policyDetail(g) }}</p>

          <ul class="trd-membranes">
            <li v-for="(m, i) in g.membranes" :key="i" class="trd-membrane" :class="{ 'trd-membrane--context': !m.signal }">
              <span class="trd-dir" :class="`trd-dir--${m.direction.toLowerCase()}`">{{ m.direction }}</span>
              <button type="button" class="trd-bname trd-drill-mini" @click.stop="$emit('drill', m.boundaryId)" :title="`Open ${m.boundaryName} profile`">{{ m.boundaryName }}</button>
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
              <button
              type="button"
              class="trd-flow-name"
              @click.stop="$emit('drill', g.flowId)"
              :title="`Open ${g.flowName || 'flow'} profile`"
            >{{ g.flowName || '(unnamed flow)' }}</button>
              <span class="trd-sens" :class="sensClass(g)">{{ sensChipLabel(g) }}</span>
              <!-- No-verdict rows (response-shaped / out-of-scope) must not read "allowed" —
                   the engine deliberately withheld a verdict; absence is the encoding. -->
              <span v-if="g.verdict" class="trd-zone-climb trd-zone-climb--muted" :title="`declared ${g.verdict.srcZone} ↦ ${g.verdict.tgtZone} (${g.verdict.verdict ?? 'no verdict'})`">
                <span class="trd-zone" :class="tierClass(g.verdict.srcZone)">{{ g.verdict.srcZone }}</span>
                <span class="trd-zone-arrow" aria-hidden="true">↦</span>
                <span class="trd-zone" :class="tierClass(g.verdict.tgtZone)">{{ g.verdict.tgtZone }}</span>
              </span>
            </header>
            <ul class="trd-membranes">
              <li v-for="(m, i) in g.membranes" :key="i" class="trd-membrane trd-membrane--context">
                <span class="trd-dir" :class="`trd-dir--${m.direction.toLowerCase()}`">{{ m.direction }}</span>
                <span class="trd-bname">{{ m.boundaryName }}</span>
              </li>
            </ul>
          </section>
        </details>

        <!-- Dead conduits: legally declared, no matching modeled flow — dead intent
             worth a review, rendered muted (never alarming, never a verdict). -->
        <details v-if="deadConduits.length" class="trd-deadconduits">
          <summary>{{ deadConduits.length }} declared conduit{{ deadConduits.length === 1 ? '' : 's' }} with no matching modeled flow (dead intent)</summary>
          <p v-for="c in deadConduits" :key="`${c.sourceId}>${c.peerId}`" class="trd-deadconduit">
            <button type="button" class="trd-drill-mini" @click="$emit('drill', c.sourceId)">{{ c.sourceName }}</button>
            <span class="trd-ep-arrow" aria-hidden="true">→</span>
            <button type="button" class="trd-drill-mini" @click="$emit('drill', c.peerId)">{{ c.peerName }}</button>
            <span v-if="c.unreviewable" class="trd-qual trd-qual--unreviewable">no justification — unreviewable</span>
            <span v-else class="trd-deadconduit-just">{{ c.justification }}</span>
          </p>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { computed, ref } from 'vue'
  import ModelMinimap from './ModelMinimap.vue'
  import { computeCrossings, sensitivityLabel } from '../lib/boundaryCrossings.js'
  import { tierClass } from '../lib/zoningPolicy.js'

  const props = defineProps({
    // The snapshot doc's modelGraph (boundaries/components/flows + geometry).
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [] }) },
    // The RAW snapshot ledger (LedgerElement[]) — reused for on-flow / crossed-
    // boundary posture (findings + supporting controls), so this view needs no
    // own query.
    ledger: { type: Array, default: () => [] },
    // The snapshot zoning block — declared effective zones per boundary, driving
    // the per-flow data-flow policy verdicts. Defaulted so the pure engine never
    // sees undefined on a pre-zoning snapshot.
    zoning: { type: Object, default: () => ({ findings: [], effectiveZones: {} }) },
  })

  // Drill into the Component Profile for a crossed boundary or a flow endpoint
  // (the shell handles it).
  defineEmits(['drill'])

  const componentById = computed(
    () => new Map((props.modelGraph?.components ?? []).map((c) => [c.id, c])),
  )
  const compName = (id) => componentById.value.get(id)?.name ?? '(unknown)'

  const result = computed(() => computeCrossings(props.modelGraph, props.ledger, props.zoning))
  const crossings = computed(() => result.value.crossings)
  const underModeled = computed(() => result.value.underModeled)
  const underModeledCount = computed(() => result.value.underModeledCount)
  const totals = computed(() => result.value.totals)
  const conduitErrors = computed(() => result.value.conduitErrors)
  const deadConduits = computed(() => result.value.deadConduits)
  const policy = computed(() => result.value.policy)
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
  // the crossing).
  const selectedFlowId = ref('')
  const selectedFlow = computed(() =>
    [...crossings.value, ...underModeled.value].find((g) => g.flowId === selectedFlowId.value),
  )
  const selectedFlowName = computed(() => selectedFlow.value?.flowName || '')
  const highlightIds = computed(() => {
    const g = selectedFlow.value
    return g ? [g.sourceId, g.targetId].filter(Boolean) : []
  })
  // The crossing's own flow edge — highlight the LINE too, not just its endpoints,
  // so the pierced membrane crossing is traceable on the map.
  const highlightEdgeIds = computed(() => {
    const g = selectedFlow.value
    return g ? [g.flowId] : []
  })
  const toggleSelect = (g) => {
    selectedFlowId.value = selectedFlowId.value === g.flowId ? '' : g.flowId
  }
  const clearSelection = () => {
    selectedFlowId.value = ''
  }
  // Keyboard activation for the clickable crossing cards (a11y parity with the
  // Residual Risk view's real buttons).
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

  // ── policy verdict presentation ────────────────────────────────────────────
  // Allowed / no-verdict rows stay silent (no word, no accent) — absence is the
  // encoding. Only violation / warning / advisory escalate.
  const VERDICT_WORDS = { violation: 'VIOLATION', warning: 'WARNING', advisory: 'ADVISORY' }
  const verdictWord = (g) => VERDICT_WORDS[g.verdict?.verdict] ?? ''
  const verdictWordClass = (g) => (g.verdict?.verdict ? `trd-verdict-word--${g.verdict.verdict}` : '')
  const verdictAccentClass = (g) => {
    const v = g.verdict?.verdict
    return v === 'violation' || v === 'warning' || v === 'advisory' ? `trd-flow--${v}` : ''
  }
  // The conduit clause as an inline token: an error (a conduit blessing an illegal
  // crossing — the 2-errors read) or a missing required conduit. Present conduits
  // are context, never surfaced.
  const conduitToken = (g) => {
    const c = g.verdict?.conduitClause
    if (c === 'error') return 'error'
    if (c === 'required-missing') return 'missing'
    return ''
  }
  // Show the verdict rationale only on escalated rows (allowed rows stay silent).
  const policyDetail = (g) => (g.verdictRank > 0 ? g.verdict?.detail || '' : '')
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
  /* The minimap is the spatial home — keep it visible while the ledger scrolls.
     The shell's .trd-view is the scroll container, so a sticky pane pins to its
     top (align-self:flex-start so the flex item isn't stretched, which would
     leave no room to stick). A surface background keeps it clean if a wide
     membrane row ever underlaps during momentum scroll. */
  .trd-minimap-pane {
    flex: 0 0 280px; max-width: 320px; min-width: 220px;
    position: sticky; top: 0; align-self: flex-start; z-index: 1;
    background: rgb(var(--v-theme-surface, 33 33 33));
    padding-bottom: 0.4rem;
  }
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
  /* The flow name drills into the flow's own Component Profile (its on-flow
     exposures + endpoints). A dotted-underline link like the other drill
     affordances; @click.stop
     keeps the card's map-highlight click intact. font-family/size inherit (not the
     `font` shorthand) so the 600 weight survives. */
  .trd-flow-name {
    font-weight: 600;
    background: none; border: none; padding: 0;
    font-family: inherit; font-size: inherit; color: inherit;
    cursor: pointer; text-align: left;
    text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
  }
  .trd-flow-name:hover { text-decoration-style: solid; color: #00b8d4; }
  .trd-flow-name:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
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
  /* Drill affordances (endpoints + crossed-boundary names) — dotted-underline
     links, click.stop so the card's map-highlight click is preserved. */
  .trd-flow-endpoints { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; }
  .trd-ep-arrow { opacity: 0.5; }
  .trd-drill-mini {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    cursor: pointer; text-decoration: underline; text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .trd-drill-mini:hover { text-decoration-style: solid; }
  .trd-drill-mini:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  button.trd-bname { font-size: 0.82rem; }
  /* Weakening/hardening are muted context tones — NOT a saturated red/green
     stoplight pair on the same row. The ⚠/✓ glyphs + labels carry the meaning. */
  .trd-weaken { font-size: 0.74rem; color: #8a5a00; }
  .trd-harden { font-size: 0.74rem; color: #4a6a55; }
  .trd-context-tag { font-size: 0.7rem; opacity: 0.55; font-style: italic; }

  .trd-collapsed-note { font-size: 0.72rem; opacity: 0.55; margin: 0.3rem 0 0; }

  .trd-undermodeled summary { cursor: pointer; font-size: 0.82rem; opacity: 0.75; margin: 0.4rem 0; }

  /* ── declared-zone policy surface ──────────────────────────────────────── */
  /* Summary counts — muted tones, not a scorecard. */
  .trd-count-violation { color: #a02020; }
  .trd-count-warning { color: #8a5a00; }

  /* Zone chips — an ordinal EXPOSURE ramp blue→violet; VENDOR off-gradient warm +
     dashed; UNTRUSTED cool. Outlined, low-saturation; a position marker, no green. */
  .trd-zone-climb { display: inline-flex; align-items: center; gap: 0.3rem; }
  .trd-zone-climb--muted { opacity: 0.7; }
  .trd-zone {
    display: inline-block; border: 1px solid currentColor; border-radius: 10px;
    padding: 0 7px; font-size: 0.66rem; letter-spacing: 0.04em;
    text-transform: uppercase; background: transparent;
  }
  .trd-zone-arrow { opacity: 0.55; }
  .trd-zone--untrusted { color: #5b8bb0; }
  .trd-zone--public { color: #5877bd; }
  .trd-zone--exposed { color: #6168c4; }
  .trd-zone--internal { color: #7a5fc0; }
  .trd-zone--restricted { color: #9455bb; }
  .trd-zone--vendor { color: #a08154; border-style: dashed; }

  /* The per-flow policy line — declared zone-pair + verdict. */
  .trd-policy {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem;
    margin: 0.35rem 0 0; font-size: 0.76rem;
  }
  .trd-policy-label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.62rem; opacity: 0.55; }
  .trd-policy-dim { opacity: 0.6; }
  .trd-policy-detail { font-size: 0.74rem; opacity: 0.72; margin: 0.25rem 0 0; line-height: 1.45; }

  /* Verdict word — the ONLY escalation vocabulary; absent on allowed rows. */
  .trd-verdict-word {
    font-size: 0.64rem; font-weight: 700; letter-spacing: 0.05em;
    padding: 0 5px; border-radius: 3px; white-space: nowrap;
  }
  .trd-verdict-word--violation, .trd-verdict-word--error { color: #a02020; background: rgba(192, 57, 43, 0.1); }
  .trd-verdict-word--warning { color: #8a5a00; background: rgba(199, 119, 0, 0.1); }
  .trd-verdict-word--advisory { color: #5f6a6a; background: rgba(127, 127, 127, 0.12); }
  .trd-conduit-token { font-size: 0.68rem; color: #a02020; }

  /* Left accent bar on non-clean rows only (allowed rows keep the neutral border). */
  .trd-flow--violation { border-left: 3px solid #a02020; }
  .trd-flow--warning { border-left: 3px solid #8a5a00; }
  .trd-flow--advisory { border-left: 3px solid rgba(127, 127, 127, 0.55); }

  /* Conduit-error surface — a declared channel that authorizes an illegal crossing. */
  .trd-conduiterrors { margin: 0 0 0.8rem; border: 1px solid rgba(192, 57, 43, 0.3); border-radius: 4px; padding: 0.2rem 0.6rem; }
  .trd-conduiterrors summary { cursor: pointer; font-size: 0.8rem; color: #a02020; margin: 0.3rem 0; }
  .trd-conduiterr { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.76rem; margin: 0.35rem 0; }
  .trd-conduiterr-detail { opacity: 0.7; font-size: 0.72rem; flex-basis: 100%; }
  .trd-qual { display: inline-block; border: 1px solid currentColor; border-radius: 10px; padding: 0 7px; font-size: 0.66rem; }
  .trd-qual--dead { color: #8a5a00; }
  .trd-qual--unreviewable { color: #8a5a00; }

  /* Zone legend — collapsed, informational. */
  .trd-zone-legend { margin: 0 0 0.8rem; }
  .trd-zone-legend summary { cursor: pointer; font-size: 0.78rem; opacity: 0.7; }
  .trd-zone-legend-body { font-size: 0.74rem; opacity: 0.75; line-height: 1.8; margin: 0.3rem 0 0; }

  /* Dead conduits — muted review surface (dead intent, never a verdict). */
  .trd-deadconduits { margin: 0.6rem 0 0; opacity: 0.75; }
  .trd-deadconduits summary { cursor: pointer; font-size: 0.8rem; margin: 0.3rem 0; }
  .trd-deadconduit { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.78rem; margin: 0.3rem 0; }
  .trd-deadconduit-just { opacity: 0.7; font-size: 0.74rem; }
</style>
