<script setup lang="ts">
  import { getBezierPath } from '@vue-flow/core'

  const props = defineProps(['id', 'sourceX', 'sourceY', 'targetX', 'targetY', 'sourcePosition', 'targetPosition', 'data'])

  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
</script>

<template>
  <path :id="id" class="vue-flow__edge-path" :d="edgePath" />
  <text>
    <textPath :href="`#${id}`" startOffset="50%" text-anchor="middle">
      {{ data.weight || 5 }}
    </textPath>
  </text>
</template>
