<script setup lang="ts">
  import { ref } from 'vue'
  import { useApolloClient } from '@vue/apollo-composable'
  import { DtExport } from '@dethernety/dt-core'

  interface Props {
    modelId: string
    show: boolean
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['update:show'])
  const dialog = ref(props.show)
  const modelId = ref(props.modelId)
  
  const { client } = useApolloClient()
  const dtExport = new DtExport(client!)
  
  const handleClose = () => {
    emits('update:show', false)
  }

  const exportModel = async () => {
    try {
      await dtExport.exportAndDownload(modelId.value, modelId.value)
      handleClose()
    } catch (error) {
      console.error('Error exporting model:', error)
      handleClose()
    }
  }
</script>

<template>
  <v-dialog
    v-model="dialog"
    max-width="500"
    @click:outside="handleClose"
    @keydown.esc="handleClose"
    @update:model-value="handleClose"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-download-outline</v-icon>
            <span class="ml-2 text-body-1">Export Model</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="handleClose"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        This will export the current model layout (boundaries, components, data flows) as a JSON file.
      </v-card-text>
      <v-card-actions class="py-6 mx-6">
        <v-spacer />
        <v-btn
          color="secondary"
          icon="mdi-download-outline"
          size="x-large"
          variant="outlined"
          @click="exportModel"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
