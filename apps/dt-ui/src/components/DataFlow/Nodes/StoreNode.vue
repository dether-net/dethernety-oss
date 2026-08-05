<script setup lang="ts">
  import { computed } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import UnclassifiedPill from '@/components/DataFlow/ClassPicker/UnclassifiedPill.vue'

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

  const unclassified = computed(
    () => !props.data.classId && !props.data.representedModelId,
  )
</script>

<template>
  <div><span class="node-label">{{ props.data.label }}</span>
    <Handle id="right" :position="Position.Right" />
    <Handle id="left" :position="Position.Left" />
    <UnclassifiedPill :visible="unclassified" />
  </div>
</template>
