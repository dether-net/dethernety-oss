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
    <Handle id="top" :position="Position.Top" />
    <Handle id="right" :position="Position.Right" />
    <Handle id="bottom" :position="Position.Bottom" />
    <Handle id="left" :position="Position.Left" />
    <!--Handle id="handle-proc5" :position="Position.Right" style="top: 11px; right: 11px;" />
    <Handle id="handle-proc6" :position="Position.Right" style="bottom: 8px; right: 8px; top: auto;" />
    <Handle id="handle=proc7" :position="Position.Left" style="top: 11px; left: 11px;"/>
    <Handle id="handle=proc8" :position="Position.Left" style="bottom: 8px; left: 8px; top: auto"/-->
  </div>
</template>
