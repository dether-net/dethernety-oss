<!--
  ComponentProfile.vue — the Component Profile view (a drill target, not a tab).

  Presentational over computeComponentProfile(elementId, { ledger, modelGraph })
  (pure TS). It SYNTHESISES residual risk for one element rather than
  re-skinning the canvas inspector: ancestor-boundary context with each
  boundary's own posture, the data it handles as a finding-bearing sub-block
  (each Data's sensitivity + its OWN exposures), the element's live-vs-
  dispositioned exposures with uncovered ones highlighted, supporting controls as
  muted defense-in-depth context, and 1-hop flow neighbours (each drillable). For a
  Data target it instead surfaces the elements that HANDLE the data (the inverse of
  "Data handled"), each drillable with its posture.
  Reachable for a Component, a SecurityBoundary, a DataFlow, or a Data node.

  Honesty: null sensitivity reads "unknown" (never "low"); the score band is a
  triage aid, not a rating; coverage is attributed to the handling element, never
  the Data node; controls are context, never a coverage claim. The breadcrumb/back
  lives in the shell.
-->
<template>
  <div class="trd-profile">
    <!-- Header -->
    <header class="trd-prof-head">
      <h3 class="trd-prof-name">{{ profile.element.name }}</h3>
      <span class="trd-etype">{{ profile.element.type }}</span>
      <span v-if="profile.element.crownJewel" class="trd-crown" title="Author-flagged crown jewel (high-value asset)">★ crown jewel</span>
      <span v-if="profile.element.type === 'Data'" class="trd-sens" :class="`trd-sens--${dataSens(profile.element.sensitivity).key}`">
        {{ dataSens(profile.element.sensitivity).label }}
      </span>
    </header>

    <p v-if="!profile.element.found" class="trd-empty">
      This element is not present in the current snapshot. It may have been removed since the snapshot was
      generated — Recreate to refresh.
    </p>

    <div v-else class="trd-prof-body">
      <div class="trd-prof-main">
        <!-- Boundary context -->
        <section v-if="profile.boundaryContext.length" class="trd-prof-section">
          <h4 class="trd-prof-sec-head">Boundary context <span class="trd-muted">(innermost → outer)</span></h4>
          <ul class="trd-bstack">
            <li v-for="b in profile.boundaryContext" :key="b.id" class="trd-bstack-item">
              <button type="button" class="trd-drill-mini" @click="$emit('drill', b.id)" :title="`Open ${b.name} profile`">{{ b.name }}</button>
              <span v-if="b.liveCount > 0" class="trd-weaken" :title="`${b.liveCount} live exposure(s) on this boundary`">
                ⚠ {{ b.liveCount }} live<span v-if="b.worstBand"> ({{ b.worstBand }})</span>
              </span>
              <span v-if="b.hasControl" class="trd-harden">✓ control present</span>
              <span v-if="b.liveCount === 0 && !b.hasControl" class="trd-muted">· no modeled posture</span>
            </li>
          </ul>
        </section>

        <!-- Own exposures -->
        <section class="trd-prof-section">
          <h4 class="trd-prof-sec-head">
            Exposures
            <span class="trd-muted">{{ profile.ownExposures.liveCount }} open · {{ profile.ownExposures.dispositionedCount }} dispositioned</span>
          </h4>
          <p v-if="profile.ownExposures.compensatingClaimNoControl" class="trd-inconsistent">
            ⚠ Compensating-control disposition on an element with no control present.
          </p>
          <p v-if="profile.ownExposures.controlRelevanceUnassessed" class="trd-note">
            Controls are present, but their relevance to these open exposures is not assessed (control-to-exposure
            mapping is not modeled) — the absence of an “uncovered” flag does <strong>not</strong> mean “covered.”
          </p>
          <p v-if="profile.ownExposures.liveCount === 0 && profile.ownExposures.dispositionedCount === 0" class="trd-none">
            No exposures modeled on this element.
          </p>
          <table v-if="profile.ownExposures.live.length" class="trd-table" :class="{ 'trd-table--uncovered': profile.ownExposures.uncovered }">
            <tbody>
              <tr v-for="f in profile.ownExposures.live" :key="f.id">
                <td class="trd-c-band"><span class="trd-band" :class="`trd-band--${f.band}`">{{ f.band }}</span></td>
                <td class="trd-c-score">{{ f.score == null ? '—' : f.score }}</td>
                <td class="trd-c-name">
                  <button type="button" class="trd-finding-name" @click="openDetail(f)" :title="`Open ${f.name} detail`">{{ f.name }}</button>
                  <span v-if="f.attackVector" class="trd-vec">{{ f.attackVector }}</span>
                  <span v-if="chipFor(f)" class="trd-confirmed" :title="chipFor(f).title">{{ chipFor(f).text }}</span>
                  <span v-if="profile.ownExposures.uncovered" class="trd-uncovered" title="no supporting control present on this element">⛉ uncovered</span>
                  <div v-if="techsFor(f.id).length" class="trd-tech-row">
                    <span class="trd-tech-label">ATT&amp;CK</span>
                    <TechniqueChips :techniques="techsFor(f.id)" @show="infoTech = $event" />
                  </div>
                </td>
                <td class="trd-c-prov">{{ f.provenance }}</td>
                <td class="trd-c-act">
                  <FindingActions
                    v-if="canDispose"
                    :finding="f"
                    :element-id="elementId"
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
          <details v-if="profile.ownExposures.dispositioned.length" class="trd-disposed">
            <summary>{{ profile.ownExposures.dispositionedCount }} dispositioned</summary>
            <table class="trd-table trd-table--muted">
              <tbody>
                <tr v-for="f in profile.ownExposures.dispositioned" :key="f.id" :class="{ 'trd-row-stale': f.stale }">
                  <td class="trd-c-band"><span class="trd-band" :class="`trd-band--${f.band}`">{{ f.band }}</span></td>
                  <td class="trd-c-name">
                    <button type="button" class="trd-finding-name" @click="openDetail(f)" :title="`Open ${f.name} detail`">{{ f.name }}</button>
                    <span class="trd-disp">{{ kindLabel(f.dispositionKind) }}<span v-if="f.stale" class="trd-stale"> · ⚠ stale</span></span>
                    <div v-if="techsFor(f.id).length" class="trd-tech-row">
                      <span class="trd-tech-label">ATT&amp;CK</span>
                      <TechniqueChips :techniques="techsFor(f.id)" @show="infoTech = $event" />
                    </div>
                  </td>
                  <td class="trd-c-act">
                    <FindingActions
                      v-if="canDispose"
                      :finding="f"
                      :element-id="elementId"
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

        <!-- Data handled (finding-bearing sub-block) -->
        <section v-if="profile.dataHandled.length" class="trd-prof-section">
          <h4 class="trd-prof-sec-head">Data handled <span class="trd-muted">(coverage attributed to this element, not the data)</span></h4>
          <ul class="trd-data">
            <li v-for="d in profile.dataHandled" :key="d.id" class="trd-data-item">
              <button type="button" class="trd-drill-mini" @click="$emit('drill', d.id)" :title="`Open ${d.name} profile`">{{ d.name }}</button>
              <span class="trd-sens" :class="`trd-sens--${dataSens(d.sensitivity).key}`">{{ dataSens(d.sensitivity).label }}</span>
              <span v-if="d.liveCount > 0" class="trd-weaken">{{ d.liveCount }} open exposure(s)</span>
              <span v-if="d.dispositionedCount > 0" class="trd-muted">· {{ d.dispositionedCount }} dispositioned</span>
              <span v-if="d.liveCount === 0 && d.dispositionedCount === 0" class="trd-muted">· no exposures</span>
            </li>
          </ul>
        </section>

        <!-- Handled by — the inverse relation for a DATA target: the components,
             data flows & security boundaries that touch this data, each drillable
             with its own posture. (Empty for non-Data targets; the forward "Data
             handled" block above covers handler → its data.) -->
        <section v-if="profile.handledByElements.length" class="trd-prof-section">
          <h4 class="trd-prof-sec-head">Handled by <span class="trd-muted">(elements that touch this data)</span></h4>
          <ul class="trd-handlers">
            <li v-for="h in profile.handledByElements" :key="h.id" class="trd-handler">
              <span class="trd-etype">{{ h.type }}</span>
              <button v-if="h.resolved" type="button" class="trd-drill-mini" @click="$emit('drill', h.id)" :title="`Open ${h.name} profile`">{{ h.name }}</button>
              <span v-else class="trd-unresolved" title="handler not present in this snapshot">{{ h.name }}</span>
              <span v-if="h.liveCount > 0" class="trd-weaken" :title="`${h.liveCount} live exposure(s) on this element`">⚠ {{ h.liveCount }} live<span v-if="h.worstBand"> ({{ h.worstBand }})</span></span>
              <span v-if="h.hasControl" class="trd-harden">✓ control present</span>
              <span v-if="h.liveCount === 0 && !h.hasControl" class="trd-muted">· no modeled posture</span>
            </li>
          </ul>
        </section>

        <!-- Controls (muted defense-in-depth context) -->
        <section v-if="profile.controls.length" class="trd-prof-section">
          <h4 class="trd-prof-sec-head">Controls present <span class="trd-muted">(defense-in-depth context — not a coverage claim)</span></h4>
          <ul class="trd-controls">
            <li v-for="c in profile.controls" :key="c.id">{{ c.name }}<span v-if="c.category" class="trd-muted"> · {{ c.category }}</span></li>
          </ul>
        </section>

        <!-- 1-hop neighbours -->
        <section v-if="profile.neighbours.length" class="trd-prof-section">
          <h4 class="trd-prof-sec-head">Connected components <span class="trd-muted">(1-hop)</span></h4>
          <ul class="trd-neighbours">
            <li v-for="n in profile.neighbours" :key="n.flowId + ':' + n.neighbourId" class="trd-neighbour">
              <span class="trd-dir" :class="`trd-dir--${n.direction}`">{{ dirLabel(n.direction) }}</span>
              <button v-if="n.neighbourResolved" type="button" class="trd-drill-mini" @click="$emit('drill', n.neighbourId)" :title="`Open ${n.neighbourName} profile`">{{ n.neighbourName }}</button>
              <span v-else class="trd-unresolved" title="endpoint not present in this snapshot">{{ n.neighbourName }}</span>
              <span class="trd-muted">via {{ n.flowName || '(unnamed flow)' }}</span>
              <span v-if="n.maxSensitivity" class="trd-sens" :class="`trd-sens--${sensKey(n.maxSensitivity)}`">{{ n.sensitivityLabel }}</span>
            </li>
          </ul>
        </section>
      </div>

      <!-- Spatial context -->
      <aside class="trd-prof-map">
        <ModelMinimap
          :model-graph="modelGraph"
          :highlight-ids="profile.highlightIds"
          :highlight-edge-ids="profile.highlightEdgeIds"
          :highlight-boundary-ids="profile.highlightBoundaryIds"
          :crown-jewel-ids="crownJewelIds"
          variant="sidebar"
        />
        <p class="trd-map-hint">{{ mapHint }}</p>

        <!-- Element identity: its class + its own description, and the class
             description on demand. Shown only when authored — never an empty line. -->
        <section v-if="hasAbout" class="trd-prof-about">
          <div v-if="profile.element.className" class="trd-about-class">
            <span class="trd-about-label">Class</span>
            <span class="trd-about-classname">{{ profile.element.className }}</span>
          </div>
          <p v-if="profile.element.description" class="trd-about-desc">{{ profile.element.description }}</p>
          <details v-if="profile.element.classDescription" class="trd-about-classdesc">
            <summary>About this class</summary>
            <p>{{ profile.element.classDescription }}</p>
          </details>
        </section>
      </aside>
    </div>

    <!-- Shared ATT&CK technique dialog (same as Coverage & Gaps and Residual Risk) — opened by a chip. -->
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
  import ModelMinimap from './ModelMinimap.vue'
  import TechniqueChips from './TechniqueChips.vue'
  import TechniqueInfoDialog from './TechniqueInfoDialog.vue'
  import ExposureDetailDialog from './ExposureDetailDialog.vue'
  import FindingActions from './FindingActions.vue'
  import { computeComponentProfile } from '../lib/componentProfile.js'
  import { buildExposureDetail } from '../lib/exposureDetail.js'
  import { dispositionKindLabel } from '../lib/aggregateLedger.js'
  import { lifecycleChipFor } from '../lib/findingActions.js'
  import { dataItemSensitivity } from '../lib/boundaryCrossings.js'

  const props = defineProps({
    elementId: { type: String, default: '' },
    ledger: { type: Array, default: () => [] },
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [], dataNodes: [] }) },
    canDispose: { type: Boolean, default: false },
    // exposureId → resolved ATT&CK techniques (buildExposureTechniqueIndex over the
    // live coverage facts). Empty when coverage-tools isn't deployed → no chips.
    techniqueIndex: { type: Object, default: () => ({}) },
  })

  defineEmits(['drill', 'dispose', 'affirm', 'supersede', 'add-note', 'delete', 'issue'])

  // Inline lifecycle chip for a live row (only an AFFIRMED-confirmed finding earns one).
  const chipFor = lifecycleChipFor

  const profile = computed(() =>
    computeComponentProfile(props.elementId, { ledger: props.ledger, modelGraph: props.modelGraph }),
  )

  // Resolved techniques for a finding (by exposure id) + the shared info dialog.
  const techsFor = (id) => props.techniqueIndex[id] ?? []
  const infoTech = ref(null)

  // The shared Exposure Detail dialog — click a finding name for its full detail.
  // The element is this profile's own element (exposures here are its ownExposures).
  const detailExposure = ref(null)
  const openDetail = (f) => {
    const e = profile.value.element
    detailExposure.value = buildExposureDetail(f, {
      techniques: techsFor(f.id),
      element: { id: e.id, name: e.name, type: e.type },
    })
  }
  const crownJewelIds = computed(() =>
    (props.modelGraph?.components ?? []).filter((c) => c.crownJewel).map((c) => c.id),
  )

  // The "about" block under the minimap renders only when there is something to
  // show — an authored description, a class name, or a class description.
  const hasAbout = computed(() => {
    const e = profile.value.element
    return Boolean(e.className || e.description || e.classDescription)
  })

  const kindLabel = dispositionKindLabel
  const sensKey = (level) => (level == null ? 'unknown' : String(level).toLowerCase())
  // A Data item's own sensitivity chip: null ⇒ "unclassified" gap, not "unknown".
  const dataSens = (level) => dataItemSensitivity(level)
  const dirLabel = (d) => ({ inbound: '← in', outbound: 'out →', source: 'source', target: 'target' })[d] ?? d

  // Minimap caption, tailored to what's highlighted for this element type.
  const mapHint = computed(() => {
    const t = profile.value.element.type
    if (t === 'DataFlow') return "This flow's endpoints highlighted on the model."
    if (t === 'SecurityBoundary') return 'This boundary highlighted on the model.'
    if (t === 'Data') {
      return profile.value.handledByElements.length
        ? 'The elements that handle this data are highlighted on the model.'
        : 'This data is not attached to any element on the model.'
    }
    return 'This element highlighted on the model.'
  })
</script>

<style scoped>
  .trd-profile { font-size: 0.9rem; }
  .trd-prof-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
  .trd-prof-name { margin: 0; font-size: 1.2rem; }
  .trd-etype {
    font-size: 0.7rem; font-weight: 400; opacity: 0.6;
    border: 1px solid rgba(127, 127, 127, 0.4); border-radius: 3px; padding: 1px 5px;
  }
  .trd-crown {
    font-size: 0.74rem; color: #b8860b; border: 1px solid currentColor;
    border-radius: 10px; padding: 0 8px;
  }
  .trd-empty { opacity: 0.75; }

  .trd-prof-body { display: flex; gap: 1.2rem; align-items: flex-start; flex-wrap: wrap; }
  .trd-prof-main { flex: 1 1 380px; min-width: 320px; }
  .trd-prof-map { flex: 0 0 260px; max-width: 300px; min-width: 200px; }
  .trd-map-hint { font-size: 0.72rem; opacity: 0.6; margin: 0.3rem 0 0; }

  /* Identity block under the minimap: class line, the element's own description,
     and the class description folded into a disclosure so long text never crowds
     the narrow aside. */
  .trd-prof-about {
    margin-top: 0.9rem; padding-top: 0.8rem; border-top: 1px solid rgba(127, 127, 127, 0.2);
    font-size: 0.8rem; line-height: 1.45;
  }
  .trd-about-class { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; margin-bottom: 0.35rem; }
  .trd-about-label {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em;
    opacity: 0.55; font-weight: 600;
  }
  .trd-about-classname { font-weight: 600; }
  .trd-about-desc { margin: 0 0 0.4rem; opacity: 0.85; overflow-wrap: anywhere; }
  .trd-about-classdesc summary {
    cursor: pointer; font-size: 0.74rem; opacity: 0.7; user-select: none;
  }
  .trd-about-classdesc summary:hover { opacity: 1; color: #00b8d4; }
  .trd-about-classdesc p { margin: 0.3rem 0 0; font-size: 0.76rem; opacity: 0.75; overflow-wrap: anywhere; }

  .trd-prof-section { margin-bottom: 1.1rem; }
  .trd-prof-sec-head {
    margin: 0 0 0.4rem; font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.04em; opacity: 0.55; font-weight: 600;
  }
  .trd-muted { opacity: 0.6; font-weight: 400; font-size: 0.8rem; }
  .trd-none { opacity: 0.7; font-size: 0.85rem; margin: 0; }
  .trd-inconsistent { font-size: 0.8rem; color: #c77700; margin: 0.2rem 0; }
  .trd-note { font-size: 0.76rem; opacity: 0.7; margin: 0.2rem 0; line-height: 1.4; }
  .trd-vec { font-size: 0.68rem; opacity: 0.6; text-transform: lowercase; border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; margin-left: 0.3rem; }
  /* Finding name → opens the Exposure Detail dialog; styled as a text link. */
  .trd-finding-name {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    text-align: left; cursor: pointer; text-decoration: underline;
    text-decoration-color: rgba(127, 127, 127, 0.45); text-underline-offset: 2px;
  }
  .trd-finding-name:hover { text-decoration-color: #00b8d4; color: #00b8d4; }
  .trd-finding-name:focus-visible { outline: 2px solid #00b8d4; outline-offset: 2px; }
  /* ATT&CK technique chips under a finding — a muted "ATT&CK" label + the chips. */
  .trd-tech-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; margin-top: 0.25rem; }
  .trd-tech-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.45; font-weight: 600; }
  .trd-unresolved { opacity: 0.6; font-style: italic; }

  .trd-bstack, .trd-data, .trd-neighbours, .trd-controls, .trd-handlers { list-style: none; margin: 0; padding: 0; }
  .trd-bstack-item, .trd-data-item, .trd-neighbour, .trd-handler {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.2rem 0; font-size: 0.85rem;
  }
  .trd-controls li { font-size: 0.84rem; padding: 0.1rem 0; }

  .trd-drill-mini {
    background: none; border: none; padding: 0; font: inherit; color: inherit; font-weight: 600;
    cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
  }
  .trd-drill-mini:hover { text-decoration-style: solid; color: #00b8d4; }
  .trd-drill-mini:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }

  .trd-weaken { font-size: 0.74rem; color: #8a5a00; }
  .trd-harden { font-size: 0.74rem; color: #4a6a55; }
  .trd-stale { color: #c77700; font-weight: 600; }
  .trd-uncovered { font-size: 0.72rem; color: #8a5a00; margin-left: 0.4rem; }

  .trd-dir {
    display: inline-block; min-width: 3.6rem; text-align: center; border: 1px solid currentColor;
    border-radius: 3px; padding: 0 5px; font-size: 0.68rem; font-weight: 600;
  }
  .trd-dir--inbound, .trd-dir--source { color: #2c6fbb; }
  .trd-dir--outbound, .trd-dir--target { color: #b9651b; }

  .trd-sens {
    display: inline-block; border: 1px solid currentColor; border-radius: 10px;
    padding: 0 7px; font-size: 0.7rem; background: transparent; text-transform: capitalize;
  }
  .trd-sens--restricted { color: #c0392b; }
  .trd-sens--confidential { color: #b9651b; }
  .trd-sens--internal { color: #8a7400; }
  .trd-sens--public { color: #5f6a6a; }
  .trd-sens--unclassified { color: #c77700; }
  .trd-sens--unknown { color: #95a5a6; }

  .trd-table { border-collapse: collapse; width: 100%; }
  .trd-table td { border-bottom: 1px solid rgba(127, 127, 127, 0.18); padding: 4px 8px; vertical-align: top; }
  .trd-table--muted { opacity: 0.62; }
  .trd-table--uncovered { box-shadow: -3px 0 0 0 #c77700 inset; }
  .trd-row-stale td { border-left: 3px solid #c77700; }
  .trd-c-band { width: 5rem; }
  .trd-c-score { width: 3rem; text-align: right; font-variant-numeric: tabular-nums; }
  .trd-c-prov { font-size: 0.72rem; opacity: 0.7; width: 4rem; }
  .trd-c-act { width: 5rem; text-align: right; }
  /* Inline "Confirmed" lifecycle chip on a live row — risk-toned, outlined, never a
     solid stoplight, never green (an affirmed finding is still an open risk). */
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
  }
  .trd-disp { font-size: 0.75rem; opacity: 0.85; display: block; margin-top: 0.1rem; }
  .trd-band {
    display: inline-block; border: 1px solid currentColor; border-radius: 10px;
    padding: 0 7px; font-size: 0.72rem; text-transform: capitalize; background: transparent;
  }
  .trd-band--critical { color: #c0392b; }
  .trd-band--high { color: #b9651b; }
  .trd-band--medium { color: #8a7400; }
  .trd-band--low { color: #5f6a6a; }
  .trd-band--unknown { color: #7f8c8d; }
  .trd-disposed summary { cursor: pointer; font-size: 0.8rem; opacity: 0.7; margin: 0.3rem 0; }
  .trd-review {
    background: transparent; border: 1px solid currentColor; border-radius: 3px;
    padding: 1px 8px; font: inherit; font-size: 0.78rem; cursor: pointer; opacity: 0.8;
  }
  .trd-review:hover { opacity: 1; }
</style>
