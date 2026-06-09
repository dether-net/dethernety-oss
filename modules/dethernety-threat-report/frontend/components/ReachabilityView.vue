<!--
  ReachabilityView.vue — the Flow-Route / Reachability view.

  Presentational over the pure `reachability.js` engine (client-side, simple-path,
  bounded). TWO modes share one engine + one minimap:

    • Mode A — Crown-Jewel Reachability: from a SELECTABLE origin (default
      External entry-points; or any node as an assumed-breach origin) → which
      crown jewels are reachable, in how few hops, with what threats on the way.
      Each reachable jewel → "view strip" (its shortest route) and "show on map".
      Each strip node → an onward-pivot that re-anchors the origin (the
      node-by-node "if they breached this, where next" exploration).

    • Mode B — Pick two: two autocomplete pickers (origin/target, any node) drive
      route enumeration; the expanded minimap is a co-equal click-to-pick surface
      (first click = pending dashed, second = commit, third = reset). The selected
      route renders as a linearised "subway strip".

  HONESTY: these are FLOW ROUTES and the threats on them — NEVER
  "attack paths". The model is TOPOLOGICAL (hop count is proximity, not effort; it
  does not model credential reuse / token theft). Unreachable = "no modeled flow
  route" tied to the scope banner — never "segmented / safe". Crossings are
  structural EXIT/ENTER (no trust chips). Truncation is a PERSISTENT "of N" banner,
  never a toast.
-->
<template>
  <div class="trd-reach">
    <!-- honesty caption (always visible, travels into export) -->
    <p class="trd-reach-caveat">
      <strong>Flow routes and the threats on them</strong> — not attack paths.
      Topological: hop count is proximity, not attacker effort; this does
      <strong>not</strong> model credential reuse or token theft. An unreachable
      jewel means <strong>no modeled flow route</strong> (a modeling gap — see the
      scope banner), never "segmented" or "safe".
    </p>

    <!-- mode toggle -->
    <nav class="trd-reach-modes" role="tablist" aria-label="Reachability modes">
      <button
        type="button" role="tab" class="trd-reach-mode"
        :class="{ 'trd-reach-mode--active': subMode === 'A' }"
        :aria-selected="subMode === 'A'"
        @click="setSubMode('A')"
      >Crown-jewel reachability</button>
      <button
        type="button" role="tab" class="trd-reach-mode"
        :class="{ 'trd-reach-mode--active': subMode === 'B' }"
        :aria-selected="subMode === 'B'"
        @click="setSubMode('B')"
      >Pick two</button>
      <button
        type="button" role="tab" class="trd-reach-mode"
        :class="{ 'trd-reach-mode--active': subMode === 'C' }"
        :aria-selected="subMode === 'C'"
        @click="setSubMode('C')"
      >Blast radius</button>
    </nav>

    <div class="trd-reach-body">
      <!-- spatial home: the faithful minimap. A glanceable sidebar overview with
           the built-in ENLARGE (⤢) button → a big modal (DFD shapes + readable
           labels) that is the primary pick-two surface for busy models; selection
           + pending + route highlight are forwarded into the modal. -->
      <div class="trd-reach-map">
        <ModelMinimap
          :model-graph="modelGraph"
          :crown-jewel-ids="jewelIds"
          :entry-point-ids="entryIds"
          :highlight-ids="mapHighlightIds"
          :highlight-edge-ids="mapHighlightEdgeIds"
          :pending-ids="mapPendingIds"
          :selectable="subMode === 'B' || subMode === 'C'"
          variant="sidebar"
          @pick="onMapPick"
        />
        <p class="trd-reach-maphint">
          <span v-if="subMode === 'B' && !mbTarget && mbOrigin">Pick the <strong>target</strong> node — enlarge the map (⤢) to click it, or choose below.</span>
          <span v-else-if="subMode === 'B' && !mbOrigin">Pick the <strong>origin</strong> node — enlarge the map (⤢) to click it, or choose below.</span>
          <span v-else-if="subMode === 'B'"><button type="button" class="trd-linkbtn" @click="resetPicks">reset selection</button></span>
          <span v-else-if="subMode === 'C' && !brOrigin"><strong>Click a node</strong> on the map (or choose below) to set the assumed-breached origin — enlarge (⤢) for easier clicks.</span>
          <span v-else-if="subMode === 'C'">The <strong>blast radius</strong> from <strong>{{ blast && blast.originName }}</strong> is highlighted. Click another node to re-anchor.</span>
          <span v-else>Crown jewels are <span class="trd-key-jewel">red</span>, external entry-points <span class="trd-key-entry">amber</span>. Highlight a route from the list.</span>
        </p>

        <!-- Route legend — the strip vocabulary, so the glyphs aren't cryptic.
             Reuses the strip's own glyph classes, so the colours match exactly. -->
        <div v-if="subMode === 'B'" class="trd-reach-legend" aria-label="Route legend">
          <span class="trd-leg-title">Route legend</span>
          <span class="trd-leg-item">
            <span class="trd-strip-glyph" aria-hidden="true">◉</span> component ·
            <span class="trd-strip-glyph trd-strip-glyph--jewel" aria-hidden="true">⬢</span> crown jewel
          </span>
          <span class="trd-leg-item">
            <em class="trd-leg-flow">flow name</em> — data flow on a hop (opens its profile)
          </span>
          <span class="trd-leg-item">
            <span class="trd-cross--exit">◂ EXIT</span> / <span class="trd-cross--enter">▸ ENTER</span> — boundary crossing (opens the boundary)
          </span>
          <span class="trd-leg-item">
            <span class="trd-leg-dots" aria-hidden="true"><span class="trd-dot trd-dot--critical">⬤</span><span class="trd-dot trd-dot--high">⬤</span><span class="trd-dot trd-dot--medium">⬤</span><span class="trd-dot trd-dot--low">⬤</span></span>
            worst live threat (critical → low)
          </span>
          <span class="trd-leg-item">
            <span class="trd-sens trd-sens--restricted">Restricted</span> data sensitivity (carried / handled)
          </span>
        </div>
      </div>

      <!-- ───────────────────── Mode A ───────────────────── -->
      <div v-if="subMode === 'A'" class="trd-reach-main">
        <div class="trd-reach-origin">
          <v-autocomplete
            v-model="originSel"
            :items="originItems"
            item-title="title"
            item-value="value"
            label="From"
            density="compact"
            variant="outlined"
            hide-details
            :menu-props="{ maxHeight: 320 }"
          />
          <span class="trd-reach-originlabel">{{ modeA.originLabel }}</span>
        </div>

        <!-- empty states (honest, never green) -->
        <p v-if="!modeA.hasCrownJewels" class="trd-empty">
          No components are marked as crown jewels — crown-jewel reachability is not
          assessable. Mark high-value assets as crown jewels, or use <button type="button" class="trd-linkbtn" @click="setSubMode('B')">Pick two</button> to trace any route.
        </p>
        <p v-else-if="!modeA.hasOrigin" class="trd-empty">
          No external entry-points are modeled — pick a specific node above as an
          assumed-breach origin to trace routes to the crown jewels.
        </p>

        <template v-else>
          <div class="trd-reach-summary">
            <strong>{{ modeA.reachableCount }}</strong> of <strong>{{ modeA.jewelCount }}</strong>
            crown jewels reachable {{ modeA.originLabel }}
            <span v-if="modeA.unreachableCount" class="trd-muted">· {{ modeA.unreachableCount }} with no modeled flow route</span>
            <!-- A bare "0 reachable" must never read as "isolated/safe" in a screenshot. -->
            <span v-if="modeA.reachableCount === 0 && modeA.unreachableCount > 0" class="trd-muted">
              — a modeled-topology gap, not isolation; see the scope banner
            </span>
          </div>

          <ul class="trd-jewels">
            <li v-for="j in modeA.jewels" :key="j.jewelId" class="trd-jewel" :class="{ 'trd-jewel--unreach': !j.reachable }">
              <div class="trd-jewel-head">
                <span class="trd-jewel-dot" :class="j.reachable ? 'trd-jewel-dot--on' : 'trd-jewel-dot--off'" aria-hidden="true">{{ j.reachable ? '●' : '○' }}</span>
                <button type="button" class="trd-drill-mini trd-jewel-name" @click="$emit('drill', j.jewelId)" :title="`Open ${j.jewelName} profile`">{{ j.jewelName }}</button>
                <template v-if="j.reachable">
                  <span class="trd-jewel-metric">reachable<span v-if="!j.isOrigin"> · shortest route {{ j.minHops }} hop{{ j.minHops === 1 ? '' : 's' }} · {{ j.crossingCount }} crossing{{ j.crossingCount === 1 ? '' : 's' }}</span></span>
                </template>
                <span v-else class="trd-jewel-noroute">no modeled flow route <span class="trd-muted">— see scope banner</span></span>
              </div>
              <div v-if="j.reachable && !j.isOrigin" class="trd-jewel-sub">
                <span v-if="j.worstOnRoute.band" class="trd-band" :class="`trd-band--${j.worstOnRoute.band}`" title="worst live threat on ANY route to this jewel (may be a longer route than the shortest above)">
                  <span class="trd-dot" :class="`trd-dot--${j.worstOnRoute.band}`" aria-hidden="true">⬤</span> worst on any route: {{ bandLabel(j.worstOnRoute.band) }}
                </span>
                <span v-else class="trd-muted">no live threats on any route to this jewel</span>
                <span v-if="j.riskAccepted" class="trd-jewel-ra" :class="{ 'trd-jewel-ra--stale': j.staleRiskAccepted }">
                  · {{ j.riskAccepted }} RISK_ACCEPTED <span aria-hidden="true">⚠</span><span v-if="j.staleRiskAccepted"> (stale)</span>
                </span>
                <span class="trd-jewel-actions">
                  <button type="button" class="trd-linkbtn" @click="viewStrip(j)">view strip</button>
                  <button type="button" class="trd-linkbtn" @click="highlightJewel(j)">show on map</button>
                </span>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <!-- ───────────────────── Mode B ───────────────────── -->
      <div v-else-if="subMode === 'B'" class="trd-reach-main">
        <div class="trd-reach-pickers">
          <v-autocomplete
            v-model="mbOrigin" :items="componentItems" item-title="title" item-value="value"
            label="Origin" density="compact" variant="outlined" hide-details clearable
            :menu-props="{ maxHeight: 320 }"
          />
          <span class="trd-reach-arrow" aria-hidden="true">→</span>
          <v-autocomplete
            v-model="mbTarget" :items="componentItems" item-title="title" item-value="value"
            label="Target" density="compact" variant="outlined" hide-details clearable
            :menu-props="{ maxHeight: 320 }"
          />
        </div>

        <p v-if="!mbOrigin || !mbTarget" class="trd-empty">
          Choose an origin and a target — above or by clicking nodes on the map — to
          enumerate the flow routes between them.
        </p>
        <p v-else-if="modeB && modeB.routes.length === 0" class="trd-empty">
          No routes within {{ DEFAULT_MAX_HOPS }} hops connect <strong>{{ nameOf(mbOrigin) }}</strong> →
          <strong>{{ nameOf(mbTarget) }}</strong> (respecting flow direction) — longer routes are not enumerated.
          This reflects the modeled topology, not a segmentation assessment.
        </p>

        <template v-else-if="modeB">
          <!-- PERSISTENT truncation banner (not a toast; travels into export) -->
          <p v-if="modeB.capped" class="trd-flag trd-flag--warning" role="note">
            <template v-if="modeB.ceilingHit">Showing {{ modeB.displayed }} routes — enumeration capped; more exist.</template>
            <template v-else>Showing {{ modeB.displayed }} of {{ modeB.total }} routes.</template>
          </p>
          <p v-else class="trd-reach-summary"><strong>{{ modeB.displayed }}</strong> flow route{{ modeB.displayed === 1 ? '' : 's' }} found.</p>

          <ul class="trd-routes">
            <li
              v-for="(r, idx) in modeB.routes"
              :key="idx"
              class="trd-route"
              :class="{ 'trd-route--sel': idx === selectedRouteIdx }"
            >
              <div class="trd-route-head">
                <button type="button" class="trd-linkbtn" @click="selectRoute(idx)">
                  Route {{ idx + 1 }} · {{ r.hopCount }} hop{{ r.hopCount === 1 ? '' : 's' }} · {{ r.crossingCount }} crossing{{ r.crossingCount === 1 ? '' : 's' }}
                </button>
              </div>
              <!-- the linearised subway strip -->
              <div class="trd-strip">
                <template v-for="(n, ni) in r.nodes" :key="n.id">
                  <span class="trd-strip-node">
                    <span class="trd-strip-glyph" :class="{ 'trd-strip-glyph--jewel': n.crownJewel }" aria-hidden="true">{{ n.crownJewel ? '⬢' : '◉' }}</span>
                    <button type="button" class="trd-drill-mini trd-strip-name" @click="$emit('drill', n.id)" :title="`Open ${n.name} profile`">{{ n.name }}</button>
                    <span v-if="n.worstBand" class="trd-dot" :class="`trd-dot--${n.worstBand}`" :title="`worst live: ${bandLabel(n.worstBand)}`" aria-hidden="true">⬤</span>
                    <span v-for="d in n.dataHandled" :key="d.id" class="trd-sens" :class="`trd-sens--${dataSens(d.sensitivity).key}`" :title="`handles ${d.name}`">{{ dataSens(d.sensitivity).label }}</span>
                    <button type="button" class="trd-onward" @click="pivotTo(n.id)" title="trace onward from here">▸ onward</button>
                  </span>
                  <!-- hop connector (between node ni and ni+1) = the DataFlow itself,
                       NAMED + drillable into its own Component Profile. -->
                  <span v-if="ni < r.hops.length" class="trd-strip-hop">
                    <span class="trd-strip-line" aria-hidden="true">──</span>
                    <button
                      type="button"
                      class="trd-drill-mini trd-strip-flow"
                      @click="$emit('drill', r.hops[ni].flowId)"
                      :title="`Open ${r.hops[ni].flowName || 'flow'} profile`"
                    >{{ r.hops[ni].flowName || '(flow)' }}</button>
                    <span class="trd-strip-line" aria-hidden="true">──</span>
                    <span class="trd-hop-marks">
                      <span v-if="r.hops[ni].maxSensitivity" class="trd-sens" :class="`trd-sens--${String(r.hops[ni].maxSensitivity).toLowerCase()}`" :title="`carries ${r.hops[ni].sensitivityLabel}`">{{ r.hops[ni].sensitivityLabel }}</span>
                      <span v-else-if="r.hops[ni].unclassifiedInMotion" class="trd-sens trd-sens--unclassified">unclassified</span>
                      <button v-for="(c, ci) in r.hops[ni].crossings" :key="ci" type="button" class="trd-cross trd-cross-btn" :class="`trd-cross--${c.direction.toLowerCase()}`" @click="$emit('drill', c.boundaryId)" :title="`Open ${c.boundaryName} profile (${c.direction})`">{{ c.direction === 'EXIT' ? '◂' : '▸' }} {{ c.boundaryName }}</button>
                      <span v-if="r.hops[ni].worstBand" class="trd-dot" :class="`trd-dot--${r.hops[ni].worstBand}`" :title="`on-flow live: ${bandLabel(r.hops[ni].worstBand)}`" aria-hidden="true">⬤</span>
                    </span>
                  </span>
                </template>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <!-- ───────────────────── Blast radius (Mode C) ───────────────────── -->
      <div v-else class="trd-reach-main">
        <div class="trd-reach-origin">
          <!-- :key forces a remount when brOrigin changes from OUTSIDE the field
               (the "set as origin" onward-pivot) so the displayed selection stays
               in sync — Vuetify keeps its own search text otherwise. Mode A gets
               this for free via its B→A v-if remount; mode C pivots in place. -->
          <v-autocomplete
            :key="brOrigin"
            v-model="brOrigin"
            :items="componentItems"
            item-title="title"
            item-value="value"
            label="Assume breached"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            :menu-props="{ maxHeight: 320 }"
          />
          <!-- scope toggle: full forward closure vs the 1-hop ring -->
          <div class="trd-br-scope" role="group" aria-label="Blast radius scope">
            <button
              type="button" class="trd-br-scope-btn"
              :class="{ 'trd-br-scope-btn--on': brScope === 'full' }"
              :aria-pressed="brScope === 'full'"
              @click="brScope = 'full'"
            >Full radius</button>
            <button
              type="button" class="trd-br-scope-btn"
              :class="{ 'trd-br-scope-btn--on': brScope === 'direct' }"
              :aria-pressed="brScope === 'direct'"
              @click="brScope = 'direct'"
            >Direct (1-hop)</button>
          </div>
        </div>

        <!-- empty states (honest, never green) -->
        <p v-if="!brOrigin" class="trd-empty">
          Select a node to see its blast radius — the set of components reachable from it by
          modeled flows (if that node were compromised).
        </p>
        <p v-else-if="blast && blast.reachableCount === 0" class="trd-empty">
          <strong>{{ blast.originName }}</strong> reaches nothing downstream in the modeled flow graph —
          a containment result, or a modeling gap (see the scope banner). <strong>Not</strong> a proof of
          isolation: unmodeled flows or non-flow vectors are out of scope.
        </p>

        <template v-else-if="blast">
          <div class="trd-reach-summary">
            <strong>{{ blast.originName }}</strong> reaches <strong>{{ blast.reachableCount }}</strong>
            of {{ blast.componentTotal - 1 }} other component{{ blast.componentTotal - 1 === 1 ? '' : 's' }}
            <span v-if="blast.scope === 'direct'" class="trd-muted">· direct neighbours only</span>
            <span v-if="blast.jewelCountInRadius" class="trd-jewel-ra">
              · <span aria-hidden="true">⬢</span> {{ blast.jewelCountInRadius }} crown jewel{{ blast.jewelCountInRadius === 1 ? '' : 's' }} in radius
            </span>
            <span v-if="blast.worstInRadius.band" class="trd-band" :class="`trd-band--${blast.worstInRadius.band}`">
              <span class="trd-dot" :class="`trd-dot--${blast.worstInRadius.band}`" aria-hidden="true">⬤</span> worst on reachable: {{ bandLabel(blast.worstInRadius.band) }}
            </span>
          </div>

          <ul class="trd-jewels">
            <li v-for="n in blast.nodes" :key="n.id" class="trd-jewel">
              <div class="trd-jewel-head">
                <span class="trd-strip-glyph" :class="{ 'trd-strip-glyph--jewel': n.crownJewel }" aria-hidden="true">{{ n.crownJewel ? '⬢' : '◉' }}</span>
                <button type="button" class="trd-drill-mini trd-jewel-name" @click="$emit('drill', n.id)" :title="`Open ${n.name} profile`">{{ n.name }}</button>
                <span class="trd-jewel-metric">{{ n.minHops }} hop{{ n.minHops === 1 ? '' : 's' }}<span v-if="n.crossingCount"> · {{ n.crossingCount }} crossing{{ n.crossingCount === 1 ? '' : 's' }}</span></span>
                <span v-if="n.worstBand" class="trd-band" :class="`trd-band--${n.worstBand}`" :title="`worst live threat on this node`">
                  <span class="trd-dot" :class="`trd-dot--${n.worstBand}`" aria-hidden="true">⬤</span> {{ bandLabel(n.worstBand) }}
                </span>
                <span v-for="d in n.dataHandled" :key="d.id" class="trd-sens" :class="`trd-sens--${dataSens(d.sensitivity).key}`" :title="`handles ${d.name}`">{{ dataSens(d.sensitivity).label }}</span>
                <button type="button" class="trd-onward" @click="brOrigin = n.id" title="trace this node's own blast radius">▸ set as origin</button>
              </div>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { computed, ref, watch } from 'vue'
  import ModelMinimap from './ModelMinimap.vue'
  import {
    modeAReachability,
    modeBRoutes,
    blastRadius,
    externalEntryIds,
    crownJewelIds,
    bandLabel,
    DEFAULT_MAX_HOPS,
  } from '../lib/reachability.js'
  import { dataItemSensitivity } from '../lib/boundaryCrossings.js'

  // A handled Data item's sensitivity chip: null ⇒ "unclassified" gap, not "unknown".
  const dataSens = (level) => dataItemSensitivity(level)

  const props = defineProps({
    modelGraph: { type: Object, default: () => ({ boundaries: [], components: [], flows: [], dataNodes: [] }) },
    ledger: { type: Array, default: () => [] },
  })
  // drill → the Component Profile (the shell handles it); navigate reserved for future deep-links.
  defineEmits(['drill', 'navigate'])

  const EXTERNAL = '__EXTERNAL__'

  const subMode = ref('A')
  const originSel = ref(EXTERNAL)
  const mbOrigin = ref(null)
  const mbTarget = ref(null)
  const selectedRouteIdx = ref(0)
  const highlightedJewelId = ref(null)
  // Blast radius (mode C): a concrete origin node + the full/direct scope toggle.
  const brOrigin = ref(null)
  const brScope = ref('full')

  // Component pick lists (sorted by name) for the autocompletes.
  const componentItems = computed(() =>
    [...(props.modelGraph?.components ?? [])]
      .map((c) => ({ title: c.name || '(unnamed)', value: c.id, type: c.type }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title))),
  )
  const originItems = computed(() => [
    { title: 'External entry-points', value: EXTERNAL },
    ...componentItems.value,
  ])
  const nameById = computed(() => new Map(componentItems.value.map((c) => [c.value, c.title])))
  const nameOf = (id) => nameById.value.get(id) ?? '(node)'

  const entryIds = computed(() => externalEntryIds(props.modelGraph))
  const jewelIds = computed(() => crownJewelIds(props.modelGraph))

  // Mode A — recompute for the selected origin.
  const modeA = computed(() =>
    modeAReachability(
      props.modelGraph,
      props.ledger,
      originSel.value === EXTERNAL ? { kind: 'external' } : { kind: 'node', id: originSel.value },
    ),
  )

  // Mode B — enumerate + annotate when both endpoints are chosen.
  const modeB = computed(() => {
    if (!mbOrigin.value || !mbTarget.value) return null
    return modeBRoutes(props.modelGraph, props.ledger, mbOrigin.value, mbTarget.value)
  })

  // Keep the selected route index in range as the route set changes.
  watch(modeB, () => { selectedRouteIdx.value = 0 })

  // Mode C — the forward blast radius of the chosen node (full closure or 1-hop).
  const blast = computed(() =>
    brOrigin.value ? blastRadius(props.modelGraph, props.ledger, brOrigin.value, { scope: brScope.value }) : null,
  )

  // Minimap highlight: mode A = a chosen jewel's shortest route; mode B = the
  // selected route's nodes (or just the picks before a route exists).
  const mapHighlightIds = computed(() => {
    if (subMode.value === 'A') {
      if (!highlightedJewelId.value) return []
      const j = modeA.value.jewels.find((x) => x.jewelId === highlightedJewelId.value)
      return j?.shortestPath?.nodes ?? []
    }
    if (subMode.value === 'C') return blast.value?.radiusNodeIds ?? []
    const r = modeB.value?.routes?.[selectedRouteIdx.value]
    if (r) return r.nodes.map((n) => n.id)
    return [mbOrigin.value, mbTarget.value].filter(Boolean)
  })
  // The route EDGES (flow ids) to highlight, so the path is traceable — mode A = a
  // chosen jewel's shortest route; mode B = the selected route's hops.
  const mapHighlightEdgeIds = computed(() => {
    if (subMode.value === 'A') {
      if (!highlightedJewelId.value) return []
      const j = modeA.value.jewels.find((x) => x.jewelId === highlightedJewelId.value)
      return j?.shortestPath?.edges ?? []
    }
    if (subMode.value === 'C') return blast.value?.radiusEdgeIds ?? []
    const r = modeB.value?.routes?.[selectedRouteIdx.value]
    return r ? r.hops.map((h) => h.flowId) : []
  })
  const mapPendingIds = computed(() =>
    subMode.value === 'B' && mbOrigin.value && !mbTarget.value ? [mbOrigin.value] : [],
  )

  const setSubMode = (m) => {
    subMode.value = m
    highlightedJewelId.value = null
  }

  // Mode A actions.
  const highlightJewel = (j) => { highlightedJewelId.value = j.jewelId }
  const viewStrip = (j) => {
    // Show the jewel's SHORTEST route as a strip: switch to pick-two anchored on
    // the shortest path's actual origin → the jewel.
    const origin = j.shortestPath?.nodes?.[0]
    if (!origin) return
    mbOrigin.value = origin
    mbTarget.value = j.jewelId
    subMode.value = 'B'
  }

  // Onward pivot: re-anchor mode A's origin to a strip node (the node-by-node
  // "if they breached this, where to next" exploration the modeler asked for).
  const pivotTo = (nodeId) => {
    originSel.value = nodeId
    highlightedJewelId.value = null
    subMode.value = 'A'
  }

  // Minimap click-to-pick. Mode C (blast radius): a click sets the assumed-breach
  // origin directly. Mode B (pick-two): fill origin, then target, then reset.
  const onMapPick = (id) => {
    if (subMode.value === 'C') { brOrigin.value = id; return }
    if (subMode.value !== 'B') return
    if (!mbOrigin.value) mbOrigin.value = id
    else if (!mbTarget.value) mbTarget.value = id
    else { mbOrigin.value = id; mbTarget.value = null }
  }
  const resetPicks = () => { mbOrigin.value = null; mbTarget.value = null }
  const selectRoute = (idx) => { selectedRouteIdx.value = idx }
</script>

<style scoped>
  .trd-reach { font-size: 0.9rem; }

  .trd-reach-caveat {
    font-size: 0.76rem; opacity: 0.7; line-height: 1.5; margin: 0 0 0.7rem;
    border-left: 2px solid rgba(127, 127, 127, 0.35); padding-left: 0.6rem;
  }

  .trd-reach-modes {
    display: inline-flex; border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 6px; overflow: hidden; margin-bottom: 0.8rem;
  }
  .trd-reach-mode {
    background: transparent; border: none; border-right: 1px solid rgba(127, 127, 127, 0.25);
    padding: 0.35rem 0.85rem; font: inherit; font-size: 0.82rem; cursor: pointer; opacity: 0.75;
  }
  .trd-reach-mode:last-child { border-right: none; }
  .trd-reach-mode:hover { background: rgba(127, 127, 127, 0.08); opacity: 1; }
  .trd-reach-mode--active { background: rgba(0, 184, 212, 0.12); opacity: 1; font-weight: 600; box-shadow: inset 0 -2px 0 0 #00b8d4; }

  .trd-reach-body { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .trd-reach-map { flex: 0 0 340px; max-width: 420px; min-width: 260px; }
  /* The sidebar variant sizes its own svg (≈180px) — no forced container height
     (that was only needed by the full-height 'expanded' variant). The ⤢ button
     opens the big modal where the real navigation/picking happens. */
  .trd-reach-maphint { font-size: 0.72rem; opacity: 0.65; margin: 0.3rem 0 0; }

  /* Route legend — a compact key for the strip glyphs, below the minimap. */
  .trd-reach-legend {
    margin: 0.6rem 0 0; padding-top: 0.5rem;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
    display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.7rem;
  }
  .trd-leg-title {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em;
    opacity: 0.5; font-weight: 600;
  }
  .trd-leg-item { opacity: 0.85; display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; line-height: 1.4; }
  .trd-leg-flow { font-style: italic; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
  .trd-leg-dots { display: inline-flex; gap: 1px; }
  .trd-reach-main { flex: 1 1 420px; min-width: 320px; }

  .trd-key-jewel { color: #c62828; font-weight: 600; }
  .trd-key-entry { color: #b9651b; font-weight: 600; }

  .trd-reach-origin, .trd-reach-pickers { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
  .trd-reach-origin { max-width: 480px; }
  .trd-reach-origin :deep(.v-input), .trd-reach-pickers :deep(.v-input) { flex: 1 1 220px; }
  .trd-reach-originlabel { font-size: 0.74rem; opacity: 0.6; white-space: nowrap; }
  .trd-reach-arrow { opacity: 0.5; }

  /* Blast-radius scope toggle (full forward closure vs the 1-hop ring). */
  .trd-br-scope { display: inline-flex; flex: 0 0 auto; border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 4px; overflow: hidden; }
  .trd-br-scope-btn { background: none; border: none; border-right: 1px solid rgba(127, 127, 127, 0.3); font: inherit; font-size: 0.76rem; padding: 0.3rem 0.6rem; color: inherit; opacity: 0.7; cursor: pointer; }
  .trd-br-scope-btn:last-child { border-right: none; }
  .trd-br-scope-btn:hover { background: rgba(127, 127, 127, 0.08); opacity: 1; }
  .trd-br-scope-btn--on { background: rgba(0, 184, 212, 0.12); opacity: 1; font-weight: 600; box-shadow: inset 0 -2px 0 0 #00b8d4; }
  .trd-br-scope-btn:focus-visible { outline: 2px solid #00b8d4; outline-offset: -2px; }

  .trd-reach-summary {
    display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: center;
    padding: 0.5rem 0.7rem; background: rgba(127, 127, 127, 0.08);
    border-radius: 4px; margin-bottom: 0.6rem; font-size: 0.84rem;
  }
  .trd-muted { opacity: 0.65; }
  .trd-empty { opacity: 0.75; line-height: 1.5; }

  .trd-flag { font-size: 0.8rem; margin: 0 0 0.6rem; padding: 0.3rem 0.6rem; border-radius: 4px; }
  .trd-flag--warning { color: #8a5a00; background: rgba(199, 119, 0, 0.1); }

  .trd-linkbtn {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    text-decoration: underline; cursor: pointer; opacity: 0.8;
  }
  .trd-linkbtn:hover { opacity: 1; }
  .trd-drill-mini {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
  }
  .trd-drill-mini:hover { text-decoration-style: solid; }
  .trd-drill-mini:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }

  /* Mode A jewel list */
  .trd-jewels { list-style: none; margin: 0; padding: 0; }
  .trd-jewel { border: 1px solid rgba(127, 127, 127, 0.22); border-radius: 5px; padding: 0.5rem 0.7rem; margin-bottom: 0.5rem; }
  .trd-jewel--unreach { opacity: 0.7; }
  .trd-jewel-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .trd-jewel-dot--on { color: #2e7d32; }
  .trd-jewel-dot--off { color: #9e9e9e; }
  .trd-jewel-name { font-weight: 600; }
  .trd-jewel-metric { font-size: 0.78rem; opacity: 0.8; }
  .trd-jewel-noroute { font-size: 0.8rem; color: #8a5a00; }
  .trd-jewel-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.35rem; font-size: 0.8rem; }
  .trd-jewel-ra { color: #8a5a00; }
  .trd-jewel-ra--stale { color: #c0392b; font-weight: 600; }
  .trd-jewel-actions { margin-left: auto; display: inline-flex; gap: 0.7rem; }

  /* severity dots — muted band tones, never a stoplight verdict */
  .trd-dot { font-size: 0.6rem; vertical-align: middle; }
  .trd-dot--critical { color: #c0392b; }
  .trd-dot--high { color: #d35400; }
  .trd-dot--medium { color: #8a7400; }
  .trd-dot--low { color: #5f6a6a; }
  .trd-dot--unknown { color: #95a5a6; }
  .trd-band { font-size: 0.78rem; }

  /* Mode B routes + subway strip */
  .trd-routes { list-style: none; margin: 0; padding: 0; }
  .trd-route { border: 1px solid rgba(127, 127, 127, 0.22); border-radius: 5px; padding: 0.5rem 0.7rem; margin-bottom: 0.55rem; }
  .trd-route--sel { border-color: #00b8d4; box-shadow: 0 0 0 1px #00b8d4 inset; }
  .trd-route-head { font-size: 0.82rem; margin-bottom: 0.4rem; }
  .trd-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 0.2rem 0.35rem; }
  .trd-strip-node { display: inline-flex; align-items: center; gap: 0.3rem; }
  .trd-strip-glyph { color: #607d8b; }
  .trd-strip-glyph--jewel { color: #c62828; }
  .trd-strip-name { font-size: 0.82rem; font-weight: 500; }
  .trd-onward { background: none; border: none; padding: 0; font: inherit; font-size: 0.68rem; color: inherit; opacity: 0.55; cursor: pointer; }
  .trd-onward:hover { opacity: 1; text-decoration: underline; }
  .trd-strip-hop { display: inline-flex; align-items: center; gap: 0.25rem; }
  .trd-strip-line { opacity: 0.4; }
  /* The flow's name on the connector — the DataFlow made visible + drillable.
     Smaller + italic so it reads as the EDGE label, distinct from the node names. */
  .trd-strip-flow { font-size: 0.72rem; font-style: italic; opacity: 0.85; }
  .trd-strip-flow:hover { opacity: 1; }
  .trd-hop-marks { display: inline-flex; align-items: center; gap: 0.25rem; }
  .trd-cross { font-size: 0.66rem; white-space: nowrap; }
  .trd-cross--exit { color: #b9651b; }
  .trd-cross--enter { color: #2c6fbb; }
  /* The crossed boundary is drillable into its own Component Profile. Button reset only
     (font-family/size, not the `font` shorthand) so the direction colour + 0.66rem
     size survive; colour comes from the direction class above. */
  .trd-cross-btn { background: none; border: none; padding: 0; font-family: inherit; cursor: pointer; }
  .trd-cross-btn:hover { text-decoration: underline; }
  .trd-cross-btn:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }

  /* sensitivity chip — outlined, low-saturation; a sort-aid, not a stoplight */
  .trd-sens { display: inline-block; border: 1px solid currentColor; border-radius: 10px; padding: 0 6px; font-size: 0.66rem; background: transparent; text-transform: capitalize; }
  .trd-sens--restricted { color: #c0392b; }
  .trd-sens--confidential { color: #b9651b; }
  .trd-sens--internal { color: #8a7400; }
  .trd-sens--public { color: #5f6a6a; }
  .trd-sens--unclassified { color: #c77700; }
  .trd-sens--nodata, .trd-sens--null { color: #95a5a6; }
</style>
