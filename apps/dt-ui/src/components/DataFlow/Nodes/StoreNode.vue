<script setup lang="ts">
  import { Handle, Position } from '@vue-flow/core'

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
</script>

<template>
  <div>{{ props.data.label }}
    <Handle id="right" :position="Position.Right" />
    <Handle id="left" :position="Position.Left" />
  </div>
</template>
