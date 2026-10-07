<script setup lang="ts">
  // Per-row badge for a class-derived finding (Exposure or Countermeasure) whose
  // class declares references the platform could not link: an id missing from the
  // loaded MITRE data, or a reference to a kind of node its field does not allow.
  // The platform records them on the finding; this lists them. Renders nothing
  // when every reference linked.
  import { computed } from 'vue'

  interface Props {
    references?: string[] | null
  }
  const props = defineProps<Props>()
  const refs = computed(() => props.references ?? [])
</script>

<template>
  <v-tooltip v-if="refs.length" location="top" max-width="360">
    <template #activator="{ props: activator }">
      <v-chip
        v-bind="activator"
        :aria-label="`${refs.length} unlinked reference(s): ${refs.join(', ')}`"
        class="ma-1"
        color="warning"
        prepend-icon="mdi-link-variant-off"
        size="x-small"
        variant="outlined"
      >
        {{ refs.length }} unlinked
      </v-chip>
    </template>
    <div>The class references these, but they could not be linked (not in the loaded MITRE data, or not allowed here):</div>
    <div>{{ refs.join(', ') }}</div>
  </v-tooltip>
</template>
