<script setup lang="ts">
  /**
   * Tactic facet chips for the TechniquePickerSheet.
   *
   * Mirrors ClassPickerFacets visually + behaviourally: the parent feeds a
   * pre-narrowed facet list with counts (derived from the currently-filtered
   * entry set), so when a tactic is selected the unselected chips disappear
   * — same drill-down UX as the class-picker's category chips.
   *
   * Static killchain ordering is the parent's responsibility; this component
   * renders whatever `facets` it's given, in order.
   *
   * For ATTACK_MITIGATION the parent simply passes an empty `facets` array
   * (mitigations have no tactic) and the component renders nothing.
   */

  interface FacetEntry { readonly value: string; readonly count: number }

  interface Props {
    facets: readonly FacetEntry[]
    selected: readonly string[]
  }
  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:selected': [tactics: string[]]
  }>()

  function toggleTactic(tactic: string): void {
    const next = props.selected.includes(tactic)
      ? props.selected.filter(t => t !== tactic)
      : [...props.selected, tactic]
    emit('update:selected', next)
  }
</script>

<template>
  <div v-if="facets.length" class="technique-picker-facets">
    <div class="text-caption text-disabled facet-group-label">Tactic</div>
    <v-chip-group>
      <v-chip
        v-for="f in facets"
        :key="f.value"
        :class="['facet-chip', { 'facet-chip--selected': selected.includes(f.value) }]"
        :color="selected.includes(f.value) ? 'primary' : undefined"
        size="small"
        :variant="selected.includes(f.value) ? 'flat' : 'tonal'"
        @click="toggleTactic(f.value)"
      >
        {{ f.value }} ({{ f.count }})
      </v-chip>
    </v-chip-group>
  </div>
</template>

<style scoped>
  .technique-picker-facets {
    margin-bottom: 8px;
  }
  .facet-group-label {
    margin-bottom: 2px;
  }
  .facet-chip :deep(.v-chip__content) {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
