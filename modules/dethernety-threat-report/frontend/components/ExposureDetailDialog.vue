<!--
  ExposureDetailDialog.vue — the shared "what is this exposure?" dialog.

  A residual-risk row shows only an exposure's name + score band + ATT&CK chips.
  This opens its FULL detail: description, classification, suggested mitigations,
  detection methods, references, tags, the element it sits on, resolved ATT&CK
  techniques (chips → the technique dialog, stacked above), provenance, and the
  disposition history. Used by the Residual Risk ledger, the Component Profile,
  and the Reachability strip — ONE component so the affordance is identical
  everywhere. Read-only: disposition ACTIONS stay on the row's FindingActions;
  this surfaces the frozen-snapshot detail only.

  A Vuetify v-dialog so it stacks correctly above the Component Profile dialog and
  inherits the host scrim / Esc / teleport; its own nested TechniqueInfoDialog
  stacks one higher again.

  Honesty: suggested mitigations are CLASS-AUTHORED suggestions for this exposure
  *type* — explicitly NOT controls applied to this element and never a coverage
  claim (the framing line + the muted styling keep them apart from real controls).
  The score band is a triage sort-aid (0–10), not a risk rating.
-->
<template>
  <v-dialog
    :model-value="!!exposure"
    max-width="680"
    scrollable
    @update:model-value="(v) => { if (!v) $emit('close') }"
  >
    <div
      v-if="exposure"
      class="trd-xd-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trd-xd-title"
    >
      <div class="trd-xd-head">
        <div>
          <h3 id="trd-xd-title" class="trd-xd-title">{{ exposure.name }}</h3>
          <p class="trd-xd-sub">
            <span class="trd-xd-band" :class="`trd-band--${exposure.band}`">{{ exposure.band }}</span>
            <span class="trd-xd-score">score {{ exposure.score == null ? '—' : exposure.score }}</span>
            <span v-if="exposure.attackVector" class="trd-xd-vec">{{ exposure.attackVector }}</span>
            <span class="trd-xd-prov">{{ exposure.provenance }}</span>
            <span v-if="exposure.type" class="trd-xd-class">{{ exposure.type }}<span v-if="exposure.category"> · {{ exposure.category }}</span></span>
          </p>
        </div>
        <button type="button" class="trd-xd-close" @click="$emit('close')" aria-label="Close">✕</button>
      </div>

      <!-- The element it sits on -->
      <p v-if="exposure.element" class="trd-xd-on">
        On <strong>{{ exposure.element.name }}</strong>
        <span v-if="exposure.element.type" class="trd-xd-on-type">{{ exposure.element.type }}</span>
        <button
          v-if="exposure.element.id"
          type="button"
          class="trd-xd-drill"
          @click="$emit('drill', exposure.element.id)"
          :title="`Open ${exposure.element.name} profile`"
        >open profile ↗</button>
      </p>

      <!-- Crown-jewel route cross-ref (the ② visibility join) -->
      <p v-if="exposure.onCrownJewelRoute" class="trd-xd-route">
        ‼ Sits on a modeled flow route to crown jewel{{ exposure.routeJewels.length === 1 ? '' : 's' }}:
        {{ exposure.routeJewels.join(', ') }} <span class="trd-xd-route-note">(see Reachability)</span>
      </p>

      <!-- Description -->
      <section v-if="exposure.hasDescription" class="trd-xd-sec">
        <h4 class="trd-xd-h">Description</h4>
        <p class="trd-xd-prose">{{ exposure.description }}</p>
      </section>
      <p v-else class="trd-xd-none">No description recorded for this exposure.</p>

      <!-- ATT&CK techniques (chips open the technique dialog, stacked above) -->
      <section v-if="exposure.techniques.length" class="trd-xd-sec">
        <h4 class="trd-xd-h">ATT&amp;CK techniques</h4>
        <TechniqueChips :techniques="exposure.techniques" @show="infoTech = $event" />
      </section>

      <!-- Suggested mitigations — honesty-framed: suggestions for the TYPE, not applied controls -->
      <section v-if="exposure.hasMitigations" class="trd-xd-sec">
        <h4 class="trd-xd-h">Suggested mitigations</h4>
        <p class="trd-xd-framing">
          Generic suggestions for this exposure type — <strong>not</strong> controls applied to this
          element, and not a coverage claim.
        </p>
        <ul class="trd-xd-list">
          <li v-for="(m, i) in exposure.mitigationSuggestions" :key="`m${i}`">{{ m }}</li>
        </ul>
      </section>

      <!-- Detection methods -->
      <section v-if="exposure.hasDetection" class="trd-xd-sec">
        <h4 class="trd-xd-h">Detection methods</h4>
        <ul class="trd-xd-list">
          <li v-for="(d, i) in exposure.detectionMethods" :key="`d${i}`">{{ d }}</li>
        </ul>
      </section>

      <!-- References -->
      <section v-if="exposure.hasReferences" class="trd-xd-sec">
        <h4 class="trd-xd-h">References</h4>
        <p class="trd-xd-prose trd-xd-refs">{{ exposure.references }}</p>
      </section>

      <!-- Tags -->
      <section v-if="exposure.hasTags" class="trd-xd-sec">
        <h4 class="trd-xd-h">Tags</h4>
        <span v-for="(t, i) in exposure.tags" :key="`t${i}`" class="trd-xd-tag">{{ t }}</span>
      </section>

      <!-- Disposition history (read-only) -->
      <section v-if="exposure.disposition" class="trd-xd-sec trd-xd-disp">
        <h4 class="trd-xd-h">Disposition</h4>
        <p class="trd-xd-prose">
          <strong>{{ exposure.disposition.kindLabel }}</strong>
          <span v-if="exposure.disposition.stale" class="trd-xd-stale"> · ⚠ stale</span>
          <span v-if="exposure.disposition.by || exposure.disposition.at" class="trd-xd-by">
            · {{ exposure.disposition.by || 'unknown' }}{{ exposure.disposition.at ? ' · ' + exposure.disposition.at : '' }}
          </span>
        </p>
        <p v-if="exposure.disposition.reason" class="trd-xd-reason">{{ exposure.disposition.reason }}</p>
      </section>

      <p class="trd-xd-foot">
        Exposure detail · frozen with this report snapshot · the score band orders findings for triage, it is not a risk rating.
      </p>
    </div>

    <!-- Nested technique dialog — stacks above this one (Vuetify z-index) -->
    <TechniqueInfoDialog :technique="infoTech" @close="infoTech = null" />
  </v-dialog>
</template>

<script setup>
  import { ref } from 'vue'
  import TechniqueChips from './TechniqueChips.vue'
  import TechniqueInfoDialog from './TechniqueInfoDialog.vue'

  defineProps({
    // The exposure detail view-model from buildExposureDetail(). null ⇒ closed.
    exposure: { type: Object, default: null },
  })
  defineEmits(['close', 'drill'])

  const infoTech = ref(null)
</script>

<style scoped>
  .trd-xd-panel {
    background: rgb(var(--v-theme-surface, 33 33 33));
    color: rgb(var(--v-theme-on-surface, 255 255 255));
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    max-height: 82vh;
    overflow-y: auto;
    padding: 1rem 1.2rem;
  }
  .trd-xd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .trd-xd-title { margin: 0; font-size: 1.1rem; line-height: 1.3; }
  .trd-xd-sub { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.4rem 0 0; font-size: 0.74rem; opacity: 0.85; }
  .trd-xd-band { text-transform: uppercase; font-size: 0.64rem; letter-spacing: 0.04em; padding: 0 6px; border-radius: 9px; border: 1px solid currentColor; }
  .trd-band--critical { color: #ff5252; }
  .trd-band--high { color: #ff9800; }
  .trd-band--medium { color: #ffc107; }
  .trd-band--low { color: #9ccc65; }
  .trd-band--unknown { color: #9e9e9e; }
  .trd-xd-score { font-variant-numeric: tabular-nums; }
  .trd-xd-vec, .trd-xd-class { font-family: ui-monospace, monospace; opacity: 0.8; }
  .trd-xd-prov { opacity: 0.7; }
  .trd-xd-close { background: none; border: none; font: inherit; font-size: 1.1rem; color: inherit; opacity: 0.7; cursor: pointer; }
  .trd-xd-close:hover { opacity: 1; }
  .trd-xd-close:focus-visible { outline: 2px solid #00b8d4; outline-offset: 2px; }
  .trd-xd-on { font-size: 0.82rem; margin: 0.7rem 0 0; opacity: 0.9; }
  .trd-xd-on-type { font-family: ui-monospace, monospace; font-size: 0.72rem; opacity: 0.7; margin-left: 0.4rem; }
  .trd-xd-drill { background: none; border: none; font: inherit; font-size: 0.76rem; color: #00b8d4; cursor: pointer; margin-left: 0.5rem; padding: 0; }
  .trd-xd-drill:hover { text-decoration: underline; }
  .trd-xd-route { font-size: 0.8rem; margin: 0.6rem 0 0; color: #ff9800; }
  .trd-xd-route-note { opacity: 0.7; }
  .trd-xd-sec { margin: 0.9rem 0 0; }
  .trd-xd-h { margin: 0 0 0.35rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; }
  .trd-xd-prose { font-size: 0.85rem; line-height: 1.55; margin: 0; white-space: pre-wrap; }
  .trd-xd-refs { font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .trd-xd-framing { font-size: 0.76rem; opacity: 0.7; margin: 0 0 0.4rem; font-style: italic; }
  .trd-xd-list { margin: 0; padding-left: 1.1rem; font-size: 0.83rem; line-height: 1.5; }
  .trd-xd-list li { margin: 0.15rem 0; }
  .trd-xd-tag { display: inline-block; font-size: 0.7rem; border: 1px solid rgba(127, 127, 127, 0.45); border-radius: 9px; padding: 0 7px; margin: 0 0.3rem 0.3rem 0; opacity: 0.8; }
  .trd-xd-disp { border-top: 1px solid rgba(127, 127, 127, 0.25); padding-top: 0.7rem; }
  .trd-xd-stale { color: #ff9800; }
  .trd-xd-by { opacity: 0.7; font-size: 0.78rem; }
  .trd-xd-reason { font-size: 0.82rem; margin: 0.25rem 0 0; opacity: 0.9; white-space: pre-wrap; }
  .trd-xd-none { font-size: 0.82rem; opacity: 0.55; margin: 0.9rem 0 0; font-style: italic; }
  .trd-xd-foot { font-size: 0.68rem; opacity: 0.5; margin: 1rem 0 0; }
</style>
