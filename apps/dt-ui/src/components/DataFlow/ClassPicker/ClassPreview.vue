<script setup lang="ts">
  import type { ClassCandidate } from '@/stores/classSuggestionsStore'
  import type { ClassRecord } from '@/composables/useRecentClasses'

  export type ClassPreviewable =
    | Pick<ClassCandidate, 'classId' | 'className' | 'classCategory' | 'classDescription' | 'moduleName'>
    | ClassRecord

  interface Props { classItem: ClassPreviewable | null }
  defineProps<Props>()
</script>

<template>
  <v-card v-if="classItem" class="pa-4" flat>
    <div class="text-h6">{{ classItem.className }}</div>
    <v-row class="mt-2">
      <v-col cols="6">
        <div class="text-caption text-disabled">Category</div>
        <div>{{ classItem.classCategory || '—' }}</div>
      </v-col>
      <v-col cols="6">
        <div class="text-caption text-disabled">Module</div>
        <div>{{ classItem.moduleName || '—' }}</div>
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-disabled">Description</div>
        <div>{{ ('classDescription' in classItem && classItem.classDescription) || '—' }}</div>
      </v-col>
    </v-row>
  </v-card>
  <v-card v-else class="pa-4" flat>
    <div class="text-caption text-disabled">No class selected</div>
  </v-card>
</template>
