<script setup lang="ts">
  import type { Model } from '@dethernety/dt-core'

  // Mirror of ClassPreview but for the represents-a-model branch.
  // Models carry no category / module metadata — only name and description —
  // so the card has a header and a single description row.
  interface Props { modelItem: Pick<Model, 'id' | 'name' | 'description'> | null }
  defineProps<Props>()
</script>

<template>
  <v-card v-if="modelItem" class="pa-4" flat>
    <div class="text-h6">{{ modelItem.name || '—' }}</div>
    <v-row class="mt-2">
      <v-col cols="12">
        <div class="text-caption text-disabled">Description</div>
        <div>{{ modelItem.description || '—' }}</div>
      </v-col>
    </v-row>
  </v-card>
  <v-card v-else class="pa-4" flat>
    <div class="text-caption text-disabled">No model selected</div>
  </v-card>
</template>
