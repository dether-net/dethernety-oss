<script setup lang="ts">
  import { ref } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Exposure } from '@dethernety/dt-core'
  import ExposuresPanel from '@/components/DataFlow/ExposuresPanel.vue'
  import ExposuresDialog from '@/components/Dialogs/DataFlow/ExposuresDialog.vue'

  // Thin host around ExposuresPanel. The panel owns the table, all action handlers,
  // the nested dialogs and the snackbar; this component preserves the public
  // props/emits contract its two consumers depend on (SettingsWindow and DataDialog)
  // and forwards through to the panel. It also hosts the maximize affordance: the
  // compact panel emits `maximize`, which opens the master-detail ExposuresDialog
  // (rendering the same panel in its expanded variant). Both consumers get this for free.
  //
  // `selectedItem` is the host element the exposures belong to — a vue-flow Node/Edge
  // (the SettingsWindow canvas selection) OR a minimal { id, data: { label } } shape
  // (a Data entity opened from DataDialog).
  interface Props {
    selectedItem: Node | Edge | { id: string; data?: { label?: string | null } } | null;
    exposures: Exposure[];
  }

  defineProps<Props>()

  defineEmits<{
    'updateForm': [];
    'redirect:issue': [];
    /** Parent renders the badge using this count. */
    'update:staleCount': [count: number];
    /** Parent renders the "awaiting review" badge using this count. */
    'update:pendingCount': [count: number];
  }>()

  const showExposuresDialog = ref(false)
</script>

<template>
  <div>
    <ExposuresPanel
      variant="compact"
      :selected-item="selectedItem"
      :exposures="exposures"
      @update-form="$emit('updateForm')"
      @redirect:issue="$emit('redirect:issue')"
      @update:stale-count="$emit('update:staleCount', $event)"
      @update:pending-count="$emit('update:pendingCount', $event)"
      @maximize="showExposuresDialog = true"
    />
    <ExposuresDialog
      v-if="showExposuresDialog"
      :show="showExposuresDialog"
      :selected-item="selectedItem"
      :exposures="exposures"
      @close="showExposuresDialog = false"
      @update-form="$emit('updateForm')"
      @redirect:issue="$emit('redirect:issue')"
    />
  </div>
</template>
