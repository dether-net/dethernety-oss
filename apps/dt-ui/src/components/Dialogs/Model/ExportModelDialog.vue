<script setup lang="ts">
  import { ref } from 'vue'
  import { useApolloClient } from '@vue/apollo-composable'
  import { DtExportSplit } from '@dethernety/dt-core'
  import { splitModelToZip } from '@/utils/modelZipUtils'

  interface Props {
    modelId: string
    show: boolean
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['update:show'])
  const dialog = ref(props.show)
  const modelId = ref(props.modelId)
  const isExporting = ref(false)
  const errorMessage = ref('')

  const { client } = useApolloClient()
  const dtExportSplit = new DtExportSplit(client!)

  const handleClose = () => {
    emits('update:show', false)
  }

  const exportModel = async () => {
    try {
      isExporting.value = true
      errorMessage.value = ''

      const splitModel = await dtExportSplit.exportModelToSplit(modelId.value)
      const zipData = splitModelToZip(splitModel)

      const blob = new Blob([new Uint8Array(zipData)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${splitModel.manifest.model.name || modelId.value}-export.zip`

      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      handleClose()
    } catch (error) {
      console.error('Error exporting model:', error)
      errorMessage.value = error instanceof Error ? error.message : 'An error occurred during export'
    } finally {
      isExporting.value = false
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
        <p>This will export the current model layout (boundaries, components, data flows) as a ZIP archive.</p>

        <v-alert
          v-if="errorMessage"
          class="mt-4"
          dismissible
          type="error"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="py-6 mx-6">
        <v-spacer />
        <v-btn
          color="secondary"
          :disabled="isExporting"
          icon="mdi-download-outline"
          :loading="isExporting"
          size="x-large"
          variant="outlined"
          @click="exportModel"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
