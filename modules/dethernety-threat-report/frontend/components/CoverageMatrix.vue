<!--
  CoverageMatrix.vue — the ① MITRE Coverage & Gaps matrix (the graph-native payoff).

  Consumes the LIVE graded-coverage facts (dethernety-coverage-tools, via
  fetchGradedCoverage) joined to the SNAPSHOT ledger for disposition, through the
  pure buildCoverageView() honesty layer. This component is ENCODING ONLY — all
  bucketing/filtering/honesty lives in the lib.

  The encoding (ux §4, one legend to rule them all — the contract against a
  traffic-light buffet):
    TIER  = FILL, a monochrome ramp + ONE break-out texture:
              UNCOVERED  dotted-empty cell
              Mitigation ▓ mid solid
              DIRECT     █ full solid
              D3FEND     ░ HATCH texture (NOT a fainter shade — "inferred, broad")
    FUNCTION = GLYPH (not hue), across all tiers:  ⛉ prevent · ◎ detect
              detect-only = ◎ with no ⛉ ("see it, can't stop it")
  Hard budget: ONE fill + at most ONE glyph per cell. Provenance/disposition never
  enter a cell (ux anti-patterns 2–4). Colour is reserved for severity + stale
  elsewhere; this grid is monochrome. Rows = techniques the model's LIVE exposures
  map to (never the full ATT&CK matrix); columns = the tactics actually reached.

  Two disclosure levels (not three): L1 = fill + glyph + residual string in the
  cell title; L3 = drill → ⑥ (the element profile). No L2 popover.
-->
<template>
  <div class="trd-coverage">
    <!-- Coverage unavailable (module not deployed / not yet fetched): never a green grid. -->
    <p v-if="!view.available" class="trd-empty">
      Coverage facts are unavailable — the <code>dethernety-coverage-tools</code> module is not deployed for this
      instance, so the MITRE coverage matrix cannot be rendered. (The rest of the report is unaffected.)
    </p>

    <template v-else>
      <!-- Controls: legend toggle + tier filter + the uncovered/detect-only preset. -->
      <div class="trd-cov-controls">
        <button type="button" class="trd-cov-ctl" :class="{ 'trd-cov-ctl--on': showLegend }" @click="showLegend = !showLegend">
          {{ showLegend ? '▾' : '▸' }} Legend
        </button>
        <span class="trd-cov-ctl-sep" aria-hidden="true">·</span>
        <label class="trd-cov-filter">
          Tier
          <select v-model="tierFilter" class="trd-cov-select">
            <option value="all">all</option>
            <option value="DIRECT">DIRECT only</option>
            <option value="INDIRECT_MITIGATION">Mitigation only</option>
            <option value="INDIRECT_D3FEND">D3FEND only</option>
            <option value="UNCOVERED">uncovered</option>
          </select>
        </label>
        <button
          type="button"
          class="trd-cov-ctl"
          :class="{ 'trd-cov-ctl--on': gapsOnly }"
          @click="gapsOnly = !gapsOnly"
          title="Show only uncovered + detect-only techniques (the fund-a-control worklist)"
        >uncovered + detect-only</button>
        <span class="trd-cov-ctl-sep" aria-hidden="true">·</span>
        <!-- The persistent honesty caveat, condensed to a one-line toggle to reclaim
             vertical space — the full disclaimer (modeled, not telemetry; no percentage)
             expands on demand and still rides into the export footer. -->
        <button
          type="button"
          class="trd-cov-ctl trd-cov-ctl--info"
          :class="{ 'trd-cov-ctl--on': showCaveat }"
          @click="showCaveat = !showCaveat"
          title="Modeled / design-asserted coverage — not deployed telemetry. Click for the full caveat."
        >ⓘ Modeled coverage</button>
      </div>

      <p v-if="showCaveat" class="trd-caveat">
        Modeled / design-asserted coverage — <strong>not</strong> deployed telemetry. Counts are
        <strong>tier-segregated</strong> (DIRECT / Mitigation / D3FEND) and function-classified; there is
        <strong>no</strong> coverage percentage and no single “covered” total — the broad D3FEND tier is shown as a
        distinct hatch, never blended into a headline.
      </p>

      <!-- The legend (collapsed by default; baked into the export footer too). -->
      <table v-if="showLegend" class="trd-legend" aria-label="Coverage encoding legend">
        <tbody>
          <tr><td><span class="cov-cell cov-DIRECT"></span></td><td>DIRECT — author-asserted (strongest)</td></tr>
          <tr><td><span class="cov-cell cov-INDIRECT_MITIGATION"></span></td><td>Mitigation — catalogue-precise</td></tr>
          <tr><td><span class="cov-cell cov-INDIRECT_D3FEND"></span></td><td>D3FEND — inferred via shared artifact (broad)</td></tr>
          <tr><td><span class="cov-cell cov-UNCOVERED"></span></td><td>UNCOVERED — exploited technique, no covering control</td></tr>
          <tr><td><span class="cov-glyph">⛉</span> / <span class="cov-glyph">◎</span></td><td>prevent / detect (detect-only = ◎ alone)</td></tr>
        </tbody>
      </table>

      <!-- OFF-GRID notes — the counts are an honesty signal (the design fights the
           "false all-clear"), so the SUMMARY line with its counts is ALWAYS visible;
           only the verbose prose collapses behind it. Never hide the counts. -->
      <div v-if="offGridParts.length" class="trd-offgrid-summary">
        <div class="trd-offgrid-sumhead" @click="showOffgrid = !showOffgrid" :title="showOffgrid ? 'Hide the off-grid details' : 'Show the off-grid details'">
          <span class="trd-offgrid-caret" aria-hidden="true">{{ showOffgrid ? '▾' : '▸' }}</span>
          <span class="cov-offgrid-mark" aria-hidden="true">⚠</span>
          <span class="trd-offgrid-sumlabel">Off-grid:</span>
          <template v-for="(p, i) in offGridParts" :key="p.key"
            ><span class="trd-offgrid-stat">{{ p.label }}</span><span v-if="i < offGridParts.length - 1" class="trd-offgrid-statsep"> · </span
          ></template>
        </div>
      </div>

      <template v-if="showOffgrid">
      <p v-if="view.offGrid.softCount > 0" class="trd-offgrid">
        <span class="cov-offgrid-mark" aria-hidden="true">▦</span>
        {{ view.offGrid.softCount }} live exposure(s) have no ATT&CK mapping — coverage cannot be assessed (off-grid).
      </p>
      <div v-if="view.offGrid.dataMappedCount > 0" class="trd-offgrid">
        <div
          class="trd-offgrid-head"
          :class="{ 'trd-offgrid-head--toggle': dataMapped.length }"
          :title="dataMapped.length ? (showData ? 'Hide the techniques these Data exposures map to' : 'Show the techniques these Data exposures map to') : null"
          @click="dataMapped.length && (showData = !showData)"
        >
          <span v-if="dataMapped.length" class="trd-offgrid-caret" aria-hidden="true">{{ showData ? '▾' : '▸' }}</span>
          {{ view.offGrid.dataMappedCount }} Data exposure(s) map to ATT&CK; data-level coverage is not assessable —
          see Residual Risk (controls are attributed to the handling element, never to Data).
        </div>
        <!-- The mapping IS known (a fact about the exposure) even though coverage is
             not assessable for Data — disclosed here OFF-GRID: no tier fill/glyph, so
             a chip is identity + launcher, never a coverage claim. One row per Data
             element (drill → its profile); chips open the shared technique dialog. -->
        <div v-if="showData" class="trd-offgrid-list">
          <div v-for="d in dataMapped" :key="d.elementId" class="trd-offgrid-row">
            <button
              type="button"
              class="trd-el-link"
              @click="$emit('drill', d.elementId)"
              :title="`open ${d.elementName} profile`"
            >{{ d.elementName }}</button>
            <TechniqueChips :techniques="d.techniques" dense @show="infoTech = $event" />
          </div>
        </div>
      </div>
      <p v-for="cls in view.structuralGaps" :key="cls" class="trd-offgrid trd-offgrid--structural">
        No control in this model supports any <strong>{{ classLabel(cls) }}</strong> — a structural / maturity gap
        (one completeness line, not a per-technique cell count).
      </p>
      <p v-if="view.offGrid.dispositionedExcluded > 0" class="trd-muted-line">
        {{ view.offGrid.dispositionedExcluded }} dispositioned exposure(s) excluded from the live coverage grid
        (still listed in Residual Risk — never silently dropped).
      </p>
      </template>

      <!-- Empty grid: no technique reached — suppress the grid, never a clean-green matrix. -->
      <p v-if="!rows.length" class="trd-empty">
        <template v-if="view.rows.length && gapsOnly">No uncovered or detect-only techniques on the live grid —
          every charted technique has a preventive control. (This does <strong>not</strong> include the off-grid
          items above — soft/unmapped, Data, and structural gaps still apply.)</template>
        <template v-else-if="view.rows.length">No techniques match the current filter.</template>
        <template v-else>No live Component/DataFlow exposure maps to an ATT&CK technique — nothing to chart on the grid.
          (See the off-grid notes above; this is a modeling/coverage state, not an all-clear.)</template>
      </p>

      <!-- The matrix: rows = techniques, columns = reached tactics. -->
      <div v-else class="trd-matrix-scroll">
        <table class="trd-matrix">
          <thead>
            <tr>
              <th class="trd-matrix-corner" scope="col">Technique</th>
              <th
                v-for="tac in tactics"
                :key="tac"
                scope="col"
                class="trd-matrix-col trd-matrix-col--btn"
                :class="{ 'trd-matrix-col--active': tacticFilter === tac }"
                :aria-pressed="tacticFilter === tac"
                :title="tacticFilter === tac ? `showing only ${tac} techniques — click to clear` : `show only techniques in ${tac}`"
                @click="toggleTactic(tac)"
              >{{ tac }}<span v-if="tacticFilter === tac" class="trd-matrix-col-x" aria-hidden="true"> ✕</span></th>
              <th scope="col" class="trd-matrix-best">Best</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.techniqueId">
              <th scope="row" class="trd-matrix-row">
                <!-- Technique id. For a technique on >1 element it's an expand
                     toggle: collapsed shows just the element count, expanded reveals
                     the full impacted-element list (no height cap). A single-element
                     technique shows its element inline — nothing to expand. -->
                <div
                  class="trd-tech-head"
                  :class="{ 'trd-tech-head--toggle': r.elements.length > 1 }"
                  :title="rowTitle(r)"
                  @click="r.elements.length > 1 && toggleRow(r.techniqueId)"
                >
                  <span v-if="r.elements.length > 1" class="trd-tech-caret" aria-hidden="true">{{ isExpanded(r.techniqueId) ? '▾' : '▸' }}</span>
                  <span class="trd-tech-id">{{ r.techniqueId }}</span>
                  <button
                    type="button"
                    class="trd-tech-info"
                    @click.stop="openInfo(r)"
                    :title="r.name ? `${r.techniqueId}: ${r.name} — details` : `What is ${r.techniqueId}?`"
                    aria-label="Technique details"
                  >ⓘ</button>
                </div>
                <!-- single element: inline drill link -->
                <button
                  v-if="r.elements.length === 1"
                  type="button"
                  class="trd-el-link"
                  :class="{ 'trd-el-link--covered': r.elements[0].covered }"
                  @click="$emit('drill', r.elements[0].id)"
                  :title="`${r.elements[0].covered ? 'covered' : 'UNCOVERED'} — open ${r.elements[0].name}`"
                >{{ r.elements[0].covered ? '✓ ' : '' }}{{ r.elements[0].name }}</button>
                <!-- multi: count when collapsed, full list (uncapped) when expanded -->
                <template v-else>
                  <button
                    v-if="!isExpanded(r.techniqueId)"
                    type="button"
                    class="trd-tech-count"
                    @click="toggleRow(r.techniqueId)"
                  >{{ r.elementsTotal }} elements · {{ r.elementsCovered }} covered</button>
                  <div v-else class="trd-tech-els">
                    <button
                      v-for="el in r.elements"
                      :key="el.id"
                      type="button"
                      class="trd-el-link"
                      :class="{ 'trd-el-link--covered': el.covered }"
                      @click="$emit('drill', el.id)"
                      :title="`${el.covered ? 'covered' : 'UNCOVERED'} — open ${el.name}`"
                    >{{ el.covered ? '✓ ' : '' }}{{ el.name }}</button>
                  </div>
                </template>
              </th>
              <td v-for="tac in tactics" :key="tac" class="trd-matrix-cell">
                <span
                  v-if="r.tactics.includes(tac)"
                  class="cov-cell"
                  :class="`cov-${r.bestTier || 'UNCOVERED'}`"
                  :title="rowTitle(r)"
                >
                  <span v-if="cellGlyph(r)" class="cov-glyph">{{ cellGlyph(r) }}</span>
                </span>
              </td>
              <td class="trd-matrix-best">
                <span class="trd-best-label" :title="rowTitle(r)">{{ bestLabel(r) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- "What is this technique?" dialog — an attack_id is opaque on its own, so a
         row's ⓘ opens the ATT&CK name + tactics + description here. The SHARED
         dialog (also used by ⑥ and ④), so the affordance is identical everywhere. -->
    <TechniqueInfoDialog :technique="infoTech" @close="closeInfo" />
  </div>
</template>

<script setup>
  import { computed, reactive, ref } from 'vue'
  import { buildCoverageView, filterByTier, TIER_LABEL } from '../lib/coverageMatrix.js'
  import TechniqueInfoDialog from './TechniqueInfoDialog.vue'
  import TechniqueChips from './TechniqueChips.vue'

  const props = defineProps({
    // Parsed gradedCoverage (or null when coverage-tools isn't deployed).
    coverage: { type: Object, default: null },
    // The snapshot ledger (for the disposition join + supporting controls).
    ledger: { type: Array, default: () => [] },
  })

  // Drill to ⑥ for an element (the shell turns this into a profile overlay).
  const emit = defineEmits(['drill'])

  const showLegend = ref(false)
  const tierFilter = ref('all')
  const gapsOnly = ref(false)
  // Click a tactic column header to filter the rows to techniques in that tactic
  // (null = all tactics). A second click on the same header clears it.
  const tacticFilter = ref(null)
  const toggleTactic = (tac) => { tacticFilter.value = tacticFilter.value === tac ? null : tac }
  // Expand state for the off-grid Data → ATT&CK disclosure (collapsed by default —
  // a count line that opens to the per-element technique chips on demand).
  const showData = ref(false)
  // Header-weight reclaim: the full caveat + the verbose off-grid prose collapse
  // behind compact toggles (the off-grid COUNTS stay visible — see offGridParts).
  const showCaveat = ref(false)
  const showOffgrid = ref(false)

  // Per-technique expand state for the impacted-element list (collapsed by default;
  // multi-element rows reveal their full list on demand).
  const expanded = reactive({})
  const isExpanded = (techniqueId) => !!expanded[techniqueId]
  const toggleRow = (techniqueId) => { expanded[techniqueId] = !expanded[techniqueId] }

  // The "what is this technique?" info dialog — an attack_id alone is opaque, so a
  // click on a row's ⓘ opens its ATT&CK name + tactics + description.
  const infoTech = ref(null)
  const openInfo = (r) => { infoTech.value = r }
  const closeInfo = () => { infoTech.value = null }

  const view = computed(() => buildCoverageView(props.coverage, props.ledger))
  const tactics = computed(() => (view.value.available ? view.value.tactics : []))
  // The off-grid Data exposures with their resolved ATT&CK techniques (per element).
  const dataMapped = computed(() => (view.value.available ? view.value.offGrid?.dataMapped ?? [] : []))

  // The always-visible off-grid COUNTS (the honesty signal). Each present category
  // becomes a compact stat; the verbose prose lives behind the expand. Plural-aware.
  const offGridParts = computed(() => {
    if (!view.value.available) return []
    const o = view.value.offGrid ?? {}
    const sg = view.value.structuralGaps ?? []
    const parts = []
    if (o.softCount > 0) parts.push({ key: 'soft', label: `${o.softCount} unmapped` })
    if (o.dataMappedCount > 0) parts.push({ key: 'data', label: `${o.dataMappedCount} Data-mapped` })
    if (sg.length) parts.push({ key: 'struct', label: `${sg.length} structural gap${sg.length > 1 ? 's' : ''}` })
    if (o.dispositionedExcluded > 0) parts.push({ key: 'disp', label: `${o.dispositionedExcluded} excluded` })
    return parts
  })

  // Rows after the local tier filter + the uncovered/detect-only preset.
  const rows = computed(() => {
    if (!view.value.available) return []
    // The tier options partition the rows by BEST tier so they sum to "all".
    let out = filterByTier(view.value.rows, tierFilter.value)
    if (gapsOnly.value) {
      out = out.filter((r) => r.status === 'UNCOVERED' || r.status === 'DETECT_ONLY')
    }
    if (tacticFilter.value) {
      out = out.filter((r) => r.tactics.includes(tacticFilter.value))
    }
    return out
  })

  const classLabel = (c) => (c === 'DataFlow' ? 'data flow' : c === 'SecurityBoundary' ? 'security boundary' : 'component')

  // ONE function glyph per cell: prevent ⛉, detect ◎; uncovered → none.
  const cellGlyph = (r) => {
    if (r.status === 'PREVENT') return '⛉'
    if (r.status === 'DETECT_ONLY') return '◎'
    return '' // UNCOVERED: empty dotted cell, no glyph
  }

  const bestLabel = (r) => {
    if (!r.covered) return 'UNCOVERED'
    const tier = TIER_LABEL[r.bestTier] ?? r.bestTier
    if (r.status === 'DETECT_ONLY') return `${tier}-detect${r.bestTier === 'INDIRECT_D3FEND' ? ' (broad)' : ''}`
    return `${tier}-prevent${r.bestTier === 'INDIRECT_D3FEND' ? ' (broad)' : ''}`
  }

  // L1 residual string — rides in the cell/row title, not a popover.
  const rowTitle = (r) => {
    const named = r.name ? `${r.techniqueId} · ${r.name}` : r.techniqueId
    const cov = `covered for ${r.elementsCovered} of ${r.elementsTotal} element(s)`
    const gap = r.elementsTotal - r.elementsCovered
    const tail = gap > 0 ? ` · ${gap} UNCOVERED` : ''
    return `${named} — ${bestLabel(r)} · ${cov}${tail}`
  }
</script>

<style scoped>
  /* Fill the shell's single scroll region and lay out as a column: the caveat,
     controls, legend and off-grid banners stay fixed, and the matrix table is the
     one part that scrolls (so the page itself doesn't also scroll). */
  .trd-coverage { font-size: 0.9rem; height: 100%; display: flex; flex-direction: column; }
  .trd-caveat { font-size: 0.75rem; opacity: 0.6; margin: 0 0 0.9rem; line-height: 1.5; }
  .trd-empty { opacity: 0.78; font-size: 0.88rem; }
  .trd-muted-line { opacity: 0.6; font-size: 0.8rem; margin: 0.4rem 0; }

  .trd-cov-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; font-size: 0.82rem; }
  .trd-cov-ctl {
    background: transparent; border: 1px solid rgba(127,127,127,0.4); border-radius: 4px;
    padding: 0.2rem 0.6rem; font: inherit; font-size: 0.8rem; cursor: pointer; opacity: 0.85;
  }
  .trd-cov-ctl:hover { opacity: 1; background: rgba(127,127,127,0.08); }
  .trd-cov-ctl--on { background: rgba(0,184,212,0.12); border-color: #00b8d4; opacity: 1; font-weight: 600; }
  .trd-cov-ctl-sep { opacity: 0.4; }
  .trd-cov-filter { display: inline-flex; align-items: center; gap: 0.3rem; }
  .trd-cov-select { font: inherit; font-size: 0.8rem; background: transparent; border: 1px solid rgba(127,127,127,0.4); border-radius: 4px; padding: 0.15rem 0.3rem; }

  .trd-legend { border-collapse: collapse; margin: 0 0 0.8rem; font-size: 0.78rem; }
  .trd-legend td { padding: 0.15rem 0.5rem 0.15rem 0; vertical-align: middle; }
  /* In the legend the prevent/detect glyphs stand alone (no fill behind them), so
     they take the readable on-surface ink rather than the on-a-fill surface colour. */
  .trd-legend .cov-glyph { color: rgb(var(--v-theme-on-surface, 255 255 255)); }

  .trd-offgrid {
    font-size: 0.82rem; margin: 0.3rem 0; padding: 0.35rem 0.6rem;
    background: rgba(127,127,127,0.08); border-left: 3px solid rgba(127,127,127,0.45); border-radius: 0 4px 4px 0;
  }
  .trd-offgrid--structural { border-left-color: #c77700; }
  .cov-offgrid-mark { font-family: monospace; opacity: 0.6; }

  /* The compact off-grid SUMMARY — one line, counts always visible, the prose behind
     a caret. Keeps the honesty signal at a glance while halving the header weight. */
  .trd-offgrid-summary { margin: 0.4rem 0; }
  .trd-offgrid-sumhead {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem;
    font-size: 0.82rem; cursor: pointer; padding: 0.3rem 0.6rem;
    background: rgba(127,127,127,0.08); border-left: 3px solid rgba(199,119,0,0.7); border-radius: 0 4px 4px 0;
  }
  .trd-offgrid-sumhead:hover { background: rgba(127,127,127,0.14); }
  .trd-offgrid-sumlabel { font-weight: 600; opacity: 0.85; }
  .trd-offgrid-stat { opacity: 0.9; }
  .trd-offgrid-statsep { opacity: 0.4; }
  /* The condensed caveat toggle reads as a muted info affordance, not a filter. */
  .trd-cov-ctl--info { opacity: 0.7; }
  .trd-cov-ctl--info:hover { opacity: 1; }

  /* The Data → ATT&CK disclosure: a count line that expands to per-element chips.
     The head is the toggle (caret) when there's something to reveal; the list sits
     under it, indented to align past the caret. OFF-grid: no tier fill ever here. */
  .trd-offgrid-head { display: flex; align-items: baseline; gap: 0.3rem; }
  .trd-offgrid-head--toggle { cursor: pointer; }
  .trd-offgrid-head--toggle:hover { opacity: 0.95; }
  .trd-offgrid-caret { font-size: 0.65rem; opacity: 0.7; flex: 0 0 auto; }
  .trd-offgrid-list { margin: 0.45rem 0 0.1rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .trd-offgrid-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }

  /* Fills the remaining column height (flex:1) and is the single scroll region —
     both axes scroll HERE (sticky headers pin to it), and because it sizes to the
     leftover space the page never needs a second scrollbar. */
  .trd-matrix-scroll { flex: 1 1 0; min-height: 0; overflow: auto; border: 1px solid rgba(127,127,127,0.25); border-radius: 6px; }
  .trd-matrix { border-collapse: collapse; font-size: 0.8rem; width: max-content; min-width: 100%; }
  .trd-matrix thead th {
    position: sticky; top: 0; z-index: 1; background: rgb(var(--v-theme-surface, 33 33 33));
    padding: 0.4rem 0.5rem; text-align: left; font-size: 0.72rem; font-weight: 600;
    border-bottom: 1px solid rgba(127,127,127,0.3); white-space: nowrap;
  }
  .trd-matrix-col { writing-mode: horizontal-tb; max-width: 8rem; }
  /* Clickable tactic header → filter rows to that tactic (toggle). */
  .trd-matrix-col--btn { cursor: pointer; user-select: none; }
  .trd-matrix-col--btn:hover { color: #00b8d4; }
  .trd-matrix-col--active { color: #00b8d4; background: rgba(0,184,212,0.12) !important; }
  .trd-matrix-col-x { font-size: 0.65rem; opacity: 0.8; }
  /* The technique-id column is sticky on BOTH axes' intersection (corner) and the
     row headers stay anchored on horizontal scroll, so a wide matrix never loses
     its row labels. */
  .trd-matrix-row {
    text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(127,127,127,0.12);
    font-weight: 500; vertical-align: top;
    min-width: 11rem; max-width: 19rem;
    position: sticky; left: 0; z-index: 1; background: rgb(var(--v-theme-surface, 33 33 33));
  }
  .trd-matrix-corner { left: 0; z-index: 2; }
  /* Cells + Best align to the top so they sit beside the technique id even when the
     impacted-element list makes a row taller. */
  .trd-matrix-cell { text-align: center; padding: 0.3rem 0.35rem; border-bottom: 1px solid rgba(127,127,127,0.12); vertical-align: top; }
  .trd-matrix-best { padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(127,127,127,0.12); white-space: nowrap; vertical-align: top; }
  .trd-best-label { font-size: 0.72rem; opacity: 0.75; }

  /* Row label: the technique id (an expand toggle when it hits >1 element), then —
     collapsed — the element count, or — expanded — the full impacted-element list as
     individual drill links (so it's clear WHICH elements a technique hits, and a
     click lands on the right one). Covered elements are muted; the uncovered gaps
     lead. The expanded list is NOT height-capped — it grows with the row. */
  .trd-tech-head { display: flex; align-items: baseline; gap: 0.3rem; }
  .trd-tech-head--toggle { cursor: pointer; }
  .trd-tech-head--toggle:hover .trd-tech-id { color: #00b8d4; }
  .trd-tech-caret { font-size: 0.65rem; opacity: 0.7; }
  .trd-tech-id { font-weight: 600; white-space: nowrap; }
  /* The "what is this technique?" affordance — opaque attack_id → ATT&CK name+desc. */
  .trd-tech-info {
    background: none; border: none; padding: 0 0 0 0.15rem; font: inherit; font-size: 0.78rem;
    line-height: 1; color: inherit; opacity: 0.4; cursor: pointer;
  }
  .trd-tech-info:hover { opacity: 1; color: #00b8d4; }
  .trd-tech-info:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-tech-count {
    background: none; border: none; padding: 0; margin-top: 0.15rem; font: inherit; font-size: 0.72rem;
    color: inherit; opacity: 0.6; cursor: pointer; display: block;
    text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
  }
  .trd-tech-count:hover { opacity: 0.9; color: #00b8d4; }
  .trd-tech-els { display: flex; flex-direction: column; align-items: flex-start; gap: 0.05rem; margin-top: 0.2rem; }
  .trd-el-link {
    background: none; border: none; padding: 0; font: inherit; font-size: 0.72rem; color: inherit;
    cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.92;
  }
  .trd-el-link:hover { color: #00b8d4; opacity: 1; }
  .trd-el-link--covered { opacity: 0.5; }
  .trd-el-link:focus-visible, .trd-tech-count:focus-visible, .trd-cov-ctl:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }

  /* The encoding — a MONOCHROME ramp (magnitude, not colour) + one hatch texture.
     Greyscale only: tier strength never shares a channel with severity (which owns
     colour elsewhere). D3FEND is a TEXTURE, so the broad tier can't masquerade as
     "a little covered" (ux anti-pattern #3). */
  .cov-cell {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.1rem; border-radius: 3px; vertical-align: middle;
  }
  /* Built from the theme's on-surface ink (rgba over the surface), so "more ink =
     stronger tier" reads correctly on BOTH themes: on the dark host DIRECT is a
     near-solid light fill, Mitigation a mid fill, D3FEND a sparse hatch; on a light
     theme the same alphas read as near-solid dark → mid → hatch. The glyph takes the
     surface colour (the inverse of the ink), so it contrasts against the solid
     fills; on the faint D3FEND base it switches to on-surface ink. */
  .cov-glyph { font-size: 0.8rem; line-height: 1; color: rgb(var(--v-theme-surface, 33 33 33)); }
  .cov-DIRECT { background: rgba(var(--v-theme-on-surface, 255 255 255), 0.88); }    /* full — strongest */
  .cov-INDIRECT_MITIGATION { background: rgba(var(--v-theme-on-surface, 255 255 255), 0.45); } /* mid */
  .cov-INDIRECT_D3FEND {                               /* hatch TEXTURE, never a flat shade */
    background-color: rgba(var(--v-theme-on-surface, 255 255 255), 0.10);
    /* coarse hatch (3px stripe / 7px period) so it reads as a TEXTURE even in a
       small cell — never blurs toward a flat "lighter shade" of the ramp. */
    background-image: repeating-linear-gradient(45deg,
      rgba(var(--v-theme-on-surface, 255 255 255), 0.65) 0,
      rgba(var(--v-theme-on-surface, 255 255 255), 0.65) 3px,
      transparent 3px, transparent 7px);
  }
  .cov-INDIRECT_D3FEND .cov-glyph { color: rgb(var(--v-theme-on-surface, 255 255 255)); } /* glyph on the faint hatch base */
  .cov-UNCOVERED {                                     /* dotted empty */
    background: transparent; border: 1px dotted rgba(var(--v-theme-on-surface, 255 255 255), 0.5);
  }
</style>
