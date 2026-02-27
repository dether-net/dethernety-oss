<script setup lang="ts">
  import { computed, toRefs } from 'vue'
  import { NodeResizer } from '@vue-flow/node-resizer'
  import '@vue-flow/node-resizer/dist/style.css'
  import { useFlowStore } from '@/stores/flowStore'

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
    <span class="top-right-text">
      {{ props.data.label || 'Boundary Node' }}
    </span>
    <NodeResizer
      :is-visible="true"
      :line-style="{ border: '0px' }"
      :min-height="minHeight || 100"
      :min-width="minWidth || 100"
      @resize-end="onResizeEnd"
      @resize-start="onResizeStart"
    />
  </div>
</template>

<style scoped>
  .top-right-text {
    text-transform: uppercase;
    position: absolute;
    right: 0;
    top: 0;
    cursor: nwse-resize;
  }
</style>
