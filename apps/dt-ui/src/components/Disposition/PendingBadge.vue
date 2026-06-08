<script setup lang="ts">
  // Terse "(N)" pending-count cue for a tab label, mirroring StaleBadge's format so
  // it fits the narrow vertical tab rail (cols="2"). Info-blue — distinct from the
  // amber StaleBadge and tied to the blue Affirm action — but not alarming. The full
  // "N awaiting review" lives in the tooltip/aria-label.
  interface Props {
    count: number
  }
  const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    class="text-info ml-1"
    :aria-label="`${props.count} awaiting review`"
    :title="`${props.count} awaiting review`"
  >({{ props.count }})</span>
</template>
