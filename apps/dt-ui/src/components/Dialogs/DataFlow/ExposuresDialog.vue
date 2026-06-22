<script setup lang="ts">
  import { ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Exposure } from '@dethernety/dt-core'
  import ExposuresPanel from '@/components/DataFlow/ExposuresPanel.vue'

  // Maximized master-detail view of an element's exposures. A thin 90vw×85vh shell
  // (modeled on AttributesDialog) around <ExposuresPanel variant="expanded">. The panel
  // owns the table-less list/detail UI, all action handlers, the nested dialogs and the
  // snackbar — this component is purely the dialog frame + header.
  //
  // No buffered/persistent/discard path: exposures commit immediately (every action
  // refreshes via updateForm), so the dialog is plainly dismissable.
  interface Props {
    show: boolean;
    selectedItem: Node | Edge | { id: string; data?: { label?: string | null } } | null;
    exposures: Exposure[];
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'close': [];
    'updateForm': [];
    'redirect:issue': [];
  }>()

  const showDialog = ref(props.show)
  watch(() => props.show, v => { showDialog.value = v })

  const onClose = () => {
    showDialog.value = false
    emit('close')
  }
</script>

<template>
  <v-dialog
    v-model="showDialog"
    class="rounded-lg"
    height="85vh"
    width="90vw"
    @click:outside="onClose"
    @keydown.esc="onClose"
    @update:model-value="(val) => { if (!val) onClose() }"
  >
    <v-card class="overflow-hidden pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet
          class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between"
          color="primary"
          density="compact"
          variant="plain"
        >
          <div>
            <v-icon
              class="mr-2"
              color="tertiary"
              icon="mdi-bug-outline"
              size="small"
            />
            <!-- Defensive title: an Edge host may lack data.label — fall back rather
                 than render "Exposures of ". -->
            <span class="ml-2 text-body-1">Exposures of {{ selectedItem?.data?.label || 'this element' }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="onClose"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text class="pa-0">
        <ExposuresPanel
          variant="expanded"
          :selected-item="selectedItem"
          :exposures="exposures"
          @update-form="emit('updateForm')"
          @redirect:issue="emit('redirect:issue')"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
