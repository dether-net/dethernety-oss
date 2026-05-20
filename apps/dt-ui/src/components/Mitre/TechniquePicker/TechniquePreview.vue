<script setup lang="ts">
  import { computed } from 'vue'
  import type { CatalogEntry } from '@/stores/techniqueSuggestionsStore'
  import type { MitreKind } from '@dethernety/dt-core'

  /**
   * Preview pane for the TechniquePickerSheet "Browse all" drawer.
   * Visually mirrors ClassPreview: plain flat card, no tint. Description
   * overflow is handled by the sheet-level `.sheet-preview` scroll
   * container (max-height: 28vh) in TechniquePickerSheet.
   *
   * Kind-aware id label: "ATT&CK ID" for ATTACK_TECHNIQUE / ATTACK_MITIGATION,
   * "D3FEND ID" for DEFEND_TECHNIQUE. The tactic row is omitted for
   * ATTACK_MITIGATION (mitigations have no tactic).
   */

  interface Props {
    item: CatalogEntry | null
    kind: MitreKind
  }
  const props = defineProps<Props>()

  const idLabel = computed<string>(() => {
    switch (props.kind) {
      case 'DEFEND_TECHNIQUE': return 'D3FEND ID'
      case 'ATTACK_MITIGATION': return 'ATT&CK ID'
      case 'ATTACK_TECHNIQUE': return 'ATT&CK ID'
      default: return 'ID'
    }
  })

  const showTactic = computed(() => props.kind !== 'ATTACK_MITIGATION')

  const emptyText = computed(() => {
    if (props.kind === 'ATTACK_MITIGATION') return 'No mitigation selected'
    if (props.kind === 'DEFEND_TECHNIQUE') return 'No defense selected'
    return 'No technique selected'
  })
</script>

<template>
  <v-card v-if="item" class="pa-4" flat>
    <div class="text-h6">{{ item.name }}</div>
    <v-row class="mt-2">
      <v-col cols="6">
        <div class="text-caption text-disabled">{{ idLabel }}</div>
        <div class="font-monospace">{{ item.mitreId }}</div>
      </v-col>
      <v-col v-if="showTactic" cols="6">
        <div class="text-caption text-disabled">Tactic</div>
        <div>{{ item.tactic || '—' }}</div>
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-disabled">Description</div>
        <div>{{ item.description || '—' }}</div>
      </v-col>
    </v-row>
  </v-card>
  <v-card v-else class="pa-4" flat>
    <div class="text-caption text-disabled">{{ emptyText }}</div>
  </v-card>
</template>
