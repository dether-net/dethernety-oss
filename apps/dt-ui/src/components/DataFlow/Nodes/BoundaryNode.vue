<script setup lang="ts">
  import { computed, toRefs } from 'vue'
  import { NodeResizer } from '@vue-flow/node-resizer'
  import '@vue-flow/node-resizer/dist/style.css'
  import { useFlowStore } from '@/stores/flowStore'
  import UnclassifiedPill from '@/components/DataFlow/ClassPicker/UnclassifiedPill.vue'
  import { zonePill, ZONE_LABEL } from '@/utils/zoneColor'

  const props = defineProps({
    id: {
      type: String,
      required: true,
    },
    data: {
      type: Object,
      required: true,
    },
  })

  interface ResizeDragEvent {
    params: {
      width: number
      height: number
      x: number
      y: number
    }
  }

  const flowStore = useFlowStore()
  const { data } = toRefs(props)
  const emit = defineEmits(['resize:start'])

  const minWidth = computed(() => data.value.minWidth || 100)
  const minHeight = computed(() => data.value.minHeight || 100)
  const unclassified = computed(
    () => !data.value.classId && !data.value.representedModelId,
  )

  // Zone diagram encoding (display only): effective zone → stripe + corner word pill.
  // `zonePill` returns null for the default fallback, so untouched boundaries stay clean.
  const effectiveZone = computed(() => flowStore.effectiveZone(props.id))
  const pill = computed(() => zonePill(effectiveZone.value))
  const pillTooltip = computed(() => {
    const ez = effectiveZone.value
    if (!pill.value) return ''
    const label = ZONE_LABEL[ez.zone]
    if (ez.source === 'inherited') {
      const fromName = (flowStore.boundaryById(ez.from || '') as any)?.data?.label || 'a parent boundary'
      return `${label} (inherited from ${fromName})`
    }
    return `${label} (declared)`
  })

  const onResizeEnd = (event: ResizeDragEvent) => {
    flowStore.updateNode({
      nodeId: props.id,
      updates: {
        width: event.params.width,
        height: event.params.height,
        position: {
          x: event.params.x,
          y: event.params.y,
        },
      },
    })
  }

  const onResizeStart = () => {
    emit('resize:start', props.id)
  }

</script>

<template>
  <div>
    <div
      v-if="pill"
      class="zone-stripe"
      :class="['bg-' + pill.color, { 'zone-inherited': pill.inherited }]"
    />
    <span class="top-right-text">
      {{ props.data.label || 'Boundary Node' }}
    </span>
    <NodeResizer
      :is-visible="flowStore.editMode"
      :line-style="{ border: '0px' }"
      :min-height="minHeight || 100"
      :min-width="minWidth || 100"
      @resize-end="onResizeEnd"
      @resize-start="onResizeStart"
    />
    <UnclassifiedPill :visible="unclassified" />
    <v-tooltip v-if="pill" location="top" :text="pillTooltip">
      <template #activator="{ props: tProps }">
        <v-chip
          v-bind="tProps"
          class="zone-pill"
          :class="{ 'zone-inherited': pill.inherited }"
          :color="pill.color"
          :aria-label="pillTooltip"
          size="x-small"
          label
          variant="flat"
        >
          {{ pill.word }}
        </v-chip>
      </template>
    </v-tooltip>
  </div>
</template>

<style scoped>
  .top-right-text {
    text-transform: uppercase;
    position: absolute;
    right: 0;
    top: 0;
  }
  /* Zone accent stripe on the boundary's left edge (declared = solid, inherited = dimmed). */
  .zone-stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    z-index: 0;
    pointer-events: none;
  }
  /* Corner zone word-pill — bottom-left, away from the top-right label and bottom-right UnclassifiedPill. */
  .zone-pill {
    position: absolute;
    bottom: 4px;
    left: 4px;
    z-index: 1;
    cursor: default;
  }
  /* Inherited: dimmed + italic (matches the "(inherited)" italic treatment; reinforces the
     declared-vs-inherited cue beyond opacity alone). Harmless on the text-less stripe. */
  .zone-inherited {
    opacity: 0.4;
    font-style: italic;
  }
</style>
