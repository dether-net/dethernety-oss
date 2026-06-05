<!--
  ModelMinimap.vue — a faithful, read-only SVG minimap of a threat model.

  Adapted from the platform's model-minimap pattern: a self-contained, generic
  model-rendering SFC. It uses the model's REAL canvas coordinates (parent-
  relative positionX/Y walked through the boundary nesting chain), so it is a
  small faithful copy of the hand-laid diagram — not an auto-layout.

  In the threat report it is the visual home for both Boundary Crossings and
  Reachability: crossings/routes are highlighted purely via the `highlightIds`
  prop — no new render logic. It is presentational by default (selection driven
  by the parent setting `highlightIds`), and OPTIONALLY interactive: when
  `selectable` is set it emits `pick(componentId)` on a node click and renders a
  `pendingIds` node with a dashed stroke (the "pick two" first-click state).
  Default off, so the Boundary Crossings usage is unchanged.

  Expects `modelGraph` = {
    boundaries: [{ id, name, positionX, positionY, width, height, parentBoundaryId }],
    components: [{ id, name, type, positionX, positionY, width, height, boundaryId }],
    flows:      [{ id, name, sourceId, targetId }],
  }
  (the snapshot doc's `modelGraph`, gathered backend-side at generate time).
-->
<script setup>
  const { useHostContext } = window.__HOST_DEPENDENCIES__
  const { vue } = useHostContext()
  const { computed, ref } = vue

  defineOptions({ name: 'ModelMinimap' })

  const props = defineProps({
    modelGraph: { type: Object, default: null },
    highlightIds: { type: Array, default: () => [] },
    // Flow ids of the edges ON the highlighted route, so the PATH (not just its
    // nodes) is traceable on the map. Precise (a flow-id list), so a chord between
    // two highlighted nodes that isn't on the route stays un-highlighted.
    highlightEdgeIds: { type: Array, default: () => [] },
    crownJewelIds: { type: Array, default: () => [] },
    entryPointIds: { type: Array, default: () => [] },
    // The "pick two" first-pick state — a dashed-stroke pending node.
    pendingIds: { type: Array, default: () => [] },
    // When true, node clicks emit `pick(componentId)` (click-to-select). Off
    // by default → the presentational usage is unchanged.
    selectable: { type: Boolean, default: false },
    completenessScore: { type: Number, default: null },
    // 'sidebar' (default, in-panel; dots-only, hover tooltips, expand button)
    // 'expanded' (modal; DFD shapes, always-on labels, no expand button)
    variant: { type: String, default: 'sidebar' },
  })

  const emit = defineEmits(['pick'])

  const isPending = (component) => props.pendingIds.includes(component.id)
  const onNodeClick = (component) => {
    if (props.selectable) emit('pick', component.id)
  }

  // A route edge: highlighted (cyan) when its flow id is in highlightEdgeIds.
  const isEdgeHighlighted = (edge) => props.highlightEdgeIds.includes(edge.id)
  // Paint highlighted edges LAST so the route line is never hidden under a grey
  // edge crossing it.
  const orderedEdges = computed(() => {
    const norm = []
    const hi = []
    for (const e of layout.value.edges) (isEdgeHighlighted(e) ? hi : norm).push(e)
    return [...norm, ...hi]
  })

  const SVG_PADDING = 20

  // Both variants scale shape sizes WITH the viewBox extent so dots/labels
  // remain visually consistent regardless of how big the model is in canvas
  // coords. Sidebar uses a smaller multiplier (we want a glanceable map, not
  // a detailed one); expanded uses a larger multiplier for readability.
  const variantSizing = (variant, viewBoxW, viewBoxH) => {
    const scale = Math.max(viewBoxW, viewBoxH)
    if (variant === 'expanded') {
      const unit = Math.max(scale * 0.02, 14)
      return {
        nodeRadius: unit,
        rectW: unit * 2.2, rectH: unit * 1.5,
        storeW: unit * 2.6, storeH: unit * 1.5,
        labelOffset: unit * 1.1,
        labelFont: unit * 0.85,
        boundaryLabelFont: unit * 1.0,
        showComponentLabels: true,
        showBoundaryLabels: true,
        edgeShorten: unit * 1.4,
        svgHeight: '100%',
      }
    }
    // Sidebar: dots-only, boundary labels on (with background pill);
    // component labels off (those were the original collision driver).
    const unit = Math.max(scale * 0.018, 10)
    return {
      nodeRadius: unit,
      rectW: unit * 1.8, rectH: unit * 1.2,    // unused — sidebar still draws dots
      storeW: unit * 2.0, storeH: unit * 1.2,
      labelOffset: unit * 1.0,
      labelFont: unit * 0.7,
      boundaryLabelFont: unit * 0.75,
      showComponentLabels: false,              // hover tooltip instead
      showBoundaryLabels: true,                // pill backdrop keeps them legible
      edgeShorten: unit * 1.2,
      svgHeight: '180px',
    }
  }

  const BOUNDARY_PAD = 20
  const DEFAULT_BOUNDARY_W = 160
  const DEFAULT_BOUNDARY_H = 100
  const DEFAULT_COMPONENT_W = 40
  const DEFAULT_COMPONENT_H = 30

  const typeColors = {
    process: '#42A5F5',
    store: '#66BB6A',
    external_entity: '#FF7043',
    default: '#9E9E9E',
  }

  // ─── Layout: parent-relative → absolute ─────────────────────────────────
  // Components and nested boundaries store positionX/Y relative to their
  // parent boundary (matches the canvas's parentNode semantics). This walks
  // each parent chain for absolute coords + computes a default size for
  // boundaries that have no stored dimensions.

  const layout = computed(() => {
    const empty = { boundaries: [], components: [], edges: [], viewBox: '0 0 300 200' }
    if (!props.modelGraph?.components?.length && !props.modelGraph?.boundaries?.length) return empty

    const rawBoundaries = props.modelGraph.boundaries || []
    const rawComponents = props.modelGraph.components || []

    const boundaryById = new Map()
    for (const b of rawBoundaries) boundaryById.set(b.id, b)

    const offsetCache = new Map()
    const absOffset = (id) => {
      if (id == null) return { x: 0, y: 0 }
      if (offsetCache.has(id)) return offsetCache.get(id)
      const b = boundaryById.get(id)
      if (!b) {
        const o = { x: 0, y: 0 }
        offsetCache.set(id, o)
        return o
      }
      const parent = absOffset(b.parentBoundaryId)
      const o = { x: parent.x + (b.positionX || 0), y: parent.y + (b.positionY || 0) }
      offsetCache.set(id, o)
      return o
    }

    const childBoundariesByParent = new Map()
    const childComponentsByParent = new Map()
    for (const b of rawBoundaries) {
      if (!b.parentBoundaryId) continue
      const arr = childBoundariesByParent.get(b.parentBoundaryId) || []
      arr.push(b); childBoundariesByParent.set(b.parentBoundaryId, arr)
    }
    for (const c of rawComponents) {
      if (!c.boundaryId) continue
      const arr = childComponentsByParent.get(c.boundaryId) || []
      arr.push(c); childComponentsByParent.set(c.boundaryId, arr)
    }

    const sizeCache = new Map()
    const visiting = new Set()
    const sizeOf = (b) => {
      if (sizeCache.has(b.id)) return sizeCache.get(b.id)
      if (b.width != null && b.height != null) {
        const s = { w: b.width, h: b.height }
        sizeCache.set(b.id, s); return s
      }
      if (visiting.has(b.id)) {
        return { w: DEFAULT_BOUNDARY_W, h: DEFAULT_BOUNDARY_H }
      }
      visiting.add(b.id)
      const childBs = childBoundariesByParent.get(b.id) || []
      const childCs = childComponentsByParent.get(b.id) || []
      let maxX = 0, maxY = 0
      for (const cb of childBs) {
        const cs = sizeOf(cb)
        const x = (cb.positionX || 0) + (cb.width != null ? cb.width : cs.w)
        const y = (cb.positionY || 0) + (cb.height != null ? cb.height : cs.h)
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      for (const cc of childCs) {
        const x = (cc.positionX || 0) + (cc.width || DEFAULT_COMPONENT_W)
        const y = (cc.positionY || 0) + (cc.height || DEFAULT_COMPONENT_H)
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      visiting.delete(b.id)
      const s = (childBs.length || childCs.length)
        ? { w: maxX + BOUNDARY_PAD, h: maxY + BOUNDARY_PAD }
        : { w: DEFAULT_BOUNDARY_W, h: DEFAULT_BOUNDARY_H }
      sizeCache.set(b.id, s)
      return s
    }

    const depthOf = (b, seen = new Set()) => {
      if (!b.parentBoundaryId) return 0
      if (seen.has(b.id)) return 0
      seen.add(b.id)
      const p = boundaryById.get(b.parentBoundaryId)
      return p ? depthOf(p, seen) + 1 : 0
    }

    const boundaries = rawBoundaries.map(b => {
      const parentAbs = absOffset(b.parentBoundaryId)
      const size = sizeOf(b)
      return {
        id: b.id,
        name: b.name,
        x: parentAbs.x + (b.positionX || 0),
        y: parentAbs.y + (b.positionY || 0),
        w: size.w,
        h: size.h,
        depth: depthOf(b),
      }
    }).sort((a, b) => a.depth - b.depth)

    const components = rawComponents.map(c => {
      const parentAbs = absOffset(c.boundaryId)
      return {
        ...c,
        x: parentAbs.x + (c.positionX || 0),
        y: parentAbs.y + (c.positionY || 0),
      }
    })

    const componentById = new Map(components.map(c => [c.id, c]))

    // Pre-bounding-box from boundary rects + component centers. Used to
    // derive expanded-variant shape sizing (which scales with the model's
    // extent so shapes remain readable regardless of model size).
    let preMinX = Infinity, preMinY = Infinity, preMaxX = -Infinity, preMaxY = -Infinity
    for (const b of boundaries) {
      if (b.x < preMinX) preMinX = b.x
      if (b.y < preMinY) preMinY = b.y
      if (b.x + b.w > preMaxX) preMaxX = b.x + b.w
      if (b.y + b.h > preMaxY) preMaxY = b.y + b.h
    }
    for (const c of components) {
      if (c.x < preMinX) preMinX = c.x
      if (c.y < preMinY) preMinY = c.y
      if (c.x > preMaxX) preMaxX = c.x
      if (c.y > preMaxY) preMaxY = c.y
    }
    if (!isFinite(preMinX)) return empty

    const sizing = variantSizing(props.variant, preMaxX - preMinX, preMaxY - preMinY)

    // Trim each edge on the target side so the arrowhead lands outside the
    // target shape rather than buried under it. Same trick on the source side
    // for visual symmetry in the expanded variant where shapes are larger.
    const shorten = sizing.edgeShorten
    const edges = (props.modelGraph.flows || [])
      .map(f => {
        const src = componentById.get(f.sourceId)
        const dst = componentById.get(f.targetId)
        if (!src || !dst) return null
        const dx = dst.x - src.x
        const dy = dst.y - src.y
        const len = Math.hypot(dx, dy) || 1
        const nx = dx / len
        const ny = dy / len
        return {
          id: f.id,
          name: f.name,
          x1: src.x + nx * (shorten * 0.5),
          y1: src.y + ny * (shorten * 0.5),
          x2: dst.x - nx * shorten,
          y2: dst.y - ny * shorten,
        }
      })
      .filter(Boolean)

    // Final viewBox: pad to ensure shapes + labels aren't clipped at the edge.
    const compHalf = Math.max(sizing.nodeRadius, sizing.rectW / 2, sizing.storeW / 2)
    const compLabelExtra = sizing.showComponentLabels ? sizing.labelOffset + sizing.labelFont : 0
    const minX = preMinX - SVG_PADDING - compHalf
    const minY = preMinY - SVG_PADDING - compHalf
    const maxX = preMaxX + SVG_PADDING + compHalf
    const maxY = preMaxY + SVG_PADDING + compHalf + compLabelExtra
    const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`

    return { boundaries, components, edges, viewBox, sizing }
  })

  // Surface sizing through a thin computed so the template can read it.
  const sizing = computed(() => layout.value.sizing || variantSizing(props.variant, 300, 200))

  // Highlight (explicit user selection) wins over crown-jewel / entry-point
  // categorisation — otherwise clicking a target on a crown-jewel
  // component (the common case) shows no visual change at all.
  const isHighlighted = (component) => props.highlightIds.includes(component.id)

  const getColor = (component) => {
    if (isHighlighted(component)) return '#00E5FF'                                     // cyan — selection
    if (props.crownJewelIds.includes(component.id)) return '#F44336'                   // red — crown jewel
    if (props.entryPointIds.includes(component.id)) return '#FFC107'                   // yellow — entry point
    return typeColors[component.type] || typeColors.default
  }

  const getStroke = (component) => {
    if (isPending(component)) return '#7C4DFF'                                         // violet — pending pick (distinct from cyan highlight / amber entry / red jewel)
    if (isHighlighted(component)) return '#00B8D4'                                     // darker cyan
    if (props.crownJewelIds.includes(component.id)) return '#C62828'
    if (props.entryPointIds.includes(component.id)) return '#F57F17'
    return 'none'
  }

  // Pending (first-pick) nodes render a DASHED stroke so the "selected one, pick
  // the second" state is unmistakable vs a committed highlight.
  const getDash = (component) => (isPending(component) ? '4,3' : null)

  // Highlighted / pending nodes get an extra-thick stroke so the selection pops
  // even on small sidebar dots that share a colour with categorisation states.
  const strokeWidth = (component) => {
    if (isHighlighted(component)) return 4
    if (isPending(component)) return 3
    return getStroke(component) !== 'none' ? 2 : 0
  }

  // Highlighted shapes render 1.4× their base size so the selection is also
  // detectable by silhouette, not only by colour.
  const HIGHLIGHT_SCALE = 1.4
  const nodeScale = (component) => (isHighlighted(component) ? HIGHLIGHT_SCALE : 1)
  const nodeR = (component) => sizing.value.nodeRadius * nodeScale(component)
  const rectW = (component) => sizing.value.rectW * nodeScale(component)
  const rectH = (component) => sizing.value.rectH * nodeScale(component)
  const storeW = (component) => sizing.value.storeW * nodeScale(component)
  const storeH = (component) => sizing.value.storeH * nodeScale(component)

  // For DFD-store (two parallel lines): the lines need a visible stroke even
  // when the component isn't highlighted, otherwise the shape disappears.
  // Highlight stroke wins when set.
  const storeStroke = (component) => {
    const s = getStroke(component)
    return s === 'none' ? '#424242' : s
  }
  const storeStrokeWidth = (component) => (getStroke(component) !== 'none' ? 2 : 1)

  const completenessPercent = computed(() =>
    props.completenessScore != null ? Math.round(props.completenessScore * 100) : null
  )

  const truncate = (name, max) => {
    if (!name) return ''
    return name.length > max ? name.slice(0, max) + '...' : name
  }
  const componentLabel = (c) => truncate(c.name, props.variant === 'expanded' ? 20 : 12)
  const boundaryLabel = (b) => truncate(b.name, props.variant === 'expanded' ? 28 : 18)

  const expanded = ref(false)
  const openExpanded = () => { expanded.value = true }
</script>

<template>
  <div class="minimap-container" :class="`variant-${variant}`">
    <div v-if="completenessPercent != null" class="completeness-badge">
      <v-chip
        size="x-small"
        :color="completenessPercent >= 60 ? 'success' : completenessPercent >= 40 ? 'warning' : 'error'"
        variant="tonal"
      >
        {{ completenessPercent }}%
      </v-chip>
    </div>

    <v-btn
      v-if="variant === 'sidebar'"
      class="expand-btn"
      color="tertiary"
      icon="mdi-arrow-expand"
      size="x-small"
      variant="text"
      density="compact"
      title="Expand"
      @click="openExpanded"
    />

    <div v-if="!modelGraph || (!modelGraph.components?.length && !modelGraph.boundaries?.length)" class="text-center text-grey pa-3 text-caption">
      No model data
    </div>
    <svg v-else :viewBox="layout.viewBox" class="minimap-svg" :style="{ height: sizing.svgHeight }" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
          <polygon points="0 0, 6 2, 0 4" fill="#9E9E9E" />
        </marker>
        <marker id="arrowhead-hl" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
          <polygon points="0 0, 6 2, 0 4" fill="#00B8D4" />
        </marker>
      </defs>

      <!-- Boundaries (outer painted first; nested painted on top).
           Labels are rendered in a separate top-most <g> below so they
           aren't occluded by component shapes that share the same coords. -->
      <g>
        <rect
          v-for="b in layout.boundaries"
          :key="'b-' + b.id"
          :x="b.x"
          :y="b.y"
          :width="b.w"
          :height="b.h"
          rx="4"
          fill="rgba(0,0,0,0.015)"
          stroke="#BDBDBD"
          stroke-width="1"
          stroke-dasharray="4,2"
        >
          <title>{{ b.name }}</title>
        </rect>
      </g>

      <!-- Edges (route edges painted cyan + thicker, and last so they sit on top) -->
      <line
        v-for="e in orderedEdges"
        :key="'e-' + e.id"
        :x1="e.x1"
        :y1="e.y1"
        :x2="e.x2"
        :y2="e.y2"
        :stroke="isEdgeHighlighted(e) ? '#00B8D4' : '#9E9E9E'"
        :stroke-width="isEdgeHighlighted(e) ? 2.5 : 1"
        :marker-end="isEdgeHighlighted(e) ? 'url(#arrowhead-hl)' : 'url(#arrowhead)'"
      >
        <title v-if="e.name">{{ e.name }}</title>
      </line>

      <!-- Component nodes (DFD shapes in expanded; dots in sidebar).
           Sizes are scaled 1.4× when highlighted via nodeR/rectW/rectH/storeW/storeH.
           When `selectable`, the group is clickable (the pick-two interaction). -->
      <g
        v-for="c in layout.components"
        :key="'c-' + c.id"
        :class="{ 'node-selectable': selectable }"
        @click="onNodeClick(c)"
      >
        <!-- Process: circle (always — sidebar dot is also a circle, just smaller) -->
        <circle
          v-if="c.type === 'process' || variant === 'sidebar'"
          :cx="c.x"
          :cy="c.y"
          :r="nodeR(c)"
          :fill="getColor(c)"
          :stroke="getStroke(c)"
          :stroke-width="strokeWidth(c)"
          :stroke-dasharray="getDash(c)"
        >
          <title>{{ c.name }}</title>
        </circle>

        <!-- External entity: rect -->
        <rect
          v-else-if="c.type === 'external_entity'"
          :x="c.x - rectW(c) / 2"
          :y="c.y - rectH(c) / 2"
          :width="rectW(c)"
          :height="rectH(c)"
          :fill="getColor(c)"
          :stroke="getStroke(c)"
          :stroke-width="strokeWidth(c)"
          :stroke-dasharray="getDash(c)"
        >
          <title>{{ c.name }}</title>
        </rect>

        <!-- Store (Yourdon DFD convention): two horizontal lines, no sides.
             Background fill is a thin rect to keep the shape clickable/hoverable. -->
        <g v-else-if="c.type === 'store'">
          <rect
            :x="c.x - storeW(c) / 2"
            :y="c.y - storeH(c) / 2"
            :width="storeW(c)"
            :height="storeH(c)"
            :fill="getColor(c)"
            opacity="0.18"
          >
            <title>{{ c.name }}</title>
          </rect>
          <line
            :x1="c.x - storeW(c) / 2"
            :y1="c.y - storeH(c) / 2"
            :x2="c.x + storeW(c) / 2"
            :y2="c.y - storeH(c) / 2"
            :stroke="storeStroke(c)"
            :stroke-width="storeStrokeWidth(c)"
          />
          <line
            :x1="c.x - storeW(c) / 2"
            :y1="c.y + storeH(c) / 2"
            :x2="c.x + storeW(c) / 2"
            :y2="c.y + storeH(c) / 2"
            :stroke="storeStroke(c)"
            :stroke-width="storeStrokeWidth(c)"
          />
        </g>

        <!-- Default: circle -->
        <circle
          v-else
          :cx="c.x"
          :cy="c.y"
          :r="nodeR(c)"
          :fill="getColor(c)"
          :stroke="getStroke(c)"
          :stroke-width="strokeWidth(c)"
          :stroke-dasharray="getDash(c)"
        >
          <title>{{ c.name }}</title>
        </circle>

        <text
          v-if="sizing.showComponentLabels"
          :x="c.x"
          :y="c.y + sizing.labelOffset + sizing.nodeRadius"
          text-anchor="middle"
          :font-size="sizing.labelFont"
          class="component-label"
        >
          {{ componentLabel(c) }}
        </text>
      </g>

      <!-- Boundary labels (top-most, with background pill so they read
           cleanly even when sitting over a component or edge). -->
      <g v-if="sizing.showBoundaryLabels">
        <g v-for="b in layout.boundaries" :key="'bl-' + b.id">
          <rect
            :x="b.x + 4"
            :y="b.y + 2"
            :width="boundaryLabel(b).length * sizing.boundaryLabelFont * 0.55 + 8"
            :height="sizing.boundaryLabelFont * 1.3"
            rx="2"
            class="boundary-label-bg"
          />
          <text
            :x="b.x + 8"
            :y="b.y + sizing.boundaryLabelFont + 4"
            :font-size="sizing.boundaryLabelFont"
            class="boundary-label"
          >
            {{ boundaryLabel(b) }}
          </text>
        </g>
      </g>
    </svg>

    <!-- Expand-to-modal (sidebar variant only) -->
    <v-dialog v-if="variant === 'sidebar'" v-model="expanded" width="80vw">
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>Model overview</span>
          <v-spacer />
          <v-btn icon="mdi-close" size="small" variant="text" @click="expanded = false" />
        </v-card-title>
        <v-card-text class="pa-0">
          <div class="expanded-mount">
            <ModelMinimap
              :model-graph="modelGraph"
              :highlight-ids="highlightIds"
              :highlight-edge-ids="highlightEdgeIds"
              :crown-jewel-ids="crownJewelIds"
              :entry-point-ids="entryPointIds"
              :pending-ids="pendingIds"
              :selectable="selectable"
              :completeness-score="completenessScore"
              variant="expanded"
              @pick="emit('pick', $event)"
            />
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.minimap-container {
  position: relative;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.02);
}

.variant-expanded {
  border: none;
  border-radius: 0;
  background: transparent;
}

.completeness-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
}

.expand-btn {
  position: absolute !important;
  top: 2px;
  left: 2px;
  z-index: 1;
  opacity: 0.6;
}
.expand-btn:hover {
  opacity: 1;
}

.minimap-svg {
  width: 100%;
  display: block;
}

/* When the map is in pick-two mode, nodes invite a click. */
.node-selectable {
  cursor: pointer;
}

/* Theme-aware label rendering — boundary labels paint after components,
   with a translucent surface-coloured pill behind them so the text reads
   cleanly even when the label sits over a component or edge. */
.boundary-label-bg {
  fill: rgb(var(--v-theme-surface));
  fill-opacity: 0.85;
}
.boundary-label {
  fill: rgb(var(--v-theme-on-surface));
  fill-opacity: 0.85;
  font-weight: 500;
  /* Tiny outline keeps the text legible if the pill ever falls short. */
  paint-order: stroke;
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 2px;
  stroke-linejoin: round;
}
.component-label {
  fill: rgb(var(--v-theme-on-surface));
  fill-opacity: 0.75;
  paint-order: stroke;
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 2px;
  stroke-linejoin: round;
}

.expanded-mount {
  height: 75vh;
  width: 100%;
}
.expanded-mount > .minimap-container {
  height: 100%;
}
.expanded-mount .minimap-svg {
  height: 100% !important;
}
</style>
