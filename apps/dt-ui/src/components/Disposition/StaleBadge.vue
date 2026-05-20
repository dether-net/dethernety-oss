<script setup lang="ts">
  // Shared "(N)" badge for stale dispositions on a tab label. Rendered
  // identically by the Exposures tab and the Countermeasures sub-table so the
  // two disposition venues stay visually consistent.
  interface Props {
    count: number
  }
  const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    class="text-warning ml-1"
    :aria-label="`${props.count} ${props.count === 1 ? 'needs' : 'need'} review`"
  >({{ props.count }})</span>
</template>
