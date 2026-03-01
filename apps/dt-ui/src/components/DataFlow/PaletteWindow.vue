<script setup lang="ts">
  import { useDragAndDrop } from '@/utils/dataFlowUtils'
  const { onDragStart } = useDragAndDrop()
</script>

<template>
  <div class="palette-container">
    <div class="palette-node vue-flow__node vue-flow__node-PROCESS" :draggable="true" @dragstart="onDragStart($event, 'PROCESS')">Process</div>
    <div class="palette-node vue-flow__node vue-flow__node-STORE" :draggable="true" @dragstart="onDragStart($event, 'STORE')">Store</div>
    <div class="palette-node vue-flow__node vue-flow__node-EXTERNAL_ENTITY" :draggable="true" @dragstart="onDragStart($event, 'EXTERNAL_ENTITY')">External Entity</div>
    <div class="palette-node vue-flow__node vue-flow__node-BOUNDARY" :draggable="true" @dragstart="onDragStart($event, 'BOUNDARY')">Boundary</div>
  </div>
</template>

<style scoped>
  @import '@/components/DataFlow/Style/main.css';

  .palette-container {
    text-transform: uppercase;
    display: flex;
    flex-direction: column;
    grid-template-columns: repeat(1, 1fr);
    gap: 25px; /* Optional: Adjust the gap between grid items */
    height: 400px;
    align-items: center;
    justify-content: center;

  }

  .palette-node {
    box-sizing: border-box!; /* Ensure padding and border are included in the element's total width and height */
    position: relative;
    color: #fff;
  }
</style>
