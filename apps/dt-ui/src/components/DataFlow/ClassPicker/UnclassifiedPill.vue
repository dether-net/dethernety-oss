<script setup lang="ts">
  interface Props {
    visible: boolean
    // Where to anchor the icon inside the host node:
    //   'corner' — top-left of the bounding box (rectangular nodes).
    //   'circle' — offset inward along the circle's perimeter, since a 4px
    //              corner offset on a round node would sit outside the
    //              visible shape.
    placement?: 'corner' | 'circle'
  }
  withDefaults(defineProps<Props>(), { placement: 'corner' })
</script>

<template>
  <v-tooltip
    v-if="visible"
    location="top"
    text="No class assigned. Open Settings to assign one."
  >
    <template #activator="{ props: tooltipProps }">
      <v-icon
        v-bind="tooltipProps"
        :class="['unclassified-pill', `unclassified-pill--${placement}`]"
        icon="mdi-help-circle-outline"
        color="warning"
        size="small"
        variant="tonal"
      />
    </template>
  </v-tooltip>
</template>

<style scoped>
  .unclassified-pill {
    position: absolute;
    z-index: 1;
    cursor: default;
  }
  .unclassified-pill--corner {
    bottom: 4px;
    right: 4px;
  }
  /* Inscribed-circle geometry: the perimeter at 225° crosses the bounding
     box at ~14.6% from each edge. 15% keeps the whole glyph inside the
     visible disc for the Process node's typical 80–120px diameter range. */
  .unclassified-pill--circle {
    top: 15%;
    left: 15%;
  }
</style>
