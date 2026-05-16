<script setup lang="ts">
  import { computed } from 'vue'

  interface FacetEntry { readonly value: string; readonly count: number }
  interface ModuleFacetEntry { readonly moduleId: string; readonly moduleName: string; readonly count: number }

  interface FacetCounts {
    readonly categories: readonly FacetEntry[]
    readonly modules: readonly ModuleFacetEntry[]
    readonly types: readonly FacetEntry[]
  }

  interface Props {
    classLabel: 'COMPONENT' | 'DATA_FLOW' | 'DATA' | 'SECURITY_BOUNDARY' | 'CONTROL'
    facetCounts: FacetCounts
    selectedCategories: readonly string[]
    selectedModuleIds: readonly string[]
  }
  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:selectedCategories': [value: string[]]
    'update:selectedModuleIds': [value: string[]]
  }>()

  // Type filtering is not exposed — for COMPONENT classes the type is locked
  // by the node context (set in the parent sheet via componentType); for
  // DATA_FLOW / SECURITY_BOUNDARY a type filter has no meaning. Either way
  // the user shouldn't be able to switch types from this picker.
  const sortedCategories = computed(() =>
    [...props.facetCounts.categories].sort((a, b) => b.count - a.count),
  )
  const sortedModules = computed(() =>
    [...props.facetCounts.modules].sort((a, b) => b.count - a.count),
  )

  function toggleCategory(value: string): void {
    const next = props.selectedCategories.includes(value)
      ? props.selectedCategories.filter(v => v !== value)
      : [...props.selectedCategories, value]
    emit('update:selectedCategories', next)
  }

  function toggleModule(moduleId: string): void {
    const next = props.selectedModuleIds.includes(moduleId)
      ? props.selectedModuleIds.filter(v => v !== moduleId)
      : [...props.selectedModuleIds, moduleId]
    emit('update:selectedModuleIds', next)
  }
</script>

<template>
  <div class="class-picker-facets">
    <div v-if="sortedCategories.length" class="facet-group facet-group--category">
      <div class="text-caption text-disabled facet-group-label">Category</div>
      <v-chip-group>
        <v-chip
          v-for="c in sortedCategories"
          :key="c.value"
          :class="['facet-chip', { 'facet-chip--selected': selectedCategories.includes(c.value) }]"
          :color="selectedCategories.includes(c.value) ? 'primary' : undefined"
          size="small"
          :variant="selectedCategories.includes(c.value) ? 'flat' : 'tonal'"
          @click="toggleCategory(c.value)"
        >
          {{ c.value }} ({{ c.count }})
        </v-chip>
      </v-chip-group>
    </div>

    <div v-if="sortedModules.length" class="facet-group facet-group--module">
      <div class="text-caption text-disabled facet-group-label">Module</div>
      <v-chip-group show-arrows>
        <v-chip
          v-for="m in sortedModules"
          :key="m.moduleId"
          :class="['facet-chip', { 'facet-chip--selected': selectedModuleIds.includes(m.moduleId) }]"
          :color="selectedModuleIds.includes(m.moduleId) ? 'primary' : undefined"
          size="small"
          :title="`${m.moduleName} (${m.count})`"
          :variant="selectedModuleIds.includes(m.moduleId) ? 'flat' : 'tonal'"
          @click="toggleModule(m.moduleId)"
        >
          {{ m.moduleName }} ({{ m.count }})
        </v-chip>
      </v-chip-group>
    </div>
  </div>
</template>

<style scoped>
  .facet-group {
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
